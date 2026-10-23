/**
 * Shared Bomberman canvas renderer with procedural pixel sprites.
 */
(function (global) {
  const CELL = { EMPTY: 0, SOLID: 1, BRICK: 2 };
  const POWERUP = { BOMB: 1, FLAME: 2, SPEED: 3 };
  const PAD = 2;

  const PLAYER_COLORS = [
    [231, 76, 60],
    [52, 152, 219],
    [46, 204, 113],
    [243, 156, 18],
  ];

  let atlas = null;
  let atlasReady = false;
  let tileSize = 32;

  function px(ctx, x, y, color, s = 1) {
    ctx.fillStyle = color;
    ctx.fillRect(x, y, s, s);
  }

  function drawCharPixels(ctx, ox, oy, rgb, facing) {
    const [r, g, b] = rgb;
    const body = `rgb(${r},${g},${b})`;
    const dark = `rgb(${Math.max(0, r - 50)},${Math.max(0, g - 50)},${Math.max(0, b - 50)})`;
    const light = `rgb(${Math.min(255, r + 40)},${Math.min(255, g + 40)},${Math.min(255, b + 40)})`;
    // body
    for (let y = 6; y < 14; y++) {
      for (let x = 4; x < 12; x++) px(ctx, ox + x, oy + y, body);
    }
    // head
    for (let y = 2; y < 8; y++) {
      for (let x = 5; x < 11; x++) px(ctx, ox + x, oy + y, light);
    }
    // eyes
    px(ctx, ox + 6, oy + 4, '#111');
    px(ctx, ox + 9, oy + 4, '#111');
    // feet
    px(ctx, ox + 5, oy + 14, dark, 2);
    px(ctx, ox + 9, oy + 14, dark, 2);
    // facing hint
    if (facing === 'UP') px(ctx, ox + 7, oy + 1, '#fff');
    if (facing === 'DOWN') px(ctx, ox + 7, oy + 7, dark);
    if (facing === 'LEFT') px(ctx, ox + 4, oy + 5, '#fff');
    if (facing === 'RIGHT') px(ctx, ox + 11, oy + 5, '#fff');
  }

  function buildAtlas() {
    const c = document.createElement('canvas');
    c.width = 256;
    c.height = 128;
    const ctx = c.getContext('2d');
    ctx.imageSmoothingEnabled = false;

    // Floor (0,0) 16x16
    ctx.fillStyle = '#1e6b3a';
    ctx.fillRect(0, 0, 16, 16);
    ctx.fillStyle = '#248a48';
    for (let i = 0; i < 16; i += 4) {
      ctx.fillRect(i, 0, 2, 16);
      ctx.fillRect(0, i, 16, 2);
    }
    ctx.fillStyle = '#16552c';
    ctx.fillRect(0, 0, 16, 1);
    ctx.fillRect(0, 15, 16, 1);

    // Solid (16,0)
    ctx.fillStyle = '#3d4a5c';
    ctx.fillRect(16, 0, 16, 16);
    ctx.fillStyle = '#2a3340';
    ctx.fillRect(17, 1, 14, 14);
    ctx.fillStyle = '#5a6a7e';
    ctx.fillRect(18, 2, 12, 3);
    ctx.fillStyle = '#1a222c';
    ctx.fillRect(18, 12, 12, 2);

    // Brick (32,0)
    ctx.fillStyle = '#8b4513';
    ctx.fillRect(32, 0, 16, 16);
    ctx.fillStyle = '#a0522d';
    ctx.fillRect(33, 1, 14, 14);
    ctx.fillStyle = '#6b3410';
    ctx.fillRect(32, 7, 16, 2);
    ctx.fillRect(39, 0, 2, 16);
    ctx.fillStyle = '#c4784a';
    ctx.fillRect(34, 2, 5, 4);
    ctx.fillRect(42, 9, 5, 4);

    // Bomb frames (48,0) (64,0) (80,0)
    function drawBomb(ox, pulse) {
      ctx.fillStyle = '#1a1a1a';
      ctx.beginPath();
      ctx.arc(ox + 8, 9, 6, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#333';
      ctx.beginPath();
      ctx.arc(ox + 6, 7, 2, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#888';
      ctx.beginPath();
      ctx.moveTo(ox + 8, 3);
      ctx.quadraticCurveTo(ox + 11, 1, ox + 12 + pulse, 2);
      ctx.stroke();
      ctx.fillStyle = pulse ? '#ffaa00' : '#ff6600';
      ctx.fillRect(ox + 11 + pulse, 1, 2, 2);
    }
    drawBomb(48, 0);
    drawBomb(64, 1);
    drawBomb(80, 0);

    // Explosion (96,0) soft center + (112,0) mid
    ctx.fillStyle = '#fff3a0';
    ctx.fillRect(98, 2, 12, 12);
    ctx.fillStyle = '#ff9a3c';
    ctx.fillRect(100, 4, 8, 8);
    ctx.fillStyle = '#ff5520';
    ctx.fillRect(102, 6, 4, 4);

    ctx.fillStyle = '#ffcc66';
    ctx.fillRect(114, 1, 12, 14);
    ctx.fillStyle = '#ff7722';
    ctx.fillRect(116, 3, 8, 10);

    // Powerups (128,0)(144,0)(160,0)
    function drawPu(ox, bg, letter) {
      ctx.fillStyle = bg;
      ctx.fillRect(ox + 2, 2, 12, 12);
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 10px monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(letter, ox + 8, 9);
    }
    drawPu(128, '#c0392b', 'B');
    drawPu(144, '#e67e22', 'F');
    drawPu(160, '#2980b9', 'S');

    // Players at y=16: 4 colors × facing stubs (we redraw facing live)
    PLAYER_COLORS.forEach((rgb, i) => {
      drawCharPixels(ctx, i * 16, 16, rgb, 'DOWN');
    });

    atlas = c;
    atlasReady = true;
  }

  function fitTileSize(gridSize, maxCssPx) {
    const max = maxCssPx || Math.min(window.innerWidth - 48, window.innerHeight - 280, 640);
    const raw = Math.floor((max - PAD * 2) / gridSize);
    return Math.max(16, Math.min(40, raw));
  }

  function resizeCanvas(canvas, gridSize) {
    tileSize = fitTileSize(gridSize);
    const size = gridSize * tileSize + PAD * 2;
    if (canvas.width !== size || canvas.height !== size) {
      canvas.width = size;
      canvas.height = size;
      canvas.style.width = size + 'px';
      canvas.style.height = size + 'px';
    }
    return tileSize;
  }

  function drawTile(ctx, sx, sy, dx, dy, ts) {
    if (atlasReady) {
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(atlas, sx, sy, 16, 16, dx, dy, ts, ts);
    }
  }

  function playerColorIndex(p) {
    const colors = ['#e74c3c', '#3498db', '#2ecc71', '#f39c12'];
    const i = colors.findIndex((c) => c === p.color);
    return i >= 0 ? i : 0;
  }

  function drawFrame(ctx, canvas, state, now, opts) {
    if (!state || !ctx) return;
    if (!atlasReady) buildAtlas();

    const gs = state.gridSize || 13;
    const ts = resizeCanvas(canvas, gs);
    const pad = PAD;
    const highlightId = opts && opts.highlightId;

    ctx.fillStyle = '#0d1f14';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    for (let y = 0; y < gs; y++) {
      for (let x = 0; x < gs; x++) {
        const cell = state.grid[y][x];
        const px = pad + x * ts;
        const py = pad + y * ts;
        if (cell === CELL.SOLID) drawTile(ctx, 16, 0, px, py, ts);
        else if (cell === CELL.BRICK) drawTile(ctx, 32, 0, px, py, ts);
        else drawTile(ctx, 0, 0, px, py, ts);
      }
    }

    const bob = Math.sin((now || Date.now()) / 200) * (ts * 0.08);

    for (const pu of state.powerups || []) {
      const px = pad + pu.x * ts;
      const py = pad + pu.y * ts + bob;
      let sx = 160;
      if (pu.type === POWERUP.BOMB) sx = 128;
      else if (pu.type === POWERUP.FLAME) sx = 144;
      drawTile(ctx, sx, 0, px, py, ts);
    }

    for (const bomb of state.bombs || []) {
      const px = pad + bomb.x * ts;
      const py = pad + bomb.y * ts;
      const frame = Math.floor(((bomb.timer || 0) / 200) % 3);
      const sx = 48 + frame * 16;
      drawTile(ctx, sx, 0, px, py, ts);
    }

    for (const exp of state.explosions || []) {
      const px = pad + exp.x * ts;
      const py = pad + exp.y * ts;
      const life = exp.endTime ? Math.max(0, exp.endTime - (now || Date.now())) : 200;
      const sx = life > 200 ? 96 : 112;
      drawTile(ctx, sx, 0, px, py, ts);
    }

    for (const p of state.players || []) {
      const px = pad + p.x * ts;
      const py = pad + p.y * ts;
      if (!p.alive) ctx.globalAlpha = 0.35;
      const idx = playerColorIndex(p);
      if (atlasReady) {
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(atlas, idx * 16, 16, 16, 16, px, py, ts, ts);
        // facing overlay pixel
        const face = p.facing || 'DOWN';
        ctx.fillStyle = '#fff';
        const m = ts / 16;
        if (face === 'UP') ctx.fillRect(px + 7 * m, py + 1 * m, m, m);
        if (face === 'DOWN') ctx.fillRect(px + 7 * m, py + 7 * m, m, m);
        if (face === 'LEFT') ctx.fillRect(px + 4 * m, py + 5 * m, m, m);
        if (face === 'RIGHT') ctx.fillRect(px + 11 * m, py + 5 * m, m, m);
      } else {
        ctx.fillStyle = p.color || '#3498db';
        ctx.beginPath();
        ctx.arc(px + ts / 2, py + ts / 2, ts / 2 - 4, 0, Math.PI * 2);
        ctx.fill();
      }
      if (highlightId && p.id === highlightId && p.alive) {
        ctx.strokeStyle = '#ffe66d';
        ctx.lineWidth = 2;
        ctx.strokeRect(px + 1, py + 1, ts - 2, ts - 2);
      }
      ctx.globalAlpha = 1;
    }
  }

  /** Tiny map preview for waiting room */
  function drawMiniMap(ctx, canvas, state) {
    if (!state || !ctx || !state.grid) return;
    if (!atlasReady) buildAtlas();
    const gs = state.gridSize || 13;
    const ts = Math.max(4, Math.floor(Math.min(canvas.width, canvas.height) / gs));
    const offsetX = Math.floor((canvas.width - gs * ts) / 2);
    const offsetY = Math.floor((canvas.height - gs * ts) / 2);
    ctx.fillStyle = '#0d1f14';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    for (let y = 0; y < gs; y++) {
      for (let x = 0; x < gs; x++) {
        const cell = state.grid[y][x];
        const px = offsetX + x * ts;
        const py = offsetY + y * ts;
        if (cell === CELL.SOLID) ctx.fillStyle = '#3d4a5c';
        else if (cell === CELL.BRICK) ctx.fillStyle = '#8b4513';
        else ctx.fillStyle = '#1e6b3a';
        ctx.fillRect(px, py, ts, ts);
      }
    }
    for (const p of state.players || []) {
      ctx.fillStyle = p.color || '#fff';
      ctx.fillRect(offsetX + p.x * ts, offsetY + p.y * ts, ts, ts);
    }
  }

  function ensureAtlas() {
    if (!atlasReady) buildAtlas();
    return atlas;
  }

  global.BombermanRender = {
    CELL,
    POWERUP,
    drawFrame,
    drawMiniMap,
    ensureAtlas,
    fitTileSize,
    resizeCanvas,
    getTileSize: () => tileSize,
  };
})(typeof window !== 'undefined' ? window : globalThis);
