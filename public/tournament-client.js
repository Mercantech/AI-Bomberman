/**
 * Tournament mode: lobby-baseret – opret turnering, del join-kode, op til 28 joiner, start når I er klar
 */

const API = '';

let currentTournamentId = null;
let currentJoinCode = null;

async function createTournament(mode, maxParticipants) {
  const res = await fetch(`${API}/api/tournament`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mode, maxParticipants: Math.max(2, Math.min(32, maxParticipants)) }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Fejl');
  return data;
}

async function getTournament(idOrCode) {
  const res = await fetch(`${API}/api/tournament/${encodeURIComponent(idOrCode)}`);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Fejl');
  return data;
}

async function getTournamentByCode(code) {
  const res = await fetch(`${API}/api/tournament/by-code/${encodeURIComponent(code)}`);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Fejl');
  return data;
}

async function joinTournament(idOrCode, name) {
  const res = await fetch(`${API}/api/tournament/${encodeURIComponent(idOrCode)}/join`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Fejl');
  return data;
}

async function startTournament(idOrCode) {
  const res = await fetch(`${API}/api/tournament/${encodeURIComponent(idOrCode)}/start`, {
    method: 'POST',
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Fejl');
  return data;
}

async function startMatch(tournamentId, matchId) {
  const res = await fetch(`${API}/api/tournament/${encodeURIComponent(tournamentId)}/match/start`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ matchId }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Fejl');
  return data;
}

function showSection(id) {
  ['create-tournament', 'tournament-lobby', 'join-lobby', 'tournament-view'].forEach(s => {
    const el = document.getElementById(s);
    if (el) el.classList.toggle('hidden', s !== id);
  });
}

function init() {
  const params = new URLSearchParams(window.location.search);
  const code = params.get('code') || params.get('join');

  if (code) {
    currentJoinCode = code.toUpperCase();
    showSection('join-lobby');
    loadJoinLobby(code);
    setInterval(() => loadJoinLobby(code), 2000);
    document.getElementById('join-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const name = document.getElementById('join-name').value.trim();
      if (!name) return;
      try {
        await joinTournament(code, name);
        sessionStorage.setItem('tournamentName', name);
        document.getElementById('join-lobby-error').classList.add('hidden');
        loadJoinLobby(code);
      } catch (err) {
        const el = document.getElementById('join-lobby-error');
        el.textContent = err.message;
        el.classList.remove('hidden');
      }
    });
    return;
  }

  document.getElementById('tournament-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const mode = document.getElementById('tournament-mode').value;
    const maxParticipants = parseInt(document.getElementById('max-participants').value, 10) || 28;
    const resultEl = document.getElementById('create-tournament-result');
    resultEl.classList.add('hidden');
    try {
      const { tournament } = await createTournament(mode, maxParticipants);
      currentTournamentId = tournament.id;
      document.getElementById('join-code').textContent = tournament.joinCode;
      document.getElementById('join-link').href = `${window.location.pathname}?code=${tournament.joinCode}`;
      document.getElementById('join-link').textContent = `${window.location.origin}${window.location.pathname}?code=${tournament.joinCode}`;
      showSection('tournament-lobby');
      pollLobby();
    } catch (err) {
      resultEl.textContent = err.message || 'Kunne ikke oprette turnering';
      resultEl.className = 'result error';
      resultEl.classList.remove('hidden');
    }
  });

  document.getElementById('btn-start-tournament').addEventListener('click', async () => {
    if (!currentTournamentId) return;
    try {
      const data = await startTournament(currentTournamentId);
      showSection('tournament-view');
      renderBracket(data);
      pollTournament();
    } catch (err) {
      alert(err.message);
    }
  });
}

async function loadJoinLobby(code) {
  try {
    const data = await getTournamentByCode(code);
    const t = data.tournament;
    currentTournamentId = t.id;
    const listEl = document.getElementById('join-lobby-participants');
    listEl.innerHTML = '<h3>Tilmeldte (' + t.participants.length + '/' + t.maxParticipants + ')</h3><ul>' +
      t.participants.map(p => '<li>' + escapeHtml(p) + '</li>').join('') + '</ul>';
    if (t.status === 'running') {
      showSection('tournament-view');
      const full = await getTournament(t.id);
      renderBracket(full);
      pollTournament();
    }
  } catch (e) {
    document.getElementById('join-lobby-participants').innerHTML = '<p class="muted">Kunne ikke hente turnering. Tjek koden.</p>';
  }
}

function pollLobby() {
  if (!currentTournamentId) return;
  getTournament(currentTournamentId)
    .then(({ tournament }) => {
      if (tournament.status !== 'registration') {
        showSection('tournament-view');
        return getTournament(currentTournamentId).then(renderBracket);
      }
      document.getElementById('join-code').textContent = tournament.joinCode;
      document.getElementById('lobby-participants').innerHTML =
        '<h3>Tilmeldte (' + tournament.participants.length + '/' + tournament.maxParticipants + ')</h3><ul>' +
        tournament.participants.map(p => '<li>' + escapeHtml(p) + '</li>').join('') + '</ul>';
      document.getElementById('btn-start-tournament').disabled = tournament.participants.length < 2;
    })
    .catch(() => {});
  setTimeout(pollLobby, 2000);
}

let pollTimeout;

function pollTournament() {
  if (!currentTournamentId) return;
  getTournament(currentTournamentId)
    .then(data => renderBracket(data))
    .catch(() => {});
  pollTimeout = setTimeout(pollTournament, 3000);
}

function renderBracket(data) {
  const { tournament, standings = [], nextMatches = [] } = data;
  const standingsEl = document.getElementById('standings');
  const bracketEl = document.getElementById('bracket');
  const nextEl = document.getElementById('next-matches');

  if (tournament.status === 'registration' || !tournament.rounds) {
    bracketEl.innerHTML = '<p class="muted">Venter på at turneringen startes.</p>';
    nextEl.classList.add('hidden');
    return;
  }

  standingsEl.innerHTML = '';
  if (standings.length) {
    standingsEl.innerHTML = `
      <h3>Point</h3>
      <table class="standings-table">
        <thead><tr><th>Spiller</th><th>Point</th></tr></thead>
        <tbody>
          ${standings.map(s => `<tr><td>${escapeHtml(s.name)}</td><td>${s.points}</td></tr>`).join('')}
        </tbody>
      </table>
    `;
  }

  bracketEl.innerHTML = '<p class="tournament-id">Join-kode: ' + escapeHtml(tournament.joinCode || tournament.id) + '</p>' +
    tournament.rounds.map((round) => `
      <div class="tournament-round">
        <h3>${escapeHtml(round.name)}</h3>
        ${round.matches.map(m => {
          const p1 = m.player1 || '?';
          const p2 = m.player2 || '?';
          const winner = m.winner ? `<span class="match-winner">→ ${escapeHtml(m.winner)}</span>` : '';
          const isLive = m.status === 'live';
          const isCompleted = m.status === 'completed';
          let actions = '';
          if (m.status === 'pending' && p1 !== 'Bye' && p2 !== 'Bye') {
            actions = `<button data-match-id="${m.id}">Start kamp</button>`;
          } else if (m.status === 'live' && m.lobbyPin) {
            actions = `<a href="/?pin=${m.lobbyPin}" target="_blank">Deltag (PIN: ${m.lobbyPin})</a> <a href="/spectate.html?pin=${m.lobbyPin}" target="_blank">Spectate</a>`;
          }
          return `
            <div class="match-card ${isLive ? 'live' : ''} ${isCompleted ? 'completed' : ''}">
              <div class="match-players">
                <span>${escapeHtml(p1)}</span>
                <span class="vs">vs</span>
                <span>${escapeHtml(p2)}</span>
                ${winner}
              </div>
              <div class="match-actions">${actions}</div>
            </div>
          `;
        }).join('')}
      </div>
    `).join('');

  bracketEl.querySelectorAll('.match-actions button').forEach(btn => {
    btn.addEventListener('click', async () => {
      const matchId = btn.dataset.matchId;
      try {
        const { pin } = await startMatch(tournament.id, matchId);
        const card = btn.closest('.match-card');
        card.classList.add('live');
        card.querySelector('.match-actions').innerHTML =
          `<a href="/?pin=${pin}" target="_blank">Deltag (PIN: ${pin})</a> <a href="/spectate.html?pin=${pin}" target="_blank">Spectate</a>`;
      } catch (err) {
        alert(err.message);
      }
    });
  });

  if (nextMatches && nextMatches.length > 0) {
    nextEl.classList.remove('hidden');
    nextEl.innerHTML = '<h3>Næste kamp(e)</h3>' +
      nextMatches.map(m => `
        <div class="match-card">
          <div class="match-players">
            <span>${escapeHtml(m.player1)}</span> <span class="vs">vs</span> <span>${escapeHtml(m.player2)}</span>
          </div>
          <div class="match-actions"><button data-match-id="${m.id}">Start kamp</button></div>
        </div>
      `).join('');
    nextEl.querySelectorAll('button').forEach(btn => {
      btn.addEventListener('click', async () => {
        try {
          const { pin } = await startMatch(tournament.id, btn.dataset.matchId);
          btn.parentElement.innerHTML = `<a href="/?pin=${pin}" target="_blank">Deltag (PIN: ${pin})</a> <a href="/spectate.html?pin=${pin}" target="_blank">Spectate</a>`;
        } catch (err) {
          alert(err.message);
        }
      });
    });
  } else if (tournament.status === 'completed') {
    const lastRound = tournament.rounds[tournament.rounds.length - 1];
    const finalMatch = lastRound && lastRound.matches[0];
    if (finalMatch && finalMatch.winner) {
      nextEl.classList.remove('hidden');
      nextEl.innerHTML = '<h3>Turneringen er slut</h3><p class="match-winner">Vinder: ' + escapeHtml(finalMatch.winner) + '</p>';
    }
  } else {
    nextEl.classList.add('hidden');
  }
}

function escapeHtml(s) {
  const div = document.createElement('div');
  div.textContent = s;
  return div.innerHTML;
}

init();
