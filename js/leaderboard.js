// THE LEADERBOARD (single player: see LIFE in fighters.js). Two lists:
//  · THIS DEVICE: the top 10 runs played here (whoever played them: the name's the one on this page, or
//    the ONLINE page). Every GAME OVER goes on it if it's good enough. Kept in this browser; always on.
//  · EVERYONE: the best wave of everyone, online. The scores live in a Supabase database; the game talks to
//    it straight from the page (its REST API, no library). To switch it on: make a free Supabase project, run
//    supabase/leaderboard.sql in its SQL Editor, then fill in your project's URL and its anon (public) key
//    below. (Settings → API in the dashboard. The anon key is meant to be public: the table only lets people
//    read scores and add new ones.) Left empty, there's no EVERYONE tab and nothing is sent anywhere.
'use strict';
const BOARD = {
  url: '',   // e.g. 'https://abcdefghijklm.supabase.co'
  key: '',   // the anon public key
  rows: null, status: '', posting: false, tab: 'local', lastT: 0,
};
const LOCAL_MAX = 10;
const boardOn = () => !!(BOARD.url && BOARD.key);
const boardHeaders = extra => Object.assign({ apikey: BOARD.key, Authorization: 'Bearer ' + BOARD.key }, extra);
const escHTML = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
// (your name's been typed in, here or on the ONLINE page: it's not just the PLAYER you get by default)
const hasName = () => !!cleanName(localStorage.getItem('ragdollName'));

// ---------------------------------------------------------------- this device's top 10
const localRuns = () => { try { const a = JSON.parse(localStorage.getItem('ragdollRuns') || '[]'); return Array.isArray(a) ? a : []; } catch (e) { return []; } };
const byRun = (a, b) => b.wave - a.wave || b.ringouts - a.ringouts || a.t - b.t;
// a run's over: on the list if it's good enough. Returns where it came (1, 2...), or 0 if it didn't make it.
function addLocalRun(wave, ringouts) {
  const run = { name: myName(), wave, ringouts, t: Date.now() };
  const runs = localRuns().concat(run).sort(byRun).slice(0, LOCAL_MAX);
  localStorage.setItem('ragdollRuns', JSON.stringify(runs));
  BOARD.lastT = run.t;
  return runs.indexOf(run) + 1;
}

// ---------------------------------------------------------------- everyone's (online)
// the top 20: each name's best run
async function fetchBoard() {
  const r = await fetch(BOARD.url + '/rest/v1/leaderboard?select=name,wave,ringouts&order=wave.desc,ringouts.desc,created_at.asc&limit=20', { headers: boardHeaders() });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return r.json();
}
async function postScore(wave, ringouts) {
  const r = await fetch(BOARD.url + '/rest/v1/scores', {
    method: 'POST', headers: boardHeaders({ 'Content-Type': 'application/json', Prefer: 'return=minimal' }),
    body: JSON.stringify({ name: myName(), wave, ringouts: Math.min(ringouts, wave * 6) }),
  });
  if (!r.ok) throw new Error('HTTP ' + r.status);
}

// GAME OVER (see gameOver in fighters.js): on this device's list, and say where it came. A new best goes up
// online too, if that's switched on and you've got a name (quietly: nothing on screen if it doesn't work).
function boardGameOver(wave, ringouts, isBest) {
  const place = addLocalRun(wave, ringouts);
  // (after the GAME OVER stripe's gone: the small messages hide behind it)
  if (place) setTimeout(() => banner('#' + place + ' ON THE LEADERBOARD!', 'good'), 3900);
  if (!isBest || !boardOn() || !hasName()) return;
  postScore(wave, ringouts).then(fetchBoard).then(rows => {
    BOARD.rows = rows;
    const i = rows.findIndex(r => r.name === myName());
    if (i >= 0) setTimeout(() => banner('#' + (i + 1) + ' IN THE WORLD!', 'good'), 5000);
  }).catch(() => {});
}

// ---------------------------------------------------------------- the LEADERBOARD page
function buildBoard() {
  if (NET.on) return;   // (online 1v1: no waves, no lives, nothing to rank)
  const btn = document.createElement('button');
  btn.id = 'boardBtn'; btn.className = 'small'; btn.textContent = 'LEADERBOARD';
  $('onlineBtn').before(btn);
  btn.onclick = openBoard;
  $('boardPanel').innerHTML = `<h2>LEADERBOARD</h2>
    ${boardOn() ? '<div class="tabs"><button id="tabLocal" class="tiny">THIS DEVICE</button><button id="tabOnline" class="tiny">EVERYONE</button></div>' : ''}
    <p class="note" id="boardNote"></p>
    <label class="nameRow"><span>YOUR NAME</span><input id="boardName" maxlength="12" placeholder="PLAYER" autocomplete="off" spellcheck="false"></label>
    <div id="boardList"></div>
    <p id="boardStatus" class="note small"></p>
    <div class="row"><button id="boardPost" class="small"></button><button id="boardDone">DONE</button></div>`;
  // (the same name as online: see net.js)
  $('boardName').onkeydown = e => e.stopPropagation();
  $('boardName').oninput = () => { localStorage.setItem('ragdollName', cleanName($('boardName').value)); if ($('myName')) $('myName').value = myName(); drawBoard(); };
  $('boardPost').onclick = postMyBest;
  $('boardDone').onclick = closeBoard;
  if (boardOn()) { $('tabLocal').onclick = () => showTab('local'); $('tabOnline').onclick = () => showTab('online'); }
}
function openBoard() {
  $('boardName').value = hasName() ? myName() : '';
  $('overlay').classList.add('board');
  showTab('local');
}
function showTab(tab) {
  BOARD.tab = tab; BOARD.status = '';
  if (tab === 'online') {
    if (!BOARD.rows) BOARD.status = 'Loading…';
    fetchBoard().then(rows => { BOARD.rows = rows; BOARD.status = ''; drawBoard(); })
      .catch(() => { BOARD.status = 'Couldn\'t load the leaderboard. Are you online?'; drawBoard(); });
  }
  drawBoard();
}
function closeBoard() { $('overlay').classList.remove('board'); fitTitle(); }
function drawBoard() {
  const online = BOARD.tab === 'online', me = hasName() ? myName() : null;
  if (boardOn()) { $('tabLocal').classList.toggle('on', !online); $('tabOnline').classList.toggle('on', online); }
  $('boardNote').textContent = online ? 'The best wave anyone\'s reached, anywhere.'
    : 'The best ' + LOCAL_MAX + ' runs on this device. Run out of lives and your run goes on here if it\'s good enough.' + (me ? '' : ' Type your name so it\'s yours!');
  const rows = online ? BOARD.rows || [] : localRuns().sort(byRun);
  const mine = r => online ? r.name === me : r.t === BOARD.lastT;   // (online: you; here: the run you just had)
  $('boardList').innerHTML = rows.length
    ? `<table><tr><th>#</th><th>NAME</th><th>WAVE</th><th>RING-OUTS</th></tr>${rows.map((r, i) =>
      `<tr class="${mine(r) ? 'me' : ''}"><td>${i + 1}</td><td>${escHTML(r.name)}</td><td>${+r.wave}</td><td>${+r.ringouts}</td></tr>`).join('')}</table>`
    : (online && !BOARD.rows ? '' : `<p class="empty">No runs yet. ${online ? 'Be the first!' : 'Press PLAY and see how far you get!'}</p>`);
  $('boardStatus').textContent = BOARD.status;
  const b = $('boardPost');
  b.style.display = online ? '' : 'none';
  b.textContent = LIFE.best ? 'POST MY BEST: WAVE ' + LIFE.best : 'NO BEST YET';
  b.disabled = !LIFE.best || !me || BOARD.posting;
  b.title = !me ? 'Type your name first' : '';
}
function postMyBest() {
  if (!LIFE.best || !hasName()) return;
  BOARD.posting = true; BOARD.status = 'Posting…'; drawBoard();
  postScore(LIFE.best, +localStorage.getItem('ragdollBestRingouts') || 0).then(fetchBoard)
    .then(rows => { BOARD.rows = rows; BOARD.status = 'Posted!'; })
    .catch(() => { BOARD.status = 'Couldn\'t post it. Try again in a bit.'; })
    .finally(() => { BOARD.posting = false; drawBoard(); });
}
buildBoard();
