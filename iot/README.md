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
| `SERVER_HOST` | Serverens adresse (fx `192.168.1.100` eller `bomberman.mercantec.tech`) |
| `SERVER_PORT` | Port (8080 lokalt, 8888 ved Docker)              |
| `GAME_PIN`    | PIN fra admin-spillet                            |
| `PLAYER_NAME` | Dit spillernavn (fx "Arduino" eller dit navn)    |

## Installation

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

## Fejlfinding

- **"WiFi FEJL"**: Tjek SSID og adgangskode
- **"Join FEJL"**: Tjek at spillet er oprettet med samme PIN, og at serveren kører og er tilgængelig fra Arduinos netværk
