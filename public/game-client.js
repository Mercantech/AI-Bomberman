/**
 * Bomberman WebSocket Client
 * Join via PIN, subscriber til spilstaten, sender inputs
 */

const CELL = { EMPTY: 0, SOLID: 1, BRICK: 2 };
const POWERUP = { NONE: 0, BOMB: 1, FLAME: 2, SPEED: 3 };
const TILE_SIZE = 32;
const CANVAS_PADDING = 2;

let ws = null;
let playerId = null;
let currentPin = null;
let currentName = '';
let state = null;
let canvas, ctx;
let keys = {};

function init() {
  canvas = document.getElementById('game-canvas');
  ctx = canvas.getContext('2d');

  const pinInput = document.getElementById('pin-input');
  const urlPin = new URLSearchParams(window.location.search).get('pin');
  if (urlPin && pinInput) {
    pinInput.value = urlPin.trim();
    tryJoin();
  }

  document.getElementById('btn-join').addEventListener('click', tryJoin);
  pinInput?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') tryJoin();
  });

  setupControls();
  setupButtons();
  setupArduinoController();
  requestAnimationFrame(renderLoop);
}

function showJoinScreen() {
  document.getElementById('join-screen').style.display = 'block';
  document.getElementById('game-screen').classList.add('hidden');
  if (ws) {
    ws.close();
    ws = null;
  }
  state = null;
  playerId = null;
  currentPin = null;
  currentName = '';
}

function showGameScreen() {
  document.getElementById('join-screen').style.display = 'none';
  document.getElementById('game-screen').classList.remove('hidden');
}

function tryJoin() {
  const pin = document.getElementById('pin-input').value.trim();
  const name = document.getElementById('name-input')?.value.trim() || '';
  const errorEl = document.getElementById('join-error');
  errorEl.classList.add('hidden');
  if (!pin) {
    errorEl.textContent = 'Indtast en PIN';
    errorEl.classList.remove('hidden');
    return;
  }
  currentPin = pin;
  currentName = name;
  connect();
}

function connect() {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const host = window.location.host;
  const url = `${protocol}//${host}`;

  updateStatus('Forbinder...', false);
  showGameScreen();

  ws = new WebSocket(url);

  ws.onopen = () => {
    ws.send(JSON.stringify({ type: 'join', pin: currentPin, name: currentName || undefined }));
  };

  ws.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data);
      switch (msg.type) {
        case 'joined':
          playerId = msg.data.playerId;
          state = msg.data.state;
          const myPlayer = msg.data.state?.players?.find(p => p.id === playerId);
          const displayName = myPlayer?.name || playerId;
          document.getElementById('player-info').textContent = `Du er: ${displayName} | PIN: ${currentPin}`;
          updateStatus('Forbundet', true);
          break;
        case 'state':
          state = msg.data;
          break;
        case 'error':
          updateStatus('Fejl', false);
          document.getElementById('join-error').textContent = msg.data?.message || 'Ukendt fejl';
          document.getElementById('join-error').classList.remove('hidden');
          showJoinScreen();
          break;
        case 'lobbyEnded':
          updateStatus('Lobby lukket', false);
          document.getElementById('join-error').textContent = 'Spillet er blevet afsluttet af admin';
          document.getElementById('join-error').classList.remove('hidden');
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
    if (document.getElementById('game-screen').classList.contains('hidden')) return;
    updateStatus('Forbindelse mistet', false);
    setTimeout(() => {
      if (currentPin && !ws) return;
      connect();
    }, 2000);
  };

  ws.onerror = () => {
    updateStatus('Fejl', false);
  };
}

function updateStatus(text, connected) {
  const el = document.getElementById('status');
  if (el) {
    el.textContent = text;
    el.className = connected ? 'connected' : 'disconnected';
  }
}

function isTypingInInput() {
  const el = document.activeElement;
  return el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.getAttribute('contenteditable') === 'true');
}

function setupControls() {
  document.addEventListener('keydown', (e) => {
    if (isTypingInInput()) return;
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'KeyW', 'KeyA', 'KeyS', 'KeyD'].includes(e.code)) {
      e.preventDefault();
      keys[e.code] = true;
    }
  });
  document.addEventListener('keyup', (e) => {
    if (isTypingInInput()) return;
    keys[e.code] = false;
  });
}

let serialReader = null;
let serialPort = null;

function applyArduinoCommand(cmd) {
  const c = String(cmd).trim().toUpperCase();
  if (c === 'UP') { keys['ArrowUp'] = true; keys['KeyW'] = true; }
  else if (c === 'RELEASE_UP') { keys['ArrowUp'] = false; keys['KeyW'] = false; }
  else if (c === 'DOWN') { keys['ArrowDown'] = true; keys['KeyS'] = true; }
  else if (c === 'RELEASE_DOWN') { keys['ArrowDown'] = false; keys['KeyS'] = false; }
  else if (c === 'LEFT') { keys['ArrowLeft'] = true; keys['KeyA'] = true; }
  else if (c === 'RELEASE_LEFT') { keys['ArrowLeft'] = false; keys['KeyA'] = false; }
  else if (c === 'RIGHT') { keys['ArrowRight'] = true; keys['KeyD'] = true; }
  else if (c === 'RELEASE_RIGHT') { keys['ArrowRight'] = false; keys['KeyD'] = false; }
  else if (c === 'BOMB') { keys['Space'] = true; }
}

async function connectArduinoController() {
  if (!('serial' in navigator)) {
    alert('Web Serial understøttes ikke i denne browser. Brug Chrome eller Edge.');
    return;
  }
  try {
    const port = await navigator.serial.requestPort();
    await port.open({ baudRate: 115200 });
    serialPort = port;
    const el = document.getElementById('arduino-status');
    if (el) { el.textContent = 'Arduino forbundet'; el.classList.add('connected'); }
    document.getElementById('btn-arduino')?.classList.add('hidden');
    let buffer = '';
    const decoder = new TextDecoderStream();
    port.readable.pipeTo(decoder.writable);
    const reader = decoder.readable.getReader();
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += value;
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() || '';
      for (const line of lines) applyArduinoCommand(line);
    }
  } catch (err) {
    if (err.name !== 'NotFoundError') {
      console.error('Arduino:', err);
      alert('Kunne ikke forbinde til Arduino: ' + (err.message || err));
    }
  } finally {
    serialPort = null;
    const st = document.getElementById('arduino-status');
    if (st) { st.textContent = ''; st.classList.remove('connected'); }
    document.getElementById('btn-arduino')?.classList.remove('hidden');
  }
}

function setupArduinoController() {
  const btn = document.getElementById('btn-arduino');
  if (btn) btn.addEventListener('click', connectArduinoController);
}

function setupButtons() {
  const startBtn = document.getElementById('btn-start');
  const resetBtn = document.getElementById('btn-reset');
  if (startBtn) startBtn.addEventListener('click', () => {
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'start' }));
  });
  if (resetBtn) resetBtn.addEventListener('click', () => {
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'reset' }));
  });
}

function sendInput(action, data = {}) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'input', data: { action, ...data } }));
  }
}

let lastMoveTime = 0;
const MOVE_COOLDOWN = 80;
function handleInput() {
  if (!state || state.gameState !== 'playing') return;
  const now = Date.now();
  if (now - lastMoveTime < MOVE_COOLDOWN) return;

  let dir = null;
  if (keys['ArrowUp'] || keys['KeyW']) dir = 'UP';
  else if (keys['ArrowDown'] || keys['KeyS']) dir = 'DOWN';
  else if (keys['ArrowLeft'] || keys['KeyA']) dir = 'LEFT';
  else if (keys['ArrowRight'] || keys['KeyD']) dir = 'RIGHT';

  if (dir) { sendInput('move', { direction: dir }); lastMoveTime = now; }
  if (keys['Space']) { sendInput('bomb'); keys['Space'] = false; }
}
setInterval(handleInput, 50);

function updateButtons() {
  const startBtn = document.getElementById('btn-start');
  const resetBtn = document.getElementById('btn-reset');
  if (!startBtn || !resetBtn) return;
  if (state) {
    startBtn.disabled = state.gameState !== 'waiting';
    resetBtn.disabled = false;
  } else {
    startBtn.disabled = true;
    resetBtn.disabled = true;
  }
}

function updateOverlay() {
  const overlay = document.getElementById('overlay');
  const title = document.getElementById('overlay-title');
  const text = document.getElementById('overlay-text');
  if (!overlay || !title || !text) return;

  if (!state) {
    overlay.classList.remove('hidden');
    title.textContent = 'Forbinder...';
    text.textContent = '';
    return;
  }

  if (state.gameState === 'waiting') {
    overlay.classList.remove('hidden', 'victory', 'defeat');
    title.textContent = 'Venter på spillere';
    text.textContent = `Tryk "Start spil" for at begynde (${state.players.length} spiller(e))`;
    return;
  }

  if (state.gameState === 'ended') {
    overlay.classList.remove('hidden');
    const iWon = state.winnerId === playerId;
    overlay.classList.toggle('victory', iWon);
    overlay.classList.toggle('defeat', !iWon);
    title.textContent = iWon ? 'Du vandt!' : 'Spillet er slut';
    text.textContent = iWon ? 'Tillykke!' : 'Tryk "Nyt spil" for at spille igen';
    return;
  }

  if (state.gameState === 'playing') {
    overlay.classList.add('hidden');
  }
}

function updateStats() {
  const panel = document.getElementById('stats-panel');
  if (!panel || !state || !state.players?.length) return;
  panel.innerHTML = state.players.map(p => {
    const isMe = p.id === playerId;
    const liveIcon = p.alive ? '❤️' : '💀';
    const displayName = p.name || p.id;
    return `
      <div class="stat-card ${isMe ? 'stat-card-me' : ''}">
        <div class="stat-avatar" style="background:${p.color}"></div>
        <div class="stat-details">
          <span class="stat-name">${displayName}${isMe ? ' (dig)' : ''}</span>
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
  if (state) {
    const gridSize = state.gridSize || 13;
    const size = gridSize * TILE_SIZE + CANVAS_PADDING * 2;
    if (canvas && (canvas.width !== size || canvas.height !== size)) {
      canvas.width = size;
      canvas.height = size;
    }
    render();
    updateButtons();
    updateOverlay();
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
