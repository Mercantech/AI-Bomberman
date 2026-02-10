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
const tournamentModule = require('./tournament');

const PORT = process.env.PORT || 8080;

// Lobbies: PIN -> { game, clients: Set<ws>, spectators, createdAt, tournamentId?, tournamentMatchId?, participantNames? }
const lobbies = new Map();
// Tournaments: id -> tournament state; joinCode -> id (for lookup by code)
const tournaments = new Map();
const tournamentByCode = new Map();

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
    playerCount: lobby.clients.size,
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

// Tournament API
function handleTournamentApi(req, res) {
  const parsed = new URL(req.url, `http://localhost:${PORT}`);
  const pathname = parsed.pathname;
  res.setHeader('Content-Type', 'application/json');

  if (pathname === '/api/tournament' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const { mode = 'sequential', maxParticipants = 28 } = JSON.parse(body || '{}');
        const tournament = tournamentModule.createTournamentLobby(mode, maxParticipants);
        tournaments.set(tournament.id, tournament);
        tournamentByCode.set(tournament.joinCode.toUpperCase(), tournament.id);
        res.writeHead(201);
        res.end(JSON.stringify({ tournament }));
      } catch (e) {
        res.writeHead(400);
        res.end(JSON.stringify({ error: 'Ugyldig forespørgsel' }));
      }
    });
    return;
  }

  const byCodeMatch = pathname.match(/^\/api\/tournament\/by-code\/([^/]+)$/);
  if (byCodeMatch && req.method === 'GET') {
    const code = (byCodeMatch[1] || '').toUpperCase();
    const tId = tournamentByCode.get(code) || tournaments.get(code);
    const t = tId ? tournaments.get(tId) : null;
    if (!t) {
      res.writeHead(404);
      res.end(JSON.stringify({ error: 'Turnering ikke fundet' }));
      return;
    }
    const standings = tournamentModule.getStandings(t);
    const nextMatches = t.rounds ? tournamentModule.getNextMatches(t) : [];
    res.writeHead(200);
    res.end(JSON.stringify({ tournament: t, standings, nextMatches }));
    return;
  }

  const getMatch = pathname.match(/^\/api\/tournament\/([^/]+)$/);
  if (getMatch && req.method === 'GET') {
    const idOrCode = getMatch[1];
    const codeId = tournamentByCode.get(idOrCode.toUpperCase());
    const t = codeId ? tournaments.get(codeId) : tournaments.get(idOrCode);
    if (!t) {
      res.writeHead(404);
      res.end(JSON.stringify({ error: 'Turnering ikke fundet' }));
      return;
    }
    const standings = tournamentModule.getStandings(t);
    const nextMatches = t.rounds ? tournamentModule.getNextMatches(t) : [];
    res.writeHead(200);
    res.end(JSON.stringify({ tournament: t, standings, nextMatches }));
    return;
  }

  const joinMatch = pathname.match(/^\/api\/tournament\/([^/]+)\/join$/);
  if (joinMatch && req.method === 'POST') {
    const codeId = tournamentByCode.get((joinMatch[1] || '').toUpperCase());
    const t = codeId ? tournaments.get(codeId) : tournaments.get(joinMatch[1]);
    if (!t) {
      res.writeHead(404);
      res.end(JSON.stringify({ error: 'Turnering ikke fundet' }));
      return;
    }
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const { name } = JSON.parse(body || '{}');
        const result = tournamentModule.addParticipant(t, name);
        if (!result.ok) {
          res.writeHead(400);
          res.end(JSON.stringify({ error: result.error }));
          return;
        }
        res.writeHead(200);
        res.end(JSON.stringify({ tournament: t }));
      } catch (e) {
        res.writeHead(400);
        res.end(JSON.stringify({ error: 'Ugyldig forespørgsel' }));
      }
    });
    return;
  }

  const startMatch = pathname.match(/^\/api\/tournament\/([^/]+)\/start$/);
  if (startMatch && req.method === 'POST') {
    const codeId = tournamentByCode.get((startMatch[1] || '').toUpperCase());
    const t = codeId ? tournaments.get(codeId) : tournaments.get(startMatch[1]);
    if (!t) {
      res.writeHead(404);
      res.end(JSON.stringify({ error: 'Turnering ikke fundet' }));
      return;
    }
    const result = tournamentModule.startTournament(t);
    if (!result.ok) {
      res.writeHead(400);
      res.end(JSON.stringify({ error: result.error }));
      return;
    }
    const standings = tournamentModule.getStandings(t);
    const nextMatches = tournamentModule.getNextMatches(t);
    res.writeHead(200);
    res.end(JSON.stringify({ tournament: t, standings, nextMatches }));
    return;
  }

  const startMatchMatch = pathname.match(/^\/api\/tournament\/([^/]+)\/match\/start$/);
  if (startMatchMatch && req.method === 'POST') {
    const tId = startMatchMatch[1];
    const t = tournaments.get(tId);
    if (!t) {
      res.writeHead(404);
      res.end(JSON.stringify({ error: 'Turnering ikke fundet' }));
      return;
    }
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const { matchId } = JSON.parse(body || '{}');
        const next = tournamentModule.getNextMatches(t);
        const match = next.find(m => m.id === matchId) || (matchId ? t.rounds[t.currentRoundIndex].matches.find(m => m.id === matchId) : next[0]);
        if (!match || match.status !== 'pending') {
          res.writeHead(400);
          res.end(JSON.stringify({ error: 'Kamp kan ikke startes' }));
          return;
        }
        const pin = generatePin();
        if (lobbies.has(pin)) {
          res.writeHead(409);
          res.end(JSON.stringify({ error: 'Prøv igen' }));
          return;
        }
        const game = new BombermanGame(13);
        lobbies.set(pin, {
          game,
          clients: new Set(),
          spectators: new Set(),
          createdAt: Date.now(),
          tournamentId: tId,
          tournamentMatchId: match.id,
          participantNames: [match.player1, match.player2],
          playerIdToName: {},
        });
        match.lobbyPin = pin;
        match.status = 'live';
        res.writeHead(200);
        res.end(JSON.stringify({ pin, matchId: match.id }));
      } catch (e) {
        res.writeHead(400);
        res.end(JSON.stringify({ error: 'Fejl' }));
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
  if (req.url && req.url.startsWith('/api/tournament')) {
    handleTournamentApi(req, res);
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
          if (lobby.participantNames && lobby.playerIdToName) {
            const joinIndex = lobby.clients.size - 1;
            const assignedName = lobby.participantNames[Math.min(joinIndex, lobby.participantNames.length - 1)];
            lobby.playerIdToName[playerId] = assignedName;
          }

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

// Broadcast state + tournament-afslutning ved game end
setInterval(() => {
  for (const [pin, lobby] of lobbies) {
    const hasClients = lobby.clients.size > 0 || (lobby.spectators && lobby.spectators.size > 0);
    const isActive = lobby.game.gameState === 'playing' || lobby.game.gameState === 'ended';
    if (hasClients && isActive) {
      broadcastToLobby(pin, { type: 'state', data: lobby.game.getState() });
    }
    if (lobby.game.gameState === 'ended' && lobby.tournamentMatchId && lobby.tournamentId) {
      const t = tournaments.get(lobby.tournamentId);
      const winnerId = lobby.game.winnerId;
      const winnerName = (lobby.playerIdToName && winnerId && lobby.playerIdToName[winnerId]) || winnerId;
      if (t && winnerName) {
        tournamentModule.advanceWinner(t, lobby.tournamentMatchId, winnerName);
      }
      lobby.tournamentMatchId = null;
      lobby.tournamentId = null;
    }
  }
}, 50);

server.listen(PORT, () => {
  console.log(`Bomberman server: http://localhost:${PORT}`);
  console.log(`Admin: http://localhost:${PORT}/admin.html`);
  console.log(`Spectator: http://localhost:${PORT}/spectate.html`);
  console.log(`Turnering: http://localhost:${PORT}/tournament.html`);
});
