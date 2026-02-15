"""
PlatformIO extra script: tilføjer target 'certificate' til upload af SSL-rootcertifikat
til NINA-modulet på MKR WiFi 1010 (nødvendigt for HTTPS til fx Cloudflare).

Brug:  pio run -t certificate
Kræver: arduino-fwuploader (npm install -g @arduino/arduino-fwuploader)
        Eller Arduino IDE 2 installeret (så er fwuploader ofte i PATH).
"""
Import("env")

# Domæne fra koden – skal matche SERVER_HOST i main.cpp
CERT_DOMAIN = "bomberman.mercantec.tech"
FQBN = "arduino:samd:mkrwifi1010"

def run_certificate_upload(source, target, env):
    port = env.get("UPLOAD_PORT")
    if not port:
        print("")
        print("UPLOAD_PORT ikke sat. Tilslut boardet og kør fx:")
        print("  pio run -t upload          (så detectes port)")
        print("  pio run -t certificate     (kør igen efter port er kendt)")
        print("Eller sæt upload_port i platformio.ini, fx: upload_port = COM3")
        print("")
        env.Exit(1)
    cmd = [
        "arduino-fwuploader", "certificates", "flash",
        "--fqbn", FQBN,
        "--address", port,
        "--url", CERT_DOMAIN + ":443"
    ]
    print("Uploader SSL-certifikat for %s til NINA-modulet på %s ..." % (CERT_DOMAIN, port))
    print("(Luk Serial Monitor først hvis den kører.)")
    try:
        env.Execute(" ".join(cmd))
    except Exception as e:
        print("")
        print("Fejl: Kunne ikke køre arduino-fwuploader.")
        print("Installér værktøjet: npm install -g @arduino/arduino-fwuploader")
        print("Eller brug Arduino IDE: Værktøjer → Upload Root Certificates")
        print("")
        env.Exit(1)

env.AddCustomTarget(
    name="certificate",
    dependencies=None,
    actions=[run_certificate_upload],
    title="Upload SSL certificate",
    description="Upload root certificate for %s to NINA (HTTPS)" % CERT_DOMAIN
)
