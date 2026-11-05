// Your body: a ragdoll all the time.
// The body is 13 points (head, shoulders, elbows, hands, hips, knees, feet) joined by sticks the length of the
// bones, simulated for real (gravity, momentum, bumping into things). It's "Verlet" physics: each point
// remembers where it was last step, and the gap is its speed.
// While you're in control, springs pull every point toward where it *should* be (standing, walking, carrying):
// stiff in the hips and chest so you stay upright, loose in the arms and legs so they swing and flop. Go limp
// and the springs switch off: you tumble for real. Come to rest and they fade back in and you get back up.
// Every frame the points are turned into the model's bone angles (poseRig), so whatever the physics does is
// exactly what you see.
'use strict';
//   0 head · 1/2 shoulders · 3/4 elbows · 5/6 hands · 7/8 hips · 9/10 knees · 11/12 feet (left first)
const RAG_STICKS = [[1, 2], [7, 8], [1, 7], [2, 8], [1, 8], [2, 7],   // the torso: a stiff box
  [0, 1], [0, 2], [0, 7], [0, 8],                                      // the head, held on by the neck
  [1, 3], [3, 5], [2, 4], [4, 6], [7, 9], [9, 11], [8, 10], [10, 12]]; // arms and legs
const RAG_BEND = [[1, 3, 5], [2, 4, 6], [7, 9, 11], [8, 10, 12]];     // elbows and knees can't fold flat
const RAG_R = [0.18, 0.14, 0.14, 0.08, 0.08, 0.08, 0.08, 0.15, 0.15, 0.08, 0.08, 0.07, 0.07].map(r => r * S);
const LIMB = { armL: 10, foreL: 11, armR: 12, foreR: 13, thighL: 14, shinL: 15, thighR: 16, shinR: 17 };   // (indexes into RAG_STICKS)
// how stiffly each point follows its target while you're in control
const ACTIVE_KW = [0.7, 0.9, 0.9, 0.75, 0.75, 0.7, 0.7, 1, 1, 0.85, 0.85, 0.9, 0.9];
const ACTIVE_K = 280, ACTIVE_DAMP = 15;

// The model's measurements, worked out from it in setupRig (so a new model from Blender just works, whatever
// size it was made at and however long its legs are). It's scaled to MODEL_H tall (then by S); SOLE is where
// the soles of its feet are, below its origin, and HAND_EXT, FOOT_DROP and HEAD_UP how far the hands, feet
// and the head's middle are past the last bone (all as at that height, before S).
const MODEL_H = 1.53;
let SOLE = -0.78, HAND_EXT = 0.23, FOOT_DROP = 0.166, HEAD_UP = 0.06;

// (there's a body for you and one for each fighter: the functions below work on whichever is `body` just
// then, so the fighters swap theirs in while they're being simulated, and swap yours back after)
const makeBody = () => ({
  pos: [], prev: [], len: [], bend: [], targets: null, tv: null,
  k: 0, damp: 0, lift: 0, ramp: 1, boost: new Array(13).fill(1),   // (boost: extra stiffness, for a punching arm)
  limp: false, limpT: 0, still: 0, acc: 0, touch: 0,
  size: 1, R: RAG_R,   // (how big: a champion's 1.5 times the size; R: how fat each point is, for bumping into things)
});
let body = makeBody();
const playerBody = body;
let STAND = [], RELAX = [];
// muscle tone: even limp, the arms and legs are loosely held toward a relaxed pose (relative to the body), so
// they flop but don't fling out to the very ends of their range like a puppet with cut strings
const TONE_K = 45, TONE_DAMP = 4, TONE_PTS = [3, 4, 5, 6, 9, 10, 11, 12];   // the standing pose: each point relative to the spot between your feet, facing -z

// ---------------------------------------------------------------- the model
// (likewise each character has its own model and bones: RIG is whichever is being posed)
let RIG = null, playerRig = null;
const BONE_NAMES = { lb: 'lower body', ub: 'upper body', head: 'head', shL: 'shoulder.l', elL: 'elbow.l',
  shR: 'shoulder.r', elR: 'elbow.r', hipL: 'hip.l', kneeL: 'knee.l', hipR: 'hip.r', kneeR: 'knee.r' };
// each limb bone points from one body point to another
const SEGMENTS = [['head', -1, 0], ['shL', 1, 3], ['elL', 3, 5], ['shR', 2, 4], ['elR', 4, 6],
  ['hipL', 7, 9], ['kneeL', 9, 11], ['hipR', 8, 10], ['kneeR', 10, 12]];
// each arm and leg bone turns about its limb's hinge (elbow or knee), worked out from the upper bone, so the
// model's limbs never twist round like a corkscrew: [bone, upper bone's first point, its second point]
const HINGED = { shL: [1, 3], elL: [1, 3], shR: [2, 4], elR: [2, 4], hipL: [7, 9], kneeL: [7, 9], hipR: [8, 10], kneeR: [8, 10] };
const PARENT = { ub: 'lb', head: 'ub', shL: 'ub', elL: 'shL', shR: 'ub', elR: 'shR', hipL: 'lb', kneeL: 'hipL', hipR: 'lb', kneeR: 'hipR' };

// a bone, by name (not minding a Blender copy number on the end: "elbow.l.001" will do for "elbow.l")
function RIG_FIND(mesh, n) {
  const want = THREE.PropertyBinding.sanitizeNodeName(n);
  return mesh.skeleton.bones.find(b => b.name === want) || mesh.skeleton.bones.find(b => /\d{3}$/.test(b.name) && b.name.slice(0, -3) === want);
}
function setupRig(gltf, color = 0x2f7bff) {
  RIG = { bones: {}, restQ: {}, restDir: {}, W: {} };
  const root = gltf.scene;
  RIG.root = root;
  let mesh;
  root.traverse(o => { if (o.isSkinnedMesh) mesh = o; });
  // its size: scaled to MODEL_H tall
  mesh.geometry.computeBoundingBox();
  const box = mesh.geometry.boundingBox, k = MODEL_H / (box.max.y - box.min.y);
  root.scale.setScalar(S * k);
  scene.add(root);
  root.updateMatrixWorld(true);
  { // (its proportions, from where its bones are; in proportion to how they were on the first model)
    const bp = n => mesh.skeleton.bones.find(b => b === RIG_FIND(mesh, n)).getWorldPosition(V3()).divideScalar(S);
    const elb = bp(BONE_NAMES.elR), knee = bp(BONE_NAMES.kneeR), hip = bp(BONE_NAMES.hipR), head = bp(BONE_NAMES.head);
    SOLE = box.min.y * k;
    HAND_EXT = 0.745 * Math.max(0.05, box.max.x * k - Math.abs(elb.x));
    FOOT_DROP = 0.706 * Math.max(0.05, knee.y - SOLE);
    HEAD_UP = 0.151 * Math.max(0.05, box.max.y * k - head.y);
    RIG.legH = hip.y - SOLE;
  }
  smoothNormals(mesh.geometry);
  mesh.material = toonM({ color: col(color), skinning: true });
  // mud: painted up the legs from the soles, a wobbly line that rises the muddier it gets (mud = 0 to 1, set
  // by muddy() in nature.js), with a few splatters just above it. (In the model's own coordinates, scaled
  // to MODEL_H tall: at most about two thirds of the way up its legs.)
  RIG.mudU = { value: 0 };
  // and wherever else you've been in the mud (fallen in it face first, say): each bone's part of the skin gets
  // splotches of mud, more of them the muddier that bone is (0 to 1, set by mudBody() in nature.js)
  const NB = mesh.skeleton.bones.length;
  RIG.boneMud = { value: new Float32Array(NB) }; RIG.ptMud = new Float32Array(13); RIG.boneIdx = {};
  for (const key in BONE_NAMES) RIG.boneIdx[key] = mesh.skeleton.bones.indexOf(RIG_FIND(mesh, BONE_NAMES[key]));
  const mudK = { value: k }, mudBase = { value: SOLE - 0.01 }, mudSpan = { value: 0.657 * RIG.legH };
  // (this rig's own mud, not whichever rig is RIG when the shader's finally built, the first time it's drawn:
  // otherwise everyone gets your mud)
  const mudU = RIG.mudU, boneMud = RIG.boneMud, seed = mudSeed();
  mesh.material.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, { mudAmt: mudU, mudCol: { value: col(0x6e4a2c) }, mudK, mudBase, mudSpan, boneMud, mudSeed: seed });
    sh.vertexShader = `uniform float mudK; uniform float boneMud[${NB}]; varying vec3 vMudP; varying float vMudB;\n` + sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
      vMudP = position * mudK;
      vMudB = boneMud[int(skinIndex.x)] * skinWeight.x + boneMud[int(skinIndex.y)] * skinWeight.y + boneMud[int(skinIndex.z)] * skinWeight.z + boneMud[int(skinIndex.w)] * skinWeight.w;`);
    sh.fragmentShader = 'uniform float mudAmt, mudBase, mudSpan; uniform vec3 mudCol, mudSeed; varying vec3 vMudP; varying float vMudB;\n' + MUD_NOISE + sh.fragmentShader.replace('#include <map_fragment>', `#include <map_fragment>
      if (mudAmt > 0.001) {
        // (the top edge of the mud: a ragged line, lumpy at a few sizes, with drips and gaps)
        float n = mudNoise(vMudP * 11.0 + mudSeed) - 0.5;
        float line = mudBase + mudAmt * mudSpan + n * 0.07;
        float m = 1.0 - smoothstep(line - 0.005, line + 0.005, vMudP.y);
        // (and some flecks flicked up above it, scattered any old how)
        float fleck = smoothstep(0.74, 0.78, mudVal(vMudP * 48.0 + mudSeed * 1.7)) * (1.0 - smoothstep(line, line + 0.09, vMudP.y));
        diffuseColor.rgb = mix(diffuseColor.rgb, mudCol, max(m, fleck * step(0.15, mudAmt)));
      }
      if (vMudB > 0.01) {
        // (blotches: random lumps of mud over the skin; the muddier, the more of it is covered, and as it
        // dries and falls off it goes in patches, the thin bits first)
        float b = mudNoise(vMudP * 8.0 + mudSeed + 11.0);
        diffuseColor.rgb = mix(diffuseColor.rgb, mudCol, smoothstep(b - 0.025, b + 0.025, vMudB * 1.15 - 0.05));
      }`);
  };
  // (the outline: the same skin, drawn inside out and puffed out a little, bending with the bones)
  const ol = new THREE.SkinnedMesh(mesh.geometry, outlineMat(+(0.042 / k).toFixed(4), true));
  ol.bind(mesh.skeleton, mesh.bindMatrix); ol.frustumCulled = false;
  mesh.parent.add(ol);
  mesh.castShadow = true; mesh.receiveShadow = false;   // (no shadows on itself: cleaner cartoon shading)
  mesh.frustumCulled = false;   // (its bounds are where it stood in Blender, not where it is now)
  const find = n => RIG_FIND(mesh, n);
  for (const k in BONE_NAMES) {
    const b = RIG.bones[k] = find(BONE_NAMES[k]);
    if (!b) throw new Error('The model has no bone called "' + BONE_NAMES[k] + '"');
    RIG.restQ[k] = b.getWorldQuaternion(new THREE.Quaternion());
    RIG.W[k] = new THREE.Quaternion();
  }
  // the body points in the model's rest pose (the T-pose it was made in)
  const at = k => RIG.bones[k].getWorldPosition(V3());
  const P = [];
  P[0] = at('head').add(V3(0, HEAD_UP * S, 0));
  P[1] = at('shL'); P[2] = at('shR'); P[3] = at('elL'); P[4] = at('elR');
  P[5] = P[3].clone().add(P[3].clone().sub(P[1]).normalize().multiplyScalar(HAND_EXT * S));
  P[6] = P[4].clone().add(P[4].clone().sub(P[2]).normalize().multiplyScalar(HAND_EXT * S));
  P[7] = at('hipL'); P[8] = at('hipR'); P[9] = at('kneeL'); P[10] = at('kneeR');
  P[11] = P[9].clone().add(V3(0, -FOOT_DROP * S, 0)); P[12] = P[10].clone().add(V3(0, -FOOT_DROP * S, 0));
  // which way each bone points at rest (in the torso's frame, which at rest is the world's)
  RIG.torsoRestInv = torsoQuat(P, new THREE.Quaternion()).invert();
  for (const [k, a, b] of SEGMENTS) RIG.restDir[k] = P[b].clone().sub(a < 0 ? shoulderMid(P) : P[a]).normalize();
  RIG.restFrameInv = {};
  torsoQuat(P, new THREE.Quaternion());
  for (const k in HINGED) {
    const [a, b] = HINGED[k];
    hingeAxis(_hu.subVectors(P[b], P[a]).normalize(), _tr, _hf.copy(_tb).negate(), _ha);
    RIG.restFrameInv[k] = limbFrame(RIG.restDir[k], _ha, new THREE.Quaternion()).invert();
  }
  const arm = RIG.bones.lb.parent;
  RIG.armQ = arm.getWorldQuaternion(new THREE.Quaternion());
  RIG.armQi = RIG.armQ.clone().invert();
  RIG.armInv = arm.matrixWorld.clone().invert();

  // standing: the rest pose stood on the ground, with the arms down by your sides instead of out
  const sole = SOLE * S;
  STAND = P.map(p => p.clone().sub(V3(0, sole, 0)));
  for (let i = 0; i < 2; i++) {
    const s = i ? 1 : -1, sh = STAND[1 + i], la = P[1 + i].distanceTo(P[3 + i]), lf = P[3 + i].distanceTo(P[5 + i]);
    STAND[3 + i] = sh.clone().add(V3(s * Math.sin(0.42), -Math.cos(0.42), -0.06).normalize().multiplyScalar(la));
    STAND[5 + i] = STAND[3 + i].clone().add(V3(s * Math.sin(0.25), -Math.cos(0.25), -0.25).normalize().multiplyScalar(lf));
  }

  // the relaxed pose a fallen body's limbs drift toward (relative to the hips): the standing pose with the
  // knees and elbows a little bent
  const hm = hipMid(STAND, V3());
  RELAX = STAND.map(p => p.clone().sub(hm));
  for (let i = 0; i < 2; i++) { RELAX[9 + i].z -= 0.08 * S; RELAX[5 + i].z -= 0.1 * S; RELAX[3 + i].z -= 0.03 * S; }

  // a face, stuck on the head: eyes (so you can see which way it's facing) and eyebrows. It pulls faces: see fx.js
  const white = new THREE.MeshBasicMaterial({ color: 0xffffff });
  const black = new THREE.MeshBasicMaterial({ color: 0x15131f });
  for (const s of [-1, 1]) {
    // big cartoon eyes: a white oval, a black pupil, and a little shine
    const eye = outline(new THREE.Mesh(new THREE.SphereGeometry(0.06 * S, 20, 14), white), 0.008);
    eye.scale.set(0.85, 1.15, 0.6);
    const pupil = new THREE.Mesh(new THREE.SphereGeometry(0.032 * S, 14, 10), black);
    pupil.position.set(0, -0.005 * S, -0.045 * S); eye.add(pupil);
    const shine = new THREE.Mesh(new THREE.SphereGeometry(0.01 * S, 8, 6), white);
    shine.position.set(0.012 * S, 0.014 * S, -0.03 * S); pupil.add(shine);
    const x = new THREE.Group(); x.visible = false;
    for (const r of [-1, 1]) {
      const bar = new THREE.Mesh(new THREE.BoxGeometry(0.09 * S, 0.022 * S, 0.02 * S), black);
      bar.rotation.z = r * Math.PI / 4; x.add(bar);
    }
    x.position.z = -0.06 * S; eye.add(x);
    const eyeAt = P[0].clone().add(V3(s * 0.07 * S, 0.035 * S, -0.16 * S));
    eye.position.copy(eyeAt);
    scene.add(eye); RIG.bones.head.attach(eye);
    // an eyebrow (only there when it's pulling a face), and a squint (> <, or ^ ^ when happy) to swap the eye for
    const brow = new THREE.Mesh(new THREE.BoxGeometry(0.1 * S, 0.026 * S, 0.02 * S), black);
    // (each sits in a holder, stuck on the head, so it can be turned and moved about on the face's own axes)
    const hold = at => { const g = new THREE.Group(); g.position.copy(at); scene.add(g); RIG.bones.head.attach(g); return g; };
    hold(eyeAt.clone().add(V3(0, 0.085 * S, -0.012 * S))).add(brow); brow.visible = false;
    const squint = new THREE.Group(); squint.visible = false;
    for (const r of [-1, 1]) {
      const bar = new THREE.Mesh(new THREE.BoxGeometry(0.07 * S, 0.024 * S, 0.02 * S), black);
      bar.position.set(-Math.cos(0.55) * 0.035 * S, r * Math.sin(0.55) * 0.035 * S, 0); bar.rotation.z = -r * 0.55; squint.add(bar);
    }
    hold(eyeAt.clone().add(V3(0, 0, -0.03 * S))).add(squint);
    (RIG.eyes = RIG.eyes || []).push({ eye, pupil, x, brow, squint, s });
  }
  // somewhere to put a hat on: on top of the head, turned the same way as the face (see custom.js)
  RIG.headR = 0.215 * S;
  RIG.hatHold = new THREE.Group();
  RIG.hatHold.position.set(P[0].x, box.max.y * k * S, P[0].z);
  scene.add(RIG.hatHold); RIG.bones.head.attach(RIG.hatHold);
  // and places to put gear on (see custom.js): the hands, the feet, the chest and the hips
  const holdOn = (bone, at) => { const g = new THREE.Group(); g.position.copy(at); scene.add(g); RIG.bones[bone].attach(g); return g; };
  RIG.gearHold = {
    handL: holdOn('elL', P[5]), handR: holdOn('elR', P[6]), footL: holdOn('kneeL', P[11]), footR: holdOn('kneeR', P[12]),
    chest: holdOn('ub', shoulderMid(P).lerp(hipMid(P), 0.3)), hips: holdOn('lb', hipMid(P)),
  };
  RIG.restP = P.map(p => p.clone());
  RIG.face = '';   // (set the first time it pulls a face: see setFace in fx.js)
  RIG.mesh = mesh;
  return RIG;
}

// The model was saved flat-shaded: every triangle has its own corners, so its normals are faceted (and an
// outline pushed out along them cracks apart). Average the normals of corners that sit in the same place.
function smoothNormals(geo) {
  const P = geo.attributes.position, N = geo.attributes.normal, sum = new Map(), key = i =>
    Math.round(P.getX(i) * 1e4) + ',' + Math.round(P.getY(i) * 1e4) + ',' + Math.round(P.getZ(i) * 1e4);
  for (let i = 0; i < P.count; i++) {
    const k = key(i), s = sum.get(k) || [0, 0, 0];
    s[0] += N.getX(i); s[1] += N.getY(i); s[2] += N.getZ(i); sum.set(k, s);
  }
  for (let i = 0; i < P.count; i++) {
    const s = sum.get(key(i)), l = Math.hypot(s[0], s[1], s[2]) || 1;
    N.setXYZ(i, s[0] / l, s[1] / l, s[2] / l);
  }
  N.needsUpdate = true;
}

const shoulderMid = (P, v = V3()) => v.addVectors(P[1], P[2]).multiplyScalar(0.5);
const hipMid = (P, v = V3()) => v.addVectors(P[7], P[8]).multiplyScalar(0.5);

// the torso's rotation: up from the hips to the shoulders, right across the shoulders and hips
const _tu = V3(), _tr = V3(), _tb = V3(), _tm = new THREE.Matrix4(), _ta = V3();
function torsoQuat(P, q) {
  _tu.subVectors(shoulderMid(P, _ta), hipMid(P, _tb)).normalize();
  _tr.subVectors(P[2], P[1]).add(_ta.subVectors(P[8], P[7]));
  _tr.addScaledVector(_tu, -_tr.dot(_tu)).normalize();
  _tb.crossVectors(_tr, _tu);
  _tm.makeBasis(_tr, _tu, _tb);
  return q.setFromRotationMatrix(_tm);
}

// a limb's hinge axis (see hinge() below): across the body, square to the upper bone; with the limb out to
// the side, from the bone and the body's forward direction (blended, so it never flips)
const _hu = V3(), _hf = V3(), _ha = V3(), _hx = V3(), _hm = new THREE.Matrix4();
function hingeAxis(upper, right, fwd, out) {
  out.copy(right).addScaledVector(upper, -right.dot(upper)).add(_hx.crossVectors(upper, fwd));
  return out.normalize();
}
// the rotation of a bone pointing along d, with its hinge axis a
function limbFrame(d, a, q) {
  _hx.copy(a).addScaledVector(d, -a.dot(d));
  if (_hx.lengthSq() < 1e-8) return null;
  _hx.normalize();
  _hm.makeBasis(d, _hx, _hu.crossVectors(d, _hx));
  return q.setFromRotationMatrix(_hm);
}

// turn the body points into bone rotations. The torso turns as a whole; each limb bone takes the shortest
// turn (measured in the torso's frame) from the way it pointed at rest to the way it points now.
const _qT = new THREE.Quaternion(), _qTi = new THREE.Quaternion(), _qs = new THREE.Quaternion(), _sd = V3(), _sm = V3();
function poseRig(P) {
  const B = RIG.bones, W = RIG.W;
  torsoQuat(P, _qT).multiply(RIG.torsoRestInv);
  _qTi.copy(_qT).invert();
  W.lb.copy(_qT).multiply(RIG.restQ.lb);
  W.ub.copy(_qT).multiply(RIG.restQ.ub);
  shoulderMid(P, _sm);
  _hf.copy(_tb).negate();   // (torsoQuat left the torso's right in _tr and back in _tb)
  const right = _ta.copy(_tr);
  for (const [k, a, b] of SEGMENTS) {
    _sd.subVectors(P[b], a < 0 ? _sm : P[a]).normalize();
    const hg = HINGED[k];
    if (hg) {
      hingeAxis(_hu.subVectors(P[hg[1]], P[hg[0]]).normalize(), right, _hf, _ha);
      if (limbFrame(_sd, _ha, _qs)) { W[k].copy(_qs).multiply(RIG.restFrameInv[k]).multiply(RIG.restQ[k]); continue; }
    }
    // (the head, or a limb folded exactly along its hinge: the shortest turn from how it pointed at rest)
    _qs.setFromUnitVectors(RIG.restDir[k], _sd.applyQuaternion(_qTi));
    W[k].copy(_qT).multiply(_qs).multiply(RIG.restQ[k]);
  }
  // bones store their turn relative to their parent
  B.lb.quaternion.copy(RIG.armQi).multiply(W.lb);
  for (const k in PARENT) B[k].quaternion.copy(W[PARENT[k]]).invert().multiply(W[k]);
  B.lb.position.copy(hipMid(P, _sd)).applyMatrix4(RIG.armInv);
}

// ---------------------------------------------------------------- poses
// the standing pose at `base` (the ground between your feet) facing yaw, into out[]
function standPose(out, base, yaw) {
  for (let i = 0; i < 13; i++) (out[i] || (out[i] = V3())).copy(STAND[i]).applyAxisAngle(UP, yaw).add(base);
  return out;
}

// bend a two-bone limb (hip-knee-foot, shoulder-elbow-hand): given where its top joint A and end E are,
// put the middle joint where it bends toward `dir`
const _iv = V3();
function bendJoint(A, E, L1, L2, dir, out) {
  _iv.subVectors(E, A);
  let d = _iv.length() || 1e-3; _iv.divideScalar(d); d = Math.min(d, L1 + L2 - 1e-3);
  const along = (L1 * L1 - L2 * L2 + d * d) / (2 * d), up = Math.sqrt(Math.max(0, L1 * L1 - along * along));
  const k = dir.dot(_iv);
  let bx = dir.x - _iv.x * k, by = dir.y - _iv.y * k, bz = dir.z - _iv.z * k;
  const bl = Math.hypot(bx, by, bz) || 1;
  return out.set(A.x + _iv.x * along + bx / bl * up, A.y + _iv.y * along + by / bl * up, A.z + _iv.z * along + bz / bl * up);
}

// ---------------------------------------------------------------- simulation
function initBody(base, yaw) {
  const B = body;
  standPose(B.pos, base, yaw);
  if (B.size !== 1) for (const p of B.pos) p.sub(base).multiplyScalar(B.size).add(base);   // (a big one: everything further apart)
  B.prev = B.pos.map(p => p.clone());
  B.len = RAG_STICKS.map(([a, b]) => B.pos[a].distanceTo(B.pos[b]));
  // (measured from the rest pose: arms straight, so the bend limit is a fraction of the full length)
  const rest = standPose([], V3(), 0);
  B.bend = RAG_BEND.map(([a, b, e]) => 0.45 * B.size * (rest[a].distanceTo(rest[b]) + rest[b].distanceTo(rest[e])));
  B.targets = B.pos.map(p => p.clone()); B.tv = B.pos.map(() => V3());
  B.limp = false; B.ramp = 1;
}

// set where the springs pull to this frame, and how fast those spots are moving
function setTargets(goal, dt) {
  const B = body;
  for (let i = 0; i < 13; i++) {
    B.tv[i].subVectors(goal[i], B.targets[i]).divideScalar(Math.max(dt, 1e-3));
    if (B.tv[i].lengthSq() > 400) B.tv[i].set(0, 0, 0);   // (a jump in the targets isn't a speed)
    B.targets[i].copy(goal[i]);
  }
}

function goLimp(vel) {
  const B = body;
  if (vel) B.prev.forEach((q, i) => q.copy(B.pos[i]).addScaledVector(vel, -H));
  B.limp = true; B.limpT = 0; B.still = 0;
}

// one small step of the body. (fx, fz): a push on every point (wriggling while you're limp)
function stepBody(fx, fz) {
  const B = body, { pos, prev } = B, h2 = H * H;
  const k = B.k, c = B.damp, T = k > 0 ? B.targets : null;
  muscleTone(pos, prev, 1 - Math.min(1, k / ACTIVE_K));
  for (let i = 0; i < 13; i++) {
    const p = pos[i], q = prev[i];
    const vx = (p.x - q.x) * 0.998, vy = (p.y - q.y) * 0.998, vz = (p.z - q.z) * 0.998;
    let ax = fx, ay = -G, az = fz;
    if (T) {
      // pulled toward its target (some parts stiffer than others), and its speed toward the target's speed
      const w = ACTIVE_KW[i] * B.boost[i] * (B.stiff || 1), tv = B.tv[i];
      ax += k * w * (T[i].x - p.x) + c * w * (tv.x - vx / H);
      ay += k * w * (T[i].y - p.y) + c * w * (tv.y - vy / H) + G * B.lift;   // (the muscles hold your weight up)
      az += k * w * (T[i].z - p.z) + c * w * (tv.z - vz / H);
    }
    q.copy(p);
    p.x += vx + ax * h2; p.y += vy + ay * h2; p.z += vz + az * h2;
  }
  // (a small one: its body's also nudged straight toward its pose each step, as well as pulled by its springs,
  // so even flat out it stays up straight with its legs going under it)
  if (B.stiff > 1 && T && k > ACTIVE_K * 0.5) for (let i = 0; i < 13; i++) {
    const p = pos[i], q = prev[i], t = T[i];
    const dx = (t.x - p.x) * 0.22, dy = (t.y - p.y) * 0.22, dz = (t.z - p.z) * 0.22;
    p.x += dx; p.y += dy; p.z += dz; q.x += dx; q.y += dy; q.z += dz;
  }
  for (let it = 0; it < 5; it++) sticks(pos);
  ragLimits(pos, prev);
  // bump into the level
  B.touch = 0;
  const fric = B.limp ? 0.75 : 0.92;
  // (a small one's little legs go so fast that its feet would catch on the ground and trail behind: they slip
  // along instead, so they keep up)
  const footFric = !B.limp && B.size < 1 ? 0.995 : fric;
  for (let i = 0; i < 13; i++) B.touch = Math.max(B.touch, collideWorld(pos[i], prev[i], B.R[i], 0.15, i >= 9 ? footFric : fric));
  if (k < ACTIVE_K * 0.5) selfCollide(pos, prev);
  sticks(pos);
}

// muscle tone (strength w, 0..1): each limb point is nudged toward where it'd be in the relaxed pose, turned
// and moved with the torso. The torso is pushed back by the same amount, so nothing drags itself along.
const _mq = new THREE.Quaternion(), _mh = V3(), _mt = V3(), _mv = V3(), _mtv = V3();
function muscleTone(pos, prev, w) {
  if (w <= 0.01) return;
  torsoQuat(pos, _mq).multiply(RIG.torsoRestInv);
  hipMid(pos, _mh);
  // how fast the torso's moving (so limbs are only damped relative to it)
  _mtv.set(0, 0, 0);
  for (const i of [1, 2, 7, 8]) _mtv.x += pos[i].x - prev[i].x, _mtv.y += pos[i].y - prev[i].y, _mtv.z += pos[i].z - prev[i].z;
  _mtv.multiplyScalar(0.25);
  const h2 = H * H, k = TONE_K * w * h2, c = TONE_DAMP * w * H;
  _mv.set(0, 0, 0);
  for (const i of TONE_PTS) {
    _mt.copy(RELAX[i]).applyQuaternion(_mq).add(_mh);
    const p = pos[i], q = prev[i];
    const dx = (_mt.x - p.x) * k - (p.x - q.x - _mtv.x) * c;
    const dy = (_mt.y - p.y) * k - (p.y - q.y - _mtv.y) * c;
    const dz = (_mt.z - p.z) * k - (p.z - q.z - _mtv.z) * c;
    p.x += dx; p.y += dy; p.z += dz;
    _mv.x += dx; _mv.y += dy; _mv.z += dz;
  }
  _mv.multiplyScalar(-0.25);
  for (const i of [1, 2, 7, 8]) pos[i].add(_mv);
}

// a limp body's hands, elbows and feet don't go through its own chest, and its legs don't pass through each
// other: the torso is a few solid tubes between its corners
const TORSO_CAPS = [[1, 2], [7, 8], [1, 7], [2, 8], [1, 8], [2, 7]], SELF_PTS = [3, 4, 5, 6, 11, 12];
const LEG_PAIRS = [[9, 10], [11, 12], [9, 12], [10, 11]];
const _sc = V3();
function selfCollide(pos, prev) {
  const R = body.R, tr = 0.13 * S * body.size;
  for (const i of SELF_PTS) {
    const p = pos[i], m = tr + R[i];
    for (const [a, b] of TORSO_CAPS) {
      const A = pos[a], ex = pos[b].x - A.x, ey = pos[b].y - A.y, ez = pos[b].z - A.z, ll = ex * ex + ey * ey + ez * ez;
      const t = clamp(((p.x - A.x) * ex + (p.y - A.y) * ey + (p.z - A.z) * ez) / (ll || 1), 0, 1);
      _sc.set(p.x - A.x - ex * t, p.y - A.y - ey * t, p.z - A.z - ez * t);
      const d = _sc.length();
      if (d >= m || d < 1e-5) continue;
      _sc.multiplyScalar((m - d) / d);
      p.add(_sc); prev[i].add(_sc.multiplyScalar(0.7));   // (out onto the surface, keeping most of its sliding)
    }
  }
  for (const [a, b] of LEG_PAIRS) {
    const m = R[a] + R[b] + 0.02 * S;
    _sc.subVectors(pos[b], pos[a]);
    const d = _sc.length();
    if (d >= m || d < 1e-5) continue;
    _sc.multiplyScalar((m - d) / d * 0.5);
    pos[b].add(_sc); pos[a].sub(_sc);
  }
}
function sticks(pos) {
  const B = body;
  for (let k = 0; k < RAG_STICKS.length; k++) stick(pos[RAG_STICKS[k][0]], pos[RAG_STICKS[k][1]], B.len[k], false);
  for (let k = 0; k < RAG_BEND.length; k++) stick(pos[RAG_BEND[k][0]], pos[RAG_BEND[k][2]], B.bend[k], true);
}
// push two points to exactly len apart (or, for a "bend", only apart if they're closer than len)
const _rd = V3();
function stick(a, b, len, minOnly) {
  _rd.subVectors(b, a);
  const d = _rd.length() || 1e-6;
  if (minOnly && d >= len) return;
  _rd.multiplyScalar((d - len) / d * 0.5);
  a.add(_rd); b.sub(_rd);
}

// The controller (an invisible spot that walks about) can go where the body can't: through another ragdoll,
// a heavy rock. Then the body gets left behind, and that looks like being knocked over. So when the body's
// hips are held back from where they should be, the controller is pulled back to them (pos: the
// controller's spot, moved in place; vel: its speed, which loses whatever was pushing into the blockage).
const _ob = V3(), _ot = V3();
function keepWithBody(pos, vel, dt) {
  const B = body;
  hipMid(B.pos, _ob).sub(hipMid(B.targets, _ot)); _ob.y = 0;
  const d = _ob.length(), slack = 0.15 * S;
  if (d <= slack) return;
  _ob.divideScalar(d);
  const k = Math.min(1, 10 * dt) * (d - slack);
  pos.x += _ob.x * k; pos.z += _ob.z * k;
  const into = vel.x * _ob.x + vel.z * _ob.z;
  if (into < 0) { vel.x -= _ob.x * into; vel.z -= _ob.z * into; }
}

// has the body stopped moving? (for getting back up: the head and torso, since a limb can twitch about)
function bodySpeed() {
  let fast = 0;
  for (const i of [0, 1, 2, 7, 8]) fast = Math.max(fast, body.pos[i].distanceTo(body.prev[i]) / H);
  return fast;
}

// Joints that only move the way real ones do (always: limp, or walking about), so the body never ends up in a
// bone-breaking pose. Knees and elbows are hinges: they only fold one way (knees back, elbows forward) and
// never sideways. Hips and shoulders turn within a human range: legs can't swing up behind the back or cross
// far over each other, and arms can't go far behind the back or through the chest.
const _ja = V3(), _jf = V3(), _jx = V3(), _jr = V3(), _ju = V3(), _jb = V3(), _jd = V3(), _je = V3(), _jc = V3();
const LEG_RANGE = [-1, 1].map(side => ({ side, maxIn: 0.2, maxOut: 0.7, maxBack: 0.3, maxUp: 0.75 }));
const ARM_RANGE = [-1, 1].map(side => ({ side, maxIn: 0.3, maxOut: 1, maxBack: 0.75, maxUp: 1 }));
const _jfw = V3();
function ragLimits(pos, prev) {
  const L = body.len;
  // the torso's own directions: right, up and back
  _ju.addVectors(pos[1], pos[2]).sub(pos[7]).sub(pos[8]).normalize();
  _jr.subVectors(pos[2], pos[1]).add(_jd.subVectors(pos[8], pos[7]));
  _jr.addScaledVector(_ju, -_jr.dot(_ju)).normalize();
  _jb.crossVectors(_jr, _ju);
  _jfw.copy(_jb).negate();
  for (let i = 0; i < 2; i++) {
    limitCone(pos[7 + i], pos[9 + i], prev[9 + i], L[14 + i * 2], LEG_RANGE[i]);
    limitCone(pos[1 + i], pos[3 + i], prev[3 + i], L[10 + i * 2], ARM_RANGE[i]);
    hinge(pos[7 + i], pos[9 + i], pos[11 + i], prev[11 + i], -1);   // knee: folds backwards
    hinge(pos[1 + i], pos[3 + i], pos[5 + i], prev[5 + i], 1);      // elbow: folds forwards
  }
}
// Each fix-up nudges the joint gently, and moves its "last position" by the same amount, so straightening a
// joint never counts as speed (otherwise the limits and the bones fight and the body shakes itself to bits).
function nudge(p, q, target, k) {
  _jc.subVectors(target, p).multiplyScalar(k);
  p.add(_jc); q.add(_jc);
}
function limitCone(a, b, bPrev, len, L) {
  _jd.subVectors(b, a);
  let x = _jd.dot(_jr) * L.side, y = _jd.dot(_ju), z = _jd.dot(_jb);   // x: outwards, y: up, z: backwards
  const n = Math.hypot(x, y, z) || 1; x /= n; y /= n; z /= n;
  let bad = false;
  if (x < -L.maxIn) { x = -L.maxIn; bad = true; }
  if (x > L.maxOut) { x = L.maxOut; bad = true; }
  if (z > L.maxBack) { z = L.maxBack; bad = true; }
  if (y > L.maxUp) { y = L.maxUp; bad = true; }
  if (!bad) return;
  _jd.set(0, 0, 0).addScaledVector(_jr, x * L.side).addScaledVector(_ju, y).addScaledVector(_jb, z).normalize();
  nudge(b, bPrev, _je.copy(a).addScaledVector(_jd, len), 0.35);
}
// A hinge (knee or elbow, joint j between bones a-j and j-e). Its axis runs across the body, square to the
// upper bone; with the limb out to the side, it comes from the bone and the body's forward direction instead
// (the two blend smoothly, so the axis never flips). The lower bone is flattened into the plane the hinge
// swings in (no bending sideways), and if it's folded the wrong way it's straightened out.
function hinge(a, j, e, ePrev, dir) {
  _jd.subVectors(j, a).normalize();
  _jx.copy(_jr).addScaledVector(_jd, -_jr.dot(_jd)).add(_ja.crossVectors(_jd, _jfw));
  if (_jx.lengthSq() < 1e-6) return;
  _jx.normalize();
  _je.subVectors(e, j);
  const lenE = _je.length();
  _je.addScaledVector(_jx, -_je.dot(_jx));                                    // no bending sideways
  if (_jc.crossVectors(_jd, _je).dot(_jx) * dir < 0 || _je.lengthSq() < 1e-8) _je.copy(_jd);   // nor backwards
  nudge(e, ePrev, _jc.copy(j).addScaledVector(_je.normalize(), lenE), 0.5);
}

// a body bumps props about, and props bump it (sharing the push by weight). A prop that hits it hard enough
// (thrown about, or swung by someone else) is a blow: returns that prop (or null).
const _pv = V3(), _pd = V3();
function bodyHitsProps() {
  const B = body;
  let knocked = null;
  for (const pr of props) {
    if (pr.noBody > 0) continue;
    const pel = B.pos[7];
    if (Math.abs(pr.c.x - pel.x) > pr.rad + 2 || Math.abs(pr.c.z - pel.z) > pr.rad + 2) continue;
    // how fast the prop as a whole is going (its middle: not a corner, which whips round fast when a rock
    // you've kicked or trodden on tumbles), to tell a rock flung at you from one you've run into
    _pv.set(0, 0, 0);
    for (let k = 0; k < pr.pts.length; k++) _pv.add(pr.pts[k]).sub(pr.prev[k]);
    _pv.divideScalar(pr.pts.length * H);
    for (let i = 0; i < 13; i++) {
      const holding = pr.held && pr.heldBy === B;
      if (holding && i >= 3 && i <= 6) continue;   // (what you're holding doesn't push your arms away)
      // (nor does a rock you've only just let go of, or are swinging, count as hitting you)
      const mine = holding || (pr.lastBy === B && pr.grace > 0);
      // (how fast it's coming at this bit of you: running into a rock lying there isn't being hit by it)
      _pd.subVectors(B.pos[i], pr.c).normalize();
      const pv = _pv.dot(_pd);
      const depth = pointIntoProp(B.pos[i], B.prev[i], B.R[i], PROP_MASS_BODY, pr, 0.1, 0.9, true, 0.012);
      // (anyone else gets knocked flat by a rock you swing at them)
      const fast = mine ? Infinity : pr.held ? 3.5 / (1 + pr.mass / 6) : pr.type === 'ball' ? 11 : 7;
      if (depth && pv > fast && pr.mass >= 0.5) knocked = pr;
    }
  }
  return knocked;
}
