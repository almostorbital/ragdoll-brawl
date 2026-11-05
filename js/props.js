// Things you can pick up and throw: crates and balls.
// A crate is its 8 corners joined by sticks (every corner to every other), so it tumbles, lands on a corner,
// rolls over and settles like a real box. A ball is one point with a radius that rolls.
// Props that have stopped moving go to sleep (frozen exactly where they are) until something bumps them,
// so a stack of crates stays stacked instead of slowly jiggling itself over.
'use strict';
const props = [];
const PROP_MASS_BODY = 6;   // (each of the body's 13 points weighs about this much)

function addCrate(x, y, z, w, h, d, color, mass, name = 'crate') {
  const mesh = outline(new THREE.Mesh(roundedBox(w, h, d, Math.min(w, h, d) * 0.08), crateMaterial(color)), 0.025);
  mesh.castShadow = mesh.receiveShadow = true; scene.add(mesh);
  const local = [], pts = [], prev = [];
  for (let i = 0; i < 8; i++) {
    const l = V3((i & 1 ? 0.5 : -0.5) * w, (i & 2 ? 0.5 : -0.5) * h, (i & 4 ? 0.5 : -0.5) * d);
    local.push(l); pts.push(l.clone().add(V3(x, y, z))); prev.push(pts[i].clone());
  }
  const sticks = [];
  for (let a = 0; a < 8; a++) for (let b = a + 1; b < 8; b++) sticks.push([a, b, local[a].distanceTo(local[b])]);
  const pr = { type: 'box', name, mesh, local, pts, prev, sticks, mass, bounce: 0.15, fric: 0.6, noBody: 0, held: false };
  setOBB(pr, V3(), new THREE.Quaternion(), V3(w / 2, h / 2, d / 2));
  props.push(pr); boxFrame(pr);
  return pr;
}

function addBall(x, y, z, r, color, mass, name = 'ball') {
  const tex = ballTexture(color);
  const mesh = outline(new THREE.Mesh(new THREE.SphereGeometry(r, 24, 16), toonM({ map: tex })), 0.025);
  mesh.castShadow = mesh.receiveShadow = true; scene.add(mesh);
  const p = V3(x, y, z);
  const pr = { type: 'ball', name, mesh, pts: [p], prev: [p.clone()], r, mass, bounce: 0.6, fric: 0.985, q: new THREE.Quaternion(), noBody: 0, held: false };
  pr.c = p; pr.rad = r;
  props.push(pr);
  return pr;
}

// a rock you can pick up (and smack someone with): it tumbles like a crate, but looks like a lumpy rock
const rockMat = () => rockMat.m || (rockMat.m = toonM({ color: col(0x9a9aae) }));
function rockGeometry(w, h, d) {
  const g = new THREE.SphereGeometry(0.5, 9, 6), P = g.attributes.position;
  // (each corner pushed in or out by an amount that depends only on where it is, so seams stay closed)
  const lump = (x, y, z) => 0.82 + 0.3 * Math.abs(Math.sin(x * 37.1 + y * 17.3 + z * 23.9) * 43758.5 % 1);
  for (let i = 0; i < P.count; i++) {
    const x = P.getX(i), y = P.getY(i), z = P.getZ(i), k = lump(+x.toFixed(3), +y.toFixed(3), +z.toFixed(3));
    P.setXYZ(i, x * k * w * 1.1, y * k * h * 1.15, z * k * d * 1.1);
  }
  g.computeVertexNormals();
  return g;
}
function addRock(x, z, size, name = 'rock') {
  const w = size, h = size * rand(0.6, 0.8), d = size * rand(0.8, 1);
  const pr = addCrate(x, terrainH(x, z) + h / 2 + 0.05, z, w, h, d, 0, clamp(0.5 + size * size * size * 22, 0.5, 16), name);   // (the big ones are heavy)
  scene.remove(pr.mesh);
  pr.mesh = outline(new THREE.Mesh(rockGeometry(w, h, d), rockMat()), 0.025);
  pr.mesh.castShadow = pr.mesh.receiveShadow = true; scene.add(pr.mesh);
  pr.fric = 0.5; pr.bounce = 0.1;
  return pr;
}

function crateMaterial(color) {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d'), col = new THREE.Color(color);
  g.fillStyle = '#' + col.getHexString(); g.fillRect(0, 0, 64, 64);
  g.strokeStyle = '#' + col.clone().multiplyScalar(0.6).getHexString(); g.lineWidth = 6;
  g.strokeRect(3, 3, 58, 58); g.beginPath(); g.moveTo(3, 3); g.lineTo(61, 61); g.stroke();
  const t = new THREE.CanvasTexture(c); t.encoding = THREE.sRGBEncoding;
  return toonM({ map: t });
}
function ballTexture(color) {
  const c = document.createElement('canvas'); c.width = 128; c.height = 64;
  const g = c.getContext('2d'), cols = ['#ffffff', '#' + new THREE.Color(color).getHexString()];
  for (let i = 0; i < 6; i++) { g.fillStyle = cols[i % 2]; g.fillRect(i * 128 / 6, 0, 128 / 6 + 1, 64); }
  const t = new THREE.CanvasTexture(c); t.encoding = THREE.sRGBEncoding;
  return t;
}

// a crate's centre, axes and rotation, worked out from where its corners are now
const _bm = new THREE.Matrix4();
function boxFrame(pr) {
  const P = pr.pts, c = pr.c.set(0, 0, 0);
  for (const p of P) c.add(p);
  c.multiplyScalar(1 / 8);
  const ax = pr.ax.set(0, 0, 0), ay = pr.ay.set(0, 0, 0);
  for (let i = 0; i < 8; i++) {
    ax.addScaledVector(P[i], i & 1 ? 1 : -1);
    ay.addScaledVector(P[i], i & 2 ? 1 : -1);
  }
  ax.normalize(); ay.addScaledVector(ax, -ay.dot(ax)).normalize();
  pr.az.crossVectors(ax, ay);
  _bm.makeBasis(ax, ay, pr.az); pr.q.setFromRotationMatrix(_bm);
}

// ---------------------------------------------------------------- simulation (one small step)
function stickBox(pr, iters) {
  const P = pr.pts;
  for (let it = 0; it < iters; it++) for (const [a, b, len] of pr.sticks) {
    _d.subVectors(P[b], P[a]);
    const d = _d.length() || 1e-6;
    _d.multiplyScalar((d - len) / d * 0.5);
    P[a].add(_d); P[b].sub(_d);
  }
}

function wake(pr) { if (pr.sleep) { pr.sleep = false; pr.calm = 0; } }
function propSpeed(pr) {
  let v = 0;
  for (let i = 0; i < pr.pts.length; i++) v = Math.max(v, pr.pts[i].distanceToSquared(pr.prev[i]));
  return Math.sqrt(v) / H;
}

function stepProps() {
  const h2 = H * H;
  for (const pr of props) {
    if (pr.noBody > 0) pr.noBody -= H;
    if (pr.grace > 0) pr.grace -= H;
    if (pr.sleep) continue;
    if (pr.netT > 0) { pr.netT -= H; continue; }   // (online: the other player's rock, moved by their messages. See net.js)
    windOnProp(pr);
    for (let i = 0; i < pr.pts.length; i++) {
      const p = pr.pts[i], q = pr.prev[i];
      const vx = (p.x - q.x) * 0.999, vy = (p.y - q.y) * 0.999, vz = (p.z - q.z) * 0.999;
      q.copy(p);
      p.x += vx; p.y += vy - G * h2; p.z += vz;
    }
    if (pr.type === 'box') {
      stickBox(pr, 3);
      for (let i = 0; i < 8; i++) collideWorld(pr.pts[i], pr.prev[i], 0.01, pr.bounce, pr.fric);
      stickBox(pr, 2);
    } else {
      pr.onGround = collideWorld(pr.pts[0], pr.prev[0], pr.r, pr.bounce, pr.fric) > 0.5;
    }
    if (pr.c.y < -40) respawnProp(pr);   // (off the island)
    // nearly still for a moment: go to sleep
    pr.calm = propSpeed(pr) < 0.25 && !pr.held ? (pr.calm || 0) + H : 0;
    if (pr.calm > 0.5) { pr.sleep = true; pr.prev.forEach((q, i) => q.copy(pr.pts[i])); }
  }
  // props bump into each other
  for (const pr of props) if (pr.type === 'box') boxFrame(pr);
  for (let a = 0; a < props.length; a++) for (let b = a + 1; b < props.length; b++) {
    const A = props[a], B = props[b];
    if (A.sleep && B.sleep) continue;
    if (A.c.distanceToSquared(B.c) > (A.rad + B.rad) ** 2) continue;
    // something moving into a sleeping prop: a real knock wakes it; something just settling onto it (a crate
    // landing on the stack) treats it as solid ground
    // (and something in your hands always wakes what it bumps)
    if (A.sleep !== B.sleep && (propSpeed(A.sleep ? B : A) > 1.5 || A.held || B.held || A.type === 'ball' || B.type === 'ball')) { wake(A); wake(B); }
    if (A.type === 'ball' && B.type === 'ball') ballBall(A, B);
    else if (A.type === 'box' && B.type === 'box') { if (!A.sleep) boxCorners(A, B); if (!B.sleep) boxCorners(B, A); }
    else if (A.type === 'ball') pointIntoProp(A.pts[0], A.prev[0], A.r, A.mass, B, 0.3, 0.9, false);
    else pointIntoProp(B.pts[0], B.prev[0], B.r, B.mass, A, 0.3, 0.9, false);
  }
}

function ballBall(A, B) {
  const pa = A.pts[0], pb = B.pts[0];
  _d.subVectors(pa, pb);
  const d = _d.length(), m = A.r + B.r;
  if (d >= m || d < 1e-6) return;
  _d.divideScalar(d);
  const k = m - d, wa = B.mass / (A.mass + B.mass);
  pa.addScaledVector(_d, k * wa); pb.addScaledVector(_d, -k * (1 - wa));
}
// every corner of crate A that's sunk into crate B
function boxCorners(A, B) {
  const per = A.mass / 8;
  for (let i = 0; i < 8; i++) pointIntoProp(A.pts[i], A.prev[i], 0.02, per * 2, B, 0.05, 0.7, false);
}

// A ball of radius r at p (with mass m) is sunk into prop pr: push them apart, sharing the push by weight.
// The point gets a proper contact (friction, bounce); the prop is shoved, more at the corners nearest the
// contact, so a hit near one end spins it. Returns the depth (0 if not touching), with CN pointing at p.
// A sleeping prop is woken by the push if `wakes` (your body), otherwise it holds still like the ground.
const _pn = V3();
// (maxPush: the most a point is moved out in one step; a body's points come out gently, or the jolt flings it)
function pointIntoProp(p, prev, r, m, pr, bounce, fric, wakes = true, maxPush = Infinity) {
  let depth;
  if (pr.type === 'box') depth = obbContact(pr, p, r);
  else {
    _d.subVectors(p, pr.pts[0]);
    const d = _d.length(), R = r + pr.r;
    if (d >= R || d < 1e-6) return 0;
    CN.copy(_d).divideScalar(d); depth = R - d;
  }
  if (!depth) return 0;
  const full = depth;
  depth = Math.min(depth, maxPush);
  if (pr.sleep && wakes && depth > 0.004) wake(pr);
  _pn.copy(CN);
  const wp = pr.sleep ? 1 : pr.mass / (pr.mass + m);
  resolve(p, prev, _pn, depth * wp, bounce, fric);
  shoveProp(pr, p, _pn, -depth * (1 - wp));
  CN.copy(_pn);
  return full;
}
const _sw = [];
function shoveProp(pr, at, n, amount) {
  if (pr.type === 'ball') { pr.pts[0].addScaledVector(n, amount); return; }
  let sum = 0;
  for (let i = 0; i < 8; i++) { _sw[i] = 1 / (pr.pts[i].distanceTo(at) + 0.25); sum += _sw[i]; }
  for (let i = 0; i < 8; i++) pr.pts[i].addScaledVector(n, amount * _sw[i] * 8 / sum);
}

// ---------------------------------------------------------------- showing them
const _rq = new THREE.Quaternion(), _rv = V3();
function drawProps(dt) {
  for (const pr of props) {
    if (pr.type === 'box') { boxFrame(pr); pr.mesh.position.copy(pr.c); pr.mesh.quaternion.copy(pr.q); continue; }
    // a ball rolls: it turns by how far it's moved along the ground
    const p = pr.pts[0], q = pr.prev[0];
    if (pr.onGround && !pr.held) {
      _rv.set(p.z - q.z, 0, -(p.x - q.x));
      const dist = _rv.length() / H * dt;
      if (dist > 1e-5) { _rq.setFromAxisAngle(_rv.normalize(), dist / pr.r); pr.q.premultiply(_rq); }
    }
    pr.mesh.position.copy(p); pr.mesh.quaternion.copy(pr.q);
  }
}

// put a prop back where it started (if it falls off the island)
function respawnProp(pr) {
  const at = pr.home, off = at.clone().sub(pr.c);
  for (let i = 0; i < pr.pts.length; i++) { pr.pts[i].add(off); pr.prev[i].copy(pr.pts[i]); }
  if (pr.type === 'box') boxFrame(pr);
}

// rocks lying all over the island, little to huge: pebbles you can swing about, rocks you can lift over your
// head, and big ones that take everything you've got just to drag
function buildProps() {
  const kinds = [[0.18, 0.28, 16], [0.32, 0.5, 19], [0.6, 0.8, 9], [0.9, 1.2, 5]];   // [smallest, biggest, how many]
  const placed = [];
  for (const [lo, hi, n] of kinds) {
    for (let k = 0, tries = 0; k < n && tries < 400; tries++) {
      const p = islandSpot(-1.5), size = rand(lo, hi); if (!p) continue; const [x, z] = p;
      if (!onIsland(x, z, -1.5 - size) || Math.hypot(x, z - 5) < 3) continue;   // (on the island, not where you start)
      if (solids.some(s => !s.noGrab && Math.hypot(s.c.x - x, s.c.z - z) < s.rad + size)) continue;
      if (placed.some(([px, pz, ps]) => Math.hypot(px - x, pz - z) < ps + size + 0.4)) continue;
      const name = size < 0.3 ? 'little rock' : size < 0.55 ? 'rock' : size < 0.85 ? 'big rock' : 'huge rock';
      addRock(x, z, size, name);
      placed.push([x, z, size]); k++;
    }
  }
  for (const pr of props) { pr.home = pr.c.clone(); pr.sleep = true; }
}
