# AI-Bomberman

Klassisk Bomberman multiplayer spil med WebSockets.

**Live:** [https://bomberman.mercantec.tech/](https://bomberman.mercantec.tech/)

## Arkitektur

- **Backend** (`server/`): Standalone Node.js WebSocket server med al spil-logik og state
- **Frontend** (`public/`): HTML, CSS og vanilla JavaScript der subscriber til serveren og sender inputs

## Kør spillet

```bash
cd server
npm install
npm start
```

Åbn derefter http://localhost:8080 i browseren.

## Flow

1. **Admin** går til `/admin.html` for at oprette et spil med PIN og bane-størrelse (9×9 til 21×21)
2. **Spillere** går til forsiden, indtaster PIN og trykker "Join spil"
3. Når alle er klar, trykkes "Start spil"

## Admin-side

- **Opret spil**: Vælg PIN (eller lad den genereres) og bane-størrelse
- **Aktive spil**: Se alle lobbies med PIN, spillere, status
- **Afslut session**: Luk et spil og kick alle spillere

## Turnering (lobby-baseret)

- Gå til `/tournament.html`
- **Opret turnering**: Vælg kamptype (en efter hinanden / parallelt) og max antal deltagere (2–32, fx 28 elever). Du får en **join-kode** og et link.
- **Elever/deltagere**: Åbn linket (fx `tournament.html?code=ABC123`) eller indtast koden, skriv navn og tryk "Join". Op til 28 (eller det valgte max) kan tilmelde sig.
- **Start**: Når mindst 2 er tilmeldt, kan arrangøren trykke "Start turnering". Bracket genereres, og du starter hver kamp med "Start kamp"; spillere deltager via PIN som normalt. Vinderen avancerer automatisk.

## Spectator

- Gå til `/spectate.html`
- Indtast PIN for at se spillet som tilskuer uden at deltage

## Styring

- **Pil eller WASD**: Bevæg spiller
- **Mellemrum**: Placer bombe
