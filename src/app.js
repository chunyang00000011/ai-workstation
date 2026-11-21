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
const STORAGE_THREADS_KEY = 'ai-workstation-threads-v1';

// 运行时读 config/models.json；加载失败时用这份离线快照（与 2026-11-21 已验证内容一致）。
const FALLBACK_CONFIG = {
  schemaVersion: 3,
  updated: '2026-11-21',
  agents: [
    { id: 1, name: 'GPT 网页版', aliases: ['GPT', 'ChatGPT'], surface: 'Web', provider: 'OpenAI', plan: 'Plus', status: 'verified', defaultModel: 'GPT-6', models: ['GPT-6', 'GPT-5.6 Sol'], thinkingLevel: 'Medium', lastVerifiedAt: '2026-11-21', allowCustomModel: true },
    { id: 2, name: 'Claude', provider: 'Anthropic', plan: null, status: 'pending', defaultModel: null, models: [], thinkingLevel: null, lastVerifiedAt: null, allowCustomModel: true },
    { id: 3, name: 'Gemini', provider: 'Google', plan: 'Google AI Ultra', status: 'verified', defaultModel: '4 Neon', models: ['自动', '4 Hydrogen', '4 Neon', '4 Carbon'], thinkingLevel: 'Low', lastVerifiedAt: '2026-11-21', allowCustomModel: true },
    { id: 4, name: 'Grok', provider: 'xAI', plan: null, status: 'pending', defaultModel: null, models: [], thinkingLevel: null, lastVerifiedAt: null, allowCustomModel: true },
    { id: 5, name: 'Antigravity', aliases: ['AGY', 'Antigravity CLI', '反重力'], bridge: 'antigravity-cli', surface: 'Desktop / Local & Cloud', provider: 'Google', plan: 'Google AI Ultra', status: 'verified', defaultModel: 'Orchestrator Gemini 4 Neon Extra High', models: ['Orchestrator Gemini 4 Neon Extra High', 'Gemini 4 Neon High', '4 Carbon Medium', '4 Argon Medium', '4 Hydrogen Medium', '3.8 Flash Medium', 'Claude Opus 5.5 Medium', 'Claude Sonnet 5.5 Medium', 'GPT-OSS 120B Medium'], thinkingLevel: 'Extra High', lastVerifiedAt: '2026-11-21', allowCustomModel: true },
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

// 所有 6 个系列的默认最近 3 条对话种子（在无本地桥接时亦保证完整可用）。
const DEFAULT_RECENT_THREADS = {
  1: [
    {
      id: 'gpt-web-1',
      title: '对比日区与美区 Plus 订阅费用',
      time: '2026-11-21 19:20',
      mode: 'web',
      modeLabel: '网页记录',
      source: 'localStorage',
      messages: [
        { role: 'user', text: '帮我列出日区、美区和韩区 ChatGPT Plus 的月费与汇率差异' },
        { role: 'assistant', text: '已整理三区月费、信用卡外币手续费及常见地区差异对比表（网页端对话快照）。', meta: 'GPT 网页版 · GPT-6' },
      ],
    },
    {
      id: 'gpt-web-2',
      title: '翻译并润色 PR 说明文案',
      time: '2026-11-20 15:40',
      mode: 'web',
      modeLabel: '网页记录',
      source: 'localStorage',
      messages: [
        { role: 'user', text: '把这版 v6 3D 办公室修改清单润色成清晰的双语 PR 描述' },
        { role: 'assistant', text: '已生成分章节 PR 说明，包含改动清单与本地回归测试步骤。', meta: 'GPT 网页版 · GPT-6' },
      ],
    },
    {
      id: 'gpt-web-3',
      title: '整理一周学习计划卡片',
      time: '2026-11-19 21:05',
      mode: 'web',
      modeLabel: '网页记录',
      source: 'localStorage',
      messages: [
        { role: 'user', text: '把每天 45 分钟的强化学习与渲染管线学习排成表格' },
        { role: 'assistant', text: '已按周一至周日拆分实践题与复盘时间块。', meta: 'GPT 网页版 · GPT-5.6 Sol' },
      ],
    },
  ],
  2: [
    {
      id: 'claude-1',
      title: '长文档结构重构建议',
      time: '2026-11-20 18:10',
      mode: 'record',
      modeLabel: '待核对记录',
      source: 'localStorage',
      messages: [
        { role: 'user', text: '如何把 3D 场景模块的纹理与 UI 状态拆分成易维护的职责边界？' },
        { role: 'assistant', text: '建议将场景资源生成、状态管理与 DOM 渲染解耦为独立小模块。', meta: 'Claude · 自定义记录' },
      ],
    },
    {
      id: 'claude-2',
      title: '代码可读性与注释评审清单',
      time: '2026-11-19 16:30',
      mode: 'record',
      modeLabel: '待核对记录',
      source: 'localStorage',
      messages: [
        { role: 'user', text: '帮我总结 PR Review 时最关键的 5 个架构检查点' },
        { role: 'assistant', text: '已整理：状态单向流、边界条件、资源释放、错误降级与可测性。', meta: 'Claude · 自定义记录' },
      ],
    },
    {
      id: 'claude-3',
      title: '待登录配置核对备忘',
      time: '2026-11-18 11:15',
      mode: 'record',
      modeLabel: '待核对记录',
      source: 'localStorage',
      messages: [
        { role: 'user', text: '记一下后续登录 Anthropic 账号后要核对的模型版本' },
        { role: 'assistant', text: '已加入待核对列表，登录验证后即可写入 config/models.json。', meta: 'Claude · 待核对' },
      ],
    },
  ],
  3: [
    {
      id: 'gemini-1',
      title: 'BatchNorm 与 MLP 收敛机制',
      time: '2026-11-21 20:10',
      mode: 'web',
      modeLabel: 'Ultra 记录',
      source: 'localStorage',
      messages: [
        { role: 'user', text: 'BatchNorm 在推理阶段如何利用移动均值和方差？' },
        { role: 'assistant', text: 'eval 模式下冻结批统计量，使用训练期累积的 running_mean 与 running_var 保持输出确定性。', meta: 'Gemini · 4 Neon' },
      ],
    },
    {
      id: 'gemini-2',
      title: 'Atelier Braun 配色与光源配比',
      time: '2026-11-21 14:25',
      mode: 'web',
      modeLabel: 'Ultra 记录',
      source: 'localStorage',
      messages: [
        { role: 'user', text: '如何在 ACES 1.04 曝光下兼顾动漫色彩活力与不过曝？' },
        { role: 'assistant', text: '控制 envMapIntensity 为 0.42，使用暖日主光配合晴空天光补色，并保持高光材质 roughness >= 0.35。', meta: 'Gemini · 4 Neon' },
      ],
    },
    {
      id: 'gemini-3',
      title: '多模态文档摘要提取',
      time: '2026-11-19 19:50',
      mode: 'web',
      modeLabel: 'Ultra 记录',
      source: 'localStorage',
      messages: [
        { role: 'user', text: '提取已知问题清单里的三个高优先级修复项' },
        { role: 'assistant', text: '分别为：Zone A 标签防重叠、1024×384 桌牌单层纹理、与“状态快照（非持续同步）”文案一致性。', meta: 'Gemini · 4 Carbon' },
      ],
    },
  ],
  4: [
    {
      id: 'grok-1',
      title: '实时技术动态追踪草稿',
      time: '2026-11-20 12:30',
      mode: 'record',
      modeLabel: '待核对记录',
      source: 'localStorage',
      messages: [
        { role: 'user', text: '关注最近 WebGPU 与 Three.js 新特性有哪些实战影响' },
        { role: 'assistant', text: '重点可留意 TSL 节点材质与跨后端粒子计算演进。', meta: 'Grok · 自定义记录' },
      ],
    },
    {
      id: 'grok-2',
      title: '头脑风暴：工位趣味交互',
      time: '2026-11-19 17:45',
      mode: 'record',
      modeLabel: '待核对记录',
      source: 'localStorage',
      messages: [
        { role: 'user', text: '给 3D 虚拟办公室加什么角色互动最有生气？' },
        { role: 'assistant', text: '让穿宇航服的奶龙老板按路线巡视各工位，并配合打字动效与热咖啡蒸汽！', meta: 'Grok · 自定义记录' },
      ],
    },
    {
      id: 'grok-3',
      title: 'xAI 账号待接入备忘',
      time: '2026-11-18 09:40',
      mode: 'record',
      modeLabel: '待核对记录',
      source: 'localStorage',
      messages: [
        { role: 'user', text: '先保留 Grok 自定义输入入口，接入后再同步官方模型名' },
        { role: 'assistant', text: '收到，当前支持在对话框指定自定义模型名进行本地演练。', meta: 'Grok · 待核对' },
      ],
    },
  ],
  5: [
    {
      id: 'agy-seed-1',
      title: 'PyTorch 进阶学习与训练闭环',
      time: '2026-11-21 21:00',
      mode: 'local',
      modeLabel: '本地工作区',
      source: 'localStorage',
      messages: [
        { role: 'user', text: '帮我安排本周 CUDA 算子与混合精度训练实验计划' },
        { role: 'assistant', text: '建议先完成 AMP 基准测试，再逐层 profiling 关键 Linear/LayerNorm 耗时。', meta: 'Antigravity · Orchestrator Gemini 4 Neon Extra High' },
      ],
    },
    {
      id: 'agy-seed-2',
      title: '3D 办公室动漫视觉与本地桥接',
      time: '2026-11-21 16:40',
      mode: 'local',
      modeLabel: '本地工作区',
      source: 'localStorage',
      messages: [
        { role: 'user', text: '如何把本地 Antigravity 的本地与云端会话同时接到工作室网页？' },
        { role: 'assistant', text: '通过 server.py 调用只读摘要与 agy --sandbox，支持本地工作区和隔离云端模式切换。', meta: 'Antigravity · 本地工作区' },
      ],
    },
    {
      id: 'agy-seed-3',
      title: '云端独立架构讨论模板',
      time: '2026-11-20 10:15',
      mode: 'cloud',
      modeLabel: '云端对话',
      source: 'localStorage',
      messages: [
        { role: 'user', text: '不绑定本地仓库，快速头脑风暴下一阶段多 Agent 协作视图' },
        { role: 'assistant', text: '已进入云端轻量会话视角，可随时切换回本地工作区执行代码修改。', meta: 'Antigravity · 云端对话' },
      ],
    },
  ],
  6: [
    {
      id: 'codex-seed-1',
      title: 'ai-workstation · server.py 接口审查',
      time: '2026-11-21 20:50',
      mode: 'local',
      modeLabel: '本地 CLI',
      source: 'localStorage',
      messages: [
        { role: 'user', text: '检查 localhost Origin 校验与 32KB 请求体上限边界' },
        { role: 'assistant', text: '已确认仅绑定 127.0.0.1，且所有写接口强制校验 Host/Origin。', meta: 'Codex · GPT-6.2-Sol' },
      ],
    },
    {
      id: 'codex-seed-2',
      title: '模型缓存与推理等级映射',
      time: '2026-11-20 22:15',
      mode: 'local',
      modeLabel: '本地 CLI',
      source: 'localStorage',
      messages: [
        { role: 'user', text: '确认 GPT-6.2-Sol 与 High reasoning effort 是否正确解析' },
        { role: 'assistant', text: '已对齐本地 models_cache.json 与只读沙箱执行参数。', meta: 'Codex · GPT-6.2-Sol' },
      ],
    },
    {
      id: 'codex-seed-3',
      title: 'Three.js r160 兼容检查',
      time: '2026-11-19 14:10',
      mode: 'local',
      modeLabel: '本地 CLI',
      source: 'localStorage',
      messages: [
        { role: 'user', text: '核查 RoomEnvironment 与 CSS2DRenderer 在 r160 的注意事项' },
        { role: 'assistant', text: '需显式传 renderer 给 RoomEnvironment，并通过 renderOrder 维持标签层级。', meta: 'Codex · GPT-6-Astra' },
      ],
    },
  ],
};

const STATUS_COLORS = { '工作中': 0x1f9d63, '思考中': 0xd98218, '待核对': 0x8a869c };
const STATUS_HEX = { '工作中': '#1f9d63', '思考中': '#d98218', '待核对': '#8a869c' };
const ACCENTS = { 'GPT 网页版': 0x22b573, GPT: 0x22b573, Codex: 0x0ea5a8, Claude: 0xe57c4b, Gemini: 0x3b82f6, Grok: 0x5b527a, Antigravity: 0xff6b3d };
const ACCENT_HEX = { 'GPT 网页版': '#22b573', GPT: '#22b573', Codex: '#0ea5a8', Claude: '#e57c4b', Gemini: '#3b82f6', Grok: '#5b527a', Antigravity: '#ff6b3d' };

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
  agMode: 'local',
  conversations: {}, // agentId -> { recent: [...], activeId: string | null }
  codexBridge: {
    connected: false,
    cliVersion: null,
    modelSlugs: {},
    latestSession: null,
    busy: false,
  },
  antigravityBridge: {
    connected: false,
    cliPath: null,
    defaultModel: null,
    defaultModelSlug: null,
    modelSlugs: {},
    latestConversation: null,
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
scene.background = new THREE.Color(0xe5f0fb);

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

const hemi = new THREE.HemisphereLight(0xd9efff, 0xf2b980, 0.78);
scene.add(hemi);

const sun = new THREE.DirectionalLight(0xffe9c7, 1.95);
sun.position.set(8.5, 11.0, 6.4);
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

const windowFill = new THREE.DirectionalLight(0x7cc8ff, 0.62);
windowFill.position.set(-5, 4.5, -7);
scene.add(windowFill);

const loungeGlow = new THREE.PointLight(0xffbe73, 0.9, 6.5, 1.6);
loungeGlow.position.set(6.2, 2.05, 2.65);
scene.add(loungeGlow);

const pickables = []; // Mesh[] with userData.agentId or userData.boss
const deskPlates = {}; // agentId -> { mesh, texture }
const headLabels = {}; // agentId -> CSS2DObject
const zoneALabels = {}; // agent.name -> CSS2DObject
const zoneBLabels = {}; // agent.name -> CSS2DObject
const avatarRigs = []; // { group, head, leftArm, rightArm, ideaOrb, baseY, phase, status }
const steamPuffs = []; // { sprite, originX, originY, originZ, phase, speed }
let dustMotes = null;
let wallClockHands = null;

let contactShadowTex = null;
let steamSpriteTex = null;
let backWallGroup = null;
let leftWallGroup = null;
let windowGroup = null;
let backWallDecor = null;
let leftWallDecor = null;
let sunbeamGroup = null;
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

// ---------------------------------------------------------------------------
// 动漫风程序化纹理库
// ---------------------------------------------------------------------------

function makeOakFloorTexture() {
  const rand = seededRng(2026);
  return makeCanvasTex(512, 512, (ctx, w, h) => {
    ctx.fillStyle = '#dfb374';
    ctx.fillRect(0, 0, w, h);
    const rows = 8;
    const plankH = h / rows;
    for (let r = 0; r < rows; r++) {
      const y = r * plankH;
      const offset = (r % 2) * (w * 0.35);
      for (let col = -1; col < 3; col++) {
        const x = col * (w * 0.5) + offset;
        const tone = Math.floor((rand() - 0.5) * 12);
        ctx.fillStyle = `rgb(${225 + tone}, ${178 + tone}, ${116 + Math.round(tone * 0.8)})`;
        ctx.fillRect(x, y, w * 0.5 - 2, plankH - 2);
        ctx.strokeStyle = 'rgba(155, 102, 48, 0.11)';
        ctx.lineWidth = 1.2;
        for (let g = 0; g < 5; g++) {
          const gy = y + 5 + rand() * (plankH - 10);
          ctx.beginPath();
          ctx.moveTo(x + 2, gy);
          ctx.lineTo(x + w * 0.5 - 4, gy + (rand() - 0.5) * 2.5);
          ctx.stroke();
        }
        ctx.fillStyle = 'rgba(132, 86, 42, 0.18)';
        ctx.fillRect(x + w * 0.5 - 2, y, 2, plankH);
      }
      ctx.fillStyle = 'rgba(132, 86, 42, 0.16)';
      ctx.fillRect(0, y + plankH - 2, w, 2);
    }
  }, { repeat: [5, 4] });
}

function makeAnimeWallTexture() {
  const rand = seededRng(77);
  return makeCanvasTex(256, 256, (ctx, w, h) => {
    ctx.fillStyle = '#fff8ec';
    ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 900; i++) {
      const alpha = 0.014 + rand() * 0.02;
      ctx.fillStyle = rand() > 0.5 ? `rgba(248, 214, 174, ${alpha})` : `rgba(255, 255, 255, ${alpha})`;
      ctx.fillRect(rand() * w, rand() * h, 3, 2);
    }
  }, { repeat: [3, 2] });
}

function makeAnimeSkyWindowTexture() {
  return makeCanvasTex(1024, 512, (ctx, w, h) => {
    const sky = ctx.createLinearGradient(0, 0, 0, h);
    sky.addColorStop(0, '#358ff0');
    sky.addColorStop(0.45, '#78cbff');
    sky.addColorStop(0.8, '#cdeaff');
    sky.addColorStop(1, '#ffe4b8');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, w, h);

    // 柔光太阳晕
    const sunGrad = ctx.createRadialGradient(w * 0.78, h * 0.24, 10, w * 0.78, h * 0.24, 190);
    sunGrad.addColorStop(0, 'rgba(255, 252, 232, 0.98)');
    sunGrad.addColorStop(0.35, 'rgba(255, 238, 184, 0.55)');
    sunGrad.addColorStop(1, 'rgba(255, 224, 165, 0)');
    ctx.fillStyle = sunGrad;
    ctx.fillRect(0, 0, w, h);

    // 新海诚风赛璐璐立体积雨云
    function drawCloud(cx, cy, scale, tint = '#c4daf7') {
      const puffs = [
        [0, 0, 74],
        [-64, 14, 54],
        [68, 16, 56],
        [-118, 28, 38],
        [124, 28, 40],
        [-28, -28, 52],
        [34, -22, 48],
      ];
      ctx.fillStyle = tint;
      for (const [dx, dy, r] of puffs) {
        ctx.beginPath();
        ctx.arc(cx + dx * scale, cy + (dy + 12) * scale, r * scale, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.fillStyle = '#ffffff';
      for (const [dx, dy, r] of puffs) {
        ctx.beginPath();
        ctx.arc(cx + dx * scale, cy + dy * scale, r * scale * 0.94, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    drawCloud(w * 0.24, h * 0.34, 1.05);
    drawCloud(w * 0.56, h * 0.26, 0.82);
    drawCloud(w * 0.82, h * 0.48, 0.9);

    // 远山与晴空屋顶剪影
    ctx.fillStyle = '#8db4e8';
    ctx.beginPath();
    ctx.moveTo(0, h);
    ctx.lineTo(0, h * 0.76);
    ctx.quadraticCurveTo(w * 0.18, h * 0.62, w * 0.38, h * 0.77);
    ctx.quadraticCurveTo(w * 0.58, h * 0.65, w * 0.8, h * 0.75);
    ctx.lineTo(w, h * 0.68);
    ctx.lineTo(w, h);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = '#6c8ec4';
    ctx.beginPath();
    ctx.moveTo(0, h);
    ctx.lineTo(0, h * 0.85);
    ctx.lineTo(w * 0.14, h * 0.82);
    ctx.lineTo(w * 0.28, h * 0.88);
    ctx.lineTo(w * 0.52, h * 0.81);
    ctx.lineTo(w * 0.74, h * 0.86);
    ctx.lineTo(w, h * 0.8);
    ctx.lineTo(w, h);
    ctx.closePath();
    ctx.fill();

    // 暖色远景小镇轮廓
    ctx.fillStyle = '#737ba6';
    for (let i = 0; i < 16; i++) {
      const rx = i * (w / 15) - 10;
      const rh = 34 + ((i * 29) % 38);
      ctx.fillRect(rx, h - rh, w / 16 - 4, rh);
    }

    // 玻璃斜向高光
    ctx.fillStyle = 'rgba(255, 255, 255, 0.16)';
    ctx.beginPath();
    ctx.moveTo(w * 0.08, 0);
    ctx.lineTo(w * 0.22, 0);
    ctx.lineTo(w * 0.04, h);
    ctx.lineTo(0, h);
    ctx.closePath();
    ctx.fill();
  });
}

function makeZoneARugTexture() {
  const rand = seededRng(91);
  return makeCanvasTex(512, 512, (ctx, w, h) => {
    ctx.fillStyle = '#fdf0df';
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = 'rgba(218, 174, 132, 0.15)';
    ctx.lineWidth = 1;
    for (let i = 0; i < w; i += 6) {
      ctx.beginPath();
      ctx.moveTo(i, 0);
      ctx.lineTo(i, h);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(0, i);
      ctx.lineTo(w, i);
      ctx.stroke();
    }
    const cx = w / 2;
    const cy = h / 2;
    for (const [r, col, lw] of [
      [234, '#ff7d54', 12],
      [212, '#ffd166', 7],
      [194, '#5da9e9', 5],
    ]) {
      ctx.strokeStyle = col;
      ctx.lineWidth = lw;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.stroke();
    }
    for (let i = 0; i < 700; i++) {
      ctx.fillStyle = `rgba(215, 148, 92, ${0.02 + rand() * 0.03})`;
      ctx.fillRect(rand() * w, rand() * h, 3, 2);
    }
  });
}

function makeZoneBRugTexture() {
  return makeCanvasTex(512, 512, (ctx, w, h) => {
    ctx.fillStyle = '#d8f4f0';
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = 'rgba(14, 165, 168, 0.13)';
    ctx.lineWidth = 1.5;
    for (let i = 24; i < w; i += 32) {
      ctx.beginPath();
      ctx.moveTo(i, 16);
      ctx.lineTo(i, h - 16);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(16, i);
      ctx.lineTo(w - 16, i);
      ctx.stroke();
    }
    ctx.strokeStyle = '#18b8bd';
    ctx.lineWidth = 12;
    ctx.strokeRect(14, 14, w - 28, h - 28);
    ctx.strokeStyle = '#ffd166';
    ctx.lineWidth = 4;
    ctx.strokeRect(28, 28, w - 56, h - 56);
  });
}

function makeLoungeRugTexture() {
  return makeCanvasTex(512, 256, (ctx, w, h) => {
    ctx.fillStyle = '#f6d9ca';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#fff6eb';
    for (let y = 26; y < h - 20; y += 38) {
      ctx.fillRect(24, y, w - 48, 12);
    }
    ctx.fillStyle = '#e87c5a';
    ctx.fillRect(0, 0, w, 14);
    ctx.fillRect(0, h - 14, w, 14);
    ctx.strokeStyle = '#d96b48';
    ctx.lineWidth = 6;
    ctx.strokeRect(12, 12, w - 24, h - 24);
  });
}

function makePosterTexture(variant) {
  return makeCanvasTex(256, 340, (ctx, w, h) => {
    if (variant === 0) {
      // 日暮富士山与动漫彩云
      const g = ctx.createLinearGradient(0, 0, 0, h);
      g.addColorStop(0, '#4f8df5');
      g.addColorStop(0.55, '#ffa799');
      g.addColorStop(1, '#ffe5b4');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = '#fff3b8';
      ctx.beginPath();
      ctx.arc(w * 0.72, h * 0.25, 30, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#5c5a9e';
      ctx.beginPath();
      ctx.moveTo(16, h * 0.85);
      ctx.lineTo(w * 0.48, h * 0.42);
      ctx.lineTo(w * 0.56, h * 0.42);
      ctx.lineTo(w - 16, h * 0.85);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#fffdf8';
      ctx.beginPath();
      ctx.moveTo(w * 0.4, h * 0.54);
      ctx.lineTo(w * 0.48, h * 0.42);
      ctx.lineTo(w * 0.56, h * 0.42);
      ctx.lineTo(w * 0.63, h * 0.54);
      ctx.lineTo(w * 0.52, h * 0.51);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#2d2b4e';
      ctx.fillRect(0, h * 0.85, w, h * 0.15);
    } else if (variant === 1) {
      // 星空宇航奶龙涂鸦海报
      const g = ctx.createLinearGradient(0, 0, 0, h);
      g.addColorStop(0, '#1e2752');
      g.addColorStop(1, '#44579e');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = '#ffe58f';
      for (const [sx, sy, r] of [[42, 48, 3], [210, 62, 4], [160, 38, 2.5], [70, 260, 3], [215, 220, 3]]) {
        ctx.beginPath();
        ctx.arc(sx, sy, r, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.strokeStyle = '#9cdbff';
      ctx.lineWidth = 6;
      ctx.beginPath();
      ctx.ellipse(w / 2, h * 0.48, 86, 22, -0.28, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = '#ffc94d';
      ctx.beginPath();
      ctx.arc(w / 2, h * 0.48, 48, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#ff7d54';
      ctx.beginPath();
      ctx.arc(w * 0.72, h * 0.78, 16, 0, Math.PI * 2);
      ctx.fill();
    } else {
      // 京都几何植物系插画
      ctx.fillStyle = '#e2f6f0';
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = '#ff9b7d';
      ctx.beginPath();
      ctx.arc(w * 0.5, h * 0.46, 68, Math.PI, 0);
      ctx.lineTo(w * 0.5 + 68, h * 0.86);
      ctx.lineTo(w * 0.5 - 68, h * 0.86);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#ffd166';
      ctx.beginPath();
      ctx.arc(w * 0.5, h * 0.34, 24, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#1f7a68';
      ctx.beginPath();
      ctx.ellipse(w * 0.46, h * 0.66, 24, 52, -0.25, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.ellipse(w * 0.58, h * 0.69, 20, 42, 0.35, 0, Math.PI * 2);
      ctx.fill();
    }
  });
}

function makePinboardTexture() {
  return makeCanvasTex(512, 320, (ctx, w, h) => {
    ctx.fillStyle = '#ddb07e';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = 'rgba(130, 82, 42, 0.1)';
    for (let x = 0; x < w; x += 12) {
      for (let y = 0; y < h; y += 12) {
        if ((x + y) % 24 === 0) ctx.fillRect(x, y, 3, 3);
      }
    }
    const notes = [
      [34, 34, 100, 86, '#fff394', '#e85d38'],
      [154, 48, 108, 92, '#ffd1dc', '#3178e8'],
      [286, 30, 96, 84, '#c7f2e3', '#1f9d63'],
      [398, 52, 84, 88, '#d2e9ff', '#ff6b3d'],
      [48, 154, 114, 112, '#fffdf7', '#232130'],
      [194, 174, 102, 92, '#ffe1a8', '#e85d38'],
      [326, 152, 138, 122, '#e6f6ff', '#0ea5a8'],
    ];
    // 连接小红线
    ctx.strokeStyle = 'rgba(232, 93, 56, 0.72)';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(84, 46);
    ctx.lineTo(208, 60);
    ctx.lineTo(334, 42);
    ctx.lineTo(395, 164);
    ctx.stroke();

    for (const [nx, ny, nw, nh, bg, pin] of notes) {
      ctx.fillStyle = 'rgba(35, 33, 48, 0.14)';
      ctx.fillRect(nx + 4, ny + 5, nw, nh);
      ctx.fillStyle = bg;
      ctx.fillRect(nx, ny, nw, nh);
      ctx.fillStyle = 'rgba(35, 33, 48, 0.22)';
      ctx.fillRect(nx + 12, ny + 26, nw * 0.65, 5);
      ctx.fillRect(nx + 12, ny + 40, nw * 0.48, 5);
      ctx.fillRect(nx + 12, ny + 54, nw * 0.56, 5);
      ctx.fillStyle = pin;
      ctx.beginPath();
      ctx.arc(nx + nw / 2, ny + 10, 6, 0, Math.PI * 2);
      ctx.fill();
    }
  });
}

function makeWhiteboardTexture() {
  return makeCanvasTex(640, 360, (ctx, w, h) => {
    ctx.fillStyle = '#fcfdff';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#eef4fc';
    ctx.fillRect(18, 18, w - 36, 48);
    ctx.fillStyle = '#232130';
    ctx.font = '700 22px "IBM Plex Sans", sans-serif';
    ctx.fillText('AI STUDIO KANBAN · SPRINT', 34, 50);

    const cols = [
      ['TODO', 24, '#ffd166', ['#ffe7a8', '#ffd8e4']],
      ['DOING', 224, '#ff7d54', ['#ffe0d4', '#d8f4f0']],
      ['DONE', 424, '#22b573', ['#d5f7e6', '#dceeff']],
    ];
    for (const [title, x, accent, cards] of cols) {
      ctx.fillStyle = '#f5f8fd';
      ctx.fillRect(x, 82, 190, 256);
      ctx.fillStyle = accent;
      ctx.fillRect(x, 82, 190, 10);
      ctx.fillStyle = '#232130';
      ctx.font = '700 16px "IBM Plex Mono", monospace';
      ctx.fillText(title, x + 12, 118);

      cards.forEach((bg, idx) => {
        const cy = 136 + idx * 82;
        ctx.fillStyle = bg;
        ctx.fillRect(x + 12, cy, 166, 66);
        ctx.fillStyle = 'rgba(35, 33, 48, 0.35)';
        ctx.fillRect(x + 22, cy + 18, 110, 7);
        ctx.fillStyle = 'rgba(35, 33, 48, 0.2)';
        ctx.fillRect(x + 22, cy + 34, 80, 6);
      });
    }
  });
}

function makeStudioSignTexture() {
  return makeCanvasTex(512, 128, (ctx, w, h) => {
    const g = ctx.createLinearGradient(0, 0, w, 0);
    g.addColorStop(0, '#272942');
    g.addColorStop(1, '#394168');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = '#ffb870';
    ctx.lineWidth = 6;
    ctx.strokeRect(8, 8, w - 16, h - 16);

    ctx.fillStyle = '#ff7d54';
    ctx.beginPath();
    ctx.arc(46, h / 2, 14, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#5ad4e6';
    ctx.beginPath();
    ctx.arc(w - 46, h / 2, 10, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#fff9ee';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = '700 32px "IBM Plex Mono", sans-serif';
    ctx.fillText('AI STUDIO · CREATIVE LAB', w / 2, h / 2 + 2);
  });
}

function makeClockFaceTexture() {
  return makeCanvasTex(256, 256, (ctx, w, h) => {
    ctx.fillStyle = '#fffdf8';
    ctx.fillRect(0, 0, w, h);
    const cx = w / 2;
    const cy = h / 2;
    ctx.strokeStyle = '#ff7d54';
    ctx.lineWidth = 10;
    ctx.beginPath();
    ctx.arc(cx, cy, 116, 0, Math.PI * 2);
    ctx.stroke();
    for (let i = 0; i < 12; i++) {
      const ang = (i / 12) * Math.PI * 2;
      const major = i % 3 === 0;
      ctx.strokeStyle = major ? '#ff7d54' : '#58546a';
      ctx.lineWidth = major ? 6 : 3;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(ang) * (major ? 84 : 94), cy + Math.sin(ang) * (major ? 84 : 94));
      ctx.lineTo(cx + Math.cos(ang) * 106, cy + Math.sin(ang) * 106);
      ctx.stroke();
    }
  });
}

function makeKeyboardTexture(accentHex) {
  return makeCanvasTex(256, 96, (ctx, w, h) => {
    ctx.fillStyle = '#f2eef7';
    ctx.fillRect(0, 0, w, h);
    const cols = 13;
    const rows = 4;
    const kw = (w - 20) / cols;
    const kh = (h - 16) / rows;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        let color = '#ffffff';
        if (r === 0 && c === 0) color = accentHex;
        else if (r === 2 && c === cols - 1) color = accentHex;
        else if (r === 3 && c >= 3 && c <= 8) {
          if (c > 3) continue;
          ctx.fillStyle = '#7cd7cf';
          ctx.fillRect(10 + c * kw + 1, 8 + r * kh + 1, kw * 6 - 3, kh - 3);
          continue;
        } else if (c === 0 || c === cols - 1) {
          color = '#d9dee8';
        }
        ctx.fillStyle = color;
        ctx.fillRect(10 + c * kw + 1, 8 + r * kh + 1, kw - 3, kh - 3);
      }
    }
  });
}

function makeMonitorScreenTexture(agent, status) {
  const accent = ACCENT_HEX[agent.name] ?? '#ff6b3d';
  const active = status !== '待核对';
  return makeCanvasTex(320, 200, (ctx, w, h) => {
    ctx.fillStyle = '#202642';
    ctx.fillRect(0, 0, w, h);

    if (!active) {
      // 柔和星空休眠壁纸
      const g = ctx.createLinearGradient(0, 0, 0, h);
      g.addColorStop(0, '#2a3052');
      g.addColorStop(1, '#414770');
      ctx.fillStyle = g;
      ctx.fillRect(10, 10, w - 20, h - 20);
      ctx.fillStyle = '#ffe29a';
      ctx.beginPath();
      ctx.arc(w / 2, h / 2, 16, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#343a5e';
      ctx.beginPath();
      ctx.arc(w / 2 + 6, h / 2 - 4, 14, 0, Math.PI * 2);
      ctx.fill();
      return;
    }

    ctx.fillStyle = '#293259';
    ctx.fillRect(10, 10, w - 20, h - 20);
    // 顶部彩色窗口栏
    ctx.fillStyle = '#333e6b';
    ctx.fillRect(10, 10, w - 20, 22);
    for (const [dx, col] of [[24, '#ff7b72'], [38, '#ffd166'], [52, '#3dd991']]) {
      ctx.fillStyle = col;
      ctx.beginPath();
      ctx.arc(dx, 21, 4, 0, Math.PI * 2);
      ctx.fill();
    }

    // 左侧导航栏
    ctx.fillStyle = '#242c4f';
    ctx.fillRect(10, 32, 64, h - 42);
    ctx.fillStyle = accent;
    ctx.fillRect(18, 44, 48, 8);
    ctx.fillStyle = '#7cd4ff';
    ctx.fillRect(18, 60, 40, 6);
    ctx.fillStyle = '#a5e8c6';
    ctx.fillRect(18, 74, 44, 6);

    // 代码与图表卡片
    ctx.fillStyle = accent;
    ctx.fillRect(88, 46, 118, 8);
    ctx.fillStyle = '#9be8ff';
    ctx.fillRect(88, 64, 180, 6);
    ctx.fillStyle = '#ffd685';
    ctx.fillRect(88, 78, 150, 6);
    ctx.fillStyle = '#8ef0c0';
    ctx.fillRect(88, 92, 168, 6);

    // 下方动漫波形与进度条
    ctx.fillStyle = 'rgba(255, 255, 255, 0.1)';
    ctx.fillRect(88, 114, 206, 62);
    ctx.strokeStyle = '#6ce8ff';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(98, 158);
    ctx.lineTo(138, 140);
    ctx.lineTo(176, 150);
    ctx.lineTo(222, 126);
    ctx.lineTo(278, 134);
    ctx.stroke();

    ctx.fillStyle = accent;
    ctx.fillRect(98, 166, 142, 4);
  });
}

function makeAvatarVisorTexture(agent, status) {
  const accent = ACCENT_HEX[agent.name] ?? '#6ce8ff';
  return makeCanvasTex(256, 128, (ctx, w, h) => {
    ctx.fillStyle = '#1b1d30';
    ctx.fillRect(0, 0, w, h);

    // 柔和动漫腮红
    ctx.fillStyle = 'rgba(255, 122, 140, 0.55)';
    for (const bx of [54, 202]) {
      ctx.beginPath();
      ctx.ellipse(bx, 86, 18, 9, 0, 0, Math.PI * 2);
      ctx.fill();
    }

    if (status === '待核对') {
      //  peaceful 弯月睡眼 (︶ ︶)
      ctx.strokeStyle = '#c8c6e8';
      ctx.lineWidth = 7;
      ctx.lineCap = 'round';
      for (const ex of [82, 174]) {
        ctx.beginPath();
        ctx.arc(ex, 62, 18, 0.15 * Math.PI, 0.85 * Math.PI);
        ctx.stroke();
      }
      return;
    }

    const eyeColor = status === '思考中' ? '#ffd166' : accent === '#5b527a' ? '#8ce8ff' : accent;
    for (const ex of [84, 172]) {
      ctx.fillStyle = eyeColor;
      ctx.beginPath();
      ctx.ellipse(ex, 58, 18, 22, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(ex - 6, 48, 6.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(ex + 6, 66, 3.2, 0, Math.PI * 2);
      ctx.fill();
    }

    if (status === '思考中') {
      ctx.fillStyle = '#ffe58f';
      for (let i = 0; i < 3; i++) {
        ctx.beginPath();
        ctx.arc(114 + i * 14, 96, 3.5, 0, Math.PI * 2);
        ctx.fill();
      }
    } else {
      ctx.strokeStyle = '#ffd5c2';
      ctx.lineWidth = 4.5;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.arc(128, 76, 11, 0.15 * Math.PI, 0.85 * Math.PI);
      ctx.stroke();
    }
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
  grad.addColorStop(0, 'rgba(42, 46, 72, 0.42)');
  grad.addColorStop(0.55, 'rgba(42, 46, 72, 0.14)');
  grad.addColorStop(1, 'rgba(42, 46, 72, 0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  contactShadowTex = new THREE.CanvasTexture(canvas);
  contactShadowTex.colorSpace = THREE.SRGBColorSpace;
  return contactShadowTex;
}

function getDustSpriteTexture() {
  if (steamSpriteTex) return steamSpriteTex;
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  const grad = ctx.createRadialGradient(size / 2, size / 2, 2, size / 2, size / 2, size / 2);
  grad.addColorStop(0, 'rgba(255, 252, 240, 1)');
  grad.addColorStop(0.5, 'rgba(255, 244, 214, 0.45)');
  grad.addColorStop(1, 'rgba(255, 244, 214, 0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  steamSpriteTex = new THREE.CanvasTexture(canvas);
  steamSpriteTex.colorSpace = THREE.SRGBColorSpace;
  return steamSpriteTex;
}

function makeContactShadow(w, d, opacity = 0.22) {
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

function buildAnimePlant(x, z, potColor = 0xe3845e, scale = 1.0) {
  const plant = new THREE.Group();
  plant.position.set(x, 0, z);
  plant.scale.setScalar(scale);

  const potProfile = [
    [0.01, 0.0],
    [0.17, 0.0],
    [0.24, 0.19],
    [0.225, 0.38],
    [0.19, 0.38],
    [0.19, 0.33],
  ].map(([r, y]) => new THREE.Vector2(r, y));
  const pot = new THREE.Mesh(new THREE.LatheGeometry(potProfile, 24), std(potColor, 0.62));
  pot.castShadow = true;
  plant.add(pot);

  const rim = new THREE.Mesh(new THREE.TorusGeometry(0.215, 0.022, 8, 24), std(0xfff5e6, 0.65));
  rim.rotation.x = Math.PI / 2;
  rim.position.y = 0.365;
  plant.add(rim);

  const soil = new THREE.Mesh(new THREE.CylinderGeometry(0.19, 0.19, 0.04, 16), std(0x4a382b, 0.92));
  soil.position.y = 0.32;
  plant.add(soil);

  const stemMat = std(0x3a7a4f, 0.78);
  const leafDark = std(0x2fa866, 0.62);
  const leafBright = std(0x63d471, 0.56);

  const count = 10;
  for (let i = 0; i < count; i++) {
    const yaw = (i / count) * Math.PI * 2 + (i % 2) * 0.22;
    const h = 0.42 + (i % 3) * 0.15;
    const tilt = 0.38 + (i % 3) * 0.14;
    const branch = new THREE.Group();
    branch.position.y = 0.33;
    branch.rotation.y = yaw;

    const stalk = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.018, h, 6), stemMat);
    stalk.position.set(0, h * 0.45, Math.sin(tilt) * h * 0.16);
    stalk.rotation.x = tilt * 0.65;
    branch.add(stalk);

    const blade = new THREE.Mesh(new THREE.SphereGeometry(0.145, 12, 10), i % 2 === 0 ? leafDark : leafBright);
    blade.scale.set(0.82, 0.18, 1.45);
    blade.position.set(0, h * 0.88, Math.sin(tilt) * h * 0.46 + 0.08);
    blade.rotation.x = tilt;
    blade.castShadow = true;
    branch.add(blade);
    plant.add(branch);
  }

  const sprout = new THREE.Mesh(new THREE.SphereGeometry(0.11, 12, 10), leafBright);
  sprout.position.set(0, 0.74, 0);
  sprout.scale.set(1.0, 1.25, 1.0);
  plant.add(sprout);

  const shadow = makeContactShadow(0.86, 0.86, 0.22);
  shadow.position.set(0, 0.012, 0);
  plant.add(shadow);
  return plant;
}

// ---------------------------------------------------------------------------
// 1. 动漫配色精密制图室房间与趣味陈设
// ---------------------------------------------------------------------------

function buildRoom() {
  const roomGroup = new THREE.Group();
  const cutawayMat = std(0x393c57, 0.66);
  const trimWoodMat = std(0xd99f5e, 0.62);
  const darkWoodMat = std(0x9b6b3e, 0.64);
  const wainscotMat = std(0xcbe6d9, 0.78);
  const metalMat = std(0x343850, 0.4, { metalness: 0.4 });
  const brassMat = std(0xeab556, 0.38, { metalness: 0.45 });

  // 建筑沙盘厚底座 + 柔和投影
  const plinth = new THREE.Mesh(new THREE.BoxGeometry(ROOM.w + 0.44, 0.3, ROOM.d + 0.44), cutawayMat);
  plinth.position.set(0, -0.151, 0);
  plinth.receiveShadow = true;
  roomGroup.add(plinth);

  const dioramaShadow = makeContactShadow(ROOM.w + 3.8, ROOM.d + 3.4, 0.2);
  dioramaShadow.position.set(0.35, -0.305, 0.35);
  roomGroup.add(dioramaShadow);

  // 暖蜜枫木拼接地板
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(ROOM.w, ROOM.d),
    std(0xffffff, 0.72, { map: makeOakFloorTexture() }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  roomGroup.add(floor);

  const wallMat = std(0xffffff, 0.88, { map: makeAnimeWallTexture() });
  const wallT = 0.2;

  // --- 后墙组（y=0 为缩放枢轴，转至墙后自动降为矮边） ---
  backWallGroup = new THREE.Group();
  const backWall = new THREE.Mesh(new THREE.BoxGeometry(ROOM.w + wallT, ROOM.h, wallT), wallMat);
  backWall.position.set(-wallT / 2, ROOM.h / 2, -ROOM.d / 2 - wallT / 2);
  backWall.receiveShadow = true;
  backWall.castShadow = true;
  backWallGroup.add(backWall);

  const backWainscot = new THREE.Mesh(new THREE.BoxGeometry(ROOM.w, 1.08, 0.025), wainscotMat);
  backWainscot.position.set(0, 0.54, -ROOM.d / 2 + 0.012);
  backWainscot.receiveShadow = true;
  backWallGroup.add(backWainscot);

  const backChairRail = new THREE.Mesh(new THREE.BoxGeometry(ROOM.w, 0.045, 0.045), trimWoodMat);
  backChairRail.position.set(0, 1.09, -ROOM.d / 2 + 0.02);
  backWallGroup.add(backChairRail);

  const backCap = new THREE.Mesh(new THREE.BoxGeometry(ROOM.w + wallT + 0.01, 0.045, wallT + 0.01), cutawayMat);
  backCap.position.set(-wallT / 2, ROOM.h + 0.022, -ROOM.d / 2 - wallT / 2);
  backWallGroup.add(backCap);

  const rightCutCap = new THREE.Mesh(new THREE.BoxGeometry(0.03, ROOM.h + 0.045, wallT + 0.01), cutawayMat);
  rightCutCap.position.set(ROOM.w / 2 + 0.01, ROOM.h / 2 + 0.01, -ROOM.d / 2 - wallT / 2);
  backWallGroup.add(rightCutCap);

  const backSkirt = new THREE.Mesh(new THREE.BoxGeometry(ROOM.w, 0.1, 0.03), darkWoodMat);
  backSkirt.position.set(0, 0.05, -ROOM.d / 2 + 0.015);
  backWallGroup.add(backSkirt);

  // 后墙新海诚风晴空分格窗 + 浅蓝百褶窗帘
  windowGroup = new THREE.Group();
  const winW = 4.6;
  const winH = 1.75;
  const winX = -3.2;
  const winY = 2.15;
  const winZ = -ROOM.d / 2 + 0.028;

  const skyTex = makeAnimeSkyWindowTexture();
  const winGlass = new THREE.Mesh(
    new THREE.PlaneGeometry(winW, winH),
    std(0xffffff, 0.25, { map: skyTex, emissive: 0xffffff, emissiveMap: skyTex, emissiveIntensity: 0.72 }),
  );
  winGlass.position.set(winX, winY, winZ);
  windowGroup.add(winGlass);

  for (const sy of [-winH / 2, 0.15, winH / 2]) {
    const bar = new THREE.Mesh(new THREE.BoxGeometry(winW + 0.1, 0.05, 0.06), trimWoodMat);
    bar.position.set(winX, winY + sy, winZ + 0.02);
    windowGroup.add(bar);
  }
  for (const sx of [-winW / 2, -winW / 6, winW / 6, winW / 2]) {
    const bar = new THREE.Mesh(new THREE.BoxGeometry(0.05, winH + 0.06, 0.06), trimWoodMat);
    bar.position.set(winX + sx, winY, winZ + 0.02);
    windowGroup.add(bar);
  }
  const winSill = new THREE.Mesh(new THREE.BoxGeometry(winW + 0.26, 0.045, 0.16), trimWoodMat);
  winSill.position.set(winX, winY - winH / 2 - 0.02, winZ + 0.06);
  windowGroup.add(winSill);

  const curtainMat = std(0x8ec5f7, 0.85);
  const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.016, winW + 0.65, 10), brassMat);
  rod.rotation.z = Math.PI / 2;
  rod.position.set(winX, winY + winH / 2 + 0.12, winZ + 0.09);
  windowGroup.add(rod);
  for (const side of [-1, 1]) {
    const curtain = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.2, winH + 0.18, 12), curtainMat);
    curtain.scale.set(1.0, 1.0, 0.45);
    curtain.position.set(winX + side * (winW / 2 + 0.16), winY, winZ + 0.09);
    curtain.castShadow = true;
    windowGroup.add(curtain);
  }
  backWallGroup.add(windowGroup);

  // 后墙右侧装饰（看板白板、悬空原木架、工作室发光铭牌）
  backWallDecor = new THREE.Group();
  const wbGroup = new THREE.Group();
  wbGroup.position.set(1.6, 2.02, -ROOM.d / 2 + 0.045);
  const wbFrame = new THREE.Mesh(new THREE.BoxGeometry(2.38, 1.38, 0.03), metalMat);
  wbFrame.castShadow = true;
  wbGroup.add(wbFrame);
  const wbFace = new THREE.Mesh(
    new THREE.PlaneGeometry(2.26, 1.26),
    std(0xffffff, 0.45, { map: makeWhiteboardTexture(), emissive: 0xffffff, emissiveMap: makeWhiteboardTexture(), emissiveIntensity: 0.12 }),
  );
  wbFace.position.z = 0.017;
  wbGroup.add(wbFace);
  const wbTray = new THREE.Mesh(new THREE.BoxGeometry(0.65, 0.03, 0.08), metalMat);
  wbTray.position.set(-0.6, -0.68, 0.04);
  wbGroup.add(wbTray);
  for (const [mx, col] of [[-0.75, 0xe85d38], [-0.63, 0x3178e8], [-0.51, 0x1f9d63]]) {
    const marker = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.11, 8), std(col, 0.5));
    marker.rotation.z = Math.PI / 2;
    marker.position.set(mx, -0.655, 0.045);
    wbGroup.add(marker);
  }
  backWallDecor.add(wbGroup);

  // 工作室铭牌 + 悬空置物架
  const signMesh = new THREE.Mesh(
    new THREE.BoxGeometry(1.9, 0.48, 0.035),
    std(0xffffff, 0.35, { map: makeStudioSignTexture(), emissive: 0xffffff, emissiveMap: makeStudioSignTexture(), emissiveIntensity: 0.38 }),
  );
  signMesh.position.set(4.85, 2.68, -ROOM.d / 2 + 0.04);
  backWallDecor.add(signMesh);

  const shelfRack = new THREE.Mesh(new THREE.BoxGeometry(1.85, 0.04, 0.28), trimWoodMat);
  shelfRack.position.set(4.85, 1.88, -ROOM.d / 2 + 0.16);
  shelfRack.castShadow = true;
  backWallDecor.add(shelfRack);
  for (const bx of [4.25, 5.45]) {
    const bracket = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.16, 0.22), metalMat);
    bracket.position.set(bx, 1.79, -ROOM.d / 2 + 0.13);
    backWallDecor.add(bracket);
  }
  for (const [idx, col] of [0xff7d54, 0x3b82f6, 0xffd166, 0x22b573].entries()) {
    const bk = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.24 + (idx % 2) * 0.04, 0.18), std(col, 0.6));
    bk.position.set(4.22 + idx * 0.085, 2.02, -ROOM.d / 2 + 0.16);
    backWallDecor.add(bk);
  }
  // 置物架小星星灯
  const starGlobe = new THREE.Mesh(
    new THREE.SphereGeometry(0.085, 14, 12),
    std(0xffe08a, 0.3, { emissive: 0xffc654, emissiveIntensity: 0.8 }),
  );
  starGlobe.position.set(5.4, 2.01, -ROOM.d / 2 + 0.16);
  backWallDecor.add(starGlobe);
  // 置物架小多肉
  const miniPot = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.045, 0.1, 12), std(0xf28d77, 0.65));
  miniPot.position.set(4.92, 1.95, -ROOM.d / 2 + 0.16);
  backWallDecor.add(miniPot);
  const miniCactus = new THREE.Mesh(new THREE.SphereGeometry(0.055, 10, 8), std(0x47bd72, 0.65));
  miniCactus.scale.set(0.85, 1.35, 0.85);
  miniCactus.position.set(4.92, 2.04, -ROOM.d / 2 + 0.16);
  backWallDecor.add(miniCactus);

  backWallGroup.add(backWallDecor);
  roomGroup.add(backWallGroup);

  // 倾斜温暖日光束与地板光斑 + 浮尘光点
  sunbeamGroup = new THREE.Group();
  const beamMat = new THREE.MeshBasicMaterial({
    color: 0xffefc9,
    transparent: true,
    opacity: 0.095,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
  });
  for (const offset of [-1.25, 0, 1.25]) {
    const beam = new THREE.Mesh(new THREE.PlaneGeometry(1.15, 4.4), beamMat);
    beam.position.set(winX + offset, 1.38, -ROOM.d / 2 + 1.55);
    beam.rotation.x = -0.62;
    beam.rotation.y = 0.22;
    sunbeamGroup.add(beam);
  }
  const sunPatch = new THREE.Mesh(
    new THREE.PlaneGeometry(4.4, 2.4),
    new THREE.MeshBasicMaterial({ color: 0xffe8b5, transparent: true, opacity: 0.18, depthWrite: false }),
  );
  sunPatch.rotation.x = -Math.PI / 2;
  sunPatch.position.set(winX + 0.45, 0.006, -ROOM.d / 2 + 2.25);
  sunbeamGroup.add(sunPatch);

  if (!REDUCED_MOTION) {
    const moteCount = 75;
    const rng = seededRng(505);
    const positions = new Float32Array(moteCount * 3);
    for (let i = 0; i < moteCount; i++) {
      positions[i * 3] = winX - 2.3 + rng() * 5.2;
      positions[i * 3 + 1] = 0.45 + rng() * 2.55;
      positions[i * 3 + 2] = -ROOM.d / 2 + 0.4 + rng() * 3.8;
    }
    const moteGeo = new THREE.BufferGeometry();
    moteGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const moteMat = new THREE.PointsMaterial({
      map: getDustSpriteTexture(),
      color: 0xfff5d4,
      size: 0.085,
      transparent: true,
      opacity: 0.65,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    dustMotes = new THREE.Points(moteGeo, moteMat);
    dustMotes.userData.baseY = Float32Array.from({ length: moteCount }, (_, idx) => positions[idx * 3 + 1]);
    sunbeamGroup.add(dustMotes);
  }
  roomGroup.add(sunbeamGroup);

  // --- 左墙组（挂画、软木灵感板与走时挂钟） ---
  leftWallGroup = new THREE.Group();
  const leftWall = new THREE.Mesh(new THREE.BoxGeometry(wallT, ROOM.h, ROOM.d), wallMat);
  leftWall.position.set(-ROOM.w / 2 - wallT / 2, ROOM.h / 2, 0);
  leftWall.receiveShadow = true;
  leftWall.castShadow = true;
  leftWallGroup.add(leftWall);

  const leftWainscot = new THREE.Mesh(new THREE.BoxGeometry(0.025, 1.08, ROOM.d), wainscotMat);
  leftWainscot.position.set(-ROOM.w / 2 + 0.012, 0.54, 0);
  leftWainscot.receiveShadow = true;
  leftWallGroup.add(leftWainscot);

  const leftChairRail = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.045, ROOM.d), trimWoodMat);
  leftChairRail.position.set(-ROOM.w / 2 + 0.02, 1.09, 0);
  leftWallGroup.add(leftChairRail);

  const leftCap = new THREE.Mesh(new THREE.BoxGeometry(wallT + 0.01, 0.045, ROOM.d + 0.01), cutawayMat);
  leftCap.position.set(-ROOM.w / 2 - wallT / 2, ROOM.h + 0.022, 0);
  leftWallGroup.add(leftCap);

  const frontCutCap = new THREE.Mesh(new THREE.BoxGeometry(wallT + 0.01, 0.03 + ROOM.h + 0.015, 0.03), cutawayMat);
  frontCutCap.position.set(-ROOM.w / 2 - wallT / 2, ROOM.h / 2 + 0.01, ROOM.d / 2 + 0.01);
  leftWallGroup.add(frontCutCap);

  const leftSkirt = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.1, ROOM.d), darkWoodMat);
  leftSkirt.position.set(-ROOM.w / 2 + 0.015, 0.05, 0);
  leftWallGroup.add(leftSkirt);

  leftWallDecor = new THREE.Group();
  const lwX = -ROOM.w / 2 + 0.035;

  // 3 幅动漫装裱海报
  const posterZ = [-3.05, -2.15, -1.25];
  for (let i = 0; i < 3; i++) {
    const frame = new THREE.Group();
    frame.position.set(lwX, 2.08, posterZ[i]);
    frame.rotation.y = Math.PI / 2;
    const outer = new THREE.Mesh(new THREE.BoxGeometry(0.68, 0.88, 0.03), trimWoodMat);
    outer.castShadow = true;
    frame.add(outer);
    const art = new THREE.Mesh(
      new THREE.PlaneGeometry(0.58, 0.78),
      std(0xffffff, 0.5, { map: makePosterTexture(i) }),
    );
    art.position.z = 0.017;
    frame.add(art);
    leftWallDecor.add(frame);
  }

  // 软木便签灵感板
  const pinGroup = new THREE.Group();
  pinGroup.position.set(lwX, 2.06, 0.02);
  pinGroup.rotation.y = Math.PI / 2;
  const pinFrame = new THREE.Mesh(new THREE.BoxGeometry(1.36, 0.86, 0.03), trimWoodMat);
  pinFrame.castShadow = true;
  pinGroup.add(pinFrame);
  const corkFace = new THREE.Mesh(
    new THREE.PlaneGeometry(1.26, 0.76),
    std(0xffffff, 0.85, { map: makePinboardTexture() }),
  );
  corkFace.position.z = 0.017;
  pinGroup.add(corkFace);
  leftWallDecor.add(pinGroup);

  // 实时走动圆形动漫挂钟
  const clockGroup = new THREE.Group();
  clockGroup.position.set(lwX, 2.68, 1.8);
  clockGroup.rotation.y = Math.PI / 2;
  const clockBody = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.32, 0.04, 28), trimWoodMat);
  clockBody.rotation.x = Math.PI / 2;
  clockBody.castShadow = true;
  clockGroup.add(clockBody);
  const clockFace = new THREE.Mesh(
    new THREE.CircleGeometry(0.29, 28),
    std(0xffffff, 0.55, { map: makeClockFaceTexture() }),
  );
  clockFace.position.z = 0.022;
  clockGroup.add(clockFace);

  function makeHand(len, width, color, zOff) {
    const pivot = new THREE.Group();
    pivot.position.z = zOff;
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, len, 0.008), std(color, 0.4));
    mesh.position.y = len * 0.42;
    pivot.add(mesh);
    clockGroup.add(pivot);
    return pivot;
  }
  const hourHand = makeHand(0.14, 0.02, 0x232130, 0.028);
  const minHand = makeHand(0.2, 0.014, 0x3b82f6, 0.032);
  const secHand = makeHand(0.23, 0.007, 0xff6b3d, 0.036);
  const centerPin = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.015, 12), std(0xff6b3d, 0.4));
  centerPin.rotation.x = Math.PI / 2;
  centerPin.position.z = 0.038;
  clockGroup.add(centerPin);
  wallClockHands = { hourHand, minHand, secHand };
  leftWallDecor.add(clockGroup);

  leftWallGroup.add(leftWallDecor);
  roomGroup.add(leftWallGroup);

  // Zone A 双岛彩边圆形编织地毯
  const rug = new THREE.Mesh(
    new THREE.CircleGeometry(3.25, 64),
    std(0xffffff, 0.94, { map: makeZoneARugTexture() }),
  );
  rug.rotation.x = -Math.PI / 2;
  rug.position.set(-3.2, 0.008, -2.8);
  rug.receiveShadow = true;
  roomGroup.add(rug);

  // Zone B OpenAI 双工位区青柠细格地垫
  const zoneBMat = new THREE.Mesh(
    new THREE.PlaneGeometry(5.1, 2.7),
    std(0xffffff, 0.9, { map: makeZoneBRugTexture() }),
  );
  zoneBMat.rotation.x = -Math.PI / 2;
  zoneBMat.position.set(3.75, 0.009, -2.4);
  zoneBMat.receiveShadow = true;
  roomGroup.add(zoneBMat);

  // Zone C — 访客长凳 + 彩色坐垫
  const benchGroup = new THREE.Group();
  benchGroup.position.set(0, 0, 2.42);
  const benchSeat = new THREE.Mesh(new THREE.BoxGeometry(4.8, 0.055, 0.52), trimWoodMat);
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
  for (const [cx, ccol] of [[-1.9, 0xf7b296], [1.9, 0xb8b1e6]]) {
    const pad = new THREE.Mesh(new THREE.BoxGeometry(0.74, 0.055, 0.44), std(ccol, 0.88));
    pad.position.set(cx, 0.465, 0);
    pad.castShadow = true;
    benchGroup.add(pad);
  }
  const benchShadow = makeContactShadow(5.1, 0.92, 0.22);
  benchShadow.position.set(0, 0.012, 0);
  benchGroup.add(benchShadow);
  roomGroup.add(benchGroup);

  // 左墙多彩漫画与设定集书架 + 垂吊常春藤
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
  const bookColors = [0xff6b3d, 0x3b82f6, 0x22b573, 0xffd166, 0xe879a8, 0x0ea5a8, 0xf9a86b];
  // 中下层丰富书本
  for (let i = 0; i < 11; i++) {
    const h = 0.21 + (i % 4) * 0.032;
    const w = 0.052 + (i % 2) * 0.014;
    const book = new THREE.Mesh(new THREE.BoxGeometry(0.26, h, w), std(bookColors[i % bookColors.length], 0.65));
    const zPos = -0.68 + i * 0.078;
    book.position.set(0.02, 0.8 + h / 2, zPos);
    if (i === 10) book.rotation.x = 0.22;
    book.castShadow = true;
    shelfGroup.add(book);
  }
  for (let i = 0; i < 6; i++) {
    const h = 0.22 + (i % 3) * 0.03;
    const book = new THREE.Mesh(new THREE.BoxGeometry(0.25, h, 0.062), std(bookColors[(i + 3) % bookColors.length], 0.65));
    book.position.set(0.02, 1.4 + h / 2, -0.62 + i * 0.085);
    book.castShadow = true;
    shelfGroup.add(book);
  }
  // 底层彩色收纳盒
  for (const [bz, col] of [[-0.42, 0x86d8cc], [0.42, 0xffcaa6]]) {
    const bin = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.26, 0.56), std(col, 0.78));
    bin.position.set(0.01, 0.33, bz);
    bin.castShadow = true;
    shelfGroup.add(bin);
  }
  // 小奖杯 + 顶层绿萝垂藤
  const trophy = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.035, 0.16, 12), brassMat);
  trophy.position.set(0.02, 1.48, 0.48);
  shelfGroup.add(trophy);
  const topPot = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.09, 0.16, 14), std(0xfff5e6, 0.6));
  topPot.position.set(0.02, 2.08, -0.45);
  shelfGroup.add(topPot);
  for (let i = 0; i < 7; i++) {
    const leaf = new THREE.Mesh(new THREE.SphereGeometry(0.065, 10, 8), std(i % 2 === 0 ? 0x3ec473 : 0x72df82, 0.58));
    leaf.scale.set(0.7, 0.3, 1.2);
    leaf.position.set(0.14 + (i % 2) * 0.06, 2.12 - i * 0.065, -0.42 + (i - 3) * 0.075);
    shelfGroup.add(leaf);
  }

  const shelfShadow = makeContactShadow(0.8, 2.2, 0.22);
  shelfShadow.position.set(0.05, 0.012, 0);
  shelfGroup.add(shelfShadow);
  roomGroup.add(shelfGroup);

  // 前左侧温馨小咖啡推车
  const cartGroup = new THREE.Group();
  cartGroup.position.set(-6.05, 0, 3.85);
  cartGroup.rotation.y = 0.28;
  for (const [cy, ch] of [[0.14, 0.03], [0.5, 0.03], [0.84, 0.035]]) {
    const tier = new THREE.Mesh(new THREE.BoxGeometry(0.86, ch, 0.5), trimWoodMat);
    tier.position.y = cy;
    tier.castShadow = true;
    cartGroup.add(tier);
  }
  for (const cx of [-0.38, 0.38]) {
    for (const cz of [-0.21, 0.21]) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.016, 0.8, 8), metalMat);
      post.position.set(cx, 0.44, cz);
      cartGroup.add(post);
      const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.025, 12), metalMat);
      wheel.rotation.z = Math.PI / 2;
      wheel.position.set(cx, 0.035, cz);
      cartGroup.add(wheel);
    }
  }
  // 薄荷绿意式咖啡机
  const espresso = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.3, 0.28), std(0x63d0c4, 0.42));
  espresso.position.set(-0.2, 1.0, -0.04);
  espresso.castShadow = true;
  cartGroup.add(espresso);
  const espressoHead = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.06, 0.12), std(0xeef2f7, 0.35, { metalness: 0.4 }));
  espressoHead.position.set(-0.2, 1.08, 0.09);
  cartGroup.add(espressoHead);
  // 叠放马卡龙色马克杯与小点心盘
  for (const [idx, col] of [0xff7d54, 0xffd166].entries()) {
    const cmug = new THREE.Mesh(new THREE.CylinderGeometry(0.042, 0.038, 0.085, 14), std(col, 0.45));
    cmug.position.set(0.18 + idx * 0.11, 0.9, 0.06);
    cartGroup.add(cmug);
  }
  const pastryPlate = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.08, 0.018, 16), std(0xfffdf8, 0.45));
  pastryPlate.position.set(0.22, 0.525, 0);
  cartGroup.add(pastryPlate);
  const cakeSlice = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.07, 4), std(0xffc96b, 0.72));
  cakeSlice.position.set(0.22, 0.565, 0);
  cartGroup.add(cakeSlice);
  const cartShadow = makeContactShadow(1.05, 0.72, 0.2);
  cartShadow.position.set(0, 0.012, 0);
  cartGroup.add(cartShadow);
  roomGroup.add(cartGroup);

  // 右侧治愈系休闲区（暖珊瑚编织地毯 + 晴空蓝布艺沙发 + 抱枕毛毯 + 拱形暖光落地灯 + 茶歇茶几，中间留出 0.88m 通行走廊）
  const loungeRug = new THREE.Mesh(
    new THREE.PlaneGeometry(3.0, 3.1),
    std(0xffffff, 0.92, { map: makeLoungeRugTexture() }),
  );
  loungeRug.rotation.x = -Math.PI / 2;
  loungeRug.position.set(5.3, 0.0085, 1.92);
  loungeRug.receiveShadow = true;
  roomGroup.add(loungeRug);

  const sofaGroup = new THREE.Group();
  sofaGroup.position.set(5.4, 0, 2.65);
  const sofaMat = std(0x5a87ab, 0.88);
  const cushionMat = std(0x739fc2, 0.85);
  for (const sx of [-0.88, 0.88]) {
    for (const sz of [-0.34, 0.34]) {
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.018, 0.14, 10), trimWoodMat);
      leg.position.set(sx, 0.07, sz);
      sofaGroup.add(leg);
    }
  }
  const sofaBase = new THREE.Mesh(new THREE.BoxGeometry(2.05, 0.22, 0.88), sofaMat);
  sofaBase.position.set(0, 0.25, 0);
  sofaBase.castShadow = true;
  sofaGroup.add(sofaBase);
  for (const sx of [-0.47, 0.47]) {
    const seatPad = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.13, 0.78), cushionMat);
    seatPad.position.set(sx, 0.425, -0.02);
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
  // 亮黄与樱花粉抱枕 + 搭在扶手上的奶油色小毯子
  for (const [px, pz, ry, rz, col] of [
    [-0.64, 0.16, 0.24, -0.18, 0xf4c542],
    [0.64, 0.15, -0.22, 0.2, 0xff8b82],
  ]) {
    const pillow = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.28, 0.11), std(col, 0.85));
    pillow.position.set(px, 0.62, pz);
    pillow.rotation.set(-0.24, ry, rz);
    pillow.castShadow = true;
    sofaGroup.add(pillow);
  }
  const throwBlanket = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.32, 0.52), std(0xfff1dc, 0.9));
  throwBlanket.position.set(-0.95, 0.51, -0.12);
  throwBlanket.rotation.z = 0.08;
  sofaGroup.add(throwBlanket);
  const sofaShadow = makeContactShadow(2.45, 1.3, 0.24);
  sofaShadow.position.set(0, 0.012, 0);
  sofaGroup.add(sofaShadow);
  roomGroup.add(sofaGroup);

  // 拱形钓鱼落地暖光灯
  const floorLamp = new THREE.Group();
  floorLamp.position.set(6.55, 0, 3.1);
  const lampBase = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.22, 0.04, 20), brassMat);
  lampBase.position.y = 0.02;
  floorLamp.add(lampBase);
  const arcCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, 0.04, 0),
    new THREE.Vector3(0, 1.5, 0),
    new THREE.Vector3(-0.18, 2.15, -0.18),
    new THREE.Vector3(-0.52, 2.02, -0.42),
  ]);
  const arcPole = new THREE.Mesh(new THREE.TubeGeometry(arcCurve, 20, 0.016, 8, false), brassMat);
  arcPole.castShadow = true;
  floorLamp.add(arcPole);
  const shadeMat = std(0xffe6ba, 0.45, { emissive: 0xffc66e, emissiveIntensity: 0.72, side: THREE.DoubleSide });
  const floorShade = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.2, 0.24, 18, 1, true), shadeMat);
  floorShade.position.set(-0.52, 1.9, -0.42);
  floorLamp.add(floorShade);
  const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.055, 12, 10), std(0xfff7dc, 0.2, { emissive: 0xffdf8c, emissiveIntensity: 1.0 }));
  bulb.position.set(-0.52, 1.88, -0.42);
  floorLamp.add(bulb);
  roomGroup.add(floorLamp);

  // 胡桃原木茶几 + 陶瓷茶壶/茶杯/摊开的画册
  const tableGroup = new THREE.Group();
  tableGroup.position.set(5.4, 0, 1.05);
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
  const teapot = new THREE.Mesh(new THREE.SphereGeometry(0.07, 14, 12), std(0x6ad4c8, 0.42));
  teapot.scale.set(1.0, 0.82, 1.0);
  teapot.position.set(-0.22, 0.41, 0.02);
  tableGroup.add(teapot);
  for (const [cx, cz] of [[-0.04, -0.06], [-0.02, 0.12]]) {
    const cup = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.025, 0.05, 12), std(0xfff8ee, 0.42));
    cup.position.set(cx, 0.385, cz);
    tableGroup.add(cup);
  }
  const artbook = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.022, 0.2), std(0xff9b7d, 0.68));
  artbook.position.set(0.28, 0.372, 0.04);
  artbook.rotation.y = 0.25;
  tableGroup.add(artbook);
  const tableShadow = makeContactShadow(1.35, 0.85, 0.2);
  tableShadow.position.set(0, 0.012, 0);
  tableGroup.add(tableShadow);
  roomGroup.add(tableGroup);

  // 三盆繁茂多叶动漫风室内绿植
  roomGroup.add(buildAnimePlant(-6.45, -4.45, 0xe3845e, 1.05));
  roomGroup.add(buildAnimePlant(6.55, -4.45, 0x5ab8ac, 1.0));
  roomGroup.add(buildAnimePlant(6.55, 4.15, 0xf2b554, 0.92));

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

  const showBackDecor = backWallGroup.scale.y > 0.35;
  if (windowGroup) windowGroup.visible = showBackDecor;
  if (backWallDecor) backWallDecor.visible = showBackDecor;
  if (sunbeamGroup) sunbeamGroup.visible = showBackDecor;
  if (leftWallDecor) leftWallDecor.visible = leftWallGroup.scale.y > 0.35;
}

// ---------------------------------------------------------------------------
// 2. 灵动动漫风 AI 伙伴形象 & 细节丰富的工位桌面
// ---------------------------------------------------------------------------

function buildAvatar(agent, status) {
  const g = new THREE.Group();
  const accent = new THREE.Color(ACCENTS[agent.name] ?? 0x8a869c);
  const hoodieMat = std(accent, 0.52);
  const creamMat = std(0xfff9f0, 0.45);
  const trimMat = std(0x32354a, 0.45);

  // 卫衣躯干 + 奶油色领圈 + 识别环
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.25, 0.42, 8, 20), hoodieMat);
  body.position.y = 0.62;
  body.castShadow = true;
  g.add(body);

  const collar = new THREE.Mesh(new THREE.TorusGeometry(0.215, 0.032, 10, 24), creamMat);
  collar.rotation.x = Math.PI / 2;
  collar.position.y = 0.94;
  g.add(collar);

  const chestPatch = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.06, 0.02), creamMat);
  chestPatch.position.set(0.1, 0.72, 0.245);
  g.add(chestPatch);

  // 奶油色圆润动漫小脑袋（总高度严格 <= 1.48m，确保头顶引线完美衔接）
  const headGroup = new THREE.Group();
  headGroup.position.set(0, 1.21, 0);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.255, 24, 18), creamMat);
  head.castShadow = true;
  headGroup.add(head);

  // 灵动发光电子表情面罩朝向 +Z（桌面方向）
  const visorTex = makeAvatarVisorTexture(agent, status);
  const visor = new THREE.Mesh(
    new THREE.SphereGeometry(0.264, 24, 18, Math.PI / 2 - 0.76, 1.52, 1.02, 1.0),
    std(0x1f2235, 0.18, {
      map: visorTex,
      emissive: 0xffffff,
      emissiveMap: visorTex,
      emissiveIntensity: status === '待核对' ? 0.35 : 0.75,
      metalness: 0.25,
    }),
  );
  headGroup.add(visor);

  // 耳机侧盖（随角色色彩点缀）
  const earCupMat = std(accent, 0.38, { metalness: 0.25 });
  for (const sx of [-0.255, 0.255]) {
    const ear = new THREE.Mesh(new THREE.CylinderGeometry(0.068, 0.068, 0.032, 16), earCupMat);
    ear.rotation.z = Math.PI / 2;
    ear.position.set(sx, 0, 0);
    headGroup.add(ear);
    const pad = new THREE.Mesh(new THREE.CylinderGeometry(0.052, 0.052, 0.042, 16), trimMat);
    pad.rotation.z = Math.PI / 2;
    pad.position.set(sx * 0.96, 0, 0);
    headGroup.add(pad);
  }
  const headband = new THREE.Mesh(new THREE.TorusGeometry(0.26, 0.016, 8, 28, Math.PI), trimMat);
  headGroup.add(headband);
  g.add(headGroup);

  // 向前打字/思考的小手臂
  function makeArm(side) {
    const armPivot = new THREE.Group();
    armPivot.position.set(side * 0.255, 0.82, 0.04);
    const sleeve = new THREE.Mesh(new THREE.CapsuleGeometry(0.062, 0.16, 6, 12), hoodieMat);
    sleeve.rotation.x = Math.PI / 2.8;
    sleeve.position.set(0, -0.05, 0.1);
    sleeve.castShadow = true;
    armPivot.add(sleeve);
    const hand = new THREE.Mesh(new THREE.SphereGeometry(0.058, 12, 10), creamMat);
    hand.position.set(0, -0.09, 0.22);
    armPivot.add(hand);
    g.add(armPivot);
    return armPivot;
  }
  const leftArm = makeArm(1);
  const rightArm = makeArm(-1);

  // 思考中工位头侧浮动发光小灵感球
  let ideaOrb = null;
  if (status === '思考中') {
    ideaOrb = new THREE.Mesh(
      new THREE.OctahedronGeometry(0.065, 0),
      std(0xffd166, 0.25, { emissive: 0xffbe3b, emissiveIntensity: 0.9 }),
    );
    ideaOrb.position.set(0.32, 1.42, 0.12);
    g.add(ideaOrb);
  }

  return { group: g, head: headGroup, body, leftArm, rightArm, ideaOrb };
}

function addSteamPuff(x, y, z, phase) {
  const mat = new THREE.SpriteMaterial({
    map: getDustSpriteTexture(),
    color: 0xffffff,
    transparent: true,
    opacity: 0.35,
    depthWrite: false,
  });
  const sprite = new THREE.Sprite(mat);
  sprite.position.set(x, y, z);
  sprite.scale.set(0.06, 0.06, 0.06);
  steamPuffs.push({ sprite, originX: x, originY: y, originZ: z, phase, speed: 0.55 + (phase % 0.3) });
  return sprite;
}

function buildDesk(agent) {
  const { x, z, rotY = 0, zone } = LAYOUT[agent.id];
  const g = new THREE.Group();
  g.position.set(x, 0, z);
  g.rotation.y = rotY;

  const oakMat = std(0xe6bc82, 0.6);
  const frameMat = std(0x33364a, 0.45, { metalness: 0.3 });
  const alumMat = std(0xe2e6ee, 0.32, { metalness: 0.55 });
  const accentHex = ACCENT_HEX[agent.name] ?? '#ff6b3d';
  const accentColor = ACCENTS[agent.name] ?? 0xff6b3d;

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

  const deskShadow = makeContactShadow(2.05, 1.25, 0.22);
  deskShadow.position.set(0, 0.012, 0);
  g.add(deskShadow);

  // 角色主题色桌垫 + 彩色机械键盘 + 鼠标
  const matColor = new THREE.Color(accentColor).lerp(new THREE.Color(0xffffff), 0.72);
  const deskMat = new THREE.Mesh(new THREE.BoxGeometry(0.84, 0.008, 0.38), std(matColor, 0.86));
  deskMat.position.set(0, 0.772, 0.06);
  g.add(deskMat);

  const keyboard = new THREE.Mesh(
    new THREE.BoxGeometry(0.46, 0.018, 0.16),
    std(0xffffff, 0.42, { map: makeKeyboardTexture(accentHex) }),
  );
  keyboard.position.set(-0.07, 0.785, 0.05);
  g.add(keyboard);

  const mouse = new THREE.Mesh(new THREE.BoxGeometry(0.068, 0.024, 0.105), std(0xfffaf2, 0.35));
  mouse.position.set(0.28, 0.786, 0.06);
  g.add(mouse);

  // 动漫风格高亮显示器 + 边角便签条
  const snap = SNAPSHOT[agent.id];
  const monitor = new THREE.Mesh(new THREE.BoxGeometry(0.76, 0.45, 0.03), frameMat);
  monitor.position.set(0, 1.07, -0.22);
  monitor.castShadow = true;
  g.add(monitor);

  const screenTex = makeMonitorScreenTexture(agent, snap.status);
  const screenPlane = new THREE.Mesh(
    new THREE.PlaneGeometry(0.71, 0.405),
    std(0xffffff, 0.3, {
      map: screenTex,
      emissive: 0xffffff,
      emissiveMap: screenTex,
      emissiveIntensity: snap.status === '待核对' ? 0.24 : 0.68,
    }),
  );
  screenPlane.position.set(0, 1.07, -0.204);
  g.add(screenPlane);

  const sticky = new THREE.Mesh(new THREE.PlaneGeometry(0.065, 0.065), std(0xffe177, 0.7));
  sticky.position.set(0.32, 0.875, -0.203);
  sticky.rotation.z = -0.08;
  g.add(sticky);

  const stand = new THREE.Mesh(new THREE.BoxGeometry(0.065, 0.25, 0.045), alumMat);
  stand.position.set(0, 0.88, -0.23);
  g.add(stand);

  // 已验证工位：配色彩色台灯 + 热咖啡马克杯与蒸汽 + 彩色笔筒
  if (agent.status === 'verified') {
    const lampBase = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.08, 0.02, 16), std(accentColor, 0.48));
    lampBase.position.set(-0.65, 0.778, -0.22);
    g.add(lampBase);
    const lampArm = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.34, 8), alumMat);
    lampArm.position.set(-0.65, 0.94, -0.22);
    lampArm.rotation.z = -0.18;
    g.add(lampArm);
    const lampHead = new THREE.Mesh(new THREE.CylinderGeometry(0.048, 0.062, 0.12, 14), std(accentColor, 0.45));
    lampHead.position.set(-0.59, 1.09, -0.19);
    lampHead.rotation.x = Math.PI / 3;
    lampHead.rotation.z = -0.3;
    g.add(lampHead);
    const bulbGlow = new THREE.Mesh(
      new THREE.SphereGeometry(0.036, 10, 8),
      std(0xfff4cf, 0.2, { emissive: 0xffd578, emissiveIntensity: 0.95 }),
    );
    bulbGlow.position.set(-0.58, 1.05, -0.17);
    g.add(bulbGlow);
  }

  // 陶瓷热咖啡杯（工作/思考中的工位冒柔和热气）
  const mug = new THREE.Mesh(new THREE.CylinderGeometry(0.044, 0.038, 0.09, 14), std(0xfffdf8, 0.42));
  mug.position.set(0.5, 0.812, -0.05);
  mug.castShadow = true;
  g.add(mug);
  const coffee = new THREE.Mesh(new THREE.CircleGeometry(0.037, 12), std(0x6b4426, 0.35));
  coffee.rotation.x = -Math.PI / 2;
  coffee.position.set(0.5, 0.858, -0.05);
  g.add(coffee);
  if (snap.status !== '待核对' && !REDUCED_MOTION) {
    g.add(addSteamPuff(0.5, 0.88, -0.05, agent.id * 1.3));
    g.add(addSteamPuff(0.5, 0.93, -0.05, agent.id * 1.3 + 1.9));
  }

  // 右侧彩色笔筒 + 叠放笔记本 + 迷你多肉盆栽
  const penCup = new THREE.Mesh(new THREE.CylinderGeometry(0.042, 0.04, 0.1, 12), std(0xffc966, 0.55));
  penCup.position.set(0.68, 0.818, -0.18);
  g.add(penCup);
  for (const [ox, oz, rz, col] of [[-0.015, 0, 0.14, 0xff6b3d], [0.012, 0.01, -0.12, 0x3b82f6], [0, -0.014, 0.04, 0x22b573]]) {
    const pencil = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.15, 6), std(col, 0.6));
    pencil.position.set(0.68 + ox, 0.87, -0.18 + oz);
    pencil.rotation.z = rz;
    g.add(pencil);
  }

  const nb1 = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.022, 0.26), std(0x88d4f7, 0.72));
  nb1.position.set(-0.56, 0.779, 0.14);
  nb1.rotation.y = 0.12;
  g.add(nb1);
  const nb2 = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.018, 0.23), std(0xffb4a2, 0.72));
  nb2.position.set(-0.55, 0.799, 0.13);
  nb2.rotation.y = -0.08;
  g.add(nb2);

  if (agent.id % 2 === 1) {
    const dPot = new THREE.Mesh(new THREE.CylinderGeometry(0.048, 0.038, 0.075, 12), std(0xe88b68, 0.62));
    dPot.position.set(-0.46, 0.805, -0.24);
    g.add(dPot);
    const dSucc = new THREE.Mesh(new THREE.DodecahedronGeometry(0.048, 0), std(0x52cc7a, 0.6));
    dSucc.position.set(-0.46, 0.86, -0.24);
    g.add(dSucc);
  }

  // 桌牌：严格保持单层 1024x384（比例 8:3 -> 0.96m x 0.36m），斜嵌在胡桃木底座上
  const defaultModel = state.selectedModels[agent.id] ?? agent.defaultModel;
  const tex = makeDeskPlateTexture(agent, defaultModel, accentHex);
  tex.anisotropy = Math.min(16, renderer.capabilities.getMaxAnisotropy());
  const plateGroup = new THREE.Group();
  plateGroup.position.set(0, 0.74, 0.435);
  plateGroup.rotation.x = -0.2;

  const plateBacking = new THREE.Mesh(new THREE.BoxGeometry(0.98, 0.38, 0.018), std(0x9b6b3e, 0.6));
  plateBacking.position.z = -0.009;
  plateBacking.castShadow = true;
  plateGroup.add(plateBacking);

  const plate = new THREE.Mesh(
    new THREE.PlaneGeometry(0.96, 0.36),
    std(0xffffff, 0.8, { map: tex }),
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
    std(statusColor, 0.3, { emissive: statusColor, emissiveIntensity: 0.65 }),
  );
  dot.position.set(0.68, 0.79, 0.28);
  g.add(dot);

  // 灵动形象 + 工学座椅（Zone C 使用带靠垫共享长凳，Zone A/B 使用带靠背彩色转椅）
  const rig = buildAvatar(agent, snap.status);
  rig.group.position.set(0, 0, -0.78);
  g.add(rig.group);
  avatarRigs.push({
    ...rig,
    baseY: 0,
    phase: agent.id * 1.15,
    status: snap.status,
  });

  if (zone !== 'C') {
    const chairCol = new THREE.Color(accentColor).lerp(new THREE.Color(0xffffff), 0.35);
    const chairSeat = new THREE.Mesh(new THREE.BoxGeometry(0.48, 0.06, 0.46), std(chairCol, 0.78));
    chairSeat.position.set(0, 0.42, -0.78);
    chairSeat.castShadow = true;
    g.add(chairSeat);
    const chairBack = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.34, 0.055), std(chairCol, 0.78));
    chairBack.position.set(0, 0.62, -1.0);
    chairBack.rotation.x = -0.1;
    chairBack.castShadow = true;
    g.add(chairBack);
    const chairStem = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.38, 10), frameMat);
    chairStem.position.set(0, 0.21, -0.78);
    g.add(chairStem);
    const chairBase = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.24, 0.025, 16), frameMat);
    chairBase.position.set(0, 0.015, -0.78);
    g.add(chairBase);
    const chairShadow = makeContactShadow(0.78, 0.78, 0.2);
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

  // 点击拾取：桌面 + 显示器 + 桌牌 + 角色躯干/头部
  for (const m of [top, monitor, screenPlane, plate, rig.body, rig.head.children[0]]) {
    m.userData.agentId = agent.id;
    pickables.push(m);
  }
  scene.add(g);
  return g;
}

// ---------------------------------------------------------------------------
// 3. 最近 3 条对话管理 + 新开对话 + 本地/云端桥接状态
// ---------------------------------------------------------------------------

function loadSavedThreadStore() {
  try {
    const raw = localStorage.getItem(STORAGE_THREADS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function saveThreadStore() {
  const persistable = {};
  for (const agent of state.config.agents) {
    const entry = state.conversations[agent.id];
    if (!entry) continue;
    // 只持久化本地模拟记录，真实桥接会话由 ~/.codex 和 Antigravity DB 维护。
    const localOnly = entry.recent.filter((c) => c.source !== 'bridge').slice(0, 3);
    if (localOnly.length > 0) {
      persistable[agent.id] = localOnly;
    }
  }
  try {
    localStorage.setItem(STORAGE_THREADS_KEY, JSON.stringify(persistable));
  } catch {
    // 忽略私密模式写入限制
  }
}

function initConversations() {
  const saved = loadSavedThreadStore();
  for (const agent of state.config.agents) {
    const custom = Array.isArray(saved[agent.id]) ? saved[agent.id] : [];
    const seeds = DEFAULT_RECENT_THREADS[agent.id] || [];
    const merged = [...custom];
    for (const s of seeds) {
      if (merged.length >= 3) break;
      if (!merged.some((item) => item.id === s.id)) {
        merged.push(JSON.parse(JSON.stringify(s)));
      }
    }
    state.conversations[agent.id] = {
      recent: merged.slice(0, 3),
      activeId: merged[0]?.id ?? null,
    };
  }
}

function getAgentRecent(agentId) {
  return state.conversations[agentId]?.recent || [];
}

function getActiveConversation(agentId) {
  const entry = state.conversations[agentId];
  if (!entry || !entry.activeId) return null;
  return entry.recent.find((c) => c.id === entry.activeId) || null;
}

function formatNowShort() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function makeShortTitle(text, fallback = '新对话') {
  const cleaned = String(text || '').replace(/\s+/g, ' ').trim();
  if (!cleaned) return fallback;
  return cleaned.length > 26 ? `${cleaned.slice(0, 25)}…` : cleaned;
}

function upsertRecentThread(agentId, thread) {
  const entry = state.conversations[agentId] || { recent: [], activeId: null };
  const filtered = entry.recent.filter((c) => c.id !== thread.id);
  filtered.unshift(thread);
  entry.recent = filtered.slice(0, 3);
  entry.activeId = thread.id;
  state.conversations[agentId] = entry;
  if (thread.source !== 'bridge') {
    saveThreadStore();
  }
}

function modePillClass(mode) {
  if (mode === 'local') return 'local';
  if (mode === 'cloud') return 'cloud';
  return 'record';
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

  // 1. 工位列表
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

    if (agent.bridge === 'antigravity-cli' && state.antigravityBridge.connected) {
      const agBadge = document.createElement('span');
      agBadge.className = 'zone-tag agy-tag';
      agBadge.textContent = '双模';
      agBadge.title = '支持本地工作区与云端对话';
      left.appendChild(agBadge);
    } else if (agent.bridge === 'codex-cli' && state.codexBridge.connected) {
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
      fill.style.background = ACCENT_HEX[agent.name] ?? '#1f9d63';
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
    dot.style.background = '#e88422';
    const nameEl = document.createElement('span');
    nameEl.className = 'agent-name';
    nameEl.textContent = '老板 · 宇航员奶龙';
    const zoneBadge = document.createElement('span');
    zoneBadge.className = 'zone-tag boss-tag';
    zoneBadge.textContent = 'BOSS';
    left.append(dot, nameEl, zoneBadge);

    const modeTag = document.createElement('span');
    modeTag.className = 'agent-model-tag';
    modeTag.id = 'boss-drawer-mode';
    modeTag.textContent = boss.isPaused() ? '已暂停' : boss.isSitting() ? '休息中' : '巡查中';
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
      chip.addEventListener('click', () => startNewConversation(agent.id));
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
  document.getElementById('inspector-dot').style.background = '#e88422';
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
    ['角色定位', '工作室老板', null],
    ['巡逻节奏', '沙发休息 ↔ 全区轮巡', null],
    ['当前状态', boss.isPaused() ? '已暂停' : boss.isSitting() ? '沙发小憩中' : '慢步巡查中', 'boss-inspector-mode'],
    ['跟拍视角', state.followBoss ? '已开启跟随' : '自由视角', null],
  ];
  for (const [k, v, id] of specs) {
    const cell = document.createElement('div');
    cell.className = 'spec-cell';
    const label = document.createElement('div');
    label.className = 'spec-k';
    label.textContent = k;
    const val = document.createElement('div');
    val.className = 'spec-v';
    if (id) val.id = id;
    val.textContent = v;
    cell.append(label, val);
    grid.appendChild(cell);
  }
  body.appendChild(grid);

  const actions = document.createElement('div');
  actions.className = 'inspector-actions';

  const sitBtn = document.createElement('button');
  sitBtn.type = 'button';
  sitBtn.id = 'boss-sit-btn';
  sitBtn.textContent = boss.isSitting() ? '起来巡查' : '去沙发歇会';
  sitBtn.addEventListener('click', () => {
    if (boss.isSitting()) boss.startPatrol();
    else boss.goSit();
    renderDrawer();
    openBossInspector();
  });

  const followBtn = document.createElement('button');
  followBtn.type = 'button';
  followBtn.className = 'secondary';
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
  pauseBtn.textContent = boss.isPaused() ? '继续' : '暂停';
  pauseBtn.addEventListener('click', () => {
    boss.togglePause();
    renderDrawer();
    openBossInspector();
  });

  actions.append(sitBtn, followBtn, pauseBtn);
  body.appendChild(actions);
  document.getElementById('inspector').hidden = false;
}

function getAgentConnectionLabel(agent) {
  if (agent.bridge === 'antigravity-cli') {
    return state.antigravityBridge.connected ? '本机桌面端 · 本地/云端实连' : '离线快照（需 server.py）';
  }
  if (agent.bridge === 'codex-cli') {
    return state.codexBridge.connected
      ? `本机 Codex CLI（${state.codexBridge.cliVersion || '已连'}）`
      : '离线快照（需 server.py）';
  }
  if (agent.surface === 'Web') {
    return `${agent.lastVerifiedAt ? `${agent.lastVerifiedAt} 验证` : '未验证'} · 网页版`;
  }
  return agent.lastVerifiedAt ? `${agent.lastVerifiedAt} 验证` : '未验证';
}

function openInspector(agentId) {
  state.inspectingBoss = false;
  const agent = state.config.agents.find((a) => a.id === agentId);
  if (!agent) return;
  const snap = SNAPSHOT[agentId];
  const model = state.selectedModels[agentId] ?? agent.defaultModel;

  document.getElementById('inspector-dot').style.background = ACCENT_HEX[agent.name] ?? '#8a869c';
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
    fill.style.background = ACCENT_HEX[agent.name] ?? '#1f9d63';
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
      agent.bridge ? '连接方式' : agent.surface === 'Web' ? '核对 · 入口' : '核对日期',
      getAgentConnectionLabel(agent),
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

  // 最近 3 条对话选择区（所有 6 个系列统一支持）
  const recent = getAgentRecent(agentId);
  const activeId = state.conversations[agentId]?.activeId;
  const recentSection = document.createElement('div');
  recentSection.className = 'recent-section';
  const recentHead = document.createElement('div');
  recentHead.className = 'recent-head';
  const rTitle = document.createElement('span');
  rTitle.textContent = `最近对话（${recent.length}）`;
  const rHint = document.createElement('span');
  rHint.textContent = '点击续聊 / 新开';
  recentHead.append(rTitle, rHint);
  recentSection.appendChild(recentHead);

  const recentList = document.createElement('div');
  recentList.className = 'recent-list';
  for (const conv of recent) {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'recent-item';
    if (conv.id === activeId) item.classList.add('active');

    const titleDiv = document.createElement('div');
    titleDiv.className = 'recent-item-title';
    titleDiv.textContent = conv.title;

    const metaDiv = document.createElement('div');
    metaDiv.className = 'recent-item-meta';
    const pill = document.createElement('span');
    pill.className = `mode-pill ${modePillClass(conv.mode)}`;
    pill.textContent = conv.active ? `${conv.modeLabel} · 运行中` : (conv.modeLabel || '记录');
    const timeEl = document.createElement('span');
    timeEl.textContent = conv.time || '最近';
    metaDiv.append(pill, timeEl);

    item.append(titleDiv, metaDiv);
    item.addEventListener('click', () => selectRecentConversation(agentId, conv.id));
    recentList.appendChild(item);
  }
  recentSection.appendChild(recentList);
  body.appendChild(recentSection);

  const actions = document.createElement('div');
  actions.className = 'inspector-actions';
  const chatBtn = document.createElement('button');
  chatBtn.type = 'button';
  chatBtn.id = 'inspector-chat';
  chatBtn.textContent = '+ 新开对话';
  chatBtn.addEventListener('click', () => startNewConversation(agentId));

  const continueBtn = document.createElement('button');
  continueBtn.type = 'button';
  continueBtn.className = 'secondary';
  continueBtn.id = 'inspector-custom';
  continueBtn.textContent = recent.length > 0 ? '继续最近' : '自定义输入';
  continueBtn.addEventListener('click', () => {
    if (recent.length > 0) {
      selectRecentConversation(agentId, recent[0].id);
    } else {
      startNewConversation(agentId);
    }
  });

  actions.append(chatBtn, continueBtn);
  body.appendChild(actions);
  document.getElementById('inspector').hidden = false;
}

// ---------------------------------------------------------------------------
// 4. 对话与自然语言指令解析
// ---------------------------------------------------------------------------

function escapeRegExp(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function parseDialogueInput(text) {
  let remaining = text;
  let model = null;
  let modelAgentId = null;

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
    .replace(/^(?:(?:[让请帮]+|[对跟给](?=\s))[\s]*)+/, '')
    .replace(/^(?:使用|用)(?:\s+|$)/, '')
    .replace(/(?:^|\s)(?:使用|用)\s*$/g, '')
    .replace(/\s+/g, ' ')
    .replace(/^[：:、，,\s]+/, '')
    .trim();

  return { agentId, model, topic };
}

function getLiveTag(agent) {
  if (!agent) return '';
  if (agent.bridge === 'antigravity-cli' && state.antigravityBridge.connected) {
    return state.agMode === 'cloud' ? '（本机 CLI · 云端对话）' : '（本机 CLI · 本地工作区）';
  }
  if (agent.bridge === 'codex-cli' && state.codexBridge.connected) {
    return '（本机 CLI 实连）';
  }
  return '';
}

function renderDialogueHeader(agentId) {
  const agent = state.config.agents.find((a) => a.id === agentId);
  const activeConv = getActiveConversation(agentId);
  const prefix = activeConv ? '最近对话' : '新对话';
  document.getElementById('dialogue-title').textContent = agent
    ? `${prefix} · ${agent.name}${getLiveTag(agent)}`
    : '新对话';

  const modeSwitch = document.getElementById('dialogue-mode-switch');
  if (modeSwitch) {
    modeSwitch.hidden = !agent || agent.bridge !== 'antigravity-cli';
    modeSwitch.querySelectorAll('.mode-switch-btn').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.agyMode === state.agMode);
    });
  }
}

function renderDialogueThreads(agentId) {
  const bar = document.getElementById('dialogue-threads');
  if (!bar) return;
  bar.replaceChildren();

  const recent = getAgentRecent(agentId);
  const activeId = state.conversations[agentId]?.activeId ?? null;

  const newBtn = document.createElement('button');
  newBtn.type = 'button';
  newBtn.id = 'dialogue-new-btn';
  newBtn.className = 'thread-pill new-btn';
  if (activeId === null) newBtn.classList.add('active');
  newBtn.textContent = '+ 新对话';
  newBtn.addEventListener('click', () => startNewConversation(agentId));
  bar.appendChild(newBtn);

  for (const conv of recent) {
    const pill = document.createElement('button');
    pill.type = 'button';
    pill.className = 'thread-pill';
    if (conv.id === activeId) pill.classList.add('active');
    pill.title = `${conv.title}（${conv.modeLabel || '记录'} · ${conv.time || '最近'}）`;

    if (conv.mode === 'local' || conv.mode === 'cloud') {
      const tag = document.createElement('span');
      tag.className = 'thread-mode-tag';
      tag.textContent = conv.mode === 'cloud' ? '云端' : '本地';
      pill.appendChild(tag);
    }

    const txt = document.createElement('span');
    txt.className = 'thread-pill-text';
    txt.textContent = conv.title;
    pill.appendChild(txt);
    pill.addEventListener('click', () => selectRecentConversation(agentId, conv.id));
    bar.appendChild(pill);
  }
}

function appendMessageElement(log, msg) {
  const div = document.createElement('div');
  if (msg.role === 'user') {
    div.className = 'msg user';
    div.textContent = msg.text;
  } else {
    div.className = 'msg';
    const nameBold = document.createElement('b');
    nameBold.textContent = msg.author || '助手：';
    const bodyDiv = document.createElement('div');
    bodyDiv.className = 'msg-body';
    bodyDiv.textContent = msg.text;
    div.append(nameBold, bodyDiv);
    if (msg.meta) {
      const simSpan = document.createElement('span');
      simSpan.className = 'sim';
      simSpan.textContent = msg.meta;
      div.appendChild(simSpan);
    }
  }
  log.appendChild(div);
}

function renderDialogueLog(agentId) {
  const log = document.getElementById('dialogue-log');
  log.replaceChildren();
  const conv = getActiveConversation(agentId);
  if (!conv) return;

  const agent = state.config.agents.find((a) => a.id === agentId);
  if (conv.loading) {
    const loadingMsg = document.createElement('div');
    loadingMsg.className = 'msg loading';
    loadingMsg.textContent = '正在读取本机历史记录…';
    log.appendChild(loadingMsg);
    return;
  }

  const msgs = conv.messages || [];
  if (msgs.length === 0) {
    const emptyNote = document.createElement('div');
    emptyNote.className = 'msg loading';
    emptyNote.textContent = `已切换到「${conv.title}」，直接在下方输入继续对话。`;
    log.appendChild(emptyNote);
    return;
  }

  for (const m of msgs) {
    appendMessageElement(log, {
      ...m,
      author: m.role === 'assistant' ? `${agent?.name || '助手'}：` : undefined,
      meta: m.role === 'assistant' ? (m.meta || `${conv.modeLabel || '记录'} · ${conv.time || ''}`.trim()) : undefined,
    });
  }
  log.scrollTop = log.scrollHeight;
}

async function selectRecentConversation(agentId, convId) {
  state.currentAgent = agentId;
  state.inspectingBoss = false;
  const entry = state.conversations[agentId];
  if (!entry) return;

  entry.activeId = convId;
  const conv = entry.recent.find((c) => c.id === convId);
  if (!conv) return;

  if (agentId === 5 && (conv.mode === 'local' || conv.mode === 'cloud')) {
    state.agMode = conv.mode;
  }
  state.currentTopic = conv.title || '';

  const agent = state.config.agents.find((a) => a.id === agentId);
  renderDialogueHeader(agentId);
  renderDialogueThreads(agentId);
  document.getElementById('dialogue').hidden = false;
  updateDock();
  renderDrawer();
  if (!document.getElementById('inspector').hidden) {
    openInspector(agentId);
  }

  if (conv.source === 'bridge' && conv.messages === undefined && agent?.bridge) {
    conv.loading = true;
    renderDialogueLog(agentId);
    const endpoint = agent.bridge === 'antigravity-cli'
      ? `./api/antigravity/history?id=${encodeURIComponent(convId)}`
      : `./api/codex/history?id=${encodeURIComponent(convId)}`;
    try {
      const res = await fetch(endpoint);
      const data = res.ok ? await res.json() : { messages: [] };
      conv.messages = Array.isArray(data.messages) ? data.messages : [];
    } catch {
      conv.messages = [];
    } finally {
      conv.loading = false;
    }
  }

  if (state.conversations[agentId]?.activeId === convId && state.currentAgent === agentId) {
    renderDialogueLog(agentId);
  }
}

function startNewConversation(agentId) {
  state.currentAgent = agentId;
  state.inspectingBoss = false;
  state.currentTopic = '';
  if (agentId === 5) {
    state.agMode = 'local';
  }
  if (state.conversations[agentId]) {
    state.conversations[agentId].activeId = null;
  }
  renderDialogueHeader(agentId);
  renderDialogueThreads(agentId);
  renderDialogueLog(agentId);
  document.getElementById('dialogue').hidden = false;
  updateDock();
  renderDrawer();
  if (!document.getElementById('inspector').hidden) {
    openInspector(agentId);
  }
  document.getElementById('dialogue-input').focus();
}

function openDialogue(agentId, topic) {
  state.currentAgent = agentId;
  state.currentTopic = topic;
  state.inspectingBoss = false;
  renderDialogueHeader(agentId);
  renderDialogueThreads(agentId);
  renderDialogueLog(agentId);
  document.getElementById('dialogue').hidden = false;
  updateDock();
  renderDrawer();
}

async function sendDialogue() {
  const input = document.getElementById('dialogue-input');
  const sendBtn = document.getElementById('dialogue-send');
  const text = input.value.trim();
  const isBusy = state.codexBridge.busy || state.antigravityBridge.busy;
  if (!text || isBusy) return;

  const parsed = parseDialogueInput(text);
  const targetId = parsed.agentId ?? state.currentAgent ?? 5;
  state.currentAgent = targetId;
  if (parsed.model) {
    state.selectedModels[targetId] = parsed.model;
    updateAgentModelVisuals(targetId, parsed.model);
  }
  if (parsed.topic) state.currentTopic = parsed.topic;

  const agent = state.config.agents.find((a) => a.id === targetId);
  const model = parsed.model ?? (agent ? (state.selectedModels[agent.id] ?? agent.defaultModel) : null);
  const promptText = parsed.topic || text;
  const activeConv = getActiveConversation(targetId);
  const activeConvId = activeConv?.source === 'bridge' ? activeConv.id : null;

  const log = document.getElementById('dialogue-log');
  // 清除无历史记录提示条
  if (log.children.length === 1 && log.firstElementChild?.classList.contains('loading')) {
    log.replaceChildren();
  }
  appendMessageElement(log, { role: 'user', text });

  input.value = '';
  renderDialogueHeader(targetId);
  renderDialogueThreads(targetId);
  updateDock();
  renderDrawer();

  const isLiveAgy = agent?.bridge === 'antigravity-cli' && state.antigravityBridge.connected;
  const isLiveCodex = agent?.bridge === 'codex-cli' && state.codexBridge.connected;

  if (isLiveAgy || isLiveCodex) {
    if (isLiveAgy) state.antigravityBridge.busy = true;
    if (isLiveCodex) state.codexBridge.busy = true;
    sendBtn.disabled = true;
    sendBtn.textContent = '思考中…';

    const loadingMsg = document.createElement('div');
    loadingMsg.className = 'msg loading';
    loadingMsg.textContent = isLiveAgy
      ? `Antigravity（${model ?? '默认模型'} · ${state.agMode === 'cloud' ? '云端对话' : '本地工作区'}）正在处理…`
      : `Codex（${model ?? 'GPT-6.2-Sol'}）正在本机只读沙箱中处理…`;
    log.appendChild(loadingMsg);
    log.scrollTop = log.scrollHeight;

    try {
      const endpoint = isLiveAgy ? './api/antigravity/chat' : './api/codex/chat';
      const payload = isLiveAgy
        ? {
            prompt: promptText,
            model,
            mode: state.agMode,
            conversationId: activeConvId,
          }
        : {
            prompt: promptText,
            model,
            reasoning: (agent.thinkingLevel || 'high').toLowerCase(),
            conversationId: activeConvId,
          };

      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      loadingMsg.remove();

      if (res.ok && data.ok) {
        const metaText = isLiveAgy
          ? `本机 Antigravity（${data.modeLabel || '本地工作区'} · ${((data.elapsedMs || 0) / 1000).toFixed(1)}s）`
          : `本机 Codex CLI 真实回复（只读沙箱 · ${((data.elapsedMs || 0) / 1000).toFixed(1)}s）`;

        const outId = data.conversationId || activeConv?.id || `${agent.bridge}-${Date.now()}`;
        const prevMsgs = Array.isArray(activeConv?.messages) ? activeConv.messages : [];
        const updatedMsgs = [
          ...prevMsgs,
          { role: 'user', text },
          { role: 'assistant', text: data.reply, meta: metaText },
        ];
        upsertRecentThread(targetId, {
          id: outId,
          title: activeConv?.title || makeShortTitle(promptText),
          time: formatNowShort(),
          mode: isLiveAgy ? (data.mode || state.agMode) : 'local',
          modeLabel: isLiveAgy ? (data.modeLabel || '本地工作区') : '本地 CLI',
          source: 'bridge',
          active: false,
          messages: updatedMsgs,
        });

        appendMessageElement(log, {
          role: 'assistant',
          author: `${agent.name}（${data.model || model || 'CLI'}）：`,
          text: data.reply,
          meta: metaText,
        });
      } else {
        appendMessageElement(log, {
          role: 'assistant',
          author: `${agent.name}：`,
          text: data.error || `请求失败（HTTP ${res.status}）`,
          meta: isLiveAgy
            ? '调用本机 Antigravity CLI 未成功，请检查模型或选择空闲对话。'
            : '调用本机 Codex CLI 未成功，请检查登录或网络代理设置。',
        });
      }
    } catch (err) {
      loadingMsg.remove();
      appendMessageElement(log, {
        role: 'assistant',
        author: `${agent.name}：`,
        text: `连接本地桥接失败：${err.message}`,
      });
    } finally {
      state.antigravityBridge.busy = false;
      state.codexBridge.busy = false;
      sendBtn.disabled = false;
      sendBtn.textContent = '发送';
      renderDialogueHeader(targetId);
      renderDialogueThreads(targetId);
      if (!document.getElementById('inspector').hidden && state.currentAgent === targetId) {
        openInspector(targetId);
      }
      log.scrollTop = log.scrollHeight;
    }
    return;
  }

  // 非本地桥接（GPT 网页版、Gemini、Claude、Grok 或纯静态离线模式）
  const simReplyText = `（${model ?? '待核对'}）收到：${promptText}。`;
  const simMeta = agent?.bridge
    ? '当前未连接到 server.py（纯静态模式），使用办公室内部模拟并保存至最近对话。'
    : '办公室内部模拟回复并保存至本地最近记录（非直连网页账号实时会话）。';

  const existing = getActiveConversation(targetId);
  const prevMsgs = Array.isArray(existing?.messages) ? existing.messages : [];
  const nextId = existing?.id || `local-${targetId}-${Date.now()}`;
  const modeVal = agent?.status === 'pending' ? 'record' : 'web';
  const modeLbl = agent?.status === 'pending' ? '自定义记录' : '本地记录';

  upsertRecentThread(targetId, {
    id: nextId,
    title: existing?.title || makeShortTitle(promptText),
    time: formatNowShort(),
    mode: existing?.mode || modeVal,
    modeLabel: existing?.modeLabel || modeLbl,
    source: 'localStorage',
    messages: [
      ...prevMsgs,
      { role: 'user', text },
      { role: 'assistant', text: simReplyText, meta: simMeta },
    ],
  });

  appendMessageElement(log, {
    role: 'assistant',
    author: `${agent ? agent.name : '办公室'}：`,
    text: simReplyText,
    meta: simMeta,
  });

  renderDialogueHeader(targetId);
  renderDialogueThreads(targetId);
  if (!document.getElementById('inspector').hidden && state.currentAgent === targetId) {
    openInspector(targetId);
  }
  log.scrollTop = log.scrollHeight;
}

// ---------------------------------------------------------------------------
// 5. 视角切换 & 双本地桥接探测
// ---------------------------------------------------------------------------

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
    if (Array.isArray(data.recentConversations) && data.recentConversations.length > 0) {
      state.conversations[codexAgent.id] = {
        recent: data.recentConversations.slice(0, 3),
        activeId: data.recentConversations[0].id,
      };
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

async function loadAntigravityBridgeStatus() {
  try {
    const res = await fetch('./api/antigravity/status');
    if (!res.ok) return;
    const data = await res.json();
    if (!data || !data.connected) return;

    state.antigravityBridge = {
      connected: true,
      cliPath: data.cliPath || 'agy.exe',
      defaultModel: data.defaultModel || null,
      defaultModelSlug: data.defaultModelSlug || null,
      modelSlugs: data.modelSlugs || {},
      latestConversation: data.latestConversation || null,
      busy: false,
    };

    const agAgent = state.config.agents.find((a) => a.bridge === 'antigravity-cli' || a.name === 'Antigravity');
    if (!agAgent) return;

    if (Array.isArray(data.models) && data.models.length > 0) {
      const merged = [...agAgent.models];
      for (const cliModel of data.models) {
        if (!merged.includes(cliModel)) merged.push(cliModel);
      }
      agAgent.models = merged;
    }
    if (Array.isArray(data.recentConversations) && data.recentConversations.length > 0) {
      const recent = data.recentConversations.slice(0, 3);
      // 默认选中最新一条未运行中或首条会话，但保持 Antigravity 默认本地模式。
      const preferred = recent.find((c) => !c.active) || recent[0];
      state.conversations[agAgent.id] = {
        recent,
        activeId: preferred.id,
      };
    }
    SNAPSHOT[agAgent.id] = {
      status: '工作中',
      task: data.latestConversation
        ? `本机已连（本地/云端）· 最近 ${data.latestConversation.title}`
        : '本机已连（本地工作区 / 云端对话）',
      progress: 86,
    };
  } catch {
    // 纯静态服务下无 /api/antigravity/status 时静默降级为快照模式
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

  document.querySelectorAll('#dialogue-mode-switch .mode-switch-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const mode = btn.dataset.agyMode;
      if (mode === 'local' || mode === 'cloud') {
        state.agMode = mode;
        renderDialogueHeader(state.currentAgent ?? 5);
      }
    });
  });

  document.getElementById('dialogue-send').addEventListener('click', sendDialogue);
  document.getElementById('dialogue-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') sendDialogue();
  });

  const dockCmd = document.getElementById('dock-cmd');
  if (dockCmd) {
    dockCmd.addEventListener('click', () => {
      openDialogue(state.currentAgent ?? 5, '');
      document.getElementById('dialogue-input').focus();
    });
  }

  window.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      openDialogue(state.currentAgent ?? 5, '');
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

// ---------------------------------------------------------------------------
// 6. 主循环与动画（每帧只调用一次 clock.getDelta()）
// ---------------------------------------------------------------------------

const clock = new THREE.Clock();
let elapsed = 0;

function updateAmbientMotion() {
  if (wallClockHands) {
    const now = new Date();
    const s = now.getSeconds() + now.getMilliseconds() / 1000;
    const m = now.getMinutes() + s / 60;
    const h = (now.getHours() % 12) + m / 60;
    wallClockHands.secHand.rotation.z = -(s / 60) * Math.PI * 2;
    wallClockHands.minHand.rotation.z = -(m / 60) * Math.PI * 2;
    wallClockHands.hourHand.rotation.z = -(h / 12) * Math.PI * 2;
  }

  if (REDUCED_MOTION) return;

  for (const rig of avatarRigs) {
    if (rig.status === '工作中') {
      rig.group.position.y = rig.baseY + Math.sin(elapsed * 2.5 + rig.phase) * 0.011;
      rig.head.rotation.x = Math.sin(elapsed * 2.8 + rig.phase) * 0.04;
      rig.head.rotation.y = Math.sin(elapsed * 0.9 + rig.phase) * 0.08;
      rig.leftArm.rotation.x = Math.sin(elapsed * 10.5 + rig.phase) * 0.14;
      rig.rightArm.rotation.x = -Math.sin(elapsed * 10.5 + rig.phase) * 0.14;
    } else if (rig.status === '思考中') {
      rig.group.position.y = rig.baseY + Math.sin(elapsed * 1.6 + rig.phase) * 0.008;
      rig.head.rotation.z = Math.sin(elapsed * 1.3 + rig.phase) * 0.09;
      rig.head.rotation.x = -0.05;
      if (rig.ideaOrb) {
        rig.ideaOrb.position.y = 1.42 + Math.sin(elapsed * 2.6 + rig.phase) * 0.04;
        rig.ideaOrb.rotation.y += 0.03;
      }
    } else {
      // 待核对：平静小憩微晃
      rig.group.position.y = rig.baseY + Math.sin(elapsed * 1.1 + rig.phase) * 0.004;
      rig.head.rotation.x = 0.06 + Math.sin(elapsed * 0.9 + rig.phase) * 0.025;
    }
  }

  for (const puff of steamPuffs) {
    const cycle = ((elapsed * puff.speed + puff.phase) % 1.0);
    puff.sprite.position.y = puff.originY + cycle * 0.22;
    puff.sprite.position.x = puff.originX + Math.sin(elapsed * 2.2 + puff.phase) * 0.018;
    const scale = 0.045 + cycle * 0.065;
    puff.sprite.scale.set(scale, scale, scale);
    puff.sprite.material.opacity = (1.0 - cycle) * 0.34;
  }

  if (dustMotes) {
    const pos = dustMotes.geometry.attributes.position;
    const baseY = dustMotes.userData.baseY;
    for (let i = 0; i < pos.count; i++) {
      pos.setY(i, baseY[i] + Math.sin(elapsed * 0.7 + i * 0.6) * 0.08);
    }
    pos.needsUpdate = true;
  }
}

function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.05);
  elapsed += dt;

  updateAmbientMotion();

  if (boss) {
    boss.update(dt, elapsed);
    const statusText = boss.getStatus();
    const drawerModeText = boss.isPaused() ? '已暂停' : boss.isSitting() ? '休息中' : '巡查中';
    const drawerMode = document.getElementById('boss-drawer-mode');
    if (drawerMode && drawerMode.textContent !== drawerModeText) {
      drawerMode.textContent = drawerModeText;
    }
    const drawerStatus = document.getElementById('boss-drawer-status');
    if (drawerStatus && drawerStatus.textContent !== statusText) {
      drawerStatus.textContent = statusText;
    }
    const inspStatus = document.getElementById('boss-inspector-status');
    if (inspStatus && inspStatus.textContent !== statusText) {
      inspStatus.textContent = statusText;
    }
    const inspModeText = boss.isPaused() ? '已暂停' : boss.isSitting() ? '沙发小憩中' : '慢步巡查中';
    const inspMode = document.getElementById('boss-inspector-mode');
    if (inspMode && inspMode.textContent !== inspModeText) {
      inspMode.textContent = inspModeText;
    }
    const sitBtn = document.getElementById('boss-sit-btn');
    const sitLabel = boss.isSitting() ? '起来巡查' : '去沙发歇会';
    if (sitBtn && sitBtn.textContent !== sitLabel) {
      sitBtn.textContent = sitLabel;
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
  initConversations();
  await Promise.all([loadCodexBridgeStatus(), loadAntigravityBridgeStatus()]);
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
