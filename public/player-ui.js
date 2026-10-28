/** Player identities shared by the lobby, game and spectator screen. */
(function (global) {
  const symbols = { circle: '●', diamond: '◆', triangle: '▲' };
  const escape = (text) => String(text ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const number = (player) => Number.isInteger(player.number) && player.number > 0 ? player.number : '?';
  const symbol = (player) => symbols[player.symbol] || symbols.circle;
  const label = (player) => `#${number(player)} ${symbol(player)} ${player.name || player.id}`;
  const modeLabel = (state) => state.mode === 'arena' ? 'Klassekamp' : 'Classic';
  const sorted = (players) => [...(players || [])].sort((a, b) => (a.number || 0) - (b.number || 0));
  function avatar(player, className) {
    const color = /^#[0-9a-f]{6}$/i.test(player.color) ? player.color : '#ffffff';
    return `<div class="${className} player-identity" style="--player-color:${color}" aria-label="Spiller ${number(player)}">
      <span class="identity-number">${number(player)}</span><span class="identity-symbol" aria-hidden="true">${symbol(player)}</span>
    </div>`;
  }
  function renderRoster(panel, state, myId) {
    if (!panel) return;
    const players = sorted(state.players);
    const key = JSON.stringify([myId, state.mode, players.map(p => [p.id, p.number, p.symbol, p.color, p.name, p.alive, p.bombs, p.maxBombs, p.flameLength, p.speed, p.kills])]);
    if (panel.dataset.renderKey === key) return;
    panel.dataset.renderKey = key;
    panel.innerHTML = players.map(p => {
      const me = p.id === myId;
      return `<div class="stat-card ${me ? 'stat-card-me' : ''} ${p.alive ? '' : 'dead'}" data-player-number="${number(p)}">
        ${avatar(p, 'stat-avatar')}
        <div class="stat-details">
          <span class="stat-name">${escape(p.name || p.id)}${me ? ' (dig)' : ''}</span>
          <div class="stat-vitals">${p.alive ? 'I live' : 'Ude'} · ${p.kills || 0} K</div>
          <div class="stat-row">
            <span><span class="stat-icon">HP</span>${p.alive ? 'OK' : 'OUT'}</span>
            <span><span class="stat-icon">B</span>${p.bombs}/${p.maxBombs}</span>
            <span><span class="stat-icon">F</span>${p.flameLength}</span>
            <span><span class="stat-icon">S</span>${(p.speed || 1).toFixed(1)}</span>
            <span><span class="stat-icon">K</span>${p.kills || 0}</span>
          </div>
        </div>
      </div>`;
    }).join('');
  }
  function updateMatchInfo(state, myId) {
    const players = state.players || [];
    const count = document.getElementById('roster-count');
    if (count) count.textContent = `${players.filter(p => p.alive).length} i live · ${players.length}/${state.maxPlayers || 4} spillere`;
    const you = document.getElementById('your-player');
    const me = players.find(p => p.id === myId);
    if (you) you.textContent = me ? `Du er ${label(me)}${me.alive ? ` · Bomber ${me.bombs}/${me.maxBombs} · Flamme ${me.flameLength} · Fart ${(me.speed || 1).toFixed(1)}` : ' · Ude'}` : '';
    for (const id of ['waiting-screen', 'game-screen', 'spectate-view']) {
      document.getElementById(id)?.classList.toggle('arena-mode', state.mode === 'arena');
    }
  }
  function setupFullscreen(targetId) {
    const button = document.getElementById('btn-fullscreen');
    const target = document.getElementById(targetId);
    if (!button || !target) return;
    if (!document.fullscreenEnabled || !target.requestFullscreen) { button.classList.add('hidden'); return; }
    button.addEventListener('click', async () => {
      try {
        if (document.fullscreenElement) await document.exitFullscreen();
        else await target.requestFullscreen();
      } catch { button.textContent = 'Fuldskærm ikke tilgængelig'; }
    });
    document.addEventListener('fullscreenchange', () => { button.textContent = document.fullscreenElement ? 'Afslut fuldskærm' : 'Fuldskærm'; });
  }
  global.BombermanPlayerUi = { escape, number, symbol, label, modeLabel, sorted, avatar, renderRoster, updateMatchInfo, setupFullscreen };
})(window);
