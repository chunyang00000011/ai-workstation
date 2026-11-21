import * as THREE from 'three';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';

// Zone A 头顶标签错开方案（Antigravity 2026-11-21 给出，修重叠用）：
// Antigravity 挂得更高、往左偏；Gemini 挂得更低、往右偏。
// dy 是头像顶之上的高度（米），dx 是横向偏移（米）。
export const ZONE_A_STAGGER = {
  Antigravity: { dy: 0.78, dx: -0.35, zIndex: 12 },
  Gemini: { dy: 0.42, dx: 0.35, zIndex: 11 },
};

// Zone B（OpenAI 双工位：GPT 网页版与 Codex）同样错开，避免旋转视角时头顶标签互盖。
export const ZONE_B_STAGGER = {
  'GPT 网页版': { dy: 0.68, dx: -0.15, zIndex: 9 },
  Codex: { dy: 0.42, dx: 0.15, zIndex: 8 },
};

const PLATE_W = 1024;
const PLATE_H = 384;
const FONT_STACK = '"IBM Plex Sans", "PingFang SC", "Microsoft YaHei", sans-serif';

function fitFont(ctx, text, maxWidth, startPx, minPx, weight = '') {
  for (let size = startPx; size >= minPx; size -= 4) {
    const font = `${weight ? `${weight} ` : ''}${size}px ${FONT_STACK}`;
    ctx.font = font;
    if (ctx.measureText(text).width <= maxWidth) return font;
  }
  return `${weight ? `${weight} ` : ''}${minPx}px ${FONT_STACK}`;
}

// 单层 1024x384 桌牌：动漫暖白奶油铭牌（第一行名字，第二行默认模型/待核对）。
export function makeDeskPlateTexture(agent, defaultModel, accentHex = '#ff6b3d') {
  const canvas = document.createElement('canvas');
  canvas.width = PLATE_W;
  canvas.height = PLATE_H;
  const ctx = canvas.getContext('2d');
  const innerMaxW = PLATE_W - 120;
  const modelText = defaultModel || '待核对';
  const isPending = !defaultModel;

  const bg = ctx.createLinearGradient(0, 0, 0, PLATE_H);
  bg.addColorStop(0, '#FFFDF8');
  bg.addColorStop(1, '#F7F0E4');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, PLATE_W, PLATE_H);

  ctx.strokeStyle = '#D7CDBC';
  ctx.lineWidth = 6;
  ctx.strokeRect(12, 12, PLATE_W - 24, PLATE_H - 24);

  // 顶部亮色品牌识别条（18px）
  ctx.fillStyle = isPending ? '#9E978D' : accentHex;
  ctx.fillRect(15, 15, PLATE_W - 30, 18);

  // 右上角精密状态指示点
  ctx.fillStyle = isPending ? '#9E978D' : accentHex;
  ctx.beginPath();
  ctx.arc(PLATE_W - 56, 72, 11, 0, Math.PI * 2);
  ctx.fill();

  // 第一行：工位名称
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#232130';
  ctx.font = fitFont(ctx, agent.name, innerMaxW, 136, 76, '700');
  ctx.fillText(agent.name, PLATE_W / 2, 150, innerMaxW);

  // 中间分割线
  ctx.fillStyle = 'rgba(35, 33, 48, 0.12)';
  ctx.fillRect(110, 218, PLATE_W - 220, 2);

  // 第二行：默认模型或待核对
  ctx.fillStyle = isPending ? '#8A869C' : '#58546A';
  ctx.font = fitFont(ctx, modelText, innerMaxW, 84, 36, '500');
  ctx.fillText(modelText, PLATE_W / 2, 288, innerMaxW);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// 头顶 CSS2D 标签：外层锚点由 CSS2DRenderer 控制定位，内层卡片用于防重叠微调。
export function makeHeadLabel(agent, defaultModel, statusColorHex = '#8a869c') {
  const anchor = document.createElement('div');
  anchor.className = 'head-label-anchor';

  const card = document.createElement('div');
  card.className = 'head-label';

  const topRow = document.createElement('div');
  topRow.className = 'head-label-top';

  const dot = document.createElement('span');
  dot.className = 'head-dot';
  dot.style.background = statusColorHex;

  const nameEl = document.createElement('span');
  nameEl.className = 'name';
  nameEl.textContent = agent.name;
  topRow.append(dot, nameEl);

  const modelEl = document.createElement('div');
  modelEl.className = 'model';
  modelEl.textContent = defaultModel || '待核对';

  card.append(topRow, modelEl);
  anchor.appendChild(card);

  const obj = new CSS2DObject(anchor);
  obj.userData.cardEl = card;
  obj.userData.nudgeY = 0;

  // Three.js r160 CSS2DRenderer 每帧会按 renderOrder 覆写 zIndex，因此必须设置 renderOrder。
  const stagger = ZONE_A_STAGGER[agent.name] || ZONE_B_STAGGER[agent.name];
  if (stagger) {
    obj.renderOrder = stagger.zIndex;
    anchor.style.zIndex = String(stagger.zIndex);
    card.dataset.zone = ZONE_A_STAGGER[agent.name] ? 'A' : 'B';
  }
  return obj;
}

// 老板（宇航员奶龙）巡逻头顶标签：renderOrder = 10，始终低于 Zone A（12/11）。
export function makeBossLabel(name, statusText) {
  const anchor = document.createElement('div');
  anchor.className = 'head-label-anchor';

  const card = document.createElement('div');
  card.className = 'head-label';
  card.dataset.boss = 'true';

  const topRow = document.createElement('div');
  topRow.className = 'head-label-top';

  const dot = document.createElement('span');
  dot.className = 'head-dot';
  dot.style.background = '#e88422';

  const nameEl = document.createElement('span');
  nameEl.className = 'name';
  nameEl.textContent = name;
  topRow.append(dot, nameEl);

  const modelEl = document.createElement('div');
  modelEl.className = 'model';
  modelEl.textContent = statusText;

  card.append(topRow, modelEl);
  anchor.appendChild(card);

  const obj = new CSS2DObject(anchor);
  obj.renderOrder = 10;
  obj.userData.cardEl = card;
  obj.userData.modelEl = modelEl;
  obj.userData.nudgeY = 0;
  return obj;
}

// 标签到头像之间的短引线。
export function makeLeaderLine(from, to) {
  const geo = new THREE.BufferGeometry().setFromPoints([from, to]);
  const mat = new THREE.LineBasicMaterial({ color: 0xd97348, transparent: true, opacity: 0.82 });
  return new THREE.Line(geo, mat);
}

function setCardNudge(labelObj, nudgeY) {
  if (!labelObj?.userData?.cardEl) return;
  if (labelObj.userData.nudgeY === nudgeY) return;
  labelObj.userData.nudgeY = nudgeY;
  labelObj.userData.cardEl.style.transform = nudgeY ? `translateY(${nudgeY}px)` : '';
}

// 渲染后屏幕空间防重叠兜底：默认不干预 3D 错开；仅在侧视/窄屏发生屏幕交叠时纵向拉开。
export function resolveZoneAOverlap(antiLabel, geminiLabel, pad = 8) {
  if (!antiLabel || !geminiLabel) return;
  if (antiLabel.element.style.display === 'none' || geminiLabel.element.style.display === 'none') {
    setCardNudge(antiLabel, 0);
    setCardNudge(geminiLabel, 0);
    return;
  }

  const antiCard = antiLabel.userData.cardEl;
  const geminiCard = geminiLabel.userData.cardEl;
  if (!antiCard || !geminiCard) return;

  const ra = antiCard.getBoundingClientRect();
  const rg = geminiCard.getBoundingClientRect();
  if (ra.width === 0 || ra.height === 0 || rg.width === 0 || rg.height === 0) return;

  const prevA = antiLabel.userData.nudgeY || 0;
  const prevG = geminiLabel.userData.nudgeY || 0;
  const baseATop = ra.top - prevA;
  const baseABottom = ra.bottom - prevA;
  const baseGTop = rg.top - prevG;
  const baseGBottom = rg.bottom - prevG;

  const overlapX = Math.min(ra.right, rg.right) - Math.max(ra.left, rg.left) + pad;
  const overlapY = Math.min(baseABottom, baseGBottom) - Math.max(baseATop, baseGTop) + pad;

  let nudgeA = 0;
  let nudgeG = 0;
  if (overlapX > 0 && overlapY > 0) {
    const centerA = (baseATop + baseABottom) / 2;
    const centerG = (baseGTop + baseGBottom) / 2;
    if (centerA <= centerG) {
      const needed = (baseABottom + pad) - baseGTop;
      if (needed > 0) {
        nudgeA = -Math.ceil(needed / 2);
        nudgeG = Math.ceil(needed / 2);
      }
    } else {
      const needed = (baseGBottom + pad) - baseATop;
      if (needed > 0) {
        nudgeG = -Math.ceil(needed / 2);
        nudgeA = Math.ceil(needed / 2);
      }
    }
  }

  setCardNudge(antiLabel, nudgeA);
  setCardNudge(geminiLabel, nudgeG);
}
