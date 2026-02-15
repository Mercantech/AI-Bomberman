# Bomberman Arduino Oplà Controller (trådløs)

Trådløs controller til Bomberman via MKR WiFi 1010 + MKR IoT Carrier. Arduino og server kan være på forskellige maskiner og netværk – Arduino forbinder til WiFi og sender input til serveren via HTTP.

## Hardware

- **Arduino MKR WiFi 1010** monteret på **MKR IoT Carrier** (Oplà)
- Ingen USB til computer under spil – kun strøm (fx batteri eller USB-lader)

## Konfiguration

Åbn `iot.ino` og rediger øverst:

| Variabel      | Beskrivelse                                      |
|---------------|--------------------------------------------------|
| `WIFI_SSID`   | Dit WiFi netværksnavn                            |
| `WIFI_PASS`   | WiFi-adgangskode                                 |
| `SERVER_HOST` | **På tværs af netværk:** jeres offentlige domæne (fx `bomberman.mercantec.tech`). Lokalt: PC'ens IP. |
| `USE_HTTPS`   | 1 = HTTPS til offentligt domæne (virker overalt). 0 = kun lokalt samme net. |
| `GAME_PIN`    | PIN fra admin-spillet                            |
| `PLAYER_NAME` | Dit spillernavn (fx "Arduino" eller dit navn)    |

## Installation

### PlatformIO (anbefalet)

```bash
cd iot
pio run -t upload    # Build og upload
pio device monitor   # Serial Monitor (115200 baud)
```

### Arduino IDE

1. Installer biblioteker i Arduino IDE:
   - **Arduino_MKRIoTCarrier**
   - **WiFiNINA** (følger med MKR WiFi 1010)
   - **ArduinoHttpClient**
2. Vælg board: **Arduino MKR WiFi 1010**
3. Upload sketch til Arduino

## Knap-layout

| Knap    | Funktion  |
|---------|-----------|
| TOUCH0  | Op        |
| TOUCH1  | Ned       |
| TOUCH2  | Venstre   |
| TOUCH3  | Højre     |
| TOUCH4  | Bombe     |

Swipe på gesture-sensoren virker også som bevægelse.

## Flow

1. **Admin** opretter spil på admin.html med en PIN
2. **Arduino** tændes – forbinder til WiFi og joiner automatisk med PIN + navn
3. Display viser "Klar!" når forbindelsen lykkes
4. **Start spillet** fra admin/browser
5. Spil med touch-knapperne – spilleren vises på skærmen sammen med de andre

## Netværk

- **Samme net**: Brug serverens lokale IP (fx `192.168.1.100`) og port 8080/8888
- **Forskellige net**: Serveren skal være tilgængelig fra internettet (fx via port-forwarding eller cloud). Brug serverens offentlige adresse og port

## Cloudflare Tunnel / HTTPS

Projektet bruger **HTTPS** som standard (`USE_HTTPS 1`). Når serveren er bag **Cloudflare Tunnel**, bruger Arduino Cloudflares edge. Boardets indbyggede CA-liste inkluderer ofte ikke den CA, så I kan få **status -3** eller timeout. Løsning: upload rod-certifikat **én gang per board**.

### Certifikat-upload med PlatformIO

1. Installér værktøjet (én gang på PC’en):  
   `npm install -g @arduino/arduino-fwuploader`
2. Tilslut MKR WiFi 1010. Luk Serial Monitor hvis den kører.
3. Kør:  
   `pio run -t certificate`  
   Hvis port ikke findes: kør først `pio run -t upload` (så detectes port), eller sæt `upload_port = COM3` (eller din port) under `[env:mkrwifi1010]` i `platformio.ini`.
4. Efter upload virker HTTPS til jeres domæne uden flere certifikat-trin.

### Certifikat-upload med Arduino IDE

**Værktøjer** → **Upload Root Certificates** → **Add New** → indtast fx `bomberman.mercantec.tech:443` → vælg MKR WiFi 1010 → **Upload**. Luk Serial Monitor først.

## Fejlfinding

- **"WiFi FEJL"**: Tjek SSID og adgangskode
- **"Join FEJL"**: Tjek at spillet er oprettet med samme PIN, og at serveren kører og er tilgængelig fra Arduinos netværk
- **Status -3 / timeout ved join**: Typisk SSL/certifikat – upload rod-certifikat én gang (se "Certifikat-upload" ovenfor)
