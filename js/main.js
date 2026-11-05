// Start-up and the main loop.
'use strict';
// (ready: everything's loaded. playing: the game's on: not on the title screen, and not paused. Nothing moves
// until you press Play, and everything stops while you're paused.)
let ready = false, playing = false, started = false, last = performance.now(), acc = 0;

roomRandom();   // (online: the same island for both of you. See ROOM in core.js)
buildWorld();
buildNature();

// The island: its shape, hills, trees, boulders, mud and rocks (a different one every time the page loads)
function makeIsland() {
  buildIsland();
  decorate();
  buildPatches();
  buildProps();
  for (const pr of props) if (!pr.home) { pr.home = pr.c.clone(); pr.sleep = true; }
}
makeIsland();
Math.random = trueRandom;   // (the island's built: properly random from here on. See ROOM in core.js)

new THREE.GLTFLoader().load('models/ragdoll.glb', gltf => {
  playerRig = setupRig(gltf);
  respawn();
  for (let i = 0; i < MAX_FIGHTERS; i++) loadFighter(i);
  updateCamera(1);
  ready = true;
  buildUI();
  buildCustom();
  buildCombos();   // (the COMBOS page: see combos.js)
  $('combosBtn').style.display = '';
  makePictures();   // (the gear and hat pictures, and the funny ones: see pictures.js)
  $('customize').style.display = '';
  $('loading').style.display = 'none';
  $('play').style.display = '';
  fitTitle();
}, null, err => { $('loading').textContent = 'Could not load the character: ' + (err.message || err); });

function startGame() {
  if (!ready) return;
  if (CUSTOM.open) closeCustom();
  closeCombos(); closeControls(); closeOnline();
  const first = !started;
  playing = started = true; last = performance.now(); acc = 0;
  hideMenu();
  // (the very start of a game: 3, 2, 1, FIGHT! Online, once you've both pressed PLAY: see net.js)
  if (first) { if (NET.on) netReady(); else startCountdown(); }
  lockPointer();
}
function pauseGame() {
  if (!playing) return;
  playing = false;
  for (const k in keys) keys[k] = false;   // (so you don't come back still running)
  showMenu(true);
}
$('play').onclick = startGame;
// (letting go of the mouse, with Esc, pauses; and so does Esc or P if the mouse wasn't locked)
document.addEventListener('pointerlockchange', () => { if (!document.pointerLockElement) pauseGame(); });
addEventListener('keydown', e => { if ((e.code === 'Escape' || e.code === 'KeyP') && playing && !document.pointerLockElement) pauseGame(); });
addEventListener('blur', pauseGame);

function frame(now) {
  requestAnimationFrame(frame);
  const dt = clamp((now - last) / 1000, 0, 0.05); last = now;
  updateTouch();   // (touch controls, on a phone or tablet: see touch.js)   // (never backwards: the first frame can be timed a touch before the clock started)
  if (ready && !started) {
    // the title screen: the camera drifts slowly round the island
    const t = now / 1000 * 0.06;
    camera.position.set(Math.cos(t) * 62, 30, 2 + Math.sin(t) * 62);
    camera.lookAt(0, -4, 2);
    updateSun(V3(0, 0, 2));
    updateWorld(dt);
  }
  if (ready && CUSTOM.open) customCamera(dt);   // (dressing up: looking at you)
  // (online, the fight goes on while your menu's up: your friend's still playing. See net.js)
  const live = ready && (playing || (started && NET.ready));
  if (live && holdForCountdown(dt)) {
    // the countdown (3, 2, 1...): nobody moves yet, but you can look about
    poseRig(body.pos); drawFighters(); drawProps(dt); updateCamera(dt); updateSun(cam.target); updateWorld(dt); updateUI(dt);
    pressed.clear(); mouse.dx = mouse.dy = mouse.wheel = 0;
    if (!drawPicture(dt)) renderer.render(scene, camera);
    return;
  }
  if (live && FX.stop > 0) {
    // hit-stop: everything freezes for a split second on a hit (the effects and the shake carry on)
    FX.stop -= dt;
    updateFX(dt); updateCamera(dt); shakeCamera(dt);
    renderer.render(scene, camera);
    return;   // (and the keys pressed this frame are kept for when it unfreezes)
  }
  if (live) {
    updateHands();
    updatePlayer(dt);
    if (!body.limp) buildGoals(dt);
    else { body.k = 0; body.damp = 0; body.lift = 0; body.ramp = 0; }
    updateWind(dt);
    updateWaves(dt);   // (dropping in each wave's fighters: see fighters.js)
    updateFighters(dt);
    updateAllies(dt);   // (your double, if you've got one: see allies.js)
    updateSpecials(dt);   // (special moves: see specials.js)
    netFrame(dt);   // (online 1v1: see net.js)
    updateMud(dt);
    updateLoot(dt);   // (gear: dropped, picked up, pinched, muddy)
    updatePower(dt);
    P.hitT = (P.hitT || 0) - dt;
    acc += dt;
    while (acc >= H) {
      acc -= H;
      stepBody(WIND.dir.x * windPush(body), WIND.dir.z * windPush(body));
      stepProps();
      stepGrip();
      stepPunch();
      stepKick();
      stepFighters();
      const slam = slammed(body);   // (knocked into a tree: ouch)
      if (slam) { fxSlam(body, slam); P.dmg += slam * 1.2; P.power = Math.max(0, P.power - slam * 5); P.slammed = true; }
      const hitBy = bodyHitsProps();
      if (hitBy && !body.limp && !(P.hitT > 0)) {
        const [dm, heft] = propHit(hitBy), dir = propDir(hitBy, body, _t), by = fighters.find(F => F.B === hitBy.heldBy || F.B === hitBy.lastBy);
        // (rocks hit you less hard; one a fighter swung counts as its hit, for its power)
        if (by) fighterHits(by, dm * 0.6, dir, 1, 1 + (heft - 1) * 0.5); else hurtPlayer(dm * 0.6, dir, 1, 1 + (heft - 1) * 0.5);
      }
    }
    // (shadows are redrawn every other frame: half the work, and you can't tell)
    renderer.shadowMap.autoUpdate = false;
    renderer.shadowMap.needsUpdate = (frame.n = (frame.n || 0) + 1) % 2 === 0;
    poseRig(body.pos);
    updateGear();   // (the hammer, in your hand)
    drawFighters();
    specialLooks(dt);   // (special moves glowing, vanishing: see specials.js)
    drawProps(dt);
    updateCamera(dt);
    updateFX(dt);
    shakeCamera(dt);
    fadeTrees(dt);
    updateSun(cam.target);
    updateWorld(dt);
    updateUI(dt);
  }
  pressed.clear(); mouse.dx = mouse.dy = mouse.wheel = 0;
  // (with the menus up, it's the funny picture that's drawn: see pictures.js)
  if (!live) renderer.shadowMap.autoUpdate = true;   // (the menus' pictures: shadows every frame, as normal)
  if (!drawPicture(dt)) renderer.render(scene, camera);
}
requestAnimationFrame(frame);
