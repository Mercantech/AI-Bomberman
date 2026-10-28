const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const path = require('node:path');
const { before, after, test } = require('node:test');
const WebSocket = require('ws');
const { BombermanGame, CELL } = require('../game');

const DIRECTIONS = [
  ['UP', 0, -1], ['DOWN', 0, 1], ['LEFT', -1, 0], ['RIGHT', 1, 0],
];

function gameFor(t, mode = 'arena', size = 13) {
  const game = new BombermanGame(size, mode);
  t.after(() => { if (game.tickInterval) clearInterval(game.tickInterval); });
  return game;
}

function fill(game, count = game.maxPlayers) {
  return Array.from({ length: count }, (_, i) => {
    const player = game.addPlayer(`p${i + 1}`, `Spiller ${i + 1}`);
    assert(player, `player ${i + 1} can join`);
    return player;
  });
}

function identity(player) {
  return { number: player.number, color: player.color, symbol: player.symbol };
}

function positions(players) {
  return players.map(p => `${p.x},${p.y}`);
}

// Find an actual walkable escape without walking through another starting player.
function escapePath(game, player) {
  const occupied = new Set(positions([...game.players.values()].filter(p => p.id !== player.id)));
  const queue = [{ x: player.x, y: player.y, path: [] }];
  const seen = new Set([`${player.x},${player.y}`]);
  for (let i = 0; i < queue.length; i++) {
    const current = queue[i];
    const dx = Math.abs(current.x - player.x);
    const dy = Math.abs(current.y - player.y);
    const inInitialBlast = (dx === 0 && dy <= 2) || (dy === 0 && dx <= 2);
    if (!inInitialBlast) return current.path;
    for (const [direction, mx, my] of DIRECTIONS) {
      const x = current.x + mx;
      const y = current.y + my;
      const key = `${x},${y}`;
      if (seen.has(key) || occupied.has(key) || game.grid[y]?.[x] !== CELL.EMPTY) continue;
      seen.add(key);
      queue.push({ x, y, path: [...current.path, direction] });
    }
  }
  return null;
}

test('classic keeps four players and the existing board sizes', (t) => {
  for (const size of [9, 13, 17, 21]) {
    const game = gameFor(t, 'classic', size);
    assert.equal(game.mode, 'classic');
    assert.equal(game.gridSize, size);
    assert.equal(game.maxPlayers, 4);
    const players = fill(game);
    assert.equal(new Set(positions(players)).size, 4);
    assert.deepEqual(players.map(p => p.number), [1, 2, 3, 4]);
    assert.equal(game.addPlayer('overflow'), null);
  }
  const defaultGame = new BombermanGame();
  assert.equal(defaultGame.mode, 'classic');
  assert.equal(defaultGame.gridSize, 13);
  assert.equal(defaultGame.maxPlayers, 4);
});

test('arena supplies 24 distinct identities and spawn locations on a fixed 31 by 31 board', (t) => {
  const game = gameFor(t, 'arena', 9);
  assert.equal(game.mode, 'arena');
  assert.equal(game.gridSize, 31);
  assert.equal(game.maxPlayers, 24);
  const players = fill(game);
  assert.equal(new Set(positions(players)).size, 24);
  assert.deepEqual(players.map(p => p.number), Array.from({ length: 24 }, (_, i) => i + 1));
  for (const player of players) {
    assert.match(player.color, /^#[0-9a-f]{6}$/i);
    assert.equal(typeof player.symbol, 'string');
    assert(player.symbol.length > 0);
    assert.equal(game.grid[player.y][player.x], CELL.EMPTY);
  }
  assert.equal(game.addPlayer('overflow'), null);
  assert.equal(game.players.size, 24);
  const state = game.getState();
  assert.equal(state.maxPlayers, 24);
  assert.equal(state.mode, 'arena');
  assert.deepEqual(state.players.map(identity), players.map(identity));
});

test('all 24 spawns have a short escape from an initial bomb even with maximum brick density', (t) => {
  t.mock.method(Math, 'random', () => 0);
  const game = gameFor(t);
  const players = fill(game);
  for (const player of players) {
    const route = escapePath(game, player);
    assert(route, `player ${player.number} can escape without another player moving`);
    assert(route.length <= 6, `player ${player.number} can escape before the two-second fuse`);
    for (const other of players) {
      if (other === player) continue;
      const distance = Math.abs(player.x - other.x) + Math.abs(player.y - other.y);
      assert(distance >= 4, 'starting players have separation');
    }
  }
  // Bricks can be destroyed; solid geometry must not isolate any spawn permanently.
  const seen = new Set([positions(players)[0]]);
  const queue = [[players[0].x, players[0].y]];
  for (let i = 0; i < queue.length; i++) {
    const [x, y] = queue[i];
    for (const [, dx, dy] of DIRECTIONS) {
      const nx = x + dx, ny = y + dy;
      const key = `${nx},${ny}`;
      if (seen.has(key) || ![CELL.EMPTY, CELL.BRICK].includes(game.grid[ny]?.[nx])) continue;
      seen.add(key); queue.push([nx, ny]);
    }
  }
  for (const position of positions(players)) assert(seen.has(position), `reachable spawn ${position}`);
});

test('numbers, colors and symbols survive departures, slot reuse, start and reset', (t) => {
  const game = gameFor(t);
  const players = fill(game);
  const saved = new Map(players.map(p => [p.id, identity(p)]));
  game.removePlayer('p3');
  game.removePlayer('p19');
  const replacementA = game.addPlayer('replacement-a', 'Ny spiller');
  const replacementB = game.addPlayer('replacement-b', 'Ny spiller');
  assert.equal(replacementA.number, 3);
  assert.equal(replacementB.number, 19);
  assert.equal(game.startGame(), true);
  assert.equal(new Set(positions([...game.players.values()])).size, 24);
  for (const p of game.players.values()) {
    if (saved.has(p.id)) assert.deepEqual(identity(p), saved.get(p.id));
  }
  game.reset();
  assert.equal(game.gameState, 'waiting');
  assert.equal(game.tickInterval, null);
  assert.equal(new Set(positions([...game.players.values()])).size, 24);
  assert.equal(new Set([...game.players.values()].map(p => p.number)).size, 24);
  for (const p of game.players.values()) {
    assert.equal(p.alive, true);
    if (saved.has(p.id)) assert.deepEqual(identity(p), saved.get(p.id));
  }
});

test('player 24 can move, bomb, escape, win and play again', (t) => {
  t.mock.method(Math, 'random', () => 0);
  const game = gameFor(t);
  fill(game);
  assert.equal(game.startGame(), true);
  const player = game.players.get('p24');
  const savedIdentity = identity(player);
  const route = escapePath(game, player);
  const bombPosition = { x: player.x, y: player.y };
  assert(game.placeBomb(player.id));
  assert.equal(player.bombs, 0);
  for (const direction of route) {
    player.lastMove = 0;
    assert(game.movePlayer(player.id, direction));
  }
  assert.equal(game.bombs[0].x, bombPosition.x);
  assert.equal(game.bombs[0].y, bombPosition.y);
  game.bombs[0].timer = 0;
  game.tick();
  assert.equal(player.alive, true);
  assert.equal(player.bombs, 1);
  assert.equal(game.bombs.length, 0);
  for (const other of game.players.values()) if (other.id !== player.id) other.alive = false;
  game.tick();
  assert.equal(game.gameState, 'ended');
  assert.equal(game.winnerId, player.id);
  game.reset();
  assert.deepEqual(identity(game.players.get('p24')), savedIdentity);
  assert.equal(game.getState().players.filter(p => p.alive).length, 24);
  assert.equal(game.explosions.length, 0);
  assert.equal(game.startGame(), true);
});

let server;
let baseUrl;
before(async () => {
  server = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
    env: { ...process.env, PORT: '0', MQTT_ENABLED: '0' },
    stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
  });
  baseUrl = await new Promise((resolve, reject) => {
    let output = '';
    const timer = setTimeout(() => reject(new Error(`Server did not start: ${output}`)), 15000);
    server.once('error', error => { clearTimeout(timer); reject(error); });
    server.once('exit', code => { clearTimeout(timer); reject(new Error(`Server exited: ${code}; ${output}`)); });
    server.stdout.on('data', chunk => {
      output += chunk;
      const match = output.match(/Bomberman server: http:\/\/localhost:(\d+)/);
      if (match) { clearTimeout(timer); resolve(`http://127.0.0.1:${match[1]}`); }
    });
    server.stderr.on('data', chunk => { output += chunk; });
  });
});
after(async () => {
  if (server && server.exitCode === null) {
    const exited = once(server, 'exit'); server.kill(); await exited;
  }
});

async function api(route, body, method = 'POST') {
  const response = await fetch(`${baseUrl}${route}`, {
    method,
    ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
  });
  return { status: response.status, data: await response.json() };
}

async function lobby(t, body = { mode: 'arena' }, route = '/api/lobbies') {
  const response = await api(route, body);
  assert.equal(response.status, 201);
  t.after(() => api(`/api/admin/lobbies/${response.data.pin}/end`, {}));
  return response.data;
}

async function client(t) {
  const ws = new WebSocket(baseUrl.replace('http:', 'ws:'));
  const messages = [];
  const listeners = new Set();
  let sequence = 0;
  ws.on('message', raw => {
    const message = { ...JSON.parse(raw), sequence: ++sequence };
    messages.push(message);
    if (messages.length > 200) messages.shift();
    for (const listener of [...listeners]) listener(message);
  });
  await once(ws, 'open');
  t.after(() => ws.terminate());
  const result = {
    ws,
    get sequence() { return sequence; },
    wait(type, predicate = () => true, afterSequence = sequence) {
      const matches = m => m.sequence > afterSequence && m.type === type && predicate(m.data);
      const existing = messages.find(matches);
      if (existing) return Promise.resolve(existing.data);
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => { listeners.delete(listener); reject(new Error(`Timed out waiting for ${type}`)); }, 7000);
        const listener = message => {
          if (!matches(message)) return;
          clearTimeout(timer); listeners.delete(listener); resolve(message.data);
        };
        listeners.add(listener);
      });
    },
    request(message, type, predicate) {
      const received = result.wait(type, predicate);
      ws.send(JSON.stringify(message));
      return received;
    },
  };
  return result;
}

test('24 HTTP/WebSocket players play together and a spectator starts and resets the match', { timeout: 15000 }, async (t) => {
  const created = await lobby(t, { mode: 'arena', gridSize: 9 });
  const { pin } = created;
  assert.equal(created.mode, 'arena'); assert.equal(created.maxPlayers, 24); assert.equal(created.gridSize, 31);
  const observer = await client(t);
  const spectating = await observer.request({ type: 'spectate', pin }, 'spectating');
  assert.equal(spectating.state.players.length, 0);
  const controllers = [];
  for (let i = 1; i <= 23; i++) {
    const joined = await api('/api/controller/join', { pin, name: `Arduino ${i}`, deviceId: `opla-${i}` });
    assert.equal(joined.status, 200); controllers.push(joined.data);
  }
  const keyboard = await client(t);
  const joined = await keyboard.request({ type: 'join', pin, name: 'Keyboard 24' }, 'joined');
  assert.equal(joined.state.players.length, 24);
  assert.equal(joined.state.players.find(p => p.id === joined.playerId).number, 24);
  const ids = joined.state.players.map(p => p.id);
  const identities = joined.state.players.map(identity);
  const fullHttp = await api('/api/controller/join', { pin, deviceId: 'overflow' });
  assert.equal(fullHttp.status, 409); assert.match(fullHttp.data.error, /24/);
  const extraBrowser = await client(t);
  const fullWs = await extraBrowser.request({ type: 'join', pin }, 'error');
  assert.match(fullWs.message, /24/);
  const reconnect = await api('/api/controller/join', { pin, deviceId: 'opla-1' });
  assert.equal(reconnect.status, 200); assert.equal(reconnect.data.playerId, controllers[0].playerId);
  const listing = await api('/api/lobbies', undefined, 'GET');
  const listed = listing.data.lobbies.find(l => l.pin === pin);
  assert.equal(listed.playerCount, 24); assert.equal(listed.maxPlayers, 24); assert.equal(listed.mode, 'arena');
  assert.equal(listed.spectatorCount, 1);
  const started = await observer.request({ type: 'start' }, 'state', s => s.gameState === 'playing');
  assert.deepEqual(started.players.map(p => p.id), ids);
  assert.equal(new Set(positions(started.players)).size, 24);
  assert.deepEqual(started.players.map(identity), identities);
  // Every controller drops a real bomb; the 24th (browser) player survives at its own safe spawn.
  const endSequence = observer.sequence;
  for (const controller of controllers) {
    const result = await api('/api/controller/action', { pin, playerId: controller.playerId, action: 'bomb' });
    assert.equal(result.status, 200);
  }
  const ended = await observer.wait('state', s => s.gameState === 'ended', endSequence);
  assert.equal(ended.winnerId, joined.playerId);
  assert.equal(ended.players.filter(p => p.alive).length, 1);
  const reset = await observer.request({ type: 'reset' }, 'state', s => s.gameState === 'waiting');
  assert.equal(reset.players.length, 24); assert.equal(reset.players.filter(p => p.alive).length, 24);
  assert.deepEqual(reset.players.map(identity), identities);
  assert.equal(new Set(positions(reset.players)).size, 24);
  assert.equal(reset.bombs.length, 0);
});

test('new arena players wait until the next round, but existing controllers can reconnect', async (t) => {
  const { pin } = await lobby(t);
  const observer = await client(t);
  await observer.request({ type: 'spectate', pin }, 'spectating');
  const first = await api('/api/controller/join', { pin, deviceId: 'known-device' });
  await api('/api/controller/join', { pin, deviceId: 'other-device' });
  await observer.request({ type: 'start' }, 'state', s => s.gameState === 'playing');
  const rejected = await api('/api/controller/join', { pin, deviceId: 'new-device' });
  assert.equal(rejected.status, 409);
  const newcomer = await client(t);
  await newcomer.request({ type: 'join', pin }, 'error');
  const returning = await api('/api/controller/join', { pin, deviceId: 'known-device' });
  assert.equal(returning.status, 200); assert.equal(returning.data.playerId, first.data.playerId);
  const anotherObserver = await client(t);
  const watched = await anotherObserver.request({ type: 'spectate', pin }, 'spectating');
  assert.equal(watched.state.players.length, 2);
  assert.equal(watched.state.gameState, 'playing');
});

test('an idle arena broadcasts controller movement even when there are no bombs or explosions', async (t) => {
  const { pin } = await lobby(t);
  const observer = await client(t);
  await observer.request({ type: 'spectate', pin }, 'spectating');
  const first = await api('/api/controller/join', { pin, deviceId: 'moving-device' });
  await api('/api/controller/join', { pin, deviceId: 'idle-device' });
  await observer.request({ type: 'start' }, 'state', s => s.gameState === 'playing');
  // Let the publisher consume start's forced update before exercising movement.
  const baseline = await observer.wait('state', s => s.gameState === 'playing');
  assert.equal(baseline.bombs.length, 0);
  assert.equal(baseline.explosions.length, 0);
  const player = baseline.players.find(p => p.id === first.data.playerId);
  const direction = DIRECTIONS.find(([, dx, dy]) => {
    const x = player.x + dx, y = player.y + dy;
    return baseline.grid[y]?.[x] === CELL.EMPTY && !baseline.players.some(p => p.x === x && p.y === y);
  });
  assert(direction, 'there is a free starting step');
  const [name, dx, dy] = direction;
  const before = observer.sequence;
  const action = await api('/api/controller/action', {
    pin, playerId: player.id, action: 'move', direction: name,
  });
  assert.equal(action.status, 200);
  const updated = await observer.wait('state', state => {
    const moved = state.players.find(p => p.id === player.id);
    return moved.x === player.x + dx && moved.y === player.y + dy;
  }, before);
  assert.equal(updated.bombs.length, 0);
  assert.equal(updated.explosions.length, 0);
});

test('admin creates both modes and classic HTTP/WebSocket capacity remains four', async (t) => {
  const arena = await lobby(t, { mode: 'arena', gridSize: 13, pin: 'arena24' }, '/api/admin/lobbies');
  assert.equal(arena.mode, 'arena'); assert.equal(arena.maxPlayers, 24); assert.equal(arena.gridSize, 31);
  const classic = await lobby(t, { gridSize: 17, pin: 'classic4' }, '/api/admin/lobbies');
  assert.equal(classic.mode, 'classic'); assert.equal(classic.maxPlayers, 4); assert.equal(classic.gridSize, 17);
  for (let i = 0; i < 4; i++) assert.equal((await api('/api/controller/join', { pin: classic.pin, deviceId: `classic-${i}` })).status, 200);
  const full = await api('/api/controller/join', { pin: classic.pin, deviceId: 'classic-overflow' });
  assert.equal(full.status, 409); assert.match(full.data.error, /4/);
  const extraBrowser = await client(t);
  assert.match((await extraBrowser.request({ type: 'join', pin: classic.pin }, 'error')).message, /4/);
  const adminList = await api('/api/admin/lobbies', undefined, 'GET');
  assert.equal(adminList.data.lobbies.find(l => l.pin === arena.pin).maxPlayers, 24);
  assert.equal(adminList.data.lobbies.find(l => l.pin === classic.pin).maxPlayers, 4);
});
