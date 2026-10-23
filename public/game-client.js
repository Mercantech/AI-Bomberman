/**
 * Bomberman client — open lobby, waiting room, sprite render
 */

const Sfx = window.BombermanSfx;
const Render = window.BombermanRender;

let ws = null;
let playerId = null;
let currentPin = null;
let currentName = '';
let state = null;
let canvas, ctx, miniCanvas, miniCtx;
let keys = {};
let lobbyPollTimer = null;
let prevBombCount = 0;
let prevExplosionCount = 0;
let prevAlive = {};
let prevPowerups = 0;
let countdownActive = false;
let lastGameState = null;
let intentionalLeave = false;

function apiBase() {
  const m = window.location.pathname.match(/^(\/Bomberman)(?=\/|$)/);
  return m ? m[1] : '';
}

function init() {
  canvas = document.getElementById('game-canvas');
  ctx = canvas?.getContext('2d');
  miniCanvas = document.getElementById('mini-map');
  miniCtx = miniCanvas?.getContext('2d');

  Sfx?.loadMutePref();
  updateMuteButtons();

  const pinInput = document.getElementById('pin-input');
  const urlPin = new URLSearchParams(window.location.search).get('pin');
  if (urlPin && pinInput) {
    pinInput.value = urlPin.trim();
  }

  document.getElementById('btn-join')?.addEventListener('click', () => {
    Sfx?.click();
    tryJoin();
  });
  pinInput?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') tryJoin();
  });
  document.getElementById('btn-create')?.addEventListener('click', () => {
    Sfx?.click();
    createLobby();
  });
  document.getElementById('btn-refresh-lobbies')?.addEventListener('click', () => {
    Sfx?.click();
    refreshOpenLobbies();
  });
  document.getElementById('btn-ready')?.addEventListener('click', toggleReady);
  document.getElementById('btn-start')?.addEventListener('click', () => {
    if (ws?.readyState === WebSocket.OPEN) {
      Sfx?.start();
      ws.send(JSON.stringify({ type: 'start' }));
    }
  });
  document.getElementById('btn-reset')?.addEventListener('click', () => {
    if (ws?.readyState === WebSocket.OPEN) {
      Sfx?.click();
      ws.send(JSON.stringify({ type: 'reset' }));
    }
  });
  document.getElementById('btn-leave')?.addEventListener('click', leaveLobby);
  document.getElementById('btn-copy-pin')?.addEventListener('click', copyPin);
  document.getElementById('btn-mute')?.addEventListener('click', toggleMute);
  document.getElementById('btn-mute-game')?.addEventListener('click', toggleMute);

  setupControls();
  setupArduinoController();
  refreshOpenLobbies();
  lobbyPollTimer = setInterval(refreshOpenLobbies, 2500);

  if (urlPin && pinInput?.value) {
    tryJoin();
  }

  requestAnimationFrame(renderLoop);
}

function updateMuteButtons() {
  const label = Sfx?.isMuted() ? 'Lyd: Off' : 'Lyd: On';
  const a = document.getElementById('btn-mute');
  const b = document.getElementById('btn-mute-game');
  if (a) a.textContent = label;
  if (b) b.textContent = label;
}

function toggleMute() {
  Sfx?.toggleMute();
  updateMuteButtons();
}

function showScreen(id) {
  ['join-screen', 'waiting-screen', 'game-screen'].forEach((sid) => {
    const el = document.getElementById(sid);
    if (!el) return;
    el.classList.toggle('hidden', sid !== id);
  });
}

function showJoinScreen(msg) {
  intentionalLeave = true;
  if (ws) {
    ws.close();
    ws = null;
  }
  state = null;
  playerId = null;
  currentPin = null;
  lastGameState = null;
  countdownActive = false;
  showScreen('join-screen');
  if (msg) {
    const err = document.getElementById('join-error');
    err.textContent = msg;
    err.classList.remove('hidden');
  }
  refreshOpenLobbies();
  setTimeout(() => {
    intentionalLeave = false;
  }, 100);
}

function leaveLobby() {
  Sfx?.click();
  showJoinScreen();
}

async function createLobby() {
  const err = document.getElementById('join-error');
  err.classList.add('hidden');
  const gridSize = document.getElementById('create-grid')?.value || 13;
  const name =
    document.getElementById('create-name')?.value.trim() ||
    document.getElementById('name-input')?.value.trim() ||
    '';
  try {
    const res = await fetch(`${apiBase()}/api/lobbies`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ gridSize: parseInt(gridSize, 10) }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Kunne ikke oprette lobby');
    currentPin = String(data.pin);
    currentName = name;
    const pinInput = document.getElementById('pin-input');
    if (pinInput) pinInput.value = currentPin;
    if (name) {
      const ni = document.getElementById('name-input');
      if (ni) ni.value = name;
    }
    connect();
  } catch (e) {
    err.textContent = e.message || 'Fejl ved oprettelse';
    err.classList.remove('hidden');
  }
}

async function refreshOpenLobbies() {
  const list = document.getElementById('open-lobby-list');
  const empty = document.getElementById('no-open-lobbies');
  if (!list) return;
  if (document.getElementById('join-screen')?.classList.contains('hidden')) return;
  try {
    const res = await fetch(`${apiBase()}/api/lobbies`);
    const data = await res.json();
    const lobbies = data.lobbies || [];
    if (!lobbies.length) {
      list.innerHTML = '';
      empty?.classList.remove('hidden');
      return;
    }
    empty?.classList.add('hidden');
    list.innerHTML = lobbies
      .map(
        (l) => `
      <div class="open-lobby-row" data-pin="${escapeHtml(l.pin)}">
        <div class="open-lobby-meta">
          <span class="pin">${escapeHtml(l.pin)}</span>
          <span>${l.playerCount} spiller(e)</span>
          <span>${l.gridSize}×${l.gridSize}</span>
        </div>
        <button type="button" class="btn-secondary btn-sm btn-join-open">Deltag</button>
      </div>`
      )
      .join('');
    list.querySelectorAll('.btn-join-open').forEach((btn) => {
      btn.addEventListener('click', () => {
        const row = btn.closest('.open-lobby-row');
        const pin = row?.dataset.pin;
        if (!pin) return;
        Sfx?.click();
        const pinInput = document.getElementById('pin-input');
        if (pinInput) pinInput.value = pin;
        tryJoin();
      });
    });
  } catch (_) {
    /* ignore poll errors */
  }
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/"/g, '&quot;');
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
  const url = `${protocol}//${window.location.host}${apiBase()}`;

  updateStatus('Forbinder...', false);
  showScreen('waiting-screen');
  document.getElementById('waiting-pin').textContent = currentPin || '----';
  const spec = document.getElementById('link-spectate');
  if (spec) spec.href = `spectate.html?pin=${encodeURIComponent(currentPin || '')}`;

  intentionalLeave = false;
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
          applyState(msg.data.state);
          updateStatus('Forbundet', true);
          break;
        case 'state':
          applyState(msg.data);
          break;
        case 'error':
          updateStatus('Fejl', false);
          showJoinScreen(msg.data?.message || 'Ukendt fejl');
          break;
        case 'lobbyEnded':
          showJoinScreen('Spillet er blevet afsluttet');
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
    if (document.getElementById('join-screen') && !document.getElementById('join-screen').classList.contains('hidden')) {
      return;
    }
    updateStatus('Forbindelse mistet', false);
    setTimeout(() => {
      if (currentPin && !intentionalLeave) connect();
    }, 2000);
  };

  ws.onerror = () => updateStatus('Fejl', false);
}

function applyState(next) {
  const prev = state;
  state = next;
  detectSfx(prev, next);

  if (next.gameState === 'waiting') {
    showScreen('waiting-screen');
    updateWaitingRoom();
  } else if (next.gameState === 'playing' || next.gameState === 'ended') {
    if (lastGameState === 'waiting' && next.gameState === 'playing') {
      runCountdown();
    }
    showScreen('game-screen');
    updateGameChrome();
  }
  lastGameState = next.gameState;
}

function detectSfx(prev, next) {
  if (!next || !Sfx) return;
  const bombs = next.bombs?.length || 0;
  const exps = next.explosions?.length || 0;
  const pus = next.powerups?.length || 0;

  if (prev && bombs > prevBombCount) Sfx.bomb();
  if (prev && exps > prevExplosionCount) Sfx.explode();
  if (prev && pus < prevPowerups) Sfx.pickup();

  if (prev?.players) {
    for (const p of next.players || []) {
      const was = prevAlive[p.id];
      if (was === true && !p.alive) Sfx.death();
    }
    if (next.gameState === 'ended' && prev.gameState === 'playing' && next.winnerId === playerId) {
      Sfx.win();
    }
  }

  prevBombCount = bombs;
  prevExplosionCount = exps;
  prevPowerups = pus;
  prevAlive = {};
  for (const p of next.players || []) prevAlive[p.id] = p.alive;
}

function runCountdown() {
  if (countdownActive) return;
  const el = document.getElementById('countdown');
  if (!el) return;
  countdownActive = true;
  el.classList.remove('hidden');
  let n = 3;
  const tick = () => {
    if (n > 0) {
      el.textContent = String(n);
      Sfx?.countdown();
      n--;
      setTimeout(tick, 700);
    } else {
      el.textContent = 'GO!';
      setTimeout(() => {
        el.classList.add('hidden');
        countdownActive = false;
      }, 400);
    }
  };
  tick();
}

function updateStatus(text, connected) {
  const el = document.getElementById('status');
  if (el) {
    el.textContent = text;
    el.className = 'status-pill ' + (connected ? 'connected' : 'disconnected');
  }
  const gs = document.getElementById('game-status');
  if (gs && state) {
    gs.textContent =
      state.gameState === 'playing' ? 'Live' : state.gameState === 'ended' ? 'Slut' : text;
    gs.className = 'status-pill ' + (connected ? 'connected' : 'disconnected');
  }
}

function updateWaitingRoom() {
  if (!state) return;
  document.getElementById('waiting-pin').textContent = currentPin || '----';
  document.getElementById('waiting-grid-info').textContent = `${state.gridSize}×${state.gridSize} · classic maze`;
  const me = state.players?.find((p) => p.id === playerId);
  document.getElementById('player-info').textContent = me
    ? `Du er: ${me.name || playerId}`
    : '';

  const cards = document.getElementById('player-cards');
  cards.innerHTML = (state.players || [])
    .map((p) => {
      const isMe = p.id === playerId;
      const isHost = state.hostId === p.id;
      return `
      <div class="player-card ${isMe ? 'is-me' : ''} ${p.ready ? 'is-ready' : ''}">
        <div class="player-avatar" style="background:${p.color}"></div>
        <div class="player-card-info">
          <div class="player-card-name">${escapeHtml(p.name || p.id)}${isMe ? ' (dig)' : ''}</div>
          <div class="player-card-badges">
            ${isHost ? '<span class="badge host">HOST</span>' : ''}
            ${p.isController ? '<span class="badge arduino">OPLÀ</span>' : ''}
            <span class="badge ${p.ready ? 'ready' : ''}">${p.ready ? 'KLAR' : 'VENTER'}</span>
          </div>
        </div>
      </div>`;
    })
    .join('');

  const readyBtn = document.getElementById('btn-ready');
  if (readyBtn && me) {
    readyBtn.textContent = me.ready ? 'Ikke klar' : 'Klar';
    readyBtn.classList.toggle('is-ready', !!me.ready);
  }

  const startBtn = document.getElementById('btn-start');
  if (startBtn) startBtn.disabled = state.gameState !== 'waiting' || !(state.players?.length >= 1);

  if (miniCtx && miniCanvas) {
    Render.drawMiniMap(miniCtx, miniCanvas, state);
  }
}

function updateGameChrome() {
  const resetBtn = document.getElementById('btn-reset');
  if (resetBtn) resetBtn.disabled = !state;
  updateOverlay();
  updateStats();
}

function updateOverlay() {
  const overlay = document.getElementById('overlay');
  const title = document.getElementById('overlay-title');
  const text = document.getElementById('overlay-text');
  if (!overlay || !title || !text || !state) return;

  if (state.gameState === 'ended') {
    overlay.classList.remove('hidden');
    const iWon = state.winnerId === playerId;
    overlay.classList.toggle('victory', iWon);
    overlay.classList.toggle('defeat', !iWon);
    title.textContent = iWon ? 'Du vandt!' : 'Spillet er slut';
    text.textContent = iWon ? 'Tillykke!' : 'Tryk "Nyt spil" for at spille igen';
  } else {
    overlay.classList.add('hidden');
  }
}

function updateStats() {
  const panel = document.getElementById('stats-panel');
  if (!panel || !state?.players?.length) return;
  panel.innerHTML = state.players
    .map((p) => {
      const isMe = p.id === playerId;
      return `
      <div class="stat-card ${isMe ? 'stat-card-me' : ''} ${p.alive ? '' : 'dead'}">
        <div class="stat-avatar" style="background:${p.color}"></div>
        <div class="stat-details">
          <span class="stat-name">${escapeHtml(p.name || p.id)}${isMe ? ' (dig)' : ''}</span>
          <div class="stat-row">
            <span><span class="stat-icon">HP</span>${p.alive ? 'OK' : 'OUT'}</span>
            <span><span class="stat-icon">B</span>${p.bombs}/${p.maxBombs}</span>
            <span><span class="stat-icon">F</span>${p.flameLength}</span>
            <span><span class="stat-icon">S</span>${(p.speed || 1).toFixed(1)}</span>
            <span><span class="stat-icon">K</span>${p.kills || 0}</span>
          </div>
        </div>
      </div>`;
    })
    .join('');
}

function toggleReady() {
  if (ws?.readyState === WebSocket.OPEN) {
    Sfx?.ready();
    ws.send(JSON.stringify({ type: 'ready' }));
  }
}

function copyPin() {
  if (!currentPin) return;
  navigator.clipboard?.writeText(currentPin).then(() => {
    Sfx?.click();
    const btn = document.getElementById('btn-copy-pin');
    if (btn) {
      const t = btn.textContent;
      btn.textContent = 'Kopieret!';
      setTimeout(() => {
        btn.textContent = t;
      }, 1200);
    }
  });
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

let serialPort = null;

function applyArduinoCommand(cmd) {
  const c = String(cmd).trim().toUpperCase();
  if (c === 'UP') {
    keys['ArrowUp'] = true;
    keys['KeyW'] = true;
  } else if (c === 'RELEASE_UP') {
    keys['ArrowUp'] = false;
    keys['KeyW'] = false;
  } else if (c === 'DOWN') {
    keys['ArrowDown'] = true;
    keys['KeyS'] = true;
  } else if (c === 'RELEASE_DOWN') {
    keys['ArrowDown'] = false;
    keys['KeyS'] = false;
  } else if (c === 'LEFT') {
    keys['ArrowLeft'] = true;
    keys['KeyA'] = true;
  } else if (c === 'RELEASE_LEFT') {
    keys['ArrowLeft'] = false;
    keys['KeyA'] = false;
  } else if (c === 'RIGHT') {
    keys['ArrowRight'] = true;
    keys['KeyD'] = true;
  } else if (c === 'RELEASE_RIGHT') {
    keys['ArrowRight'] = false;
    keys['KeyD'] = false;
  } else if (c === 'BOMB') {
    keys['Space'] = true;
  }
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
    if (el) {
      el.textContent = 'Arduino forbundet';
      el.classList.add('connected');
    }
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
      alert('Kunne ikke forbinde til Arduino: ' + (err.message || err));
    }
  } finally {
    serialPort = null;
    const st = document.getElementById('arduino-status');
    if (st) {
      st.textContent = '';
      st.classList.remove('connected');
    }
    document.getElementById('btn-arduino')?.classList.remove('hidden');
  }
}

function setupArduinoController() {
  document.getElementById('btn-arduino')?.addEventListener('click', connectArduinoController);
}

function sendInput(action, data = {}) {
  if (ws?.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'input', data: { action, ...data } }));
  }
}

let lastMoveTime = 0;
const MOVE_COOLDOWN = 80;
function handleInput() {
  if (!state || state.gameState !== 'playing' || countdownActive) return;
  const now = Date.now();
  if (now - lastMoveTime < MOVE_COOLDOWN) return;

  let dir = null;
  if (keys['ArrowUp'] || keys['KeyW']) dir = 'UP';
  else if (keys['ArrowDown'] || keys['KeyS']) dir = 'DOWN';
  else if (keys['ArrowLeft'] || keys['KeyA']) dir = 'LEFT';
  else if (keys['ArrowRight'] || keys['KeyD']) dir = 'RIGHT';

  if (dir) {
    sendInput('move', { direction: dir });
    lastMoveTime = now;
  }
  if (keys['Space']) {
    sendInput('bomb');
    keys['Space'] = false;
  }
}
setInterval(handleInput, 50);

function renderLoop() {
  const now = Date.now();
  if (state && canvas && ctx && (state.gameState === 'playing' || state.gameState === 'ended')) {
    Render.drawFrame(ctx, canvas, state, now, { highlightId: playerId });
    updateOverlay();
    updateStats();
  }
  if (state && state.gameState === 'waiting' && miniCtx && miniCanvas) {
    Render.drawMiniMap(miniCtx, miniCanvas, state);
  }
  requestAnimationFrame(renderLoop);
}

init();
