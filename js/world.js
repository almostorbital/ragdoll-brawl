// The level, and colliding with it.
// Everything solid is a box (an "OBB": a box that can be turned any way, so ramps are just tilted boxes).
// A point with a radius (a body part, a crate corner, a ball) is pushed out of any box it sinks into.
'use strict';
// how far down you can fall before you're out (way down into the sky)
const FALL_Y = -30, RINGOUT_Y = -35;
const solids = [];        // {c: centre, q: rotation, h: half sizes, ax/ay/az: its axes, rad, mesh, noGrab}
const solidMeshes = [];   // (for the camera, so it doesn't go behind walls)

// fill in a box's axes from its centre, rotation and half sizes
function setOBB(o, c, q, h) {
  o.c = c; o.q = q; o.h = h;
  o.ax = V3(1, 0, 0).applyQuaternion(q); o.ay = V3(0, 1, 0).applyQuaternion(q); o.az = V3(0, 0, 1).applyQuaternion(q);
  o.rad = h.length();
  return o;
}

// A box with softly rounded edges (it collides as a plain box: the rounding is only a few centimetres).
// The box is cut into a narrow band of strips along every edge, and those are bent round onto a curve.
function roundedBox(w, h, d, r) {
  const bands = 2, seg = bands * 2 + 1;
  const g = new THREE.BoxGeometry(w, h, d, seg, seg, seg);
  const P = g.attributes.position, N = g.attributes.normal, v = V3(), c = V3(), n = V3();
  const half = [w / 2, h / 2, d / 2];
  // move the grid lines so the outer strips are exactly r wide
  const remap = (u, W) => {
    const i = Math.round((u + W) / (2 * W) * seg), inner = W - r;
    if (i <= bands) return -W + i / bands * r;
    if (i >= seg - bands) return inner + (i - (seg - bands)) / bands * r;
    return -inner + (i - bands) / (seg - 2 * bands) * 2 * inner;
  };
  for (let i = 0; i < P.count; i++) {
    v.set(remap(P.getX(i), half[0]), remap(P.getY(i), half[1]), remap(P.getZ(i), half[2]));
    c.set(clamp(v.x, -half[0] + r, half[0] - r), clamp(v.y, -half[1] + r, half[1] - r), clamp(v.z, -half[2] + r, half[2] - r));
    n.subVectors(v, c);
    if (n.lengthSq() < 1e-12) continue;
    n.normalize();
    v.copy(c).addScaledVector(n, r);
    P.setXYZ(i, v.x, v.y, v.z); N.setXYZ(i, n.x, n.y, n.z);
  }
  return g;
}

function addBox(x, y, z, w, h, d, color, rx = 0, ry = 0, rz = 0, material) {
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz, 'YXZ'));
  const r = Math.min(0.06, Math.min(w, h, d) * 0.3);
  const geo = Array.isArray(material) ? new THREE.BoxGeometry(w, h, d) : roundedBox(w, h, d, r);
  const mesh = new THREE.Mesh(geo, material || mat(color));
  if (!Array.isArray(material)) outline(mesh);
  mesh.position.set(x, y, z); mesh.quaternion.copy(q);
  mesh.castShadow = mesh.receiveShadow = true;
  scene.add(mesh); solidMeshes.push(mesh);
  const s = setOBB({ mesh, bounce: 0.1 }, V3(x, y, z), q, V3(w / 2, h / 2, d / 2));
  solids.push(s);
  return s;
}

// a ramp centred at (cx, cz), `len` long and `wid` wide, climbing `rise` toward the direction `ry` faces
function addRamp(cx, cz, len, wid, rise, ry, color) {
  const t = 0.3, ang = Math.atan2(rise, len), slab = Math.hypot(len, rise);
  return addBox(cx, rise / 2 - t / 2 / Math.cos(ang), cz, wid, t, slab, color, ang, ry);
}

// ---------------------------------------------------------------- contacts
// How deep is a ball of radius r at p sunk into box s? Returns the depth (0 if not touching)
// and leaves the direction to push it out in CN.
const CN = V3(), _d = V3();
function obbContact(s, p, r) {
  _d.subVectors(p, s.c);
  const R = s.rad + r;
  if (_d.lengthSq() > R * R) return 0;
  const lx = _d.dot(s.ax), ly = _d.dot(s.ay), lz = _d.dot(s.az), h = s.h;
  if (Math.abs(lx) > h.x + r || Math.abs(ly) > h.y + r || Math.abs(lz) > h.z + r) return 0;
  const cx = clamp(lx, -h.x, h.x), cy = clamp(ly, -h.y, h.y), cz = clamp(lz, -h.z, h.z);
  let nx = lx - cx, ny = ly - cy, nz = lz - cz, depth;
  const dist = Math.hypot(nx, ny, nz);
  if (dist > 1e-6) {
    if (dist >= r) return 0;
    nx /= dist; ny /= dist; nz /= dist; depth = r - dist;
  } else {
    // the centre is inside the box: out through the nearest face
    const ex = h.x - Math.abs(lx), ey = h.y - Math.abs(ly), ez = h.z - Math.abs(lz);
    nx = ny = nz = 0;
    if (ex <= ey && ex <= ez) { nx = Math.sign(lx) || 1; depth = ex + r; }
    else if (ey <= ez) { ny = Math.sign(ly) || 1; depth = ey + r; }
    else { nz = Math.sign(lz) || 1; depth = ez + r; }
  }
  CN.set(0, 0, 0).addScaledVector(s.ax, nx).addScaledVector(s.ay, ny).addScaledVector(s.az, nz);
  return depth;
}

// push a moving point out along n, then stop it moving into the surface (with a bounce), and rub off some
// of its sliding speed (friction). Its speed is the gap between where it is and where it was (Verlet).
function resolve(p, prev, n, depth, bounce, fric) {
  const vx = p.x - prev.x, vy = p.y - prev.y, vz = p.z - prev.z;
  p.addScaledVector(n, depth);
  const vn = vx * n.x + vy * n.y + vz * n.z;
  if (vn >= 0) { prev.set(p.x - vx, p.y - vy, p.z - vz); return; }
  let tx = (vx - n.x * vn) * fric, ty = (vy - n.y * vn) * fric, tz = (vz - n.z * vn) * fric;
  tx -= n.x * vn * bounce; ty -= n.y * vn * bounce; tz -= n.z * vn * bounce;
  prev.set(p.x - tx, p.y - ty, p.z - tz);
}

// collide a point with the whole level; returns how "floor-like" the steepest thing it's resting on is
// (1 = flat ground, 0 = touching nothing or only walls)
let lastSolid = null;
function collideWorld(p, prev, r, bounce = 0.1, fric = 0.8) {
  let ground = 0;
  // the island's lawn, hills and all (and its cliffs, just below the edge)
  if (p.y < TERRAIN_MAX + r && p.y > -ISLAND_DEPTH) {
    const D = islandD(p.x, p.z);   // (how far out past the edge)
    const h = D < r ? terrainH(p.x, p.z) : 0;
    if (D < r && p.y < h + r) {
      if (p.y > h - 0.6 || D < -0.6) {
        if (D < 0) {
          // the ground's slope here (from the heights either side), and push out along it
          const e = 0.05, gx = (terrainH(p.x + e, p.z) - terrainH(p.x - e, p.z)) / (2 * e), gz = (terrainH(p.x, p.z + e) - terrainH(p.x, p.z - e)) / (2 * e);
          CN.set(-gx, 1, -gz).normalize();
          const surf = patches.length ? surfaceAt(p.x, p.z) : null;   // (mud grips)
          resolve(p, prev, CN, (h + r - p.y) * CN.y, bounce, surf ? SURF[surf].fric : fric); ground = CN.y; lastSolid = ISLAND;
        }
      } else {
        islandOut(p.x, p.z, CN); resolve(p, prev, CN, r - D, bounce, fric);   // (pushed out of the cliff side)
      }
    }
  }
  for (const s of solids) {
    const depth = obbContact(s, p, r);
    if (!depth) continue;
    resolve(p, prev, CN, depth, bounce, fric);
    if (CN.y > ground) { ground = CN.y; lastSolid = s; }
  }
  return ground;
}

// the height of the floor under (x, z): the highest surface below y + up (so you can step up onto things
// lower than that). Also checks `extra` boxes (crates you could stand on). -Infinity if there's no floor.
const _ray = new THREE.Ray(), _box3 = new THREE.Box3(), _hit = V3(), _qi = new THREE.Quaternion();
let groundSolid = null;
function rayDown(s, x, y, z) {
  _qi.copy(s.q).invert();
  _ray.origin.set(x - s.c.x, y - s.c.y, z - s.c.z).applyQuaternion(_qi);
  _box3.min.copy(s.h).negate(); _box3.max.copy(s.h);
  if (_box3.containsPoint(_ray.origin)) return -Infinity;   // (starting inside: that's a wall, not a floor)
  _ray.direction.set(0, -1, 0).applyQuaternion(_qi);
  if (!_ray.intersectBox(_box3, _hit)) return -Infinity;
  return _hit.applyQuaternion(s.q).y + s.c.y;
}
function groundAt(x, y, z, up = 0.45, extra) {
  let best = -Infinity; groundSolid = null;
  if (onIsland(x, z)) {
    const h = terrainH(x, z);
    if (y + up >= h - 2) { best = h; groundSolid = ISLAND; }   // (-2: if a fast fall carried you just past the top in one step, you still land)
  }
  const check = s => {
    if (Math.abs(x - s.c.x) > s.rad || Math.abs(z - s.c.z) > s.rad) return;
    const g = rayDown(s, x, y + up, z);
    if (g > best) { best = g; groundSolid = s; }
  };
  solids.forEach(check);
  if (extra) extra.forEach(check);
  return best;
}

// ---------------------------------------------------------------- the level
// canvas textures: a speckly noise over a base colour (each pixel a little lighter or darker)
function noiseCanvas(size, base, amount, extra) {
  const c = document.createElement('canvas'); c.width = c.height = size;
  const g = c.getContext('2d');
  g.fillStyle = base; g.fillRect(0, 0, size, size);
  if (extra) extra(g, size);
  const img = g.getImageData(0, 0, size, size), D = img.data;
  for (let i = 0; i < D.length; i += 4) {
    const k = 1 + (Math.random() - 0.5) * amount;
    D[i] *= k; D[i + 1] *= k; D[i + 2] *= k;
  }
  g.putImageData(img, 0, 0);
  return c;
}
function canvasTexture(c, repeat) {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(repeat, repeat); t.anisotropy = 8;
  t.encoding = THREE.sRGBEncoding;
  return t;
}
// the island's cliffs: chocolatey earth with a wavy darker band and a few pebbles
function dirtTexture() {
  return canvasTexture(noiseCanvas(128, '#a8703f', 0, (g, n) => {
    g.fillStyle = '#8c5a30';
    g.beginPath(); g.moveTo(0, n * 0.55);
    for (let x = 0; x <= n; x += 8) g.lineTo(x, n * 0.55 + Math.sin(x / n * Math.PI * 4) * 6);
    g.lineTo(n, n); g.lineTo(0, n); g.fill();
    g.fillStyle = '#c99a6a';
    for (let i = 0; i < 8; i++) { g.beginPath(); g.arc(Math.random() * n, Math.random() * n * 0.5, 2 + Math.random() * 3, 0, 7); g.fill(); }
  }), 8);
}

// the sky: a big dome, deep blue overhead fading to pale at the horizon, with a warm glow round the sun
function buildSky() {
  const m = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { below: { value: col(0x6fb8ff) }, top: { value: col(0x3d9cff) }, horizon: { value: HORIZON }, sun: { value: SUN_DIR }, glow: { value: col(0xfff2cf) } },
    vertexShader: 'varying vec3 vDir; void main() { vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `uniform vec3 below, top, horizon, sun, glow; varying vec3 vDir;
      void main() {
        float h = max(vDir.y, 0.0);
        vec3 c = mix(horizon, top, pow(h, 0.55));
        c = mix(c, below, pow(max(-vDir.y, 0.0), 0.7));   // (and down below the island, more sky)
        float s = max(dot(normalize(vDir), sun), 0.0);
        c += glow * (step(0.9992, s) * 1.5 + pow(s, 30.0) * 0.25);   // (a solid cartoon sun, and a soft glow)
        gl_FragColor = vec4(c, 1.0);
      }`,
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(400, 32, 16), m);
  sky.renderOrder = -1; scene.add(sky);
  return sky;
}

// puffy clouds drifting by
const clouds = [];
function buildClouds() {
  const m = toonM({ color: col(0xffffff), emissive: col(0x8a9bb0), emissiveIntensity: 0.6 });
  for (let i = 0; i < 24; i++) {
    const g = new THREE.Group();
    const n = 4 + Math.floor(Math.random() * 4);
    for (let k = 0; k < n; k++) {
      const b = new THREE.Mesh(new THREE.SphereGeometry(rand(3, 6), 10, 7), m);   // (far away: a simple ball does)
      b.position.set(k * rand(3, 4.5) - n * 1.8, rand(-1, 1.5), rand(-2, 2)); b.scale.y = 0.6;
      g.add(b);
    }
    const a = Math.random() * Math.PI * 2, r = rand(60, 170);
    g.position.set(Math.cos(a) * r, i % 3 === 0 ? rand(-45, -20) : rand(25, 55), Math.sin(a) * r);
    g.rotation.y = Math.random() * Math.PI;
    scene.add(g); clouds.push(g);
  }
}

// trees and big boulders round the island, and a few trees in among everything (solid: you can bump into
// them and grab the trunks)
const treeLeaves = [], TREES = [];
function buildScenery() {
  const trunkM = mat(0x9b6234), leafMs = [0x4fc24a, 0x3fae3f, 0x6ad65a].map(c => mat(c));
    const clear = (x, z, r) => solids.every(s => s.noGrab || Math.hypot(s.c.x - x, s.c.z - z) > s.rad + r);
  let trees = 0, rocks = 0;
  for (let tries = 0; tries < 1500 && (trees < 18 || rocks < 13); tries++) {
    const p = islandSpot(-2.5); if (!p) continue;
    const [x, z] = p, edge = -islandD(x, z);
    if (edge < 2.5 || (edge > 7 && tries % 3)) continue;   // (mostly round the edge, some further in)
    if (Math.hypot(x, z - 5) < 5) continue;   // (not where you start)
    const y0 = terrainH(x, z) - 0.1;
    if (trees < 18 && clear(x, z, 2.5)) {
      const h = rand(1.6, 2.6), s = rand(0.9, 1.4);
      // (each tree has its own materials, so it can fade out on its own when it's in the way: see fadeTrees)
      const tm = trunkM.clone(), lm = leafMs[Math.floor(Math.random() * 3)].clone();
      const T = { x, z, y0, top: y0 + h + 1.9 * s, r: 1.5 * s, mats: [tm, lm], meshes: [], a: 1 };
      const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.16 * s, 0.24 * s, h, 8), tm);
      trunk.position.set(x, y0 + h / 2, z); trunk.castShadow = true; scene.add(outline(trunk)); T.meshes.push(trunk);
      for (let k = 0; k < 3; k++) {
        const leaf = new THREE.Mesh(new THREE.SphereGeometry(rand(0.8, 1.15) * s, 12, 8), lm);
        leaf.position.set(x + rand(-0.5, 0.5) * s, y0 + h + rand(0.1, 0.9) * s, z + rand(-0.5, 0.5) * s);
        leaf.rotation.set(Math.random() * 3, Math.random() * 3, 0);
        leaf.castShadow = leaf.receiveShadow = true; scene.add(outline(leaf)); T.meshes.push(leaf);
        leaf.userData.base = leaf.position.clone(); treeLeaves.push(leaf);   // (they sway in the wind: see nature.js)
      }
      TREES.push(T);
      const box = addBox(x, y0 + h / 2, z, 0.4 * s, h, 0.4 * s, 0); box.mesh.visible = false;   // (its trunk, to bump into)
      trees++;
    } else if (rocks < 13 && clear(x, z, 3)) {
      // a big boulder (too big to pick up: climb on it, or bash someone into it)
      const w = rand(1.6, 2.8), h = w * rand(0.55, 0.8), d = w * rand(0.8, 1.1), ry = Math.random() * 3;
      const rock = new THREE.Mesh(rockGeometry(w, h, d), rockMat());
      rock.position.set(x, y0 + h * 0.4, z); rock.rotation.y = ry;
      rock.castShadow = rock.receiveShadow = true; scene.add(outline(rock, 0.04));
      const box = addBox(x, y0 + h * 0.4, z, w * 0.9, h * 0.95, d * 0.9, 0, 0, ry); box.mesh.visible = false;
      rocks++;
    }
  }
}

// The island: a lawn floating high in the sky, on a great craggy lump of rock and earth hanging down underneath.
// Walk (or get punched) off the edge and down you go.
// Its shape is different every time: long, four lumps in a row (you start in the middle), more lumps
// stuck on (some joined on broadly, some out on the end of a skinny neck of land), and a skinny spit or two sticking out into
// the sky. (Fight someone out along one of those!)
// It isn't one of the boxes. How far any spot is from the edge (islandD: below 0 on the island, above 0 out
// in the sky) is worked out once, into a fine grid. Anything inside the edge and near the ground stands on it
// (see collideWorld, groundAt). The ground rolls: rounded hills and long ridges. How high it is: terrainH.
const ISLAND_DEPTH = 6, ISLAND = { noGrab: true };
const ISLE = { parts: [], x0: 0, z0: 0, cell: 0.25, nx: 0, nz: 0, d: null, edge: [] };
const smin = (a, b, k) => { const h = Math.max(k - Math.abs(a - b), 0) / k; return Math.min(a, b) - h * h * k / 4; };   // (a smooth join)

function planIsland() {
  const parts = ISLE.parts;
  const blob = (x, z, r) => parts.push({ x, z, r, p1: rand(0, 7), p2: rand(0, 7) });
  const neck = (x, z, a, d0, d1, w0, w1) => parts.push({ neck: true, x0: x + Math.cos(a) * d0, z0: z + Math.sin(a) * d0, x1: x + Math.cos(a) * d1, z1: z + Math.sin(a) * d1, w0, w1 });
  // the long middle: four lumps in a row, with a bit of a bend in it (you start between the middle two)
  const ax = Math.random() * Math.PI * 2, L = rand(12, 14), bend = rand(-0.12, 0.12), spine = [];
  for (const t of [-1.5, -0.5, 0.5, 1.5]) {
    const a = ax + bend * t * Math.abs(t), r = Math.abs(t) > 1 ? rand(8, 10) : rand(9.5, 11);
    const x = t * Math.cos(a) * L, z = 2 + t * Math.sin(a) * L;
    blob(x, z, r); spine.push({ x, z, r, out: ax + (t < 0 ? Math.PI : 0) + bend * t * 2 });
  }
  // places to stick more on: off both ends first (longer still), then either side of the lumps
  const sides = [];
  spine.forEach(s => { for (const side of [-1, 1]) sides.push({ s, a: ax + side * Math.PI / 2 + rand(-0.35, 0.35) }); });
  sides.sort(() => Math.random() - 0.5);
  const slots = [{ s: spine[0], a: spine[0].out + rand(-0.3, 0.3) }, { s: spine[3], a: spine[3].out + rand(-0.3, 0.3) }, ...sides];
  // (all joined on broadly: no skinny bits sticking out)
  const n = 2 + Math.floor(Math.random() * 3);
  for (let k = 0; k < n; k++) {
    const { s, a } = slots[k], r = rand(5, 8.5), d = s.r + r * rand(0.15, 0.5);
    blob(s.x + Math.cos(a) * d, s.z + Math.sin(a) * d, r);
  }
}
// how far (x, z) is from the edge, worked out from the shapes (slow: islandD looks it up in the grid instead)
function islandDist(x, z) {
  let d = 1e9;
  for (const s of ISLE.parts) {
    let e;
    if (s.neck) {
      const dx = s.x1 - s.x0, dz = s.z1 - s.z0, t = clamp(((x - s.x0) * dx + (z - s.z0) * dz) / (dx * dx + dz * dz), 0, 1);
      e = Math.hypot(s.x0 + dx * t - x, s.z0 + dz * t - z) - (s.w0 + (s.w1 - s.w0) * t);
    } else {
      const a = Math.atan2(z - s.z, x - s.x);
      e = Math.hypot(x - s.x, z - s.z) - s.r * (1 + 0.09 * Math.sin(3 * a + s.p1) + 0.05 * Math.sin(5 * a + s.p2));
    }
    d = smin(d, e, s.neck ? 1.5 : 3);
  }
  return d + 0.22 * Math.sin(x * 1.3 + Math.sin(z * 0.7) * 2) * Math.sin(z * 1.1 - x * 0.4);   // (a little crinkly)
}
function bakeIsland() {
  const I = ISLE;
  let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9;
  for (const s of I.parts) {
    const pts = s.neck ? [[s.x0, s.z0, s.w0], [s.x1, s.z1, s.w1]] : [[s.x, s.z, s.r * 1.15]];
    for (const [x, z, r] of pts) { x0 = Math.min(x0, x - r); x1 = Math.max(x1, x + r); z0 = Math.min(z0, z - r); z1 = Math.max(z1, z + r); }
  }
  I.x0 = x0 - 4; I.z0 = z0 - 4;
  I.nx = Math.ceil((x1 - x0 + 8) / I.cell) + 1; I.nz = Math.ceil((z1 - z0 + 8) / I.cell) + 1;
  I.d = new Float32Array(I.nx * I.nz);
  for (let j = 0; j < I.nz; j++) for (let i = 0; i < I.nx; i++) I.d[j * I.nx + i] = islandDist(I.x0 + i * I.cell, I.z0 + j * I.cell);
}
function islandD(x, z) {
  const I = ISLE, fx = (x - I.x0) / I.cell, fz = (z - I.z0) / I.cell;
  if (!(fx >= 0 && fz >= 0 && fx < I.nx - 1 && fz < I.nz - 1)) return 9;
  const i = fx | 0, j = fz | 0, u = fx - i, v = fz - j, k = j * I.nx + i, d = I.d;
  return (d[k] * (1 - u) + d[k + 1] * u) * (1 - v) + (d[k + I.nx] * (1 - u) + d[k + I.nx + 1] * u) * v;
}
// which way is out (towards the nearest edge), flat, into out
function islandOut(x, z, out) {
  const e = 0.2;
  out.set(islandD(x + e, z) - islandD(x - e, z), 0, islandD(x, z + e) - islandD(x, z - e));
  const l = out.length(); return l > 1e-6 ? out.divideScalar(l) : out.set(x, 0, z - 2).normalize();
}
// (inside the edge? pad < 0: that far in from it)
const onIsland = (x, z, pad = 0) => islandD(x, z) < pad;
// somewhere on the island, at least -pad in from the edge (or null)
function islandSpot(pad = 0) {
  const I = ISLE;
  for (let k = 0; k < 60; k++) {
    const x = I.x0 + Math.random() * (I.nx - 1) * I.cell, z = I.z0 + Math.random() * (I.nz - 1) * I.cell;
    if (islandD(x, z) < pad) return [x, z];
  }
  return null;
}
// the nearest point on the island's edge to (x, z), into out; returns how far it is
function nearestEdge(x, z, out) {
  let best = 1e9;
  for (const e of ISLE.edge) { const d = Math.hypot(e[0] - x, e[1] - z); if (d < best) { best = d; out.set(e[0], 0, e[1]); } }
  return best;
}

const HILLS = [], RIDGES = [];
let TERRAIN_MAX = 0;
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
function terrainH(x, z) {
  // flat by the edge, and where you start
  const fade = smooth(1, 6, -islandD(x, z)) * smooth(2.5, 6, Math.hypot(x, z - 5));
  if (fade <= 0) return 0;
  let h = 0;
  for (const H of HILLS) { const dx = x - H.x, dz = z - H.z; h += H.h * Math.exp(-(dx * dx + dz * dz) / (2 * H.s * H.s)); }
  for (const Rg of RIDGES) {
    // (distance to the ridge's line, tapering off at its ends)
    const t = clamp(((x - Rg.x0) * Rg.dx + (z - Rg.z0) * Rg.dz) / Rg.len2, 0, 1);
    const px = Rg.x0 + Rg.dx * t - x, pz = Rg.z0 + Rg.dz * t - z, end = Math.sin(t * Math.PI);
    h += Rg.h * (0.35 + 0.65 * end) * Math.exp(-(px * px + pz * pz) / (2 * Rg.s * Rg.s));
  }
  return h * fade;
}
function planTerrain() {
  const edge = (x, z) => -islandD(x, z);
  for (let tries = 0; HILLS.length < 10 && tries < 400; tries++) {
    const p = islandSpot(-2.8), s = rand(2.8, 5);
    if (!p || edge(p[0], p[1]) < s) continue;
    HILLS.push({ x: p[0], z: p[1], s, h: rand(0.4, 1.1) * (s / 4) });
  }
  for (let tries = 0; RIDGES.length < 4 && tries < 400; tries++) {
    const p = islandSpot(-4); if (!p) continue;
    const [x0, z0] = p, a = Math.random() * Math.PI, len = rand(7, 12);
    const x1 = x0 + Math.cos(a) * len, z1 = z0 + Math.sin(a) * len;
    if (edge(x1, z1) < 4 || edge((x0 + x1) / 2, (z0 + z1) / 2) < 4) continue;
    RIDGES.push({ x0, z0, dx: x1 - x0, dz: z1 - z0, len2: len * len, h: rand(0.35, 0.65), s: rand(1.4, 1.9) });
  }
  TERRAIN_MAX = HILLS.reduce((m, H) => m + H.h, 0) + RIDGES.reduce((m, R) => m + R.h, 0);
}

function buildIsland() {
  planIsland(); bakeIsland(); planTerrain();
  // A web of triangles over a grid, every half metre: every square with a corner on the island, with the
  // corners out in the sky pulled in onto the edge (so the edge is smooth, not steps).
  const I = ISLE, g = 0.5, gx = Math.floor((I.nx - 1) * I.cell / g), gz = Math.floor((I.nz - 1) * I.cell / g), W = gx + 1;
  const Dn = new Float32Array(W * (gz + 1)), vid = new Int32Array(W * (gz + 1)).fill(-1), xz = [], _o = V3();
  for (let j = 0; j <= gz; j++) for (let i = 0; i <= gx; i++) Dn[j * W + i] = islandD(I.x0 + i * g, I.z0 + j * g);
  const node = k => {
    if (vid[k] < 0) {
      let x = I.x0 + (k % W) * g, z = I.z0 + Math.floor(k / W) * g;
      if (Dn[k] >= 0) for (let it = 0; it < 5; it++) { const D = islandD(x, z); islandOut(x, z, _o); x -= _o.x * D; z -= _o.z * D; }
      vid[k] = xz.length; xz.push([x, z, Dn[k] >= 0]);
    }
    return vid[k];
  };
  const tris = [];
  const tri = (a, b, c) => {
    if (Dn[a] >= 0 && Dn[b] >= 0 && Dn[c] >= 0) return;   // (all out in the sky: nothing there)
    let A = node(a), B = node(b), C = node(c);
    const p = xz[A], q = xz[B], r = xz[C];
    if ((q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]) > 0) [B, C] = [C, B];   // (facing up)
    tris.push(A, B, C);
  };
  for (let j = 0; j < gz; j++) for (let i = 0; i < gx; i++) {
    const a = j * W + i, b = a + 1, c = a + W + 1, d = a + W;
    if (Dn[a] >= 0 && Dn[b] >= 0 && Dn[c] >= 0 && Dn[d] >= 0) continue;
    if (Dn[a] + Dn[c] <= Dn[b] + Dn[d]) { tri(a, b, c); tri(a, c, d); } else { tri(a, b, d); tri(b, c, d); }
  }
  // the edge: the sides of triangles that no other triangle shares
  const count = new Map(), key = (a, b) => a < b ? a * 1e6 + b : b * 1e6 + a;
  for (let t = 0; t < tris.length; t += 3) for (let e = 0; e < 3; e++) { const k = key(tris[t + e], tris[t + (e + 1) % 3]); count.set(k, (count.get(k) || 0) + 1); }
  const rim = [];
  for (let t = 0; t < tris.length; t += 3) for (let e = 0; e < 3; e++) { const a = tris[t + e], b = tris[t + (e + 1) % 3]; if (count.get(key(a, b)) === 1) rim.push(a, b); }
  const onRim = new Set(rim);
  ISLE.edge = [...onRim].map(v => xz[v]);

  // the ground, raised into hills, in bright green: a little lighter on the tops and darker on steep slopes
  // (so you can see the shape of the land), with big soft patches of a yellower and a bluer green
  const lo = col(0x5cc644), hi = col(0x8fe060), warm = col(0xa8d84a), cool = col(0x48b86a), dark = col(0x3f9a3a), c = new THREE.Color();
  const pos = [], colr = [];
  for (const [x, z] of xz) {
    const h = terrainH(x, z), e = 0.3;
    const slope = Math.hypot(terrainH(x + e, z) - terrainH(x - e, z), terrainH(x, z + e) - terrainH(x, z - e)) / (2 * e);
    pos.push(x, h, z);
    c.copy(lo).lerp(hi, clamp(h / 1.2, 0, 1));
    const pw = Math.sin(x * 0.17 + Math.sin(z * 0.13) * 1.5) * Math.sin(z * 0.19 - x * 0.07);
    if (pw > 0) c.lerp(warm, smooth(0.2, 0.6, pw) * 0.6); else c.lerp(cool, smooth(0.2, 0.6, -pw) * 0.5);
    c.lerp(dark, clamp(slope * 0.9, 0, 0.45));
    colr.push(c.r, c.g, c.b);
  }
  const lg = new THREE.BufferGeometry();
  lg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  lg.setAttribute('color', new THREE.Float32BufferAttribute(colr, 3));
  lg.setIndex(tris); lg.computeVertexNormals();
  const lawn = new THREE.Mesh(lg, toonM({ vertexColors: true }));
  lawn.receiveShadow = true; scene.add(lawn); solidMeshes.push(lawn);

  // the rock underneath: the same web, hanging down: it drops away quickly from the edge, then flattens out into
  // a nearly flat bottom, with just a little bumpiness to it
  const rp = [];
  for (const [x, z, out] of xz) {
    const t = out ? 0 : Math.max(0, -islandD(x, z)), rough = Math.min(1, t / 1.5), e = Math.min(1, t / 2.5);
    const depth = 4.5 * (1 - (1 - e) * (1 - e)) + 0.08 * t;
    const crag = rough * (0.35 * Math.sin(x * 0.7 + z * 0.3) * Math.sin(z * 0.9 - x * 0.2) + 0.15 * Math.sin(x * 2.1 + 1) * Math.sin(z * 1.9));
    rp.push(x, -0.28 - depth - Math.max(-depth * 0.4, crag), z);
  }
  const ri = [];
  for (let t = 0; t < tris.length; t += 3) ri.push(tris[t], tris[t + 2], tris[t + 1]);   // (facing down)
  const ug = new THREE.BufferGeometry();
  ug.setAttribute('position', new THREE.Float32BufferAttribute(rp, 3)); ug.setIndex(ri); ug.computeVertexNormals();
  const rock = new THREE.Mesh(ug, toonM({ color: col(0x8a6a58) }));
  rock.receiveShadow = true; scene.add(outline(rock, 0.08));

  // the turf's edge: a band of green going down from the grass to the rock
  const band = [], bi = [];
  for (let k = 0; k < rim.length; k += 2) {
    const [ax, az] = xz[rim[k]], [bx, bz] = xz[rim[k + 1]], n = band.length / 3;
    band.push(ax, 0.02, az, bx, 0.02, bz, ax, -0.3, az, bx, -0.3, bz);
    bi.push(n, n + 1, n + 2, n + 1, n + 3, n + 2);
  }
  const bg = new THREE.BufferGeometry(); bg.setAttribute('position', new THREE.Float32BufferAttribute(band, 3)); bg.setIndex(bi); bg.computeVertexNormals();
  scene.add(new THREE.Mesh(bg, toonM({ color: col(0x4fae35), side: THREE.DoubleSide })));
  buildGrassBits();
}

// a few clumps of grass tufts dotted about (lots of copies of one small shape: cheap to draw)
function buildGrassBits() {
  const spot = pad => {
    return islandSpot(pad);
  };
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), sv = V3(), pv = V3();
  // tufts: a little fan of blades, a few together
  const blade = new THREE.ConeGeometry(0.05, 0.34, 3); blade.translate(0, 0.17, 0);
  const tufts = new THREE.InstancedMesh(blade, toonM({ color: col(0x8ae25e) }), 900);
  let n = 0;
  for (let k = 0; k < 70 && n < 880; k++) {
    const p = spot(-1.5); if (!p) continue;
    for (let t = 0; t < 4 && n < 880; t++) {
      const x = p[0] + rand(-0.8, 0.8), z = p[1] + rand(-0.8, 0.8), y = terrainH(x, z) - 0.02;
      for (let b = 0; b < 3; b++) {
        e.set(rand(0.2, 0.45), b * 2.1 + Math.random(), 0, 'YXZ'); q.setFromEuler(e);
        tufts.setMatrixAt(n++, m.compose(pv.set(x, y, z), q, sv.setScalar(rand(0.7, 1.2))));
      }
    }
  }
  tufts.count = n; scene.add(tufts);
}

function buildWorld() {
  buildSky();
  buildClouds();
}

// trees and boulders (before the loose rocks, so those keep out of their way)
function decorate() { buildScenery(); }

// A tree between the camera and you (or with the camera inside it) fades almost invisible, so you can always
// see yourself; it fades back in once it's out of the way.
const _fc = V3();
// (blocks: or a test of its own for whether a tree's in the way, if given: see crowd.js)
function fadeTrees(dt, blocks) {
  const a = camera.position, b = cam.target;
  for (const T of TREES) {
    // (does the line from the camera to you pass through the tree: its trunk and its ball of leaves?)
    let inWay = blocks ? blocks(T) : false;
    for (let k = 0; k <= 10 && !inWay && !blocks; k++) {
      _fc.lerpVectors(a, b, k / 10 * 0.92);
      if (_fc.y < T.y0 - 0.3 || _fc.y > T.top + 0.4) continue;
      const r = _fc.y > T.top - 2.4 * T.r ? T.r + 0.4 : 0.6;   // (wide up in the leaves, narrow down the trunk)
      if (Math.hypot(_fc.x - T.x, _fc.z - T.z) < r) inWay = true;
    }
    const want = inWay ? 0.15 : 1;
    if (Math.abs(T.a - want) < 0.005) continue;
    T.a += (want - T.a) * (1 - Math.exp(-8 * dt));
    if (Math.abs(T.a - want) < 0.01) T.a = want;
    const see = T.a < 0.99;
    for (const m of T.mats) { m.transparent = see; m.opacity = T.a; m.depthWrite = !see; }
    for (const m of T.meshes) { m.castShadow = !see || T.a > 0.6; for (const c of m.children) c.visible = !see; }   // (no outline while see-through)
  }
}

function updateWorld(dt) {
  for (const c of clouds) {
    c.position.x += dt * 0.8;
    if (c.position.x > 180) c.position.x = -180;
  }
}
