/**
 * Shared Bomberman renderer — CC0 Bombman sprites + smooth interpolation.
 * Fallback: procedural atlas if images fail to load.
 */
(function (global) {
  const CELL = { EMPTY: 0, SOLID: 1, BRICK: 2 };
  const POWERUP = { BOMB: 1, FLAME: 2, SPEED: 3 };
  const PAD = 2;
  const ASSET = 'assets/sprites/bombman/';
  const MOVE_LERP_MS = 110;

  const PLAYER_COLORS = ['#e74c3c', '#3498db', '#2ecc71', '#f39c12'];

  const imgs = {};
  let imagesReady = false;
  let imagesFailed = false;
  let loadStarted = false;
  let proceduralAtlas = null;

  // Grid layer cache
  let gridCache = null;
  let gridCacheKey = '';
  let gridCacheTs = 0;

  // Player smooth positions
  const lerpMap = Object.create(null);
  // Tinted player frame cache: key = color|src
  const tintCache = Object.create(null);

  const LOAD_LIST = [
    'tile_env1_floor.png',
    'tile_env1_block.png',
    'tile_env1_wall.png',
    'bomb1.png',
    'bomb2.png',
    'bomb3.png',
    'flame1.png',
    'flame2.png',
    'flame1_up.png',
    'flame1_down.png',
    'flame1_left.png',
    'flame1_right.png',
    'flame1_horizontal.png',
    'flame1_vertical.png',
    'item_bomb.png',
    'item_flame.png',
    'item_speedup.png',
    'player_down.png',
    'player_down_walk1.png',
    'player_down_walk2.png',
    'player_down_walk3.png',
    'player_up.png',
    'player_up_walk1.png',
    'player_up_walk2.png',
    'player_up_walk3.png',
    'player_left.png',
    'player_left_walk1.png',
    'player_left_walk3.png',
    'player_right.png',
    'player_right_walk1.png',
    'player_right_walk3.png',
  ];

  function loadImages() {
    if (loadStarted) return;
    loadStarted = true;
    let pending = LOAD_LIST.length;
    let failed = 0;
    LOAD_LIST.forEach((name) => {
      const img = new Image();
      img.decoding = 'async';
      img.onload = () => {
        imgs[name] = img;
        pending--;
        if (pending === 0) {
          imagesReady = failed < LOAD_LIST.length / 2;
          imagesFailed = !imagesReady;
          if (!imagesReady) buildProceduralAtlas();
        }
      };
      img.onerror = () => {
        failed++;
        pending--;
        if (pending === 0) {
          imagesReady = failed < LOAD_LIST.length / 2;
          imagesFailed = !imagesReady;
          if (!imagesReady) buildProceduralAtlas();
        }
      };
      img.src = ASSET + name;
    });
  }

  function buildProceduralAtlas() {
    const c = document.createElement('canvas');
    c.width = 64;
    c.height = 48;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#1e6b3a';
    ctx.fillRect(0, 0, 16, 16);
    ctx.fillStyle = '#3d4a5c';
    ctx.fillRect(16, 0, 16, 16);
    ctx.fillStyle = '#8b4513';
    ctx.fillRect(32, 0, 16, 16);
    ctx.fillStyle = '#222';
    ctx.beginPath();
    ctx.arc(56, 8, 6, 0, Math.PI * 2);
    ctx.fill();
    proceduralAtlas = c;
  }

  function fitTileSize(gridSize) {
    const max = Math.min(window.innerWidth - 48, window.innerHeight - 280, 720);
    const raw = Math.floor((max - PAD * 2) / gridSize);
    return Math.max(18, Math.min(48, raw));
  }

  function resizeCanvas(canvas, gridSize) {
    const ts = fitTileSize(gridSize);
    const size = gridSize * ts + PAD * 2;
    if (canvas.width !== size || canvas.height !== size) {
      canvas.width = size;
      canvas.height = size;
      canvas.style.width = size + 'px';
      canvas.style.height = size + 'px';
      gridCacheKey = ''; // force rebuild
    }
    return ts;
  }

  function gridFingerprint(state) {
    // Cheap hash: brick/solid pattern + size
    let h = state.gridSize | 0;
    const g = state.grid;
    for (let y = 0; y < g.length; y++) {
      const row = g[y];
      for (let x = 0; x < row.length; x++) h = (h * 31 + row[x]) | 0;
    }
    return h + ':' + (state.powerups?.length || 0);
  }

  function ensureGridCache(state, ts) {
    const key = gridFingerprint(state) + ':' + ts;
    if (gridCache && key === gridCacheKey && gridCacheTs === ts) return gridCache;
    const gs = state.gridSize;
    const c = document.createElement('canvas');
    c.width = gs * ts + PAD * 2;
    c.height = gs * ts + PAD * 2;
    const ctx = c.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = '#0d1f14';
    ctx.fillRect(0, 0, c.width, c.height);

    const floor = imgs['tile_env1_floor.png'];
    const wall = imgs['tile_env1_wall.png'];
    const block = imgs['tile_env1_block.png'];

    for (let y = 0; y < gs; y++) {
      for (let x = 0; x < gs; x++) {
        const cell = state.grid[y][x];
        const dx = PAD + x * ts;
        const dy = PAD + y * ts;
        let img = floor;
        if (cell === CELL.SOLID) img = wall;
        else if (cell === CELL.BRICK) img = block;
        if (img) {
          ctx.drawImage(img, dx, dy, ts, ts);
        } else if (proceduralAtlas) {
          const sx = cell === CELL.SOLID ? 16 : cell === CELL.BRICK ? 32 : 0;
          ctx.drawImage(proceduralAtlas, sx, 0, 16, 16, dx, dy, ts, ts);
        } else {
          ctx.fillStyle = cell === CELL.SOLID ? '#3d4a5c' : cell === CELL.BRICK ? '#8b4513' : '#1e6b3a';
          ctx.fillRect(dx, dy, ts, ts);
        }
      }
    }
    gridCache = c;
    gridCacheKey = key;
    gridCacheTs = ts;
    return c;
  }

  function updateLerp(players, now) {
    const seen = Object.create(null);
    for (const p of players || []) {
      seen[p.id] = true;
      const cur = lerpMap[p.id];
      if (!cur) {
        lerpMap[p.id] = {
          x: p.x,
          y: p.y,
          fromX: p.x,
          fromY: p.y,
          toX: p.x,
          toY: p.y,
          start: now,
          facing: p.facing || 'DOWN',
          moving: false,
        };
        continue;
      }
      if (cur.toX !== p.x || cur.toY !== p.y) {
        const t = Math.min(1, (now - cur.start) / MOVE_LERP_MS);
        const e = t * t * (3 - 2 * t);
        cur.fromX = cur.fromX + (cur.toX - cur.fromX) * e;
        cur.fromY = cur.fromY + (cur.toY - cur.fromY) * e;
        cur.toX = p.x;
        cur.toY = p.y;
        cur.start = now;
        cur.moving = true;
      }
      cur.facing = p.facing || cur.facing || 'DOWN';
      const t2 = Math.min(1, (now - cur.start) / MOVE_LERP_MS);
      if (t2 >= 1) cur.moving = false;
      const e2 = t2 * t2 * (3 - 2 * t2);
      cur.x = cur.fromX + (cur.toX - cur.fromX) * e2;
      cur.y = cur.fromY + (cur.toY - cur.fromY) * e2;
    }
    for (const id of Object.keys(lerpMap)) {
      if (!seen[id]) delete lerpMap[id];
    }
  }

  function tintImage(img, colorHex) {
    const key = colorHex + '|' + img.src;
    if (tintCache[key]) return tintCache[key];
    const c = document.createElement('canvas');
    c.width = img.naturalWidth || img.width;
    c.height = img.naturalHeight || img.height;
    const ctx = c.getContext('2d');
    ctx.drawImage(img, 0, 0);
    ctx.globalCompositeOperation = 'source-atop';
    ctx.fillStyle = colorHex;
    ctx.globalAlpha = 0.42;
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    tintCache[key] = c;
    return c;
  }

  function playerSprite(p, now, moving) {
    const face = (p.facing || 'DOWN').toLowerCase();
    const dir = ['up', 'down', 'left', 'right'].includes(face) ? face : 'down';
    let name = `player_${dir}.png`;
    if (moving) {
      const frame = Math.floor(now / 120) % 3;
      if (dir === 'left' || dir === 'right') {
        const walk = frame === 1 ? 1 : 3;
        name = `player_${dir}_walk${walk}.png`;
      } else {
        name = `player_${dir}_walk${frame + 1}.png`;
      }
    }
    let img = imgs[name] || imgs[`player_${dir}.png`] || imgs['player_down.png'];
    if (!img) return null;
    const color = p.color || PLAYER_COLORS[0];
    return tintImage(img, color);
  }

  function drawImg(ctx, img, dx, dy, dw, dh) {
    if (!img) return;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(img, dx, dy, dw, dh);
  }

  function drawFrame(ctx, canvas, state, now, opts) {
    if (!state || !ctx) return;
    loadImages();
    now = now || performance.now();

    const gs = state.gridSize || 13;
    const ts = resizeCanvas(canvas, gs);
    const highlightId = opts && opts.highlightId;

    // Static grid (cached)
    const layer = ensureGridCache(state, ts);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(layer, 0, 0);

    const bob = Math.sin(now / 220) * (ts * 0.06);

    // Powerups
    for (const pu of state.powerups || []) {
      let img = imgs['item_speedup.png'];
      if (pu.type === POWERUP.BOMB) img = imgs['item_bomb.png'];
      else if (pu.type === POWERUP.FLAME) img = imgs['item_flame.png'];
      const dx = PAD + pu.x * ts;
      const dy = PAD + pu.y * ts + bob;
      drawImg(ctx, img, dx, dy, ts, ts);
    }

    // Bombs (pulse)
    for (const bomb of state.bombs || []) {
      const frame = 1 + (Math.floor((bomb.timer || 0) / 180) % 3);
      const img = imgs[`bomb${frame}.png`] || imgs['bomb1.png'];
      const scale = 0.92 + 0.08 * Math.sin(now / 90);
      const dw = ts * scale;
      const dh = ts * scale;
      const dx = PAD + bomb.x * ts + (ts - dw) / 2;
      const dy = PAD + bomb.y * ts + (ts - dh) / 2;
      drawImg(ctx, img, dx, dy, dw, dh);
    }

    // Explosions
    for (const exp of state.explosions || []) {
      const life = exp.endTime ? Math.max(0, exp.endTime - Date.now()) : 200;
      const img = life > 200 ? imgs['flame1.png'] : imgs['flame2.png'];
      drawImg(ctx, img, PAD + exp.x * ts, PAD + exp.y * ts, ts, ts);
    }

    // Players (interpolated)
    updateLerp(state.players, now);
    for (const p of state.players || []) {
      const L = lerpMap[p.id];
      const px = PAD + (L ? L.x : p.x) * ts;
      const py = PAD + (L ? L.y : p.y) * ts;
      if (!p.alive) ctx.globalAlpha = 0.4;
      const spr = playerSprite(p, now, L && L.moving && p.alive);
      if (spr) {
        // Character sprites are taller — fit height, center horizontally
        const aspect = (spr.height || 1) / (spr.width || 1);
        const dh = ts * 1.15;
        const dw = dh / aspect;
        const ox = px + (ts - dw) / 2;
        const oy = py + ts - dh + 2;
        drawImg(ctx, spr, ox, oy, dw, dh);
      } else {
        ctx.fillStyle = p.color || '#3498db';
        ctx.beginPath();
        ctx.arc(px + ts / 2, py + ts / 2, ts / 2 - 4, 0, Math.PI * 2);
        ctx.fill();
      }
      if (highlightId && p.id === highlightId && p.alive) {
        ctx.strokeStyle = 'rgba(255, 230, 100, 0.85)';
        ctx.lineWidth = 2;
        ctx.strokeRect(px + 1, py + 1, ts - 2, ts - 2);
      }
      ctx.globalAlpha = 1;
    }
  }

  function drawMiniMap(ctx, canvas, state) {
    if (!state?.grid || !ctx) return;
    loadImages();
    const gs = state.gridSize || 13;
    const ts = Math.max(4, Math.floor(Math.min(canvas.width, canvas.height) / gs));
    const ox = Math.floor((canvas.width - gs * ts) / 2);
    const oy = Math.floor((canvas.height - gs * ts) / 2);
    ctx.fillStyle = '#0d1f14';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    const floor = imgs['tile_env1_floor.png'];
    const wall = imgs['tile_env1_wall.png'];
    const block = imgs['tile_env1_block.png'];
    for (let y = 0; y < gs; y++) {
      for (let x = 0; x < gs; x++) {
        const cell = state.grid[y][x];
        const dx = ox + x * ts;
        const dy = oy + y * ts;
        const img = cell === CELL.SOLID ? wall : cell === CELL.BRICK ? block : floor;
        if (img) {
          ctx.imageSmoothingEnabled = false;
          ctx.drawImage(img, dx, dy, ts, ts);
        } else {
          ctx.fillStyle = cell === CELL.SOLID ? '#3d4a5c' : cell === CELL.BRICK ? '#8b4513' : '#1e6b3a';
          ctx.fillRect(dx, dy, ts, ts);
        }
      }
    }
    for (const p of state.players || []) {
      ctx.fillStyle = p.color || '#fff';
      ctx.fillRect(ox + p.x * ts, oy + p.y * ts, ts, ts);
    }
  }

  function invalidateGridCache() {
    gridCacheKey = '';
  }

  loadImages();

  global.BombermanRender = {
    CELL,
    POWERUP,
    drawFrame,
    drawMiniMap,
    invalidateGridCache,
    fitTileSize,
    resizeCanvas,
    isReady: () => imagesReady || imagesFailed,
  };
})(typeof window !== 'undefined' ? window : globalThis);
