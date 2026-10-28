# AI-Bomberman

Klassisk Bomberman multiplayer spil med WebSockets.

**Live:** [https://games.mercantec.tech/Bomberman](https://games.mercantec.tech/Bomberman)

Portal: [https://games.mercantec.tech/](https://games.mercantec.tech/)

## Arkitektur

- **Backend** (`server/`): Node.js WebSocket server + HTTP controller-API + valgfri **MQTT-bridge** til Oplà
- **Frontend** (`public/`): HTML, CSS og vanilla JavaScript der subscriber til serveren og sender inputs
- **Browser:** WebSocket. **Oplà:** HTTP (default) eller MQTT (Bomberman only)

## Kør spillet

```bash
cd server
npm install
npm start
```

Åbn derefter http://localhost:8080 i browseren.

### Docker + MQTT (lokal)

```bash
# Terminal 1 — broker (Games-repo)
cd ../Games/mqtt
docker compose -f docker-compose.yml -f docker-compose.local.yml up -d

# Terminal 2 — Bomberman
cd AI-Bomberman
docker compose -f docker-compose.yml -f docker-compose.local.yml up --build
```

Sæt `MQTT_ENABLED=1`, `MQTT_URL=mqtt://host.docker.internal:1883` (Windows/Mac).

## Flow (elever — åben lobby)

1. Gå til forsiden → **Opret spil** (vælg banestørrelse) eller **Join med PIN** / vælg en åben lobby
2. I waiting-room: se spillere, del PIN, tryk **Klar**, og **Start spil**
3. Spil med pile/WASD + mellemrum (eller Oplà-pad)

Offentlig API: `GET/POST /api/lobbies` (kun waiting-lobbies i listen).

## Admin / lærer-værktøj

`/admin.html` er sekundært — elever behøver det ikke.

- Opret spil med valgfri fast PIN
- Se alle aktive lobbies
- Afslut session (kick alle)

## Spectator

- Gå til `/spectate.html`
- Indtast PIN for at se spillet som tilskuer uden at deltage
- Tryk **Start spil** på Spectate-siden, når mindst én spiller er med, og lobbyen venter. Det virker også med kun Arduino-spillere.
- Tilskueren optager ingen spillerplads. Startknappen er deaktiveret under spillet og ved mistet forbindelse.

## Styring

- **Pil eller WASD**: Bevæg spiller
- **Mellemrum**: Placer bombe

## Arduino Oplà controller (trådløs)

Arduino MKR WiFi 1010 + MKR IoT Carrier — se Mercantec Games [`arduino/MercantecGamesController`](https://github.com/Mercantech/Games/tree/main/arduino/MercantecGamesController).

- **HTTP:** `POST /Bomberman/api/controller/join|heartbeat|action` (som i dag)
- **MQTT:** broker `games-mqtt.mercantec.tech:8883` (MQTTS), topics under `mercantec/bomberman/v1`

### MQTT topics

| Retning | Topic |
|---------|--------|
| Pad → | `{prefix}/{pin}/join` |
| Pad → | `{prefix}/{pin}/action/{playerId}` |
| Pad → | `{prefix}/{pin}/heartbeat/{playerId}` |
| Server → | `{prefix}/{pin}/join/resp/{deviceId}` |
| Server → | `{prefix}/{pin}/error/{deviceId}` |

Default `{prefix}` = `mercantec/bomberman/v1`.

### Server env (Dokploy)

| Variabel | Beskrivelse |
|----------|-------------|
| `MQTT_ENABLED` | `1` for at starte bridge |
| `MQTT_URL` | Internt fx `mqtt://games-mqtt:1883` på `dokploy-network` |
| `MQTT_USERNAME` / `MQTT_PASSWORD` | Bruger `bomberman-server` |
| `MQTT_TOPIC_PREFIX` | Default `mercantec/bomberman/v1` |

Broker-drift: [`Games/mqtt/README.md`](https://github.com/Mercantech/Games/tree/main/mqtt).

Legacy reference: `iot/README.md`.
