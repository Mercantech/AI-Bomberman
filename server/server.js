/**
 * Bomberman WebSocket Server
 * Multi-lobby system med PIN, admin API, valgfri MQTT-bridge til Oplà
 */

const WebSocket = require('ws');
const http = require('http');
const path = require('path');
const fs = require('fs');
const { URL } = require('url');

const { BombermanGame, normalizeDirection, MIN_GRID_SIZE, MAX_GRID_SIZE } = require('./game');
const { createControllerService } = require('./controller-service');
const { startMqttBridge } = require('./mqtt-bridge');

const PORT = process.env.PORT || 8080;

const lobbies = new Map();

let playerIdCounter = 0;

function allocatePlayerId() {
  return `player_${++playerIdCounter}`;
}

function generatePin() {
  return String(Math.floor(1000 + Math.random() * 9000));
}

function createLobby(gridSize = 13, requestedPin) {
  let pin;
  if (requestedPin) {
    pin = String(requestedPin).trim().slice(0, 8);
    if (!pin) {
      return { error: 'Ugyldig PIN' };
    }
    if (lobbies.has(pin)) {
      return { error: 'PIN er allerede i brug', pin, conflict: true };
    }
  } else {
    pin = generatePin();
    let attempts = 0;
    while (lobbies.has(pin) && attempts < 20) {
      pin = generatePin();
      attempts++;
    }
    if (lobbies.has(pin)) {
      return { error: 'Kunne ikke generere unik PIN' };
    }
  }
  const size = Math.min(MAX_GRID_SIZE, Math.max(MIN_GRID_SIZE, parseInt(gridSize, 10) || 13));
  const game = new BombermanGame(size);
  lobbies.set(pin, {
    game,
    clients: new Set(),
    spectators: new Set(),
    controllerPlayers: new Map(),
    controllerDevices: new Map(),
    createdAt: Date.now(),
  });
  return { pin, gridSize: game.gridSize };
}

function sendTo(client, type, data) {
  if (client && client.readyState === WebSocket.OPEN) {
    client.send(JSON.stringify({ type, data }));
  }
}

function broadcastToLobby(pin, message) {
  const lobby = lobbies.get(pin);
  if (!lobby) return;
  const msg = typeof message === 'string' ? message : JSON.stringify(message);
  lobby.clients.forEach((ws) => {
    if (ws.readyState === WebSocket.OPEN) ws.send(msg);
  });
  if (lobby.spectators) {
    lobby.spectators.forEach((ws) => {
      if (ws.readyState === WebSocket.OPEN) ws.send(msg);
    });
  }
}

function handleInput(pin, playerId, input) {
  const lobby = lobbies.get(pin);
  if (!lobby) return;
  const game = lobby.game;
  if (game.gameState !== 'playing') return;

  switch (input.action) {
    case 'move': {
      const dir = normalizeDirection(input.direction);
      if (dir && game.movePlayer(playerId, dir)) {
        broadcastToLobby(pin, { type: 'state', data: game.getState() });
      }
      break;
    }
    case 'bomb':
      if (game.placeBomb(playerId)) {
        broadcastToLobby(pin, { type: 'state', data: game.getState() });
      }
      break;
    default:
      break;
  }
}

function getOpenLobbyList() {
  return [...lobbies.entries()]
    .filter(([, lobby]) => lobby.game.gameState === 'waiting')
    .map(([pin, lobby]) => ({
      pin,
      gridSize: lobby.game.gridSize,
      playerCount: lobby.clients.size + (lobby.controllerPlayers?.size || 0),
      spectatorCount: (lobby.spectators || new Set()).size,
      gameState: lobby.game.gameState,
      createdAt: lobby.createdAt,
    }));
}

const controller = createControllerService({
  lobbies,
  allocatePlayerId,
  broadcastToLobby,
  applyGameInput: handleInput,
});

function getLobbyList() {
  return [...lobbies.entries()].map(([pin, lobby]) => ({
    pin,
    gridSize: lobby.game.gridSize,
    playerCount: lobby.clients.size + (lobby.controllerPlayers?.size || 0),
    spectatorCount: (lobby.spectators || new Set()).size,
    gameState: lobby.game.gameState,
    createdAt: lobby.createdAt,
  }));
}

function endLobby(pin) {
  const lobby = lobbies.get(pin);
  if (!lobby) return false;
  if (lobby.game.tickInterval) {
    clearInterval(lobby.game.tickInterval);
  }
  lobby.clients.forEach((ws) => {
    sendTo(ws, 'lobbyEnded', { pin });
  });
  if (lobby.spectators) {
    lobby.spectators.forEach((ws) => {
      sendTo(ws, 'lobbyEnded', { pin });
    });
  }
  lobbies.delete(pin);
  return true;
}

function handleAdminApi(req, res) {
  const parsed = new URL(req.url, `http://localhost:${PORT}`);
  const pathname = parsed.pathname;

  res.setHeader('Content-Type', 'application/json');

  if (pathname === '/api/admin/lobbies' && req.method === 'GET') {
    res.writeHead(200);
    res.end(JSON.stringify({ lobbies: getLobbyList() }));
    return;
  }

  if (pathname === '/api/admin/lobbies' && req.method === 'POST') {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
    });
    req.on('end', () => {
      try {
        const { pin: reqPin, gridSize = 13 } = JSON.parse(body || '{}');
        if (reqPin) {
          const pin = String(reqPin).slice(0, 8);
          if (lobbies.has(pin)) {
            res.writeHead(409);
            res.end(JSON.stringify({ error: 'PIN eksisterer allerede', pin }));
            return;
          }
          const size = Math.min(MAX_GRID_SIZE, Math.max(MIN_GRID_SIZE, parseInt(gridSize, 10) || 13));
          const game = new BombermanGame(size);
          lobbies.set(pin, {
            game,
            clients: new Set(),
            spectators: new Set(),
            controllerPlayers: new Map(),
            controllerDevices: new Map(),
            createdAt: Date.now(),
          });
          res.writeHead(201);
          res.end(JSON.stringify({ pin, gridSize: game.gridSize }));
          return;
        }
        const created = createLobby(gridSize);
        if (created.error) {
          res.writeHead(500);
          res.end(JSON.stringify({ error: created.error }));
          return;
        }
        res.writeHead(201);
        res.end(JSON.stringify(created));
      } catch (e) {
        res.writeHead(400);
        res.end(JSON.stringify({ error: 'Ugyldig forespørgsel' }));
      }
    });
    return;
  }

  const endMatch = pathname.match(/^\/api\/admin\/lobbies\/([^/]+)\/end$/);
  if (endMatch && req.method === 'POST') {
    const pin = endMatch[1];
    if (endLobby(pin)) {
      res.writeHead(200);
      res.end(JSON.stringify({ success: true, pin }));
    } else {
      res.writeHead(404);
      res.end(JSON.stringify({ error: 'Lobby ikke fundet', pin }));
    }
    return;
  }

  res.writeHead(404);
  res.end(JSON.stringify({ error: 'Not found' }));
}

function handleControllerApi(req, res) {
  const parsed = new URL(req.url, `http://localhost:${PORT}`);
  const pathname = parsed.pathname;
  res.setHeader('Content-Type', 'application/json');

  if (pathname === '/api/controller/join' && req.method === 'POST') {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
    });
    req.on('end', () => {
      try {
        console.log('[CONTROLLER JOIN] Raw body:', body);
        const { pin, name, deviceId } = JSON.parse(body || '{}');
        const pinStr = String(pin || '').trim();
        const result = controller.controllerJoin(pinStr, { name, deviceId });
        res.writeHead(result.status);
        res.end(JSON.stringify(result.body));
      } catch (e) {
        console.error('[CONTROLLER JOIN] Error:', e.message, e.stack);
        res.writeHead(400);
        res.end(JSON.stringify({ ok: false, error: 'Ugyldig forespørgsel' }));
      }
    });
    return;
  }

  if (pathname === '/api/controller/heartbeat' && req.method === 'POST') {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
    });
    req.on('end', () => {
      try {
        const { pin, playerId } = JSON.parse(body || '{}');
        const pinStr = String(pin || '').trim();
        const result = controller.controllerHeartbeat(pinStr, playerId);
        res.writeHead(result.status);
        res.end(JSON.stringify(result.body));
      } catch (e) {
        res.writeHead(400);
        res.end(JSON.stringify({ ok: false, error: 'Ugyldig forespørgsel' }));
      }
    });
    return;
  }

  if (
    (pathname === '/api/controller/action' || pathname === '/api/controller/input') &&
    req.method === 'POST'
  ) {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
    });
    req.on('end', () => {
      try {
        const { pin, playerId, action, direction, params } = JSON.parse(body || '{}');
        const pinStr = String(pin || '').trim();
        const result = controller.controllerAction(pinStr, playerId, {
          action,
          direction,
          params,
        });
        res.writeHead(result.status);
        res.end(JSON.stringify(result.body));
      } catch (e) {
        res.writeHead(400);
        res.end(JSON.stringify({ ok: false, error: 'Ugyldig forespørgsel' }));
      }
    });
    return;
  }

  res.writeHead(404);
  res.end(JSON.stringify({ ok: false, error: 'Not found' }));
}

function setCorsHeaders(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

function handlePublicLobbyApi(req, res) {
  const parsed = new URL(req.url, `http://localhost:${PORT}`);
  const pathname = parsed.pathname;
  res.setHeader('Content-Type', 'application/json');

  if (pathname === '/api/lobbies' && req.method === 'GET') {
    res.writeHead(200);
    res.end(JSON.stringify({ lobbies: getOpenLobbyList() }));
    return;
  }

  if (pathname === '/api/lobbies' && req.method === 'POST') {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
    });
    req.on('end', () => {
      try {
        const { gridSize = 13, pin: reqPin } = JSON.parse(body || '{}');
        const created = createLobby(gridSize, reqPin || undefined);
        if (created.error) {
          res.writeHead(created.conflict ? 409 : 400);
          res.end(JSON.stringify({ error: created.error, pin: created.pin }));
          return;
        }
        res.writeHead(201);
        res.end(JSON.stringify(created));
      } catch (e) {
        res.writeHead(400);
        res.end(JSON.stringify({ error: 'Ugyldig forespørgsel' }));
      }
    });
    return;
  }

  res.writeHead(404);
  res.end(JSON.stringify({ error: 'Not found' }));
}

const server = http.createServer((req, res) => {
  setCorsHeaders(res);

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.url && req.url.startsWith('/api/admin/')) {
    handleAdminApi(req, res);
    return;
  }

  if (req.url && (req.url.split('?')[0] === '/api/lobbies' || req.url.startsWith('/api/lobbies?'))) {
    handlePublicLobbyApi(req, res);
    return;
  }

  if (req.url && req.url.startsWith('/api/controller/')) {
    handleControllerApi(req, res);
    return;
  }

  const healthPath = (req.url || '').split('?')[0];
  if (healthPath === '/api/health' && req.method === 'GET') {
    res.setHeader('Content-Type', 'application/json');
    res.writeHead(200);
    res.end(
      JSON.stringify({
        ok: true,
        service: 'bomberman',
        mqtt: process.env.MQTT_ENABLED === '1' || process.env.MQTT_ENABLED === 'true',
      })
    );
    return;
  }

  let rawUrl = req.url || '/';
  const q = rawUrl.indexOf('?');
  if (q !== -1) rawUrl = rawUrl.slice(0, q);
  let filePath = rawUrl === '/' || rawUrl === '' ? '/index.html' : rawUrl;
  filePath = path.join(__dirname, '..', 'public', filePath);

  const ext = path.extname(filePath);
  const contentTypes = {
    '.html': 'text/html',
    '.css': 'text/css',
    '.js': 'application/javascript',
    '.ico': 'image/x-icon',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
    '.svg': 'image/svg+xml',
    '.wav': 'audio/wav',
    '.mp3': 'audio/mpeg',
    '.md': 'text/markdown',
  };

  fs.readFile(filePath, (err, data) => {
    if (err) {
      if (err.code === 'ENOENT') {
        res.writeHead(404);
        res.end('Not found');
      } else {
        res.writeHead(500);
        res.end('Server error');
      }
      return;
    }
    const headers = { 'Content-Type': contentTypes[ext] || 'text/plain' };
    if (ext === '.html') {
      headers['Cache-Control'] = 'no-cache';
    } else if (ext === '.css' || ext === '.js') {
      headers['Cache-Control'] = 'public, max-age=60';
    }
    res.writeHead(200, headers);
    res.end(data);
  });
});

const wss = new WebSocket.Server({
  server,
  verifyClient: () => true,
});

wss.on('connection', (ws) => {
  ws.playerId = null;
  ws.lobbyPin = null;

  ws.on('message', (raw) => {
    try {
      const msg = JSON.parse(raw.toString());

      if (!ws.lobbyPin) {
        if (msg.type === 'join' && msg.pin) {
          const pin = String(msg.pin).trim();
          const lobby = lobbies.get(pin);
          if (!lobby) {
            sendTo(ws, 'error', { message: 'Ugyldig eller ukendt PIN' });
            return;
          }
          const playerId = allocatePlayerId();
          ws.playerId = playerId;
          ws.lobbyPin = pin;
          ws.isSpectator = false;
          const name = msg.name ? String(msg.name).trim().slice(0, 20) : null;
          lobby.game.addPlayer(playerId, name || `Player ${playerIdCounter}`);
          lobby.clients.add(ws);

          sendTo(ws, 'joined', { playerId, pin, state: lobby.game.getState() });
          broadcastToLobby(pin, { type: 'state', data: lobby.game.getState() });
        } else if (msg.type === 'spectate' && msg.pin) {
          const pin = String(msg.pin).trim();
          const lobby = lobbies.get(pin);
          if (!lobby) {
            sendTo(ws, 'error', { message: 'Ugyldig eller ukendt PIN' });
            return;
          }
          ws.playerId = null;
          ws.lobbyPin = pin;
          ws.isSpectator = true;
          if (!lobby.spectators) lobby.spectators = new Set();
          lobby.spectators.add(ws);

          sendTo(ws, 'spectating', { pin, state: lobby.game.getState() });
        }
        return;
      }

      const pin = ws.lobbyPin;
      const lobby = lobbies.get(pin);
      if (!lobby) return;
      const game = lobby.game;

      switch (msg.type) {
        case 'input':
          if (msg.data) handleInput(pin, ws.playerId, msg.data);
          break;
        case 'ready':
          if (ws.playerId && game.gameState === 'waiting') {
            const ready = typeof msg.ready === 'boolean' ? msg.ready : undefined;
            if (ready === undefined) game.togglePlayerReady(ws.playerId);
            else game.setPlayerReady(ws.playerId, ready);
            broadcastToLobby(pin, { type: 'state', data: game.getState() });
          }
          break;
        case 'start':
          if (game.gameState === 'waiting' && game.canStart()) {
            game.startGame();
            broadcastToLobby(pin, { type: 'state', data: game.getState() });
          }
          break;
        case 'reset':
          if (game.gameState === 'ended' || game.gameState === 'waiting') {
            game.reset();
            broadcastToLobby(pin, { type: 'state', data: game.getState() });
          }
          break;
        default:
          break;
      }
    } catch (e) {
      // Ignorer
    }
  });

  ws.on('close', () => {
    if (ws.lobbyPin) {
      const lobby = lobbies.get(ws.lobbyPin);
      if (lobby) {
        if (ws.isSpectator) {
          lobby.spectators?.delete(ws);
        } else {
          lobby.clients.delete(ws);
          if (ws.playerId) lobby.game.removePlayer(ws.playerId);
          broadcastToLobby(ws.lobbyPin, { type: 'state', data: lobby.game.getState() });
          const hasControllers = lobby.controllerPlayers && lobby.controllerPlayers.size > 0;
          if (
            lobby.clients.size === 0 &&
            (!lobby.spectators || lobby.spectators.size === 0) &&
            !hasControllers
          ) {
            if (lobby.game.tickInterval) clearInterval(lobby.game.tickInterval);
            lobbies.delete(ws.lobbyPin);
          }
        }
      }
    }
  });

  ws.on('error', () => {
    if (ws.lobbyPin) {
      const lobby = lobbies.get(ws.lobbyPin);
      if (lobby) {
        if (ws.isSpectator) lobby.spectators?.delete(ws);
        else {
          lobby.clients.delete(ws);
          if (ws.playerId) lobby.game.removePlayer(ws.playerId);
          broadcastToLobby(ws.lobbyPin, { type: 'state', data: lobby.game.getState() });
        }
      }
    }
  });
});

setInterval(() => {
  for (const [pin, lobby] of lobbies) {
    const hasClients = lobby.clients.size > 0 || (lobby.spectators && lobby.spectators.size > 0);
    const isActive = lobby.game.gameState === 'playing' || lobby.game.gameState === 'ended';
    if (hasClients && isActive) {
      broadcastToLobby(pin, { type: 'state', data: lobby.game.getState() });
    }
  }
}, 50);

// Fjern tomme waiting-lobbies efter 15 min (elever der opretter uden at joine)
setInterval(() => {
  const maxAge = 15 * 60 * 1000;
  const now = Date.now();
  for (const [pin, lobby] of lobbies) {
    if (lobby.game.gameState !== 'waiting') continue;
    const empty =
      lobby.clients.size === 0 &&
      (!lobby.spectators || lobby.spectators.size === 0) &&
      (!lobby.controllerPlayers || lobby.controllerPlayers.size === 0);
    if (empty && now - lobby.createdAt > maxAge) {
      lobbies.delete(pin);
    }
  }
}, 60000);

startMqttBridge(controller);

server.listen(PORT, () => {
  console.log(`Bomberman server: http://localhost:${PORT}`);
  console.log(`Admin: http://localhost:${PORT}/admin.html`);
  console.log(`Spectator: http://localhost:${PORT}/spectate.html`);
});
