import * as THREE from 'three';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';

// Zone A 头顶标签错开方案（Antigravity 2026-11-21 给出，修重叠用）：
// Antigravity 挂得更高、往左偏；Gemini 挂得更低、往右偏。
// dy 是头像顶之上的高度（米），dx 是横向偏移（米）。
export const ZONE_A_STAGGER = {
  Antigravity: { dy: 0.78, dx: -0.35, zIndex: 12 },
  Gemini: { dy: 0.42, dx: 0.35, zIndex: 11 },
};

const PLATE_W = 1024;
const PLATE_H = 384;

// 单层 1024x384 桌牌：第一行名字，第二行默认模型（待核对工位写“待核对”）。
export function makeDeskPlateTexture(agent, defaultModel) {
  const canvas = document.createElement('canvas');
  canvas.width = PLATE_W;
  canvas.height = PLATE_H;
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = '#fbf8f1';
  ctx.fillRect(0, 0, PLATE_W, PLATE_H);
  ctx.strokeStyle = '#b0703c';
  ctx.lineWidth = 10;
  ctx.strokeRect(14, 14, PLATE_W - 28, PLATE_H - 28);

  ctx.fillStyle = '#2b2620';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = '700 148px "PingFang SC", "Microsoft YaHei", sans-serif';
  ctx.fillText(agent.name, PLATE_W / 2, 138);

  ctx.fillStyle = '#6b6257';
  ctx.font = '96px "PingFang SC", "Microsoft YaHei", sans-serif';
  ctx.fillText(defaultModel || '待核对', PLATE_W / 2, 278);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// 头顶 CSS2D 标签：名字 + 默认模型两行。
export function makeHeadLabel(agent, defaultModel) {
  const div = document.createElement('div');
  div.className = 'head-label';
  const nameEl = document.createElement('div');
  nameEl.className = 'name';
  nameEl.textContent = agent.name;
  const modelEl = document.createElement('div');
  modelEl.className = 'model';
  modelEl.textContent = defaultModel || '待核对';
  div.append(nameEl, modelEl);

  const obj = new CSS2DObject(div);
  // Zone A 两个标签用不同层级，避免视觉上互相压住。
  const stagger = ZONE_A_STAGGER[agent.name];
  if (stagger) div.style.zIndex = String(stagger.zIndex);
  return obj;
}

// 标签到头像之间的短引线。
export function makeLeaderLine(from, to) {
  const geo = new THREE.BufferGeometry().setFromPoints([from, to]);
  const mat = new THREE.LineBasicMaterial({ color: 0xb0703c, transparent: true, opacity: 0.65 });
  return new THREE.Line(geo, mat);
}
