import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CSS2DRenderer } from 'three/addons/renderers/CSS2DRenderer.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { makeDeskPlateTexture, makeHeadLabel, makeLeaderLine, ZONE_A_STAGGER } from './labels.js';

// v6 规范：剖面式制图室 10.8m x 7.6m x 3.3m，FOV 33，ACES 曝光 1.04。
const ROOM = { w: 10.8, d: 7.6, h: 3.3 };
const CAMERA_FOV = 33;
const EXPOSURE = 1.04;

// 运行时读 config/models.json；加载失败时用这份离线快照（与 2026-11-21 已验证内容一致）。
const FALLBACK_CONFIG = {
  schemaVersion: 3,
  updated: '2026-11-21',
  agents: [
    { id: 1, name: 'GPT', provider: 'OpenAI', plan: 'Plus', status: 'verified', defaultModel: 'GPT-6', models: ['GPT-6', 'GPT-5.6 Sol'], thinkingLevel: 'Medium', lastVerifiedAt: '2026-11-21' },
    { id: 2, name: 'Claude', provider: 'Anthropic', plan: null, status: 'pending', defaultModel: null, models: [], thinkingLevel: null, lastVerifiedAt: null },
    { id: 3, name: 'Gemini', provider: 'Google', plan: 'Google AI Ultra', status: 'verified', defaultModel: '4 Neon', models: ['自动', '4 Hydrogen', '4 Neon', '4 Carbon'], thinkingLevel: 'Low', lastVerifiedAt: '2026-11-21' },
    { id: 4, name: 'Grok', provider: 'xAI', plan: null, status: 'pending', defaultModel: null, models: [], thinkingLevel: null, lastVerifiedAt: null },
    { id: 5, name: 'Antigravity', provider: 'Google', plan: 'Google AI Ultra', status: 'verified', defaultModel: 'Gemini 4 Neon High', models: ['Gemini 4 Neon High', '4 Carbon Medium', '4 Argon Medium', '4 Hydrogen Medium', '3.8 Flash Medium', 'Claude Opus 5.5 Medium', 'Claude Sonnet 5.5 Medium', 'GPT-OSS 120B Medium'], thinkingLevel: 'High', lastVerifiedAt: '2026-11-21' },
  ],
};

// 办公室内部的状态快照（不是持续同步，见顶栏标注）。
const SNAPSHOT = {
  1: { status: '工作中', task: '正在比较地区价格', progress: 62 },
  2: { status: '待核对', task: '—', progress: 0 },
  3: { status: '思考中', task: 'BatchNorm 与 MLP 问答', progress: 40 },
  4: { status: '待核对', task: '—', progress: 0 },
  5: { status: '工作中', task: 'PyTorch 进阶学习规划', progress: 78 },
};

const STATUS_COLORS = { '工作中': 0x3f7d4e, '思考中': 0xb98a1d, '待核对': 0x8a8378 };
const ACCENTS = { GPT: 0x3f7d4e, Claude: 0xc46a3b, Gemini: 0x3b6fd4, Grok: 0x2b2620, Antigravity: 0xb0703c };

// 工位布局：Zone A 双岛（Antigravity 左半、Gemini 右半），Zone B GPT 独立桌，Zone C 访客长凳。
const LAYOUT = {
  5: { x: -3.9, z: -2.2, zone: 'A' },
  3: { x: -0.9, z: -2.2, zone: 'A' },
  1: { x: 3.6, z: -1.4, zone: 'B', rotY: -0.35 },
  2: { x: -1.4, z: 2.5, zone: 'C' },
  4: { x: 1.4, z: 2.5, zone: 'C' },
};

const state = {
  config: FALLBACK_CONFIG,
  selectedModels: {},
  currentAgent: null,
  currentTopic: '',
  cameraGoal: null,
};

const container = document.getElementById('scene-container');
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = EXPOSURE;
container.appendChild(renderer.domElement);

const labelRenderer = new CSS2DRenderer();
labelRenderer.setSize(window.innerWidth, window.innerHeight);
labelRenderer.domElement.style.position = 'absolute';
labelRenderer.domElement.style.top = '0';
labelRenderer.domElement.style.pointerEvents = 'none';
container.appendChild(labelRenderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0xf4efe4);

const camera = new THREE.PerspectiveCamera(CAMERA_FOV, window.innerWidth / window.innerHeight, 0.1, 100);
camera.position.set(7.5, 5.2, 9.5);

const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 0.8, 0);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.maxPolarAngle = Math.PI / 2.15;
controls.minDistance = 3;
controls.maxDistance = 18;

// PMREM 环境光（IBL）。
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

const hemi = new THREE.HemisphereLight(0xfff6e6, 0x8a7a62, 0.55);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xfff2dd, 1.6);
sun.position.set(6, 8, 4);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.left = -8;
sun.shadow.camera.right = 8;
sun.shadow.camera.top = 8;
sun.shadow.camera.bottom = -8;
scene.add(sun);

const pickables = []; // { mesh, agentId }
const deskPlates = {}; // agentId -> { mesh, texture }
const headLabels = {}; // agentId -> CSS2DObject

function std(color, roughness = 0.85) {
  return new THREE.MeshStandardMaterial({ color, roughness });
}

function buildRoom() {
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(ROOM.w, ROOM.d), std(0xb08a5e, 0.8));
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);

  // 剖面式：只留后墙和左墙，前方和右侧切开。
  const wallMat = std(0xefe7d6, 0.95);
  const backWall = new THREE.Mesh(new THREE.BoxGeometry(ROOM.w, ROOM.h, 0.12), wallMat);
  backWall.position.set(0, ROOM.h / 2, -ROOM.d / 2);
  backWall.receiveShadow = true;
  scene.add(backWall);
  const leftWall = new THREE.Mesh(new THREE.BoxGeometry(0.12, ROOM.h, ROOM.d), wallMat);
  leftWall.position.set(-ROOM.w / 2, ROOM.h / 2, 0);
  leftWall.receiveShadow = true;
  scene.add(leftWall);

  // 后墙窗户（发光面）。
  const windowMesh = new THREE.Mesh(
    new THREE.PlaneGeometry(3.6, 1.8),
    new THREE.MeshStandardMaterial({ color: 0xdfeaf2, emissive: 0xcfdfe8, emissiveIntensity: 0.7 }),
  );
  windowMesh.position.set(-2.4, 2.0, -ROOM.d / 2 + 0.08);
  scene.add(windowMesh);

  // 地毯（Zone A 岛下）。
  const rug = new THREE.Mesh(new THREE.CircleGeometry(2.6, 48), std(0xd8c9a8, 1));
  rug.rotation.x = -Math.PI / 2;
  rug.position.set(-2.4, 0.01, -2.2);
  rug.receiveShadow = true;
  scene.add(rug);

  // 书架（左墙）、沙发（右侧）、绿植。
  const shelf = new THREE.Mesh(new THREE.BoxGeometry(0.5, 2.2, 1.8), std(0x8a6a44, 0.8));
  shelf.position.set(-ROOM.w / 2 + 0.35, 1.1, 1.6);
  shelf.castShadow = true;
  scene.add(shelf);
  const sofaBase = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.45, 0.85), std(0x7a6a58, 1));
  sofaBase.position.set(4.1, 0.23, 1.8);
  sofaBase.castShadow = true;
  scene.add(sofaBase);
  const sofaBack = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.7, 0.25), std(0x7a6a58, 1));
  sofaBack.position.set(4.1, 0.7, 2.15);
  sofaBack.castShadow = true;
  scene.add(sofaBack);
  for (const [x, z] of [[-5.0, -3.2], [5.0, -3.0]]) {
    const pot = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.18, 0.35, 16), std(0xa8663c, 0.9));
    pot.position.set(x, 0.18, z);
    pot.castShadow = true;
    scene.add(pot);
    const leaves = new THREE.Mesh(new THREE.ConeGeometry(0.42, 1.0, 12), std(0x4a7a45, 1));
    leaves.position.set(x, 0.85, z);
    leaves.castShadow = true;
    scene.add(leaves);
  }
}

function buildAvatar(agent) {
  const g = new THREE.Group();
  const accent = new THREE.Color(ACCENTS[agent.name] ?? 0x8a8378);
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.28, 0.5, 6, 16), std(0xf5c542, 0.6));
  body.position.y = 0.62;
  body.castShadow = true;
  g.add(body);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.26, 24, 18), std(0xf5c542, 0.55));
  head.position.y = 1.22;
  head.castShadow = true;
  g.add(head);
  // 头盔面罩。
  const visor = new THREE.Mesh(
    new THREE.SphereGeometry(0.27, 24, 18, -0.7, 1.4, 1.1, 0.9),
    new THREE.MeshStandardMaterial({ color: 0x2b2620, roughness: 0.25, metalness: 0.35 }),
  );
  visor.position.y = 1.22;
  g.add(visor);
  //  accent 环。
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.3, 0.03, 10, 32), new THREE.MeshStandardMaterial({ color: accent, roughness: 0.5 }));
  ring.rotation.x = Math.PI / 2;
  ring.position.y = 0.92;
  g.add(ring);
  return g;
}

function buildDesk(agent) {
  const { x, z, rotY = 0 } = LAYOUT[agent.id];
  const g = new THREE.Group();
  g.position.set(x, 0, z);
  g.rotation.y = rotY;

  const top = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.06, 0.85), std(0x9a7a52, 0.7));
  top.position.y = 0.74;
  top.castShadow = true;
  top.receiveShadow = true;
  g.add(top);
  for (const sx of [-0.75, 0.75]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.74, 0.07), std(0x4a4038, 0.6));
    leg.position.set(sx, 0.37, 0);
    leg.castShadow = true;
    g.add(leg);
  }
  const monitor = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.45, 0.04), std(0x2b2620, 0.4));
  monitor.position.set(0, 1.05, -0.22);
  monitor.castShadow = true;
  g.add(monitor);
  const stand = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.28, 0.08), std(0x4a4038, 0.6));
  stand.position.set(0, 0.88, -0.22);
  g.add(stand);
  const keyboard = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.03, 0.22), std(0xe8e2d4, 0.7));
  keyboard.position.set(0, 0.79, 0.08);
  g.add(keyboard);

  // 桌牌：单层 1024x384 贴图。
  const defaultModel = state.selectedModels[agent.id] ?? agent.defaultModel;
  const tex = makeDeskPlateTexture(agent, defaultModel);
  tex.anisotropy = Math.min(16, renderer.capabilities.getMaxAnisotropy());
  const plate = new THREE.Mesh(
    new THREE.PlaneGeometry(1.2, 0.45),
    new THREE.MeshStandardMaterial({ map: tex, roughness: 0.85 }),
  );
  plate.position.set(0, 0.82, 0.45);
  plate.rotation.x = -0.12;
  g.add(plate);
  deskPlates[agent.id] = { mesh: plate, texture: tex };

  // 状态点。
  const snap = SNAPSHOT[agent.id];
  const dot = new THREE.Mesh(
    new THREE.SphereGeometry(0.06, 12, 10),
    new THREE.MeshStandardMaterial({ color: STATUS_COLORS[snap.status], roughness: 0.4 }),
  );
  dot.position.set(0.78, 0.8, 0.32);
  g.add(dot);

  // 椅子 + 坐着的形象。
  const avatar = buildAvatar(agent);
  avatar.position.set(0, 0, -0.78);
  g.add(avatar);
  const chair = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.08, 0.5), std(0x6b5a44, 0.9));
  chair.position.set(0, 0.42, -0.78);
  chair.castShadow = true;
  g.add(chair);

  // 头顶标签：Zone A 按错开方案锚定，否则挂在头像顶上方 0.5m。
  const stagger = ZONE_A_STAGGER[agent.name];
  const label = makeHeadLabel(agent, defaultModel);
  const avatarTopY = 1.48;
  const anchor = new THREE.Vector3(
    x + (stagger ? stagger.dx : 0),
    avatarTopY + (stagger ? stagger.dy : 0.5),
    z - 0.78,
  );
  label.position.copy(anchor);
  scene.add(label);
  headLabels[agent.id] = label;
  if (stagger) {
    const topPoint = new THREE.Vector3(x, avatarTopY, z - 0.78);
    scene.add(makeLeaderLine(topPoint, anchor));
  }

  // 点击拾取用：桌面 + 显示器。
  for (const m of [top, monitor]) {
    m.userData.agentId = agent.id;
    pickables.push(m);
  }
  scene.add(g);
  return g;
}

function daysSince(dateStr) {
  if (!dateStr) return null;
  return Math.floor((Date.now() - new Date(dateStr).getTime()) / 86400000);
}

function updateDock() {
  const agent = state.currentAgent
    ? state.config.agents.find((a) => a.id === state.currentAgent)
    : null;
  document.getElementById('chip-agent').textContent = agent ? agent.name : '—';
  document.getElementById('chip-model').textContent = agent
    ? (state.selectedModels[agent.id] ?? agent.defaultModel ?? '待核对')
    : '—';
  document.getElementById('chip-thinking').textContent = agent ? (agent.thinkingLevel ?? '—') : '—';
  document.getElementById('chip-topic').textContent = state.currentTopic || '—';
}

function renderDrawer() {
  const agents = state.config.agents;
  const agentsPanel = document.getElementById('panel-agents');
  agentsPanel.innerHTML = '';
  for (const agent of agents) {
    const snap = SNAPSHOT[agent.id];
    const btn = document.createElement('button');
    btn.className = 'agent-row';
    const dot = document.createElement('span');
    dot.className = 'dot';
    dot.style.background = `#${STATUS_COLORS[snap.status].toString(16).padStart(6, '0')}`;
    const text = document.createElement('span');
    text.textContent = `${agent.name} · ${snap.status} — ${snap.task}`;
    btn.append(dot, text);
    btn.addEventListener('click', () => focusAgent(agent.id));
    agentsPanel.appendChild(btn);
  }

  const modelsPanel = document.getElementById('panel-models');
  modelsPanel.innerHTML = '';
  for (const agent of agents) {
    const title = document.createElement('h3');
    title.style.cssText = 'font-size:12px;color:#6b6257;margin:10px 0 6px;letter-spacing:1px;';
    title.textContent = `${agent.name}（${agent.plan ?? '未接入'}）`;
    modelsPanel.appendChild(title);
    if (agent.models.length === 0) {
      const note = document.createElement('div');
      note.textContent = '模型列表待核对，仅支持自定义输入。';
      const chip = document.createElement('span');
      chip.className = 'model-chip pending';
      chip.textContent = '自定义模型';
      chip.addEventListener('click', () => openDialogue(agent.id, ''));
      note.appendChild(document.createElement('br'));
      note.appendChild(chip);
      modelsPanel.appendChild(note);
      continue;
    }
    for (const model of agent.models) {
      const chip = document.createElement('span');
      chip.className = 'model-chip';
      chip.textContent = model;
      if ((state.selectedModels[agent.id] ?? agent.defaultModel) === model) chip.classList.add('active');
      chip.addEventListener('click', () => selectModel(agent.id, model));
      modelsPanel.appendChild(chip);
    }
  }

  const checkPanel = document.getElementById('panel-check');
  checkPanel.innerHTML = '';
  for (const agent of agents) {
    const row = document.createElement('div');
    row.className = 'check-row';
    const days = daysSince(agent.lastVerifiedAt);
    let statusHtml;
    if (agent.status !== 'verified') {
      statusHtml = '<span class="warn">未验证 · 模型列表待核对</span>';
    } else if (days !== null && days > 14) {
      statusHtml = `<span class="warn">已超过 ${days} 天未核对，需要重新验证</span>`;
    } else {
      statusHtml = `<span class="ok">已验证 · ${days} 天前核对</span>`;
    }
    row.innerHTML = `<b>${agent.name}</b> · ${agent.provider}<br>${statusHtml}<br>默认模型：${agent.defaultModel ?? '—'} · 思考等级：${agent.thinkingLevel ?? '—'}`;
    checkPanel.appendChild(row);
  }
}

function selectModel(agentId, model) {
  state.selectedModels[agentId] = model;
  const agent = state.config.agents.find((a) => a.id === agentId);
  // 桌牌和头顶标签同步更新。
  const plate = deskPlates[agentId];
  if (plate) {
    plate.texture.dispose();
    const tex = makeDeskPlateTexture(agent, model);
    tex.anisotropy = Math.min(16, renderer.capabilities.getMaxAnisotropy());
    plate.mesh.material.map = tex;
    plate.mesh.material.needsUpdate = true;
    plate.texture = tex;
  }
  const label = headLabels[agentId];
  if (label) {
    const modelEl = label.element.querySelector('.model');
    if (modelEl) modelEl.textContent = model;
  }
  state.currentAgent = agentId;
  updateDock();
  renderDrawer();
  openInspector(agentId);
}

function focusAgent(agentId) {
  const { x, z } = LAYOUT[agentId];
  state.currentAgent = agentId;
  state.cameraGoal = {
    pos: new THREE.Vector3(x + 2.2, 2.4, z + 3.4),
    target: new THREE.Vector3(x, 1.0, z),
  };
  updateDock();
  openInspector(agentId);
}

function openInspector(agentId) {
  const agent = state.config.agents.find((a) => a.id === agentId);
  if (!agent) return;
  const snap = SNAPSHOT[agentId];
  const model = state.selectedModels[agentId] ?? agent.defaultModel;
  document.getElementById('inspector-title').textContent = `${agent.name} · ${agent.provider}`;
  document.getElementById('inspector-body').innerHTML = `
    <section><h3>状态</h3><div>${snap.status} · ${snap.task}${snap.progress ? ` · ${snap.progress}%` : ''}</div></section>
    <section><h3>套餐</h3><div>${agent.plan ?? '未接入'}</div></section>
    <section><h3>模型</h3><div>${model ?? '待核对（仅自定义输入）'} · 思考等级：${agent.thinkingLevel ?? '—'}</div></section>
    <section><h3>核对</h3><div>${agent.lastVerifiedAt ? `${agent.lastVerifiedAt} 验证` : '未验证'}</div></section>
    <div class="inspector-actions">
      <button id="inspector-chat">开新对话</button>
      <button class="secondary" id="inspector-custom">自定义输入</button>
    </div>`;
  document.getElementById('inspector').hidden = false;
  document.getElementById('inspector-chat').addEventListener('click', () => openDialogue(agentId, ''));
  document.getElementById('inspector-custom').addEventListener('click', () => {
    openDialogue(agentId, '');
    document.getElementById('dialogue-input').focus();
  });
}

function parseDialogueInput(text) {
  let agentId = state.currentAgent;
  let model = null;
  let topic = text;
  for (const agent of state.config.agents) {
    if (text.toLowerCase().includes(agent.name.toLowerCase())) {
      agentId = agent.id;
      topic = topic.replace(new RegExp(agent.name, 'i'), '').trim();
    }
    for (const m of agent.models) {
      if (text.includes(m)) {
        model = m;
        agentId = agent.id;
        topic = topic.replace(m, '').trim();
      }
    }
  }
  return { agentId, model, topic: topic.replace(/^[：:、，,\s]+/, '') };
}

function openDialogue(agentId, topic) {
  state.currentAgent = agentId;
  state.currentTopic = topic;
  const agent = state.config.agents.find((a) => a.id === agentId);
  document.getElementById('dialogue-title').textContent = agent
    ? `新对话 · ${agent.name}`
    : '新对话';
  document.getElementById('dialogue').hidden = false;
  updateDock();
}

function sendDialogue() {
  const input = document.getElementById('dialogue-input');
  const text = input.value.trim();
  if (!text) return;
  const log = document.getElementById('dialogue-log');
  const userMsg = document.createElement('div');
  userMsg.className = 'msg user';
  userMsg.textContent = text;
  log.appendChild(userMsg);

  const parsed = parseDialogueInput(text);
  if (parsed.agentId) state.currentAgent = parsed.agentId;
  if (parsed.model) state.selectedModels[parsed.agentId] = parsed.model;
  if (parsed.topic) state.currentTopic = parsed.topic;
  const agent = state.config.agents.find((a) => a.id === parsed.agentId);
  const model = parsed.model ?? (agent ? (state.selectedModels[agent.id] ?? agent.defaultModel) : null);
  const reply = document.createElement('div');
  reply.className = 'msg';
  reply.innerHTML = `<b>${agent ? agent.name : '办公室'}</b>（${model ?? '待核对'}）收到：${parsed.topic || '（无主题）'}。<br><span class="sim">办公室内部模拟回复，不是直连账号的真实会话。</span>`;
  log.appendChild(reply);
  input.value = '';
  log.scrollTop = log.scrollHeight;
  updateDock();
  renderDrawer();
}

function setView(name) {
  document.querySelectorAll('.view-btn').forEach((b) => b.classList.toggle('active', b.dataset.view === name));
  if (name === 'auto') {
    controls.autoRotate = !controls.autoRotate;
    controls.autoRotateSpeed = 0.8;
    return;
  }
  controls.autoRotate = false;
  if (name === 'panoramic') {
    state.cameraGoal = { pos: new THREE.Vector3(7.5, 5.2, 9.5), target: new THREE.Vector3(0, 0.8, 0) };
  } else if (name === 'closeup') {
    state.cameraGoal = { pos: new THREE.Vector3(-2.4, 2.2, 1.6), target: new THREE.Vector3(-2.4, 1.0, -2.2) };
  } else if (name === 'top') {
    state.cameraGoal = { pos: new THREE.Vector3(0, 12, 0.01), target: new THREE.Vector3(0, 0, 0) };
  }
}

async function loadConfig() {
  try {
    const res = await fetch('./config/models.json');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    if (json && Array.isArray(json.agents)) state.config = json;
  } catch (err) {
    document.getElementById('config-note').hidden = false;
    console.warn('config/models.json 加载失败，使用离线快照', err);
  }
  for (const agent of state.config.agents) {
    state.selectedModels[agent.id] = agent.defaultModel;
  }
}

function initUI() {
  document.querySelectorAll('#drawer-tabs button').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#drawer-tabs button').forEach((b) => b.classList.toggle('active', b === btn));
      document.getElementById('panel-agents').hidden = btn.dataset.tab !== 'agents';
      document.getElementById('panel-models').hidden = btn.dataset.tab !== 'models';
      document.getElementById('panel-check').hidden = btn.dataset.tab !== 'check';
    });
  });
  document.querySelectorAll('.view-btn').forEach((btn) => {
    btn.addEventListener('click', () => setView(btn.dataset.view));
  });
  document.getElementById('inspector-close').addEventListener('click', () => {
    document.getElementById('inspector').hidden = true;
  });
  document.getElementById('dialogue-close').addEventListener('click', () => {
    document.getElementById('dialogue').hidden = true;
  });
  document.getElementById('dialogue-send').addEventListener('click', sendDialogue);
  document.getElementById('dialogue-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') sendDialogue();
  });
  window.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      openDialogue(state.currentAgent ?? 1, '');
      document.getElementById('dialogue-input').focus();
    }
  });
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  let downPos = null;
  renderer.domElement.addEventListener('pointerdown', (e) => {
    downPos = [e.clientX, e.clientY];
  });
  renderer.domElement.addEventListener('pointerup', (e) => {
    if (!downPos) return;
    const moved = Math.hypot(e.clientX - downPos[0], e.clientY - downPos[1]);
    downPos = null;
    if (moved > 5) return;
    pointer.x = (e.clientX / window.innerWidth) * 2 - 1;
    pointer.y = -(e.clientY / window.innerHeight) * 2 + 1;
    raycaster.setFromCamera(pointer, camera);
    const hits = raycaster.intersectObjects(pickables, false);
    if (hits.length > 0) focusAgent(hits[0].object.userData.agentId);
  });
  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    labelRenderer.setSize(window.innerWidth, window.innerHeight);
  });
}

function animate() {
  requestAnimationFrame(animate);
  if (state.cameraGoal) {
    camera.position.lerp(state.cameraGoal.pos, 0.08);
    controls.target.lerp(state.cameraGoal.target, 0.08);
    if (camera.position.distanceTo(state.cameraGoal.pos) < 0.05) state.cameraGoal = null;
  }
  controls.update();
  renderer.render(scene, camera);
  labelRenderer.render(scene, camera);
}

async function main() {
  await loadConfig();
  buildRoom();
  for (const agent of state.config.agents) buildDesk(agent);
  initUI();
  renderDrawer();
  updateDock();
  animate();
}

main();
