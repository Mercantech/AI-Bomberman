/**
 * Fælles controller-logik for HTTP og MQTT (Oplà).
 */

function createControllerService(deps) {
  const { lobbies, allocatePlayerId, broadcastToLobby, applyGameInput } = deps;

  function ensureControllerMaps(lobby) {
    if (!lobby.controllerPlayers) lobby.controllerPlayers = new Map();
    if (!lobby.controllerDevices) lobby.controllerDevices = new Map();
  }

  function controllerJoin(pinStr, { name, deviceId }) {
    const lobby = lobbies.get(pinStr);
    if (!lobby) {
      return { status: 404, body: { ok: false, error: 'Ugyldig eller ukendt PIN' } };
    }

    ensureControllerMaps(lobby);
    const devKey = deviceId ? String(deviceId).trim().slice(0, 40) : null;

    if (devKey && lobby.controllerDevices.has(devKey)) {
      const existingId = lobby.controllerDevices.get(devKey);
      const meta = lobby.controllerPlayers.get(existingId);
      if (meta && lobby.game.players.has(existingId)) {
        console.log('[CONTROLLER JOIN] Reconnect deviceId=%s playerId=%s', devKey, existingId);
        return {
          status: 200,
          body: { ok: true, playerId: existingId, name: meta.name, reconnected: true },
        };
      }
      lobby.controllerDevices.delete(devKey);
    }

    const playerId = allocatePlayerId();
    const displayName = name ? String(name).trim().slice(0, 20) : `Arduino ${playerId.replace('player_', '')}`;
    lobby.game.addPlayer(playerId, displayName);
    lobby.controllerPlayers.set(playerId, {
      name: displayName,
      deviceId: devKey,
    });
    if (devKey) lobby.controllerDevices.set(devKey, playerId);

    broadcastToLobby(pinStr, { type: 'state', data: lobby.game.getState() });
    console.log('[CONTROLLER JOIN] OK playerId=%s name=%s pin=%s', playerId, displayName, pinStr);
    return { status: 200, body: { ok: true, playerId, name: displayName } };
  }

  function controllerHeartbeat(pinStr, playerId) {
    const lobby = lobbies.get(pinStr);
    if (!lobby) {
      return { status: 404, body: { ok: false, error: 'Lobby ikke fundet' } };
    }
    if (playerId && !lobby.controllerPlayers?.has(playerId)) {
      return { status: 403, body: { ok: false, error: 'Ugyldig controller' } };
    }
    return { status: 200, body: { ok: true } };
  }

  function controllerAction(pinStr, playerId, { action, direction, params }) {
    const lobby = lobbies.get(pinStr);
    if (!lobby) {
      return { status: 404, body: { ok: false, error: 'Lobby ikke fundet' } };
    }
    if (!lobby.controllerPlayers?.has(playerId)) {
      return { status: 403, body: { ok: false, error: 'Ugyldig controller' } };
    }

    const resolvedAction = action || params?.action;
    const resolvedDirection = direction || params?.direction;

    let data;
    if (resolvedAction === 'move') {
      if (!['UP', 'DOWN', 'LEFT', 'RIGHT', 'up', 'down', 'left', 'right'].includes(resolvedDirection)) {
        return { status: 400, body: { ok: false, error: 'direction påkrævet for move' } };
      }
      data = { action: 'move', direction: resolvedDirection };
    } else if (resolvedAction === 'bomb') {
      data = { action: 'bomb' };
    } else {
      return { status: 400, body: { ok: false, error: 'Ukendt action' } };
    }

    applyGameInput(pinStr, playerId, data);
    return { status: 200, body: { ok: true } };
  }

  return {
    controllerJoin,
    controllerHeartbeat,
    controllerAction,
  };
}

module.exports = { createControllerService };
