/**
 * Bomberman Admin - Opret spil, se aktive, afslut sessioner
 */

const API_BASE = '';

async function createLobby(pin, gridSize) {
  const res = await fetch(`${API_BASE}/api/admin/lobbies`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pin: pin || undefined, gridSize: parseInt(gridSize, 10) }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Fejl');
  return data;
}

async function getLobbies() {
  const res = await fetch(`${API_BASE}/api/admin/lobbies`);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Fejl');
  return data.lobbies || [];
}

async function endLobby(pin) {
  const res = await fetch(`${API_BASE}/api/admin/lobbies/${pin}/end`, {
    method: 'POST',
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Fejl');
  return data;
}

function init() {
  document.getElementById('create-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const pinInput = document.getElementById('pin-input');
    const gridSelect = document.getElementById('grid-size');
    const resultEl = document.getElementById('create-result');
    const pin = pinInput.value.trim();
    const gridSize = gridSelect.value;

    resultEl.classList.add('hidden');
    try {
      const data = await createLobby(pin || undefined, gridSize);
      resultEl.textContent = `Spil oprettet! PIN: ${data.pin} (Bane: ${data.gridSize}×${data.gridSize})`;
      resultEl.className = 'result success';
      resultEl.classList.remove('hidden');
      pinInput.value = '';
      refreshLobbies();
    } catch (err) {
      resultEl.textContent = err.message || 'Kunne ikke oprette spil';
      resultEl.className = 'result error';
      resultEl.classList.remove('hidden');
    }
  });

  refreshLobbies();
  setInterval(refreshLobbies, 3000);
}

async function refreshLobbies() {
  try {
    const lobbies = await getLobbies();
    const listEl = document.getElementById('lobby-list');
    const noEl = document.getElementById('no-lobbies');

    listEl.innerHTML = '';
    noEl.style.display = lobbies.length === 0 ? 'block' : 'none';

    for (const lobby of lobbies) {
      const item = document.createElement('div');
      item.className = 'lobby-item';
      item.innerHTML = `
        <div class="lobby-info">
          <span class="pin">PIN: ${lobby.pin}</span>
          <span>Bane: ${lobby.gridSize}×${lobby.gridSize}</span>
          <span>Spillere: ${lobby.playerCount}</span>
          <span>Status: ${lobby.gameState === 'playing' ? 'I gang' : lobby.gameState === 'ended' ? 'Slut' : 'Venter'}</span>
        </div>
        <div class="lobby-actions">
          <a href="/?pin=${lobby.pin}" target="_blank" class="btn-join-link">Deltag</a>
          <a href="/spectate.html?pin=${lobby.pin}" target="_blank" class="btn-spectate-link">Spectate</a>
          <button data-pin="${lobby.pin}" class="btn-end">Afslut</button>
        </div>
      `;
      item.querySelector('.btn-end').addEventListener('click', async () => {
        if (!confirm(`Afslut spil med PIN ${lobby.pin}?`)) return;
        try {
          await endLobby(lobby.pin);
          refreshLobbies();
        } catch (err) {
          alert(err.message);
        }
      });
      listEl.appendChild(item);
    }
  } catch (err) {
    console.error('Kunne ikke hente lobbies:', err);
  }
}

init();
