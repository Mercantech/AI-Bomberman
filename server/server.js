/**
 * Bomberman WebSocket Server
 * Multi-lobby system med PIN, admin API
 */

const WebSocket = require('ws');
const http = require('http');
const path = require('path');
const fs = require('fs');
const { URL } = require('url');

const { BombermanGame } = require('./game');

const PORT = process.env.PORT || 8080;

// Lobbies: PIN -> { game, clients: Set<ws>, createdAt }
const lobbies = new Map();

// Klienter uden lobby (venter på join)
const pendingClients = new Map();

let playerIdCounter = 0;

function generatePin() {
  return String(Math.floor(1000 + Math.random() * 9000));
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
  lobby.clients.forEach(ws => { if (ws.readyState === WebSocket.OPEN) ws.send(msg); });
  if (lobby.spectators) lobby.spectators.forEach(ws => { if (ws.readyState === WebSocket.OPEN) ws.send(msg); });
}

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
  lobby.clients.forEach(ws => { sendTo(ws, 'lobbyEnded', { pin }); });
  if (lobby.spectators) lobby.spectators.forEach(ws => { sendTo(ws, 'lobbyEnded', { pin }); });
  lobbies.delete(pin);
  return true;
}

// Admin API
function handleAdminApi(req, res) {
  const parsed = new URL(req.url, `http://localhost:${PORT}`);
  const path = parsed.pathname;

  res.setHeader('Content-Type', 'application/json');

  if (path === '/api/admin/lobbies' && req.method === 'GET') {
    res.writeHead(200);
    res.end(JSON.stringify({ lobbies: getLobbyList() }));
    return;
  }

  if (path === '/api/admin/lobbies' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const { pin: reqPin, gridSize = 13 } = JSON.parse(body || '{}');
        const pin = reqPin ? String(reqPin).slice(0, 8) : generatePin();
        if (lobbies.has(pin)) {
          res.writeHead(409);
          res.end(JSON.stringify({ error: 'PIN eksisterer allerede', pin }));
          return;
        }
        const game = new BombermanGame(gridSize);
        lobbies.set(pin, {
          game,
          clients: new Set(),
          spectators: new Set(),
          controllerPlayers: new Map(), // playerId -> { name }
          createdAt: Date.now(),
        });
        res.writeHead(201);
        res.end(JSON.stringify({ pin, gridSize }));
      } catch (e) {
        res.writeHead(400);
        res.end(JSON.stringify({ error: 'Ugyldig forespørgsel' }));
      }
    });
    return;
  }

  const endMatch = path.match(/^\/api\/admin\/lobbies\/([^/]+)\/end$/);
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
  const path = parsed.pathname;
  res.setHeader('Content-Type', 'application/json');

  if (path === '/api/controller/join' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const { pin, name } = JSON.parse(body || '{}');
        const pinStr = String(pin || '').trim();
        const lobby = lobbies.get(pinStr);
        if (!lobby) {
          res.writeHead(404);
          res.end(JSON.stringify({ error: 'Ugyldig eller ukendt PIN' }));
          return;
        }
        const playerId = `player_${++playerIdCounter}`;
        const displayName = name ? String(name).trim().slice(0, 20) : `Arduino ${playerIdCounter}`;
        lobby.game.addPlayer(playerId, displayName);
        if (!lobby.controllerPlayers) lobby.controllerPlayers = new Map();
        lobby.controllerPlayers.set(playerId, { name: displayName });
        broadcastToLobby(pinStr, { type: 'state', data: lobby.game.getState() });
        res.writeHead(200);
        res.end(JSON.stringify({ ok: true, playerId, name: displayName }));
      } catch (e) {
        res.writeHead(400);
        res.end(JSON.stringify({ error: 'Ugyldig forespørgsel' }));
      }
    });
    return;
  }

  if (path === '/api/controller/input' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const { pin, playerId, action, direction } = JSON.parse(body || '{}');
        const pinStr = String(pin || '').trim();
        const lobby = lobbies.get(pinStr);
        if (!lobby) {
          res.writeHead(404);
          res.end(JSON.stringify({ error: 'Lobby ikke fundet' }));
          return;
        }
        if (!lobby.controllerPlayers?.has(playerId)) {
          res.writeHead(403);
          res.end(JSON.stringify({ error: 'Ugyldig controller' }));
          return;
        }
        const data = action === 'move' ? { action: 'move', direction } : { action: 'bomb' };
        handleInput(pinStr, playerId, data);
        res.writeHead(200);
        res.end(JSON.stringify({ ok: true }));
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

// CORS headers til alle requests
function setCorsHeaders(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

// HTTP server - admin API først, derefter statiske filer
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

  if (req.url && req.url.startsWith('/api/controller/')) {
    handleControllerApi(req, res);
    return;
  }

  let filePath = req.url === '/' ? '/index.html' : req.url;
  filePath = path.join(__dirname, '..', 'public', filePath.split('?')[0]);

  const ext = path.extname(filePath);
  const contentTypes = {
    '.html': 'text/html',
    '.css': 'text/css',
    '.js': 'application/javascript',
    '.ico': 'image/x-icon',
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
    res.writeHead(200, { 'Content-Type': contentTypes[ext] || 'text/plain' });
    res.end(data);
  });
});

// WebSocket server med CORS (tillader alle origins)
const wss = new WebSocket.Server({ 
  server,
  verifyClient: (info) => {
    // Tillad alle origins for WebSocket
    return true;
  }
});

wss.on('connection', (ws) => {
  ws.playerId = null;
  ws.lobbyPin = null;

  ws.on('message', (raw) => {
    try {
      const msg = JSON.parse(raw.toString());

      if (!ws.lobbyPin) {
        // Klient skal først sende join med PIN
        if (msg.type === 'join' && msg.pin) {
          const pin = String(msg.pin).trim();
          const lobby = lobbies.get(pin);
          if (!lobby) {
            sendTo(ws, 'error', { message: 'Ugyldig eller ukendt PIN' });
            return;
          }
          const playerId = `player_${++playerIdCounter}`;
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
        case 'start':
          if (game.gameState === 'waiting') {
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
          if (lobby.clients.size === 0 && (!lobby.spectators || lobby.spectators.size === 0)) {
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

function handleInput(pin, playerId, input) {
  const lobby = lobbies.get(pin);
  if (!lobby) return;
  const game = lobby.game;
  if (game.gameState !== 'playing') return;

  switch (input.action) {
    case 'move':
      if (game.movePlayer(playerId, input.direction)) {
        broadcastToLobby(pin, { type: 'state', data: game.getState() });
      }
      break;
    case 'bomb':
      if (game.placeBomb(playerId)) {
        broadcastToLobby(pin, { type: 'state', data: game.getState() });
      }
      break;
    default:
      break;
  }
}

// Broadcast state til aktive spil (inkl. ended, så klienter får slut-tilstanden)
setInterval(() => {
  for (const [pin, lobby] of lobbies) {
    const hasClients = lobby.clients.size > 0 || (lobby.spectators && lobby.spectators.size > 0);
    const isActive = lobby.game.gameState === 'playing' || lobby.game.gameState === 'ended';
    if (hasClients && isActive) {
      broadcastToLobby(pin, { type: 'state', data: lobby.game.getState() });
    }
  }
}, 50);

server.listen(PORT, () => {
  console.log(`Bomberman server: http://localhost:${PORT}`);
  console.log(`Admin: http://localhost:${PORT}/admin.html`);
  console.log(`Spectator: http://localhost:${PORT}/spectate.html`);
});
