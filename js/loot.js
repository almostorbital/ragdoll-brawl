// Gear on the loose. Gear doesn't stay put in a fight:
//  · you can't take yours off, but you can pick gear up off the ground with E (anything you had on in that
//    slot comes off for it);
//  · a hit that sends someone flying can knock their gear off, and it goes flying too;
//  · fighters go and pick up gear lying about, and wear it (and get its powers: see fighters.js). Get knocked
//    down and one may come and pinch yours! Knock them flying to get it back, or ring them out (whatever
//    they had on lands back on the island).
// And gear gets muddy: shoes from walking in mud, gloves and hammers from being dragged through it, and
// anything lying in it. It slowly comes clean again.
'use strict';
const loot = [];   // gear lying about: { item, grp, pos, vel, spin, rest, lift, age, ground }
const _lq = new THREE.Quaternion(), _le = new THREE.Euler(), _lv2 = V3(), _lv3 = V3(), _lbox = new THREE.Box3();

// gear flies off someone (a slot's worth), and lands somewhere about
function dropGear(who, slot, vel) {
  const g = gearOf(who), it = g[slot];
  if (!it) return null;
  g[slot] = null; wearGear(who);
  const B = bodyOf(who);
  return spawnLoot(it, slot === 'hands' ? B.pos[6] : B.pos[11], vel);
}
function spawnLoot(it, at, vel) {
  const grp = new THREE.Group(); scene.add(grp);
  const L = { item: it, grp, pos: at.clone(), vel: vel ? vel.clone() : V3(), spin: V3(rand(-7, 7), rand(-7, 7), rand(-7, 7)), age: 0, ground: false };
  // (how it lies once it's landed: on its side, turned any which way)
  L.rest = new THREE.Quaternion().setFromAxisAngle(UP, rand(0, Math.PI * 2));
  if (it.kind === 'cartoon hammer') L.rest.multiply(_lq.setFromAxisAngle(V3(0, 0, 1), Math.PI / 2));
  lootLooks(L);
  loot.push(L);
  return L;
}
// its models: a pair of gloves or shoes side by side, or the hammer
function lootLooks(L) {
  L.grp.clear();
  const it = L.item, n = it.kind === 'cartoon hammer' ? 1 : 2;
  for (let i = 0; i < n; i++) {
    let m = gearModel(it.kind, 0.012, it.mudU);
    if (!m) m = outline(new THREE.Mesh(roundedBox(0.2 * S, 0.14 * S, 0.26 * S, 0.03 * S), gearMat(0xffd23a, it.mudU)), 0.012);   // (until its model's loaded)
    if (n === 2) { if (it.slot === 'hands') m.position.z = (i ? 1 : -1) * 0.17 * S; else m.position.x = (i ? 1 : -1) * 0.14 * S; }   // (gloves lie long-ways: side by side)
    L.grp.add(m);
  }
  // (how far its middle sits above the ground, lying at rest)
  const q = L.grp.quaternion.clone(), p = L.grp.position.clone();
  L.grp.quaternion.copy(L.rest); L.grp.position.set(0, 0, 0); L.grp.updateMatrixWorld(true);
  _lbox.setFromObject(L.grp);
  L.lift = -_lbox.min.y;
  L.grp.quaternion.copy(q); L.grp.position.copy(p);
}
function removeLoot(L) {
  const i = loot.indexOf(L);
  if (i >= 0) loot.splice(i, 1);
  scene.remove(L.grp);
}
// someone picks up gear: puts it on (taking off what they had there)
function pickUpLoot(who, L) {
  if (!loot.includes(L)) return;
  removeLoot(L);
  if (NET.on && who === P) netSend({ t: 'took', id: L.id, kind: L.item.kind, p: L.pos.toArray().map(r3) });   // (online: gone from their island too)
  const slot = L.item.slot, B = bodyOf(who);
  if (gearOf(who)[slot]) {
    const old = dropGear(who, slot, fwdOf(who.yaw, _lv2).multiplyScalar(-1.5).setY(3));   // (the old one, tossed behind)
    if (NET.on && who === P && old) netLoot(old);   // (online: on their island too, so either of you can pick it up)
  }
  gearOf(who)[slot] = L.item; wearGear(who);
  fxDust(L.pos, 0.4);
  if (who !== P) fxWord(pick(['MINE!', 'OOH!', 'SHINY!']), B.pos[0], '', 0.6);
}
// a fighter pinches yours (while you're down)
function stealGear(F, slot) {
  const it = gearOf(P)[slot];
  if (!it) return;
  gearOf(P)[slot] = null; wearGear(P);
  if (gearOf(F)[slot]) dropGear(F, slot, fwdOf(F.yaw, _lv2).multiplyScalar(-1.5).setY(3));
  gearOf(F)[slot] = it; wearGear(F);
  fxWord(pick(['YOINK!', 'SWIPE!', 'GOTCHA!']), playerBody.pos[slot === 'hands' ? 5 : 11], '', 0.9);
}
// knocked flying: sometimes your gear comes off too (and flies off the way you're going)
function knockGearOff(B, dir) {
  if (NET.on && B !== playerBody) return;   // (online, the other player's computer knocks their own gear off: see net.js)
  const who = B === playerBody ? P : fighters.find(F => F.B === B);
  if (!who || Math.random() > 0.4) return;
  const slots = Object.keys(GEAR).filter(s => gearOf(who)[s]);
  if (!slots.length) return;
  const slot = slots[Math.floor(Math.random() * slots.length)];
  _lv2.copy(dir).setY(0).normalize().multiplyScalar(rand(2.5, 4.5)).y = rand(4.5, 6.5);
  const L = dropGear(who, slot, _lv2);
  if (NET.on && L) netLoot(L);   // (and it flies off on their screen too)
}
// a fighter rung out: whatever it had on lands back on the island, near where it went off
function returnGear(F) {
  for (const slot in GEAR) {
    const it = gearOf(F)[slot];
    if (!it) continue;
    gearOf(F)[slot] = null;
    nearestEdge(F.pos.x, F.pos.z, _lv2); islandOut(_lv2.x, _lv2.z, _lv3);
    let x = _lv2.x - _lv3.x * 3, z = _lv2.z - _lv3.z * 3;
    if (!onIsland(x, z, -1.5)) [x, z] = islandSpot(-3) || [0, 2];
    spawnLoot(it, V3(x + rand(-0.5, 0.5), terrainH(x, z) + 6, z + rand(-0.5, 0.5)));
  }
  wearGear(F);
}
// the gear lying nearest someone (within d), that's been down a moment
function nearLoot(pos, d) {
  let best = null;
  for (const L of loot) {
    if (L.age < 0.6) continue;
    const dd = Math.hypot(L.pos.x - pos.x, L.pos.z - pos.z);
    if (dd < d && Math.abs(L.pos.y - pos.y) < 1.6) { d = dd; best = L; }
  }
  return best;
}

// ---------------------------------------------------------------- each frame
function updateLoot(dt) {
  // you: E picks gear up
  if (!playerBody.limp && !P.hang) {
    const L = nearLoot(P.pos, 1.5);
    if (L && hit('pickup')) pickUpLoot(P, L);
    showLootHint(L);
  } else showLootHint(null);

  // gear lying about: flies, lands, tumbles to a stop
  for (let i = loot.length - 1; i >= 0; i--) {
    const L = loot[i];
    L.age += dt;
    L.vel.y -= G * dt;
    L.pos.addScaledVector(L.vel, dt);
    const floor = groundAt(L.pos.x, L.pos.y, L.pos.z, 0.45) + L.lift;
    if (L.pos.y <= floor) {
      L.pos.y = floor;
      if (L.vel.y < -3) { L.vel.y *= -0.3; L.vel.x *= 0.6; L.vel.z *= 0.6; L.spin.multiplyScalar(0.6); }   // (bounce)
      else { L.vel.y = 0; L.ground = true; }
    } else if (L.pos.y > floor + 0.05) L.ground = false;
    if (L.ground) {
      L.vel.x *= Math.exp(-6 * dt); L.vel.z *= Math.exp(-6 * dt);
      L.grp.quaternion.slerp(L.rest, 1 - Math.exp(-10 * dt));
    } else {
      _lq.setFromEuler(_le.set(L.spin.x * dt, L.spin.y * dt, L.spin.z * dt));
      L.grp.quaternion.multiply(_lq);
    }
    L.grp.position.copy(L.pos);
    if (L.pos.y < FALL_Y) removeLoot(L);   // (off the edge: gone for good)
  }

  // mud: shoes get it from walking through mud (or lying in it); gloves and hammers from your hands being in it.
  // It comes off again in about ten seconds.
  for (const who of wearers()) {
    const rig = rigOfWho(who), g = gearOf(who), pm = rig && rig.ptMud;
    if (!pm || who.remote) continue;   // (the other player online: sent by their computer, see net.js)
    if (g.hands) g.hands.dirt = Math.max(g.hands.dirt - 0.1 * dt, pm[5], pm[6]);
    if (g.feet) g.feet.dirt = Math.max(g.feet.dirt - 0.1 * dt, who.mud || 0, pm[11], pm[12]);
  }
  for (const who of wearers()) for (const slot in GEAR) { const it = gearOf(who)[slot]; if (it) it.mudU.value = it.dirt; }
  for (const L of loot) {
    const inMud = L.ground && surfaceAt(L.pos.x, L.pos.z) === 'mud';   // (lying in the mud)
    L.item.dirt = clamp(L.item.dirt + (inMud ? 0.5 : -0.1) * dt, 0, 1);
    L.item.mudU.value = L.item.dirt;
  }
}

// "E pick up the boxing gloves", when you're next to some
function showLootHint(L) {
  const el = $('lootHint');
  const text = L ? `${keysFor('pickup')} pick up the ${L.item.kind}` : '';
  if (el.dataset.t !== text) { el.dataset.t = text; el.innerHTML = text; el.style.display = text ? '' : 'none'; }
}
