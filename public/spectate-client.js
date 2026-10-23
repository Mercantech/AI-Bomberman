/**
 * Bomberman Spectator — shared renderer
 */

const Render = window.BombermanRender;

let ws = null;
let currentPin = null;
let state = null;
let canvas, ctx;
let intentionalLeave = false;
let stateReceivedAt = 0;
let lastStatsKey = '';

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
  pinInput?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') trySpectate();
  });

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
          state = msg.data.state;
          stateReceivedAt = performance.now();
          document.getElementById('spectate-info').textContent = `PIN: ${currentPin}`;
          updateStatus('Ser spil');
          break;
        case 'state':
          state = msg.data;
          stateReceivedAt = performance.now();
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
    if (intentionalLeave) return;
    if (document.getElementById('spectate-view').classList.contains('hidden')) return;
    updateStatus('Forbindelse mistet…');
    setTimeout(connect, 2000);
  };

  ws.onerror = () => updateStatus('Fejl');
}

function updateStatus(text) {
  const el = document.getElementById('status');
  if (el) {
    el.textContent = text;
    el.className = 'status-pill connected';
  }
}

function updateStats() {
  const panel = document.getElementById('stats-panel');
  if (!panel || !state?.players?.length) return;
  const key = state.players
    .map((p) => `${p.id}:${p.alive}:${p.bombs}:${p.maxBombs}:${p.flameLength}:${p.kills}`)
    .join('|');
  if (key === lastStatsKey) return;
  lastStatsKey = key;
  panel.innerHTML = state.players
    .map(
      (p) => `
      <div class="stat-card ${p.alive ? '' : 'dead'}">
        <div class="stat-avatar" style="background:${p.color}"></div>
        <div class="stat-details">
          <span class="stat-name">${p.name || p.id}</span>
          <div class="stat-row">
            <span><span class="stat-icon">HP</span>${p.alive ? 'OK' : 'OUT'}</span>
            <span><span class="stat-icon">B</span>${p.bombs}/${p.maxBombs}</span>
            <span><span class="stat-icon">F</span>${p.flameLength}</span>
            <span><span class="stat-icon">K</span>${p.kills || 0}</span>
          </div>
        </div>
      </div>`
    )
    .join('');
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
    updateStats();
  }
  requestAnimationFrame(renderLoop);
}

init();
