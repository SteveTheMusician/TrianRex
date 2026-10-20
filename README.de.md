[English](README.md) | **Deutsch**

# 🦖 TrianRex

![Version](https://img.shields.io/badge/Version-0.9-purple)
![Affinity](https://img.shields.io/badge/Affinity_Designer-3.0+-1D63ED)
![Language](https://img.shields.io/badge/Sprache-JavaScript-yellow)
![Status](https://img.shields.io/badge/Status-Beta-orange)
![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)

> **Triangulation für Affinity Designer** — verwandle jedes Vektorobjekt in ein 
> individuelles Netz aus Dreiecken und erschaffe so dein eigenes Polygon-Kunstwerk.


<p align="center">
  <img src="images/TrianRexIcon.jpg" alt="TrianRex Icon" width="200" height="200">
</p>
---

## 📥 Download

⬇️ **[TrianRex v0.9.8 herunterladen](downloads/TrianRex_v0.9.8.afscript)**
⬇️ **[TrianRex v0.9 herunterladen](downloads/TrianRex_v0.9.afscript)**

## ✨ Funktionen

| Feature | Beschreibung |
|---------|--------------|
| 🎯 **Formgenaue Triangulation** | Die Dreiecke folgen exakt der Außenkontur des Objekts — Kreise, Sterne, Herzen oder eigene Pfade bleiben sauber erkennbar |
| 🎨 **Objektfarbe** | Die Füllung des Originals (Vollton **und** Verläufe) wird auf die Dreiecke übertragen |
| 🎲 **Zufällig-Modus** | Farbige Variation der Objektfarbe, ausgehend von den nächstgelegenen Farbtönen |
| ↕️ **Verlaufs-Modi** | Gerichtete Abstufungen: oben→unten, unten→oben, links→rechts |
| 🌈 **Farbvariation** | Regler für dezente bis kräftige Farb-Shades pro Dreieck |
| ⚙️ **Einstellbare Größe & Unregelmäßigkeit** | Dreiecksgröße und Jitter des Punktasters frei wählbar |
| 🎲 **Seed** | Gleicher Seed = reproduzierbares Ergebnis |
| 📁 **Automatische Gruppierung** | Das Ergebnis landet in einer eigenen Gruppe (`Objekt-Triangulated`, `-1`, `-2`, …) |

## 🚀 Installation

1. Download: [`downloads/TrianRex_v0.9.afscript`](downloads/TrianRex_v0.9.afscript)
2. Datei in den Affinity-Script-Ordner legen
   *(in Affinity Designer zu finden unter: **Bearbeiten → Einstellungen → Tools → Scripts**)*
3. Affinity Designer neu starten
4. Skript über die Scripts-Konsole bzw. das Skript-Menü starten

## 📖 Verwendung

1. Ein beliebiges Vektorobjekt (Shape oder Kurve) auswählen
2. Skript `TrianRex` starten
3. Parameter im Dialog einstellen
4. **OK** — die Dreiecksgruppe wird erzeugt ✅

> 💡 **Tipp:** Das Original bleibt unangetastet — verstecke es einfach, um nur
> das Triangulations-Ergebnis zu sehen.

## ⚠️ Bekannte Einschränkungen (Beta)

- Bei sehr komplexen Figuren wird der Verlauf nicht immer korrekt erkannt
- Vereinzelt können kleine Randdreiecke minimal über die Kontur ragen
- Sporadisch liefert Affinity zwischengespeicherte Objektdaten — im Zweifel einmal speichern, dein Projekt erneut öffnen und das Skript erneut starten

## 🛠️ Technologie

- **Plattform:** Affinity Designer 3 (Scripting API)
- **Sprache:** JavaScript (`.afscript`)
- **Geometrie:** Eigene Delaunay-Triangulation mit Formfilterung (Raycasting + Kantentests)

## 🤖 Generiert mit KI

Dieses Skript wurde unter Mithilfe von **KI-Assistenz** entwickelt
(iteratives Debugging gemeinsam mit Tester-Feedback ❤️).

Fehler gefunden? Feedback? Einfach ein Issue aufmachen!

## 🦊 Persönliche Anmerkung

Ich bin großer Freund von: Ich scripte mein Zeug selbst, aber da ich für diese Sidequest nicht viel Zeit habe,
habe ich das hier zu 99% mit einem LLM (KI) gemacht.

Da es aber JS ist, kann ich damit was anfangen und bei Fragen zur Seite stehen.
Das Script kannst du manuell in Affinity laden oder installiere einfach eines der Verpackten Versionen

LG

---

*Made with 🦊 and  KI🐾*