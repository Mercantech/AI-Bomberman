/**
 * Bomberman Controller - Arduino MKR WiFi 1010 + MKR IoT Carrier (Oplà)
 * Trådløs over WiFi – sender input til spil-server via HTTP.
 * Virker selvom Arduino og server er på forskellige netværk (server skal være tilgængelig).
 *
 * OBS: Rediger WIFI_SSID, WIFI_PASS, SERVER_HOST og GAME_PIN før upload.
 *
 * Knap-layout: TOUCH0=Op, TOUCH1=Ned, TOUCH2=Venstre, TOUCH3=Højre, TOUCH4=Bombe
 */

#include <Arduino_MKRIoTCarrier.h>
#include <WiFiNINA.h>
#include <ArduinoHttpClient.h>

MKRIoTCarrier carrier;

// ========== KONFIGURATION – ændr til dit netværk og server ==========
#define WIFI_SSID      "NETGEAR25-5G"
#define WIFI_PASS      "fuzzysocks666"
#define SERVER_HOST    "bomberman.mercantec.tech"  // Eller IP fx "192.168.1.100"
#define SERVER_PORT    8888                         // 8080 lokalt, 8888 Docker. Ved HTTPS brug 443 og WiFiSSLClient
#define GAME_PIN       "1234"                       // PIN fra admin-spillet
#define PLAYER_NAME    "Arduino"                    // Dit spillernavn
// ====================================================================

#define BTN_UP    TOUCH0
#define BTN_DOWN  TOUCH1
#define BTN_LEFT  TOUCH2
#define BTN_RIGHT TOUCH3
#define BTN_BOMB  TOUCH4

const unsigned long DEBOUNCE_MS = 80;
unsigned long lastUp = 0, lastDown = 0, lastLeft = 0, lastRight = 0, lastBomb = 0;

String playerId;
WiFiClient wifi;
HttpClient client = HttpClient(wifi, SERVER_HOST, SERVER_PORT);

void showStatus(const char* msg, uint16_t color = ST77XX_WHITE) {
  carrier.display.fillScreen(ST77XX_BLACK);
  carrier.display.setTextColor(color);
  carrier.display.setTextSize(2);
  carrier.display.setCursor(10, 100);
  carrier.display.print(msg);
}

void sendInput(const char* action, const char* direction = nullptr) {
  if (playerId.length() == 0) return;

  String path = "/api/controller/input";
  String body = "{\"pin\":\"" + String(GAME_PIN) + "\",\"playerId\":\"" + playerId + "\",\"action\":\"" + String(action) + "\"";
  if (direction) body += ",\"direction\":\"" + String(direction) + "\"";
  body += "}";

  client.beginRequest();
  client.post(path);
  client.sendHeader("Content-Type", "application/json");
  client.sendHeader("Content-Length", body.length());
  client.beginBody();
  client.print(body);
  client.endRequest();
}

bool doJoin() {
  String path = "/api/controller/join";
  String body = "{\"pin\":\"" + String(GAME_PIN) + "\",\"name\":\"" + String(PLAYER_NAME) + "\"}";

  client.beginRequest();
  client.post(path);
  client.sendHeader("Content-Type", "application/json");
  client.sendHeader("Content-Length", body.length());
  client.beginBody();
  client.print(body);
  client.endRequest();

  int status = client.responseStatusCode();
  String resp = client.responseBody();

  if (status == 200 && resp.indexOf("\"playerId\"") >= 0) {
    int start = resp.indexOf("\"playerId\":\"") + 12;
    int end = resp.indexOf("\"", start);
    playerId = resp.substring(start, end);
    return true;
  }
  return false;
}

void setup() {
  Serial.begin(115200);
  carrier.noCase();
  carrier.begin();

  showStatus("WiFi...", ST77XX_YELLOW);

  WiFi.begin(WIFI_SSID, WIFI_PASS);
  int w = 0;
  while (WiFi.status() != WL_CONNECTED && w < 20) {
    delay(500);
    w++;
  }

  if (WiFi.status() != WL_CONNECTED) {
    showStatus("WiFi FEJL", ST77XX_RED);
    return;
  }

  showStatus("Joiner...", ST77XX_YELLOW);
  delay(500);

  if (!doJoin()) {
    showStatus("Join FEJL", ST77XX_RED);
    return;
  }

  showStatus("Klar!", ST77XX_GREEN);
}

void loop() {
  if (playerId.length() == 0) {
    delay(1000);
    return;
  }

  carrier.Buttons.update();
  unsigned long now = millis();

  // Hold knap = gentag bevægelse (som tastatur)
  if (carrier.Buttons.getTouch(BTN_UP)) {
    if (now - lastUp > DEBOUNCE_MS) { sendInput("move", "UP"); lastUp = now; }
  }
  if (carrier.Buttons.getTouch(BTN_DOWN)) {
    if (now - lastDown > DEBOUNCE_MS) { sendInput("move", "DOWN"); lastDown = now; }
  }
  if (carrier.Buttons.getTouch(BTN_LEFT)) {
    if (now - lastLeft > DEBOUNCE_MS) { sendInput("move", "LEFT"); lastLeft = now; }
  }
  if (carrier.Buttons.getTouch(BTN_RIGHT)) {
    if (now - lastRight > DEBOUNCE_MS) { sendInput("move", "RIGHT"); lastRight = now; }
  }

  if (carrier.Buttons.onTouchDown(BTN_BOMB) && now - lastBomb > DEBOUNCE_MS) {
    sendInput("bomb");
    lastBomb = now;
  }

  // Gesture som backup
  if (carrier.Light.gestureAvailable()) {
    uint8_t g = carrier.Light.readGesture();
    if (g == UP)   sendInput("move", "UP");
    if (g == DOWN) sendInput("move", "DOWN");
    if (g == LEFT) sendInput("move", "LEFT");
    if (g == RIGHT) sendInput("move", "RIGHT");
  }

  delay(20);
}
