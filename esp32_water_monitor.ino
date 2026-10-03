/*
 * ESP32-C3 Super Mini — Water Salinity Monitor + Pump Control
 * 
 * Wiring:
 *   Relay Module  → GPIO8 (signal), 5V external (VCC), GND
 *   TDS Sensor   → GPIO2 (analog signal), 3.3V (VCC), GND
 *   DC Motor/Pump → Connected through the relay's NO (Normally Open) terminal
 * 
 * What it does:
 *   - Reads TDS sensor to check water salinity
 *   - If water is SALTY (TDS > threshold), turns ON pump to replace with fresh water
 *   - If water is FRESH (TDS < threshold), turns OFF pump
 *   - Sends status to the GitHub Pages website
 * 
 * IMPORTANT: GPIO8 is PERMANENTLY assigned to the Relay Module.
 * Do NOT use GPIO8 for anything else. It controls the pump relay.
 */

#include <WiFi.h>
#include <HTTPClient.h>

// ============ CONFIGURATION ============

const char* WIFI_SSID = "OPPO F21 Pro";
const char* WIFI_PASSWORD = "Tamwar@13092021";
const char* SERVER_URL = "https://portal704.github.io/water-monitor-beta/api/status";

// ============================================
//  RELAY MODULE — FIXED PIN: GPIO8
//  This pin is PERMANENTLY assigned to the relay.
//  The relay controls the water pump (DC motor).
//  Do NOT change this pin. Do NOT use GPIO8 for anything else.
// ============================================
const int RELAY_PIN = 8;

// ============================================
//  TDS SENSOR — FIXED PIN: GPIO2
//  This pin reads the TDS (water salinity) sensor.
//  Do NOT change this pin. Do NOT use GPIO2 for anything else.
// ============================================
const int TDS_PIN = 2;

// TDS threshold — above this = SALTY, below this = FRESH
const int TDS_THRESHOLD = 500;

const int SEND_INTERVAL = 5000;  // Send data every 5 seconds

// ============ GLOBAL VARIABLES ============

bool pumpState = false;
unsigned long lastSendTime = 0;
int lastTDSValue = 0;
unsigned long lastWiFiAttempt = 0;
const int WIFI_RETRY_DELAY = 10000;

// ============ SETUP ============

void setup() {
    Serial.begin(9600);
    delay(1000);
    
    Serial.println("\n\n=================================");
    Serial.println("ESP32-C3 Water Salinity Monitor");
    Serial.println("=================================\n");

    // Initialize relay pin — GPIO8 is ONLY for the relay
    pinMode(RELAY_PIN, OUTPUT);
    digitalWrite(RELAY_PIN, LOW);  // Pump OFF to start
    
    Serial.println("Pins initialized");
    Serial.print("Relay (Pump) pin: GPIO");
    Serial.println(RELAY_PIN);
    Serial.print("TDS sensor pin: GPIO");
    Serial.println(TDS_PIN);
    Serial.print("TDS Threshold: ");
    Serial.println(TDS_THRESHOLD);
    
    connectToWiFi();
}

// ============ MAIN LOOP ============

void loop() {
    // Only try to reconnect every 10 seconds, not constantly
    if (WiFi.status() != WL_CONNECTED && millis() - lastWiFiAttempt > WIFI_RETRY_DELAY) {
        lastWiFiAttempt = millis();
        Serial.println("WiFi disconnected, reconnecting...");
        connectToWiFi();
    }

    // Only read sensors and control relay if WiFi is connected
    if (WiFi.status() == WL_CONNECTED) {
        lastTDSValue = readTDS();
        Serial.print("TDS Value: ");
        Serial.print(lastTDSValue);
        Serial.println(" ppm");

        if (lastTDSValue > TDS_THRESHOLD) {
            setPump(true);
            Serial.println("Status: SALTY -> Pump ON (replacing with fresh water)");
        } else {
            setPump(false);
            Serial.println("Status: FRESH -> Pump OFF (water is good)");
        }

        if (millis() - lastSendTime > SEND_INTERVAL) {
            sendStatusToServer();
            lastSendTime = millis();
        }
    }

    delay(500);
}

// ============ FUNCTIONS ============

void connectToWiFi() {
    if (WiFi.status() == WL_CONNECTED) return;
    
    Serial.print("Connecting to WiFi");
    WiFi.mode(WIFI_STA);
    WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
    
    int attempts = 0;
    while (WiFi.status() != WL_CONNECTED && attempts < 20) {
        delay(500);
        Serial.print(".");
        attempts++;
    }
    
    if (WiFi.status() == WL_CONNECTED) {
        Serial.println("\nWiFi Connected!");
        Serial.print("IP Address: ");
        Serial.println(WiFi.localIP());
    } else {
        Serial.println("\nWiFi Connection Failed! Will retry in 10 seconds...");
    }
}

int readTDS() {
    int rawValue = analogRead(TDS_PIN);
    float voltage = rawValue * (3.3 / 4095.0);
    float tdsValue = (133.42 * voltage * voltage * voltage) - (255.86 * voltage * voltage) + (857.39 * voltage);
    if (tdsValue < 0) tdsValue = 0;
    return (int)tdsValue;
}

void setPump(bool state) {
    pumpState = state;
    digitalWrite(RELAY_PIN, state ? HIGH : LOW);
    Serial.print("Pump set to: ");
    Serial.println(state ? "ON" : "OFF");
}

void sendStatusToServer() {
    if (WiFi.status() != WL_CONNECTED) return;
    
    HTTPClient http;
    http.begin(SERVER_URL);
    http.addHeader("Content-Type", "application/json");
    
    String payload = "{";
    payload += "\"relay\":" + String(pumpState ? "true" : "false") + ",";
    payload += "\"tds\":" + String(lastTDSValue) + ",";
    payload += "\"timestamp\":" + String(millis() / 1000);
    payload += "}";
    
    int httpCode = http.POST(payload);
    
    if (httpCode > 0) {
        Serial.print("Status sent. Response: ");
        Serial.println(httpCode);
    } else {
        Serial.print("Failed to send. Error: ");
        Serial.println(http.errorToString(httpCode));
    }
    
    http.end();
}
