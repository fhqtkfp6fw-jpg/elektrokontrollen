# Elektrokontrolle NIV – Erfassungs-App

Offline-fähige Web-App (PWA) für die Erfassung von Mess- und Prüfdaten bei
periodischen Elektrokontrollen in der Schweiz. Läuft auf dem iPad im Safari
bzw. als App vom Home-Bildschirm.

## Funktionen

- **Kundendaten**: Ort der Anlage, Gebäudeart, Zählernummer, Eigentümer- und
  abweichende Rechnungsadresse
- **Unterverteilungen (UV)**: beliebig viele pro Kontrolle, mit Name, Ort und
  Stromkunde. Die erste Zeile jeder UV ist die **Zuleitung**
- **Gruppen per Diktat** erfassen (iPad-Diktierfunktion) oder tippen,
  Zeilen verschieben/löschen
- **Schnell-Ausfüllen**: Kabelart, Drahtzahl, Sicherungsart und Ampere antippen –
  die Tabelle wird automatisch vorbefüllt (Querschnitt gemäss Zuordnungstabelle,
  RISO 500, Rlo i.o., RCD-Werte bei FI-Typen)
- **Messmodus**: die ganze Tabelle passt in die Bildschirmbreite (alle Spalten
  inkl. RCD sichtbar, nur vertikal scrollen, Kopfzeile bleibt stehen).
  IK-Ende der Zuleitung wird automatisch als IK-Anfang aller Gruppen übernommen
- **Unterschrift**: in den Optionen als Bild hinterlegbar (PNG mit
  transparentem Hintergrund wirkt wie echt unterschrieben); erscheint im
  Kontrollbericht bei «Unterschrift» und wandert mit dem Voll-Backup mit
- **Abgeschlossen-Status**: Haken pro Kontrolle in der Übersicht (grüner
  Balken + «✓ abgeschlossen»); sperrt nichts, reine Anzeige
- **Mängel & Infos** mit Ort, Text und Fotos (Kamera), jederzeit vom Messmodus
  aus; jeder Eintrag ist per Umschalter Mangel oder Information. Für Infos
  stehen vorgefertigte Textbausteine zur Auswahl (in den Optionen pflegbar,
  getrennt durch `---`-Zeilen); Infos erscheinen im Bericht in einem eigenen
  Abschnitt «Information» und zählen nicht als Mangel
- **Export**: Tab-getrenntes CSV (kopieren oder als Datei),
  SKX-Datei für den direkten Import in ElektroForm, Kontrollbericht als PDF
  (über den Druckdialog), komplettes JSON-Backup inkl. Fotos
- **Kontrollbericht** nach ElektroForm-Vorlage: Kopf mit Auftraggeber,
  ausführender Firma, Inspekteur (Name/Tel/Mail), Auftragsnummer und
  Kontrollumfang; Mängelliste nach Verteiler gruppiert; unten Erledigungstext
  und Bestätigungsblock (Datum / Firmenstempel / Unterschrift nach NIV Art. 3+4)
- **Berichts-Auswahl**: pro Verteiler ankreuzen, was zusammen in einen
  Kontrollbericht kommt (einzeln oder kombiniert); der PDF-Dateiname wird
  automatisch gesetzt: `Kontrollbericht_UV Name_Strasse_Ort`
- **Abschluss & Übergabe**: Arbeitszeitfeld pro Kontrolle; eine einzelne
  Kontrolle kann als Datei (inkl. aller Fotos) exportiert und über das
  Teilen-Menü direkt per Mail/AirDrop verschickt werden. Der Empfänger
  importiert sie über «Backup importieren» – so lassen sich vorbereitete
  Kontrollen an Mitarbeiter senden und fertige zurück
- **Einstellungen**: alle Auswahllisten und Vorgabewerte anpassbar; Firma,
  Inspekteur und Erledigungstext werden einmal hinterlegt und gelten für alle
  Kontrollen

## Arbeitsablauf mit Mitarbeiter

1. Chef legt die Kontrolle an, füllt Kundendaten (inkl. Feld «Bemerkungen /
   Besonderheiten»), evtl. schon UVs und Gruppen aus
2. **Export → Kontrolle teilen / per Mail senden** – der Mitarbeiter erhält
   die Datei
3. Mitarbeiter: Datei in der Dateien-App sichern, in der App
   **Export → Backup importieren** – die vorbereitete Kontrolle erscheint
4. Mitarbeiter erfasst Messwerte, Mängel, Fotos und die Arbeitszeit und sendet
   die Kontrolle gleich wieder zurück (Schritt 2)
5. Chef importiert, prüft und erstellt Berichte und CSV/SKX
- **Autosave**: jede Eingabe wird sofort lokal gespeichert (IndexedDB)

## Auf GitHub Pages veröffentlichen (einmalig)

1. Auf github.com ein neues Repository anlegen, z.B. `elektrokontrolle`
2. Diese Dateien hochladen (via Browser: «Add file → Upload files»)
3. Im Repository: **Settings → Pages → Source: Deploy from a branch**,
   Branch `main`, Ordner `/ (root)` wählen, speichern
4. Nach ca. 1 Minute ist die App unter
   `https://<benutzername>.github.io/elektrokontrolle/` erreichbar

## Auf dem iPad installieren

1. Die GitHub-Pages-Adresse in **Safari** öffnen
2. Teilen-Symbol → **«Zum Home-Bildschirm»**
3. Die App vom Home-Bildschirm starten – ab jetzt funktioniert sie
   auch **komplett offline**

## Diktieren der Gruppen

Im Feld «Gruppen per Diktat erfassen» die Mikrofon-Taste der iPad-Tastatur
drücken und pro Gruppe sagen:

> «F1 Wohnen Essen Küche **neue Zeile** F2 Zimmer eins und zwei **neue Zeile** F3 Geschirrspüler»

Der Sprachbefehl **«neue Zeile»** erzeugt den Zeilenumbruch. Jede Zeile wird
zu einer Gruppe: das erste Wort (mit Ziffer) wird als Nummer erkannt, der Rest
als Bezeichnung. Der Text kann vor dem Übernehmen noch korrigiert werden.

## Datensicherheit

- Alle Daten liegen lokal auf dem Gerät (IndexedDB, überlebt Neustart und
  Offline-Betrieb)
- Wichtig: Regelmässig unter **Export → Backup exportieren** eine JSON-Datei
  in die Dateien-App/iCloud sichern
- Hinweis: Wird die App über Wochen nie geöffnet, kann iOS Website-Daten
  löschen. Als Home-Bildschirm-App und mit regelmässigen Backups ist das Risiko
  minimal

## Wichtige Dateien

| Datei | Zweck |
|---|---|
| `index.html` | App-Gerüst |
| `app.js` | Gesamte Logik (Erfassung, Autosave, Exporte) |
| `app.css` | Layout, iPad-optimiert |
| `sw.js` | Service Worker (Offline-Cache) – bei Updates `CACHE`-Version hochzählen |
| `manifest.webmanifest` | PWA-Manifest |
