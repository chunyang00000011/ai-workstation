import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CSS2DRenderer } from 'three/addons/renderers/CSS2DRenderer.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import {
  makeBossLabel,
  makeDeskPlateTexture,
  makeHeadLabel,
  makeLeaderLine,
  resolveZoneAOverlap,
  ZONE_A_STAGGER,
  ZONE_B_STAGGER,
} from './labels.js';
import { createBossNailong } from './boss.js';

// v6 规范：剖面式制图室 14.4m x 10.4m x 3.5m（宽敞巡逻通道），FOV 33，ACES 曝光 1.04，环境强度 0.42。
const ROOM = { w: 14.4, d: 10.4, h: 3.5 };
const CAMERA_FOV = 33;
const EXPOSURE = 1.04;
const ENV_INTENSITY = 0.42;
const REDUCED_MOTION = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// 运行时读 config/models.json；加载失败时用这份离线快照（与 2026-11-21 已验证内容一致）。
const FALLBACK_CONFIG = {
  schemaVersion: 3,
  updated: '2026-11-21',
  agents: [
    { id: 1, name: 'GPT 网页版', aliases: ['GPT', 'ChatGPT'], surface: 'Web', provider: 'OpenAI', plan: 'Plus', status: 'verified', defaultModel: 'GPT-6', models: ['GPT-6', 'GPT-5.6 Sol'], thinkingLevel: 'Medium', lastVerifiedAt: '2026-11-21', allowCustomModel: true },
    { id: 2, name: 'Claude', provider: 'Anthropic', plan: null, status: 'pending', defaultModel: null, models: [], thinkingLevel: null, lastVerifiedAt: null, allowCustomModel: true },
    { id: 3, name: 'Gemini', provider: 'Google', plan: 'Google AI Ultra', status: 'verified', defaultModel: '4 Neon', models: ['自动', '4 Hydrogen', '4 Neon', '4 Carbon'], thinkingLevel: 'Low', lastVerifiedAt: '2026-11-21', allowCustomModel: true },
    { id: 4, name: 'Grok', provider: 'xAI', plan: null, status: 'pending', defaultModel: null, models: [], thinkingLevel: null, lastVerifiedAt: null, allowCustomModel: true },
    { id: 5, name: 'Antigravity', provider: 'Google', plan: 'Google AI Ultra', status: 'verified', defaultModel: 'Gemini 4 Neon High', models: ['Gemini 4 Neon High', '4 Carbon Medium', '4 Argon Medium', '4 Hydrogen Medium', '3.8 Flash Medium', 'Claude Opus 5.5 Medium', 'Claude Sonnet 5.5 Medium', 'GPT-OSS 120B Medium'], thinkingLevel: 'High', lastVerifiedAt: '2026-11-21', allowCustomModel: true },
    { id: 6, name: 'Codex', aliases: ['Codex CLI', 'OpenAI Codex'], surface: 'CLI / Desktop', bridge: 'codex-cli', provider: 'OpenAI', plan: 'Plus / Codex CLI', status: 'verified', defaultModel: 'GPT-6.2-Sol', models: ['GPT-6.2-Sol', 'GPT-6.2-Astra', 'GPT-6.1 Terra', 'GPT-6.1-Sol', 'GPT-6-Astra', 'GPT-6-Sol', 'GPT-6-Luna', 'GPT-5.6-Sol', 'GPT-5.6-Terra', 'GPT-5.6-Luna'], thinkingLevel: 'High', lastVerifiedAt: '2026-11-21', allowCustomModel: true },
  ],
};

// 办公室内部的状态快照（不是持续同步，见顶栏标注）。
const SNAPSHOT = {
  1: { status: '工作中', task: '正在比较地区价格', progress: 62 },
  2: { status: '待核对', task: '未登录，仅支持自定义模型', progress: 0 },
  3: { status: '思考中', task: 'BatchNorm 与 MLP 问答', progress: 40 },
  4: { status: '待核对', task: '未登录，仅支持自定义模型', progress: 0 },
  5: { status: '工作中', task: 'PyTorch 进阶学习规划', progress: 78 },
  6: { status: '工作中', task: 'Codex CLI 待命（需启动 server.py 实连）', progress: 85 },
};

const STATUS_COLORS = { '工作中': 0x2e7d4f, '思考中': 0xc28516, '待核对': 0x8a8277 };
const STATUS_HEX = { '工作中': '#2e7d4f', '思考中': '#c28516', '待核对': '#8a8277' };
const ACCENTS = { 'GPT 网页版': 0x2e7d4f, GPT: 0x2e7d4f, Codex: 0x1f6e7a, Claude: 0xb86238, Gemini: 0x2f63c6, Grok: 0x2b2620, Antigravity: 0xd65a28 };
const ACCENT_HEX = { 'GPT 网页版': '#2e7d4f', GPT: '#2e7d4f', Codex: '#1f6e7a', Claude: '#b86238', Gemini: '#2f63c6', Grok: '#2b2620', Antigravity: '#d65a28' };

// 工位布局：Zone A Ultra 双岛，Zone B OpenAI 双工位（GPT 网页版 + Codex），Zone C 访客长凳。
const LAYOUT = {
  5: { x: -4.9, z: -2.8, zone: 'A' },
  3: { x: -1.5, z: -2.8, zone: 'A' },
  1: { x: 2.35, z: -2.75, zone: 'B', rotY: -0.15 },
  6: { x: 5.15, z: -2.05, zone: 'B', rotY: -0.35 },
  2: { x: -1.9, z: 3.2, zone: 'C' },
  4: { x: 1.9, z: 3.2, zone: 'C' },
};

const state = {
  config: FALLBACK_CONFIG,
  selectedModels: {},
  currentAgent: null,
  currentTopic: '',
  cameraGoal: null,
  followBoss: false,
  inspectingBoss: false,
  codexBridge: {
    connected: false,
    cliVersion: null,
    modelSlugs: {},
    latestSession: null,
    busy: false,
  },
};

const container = document.getElementById('scene-container');
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = EXPOSURE;
container.appendChild(renderer.domElement);

const labelRenderer = new CSS2DRenderer();
labelRenderer.setSize(window.innerWidth, window.innerHeight);
labelRenderer.domElement.style.position = 'absolute';
labelRenderer.domElement.style.top = '0';
labelRenderer.domElement.style.left = '0';
labelRenderer.domElement.style.zIndex = '1';
labelRenderer.domElement.style.pointerEvents = 'none';
container.appendChild(labelRenderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0xede8de);

const camera = new THREE.PerspectiveCamera(CAMERA_FOV, window.innerWidth / window.innerHeight, 0.1, 100);
camera.position.set(10.6, 8.2, 13.8);

function updateCameraProjection() {
  const aspect = window.innerWidth / window.innerHeight;
  camera.aspect = aspect;
  // 桌面端严格保持 FOV 33°；窄屏竖屏时平滑拓宽垂直视场以完整保留制图室主体。
  if (aspect >= 1.15) {
    camera.fov = CAMERA_FOV;
  } else {
    const halfH = Math.tan(THREE.MathUtils.degToRad(CAMERA_FOV) / 2) * 1.45;
    camera.fov = Math.min(68, THREE.MathUtils.radToDeg(2 * Math.atan(halfH / aspect)));
  }
  camera.updateProjectionMatrix();
}
updateCameraProjection();

const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(-0.4, 0.7, 0);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.maxPolarAngle = Math.PI / 2.12;
controls.minDistance = 3.5;
controls.maxDistance = 28;
controls.addEventListener('start', () => {
  state.cameraGoal = null;
});

// Three.js r160：RoomEnvironment 需传入 renderer 以使用物理光照强度，并在生成纹理后释放临时资源。
const pmrem = new THREE.PMREMGenerator(renderer);
const roomEnv = new RoomEnvironment(renderer);
scene.environment = pmrem.fromScene(roomEnv, 0.04).texture;
roomEnv.dispose();
pmrem.dispose();

const hemi = new THREE.HemisphereLight(0xfff8ee, 0x7a6c5a, 0.58);
scene.add(hemi);

const sun = new THREE.DirectionalLight(0xfff2de, 1.85);
sun.position.set(8.5, 10.5, 6.2);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.near = 1;
sun.shadow.camera.far = 34;
sun.shadow.camera.left = -9.5;
sun.shadow.camera.right = 9.5;
sun.shadow.camera.top = 9.5;
sun.shadow.camera.bottom = -9.5;
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 0.02;
scene.add(sun);

const windowFill = new THREE.DirectionalLight(0xdcebff, 0.35);
windowFill.position.set(-4, 4, -6);
scene.add(windowFill);

const pickables = []; // Mesh[] with userData.agentId or userData.boss
const deskPlates = {}; // agentId -> { mesh, texture }
const headLabels = {}; // agentId -> CSS2DObject
const zoneALabels = {}; // agent.name -> CSS2DObject
const zoneBLabels = {}; // agent.name -> CSS2DObject
const avatarRigs = []; // { group, baseY, phase, active }

let contactShadowTex = null;
let backWallGroup = null;
let leftWallGroup = null;
let windowGroup = null;
let boss = null;
const lastBossPos = new THREE.Vector3();

function std(color, roughness = 0.85, extra = {}) {
  return new THREE.MeshStandardMaterial({
    color,
    roughness,
    envMapIntensity: ENV_INTENSITY,
    ...extra,
  });
}

function seededRng(seed = 1) {
  let s = (seed >>> 0) || 1;
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
}

function makeCanvasTex(w, h, draw, { srgb = true, repeat = null, aniso = 8 } = {}) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) {
    t.wrapS = THREE.RepeatWrapping;
    t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(repeat[0], repeat[1]);
  }
  t.anisotropy = Math.min(aniso, renderer.capabilities.getMaxAnisotropy());
  return t;
}

function makeOakFloorTexture() {
  const rand = seededRng(2026);
  return makeCanvasTex(512, 512, (ctx, w, h) => {
    ctx.fillStyle = '#c5a57a';
    ctx.fillRect(0, 0, w, h);
    const rows = 8;
    const plankH = h / rows;
    for (let r = 0; r < rows; r++) {
      const y = r * plankH;
      const offset = (r % 2) * (w * 0.35);
      for (let col = -1; col < 3; col++) {
        const x = col * (w * 0.5) + offset;
        const tone = Math.floor((rand() - 0.5) * 14);
        ctx.fillStyle = `rgb(${196 + tone}, ${163 + tone}, ${120 + tone})`;
        ctx.fillRect(x, y, w * 0.5 - 2, plankH - 2);
        // 细木纹
        ctx.strokeStyle = 'rgba(110, 82, 50, 0.08)';
        ctx.lineWidth = 1;
        for (let g = 0; g < 6; g++) {
          const gy = y + 4 + rand() * (plankH - 8);
          ctx.beginPath();
          ctx.moveTo(x + 2, gy);
          ctx.lineTo(x + w * 0.5 - 4, gy + (rand() - 0.5) * 3);
          ctx.stroke();
        }
        // 拼缝
        ctx.fillStyle = 'rgba(72, 52, 32, 0.22)';
        ctx.fillRect(x + w * 0.5 - 2, y, 2, plankH);
      }
      ctx.fillStyle = 'rgba(72, 52, 32, 0.2)';
      ctx.fillRect(0, y + plankH - 2, w, 2);
    }
  }, { repeat: [5, 4] });
}

function makePlasterWallTexture() {
  const rand = seededRng(77);
  return makeCanvasTex(256, 256, (ctx, w, h) => {
    ctx.fillStyle = '#f2ede3';
    ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 1600; i++) {
      const x = rand() * w;
      const y = rand() * h;
      const alpha = 0.015 + rand() * 0.025;
      ctx.fillStyle = rand() > 0.5 ? `rgba(120, 108, 92, ${alpha})` : `rgba(255, 252, 246, ${alpha})`;
      ctx.fillRect(x, y, 2, 2);
    }
  }, { repeat: [3, 2] });
}

function makeWovenRugTexture() {
  const rand = seededRng(91);
  return makeCanvasTex(512, 512, (ctx, w, h) => {
    ctx.fillStyle = '#dfd4be';
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = 'rgba(130, 114, 92, 0.14)';
    ctx.lineWidth = 1;
    for (let i = 0; i < w; i += 4) {
      ctx.beginPath();
      ctx.moveTo(i, 0);
      ctx.lineTo(i, h);
      ctx.stroke();
    }
    for (let j = 0; j < h; j += 4) {
      ctx.beginPath();
      ctx.moveTo(0, j);
      ctx.lineTo(w, j);
      ctx.stroke();
    }
    for (let i = 0; i < 1200; i++) {
      ctx.fillStyle = `rgba(92, 78, 60, ${0.02 + rand() * 0.03})`;
      ctx.fillRect(rand() * w, rand() * h, 3, 2);
    }
  }, { repeat: [2, 2] });
}

function makeMonitorScreenTexture(agent, status) {
  const accent = ACCENT_HEX[agent.name] ?? '#b0703c';
  const active = status !== '待核对';
  return makeCanvasTex(256, 160, (ctx, w, h) => {
    ctx.fillStyle = '#141518';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#1e2025';
    ctx.fillRect(10, 10, w - 20, h - 20);
    if (!active) {
      ctx.fillStyle = '#5a5751';
      ctx.beginPath();
      ctx.arc(w / 2, h / 2, 6, 0, Math.PI * 2);
      ctx.fill();
      return;
    }
    ctx.fillStyle = accent;
    ctx.fillRect(18, 20, 68, 6);
    ctx.fillStyle = 'rgba(236, 231, 221, 0.65)';
    ctx.fillRect(18, 36, 140, 4);
    ctx.fillStyle = 'rgba(236, 231, 221, 0.32)';
    ctx.fillRect(18, 48, 196, 4);
    ctx.fillRect(18, 60, 172, 4);
    ctx.fillRect(18, 72, 188, 4);
    ctx.fillStyle = 'rgba(236, 231, 221, 0.16)';
    ctx.fillRect(18, 92, 220, 44);
    ctx.fillStyle = accent;
    ctx.fillRect(26, 104, 112, 5);
    ctx.fillStyle = 'rgba(236, 231, 221, 0.45)';
    ctx.fillRect(26, 118, 86, 4);
  });
}

function getContactShadowTexture() {
  if (contactShadowTex) return contactShadowTex;
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  const grad = ctx.createRadialGradient(size / 2, size / 2, size * 0.08, size / 2, size / 2, size * 0.5);
  grad.addColorStop(0, 'rgba(36, 30, 24, 0.46)');
  grad.addColorStop(0.55, 'rgba(36, 30, 24, 0.16)');
  grad.addColorStop(1, 'rgba(36, 30, 24, 0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  contactShadowTex = new THREE.CanvasTexture(canvas);
  contactShadowTex.colorSpace = THREE.SRGBColorSpace;
  return contactShadowTex;
}

function makeContactShadow(w, d, opacity = 0.24) {
  const mat = new THREE.MeshBasicMaterial({
    map: getContactShadowTexture(),
    transparent: true,
    opacity,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -1,
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, d), mat);
  mesh.rotation.x = -Math.PI / 2;
  return mesh;
}

function buildRoom() {
  const roomGroup = new THREE.Group();
  const cutawayMat = std(0x3a342d, 0.72);
  const trimWoodMat = std(0x6e553c, 0.68);
  const metalMat = std(0x282521, 0.42, { metalness: 0.45 });

  // 建筑沙盘厚底座 + 地面柔和投影
  const plinth = new THREE.Mesh(new THREE.BoxGeometry(ROOM.w + 0.44, 0.3, ROOM.d + 0.44), cutawayMat);
  plinth.position.set(0, -0.151, 0);
  plinth.receiveShadow = true;
  roomGroup.add(plinth);

  const dioramaShadow = makeContactShadow(ROOM.w + 3.8, ROOM.d + 3.4, 0.22);
  dioramaShadow.position.set(0.35, -0.305, 0.35);
  roomGroup.add(dioramaShadow);

  // 欧洲橡木拼接地板
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(ROOM.w, ROOM.d),
    std(0xffffff, 0.76, { map: makeOakFloorTexture() }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  roomGroup.add(floor);

  // 剖面式墙壁分组（以 y=0 为缩放枢轴，相机转至墙后时自动降为地坪矮边，杜绝卡墙挡视角）
  const wallTex = makePlasterWallTexture();
  const wallMat = std(0xffffff, 0.92, { map: wallTex });
  const wallT = 0.2;

  backWallGroup = new THREE.Group();
  const backWall = new THREE.Mesh(new THREE.BoxGeometry(ROOM.w + wallT, ROOM.h, wallT), wallMat);
  backWall.position.set(-wallT / 2, ROOM.h / 2, -ROOM.d / 2 - wallT / 2);
  backWall.receiveShadow = true;
  backWall.castShadow = true;
  backWallGroup.add(backWall);

  const backCap = new THREE.Mesh(new THREE.BoxGeometry(ROOM.w + wallT + 0.01, 0.045, wallT + 0.01), cutawayMat);
  backCap.position.set(-wallT / 2, ROOM.h + 0.022, -ROOM.d / 2 - wallT / 2);
  backWallGroup.add(backCap);

  const rightCutCap = new THREE.Mesh(new THREE.BoxGeometry(0.03, ROOM.h + 0.045, wallT + 0.01), cutawayMat);
  rightCutCap.position.set(ROOM.w / 2 + 0.01, ROOM.h / 2 + 0.01, -ROOM.d / 2 - wallT / 2);
  backWallGroup.add(rightCutCap);

  const backSkirt = new THREE.Mesh(new THREE.BoxGeometry(ROOM.w, 0.1, 0.03), trimWoodMat);
  backSkirt.position.set(0, 0.05, -ROOM.d / 2 + 0.015);
  backWallGroup.add(backSkirt);

  // 后墙精密落地分格窗（位于 Zone A 后方）
  windowGroup = new THREE.Group();
  const winW = 4.6;
  const winH = 1.75;
  const winX = -3.2;
  const winY = 2.15;
  const winZ = -ROOM.d / 2 + 0.02;

  const winGlass = new THREE.Mesh(
    new THREE.PlaneGeometry(winW, winH),
    std(0xf6f2e9, 0.35, { emissive: 0xefead8, emissiveIntensity: 0.45 }),
  );
  winGlass.position.set(winX, winY, winZ);
  windowGroup.add(winGlass);

  for (const sy of [-winH / 2, 0.15, winH / 2]) {
    const bar = new THREE.Mesh(new THREE.BoxGeometry(winW + 0.08, 0.045, 0.06), metalMat);
    bar.position.set(winX, winY + sy, winZ + 0.02);
    windowGroup.add(bar);
  }
  for (const sx of [-winW / 2, -winW / 6, winW / 6, winW / 2]) {
    const bar = new THREE.Mesh(new THREE.BoxGeometry(0.045, winH + 0.06, 0.06), metalMat);
    bar.position.set(winX + sx, winY, winZ + 0.02);
    windowGroup.add(bar);
  }
  const winSill = new THREE.Mesh(new THREE.BoxGeometry(winW + 0.18, 0.04, 0.14), trimWoodMat);
  winSill.position.set(winX, winY - winH / 2 - 0.02, winZ + 0.05);
  windowGroup.add(winSill);
  backWallGroup.add(windowGroup);
  roomGroup.add(backWallGroup);

  leftWallGroup = new THREE.Group();
  const leftWall = new THREE.Mesh(new THREE.BoxGeometry(wallT, ROOM.h, ROOM.d), wallMat);
  leftWall.position.set(-ROOM.w / 2 - wallT / 2, ROOM.h / 2, 0);
  leftWall.receiveShadow = true;
  leftWall.castShadow = true;
  leftWallGroup.add(leftWall);

  const leftCap = new THREE.Mesh(new THREE.BoxGeometry(wallT + 0.01, 0.045, ROOM.d + 0.01), cutawayMat);
  leftCap.position.set(-ROOM.w / 2 - wallT / 2, ROOM.h + 0.022, 0);
  leftWallGroup.add(leftCap);

  const frontCutCap = new THREE.Mesh(new THREE.BoxGeometry(wallT + 0.01, 0.03 + ROOM.h + 0.015, 0.03), cutawayMat);
  frontCutCap.position.set(-ROOM.w / 2 - wallT / 2, ROOM.h / 2 + 0.01, ROOM.d / 2 + 0.01);
  leftWallGroup.add(frontCutCap);

  const leftSkirt = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.1, ROOM.d), trimWoodMat);
  leftSkirt.position.set(-ROOM.w / 2 + 0.015, 0.05, 0);
  leftWallGroup.add(leftSkirt);
  roomGroup.add(leftWallGroup);

  // Zone A 双岛亚麻圆毯与黄铜镶边
  const rug = new THREE.Mesh(
    new THREE.CircleGeometry(3.25, 64),
    std(0xffffff, 0.96, { map: makeWovenRugTexture() }),
  );
  rug.rotation.x = -Math.PI / 2;
  rug.position.set(-3.2, 0.008, -2.8);
  rug.receiveShadow = true;
  roomGroup.add(rug);

  const rugTrim = new THREE.Mesh(
    new THREE.RingGeometry(3.22, 3.28, 64),
    std(0xb8864b, 0.45, { metalness: 0.45 }),
  );
  rugTrim.rotation.x = -Math.PI / 2;
  rugTrim.position.set(-3.2, 0.009, -2.8);
  roomGroup.add(rugTrim);

  // Zone B OpenAI 双工位区（GPT 网页版 + Codex）地垫与青灰镶边
  const zoneBTrim = new THREE.Mesh(
    new THREE.PlaneGeometry(5.1, 2.7),
    std(0x1f6e7a, 0.65),
  );
  zoneBTrim.rotation.x = -Math.PI / 2;
  zoneBTrim.position.set(3.75, 0.0075, -2.4);
  roomGroup.add(zoneBTrim);

  const zoneBMat = new THREE.Mesh(
    new THREE.PlaneGeometry(5.0, 2.6),
    std(0xe3ded3, 0.94),
  );
  zoneBMat.rotation.x = -Math.PI / 2;
  zoneBMat.position.set(3.75, 0.009, -2.4);
  zoneBMat.receiveShadow = true;
  roomGroup.add(zoneBMat);

  // Zone C — 访客长凳（横跨 Claude & Grok 身后）
  const benchGroup = new THREE.Group();
  benchGroup.position.set(0, 0, 2.42);
  const benchSeat = new THREE.Mesh(new THREE.BoxGeometry(4.8, 0.055, 0.52), std(0x9b7952, 0.65));
  benchSeat.position.y = 0.41;
  benchSeat.castShadow = true;
  benchSeat.receiveShadow = true;
  benchGroup.add(benchSeat);
  const benchRail = new THREE.Mesh(new THREE.BoxGeometry(4.5, 0.03, 0.04), metalMat);
  benchRail.position.y = 0.24;
  benchGroup.add(benchRail);
  for (const bx of [-2.15, 0, 2.15]) {
    for (const bz of [-0.18, 0.18]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.39, 0.045), metalMat);
      leg.position.set(bx, 0.195, bz);
      leg.castShadow = true;
      benchGroup.add(leg);
    }
  }
  const benchShadow = makeContactShadow(5.1, 0.92, 0.22);
  benchShadow.position.set(0, 0.012, 0);
  benchGroup.add(benchShadow);
  roomGroup.add(benchGroup);

  // 左墙 Braun 模块化开放书架
  const shelfGroup = new THREE.Group();
  shelfGroup.position.set(-ROOM.w / 2 + 0.34, 0, 1.8);
  for (const sz of [-0.88, 0.88]) {
    const upright = new THREE.Mesh(new THREE.BoxGeometry(0.42, 2.15, 0.035), metalMat);
    upright.position.set(0, 1.075, sz);
    upright.castShadow = true;
    shelfGroup.add(upright);
  }
  for (const sy of [0.18, 0.78, 1.38, 1.98]) {
    const board = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.035, 1.78), trimWoodMat);
    board.position.set(0, sy, 0);
    board.castShadow = true;
    board.receiveShadow = true;
    shelfGroup.add(board);
  }
  const bookColors = [0xd65a28, 0x2f63c6, 0x2e7d4f, 0x3b352d, 0xc9b99c];
  for (let i = 0; i < 6; i++) {
    const h = 0.22 + (i % 3) * 0.04;
    const book = new THREE.Mesh(new THREE.BoxGeometry(0.26, h, 0.065), std(bookColors[i % bookColors.length], 0.7));
    book.position.set(0.02, 0.8 + h / 2, -0.58 + i * 0.09);
    book.castShadow = true;
    shelfGroup.add(book);
  }
  const roll = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.42, 16), std(0xfaf7f0, 0.85));
  roll.rotation.z = Math.PI / 2;
  roll.position.set(0.02, 1.44, 0.35);
  shelfGroup.add(roll);

  const shelfShadow = makeContactShadow(0.8, 2.2, 0.24);
  shelfShadow.position.set(0.05, 0.012, 0);
  shelfGroup.add(shelfShadow);
  roomGroup.add(shelfGroup);

  // 右侧 Bauhaus 休息沙发 + 胡桃木茶几
  const sofaGroup = new THREE.Group();
  sofaGroup.position.set(5.4, 0, 2.5);
  const sofaMat = std(0x6e6256, 0.92);
  const cushionMat = std(0x7d7063, 0.9);
  for (const sx of [-0.88, 0.88]) {
    for (const sz of [-0.34, 0.34]) {
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.018, 0.14, 10), metalMat);
      leg.position.set(sx, 0.07, sz);
      sofaGroup.add(leg);
    }
  }
  const sofaBase = new THREE.Mesh(new THREE.BoxGeometry(2.05, 0.22, 0.88), sofaMat);
  sofaBase.position.set(0, 0.25, 0);
  sofaBase.castShadow = true;
  sofaGroup.add(sofaBase);
  for (const sx of [-0.47, 0.47]) {
    const seatPad = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.12, 0.78), cushionMat);
    seatPad.position.set(sx, 0.42, -0.02);
    seatPad.castShadow = true;
    sofaGroup.add(seatPad);
  }
  const sofaBack = new THREE.Mesh(new THREE.BoxGeometry(2.05, 0.56, 0.2), sofaMat);
  sofaBack.position.set(0, 0.62, 0.34);
  sofaBack.castShadow = true;
  sofaGroup.add(sofaBack);
  for (const sx of [-0.95, 0.95]) {
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.32, 0.88), sofaMat);
    arm.position.set(sx, 0.48, 0);
    arm.castShadow = true;
    sofaGroup.add(arm);
  }
  const sofaShadow = makeContactShadow(2.45, 1.3, 0.26);
  sofaShadow.position.set(0, 0.012, 0);
  sofaGroup.add(sofaShadow);
  roomGroup.add(sofaGroup);

  const tableGroup = new THREE.Group();
  tableGroup.position.set(5.4, 0, 1.35);
  const tableTop = new THREE.Mesh(new THREE.BoxGeometry(1.15, 0.04, 0.62), trimWoodMat);
  tableTop.position.y = 0.34;
  tableTop.castShadow = true;
  tableTop.receiveShadow = true;
  tableGroup.add(tableTop);
  for (const tx of [-0.48, 0.48]) {
    for (const tz of [-0.22, 0.22]) {
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.016, 0.32, 10), metalMat);
      leg.position.set(tx, 0.16, tz);
      tableGroup.add(leg);
    }
  }
  const tableShadow = makeContactShadow(1.35, 0.85, 0.2);
  tableShadow.position.set(0, 0.012, 0);
  tableGroup.add(tableShadow);
  roomGroup.add(tableGroup);

  // Lathe 陶土花盆 + 雕塑感球状绿植
  const potProfile = [
    [0.01, 0.0],
    [0.17, 0.0],
    [0.23, 0.18],
    [0.22, 0.36],
    [0.19, 0.36],
    [0.19, 0.32],
  ].map(([r, y]) => new THREE.Vector2(r, y));
  const potGeo = new THREE.LatheGeometry(potProfile, 24);
  const potMat = std(0xb46f46, 0.82);
  const soilMat = std(0x3a2f26, 0.95);
  const leafMat = std(0x467346, 0.85);
  const leafLightMat = std(0x568754, 0.85);

  for (const [x, z] of [[-6.45, -4.45], [6.55, -4.45]]) {
    const plant = new THREE.Group();
    plant.position.set(x, 0, z);
    const pot = new THREE.Mesh(potGeo, potMat);
    pot.castShadow = true;
    plant.add(pot);
    const soil = new THREE.Mesh(new THREE.CylinderGeometry(0.19, 0.19, 0.04, 16), soilMat);
    soil.position.y = 0.31;
    plant.add(soil);
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.032, 0.45, 8), std(0x6e523a, 0.9));
    stem.position.y = 0.52;
    plant.add(stem);
    for (const [ox, oy, oz, r, m] of [
      [0, 0.86, 0, 0.27, leafMat],
      [-0.14, 0.72, 0.1, 0.2, leafLightMat],
      [0.14, 0.75, -0.08, 0.21, leafMat],
      [0.05, 1.05, 0.04, 0.18, leafLightMat],
    ]) {
      const canopy = new THREE.Mesh(new THREE.SphereGeometry(r, 16, 14), m);
      canopy.position.set(ox, oy, oz);
      canopy.castShadow = true;
      plant.add(canopy);
    }
    const plantShadow = makeContactShadow(0.75, 0.75, 0.22);
    plantShadow.position.set(0, 0.012, 0);
    plant.add(plantShadow);
    roomGroup.add(plant);
  }

  scene.add(roomGroup);
}

function updateCutawayWalls() {
  if (!backWallGroup || !leftWallGroup) return;
  const hideBack = camera.position.z < -ROOM.d / 2 + 2.0;
  const hideLeft = camera.position.x < -ROOM.w / 2 + 2.0;
  const targetBack = hideBack ? 0.045 : 1.0;
  const targetLeft = hideLeft ? 0.045 : 1.0;
  const factor = REDUCED_MOTION ? 1.0 : 0.14;

  backWallGroup.scale.y = THREE.MathUtils.lerp(backWallGroup.scale.y, targetBack, factor);
  leftWallGroup.scale.y = THREE.MathUtils.lerp(leftWallGroup.scale.y, targetLeft, factor);
  if (windowGroup) {
    windowGroup.visible = backWallGroup.scale.y > 0.35;
  }
}

function buildAvatar(agent) {
  const g = new THREE.Group();
  const accent = new THREE.Color(ACCENTS[agent.name] ?? 0x8a8277);
  const ceramicMat = std(0xf0eae0, 0.48);

  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.27, 0.48, 8, 20), ceramicMat);
  body.position.y = 0.62;
  body.castShadow = true;
  g.add(body);

  const head = new THREE.Mesh(new THREE.SphereGeometry(0.255, 24, 18), ceramicMat);
  head.position.y = 1.225;
  head.castShadow = true;
  g.add(head);

  // 头盔面罩朝向 +Z（面朝显示器与桌面）
  const visor = new THREE.Mesh(
    new THREE.SphereGeometry(0.264, 24, 18, Math.PI / 2 - 0.72, 1.44, 1.08, 0.92),
    std(0x1f1d1a, 0.18, { metalness: 0.45 }),
  );
  visor.position.y = 1.225;
  g.add(visor);

  // Braun 耳机侧片细节
  const earMat = std(0x3a342d, 0.4, { metalness: 0.35 });
  for (const sx of [-0.255, 0.255]) {
    const ear = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.025, 16), earMat);
    ear.rotation.z = Math.PI / 2;
    ear.position.set(sx, 1.22, 0);
    g.add(ear);
  }

  // 金属质感识别环
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(0.295, 0.026, 12, 32),
    std(accent, 0.38, { metalness: 0.35 }),
  );
  ring.rotation.x = Math.PI / 2;
  ring.position.y = 0.93;
  g.add(ring);

  return g;
}

function buildDesk(agent) {
  const { x, z, rotY = 0, zone } = LAYOUT[agent.id];
  const g = new THREE.Group();
  g.position.set(x, 0, z);
  g.rotation.y = rotY;

  const oakMat = std(0xa88258, 0.68);
  const frameMat = std(0x2e2a25, 0.48, { metalness: 0.35 });
  const alumMat = std(0xcac4b8, 0.35, { metalness: 0.65 });

  // 桌面 + U 形钢架桌腿 + 后挡杆
  const top = new THREE.Mesh(new THREE.BoxGeometry(1.68, 0.055, 0.82), oakMat);
  top.position.y = 0.74;
  top.castShadow = true;
  top.receiveShadow = true;
  g.add(top);

  for (const sx of [-0.74, 0.74]) {
    for (const sz of [-0.32, 0.32]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.715, 0.045), frameMat);
      leg.position.set(sx, 0.358, sz);
      leg.castShadow = true;
      g.add(leg);
    }
    const foot = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.025, 0.68), frameMat);
    foot.position.set(sx, 0.013, 0);
    g.add(foot);
  }
  const crossbar = new THREE.Mesh(new THREE.BoxGeometry(1.48, 0.035, 0.035), frameMat);
  crossbar.position.set(0, 0.24, -0.32);
  g.add(crossbar);

  const deskShadow = makeContactShadow(2.05, 1.25, 0.24);
  deskShadow.position.set(0, 0.012, 0);
  g.add(deskShadow);

  // 桌垫、键盘、鼠标
  const deskMat = new THREE.Mesh(new THREE.BoxGeometry(0.78, 0.008, 0.36), std(0x2a2723, 0.9));
  deskMat.position.set(0, 0.772, 0.06);
  g.add(deskMat);

  const keyboard = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.018, 0.16), alumMat);
  keyboard.position.set(-0.06, 0.785, 0.05);
  g.add(keyboard);

  const mouse = new THREE.Mesh(new THREE.BoxGeometry(0.065, 0.022, 0.1), std(0x3a352f, 0.4));
  mouse.position.set(0.28, 0.786, 0.06);
  g.add(mouse);

  // 精密显示器与屏幕内容
  const snap = SNAPSHOT[agent.id];
  const monitor = new THREE.Mesh(new THREE.BoxGeometry(0.74, 0.44, 0.028), frameMat);
  monitor.position.set(0, 1.06, -0.22);
  monitor.castShadow = true;
  g.add(monitor);

  const screenPlane = new THREE.Mesh(
    new THREE.PlaneGeometry(0.7, 0.4),
    std(0xffffff, 0.35, {
      map: makeMonitorScreenTexture(agent, snap.status),
      emissive: 0xffffff,
      emissiveMap: makeMonitorScreenTexture(agent, snap.status),
      emissiveIntensity: snap.status === '待核对' ? 0.15 : 0.45,
    }),
  );
  screenPlane.position.set(0, 1.06, -0.205);
  g.add(screenPlane);

  const stand = new THREE.Mesh(new THREE.BoxGeometry(0.065, 0.24, 0.045), alumMat);
  stand.position.set(0, 0.88, -0.23);
  g.add(stand);

  // 已验证工位配一台 Dieter Rams 风格极简台灯
  if (agent.status === 'verified') {
    const lampBase = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.08, 0.02, 16), frameMat);
    lampBase.position.set(-0.65, 0.778, -0.22);
    g.add(lampBase);
    const lampArm = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.34, 8), frameMat);
    lampArm.position.set(-0.65, 0.94, -0.22);
    lampArm.rotation.z = -0.18;
    g.add(lampArm);
    const lampHead = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.055, 0.12, 14), frameMat);
    lampHead.position.set(-0.59, 1.09, -0.19);
    lampHead.rotation.x = Math.PI / 3;
    lampHead.rotation.z = -0.3;
    g.add(lampHead);
  }

  // 桌牌：严格保持单层 1024x384（比例 8:3 -> 0.96m x 0.36m），斜嵌在胡桃木底座上
  const defaultModel = state.selectedModels[agent.id] ?? agent.defaultModel;
  const tex = makeDeskPlateTexture(agent, defaultModel, ACCENT_HEX[agent.name]);
  tex.anisotropy = Math.min(16, renderer.capabilities.getMaxAnisotropy());
  const plateGroup = new THREE.Group();
  plateGroup.position.set(0, 0.74, 0.435);
  plateGroup.rotation.x = -0.2;

  const plateBacking = new THREE.Mesh(new THREE.BoxGeometry(0.98, 0.38, 0.018), std(0x524132, 0.65));
  plateBacking.position.z = -0.009;
  plateBacking.castShadow = true;
  plateGroup.add(plateBacking);

  const plate = new THREE.Mesh(
    new THREE.PlaneGeometry(0.96, 0.36),
    std(0xffffff, 0.82, { map: tex }),
  );
  plate.position.z = 0.001;
  plateGroup.add(plate);
  g.add(plateGroup);
  deskPlates[agent.id] = { mesh: plate, texture: tex };

  // 精密状态 LED 指示钮
  const statusColor = STATUS_COLORS[snap.status];
  const ledBezel = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.05, 0.02, 16), alumMat);
  ledBezel.position.set(0.68, 0.778, 0.28);
  g.add(ledBezel);
  const dot = new THREE.Mesh(
    new THREE.SphereGeometry(0.028, 12, 10),
    std(statusColor, 0.3, { emissive: statusColor, emissiveIntensity: 0.45 }),
  );
  dot.position.set(0.68, 0.79, 0.28);
  g.add(dot);

  // 形象 + 座椅（Zone C 使用共享访客长凳，Zone A/B 使用独立工作室座椅）
  const avatar = buildAvatar(agent);
  avatar.position.set(0, 0, -0.78);
  g.add(avatar);
  avatarRigs.push({
    group: avatar,
    baseY: 0,
    phase: agent.id * 1.15,
    active: snap.status !== '待核对',
  });

  if (zone !== 'C') {
    const chairSeat = new THREE.Mesh(new THREE.BoxGeometry(0.48, 0.06, 0.46), std(0x4b433b, 0.85));
    chairSeat.position.set(0, 0.42, -0.78);
    chairSeat.castShadow = true;
    g.add(chairSeat);
    const chairStem = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.38, 10), frameMat);
    chairStem.position.set(0, 0.21, -0.78);
    g.add(chairStem);
    const chairBase = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.24, 0.025, 16), frameMat);
    chairBase.position.set(0, 0.015, -0.78);
    g.add(chairBase);
    const chairShadow = makeContactShadow(0.78, 0.78, 0.22);
    chairShadow.position.set(0, 0.012, -0.78);
    g.add(chairShadow);
  }

  // 头顶标签与引线挂在工位组内（本地坐标），确保带旋转角工位（如 GPT 网页版 / Codex）也能对齐头顶。
  const stagger = ZONE_A_STAGGER[agent.name] || ZONE_B_STAGGER[agent.name];
  const label = makeHeadLabel(agent, defaultModel, STATUS_HEX[snap.status]);
  const avatarTopY = 1.48;
  const localAnchor = new THREE.Vector3(
    stagger ? stagger.dx : 0,
    avatarTopY + (stagger ? stagger.dy : 0.5),
    -0.78,
  );
  label.position.copy(localAnchor);
  g.add(label);
  headLabels[agent.id] = label;
  if (stagger) {
    if (ZONE_A_STAGGER[agent.name]) zoneALabels[agent.name] = label;
    if (ZONE_B_STAGGER[agent.name]) zoneBLabels[agent.name] = label;
    const localTop = new THREE.Vector3(0, avatarTopY, -0.78);
    g.add(makeLeaderLine(localTop, localAnchor));
  }

  // 点击拾取用：桌面 + 显示器 + 桌牌。
  for (const m of [top, monitor, screenPlane, plate]) {
    m.userData.agentId = agent.id;
    pickables.push(m);
  }
  scene.add(g);
  return g;
}

function daysSince(dateStr) {
  if (!dateStr) return null;
  let ts = new Date(`${dateStr}T00:00:00`).getTime();
  if (Number.isNaN(ts)) ts = new Date(dateStr).getTime();
  if (Number.isNaN(ts)) return null;
  return Math.max(0, Math.floor((Date.now() - ts) / 86400000));
}

function updateAgentModelVisuals(agentId, model) {
  const agent = state.config.agents.find((a) => a.id === agentId);
  if (!agent) return;
  const displayModel = model ?? agent.defaultModel;
  const plate = deskPlates[agentId];
  if (plate) {
    plate.texture.dispose();
    const tex = makeDeskPlateTexture(agent, displayModel, ACCENT_HEX[agent.name]);
    tex.anisotropy = Math.min(16, renderer.capabilities.getMaxAnisotropy());
    plate.mesh.material.map = tex;
    plate.mesh.material.needsUpdate = true;
    plate.texture = tex;
  }
  const label = headLabels[agentId];
  if (label) {
    const modelEl = label.element.querySelector('.model');
    if (modelEl) modelEl.textContent = displayModel || '待核对';
  }
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

  // 1. 工位列表（无嵌套卡片，扁平高精度分隔行）
  const agentsPanel = document.getElementById('panel-agents');
  agentsPanel.replaceChildren();
  for (const agent of agents) {
    const snap = SNAPSHOT[agent.id];
    const zone = LAYOUT[agent.id]?.zone ?? '—';
    const currentModel = state.selectedModels[agent.id] ?? agent.defaultModel ?? '待核对';

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'agent-row';
    if (state.currentAgent === agent.id) btn.classList.add('active');

    const topLine = document.createElement('div');
    topLine.className = 'agent-row-top';

    const left = document.createElement('span');
    left.className = 'agent-row-id';
    const dot = document.createElement('span');
    dot.className = 'dot';
    dot.style.background = STATUS_HEX[snap.status];
    const nameEl = document.createElement('span');
    nameEl.className = 'agent-name';
    nameEl.textContent = agent.name;
    const zoneBadge = document.createElement('span');
    zoneBadge.className = 'zone-tag';
    zoneBadge.textContent = zone;
    left.append(dot, nameEl, zoneBadge);

    if (agent.bridge === 'codex-cli' && state.codexBridge.connected) {
      const cliBadge = document.createElement('span');
      cliBadge.className = 'zone-tag cli-tag';
      cliBadge.textContent = 'CLI';
      left.appendChild(cliBadge);
    }

    const modelTag = document.createElement('span');
    modelTag.className = 'agent-model-tag';
    modelTag.textContent = currentModel;

    topLine.append(left, modelTag);

    const taskLine = document.createElement('div');
    taskLine.className = 'agent-row-task';
    taskLine.textContent = `${snap.status} · ${snap.task}`;

    btn.append(topLine, taskLine);

    if (snap.progress > 0) {
      const track = document.createElement('div');
      track.className = 'progress-track';
      const fill = document.createElement('div');
      fill.className = 'progress-fill';
      fill.style.width = `${snap.progress}%`;
      fill.style.background = ACCENT_HEX[agent.name] ?? '#2e7d4f';
      track.appendChild(fill);
      btn.appendChild(track);
    }

    btn.addEventListener('click', () => focusAgent(agent.id));
    agentsPanel.appendChild(btn);
  }

  if (boss) {
    const bossBtn = document.createElement('button');
    bossBtn.type = 'button';
    bossBtn.className = 'agent-row boss-row';
    if (state.inspectingBoss) bossBtn.classList.add('active');

    const topLine = document.createElement('div');
    topLine.className = 'agent-row-top';
    const left = document.createElement('span');
    left.className = 'agent-row-id';
    const dot = document.createElement('span');
    dot.className = 'dot';
    dot.style.background = '#d68a28';
    const nameEl = document.createElement('span');
    nameEl.className = 'agent-name';
    nameEl.textContent = '老板 · 宇航员奶龙';
    const zoneBadge = document.createElement('span');
    zoneBadge.className = 'zone-tag boss-tag';
    zoneBadge.textContent = 'BOSS';
    left.append(dot, nameEl, zoneBadge);

    const modeTag = document.createElement('span');
    modeTag.className = 'agent-model-tag';
    modeTag.textContent = boss.isPaused() ? '已暂停' : '巡逻中';
    topLine.append(left, modeTag);

    const taskLine = document.createElement('div');
    taskLine.className = 'agent-row-task';
    taskLine.id = 'boss-drawer-status';
    taskLine.textContent = boss.getStatus();

    bossBtn.append(topLine, taskLine);
    bossBtn.addEventListener('click', focusBoss);
    agentsPanel.appendChild(bossBtn);
  }

  // 2. 模型选择器
  const modelsPanel = document.getElementById('panel-models');
  modelsPanel.replaceChildren();
  for (const agent of agents) {
    const group = document.createElement('div');
    group.className = 'model-group';

    const head = document.createElement('div');
    head.className = 'model-group-head';
    const title = document.createElement('span');
    title.className = 'model-group-name';
    title.textContent = agent.name;
    const plan = document.createElement('span');
    plan.className = 'model-group-plan';
    plan.textContent = agent.plan ?? '未接入';
    head.append(title, plan);
    group.appendChild(head);

    const list = document.createElement('div');
    list.className = 'model-chip-list';
    if (agent.models.length === 0) {
      const note = document.createElement('div');
      note.className = 'model-empty-note';
      note.textContent = '模型列表待核对，仅支持自定义输入。';
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'model-chip pending';
      chip.textContent = '自定义模型';
      chip.addEventListener('click', () => openDialogue(agent.id, ''));
      list.append(note, chip);
    } else {
      for (const model of agent.models) {
        const chip = document.createElement('button');
        chip.type = 'button';
        chip.className = 'model-chip';
        chip.textContent = model;
        if ((state.selectedModels[agent.id] ?? agent.defaultModel) === model) chip.classList.add('active');
        chip.addEventListener('click', () => selectModel(agent.id, model));
        list.appendChild(chip);
      }
    }
    group.appendChild(list);
    modelsPanel.appendChild(group);
  }

  // 3. 14天核对检查清单
  const checkPanel = document.getElementById('panel-check');
  checkPanel.replaceChildren();
  for (const agent of agents) {
    const row = document.createElement('div');
    row.className = 'check-row';

    const head = document.createElement('div');
    head.className = 'check-row-head';
    const nameEl = document.createElement('span');
    nameEl.className = 'check-name';
    nameEl.textContent = `${agent.name} · ${agent.provider}`;

    const statusSpan = document.createElement('span');
    const days = daysSince(agent.lastVerifiedAt);
    if (agent.status !== 'verified') {
      statusSpan.className = 'check-pill warn';
      statusSpan.textContent = '未验证 · 模型列表待核对';
    } else if (days !== null && days > 14) {
      statusSpan.className = 'check-pill warn';
      statusSpan.textContent = `已超过 ${days} 天未核对`;
    } else if (days === 0) {
      statusSpan.className = 'check-pill ok';
      statusSpan.textContent = '已验证 · 今日核对';
    } else {
      statusSpan.className = 'check-pill ok';
      statusSpan.textContent = `已验证 · ${days} 天前核对`;
    }
    head.append(nameEl, statusSpan);

    const detail = document.createElement('div');
    detail.className = 'check-meta';
    detail.textContent = `默认模型：${agent.defaultModel ?? '—'} · 思考等级：${agent.thinkingLevel ?? '—'}`;
    row.append(head, detail);
    checkPanel.appendChild(row);
  }
}

function selectModel(agentId, model) {
  state.selectedModels[agentId] = model;
  updateAgentModelVisuals(agentId, model);
  state.currentAgent = agentId;
  updateDock();
  renderDrawer();
  openInspector(agentId);
}

function focusAgent(agentId) {
  const { x, z } = LAYOUT[agentId];
  controls.autoRotate = false;
  state.followBoss = false;
  state.inspectingBoss = false;
  const autoBtn = document.querySelector('.view-btn[data-view="auto"]');
  if (autoBtn) {
    autoBtn.classList.remove('active');
    autoBtn.setAttribute('aria-pressed', 'false');
  }
  state.currentAgent = agentId;
  state.cameraGoal = {
    pos: new THREE.Vector3(x + 2.2, 2.4, z + 3.4),
    target: new THREE.Vector3(x, 1.0, z),
  };
  updateDock();
  renderDrawer();
  openInspector(agentId);
}

function focusBoss() {
  if (!boss) return;
  controls.autoRotate = false;
  const autoBtn = document.querySelector('.view-btn[data-view="auto"]');
  if (autoBtn) {
    autoBtn.classList.remove('active');
    autoBtn.setAttribute('aria-pressed', 'false');
  }
  state.currentAgent = null;
  state.inspectingBoss = true;
  const bp = boss.root.position;
  const yaw = boss.root.rotation.y;
  const fwdX = Math.sin(yaw);
  const fwdZ = Math.cos(yaw);
  state.cameraGoal = {
    pos: new THREE.Vector3(bp.x + fwdX * 4.0 + fwdZ * 1.45, 2.35, bp.z + fwdZ * 4.0 - fwdX * 1.45),
    target: new THREE.Vector3(bp.x, 1.15, bp.z),
  };
  updateDock();
  renderDrawer();
  openBossInspector();
}

function openBossInspector() {
  if (!boss) return;
  document.getElementById('inspector-dot').style.background = '#d68a28';
  document.getElementById('inspector-title').textContent = '老板 · 宇航员奶龙';

  const body = document.getElementById('inspector-body');
  body.replaceChildren();

  const statusBlock = document.createElement('div');
  statusBlock.className = 'inspector-status';
  const statusLine = document.createElement('div');
  statusLine.className = 'inspector-status-text';
  statusLine.id = 'boss-inspector-status';
  statusLine.textContent = boss.getStatus();
  statusBlock.appendChild(statusLine);
  body.appendChild(statusBlock);

  const grid = document.createElement('div');
  grid.className = 'spec-grid';
  const specs = [
    ['角色定位', '工作室老板'],
    ['巡逻路线', 'Zone C → Zone A → Zone B'],
    ['巡逻状态', boss.isPaused() ? '已暂停' : '自动巡逻中'],
    ['跟拍视角', state.followBoss ? '已开启跟随' : '自由视角'],
  ];
  for (const [k, v] of specs) {
    const cell = document.createElement('div');
    cell.className = 'spec-cell';
    const label = document.createElement('div');
    label.className = 'spec-k';
    label.textContent = k;
    const val = document.createElement('div');
    val.className = 'spec-v';
    val.textContent = v;
    cell.append(label, val);
    grid.appendChild(cell);
  }
  body.appendChild(grid);

  const actions = document.createElement('div');
  actions.className = 'inspector-actions';

  const followBtn = document.createElement('button');
  followBtn.type = 'button';
  followBtn.id = 'boss-follow-btn';
  followBtn.textContent = state.followBoss ? '取消跟随' : '跟随视角';
  followBtn.addEventListener('click', () => {
    state.followBoss = !state.followBoss;
    if (state.followBoss) focusBoss();
    else openBossInspector();
  });

  const pauseBtn = document.createElement('button');
  pauseBtn.type = 'button';
  pauseBtn.className = 'secondary';
  pauseBtn.id = 'boss-pause-btn';
  pauseBtn.textContent = boss.isPaused() ? '继续巡逻' : '暂停巡逻';
  pauseBtn.addEventListener('click', () => {
    boss.togglePause();
    renderDrawer();
    openBossInspector();
  });

  actions.append(followBtn, pauseBtn);
  body.appendChild(actions);
  document.getElementById('inspector').hidden = false;
}

function openInspector(agentId) {
  state.inspectingBoss = false;
  const agent = state.config.agents.find((a) => a.id === agentId);
  if (!agent) return;
  const snap = SNAPSHOT[agentId];
  const model = state.selectedModels[agentId] ?? agent.defaultModel;

  document.getElementById('inspector-dot').style.background = ACCENT_HEX[agent.name] ?? '#8a8277';
  document.getElementById('inspector-title').textContent = `${agent.name} · ${agent.provider}`;

  const body = document.getElementById('inspector-body');
  body.replaceChildren();

  const statusBlock = document.createElement('div');
  statusBlock.className = 'inspector-status';
  const statusLine = document.createElement('div');
  statusLine.className = 'inspector-status-text';
  statusLine.textContent = `${snap.status} · ${snap.task}${snap.progress ? `（${snap.progress}%）` : ''}`;
  statusBlock.appendChild(statusLine);
  if (snap.progress > 0) {
    const track = document.createElement('div');
    track.className = 'progress-track';
    const fill = document.createElement('div');
    fill.className = 'progress-fill';
    fill.style.width = `${snap.progress}%`;
    fill.style.background = ACCENT_HEX[agent.name] ?? '#2e7d4f';
    track.appendChild(fill);
    statusBlock.appendChild(track);
  }
  body.appendChild(statusBlock);

  const grid = document.createElement('div');
  grid.className = 'spec-grid';
  const specs = [
    ['订阅套餐', agent.plan ?? '未接入'],
    ['思考等级', agent.thinkingLevel ?? '—'],
    ['当前模型', model ?? '待核对（仅自定义）'],
    [
      agent.bridge === 'codex-cli' ? '连接方式' : agent.surface === 'Web' ? '核对 · 入口' : '核对日期',
      agent.bridge === 'codex-cli'
        ? (state.codexBridge.connected ? `本机 Codex CLI（${state.codexBridge.cliVersion || '已连'}）` : '离线快照（需 server.py）')
        : agent.surface === 'Web'
          ? `${agent.lastVerifiedAt ? `${agent.lastVerifiedAt} 验证` : '未验证'} · 网页版`
          : (agent.lastVerifiedAt ? `${agent.lastVerifiedAt} 验证` : '未验证'),
    ],
  ];
  for (const [k, v] of specs) {
    const cell = document.createElement('div');
    cell.className = 'spec-cell';
    const label = document.createElement('div');
    label.className = 'spec-k';
    label.textContent = k;
    const val = document.createElement('div');
    val.className = 'spec-v';
    val.textContent = v;
    cell.append(label, val);
    grid.appendChild(cell);
  }
  body.appendChild(grid);

  const actions = document.createElement('div');
  actions.className = 'inspector-actions';
  const chatBtn = document.createElement('button');
  chatBtn.type = 'button';
  chatBtn.id = 'inspector-chat';
  chatBtn.textContent = '开新对话';
  chatBtn.addEventListener('click', () => openDialogue(agentId, ''));

  const customBtn = document.createElement('button');
  customBtn.type = 'button';
  customBtn.className = 'secondary';
  customBtn.id = 'inspector-custom';
  customBtn.textContent = '自定义输入';
  customBtn.addEventListener('click', () => {
    openDialogue(agentId, '');
    document.getElementById('dialogue-input').focus();
  });

  actions.append(chatBtn, customBtn);
  body.appendChild(actions);
  document.getElementById('inspector').hidden = false;
}

function escapeRegExp(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function parseDialogueInput(text) {
  let remaining = text;
  let model = null;
  let modelAgentId = null;

  // 先按模型名长度降序匹配，避免 "Gemini 4 Neon High" 被拆成 "Gemini" + "4 Neon"。
  const modelEntries = [];
  for (const agent of state.config.agents) {
    for (const m of agent.models) {
      modelEntries.push({ agentId: agent.id, model: m });
    }
  }
  modelEntries.sort((a, b) => b.model.length - a.model.length);

  for (const entry of modelEntries) {
    const re = new RegExp(escapeRegExp(entry.model), 'i');
    if (re.test(remaining)) {
      model = entry.model;
      modelAgentId = entry.agentId;
      remaining = remaining.replace(re, ' ').trim();
      break;
    }
  }

  let explicitAgentId = null;
  const agentMatchers = [];
  for (const agent of state.config.agents) {
    agentMatchers.push({ agentId: agent.id, token: agent.name });
    if (Array.isArray(agent.aliases)) {
      for (const alias of agent.aliases) {
        agentMatchers.push({ agentId: agent.id, token: alias });
      }
    }
  }
  agentMatchers.sort((a, b) => b.token.length - a.token.length);
  for (const m of agentMatchers) {
    const re = new RegExp(escapeRegExp(m.token), 'i');
    if (re.test(remaining)) {
      explicitAgentId = m.agentId;
      remaining = remaining.replace(re, ' ').trim();
      break;
    }
  }

  const agentId = explicitAgentId ?? modelAgentId ?? state.currentAgent;
  const targetAgent = state.config.agents.find((a) => a.id === agentId);
  if (!model && targetAgent?.allowCustomModel) {
    const customMatch = remaining.match(/(?:使用|用)\s*([A-Za-z][A-Za-z0-9._-]{1,32})/);
    if (customMatch) {
      model = customMatch[1];
      remaining = remaining.replace(customMatch[0], ' ').trim();
    }
  }

  const topic = remaining
    .replace(/^[让请帮对跟给\s]+/, '')
    .replace(/^(?:使用|用)(?:\s+|$)/, '')
    .replace(/(?:^|\s)(?:使用|用)\s*$/g, '')
    .replace(/\s+/g, ' ')
    .replace(/^[：:、，,\s]+/, '')
    .trim();

  return { agentId, model, topic };
}

function openDialogue(agentId, topic) {
  state.currentAgent = agentId;
  state.currentTopic = topic;
  state.inspectingBoss = false;
  const agent = state.config.agents.find((a) => a.id === agentId);
  const liveTag = agent?.bridge === 'codex-cli' && state.codexBridge.connected ? '（本机 CLI 实连）' : '';
  document.getElementById('dialogue-title').textContent = agent
    ? `新对话 · ${agent.name}${liveTag}`
    : '新对话';
  document.getElementById('dialogue').hidden = false;
  updateDock();
  renderDrawer();
}

async function sendDialogue() {
  const input = document.getElementById('dialogue-input');
  const sendBtn = document.getElementById('dialogue-send');
  const text = input.value.trim();
  if (!text || state.codexBridge.busy) return;

  const log = document.getElementById('dialogue-log');
  const userMsg = document.createElement('div');
  userMsg.className = 'msg user';
  userMsg.textContent = text;
  log.appendChild(userMsg);

  const parsed = parseDialogueInput(text);
  if (parsed.agentId) state.currentAgent = parsed.agentId;
  if (parsed.model && parsed.agentId) {
    state.selectedModels[parsed.agentId] = parsed.model;
    updateAgentModelVisuals(parsed.agentId, parsed.model);
  }
  if (parsed.topic) state.currentTopic = parsed.topic;

  const agent = state.config.agents.find((a) => a.id === parsed.agentId);
  const isLiveCodex = agent?.bridge === 'codex-cli' && state.codexBridge.connected;
  document.getElementById('dialogue-title').textContent = agent
    ? `新对话 · ${agent.name}${isLiveCodex ? '（本机 CLI 实连）' : ''}`
    : '新对话';
  const model = parsed.model ?? (agent ? (state.selectedModels[agent.id] ?? agent.defaultModel) : null);

  input.value = '';
  updateDock();
  renderDrawer();

  if (isLiveCodex) {
    state.codexBridge.busy = true;
    sendBtn.disabled = true;
    sendBtn.textContent = '思考中…';

    const loadingMsg = document.createElement('div');
    loadingMsg.className = 'msg loading';
    loadingMsg.textContent = `Codex（${model ?? 'GPT-6.2-Sol'}）正在本机只读沙箱中处理…`;
    log.appendChild(loadingMsg);
    log.scrollTop = log.scrollHeight;

    try {
      const res = await fetch('./api/codex/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: parsed.topic || text,
          model,
          reasoning: (agent.thinkingLevel || 'high').toLowerCase(),
        }),
      });
      const data = await res.json();
      loadingMsg.remove();

      const reply = document.createElement('div');
      reply.className = 'msg';
      const nameBold = document.createElement('b');
      nameBold.textContent = `${agent.name}（${data.model || model || 'Codex'}）：`;
      const bodyDiv = document.createElement('div');
      bodyDiv.className = 'msg-body';
      const simSpan = document.createElement('span');
      simSpan.className = 'sim';

      if (res.ok && data.ok) {
        bodyDiv.textContent = data.reply;
        simSpan.textContent = `本机 Codex CLI 真实回复（只读沙箱 · ${((data.elapsedMs || 0) / 1000).toFixed(1)}s）`;
      } else {
        bodyDiv.textContent = data.error || `请求失败（HTTP ${res.status}）`;
        simSpan.textContent = '调用本机 Codex CLI 未成功，请检查登录或网络代理设置。';
      }
      reply.append(nameBold, bodyDiv, simSpan);
      log.appendChild(reply);
    } catch (err) {
      loadingMsg.remove();
      const errReply = document.createElement('div');
      errReply.className = 'msg';
      const errBold = document.createElement('b');
      errBold.textContent = `${agent.name}：`;
      const errText = document.createElement('div');
      errText.className = 'msg-body';
      errText.textContent = `连接本地桥接失败：${err.message}`;
      errReply.append(errBold, errText);
      log.appendChild(errReply);
    } finally {
      state.codexBridge.busy = false;
      sendBtn.disabled = false;
      sendBtn.textContent = '发送';
      log.scrollTop = log.scrollHeight;
    }
    return;
  }

  const reply = document.createElement('div');
  reply.className = 'msg';
  const nameBold = document.createElement('b');
  nameBold.textContent = agent ? agent.name : '办公室';
  const bodyText = document.createTextNode(
    `（${model ?? '待核对'}）收到：${parsed.topic || '（无主题）'}。`,
  );
  const simSpan = document.createElement('span');
  simSpan.className = 'sim';
  simSpan.textContent = agent?.bridge === 'codex-cli'
    ? '当前未连接到 server.py（纯静态模式），使用办公室内部模拟回复。'
    : '办公室内部模拟回复，不是直连账号的真实会话。';
  reply.append(nameBold, bodyText, document.createElement('br'), simSpan);

  log.appendChild(reply);
  log.scrollTop = log.scrollHeight;
}

function setView(name) {
  if (name === 'auto') {
    controls.autoRotate = !controls.autoRotate;
    controls.autoRotateSpeed = 0.8;
    const autoBtn = document.querySelector('.view-btn[data-view="auto"]');
    if (autoBtn) {
      autoBtn.classList.toggle('active', controls.autoRotate);
      autoBtn.setAttribute('aria-pressed', String(controls.autoRotate));
    }
    return;
  }
  controls.autoRotate = false;
  state.followBoss = false;
  document.querySelectorAll('.view-btn').forEach((b) => {
    const active = b.dataset.view === name;
    b.classList.toggle('active', active);
    if (b.dataset.view === 'auto') b.setAttribute('aria-pressed', 'false');
  });
  if (name === 'panoramic') {
    state.cameraGoal = { pos: new THREE.Vector3(10.6, 8.2, 13.8), target: new THREE.Vector3(-0.4, 0.7, 0) };
  } else if (name === 'closeup') {
    state.cameraGoal = { pos: new THREE.Vector3(-3.2, 2.4, 1.4), target: new THREE.Vector3(-3.2, 1.0, -2.8) };
  } else if (name === 'top') {
    state.cameraGoal = { pos: new THREE.Vector3(-2.3, 25.0, 0.01), target: new THREE.Vector3(-2.3, 0, -0.3) };
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

async function loadCodexBridgeStatus() {
  try {
    const res = await fetch('./api/codex/status');
    if (!res.ok) return;
    const data = await res.json();
    if (!data || !data.connected) return;

    state.codexBridge = {
      connected: true,
      cliVersion: data.cliVersion || null,
      modelSlugs: data.modelSlugs || {},
      latestSession: data.latestSession || null,
      busy: false,
    };

    const codexAgent = state.config.agents.find((a) => a.bridge === 'codex-cli' || a.name === 'Codex');
    if (!codexAgent) return;

    if (Array.isArray(data.models) && data.models.length > 0) {
      codexAgent.models = data.models;
    }
    if (data.defaultModel) {
      codexAgent.defaultModel = data.defaultModel;
      state.selectedModels[codexAgent.id] = data.defaultModel;
    }
    if (data.thinkingLevel) {
      codexAgent.thinkingLevel = data.thinkingLevel;
    }
    if (data.fetchedAt) {
      codexAgent.lastVerifiedAt = data.fetchedAt;
    }
    SNAPSHOT[codexAgent.id] = {
      status: '工作中',
      task: data.latestSession
        ? `本机已连 · 最近 ${data.latestSession.project}（${data.latestSession.time}）`
        : `本机已连 · ${data.cliVersion || 'codex-cli'}`,
      progress: 88,
    };
  } catch {
    // 纯静态服务下无 /api/codex/status 时静默降级为快照模式
  }
}

function setDrawerOpen(open) {
  const drawer = document.getElementById('drawer');
  const toggle = document.getElementById('drawer-toggle');
  if (!drawer || !toggle) return;
  drawer.hidden = !open;
  toggle.classList.toggle('active', open);
  toggle.setAttribute('aria-expanded', String(open));
}

function syncTopbarOffset() {
  const topbar = document.getElementById('topbar');
  if (!topbar) return;
  document.documentElement.style.setProperty('--hud-top', `${topbar.offsetHeight + 12}px`);
}

function initUI() {
  syncTopbarOffset();

  document.querySelectorAll('#drawer-tabs button[data-tab]').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#drawer-tabs button[data-tab]').forEach((b) => b.classList.toggle('active', b === btn));
      document.getElementById('panel-agents').hidden = btn.dataset.tab !== 'agents';
      document.getElementById('panel-models').hidden = btn.dataset.tab !== 'models';
      document.getElementById('panel-check').hidden = btn.dataset.tab !== 'check';
    });
  });

  const drawerToggle = document.getElementById('drawer-toggle');
  if (drawerToggle) {
    drawerToggle.addEventListener('click', () => {
      const drawer = document.getElementById('drawer');
      setDrawerOpen(drawer.hidden);
    });
  }
  setDrawerOpen(window.innerWidth > 720);

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

  const dockCmd = document.getElementById('dock-cmd');
  if (dockCmd) {
    dockCmd.addEventListener('click', () => {
      openDialogue(state.currentAgent ?? 1, '');
      document.getElementById('dialogue-input').focus();
    });
  }

  window.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      openDialogue(state.currentAgent ?? 1, '');
      document.getElementById('dialogue-input').focus();
    } else if (e.key === 'Escape') {
      const dlg = document.getElementById('dialogue');
      const insp = document.getElementById('inspector');
      if (!dlg.hidden) {
        dlg.hidden = true;
      } else if (!insp.hidden) {
        insp.hidden = true;
      }
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
    const rect = renderer.domElement.getBoundingClientRect();
    pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(pointer, camera);
    const hits = raycaster.intersectObjects(pickables, false);
    if (hits.length > 0) {
      const hitData = hits[0].object.userData;
      if (hitData.boss) focusBoss();
      else if (hitData.agentId) focusAgent(hitData.agentId);
    }
  });

  window.addEventListener('resize', () => {
    updateCameraProjection();
    renderer.setSize(window.innerWidth, window.innerHeight);
    labelRenderer.setSize(window.innerWidth, window.innerHeight);
    syncTopbarOffset();
  });
}

const clock = new THREE.Clock();
let elapsed = 0;

function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.05);
  elapsed += dt;

  if (!REDUCED_MOTION) {
    for (const rig of avatarRigs) {
      if (!rig.active) continue;
      rig.group.position.y = rig.baseY + Math.sin(elapsed * 2.1 + rig.phase) * 0.008;
    }
  }

  if (boss) {
    boss.update(dt, elapsed);
    const statusText = boss.getStatus();
    const drawerStatus = document.getElementById('boss-drawer-status');
    if (drawerStatus && drawerStatus.textContent !== statusText) {
      drawerStatus.textContent = statusText;
    }
    const inspStatus = document.getElementById('boss-inspector-status');
    if (inspStatus && inspStatus.textContent !== statusText) {
      inspStatus.textContent = statusText;
    }

    const dx = boss.root.position.x - lastBossPos.x;
    const dz = boss.root.position.z - lastBossPos.z;
    lastBossPos.copy(boss.root.position);
    if (state.followBoss && (dx !== 0 || dz !== 0)) {
      if (state.cameraGoal) {
        state.cameraGoal.pos.x += dx;
        state.cameraGoal.pos.z += dz;
        state.cameraGoal.target.x += dx;
        state.cameraGoal.target.z += dz;
      } else {
        camera.position.x += dx;
        camera.position.z += dz;
        controls.target.x += dx;
        controls.target.z += dz;
      }
    }
  }

  updateCutawayWalls();

  if (state.cameraGoal) {
    camera.position.lerp(state.cameraGoal.pos, 0.08);
    controls.target.lerp(state.cameraGoal.target, 0.08);
    if (
      camera.position.distanceTo(state.cameraGoal.pos) < 0.03 &&
      controls.target.distanceTo(state.cameraGoal.target) < 0.03
    ) {
      camera.position.copy(state.cameraGoal.pos);
      controls.target.copy(state.cameraGoal.target);
      state.cameraGoal = null;
    }
  }

  controls.update();
  renderer.render(scene, camera);
  labelRenderer.render(scene, camera);
  resolveZoneAOverlap(zoneALabels.Antigravity, zoneALabels.Gemini, 8);
  resolveZoneAOverlap(zoneBLabels['GPT 网页版'], zoneBLabels.Codex, 8);
}

async function main() {
  await loadConfig();
  await loadCodexBridgeStatus();
  buildRoom();
  for (const agent of state.config.agents) buildDesk(agent);
  boss = createBossNailong({
    std,
    makeContactShadow,
    makeBossLabel,
    reducedMotion: REDUCED_MOTION,
  });
  scene.add(boss.root);
  pickables.push(...boss.pickables);
  lastBossPos.copy(boss.root.position);
  initUI();
  renderDrawer();
  updateDock();
  animate();
}

main();
