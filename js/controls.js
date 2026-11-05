// The CONTROLS page: change what each action's on. Click one of an action's two slots, then press any key or
// mouse button (Delete or Backspace to clear the slot, Esc to change your mind). A key can only do one thing:
// put it on a new action and it comes off the old one. Remembered for next time.
// Also: every list of keys the game shows (the title, the help in the corner) is made here, from your keys.
'use strict';
let bindWait = null;   // the slot that's waiting for you to press something: { a: action, i: 0 or 1, el }

function saveBinds() { localStorage.setItem('ragdollKeys', JSON.stringify(BINDS)); }

// the lists of keys: on the title screen, and in the corner while you play
function showKeyLists() {
  const move = ['forward', 'left', 'back', 'right'].map(a => keysFor(a)).join('');
  $('help').innerHTML = `
    <div>${move} move</div>
    <div>${keysFor('run')} run &nbsp; ${keysFor('jump')} jump</div>
    <div>${keysFor('punch')} punch / swing</div>
    <div>${keysFor('grab')} grab / pick up</div>
    <div>${keysFor('kick')} kick &nbsp; punch, punch, kick!</div>
    <div>${keysFor('special')} special move</div>
    <div>${keysFor('pickup')} pick up gear</div>
    <div>${keysFor('flop')} flop &nbsp; ${keysFor('help')} hide this</div>`;
  $('keyList').innerHTML = `
    <span>${move} move</span><span>${keysFor('run')} run</span><span>${keysFor('jump')} jump</span>
    <span>${keysFor('punch')} punch</span><span>${keysFor('grab')} grab</span><span>${keysFor('kick')} kick</span><span>${keysFor('special')} special</span>
    <span>${keysFor('pickup')} pick up gear</span><span>${keysFor('flop')} flop</span><span><kbd>Esc</kbd> pause</span>`;
}

function buildControls() {
  const el = $('controlsPanel');
  el.innerHTML = `<h2>CONTROLS</h2>
    <p class="note">Click a box, then press a key or a mouse button. <kbd>Delete</kbd> clears it, <kbd>Esc</kbd> cancels.</p>
    <div class="list">${Object.keys(ACTIONS).map(a => `<div class="bind"><span>${ACTIONS[a]}</span>
      <button data-a="${a}" data-i="0"></button><button data-a="${a}" data-i="1"></button></div>`).join('')}</div>
    <div class="row"><button id="bindsReset" class="tiny">PUT BACK TO NORMAL</button></div>
    <button id="controlsDone">DONE</button>`;
  el.querySelectorAll('.bind button').forEach(b => b.onclick = e => { e.stopPropagation(); waitForKey(b); });
  $('bindsReset').onclick = () => {
    for (const a in BINDS) BINDS[a] = BIND_DEFAULT[a].slice();
    saveBinds(); showBinds();
  };
  $('controlsDone').onclick = closeControls;
  $('controlsBtn').onclick = openControls;
  showBinds();
}
// what's in each slot
function showBinds() {
  document.querySelectorAll('#controlsPanel .bind button').forEach(b => {
    const c = BINDS[b.dataset.a][+b.dataset.i];
    b.classList.toggle('empty', !c); b.classList.remove('wait');
    b.textContent = c ? keyName(c) : '—';
  });
  showKeyLists();
}
// a slot's waiting for you to press something
function waitForKey(b) {
  showBinds();
  bindWait = { a: b.dataset.a, i: +b.dataset.i, el: b };
  b.classList.add('wait'); b.textContent = 'press a key…';
}
function setBind(code) {
  const { a, i } = bindWait;
  bindWait = null;
  if (code) for (const o in BINDS) for (let j = 0; j < 2; j++) if (BINDS[o][j] === code) BINDS[o][j] = '';   // (off whatever it was on before)
  BINDS[a][i] = code;
  saveBinds(); showBinds();
}
// (caught before anything else gets them, while a slot's waiting)
addEventListener('keydown', e => {
  if (!bindWait) return;
  e.preventDefault(); e.stopImmediatePropagation();
  if (e.code === 'Escape') { bindWait = null; showBinds(); return; }
  setBind(e.code === 'Delete' || e.code === 'Backspace' ? '' : e.code);
}, true);
addEventListener('mousedown', e => {
  if (!bindWait) return;
  e.preventDefault(); e.stopImmediatePropagation();
  setBind('Mouse' + e.button);
}, true);

function openControls() { showBinds(); $('overlay').classList.add('controls'); }
function closeControls() { bindWait = null; $('overlay').classList.remove('controls'); fitTitle(); }
buildControls();
