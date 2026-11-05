// Sound: made right here, as it's needed, out of noise and simple waves (Web Audio): no sound files. Only four
// things make a sound: hits (punches, kicks, swung rocks, and slamming into trees and boulders), combos, the
// buttons, and the music (five songs: see below).
// (Hits on trees, rocks and the ground, and the ground pound, count as hits too.)
// The hits are built like real ones: a sharp snap of skin, a meaty smack, a low thud from the body, a little
// grit, and a touch of echo off the island; panned left or right by where they happen, quieter far away.
// SOUND and MUSIC can each be turned off (buttons on the title / pause screen), and that's remembered.
'use strict';
const SND = Object.assign({ sfx: true, music: true }, JSON.parse(localStorage.getItem('ragdollSound') || '{}'));
let AC = null, sfxOut = null, musicOut = null, noiseBuf = null, brownBuf = null, hitBus = null, guitarIn = null;

// (browsers only let a page make sound once you've clicked or pressed something: so it all starts then)
function startAudio() {
  if (AC) { if (AC.state === 'suspended') AC.resume(); return; }
  const C = window.AudioContext || window.webkitAudioContext;
  if (!C) return;
  AC = new C();
  const comp = AC.createDynamicsCompressor();
  comp.threshold.value = -14; comp.ratio.value = 6;
  comp.connect(AC.destination);
  const master = AC.createGain(); master.gain.value = 0.8; master.connect(comp);
  sfxOut = AC.createGain(); sfxOut.connect(master);
  musicOut = AC.createGain(); musicOut.connect(master);
  setVolumes();
  // noise: white (hiss), and brown (deep rumble, for the body of a hit)
  noiseBuf = AC.createBuffer(1, AC.sampleRate, AC.sampleRate);
  brownBuf = AC.createBuffer(1, AC.sampleRate, AC.sampleRate);
  const d = noiseBuf.getChannelData(0), br = brownBuf.getChannelData(0);
  let last = 0;
  for (let i = 0; i < d.length; i++) { d[i] = Math.random() * 2 - 1; last = (last + 0.02 * d[i]) / 1.02; br[i] = last * 3.5; }
  // hits go through a bit of grit (soft clipping), then out, and a little into a short echo
  const grit = AC.createWaveShaper(), curve = new Float32Array(1024);
  for (let i = 0; i < 1024; i++) { const x = i / 511.5 - 1; curve[i] = Math.tanh(2.2 * x) / Math.tanh(2.2); }
  grit.curve = curve;
  hitBus = AC.createGain(); hitBus.gain.value = 2;
  hitBus.connect(grit).connect(sfxOut);
  const room = AC.createConvolver(), ir = AC.createBuffer(2, AC.sampleRate * 0.35, AC.sampleRate);
  for (let c = 0; c < 2; c++) { const r = ir.getChannelData(c); for (let i = 0; i < r.length; i++) r[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / r.length, 4); }
  room.buffer = ir;
  const wet = AC.createGain(); wet.gain.value = 0.14;
  grit.connect(room).connect(wet).connect(sfxOut);
  // the music's guitar: a distortion pedal and an amp (cuts the fizz off the top)
  guitarIn = AC.createGain();
  const dist = AC.createWaveShaper(), dc = new Float32Array(2048);
  for (let i = 0; i < 2048; i++) { const x = i / 1023.5 - 1; dc[i] = Math.tanh(14 * x); }
  dist.curve = dc; dist.oversample = '4x';
  const amp = AC.createBiquadFilter(); amp.type = 'lowpass'; amp.frequency.value = 3000; amp.Q.value = 0.9;
  const body = AC.createBiquadFilter(); body.type = 'peaking'; body.frequency.value = 800; body.gain.value = -5;
  const gOut = AC.createGain(); gOut.gain.value = 0.16;
  guitarIn.connect(dist).connect(amp).connect(body).connect(gOut).connect(musicOut);
  setInterval(musicTick, 25);
}
addEventListener('pointerdown', startAudio, true);
addEventListener('keydown', startAudio, true);
// (quiet while the game's in another tab)
document.addEventListener('visibilitychange', () => { if (AC) document.hidden ? AC.suspend() : AC.resume(); });

function setVolumes() {
  if (!AC) return;
  sfxOut.gain.setTargetAtTime(SND.sfx ? 1 : 0, AC.currentTime, 0.02);
  musicOut.gain.setTargetAtTime(SND.music ? 0.32 : 0, AC.currentTime, 0.05);
}

// ---------------------------------------------------------------- the building blocks
// a tone: a wave sliding from f0 to f1, fading out (vib: wobble, out: where it goes)
function tone(type, f0, f1, dur, vol, at = 0, o = {}) {
  if (!AC) return;
  const t = AC.currentTime + at, osc = AC.createOscillator(), g = AC.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(f0, t);
  if (f1 !== f0) osc.frequency.exponentialRampToValueAtTime(f1, t + dur);
  if (o.vib) {   // (a wobble)
    const lfo = AC.createOscillator(), lg = AC.createGain();
    lfo.frequency.value = o.vib; lg.gain.value = o.vibAmt || f0 * 0.03;
    lfo.connect(lg).connect(osc.frequency); lfo.start(t); lfo.stop(t + dur + 0.05);
  }
  const atk = o.attack || 0.005;
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + atk);
  if (o.hold) g.gain.setValueAtTime(vol, t + o.hold);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  let node = osc.connect(g);
  if (o.lp) { const f = AC.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = o.lp; node = node.connect(f); }
  node.connect(o.out || sfxOut);
  osc.start(t); osc.stop(t + dur + 0.05);
}
// a hiss through a filter sliding from f0 to f1 (a whoosh, a thud's crack, a drum)
function hiss(dur, vol, kind, f0, f1, at = 0, o = {}) {
  if (!AC) return;
  const t = AC.currentTime + at, src = AC.createBufferSource(), f = AC.createBiquadFilter(), g = AC.createGain();
  src.buffer = o.brown ? brownBuf : noiseBuf; src.loop = true;
  f.type = kind; f.Q.value = o.Q || 1;
  f.frequency.setValueAtTime(f0, t);
  f.frequency.exponentialRampToValueAtTime(f1, t + dur);
  const atk = o.attack || 0.003;
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + atk);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(f).connect(g).connect(o.out || sfxOut);
  src.start(t, Math.random() * 0.5); src.stop(t + dur + 0.05);
}
const wob = (f, a = 0.08) => f * (1 + rand(-a, a));   // (a bit different every time)
// how loud something is from where you are (far-off fights are quieter), and which side it's on
function nearYou(pos) {
  if (!pos || typeof playerBody === 'undefined' || !playerBody.pos[7]) return 1;
  return clamp(1.3 - playerBody.pos[7].distanceTo(pos) / 25, 0.35, 1);
}
const _sndR = new THREE.Vector3(), _sndD = new THREE.Vector3();
function sideOf(pos) {
  if (!pos) return 0;
  _sndR.setFromMatrixColumn(camera.matrixWorld, 0);
  _sndD.subVectors(pos, camera.position);
  const d = _sndD.length();
  return d < 1e-3 ? 0 : clamp(_sndD.dot(_sndR) / d, -1, 1) * 0.7;
}

// ---------------------------------------------------------------- the sounds
// One hit landing (s: how hard, 0.5 a tap to 1.6 a huge one; at: when; v: how loud; pan: -1 left to 1 right).
// There are a few kinds of hit, picked at random (never the same kind twice running), and every one's pitched
// and timed a little differently too, so a fight never sounds like the same sound over and over:
//   jab: tight and snappy · body: a deep, heavy blow to the gut · slap: bright and stinging
//   crunch: gritty, with a crack · thwack: a hollow, woody whack
const HIT_KINDS = {
  jab:    { snap: 1.2, smack: 0.8, smackF: 1600, body: 0.6, bodyLen: 0.7, thud: 0.8, thudF: 115 },
  body:   { snap: 0.5, smack: 0.6, smackF: 900,  body: 1.3, bodyLen: 1.4, thud: 1.2, thudF: 80 },
  slap:   { snap: 1.5, smack: 1.2, smackF: 2200, body: 0.4, bodyLen: 0.6, thud: 0.4, thudF: 140 },
  crunch: { snap: 1.0, smack: 0.9, smackF: 1200, body: 1.0, bodyLen: 1.0, thud: 0.9, thudF: 95, crack: 1 },
  thwack: { snap: 0.8, smack: 0.7, smackF: 1000, body: 0.8, bodyLen: 0.9, thud: 0.9, thudF: 100, knock: 1 },
};
let lastHitKind = '';
function impact(s = 1, at = 0, v = 1, pan = 0, kind) {
  if (!kind) { const ks = Object.keys(HIT_KINDS).filter(k => k !== lastHitKind); kind = ks[Math.floor(Math.random() * ks.length)]; }
  lastHitKind = kind;
  const K = HIT_KINDS[kind], pitch = rand(0.85, 1.18);
  const out = AC.createStereoPanner(); out.pan.value = clamp(pan + rand(-0.08, 0.08), -1, 1); out.connect(hitBus);
  const o = { out };
  // (sometimes two layers land a hair apart, like a glove and then the arm behind it)
  const flam = Math.random() < 0.35 ? rand(0.008, 0.02) : 0;
  hiss(rand(0.01, 0.022), 0.55 * K.snap * v, 'highpass', 2500 * pitch, 1800 * pitch, at, { ...o, attack: 0.001 });                         // the snap
  if (flam) hiss(0.012, 0.3 * K.snap * v, 'highpass', 2200 * pitch, 1600 * pitch, at + flam, { ...o, attack: 0.001 });
  hiss((0.04 + 0.04 * s) * rand(0.8, 1.25), 0.65 * K.smack * v, 'bandpass', wob(K.smackF * pitch, 0.15), wob(K.smackF * 0.55, 0.2), at, { ...o, Q: rand(0.6, 1.2), attack: 0.002 });   // the smack
  hiss((0.08 + 0.12 * s) * K.bodyLen * rand(0.85, 1.2), Math.min(1.2, 0.55 * s * K.body) * v, 'lowpass', wob(700 * pitch, 0.15), 110, at + 0.002 + flam, { ...o, brown: true });   // the body
  tone('sine', K.thudF * pitch * (1.1 - 0.12 * s), 40, (0.07 + 0.14 * s) * rand(0.85, 1.2), Math.min(1, 0.45 * s * K.thud) * v, at + 0.003 + flam, { ...o, attack: 0.003 });   // the thud
  if (K.crack) hiss(rand(0.015, 0.03), 0.45 * v, 'bandpass', rand(2800, 4200), rand(2000, 3000), at + rand(0.004, 0.012), { ...o, Q: 3, attack: 0.001 });   // a crack
  if (K.knock) tone('triangle', rand(180, 260) * pitch, rand(140, 180), rand(0.05, 0.09), 0.35 * v, at + 0.002, o);        // a hollow knock
}
const SFX = {
  // a button: a little plastic click
  click() { hiss(0.006, 0.25, 'highpass', 3500, 3000, 0, { attack: 0.0005 }); hiss(0.01, 0.15, 'bandpass', 1800, 1500, 0.035, { Q: 2, attack: 0.0005 }); },
  // a hit landing: harder hits, heavier sound
  hit(tier, pos) { impact(tier === 'small' ? 0.55 : tier === 'mid' ? 1 : 1.5, 0, nearYou(pos), sideOf(pos)); },
  // slammed into a tree or a boulder: a heavy body hit, and the crunch and knock of whatever they hit
  slam(pos) {
    const v = nearYou(pos), pan = sideOf(pos);
    impact(1.6, 0, v, pan);
    const out = AC.createStereoPanner(); out.pan.value = pan; out.connect(hitBus);
    hiss(0.12, 0.45 * v, 'bandpass', wob(320), 240, 0.01, { out, Q: 3 });                     // the knock
    hiss(0.25, 0.3 * v, 'lowpass', 2500, 300, 0.015, { out });                                // the crunch
  },
  // a punch or a kick on something that isn't a fighter: a tree or boulder (a hard, woody thwack), a rock you
  // can pick up (a duller knock), or the ground (a dull thud and a little dirt)
  thing(what, pos, kick) {
    const v = nearYou(pos), pan = sideOf(pos), out = AC.createStereoPanner(); out.pan.value = pan; out.connect(hitBus);
    if (what === 'ground') {
      tone('sine', wob(90), 38, 0.2, 0.7 * v, 0, { out });
      hiss(0.16, 0.45 * v, 'lowpass', wob(900), 150, 0, { out, brown: true });
      hiss(0.1, 0.12 * v, 'bandpass', 2500, 1500, 0.01, { out, Q: 0.8 });   // (the dirt)
      return;
    }
    impact(kick ? 0.8 : 0.6, 0, v * 0.7, pan, 'thwack');
    const f = what === 'tree' ? rand(230, 320) : rand(380, 520);
    hiss(what === 'tree' ? 0.14 : 0.08, 0.5 * v, 'bandpass', f, f * 0.8, 0.003, { out, Q: what === 'tree' ? 5 : 3 });
    tone('triangle', f * 0.9, f * 0.7, 0.07, 0.3 * v, 0.003, { out });
  },
  // the ground pound landing: a huge thud that shakes the island
  pound() {
    const out = hitBus;
    tone('sine', 85, 28, 0.6, 1, 0, { out });
    hiss(0.5, 0.7, 'lowpass', 1500, 80, 0, { out, brown: true });
    hiss(0.25, 0.3, 'lowpass', 3500, 400, 0.005, { out });
  },
  // a combo: one more, even heavier blow right on top of the hit, and a sharp crack
  combo() { impact(1.6, 0.025, 0.8, 0, Math.random() < 0.5 ? 'body' : 'crunch'); hiss(0.03, 0.4, 'highpass', 3000, 2000, 0.025, { out: hitBus, attack: 0.001 }); },
};
// (each sound by name, if sound's on: sfx('hit', 'big', pos))
// (online, the other player hears yours too: hitting trees, rocks and the ground, ground pounds, combos, slams.
// Your hits on each other they hear anyway: each computer makes the sound of a hit landing)
const SHARED_SFX = ['thing', 'pound', 'combo', 'slam'];
function sfx(name, ...args) {
  if (typeof NET !== 'undefined' && NET.ready && !sfx.remote && SHARED_SFX.includes(name)) netSend({ t: 'sfx', n: name, a: args.map(a => a && a.isVector3 ? { v: a.toArray().map(r3) } : a) });
  if (AC && SND.sfx && AC.state === 'running') SFX[name](...args);
}

// every button clicks
addEventListener('click', e => { if (e.target.closest && e.target.closest('button')) sfx('click'); }, true);

// ---------------------------------------------------------------- the music
// Five songs, all written out here as notes and drum patterns, and played live (nothing's recorded):
//   MENU    on the title screen: slow and moody, big ringing chords
//   BRAWL   A minor, fast: chugging guitar, pounding drums, a screaming lead
//   STREET  E minor, funky: a bouncing bass, guitar stabs, a boom-bap beat
//   RUMBLE  G minor, driving: a four-on-the-floor stomp
//   BOSS    when a champion's on the island: D harmonic minor, really fast, galloping guitar, double kicks
// The fight songs take turns, a new one each wave. Pause and the drums and the lead drop out till you're back.
// Each song: bpm; roots (each bar's chord, as note numbers: 60 is middle C); gtr / gtr2 (the guitar's rhythm in
// a bar, x a chug, X a long one; gtr2 on every fourth bar); bass (the bass's rhythm, if it's not the guitar's;
// o: an octave up); kick / snare / fill (the drums); lead (each bar: [step, note, how many steps long]);
// leadEvery (the lead plays every time round, or every other).
const SONGS = {
  menu: { bpm: 108, roots: [45, 41, 48, 43], gtr: 'X.......X.....x.', bass: 'x.x.x.x.x.x.x.x.', kick: 'x.......x.x.....', snare: '....x.......x...',
    lead: [[[0, 76, 6], [6, 74, 2], [8, 72, 8]], [[0, 69, 6], [6, 72, 2], [8, 77, 8]], [[0, 79, 6], [6, 77, 2], [8, 76, 8]], [[0, 74, 8], [8, 71, 8]]], leadEvery: 2 },
  brawl: { bpm: 150, roots: [45, 41, 43, 40, 45, 41, 38, 40], gtr: 'x.xxx.xxx.xxx.x.', gtr2: 'X..X..X.x.xxX...',
    kick: 'x..x..x.x.xx..x.', snare: '....x.......x...', fill: '....x.......xxxx', leadEvery: 2,
    lead: [[[0, 69, 3], [3, 72, 3], [6, 76, 2], [8, 74, 2], [10, 72, 2], [12, 71, 2], [14, 72, 2]], [[0, 72, 3], [3, 69, 3], [6, 77, 4], [10, 76, 2], [12, 72, 4]],
      [[0, 74, 3], [3, 71, 3], [6, 67, 2], [8, 71, 2], [10, 74, 2], [12, 79, 4]], [[0, 80, 6], [6, 76, 2], [8, 74, 2], [10, 71, 2], [12, 68, 4]],
      [[0, 81, 4], [4, 79, 2], [6, 76, 2], [8, 81, 2], [10, 84, 6]], [[0, 81, 3], [3, 77, 3], [6, 72, 2], [8, 77, 4], [12, 81, 4]],
      [[0, 74, 2], [2, 77, 2], [4, 81, 2], [6, 86, 6], [12, 84, 2], [14, 81, 2]], [[0, 83, 4], [4, 80, 4], [8, 76, 8]]] },
  street: { bpm: 126, roots: [40, 40, 43, 45, 40, 40, 47, 45], gtr: '..x...x...x..x.x', gtr2: '..x...x...X.....', bass: 'x..o.xx.x..o.x.o',
    kick: 'x.....x...x.....', snare: '....x.......x..x', fill: '....x.......x.xx', leadEvery: 1,
    lead: [[[0, 76, 2], [2, 79, 2], [4, 76, 1], [6, 74, 2], [8, 71, 4], [12, 74, 2], [14, 76, 2]], [[0, 79, 3], [3, 81, 3], [6, 79, 2], [8, 76, 6], [14, 74, 2]],
      [[0, 71, 2], [2, 74, 2], [4, 76, 2], [6, 79, 4], [10, 81, 2], [12, 83, 4]], [[0, 81, 4], [4, 79, 2], [6, 76, 2], [8, 74, 4], [12, 76, 4]]] },
  rumble: { bpm: 140, roots: [43, 43, 46, 48, 43, 43, 39, 38], gtr: 'xxx.xxx.xx.xxx.x', gtr2: 'X...X...X.x.x.x.',
    kick: 'x...x...x...x.x.', snare: '....x.......x...', fill: '....x...x.x.xxxx', leadEvery: 2,
    lead: [[[0, 79, 4], [4, 77, 2], [6, 74, 2], [8, 75, 4], [12, 74, 4]], [[0, 70, 2], [2, 72, 2], [4, 74, 4], [8, 77, 2], [10, 75, 2], [12, 74, 4]],
      [[0, 79, 2], [2, 82, 2], [4, 81, 4], [8, 79, 2], [10, 77, 2], [12, 75, 4]], [[0, 74, 6], [6, 72, 2], [8, 70, 4], [12, 66, 4]]] },
  boss: { bpm: 172, roots: [38, 38, 46, 45, 38, 41, 43, 45], gtr: 'x.xxx.xxx.xxx.xx', gtr2: 'X.....X.....X.X.',
    kick: 'x.x.x.x.x.x.x.x.', snare: '....x.......x...', fill: '....x...xxxxxxxx', leadEvery: 1,
    lead: [[[0, 74, 2], [2, 77, 2], [4, 81, 2], [6, 86, 6], [12, 85, 4]], [[0, 82, 4], [4, 81, 2], [6, 79, 2], [8, 77, 4], [12, 76, 4]],
      [[0, 74, 2], [2, 76, 2], [4, 77, 2], [6, 79, 2], [8, 81, 2], [10, 82, 2], [12, 85, 4]], [[0, 86, 8], [8, 81, 8]]] },
};
const FIGHT_SONGS = ['brawl', 'street', 'rumble'];
const midi = n => 440 * Math.pow(2, (n - 69) / 12);
const MUS = { song: 'menu', step: 0, next: 0 };
// which song should be on right now
function wantSong() {
  if (typeof started === 'undefined' || !started) return 'menu';
  if (fighters.some(F => F.champ)) return 'boss';
  return FIGHT_SONGS[wave % FIGHT_SONGS.length];
}
function musicTick() {
  if (!AC || AC.state !== 'running') return;
  if (!SND.music) { MUS.next = 0; return; }
  if (MUS.next < AC.currentTime) MUS.next = AC.currentTime + 0.05;
  while (MUS.next < AC.currentTime + 0.15) {
    // (a new song starts at the top of a bar)
    if (MUS.step % 16 === 0) { const w = wantSong(); if (w !== MUS.song) { MUS.song = w; MUS.step = 0; } }
    const T = SONGS[MUS.song];
    playStep(T, MUS.step, MUS.next - AC.currentTime, typeof playing === 'undefined' || playing || MUS.song === 'menu');
    MUS.step++; MUS.next += 60 / T.bpm / 4;
  }
}
// one power chord on the guitar (root, fifth, octave; two strings a hair out of tune for thickness)
function chug(root, len, at) {
  for (const n of [root, root + 7, root + 12]) for (const d of [0.997, 1.003])
    tone('sawtooth', midi(n) * d, midi(n) * d, len, 0.12, at, { out: guitarIn, attack: 0.003, hold: len * 0.6 });
}
// one sixteenth of a song (full: drums and the lead too)
function playStep(T, s, at, full) {
  const o = { out: musicOut }, STEP = 60 / T.bpm / 4, nb = T.roots.length;
  const bar = Math.floor(s / 16) % nb, i = s % 16, root = T.roots[bar], fourth = bar % 4 === 3;
  // guitar
  const g = (fourth && T.gtr2 || T.gtr)[i];
  if (g !== '.') chug(root + 12, g === 'X' ? STEP * (T === SONGS.menu ? 7 : 2.6) : STEP * 0.8, at);
  // bass
  const b = T.bass ? T.bass[i] : g;
  if (b !== '.') {
    const n = root - 12 + (b === 'o' ? 12 : 0), len = b === 'X' ? STEP * 2.6 : STEP * 0.85;
    tone('sawtooth', midi(n), midi(n), len * 1.1, 0.35, at, { ...o, lp: T === SONGS.street ? 900 : 500, attack: 0.004, hold: len * 0.7 });
  }
  // hi-hats
  if (i % 2 === 0 || T.bpm < 130) hiss(0.03, i % 4 === 2 ? 0.1 : 0.05, 'highpass', 8000, 8000, at, { ...o, attack: 0.001 });
  if (!full) return;
  // drums: a punchy kick, a cracking snare (a fill at the end of every fourth bar), a crash at the top
  if (T.kick[i] === 'x') { tone('sine', 140, 45, 0.2, 0.9, at, o); hiss(0.012, 0.25, 'lowpass', 4000, 2500, at, { ...o, attack: 0.001 }); }
  if ((fourth && T.fill || T.snare)[i] === 'x') {
    const v = T.snare[i] === 'x' ? 1 : 0.6;
    hiss(0.18, 0.4 * v, 'highpass', 1800, 1300, at, { ...o, attack: 0.001 });
    hiss(0.08, 0.3 * v, 'bandpass', 900, 700, at, { ...o, attack: 0.001 });
    tone('triangle', 200, 165, 0.08, 0.35 * v, at, o);
  }
  if (s % (nb * 16) === 0) hiss(1.6, 0.18, 'highpass', 5000, 4000, at, { ...o, attack: 0.002 });
  // the lead
  if (Math.floor(s / (nb * 16)) % T.leadEvery === T.leadEvery - 1) for (const [st, n, len] of T.lead[bar % T.lead.length]) if (st === i) {
    const d = STEP * len * 0.95;
    tone('sawtooth', midi(n), midi(n), d, 0.06, at, { ...o, lp: 2600, attack: 0.01, hold: d * 0.7, vib: 6, vibAmt: 4 });
    tone('square', midi(n) * 1.004, midi(n) * 1.004, d, 0.035, at, { ...o, lp: 2000, attack: 0.01, hold: d * 0.7 });
  }
}

// ---------------------------------------------------------------- the SOUND and MUSIC buttons
function showSoundBtns() {
  $('sfxBtn').textContent = SND.sfx ? 'SOUND ON' : 'SOUND OFF';
  $('musicBtn').textContent = SND.music ? 'MUSIC ON' : 'MUSIC OFF';
  $('sfxBtn').classList.toggle('off', !SND.sfx); $('musicBtn').classList.toggle('off', !SND.music);
}
function toggleSound(k) {
  SND[k] = !SND[k];
  localStorage.setItem('ragdollSound', JSON.stringify(SND));
  setVolumes(); showSoundBtns();
}
$('sfxBtn').onclick = () => toggleSound('sfx');
$('musicBtn').onclick = () => toggleSound('music');
showSoundBtns();
