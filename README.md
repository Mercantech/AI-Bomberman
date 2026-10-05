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

## Flow

1. **Admin** går til `/admin.html` for at oprette et spil med PIN og bane-størrelse (9×9 til 21×21)
2. **Spillere** går til forsiden, indtaster PIN og trykker "Join spil"
3. Når alle er klar, trykkes "Start spil"

## Admin-side

- **Opret spil**: Vælg PIN (eller lad den genereres) og bane-størrelse
- **Aktive spil**: Se alle lobbies med PIN, spillere, status
- **Afslut session**: Luk et spil og kick alle spillere

## Spectator

- Gå til `/spectate.html`
- Indtast PIN for at se spillet som tilskuer uden at deltage

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
