// ONLINE 1v1: you against a friend on another computer. First to WIN ring-outs wins.
// How it works: one of you HOSTS (gets a room code), the other JOINS with it; both pages then reload with
// ?room=CODE in the address, which builds both islands the same (see ROOM in core.js), and talk through the
// little server (server.js: run `node server.js`). There are no other fighters.
// Each computer runs its own ragdoll, exactly as normal. The other player is shown as a puppet: a fighter
// (the first one in FIGHTER_POOL) with no brain, whose body is put wherever their computer says it is (about
// 30 times a second, smoothed). When you hit the puppet, your computer tells theirs, and theirs hits them
// for real (so they get knocked flying on their own screen, and you see it a moment later). Fall off, and
// your computer tells theirs: that's a ring-out for them.
// Rocks you pick up and throw are sent too (where they are, while they're yours), so you both see them.
// Grabbing them while they're down sends where your hand is, and their computer drags them there. Gear
// knocked off flies off on both screens, and whoever picks it up first gets it.
'use strict';
const NET = {
  on: !!ROOM, ws: null, ready: false, host: false, R: null, WIN: 5,
  sendT: 0, lookT: 0, lookSent: '', target: null, lastS: 0, ips: [], status: '', over: 0,
};
const netSend = m => { if (NET.ws && NET.ws.readyState === 1) NET.ws.send(JSON.stringify(m)); };
const r3 = v => Math.round(v * 1000) / 1000;
const _nd = V3();

// where you start (and come back after a fall): the host where the game normally puts you, the other player
// across the island, facing them
function spawnSpot() {
  if (!NET.on || NET.host) return [0, 5, 0];
  for (const z of [-3, -1, 1, 2]) if (onIsland(0, z, -2)) return [0, z, Math.PI];
  const p = islandSpot(-3) || [0, 2];
  return [p[0], p[1], Math.PI];
}

// ---------------------------------------------------------------- talking to the server
// Two ways to connect. From this computer's own server (node server.js, port 8767): through it, as a relay.
// Anywhere else (like the game on GitHub Pages): straight from one computer to the other (WebRTC, with the
// PeerJS library: its free public server just introduces them). The room's host takes the name
// ragdollbrawl-CODE, and whoever comes second connects to that. Either way, the rest of this file gets the
// same messages: joined, start, left, full.
const USE_SERVER = location.port === '8767';
function netConnect() {
  setNetStatus('Connecting…');
  if (!USE_SERVER) return peerConnect();
  let ws;
  try { ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.hostname}:8767`); }
  catch (e) { setNetStatus('Could not reach the online server.', true); return; }
  NET.ws = ws;
  ws.onopen = () => netSend({ t: 'join', room: ROOM });
  ws.onmessage = e => { let m; try { m = JSON.parse(e.data); } catch (err) { return; } netMessage(m); };
  ws.onerror = () => {};
  ws.onclose = () => {
    if (NET.ready) banner('CONNECTION LOST', 'bad');
    NET.ready = false; NET.ws = null; removeRemote();
    setNetStatus('Can\'t reach the online server. Is it running? (In the Ragdoll folder: node server.js)', true);
  };
}
// ---------------------------------------------------------------- straight to each other (no server of ours)
function peerConnect() {
  if (typeof Peer !== 'undefined') return peerStart();
  const sc = document.createElement('script');
  sc.src = 'js/lib/peerjs.min.js';
  sc.onload = peerStart;
  sc.onerror = () => setNetStatus('Could not load the online bits. Check your internet.', true);
  document.head.appendChild(sc);
}
function peerStart() {
  const id = 'ragdollbrawl-' + ROOM;
  // (what the rest of this file talks to: like a WebSocket)
  const link = { readyState: 0, conn: null, peer: null, heard: 0, send(s) { if (this.conn && this.conn.open) try { this.conn.send(s); } catch (e) {} } };
  NET.ws = link;
  const lost = () => {
    if (!link.conn) return;
    try { link.conn.close(); } catch (e) {}
    link.conn = null; link.readyState = 0;
    netMessage({ t: 'left' });
    // (if they were the host, you take over the room, so they can come back into it)
    if (!link.host) { try { link.peer.destroy(); } catch (e) {} setTimeout(beHost, 800); }
    else netMessage({ t: 'joined', n: 1 });
  };
  const attach = conn => {
    link.conn = conn;
    conn.on('open', () => {
      link.readyState = 1; link.heard = performance.now();
      if (link.host) { netMessage({ t: 'joined', n: 2 }); conn.send(JSON.stringify({ t: 'start', host: false })); netMessage({ t: 'start', host: true }); }
    });
    conn.on('data', d => { link.heard = performance.now(); let m; try { m = JSON.parse(d); } catch (e) { return; } if (m.t !== 'ping') netMessage(m); });
    conn.on('close', lost);
    conn.on('error', () => {});
  };
  const trouble = err => setNetStatus('Online trouble (' + (err && err.type || 'unknown') + '). Try again in a moment.', true);
  // the first one in: the host
  function beHost() {
    const peer = link.peer = new Peer(id);
    link.host = true;
    peer.on('open', () => netMessage({ t: 'joined', n: 1 }));
    peer.on('connection', conn => {
      if (link.conn && link.conn.open) { conn.on('open', () => { conn.send(JSON.stringify({ t: 'full' })); setTimeout(() => conn.close(), 500); }); return; }
      attach(conn);
    });
    peer.on('error', err => {
      if (err.type === 'unavailable-id') { peer.destroy(); beGuest(); }   // (someone's hosting it already: join them)
      else trouble(err);
    });
  }
  // the second one: connect to the host
  function beGuest() {
    const peer = link.peer = new Peer();
    link.host = false;
    peer.on('open', () => attach(peer.connect(id, { reliable: true })));
    peer.on('error', err => {
      if (err.type === 'peer-unavailable') { peer.destroy(); setTimeout(beHost, 300); }   // (the host's gone: you're it)
      else trouble(err);
    });
  }
  beHost();
  // (every couple of seconds, a hello; heard nothing for a while: they've gone)
  setInterval(() => {
    if (!link.conn || !link.conn.open) return;
    link.send(JSON.stringify({ t: 'ping' }));
    if (performance.now() - link.heard > 9000) lost();
  }, 2000);
}

function netMessage(m) {
  if (m.t === 'joined') {
    NET.ips = m.ips || [];
    if (m.n < 2) setNetStatus(`Waiting for your friend… Tell them to open <b>${shareLink()}</b><br>or click ONLINE 1v1, then JOIN with the code <b>${ROOM}</b>`);
  } else if (m.t === 'full') {
    setNetStatus(`Room ${ROOM} already has two players in it.`, true);
  } else if (m.t === 'start') {
    NET.ready = true; NET.host = m.host; NET.lookSent = ''; NET.themReady = false; NET.going = false;
    if (NET.meReady) { netSend({ t: 'ready' }); COUNT.wait = true; }   // (you'd already pressed PLAY: tell them)
    koCount = falls = 0; NET.lastS = 0;
    if (ready) respawn();
    setNetStatus(`Connected! You're fighting your friend. First to ${NET.WIN} ring-outs wins.`);
    banner('FRIEND JOINED!', 'good');
  } else if (m.t === 'look') {
    NET.look = m; if (NET.R) putOnRemote(m);
  } else if (m.t === 's') {
    netState(m);
  } else if (m.t === 'hit') {
    if (!NET.ready || !started) return;
    hurtPlayer(m.d, V3(m.x, m.y, m.z), m.k, m.h);
    if (m.up) for (let i = 0; i < 13; i++) playerBody.prev[i].y -= m.up * H;   // (an uppercut: up you go)
    if (NET.R) NET.R.power = Math.min(100, (NET.R.power || 0) + 8);
  } else if (m.t === 'loot') {
    // their gear's been knocked off: it flies off here too
    const L = spawnLoot(newItem(m.slot, m.kind), V3(...m.p), V3(...m.v));
    L.id = m.id;
  } else if (m.t === 'took') {
    // (by its id; or, gear that never had one, the same kind lying closest to where they picked it up)
    let L = m.id && loot.find(L => L.id === m.id);
    if (!L && m.p) { let bd = 2; for (const Q of loot) { const d = Math.hypot(Q.pos.x - m.p[0], Q.pos.z - m.p[2]); if (Q.item.kind === m.kind && d < bd) { bd = d; L = Q; } } }
    if (L) removeLoot(L);
  } else if (m.t === 'fell') {
    koCount++;
    countRingOut();
  } else if (m.t === 'ready') {
    NET.themReady = true; netCheckGo();
  } else if (m.t === 'go') {
    NET.going = true; startCountdown();
  } else if (m.t === 'swap') {
    // they SWAPPED places with you: you're where they were
    if (!NET.ready || !started || !isFinite(m.x) || !isFinite(m.z)) return;
    smoke(playerBody.pos[7]); P.hideT = 0.22;
    moveWho(P, m.x, m.z); dizzy(playerBody, 1.5); smoke(playerBody.pos[7]);
  } else if (m.t === 'sp') {
    // they did their special move: its name, over them
    if (NET.R && NET.R.B.pos.length) { fxWord(String(m.n).slice(0, 20), NET.R.B.pos[0], '', 1); if (SPECIALS[m.k]) specialShow(NET.R, m.k); }
  } else if (m.t === 'sfx') {
    sfx.remote = true; try { sfx(m.n, ...(m.a || []).map(a => a && a.v ? V3(...a.v) : a)); } finally { sfx.remote = false; }
  } else if (m.t === 'left') {
    NET.ready = false; removeRemote(); NET.themReady = NET.going = false; COUNT.wait = false;
    banner('YOUR FRIEND LEFT', 'bad');
    setNetStatus(`Your friend left. Waiting for someone to join room <b>${ROOM}</b>… (<b>${shareLink()}</b>)`);
  }
}
function shareLink() {
  if (!USE_SERVER) return `${location.origin}${location.pathname}?room=${ROOM}`;
  const host = NET.ips[0] || location.hostname;
  return `http://${host}:${location.port || 80}/?room=${ROOM}`;
}

// ---------------------------------------------------------------- the other player (a puppet)
function getRemote() {
  if (NET.R) return NET.R;
  const F = FIGHTER_POOL[0];
  if (!F) return null;
  NET.R = F;
  F.remote = true; F.champ = F.B.champ = false;
  F.dmg = 0; F.power = 0; F.punch = null; F.grab = null; F.rock = null; F.hitT = 0;
  F.B.size = 1; F.B.R = RAG_R;
  withBody(F, () => initBody(V3(0, terrainH(0, 0), 0), 0));   // (its body's points: put where they really are by their first message)
  fighters.push(F); scene.add(F.rig.root);
  NET.target = null; NET.lastS = 0;
  if (NET.look) putOnRemote(NET.look);
  return F;
}
function removeRemote() {
  const F = NET.R;
  if (!F) return;
  remoteAlly(null);
  takeOff(F);
  F.remote = false; NET.R = null;
}
// how they look: their colour, hat, eyebrows and gear
function putOnRemote(m) {
  const F = getRemote();
  if (!F) return;
  const rig = F.rig;
  // (the same colour as you? then they're red, so you can tell who's who: or orange, if you're red)
  F.styleColor = m.color;   // (their style goes with their real colour)
  F.name = cleanName(m.name) || 'FRIEND';   // (for their name tag)
  F.sizeK = SIZES[m.size] ? m.size : 'normal';   // (and their size)
  setBodySize(F.B, F.rig, SIZES[F.sizeK].scale);
  F.color = m.color !== LOOK.color ? m.color : LOOK.color === 0xff4a4a ? 0xff9a2a : 0xff4a4a;
  rig.mesh.material.color.copy(col(F.color));
  if (rig.hat) { rig.hatHold.remove(rig.hat); rig.hat = null; }
  if (m.hat && m.hat !== 'none' && HATS.includes(m.hat)) { rig.hat = makeHat(m.hat, rig.headR, rig.hatMud || (rig.hatMud = { value: 0 })); rig.hatHold.add(rig.hat); }
  for (const e of rig.eyes) e.brow.scale.y = BROWS[m.brows] || 1;
  const g = gearOf(F);
  for (const slot in GEAR) {
    const kind = m[slot];
    if ((g[slot] && g[slot].kind) !== kind) g[slot] = kind && GEAR[slot][kind] && kind !== 'none' ? newItem(slot, kind) : null;
  }
  wearGear(F);
  UI.chips = [];   // (redo the HUD chip, in their colour)
}
// where they are now
function netState(m) {
  const F = getRemote();
  if (!F) return;
  NET.target = NET.target || Array.from({ length: 13 }, () => V3());
  for (let i = 0; i < 13; i++) NET.target[i].set(m.p[i * 3], m.p[i * 3 + 1], m.p[i * 3 + 2]);
  const jump = F.B.pos[7].distanceTo(NET.target[7]) > 3 || !NET.lastS;   // (just appeared, or came back after a fall: go straight there)
  if (jump) for (let i = 0; i < 13; i++) { F.B.pos[i].copy(NET.target[i]); F.B.prev[i].copy(NET.target[i]); }
  F.grab = m.g ? { i: m.g[0], hand: 0, at: V3(m.g[1], m.g[2], m.g[3]) } : null;   // (holding you: see remoteRocks)
  // their mud: up their legs, splodges wherever they've lain in it, and on their gear
  if (m.m) { F.mud = m.m[0]; F.rig.mudU.value = m.m[0]; for (let i = 0; i < 13; i++) F.rig.ptMud[i] = m.m[i + 1] || 0; }
  if (m.gd) { const g = gearOf(F); if (g.hands) g.hands.dirt = m.gd[0]; if (g.feet) g.feet.dirt = m.gd[1]; }
  F.yaw = m.y; F.B.limp = !!m.l; F.dmg = m.d; F.power = m.w; F.punch = m.u ? true : null;
  NET.lastS = performance.now();
  remoteAlly(m.a);
  // their rocks
  if (m.r) for (const [i, ...pts] of m.r) {
    const pr = props[i];
    if (!pr || pr.heldBy === playerBody) continue;
    const dtS = clamp((performance.now() - (pr.netAt || 0)) / 1000, 1 / 60, 0.2);
    for (let k = 0; k < pr.pts.length; k++) {
      const p = pr.pts[k], x = pts[k * 3], y = pts[k * 3 + 1], z = pts[k * 3 + 2];
      // (keep its speed, so it flies on smoothly if the messages stop: it's moving (new - old) per message)
      const vx = (x - p.x) / dtS * H, vy = (y - p.y) / dtS * H, vz = (z - p.z) / dtS * H;
      p.set(x, y, z); pr.prev[k].set(x - vx, y - vy, z - vz);
    }
    pr.netAt = performance.now(); pr.netT = 0.25; pr.sleep = false; pr.lastBy = F.B;
    if (pr.type === 'box') boxFrame(pr);
  }
}

// their double (mint's special): just a picture of it, posed where it is on their computer. (Its hits on you
// come as hits, like theirs: see 'hit')
function remoteAlly(a) {
  const R = NET.R;
  if (!a) { if (NET.RA) { smoke(NET.RA.B.pos[7], 12, 1); scene.remove(NET.RA.rig.root); NET.RA = null; } return; }
  if (!NET.RA) {
    const F = FIGHTER_POOL.find(G => G !== R && !fighters.includes(G));
    if (!F) return;
    NET.RA = F;
    F.rig.mesh.material.color.copy(col(R ? R.color : 0xff4a4a));
    setBodySize(F.B, F.rig, (SIZES[R && R.sizeK] || SIZES.normal).scale);
    F.RAT = Array.from({ length: 13 }, () => V3());
    scene.add(F.rig.root);
    for (let i = 0; i < 13; i++) F.B.pos[i] = F.B.pos[i] || V3();
    for (let i = 0; i < 13; i++) F.B.pos[i].set(a[i * 3], a[i * 3 + 1], a[i * 3 + 2]);
    smoke(F.B.pos[7], 12, 1);
  }
  for (let i = 0; i < 13; i++) NET.RA.RAT[i].set(a[i * 3], a[i * 3 + 1], a[i * 3 + 2]);
}
function drawRemoteAlly(dt) {
  const F = NET.RA;
  if (!F) return;
  for (let i = 0; i < 13; i++) F.B.pos[i].lerp(F.RAT[i], 1 - Math.exp(-20 * dt));
  const old = RIG; RIG = F.rig; poseRig(F.B.pos); RIG = old;
}

// ---------------------------------------------------------------- every frame (while you're playing)
function netFrame(dt) {
  drawRemoteAlly(dt);
  nameTags();
  if (!NET.on) return;
  const F = NET.R;
  if (F) {
    F.hitT -= dt;
    // glide their body toward where they are
    if (NET.target) {
      const k = 1 - Math.exp(-22 * dt);
      for (let i = 0; i < 13; i++) { F.B.pos[i].lerp(NET.target[i], k); F.B.prev[i].copy(F.B.pos[i]); }
      hipMid(F.B.pos, F.pos);
    }
  }
  if (!NET.ready) return;
  // tell them where you are (30 times a second), and what you look like (when it changes)
  NET.sendT -= dt;
  const g = gearOf(P);
  if (NET.sendT <= 0) {
    NET.sendT = 1 / 30;
    const p = [];
    for (let i = 0; i < 13; i++) p.push(r3(playerBody.pos[i].x), r3(playerBody.pos[i].y), r3(playerBody.pos[i].z));
    const r = [];
    props.forEach((pr, i) => {
      if (pr.heldBy === playerBody && pr.held) pr.mineT = 1.5;
      else if (pr.mineT > 0) pr.mineT -= 1 / 30;
      if (pr.mineT > 0 && !pr.sleep) r.push([i, ...pr.pts.flatMap(q => [r3(q.x), r3(q.y), r3(q.z)])]);
    });
    const h = hands.find(h => h.fb && h.fb === NET.R), hp = h && playerBody.pos[5 + hands.indexOf(h)];
    netSend({ t: 's', g: h ? [h.fi, r3(hp.x), r3(hp.y), r3(hp.z)] : undefined, p, y: r3(P.yaw), l: playerBody.limp ? 1 : 0, d: Math.round(P.dmg), w: Math.round(P.power), u: P.punch || P.kick ? 1 : 0, m: [P.mud || 0, ...playerRig.ptMud].map(v => Math.round(v * 100) / 100), gd: [g.hands ? r3(g.hands.dirt) : 0, g.feet ? r3(g.feet.dirt) : 0], r: r.length ? r : undefined,
      a: allies.length ? allies[0].B.pos.flatMap(q => [r3(q.x), r3(q.y), r3(q.z)]) : undefined });   // (your double, if you've got one out)
  }
  const look = JSON.stringify({ t: 'look', name: myName(), color: LOOK.color, hat: LOOK.hat, brows: LOOK.brows, size: LOOK.size, hands: g.hands ? g.hands.kind : 'none', feet: g.feet ? g.feet.kind : 'none' });
  if (look !== NET.lookSent) { NET.ws.send(look); NET.lookSent = look; }
  // first to WIN
  if (!NET.over && (koCount >= NET.WIN || falls >= NET.WIN)) {
    const won = koCount >= NET.WIN;
    NET.over = 5;
    setTimeout(() => showMatchEnd(won), 900);
  }
  if (NET.over > 0) {
    NET.over -= dt;
    if (NET.over <= 0) { NET.over = 0; koCount = falls = 0; UI.lastKO = UI.lastFalls = 0; respawn(); startCountdown(); }   // (a new match: 3, 2, 1...)
  }
}

// The start of the match: 3, 2, 1, FIGHT! for you both at once, when you've both pressed PLAY. You say you're
// ready; when the host knows you both are, it says go (and you both count down).
function netReady() {
  NET.meReady = true;
  if (!NET.ready) return;   // (no friend yet: you can wander about till they come; see the 'start' message)
  netSend({ t: 'ready' }); COUNT.wait = true; netCheckGo();
}
function netCheckGo() {
  if (!NET.host || !NET.meReady || !NET.themReady || NET.going) return;
  NET.going = true; netSend({ t: 'go' }); startCountdown();
}
// the end of a match: a big YOU WIN! (or YOU LOSE!) over everything, with the score
function showMatchEnd(won) {
  const el = $('matchEnd');
  el.className = won ? 'win' : 'lose';
  el.innerHTML = `${won ? '<div class="stars">' + Array.from({ length: 40 }, () => `<i style="left:${Math.random() * 100}%;animation-duration:${1.5 + Math.random() * 2}s;animation-delay:${Math.random() * 1.2}s;background:${['#ffd23a', '#ff9a2a', '#7fe05a', '#5ab8ff', '#ff5fb0'][Math.floor(Math.random() * 5)]}"></i>`).join('') + '</div>' : ''}
    <div class="score">${koCount} – ${falls}</div>
    <div class="sub">${won ? 'You knocked your friend off ' + koCount + ' times!' : 'Get them back next time!'} Next match in a moment…</div>`;
  el.style.display = 'flex';
  slashBanner(won ? 'YOU WIN!' : 'YOU LOSE!', won ? 'CHAMPION OF THE SKY ISLAND' : 'KNOCKED OUT OF THE SKY', won ? 'win' : 'lose', 3.4);
  setTimeout(() => { el.style.display = 'none'; }, 3900);
}

// you hit them: tell their computer (and show it here straight away)
function netHit(F, dmg, dir, k, heft, up) {
  if (F.hitT > 0) return;
  F.hitT = 0.3;
  netSend({ t: 'hit', d: r3(dmg), x: r3(dir.x), y: r3(dir.y), z: r3(dir.z), k, h: r3(heft), up: up || 0 });
  fxHit(F.B, F.B.pos[k], dmg, false);
}
// your gear's been knocked off: it flies off on their screen too (either of you can pick it up)
function netLoot(L) {
  L.id = Math.random().toString(36).slice(2, 9);
  netSend({ t: 'loot', id: L.id, slot: L.item.slot, kind: L.item.kind, p: L.pos.toArray().map(r3), v: L.vel.toArray().map(r3) });
}
// you fell off: a ring-out for them
function netFell() { if (NET.ready) netSend({ t: 'fell' }); }

// (each physics step) a rock of yours hits them? (on your computer, their body's only a puppet, so it's checked
// here.) And are they dragging you while you're down? Then the bit of you they've got hold of is pulled toward
// their hand. (Press a key to get up and break free, as normal.)
function remoteRocks(F) {
  if (F.grab && playerBody.limp) {
    const q = playerBody.pos[F.grab.i], d = _nd.subVectors(F.grab.at, q), gap = d.length();
    if (gap > 0.1 && gap < 1.6 * S) q.addScaledVector(d, Math.min((gap - 0.1) * 0.45, 0.03) / gap);
  }
  const hitBy = bodyHitsProps();
  if (hitBy && !F.B.limp && F.hitT <= 0 && (hitBy.heldBy === playerBody || hitBy.lastBy === playerBody)) {
    const [dm, heft] = propHit(hitBy);
    playerHits(F, dm, propDir(hitBy, F.B, V3()), 1, heft, 'swing');
  }
}

// ---------------------------------------------------------------- the ONLINE 1v1 page, and the status line
function setNetStatus(html, bad) {
  const el = $('netStatus');
  el.style.display = '';
  el.innerHTML = `<b>ONLINE ROOM ${ROOM}</b> · ${html}`;
  el.classList.toggle('bad', !!bad);
  if (typeof fitTitle === 'function') fitTitle();
}
const newCode = () => Array.from({ length: 4 }, () => 'ABCDEFGHJKLMNPQRSTUVWXYZ'[Math.floor(trueRandom() * 24)]).join('');
function goToRoom(code) { location.href = location.pathname + '?room=' + code; }
// ---------------------------------------------------------------- name tags
// Online, everyone's name floats over their head (yours too, in blue; theirs in red).
const cleanName = s => String(s || '').replace(/[^\w .!?'-]/g, '').trim().slice(0, 12).toUpperCase();
const myName = () => cleanName(localStorage.getItem('ragdollName')) || 'PLAYER';
const _nt = V3();
function nameTags() {
  const box = $('nametags');
  const on = NET.on && NET.ready && started && !!NET.R;
  box.style.display = on ? '' : 'none';
  if (!on) return;
  const tags = [[playerBody, myName(), 'me', playerRig], [NET.R.B, NET.R.name || 'FRIEND', 'them', NET.R.rig]];
  if (box.children.length !== 2) box.innerHTML = '<div class="nt me"></div><div class="nt them"></div>';
  tags.forEach(([B, name, cls, rig], i) => {
    const el = box.children[i];
    if (el.textContent !== name) el.textContent = name;
    if (!B.pos[0]) { el.style.display = 'none'; return; }
    _nt.copy(B.pos[0]); _nt.y += 0.55 * (B.size || 1) + (rig && rig.hat ? 0.25 : 0);
    _nt.project(camera);
    const hide = _nt.z > 1 || (rig && !rig.root.visible);
    el.style.display = hide ? 'none' : '';
    el.style.left = ((_nt.x + 1) / 2 * innerWidth).toFixed(1) + 'px';
    el.style.top = ((1 - _nt.y) / 2 * innerHeight).toFixed(1) + 'px';
  });
}

function buildOnline() {
  const el = $('onlinePanel');
  el.innerHTML = `<h2>ONLINE 1v1</h2>
    <p class="note">Fight a friend on another computer! One of you hosts a game, the other joins it with the code.
      First to ${NET.WIN} ring-outs wins.</p>
    <div class="list">
      <label class="nameRow"><span>YOUR NAME</span><input id="myName" maxlength="12" placeholder="PLAYER" autocomplete="off" spellcheck="false"></label>
      <button id="hostBtn" class="small">HOST A GAME</button>
      <div class="join"><input id="joinCode" maxlength="6" placeholder="CODE" autocomplete="off" spellcheck="false"><button id="joinBtn" class="small">JOIN</button></div>
      <p class="note small">${USE_SERVER ? 'Playing through the online server on this computer (<kbd>node server.js</kbd>): your friend opens the address it prints, on the same Wi-Fi.' : 'Works anywhere: your friend just needs this game\'s address and the code.'}</p>
    </div>
    <button id="onlineDone">DONE</button>`;
  // (your name: shown over your head on their screen. Remembered)
  $('myName').value = myName();
  $('myName').onkeydown = e => e.stopPropagation();
  $('myName').oninput = () => { localStorage.setItem('ragdollName', cleanName($('myName').value)); NET.lookSent = null; };
  $('hostBtn').onclick = () => goToRoom(newCode());
  const join = () => { const c = $('joinCode').value.toUpperCase().replace(/[^A-Z]/g, ''); if (c.length >= 3) goToRoom(c); else $('joinCode').focus(); };
  $('joinBtn').onclick = join;
  $('joinCode').onkeydown = e => { e.stopPropagation(); if (e.key === 'Enter') join(); };
  $('onlineDone').onclick = closeOnline;
  $('onlineBtn').onclick = openOnline;
  if (NET.on) {
    $('onlineBtn').textContent = 'LEAVE ONLINE';
    $('onlineBtn').onclick = () => { location.href = location.pathname; };
    $('waveLabel').textContent = 'First to';
    $('modeTag').textContent = 'Online 1v1: knock your friend off the sky island!';
    netConnect();
  }
}
function openOnline() { $('overlay').classList.add('online'); setTimeout(() => $('joinCode').focus(), 50); }
function closeOnline() { $('overlay').classList.remove('online'); fitTitle(); }
buildOnline();
