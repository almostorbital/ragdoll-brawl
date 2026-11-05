// Pictures, made in the game's own 3D, once, when it loads:
//  · a little picture of each hat and each piece of gear, for the buttons in the customize panel;
//  · a funny comic-book picture of ragdolls fighting, filling the screen behind the title and the customize
//    panel: a little 3D scene, with the camera swinging about it. A new one each game and each time you
//    pause (one that goes with your gear: see picFits). It's two real ragdolls (the same model, eyes and gear as in the game) stood in a pose, on a
//    chunk of island in the sky, with a comic word over them. One of them is you: your colour, hat, eyebrows
//    and gear. Change any of those and it's made again with the change (and maybe it's a different picture).
// The icons are drawn by a little renderer of their own, off screen, and turned into images; the picture's
// drawn by the game's renderer, in place of the game, while the menus are up.
'use strict';
const ICONS = {};   // kind (a hat or gear) → image (a data: URL)

// ---------------------------------------------------------------- the little renderer
let picR = null;
function picRenderer(w, h) {
  if (!picR) {
    picR = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    picR.outputEncoding = THREE.sRGBEncoding;
    picR.shadowMap.enabled = true; picR.shadowMap.type = THREE.PCFSoftShadowMap;
  }
  picR.setPixelRatio(1); picR.setSize(w, h, false);
  return picR;
}
// a scene with the game's lighting
function picScene() {
  const sc = new THREE.Scene();
  sc.add(new THREE.HemisphereLight(col(0xeaf6ff), col(0xb0c890), 0.55));
  const sun = new THREE.DirectionalLight(col(0xfff6e8), 0.75);
  sun.position.set(2.5, 6, 4); sun.castShadow = true; sun.shadow.mapSize.set(1024, 1024);
  Object.assign(sun.shadow.camera, { left: -4, right: 4, top: 4, bottom: -4, near: 0.5, far: 20 });
  sun.shadow.bias = -0.0005; sun.shadow.normalBias = 0.02;
  sc.add(sun);
  return sc;
}

// ---------------------------------------------------------------- icons: a hat or a piece of gear, on its own
function snapIcon(obj, view) {
  const sc = picScene(), R = picRenderer(128, 128);
  const holder = new THREE.Group(); holder.add(obj); sc.add(holder);
  holder.rotation.set(view[0], view[1], view[2] || 0);
  holder.updateMatrixWorld(true);
  // (fit it in the middle)
  const box = new THREE.Box3().setFromObject(holder), c = box.getCenter(V3()), size = box.getSize(V3()).length();
  holder.position.sub(c);
  const cam = new THREE.PerspectiveCamera(30, 1, 0.01, 50);
  cam.position.set(0, 0, size * 1.35); cam.lookAt(0, 0, 0);
  R.setClearColor(0x000000, 0);
  R.render(sc, cam);
  return R.domElement.toDataURL();
}
const ICON_VIEW = {
  'boxing gloves': [0.15, 0.7, Math.PI / 2], 'cartoon hammer': [0.2, 0.5, -0.7],
  'butter shoes': [0.45, 0.7], 'spring shoes': [0.3, 0.8],
};
function makeIcons() {
  for (const slot in GEAR) for (const kind in GEAR[slot]) {
    if (kind === 'none') continue;
    let obj = gearModel(kind, 0.012);
    if (!obj) continue;
    if (GEAR.feet[kind]) {
      // (a pair)
      const two = new THREE.Group(), b = gearModel(kind, 0.012);
      obj.position.x = -0.13 * S; b.position.x = 0.13 * S;
      two.add(obj, b); obj = two;
    }
    ICONS[kind] = snapIcon(obj, ICON_VIEW[kind] || [0.4, 0.6]);
  }
  for (const kind of HATS) if (kind !== 'none') ICONS[kind] = snapIcon(makeHat(kind, playerRig.headR), [0.35, 0.5]);
}

// ---------------------------------------------------------------- posing a ragdoll for a picture
// A pose is made in the ragdoll's own frame: x to its right, y up, z the way it's facing, starting from
// standing. Then it's put in the picture: stood at `at`, facing `yaw`.
const PIC_LEN = {};
function picLocal() {
  const L = STAND.map(p => V3(p.x, p.y, -p.z));
  PIC_LEN.arm = [L[1].distanceTo(L[3]), L[3].distanceTo(L[5])];
  PIC_LEN.leg = [L[7].distanceTo(L[9]), L[9].distanceTo(L[11])];
  return L;
}
// put a hand (side 0: left, 1: right) at `to`, its elbow bending toward `bend`
function picArm(L, side, to, bend) {
  const [a, b] = PIC_LEN.arm, sh = L[1 + side];
  const d = to.clone().sub(sh); if (d.length() > (a + b) * 0.98) d.setLength((a + b) * 0.98);
  L[5 + side].copy(sh).add(d);
  bendJoint(sh, L[5 + side], a, b, bend.clone().normalize(), L[3 + side]);
}
function picLeg(L, side, to, bend) {
  const [a, b] = PIC_LEN.leg, hip = L[7 + side];
  const d = to.clone().sub(hip); if (d.length() > (a + b) * 0.98) d.setLength((a + b) * 0.98);
  L[11 + side].copy(hip).add(d);
  bendJoint(hip, L[11 + side], a, b, bend.clone().normalize(), L[9 + side]);
}
// move some points (the upper body, say) along
const picMove = (L, ids, v) => { for (const i of ids) L[i].add(v); };
// turn the whole pose round its hips (tilt: about its forward axis; pitch: leaning forward or back)
function picTurn(L, axis, ang) {
  const c = L[7].clone().lerp(L[8], 0.5);
  for (const p of L) p.sub(c).applyAxisAngle(axis, ang).add(c);
}
// the pose into the picture
function picPlace(L, at, yaw) {
  const f = fwdOf(yaw, V3()), r = rightOf(yaw, V3());
  return L.map(p => at.clone().addScaledVector(r, p.x).addScaledVector(UP, p.y).addScaledVector(f, p.z));
}
// show a picture ragdoll in a pose
function picPose(rig, W) {
  // (you're small or big, if that's what you picked: grown or shrunk about your feet. See SIZES in custom.js)
  const z = rig.picSize || 1;
  if (z !== 1) { const c = W[11].clone().lerp(W[12], 0.5); c.y = Math.min(W[11].y, W[12].y) - 0.08; for (const p of W) p.sub(c).multiplyScalar(z).add(c); }
  rig.picW = W;
  const old = RIG; RIG = rig; poseRig(W); RIG = old;
  rig.root.updateMatrixWorld(true);
}
// dress it: colour, face, hat, gear (anything it had on from the last picture comes off)
function picDress(rig, sc, o) {
  // (anyone else in the same colour as you changes, so you can tell which is you)
  let c = o.color;
  if (!o.you && c === LOOK.color) c = c === 0xff9a2a ? 0x2fcf6a : 0xff9a2a;
  rig.mesh.material.color.copy(col(c));
  // (your size)
  rig.picBase = rig.picBase || rig.root.scale.x;
  rig.picSize = o.you ? (SIZES[LOOK.size] || SIZES.normal).scale : 1;
  rig.root.scale.setScalar(rig.picBase * rig.picSize); rig.root.updateMatrixWorld(true);
  rig.armInv = rig.bones.lb.parent.matrixWorld.clone().invert();
  if (rig.picStuff) for (const m of rig.picStuff) m.parent && m.parent.remove(m);
  rig.picStuff = [];
  if (o.hat) { const h = makeHat(o.hat, rig.headR); rig.hatHold.add(h); rig.picStuff.push(h); }
  rig.hammer = null; rig.hammerPosed = false;
  for (const kind of o.gear || []) {
    const made = makeGear(rig, GEAR.hands[kind] ? 'hands' : 'feet', kind, null);
    rig.picStuff.push(...made);
  }
  if (rig.hammer) sc.add(rig.hammer);
  rig.face = ''; setFace(rig, o.face || 'normal');
  for (const e of rig.eyes) e.brow.scale.y = o.brows || 1;
}
// you, in a picture: your look, and the gear the picture needs (plus your own, in the other slot)
function picYou(o) {
  const gear = [...(o.gear || [])], fixed = new Set(gear.map(k => GEAR.hands[k] ? 'hands' : 'feet'));
  for (const slot in GEAR) if (!fixed.has(slot) && LOOK[slot] !== 'none' && unlocked(LOOK[slot])) gear.push(LOOK[slot]);
  return Object.assign({}, o, { you: true, color: LOOK.color, hat: LOOK.hat === 'none' ? null : LOOK.hat, brows: BROWS[LOOK.brows], gear });
}
// hold the hammer: its grip at the hand, its handle pointing along dir (its head's flat faces swinging along `swing`)
function picHammer(rig, hand, dir, swing) {
  const g = rig.hammer; if (!g) return;
  rig.hammerPosed = true;
  const y = dir.clone().normalize(), x = new THREE.Vector3().crossVectors(y, swing).normalize(), z = new THREE.Vector3().crossVectors(x, y);
  g.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z));
  g.position.copy(hand);
}
const hammerLen = () => (0.53 - (GEAR_MODELS['cartoon hammer'].grip || 0)) * (GEAR_MODELS['cartoon hammer'].k || 1);

// a chunk of floating island (its top at y = 0), and a few clouds behind
// (its shapes and colours are made once, and shared by every picture)
const PIC_BITS = {};
function picBits() {
  if (PIC_BITS.island) return PIC_BITS;
  PIC_BITS.island = new THREE.CylinderGeometry(3.2, 3.2 * 0.55, 1.6, 40, 1);
  PIC_BITS.islandM = [toonM({ color: col(0x9a6a44) }), toonM({ color: col(0x7ad34a) }), toonM({ color: col(0x9a6a44) })];
  PIC_BITS.puff = new THREE.SphereGeometry(0.5, 14, 10);
  PIC_BITS.white = toonM({ color: col(0xffffff) });
  return PIC_BITS;
}
function picIsland(sc, x) {
  const P = picBits();
  const m = outline(new THREE.Mesh(P.island, P.islandM), 0.03);
  m.position.set(x, -0.8, 0); m.receiveShadow = true; sc.add(m);
  for (const [cx, cy, cz, s] of [[-3.2, 2.6, -6, 1], [3.6, 3.1, -7, 1.3], [0.4, -2.2, -5, 0.9], [7, 1.5, -9, 1.6], [-7, 0.5, -8, 1.2]]) {
    const c = new THREE.Group();
    for (let k = 0; k < 4; k++) { const b = new THREE.Mesh(P.puff, P.white); b.position.set((k - 1.5) * 0.55 * s, (k % 2) * 0.2 * s, 0); b.scale.set(1, 0.7, 1).multiplyScalar(s * (k % 2 ? 0.8 : 1)); c.add(b); }
    c.position.set(cx, cy, cz); sc.add(c);
  }
}
// dizzy stars round a head
function picStars(sc, at, n = 4, r = 0.32) {
  for (let i = 0; i < n; i++) {
    const a = i / n * Math.PI * 2, s = new THREE.Mesh(FX_GEO.star, FX_MAT.star);
    s.position.set(at.x + Math.cos(a) * r, at.y + 0.28 + Math.sin(a * 2) * 0.05, at.z + Math.sin(a) * r);
    s.scale.setScalar(0.09 / 0.5); s.rotation.y = a; sc.add(s);
  }
}
// ---------------------------------------------------------------- the pictures
// (yaw for facing along +x or -x, turned a little toward the camera so you see their faces)
const TO_RIGHT = -Math.PI / 2 - 0.45, TO_LEFT = Math.PI / 2 + 0.45;
const SCENES = [
  { // BONK! you bring a giant hammer down on someone's head
    needs: 'cartoon hammer', word: 'BONK!', cam: [0, 1.15, 5.4], look: [0.05, 1.0, 0],
    make(sc, [a, b]) {
      picIsland(sc, 0);
      picDress(a, sc, picYou({ face: 'angry', gear: ['cartoon hammer'] }));
      picDress(b, sc, { color: 0xff4a4a, face: 'dizzy' });
      // you: lunging in, both hands up high on the handle, swinging it down
      const at = V3(-0.5, 0, 0), yaw = TO_RIGHT, f = fwdOf(yaw, V3());
      const A = picLocal();
      picMove(A, [0, 1, 2, 3, 4, 5, 6], V3(0, -0.04, 0.18)); A[0].z += 0.06;
      picLeg(A, 0, V3(-0.16, 0.08, 0.36), V3(0, 0, 1)); picLeg(A, 1, V3(0.16, 0.08, -0.28), V3(0, 0, 1));
      picArm(A, 1, V3(0.06, 1.62, 0.45), V3(1, 0, -0.3)); picArm(A, 0, V3(-0.04, 1.5, 0.4), V3(-1, 0, -0.3));
      const WA = picPlace(A, at, yaw);
      picPose(a, WA);
      // the dizzy one: knees bent, bowed right over, arms flung out
      const B = picLocal();
      picMove(B, [0, 1, 2, 3, 4, 5, 6, 7, 8], V3(0, -0.2, 0));
      picTurn(B, V3(1, 0, 0), 0.5);   // (bowing forward)
      picLeg(B, 0, V3(-0.3, 0.08, 0.05), V3(-1, 0, 0.5)); picLeg(B, 1, V3(0.3, 0.08, 0.05), V3(1, 0, 0.5));
      picArm(B, 0, V3(-0.75, 0.6, 0.1), V3(0, -1, 0)); picArm(B, 1, V3(0.75, 0.7, 0.1), V3(0, -1, 0));
      // (stood just where the hammer, swung from your hands, comes down on top of its head)
      const head = picPlace(B, V3(), TO_LEFT)[0], len = hammerLen(), H = WA[6];
      const ty = head.y + 0.33, dy = H.y - ty, along = Math.sqrt(Math.max(0.01, len * len - dy * dy));
      const fh = f.clone().setY(0).normalize(), T = H.clone().addScaledVector(fh, along).setY(ty);
      const WB = picPlace(B, V3(T.x - head.x, 0, T.z - head.z), TO_LEFT);
      picPose(b, WB); picStars(sc, WB[0], 4, 0.36);
      picHammer(a, H, T.clone().sub(H), f);
    },
  },
  { // WHEEE! knocked clean off the island
    word: 'WHEEE!', cam: [0.35, 1.15, 5.8], look: [0.4, 1.0, 0],
    make(sc, [a, b]) {
      picIsland(sc, -2.6);   // (its edge at about x = 0.6)
      picDress(a, sc, picYou({ face: 'happy' }));
      picDress(b, sc, { color: 0xff9a2a, face: 'shocked', hat: 'party hat' });
      // the winner: right at the edge, both gloves up in the air
      const A = picLocal();
      picArm(A, 0, V3(-0.6, 1.7, 0.1), V3(-1, 0, 0)); picArm(A, 1, V3(0.6, 1.7, 0.1), V3(1, 0, 0));
      picLeg(A, 0, V3(-0.22, 0.08, 0), V3(-0.5, 0, 1)); picLeg(A, 1, V3(0.22, 0.08, 0), V3(0.5, 0, 1));
      picPose(a, picPlace(A, V3(-0.45, 0, 0), -2.7));
      // the loser: sailing off over the edge, flipped sideways, arms and legs everywhere
      const B = picLocal();
      picArm(B, 0, V3(-0.65, 1.45, 0.2), V3(0, -1, 0)); picArm(B, 1, V3(0.75, 1.2, -0.1), V3(0, -1, 0));
      picLeg(B, 0, V3(-0.4, 0.1, 0.3), V3(0, 0, 1)); picLeg(B, 1, V3(0.35, 0.25, -0.25), V3(0, 0, 1));
      picTurn(B, V3(0, 0, 1), 1.0);
      picPose(b, picPlace(B, V3(1.45, 0.55, 0.2), 2.6));
    },
  },
  { // WHOOPS! butter shoes: feet out from under you, and someone laughing at you
    needs: 'butter shoes', word: 'WHOOPS!', cam: [0, 1.15, 5.6], look: [0.1, 0.95, 0],
    make(sc, [a, b]) {
      picIsland(sc, 0);
      picDress(a, sc, picYou({ face: 'shocked', gear: ['butter shoes'] }));
      picDress(b, sc, { color: 0xff5fb0, face: 'happy', hat: 'top hat' });
      // tipping over backwards in mid-air: feet flying up in front, arms flailing
      const A = picLocal();
      picLeg(A, 0, V3(-0.15, 0.25, 0.42), V3(0, 1, 0.3)); picLeg(A, 1, V3(0.18, 0.12, 0.3), V3(0, 1, 0.3));
      picArm(A, 0, V3(-0.7, 1.3, 0.1), V3(0, -1, 0)); picArm(A, 1, V3(0.7, 1.45, 0.25), V3(0, -1, 0));
      picTurn(A, V3(1, 0, 0), -1.75);   // (tipped right over backwards, feet higher than its head)
      picPose(a, picPlace(A, V3(-0.75, 0.55, 0), TO_RIGHT + 0.2));
      for (let i = 0; i < 4; i++) { const s = new THREE.Mesh(FX_GEO.smear, FX_MAT.smear); s.position.set(-0.6 + i * 0.3, 0.03, 0.2 + (i % 2) * 0.15); s.scale.setScalar(0.55); sc.add(s); }
      // the one laughing: leaning back, pointing at you, holding its tummy
      const B = picLocal();
      picMove(B, [0, 1, 2, 3, 4, 5, 6], V3(0, 0, -0.1)); B[0].z -= 0.08;
      picArm(B, 1, V3(0.35, 1.15, 0.6), V3(1, -0.5, 0));
      picArm(B, 0, V3(0.0, 0.62, 0.22), V3(-1, 0, 0));
      picPose(b, picPlace(B, V3(0.95, 0, 0), TO_LEFT));
    },
  },
  { // POW! two punches, both at once, right in the face
    needs: 'boxing gloves', word: 'POW!', cam: [0, 1.2, 5.0], look: [0, 1.0, 0],
    make(sc, [a, b]) {
      picIsland(sc, 0);
      picDress(a, sc, picYou({ face: 'angry', gear: ['boxing gloves'] }));
      picDress(b, sc, { color: 0xffd23a, face: 'hurt', gear: ['boxing gloves'] });
      // the puncher: stepping in, its near fist right in the other one's face
      const A = picLocal();
      picMove(A, [0, 1, 2, 3, 4, 5, 6], V3(0, -0.03, 0.12));
      picLeg(A, 0, V3(-0.17, 0.08, 0.3), V3(0, 0, 1)); picLeg(A, 1, V3(0.17, 0.08, -0.25), V3(0, 0, 1));
      // the one getting punched: head snapped back, leaning back off its feet, arms flung out
      const B = picLocal();
      picArm(B, 0, V3(-0.7, 1.25, -0.1), V3(0, -1, 0)); picArm(B, 1, V3(0.7, 1.35, -0.15), V3(0, -1, 0));
      picLeg(B, 0, V3(-0.2, 0.08, 0.25), V3(0, 0, 1)); picLeg(B, 1, V3(0.15, 0.08, -0.05), V3(0, 0, 1));
      B[0].z -= 0.1; B[0].y += 0.03;
      picTurn(B, V3(1, 0, 0), -0.35);
      const WB = picPlace(B, V3(0.42, 0.06, 0), TO_LEFT + 0.15);
      picPose(b, WB);
      const at = V3(-0.42, 0, 0), yaw = TO_RIGHT, f = fwdOf(yaw, V3()), r = rightOf(yaw, V3());
      const toLocal = w => { const d = w.clone().sub(at); return V3(d.dot(r), d.y, d.dot(f)); };
      picArm(A, 1, toLocal(WB[0].clone().add(V3(-0.05, -0.02, 0.12))), V3(1, -0.4, 0));   // (on the nose)
      picArm(A, 0, V3(-0.15, 0.95, 0.28), V3(-1, -1, 0));
      picPose(a, picPlace(A, at, yaw));
    },
  },
  { // BOING! up on spring shoes, way over someone's head
    needs: 'spring shoes', word: 'BOING!', wordUp: 0.95, cam: [0, 1.3, 5.8], look: [0.1, 1.2, 0],
    make(sc, [a, b]) {
      picIsland(sc, 0);
      picDress(a, sc, picYou({ face: 'happy', gear: ['spring shoes'] }));
      picDress(b, sc, { color: 0x2fcf6a, face: 'shocked', hat: 'cap' });
      // you: knees tucked up, arms flung up, high in the air
      const A = picLocal();
      picLeg(A, 0, V3(-0.16, 0.22, 0.12), V3(0, 0, 1)); picLeg(A, 1, V3(0.16, 0.3, 0.2), V3(0, 0, 1));
      picArm(A, 0, V3(-0.6, 1.65, 0.1), V3(-1, 0, 0)); picArm(A, 1, V3(0.6, 1.6, 0.2), V3(1, 0, 0));
      picPose(a, picPlace(A, V3(-0.4, 0.8, 0), TO_RIGHT - 0.3));
      // them: leaning back, gawping up at you, pointing
      const B = picLocal();
      picTurn(B, V3(1, 0, 0), -0.3);
      picLeg(B, 0, V3(-0.2, 0.08, 0.12), V3(0, 0, 1)); picLeg(B, 1, V3(0.2, 0.08, -0.05), V3(0, 0, 1));
      picArm(B, 1, V3(0.15, 1.75, 0.25), V3(1, 0, 0)); picArm(B, 0, V3(-0.5, 0.85, 0.05), V3(-1, -0.5, 0));
      picPose(b, picPlace(B, V3(0.75, 0, 0), TO_LEFT + 0.2));
    },
  },
  { // THUNK! a big rock, held up high, about to come down on someone cowering
    avoid: 'cartoon hammer', word: 'THUNK!', wordUp: 1.5, cam: [0, 1.3, 5.6], look: [0.05, 1.1, 0],
    make(sc, [a, b]) {
      picIsland(sc, 0);
      picDress(a, sc, picYou({ face: 'angry' }));
      picDress(b, sc, { color: 0xa45cff, face: 'shocked', hat: 'beanie' });
      const A = picLocal();
      picMove(A, [0, 1, 2, 3, 4, 5, 6], V3(0, 0, -0.06));
      picArm(A, 0, V3(-0.2, 1.85, 0.12), V3(-1, 0, -0.3)); picArm(A, 1, V3(0.2, 1.85, 0.12), V3(1, 0, -0.3));
      picLeg(A, 0, V3(-0.2, 0.08, 0.15), V3(0, 0, 1)); picLeg(A, 1, V3(0.2, 0.08, -0.15), V3(0, 0, 1));
      const WA = picPlace(A, V3(-0.5, 0, 0), TO_RIGHT + 0.15);
      picPose(a, WA);
      const rock = outline(new THREE.Mesh(rockGeometry(0.55, 0.42, 0.5), rockMat()), 0.025);
      rock.position.copy(WA[5]).lerp(WA[6], 0.5).add(V3(0, 0.2, 0)); rock.castShadow = true; sc.add(rock);
      // cowering: crouched, arms over its head
      const B = picLocal();
      picMove(B, [0, 1, 2, 3, 4, 5, 6, 7, 8], V3(0, -0.18, 0)); picTurn(B, V3(1, 0, 0), 0.25);
      picLeg(B, 0, V3(-0.25, 0.08, 0.08), V3(-0.5, 0, 1)); picLeg(B, 1, V3(0.25, 0.08, 0.08), V3(0.5, 0, 1));
      picArm(B, 0, V3(-0.12, 1.25, 0.25), V3(-1, 0.3, 0)); picArm(B, 1, V3(0.12, 1.3, 0.25), V3(1, 0.3, 0));
      picPose(b, picPlace(B, V3(0.62, 0, 0), TO_LEFT));
    },
  },
  { // WHAM! a flying kick, right in the tummy
    word: 'WHAM!', cam: [0, 1.2, 5.6], look: [0, 0.95, 0],
    make(sc, [a, b]) {
      picIsland(sc, 0);
      picDress(a, sc, picYou({ face: 'angry' }));
      picDress(b, sc, { color: 0xff9a2a, face: 'hurt', hat: 'top hat' });
      // them: folded over, pushed back, arms flung forward
      const B = picLocal();
      picMove(B, [7, 8], V3(0, 0, -0.12)); picTurn(B, V3(1, 0, 0), 0.45);
      picLeg(B, 0, V3(-0.18, 0.08, 0.05), V3(0, 0, 1)); picLeg(B, 1, V3(0.18, 0.08, 0.1), V3(0, 0, 1));
      picArm(B, 0, V3(-0.35, 0.9, 0.55), V3(0, -1, 0)); picArm(B, 1, V3(0.35, 0.95, 0.55), V3(0, -1, 0));
      const WB = picPlace(B, V3(0.6, 0, 0), TO_LEFT);
      picPose(b, WB);
      // you: in the air, leaning back, one leg tucked, the other shooting out into its tummy
      const at = V3(-0.5, 0.35, 0), yaw = TO_RIGHT + 0.1, f = fwdOf(yaw, V3()), r = rightOf(yaw, V3());
      const toLocal = w => { const d = w.clone().sub(at); return V3(d.dot(r), d.y, d.dot(f)); };
      const A = picLocal();
      picTurn(A, V3(1, 0, 0), -0.4);
      picArm(A, 0, V3(-0.65, 1.2, -0.2), V3(0, -1, 0)); picArm(A, 1, V3(0.6, 1.35, -0.25), V3(0, -1, 0));
      picLeg(A, 0, V3(-0.15, 0.3, 0.15), V3(0, 0.3, 1));
      const tummy = WB[7].clone().lerp(WB[8], 0.5).lerp(WB[0], 0.35);
      picLeg(A, 1, toLocal(tummy), V3(0, 1, 0));
      picPose(a, picPlace(A, at, yaw));
    },
  },
  { // BYE BYE! dragging someone off to the edge by its foot
    word: 'BYE BYE!', cam: [0.2, 1.15, 5.8], look: [-0.25, 0.75, 0],
    make(sc, [a, b]) {
      picIsland(sc, -2.6);   // (its edge at about x = 0.6)
      picDress(a, sc, picYou({ face: 'happy' }));
      picDress(b, sc, { color: 0xff4a4a, face: 'dizzy', hat: 'party hat' });
      // you: striding toward the edge, leaning into it, your left hand back holding its foot
      const A = picLocal();
      picMove(A, [0, 1, 2, 3, 4, 5, 6], V3(0, -0.04, 0.15)); A[0].z += 0.05;
      picLeg(A, 0, V3(-0.16, 0.08, 0.3), V3(0, 0, 1)); picLeg(A, 1, V3(0.16, 0.12, -0.3), V3(0, 0, 1));
      picArm(A, 0, V3(-0.3, 0.72, -0.42), V3(-1, 0, 0)); picArm(A, 1, V3(0.5, 0.95, 0.25), V3(1, -1, 0));
      const WA = picPlace(A, V3(0.05, 0, 0), TO_RIGHT + 0.15);
      picPose(a, WA);
      // them: flat on their back, arms flung out over their head, one leg up in your hand
      const B = picLocal();
      picArm(B, 0, V3(-0.45, 1.6, 0.05), V3(-1, 0, 0)); picArm(B, 1, V3(0.45, 1.55, 0.05), V3(1, 0, 0));
      picTurn(B, V3(1, 0, 0), -Math.PI / 2 + 0.12);   // (lying on its back, feet toward you)
      picLeg(B, 1, V3(0.08, 0.95, 0.4), V3(0, 1, 0)); picLeg(B, 0, V3(-0.2, 0.42, 0.55), V3(0, 1, 0));
      const yawB = -Math.PI / 2 - 0.2, foot = picPlace(B, V3(), yawB)[11 + 1];
      const WB = picPlace(B, WA[5].clone().sub(foot), yawB);
      picPose(b, WB); picStars(sc, WB[0], 3, 0.3);
    },
  },
];

// ---------------------------------------------------------------- the picture, live
// PIC: the scene, which picture it is, its camera (and where that drifts about), the comic word and where it hangs
const PIC = { scene: null, i: -1, cam: new THREE.PerspectiveCamera(32, 1, 0.05, 80), base: V3(), look: V3(), word: V3(), t: 0 };
const PIC_BACK = 1.25;   // (how much further back the camera is than for a picture just of the fight)
let picSky = null, picRigs = null;
function buildPicture(i) {
  const Sc = SCENES[i], rigs = picRigs;
  // (anything the last picture had on its ragdolls comes off)
  for (const r of rigs) { if (r.picStuff) for (const m of r.picStuff) m.parent && m.parent.remove(m); r.picStuff = []; r.root.parent && r.root.parent.remove(r.root); }
  const sc = picScene();
  if (!picSky) {
    const sky = document.createElement('canvas'); sky.width = 4; sky.height = 128;
    const sg = sky.getContext('2d'), gr = sg.createLinearGradient(0, 0, 0, 128);
    gr.addColorStop(0, '#3d8bff'); gr.addColorStop(1, '#bfe8ff'); sg.fillStyle = gr; sg.fillRect(0, 0, 4, 128);
    picSky = new THREE.CanvasTexture(sky); picSky.encoding = THREE.sRGBEncoding;
  }
  sc.background = picSky;
  for (const r of rigs) { sc.add(r.root); r.mesh.frustumCulled = false; }
  Sc.make(sc, rigs);
  for (const r of rigs) if (r.hammer && !r.hammerPosed && r.picW) {
    const W = r.picW; picHammer(r, W[6], W[6].clone().sub(W[4]).normalize().add(V3(0, 1.2, 0)), fwdOf(0, V3()));
  }
  PIC.scene = sc; PIC.i = i;
  PIC.base.set(Sc.cam[0], Sc.cam[1] + 0.25, Sc.cam[2] * PIC_BACK);
  PIC.look.set(...Sc.look);
  // (the word hangs over the fight: above the higher of their two heads)
  const h0 = rigs[0].bones.head.getWorldPosition(V3()), h1 = rigs[1].bones.head.getWorldPosition(V3());
  PIC.word.copy(h0).lerp(h1, 0.5).setY(Math.max(h0.y, h1.y) + (Sc.wordUp || 0.85));
  $('picWord').innerHTML = `<span>${Sc.word}</span>`;
}

// each frame the menus are up: draw the picture instead of the game, the camera drifting slowly about.
// (The fight's framed off to the left, as the menus are on the right.) Returns false when it's not showing.
const _pw = V3(), _pw2 = V3();
function drawPicture(dt) {
  // (the title screen: the big brawl, on the real island, drawn as the game is. See crowd.js)
  if (CROWD.on && !playing) { crowdFrame(dt); return false; }
  // (and till the brawl's ready, just the island: not one of the other pictures for a moment)
  if ($('overlay').classList.contains('splash') && !started) { $('picWord').style.display = 'none'; return false; }
  const wordEl = $('picWord');
  if (!PIC.scene || playing) {
    if (wordEl) wordEl.style.display = 'none';
    return false;
  }
  PIC.t += dt;
  const t = PIC.t, cam = PIC.cam;
  cam.aspect = innerWidth / innerHeight;
  // (swinging round the fight from side to side, in and out, up and down)
  const ang = Math.sin(t * 0.23) * 0.5, zoom = 1 + Math.sin(t * 0.17) * 0.14;
  _pw.subVectors(PIC.base, PIC.look).multiplyScalar(zoom).applyAxisAngle(UP, ang);
  cam.position.copy(PIC.look).add(_pw); cam.position.y += Math.sin(t * 0.29) * 0.35;
  cam.lookAt(PIC.look);
  // (then moved across, so the fight sits about a fifth of the way across the screen, clear of the menus)
  const D = cam.position.distanceTo(PIC.look), halfW = D * Math.tan(THREE.MathUtils.degToRad(cam.fov / 2)) * cam.aspect;
  _pw2.set(1, 0, 0).applyQuaternion(cam.quaternion).multiplyScalar((0.5 - 0.2) * 2 * halfW);
  cam.position.add(_pw2);
  cam.updateProjectionMatrix();
  renderer.render(PIC.scene, cam);
  // the comic word, over the fight (gently bobbing)
  if (wordEl) {
    _pw.copy(PIC.word).project(cam);
    wordEl.style.display = '';
    wordEl.style.left = ((_pw.x + 1) / 2 * innerWidth) + 'px';
    wordEl.style.top = ((1 - _pw.y) / 2 * innerHeight) + 'px';
    wordEl.style.setProperty('--s', (innerHeight / 430 * (1 + Math.sin(t * 2.2) * 0.03)).toFixed(3));
  }
  return true;
}

// which pictures go with what you've got on (not one showing off gear you haven't got; not THUNK! if
// you've a hammer in your hand)
function picFits(i) {
  const S = SCENES[i];
  if (S.avoid && (LOOK.hands === S.avoid || LOOK.feet === S.avoid)) return false;
  return !S.needs || LOOK.hands === S.needs || LOOK.feet === S.needs;
}
// a new picture (each new game, and each time you pause): any one that fits, but not the same as last time
function newPicture() {
  if (!picRigs) return;
  const fits = SCENES.map((S, i) => i).filter(picFits);
  const pool = fits.length > 1 ? fits.filter(i => i !== PIC.i) : fits;
  buildPicture(pool[Math.floor(Math.random() * pool.length)]);
}
// you've changed your look (see applyLook): the same picture, made again with the change. (Unless you've just
// put on some gear: then it's the one that shows it off, the hammer: BONK!; gloves: POW!; butter shoes:
// WHOOPS!; spring shoes: BOING! Or it doesn't go with what you've got on any more: then a new one.)
function redrawPictures(changed) {
  if (!picRigs) return;
  if (changed && GEAR[changed] && LOOK[changed] !== 'none') {
    const i = SCENES.findIndex(S => S.needs === LOOK[changed]);
    if (i >= 0) return buildPicture(i);
  }
  if (PIC.i >= 0 && picFits(PIC.i)) buildPicture(PIC.i); else newPicture();
}

// make the icons and the picture (once everything they need has loaded)
function makePictures() {
  const ready = () => Object.values(GEAR_MODELS).every(G => G.parts);
  let tries = 0;
  const go = () => {
    if (!ready() && tries++ < 60) return setTimeout(go, 250);
    makeIcons();
    showLocks();
    // two ragdolls to pose (loaded just for the pictures)
    const rigs = [];
    for (let i = 0; i < 2; i++) new THREE.GLTFLoader().load('models/ragdoll.glb', gltf => {
      const old = RIG; rigs.push(setupRig(gltf)); RIG = old;
      for (const r of rigs) r.root.parent && r.root.parent.remove(r.root);
      if (rigs.length < 2) return;
      picRigs = rigs;
      newPicture();
      if ($('overlay').classList.contains('splash')) showCrowd();   // (the title screen: the big brawl instead)
    });
  };
  go();
}
