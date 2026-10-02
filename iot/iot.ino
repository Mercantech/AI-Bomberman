/**
 * Bomberman Controller - Arduino MKR WiFi 1010 + MKR IoT Carrier (Oplà)
 * Trådløs over WiFi – sender input til spil-server via HTTP.
 *
 * Fælles controller-kontrakt (samme som Wizard Duel):
 *   POST {GAME_BASE_PATH}/api/controller/join
 *   POST {GAME_BASE_PATH}/api/controller/heartbeat
 *   POST {GAME_BASE_PATH}/api/controller/action
 *
 * Knap-layout (Nav-profil): TOUCH0=Op, TOUCH1=Ned, TOUCH2=Venstre, TOUCH3=Højre, TOUCH4=Bombe
 */

#include <Arduino_MKRIoTCarrier.h>
#include <WiFiNINA.h>
#include <ArduinoHttpClient.h>

MKRIoTCarrier carrier;

// ========== KONFIGURATION – ændr til dit netværk og spil ==========
#define WIFI_SSID       "WIFI_NAVN_HER"
#define WIFI_PASS       "WIFI_PASSWORD_HER"
#define SERVER_HOST     "games.mercantec.tech"
#define GAME_BASE_PATH  "/Bomberman"   // Skift til "/Wizard" for Wizard Duel
#define GAME_PIN        "1234"         // PIN fra admin-spillet
#define PLAYER_NAME     "Arduino"

// 1 = HTTPS (port 443). 0 = HTTP (port 80) – brug 0 kun lokalt.
#define USE_HTTPS       1

#if USE_HTTPS
  #define SERVER_PORT 443
#else
  #define SERVER_PORT 80
#endif
// ====================================================================

#define BTN_UP    TOUCH0
#define BTN_DOWN  TOUCH1
#define BTN_LEFT  TOUCH2
#define BTN_RIGHT TOUCH3
#define BTN_BOMB  TOUCH4

const unsigned long DEBOUNCE_MS = 80;
const unsigned long HEARTBEAT_MS = 4000;
unsigned long lastUp = 0, lastDown = 0, lastLeft = 0, lastRight = 0, lastBomb = 0, lastHeartbeat = 0;

String playerId;
String deviceId;

#if USE_HTTPS
  WiFiSSLClient wifi;
#else
  WiFiClient wifi;
#endif
HttpClient client = HttpClient(wifi, SERVER_HOST, SERVER_PORT);

#define HTTP_TIMEOUT_MS 15000

String apiPath(const char* endpoint) {
  return String(GAME_BASE_PATH) + endpoint;
}

void showStatus(const char* msg, uint16_t color = ST77XX_WHITE) {
  carrier.display.fillScreen(ST77XX_BLACK);
  carrier.display.setTextColor(color);
  carrier.display.setTextSize(2);
  carrier.display.setCursor(10, 100);
  carrier.display.print(msg);
}

void showStatus2(const char* line1, const char* line2, uint16_t color = ST77XX_WHITE) {
  carrier.display.fillScreen(ST77XX_BLACK);
  carrier.display.setTextColor(color);
  carrier.display.setTextSize(2);
  carrier.display.setCursor(10, 80);
  carrier.display.print(line1);
  carrier.display.setCursor(10, 110);
  carrier.display.print(line2);
}

void buildDeviceId() {
  byte mac[6];
  WiFi.macAddress(mac);
  char buf[16];
  sprintf(buf, "OPLA_%02X%02X%02X", mac[3], mac[4], mac[5]);
  deviceId = String(buf);
}

bool httpPost(const String& path, const String& body, String& responseBody) {
  wifi.setTimeout(HTTP_TIMEOUT_MS / 1000);
  client.beginRequest();
  client.post(path);
  client.sendHeader("Content-Type", "application/json");
  client.sendHeader("Content-Length", body.length());
  client.beginBody();
  client.print(body);
  client.endRequest();

  int status = client.responseStatusCode();
  responseBody = client.responseBody();
  return status == 200;
}

void sendAction(const char* action, const char* direction = nullptr) {
  if (playerId.length() == 0) return;

  String path = apiPath("/api/controller/action");
  String body = "{\"pin\":\"" + String(GAME_PIN) +
                "\",\"playerId\":\"" + playerId +
                "\",\"deviceId\":\"" + deviceId +
                "\",\"action\":\"" + String(action) + "\"";
  if (direction) {
    body += ",\"params\":{\"direction\":\"" + String(direction) + "\"}";
    body += ",\"direction\":\"" + String(direction) + "\"";
  }
  body += "}";

  String resp;
  httpPost(path, body, resp);
}

void sendHeartbeat() {
  if (playerId.length() == 0) return;
  String path = apiPath("/api/controller/heartbeat");
  String body = "{\"pin\":\"" + String(GAME_PIN) +
                "\",\"playerId\":\"" + playerId +
                "\",\"deviceId\":\"" + deviceId + "\"}";
  String resp;
  httpPost(path, body, resp);
}

bool doJoin() {
  String path = apiPath("/api/controller/join");
  String body = "{\"pin\":\"" + String(GAME_PIN) +
                "\",\"name\":\"" + String(PLAYER_NAME) +
                "\",\"deviceId\":\"" + deviceId + "\"}";

  Serial.println("========== JOIN REQUEST ==========");
  Serial.print("[JOIN] Host: ");
  Serial.print(SERVER_HOST);
  Serial.print(":");
  Serial.println(SERVER_PORT);
  Serial.print("[JOIN] Path: ");
  Serial.println(path);
  Serial.print("[JOIN] Body: ");
  Serial.println(body);

  String resp;
  bool ok = httpPost(path, body, resp);
  Serial.print("[JOIN] Response: ");
  Serial.println(resp);

  if (ok && resp.indexOf("\"playerId\"") >= 0) {
    int start = resp.indexOf("\"playerId\":\"") + 12;
    int end = resp.indexOf("\"", start);
    playerId = resp.substring(start, end);
    Serial.print("[JOIN] OK! playerId=");
    Serial.println(playerId);
    return true;
  }
  return false;
}

void setup() {
  Serial.begin(115200);
  delay(500);
  Serial.println("\n\n========== BOMBERMAN CONTROLLER START ==========");

  carrier.noCase();
  carrier.begin();

  showStatus("Tilslutter WiFi...", ST77XX_YELLOW);
  WiFi.begin(WIFI_SSID, WIFI_PASS);
  int w = 0;
  while (WiFi.status() != WL_CONNECTED && w < 20) {
    delay(500);
    w++;
  }

  if (WiFi.status() != WL_CONNECTED) {
    showStatus2("WiFi fejl", "Tjek SSID/password", ST77XX_RED);
    return;
  }

  buildDeviceId();
  Serial.print("[ID] deviceId=");
  Serial.println(deviceId);

  {
    String line2 = "PIN: " + String(GAME_PIN);
    showStatus2("Joiner spil...", line2.c_str(), ST77XX_YELLOW);
  }
  delay(500);

  if (!doJoin()) {
    showStatus2("Join fejl!", "Tjek PIN + server", ST77XX_RED);
    return;
  }

  showStatus("Klar! Spil!", ST77XX_GREEN);
  lastHeartbeat = millis();
}

void loop() {
  if (playerId.length() == 0) {
    delay(1000);
    return;
  }

  unsigned long now = millis();
  if (now - lastHeartbeat > HEARTBEAT_MS) {
    sendHeartbeat();
    lastHeartbeat = now;
  }

  carrier.Buttons.update();

  if (carrier.Buttons.getTouch(BTN_UP)) {
    if (now - lastUp > DEBOUNCE_MS) { sendAction("move", "UP"); lastUp = now; }
  }
  if (carrier.Buttons.getTouch(BTN_DOWN)) {
    if (now - lastDown > DEBOUNCE_MS) { sendAction("move", "DOWN"); lastDown = now; }
  }
  if (carrier.Buttons.getTouch(BTN_LEFT)) {
    if (now - lastLeft > DEBOUNCE_MS) { sendAction("move", "LEFT"); lastLeft = now; }
  }
  if (carrier.Buttons.getTouch(BTN_RIGHT)) {
    if (now - lastRight > DEBOUNCE_MS) { sendAction("move", "RIGHT"); lastRight = now; }
  }

  if (carrier.Buttons.onTouchDown(BTN_BOMB) && now - lastBomb > DEBOUNCE_MS) {
    sendAction("bomb");
    lastBomb = now;
  }

  if (carrier.Light.gestureAvailable()) {
    uint8_t g = carrier.Light.readGesture();
    if (g == UP)   sendAction("move", "UP");
    if (g == DOWN) sendAction("move", "DOWN");
    if (g == LEFT) sendAction("move", "LEFT");
    if (g == RIGHT) sendAction("move", "RIGHT");
  }

  delay(20);
}
