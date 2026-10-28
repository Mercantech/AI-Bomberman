/**
 * Klassisk Bomberman spil-logik
 * Grid-baseret, bomber eksploderer i kors-mønster
 */

const DEFAULT_GRID_SIZE = 13;
const MIN_GRID_SIZE = 9;
const MAX_GRID_SIZE = 21;
const MAX_PLAYERS = 4;
const ARENA_GRID_SIZE = 31;
const ARENA_MAX_PLAYERS = 24;
const PLAYER_COLORS = ['#e74c3c', '#3498db', '#2ecc71', '#f39c12', '#9b59b6', '#1abc9c', '#ec5bad', '#d5e03e'];
const PLAYER_SYMBOLS = ['circle', 'diamond', 'triangle'];
const TICK_RATE = 100; // ms
const BRICK_DENSITY = 0.58;

// Cell types
const CELL = {
  EMPTY: 0,
  SOLID: 1,    // Udestruerbar væg
  BRICK: 2,    // Destruerbar kasse
};

// Power-up types
const POWERUP = {
  NONE: 0,
  BOMB: 1,     // +1 bombe
  FLAME: 2,    // +1 eksplosionsradius
  SPEED: 3,    // Hurtigere bevægelse
};

// Movement directions
const DIR = {
  UP: [0, -1],
  DOWN: [0, 1],
  LEFT: [-1, 0],
  RIGHT: [1, 0],
};

function normalizeDirection(dir) {
  if (!dir) return null;
  const key = String(dir).toUpperCase();
  return DIR[key] ? key : null;
}

function weightedPowerupType() {
  // FLAME 40%, BOMB 35%, SPEED 25%
  const r = Math.random();
  if (r < 0.4) return POWERUP.FLAME;
  if (r < 0.75) return POWERUP.BOMB;
  return POWERUP.SPEED;
}

class BombermanGame {
  constructor(gridSize = DEFAULT_GRID_SIZE, mode = 'classic') {
    this.mode = mode === 'arena' ? 'arena' : 'classic';
    this.maxPlayers = this.mode === 'arena' ? ARENA_MAX_PLAYERS : MAX_PLAYERS;
    const requestedSize = parseInt(gridSize, 10) || DEFAULT_GRID_SIZE;
    this.gridSize = this.mode === 'arena' ? ARENA_GRID_SIZE
      : Math.min(MAX_GRID_SIZE, Math.max(MIN_GRID_SIZE, requestedSize));
    if (this.gridSize % 2 === 0) this.gridSize++; // Skal være ulige
    this.grid = [];
    this.players = new Map();
    this.bombs = [];
    this.explosions = [];
    this.powerups = [];
    this.gameState = 'waiting'; // waiting, playing, ended
    this.tickInterval = null;
    this.winnerId = null;
    this.theme = 'classic';
    this.hostId = null;
    this.initGrid();
  }

  getCornerSpawns() {
    const gs = this.gridSize;
    return [[1, 1], [gs - 2, 1], [1, gs - 2], [gs - 2, gs - 2]];
  }

  getSpawnPoints() {
    if (this.mode !== 'arena') return this.getCornerSpawns();
    // 24 positions, at least six cells apart; the centre is not a spawn.
    const axis = [1, 7, 15, 23, 29];
    const spawns = this.getCornerSpawns();
    const candidates = axis.flatMap(y => axis.filter(x => x !== 15 || y !== 15).map(x => [x, y]))
      .filter(([x, y]) => !spawns.some(([sx, sy]) => sx === x && sy === y));
    // Spread smaller class matches across the board rather than filling one edge first.
    while (candidates.length) {
      let bestIndex = 0;
      let bestDistance = -1;
      candidates.forEach(([x, y], index) => {
        const distance = Math.min(...spawns.map(([sx, sy]) => Math.abs(sx - x) + Math.abs(sy - y)));
        if (distance > bestDistance) { bestDistance = distance; bestIndex = index; }
      });
      spawns.push(candidates.splice(bestIndex, 1)[0]);
    }
    return spawns;
  }

  getSpawnClearCells() {
    if (this.mode === 'arena') {
      const cells = new Map();
      const add = (x, y) => {
        if (x > 0 && y > 0 && x < this.gridSize - 1 && y < this.gridSize - 1 &&
            !(x % 2 === 0 && y % 2 === 0)) cells.set(`${x},${y}`, [x, y]);
      };
      for (const [x, y] of this.getSpawnPoints()) {
        add(x, y);
        for (const [dx, dy] of Object.values(DIR)) {
          add(x + dx, y + dy);
          add(x + 2 * dx, y + 2 * dy);
          // A turn after two steps lets every player escape their first radius-2 bomb.
          add(x + 2 * dx - dy, y + 2 * dy + dx);
          add(x + 2 * dx + dy, y + 2 * dy - dx);
        }
      }
      return [...cells.values()];
    }
    const gs = this.gridSize;
    return [
      [1, 1], [1, 2], [2, 1], [1, 3], [3, 1],
      [gs - 2, 1], [gs - 3, 1], [gs - 2, 2], [gs - 4, 1], [gs - 2, 3],
      [1, gs - 2], [1, gs - 3], [2, gs - 2], [1, gs - 4], [3, gs - 2],
      [gs - 2, gs - 2], [gs - 3, gs - 2], [gs - 2, gs - 3], [gs - 4, gs - 2], [gs - 2, gs - 4],
    ];
  }

  initGrid() {
    const gs = this.gridSize;
    this.grid = [];
    const spawnCells = new Set(this.getSpawnClearCells().map(([x, y]) => `${x},${y}`));
    for (let y = 0; y < gs; y++) {
      this.grid[y] = [];
      for (let x = 0; x < gs; x++) {
        if (x === 0 || y === 0 || x === gs - 1 || y === gs - 1) {
          this.grid[y][x] = CELL.SOLID;
        } else if (x % 2 === 0 && y % 2 === 0) {
          this.grid[y][x] = CELL.SOLID;
        } else if (spawnCells.has(`${x},${y}`)) {
          this.grid[y][x] = CELL.EMPTY;
        } else {
          this.grid[y][x] = Math.random() < BRICK_DENSITY ? CELL.BRICK : CELL.EMPTY;
        }
      }
    }
    this.clearSpawnCorridors();
    this.ensureSpawnConnectivity();
  }

  isSpawnPoint(x, y) {
    return this.getSpawnClearCells().some(([sx, sy]) => sx === x && sy === y);
  }

  clearSpawnCorridors() {
    for (const [x, y] of this.getSpawnClearCells()) {
      if (
        x > 0 && x < this.gridSize - 1 &&
        y > 0 && y < this.gridSize - 1 &&
        this.grid[y][x] !== CELL.SOLID
      ) {
        this.grid[y][x] = CELL.EMPTY;
      }
    }
  }

  /** Flood-fill through EMPTY + BRICK; carve bricks if spawns cannot reach each other. */
  ensureSpawnConnectivity() {
    const spawns = this.getSpawnPoints();
    const canPass = (x, y) => {
      const c = this.grid[y]?.[x];
      return c === CELL.EMPTY || c === CELL.BRICK;
    };

    const reachableFrom = (sx, sy) => {
      const seen = new Set();
      const q = [[sx, sy]];
      seen.add(`${sx},${sy}`);
      while (q.length) {
        const [x, y] = q.shift();
        for (const [dx, dy] of Object.values(DIR)) {
          const nx = x + dx;
          const ny = y + dy;
          const key = `${nx},${ny}`;
          if (seen.has(key)) continue;
          if (!canPass(nx, ny)) continue;
          seen.add(key);
          q.push([nx, ny]);
        }
      }
      return seen;
    };

    const start = spawns[0];
    let reachable = reachableFrom(start[0], start[1]);

    for (let i = 1; i < spawns.length; i++) {
      const [tx, ty] = spawns[i];
      if (reachable.has(`${tx},${ty}`)) continue;

      // BFS allowing SOLID-blocked paths via clearing BRICK along shortest path
      const parent = new Map();
      const q = [[start[0], start[1]]];
      parent.set(`${start[0]},${start[1]}`, null);
      let found = false;

      while (q.length && !found) {
        const [x, y] = q.shift();
        for (const [dx, dy] of Object.values(DIR)) {
          const nx = x + dx;
          const ny = y + dy;
          const key = `${nx},${ny}`;
          if (parent.has(key)) continue;
          if (nx < 0 || ny < 0 || nx >= this.gridSize || ny >= this.gridSize) continue;
          if (this.grid[ny][nx] === CELL.SOLID) continue;
          parent.set(key, [x, y]);
          if (nx === tx && ny === ty) {
            found = true;
            break;
          }
          q.push([nx, ny]);
        }
      }

      if (found) {
        let cur = [tx, ty];
        while (cur) {
          const [cx, cy] = cur;
          if (this.grid[cy][cx] === CELL.BRICK) this.grid[cy][cx] = CELL.EMPTY;
          const p = parent.get(`${cx},${cy}`);
          cur = p;
        }
      }
      reachable = reachableFrom(start[0], start[1]);
    }
  }

  addPlayer(id, name = 'Player') {
    if (this.players.has(id)) return this.players.get(id);
    if (this.players.size >= this.maxPlayers) return null;
    // Arena participants join between rounds so no one spawns into a live blast.
    if (this.mode === 'arena' && this.gameState === 'playing') return null;
    const spawns = this.getSpawnPoints();
    const usedNumbers = new Set([...this.players.values()].map(p => p.number));
    let number = 1;
    while (usedNumbers.has(number)) number++;
    let spawn = spawns[number - 1];
    if (this.gameState === 'playing') {
      // Preserve Classic's existing ability to join a running match.
      const used = [...this.players.values()].map(p => `${p.x},${p.y}`);
      spawn = spawns.find(([x, y]) => !used.includes(`${x},${y}`)) || spawns[0];
    }
    const isFirst = this.players.size === 0;

    this.players.set(id, {
      id,
      name,
      number,
      symbol: PLAYER_SYMBOLS[Math.floor((number - 1) / PLAYER_COLORS.length)],
      x: spawn[0],
      y: spawn[1],
      bombs: 1,
      maxBombs: 1,
      flameLength: 2,
      speed: 1,
      alive: true,
      kills: 0,
      lastMove: 0,
      color: this.getPlayerColor(number - 1),
      facing: 'DOWN',
      ready: false,
      isController: false,
    });

    if (isFirst || !this.hostId) {
      this.hostId = id;
    }
    return this.players.get(id);
  }

  setPlayerReady(id, ready) {
    const player = this.players.get(id);
    if (!player || this.gameState !== 'waiting') return false;
    player.ready = !!ready;
    return true;
  }

  togglePlayerReady(id) {
    const player = this.players.get(id);
    if (!player || this.gameState !== 'waiting') return false;
    player.ready = !player.ready;
    return true;
  }

  getPlayerColor(index) {
    return PLAYER_COLORS[index % PLAYER_COLORS.length];
  }

  removePlayer(id) {
    this.players.delete(id);
    if (this.hostId === id) {
      this.hostId = this.players.size ? [...this.players.keys()][0] : null;
    }
  }

  canStart() {
    return this.players.size >= 1 && this.gameState === 'waiting';
  }

  startGame() {
    if (this.gameState !== 'waiting') return false;
    this.gameState = 'playing';
    this.bombs = [];
    this.explosions = [];
    this.powerups = [];
    this.winnerId = null;
    this.initGrid();
    const spawns = this.getSpawnPoints();
    for (const [, p] of this.players) {
      p.x = spawns[p.number - 1][0];
      p.y = spawns[p.number - 1][1];
      p.alive = true;
      p.maxBombs = 1;
      p.flameLength = 2;
      p.speed = 1;
      p.bombs = 1;
      p.kills = 0;
      p.facing = 'DOWN';
      p.ready = false;
      p.lastMove = 0;
    }
    this.tickInterval = setInterval(() => this.tick(), TICK_RATE);
    return true;
  }

  tick() {
    const now = Date.now();

    for (let i = this.bombs.length - 1; i >= 0; i--) {
      const bomb = this.bombs[i];
      bomb.timer -= TICK_RATE;
      if (bomb.timer <= 0) {
        this.explodeBomb(i);
      }
    }

    this.explosions = this.explosions.filter(e => e.endTime > now);

    for (const [, player] of this.players) {
      if (!player.alive) continue;
      const explosionAt = this.explosions.find(e => e.x === player.x && e.y === player.y);
      if (explosionAt) {
        player.alive = false;
        if (explosionAt.ownerId) {
          const killer = this.players.get(explosionAt.ownerId);
          if (killer && killer.id !== player.id) killer.kills = (killer.kills || 0) + 1;
        }
      }
    }

    const alive = [...this.players.values()].filter(p => p.alive);
    const shouldEnd = (alive.length <= 1 && this.players.size > 1) || alive.length === 0;
    if (shouldEnd && this.gameState === 'playing') {
      this.gameState = 'ended';
      this.winnerId = alive.length === 1 ? alive[0].id : null;
      if (this.tickInterval) {
        clearInterval(this.tickInterval);
        this.tickInterval = null;
      }
    }
  }

  explodeBomb(index) {
    if (index < 0 || index >= this.bombs.length) return;
    const bomb = this.bombs[index];
    this.bombs.splice(index, 1);

    const player = this.players.get(bomb.playerId);
    if (player) player.bombs++;

    const blastCells = [[bomb.x, bomb.y]];
    const dirs = [DIR.UP, DIR.DOWN, DIR.LEFT, DIR.RIGHT];
    const chainBombs = [];

    for (const [dx, dy] of dirs) {
      for (let r = 1; r <= bomb.radius; r++) {
        const x = bomb.x + dx * r;
        const y = bomb.y + dy * r;
        if (x < 0 || x >= this.gridSize || y < 0 || y >= this.gridSize) break;

        const cell = this.grid[y][x];
        if (cell === CELL.SOLID) break;
        blastCells.push([x, y]);

        const chained = this.bombs.find(b => b.x === x && b.y === y);
        if (chained && !chainBombs.includes(chained)) {
          chainBombs.push(chained);
        }

        if (cell === CELL.BRICK) {
          this.grid[y][x] = CELL.EMPTY;
          if (Math.random() < 0.3) {
            this.powerups.push({
              x, y,
              type: weightedPowerupType(),
            });
          }
          break;
        }
      }
    }

    const duration = 400;
    for (const [x, y] of blastCells) {
      this.explosions.push({
        x, y,
        endTime: Date.now() + duration,
        ownerId: bomb.playerId,
      });
    }

    // Chain-reaction: trigger by object reference (indices shift after splice)
    for (const chained of chainBombs) {
      const idx = this.bombs.indexOf(chained);
      if (idx >= 0) this.explodeBomb(idx);
    }
  }

  placeBomb(playerId) {
    const player = this.players.get(playerId);
    if (!player || !player.alive || player.bombs <= 0) return false;

    const hasBomb = this.bombs.some(b => b.x === player.x && b.y === player.y);
    if (hasBomb) return false;

    this.bombs.push({
      x: player.x,
      y: player.y,
      playerId,
      radius: player.flameLength,
      timer: 2000,
    });
    player.bombs--;
    return true;
  }

  movePlayer(playerId, dir) {
    const player = this.players.get(playerId);
    if (!player || !player.alive) return false;

    const facing = normalizeDirection(dir);
    if (!facing) return false;
    const [dx, dy] = DIR[facing];

    const now = Date.now();
    const moveCooldown = 150 / player.speed;
    if (now - player.lastMove < moveCooldown) return false;

    const nx = player.x + dx;
    const ny = player.y + dy;

    if (nx < 1 || nx >= this.gridSize - 1 || ny < 1 || ny >= this.gridSize - 1) return false;
    if (this.grid[ny][nx] !== CELL.EMPTY) return false;

    const hasBomb = this.bombs.some(b => b.x === nx && b.y === ny);
    if (hasBomb) return false;

    const otherPlayer = [...this.players.values()].find(p => p.id !== playerId && p.alive && p.x === nx && p.y === ny);
    if (otherPlayer) return false;

    player.x = nx;
    player.y = ny;
    player.lastMove = now;
    player.facing = facing;

    const puIndex = this.powerups.findIndex(pu => pu.x === nx && pu.y === ny);
    if (puIndex >= 0) {
      const pu = this.powerups.splice(puIndex, 1)[0];
      if (pu.type === POWERUP.BOMB) {
        player.maxBombs++;
        player.bombs++;
      } else if (pu.type === POWERUP.FLAME) {
        player.flameLength++;
      } else if (pu.type === POWERUP.SPEED) {
        player.speed = Math.min(2, player.speed + 0.3);
      }
      return { moved: true, pickup: pu.type };
    }

    return true;
  }

  getState() {
    return {
      grid: this.grid,
      players: [...this.players.values()],
      bombs: this.bombs.map(b => ({
        x: b.x, y: b.y, radius: b.radius, timer: b.timer,
      })),
      explosions: this.explosions.filter(e => e.endTime > Date.now()),
      powerups: [...this.powerups],
      gameState: this.gameState,
      winnerId: this.winnerId,
      gridSize: this.gridSize,
      mode: this.mode,
      maxPlayers: this.maxPlayers,
      theme: this.theme,
      hostId: this.hostId,
    };
  }

  reset() {
    if (this.tickInterval) {
      clearInterval(this.tickInterval);
      this.tickInterval = null;
    }
    this.gameState = 'waiting';
    this.bombs = [];
    this.explosions = [];
    this.powerups = [];
    this.winnerId = null;
    this.initGrid();
    const spawns = this.getSpawnPoints();
    for (const [, p] of this.players) {
      const idx = p.number - 1;
      p.x = spawns[idx][0];
      p.y = spawns[idx][1];
      p.alive = true;
      p.maxBombs = 1;
      p.flameLength = 2;
      p.speed = 1;
      p.bombs = 1;
      p.kills = 0;
      p.facing = 'DOWN';
      p.ready = false;
      p.lastMove = 0;
    }
  }
}

module.exports = {
  BombermanGame,
  DEFAULT_GRID_SIZE,
  MIN_GRID_SIZE,
  MAX_GRID_SIZE,
  MAX_PLAYERS,
  ARENA_GRID_SIZE,
  ARENA_MAX_PLAYERS,
  CELL,
  POWERUP,
  TICK_RATE,
  normalizeDirection,
};
