// THE LEADERBOARD: everyone's best wave, online (single player: see LIFE in fighters.js).
// The scores live in a Supabase database; the game talks to it straight from the page (its REST API, no
// library). To switch it on: make a free Supabase project, run supabase/leaderboard.sql in its SQL Editor,
// then fill in your project's URL and its anon (public) key below. (Settings → API in the dashboard. The anon
// key is meant to be public: the table only lets people read scores and add new ones.)
// Left empty, there's no LEADERBOARD button and nothing is sent anywhere.
'use strict';
const BOARD = {
  url: '',   // e.g. 'https://abcdefghijklm.supabase.co'
  key: '',   // the anon public key
  rows: null, status: '', posting: false,
};
const boardOn = () => !!(BOARD.url && BOARD.key);
const boardHeaders = extra => Object.assign({ apikey: BOARD.key, Authorization: 'Bearer ' + BOARD.key }, extra);
const escHTML = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
// (your name's been typed in, here or on the ONLINE page: it's not just the PLAYER you get by default)
const hasName = () => !!cleanName(localStorage.getItem('ragdollName'));

// the top 20: each name's best run
async function fetchBoard() {
  const r = await fetch(BOARD.url + '/rest/v1/leaderboard?select=name,wave,ringouts&order=wave.desc,ringouts.desc,created_at.asc&limit=20', { headers: boardHeaders() });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return r.json();
}
// post a run (quiet: no messages on the page if it doesn't work)
async function postScore(wave, ringouts) {
  const r = await fetch(BOARD.url + '/rest/v1/scores', {
    method: 'POST', headers: boardHeaders({ 'Content-Type': 'application/json', Prefer: 'return=minimal' }),
    body: JSON.stringify({ name: myName(), wave, ringouts: Math.min(ringouts, wave * 6) }),
  });
  if (!r.ok) throw new Error('HTTP ' + r.status);
}

// GAME OVER with a new best (see gameOver in fighters.js): post it, if you've got a name, and say where it
// puts you. No name yet: it waits for you to post it from the LEADERBOARD page.
function boardNewBest(wave, ringouts) {
  if (!boardOn() || !hasName()) return;
  postScore(wave, ringouts).then(fetchBoard).then(rows => {
    BOARD.rows = rows;
    const i = rows.findIndex(r => r.name === myName());
    if (i >= 0) setTimeout(() => banner('#' + (i + 1) + ' ON THE LEADERBOARD!', 'good'), 2500);
  }).catch(() => {});
}

// ---------------------------------------------------------------- the LEADERBOARD page
function buildBoard() {
  if (!boardOn()) return;
  const btn = $('boardBtn');
  btn.style.display = '';
  btn.onclick = openBoard;
  $('boardPanel').innerHTML = `<h2>LEADERBOARD</h2>
    <p class="note">The best waves anyone's reached. Run out of lives on a new best and it goes up here.</p>
    <label class="nameRow"><span>YOUR NAME</span><input id="boardName" maxlength="12" placeholder="PLAYER" autocomplete="off" spellcheck="false"></label>
    <div id="boardList"></div>
    <p id="boardStatus" class="note small"></p>
    <div class="row"><button id="boardPost" class="small"></button><button id="boardDone">DONE</button></div>`;
  // (the same name as online: see net.js)
  $('boardName').onkeydown = e => e.stopPropagation();
  $('boardName').oninput = () => { localStorage.setItem('ragdollName', cleanName($('boardName').value)); if ($('myName')) $('myName').value = myName(); drawBoard(); };
  $('boardPost').onclick = postMyBest;
  $('boardDone').onclick = closeBoard;
}
function openBoard() {
  $('boardName').value = hasName() ? myName() : '';
  $('overlay').classList.add('board');
  BOARD.status = BOARD.rows ? '' : 'Loading…';
  drawBoard();
  fetchBoard().then(rows => { BOARD.rows = rows; BOARD.status = ''; drawBoard(); })
    .catch(() => { BOARD.status = 'Couldn\'t load the leaderboard. Are you online?'; drawBoard(); });
}
function closeBoard() { $('overlay').classList.remove('board'); fitTitle(); }
function drawBoard() {
  const rows = BOARD.rows || [], me = hasName() ? myName() : null;
  $('boardList').innerHTML = rows.length
    ? `<table><tr><th>#</th><th>NAME</th><th>WAVE</th><th>RING-OUTS</th></tr>${rows.map((r, i) =>
      `<tr class="${r.name === me ? 'me' : ''}"><td>${i + 1}</td><td>${escHTML(r.name)}</td><td>${+r.wave}</td><td>${+r.ringouts}</td></tr>`).join('')}</table>`
    : (BOARD.rows ? '<p class="note">No scores yet. Be the first!</p>' : '');
  $('boardStatus').textContent = BOARD.status;
  const b = $('boardPost');
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
