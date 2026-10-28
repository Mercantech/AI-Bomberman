/**
 * Bomberman Spectator — shared renderer
 */

const Render = window.BombermanRender;
const PlayerUi = window.BombermanPlayerUi;

let ws = null;
let currentPin = null;
let state = null;
let canvas, ctx;
let intentionalLeave = false;
let stateReceivedAt = 0;
let spectating = false;
let startPending = false;

function apiBase() {
  const m = window.location.pathname.match(/^(\/Bomberman)(?=\/|$)/);
  return m ? m[1] : '';
}

function init() {
  canvas = document.getElementById('game-canvas');
  ctx = canvas.getContext('2d');

  const pinInput = document.getElementById('pin-input');
  const urlPin = new URLSearchParams(window.location.search).get('pin');
  if (urlPin && pinInput) {
    pinInput.value = urlPin.trim();
    trySpectate();
  }

  document.getElementById('btn-watch').addEventListener('click', trySpectate);
  document.getElementById('btn-start').addEventListener('click', startGame);
  document.getElementById('btn-reset').addEventListener('click', resetGame);
  pinInput?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') trySpectate();
  });

  PlayerUi.setupFullscreen('spectate-view');
  requestAnimationFrame(renderLoop);
}

function showJoinScreen() {
  intentionalLeave = true;
  document.getElementById('spectate-join').style.display = 'block';
  document.getElementById('spectate-view').classList.add('hidden');
  if (ws) {
    ws.close();
    ws = null;
  }
  state = null;
  currentPin = null;
  spectating = false;
  startPending = false;
  updateControls();
  setTimeout(() => {
    intentionalLeave = false;
  }, 100);
}

function showSpectateView() {
  document.getElementById('spectate-join').style.display = 'none';
  document.getElementById('spectate-view').classList.remove('hidden');
}

function trySpectate() {
  const pin = document.getElementById('pin-input').value.trim();
  const errorEl = document.getElementById('spectate-error');
  errorEl.classList.add('hidden');
  if (!pin) {
    errorEl.textContent = 'Indtast en PIN';
    errorEl.classList.remove('hidden');
    return;
  }
  currentPin = pin;
  connect();
}

function connect() {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const url = `${protocol}//${window.location.host}${apiBase()}`;

  spectating = false;
  startPending = false;
  updateControls();
  updateStatus('Forbinder...');
  showSpectateView();
  intentionalLeave = false;

  ws = new WebSocket(url);

  ws.onopen = () => {
    ws.send(JSON.stringify({ type: 'spectate', pin: currentPin }));
  };

  ws.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data);
      switch (msg.type) {
        case 'spectating':
          spectating = true;
          startPending = false;
          state = msg.data.state;
          stateReceivedAt = performance.now();
          document.getElementById('spectate-info').textContent = `PIN: ${currentPin}`;
          updateStatus('Ser spil');
          updateControls();
          break;
        case 'state':
          state = msg.data;
          stateReceivedAt = performance.now();
          startPending = false;
          updateControls();
          break;
        case 'error':
          document.getElementById('spectate-error').textContent = msg.data?.message || 'Ukendt fejl';
          document.getElementById('spectate-error').classList.remove('hidden');
          showJoinScreen();
          break;
        case 'lobbyEnded':
          document.getElementById('spectate-error').textContent = 'Spillet er blevet afsluttet';
          document.getElementById('spectate-error').classList.remove('hidden');
          showJoinScreen();
          break;
        default:
          break;
      }
    } catch (e) {
      console.error('Parse error:', e);
    }
  };

  ws.onclose = () => {
    spectating = false;
    startPending = false;
    updateControls();
    if (intentionalLeave) return;
    if (document.getElementById('spectate-view').classList.contains('hidden')) return;
    updateStatus('Forbindelse mistet…');
    setTimeout(connect, 2000);
  };

  ws.onerror = () => {
    spectating = false;
    updateControls();
    updateStatus('Fejl');
  };
}

function canStartGame() {
  return spectating && ws?.readyState === WebSocket.OPEN && !startPending &&
    state?.gameState === 'waiting' && state.players?.length >= 1;
}

function startGame() {
  if (!canStartGame()) return;
  startPending = true;
  updateControls();
  ws.send(JSON.stringify({ type: 'start' }));
}

function resetGame() {
  if (!spectating || ws?.readyState !== WebSocket.OPEN || startPending || state?.gameState !== 'ended') return;
  startPending = true;
  updateControls();
  ws.send(JSON.stringify({ type: 'reset' }));
}

function updateControls() {
  if (state) {
    PlayerUi.updateMatchInfo(state, null);
    PlayerUi.renderRoster(document.getElementById('stats-panel'), state, null);
    document.getElementById('spectate-info').textContent = `PIN: ${currentPin} · ${PlayerUi.modeLabel(state)} · op til ${state.maxPlayers || 4} spillere`;
  }
  document.getElementById('btn-start').disabled = !canStartGame();
  document.getElementById('btn-reset').disabled = !spectating || ws?.readyState !== WebSocket.OPEN || startPending || state?.gameState !== 'ended';
  const hint = document.getElementById('spectate-start-hint');
  const text = !spectating || ws?.readyState !== WebSocket.OPEN ? 'Venter på forbindelse…'
    : state?.gameState === 'playing' ? 'Spillet er i gang.'
      : state?.gameState === 'ended' ? 'Spillet er slut. Vælg «Nyt spil» for en ny runde.'
        : startPending ? 'Starter spillet…'
          : !state?.players?.length ? 'Venter på mindst én spiller.'
            : 'Du kan starte spillet uden selv at deltage.';
  if (hint.textContent !== text) hint.textContent = text;
}

function updateStatus(text) {
  const el = document.getElementById('status');
  if (el) {
    el.textContent = text;
    el.className = 'status-pill connected';
  }
}


function renderLoop(now) {
  now = now || performance.now();
  if (state && canvas && ctx) {
    let rs = state;
    if (state.gameState === 'playing' && state.bombs?.length) {
      const elapsed = now - stateReceivedAt;
      rs = {
        ...state,
        bombs: state.bombs.map((b) => ({ ...b, timer: Math.max(0, (b.timer || 0) - elapsed) })),
      };
    }
    Render.drawFrame(ctx, canvas, rs, now, {});
  }
  requestAnimationFrame(renderLoop);
}

init();
