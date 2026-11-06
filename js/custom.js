// Dress up your ragdoll: its colour, a hat, and how bushy its eyebrows are; and kit it out with gear that
// helps in a fight: boxing gloves or a big cartoon hammer for your hands, butter shoes or spring shoes for
// your feet. Every colour has its own special move (see specials.js), the fighters' too. Open from the title
// (or pause) screen; you see yourself up close while you choose. What you pick is remembered for next time.
'use strict';
const LOOK_COLORS = [0x2f7bff, 0x22c3e6, 0x2fcf6a, 0x9ad63a, 0xffd23a, 0xff9a2a, 0xff4a4a, 0xff5fb0, 0xa45cff, 0x8a5a3c, 0xf4f0e6, 0x3a3a4a, 0x5ee0c0];
// (the first few are yours from the start; the rest unlock as you level up: see UNLOCK)
const HATS = ['none', 'cap', 'top hat', 'party hat', 'beanie', 'viking', 'chef hat', 'cowboy hat', 'propeller cap', 'traffic cone', 'wizard hat', 'pirate hat', 'bunny ears', 'halo', 'crown'];
const BROWS = { thin: 0.6, normal: 1, thick: 1.8 };
// the gear: what each does (its stats multiply: punch, kick: how hard those hit; heft: how far your punches
// send them; speed, jump; grip: how quickly you can change speed on the ground; coast: and how quickly you stop;
// charge: how fast your hits charge your POWER)
const GEAR = {
  hands: {
    none: { desc: 'Bare hands.' },
    'boxing gloves': { desc: 'Punches hit 40% harder.', stats: { punch: 1.4 } },
    'cartoon hammer': { desc: 'BONK! Every punch is a big hammer smash: much harder and further, but a bit slower.', stats: { punch: 1.8, heft: 1.4 } },
    'iron fists': { desc: 'Heavy metal fists: punches hit harder and send them further, but they slow you down a bit.', stats: { punch: 1.3, heft: 1.25, speed: 0.9 } },
    'foam fingers': { desc: 'A giant foam #1 hand! Your hits barely hurt, but they send people FLYING.', stats: { punch: 0.75, heft: 1.8 } },
  },
  feet: {
    none: { desc: 'Bare feet.' },
    'butter shoes': { desc: 'Slide about super fast, but they are really hard to stop!', stats: { speed: 1.5, grip: 0.12, coast: 0.25 } },
    'spring shoes': { desc: 'Jump 35% higher.', stats: { jump: 1.35 } },
    'rocket boots': { desc: 'Zoom! Run faster and jump higher, but they are a bit slippy.', stats: { speed: 1.3, jump: 1.2, grip: 0.6 } },
    'clown shoes': { desc: 'Huge floppy shoes. Your kicks hit really hard, but you are a bit slower.', stats: { kick: 1.7, heft: 1.15, speed: 0.9 } },
  },
};
// ---------------------------------------------------------------- special moves: one for each colour
// Every colour has its own special move (see specials.js). That's all a colour changes: no other bonuses.
// (styleStat: just a special move's buff, if you've got one going: RAGE, IRON BODY, HOME RUN.)
const STYLES = {
  0x2f7bff: { special: 'haymaker' },
  0x22c3e6: { special: 'dash' },
  0x2fcf6a: { special: 'skyslam' },
  0x9ad63a: { special: 'spinkick' },
  0xffd23a: { special: 'surge' },
  0xff9a2a: { special: 'homerun' },
  0xff4a4a: { special: 'rage' },
  0xff5fb0: { special: 'backflip' },
  0xa45cff: { special: 'flurry' },
  0x8a5a3c: { special: 'iron' },
  0xf4f0e6: { special: 'teleport' },
  0x3a3a4a: { special: 'quake' },
  0x5ee0c0: { special: 'clone' },   // (mint: just for you, the fighters don't come in it)
};
const CHAMP_STYLE = { special: 'quake' };
const NO_STYLE = {};
// whose style: yours is your colour; a fighter's is its colour (the champion has its own); the other player
// online, theirs (their real colour: it may be shown different if it's the same as yours, see net.js)
function styleOf(who = P) {
  if (who === P) return STYLES[LOOK.color] || NO_STYLE;
  if (who.B && who.B.champ) return CHAMP_STYLE;
  return STYLES[who.remote ? who.styleColor : who.baseColor] || NO_STYLE;
}
// (times any special move buff they've got on just now: RAGE, IRON BODY... see specials.js)
// (and times your size's: see SIZES)
const styleStat = (k, who = P) => { const v = (styleOf(who).stats || {})[k], b = who.buffT > 0 && who.buff && who.buff[k], z = (SIZES[sizeOf(who)] || SIZES.normal).stats[k];
  return (v === undefined ? 1 : v) * (b || 1) * (z || 1); };
// what their gear does to one of the stats (all of it multiplied together)
const gearStat = (k, who = P) => {
  let m = 1; const g = gearOf(who);
  for (const slot in GEAR) { const it = g[slot], st = it && GEAR[slot][it.kind] && GEAR[slot][it.kind].stats; if (st && st[k]) m *= st[k]; }
  return m;
};
// both together: their colour's style and their gear
const statOf = (k, who = P) => styleStat(k, who) * gearStat(k, who);

// What someone's got on (who: P for you, or a fighter): who.gear = { hands, feet }, each null or an item,
// { slot, kind, dirt } (dirt: how muddy it is, 0 to 1). An item keeps its mud if it's dropped or stolen.
// What you pick in the GEAR tab is what you start with; in a fight it can come off (see loot.js).
const newItem = (slot, kind) => ({ slot, kind, dirt: 0, mudU: { value: 0 } });
const gearOf = who => who.gear || (who.gear = { hands: null, feet: null });
const wearing = (who, kind) => { const g = gearOf(who); return !!((g.hands && g.hands.kind === kind) || (g.feet && g.feet.kind === kind)); };
const hasGear = who => { const g = gearOf(who); return !!(g.hands || g.feet); };
// everyone who can wear gear, and their models and bodies
const wearers = () => [P, ...fighters];
const rigOfWho = who => who === P ? playerRig : who.rig;
const bodyOf = who => who === P ? playerBody : who.B;
// how far up someone's springs hold them (if they've got spring shoes on)
const springLift = (who = P) => wearing(who, 'spring shoes') ? GEAR_MODELS['spring shoes'].lift || 0 : 0;

// LEVELS: everything you do in a fight earns XP (ring-outs, clearing waves, beating champions), and XP
// levels you up. Hats and gear unlock as you level (UNLOCK: which level each needs; the first few hats are
// yours from the start). XP and your level are remembered.
const UNLOCK = {
  'boxing gloves': 2, 'chef hat': 3, 'spring shoes': 4, 'cowboy hat': 5, 'butter shoes': 6, 'propeller cap': 7,
  'cartoon hammer': 8, 'traffic cone': 9, 'iron fists': 10, 'wizard hat': 11, 'rocket boots': 12, 'pirate hat': 13,
  'bunny ears': 14, 'foam fingers': 15, 'halo': 16, 'clown shoes': 18, 'crown': 20,
};
const XP_FOR = { ringout: 10, champ: 40, wave: 5 };   // (a ring-out; a champion's, instead; clearing wave n: n times this)
// (how much XP it takes to get from level L to the next one; and how much altogether to reach level L)
const xpStep = L => 40 + 20 * L;
const xpTo = L => 40 * (L - 1) + 10 * (L - 1) * L;
const levelOf = xp => { let L = 1; while (xp >= xpTo(L + 1)) L++; return L; };
const SAVE = { ringouts: +localStorage.getItem('ragdollRingouts') || 0, xp: +localStorage.getItem('ragdollXP') || 0, kept: [] };
try { SAVE.kept = JSON.parse(localStorage.getItem('ragdollKept') || '[]'); } catch (e) {}
// (from before there were levels, when gear unlocked by ring-outs: a start on XP for the ones you'd done, and
// whatever you'd unlocked then stays unlocked)
if (localStorage.getItem('ragdollXP') === null && SAVE.ringouts > 0) {
  const OLD = { 'boxing gloves': 3, 'spring shoes': 8, 'butter shoes': 15, 'cartoon hammer': 25 };
  SAVE.xp = SAVE.ringouts * XP_FOR.ringout;
  SAVE.kept = Object.keys(OLD).filter(k => SAVE.ringouts >= OLD[k]);
  localStorage.setItem('ragdollXP', SAVE.xp); localStorage.setItem('ragdollKept', JSON.stringify(SAVE.kept));
}
const myLevel = () => levelOf(SAVE.xp);
const unlocked = kind => !UNLOCK[kind] || myLevel() >= UNLOCK[kind] || SAVE.kept.includes(kind);
// (the next thing you'll unlock, and at what level: null when you've got the lot)
const nextUnlock = () => { const k = Object.keys(UNLOCK).filter(k => !unlocked(k)).sort((a, b) => UNLOCK[a] - UNLOCK[b])[0]; return k ? { kind: k, level: UNLOCK[k] } : null; };
const cap = s => s[0].toUpperCase() + s.slice(1);
// earn some XP: and if that's a new level, say so, and what it's unlocked
function addXP(n) {
  if (!(n > 0)) return;
  const before = myLevel();
  SAVE.xp += Math.round(n);
  RUN_XP.n += Math.round(n);
  localStorage.setItem('ragdollXP', SAVE.xp);
  const now = myLevel();
  for (let L = before + 1; L <= now; L++) {
    setTimeout(() => banner('LEVEL ' + L + '!', 'unlock'), 600);
    for (const kind in UNLOCK) if (UNLOCK[kind] === L && !SAVE.kept.includes(kind)) setTimeout(() => banner('UNLOCKED: ' + kind.toUpperCase() + '!', 'unlock'), 900);
  }
  if (now > before) { showLocks(); if (typeof showBest === 'function') showBest(); }
}
const RUN_XP = { n: 0 };   // (earned this run: shown at GAME OVER)
// (a ring-out: count it, and its XP. F: who, if it was a fighter: a champion's worth more)
function countRingOut(F) {
  SAVE.ringouts++;
  localStorage.setItem('ragdollRingouts', SAVE.ringouts);
  addXP(F && F.B && F.B.champ ? XP_FOR.champ : XP_FOR.ringout);
}
// SIZE: small ones are really fast but light (easy to knock away) and hit softer; big ones are really slow
// but heavy (hard to knock away) and hit harder; normal's in between. (Its stats multiply like a special's do.)
const SIZES = {
  small:  { scale: 0.75, name: 'SMALL',  desc: 'Really fast and jumpy, but light: easy to knock flying, and your hits are softer.', stats: { speed: 1.25, jump: 1.2, punch: 0.8, kick: 0.8, tough: 0.7 } },
  normal: { scale: 1,    name: 'NORMAL', desc: 'A bit of everything: OK speed, OK hits, OK weight.', stats: {} },
  big:    { scale: 1.3,  name: 'BIG',    desc: 'Really slow, but heavy: hard to knock away, and your hits are huge.', stats: { speed: 0.65, jump: 0.85, punch: 1.35, kick: 1.35, heft: 1.2, tough: 1.6 } },
};
const sizeOf = who => who === P || who.ally ? LOOK.size : who.remote ? (who.sizeK || 'normal') : 'normal';
const LOOK = Object.assign({ color: 0x2f7bff, hat: 'none', brows: 'normal', hands: 'none', feet: 'none', size: 'normal' }, JSON.parse(localStorage.getItem('ragdollLook') || '{}'));
const CUSTOM = { open: false, t: 0 };

// ---------------------------------------------------------------- hats (made of simple shapes, sat on top of the head)
// (R: the head's radius. y = 0 is the very top of the head; -z is the way the face looks. mudU: how muddy it
// is, 0 to 1, if it can get muddy: it does when your head's in the mud, see mudBody in nature.js)
function makeHat(kind, R, mudU) {
  const g = new THREE.Group();
  const add = (geo, color, x = 0, y = 0, z = 0, th = 0.012) => {
    const m = outline(new THREE.Mesh(geo, withMud(mat(color), mudU)), th);
    m.position.set(x, y, z); m.castShadow = true; g.add(m); return m;
  };
  const dome = (r, color, y) => add(new THREE.SphereGeometry(r, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), color, 0, y);
  if (kind === 'cap') {
    dome(R * 1.08, 0xff4a4a, -R * 0.62);
    const brim = add(new THREE.CylinderGeometry(R * 0.75, R * 0.75, R * 0.07, 24, 1, false, Math.PI / 2, Math.PI), 0xff4a4a, 0, -R * 0.6, -R * 0.62);
    brim.scale.z = 1.3;
    add(new THREE.SphereGeometry(R * 0.1, 10, 8), 0xffffff, 0, R * 0.45, 0);
  } else if (kind === 'top hat') {
    add(new THREE.CylinderGeometry(R * 1.35, R * 1.35, R * 0.08, 28), 0x2a2838, 0, -R * 0.15);
    add(new THREE.CylinderGeometry(R * 0.8, R * 0.85, R * 1.3, 28), 0x2a2838, 0, R * 0.5);
    add(new THREE.CylinderGeometry(R * 0.86, R * 0.86, R * 0.22, 28), 0xff4a4a, 0, R * 0.0);
  } else if (kind === 'crown') {
    add(new THREE.CylinderGeometry(R * 0.78, R * 0.78, R * 0.4, 28, 1, true), 0xffc928, 0, R * 0.05).material.side = THREE.DoubleSide;
    for (let i = 0; i < 6; i++) {
      const a = i / 6 * Math.PI * 2;
      add(new THREE.ConeGeometry(R * 0.17, R * 0.42, 4), 0xffc928, Math.sin(a) * R * 0.74, R * 0.45, -Math.cos(a) * R * 0.74, 0.008);
      add(new THREE.SphereGeometry(R * 0.08, 10, 8), i % 2 ? 0x3ad1ff : 0xff3d6e, Math.sin(a) * R * 0.8, R * 0.05, -Math.cos(a) * R * 0.8, 0.006);
    }
  } else if (kind === 'party hat') {
    const c = add(new THREE.ConeGeometry(R * 0.6, R * 1.6, 24), 0xff5fb0, 0, R * 0.65);
    // (stripes, painted on)
    const cv = document.createElement('canvas'); cv.width = 64; cv.height = 64;
    const x = cv.getContext('2d'); x.fillStyle = '#ff5fb0'; x.fillRect(0, 0, 64, 64); x.fillStyle = '#ffe14a';
    for (let i = 0; i < 4; i++) x.fillRect(0, i * 16 + 4, 64, 7);
    const tex = new THREE.CanvasTexture(cv); tex.encoding = THREE.sRGBEncoding;
    c.material = withMud(toonM({ map: tex }), mudU);
    add(new THREE.SphereGeometry(R * 0.2, 12, 10), 0x3ad1ff, 0, R * 1.5);
  } else if (kind === 'beanie') {
    dome(R * 1.07, 0x2fcf6a, -R * 0.55);
    add(new THREE.CylinderGeometry(R * 1.1, R * 1.1, R * 0.3, 28), 0x23a856, 0, -R * 0.5);
    add(new THREE.IcosahedronGeometry(R * 0.28, 1), 0xffffff, 0, R * 0.55);
  } else if (kind === 'viking') {
    dome(R * 1.08, 0x9aa0b4, -R * 0.62);
    add(new THREE.CylinderGeometry(R * 1.1, R * 1.1, R * 0.16, 28), 0x8a5a3c, 0, -R * 0.55);
    for (const s of [-1, 1]) {
      const horn = add(new THREE.ConeGeometry(R * 0.32, R * 1.5, 16), 0xf4f0e6, s * R * 1.3, R * 0.2, 0);
      horn.rotation.z = -s * 0.85;
    }
  } else if (kind === 'chef hat') {
    // a tall white band with a big puffy top
    add(new THREE.CylinderGeometry(R * 0.82, R * 0.86, R * 0.75, 24), 0xffffff, 0, -R * 0.05);
    for (let i = 0; i < 6; i++) { const a = i / 6 * Math.PI * 2; add(new THREE.SphereGeometry(R * 0.42, 14, 10), 0xffffff, Math.sin(a) * R * 0.5, R * 0.5, Math.cos(a) * R * 0.5, 0.01); }
    add(new THREE.SphereGeometry(R * 0.55, 16, 12), 0xffffff, 0, R * 0.65, 0, 0.01);
  } else if (kind === 'cowboy hat') {
    const brim = add(new THREE.CylinderGeometry(R * 1.55, R * 1.55, R * 0.08, 32), 0xa0662e, 0, -R * 0.3);
    brim.scale.z = 1.15;
    add(new THREE.CylinderGeometry(R * 0.72, R * 0.82, R * 0.75, 24), 0xa0662e, 0, R * 0.08);
    add(new THREE.CylinderGeometry(R * 0.84, R * 0.84, R * 0.16, 24), 0x4a2a18, 0, -R * 0.18);
    const dent = add(new THREE.SphereGeometry(R * 0.72, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2), 0xa0662e, 0, R * 0.42);
    dent.scale.y = 0.35;
  } else if (kind === 'propeller cap') {
    // a two-colour cap with a little propeller on top (it spins: see spinHats)
    dome(R * 1.08, 0x3ad1ff, -R * 0.62);
    const half = add(new THREE.SphereGeometry(R * 1.085, 24, 12, 0, Math.PI, 0, Math.PI / 2), 0xffd23a, 0, -R * 0.62);
    half.rotation.y = Math.PI / 2;
    const brim = add(new THREE.CylinderGeometry(R * 0.7, R * 0.7, R * 0.07, 24, 1, false, Math.PI / 2, Math.PI), 0xff4a4a, 0, -R * 0.6, -R * 0.62);
    brim.scale.z = 1.2;
    add(new THREE.CylinderGeometry(R * 0.05, R * 0.05, R * 0.4, 8), 0x3a3a4a, 0, R * 0.55, 0, 0.006);
    const prop = new THREE.Group(); prop.position.y = R * 0.78; g.add(prop); g.userData.prop = prop;
    for (const s of [-1, 1]) {
      const blade = outline(new THREE.Mesh(roundedBox(R * 0.9, R * 0.05, R * 0.24, R * 0.02), withMud(mat(s > 0 ? 0xff4a4a : 0xff9a2a), mudU)), 0.008);
      blade.position.x = s * R * 0.45; blade.rotation.x = s * 0.25; blade.castShadow = true; prop.add(blade);
    }
    add(new THREE.SphereGeometry(R * 0.09, 10, 8), 0xffd23a, 0, R * 0.8, 0, 0.006);
  } else if (kind === 'traffic cone') {
    add(roundedBox(R * 1.6, R * 0.14, R * 1.6, R * 0.04), 0xff7a1a, 0, -R * 0.25);
    add(new THREE.ConeGeometry(R * 0.72, R * 1.9, 24), 0xff7a1a, 0, R * 0.75);
    add(new THREE.CylinderGeometry(R * 0.47, R * 0.56, R * 0.3, 24), 0xffffff, 0, R * 0.42, 0, 0.004);
    add(new THREE.CylinderGeometry(R * 0.24, R * 0.32, R * 0.24, 24), 0xffffff, 0, R * 1.05, 0, 0.004);
  } else if (kind === 'wizard hat') {
    add(new THREE.CylinderGeometry(R * 1.35, R * 1.35, R * 0.07, 28), 0x5a2fb0, 0, -R * 0.2);
    const tip = add(new THREE.ConeGeometry(R * 0.82, R * 2.1, 24), 0x6a3ad0, 0, R * 0.85);
    tip.rotation.z = 0.18; tip.position.x = -R * 0.12;
    const stars = [[0.45, 0.3, -0.55], [-0.35, 0.9, -0.45], [0.1, 1.3, -0.35], [-0.6, 0.15, -0.3]];
    for (const [x, y, z] of stars) add(new THREE.OctahedronGeometry(R * 0.11), 0xffd23a, x * R, y * R, z * R, 0.004);
  } else if (kind === 'pirate hat') {
    dome(R * 1.08, 0x2a2838, -R * 0.6);
    // the big upturned brim at the front, with a skull on it
    const front = add(roundedBox(R * 2.3, R * 0.85, R * 0.12, R * 0.05), 0x2a2838, 0, R * 0.05, -R * 0.55);
    front.rotation.x = -0.25;
    add(roundedBox(R * 2.32, R * 0.08, R * 0.13, R * 0.03), 0xffd23a, 0, R * 0.43, -R * 0.64, 0.004).rotation.x = -0.25;
    add(new THREE.SphereGeometry(R * 0.17, 12, 10), 0xffffff, 0, R * 0.08, -R * 0.66, 0.006);
    for (const s of [-1, 1]) add(roundedBox(R * 0.36, R * 0.07, R * 0.07, R * 0.02), 0xffffff, 0, -R * 0.18, -R * 0.63, 0.004).rotation.z = s * 0.7;
  } else if (kind === 'bunny ears') {
    add(new THREE.TorusGeometry(R * 0.95, R * 0.06, 8, 32, Math.PI), 0xff5fb0, 0, -R * 0.55, 0, 0.006);
    for (const s of [-1, 1]) {
      const ear = add(new THREE.SphereGeometry(R * 0.26, 16, 12), 0xffffff, s * R * 0.42, R * 0.55, R * 0.02);
      ear.scale.set(1, 3, 0.55); ear.rotation.z = -s * 0.22;
      const inner = add(new THREE.SphereGeometry(R * 0.15, 14, 10), 0xffa8d6, s * R * 0.42, R * 0.55, -R * 0.1, 0.004);
      inner.scale.set(1, 3.6, 0.4); inner.rotation.z = -s * 0.22;
    }
  } else if (kind === 'halo') {
    const ring = add(new THREE.TorusGeometry(R * 0.7, R * 0.11, 12, 36), 0xffe14a, 0, R * 0.55);
    ring.rotation.x = Math.PI / 2 + 0.15;
    ring.material.emissive = col(0xffc928); ring.material.emissiveIntensity = 0.45;
  }
  return g;
}

// ---------------------------------------------------------------- gear models (made in Blender: models/gear/)
// Each is loaded once, then squashed down to a ready-to-use shape: every part's geometry gets its node
// transforms baked in, then is scaled and moved so the model's handy point (the fist's middle, the bottom of
// a shoe, the hammer's grip) is at 0,0,0. Until a model has loaded the gear is made of simple shapes instead.
const GEAR_MODELS = {
  'boxing gloves':  { file: 'glove',  color: 0xe8322a,
    // (the fist is at +x, the cuff's opening at -x)
    fit: b => { const r = (b.max.y - b.min.y) / 2; return { k: 0.16 * S / r, at: V3(b.max.x - r, (b.min.y + b.max.y) / 2, (b.min.z + b.max.z) / 2) }; } },
  'butter shoes':   { file: 'butter',
    fit: b => ({ k: 0.37 * S / (b.max.z - b.min.z), at: V3((b.min.x + b.max.x) / 2, b.min.y, (b.min.z + b.max.z) / 2) }) },
  'spring shoes':   { file: 'spring',
    // (the shoe's made a bit roomy, as the ragdoll's feet are big round things. Its sole sits at the foot's
    // sole, with the springs sticking out below: you stand up on them, see springLift)
    fit: b => { const k = 0.37 * S / (b.max.z - b.min.z), coil = 0.077; GEAR_MODELS['spring shoes'].lift = (coil - 0.012) * k;
      return { k, at: V3((b.min.x + b.max.x) / 2, b.min.y + coil, (b.min.z + b.max.z) / 2) }; } },
  'cartoon hammer': { file: 'hammer',
    // (the handle runs up y, with the head across the top; held a little way up from the handle's end)
    fit: b => { const grip = GEAR_MODELS['cartoon hammer'].grip = b.min.y + 0.12; return { k: 0.62 * S / (0.53 - grip), at: V3(0, grip, 0.394) }; } },
  // (these are made of simple shapes, not loaded: see gearParts. Hands: the fist's middle at 0,0,0, pointing
  // +x. Feet: the sole's middle at 0,0,0, the toes at -z)
  'iron fists': { build: () => gearParts([
    [new THREE.SphereGeometry(0.12 * S, 18, 14), 0x9aa0b4, [0, 0, 0], null, [1.1, 1, 1]],
    [new THREE.CylinderGeometry(0.085 * S, 0.095 * S, 0.08 * S, 16), 0x5a5e6e, [-0.1 * S, 0, 0], [0, 0, Math.PI / 2]],
    ...[-1, -0.33, 0.33, 1].map(t => [new THREE.SphereGeometry(0.03 * S, 8, 6), 0x5a5e6e, [0.115 * S, 0.035 * S, t * 0.07 * S]]),
  ]) },
  'foam fingers': { build: () => gearParts([
    [roundedBox(0.2 * S, 0.24 * S, 0.24 * S, 0.06 * S), 0xff9a2a, [0, 0, 0]],
    [roundedBox(0.26 * S, 0.08 * S, 0.08 * S, 0.035 * S), 0xff9a2a, [0.2 * S, 0.06 * S, 0]],
    [roundedBox(0.08 * S, 0.07 * S, 0.1 * S, 0.03 * S), 0xff9a2a, [0.05 * S, -0.1 * S, 0.12 * S]],
    [new THREE.CylinderGeometry(0.1 * S, 0.1 * S, 0.06 * S, 16), 0x2f7bff, [-0.12 * S, 0, 0], [0, 0, Math.PI / 2]],
  ]) },
  'rocket boots': { build: () => gearParts([
    [roundedBox(0.17 * S, 0.12 * S, 0.3 * S, 0.04 * S), 0xe8322a, [0, 0.06 * S, -0.03 * S]],
    [roundedBox(0.175 * S, 0.03 * S, 0.305 * S, 0.012 * S), 0xffffff, [0, 0.015 * S, -0.03 * S]],
    [new THREE.CylinderGeometry(0.045 * S, 0.06 * S, 0.1 * S, 14), 0x5a5e6e, [0, 0.08 * S, 0.15 * S], [Math.PI / 2, 0, 0]],
    [new THREE.ConeGeometry(0.045 * S, 0.14 * S, 12), 0xffb21a, [0, 0.08 * S, 0.26 * S], [-Math.PI / 2, 0, 0]],
    [new THREE.ConeGeometry(0.025 * S, 0.08 * S, 10), 0xfff4a0, [0, 0.08 * S, 0.24 * S], [-Math.PI / 2, 0, 0]],
  ]) },
  'clown shoes': { build: () => gearParts([
    [new THREE.SphereGeometry(0.1 * S, 18, 12), 0xe8322a, [0, 0.07 * S, -0.11 * S], null, [1.05, 0.75, 2.3]],
    [roundedBox(0.2 * S, 0.03 * S, 0.5 * S, 0.014 * S), 0xffd23a, [0, 0.015 * S, -0.1 * S]],
    [new THREE.SphereGeometry(0.035 * S, 10, 8), 0xffffff, [0, 0.14 * S, -0.06 * S]],
  ]) },
};
// a gear model from simple shapes: [geometry, colour, position, rotation, scale] each, baked into its geometry
function gearParts(list) {
  return list.map(([g, color, at, rot, sc]) => {
    const o = new THREE.Object3D();
    o.position.set(...at); if (rot) o.rotation.set(...rot); if (sc) o.scale.set(...sc);
    o.updateMatrix(); g.applyMatrix4(o.matrix);
    return { g, color: col(color) };
  });
}
for (const kind in GEAR_MODELS) {
  const G = GEAR_MODELS[kind];
  if (G.build) { G.parts = G.build(); G.k = 1; continue; }
  new THREE.GLTFLoader().load('models/gear/' + G.file + '.glb', gltf => {
    const parts = [], box = new THREE.Box3();
    gltf.scene.updateMatrixWorld(true);
    gltf.scene.traverse(o => {
      if (!o.isMesh) return;
      const g = o.geometry.clone(); g.applyMatrix4(o.matrixWorld); g.computeBoundingBox(); box.union(g.boundingBox);
      parts.push({ g, color: G.color != null ? col(G.color) : o.material.color.clone() });
    });
    const { k, at } = G.fit(box);
    for (const p of parts) p.g.translate(-at.x, -at.y, -at.z).scale(k, k, k);
    G.parts = parts; G.k = k;
    // (if anyone's already wearing it, or it's lying about, swap the stand-in shapes for the real thing)
    for (const who of wearers()) {
      const rig = rigOfWho(who);
      if (rig && rig.gearOn) for (const slot in rig.gearOn) {
        const on = rig.gearOn[slot];
        if (!on.item || on.item.kind !== kind) continue;
        for (const m of on.made) m.parent && m.parent.remove(m);
        rig.gearOn[slot] = { item: on.item, made: makeGear(rig, slot, kind, on.item.mudU) };
      }
    }
    if (typeof loot !== "undefined") for (const L of loot) if (L.item.kind === kind) lootLooks(L);   // (if the gear on the ground has loaded yet: see loot.js)
  }, undefined, e => console.warn('gear model', G.file, e));
}
// a copy of a loaded gear model, as a group (null if it hasn't loaded yet)
// (mudU: how muddy it is, see gearMat)
function gearModel(kind, th = 0.012, mudU = null) {
  const G = GEAR_MODELS[kind];
  if (!G || !G.parts) return null;
  const grp = new THREE.Group();
  for (const p of G.parts) {
    const m = new THREE.Mesh(p.g, gearMat(p.color, mudU, GEAR.feet[kind] ? 5 : 0));
    p.og = p.og || smoothShell(p.g);
    m.add(new THREE.Mesh(p.og, outlineMat(th)));
    m.castShadow = true; grp.add(m);
  }
  return grp;
}
// Gear's material: toon, with mud. mudU.value is how muddy (0 to 1): blotches of mud, the more of it covered
// the muddier it is. (up: how much more the bottom gets it than the top; for shoes, whose bottom is at y = 0.)
const GEAR_MUD = col(0x6e4a2c);
function gearMat(color, mudU, up = 0) {
  return withMud(toonM({ color: color.isColor ? color : col(color) }), mudU, up);
}
// (mud on any material: mudU says how muddy, 0 to 1)
function withMud(m, mudU, up = 0) {
  if (!mudU) return m;
  const seed = mudSeed();
  m.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, { mudAmt: mudU, mudCol: { value: GEAR_MUD }, mudUp: { value: up }, mudSeed: seed });
    sh.vertexShader = 'varying vec3 vGP;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n  vGP = position;');
    sh.fragmentShader = 'uniform float mudAmt, mudUp; uniform vec3 mudCol, mudSeed; varying vec3 vGP;\n' + MUD_NOISE + sh.fragmentShader.replace('#include <map_fragment>', `#include <map_fragment>
      if (mudAmt > 0.001) {
        // (random lumps of mud; it comes off in patches, any old where)
        float n = (mudNoise(vGP * 9.0 + mudSeed) - 0.5) * 3.0;
        n = n * 0.5 + vGP.y * mudUp;
        float th = mix(-0.8, 0.45 + mudUp * 0.25, mudAmt);   // (at its muddiest a bit of colour still shows)
        diffuseColor.rgb = mix(diffuseColor.rgb, mudCol, smoothstep(th + 0.05, th - 0.05, n));
      }`);
  };
  m.customProgramCacheKey = () => 'gearmud';
  return m;
}

// The outline puffs a copy of the mesh out along its normals. On a model with sharp edges the faces either
// side of an edge point different ways, so the puffed copy splits apart there and the outline goes patchy:
// this gives the copy smooth normals instead (every corner that's in the same place gets the same normal).
function smoothShell(g) {
  const o = new THREE.BufferGeometry(), pos = g.attributes.position, nor = g.attributes.normal;
  o.setAttribute('position', pos); if (g.index) o.setIndex(g.index);
  const sum = new Map(), key = i => Math.round(pos.getX(i) * 1e4) + ',' + Math.round(pos.getY(i) * 1e4) + ',' + Math.round(pos.getZ(i) * 1e4);
  for (let i = 0; i < pos.count; i++) {
    const kk = key(i), v = sum.get(kk) || sum.set(kk, V3()).get(kk);
    v.x += nor.getX(i); v.y += nor.getY(i); v.z += nor.getZ(i);
  }
  const n = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) { const v = sum.get(key(i)).clone().normalize(); n[i * 3] = v.x; n[i * 3 + 1] = v.y; n[i * 3 + 2] = v.z; }
  o.setAttribute('normal', new THREE.BufferAttribute(n, 3));
  return o;
}

// ---------------------------------------------------------------- gear (stuck on the hands, feet and body)
const _gz = V3(0, 0, 1), _gpx = V3(1, 0, 0);
function makeGear(rig, slot, kind, mudU) {
  const H = rig.gearHold, R = rig.restP, made = [], up = slot === 'feet' ? 5 : 0;
  const put = (hold, geo, color, at, th = 0.012) => {
    const m = outline(new THREE.Mesh(geo, gearMat(color, mudU, up)), th);
    m.position.copy(at); m.castShadow = true; hold.add(m); made.push(m); return m;
  };
  const putModel = (hold, at) => {
    const g = gearModel(kind, 0.012, mudU); if (!g) return null;
    g.position.copy(at); hold.add(g); made.push(g); return g;
  };
  if (slot === 'hands' && kind !== 'cartoon hammer' && GEAR_MODELS[kind] && GEAR_MODELS[kind].parts) for (const i of [0, 1]) {
    const hold = H[i ? 'handR' : 'handL'], dir = R[5 + i].clone().sub(R[3 + i]).normalize();
    putModel(hold, dir.clone().multiplyScalar(0.09 * S)).quaternion.setFromUnitVectors(_gpx, dir);
  } else if (kind === 'boxing gloves') for (const i of [0, 1]) {
    const hold = H[i ? 'handR' : 'handL'], dir = R[5 + i].clone().sub(R[3 + i]).normalize();
    put(hold, new THREE.SphereGeometry(0.11 * S, 18, 14), 0xe8322a, dir.clone().multiplyScalar(0.03 * S)).scale.set(1.05, 1, 1.15);
    put(hold, new THREE.SphereGeometry(0.05 * S, 10, 8), 0xe8322a, V3(0, 0, -0.1 * S));
    const cuff = put(hold, new THREE.CylinderGeometry(0.075 * S, 0.08 * S, 0.07 * S, 16), 0xffffff, dir.clone().multiplyScalar(-0.085 * S));
    cuff.quaternion.setFromUnitVectors(UP, dir);
  }
  if (kind === 'cartoon hammer' && GEAR_MODELS[kind].parts) {
    // (it's placed in your right fist every frame, pointing out in front: see updateGear)
    const g = gearModel(kind, 0.012, mudU), head = new THREE.Object3D();
    head.position.set(0, (0.53 - (GEAR_MODELS[kind].grip)) * GEAR_MODELS[kind].k, 0);   // (the middle of its head)
    g.add(head); scene.add(g); made.push(g);
    rig.hammer = g; rig.hammerHead = head;
  } else if (kind === 'cartoon hammer') {
    // a wooden handle with a big round head on the end. It's not stuck to the hand bone (that would leave it
    // poking out sideways): it's placed in your right fist every frame, pointing out in front (see updateGear)
    const g = new THREE.Group(), part = (geo, color, at, th = 0.012) => {
      const m = outline(new THREE.Mesh(geo, gearMat(color, mudU)), th);
      m.position.copy(at); m.castShadow = true; g.add(m); return m;
    };
    part(new THREE.CylinderGeometry(0.03 * S, 0.035 * S, 0.62 * S, 10), 0xc68a4a, V3(0, 0.2 * S, 0));
    part(new THREE.SphereGeometry(0.045 * S, 10, 8), 0xc68a4a, V3(0, -0.12 * S, 0), 0.008);
    const head = part(new THREE.CylinderGeometry(0.15 * S, 0.15 * S, 0.36 * S, 22), 0xe8322a, V3(0, 0.53 * S, 0), 0.016);
    head.rotation.x = Math.PI / 2;   // (its flat faces point the way you swing it)
    for (const s of [-1, 1]) part(new THREE.CylinderGeometry(0.155 * S, 0.155 * S, 0.06 * S, 22), 0xffd23a, V3(0, 0.53 * S, s * 0.15 * S), 0.008).rotation.x = Math.PI / 2;
    scene.add(g); made.push(g);
    rig.hammer = g; rig.hammerHead = head;
  } else if (slot === 'hands') rig.hammer = null;
  if (slot === 'feet') for (const i of [0, 1]) {
    const hold = H[i ? 'footR' : 'footL'], sole = SOLE * S - R[11 + i].y;
    if (GEAR_MODELS[kind] && GEAR_MODELS[kind].parts) putModel(hold, V3(0, sole - (kind === 'butter shoes' ? 0.04 * S : 0), -0.03 * S));   // (butter: sunk in a little, it's a slippery slab under you)
    else if (kind === 'butter shoes') {
      // a slab of butter on each foot (with a little pat melting on top)
      put(hold, roundedBox(0.17 * S, 0.1 * S, 0.29 * S, 0.02 * S), 0xffe68a, V3(0, sole + 0.05 * S, -0.045 * S));
      put(hold, roundedBox(0.1 * S, 0.03 * S, 0.1 * S, 0.012 * S), 0xfff4c4, V3(0.02 * S, sole + 0.11 * S, -0.1 * S), 0.006);
    } else if (kind === 'spring shoes') {
      put(hold, roundedBox(0.16 * S, 0.07 * S, 0.25 * S, 0.025 * S), 0x3ad1ff, V3(0, sole + 0.035 * S, -0.04 * S));
      for (let k = 0; k < 3; k++) put(hold, new THREE.TorusGeometry(0.105 * S, 0.018 * S, 6, 18), 0xffd23a, V3(0, sole + (0.1 + k * 0.05) * S, -0.02 * S), 0.006).rotation.x = Math.PI / 2;
    }
  }
  return made;
}

// a hammer, in its owner's right fist: pointing forward and up from it, so a punch swings it out in front
const _gy = V3(), _gx = V3(), _gzz = V3(), _gf = V3(), _gm = new THREE.Matrix4();
function updateGear() {
  for (const who of wearers()) {
    const rig = rigOfWho(who), g = rig && rig.hammer;
    if (rig && rig.hat && rig.hat.userData.prop) rig.hat.userData.prop.rotation.y += 0.3;   // (a propeller cap: whirr)
    if (!g) continue;
    const B = bodyOf(who), hand = B.pos[6];
    _gy.subVectors(B.pos[6], B.pos[4]).normalize();   // (the arm)
    fwdOf(who.yaw, _gf);
    _gy.multiplyScalar(0.6).add(_gf).addScaledVector(UP, 0.7).normalize();   // (the handle)
    _gx.crossVectors(_gy, _gf); if (_gx.lengthSq() < 1e-4) _gx.set(1, 0, 0); _gx.normalize();
    _gzz.crossVectors(_gx, _gy);
    g.quaternion.setFromRotationMatrix(_gm.makeBasis(_gx, _gy, _gzz));
    g.position.copy(hand); g.scale.setScalar(B.size || 1);   // (a big one's hammer is big too)
    g.updateMatrixWorld(true);
  }
}

// put on (or take off) the models of whatever someone's wearing now
function wearGear(who) {
  const rig = rigOfWho(who);
  if (!rig) return;
  rig.gearOn = rig.gearOn || {};
  const g = gearOf(who);
  for (const slot in GEAR) {
    const it = g[slot], on = rig.gearOn[slot];
    if (on && on.item === it) continue;
    if (on) for (const m of on.made) m.parent && m.parent.remove(m);
    if (slot === 'hands') rig.hammer = rig.hammerHead = null;
    rig.gearOn[slot] = { item: it, made: it ? makeGear(rig, slot, it.kind, it.mudU) : [] };
  }
}

// ---------------------------------------------------------------- putting it on
// (changed: which option you just picked. Your gear's only swapped for what's picked when you pick it, or the
// first time: so picking a hat doesn't magically give you back the gloves a fighter pinched)
function applyLook(changed) {
  const rig = playerRig;
  if (!rig) return;
  rig.mesh.material.color.copy(col(LOOK.color));
  if (rig.hat) { rig.hatHold.remove(rig.hat); rig.hat = null; }
  if (LOOK.hat !== 'none') { rig.hat = makeHat(LOOK.hat, rig.headR, rig.hatMud || (rig.hatMud = { value: 0 })); rig.hatHold.add(rig.hat); }
  for (const e of rig.eyes) e.brow.scale.y = BROWS[LOOK.brows];
  // your size: your body and your model, bigger or smaller (and your stats, see SIZES)
  if (!SIZES[LOOK.size]) LOOK.size = 'normal';
  setBodySize(playerBody, rig, SIZES[LOOK.size].scale);
  if (changed === 'size' || !applyLook.done) initBody(P.pos, P.yaw);
  // (the size cards show you, in your colour)
  document.querySelectorAll('#custom .ccard.size').forEach(b => { b.style.setProperty('--fc', '#' + LOOK.color.toString(16).padStart(6, '0')); const f = b.querySelector('.face'); if (f) f.outerHTML = faceHTML(LOOK.color); });
  { const z = SIZES[LOOK.size]; infoCard('desc-size', z.name, z.desc, 'Size', null, sizeBars(z.stats)); }
  infoCard('desc-hat', LOOK.hat === 'none' ? 'NO HAT' : LOOK.hat.toUpperCase(), HAT_LINES[LOOK.hat] || '', 'Hat');
  for (const slot in GEAR) {
    if (!GEAR[slot][LOOK[slot]] || !unlocked(LOOK[slot])) LOOK[slot] = 'none';
    const g = gearOf(P), have = g[slot] ? g[slot].kind : 'none';
    if ((changed === slot || !applyLook.done) && have !== LOOK[slot]) g[slot] = LOOK[slot] === 'none' ? null : newItem(slot, LOOK[slot]);
    infoCard('desc-' + slot, LOOK[slot] === 'none' ? 'NOTHING' : LOOK[slot].toUpperCase(), GEAR[slot][LOOK[slot]].desc, slot === 'hands' ? 'Hands' : 'Feet', null, gearBars(GEAR[slot][LOOK[slot]].stats || {}));
  }
  wearGear(P);
  { const sm = SPECIALS[styleOf(P).special]; if (sm) infoCard('desc-color', sm.name, sm.desc, `Special move ${keysFor('special')}`); }
  applyLook.done = true;
  if (!rig.face) setFace(rig, 'normal');   // (so you can see your eyebrows before the game's started)
  $('youFace').innerHTML = faceHTML(LOOK.color);
  $('you').style.setProperty('--pc', '#' + LOOK.color.toString(16).padStart(6, '0'));   // (your power card's stripe, in your colour)
  localStorage.setItem('ragdollLook', JSON.stringify(LOOK));
  if (changed && typeof redrawPictures === 'function') redrawPictures(changed);   // (you're in the pictures too: see pictures.js)
  // (show which ones are picked)
  document.querySelectorAll('#custom [data-k]').forEach(b => b.classList.toggle('on', String(LOOK[b.dataset.k]) === b.dataset.v));
}

// the box under each choice saying what it is: a speech bubble, its name big, a tag, and a line about it
// (kind: 'locked' for a padlocked one: red)
const HAT_LINES = { none: 'Just you and your big round head.', cap: 'A classic. Sporty!', 'top hat': 'Very fancy. Very tall.',
  'party hat': 'Every fight is a party.', beanie: 'Warm, woolly, and ready to rumble.', viking: 'Big horns! Fearsome.',
  'chef hat': 'Cooking up a knuckle sandwich.', 'cowboy hat': "This island ain't big enough for the both of us.",
  'propeller cap': 'It spins! (It does not help you fly.)', 'traffic cone': 'Caution: falling ragdolls.',
  'wizard hat': 'You shall not pass. (Off the edge, that is.)', 'pirate hat': 'Arr! Make them walk the plank.',
  'bunny ears': 'Hop, skip, and punch.', halo: 'An angel. Who knocks people off islands.', crown: 'Level 20. The king of the sky island!' };
function infoCard(id, title, text, tag, kind, bars) {
  const el = $(id);
  if (!el) return;
  el.className = 'desc info' + (kind ? ' ' + kind : '');
  el.innerHTML = `<span class="tag">${tag}</span><b>${title}</b><span class="txt">${text}</span>${bars || ''}`;
  bump(el, 'pop');
}

// stat bars: how a thing changes each stat (a multiplier: 1 is normal, the middle of the bar; 2 or more fills it)
function statBars(rows) {
  return `<span class="stats">${rows.map(([label, v]) => {
    const w = clamp(v / 2, 0.04, 1) * 100, pc = Math.round((v - 1) * 100), cls = pc > 0 ? 'up' : pc < 0 ? 'down' : '';
    return `<span class="st ${cls}"><span class="l">${label}</span><span class="sb"><i style="width:${w.toFixed(0)}%"></i><u></u></span><span class="v">${pc > 0 ? '+' : ''}${pc ? pc + '%' : '—'}</span></span>`;
  }).join('')}</span>`;
}
const st = (s, k) => s[k] === undefined ? 1 : s[k];
const gearBars = s => statBars([['Punch', st(s, 'punch')], ['Kick', st(s, 'kick')], ['Knockback', st(s, 'heft')], ['Speed', st(s, 'speed')], ['Jump', st(s, 'jump')], ['Grip', st(s, 'grip')]]);
const sizeBars = s => statBars([['Hits', st(s, 'punch')], ['Knockback', st(s, 'heft')], ['Speed', st(s, 'speed')], ['Jump', st(s, 'jump')], ['Weight', st(s, 'tough')]]);
// a body (and its model) made bigger or smaller
function setBodySize(B, rig, size) {
  B.size = size; B.R = size === 1 ? RAG_R : RAG_R.map(r => r * size);
  // (gravity pulls a small one down just as hard: its muscles have to be stronger for it to stand up straight
  // and keep its legs going under it)
  B.stiff = size < 1 ? 1.9 : 1;
  if (!rig) return;
  rig.baseScale = rig.baseScale || rig.root.scale.x;
  rig.root.scale.setScalar(rig.baseScale * size); rig.root.updateMatrixWorld(true);
  rig.armInv = rig.bones.lb.parent.matrixWorld.clone().invert();
}

function buildCustom() {
  const el = $('custom');
  const opts = (k, list) => `<div class="opts">${list.map(v => `<button data-k="${k}" data-v="${v}">${v}</button>`).join('')}</div>`;
  el.innerHTML = `<h2>YOUR RAGDOLL</h2>
    <div class="tabs"><button data-tab="look" class="on">LOOK</button><button data-tab="gear">GEAR</button></div>
    <div class="tab" id="tab-look">
      <h3>Colour (each has its own special move)</h3><div class="ccards">${LOOK_COLORS.map((c, i) => `<button class="ccard" data-k="color" data-v="${c}" style="--fc:#${c.toString(16).padStart(6, '0')};--tilt:${i % 2 ? 2 : -2}deg">${faceHTML(c)}<em>${(SPECIALS[(STYLES[c] || NO_STYLE).special] || { name: '' }).name}</em></button>`).join('')}</div>
      <p class="desc" id="desc-color"></p>
      <h3>Size</h3><div class="sizes">${Object.keys(SIZES).map(k => `<button class="ccard size" data-k="size" data-v="${k}" style="--fc:#${LOOK.color.toString(16).padStart(6, '0')};--z:${SIZES[k].scale}">${faceHTML(LOOK.color)}<em>${SIZES[k].name}</em></button>`).join('')}</div>
      <p class="desc" id="desc-size"></p>
      <p class="unlockNote" id="unlockNoteHat"></p><h3>Hat</h3>${opts('hat', HATS)}<p class="desc" id="desc-hat"></p>
      <h3>Eyebrows</h3>${opts('brows', Object.keys(BROWS))}
    </div>
    <div class="tab" id="tab-gear" style="display:none">
      <p class="unlockNote" id="unlockNote"></p>
      ${Object.keys(GEAR).map(slot => `<h3>${slot}</h3>${opts(slot, Object.keys(GEAR[slot]))}<p class="desc" id="desc-${slot}"></p>`).join('')}
    </div>
    <button id="customDone">DONE</button>`;
  el.querySelectorAll('[data-tab]').forEach(b => b.onclick = () => {
    el.querySelectorAll('[data-tab]').forEach(t => t.classList.toggle('on', t === b));
    for (const t of ['look', 'gear']) $('tab-' + t).style.display = t === b.dataset.tab ? '' : 'none';
  });
  el.querySelectorAll('[data-k]').forEach(b => b.onclick = () => {
    if (!unlocked(b.dataset.v)) {
      // (locked: say how to get it)
      const L = UNLOCK[b.dataset.v], left = xpTo(L) - SAVE.xp;
      infoCard('desc-' + b.dataset.k, 'LOCKED!', `Reach level ${L} to unlock the ${b.dataset.v}. That's ${left} more XP: ring fighters out and clear waves!`, b.dataset.v, 'locked');
      bump(b, 'shake');
      return;
    }
    LOOK[b.dataset.k] = b.dataset.k === 'color' ? +b.dataset.v : b.dataset.v;
    applyLook(b.dataset.k);
  });
  $('customDone').onclick = closeCustom;
  showLocks();
  $('customize').onclick = openCustom;
  applyLook();
}
// the hat and gear buttons: a picture of each (see pictures.js; just its name until that's made), a cross
// for none; locked ones get a padlock, and how many ring-outs they need
function showLocks() {
  document.querySelectorAll('#custom [data-k="hands"], #custom [data-k="feet"], #custom [data-k="hat"]').forEach(b => {
    const k = b.dataset.v, lock = !unlocked(k);
    b.classList.toggle('locked', lock);
    b.classList.toggle('pic', k === 'none' || !!ICONS[k]);
    b.title = k;
    const face = k === 'none' ? '<span class="nothing">NONE</span>' : ICONS[k] ? `<img src="${ICONS[k]}" alt="${k}">` : k;
    b.innerHTML = face + (lock ? `<i class="lock">LEVEL ${UNLOCK[k]}</i>` : '');
  });
  // (your level, and what's next)
  const L = myLevel(), nx = nextUnlock(), into = SAVE.xp - xpTo(L);
  const note = `Level up to unlock hats and gear! You're <b>LEVEL ${L}</b> <span class="xpTo">${into} / ${xpStep(L)} XP</span>${nx ? `<br>Next: the <u>${nx.kind}</u> at level ${nx.level}.` : '<br>You have unlocked everything!'}`;
  for (const id of ['unlockNote', 'unlockNoteHat']) { const n = $(id); if (n) n.innerHTML = note; }
}
function openCustom() { CUSTOM.open = true; CUSTOM.t = 0; $('overlay').classList.add('custom'); }
function closeCustom() {
  CUSTOM.open = false; $('overlay').classList.remove('custom'); fitTitle();
  if (started) updateCamera(1);   // (back to where the camera was, behind you)
}

// while you're choosing: the camera in front of you, swaying gently from side to side
const _cc = V3(), _cf = V3(), _cr = V3();
function customCamera(dt) {
  CUSTOM.t += dt;
  poseRig(body.pos);
  updateGear();
  const a = P.yaw + Math.sin(CUSTOM.t * 0.5) * 0.5;
  fwdOf(a, _cf); rightOf(P.yaw, _cr);
  _cc.copy(body.pos[0]).lerp(body.pos[7], 0.45);
  camera.position.copy(_cc).addScaledVector(_cf, 2.4).y += 0.35;
  // (looking a little to one side, so you stand on the left and the panel's on the right)
  camera.lookAt(_cc.addScaledVector(_cr, -0.55));
  updateSun(body.pos[7]);
}
