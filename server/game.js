/**
 * Klassisk Bomberman spil-logik
 * Grid-baseret, bomber eksploderer i kors-mønster
 */

const DEFAULT_GRID_SIZE = 13;
const MIN_GRID_SIZE = 9;
const MAX_GRID_SIZE = 21;
const TICK_RATE = 100; // ms

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

class BombermanGame {
  constructor(gridSize = DEFAULT_GRID_SIZE) {
    this.gridSize = Math.min(MAX_GRID_SIZE, Math.max(MIN_GRID_SIZE, gridSize));
    if (this.gridSize % 2 === 0) this.gridSize++; // Skal være ulige
    this.grid = [];
    this.players = new Map();
    this.bombs = [];
    this.explosions = [];
    this.powerups = [];
    this.gameState = 'waiting'; // waiting, playing, ended
    this.tickInterval = null;
    this.winnerId = null;
    this.initGrid();
  }

  initGrid() {
    const gs = this.gridSize;
    this.grid = [];
    for (let y = 0; y < gs; y++) {
      this.grid[y] = [];
      for (let x = 0; x < gs; x++) {
        // Kant = solid væg
        if (x === 0 || y === 0 || x === gs - 1 || y === gs - 1) {
          this.grid[y][x] = CELL.SOLID;
        }
        // Lige koordinater = solid (klassisk bomberman mønster)
        else if (x % 2 === 0 && y % 2 === 0) {
          this.grid[y][x] = CELL.SOLID;
        }
        // Brick-mønster (undtagen spawn-punkter)
        else if ((x > 1 || y > 1) && (x < gs - 2 || y < gs - 2)) {
          const isSpawn = this.isSpawnPoint(x, y);
          this.grid[y][x] = isSpawn ? CELL.EMPTY : (Math.random() < 0.65 ? CELL.BRICK : CELL.EMPTY);
        } else {
          this.grid[y][x] = CELL.EMPTY;
        }
      }
    }
  }

  isSpawnPoint(x, y) {
    const gs = this.gridSize;
    const spawns = [[1, 1], [1, 2], [2, 1], [gs - 2, 1], [gs - 3, 1], [gs - 2, 2],
      [1, gs - 2], [1, gs - 3], [2, gs - 2],
      [gs - 2, gs - 2], [gs - 3, gs - 2], [gs - 2, gs - 3]];
    return spawns.some(([sx, sy]) => sx === x && sy === y);
  }

  addPlayer(id, name = 'Player') {
    const gs = this.gridSize;
    const spawns = [[1, 1], [gs - 2, 1], [1, gs - 2], [gs - 2, gs - 2]];
    const used = [...this.players.values()].map(p => `${p.x},${p.y}`);
    let spawn = spawns.find(([x, y]) => !used.includes(`${x},${y}`)) || spawns[0];

    this.players.set(id, {
      id,
      name,
      x: spawn[0],
      y: spawn[1],
      bombs: 1,
      maxBombs: 1,
      flameLength: 2,
      speed: 1,
      alive: true,
      kills: 0,
      lastMove: 0,
      color: this.getPlayerColor(this.players.size),
    });
  }

  getPlayerColor(index) {
    const colors = ['#e74c3c', '#3498db', '#2ecc71', '#f39c12'];
    return colors[index % colors.length];
  }

  removePlayer(id) {
    this.players.delete(id);
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
    // Reset player positions
    const gs = this.gridSize;
    const spawns = [[1, 1], [gs - 2, 1], [1, gs - 2], [gs - 2, gs - 2]];
    let i = 0;
    for (const [id, p] of this.players) {
      p.x = spawns[i][0];
      p.y = spawns[i][1];
      p.alive = true;
      p.maxBombs = 1;
      p.flameLength = 2;
      p.speed = 1;
      p.bombs = 1;
      p.kills = 0;
      i = (i + 1) % spawns.length;
    }
    this.tickInterval = setInterval(() => this.tick(), TICK_RATE);
    return true;
  }

  tick() {
    const now = Date.now();

    // Opdater bomber
    for (let i = this.bombs.length - 1; i >= 0; i--) {
      const bomb = this.bombs[i];
      bomb.timer -= TICK_RATE;
      if (bomb.timer <= 0) {
        this.explodeBomb(i);
      }
    }

    // Fjern forældede eksplosioner
    this.explosions = this.explosions.filter(e => e.endTime > now);

    // Tjek om spillere er i eksplosion
    for (const [id, player] of this.players) {
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

    // Tjek vinder - slut når max 1 i live, eller alle døde
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
    const bomb = this.bombs[index];
    this.bombs.splice(index, 1);

    const player = this.players.get(bomb.playerId);
    if (player) player.bombs++;

    const blastCells = [[bomb.x, bomb.y]];
    const dirs = [DIR.UP, DIR.DOWN, DIR.LEFT, DIR.RIGHT];

    for (const [dx, dy] of dirs) {
      for (let r = 1; r <= bomb.radius; r++) {
        const x = bomb.x + dx * r;
        const y = bomb.y + dy * r;
        if (x < 0 || x >= this.gridSize || y < 0 || y >= this.gridSize) break;

        const cell = this.grid[y][x];
        if (cell === CELL.SOLID) break;
        blastCells.push([x, y]);
        if (cell === CELL.BRICK) {
          this.grid[y][x] = CELL.EMPTY;
          if (Math.random() < 0.3) {
            this.powerups.push({
              x, y,
              type: [POWERUP.BOMB, POWERUP.FLAME, POWERUP.SPEED][Math.floor(Math.random() * 3)],
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

    const [dx, dy] = DIR[dir] || [0, 0];
    if (dx === 0 && dy === 0) return false;

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

    // Saml power-up
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
    const gs = this.gridSize;
    const spawns = [[1, 1], [gs - 2, 1], [1, gs - 2], [gs - 2, gs - 2]];
    for (const [id, p] of this.players) {
      const idx = [...this.players.keys()].indexOf(id) % 4;
      p.x = spawns[idx][0];
      p.y = spawns[idx][1];
      p.alive = true;
      p.maxBombs = 1;
      p.flameLength = 2;
      p.speed = 1;
      p.bombs = 1;
      p.kills = 0;
    }
  }
}

module.exports = { BombermanGame, DEFAULT_GRID_SIZE, MIN_GRID_SIZE, MAX_GRID_SIZE, CELL, POWERUP, TICK_RATE };
