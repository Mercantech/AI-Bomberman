/**
 * Tournament mode: bracket, point-system, parallel/sequential
 * Single-elimination: kvart/semi/finale
 */

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Udvid til næste potens af 2 med "Bye" */
function padToPowerOfTwo(participants) {
  const n = participants.length;
  if (n <= 0) return [];
  let size = 4;
  while (size < n) size *= 2;
  const out = [...participants];
  while (out.length < size) out.push('Bye');
  return out;
}

/**
 * Generer bracket (single-elimination).
 * rounds[0] = første runde (semi eller kvart), rounds[last] = finale
 */
function generateBracket(participants) {
  const padded = padToPowerOfTwo(participants);
  const shuffled = shuffle(padded);
  const rounds = [];
  let current = shuffled.map((name, i) => ({ id: `m-0-${i}`, player1: name, player2: null, winner: null, lobbyPin: null, status: 'pending' }));

  // Par spillere i første runde: (0,1), (2,3), (4,5), (6,7) ...
  const firstRoundMatches = [];
  for (let i = 0; i < current.length; i += 2) {
    firstRoundMatches.push({
      id: `m-0-${firstRoundMatches.length}`,
      player1: current[i].player1,
      player2: current[i + 1].player1,
      winner: null,
      lobbyPin: null,
      status: 'pending',
    });
  }
  rounds.push({ name: 'Runde 1', matches: firstRoundMatches });

  // Næste runder: placeholders, fyldes når vindere er kendt
  let roundIndex = 1;
  let matchCount = firstRoundMatches.length / 2;
  while (matchCount >= 1) {
    const roundName = matchCount === 1 ? 'Finale' : matchCount === 2 ? 'Semifinale' : `Runde ${roundIndex + 1}`;
    const matches = [];
    for (let i = 0; i < matchCount; i++) {
      matches.push({
        id: `m-${roundIndex}-${i}`,
        player1: null,
        player2: null,
        winner: null,
        lobbyPin: null,
        status: 'pending',
      });
    }
    rounds.push({ name: roundName, matches });
    matchCount = Math.floor(matchCount / 2);
    roundIndex++;
  }

  return rounds;
}

/** Point: sejr = 3, nederlag = 0 (til standings) */
function getStandings(tournament) {
  const points = new Map();
  const list = tournament.participants || [];
  for (const p of list) {
    if (p === 'Bye') continue;
    points.set(p, 0);
  }
  const rounds = tournament.rounds || [];
  for (const round of rounds) {
    for (const m of round.matches) {
      if (m.status !== 'completed' || !m.winner) continue;
      if (m.winner !== 'Bye') points.set(m.winner, (points.get(m.winner) || 0) + 3);
    }
  }
  return [...points.entries()].sort((a, b) => b[1] - a[1]).map(([name, pts]) => ({ name, points: pts }));
}

/** Kort join-kode (6 tegn) */
function generateJoinCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

const MAX_PARTICIPANTS_DEFAULT = 28;

/**
 * Opret turnering som lobby – deltagere joiner bagefter (op til maxParticipants).
 */
function createTournamentLobby(mode, maxParticipants = MAX_PARTICIPANTS_DEFAULT) {
  const id = `t-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const joinCode = generateJoinCode();
  return {
    id,
    joinCode,
    participants: [],
    maxParticipants: Math.min(32, Math.max(2, maxParticipants)),
    mode: mode === 'parallel' ? 'parallel' : 'sequential',
    rounds: null,
    currentRoundIndex: 0,
    status: 'registration',
    createdAt: Date.now(),
  };
}

/** Tilføj deltager (lobby-fase). Returnerer true hvis tilføjet. */
function addParticipant(tournament, name) {
  if (tournament.status !== 'registration') return { ok: false, error: 'Turneringen er startet' };
  const n = String(name || '').trim().slice(0, 30);
  if (!n) return { ok: false, error: 'Navn påkrævet' };
  if (tournament.participants.length >= tournament.maxParticipants) return { ok: false, error: 'Turneringen er fuld' };
  if (tournament.participants.includes(n)) return { ok: false, error: 'Navn er allerede tilmeldt' };
  tournament.participants.push(n);
  return { ok: true };
}

/** Start turnering: generer bracket fra tilmeldte (min. 2). */
function startTournament(tournament) {
  if (tournament.status !== 'registration') return { ok: false, error: 'Turneringen er allerede startet' };
  if (tournament.participants.length < 2) return { ok: false, error: 'Mindst 2 deltagere kræves' };
  tournament.rounds = generateBracket(tournament.participants);
  tournament.status = 'running';
  tournament.currentRoundIndex = 0;
  return { ok: true };
}

/** Legacy: opret turnering med færdig liste (bruges ikke i lobby-flow) */
function createTournament(participants, mode) {
  const list = Array.isArray(participants) ? participants.filter(Boolean).map(String) : [];
  if (list.length < 2) return null;
  const rounds = generateBracket(list);
  return {
    id: `t-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    joinCode: generateJoinCode(),
    participants: list,
    maxParticipants: list.length,
    mode: mode === 'parallel' ? 'parallel' : 'sequential',
    rounds,
    currentRoundIndex: 0,
    status: 'running',
    createdAt: Date.now(),
  };
}

/** Find næste kamp(e) der kan startes. For sequential: én; for parallel: alle i nuværende runde der er pending. */
function getNextMatches(tournament) {
  const rounds = tournament.rounds || [];
  const { currentRoundIndex, mode } = tournament;
  const round = rounds[currentRoundIndex];
  if (!round) return [];
  const pending = round.matches.filter(m => m.status === 'pending' && m.player1 && m.player2 && m.player1 !== 'Bye' && m.player2 !== 'Bye');
  if (mode === 'sequential') return pending.slice(0, 1);
  return pending;
}

/** Efter en match er færdig: sæt vinder og flyt til næste runde */
function advanceWinner(tournament, matchId, winnerName) {
  const round = tournament.rounds[tournament.currentRoundIndex];
  if (!round) return false;
  const match = round.matches.find(m => m.id === matchId);
  if (!match) return false;
  match.winner = winnerName;
  match.status = 'completed';

  const allInRoundComplete = round.matches.every(m => m.status === 'completed');
  if (!allInRoundComplete) return true;

  let nextRound = tournament.rounds[tournament.currentRoundIndex + 1];
  if (!nextRound) {
    tournament.status = 'completed';
    return true;
  }

  const winners = round.matches.map(m => m.winner === 'Bye' ? (m.player1 === 'Bye' ? m.player2 : m.player1) : m.winner);
  for (let i = 0; i < nextRound.matches.length; i++) {
    const m = nextRound.matches[i];
    m.player1 = winners[i * 2] || null;
    m.player2 = winners[i * 2 + 1] || null;
    m.status = 'pending';
    if (m.player1 === 'Bye' && m.player2) {
      m.winner = m.player2;
      m.status = 'completed';
    } else if (m.player2 === 'Bye' && m.player1) {
      m.winner = m.player1;
      m.status = 'completed';
    }
  }
  tournament.currentRoundIndex++;
  while (tournament.currentRoundIndex < tournament.rounds.length) {
    const r = tournament.rounds[tournament.currentRoundIndex];
    const allComplete = r.matches.every(m => m.status === 'completed');
    if (!allComplete) break;
    const nextWinners = r.matches.map(m => m.winner);
    const nr = tournament.rounds[tournament.currentRoundIndex + 1];
    if (!nr) {
      tournament.status = 'completed';
      break;
    }
    for (let i = 0; i < nr.matches.length; i++) {
      const m = nr.matches[i];
      m.player1 = nextWinners[i * 2] || null;
      m.player2 = nextWinners[i * 2 + 1] || null;
      m.status = 'pending';
      if (m.player1 === 'Bye' && m.player2) {
        m.winner = m.player2;
        m.status = 'completed';
      } else if (m.player2 === 'Bye' && m.player1) {
        m.winner = m.player1;
        m.status = 'completed';
      }
    }
    tournament.currentRoundIndex++;
  }
  return true;
}

module.exports = {
  createTournament,
  createTournamentLobby,
  addParticipant,
  startTournament,
  generateBracket,
  getStandings,
  getNextMatches,
  advanceWinner,
};
