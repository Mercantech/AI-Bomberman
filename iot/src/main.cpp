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
#define WIFI_SSID      "NETGEAR25"
#define WIFI_PASS      "fuzzysocks666"
// På tværs af netværk: brug altid jeres offentlige domæne (fx Cloudflare Tunnel). Samme kode virker overalt.
// Kun lokalt på samme WiFi: kan sættes til PC'ens IP (fx 192.168.1.15) og USE_HTTPS 0, port 8080.
#define SERVER_HOST    "bomberman.mercantec.tech"
#define GAME_PIN       "1234"                       // PIN fra admin-spillet
#define PLAYER_NAME    "Arduino"                    // Dit spillernavn

// 1 = HTTPS (port 443, kræver cert-upload). 0 = HTTP (port 80) – virker når "Always Use HTTPS" er slået fra i Cloudflare.
#define USE_HTTPS      0

#if USE_HTTPS
  #define SERVER_PORT 443
#else
  #define SERVER_PORT 80     // HTTP til offentligt domæne; brug 8080 kun ved lokalt IP
#endif
// ====================================================================

#define BTN_UP    TOUCH0
#define BTN_DOWN  TOUCH1
#define BTN_LEFT  TOUCH2
#define BTN_RIGHT TOUCH3
#define BTN_BOMB  TOUCH4

const unsigned long DEBOUNCE_MS = 80;
unsigned long lastUp = 0, lastDown = 0, lastLeft = 0, lastRight = 0, lastBomb = 0;

String playerId;
#if USE_HTTPS
  WiFiSSLClient wifi;
#else
  WiFiClient wifi;
#endif
HttpClient client = HttpClient(wifi, SERVER_HOST, SERVER_PORT);

#define HTTP_TIMEOUT_MS 15000  // 15 sek – undgå evig venten ved joiner

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

  Serial.println("========== JOIN REQUEST ==========");
  Serial.print("[JOIN] Host: ");
  Serial.print(SERVER_HOST);
  Serial.print(":");
  Serial.println(SERVER_PORT);
  Serial.print("[JOIN] Path: ");
  Serial.println(path);
  Serial.print("[JOIN] Body: ");
  Serial.println(body);
  Serial.println("[JOIN] Sending HTTP POST...");

  unsigned long t0 = millis();
  wifi.setTimeout(HTTP_TIMEOUT_MS / 1000);

  client.beginRequest();
  client.post(path);
  client.sendHeader("Content-Type", "application/json");
  client.sendHeader("Content-Length", body.length());
  client.beginBody();
  client.print(body);
  client.endRequest();

  Serial.print("[JOIN] Waiting for responseStatusCode()... (timeout ");
  Serial.print(HTTP_TIMEOUT_MS / 1000);
  Serial.println("s)");

  int status = client.responseStatusCode();

  unsigned long elapsed = millis() - t0;
  Serial.print("[JOIN] Got status code: ");
  Serial.print(status);
  Serial.print(" (took ");
  Serial.print(elapsed);
  Serial.println(" ms)");

  String resp = client.responseBody();
  Serial.print("[JOIN] Response body: ");
  Serial.println(resp);
  Serial.println("================================");

  if (status == 200 && resp.indexOf("\"playerId\"") >= 0) {
    int start = resp.indexOf("\"playerId\":\"") + 12;
    int end = resp.indexOf("\"", start);
    playerId = resp.substring(start, end);
    Serial.print("[JOIN] OK! playerId=");
    Serial.println(playerId);
    return true;
  }

  Serial.print("[JOIN] FAILED: status=");
  Serial.print(status);
  Serial.print(" hasPlayerId=");
  Serial.println(resp.indexOf("\"playerId\"") >= 0 ? "yes" : "no");
  return false;
}

void setup() {
  Serial.begin(115200);
  delay(500);  // Lad Serial stabilisere
  Serial.println("\n\n========== BOMBERMAN CONTROLLER START ==========");
  Serial.println("[INIT] Serial OK (115200)");

  carrier.noCase();
  carrier.begin();
  Serial.println("[INIT] Carrier/display OK");

  showStatus("Tilslutter WiFi...", ST77XX_YELLOW);
  Serial.print("[WIFI] Connecting to ");
  Serial.print(WIFI_SSID);
  Serial.println("...");

  WiFi.begin(WIFI_SSID, WIFI_PASS);
  int w = 0;
  while (WiFi.status() != WL_CONNECTED && w < 20) {
    delay(500);
    w++;
    Serial.print("[WIFI] Attempt ");
    Serial.print(w);
    Serial.print("/20, status=");
    Serial.println(WiFi.status());
  }

  if (WiFi.status() != WL_CONNECTED) {
    showStatus2("WiFi fejl", "Tjek SSID/password", ST77XX_RED);
    Serial.println("[WIFI] FAILED - not connected!");
    Serial.print("[WIFI] Final status=");
    Serial.println(WiFi.status());
    return;
  }

  Serial.println("[WIFI] Connected!");
  Serial.print("[WIFI] IP: ");
  Serial.println(WiFi.localIP());
  Serial.print("[WIFI] Signal: ");
  Serial.print(WiFi.RSSI());
  Serial.println(" dBm");

  {
    String line2 = "PIN: " + String(GAME_PIN);
    showStatus2("Joiner spil...", line2.c_str(), ST77XX_YELLOW);
  }
  Serial.println("[JOIN] About to join game...");
  delay(500);

  if (!doJoin()) {
    showStatus2("Join fejl!", "Tjek PIN + server", ST77XX_RED);
    Serial.println("[SETUP] Join failed - controller stopped");
    return;
  }

  showStatus("Klar! Spil!", ST77XX_GREEN);
  Serial.println("[SETUP] SUCCESS - controller ready!");
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