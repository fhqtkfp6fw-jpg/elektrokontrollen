# Elektrokontrolle NIV – Erfassungs-App (Version 2.0)

Offline-fähige Web-App (PWA) für die Erfassung von Mess- und Prüfdaten bei
periodischen Elektrokontrollen in der Schweiz. Läuft auf dem iPad im Safari
bzw. als App vom Home-Bildschirm – komplett offline, alle Daten bleiben auf
dem Gerät.

## Die Reiter im Überblick

| Reiter | Zweck |
|---|---|
| 🗂 **Kontrollen** | Übersicht aller Kontrollen, sortiert nach geplantem Kontrolldatum (📅). Status-Badge zeigt den Fortschritt, «● geöffnet» die aktive Kontrolle |
| 👤 **Kunde** | Auftrag (Nummer, Bezeichnung, Kontrollumfang, geplantes Datum), Ort der Anlage mit Gebäudeart, VNB und Bemerkungen, Eigentümer (inkl. E-Mail, Adresse per Knopf von der Anlage übernehmbar), abweichende Rechnungsadresse |
| 🔌 **Anlagen** | HAK-Feld (einer pro Gebäude), pro Anlage: Name, Zählernummer, Stromkunde, «Geprüft durch» (Inspektor-Kürzel). Gruppen per **Diktat** oder von Hand erfassen; erste Zeile = Zuleitung |
| ⚡ **Ausfüllen** | Schnell-Ausfüllen: Kabelart, Drahtzahl, Sicherungsart, Ampere antippen → Tabelle wird vorbefüllt (Querschnitt automatisch, RISO 500, Rlo i.o., RCD-Werte bei FI-Typen; bei 2x bleibt RISO leer) |
| 📋 **Messen** | Ganze Messtabelle in Bildschirmbreite, nur vertikal scrollen. IK-Ende der Zuleitung wird automatisch als IK-Anfang aller Gruppen übernommen. Direktabsprung zu «Mangel erfassen» |
| ⚠️ **Mängel** | Mangel- und Info-Einträge (Umschalter) mit Anlage, Ort, Text und Fotos. Für Infos stehen Textbausteine zur Auswahl |
| 📤 **Abschluss** | CSV/SKX pro Anlage, Kontrollbericht (Auswahl der Anlagen und Inspektoren), Bericht drucken oder **per Mail mit PDF-Anhang senden**, Status-Workflow, Arbeitszeiten, Übergabe-Datei, Backup |
| ⚙️ **Optionen** | Alle Auswahllisten und Vorgabewerte, Firma, Inspektoren, Erledigungstext, Info-Textbausteine, Unterschrift-Bild |

Oben rechts: Vollbild-Knopf ⛶ und Speicher-Anzeige (**Autosave** – jede
Eingabe wird sofort lokal gespeichert).

## Kontrollbericht

- Aufbau nach ElektroForm-Vorlage: Kopf mit «Auftrag: Nummer + Bezeichnung»,
  Auftraggeber/Auftragnehmer, VNB, Kontrollumfang, Anlagen mit Zählernummern,
  Inspektoren mit Tel./Mail, Mängel-Ankreuzfeld
- Mängelliste nach Anlagen gruppiert (mit Fotos), eigener Abschnitt
  «Information», Datum/Unterschrift (hinterlegtes Unterschrift-Bild wird
  eingesetzt), Erledigungstext und Bestätigungsblock nach NIV Art. 3+4
- Pro Anlage wählbar, was zusammen in einen Bericht kommt; PDF-Dateiname
  automatisch: `Kontrollbericht_Anlage_Strasse_Ort`
- **Zwei Wege:** «Bericht erstellen & drucken» (Druckdialog → Als PDF sichern)
  oder «✉️ Bericht per Mail senden» – die App erzeugt das PDF selbst und
  öffnet das Teilen-Menü; im Mail ist der Bericht **bereits angehängt**, die
  Kundenadresse liegt in der Zwischenablage (bei «An:» einsetzen)

## Team-Funktionen

- **Inspektoren** in den Optionen erfassen (eine Zeile pro Person:
  `Kürzel; Name; Telefon; E-Mail`) – die Kürzel stehen bei «Geprüft durch»,
  beim Status und bei den Arbeitszeiten zur Auswahl
- **Status-Workflow**: Erfasst → Gemessen → Geschrieben → Abgerechnet →
  Abgeschlossen. Beim Setzen wird das Kürzel abgefragt und protokolliert
  (wer, wann); der fortgeschrittenste Status erscheint in der Übersicht.
  Beim Status «Gemessen» prüft die App, ob das HAK-Feld ausgefüllt ist
- **Arbeitszeiten**: pro Person mit Kürzel erfassen; die App rechnet das
  Total und zeigt es in der Übersicht (⏱)

## Arbeitsablauf mit Mitarbeiter

1. Chef legt die Kontrolle an, füllt Kundendaten (inkl. Bemerkungen für die
   Vorbereitung), evtl. schon Anlagen und Gruppen aus
2. **Abschluss → Kontrolle teilen / per Mail senden** – der Mitarbeiter
   erhält die Übergabe-Datei (mit allen Daten und Fotos)
3. Mitarbeiter: Datei sichern, in der App **Abschluss → Backup importieren**
   – die vorbereitete Kontrolle erscheint
4. Mitarbeiter erfasst Messwerte, Mängel, Fotos, setzt Status und
   Arbeitszeit unter seinem Kürzel und sendet die Kontrolle zurück
5. Chef importiert, prüft, erstellt Berichte und CSV/SKX, verrechnet

## Exporte

- **CSV** (Tab-getrennt) pro Anlage – zum Einfügen in ElektroForm
- **SKX-Datei** pro Anlage – für den direkten ElektroForm-Import
  («Messdaten importieren»)
- **Kontrollbericht** als PDF (Druck oder Mail-Anhang)
- **Übergabe-Datei** (eine Kontrolle) und **Voll-Backup** (alles inkl.
  Fotos, Einstellungen und Unterschrift) als JSON; der Import nimmt beide
  Formate an

## Diktieren der Gruppen

Im Feld «Gruppen per Diktat erfassen» die Mikrofon-Taste der iPad-Tastatur
drücken und pro Gruppe sagen:

> «F1 Wohnen Essen Küche **neue Zeile** F2 Zimmer eins und zwei **neue Zeile** F3 Geschirrspüler»

Der Sprachbefehl **«neue Zeile»** erzeugt den Zeilenumbruch. Jede Zeile wird
zu einer Gruppe: das erste Wort (mit Ziffer) wird als Nummer erkannt, der
Rest als Bezeichnung. Der Text kann vor dem Übernehmen korrigiert werden.

## Auf GitHub Pages veröffentlichen (einmalig)

1. Auf github.com ein Repository anlegen
2. Alle Dateien hochladen («Add file → Upload files»)
3. **Settings → Pages → Source: Deploy from a branch**, Branch `main`,
   Ordner `/ (root)` → Save
4. Nach 1–2 Minuten läuft die App unter
   `https://<benutzername>.github.io/<repository>/`

**Updates einspielen:** geänderte Dateien einfach erneut hochladen
(gleichnamige werden ersetzt, nichts löschen) → Commit changes → App auf dem
iPad **zweimal öffnen**. Die aktive Version steht unter Optionen.

## Auf dem iPad installieren

1. Die GitHub-Pages-Adresse in **Safari** öffnen
2. Teilen-Symbol → **«Zum Home-Bildschirm»**
3. Die App vom Home-Bildschirm starten – ab jetzt funktioniert sie
   auch **komplett offline**

## Datensicherheit

- Alle Daten liegen lokal auf dem Gerät (IndexedDB) – kein Server, keine Cloud
- Wichtig: Regelmässig unter **Abschluss → Backup exportieren** eine
  JSON-Datei in die Dateien-App/iCloud sichern
- Hinweis: Wird die App über Monate nie geöffnet, kann iOS Website-Daten
  löschen. Als Home-Bildschirm-App und mit regelmässigen Backups ist das
  Risiko minimal

## Wichtige Dateien

| Datei | Zweck |
|---|---|
| `index.html` | App-Gerüst |
| `app.js` | Gesamte Logik (Erfassung, Autosave, Exporte, PDF) |
| `app.css` | Layout, iPad-optimiert |
| `sw.js` | Service Worker (Offline-Cache) – bei Updates `CACHE`-Version hochzählen |
| `jspdf.min.js` | PDF-Bibliothek (jsPDF) für den Bericht als Mail-Anhang |
| `manifest.webmanifest` | PWA-Manifest |
| `icon-180.png` / `icon-512.png` | App-Icons |
