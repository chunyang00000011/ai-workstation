import * as THREE from 'three';

function makeBellyTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = '#f0b848';
  ctx.fillRect(0, 0, 512, 256);

  // 胸腹正中奶黄色大肚皮（Lathe 旋转 π 后 u=0.5 对齐正面 +Z）
  const grad = ctx.createRadialGradient(256, 138, 24, 256, 138, 128);
  grad.addColorStop(0, '#f9e3ad');
  grad.addColorStop(0.76, '#f6d897');
  grad.addColorStop(0.92, '#f2c464');
  grad.addColorStop(1, 'rgba(240, 184, 72, 0)');

  ctx.save();
  ctx.translate(256, 138);
  ctx.scale(1.06, 0.84);
  ctx.translate(-256, -138);
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(256, 138, 128, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  return tex;
}

function makeChestBoxTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 160;
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = '#ebe8e1';
  ctx.fillRect(0, 0, 256, 160);
  ctx.strokeStyle = '#9b968c';
  ctx.lineWidth = 6;
  ctx.strokeRect(6, 6, 244, 148);

  // 左侧小屏与按键
  ctx.fillStyle = '#2b2c30';
  ctx.fillRect(26, 48, 86, 56);
  ctx.fillStyle = '#535861';
  ctx.fillRect(34, 56, 70, 10);
  ctx.fillStyle = '#2b2c30';
  ctx.fillRect(26, 114, 42, 22);

  // 右侧焦糖橙宇航徽章 + 小星星
  ctx.fillStyle = '#c87432';
  ctx.fillRect(132, 26, 98, 66);
  ctx.fillStyle = '#f6d897';
  ctx.beginPath();
  ctx.arc(158, 59, 8, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(196, 42);
  ctx.lineTo(212, 72);
  ctx.lineTo(180, 72);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = '#3a3834';
  ctx.fillRect(156, 104, 62, 26);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function makeHoseTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 32;
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = '#eae7e0';
  ctx.fillRect(0, 0, 256, 32);
  ctx.fillStyle = '#c4beb3';
  for (let x = 0; x < 256; x += 16) {
    ctx.fillRect(x, 0, 6, 32);
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.repeat.set(22, 1);
  return tex;
}

function makeHand(oliveMat) {
  const hand = new THREE.Group();
  const palm = new THREE.Mesh(new THREE.SphereGeometry(0.068, 14, 12), oliveMat);
  palm.scale.set(1.0, 0.9, 0.72);
  hand.add(palm);
  for (let i = 0; i < 4; i++) {
    const finger = new THREE.Mesh(new THREE.CapsuleGeometry(0.017, 0.042, 4, 8), oliveMat);
    finger.position.set(-0.036 + i * 0.024, -0.066, 0.008);
    finger.rotation.z = (-0.18 + i * 0.12);
    hand.add(finger);
  }
  const thumb = new THREE.Mesh(new THREE.CapsuleGeometry(0.017, 0.035, 4, 8), oliveMat);
  thumb.position.set(0.056, -0.018, 0.018);
  thumb.rotation.z = -0.65;
  hand.add(thumb);
  return hand;
}

function makeBootFoot(whiteMat, oliveMat, metalMat) {
  const foot = new THREE.Group();
  const thigh = new THREE.Mesh(new THREE.CylinderGeometry(0.125, 0.105, 0.22, 18), stdYellow());
  thigh.position.y = -0.11;
  thigh.castShadow = true;
  foot.add(thigh);

  const bootShaft = new THREE.Mesh(new THREE.CylinderGeometry(0.115, 0.126, 0.19, 18), whiteMat);
  bootShaft.position.y = -0.28;
  bootShaft.castShadow = true;
  foot.add(bootShaft);

  const cuff = new THREE.Mesh(new THREE.TorusGeometry(0.116, 0.021, 10, 22), whiteMat);
  cuff.rotation.x = Math.PI / 2;
  cuff.position.y = -0.195;
  foot.add(cuff);

  const sole = new THREE.Mesh(new THREE.CylinderGeometry(0.125, 0.132, 0.045, 18), oliveMat);
  sole.position.set(0, -0.395, 0.02);
  sole.scale.set(1.0, 1.0, 1.25);
  sole.castShadow = true;
  foot.add(sole);

  const toeCap = new THREE.Mesh(new THREE.SphereGeometry(0.112, 16, 12), whiteMat);
  toeCap.position.set(0, -0.34, 0.045);
  toeCap.scale.set(1.0, 0.72, 1.15);
  foot.add(toeCap);

  for (const tx of [-0.052, 0, 0.052]) {
    const toe = new THREE.Mesh(new THREE.SphereGeometry(0.032, 10, 8), oliveMat);
    toe.position.set(tx, -0.392, 0.155);
    toe.scale.set(0.95, 0.72, 1.25);
    foot.add(toe);
  }
  const strap = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.022, 0.03), metalMat);
  strap.position.set(0, -0.28, 0.115);
  foot.add(strap);
  return foot;

  function stdYellow() {
    return new THREE.MeshStandardMaterial({ color: 0xefb648, roughness: 0.58, envMapIntensity: 0.42 });
  }
}

const WAYPOINTS = [
  { x: 1.35, z: -0.25, pause: 2.2, lookAt: [2.35, -2.75], text: '视察 GPT 网页版 · 方案对比加油', walkText: '巡逻中 · 前往 Codex' },
  { x: 3.9, z: -0.15, pause: 2.6, lookAt: [5.15, -2.05], text: '视察 Codex · 代码跑得稳不稳？', walkText: '巡逻中 · 前往休息区' },
  { x: 2.8, z: 1.15, pause: 0, walkText: '巡逻中 · 前往 Zone C' },
  { x: 0.0, z: 1.05, pause: 2.4, lookAt: [0.0, 2.9], text: '视察访客区 · 等你们入职', walkText: '巡逻中 · 前往 Zone A' },
  { x: -3.8, z: 0.85, pause: 0, walkText: '巡逻中 · 前往 Zone A' },
  { x: -4.9, z: -0.85, pause: 2.6, lookAt: [-4.9, -2.8], text: '视察 Antigravity · 干得不错', walkText: '巡逻中 · 前往 Gemini' },
  { x: -1.5, z: -0.85, pause: 2.6, lookAt: [-1.5, -2.8], text: '视察 Gemini · 思考进度如何？', walkText: '巡逻中 · 前往 Zone B' },
];

function lerpAngle(a, b, t) {
  let diff = ((b - a + Math.PI) % (Math.PI * 2)) - Math.PI;
  if (diff < -Math.PI) diff += Math.PI * 2;
  return a + diff * t;
}

export function createBossNailong({ std, makeContactShadow, makeBossLabel, reducedMotion = false }) {
  const root = new THREE.Group();
  root.position.set(WAYPOINTS[0].x, 0, WAYPOINTS[0].z);

  const skinMat = std(0xf2bf4e, 0.54);
  const whiteSuitMat = std(0xf1efe9, 0.6);
  const trimDarkMat = std(0x2d2b28, 0.42, { metalness: 0.25 });
  const oliveMat = std(0x6e603b, 0.72);
  const metalMat = std(0xb8b4ac, 0.32, { metalness: 0.7 });
  const mintEyeMat = std(0xa9c799, 0.35);
  const pupilMat = std(0x181a17, 0.15, { metalness: 0.2 });
  const specMat = new THREE.MeshBasicMaterial({ color: 0xffffff });

  const bodyGroup = new THREE.Group();
  root.add(bodyGroup);

  // 1. 梨形圆鼓鼓大肚皮（旋转 π 隐藏接缝于背后并令肚皮中心对齐正面 +Z）
  const bellyProfile = [
    [0.01, 0.36],
    [0.25, 0.38],
    [0.34, 0.45],
    [0.41, 0.60],
    [0.40, 0.72],
    [0.35, 0.85],
    [0.28, 0.96],
    [0.24, 1.04],
    [0.01, 1.05],
  ].map(([r, y]) => new THREE.Vector2(r, y));
  const bellyGeo = new THREE.LatheGeometry(bellyProfile, 32);
  const bellyMat = std(0xffffff, 0.56, { map: makeBellyTexture() });
  const belly = new THREE.Mesh(bellyGeo, bellyMat);
  belly.rotation.y = Math.PI;
  belly.scale.set(1.0, 1.0, 1.08);
  belly.castShadow = true;
  belly.receiveShadow = true;
  bodyGroup.add(belly);

  // 2. 屁股后方小龙尾巴
  for (const [ty, tz, r] of [[0.47, -0.34, 0.115], [0.51, -0.44, 0.082], [0.56, -0.52, 0.048]]) {
    const tailSeg = new THREE.Mesh(new THREE.SphereGeometry(r, 12, 10), skinMat);
    tailSeg.position.set(0, ty, tz);
    tailSeg.castShadow = true;
    bodyGroup.add(tailSeg);
  }

  // 3. 短款白色宇航服上衣 + 滚边下摆（露出下方奶黄圆肚皮）
  const jacketProfile = [
    [0.362, 0.81],
    [0.355, 0.88],
    [0.32, 0.98],
    [0.275, 1.06],
    [0.23, 1.09],
  ].map(([r, y]) => new THREE.Vector2(r, y));
  const jacket = new THREE.Mesh(new THREE.LatheGeometry(jacketProfile, 28), whiteSuitMat);
  jacket.scale.set(1.0, 1.0, 1.08);
  jacket.castShadow = true;
  bodyGroup.add(jacket);

  const jacketHem = new THREE.Mesh(new THREE.TorusGeometry(0.352, 0.032, 10, 28), whiteSuitMat);
  jacketHem.rotation.x = Math.PI / 2;
  jacketHem.scale.set(1.0, 1.08, 1.0);
  jacketHem.position.y = 0.815;
  bodyGroup.add(jacketHem);

  // 肩带与胸前控制盒
  for (const sx of [-0.145, 0.145]) {
    const strap = new THREE.Mesh(new THREE.BoxGeometry(0.055, 0.24, 0.035), whiteSuitMat);
    strap.position.set(sx, 0.96, 0.275);
    strap.rotation.x = -0.22;
    bodyGroup.add(strap);
    const buckle = new THREE.Mesh(new THREE.BoxGeometry(0.062, 0.03, 0.042), trimDarkMat);
    buckle.position.set(sx, 0.91, 0.295);
    bodyGroup.add(buckle);
  }

  const chestBox = new THREE.Mesh(new THREE.BoxGeometry(0.27, 0.16, 0.08), whiteSuitMat);
  chestBox.position.set(0, 0.935, 0.335);
  chestBox.rotation.x = -0.06;
  chestBox.castShadow = true;
  bodyGroup.add(chestBox);

  const chestFront = new THREE.Mesh(
    new THREE.PlaneGeometry(0.255, 0.148),
    std(0xffffff, 0.55, { map: makeChestBoxTexture() }),
  );
  chestFront.position.set(0, 0.938, 0.377);
  chestFront.rotation.x = -0.06;
  bodyGroup.add(chestFront);

  const chestKnob = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.02, 0.025, 12), trimDarkMat);
  chestKnob.position.set(-0.085, 1.02, 0.33);
  bodyGroup.add(chestKnob);

  // 4. 两侧对称罗纹宇航生命支持软管（绕圆肚皮腰侧连回背包）
  const hoseMat = std(0xffffff, 0.65, { map: makeHoseTexture() });
  for (const side of [-1, 1]) {
    const curve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(side * 0.125, 0.90, 0.33),
      new THREE.Vector3(side * 0.365, 0.78, 0.22),
      new THREE.Vector3(side * 0.415, 0.68, -0.02),
      new THREE.Vector3(side * 0.34, 0.72, -0.24),
      new THREE.Vector3(side * 0.15, 0.84, -0.29),
    ]);
    const hose = new THREE.Mesh(new THREE.TubeGeometry(curve, 24, 0.028, 10, false), hoseMat);
    hose.castShadow = true;
    bodyGroup.add(hose);
  }

  // 5. 后背 PLSS 背包 + 左侧（面向观众右侧）氧气瓶与银色天线
  const pack = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.42, 0.17), whiteSuitMat);
  pack.position.set(0, 0.97, -0.31);
  pack.castShadow = true;
  bodyGroup.add(pack);

  for (let i = 0; i < 3; i++) {
    const vent = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.015, 0.02), trimDarkMat);
    vent.position.set(-0.08, 1.08 - i * 0.035, -0.395);
    bodyGroup.add(vent);
  }

  const oxyTank = new THREE.Mesh(new THREE.CapsuleGeometry(0.055, 0.24, 8, 16), whiteSuitMat);
  oxyTank.position.set(0.23, 0.91, -0.31);
  oxyTank.castShadow = true;
  bodyGroup.add(oxyTank);
  for (const by of [0.82, 0.99]) {
    const band = new THREE.Mesh(new THREE.CylinderGeometry(0.058, 0.058, 0.025, 16), trimDarkMat);
    band.position.set(0.23, by, -0.31);
    bodyGroup.add(band);
  }
  const valve = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.028, 0.04, 12), metalMat);
  valve.position.set(0.23, 1.09, -0.31);
  bodyGroup.add(valve);

  const antPole = new THREE.Mesh(new THREE.CylinderGeometry(0.007, 0.01, 0.24, 8), metalMat);
  antPole.position.set(0.16, 1.29, -0.34);
  bodyGroup.add(antPole);
  const antTip = new THREE.Mesh(new THREE.SphereGeometry(0.014, 10, 8), metalMat);
  antTip.position.set(0.16, 1.41, -0.34);
  bodyGroup.add(antTip);

  // 6. 奶龙圆润黄脑袋、水汪汪淡绿大眼与微笑嘴
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.235, 26, 20), skinMat);
  head.position.set(0, 1.295, 0.036);
  head.scale.set(1.03, 1.04, 0.98);
  head.castShadow = true;
  bodyGroup.add(head);

  for (const side of [-1, 1]) {
    const eyeGroup = new THREE.Group();
    eyeGroup.position.set(side * 0.096, 1.335, 0.22);
    eyeGroup.rotation.y = side * 0.3;
    const iris = new THREE.Mesh(new THREE.SphereGeometry(0.048, 16, 12), mintEyeMat);
    iris.scale.set(1.0, 1.05, 0.55);
    eyeGroup.add(iris);
    const pupil = new THREE.Mesh(new THREE.SphereGeometry(0.032, 14, 10), pupilMat);
    pupil.position.z = 0.016;
    pupil.scale.set(1.0, 1.05, 0.55);
    eyeGroup.add(pupil);
    const spec = new THREE.Mesh(new THREE.SphereGeometry(0.01, 8, 8), specMat);
    spec.position.set(-0.011, 0.013, 0.032);
    eyeGroup.add(spec);
    bodyGroup.add(eyeGroup);
  }

  const mouth = new THREE.Mesh(new THREE.CapsuleGeometry(0.008, 0.05, 4, 8), trimDarkMat);
  mouth.rotation.z = Math.PI / 2;
  mouth.position.set(0, 1.242, 0.251);
  bodyGroup.add(mouth);

  // 7. 开放式白宇航头盔 + 领圈 + 耳机侧盖 + 透明玻璃面罩穹顶
  const collar = new THREE.Mesh(new THREE.TorusGeometry(0.245, 0.044, 14, 32), whiteSuitMat);
  collar.rotation.x = Math.PI / 2;
  collar.position.y = 1.095;
  collar.castShadow = true;
  bodyGroup.add(collar);

  const helmetShell = new THREE.Mesh(
    new THREE.SphereGeometry(0.315, 32, 24, 0, Math.PI * 2, 0.78, Math.PI - 1.04),
    whiteSuitMat,
  );
  helmetShell.rotation.x = Math.PI / 2;
  helmetShell.position.set(0, 1.31, 0.01);
  helmetShell.castShadow = true;
  bodyGroup.add(helmetShell);

  const visorRim = new THREE.Mesh(new THREE.TorusGeometry(0.222, 0.024, 12, 36), whiteSuitMat);
  visorRim.position.set(0, 1.31, 0.225);
  bodyGroup.add(visorRim);

  for (const side of [-1, 1]) {
    const earPod = new THREE.Mesh(new THREE.CylinderGeometry(0.072, 0.072, 0.044, 18), whiteSuitMat);
    earPod.rotation.z = Math.PI / 2;
    earPod.position.set(side * 0.31, 1.31, 0.01);
    bodyGroup.add(earPod);
    const earRing = new THREE.Mesh(new THREE.TorusGeometry(0.056, 0.008, 8, 20), trimDarkMat);
    earRing.rotation.y = Math.PI / 2;
    earRing.position.set(side * 0.333, 1.31, 0.01);
    bodyGroup.add(earRing);
  }

  const glassDome = new THREE.Mesh(
    new THREE.SphereGeometry(0.292, 28, 20),
    new THREE.MeshPhysicalMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.22,
      roughness: 0.06,
      metalness: 0.08,
      clearcoat: 1.0,
      clearcoatRoughness: 0.04,
      envMapIntensity: 0.85,
      depthWrite: false,
    }),
  );
  glassDome.position.set(0, 1.31, 0.045);
  bodyGroup.add(glassDome);

  // 8. 双臂：右臂（-X）可挥手问好，左臂（+X）优雅扶着圆肚皮
  const waveArm = new THREE.Group();
  waveArm.position.set(-0.295, 1.01, 0.02);
  const waveSleeve = new THREE.Mesh(new THREE.CapsuleGeometry(0.084, 0.22, 6, 14), whiteSuitMat);
  waveSleeve.position.y = -0.14;
  waveSleeve.castShadow = true;
  waveArm.add(waveSleeve);
  const waveCuff = new THREE.Mesh(new THREE.CylinderGeometry(0.078, 0.078, 0.032, 14), trimDarkMat);
  waveCuff.position.y = -0.26;
  waveArm.add(waveCuff);
  const waveHand = makeHand(oliveMat);
  waveHand.position.y = -0.32;
  waveArm.add(waveHand);
  bodyGroup.add(waveArm);

  const bellyArm = new THREE.Group();
  bellyArm.position.set(0.295, 1.01, 0.02);
  bellyArm.rotation.set(-0.46, 0, -0.36);
  const bellySleeve = new THREE.Mesh(new THREE.CapsuleGeometry(0.084, 0.22, 6, 14), whiteSuitMat);
  bellySleeve.position.y = -0.14;
  bellySleeve.castShadow = true;
  bellyArm.add(bellySleeve);
  const bellyCuff = new THREE.Mesh(new THREE.CylinderGeometry(0.078, 0.078, 0.032, 14), trimDarkMat);
  bellyCuff.position.y = -0.26;
  bellyArm.add(bellyCuff);
  const bellyHand = makeHand(oliveMat);
  bellyHand.position.y = -0.32;
  bellyHand.rotation.z = -0.3;
  bellyArm.add(bellyHand);
  bodyGroup.add(bellyArm);

  // 9. 短腿与白宇航靴
  const leftLeg = makeBootFoot(whiteSuitMat, oliveMat, metalMat);
  leftLeg.position.set(0.175, 0.42, 0.01);
  root.add(leftLeg);

  const rightLeg = makeBootFoot(whiteSuitMat, oliveMat, metalMat);
  rightLeg.position.set(-0.175, 0.42, 0.01);
  root.add(rightLeg);

  // 底部接触阴影 + 头顶巡逻状态标签
  const shadow = makeContactShadow(1.22, 1.22, 0.28);
  shadow.position.set(0, 0.015, 0);
  root.add(shadow);

  const label = makeBossLabel('老板 · 宇航员奶龙', WAYPOINTS[0].text);
  label.position.set(0, 2.04, 0);
  root.add(label);

  // 拾取标记
  const pickables = [];
  root.traverse((obj) => {
    if (obj.isMesh && obj !== shadow && obj !== glassDome) {
      obj.userData.boss = true;
      pickables.push(obj);
    }
  });

  // 巡逻状态机
  const patrol = {
    idx: 0,
    pauseTimer: WAYPOINTS[0].pause,
    paused: false,
    walkPhase: 0,
    statusText: WAYPOINTS[0].text,
  };

  function setStatusText(text) {
    if (patrol.statusText === text) return;
    patrol.statusText = text;
    if (label.userData.modelEl) label.userData.modelEl.textContent = text;
  }

  // 初始朝向第一个停靠目标
  if (WAYPOINTS[0].lookAt) {
    const [lx, lz] = WAYPOINTS[0].lookAt;
    root.rotation.y = Math.atan2(lx - root.position.x, lz - root.position.z);
  }
  waveArm.rotation.z = -2.25;

  function update(dt, elapsed) {
    if (reducedMotion) {
      waveArm.rotation.set(0, 0, -2.25);
      return;
    }

    if (patrol.paused) {
      setStatusText('巡逻已暂停 · 原地待命');
      leftLeg.rotation.x *= 0.85;
      rightLeg.rotation.x *= 0.85;
      bodyGroup.position.y *= 0.85;
      bodyGroup.rotation.z *= 0.85;
      waveArm.rotation.x = THREE.MathUtils.lerp(waveArm.rotation.x, 0, 0.12);
      waveArm.rotation.z = THREE.MathUtils.lerp(waveArm.rotation.z, -2.25 + Math.sin(elapsed * 4.5) * 0.14, 0.12);
      return;
    }

    const wp = WAYPOINTS[patrol.idx];
    if (patrol.pauseTimer > 0) {
      patrol.pauseTimer -= dt;
      setStatusText(wp.text || '巡逻停靠中');
      if (wp.lookAt) {
        const targetYaw = Math.atan2(wp.lookAt[0] - root.position.x, wp.lookAt[1] - root.position.z);
        root.rotation.y = lerpAngle(root.rotation.y, targetYaw, Math.min(1, dt * 5.5));
      }
      leftLeg.rotation.x = THREE.MathUtils.lerp(leftLeg.rotation.x, 0, 0.15);
      rightLeg.rotation.x = THREE.MathUtils.lerp(rightLeg.rotation.x, 0, 0.15);
      bodyGroup.position.y = THREE.MathUtils.lerp(bodyGroup.position.y, Math.sin(elapsed * 2.4) * 0.01, 0.15);
      bodyGroup.rotation.z = THREE.MathUtils.lerp(bodyGroup.rotation.z, 0, 0.15);
      waveArm.rotation.x = THREE.MathUtils.lerp(waveArm.rotation.x, 0, 0.15);
      waveArm.rotation.z = THREE.MathUtils.lerp(
        waveArm.rotation.z,
        -2.25 + Math.sin(elapsed * 7.2) * 0.24,
        0.18,
      );
      if (patrol.pauseTimer <= 0) {
        patrol.idx = (patrol.idx + 1) % WAYPOINTS.length;
      }
      return;
    }

    // 迈步前往下一巡逻点
    setStatusText(wp.walkText || '巡逻中');
    const dx = wp.x - root.position.x;
    const dz = wp.z - root.position.z;
    const dist = Math.hypot(dx, dz);
    const speed = 1.05;

    if (dist < 0.08) {
      root.position.x = wp.x;
      root.position.z = wp.z;
      if (wp.pause > 0) {
        patrol.pauseTimer = wp.pause;
      } else {
        patrol.idx = (patrol.idx + 1) % WAYPOINTS.length;
      }
      return;
    }

    const stepDist = Math.min(dist, speed * dt);
    root.position.x += (dx / dist) * stepDist;
    root.position.z += (dz / dist) * stepDist;

    const moveYaw = Math.atan2(dx, dz);
    root.rotation.y = lerpAngle(root.rotation.y, moveYaw, Math.min(1, dt * 6.0));

    // 奶龙胖嘟嘟摇摆步态
    patrol.walkPhase += dt * 7.2;
    const swing = Math.sin(patrol.walkPhase);
    leftLeg.rotation.x = swing * 0.42;
    rightLeg.rotation.x = -swing * 0.42;
    bodyGroup.position.y = Math.abs(swing) * 0.036;
    bodyGroup.rotation.z = swing * 0.068;
    waveArm.rotation.z = THREE.MathUtils.lerp(waveArm.rotation.z, -0.22, 0.15);
    waveArm.rotation.x = THREE.MathUtils.lerp(waveArm.rotation.x, -swing * 0.34, 0.18);
  }

  return {
    root,
    pickables,
    label,
    getStatus: () => patrol.statusText,
    isPaused: () => patrol.paused,
    togglePause: () => {
      patrol.paused = !patrol.paused;
      return patrol.paused;
    },
    update,
  };
}
