# Elektrokontrolle NIV – Technische Projektnotizen

Diese Datei dokumentiert Architektur und Konventionen für künftige Änderungen.
(Muss nicht auf GitHub hochgeladen werden, schadet aber auch nicht.)

## Zweck & Kontext

Offline-PWA für Gabriel Kloter (Elektro-Kontrolleur, Schweiz, NIV-Kontrollen).
Läuft auf dem iPad als Home-Bildschirm-App, gehostet auf GitHub Pages.
Referenz-Vorlagen (ElektroForm-PDFs) liegen im Elternordner `../`:
`Sina_Stockhornstrasse...pdf` (Mess- und Prüfprotokoll + SiNa) und
`NIV 25, Waldeckweg...KB.pdf` (Kontrollbericht — der App-Bericht ist diesem nachgebaut).

## Dateien

| Datei | Inhalt |
|---|---|
| `index.html` | Nur Gerüst: Topbar, `#view`, Tabbar, `#printarea`. Kein Inline-JS/CSS |
| `app.js` | Gesamte Logik (~1100 Zeilen), eine Datei, Vanilla JS, kein Framework |
| `app.css` | Styles inkl. `@media print` für den Bericht |
| `sw.js` | Service Worker, Cache-first. **`CACHE`-Konstante bei JEDER Änderung hochzählen!** |
| `manifest.webmanifest` | PWA-Manifest |
| `icon-180/512.png` | Icons (generiert mit PyMuPDF, dunkler Grund + gelber Blitz) |

## Architektur (app.js)

- **SPA mit Render-Funktionen:** globaler Zustand `S` (`view`, `kontrolle`, `uvId`,
  `fillSel`, `fillGid`, `returnView`, `csvHeader`). `go(view)` → `render()` →
  dispatcht auf `renderKontrollen/renderKunde/renderUvView/renderFill/renderMess/renderMaengel/renderExport/renderSettings`.
  Jede Render-Funktion baut `#view.innerHTML` komplett neu und verdrahtet danach Events.
- **`esc()`** für alles Nutzer-Eingegebene in HTML-Templates verwenden (XSS/kaputtes Markup).
- **IndexedDB** `nivapp`, Version 1, Stores:
  - `kontrollen` (keyPath `id`) – ganze Kontrolle als ein Objekt
  - `photos` (keyPath `id`) – `{id, blob}` (Mängel-/Info-Fotos)
  - `kv` (out-of-line keys) – Key `'settings'` = SETTINGS-Objekt, Key `'signatur'` = PNG-Blob der Unterschrift
  - Helfer: `dbPut/dbGet/dbAll/dbDel` (Promise-Wrapper `idb()`)
- **Autosave:** `save()` debounct 500 ms → `dbPut('kontrollen', S.kontrolle)`;
  `save(true)` sofort. Zusätzlich bei `visibilitychange`/`pagehide`.
  Indikator `#savestate`. `bindInput(el, obj, key)` = Standard-Binding für Inputs.
- **Einstellungen:** `DEFAULT_SETTINGS` + gespeichertes Objekt gemergt via
  `Object.assign({}, DEFAULT_SETTINGS, stored)` – neue Default-Keys überleben so alte Speicherstände.

## Datenmodell

```js
kontrolle = {
  id, createdAt, updatedAt,
  abgeschlossen: bool,      // LEGACY (v1.4-Haken); seit v1.5 ersetzt durch statusLog,
                            // furthestStatus() wertet ihn als Fallback noch aus
  statusLog: [{status, kz, ts}],  // Status-Workflow v1.5: wer (Kürzel) hat wann welchen Status gesetzt
  zeitLog: [{zeit, kz, ts}],      // v1.6: Arbeitszeiten pro Person (Zeit als Freitext, z.B. "3.5 h");
                                  // zeitTotal(k) summiert numerische Anteile, Anzeige in Kontrollen-Liste
  hak: '',                        // v1.8: Hausanschlusskasten (Freitext, Karte zuoberst im Reiter Anlagen);
                                  // Status «Gemessen» zeigt confirm-Hinweis, wenn leer (setzen trotzdem möglich)
  arbeitszeit: '',          // LEGACY (Einzelfeld bis v1.5) – Fallback in zeitTotal(); NICHT im Bericht
  kunde: {
    auftragNr, auftragBez, kontrollumfang,   // getrennte Felder (User-Entscheid v1.3)
    planDatum,              // v1.8: geplantes Kontrolldatum (ISO yyyy-mm-dd); Kontrollen-Liste
                            // sortiert danach aufsteigend, Einträge ohne Datum ans Ende
    gebaeudeart, strasse, plz, ort,
    zaehler,                // ACHTUNG v1.5: enthält jetzt den VNB (Netzbetreiber, z.B. BKW)!
                            // Property-Name blieb für Datenkompatibilität
    bemerkung,
    eigName, eigStrasse, eigPlz, eigOrt, eigTel, eigMail,
    rechAbw: bool, rechName, rechStrasse, rechPlz, rechOrt
  },
  uvs: [{ id, name,
    ort,                    // ACHTUNG v1.5: enthält jetzt die ZÄHLERNUMMER der Anlage!
    stromkunde,
    geprueft: [kuerzel],    // wer die Anlage geprüft hat (Kürzel aus SETTINGS.inspektoren)
    gruppen: [gruppe] }],
  maengel: [{ id, uvId, typ: 'mangel'|'info', ort, text, fotos: [photoId] }]
  // typ fehlt bei Altdaten → istInfo() behandelt fehlend als 'mangel'
}
gruppe = { id, nr, bez, art, leiter, char, inA,
  ikAnfLPE, ikEndLPE, ikAnfLN, ikEndLN, riso, rlo, rcdIn, rcdMa, ausl, weiteres }
// gruppen[0] jeder UV = Zuleitung (bei newUv() automatisch angelegt)
```

**Begriffe (v1.5):** UI sagt überall «Anlage(n)» statt UV/Verteiler, der Reiter «Export»
heisst «Abschluss» – intern heissen die Strukturen weiterhin `uvs`, `uvId`, view `'uv'`/`'export'`.

**Inspektoren & Status (v1.5):**
- `SETTINGS.inspektoren = [{kuerzel, name, tel, mail}]`, gepflegt in Optionen als Textarea
  (eine Zeile pro Person, `;`-getrennt). Die alten Felder inspName/Tel/Mail werden beim
  Speichern mit dem ersten Inspektor synchron gehalten (Fallbacks, Mail-Signatur).
- Pro Anlage Kürzel-Chips «Geprüft durch» (uv.geprueft). Im Abschluss beim Bericht
  Checkboxen «Inspektor(en) im Bericht», vorangekreuzt = Union der geprüft-Kürzel;
  showReport(sel) bekommt `sel.inspKuerzel` und listet alle im Kopf (Durch/Tel/Mail)
  und bei der Unterschrift.
- `STATUS_STUFEN = ['Erfasst','Gemessen','Geschrieben','Abgerechnet','Abgeschlossen']`.
  Status setzen im Abschluss: Chip antippen → Kürzel-Auswahl (oder prompt ohne Inspektoren)
  → Eintrag in statusLog. `furthestStatus(k)` = weiteste erreichte Stufe, angezeigt als
  Badge in der Kontrollen-Liste (grün bei Abgeschlossen, `.kcard.done`).

## Fachliche Regeln (User-Vorgaben, nicht ändern ohne Rückfrage)

- **Schnell-Ausfüllen** (`applyFill`): Auswahl `fillSel` = {kabel, draehte, sich, amp}.
  art=Kabelart; leiter=`{draehte}x{querschnitt[amp]}`; char=Sicherungsart; inA=amp;
  riso=`SETTINGS.risoDefault` (500) **ausser draehte==='2' → riso leer** (nur RISO! Rlo etc. normal);
  rlo=`SETTINGS.rloDefault` ('i.o.');
  Sicherungsart enthält Substring `'FI'` → rcdIn=amp, rcdMa=`SETTINGS.idnDefault` (30), sonst beide leer.
  Auswahl bleibt für nächste Gruppe stehen (bewusst, für Serien).
- **Querschnitt-Mapping** (Settings, editierbar): 6→1, 10/13→1.5, 16→2.5, 20→4,
  25→6, 32/40→10, 50/60/63→16, 80→25, 100→35.
- **IK-Propagation** (`propagateIk`): Ändert man in Zeile 0 (Zuleitung) `ikEndLPE`/`ikEndLN`,
  wird der Wert in allen Zeilen darunter als `ikAnfLPE`/`ikAnfLN` gesetzt –
  aber nur wenn dort leer oder == alter Wert (manuelle Überschreibungen bleiben).
- **Diktat-Parsing** (`parseDictation`): Zeilenweise; `"F 1"`→`"F1"` normalisiert;
  erstes Token mit Ziffer (≤8 Zeichen, `[A-Za-z0-9./-]`) = Nr (uppercase), Rest = Bezeichnung;
  ohne Nummer-Token → ganze Zeile = Bezeichnung, Nr leer. Satzzeichen am Ende gestrippt.
  User diktiert mit iOS-Befehl «neue Zeile».

## Exporte

- **CSV** (`buildCSV`): 15 Spalten, Tab-getrennt, `\r\n`-Zeilen, optionale Kopfzeile.
  Reihenfolge = ElektroForm-Spalten A–O: Nr, Bez, Art/Typ, Leiter/Quer, Charakt, In,
  IK Anf L-PE, IK Ende L-PE, IK Anf L-N, IK Ende L-N, RISO, Rlo, RCD In, IΔN, Auslösezeit.
- **SKX** (`buildSKX`): ElektroForm/TinLine-XML. Kritisch: UTF-8 **mit BOM**
  (`'﻿' + xml` beim Download), **CRLF**, leere Felder als `<A05>\r\n    </A05>`
  (nicht self-closing!). Feld-Mapping: A02=nr, A03=rcdMa, A04=bez, A07–A10=IK-Werte,
  A13.1=art, A13.2=leiter, A14=rcdIn, A15=ausl, A16=`normCharakt(char)` (LS-C→C via
  Regex `/LS-?\s?([A-Z])/i`, sonst Rohwert z.B. DII), A18=inA, A19=riso, A20=rlo.
  Eine SKX-Datei pro UV. Spez: Skill `anthropic-skills:skx-generator`.
- **Kontrollbericht** (`showReport(sel)`): druckbares HTML in `#printarea`,
  `@media print` blendet App aus. `sel = {uvIds: [...], includeOhne: bool}` von den
  Checkboxen im Export. Aufbau nach Vorlage: Kopf (Auftraggeber/Auftragnehmer=SETTINGS.firma*,
  Ort, Gebäudeart, Auftragsbez, Zähler, Kontrollumfang, Verteiler, Inspekteur+Tel/Mail,
  Mängel ☒Ja(n)/☐Nein) → «Mängelliste» nach UV gruppiert, fortlaufend nummeriert →
  «Information» (typ='info'-Einträge, nicht nummeriert, zählen nicht als Mangel) →
  Datum/Unterschrift (Unterschrift-Bild aus kv 'signatur' statt Linie, falls vorhanden) →
  nur bei mCount>0: Erledigungstext + Bestätigungsblock (NIV Art. 3+4 / Art. 27).
  **PDF-Dateiname** = `document.title` = `Kontrollbericht_{UV|alle UV|A+B}_{Strasse}_{Ort}`
  (gesetzt vor `window.print()`, zurückgesetzt bei `afterprint`).
- **Übergabe einer Kontrolle** (`buildKontrolleExport`): JSON `{app:'nivapp', type:'kontrolle',
  kontrolle, photos:[{id,data:base64}]}`. Versand via **Web Share API** (navigator.share
  mit File → iPad-Teilen-Menü); mailto kann keine Anhänge → deshalb so. Fallback Download.
- **Voll-Backup** (`exportBackup`): alle Kontrollen + Fotos base64 + SETTINGS + `signatur` base64.
  `importBackup` akzeptiert **beide** Formate (kontrollen[] oder kontrolle) und merged per dbPut.
- **Mail an Kunde** (btnMailKunde): reines `mailto:` an `kunde.eigMail` mit Betreff/Text –
  PDF muss der User im Mail anhängen.

## Messtabelle (renderMess)

`MESS_COLS` definiert Spalten inkl. `w` (%-Breite, Summe 100) → `<colgroup>`.
`table-layout: fixed`, Breite 100 %, **kein horizontales Scrollen** (User-Wunsch:
alles sichtbar, auch RCD). `.tablewrap` hat max-height (calc mit 100vh) + overflow-y,
`thead th` sticky. Inputs `width:100%`, numerische mit `inputmode="decimal"`.
Zeile 0 = Zuleitung, gelb (`tr.zuleitung`).

## Service Worker / Update-Prozess (WICHTIG)

1. Bei jeder Code-Änderung in sw.js `CACHE = 'nivapp-vN'` hochzählen (sonst liefert
   der SW die alte Version aus!) und App-Version in renderSettings (`#appver`) anpassen.
2. `cache.addAll` nutzt `new Request(u, {cache:'reload'})` – umgeht den HTTP-Cache.
   Ohne das kam beim Update altes CSS (Bug in v1.3 gefunden).
3. Auf dem iPad wird das Update nach **zweimaligem Öffnen** aktiv (skipWaiting+claim,
   aber die erste Sitzung lief noch mit alten Assets los).
4. Deployment: User lädt Dateien von Hand auf GitHub hoch (Add file → Upload files,
   Repo vermutlich `elektrokontrolle`, GitHub Pages von main/root). Kein git lokal.

## Entwicklungs-Workflow auf diesem Mac

- **Kein Node!** Syntax-Check via JXA:
  `osascript -l JavaScript -e "...NSString...; new Function(src)"` (siehe frühere Sessions).
- **Vorschau/Test:** `~/.claude/launch.json` hat Config `elektrokontrolle`
  (`python3 -m http.server 8123 --directory <app-ordner>`); mit preview_start starten,
  dann preview_eval. Nach Änderungen **zweimal reloaden** (SW-Update).
- **Testdaten:** Der User testet selbst im Vorschau-Panel – seine IndexedDB dort enthält
  echte Testdaten. Bei automatisierten Tests: Testkontrollen nur **im Speicher** bauen
  (`S.kontrolle = newKontrolle()` ohne dbPut, `window.print` stubben, danach
  `S.kontrolle` zurücksetzen) oder DB-Einträge am Ende wieder löschen. Nichts vom User anfassen!
  **FALLE (zweimal passiert):** Jede UI-Interaktion, die `save()`/`setStatus()` auslöst
  (Status setzen, Zeit erfassen, Input-Events), speichert die Test-S.kontrolle in die DB!
  Nach solchen Tests IMMER `dbDel('kontrollen', testId)` ausführen bzw. per Fingerabdruck
  (Testwerte) suchen und löschen.
- PDF-Vorlagen ansehen: PyMuPDF (`fitz`) ist via pip installiert, rendert Seiten als PNG.

## Versionshistorie (Kurz)

- **1.8** HAK-Feld (kontrolle.hak, Karte zuoberst in Anlagen, confirm-Hinweis bei Status «Gemessen»
  wenn leer); geplantes Kontrolldatum (kunde.planDatum, date-Input im Auftrag-Block), Kontrollen-Liste
  zeigt 📅 und sortiert danach (Cache v15)
- **1.7** Vollbild-Knopf ⛶ in der Topbar (Fullscreen-API mit webkit-Fallback, Promise-Rejection
  abgefangen; im eingebetteten Preview blockiert die API – auf dem iPad/Safari ok);
  «● offen» → «● geöffnet»; save()-Guard gegen Kontrollen ohne id (Cache v14)
- **1.6** Arbeitszeit als Log wie Status: Zeit eintippen → «＋ Erfassen» → Kürzel-Auswahl →
  zeitLog-Eintrag mit Löschknopf; Total (zeitTotal) im Abschluss und in der Kontrollen-Liste (Cache v11)
- **1.5** Umbenennung Verteiler→Anlagen, Export→Abschluss; kunde.zaehler=VNB, uv.ort=Zählernummer;
  Inspektoren-Liste (Kürzel) + «Geprüft durch» pro Anlage + Auswahl im Bericht;
  Status-Workflow mit Log (ersetzt v1.4-Haken); Adresse-übernehmen-Knopf beim Eigentümer (Cache v10)

- **1.0** Grundapp: Kunde, UVs, Diktat, Schnell-Ausfüllen, Messen, Mängel+Fotos, CSV/SKX/Bericht/Backup, Settings
- **1.1** Kontrollbericht nach Vorlage (Firma/Inspekteur in Settings, Auftragsfelder, Erledigungstext, Unterschriftsblock NIV Art. 3+4)
- **1.2** Bericht pro UV wählbar, PDF-Dateiname, Arbeitszeit, Bemerkungsfeld, Einzelkontroll-Export + Web Share
- **1.3** Auftragsbez./Kontrollumfang getrennt, Arbeitszeit raus aus Bericht, Info-Typ + Textbausteine (SETTINGS.infoTexte, `---`-getrennt), eigMail + Mail-Knopf, SW cache:'reload'-Fix
- **1.4** Unterschrift-Bild (kv 'signatur', PNG/transparent, im Bericht + Backup), Messtabelle auf Bildschirmbreite, Abgeschlossen-Haken (Cache v8)

## Offene Ideen (nie umgesetzt, nur falls User fragt)

- Sortierung/Filter «abgeschlossen» in der Kontrollen-Liste
- SKX kombiniert über mehrere UVs (aktuell pro UV)
- Frist-Feld für Mängelbehebung (Vorlage hätte eines)
