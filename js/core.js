// Shared helpers, the renderer, the scene, lights and input.
// Every js/ file is a plain script; they share these globals and load in the order listed in index.html.
'use strict';
const $ = id => document.getElementById(id);

// Online (see net.js): you're in a room when the address ends ?room=CODE. Both players' islands have to be
// exactly the same, so while the island's being built, the "random" numbers come from the room code instead
// (the same code, the same numbers, the same island). After that they're properly random again (see main.js).
const ROOM = (new URLSearchParams(location.search).get('room') || '').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 6) || null;
const trueRandom = Math.random;
function roomRandom() {   // (called just before the island's built: see main.js)
  if (!ROOM) return;
  let s = 2166136261;
  for (const c of ROOM) s = Math.imul(s ^ c.charCodeAt(0), 16777619) >>> 0;
  Math.random = () => { s = (s + 0x6D2B79F5) | 0; let t = Math.imul(s ^ s >>> 15, 1 | s); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}
const rand = (a, b) => a + Math.random() * (b - a);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const V3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const UP = V3(0, 1, 0);
const G = 18;          // gravity (a bit more than real life: falls feel snappier)
const H = 1 / 120;     // physics time step
const S = 1.15;        // the character's size (the model is about 1.5 m tall at 1)

// forward and right for something facing `yaw` (yaw 0 faces -z, like the model)
const fwdOf = (yaw, v = V3()) => v.set(-Math.sin(yaw), 0, -Math.cos(yaw));
const rightOf = (yaw, v = V3()) => v.set(Math.cos(yaw), 0, -Math.sin(yaw));

// ---------------------------------------------------------------- rendering
// (smoothing the edges (antialias) is costly on a big screen, and the black outlines keep the edges looking
// clean anyway: so it's only on for smaller screens. And on a sharp phone or laptop screen, no more than 1.5
// pixels per pixel: it looks the same, and it's a lot less to draw)
const PIXEL_RATIO = Math.min(devicePixelRatio, 1.5);
const renderer = new THREE.WebGLRenderer({ antialias: innerWidth * innerHeight * PIXEL_RATIO * PIXEL_RATIO < 2.2e6 });
renderer.setPixelRatio(PIXEL_RATIO);
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputEncoding = THREE.sRGBEncoding;
renderer.toneMapping = THREE.NoToneMapping;   // (cartoon: flat, bright colours straight through)
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const HORIZON = new THREE.Color(0xd4f0ff).convertSRGBToLinear();
scene.fog = new THREE.Fog(HORIZON, 60, 220);   // (the sky itself is a dome: see world.js)
const camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.05, 900);
addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

// colours written as hex are what you'd see on screen (sRGB): convert them for the lighting maths
const col = hex => new THREE.Color(hex).convertSRGBToLinear();
scene.add(new THREE.HemisphereLight(col(0xeaf6ff), col(0xb0c890), 0.55));
// the sun: low enough for long-ish shadows. It follows you about (see updateSun) so its shadows stay sharp.
const SUN_DIR = V3(0.55, 1, 0.4).normalize();
const sun = new THREE.DirectionalLight(col(0xfff6e8), 0.75);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -16, right: 16, top: 16, bottom: -16, near: 1, far: 80 });
sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.02;
scene.add(sun, sun.target);
function updateSun(at) {
  // (snapped to the shadow map's pixels, so shadow edges don't shimmer as you move)
  const snap = 32 / 2048;
  const x = Math.round(at.x / snap) * snap, z = Math.round(at.z / snap) * snap;
  sun.target.position.set(x, 0, z);
  sun.position.set(x, 0, z).addScaledVector(SUN_DIR, 40);
}

// ---------------------------------------------------------------- the cartoon look
// Toon shading: instead of smooth light-to-dark, each surface gets just three flat bands (lit, half-lit,
// shadow), like a cartoon. And everything gets a thick dark outline.
const TOON_RAMP = (() => {
  const d = new Uint8Array([100, 100, 100, 255, 178, 178, 178, 255, 255, 255, 255, 255]);
  const t = new THREE.DataTexture(d, 3, 1, THREE.RGBAFormat);
  t.minFilter = t.magFilter = THREE.NearestFilter; t.generateMipmaps = false; t.needsUpdate = true;
  return t;
})();
// a toon material (options as for any material: color, map, emissive, skinning…)
// Lumpy random noise for shaders (mud): smooth blobs at a few sizes on top of each other, nothing regular
// about it. mudNoise(p) gives 0 to 1, mostly between about 0.2 and 0.8. (Paste MUD_NOISE into a shader.)
const MUD_NOISE = `
  float mudHash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
  float mudVal(vec3 x) {
    vec3 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(mix(mudHash(i), mudHash(i + vec3(1, 0, 0)), f.x), mix(mudHash(i + vec3(0, 1, 0)), mudHash(i + vec3(1, 1, 0)), f.x), f.y),
               mix(mix(mudHash(i + vec3(0, 0, 1)), mudHash(i + vec3(1, 0, 1)), f.x), mix(mudHash(i + vec3(0, 1, 1)), mudHash(i + vec3(1, 1, 1)), f.x), f.y), f.z);
  }
  float mudNoise(vec3 p) { return 0.5 * mudVal(p) + 0.3 * mudVal(p * 2.07 + 7.1) + 0.2 * mudVal(p * 4.13 + 3.3); }
`;
const mudSeed = () => ({ value: new THREE.Vector3(Math.random() * 100, Math.random() * 100, Math.random() * 100) });   // (everyone's mud is different)

function toonM(o = {}) {
  const opts = Object.assign({ gradientMap: TOON_RAMP }, o);
  delete opts.roughness; delete opts.metalness;
  return new THREE.MeshToonMaterial(opts);
}
const mat = color => toonM({ color: col(color) });

// The outline: a copy of the mesh, drawn inside out in a dark colour and puffed out along its normals, so
// only a rim of it shows round the edge. th: how thick, in the mesh's own units.
const OUTLINE = col(0x1c1a2e), outlineMats = {};
function outlineMat(th, skinning = false) {
  const key = th + (skinning ? 's' : '');
  if (outlineMats[key]) return outlineMats[key];
  // (pushed a touch further away in depth, so it never pokes through the front of the thing it outlines)
  const m = new THREE.MeshBasicMaterial({ color: OUTLINE, side: THREE.BackSide, skinning, polygonOffset: true, polygonOffsetFactor: 2, polygonOffsetUnits: 4 });
  m.onBeforeCompile = sh => {
    sh.vertexShader = sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n  transformed += normal * ' + th.toFixed(4) + ';');
  };
  m.customProgramCacheKey = () => 'outline' + key;
  return (outlineMats[key] = m);
}
function outline(mesh, th = 0.04) {
  const o = new THREE.Mesh(mesh.geometry, outlineMat(th));
  o.castShadow = o.receiveShadow = false;
  mesh.add(o);
  return mesh;
}

// ---------------------------------------------------------------- input
// keys: held right now. pressed: went down since last frame (cleared every frame). Mouse buttons count as keys
// too: Mouse0 (left), Mouse1 (middle), Mouse2 (right).
const keys = {}, pressed = new Set();
const mouse = { dx: 0, dy: 0, wheel: 0 };
addEventListener('keydown', e => {
  if (!e.repeat) pressed.add(e.code);
  keys[e.code] = true;
  if (['Space', 'ArrowUp', 'ArrowDown'].includes(e.code)) e.preventDefault();
});
addEventListener('keyup', e => { keys[e.code] = false; });
addEventListener('blur', () => { for (const k in keys) keys[k] = false; });
addEventListener('mousemove', e => {
  if (document.pointerLockElement) { mouse.dx += e.movementX; mouse.dy += e.movementY; }
});
addEventListener('wheel', e => { mouse.wheel += Math.sign(e.deltaY); }, { passive: true });
const lockPointer = () => { try { const r = renderer.domElement.requestPointerLock(); if (r && r.catch) r.catch(() => {}); } catch (e) {} };
renderer.domElement.addEventListener('mousedown', e => {
  if (!document.pointerLockElement) { lockPointer(); return; }
  keys['Mouse' + e.button] = true; pressed.add('Mouse' + e.button);
  if (e.button === 1) e.preventDefault();
});
addEventListener('mouseup', e => { keys['Mouse' + e.button] = false; });
addEventListener('contextmenu', e => e.preventDefault());
document.addEventListener('pointerlockchange', () => { if (!document.pointerLockElement) for (let b = 0; b < 5; b++) keys['Mouse' + b] = false; });

// ---------------------------------------------------------------- the controls
// What each action's on: up to two keys (or mouse buttons) each. You can change them on the CONTROLS page
// (see controls.js); yours are remembered.
const ACTIONS = {
  forward: 'Move forward', back: 'Move back', left: 'Move left', right: 'Move right',
  run: 'Run', jump: 'Jump', punch: 'Punch / swing', kick: 'Kick', grab: 'Grab (hold)',
  pickup: 'Pick up gear', flop: 'Flop (hold)', help: 'Hide the help', special: 'Special move',
};
const BIND_DEFAULT = {
  forward: ['KeyW', 'ArrowUp'], back: ['KeyS', 'ArrowDown'], left: ['KeyA', 'ArrowLeft'], right: ['KeyD', 'ArrowRight'],
  run: ['ShiftLeft', 'ShiftRight'], jump: ['Space', ''], punch: ['Mouse0', ''], kick: ['KeyF', 'Mouse1'], grab: ['Mouse2', ''],
  pickup: ['KeyE', ''], flop: ['KeyR', ''], help: ['KeyH', ''], special: ['KeyQ', ''],
};
const BINDS = JSON.parse(JSON.stringify(BIND_DEFAULT));
try { const saved = JSON.parse(localStorage.getItem('ragdollKeys') || '{}'); for (const a in BINDS) if (Array.isArray(saved[a])) BINDS[a] = [saved[a][0] || '', saved[a][1] || '']; } catch (e) {}
// is an action's key held down? did it just go down?
// (only while you're playing: online the game carries on behind the pause menu, and typing there does nothing)
const held = a => typeof playing !== 'undefined' && playing && BINDS[a].some(c => c && keys[c]);
const hit = a => typeof playing !== 'undefined' && playing && BINDS[a].some(c => c && pressed.has(c));
// a key's name, to show you (KeyF: F; Mouse0: Left click…)
function keyName(code) {
  const named = { Mouse0: 'Left click', Mouse1: 'Middle click', Mouse2: 'Right click', Mouse3: 'Mouse back', Mouse4: 'Mouse forward',
    Space: 'Space', ShiftLeft: 'Shift', ShiftRight: 'Right Shift', ControlLeft: 'Ctrl', ControlRight: 'Right Ctrl', AltLeft: 'Alt', AltRight: 'Right Alt',
    ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→', Enter: 'Enter', Tab: 'Tab', Backquote: '`', CapsLock: 'Caps Lock' };
  if (!code) return '';
  if (named[code]) return named[code];
  return code.replace(/^Key/, '').replace(/^Digit/, '').replace(/^Numpad/, 'Num ');
}
// an action's key(s) as key caps (just the first, or both)
const keyCap = c => `<kbd class="${c.startsWith('Mouse') ? 'm' : ''}">${keyName(c)}</kbd>`;
const keysFor = (a, both) => BINDS[a].filter(Boolean).slice(0, both ? 2 : 1).map(keyCap).join(' ') || '<kbd>?</kbd>';
