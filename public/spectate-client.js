/**
 * Bomberman Spectator - Se spil uden at deltage
 */

const CELL = { EMPTY: 0, SOLID: 1, BRICK: 2 };
const POWERUP = { NONE: 0, BOMB: 1, FLAME: 2, SPEED: 3 };
const TILE_SIZE = 32;
const CANVAS_PADDING = 2;

let ws = null;
let currentPin = null;
let state = null;
let canvas, ctx;

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
  document.getElementById('spectate-join').style.display = 'block';
  document.getElementById('spectate-view').classList.add('hidden');
  if (ws) { ws.close(); ws = null; }
  state = null;
  currentPin = null;
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
  const url = `${protocol}//${window.location.host}`;

  updateStatus('Forbinder...');
  showSpectateView();

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
          document.getElementById('spectate-info').textContent = `Ser spil med PIN: ${currentPin}`;
          updateStatus('Ser spil');
          break;
        case 'state':
          state = msg.data;
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
    if (document.getElementById('spectate-view').classList.contains('hidden')) return;
    updateStatus('Forbindelse mistet - Genindlæser...');
    setTimeout(connect, 2000);
  };

  ws.onerror = () => {
    updateStatus('Fejl');
  };
}

function updateStatus(text) {
  const el = document.getElementById('status');
  if (el) el.textContent = text;
}

function updateStats() {
  const panel = document.getElementById('stats-panel');
  if (!panel || !state || !state.players?.length) return;
  panel.innerHTML = state.players.map(p => {
    const liveIcon = p.alive ? '❤️' : '💀';
    return `
      <div class="stat-card">
        <div class="stat-avatar" style="background:${p.color}"></div>
        <div class="stat-details">
          <span class="stat-name">${p.name || p.id}</span>
          <div class="stat-row">
            <span title="Liv">${liveIcon}</span>
            <span title="Bomber">💣 ${p.bombs}/${p.maxBombs}</span>
            <span title="Kills">⚔️ ${p.kills || 0}</span>
            <span title="Flamme">🔥 ${p.flameLength}</span>
            <span title="Hastighed">⚡ ${p.speed?.toFixed(1) || 1}</span>
          </div>
        </div>
      </div>
    `;
  }).join('');
}

function renderLoop() {
  if (state && canvas && ctx) {
    const gridSize = state.gridSize || 13;
    const size = gridSize * TILE_SIZE + CANVAS_PADDING * 2;
    if (canvas.width !== size || canvas.height !== size) {
      canvas.width = size;
      canvas.height = size;
    }
    render();
    updateStats();
  }
  requestAnimationFrame(renderLoop);
}

function render() {
  if (!state || !ctx) return;
  const gs = state.gridSize || 13;
  const pad = CANVAS_PADDING;

  ctx.fillStyle = '#1a1a2e';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  for (let y = 0; y < gs; y++) {
    for (let x = 0; x < gs; x++) {
      const cell = state.grid[y][x];
      const px = pad + x * TILE_SIZE;
      const py = pad + y * TILE_SIZE;
      if (cell === CELL.SOLID) {
        ctx.fillStyle = '#2c3e50';
        ctx.fillRect(px, py, TILE_SIZE, TILE_SIZE);
        ctx.strokeStyle = '#34495e';
        ctx.strokeRect(px, py, TILE_SIZE, TILE_SIZE);
      } else if (cell === CELL.BRICK) {
        ctx.fillStyle = '#8b4513';
        ctx.fillRect(px, py, TILE_SIZE, TILE_SIZE);
        ctx.fillStyle = '#a0522d';
        ctx.fillRect(px + 2, py + 2, TILE_SIZE - 4, TILE_SIZE - 4);
      } else {
        ctx.fillStyle = '#2a2a3e';
        ctx.fillRect(px, py, TILE_SIZE, TILE_SIZE);
      }
    }
  }

  for (const pu of state.powerups || []) {
    const px = pad + pu.x * TILE_SIZE;
    const py = pad + pu.y * TILE_SIZE;
    ctx.font = '20px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    if (pu.type === POWERUP.BOMB) ctx.fillStyle = '#e74c3c';
    else if (pu.type === POWERUP.FLAME) ctx.fillStyle = '#f39c12';
    else ctx.fillStyle = '#3498db';
    ctx.fillText(pu.type === POWERUP.BOMB ? 'B' : pu.type === POWERUP.FLAME ? 'F' : 'S', px + TILE_SIZE / 2, py + TILE_SIZE / 2);
  }

  for (const bomb of state.bombs || []) {
    const px = pad + bomb.x * TILE_SIZE;
    const py = pad + bomb.y * TILE_SIZE;
    ctx.fillStyle = '#333';
    ctx.beginPath();
    ctx.arc(px + TILE_SIZE / 2, py + TILE_SIZE / 2, TILE_SIZE / 2 - 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#555';
    ctx.stroke();
  }

  for (const exp of state.explosions || []) {
    const px = pad + exp.x * TILE_SIZE;
    const py = exp.y * TILE_SIZE;
    ctx.fillStyle = 'rgba(255, 150, 50, 0.8)';
    ctx.fillRect(px + 4, py + 4, TILE_SIZE - 8, TILE_SIZE - 8);
  }

  for (const p of state.players || []) {
    const px = pad + p.x * TILE_SIZE;
    const py = pad + p.y * TILE_SIZE;
    if (!p.alive) ctx.globalAlpha = 0.4;
    ctx.fillStyle = p.color || '#3498db';
    ctx.beginPath();
    ctx.arc(px + TILE_SIZE / 2, py + TILE_SIZE / 2, TILE_SIZE / 2 - 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.globalAlpha = 1;
  }
}

init();
