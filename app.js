'use strict';

/* ============================================================
   Elektrokontrolle NIV – Erfassungs-App für periodische Kontrollen
   Offline-PWA, Datenhaltung in IndexedDB, Export CSV (Tab) / SKX / PDF-Bericht
   ============================================================ */

const $ = s => document.querySelector(s);
const $$ = s => Array.from(document.querySelectorAll(s));
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : 'id' + Date.now() + Math.random().toString(16).slice(2));

/* ---------------- Einstellungen (Defaults) ---------------- */

const DEFAULT_SETTINGS = {
  kabelArten: ['TT', 'FE0', 'Cca'],
  draehte: ['2', '3', '5'],
  sicherungsArten: ['NH00', 'LS-B', 'LS-C', 'LS-D', 'DI', 'DII', 'DIII', 'FI LS-C', 'LS-L', 'LS-V'],
  ampere: ['6', '10', '13', '16', '20', '25', '32', '40', '50', '60', '63', '80', '100'],
  querschnitt: {
    '6': '1', '10': '1.5', '13': '1.5', '16': '2.5', '20': '4', '25': '6',
    '32': '10', '40': '10', '50': '16', '60': '16', '63': '16', '80': '25', '100': '35'
  },
  risoDefault: '500',
  rloDefault: 'i.o.',
  idnDefault: '30',
  inspektoren: [],   // [{kuerzel, name, tel, mail}] – gepflegt in den Optionen
  gebaeudeArten: ['EFH', 'MFH', 'Gewerbe', 'Landwirtschaft', 'Öffentliches Gebäude', 'Garage/Nebengebäude'],
  firmaName: '',
  firmaStrasse: '',
  firmaPlzOrt: '',
  inspName: '',
  inspTel: '',
  inspMail: '',
  erledigungsText: 'Die aufgeführten Mängel sind durch eine fachkundige Person oder eine kontrollberechtigte Person beheben zu lassen. Nach erfolgter Behebung ist die untenstehende Bestätigung zu datieren, zu stempeln und zu unterzeichnen und dieser Kontrollbericht an die ausführende Firma zurückzusenden.',
  infoTexte: [
    'Diese hier aufgeführten Mängel betreffen nicht diesen SiNa. Es wird aber dringend empfohlen, diese Mängel zeitnah zu beheben. Der Eigentümer der Anlage ist darüber zu informieren.',
    'Die alten Verteilungen sollten in der nächsten Zeit ersetzt werden, damit die Anlage wieder dem Stand der Technik entspricht. Dies ist bei kommenden Arbeiten zu berücksichtigen.',
    'Die Anlage wurde stichprobenweise kontrolliert.'
  ]
};

let SETTINGS = JSON.parse(JSON.stringify(DEFAULT_SETTINGS));

/* ---------------- IndexedDB ---------------- */

let db;

function openDB() {
  return new Promise((res, rej) => {
    const r = indexedDB.open('nivapp', 1);
    r.onupgradeneeded = e => {
      const d = e.target.result;
      if (!d.objectStoreNames.contains('kontrollen')) d.createObjectStore('kontrollen', { keyPath: 'id' });
      if (!d.objectStoreNames.contains('photos')) d.createObjectStore('photos', { keyPath: 'id' });
      if (!d.objectStoreNames.contains('kv')) d.createObjectStore('kv');
    };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}

function idb(store, mode, fn) {
  return new Promise((res, rej) => {
    const t = db.transaction(store, mode);
    const os = t.objectStore(store);
    const q = fn(os);
    q.onsuccess = () => res(q.result);
    q.onerror = () => rej(q.error);
  });
}
const dbPut = (store, val, key) => idb(store, 'readwrite', os => key !== undefined ? os.put(val, key) : os.put(val));
const dbGet = (store, key) => idb(store, 'readonly', os => os.get(key));
const dbAll = (store) => idb(store, 'readonly', os => os.getAll());
const dbDel = (store, key) => idb(store, 'readwrite', os => os.delete(key));

/* ---------------- Datenmodell ---------------- */

function newGruppe(nr, bez) {
  return {
    id: uid(), nr: nr || '', bez: bez || '',
    art: '', leiter: '', char: '', inA: '',
    ikAnfLPE: '', ikEndLPE: '', ikAnfLN: '', ikEndLN: '',
    riso: '', rlo: '', rcdIn: '', rcdMa: '', ausl: '', weiteres: ''
  };
}

// Hinweis: uv.ort enthält seit v1.5 die ZÄHLERNUMMER der Anlage (Feld wurde
// umgenutzt, Property-Name blieb für Datenkompatibilität). uv.geprueft = [Kürzel].
function newUv(name) {
  return { id: uid(), name: name || '', ort: '', stromkunde: '', geprueft: [], gruppen: [newGruppe('', 'Zuleitung UV')] };
}

const STATUS_STUFEN = ['Erfasst', 'Gemessen', 'Geschrieben', 'Abgerechnet', 'Abgeschlossen'];

function furthestStatus(k) {
  let idx = -1;
  for (const e of (k.statusLog || [])) {
    const i = STATUS_STUFEN.indexOf(e.status);
    if (i > idx) idx = i;
  }
  if (idx < 0 && k.abgeschlossen) return 'Abgeschlossen'; // Altdaten mit v1.4-Haken
  return idx >= 0 ? STATUS_STUFEN[idx] : '';
}

function setStatus(k, status, kz) {
  (k.statusLog = k.statusLog || []).push({ status, kz, ts: Date.now() });
  save();
}

// Summe der erfassten Arbeitszeiten ("3.5 h", "2,25" etc. → Zahl); Fallback: altes Einzelfeld
function zeitTotal(k) {
  let sum = 0, any = false;
  for (const e of (k.zeitLog || [])) {
    const m = String(e.zeit).replace(',', '.').match(/[\d.]+/);
    if (m) { sum += parseFloat(m[0]); any = true; }
  }
  if (any) return (Math.round(sum * 100) / 100) + ' h';
  return k.arbeitszeit || '';
}

function newKontrolle() {
  return {
    id: uid(), createdAt: Date.now(), updatedAt: Date.now(),
    abgeschlossen: false,
    statusLog: [],   // [{status, kz, ts}] – wer hat wann welchen Status gesetzt
    zeitLog: [],     // [{zeit, kz, ts}] – erfasste Arbeitszeiten pro Person
    hak: '',         // Hausanschlusskasten (einer pro Gebäude) – geprüft beim Status «Gemessen»
    arbeitszeit: '', // LEGACY (bis v1.5, einzelnes Textfeld) – zeitTotal() nutzt es als Fallback
    kunde: {
      auftragNr: '', auftragBez: '', kontrollumfang: '', planDatum: '',
      gebaeudeart: '', strasse: '', plz: '', ort: '', zaehler: '', bemerkung: '',
      eigName: '', eigStrasse: '', eigPlz: '', eigOrt: '', eigTel: '', eigMail: '',
      rechAbw: false, rechName: '', rechStrasse: '', rechPlz: '', rechOrt: ''
    },
    uvs: [],
    maengel: []
  };
}

function newMangel(uvId) {
  return { id: uid(), uvId: uvId || '', typ: 'mangel', ort: '', text: '', fotos: [] };
}

// Ältere Einträge haben noch kein typ-Feld → als Mangel behandeln
const istInfo = m => (m.typ || 'mangel') === 'info';

/* ---------------- Zustand ---------------- */

const S = {
  view: 'kontrollen',
  kontrolle: null,
  uvId: null,
  fillSel: { kabel: null, draehte: null, sich: null, amp: null },
  fillGid: null,
  returnView: null,
  csvHeader: false
};

/* ---------------- Speichern (Autosave) ---------------- */

let saveTimer = null;

function setSaveState(cls, txt) {
  const el = $('#savestate');
  el.className = cls;
  el.textContent = txt;
}

function save(immediate) {
  if (!S.kontrolle || !S.kontrolle.id) return;
  S.kontrolle.updatedAt = Date.now();
  setSaveState('saving', '● Speichert…');
  clearTimeout(saveTimer);
  const doSave = async () => {
    try {
      await dbPut('kontrollen', S.kontrolle);
      setSaveState('saved', '✓ Gespeichert');
    } catch (e) {
      setSaveState('error', '⚠️ Fehler!');
      console.error(e);
    }
  };
  if (immediate) doSave(); else saveTimer = setTimeout(doSave, 500);
}

document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') save(true); });
window.addEventListener('pagehide', () => save(true));

async function saveSettings() {
  await dbPut('kv', SETTINGS, 'settings');
}

/* ---------------- Hilfen ---------------- */

function curUv() {
  if (!S.kontrolle) return null;
  let uv = S.kontrolle.uvs.find(u => u.id === S.uvId);
  if (!uv && S.kontrolle.uvs.length) { uv = S.kontrolle.uvs[0]; S.uvId = uv.id; }
  return uv || null;
}

function kontrolleTitle(k) {
  const ku = k.kunde;
  const adr = [ku.strasse, [ku.plz, ku.ort].filter(Boolean).join(' ')].filter(Boolean).join(', ');
  return adr || 'Neue Kontrolle';
}

function fmtDate(ts) {
  const d = new Date(ts);
  return d.toLocaleDateString('de-CH') + ' ' + d.toLocaleTimeString('de-CH', { hour: '2-digit', minute: '2-digit' });
}

function bindInput(el, obj, key, after) {
  el.addEventListener('input', () => {
    obj[key] = el.type === 'checkbox' ? el.checked : el.value;
    save();
    if (after) after(el);
  });
}

/* ---------------- Navigation ---------------- */

function go(view) {
  S.view = view;
  $$('#tabbar button').forEach(b => b.classList.toggle('active', b.dataset.view === view));
  render();
  window.scrollTo(0, 0);
}

$$('#tabbar button').forEach(b => b.addEventListener('click', () => go(b.dataset.view)));

function render() {
  $('#ctxtitle').textContent = S.kontrolle ? kontrolleTitle(S.kontrolle) : '';
  const v = $('#view');
  const needK = ['kunde', 'uv', 'fill', 'mess', 'maengel', 'export'];
  if (needK.includes(S.view) && !S.kontrolle) {
    v.innerHTML = `<div class="empty">Bitte zuerst unter <b>🗂 Kontrollen</b> eine Kontrolle öffnen oder neu anlegen.</div>`;
    return;
  }
  ({
    kontrollen: renderKontrollen, kunde: renderKunde, uv: renderUvView,
    fill: renderFill, mess: renderMess, maengel: renderMaengel,
    export: renderExport, settings: renderSettings
  })[S.view]();
}

/* ============================================================
   Ansicht: Kontrollen-Liste
   ============================================================ */

async function renderKontrollen() {
  const v = $('#view');
  // Sortierung: geplantes Kontrolldatum aufsteigend (nächster Termin zuoberst),
  // Kontrollen ohne Datum danach (neueste Änderung zuerst)
  const list = (await dbAll('kontrollen')).sort((a, b) => {
    const da = a.kunde.planDatum || '';
    const db_ = b.kunde.planDatum || '';
    if (da && db_) return da.localeCompare(db_) || b.updatedAt - a.updatedAt;
    if (da) return -1;
    if (db_) return 1;
    return b.updatedAt - a.updatedAt;
  });
  let html = `<h2>Kontrollen</h2>
    <div class="btnrow"><button class="btn primary" id="btnNewK">＋ Neue Kontrolle</button></div>`;
  if (!list.length) html += `<div class="empty">Noch keine Kontrollen erfasst.</div>`;
  for (const k of list) {
    const open = S.kontrolle && S.kontrolle.id === k.id;
    const stufe = furthestStatus(k);
    const done = stufe === 'Abgeschlossen';
    const badges = (stufe ? ` <span class="statusbadge ${done ? 'sb-done' : ''}">${esc(stufe)}</span>` : '')
      + (open ? ' <span style="color:var(--accent)">● geöffnet</span>' : '');
    html += `<div class="card kcard ${done ? 'done' : ''}" data-id="${k.id}">
      <div class="kinfo">
        <div class="kt">${esc(kontrolleTitle(k))}${badges}</div>
        <div class="ks">${k.kunde.planDatum ? '📅 <b>' + esc(new Date(k.kunde.planDatum + 'T12:00:00').toLocaleDateString('de-CH')) + '</b> · ' : ''}${esc(k.kunde.gebaeudeart || '–')} · VNB ${esc(k.kunde.zaehler || '–')} · ${k.uvs.length} Anlagen · ${k.maengel.filter(m => !istInfo(m)).length} Mängel${zeitTotal(k) ? ' · ⏱ ' + esc(zeitTotal(k)) : ''} · geändert ${fmtDate(k.updatedAt)}</div>
      </div>
      <button class="btn primary small" data-act="open">Öffnen</button>
      <button class="btn danger small" data-act="del">Löschen</button>
    </div>`;
  }
  v.innerHTML = html;
  $('#btnNewK').addEventListener('click', async () => {
    S.kontrolle = newKontrolle();
    S.uvId = null;
    await dbPut('kontrollen', S.kontrolle);
    go('kunde');
  });
  $$('.kcard button').forEach(b => b.addEventListener('click', async () => {
    const id = b.closest('.kcard').dataset.id;
    if (b.dataset.act === 'open') {
      S.kontrolle = await dbGet('kontrollen', id);
      S.uvId = S.kontrolle.uvs.length ? S.kontrolle.uvs[0].id : null;
      go('kunde');
    } else {
      const k = await dbGet('kontrollen', id);
      if (!confirm(`Kontrolle «${kontrolleTitle(k)}» wirklich löschen?\nAlle Daten und Fotos dieser Kontrolle gehen verloren.`)) return;
      for (const m of k.maengel) for (const f of m.fotos) await dbDel('photos', f);
      await dbDel('kontrollen', id);
      if (S.kontrolle && S.kontrolle.id === id) { S.kontrolle = null; S.uvId = null; }
      render();
    }
  }));
}

/* ============================================================
   Ansicht: Kundendaten
   ============================================================ */

function renderKunde() {
  const v = $('#view');
  const ku = S.kontrolle.kunde;
  const gebOpts = SETTINGS.gebaeudeArten.map(g => `<option value="${esc(g)}"></option>`).join('');
  v.innerHTML = `<h2>Kundendaten</h2>
  <div class="card">
    <h3 style="margin-top:0">Auftrag</h3>
    <div class="row">
      <div class="narrow" style="flex:0 0 200px"><label class="f">Auftragsnummer</label><input type="text" id="k_anr" value="${esc(ku.auftragNr)}"></div>
      <div><label class="f">Auftragsbezeichnung</label><input type="text" id="k_abez" value="${esc(ku.auftragBez)}" placeholder="z.B. Periodische Kontrolle NIV 25"></div>
      <div><label class="f">Kontrollumfang</label><input type="text" id="k_kumf" value="${esc(ku.kontrollumfang)}" placeholder="z.B. Gesamte Installation Wohnhaus"></div>
      <div class="narrow" style="flex:0 0 200px"><label class="f">Geplantes Kontrolldatum</label><input type="date" id="k_plan" value="${esc(ku.planDatum)}"></div>
    </div>
  </div>
  <div class="card">
    <h3 style="margin-top:0">Ort der Anlage</h3>
    <div class="row">
      <div><label class="f">Gebäudeart</label><input type="text" id="k_geb" list="gebliste" value="${esc(ku.gebaeudeart)}"><datalist id="gebliste">${gebOpts}</datalist></div>
      <div><label class="f">VNB (Verteilnetzbetreiber, z.B. BKW, EWB)</label><input type="text" id="k_zaehler" value="${esc(ku.zaehler)}"></div>
    </div>
    <div class="row">
      <div style="flex:2"><label class="f">Strasse, Nr.</label><input type="text" id="k_str" value="${esc(ku.strasse)}"></div>
      <div class="narrow"><label class="f">PLZ</label><input type="text" id="k_plz" inputmode="numeric" value="${esc(ku.plz)}"></div>
      <div><label class="f">Ort</label><input type="text" id="k_ort" value="${esc(ku.ort)}"></div>
    </div>
    <label class="f">Bemerkungen / Besonderheiten (z.B. für die Vorbereitung, Schlüssel, Zugang, Kontaktperson)</label>
    <textarea id="k_bem">${esc(ku.bemerkung)}</textarea>
  </div>
  <div class="card">
    <h3 style="margin-top:0">Eigentümer</h3>
    <div class="btnrow" style="margin-top:0"><button class="btn small" id="btnCopyAdr">⤵ Adresse der Anlage übernehmen</button></div>
    <div class="row">
      <div><label class="f">Name</label><input type="text" id="k_ename" value="${esc(ku.eigName)}"></div>
      <div><label class="f">Telefon</label><input type="text" id="k_etel" inputmode="tel" value="${esc(ku.eigTel)}"></div>
      <div><label class="f">E-Mail</label><input type="text" id="k_email" inputmode="email" autocapitalize="none" value="${esc(ku.eigMail)}"></div>
    </div>
    <div class="row">
      <div style="flex:2"><label class="f">Strasse, Nr.</label><input type="text" id="k_estr" value="${esc(ku.eigStrasse)}"></div>
      <div class="narrow"><label class="f">PLZ</label><input type="text" id="k_eplz" inputmode="numeric" value="${esc(ku.eigPlz)}"></div>
      <div><label class="f">Ort</label><input type="text" id="k_eort" value="${esc(ku.eigOrt)}"></div>
    </div>
    <label class="f" style="margin-top:14px"><input type="checkbox" id="k_rabw" ${ku.rechAbw ? 'checked' : ''} style="width:auto;margin-right:8px">Rechnungsadresse weicht ab</label>
    <div id="rechblock" style="display:${ku.rechAbw ? 'block' : 'none'}">
      <div class="row">
        <div><label class="f">Name (Rechnung)</label><input type="text" id="k_rname" value="${esc(ku.rechName)}"></div>
      </div>
      <div class="row">
        <div style="flex:2"><label class="f">Strasse, Nr.</label><input type="text" id="k_rstr" value="${esc(ku.rechStrasse)}"></div>
        <div class="narrow"><label class="f">PLZ</label><input type="text" id="k_rplz" inputmode="numeric" value="${esc(ku.rechPlz)}"></div>
        <div><label class="f">Ort</label><input type="text" id="k_rort" value="${esc(ku.rechOrt)}"></div>
      </div>
    </div>
  </div>`;
  const map = {
    k_anr: 'auftragNr', k_abez: 'auftragBez', k_kumf: 'kontrollumfang', k_plan: 'planDatum',
    k_geb: 'gebaeudeart', k_zaehler: 'zaehler', k_str: 'strasse', k_plz: 'plz', k_ort: 'ort', k_bem: 'bemerkung',
    k_ename: 'eigName', k_etel: 'eigTel', k_email: 'eigMail', k_estr: 'eigStrasse', k_eplz: 'eigPlz', k_eort: 'eigOrt',
    k_rname: 'rechName', k_rstr: 'rechStrasse', k_rplz: 'rechPlz', k_rort: 'rechOrt'
  };
  for (const [id, key] of Object.entries(map)) bindInput($('#' + id), ku, key, el => {
    if (['k_str', 'k_plz', 'k_ort'].includes(el.id)) $('#ctxtitle').textContent = kontrolleTitle(S.kontrolle);
  });
  $('#k_rabw').addEventListener('change', e => {
    ku.rechAbw = e.target.checked;
    $('#rechblock').style.display = ku.rechAbw ? 'block' : 'none';
    save();
  });
  $('#btnCopyAdr').addEventListener('click', () => {
    ku.eigStrasse = ku.strasse;
    ku.eigPlz = ku.plz;
    ku.eigOrt = ku.ort;
    save();
    renderKunde();
  });
}

/* ============================================================
   Ansicht: Anlagen (intern «uv») + Gruppen erfassen
   ============================================================ */

function uvChips(onSwitch) {
  const k = S.kontrolle;
  let html = `<div class="chips">`;
  for (const uv of k.uvs) {
    html += `<button class="chip ${uv.id === S.uvId ? 'active' : ''}" data-uvid="${uv.id}">${esc(uv.name || 'Anlage ohne Name')}</button>`;
  }
  html += `<button class="chip add" id="chipAddUv">＋ Anlage</button></div>`;
  return {
    html,
    wire() {
      $$('.chip[data-uvid]').forEach(c => c.addEventListener('click', () => { S.uvId = c.dataset.uvid; onSwitch(); }));
      const add = $('#chipAddUv');
      if (add) add.addEventListener('click', () => {
        const uv = newUv('Anlage ' + (k.uvs.length + 1));
        k.uvs.push(uv); S.uvId = uv.id; save(); onSwitch();
      });
    }
  };
}

const DIKTAT_HILFE = `<b>So diktierst du die Gruppen</b> (Mikrofon-Taste der iPad-Tastatur im Textfeld unten drücken):<br>
Sage pro Sicherungsgruppe: <b>Nummer, dann Bezeichnung</b>, danach den Befehl <b>«neue Zeile»</b>.<br>
Beispiel gesprochen: <i>«F1 Wohnen Essen Küche <b>neue Zeile</b> F2 Zimmer eins und zwei <b>neue Zeile</b> F3 Geschirrspüler»</i><br>
Der Befehl «neue Zeile» erzeugt den Zeilenumbruch – jede Zeile wird zu einer Gruppe. Satzzeichen sind nicht nötig.
Danach «Zeilen übernehmen» tippen. Du kannst den Text vorher noch von Hand korrigieren.`;

function parseDictation(text) {
  const out = [];
  for (let line of text.split(/\n+/)) {
    line = line.trim().replace(/[.,;:!]+$/, '').trim();
    if (!line) continue;
    // "F 1" -> "F1" (Diktat fügt gerne Leerzeichen ein)
    line = line.replace(/^([A-Za-z]{1,2})\s+(\d)/, '$1$2');
    const m = line.match(/^(\S+)\s+(.+)$/);
    if (m && /\d/.test(m[1]) && m[1].length <= 8 && /^[A-Za-z0-9./-]+$/.test(m[1])) {
      out.push({ nr: m[1].toUpperCase(), bez: m[2].trim() });
    } else {
      out.push({ nr: '', bez: line });
    }
  }
  return out;
}

function renderUvView() {
  const v = $('#view');
  const chips = uvChips(() => renderUvView());
  const uv = curUv();
  const k = S.kontrolle;
  const hakCard = `<div class="card">
    <label class="f" style="margin-top:0">HAK (Hausanschlusskasten) – einer pro Gebäude</label>
    <input type="text" id="hakfeld" value="${esc(k.hak || '')}" placeholder="z.B. DIII 60 A, IK 950 A">
  </div>`;
  let html = `<h2>Anlagen</h2>${hakCard}${chips.html}`;
  if (!uv) {
    html += `<div class="empty">Noch keine Anlage. Tippe auf <b>＋ Anlage</b>.</div>`;
    v.innerHTML = html;
    chips.wire();
    bindInput($('#hakfeld'), k, 'hak');
    return;
  }
  const inspChips = (SETTINGS.inspektoren || []).length
    ? (SETTINGS.inspektoren || []).map(i => `<button class="chip ${(uv.geprueft || []).includes(i.kuerzel) ? 'active' : ''}" data-kz="${esc(i.kuerzel)}" title="${esc(i.name)}">${esc(i.kuerzel)}</button>`).join('')
    : '<span class="hint" style="display:inline">Zuerst unter ⚙️ Optionen Inspektoren erfassen.</span>';
  html += `<div class="card">
    <div class="row">
      <div><label class="f">Name der Anlage</label><input type="text" id="uv_name" value="${esc(uv.name)}" placeholder="z.B. UV Wohnung EG"></div>
      <div><label class="f">Zählernummer</label><input type="text" id="uv_ort" value="${esc(uv.ort)}" placeholder="z.B. 10096600"></div>
      <div><label class="f">Stromkunde (Mieter/Bewohner)</label><input type="text" id="uv_kunde" value="${esc(uv.stromkunde)}"></div>
    </div>
    <label class="f">Geprüft durch</label>
    <div class="chips" id="gepChips" style="margin-bottom:4px">${inspChips}</div>
    <div class="btnrow" style="margin-top:12px"><button class="btn danger small" id="btnDelUv">Anlage löschen</button></div>
  </div>

  <div class="card">
    <h3 style="margin-top:0">Gruppen per Diktat erfassen</h3>
    <div class="hint">${DIKTAT_HILFE}</div>
    <textarea id="diktat" placeholder="F1 Wohnen Essen Küche&#10;F2 Zimmer 1, Zimmer 2&#10;F3 Geschirrspüler"></textarea>
    <div class="btnrow"><button class="btn primary" id="btnParse">Zeilen übernehmen</button></div>
  </div>

  <div class="card">
    <h3 style="margin-top:0">Gruppen (${uv.gruppen.length})</h3>
    <div class="hint">Die erste Zeile ist die <b>Zuleitung der Anlage</b> – ihr «IK Ende» wird automatisch als «IK Anfang» aller anderen Gruppen übernommen.</div>
    <div id="glist"></div>
    <div class="btnrow"><button class="btn" id="btnAddG">＋ Zeile hinzufügen</button></div>
  </div>`;
  v.innerHTML = html;
  chips.wire();

  bindInput($('#hakfeld'), k, 'hak');
  bindInput($('#uv_name'), uv, 'name');
  bindInput($('#uv_ort'), uv, 'ort');
  bindInput($('#uv_kunde'), uv, 'stromkunde');

  $$('#gepChips .chip').forEach(ch => ch.addEventListener('click', () => {
    const kz = ch.dataset.kz;
    uv.geprueft = uv.geprueft || [];
    if (uv.geprueft.includes(kz)) uv.geprueft = uv.geprueft.filter(x => x !== kz);
    else uv.geprueft.push(kz);
    ch.classList.toggle('active');
    save();
  }));

  $('#btnDelUv').addEventListener('click', () => {
    if (!confirm(`Anlage «${uv.name || 'ohne Name'}» mit allen Gruppen löschen?`)) return;
    S.kontrolle.uvs = S.kontrolle.uvs.filter(u => u.id !== uv.id);
    S.uvId = S.kontrolle.uvs.length ? S.kontrolle.uvs[0].id : null;
    save(); renderUvView();
  });

  $('#btnParse').addEventListener('click', () => {
    const parsed = parseDictation($('#diktat').value);
    if (!parsed.length) { alert('Keine Zeilen gefunden.'); return; }
    for (const p of parsed) uv.gruppen.push(newGruppe(p.nr, p.bez));
    $('#diktat').value = '';
    save(); renderUvView();
  });

  $('#btnAddG').addEventListener('click', () => {
    uv.gruppen.push(newGruppe('', ''));
    save(); renderUvView();
  });

  renderGruppenListe(uv);
}

function renderGruppenListe(uv) {
  const el = $('#glist');
  el.innerHTML = uv.gruppen.map((g, i) => `
    <div class="gruppenrow" data-gid="${g.id}">
      ${i === 0 ? '<span class="zuleitung-tag">ZULEITUNG</span>' : ''}
      <input type="text" class="nr" value="${esc(g.nr)}" placeholder="Nr.">
      <input type="text" class="bez" value="${esc(g.bez)}" placeholder="Bezeichnung / Ort, Anlageteil">
      <button class="iconbtn up" title="nach oben">▲</button>
      <button class="iconbtn down" title="nach unten">▼</button>
      <button class="iconbtn del" title="löschen">🗑</button>
    </div>`).join('');
  $$('#glist .gruppenrow').forEach(rowEl => {
    const g = uv.gruppen.find(x => x.id === rowEl.dataset.gid);
    bindInput(rowEl.querySelector('.nr'), g, 'nr');
    bindInput(rowEl.querySelector('.bez'), g, 'bez');
    rowEl.querySelector('.del').addEventListener('click', () => {
      if (g.bez && !confirm(`Zeile «${g.nr} ${g.bez}» löschen?`)) return;
      uv.gruppen = uv.gruppen.filter(x => x.id !== g.id);
      save(); renderGruppenListe(uv);
    });
    rowEl.querySelector('.up').addEventListener('click', () => moveGruppe(uv, g.id, -1));
    rowEl.querySelector('.down').addEventListener('click', () => moveGruppe(uv, g.id, 1));
  });
}

function moveGruppe(uv, gid, dir) {
  const i = uv.gruppen.findIndex(x => x.id === gid);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= uv.gruppen.length) return;
  [uv.gruppen[i], uv.gruppen[j]] = [uv.gruppen[j], uv.gruppen[i]];
  save(); renderGruppenListe(uv);
}

/* ============================================================
   Ansicht: Schnell-Ausfüllen
   ============================================================ */

function gruppeSummary(g) {
  const parts = [g.art, g.leiter, g.char, g.inA ? g.inA + 'A' : ''].filter(Boolean);
  return parts.length ? parts.join(' · ') : 'noch nicht ausgefüllt';
}

function renderFill() {
  const v = $('#view');
  const chips = uvChips(() => { S.fillGid = null; renderFill(); });
  const uv = curUv();
  let html = `<h2>Schnell-Ausfüllen</h2>${chips.html}`;
  if (!uv || uv.gruppen.length === 0) {
    html += `<div class="empty">Zuerst unter <b>🔌 Anlagen</b> Gruppen erfassen.</div>`;
    v.innerHTML = html; chips.wire(); return;
  }
  if (!S.fillGid || !uv.gruppen.some(g => g.id === S.fillGid)) S.fillGid = uv.gruppen[0].id;

  const optSection = (label, key, values) => `
    <div class="optlabel">${label}</div>
    <div class="optbtns" data-key="${key}">
      ${values.map(val => `<button data-val="${esc(val)}" class="${S.fillSel[key] === val ? 'sel' : ''}">${esc(val)}</button>`).join('')}
    </div>`;

  html += `<div class="hint">Links Gruppe wählen → rechts die vier Eigenschaften antippen → <b>Übernehmen</b>. Die Auswahl bleibt für die nächste Gruppe stehen (praktisch bei ähnlichen Gruppen). Vorbefüllt werden: Art/Typ, Leiteranzahl×Querschnitt, Charakteristik, In, RISO (${esc(SETTINGS.risoDefault)}, leer bei 2x), Rlo (${esc(SETTINGS.rloDefault)}) und bei FI-Typen RCD In + ${esc(SETTINGS.idnDefault)} mA.</div>
  <div class="filllayout">
    <div class="fillleft" id="fillleft"></div>
    <div class="fillright card">
      ${optSection('1 · Kabelart', 'kabel', SETTINGS.kabelArten)}
      ${optSection('2 · Anzahl Drähte', 'draehte', SETTINGS.draehte)}
      ${optSection('3 · Art der Sicherung', 'sich', SETTINGS.sicherungsArten)}
      ${optSection('4 · Sicherungsgrösse [A]', 'amp', SETTINGS.ampere)}
      <div class="btnrow" style="margin-top:16px">
        <button class="btn primary" id="btnApply" style="flex:1">✓ Übernehmen &amp; weiter</button>
        <button class="btn" id="btnSkip">Überspringen</button>
      </div>
    </div>
  </div>`;
  v.innerHTML = html;
  chips.wire();

  const paintLeft = () => {
    $('#fillleft').innerHTML = uv.gruppen.map((g, i) => `
      <button class="fillgroup ${g.id === S.fillGid ? 'active' : ''}" data-gid="${g.id}">
        <span class="gnr">${esc(g.nr || (i === 0 ? 'Zul.' : '–'))}</span>${esc(g.bez)}
        <span class="gsum ${g.art || g.char ? 'done' : ''}">${esc(gruppeSummary(g))}</span>
      </button>`).join('');
    $$('#fillleft .fillgroup').forEach(b => b.addEventListener('click', () => {
      S.fillGid = b.dataset.gid; paintLeft();
    }));
    const act = $('#fillleft .fillgroup.active');
    if (act) act.scrollIntoView({ block: 'nearest' });
  };
  paintLeft();

  $$('.optbtns').forEach(box => box.addEventListener('click', e => {
    const btn = e.target.closest('button'); if (!btn) return;
    const key = box.dataset.key;
    S.fillSel[key] = (S.fillSel[key] === btn.dataset.val) ? null : btn.dataset.val;
    box.querySelectorAll('button').forEach(b => b.classList.toggle('sel', b.dataset.val === S.fillSel[key]));
  }));

  const advance = () => {
    const i = uv.gruppen.findIndex(g => g.id === S.fillGid);
    if (i < uv.gruppen.length - 1) S.fillGid = uv.gruppen[i + 1].id;
    paintLeft();
  };

  $('#btnApply').addEventListener('click', () => {
    const g = uv.gruppen.find(x => x.id === S.fillGid);
    if (!g) return;
    applyFill(g);
    save();
    advance();
  });
  $('#btnSkip').addEventListener('click', advance);
}

function applyFill(g) {
  const s = S.fillSel;
  if (s.kabel) g.art = s.kabel;
  const qs = s.amp ? (SETTINGS.querschnitt[s.amp] || '') : '';
  if (s.draehte || qs) g.leiter = (s.draehte ? s.draehte + 'x' : '') + qs;
  if (s.sich) g.char = s.sich;
  if (s.amp) g.inA = s.amp;
  g.riso = (s.draehte === '2') ? '' : SETTINGS.risoDefault;
  g.rlo = SETTINGS.rloDefault;
  if (s.sich && s.sich.toUpperCase().includes('FI')) {
    g.rcdIn = s.amp || '';
    g.rcdMa = SETTINGS.idnDefault;
  } else {
    g.rcdIn = ''; g.rcdMa = '';
  }
}

/* ============================================================
   Ansicht: Messmodus (Tabelle)
   ============================================================ */

const MESS_COLS = [
  { key: 'nr', label: 'Nr.', w: 4 },
  { key: 'bez', label: 'Ort / Anlageteil', cls: 'wide', w: 13 },
  { key: 'art', label: 'Art/ Typ', w: 5 },
  { key: 'leiter', label: 'Leiter/ Quer.', w: 6.5 },
  { key: 'char', label: 'Charakt.', w: 6 },
  { key: 'inA', label: 'In [A]', num: true, w: 4.5 },
  { key: 'ikAnfLPE', label: 'IK Anf. L-PE', num: true, w: 6 },
  { key: 'ikEndLPE', label: 'IK Ende L-PE', num: true, w: 6 },
  { key: 'ikAnfLN', label: 'IK Anf. L-N', num: true, w: 6 },
  { key: 'ikEndLN', label: 'IK Ende L-N', num: true, w: 6 },
  { key: 'riso', label: 'RISO [MΩ]', num: true, w: 5.5 },
  { key: 'rlo', label: 'Rlo', w: 5.5 },
  { key: 'rcdIn', label: 'RCD In [A]', num: true, w: 5 },
  { key: 'rcdMa', label: 'IΔN [mA]', num: true, w: 5 },
  { key: 'ausl', label: 'Ausl. [ms]', num: true, w: 5.5 },
  { key: 'weiteres', label: 'Weiteres', cls: 'wide', w: 10.5 }
];

function renderMess() {
  const v = $('#view');
  const chips = uvChips(() => renderMess());
  const uv = curUv();
  let html = `<h2>Messwerte erfassen</h2>${chips.html}`;
  if (!uv || uv.gruppen.length === 0) {
    html += `<div class="empty">Zuerst unter <b>🔌 Anlagen</b> Gruppen erfassen.</div>`;
    v.innerHTML = html; chips.wire(); return;
  }
  html += `<div class="btnrow">
      <button class="btn primary" id="btnMangel">⚠️ Mangel erfassen</button>
    </div>
    <div class="hint">Gelbe Zeile = Zuleitung der Anlage. Trägst du dort <b>IK Ende</b> ein, wird der Wert automatisch als <b>IK Anfang</b> in alle Gruppen darunter übernommen (nur leere bzw. automatisch gefüllte Felder werden überschrieben).</div>
    <div class="tablewrap"><table class="mess">
    <colgroup>${MESS_COLS.map(c => `<col style="width:${c.w}%">`).join('')}</colgroup>
    <thead><tr>${MESS_COLS.map(c => `<th class="${c.cls || ''}">${c.label}</th>`).join('')}</tr></thead>
    <tbody>
    ${uv.gruppen.map((g, i) => `<tr class="${i === 0 ? 'zuleitung' : ''}" data-gid="${g.id}">
      ${MESS_COLS.map(c => `<td class="${c.cls || ''}"><input type="text" ${c.num ? 'inputmode="decimal"' : ''} data-key="${c.key}" value="${esc(g[c.key])}"></td>`).join('')}
    </tr>`).join('')}
    </tbody></table></div>`;
  v.innerHTML = html;
  chips.wire();

  $('#btnMangel').addEventListener('click', () => {
    S.returnView = 'mess';
    S.kontrolle.maengel.push(newMangel(uv.id));
    save();
    go('maengel');
  });

  $$('table.mess input').forEach(inp => {
    const tr = inp.closest('tr');
    const g = uv.gruppen.find(x => x.id === tr.dataset.gid);
    const key = inp.dataset.key;
    inp.addEventListener('focus', () => { inp.dataset.prev = g[key]; inp.select && inp.select(); });
    inp.addEventListener('input', () => {
      const oldVal = g[key];
      g[key] = inp.value;
      if (uv.gruppen[0] === g && (key === 'ikEndLPE' || key === 'ikEndLN')) {
        propagateIk(uv, key, oldVal, inp.value);
        refreshIkAnf(uv);
      }
      save();
    });
  });
}

function propagateIk(uv, endKey, oldVal, newVal) {
  const anfKey = endKey === 'ikEndLPE' ? 'ikAnfLPE' : 'ikAnfLN';
  for (const g of uv.gruppen.slice(1)) {
    if (g[anfKey] === '' || g[anfKey] === oldVal) g[anfKey] = newVal;
  }
}

function refreshIkAnf(uv) {
  $$('table.mess tbody tr').forEach((tr, i) => {
    if (i === 0) return;
    const g = uv.gruppen[i];
    if (!g) return;
    tr.querySelectorAll('input').forEach(inp => {
      if (inp.dataset.key === 'ikAnfLPE') inp.value = g.ikAnfLPE;
      if (inp.dataset.key === 'ikAnfLN') inp.value = g.ikAnfLN;
    });
  });
}

/* ============================================================
   Ansicht: Mängel
   ============================================================ */

async function renderMaengel() {
  const v = $('#view');
  const k = S.kontrolle;
  let html = `<h2>Mängel (${k.maengel.length})</h2>
    <div class="btnrow">
      <button class="btn primary" id="btnAddM">＋ Mangel</button>
      <button class="btn" id="btnAddI">＋ Info</button>
      ${S.returnView ? '<button class="btn" id="btnBack">← Zurück zum Messen</button>' : ''}
    </div>`;
  if (!k.maengel.length) html += `<div class="empty">Keine Mängel erfasst. Sehr schön! 🎉</div>`;
  const uvOpts = uvId => ['<option value="">– Anlage wählen –</option>']
    .concat(k.uvs.map(u => `<option value="${u.id}" ${u.id === uvId ? 'selected' : ''}>${esc(u.name || 'Anlage ohne Name')}</option>`)).join('');
  let mNr = 0;
  k.maengel.forEach(m => {
    const info = istInfo(m);
    if (!info) mNr++;
    const vorlagen = SETTINGS.infoTexte || [];
    html += `<div class="card mangelcard ${info ? 'infocard' : ''}" data-mid="${m.id}">
      <div class="row" style="align-items:flex-end">
        <div class="narrow" style="flex:0 0 auto">
          <label class="f">${info ? 'Info' : 'Mangel ' + mNr}</label>
          <div class="typtoggle">
            <button class="t_mangel ${info ? '' : 'on'}">⚠️ Mangel</button>
            <button class="t_info ${info ? 'on' : ''}">ℹ️ Info</button>
          </div>
        </div>
        <div><label class="f">Anlage</label><select class="m_uv">${uvOpts(m.uvId)}</select></div>
        <div><label class="f">Ort (Zimmer, Anlageteil)</label><input type="text" class="m_ort" value="${esc(m.ort)}"></div>
      </div>
      ${info ? `<label class="f">Textbaustein einfügen</label>
      <select class="m_vorlage">
        <option value="">– Vorlage wählen –</option>
        ${vorlagen.map((t, j) => `<option value="${j}">${esc(t.length > 80 ? t.slice(0, 80) + '…' : t)}</option>`).join('')}
      </select>` : ''}
      <label class="f">${info ? 'Informationstext' : 'Mängeltext'}</label>
      <textarea class="m_text">${esc(m.text)}</textarea>
      <div class="btnrow">
        <label class="btn" style="display:inline-flex;align-items:center;gap:8px;cursor:pointer">📷 Foto aufnehmen / wählen
          <input type="file" class="m_foto" accept="image/*" capture="environment" multiple style="display:none">
        </label>
        <button class="btn danger small m_del">${info ? 'Info löschen' : 'Mangel löschen'}</button>
      </div>
      <div class="fotothumbs"></div>
    </div>`;
  });
  v.innerHTML = html;

  $('#btnAddM').addEventListener('click', () => {
    k.maengel.push(newMangel(curUv() ? curUv().id : ''));
    save(); renderMaengel();
  });
  $('#btnAddI').addEventListener('click', () => {
    const m = newMangel(curUv() ? curUv().id : '');
    m.typ = 'info';
    k.maengel.push(m);
    save(); renderMaengel();
  });
  const back = $('#btnBack');
  if (back) back.addEventListener('click', () => { S.returnView = null; go('mess'); });

  for (const card of $$('.mangelcard')) {
    const m = k.maengel.find(x => x.id === card.dataset.mid);
    card.querySelector('.t_mangel').addEventListener('click', () => {
      if (istInfo(m)) { m.typ = 'mangel'; save(); renderMaengel(); }
    });
    card.querySelector('.t_info').addEventListener('click', () => {
      if (!istInfo(m)) { m.typ = 'info'; save(); renderMaengel(); }
    });
    const vorlSel = card.querySelector('.m_vorlage');
    if (vorlSel) vorlSel.addEventListener('change', () => {
      const t = (SETTINGS.infoTexte || [])[Number(vorlSel.value)];
      if (t === undefined) return;
      m.text = m.text ? m.text + '\n' + t : t;
      card.querySelector('.m_text').value = m.text;
      vorlSel.value = '';
      save();
    });
    card.querySelector('.m_uv').addEventListener('change', e => { m.uvId = e.target.value; save(); });
    bindInput(card.querySelector('.m_ort'), m, 'ort');
    bindInput(card.querySelector('.m_text'), m, 'text');
    card.querySelector('.m_del').addEventListener('click', async () => {
      if (!confirm(istInfo(m) ? 'Diese Info löschen?' : 'Diesen Mangel löschen?')) return;
      for (const f of m.fotos) await dbDel('photos', f);
      k.maengel = k.maengel.filter(x => x.id !== m.id);
      save(); renderMaengel();
    });
    card.querySelector('.m_foto').addEventListener('change', async e => {
      for (const file of e.target.files) {
        const blob = await resizePhoto(file);
        const pid = uid();
        await dbPut('photos', { id: pid, blob });
        m.fotos.push(pid);
      }
      e.target.value = '';
      save(true); renderMaengel();
    });
    paintThumbs(card, m);
  }
}

async function paintThumbs(card, m) {
  const box = card.querySelector('.fotothumbs');
  box.innerHTML = '';
  for (const pid of m.fotos) {
    const rec = await dbGet('photos', pid);
    if (!rec) continue;
    const div = document.createElement('div');
    div.className = 'thumb';
    const img = document.createElement('img');
    img.src = URL.createObjectURL(rec.blob);
    const del = document.createElement('button');
    del.className = 'del'; del.textContent = '✕';
    del.addEventListener('click', async () => {
      if (!confirm('Foto löschen?')) return;
      await dbDel('photos', pid);
      m.fotos = m.fotos.filter(x => x !== pid);
      save(); paintThumbs(card, m);
    });
    div.append(img, del);
    box.append(div);
  }
}

// Unterschrift: als PNG speichern, damit ein transparenter Hintergrund erhalten bleibt
function resizeSig(file, maxW = 800) {
  return new Promise((res, rej) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      let { width: w, height: h } = img;
      if (w > maxW) { h = Math.round(h * maxW / w); w = maxW; }
      const cv = document.createElement('canvas');
      cv.width = w; cv.height = h;
      cv.getContext('2d').drawImage(img, 0, 0, w, h);
      URL.revokeObjectURL(url);
      cv.toBlob(b => b ? res(b) : rej(new Error('toBlob fehlgeschlagen')), 'image/png');
    };
    img.onerror = () => { URL.revokeObjectURL(url); rej(new Error('Bild konnte nicht gelesen werden')); };
    img.src = url;
  });
}

function resizePhoto(file, maxDim = 1600, quality = 0.82) {
  return new Promise((res, rej) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      let { width: w, height: h } = img;
      if (Math.max(w, h) > maxDim) {
        const f = maxDim / Math.max(w, h);
        w = Math.round(w * f); h = Math.round(h * f);
      }
      const cv = document.createElement('canvas');
      cv.width = w; cv.height = h;
      cv.getContext('2d').drawImage(img, 0, 0, w, h);
      URL.revokeObjectURL(url);
      cv.toBlob(b => b ? res(b) : rej(new Error('toBlob fehlgeschlagen')), 'image/jpeg', quality);
    };
    img.onerror = () => { URL.revokeObjectURL(url); rej(new Error('Bild konnte nicht gelesen werden')); };
    img.src = url;
  });
}

/* ============================================================
   Ansicht: Export
   ============================================================ */

function renderExport() {
  const v = $('#view');
  const k = S.kontrolle;
  let html = `<h2>Abschluss</h2>`;
  if (!k.uvs.length) {
    html += `<div class="hint warntext">Noch keine Anlagen erfasst.</div>`;
  }
  html += `<div class="card">
    <h3 style="margin-top:0">Messdaten pro Anlage</h3>
    <label class="f"><input type="checkbox" id="csvHeader" ${S.csvHeader ? 'checked' : ''} style="width:auto;margin-right:8px">Kopfzeile im CSV einschliessen</label>
    ${k.uvs.map(uv => `
      <div class="row" style="align-items:center;margin-top:10px" data-uvid="${uv.id}">
        <div style="flex:1;font-weight:600">${esc(uv.name || 'Anlage ohne Name')} <span class="hint" style="display:inline">(${uv.gruppen.length} Zeilen)</span></div>
        <button class="btn small" data-act="copy">📋 CSV kopieren</button>
        <button class="btn small" data-act="csv">⬇︎ CSV-Datei</button>
        <button class="btn small" data-act="skx">⬇︎ SKX (ElektroForm)</button>
      </div>`).join('')}
  </div>
  <div class="card">
    <h3 style="margin-top:0">Kontrollbericht (PDF)</h3>
    <div class="hint">Anhaken, welche Anlagen <b>zusammen in einen Bericht</b> kommen – für Einzelberichte jeweils nur eine anwählen und erneut drucken. Auf dem iPad: <b>Drucken → in der Vorschau «Als PDF sichern»</b> (oder Teilen-Symbol im Druckdialog). Der Dateiname wird automatisch gesetzt: <i>Kontrollbericht_Anlage_Strasse_Ort</i>.</div>
    <div id="rptsel">
    ${k.uvs.map(uv => {
      const nm = k.maengel.filter(m => m.uvId === uv.id && !istInfo(m)).length;
      const ni = k.maengel.filter(m => m.uvId === uv.id && istInfo(m)).length;
      return `<label class="f rptselrow"><input type="checkbox" class="rptuvsel" value="${uv.id}" checked style="width:auto;margin-right:8px">${esc(uv.name || 'Anlage ohne Name')}${uv.ort ? ' – Zähler ' + esc(uv.ort) : ''} <span class="hint" style="display:inline">(${nm} ${nm === 1 ? 'Mangel' : 'Mängel'}${ni ? ', ' + ni + ' Info' : ''})</span></label>`;
    }).join('')}
    ${(() => {
      const n = k.maengel.filter(m => !k.uvs.some(u => u.id === m.uvId)).length;
      return n ? `<label class="f rptselrow"><input type="checkbox" id="rptohne" checked style="width:auto;margin-right:8px">Allgemeine Einträge (ohne Anlage) <span class="hint" style="display:inline">(${n})</span></label>` : '';
    })()}
    </div>
    <label class="f">Inspektor(en) im Bericht</label>
    ${(() => {
      const insps = SETTINGS.inspektoren || [];
      if (!insps.length) return '<div class="hint">Keine Inspektoren erfasst – bitte unter ⚙️ Optionen anlegen.</div>';
      const union = new Set();
      k.uvs.forEach(uv => (uv.geprueft || []).forEach(kz => union.add(kz)));
      return `<div id="rptinsp">${insps.map(i =>
        `<label class="f rptselrow"><input type="checkbox" class="rptinspsel" value="${esc(i.kuerzel)}" ${union.has(i.kuerzel) ? 'checked' : ''} style="width:auto;margin-right:8px">${esc(i.kuerzel)} – ${esc(i.name)}</label>`).join('')}</div>`;
    })()}
    <div class="btnrow">
      <button class="btn primary" id="btnReport">🖨 Bericht erstellen &amp; drucken</button>
      <button class="btn" id="btnMailKunde">✉️ Bericht per Mail senden</button>
    </div>
    <div class="hint">«Bericht per Mail senden» erstellt das PDF (mit den oben angehakten Anlagen und Inspektoren) und öffnet das Teilen-Menü – dort <b>Mail</b> wählen: <b>der Bericht ist bereits angehängt</b>. Die Kundenadresse <b>${esc(k.kunde.eigMail || '(keine E-Mail beim Eigentümer erfasst)')}</b> wird in die Zwischenablage kopiert – im Mail bei «An:» einfach einsetzen (das Teilen-Menü erlaubt kein automatisches Ausfüllen des Empfängers).</div>
  </div>
  <div class="card">
    <h3 style="margin-top:0">Status &amp; Übergabe</h3>
    <label class="f">Status der Kontrolle ${furthestStatus(k) ? '– aktuell: <b>' + esc(furthestStatus(k)) + '</b>' : ''}</label>
    <div class="chips" id="statusChips" style="margin-bottom:6px">
      ${STATUS_STUFEN.map(s => `<button class="chip ${furthestStatus(k) === s ? 'active' : ''}" data-status="${s}">${s}</button>`).join('')}
    </div>
    <div id="statusPick" style="display:none"></div>
    ${(k.statusLog || []).length ? `<div class="hint">${k.statusLog.slice().reverse().map(e => `<b>${esc(e.status)}</b> – ${esc(e.kz)}, ${fmtDate(e.ts)}`).join('<br>')}</div>` : ''}
    <label class="f">Arbeitszeiten ${(k.zeitLog || []).length ? '– Total: <b>' + esc(zeitTotal(k)) + '</b>' : ''}</label>
    ${(k.zeitLog || []).length
      ? `<div class="hint">${(k.zeitLog || []).map((e, i) => ({ e, i })).reverse().map(x =>
          `<b>${esc(x.e.zeit)}</b> – ${esc(x.e.kz)}, ${fmtDate(x.e.ts)} <button class="zdel" data-i="${x.i}">✕</button>`).join('<br>')}</div>`
      : (k.arbeitszeit ? `<div class="hint">Früher erfasst: <b>${esc(k.arbeitszeit)}</b></div>` : '')}
    <div class="row" style="align-items:flex-end">
      <div class="narrow" style="flex:0 0 220px"><label class="f">Zeit erfassen</label><input type="text" id="e_zeit" inputmode="decimal" placeholder="z.B. 3.5 h"></div>
      <div class="narrow" style="flex:0 0 auto"><button class="btn" id="btnAddZeit">＋ Erfassen</button></div>
    </div>
    <div id="zeitPick" style="display:none"></div>
    <div class="hint">Sendet <b>diese Kontrolle</b> als Datei – mit allen Daten, Fotos und der Arbeitszeit. So kann eine vorbereitete Kontrolle an den Mitarbeiter gehen und die fertige wieder zurück. Der Empfänger importiert die Datei unten bei «Backup importieren». «Teilen» öffnet auf dem iPad das Teilen-Menü (Mail, AirDrop, …) mit der Datei im Anhang.</div>
    <div class="btnrow">
      <button class="btn primary" id="btnShareK">✉️ Kontrolle teilen / per Mail senden</button>
      <button class="btn" id="btnDlK">⬇︎ Kontrolle als Datei sichern</button>
    </div>
  </div>
  <div class="card">
    <h3 style="margin-top:0">Datensicherung</h3>
    <div class="hint">Sichert <b>alle</b> Kontrollen inkl. Fotos und Einstellungen als JSON-Datei (z.B. in die Dateien-App / iCloud). «Backup importieren» nimmt sowohl Voll-Backups als auch einzelne Kontroll-Dateien (Übergabe) an.</div>
    <div class="btnrow">
      <button class="btn" id="btnBackup">⬇︎ Backup exportieren</button>
      <label class="btn" style="display:inline-flex;align-items:center;cursor:pointer">⬆︎ Backup importieren
        <input type="file" id="backupFile" accept=".json,application/json" style="display:none">
      </label>
    </div>
  </div>`;
  v.innerHTML = html;

  $('#csvHeader').addEventListener('change', e => { S.csvHeader = e.target.checked; });

  $$('.row[data-uvid] button').forEach(b => b.addEventListener('click', async () => {
    const uv = k.uvs.find(u => u.id === b.closest('.row').dataset.uvid);
    const fnBase = (uv.name || 'UV').replace(/[^\wäöüÄÖÜ\- ]+/g, '').trim().replace(/\s+/g, '_') || 'UV';
    if (b.dataset.act === 'copy') {
      try {
        await navigator.clipboard.writeText(buildCSV(uv, S.csvHeader));
        b.textContent = '✓ Kopiert!';
        setTimeout(() => { b.textContent = '📋 CSV kopieren'; }, 1500);
      } catch (e) {
        alert('Kopieren nicht möglich – nutze den Datei-Download.');
      }
    } else if (b.dataset.act === 'csv') {
      download(fnBase + '.csv', buildCSV(uv, S.csvHeader), 'text/tab-separated-values;charset=utf-8');
    } else if (b.dataset.act === 'skx') {
      download(fnBase + '.skx', '\uFEFF' + buildSKX(k, uv), 'application/octet-stream');
    }
  }));

  $('#btnReport').addEventListener('click', () => {
    const uvIds = $$('.rptuvsel:checked').map(c => c.value);
    const ohneBox = $('#rptohne');
    const includeOhne = ohneBox ? ohneBox.checked : true;
    if (k.uvs.length && !uvIds.length && !includeOhne) {
      alert('Bitte mindestens eine Anlage anwählen.');
      return;
    }
    const inspKuerzel = $$('.rptinspsel:checked').map(c => c.value);
    showReport({ uvIds, includeOhne, inspKuerzel });
  });

  $$('#statusChips .chip').forEach(ch => ch.addEventListener('click', () => {
    const status = ch.dataset.status;
    if (status === 'Gemessen' && !(k.hak || '').trim()) {
      if (!confirm('Hinweis: Das HAK-Feld (Hausanschlusskasten) im Reiter Anlagen ist noch leer.\n\nStatus «Gemessen» trotzdem setzen?')) return;
    }
    const insps = SETTINGS.inspektoren || [];
    if (!insps.length) {
      const kz = (prompt(`Status «${status}» setzen – dein Kürzel:`) || '').trim();
      if (!kz) return;
      setStatus(k, status, kz.toUpperCase());
      renderExport();
      return;
    }
    const box = $('#statusPick');
    box.style.display = '';
    box.innerHTML = `<div class="hint">Status «${esc(status)}» setzen als:</div><div class="chips">`
      + insps.map(i => `<button class="chip" data-kz="${esc(i.kuerzel)}">${esc(i.kuerzel)}</button>`).join('')
      + `<button class="chip" data-kz="">✕ Abbrechen</button></div>`;
    box.querySelectorAll('.chip').forEach(b => b.addEventListener('click', () => {
      if (b.dataset.kz) { setStatus(k, status, b.dataset.kz); renderExport(); }
      else { box.style.display = 'none'; box.innerHTML = ''; }
    }));
  }));

  $('#btnMailKunde').addEventListener('click', async () => {
    const btn = $('#btnMailKunde');
    const ku = k.kunde;
    const uvIds = $$('.rptuvsel:checked').map(c => c.value);
    const ohneBox = $('#rptohne');
    const includeOhne = ohneBox ? ohneBox.checked : true;
    const inspKuerzel = $$('.rptinspsel:checked').map(c => c.value);
    const anlage = [ku.strasse, [ku.plz, ku.ort].filter(Boolean).join(' ')].filter(Boolean).join(', ');
    btn.disabled = true;
    const oldLabel = btn.textContent;
    btn.textContent = '⏳ PDF wird erstellt …';
    try {
      const { blob, fname } = await buildReportPdf({ uvIds, includeOhne, inspKuerzel });
      const file = new File([blob], fname + '.pdf', { type: 'application/pdf' });
      // Kundenadresse in die Zwischenablage (Teilen-Menü kann keinen Empfänger vorausfüllen)
      if (ku.eigMail && navigator.clipboard) {
        try { await navigator.clipboard.writeText(ku.eigMail); } catch (e) { /* egal */ }
      }
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title: `Kontrollbericht ${anlage}` });
      } else {
        // Fallback ohne Teilen-Menü (z.B. Desktop): PDF herunterladen + Mail-Entwurf öffnen
        download(fname + '.pdf', blob, 'application/pdf');
        const subject = `Kontrollbericht ${anlage}`;
        const body = `Guten Tag\n\nIm Anhang erhalten Sie den Kontrollbericht zur elektrischen Anlage ${anlage}.\n\nFreundliche Grüsse\n${SETTINGS.inspName || ''}\n${SETTINGS.firmaName || ''}`;
        location.href = `mailto:${encodeURIComponent(ku.eigMail || '')}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
        alert('Teilen wird hier nicht unterstützt – das PDF wurde heruntergeladen und ein Mail-Entwurf geöffnet. Das PDF bitte von Hand anhängen.');
      }
    } catch (err) {
      if (!err || err.name !== 'AbortError') {
        alert('Bericht-PDF konnte nicht erstellt werden: ' + (err && err.message ? err.message : err));
      }
    } finally {
      btn.disabled = false;
      btn.textContent = oldLabel;
    }
  });

  $('#btnAddZeit').addEventListener('click', () => {
    const val = $('#e_zeit').value.trim();
    if (!val) { alert('Bitte zuerst die Zeit eintragen (z.B. 3.5 h).'); return; }
    const apply = kz => {
      (k.zeitLog = k.zeitLog || []).push({ zeit: val, kz, ts: Date.now() });
      save();
      renderExport();
    };
    const insps = SETTINGS.inspektoren || [];
    if (!insps.length) {
      const kz = (prompt(`Zeit «${val}» erfassen – dein Kürzel:`) || '').trim();
      if (!kz) return;
      apply(kz.toUpperCase());
      return;
    }
    const box = $('#zeitPick');
    box.style.display = '';
    box.innerHTML = `<div class="hint">Zeit «${esc(val)}» erfassen als:</div><div class="chips">`
      + insps.map(i => `<button class="chip" data-kz="${esc(i.kuerzel)}">${esc(i.kuerzel)}</button>`).join('')
      + `<button class="chip" data-kz="">✕ Abbrechen</button></div>`;
    box.querySelectorAll('.chip').forEach(b => b.addEventListener('click', () => {
      if (b.dataset.kz) apply(b.dataset.kz);
      else { box.style.display = 'none'; box.innerHTML = ''; }
    }));
  });

  $$('.zdel').forEach(b => b.addEventListener('click', () => {
    const i = Number(b.dataset.i);
    const e = (k.zeitLog || [])[i];
    if (!e) return;
    if (!confirm(`Zeiteintrag «${e.zeit} – ${e.kz}» löschen?`)) return;
    k.zeitLog.splice(i, 1);
    save();
    renderExport();
  }));

  $('#btnShareK').addEventListener('click', async () => {
    try {
      const json = await buildKontrolleExport(k);
      const file = new File([json], kontrolleFilename(k), { type: 'application/json' });
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title: 'Elektrokontrolle ' + kontrolleTitle(k) });
      } else {
        download(kontrolleFilename(k), json, 'application/json');
        alert('Direktes Teilen wird in diesem Browser nicht unterstützt – die Datei wurde stattdessen heruntergeladen und kann von Hand an ein Mail angehängt werden.');
      }
    } catch (err) {
      if (err && err.name === 'AbortError') return; // Teilen-Dialog abgebrochen
      alert('Teilen fehlgeschlagen: ' + (err && err.message ? err.message : err));
    }
  });

  $('#btnDlK').addEventListener('click', async () => {
    download(kontrolleFilename(k), await buildKontrolleExport(k), 'application/json');
  });

  $('#btnBackup').addEventListener('click', exportBackup);
  $('#backupFile').addEventListener('change', importBackup);
}

function kontrolleFilename(k) {
  return ['Kontrolle', fnSan(k.kunde.strasse), fnSan(k.kunde.ort)].filter(Boolean).join('_') + '.json';
}

async function buildKontrolleExport(k) {
  const photos = [];
  for (const m of k.maengel) {
    for (const pid of m.fotos) {
      const rec = await dbGet('photos', pid);
      if (rec) photos.push({ id: rec.id, data: await blobToDataURL(rec.blob) });
    }
  }
  return JSON.stringify({
    app: 'nivapp', type: 'kontrolle', version: 1,
    exported: new Date().toISOString(),
    kontrolle: k, photos
  });
}

const CSV_HEADER = ['Nr.', 'Bezeichnung', 'Art/Typ', 'Leiteranz./Quer. [mm2]', 'Art Charakt.', 'In [A]',
  'IK Anf. L-PE [A]', 'IK Ende L-PE [A]', 'IK Anf. L-N [A]', 'IK Ende L-N [A]',
  'RISO [MOhm]', 'Leitf. Schutzl.', 'RCD In/Typ [A]', 'IdN [mA]', 'Ausloesezeit [ms]'];

function csvRow(g) {
  return [g.nr, g.bez, g.art, g.leiter, g.char, g.inA,
    g.ikAnfLPE, g.ikEndLPE, g.ikAnfLN, g.ikEndLN,
    g.riso, g.rlo, g.rcdIn, g.rcdMa, g.ausl]
    .map(x => String(x ?? '').replace(/[\t\r\n]+/g, ' '));
}

function buildCSV(uv, withHeader) {
  const lines = [];
  if (withHeader) lines.push(CSV_HEADER.join('\t'));
  for (const g of uv.gruppen) lines.push(csvRow(g).join('\t'));
  return lines.join('\r\n');
}

/* ---- SKX (ElektroForm-Import, TinLine-Format) ---- */

function xmlEsc(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function normCharakt(c) {
  const m = String(c || '').match(/LS-?\s?([A-Z])/i);
  return m ? m[1].toUpperCase() : String(c || '');
}

function buildSKX(k, uv) {
  const ku = k.kunde;
  const kopf = {
    ProjName: [ku.strasse, [ku.plz, ku.ort].filter(Boolean).join(' ')].filter(Boolean).join(', '),
    ProjBez1: uv.name || '',
    ProjBez2: uv.ort || '',
    AuftragsNr: '', SchemaNr: '',
    KundeName1: ku.eigName || '', KundeName2: '',
    KundeAdresse: ku.eigStrasse || '', KundePLZ: ku.eigPlz || '', KundeOrt: ku.eigOrt || '',
    ObjektName1: [uv.name, uv.ort].filter(Boolean).join(' – ') || (ku.gebaeudeart || ''),
    ObjektAdresse: ku.strasse || '', ObjektPLZ: ku.plz || '', ObjektOrt: ku.ort || ''
  };
  const lines = ['<?xml version="1.0" encoding="utf-8" standalone="yes"?>', '<tinSchema1>', '  <KopfData>'];
  const field = (name, val) => {
    val = xmlEsc(val);
    if (val === '') lines.push(`    <${name}>\r\n    </${name}>`);
    else lines.push(`    <${name}>${val}</${name}>`);
  };
  for (const [kk, vv] of Object.entries(kopf)) field(kk, vv);
  lines.push('  </KopfData>');
  uv.gruppen.forEach((g, i) => {
    lines.push('  <Zeilen>');
    field('A01', String(i + 1));
    field('A02', g.nr);
    field('A03', g.rcdMa);
    field('A04', g.bez);
    field('A05', ''); field('A06', '');
    field('A07', g.ikAnfLPE);
    field('A08', g.ikEndLPE);
    field('A09', g.ikAnfLN);
    field('A10', g.ikEndLN);
    field('A11', ''); field('A12', '');
    field('A13.1', g.art);
    field('A13.2', g.leiter);
    field('A14', g.rcdIn);
    field('A15', g.ausl);
    field('A16', normCharakt(g.char));
    field('A17', '');
    field('A18', g.inA);
    field('A19', g.riso);
    field('A20', g.rlo);
    field('A21', '');
    lines.push('  </Zeilen>');
  });
  lines.push('</tinSchema1>');
  return lines.join('\r\n');
}

/* ---- Download-Helfer ---- */

function download(name, content, type) {
  const blob = content instanceof Blob ? content : new Blob([content], { type: type || 'text/plain;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
}

/* ---- Mängelbericht (Druck / PDF) ---- */

function fnSan(s) {
  return String(s || '').replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim();
}

async function showReport(sel) {
  const k = S.kontrolle;
  const ku = k.kunde;
  const heute = new Date().toLocaleDateString('de-CH');
  const dash = s => esc(s || '–');

  // Auswahl: welche Anlagen in diesen Bericht kommen (Standard: alle)
  const uvIds = sel && sel.uvIds ? sel.uvIds : k.uvs.map(u => u.id);
  const inclOhne = sel ? !!sel.includeOhne : true;
  const inclUvs = k.uvs.filter(u => uvIds.includes(u.id));
  const istOhneUv = m => !k.uvs.some(u => u.id === m.uvId);
  const inBericht = m => uvIds.includes(m.uvId) || (inclOhne && istOhneUv(m));
  const mangelItems = k.maengel.filter(m => !istInfo(m) && inBericht(m));
  const infoItems = k.maengel.filter(m => istInfo(m) && inBericht(m));
  const mCount = mangelItems.length;
  const uvNamen = inclUvs.map(u => (u.name || 'Anlage ohne Name') + (u.ort ? ' (Zähler ' + u.ort + ')' : ''))
    .concat(inclOhne && k.maengel.some(istOhneUv) ? ['Allgemein'] : []);

  // Inspektoren für diesen Bericht (aus der Auswahl im Abschluss)
  const selKz = (sel && sel.inspKuerzel) ? sel.inspKuerzel : [];
  let inspektoren = (SETTINGS.inspektoren || []).filter(i => selKz.includes(i.kuerzel));
  if (!inspektoren.length && SETTINGS.inspName) {
    inspektoren = [{ kuerzel: '', name: SETTINGS.inspName, tel: SETTINGS.inspTel, mail: SETTINGS.inspMail }];
  }

  const auftragTitel = [ku.auftragNr, ku.auftragBez].filter(Boolean).join(' ') || '–';

  let html = `<div class="rpthead">
    <div class="rpttitle"><h1>Kontrollbericht</h1><div>Auftrag:&nbsp;&nbsp;<b>${esc(auftragTitel)}</b></div></div>
    <table class="rpt">
      <tr>
        <td class="lbl">Auftraggeber<br>(Eigentümer)</td>
        <td><b>${dash(ku.eigName)}</b><br>${esc(ku.eigStrasse || '')}<br>${esc([ku.eigPlz, ku.eigOrt].filter(Boolean).join(' '))}</td>
        <td class="lbl">Auftragnehmer</td>
        <td><b>${dash(SETTINGS.firmaName)}</b><br>${esc(SETTINGS.firmaStrasse || '')}<br>${esc(SETTINGS.firmaPlzOrt || '')}</td>
      </tr>
      <tr>
        <td class="lbl">Ort der Installation</td>
        <td><b>${esc(ku.strasse)}, ${esc(ku.plz)} ${esc(ku.ort)}</b></td>
        <td class="lbl">Gebäudeart</td><td>${dash(ku.gebaeudeart)}</td>
      </tr>
      <tr>
        <td class="lbl">Auftragsbezeichnung</td><td>${dash(ku.auftragBez)}</td>
        <td class="lbl">VNB</td><td>${dash(ku.zaehler)}</td>
      </tr>
      <tr>
        <td class="lbl">Kontrollumfang</td><td>${dash(ku.kontrollumfang)}</td>
        <td class="lbl">Anlage(n)</td>
        <td>${uvNamen.length ? esc(uvNamen.join(', ')) : '–'}</td>
      </tr>
      <tr>
        <td class="lbl">Kontrolle am / durch</td>
        <td>${esc(heute)}<br>${inspektoren.length ? inspektoren.map(i => esc(i.name || i.kuerzel)).join('<br>') : '–'}</td>
        <td class="lbl">Tel. / E-Mail</td>
        <td>${inspektoren.length ? inspektoren.map(i => esc([i.tel, i.mail].filter(Boolean).join(' · ') || '–')).join('<br>') : '–'}</td>
      </tr>
      <tr>
        <td class="lbl">Mängel</td>
        <td colspan="3"><b>${mCount ? '☒ Ja (' + mCount + ')' : '☐ Ja'}&nbsp;&nbsp;&nbsp;${mCount ? '☐ Nein' : '☒ Nein'}</b></td>
      </tr>
    </table>
  </div>
  <h2 class="rptsection">Mängelliste</h2>`;

  if (!mCount) {
    html += `<p><b>Keine Mängel festgestellt.</b></p>`;
  } else {
    // Nach UV gruppieren, Reihenfolge der UVs beibehalten, Nummerierung fortlaufend
    const gruppen = [];
    for (const uv of inclUvs) {
      const ms = mangelItems.filter(m => m.uvId === uv.id);
      if (ms.length) gruppen.push({ titel: (uv.name || 'Anlage ohne Name') + (uv.ort ? ' – Zähler ' + uv.ort : ''), ms });
    }
    const ohne = mangelItems.filter(istOhneUv);
    if (ohne.length) gruppen.push({ titel: 'Allgemein / ohne Anlage', ms: ohne });

    let nr = 0;
    for (const grp of gruppen) {
      html += `<h3 class="rptuv">${esc(grp.titel)}</h3>`;
      for (const m of grp.ms) {
        nr++;
        let fotosHtml = '';
        for (const pid of m.fotos) {
          const rec = await dbGet('photos', pid);
          if (rec) fotosHtml += `<img src="${await blobToDataURL(rec.blob)}">`;
        }
        html += `<div class="mangel">
          <div class="mnr">${nr}.&nbsp; ${dash(m.ort)}</div>
          <div class="mtext">${esc(m.text || '–').replace(/\n/g, '<br>')}</div>
          ${fotosHtml}
        </div>`;
      }
    }
  }

  if (infoItems.length) {
    const uvNameById = id => { const u = k.uvs.find(x => x.id === id); return u ? (u.name || 'Anlage ohne Name') : ''; };
    html += `<h2 class="rptsection">Information</h2>`;
    for (const m of infoItems) {
      let fotosHtml = '';
      for (const pid of m.fotos) {
        const rec = await dbGet('photos', pid);
        if (rec) fotosHtml += `<img src="${await blobToDataURL(rec.blob)}">`;
      }
      const kopf = [uvNameById(m.uvId), m.ort].filter(Boolean).join(' – ');
      html += `<div class="mangel">
        ${kopf ? `<div class="mnr">${esc(kopf)}</div>` : ''}
        <div class="mtext">${esc(m.text || '–').replace(/\n/g, '<br>')}</div>
        ${fotosHtml}
      </div>`;
    }
  }

  let sigImg = '';
  try {
    const sigBlob = await dbGet('kv', 'signatur');
    if (sigBlob) sigImg = `<img class="sigimg" src="${await blobToDataURL(sigBlob)}" alt="">`;
  } catch (e) { /* ohne Unterschrift weiterfahren */ }

  html += `<div class="rptsig">
      <span>Datum&nbsp; <b>${esc(heute)}</b></span>
      <span>Unterschrift&nbsp; <b>${inspektoren.length ? esc(inspektoren.map(i => i.name || i.kuerzel).join(' / ')) : '–'}</b>&nbsp;${sigImg || '<span class="sigline"></span>'}</span>
    </div>`;

  if (mCount) {
    html += `<div class="erledigung">${esc(SETTINGS.erledigungsText).replace(/\n/g, '<br>')}</div>
    <div class="signconfirm">
      <div class="signhead">Die Unterzeichnenden bestätigen, dass die Mängel gemäss Kontrollbericht nach NIV Art. 3 + 4 behoben wurden.</div>
      <table class="signtable"><tr>
        <td>Datum der Mängelbehebung</td>
        <td>Firmenstempel</td>
        <td>Unterschrift fachkundige Person oder Elektro-Kontrolleur gemäss NIV Art. 27</td>
      </tr></table>
    </div>`;
  }

  // Dateiname: Kontrollbericht_UV Name_Strasse_Ort (wird beim «Als PDF sichern» übernommen)
  let uvPart;
  if (!k.uvs.length) uvPart = uvNamen.join('+') || 'Kontrolle';
  else if (inclUvs.length === k.uvs.length) uvPart = k.uvs.length > 1 ? 'alle Anlagen' : (inclUvs[0].name || 'Anlage');
  else uvPart = inclUvs.map(u => u.name || 'UV').join('+') || 'Allgemein';
  const fname = ['Kontrollbericht', fnSan(uvPart), fnSan(ku.strasse), fnSan(ku.ort)].filter(Boolean).join('_');
  const oldTitle = document.title;
  document.title = fname;
  window.addEventListener('afterprint', () => { document.title = oldTitle; }, { once: true });

  $('#printarea').innerHTML = html;
  setTimeout(() => window.print(), 150);
}

/* ---- Kontrollbericht als PDF-Datei (jsPDF) – für den Mail-Anhang via Teilen-Menü.
   Achtung: Auswahl-Logik und Aufbau entsprechen showReport() – Änderungen dort
   müssen hier nachgezogen werden! ---- */

async function buildReportPdf(sel) {
  if (!window.jspdf || !window.jspdf.jsPDF) throw new Error('PDF-Bibliothek (jspdf.min.js) nicht geladen');
  const { jsPDF } = window.jspdf;
  const k = S.kontrolle;
  const ku = k.kunde;
  const heute = new Date().toLocaleDateString('de-CH');

  const uvIds = sel && sel.uvIds ? sel.uvIds : k.uvs.map(u => u.id);
  const inclOhne = sel ? !!sel.includeOhne : true;
  const inclUvs = k.uvs.filter(u => uvIds.includes(u.id));
  const istOhneUv = m => !k.uvs.some(u => u.id === m.uvId);
  const inBericht = m => uvIds.includes(m.uvId) || (inclOhne && istOhneUv(m));
  const mangelItems = k.maengel.filter(m => !istInfo(m) && inBericht(m));
  const infoItems = k.maengel.filter(m => istInfo(m) && inBericht(m));
  const selKz = sel && sel.inspKuerzel ? sel.inspKuerzel : [];
  let inspektoren = (SETTINGS.inspektoren || []).filter(i => selKz.includes(i.kuerzel));
  if (!inspektoren.length && SETTINGS.inspName) {
    inspektoren = [{ kuerzel: '', name: SETTINGS.inspName, tel: SETTINGS.inspTel, mail: SETTINGS.inspMail }];
  }
  const uvNamen = inclUvs.map(u => (u.name || 'Anlage ohne Name') + (u.ort ? ' (Zähler ' + u.ort + ')' : ''))
    .concat(inclOhne && k.maengel.some(istOhneUv) ? ['Allgemein'] : []);

  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const W = 210, M = 15, CW = W - 2 * M, BOTTOM = 282;
  let y = M;
  const ensure = h => { if (y + h > BOTTOM) { doc.addPage(); y = M; } };
  const wrap = (t, w) => doc.splitTextToSize(String(t || '–'), w);
  const imgFormat = d => d.includes('image/png') ? 'PNG' : 'JPEG';

  // ---- Kopf ----
  const headTop = y;
  doc.setFont('helvetica', 'bold'); doc.setFontSize(15);
  doc.text('Kontrollbericht', M + 3, y + 8);
  const auftragTitel = 'Auftrag: ' + ([ku.auftragNr, ku.auftragBez].filter(Boolean).join(' ') || '–');
  doc.setFontSize(10);
  if (doc.getTextWidth(auftragTitel) > 115) doc.setFontSize(8.5); // langer Auftrag: kleiner, damit er nicht in den Titel läuft
  doc.text(auftragTitel, W - M - 3, y + 8, { align: 'right' });
  doc.setFontSize(10);
  y += 11;
  doc.setLineWidth(0.3);
  doc.line(M, y, W - M, y);
  y += 2.5;

  const L1 = M + 3, V1 = M + 38, L2 = M + 100, V2 = M + 128;
  const V1W = L2 - V1 - 4, V2W = W - M - V2 - 3, L1W = V1 - L1 - 2;
  const headRow = (l1, v1, l2, v2) => {
    doc.setFontSize(9);
    doc.setFont('helvetica', 'normal'); doc.setTextColor(90);
    const la = wrap(l1, L1W);
    doc.text(la, L1, y + 3.5);
    if (l2) doc.text(wrap(l2, V2 - L2 - 2), L2, y + 3.5);
    doc.setTextColor(0); doc.setFont('helvetica', 'bold');
    const a = wrap(v1, V1W), b = l2 ? wrap(v2, V2W) : [];
    doc.text(a, V1, y + 3.5);
    if (l2) doc.text(b, V2, y + 3.5);
    doc.setFont('helvetica', 'normal');
    y += Math.max(a.length, b.length, la.length) * 4 + 2.5;
  };
  headRow('Auftraggeber (Eigentümer)',
    [ku.eigName, ku.eigStrasse, [ku.eigPlz, ku.eigOrt].filter(Boolean).join(' ')].filter(Boolean).join('\n') || '–',
    'Auftragnehmer',
    [SETTINGS.firmaName, SETTINGS.firmaStrasse, SETTINGS.firmaPlzOrt].filter(Boolean).join('\n') || '–');
  headRow('Ort der Installation',
    [ku.strasse, [ku.plz, ku.ort].filter(Boolean).join(' ')].filter(Boolean).join(', ') || '–',
    'Gebäudeart', ku.gebaeudeart || '–');
  headRow('Auftragsbezeichnung', ku.auftragBez || '–', 'VNB', ku.zaehler || '–');
  headRow('Kontrollumfang', ku.kontrollumfang || '–', 'Anlage(n)', uvNamen.join(', ') || '–');
  headRow('Kontrolle am / durch',
    heute + (inspektoren.length ? '\n' + inspektoren.map(i => i.name || i.kuerzel).join('\n') : ''),
    'Tel. / E-Mail',
    inspektoren.length ? inspektoren.map(i => [i.tel, i.mail].filter(Boolean).join(' · ') || '–').join('\n') : '–');
  headRow('Mängel',
    mangelItems.length ? `[X] Ja (${mangelItems.length})      [  ] Nein` : '[  ] Ja      [X] Nein', '', '');
  doc.rect(M, headTop, CW, y - headTop);
  y += 8;

  const drawFotos = async fotos => {
    for (const pid of fotos) {
      const rec = await dbGet('photos', pid);
      if (!rec) continue;
      const d = await blobToDataURL(rec.blob);
      let p;
      try { p = doc.getImageProperties(d); } catch (e) { continue; }
      let w = 75, h = w * p.height / p.width;
      if (h > 75) { h = 75; w = h * p.width / p.height; }
      ensure(h + 4);
      doc.addImage(d, imgFormat(d), M + 5, y, w, h);
      y += h + 4;
    }
  };

  // ---- Mängelliste ----
  ensure(12);
  doc.setFont('helvetica', 'bold'); doc.setFontSize(13);
  doc.text('Mängelliste', M, y + 5); y += 9;

  if (!mangelItems.length) {
    doc.setFontSize(10.5);
    ensure(8); doc.text('Keine Mängel festgestellt.', M, y + 4); y += 8;
    doc.setFont('helvetica', 'normal');
  } else {
    const gruppen = [];
    for (const uv of inclUvs) {
      const ms = mangelItems.filter(m => m.uvId === uv.id);
      if (ms.length) gruppen.push({ titel: (uv.name || 'Anlage ohne Name') + (uv.ort ? ' – Zähler ' + uv.ort : ''), ms });
    }
    const ohne = mangelItems.filter(istOhneUv);
    if (ohne.length) gruppen.push({ titel: 'Allgemein / ohne Anlage', ms: ohne });
    let nr = 0;
    for (const grp of gruppen) {
      ensure(14);
      doc.setFont('helvetica', 'bold'); doc.setFontSize(11);
      doc.text(grp.titel, M, y + 4);
      doc.setLineWidth(0.2); doc.line(M, y + 5.5, W - M, y + 5.5);
      y += 9;
      for (const m of grp.ms) {
        nr++;
        const zeilen = wrap(m.text || '–', CW - 10);
        ensure(6 + Math.min(zeilen.length, 5) * 4.3);
        doc.setFont('helvetica', 'bold'); doc.setFontSize(10.5);
        doc.text(nr + '.  ' + (m.ort || '–'), M, y + 4); y += 6.5;
        doc.setFont('helvetica', 'normal'); doc.setFontSize(10);
        for (const z of zeilen) { ensure(5); doc.text(z, M + 5, y + 3.2); y += 4.3; }
        y += 2;
        await drawFotos(m.fotos);
        y += 2;
      }
    }
  }

  // ---- Information ----
  if (infoItems.length) {
    ensure(14);
    doc.setFont('helvetica', 'bold'); doc.setFontSize(13);
    doc.text('Information', M, y + 5); y += 9;
    const uvNameById = id => { const u = k.uvs.find(x => x.id === id); return u ? (u.name || 'Anlage ohne Name') : ''; };
    for (const m of infoItems) {
      const kopf = [uvNameById(m.uvId), m.ort].filter(Boolean).join(' – ');
      const zeilen = wrap(m.text || '–', CW - 10);
      ensure((kopf ? 6.5 : 0) + Math.min(zeilen.length, 5) * 4.3);
      if (kopf) {
        doc.setFont('helvetica', 'bold'); doc.setFontSize(10.5);
        doc.text(kopf, M, y + 4); y += 6.5;
      }
      doc.setFont('helvetica', 'normal'); doc.setFontSize(10);
      for (const z of zeilen) { ensure(5); doc.text(z, M + 5, y + 3.2); y += 4.3; }
      y += 2;
      await drawFotos(m.fotos);
      y += 2;
    }
  }

  // ---- Datum / Unterschrift ----
  let sigDataUrl = null;
  try {
    const sb = await dbGet('kv', 'signatur');
    if (sb) sigDataUrl = await blobToDataURL(sb);
  } catch (e) { /* ohne Unterschrift weiterfahren */ }
  ensure(sigDataUrl ? 28 : 20);
  y += 5;
  doc.setFontSize(10); doc.setFont('helvetica', 'normal');
  doc.text('Datum', M + 2, y + 5);
  doc.setFont('helvetica', 'bold');
  doc.text(heute, M + 18, y + 5);
  doc.setFont('helvetica', 'normal');
  doc.text('Unterschrift', M + 78, y + 5);
  doc.setFont('helvetica', 'bold');
  doc.text(inspektoren.length ? inspektoren.map(i => i.name || i.kuerzel).join(' / ') : '–', M + 101, y + 5);
  doc.setFont('helvetica', 'normal');
  if (sigDataUrl) {
    try {
      const p = doc.getImageProperties(sigDataUrl);
      const h = 14, w = Math.min(h * p.width / p.height, 60);
      doc.addImage(sigDataUrl, imgFormat(sigDataUrl), M + 101, y + 7, w, h);
    } catch (e) { /* Bild nicht lesbar – nur Name */ }
    y += 26;
  } else {
    doc.setLineWidth(0.3); doc.line(M + 101, y + 13, M + 168, y + 13);
    y += 18;
  }

  // ---- Erledigungstext + Bestätigungsblock (nur wenn Mängel) ----
  if (mangelItems.length) {
    doc.setFontSize(9.5);
    const erl = wrap(SETTINGS.erledigungsText || '', CW - 8);
    const kopfTxt = wrap('Die Unterzeichnenden bestätigen, dass die Mängel gemäss Kontrollbericht nach NIV Art. 3 + 4 behoben wurden.', CW - 6);
    const kh = kopfTxt.length * 4.2 + 4;
    ensure(erl.length * 4.2 + 8 + kh + 26 + 8);
    y += 3;
    doc.setLineWidth(0.25);
    doc.rect(M, y, CW, erl.length * 4.2 + 5);
    doc.text(erl, M + 4, y + 4.5);
    y += erl.length * 4.2 + 9;
    doc.setFillColor(235, 235, 235);
    doc.rect(M, y, CW, kh, 'FD');
    doc.setFont('helvetica', 'bold');
    doc.text(kopfTxt, M + 3, y + 4.5);
    y += kh;
    const cw3 = CW / 3, ch = 26;
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5); doc.setTextColor(60);
    for (let i = 0; i < 3; i++) doc.rect(M + i * cw3, y, cw3, ch);
    doc.text('Datum der Mängelbehebung', M + 2, y + 4);
    doc.text('Firmenstempel', M + cw3 + 2, y + 4);
    doc.text(wrap('Unterschrift fachkundige Person oder Elektro-Kontrolleur gemäss NIV Art. 27', cw3 - 4), M + 2 * cw3 + 2, y + 4);
    doc.setTextColor(0);
    y += ch;
  }

  // Dateiname wie beim Druck-Bericht
  let uvPart;
  if (!k.uvs.length) uvPart = 'Kontrolle';
  else if (inclUvs.length === k.uvs.length) uvPart = k.uvs.length > 1 ? 'alle Anlagen' : (inclUvs[0].name || 'Anlage');
  else uvPart = inclUvs.map(u => u.name || 'Anlage').join('+') || 'Allgemein';
  const fname = ['Kontrollbericht', fnSan(uvPart), fnSan(ku.strasse), fnSan(ku.ort)].filter(Boolean).join('_');

  return { blob: doc.output('blob'), fname };
}

function blobToDataURL(blob) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result);
    r.onerror = () => rej(r.error);
    r.readAsDataURL(blob);
  });
}

/* ---- Backup ---- */

async function exportBackup() {
  const kontrollen = await dbAll('kontrollen');
  const photos = await dbAll('photos');
  const photosB64 = [];
  for (const p of photos) photosB64.push({ id: p.id, data: await blobToDataURL(p.blob) });
  let signatur = null;
  try {
    const sigBlob = await dbGet('kv', 'signatur');
    if (sigBlob) signatur = await blobToDataURL(sigBlob);
  } catch (e) { /* Backup ohne Unterschrift */ }
  const payload = { app: 'nivapp', version: 1, exported: new Date().toISOString(), settings: SETTINGS, signatur, kontrollen, photos: photosB64 };
  const d = new Date();
  const name = `nivapp-backup-${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}.json`;
  download(name, JSON.stringify(payload), 'application/json');
}

async function importBackup(e) {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  try {
    const payload = JSON.parse(await file.text());
    if (payload.app !== 'nivapp') throw new Error('Keine gültige Backup- oder Kontroll-Datei.');
    const kontrollen = payload.kontrollen || (payload.kontrolle ? [payload.kontrolle] : []);
    if (!kontrollen.length) throw new Error('Die Datei enthält keine Kontrollen.');
    const was = payload.type === 'kontrolle'
      ? `Kontrolle «${kontrolleTitle(payload.kontrolle)}»`
      : `${kontrollen.length} Kontrollen`;
    if (!confirm(`${was} vom ${payload.exported ? payload.exported.slice(0, 10) : '?'} importieren?\n(Bestehende Kontrollen mit gleicher ID werden überschrieben.)`)) return;
    for (const k of kontrollen) await dbPut('kontrollen', k);
    for (const p of payload.photos || []) {
      const blob = await (await fetch(p.data)).blob();
      await dbPut('photos', { id: p.id, blob });
    }
    if (payload.settings) { SETTINGS = Object.assign({}, DEFAULT_SETTINGS, payload.settings); await saveSettings(); }
    if (payload.signatur) {
      const sigBlob = await (await fetch(payload.signatur)).blob();
      await dbPut('kv', sigBlob, 'signatur');
    }
    alert('Import erfolgreich.');
    S.kontrolle = null; S.uvId = null;
    go('kontrollen');
  } catch (err) {
    alert('Import fehlgeschlagen: ' + err.message);
  }
}

/* ============================================================
   Ansicht: Einstellungen
   ============================================================ */

function renderSettings() {
  const v = $('#view');
  const qsLines = Object.entries(SETTINGS.querschnitt).map(([a, q]) => `${a}=${q}`).join('\n');
  // Migration: alter Einzel-Inspekteur (bis v1.4) wird als erste Zeile vorgeschlagen
  let inspZeilen = (SETTINGS.inspektoren || []).map(i => [i.kuerzel, i.name, i.tel, i.mail].join('; ')).join('\n');
  if (!inspZeilen && SETTINGS.inspName) {
    const kz = SETTINGS.inspName.split(/\s+/).map(w => w[0] || '').join('').toUpperCase();
    inspZeilen = [kz, SETTINGS.inspName, SETTINGS.inspTel, SETTINGS.inspMail].join('; ');
  }
  const area = (id, label, val, hint) => `
    <label class="f">${label}</label>
    ${hint ? `<div class="hint">${hint}</div>` : ''}
    <textarea id="${id}" spellcheck="false">${esc(val)}</textarea>`;
  v.innerHTML = `<h2>Einstellungen</h2>
  <div class="card">
    <h3 style="margin-top:0">Ausführende Firma &amp; Inspektoren</h3>
    <div class="hint">Erscheint im Kopf des Kontrollberichts (Auftragnehmer / «Kontrolle durch»).</div>
    <div class="row">
      <div><label class="f">Firma</label><input type="text" id="s_fname" value="${esc(SETTINGS.firmaName)}" placeholder="z.B. Elektro Burkhalter AG"></div>
      <div><label class="f">Strasse, Nr.</label><input type="text" id="s_fstr" value="${esc(SETTINGS.firmaStrasse)}"></div>
      <div><label class="f">PLZ / Ort</label><input type="text" id="s_fplzort" value="${esc(SETTINGS.firmaPlzOrt)}"></div>
    </div>
    <label class="f">Inspektoren – einer pro Zeile, Angaben mit Strichpunkt getrennt: <b>Kürzel; Name; Telefon; E-Mail</b></label>
    <div class="hint">Beispiel: <b>GK; Gabriel Kloter; 031 996 33 26; gabriel@firma.ch</b> – die Kürzel stehen dann bei den Anlagen («Geprüft durch») und beim Status zur Auswahl.</div>
    <textarea id="s_insp" spellcheck="false" placeholder="GK; Gabriel Kloter; 031 996 33 26; gabriel@firma.ch">${esc(inspZeilen)}</textarea>
    <label class="f">Text zur Mängelerledigung (erscheint unten im Bericht über dem Unterschriftsfeld)</label>
    <textarea id="s_erltext">${esc(SETTINGS.erledigungsText)}</textarea>
    <label class="f">Info-Textbausteine (für den Informationsteil im Bericht)</label>
    <div class="hint">Mehrere Bausteine mit einer Zeile, die nur <b>---</b> enthält, trennen. Sie stehen dann bei den Mängeln unter «ℹ️ Info» zur Auswahl.</div>
    <textarea id="s_info" style="min-height:180px">${esc((SETTINGS.infoTexte || []).join('\n---\n'))}</textarea>
    <label class="f">Unterschrift (Bild)</label>
    <div class="hint">Wird im Kontrollbericht bei «Unterschrift» eingefügt. Am besten ein <b>PNG mit transparentem Hintergrund</b> – dann sieht es wie echt unterschrieben aus. Ein JPG (weisser Hintergrund) geht auch. Das Bild wird sofort gespeichert.</div>
    <div class="btnrow">
      <label class="btn" style="display:inline-flex;align-items:center;gap:8px;cursor:pointer">🖊 Unterschrift-Bild wählen
        <input type="file" id="s_sig" accept="image/*" style="display:none">
      </label>
      <button class="btn danger small" id="s_sigdel" style="display:none">Unterschrift entfernen</button>
    </div>
    <div id="s_sigprev" style="max-width:340px"></div>
  </div>
  <div class="hint">Ein Wert pro Zeile. Änderungen gelten für das Schnell-Ausfüllen und die Auswahllisten.</div>
  <div class="card">
    ${area('s_kabel', 'Kabelarten', SETTINGS.kabelArten.join('\n'))}
    ${area('s_draehte', 'Anzahl Drähte', SETTINGS.draehte.join('\n'))}
    ${area('s_sich', 'Sicherungsarten', SETTINGS.sicherungsArten.join('\n'), 'Enthält ein Eintrag «FI», werden beim Ausfüllen automatisch RCD In und IΔN gesetzt.')}
    ${area('s_amp', 'Sicherungsgrössen [A]', SETTINGS.ampere.join('\n'))}
    ${area('s_qs', 'Querschnitt-Zuordnung (Ampere=mm²)', qsLines, 'Format: 16=2.5 – bestimmt den Querschnitt hinter der Drahtzahl, z.B. 3x2.5.')}
    ${area('s_geb', 'Gebäudearten', SETTINGS.gebaeudeArten.join('\n'))}
    <div class="row">
      <div><label class="f">RISO Vorgabewert [MΩ]</label><input type="text" id="s_riso" value="${esc(SETTINGS.risoDefault)}"></div>
      <div><label class="f">Rlo Vorgabewert</label><input type="text" id="s_rlo" value="${esc(SETTINGS.rloDefault)}"></div>
      <div><label class="f">IΔN Vorgabe [mA]</label><input type="text" id="s_idn" value="${esc(SETTINGS.idnDefault)}"></div>
    </div>
    <div class="btnrow" style="margin-top:16px">
      <button class="btn primary" id="btnSaveS">Einstellungen speichern</button>
      <button class="btn danger" id="btnResetS">Auf Standard zurücksetzen</button>
    </div>
  </div>
  <div class="card">
    <div class="hint">App-Version: <span id="appver">2.0</span> · Daten werden lokal auf diesem Gerät gespeichert (IndexedDB). Regelmässig unter <b>📤 Export</b> ein Backup sichern!</div>
  </div>`;

  const paintSig = async () => {
    const blob = await dbGet('kv', 'signatur');
    const prev = $('#s_sigprev');
    const del = $('#s_sigdel');
    if (blob) {
      prev.innerHTML = `<img src="${URL.createObjectURL(blob)}" alt="Unterschrift" style="max-width:100%;max-height:110px;border:1px dashed var(--line);border-radius:8px;padding:6px;background:#fff">`;
      del.style.display = '';
    } else {
      prev.innerHTML = '<div class="hint">Keine Unterschrift hinterlegt.</div>';
      del.style.display = 'none';
    }
  };
  paintSig();
  $('#s_sig').addEventListener('change', async e => {
    const f = e.target.files[0];
    e.target.value = '';
    if (!f) return;
    try {
      await dbPut('kv', await resizeSig(f), 'signatur');
      paintSig();
    } catch (err) {
      alert('Bild konnte nicht übernommen werden: ' + err.message);
    }
  });
  $('#s_sigdel').addEventListener('click', async () => {
    if (!confirm('Unterschrift entfernen?')) return;
    await dbDel('kv', 'signatur');
    paintSig();
  });

  const parseLines = t => t.split('\n').map(x => x.trim()).filter(Boolean);
  $('#btnSaveS').addEventListener('click', async () => {
    SETTINGS.kabelArten = parseLines($('#s_kabel').value);
    SETTINGS.draehte = parseLines($('#s_draehte').value);
    SETTINGS.sicherungsArten = parseLines($('#s_sich').value);
    SETTINGS.ampere = parseLines($('#s_amp').value);
    SETTINGS.gebaeudeArten = parseLines($('#s_geb').value);
    const qs = {};
    for (const line of parseLines($('#s_qs').value)) {
      const m = line.match(/^([\d.]+)\s*=\s*([\d.]+)$/);
      if (m) qs[m[1]] = m[2];
    }
    SETTINGS.querschnitt = qs;
    SETTINGS.risoDefault = $('#s_riso').value.trim();
    SETTINGS.rloDefault = $('#s_rlo').value.trim();
    SETTINGS.idnDefault = $('#s_idn').value.trim();
    SETTINGS.firmaName = $('#s_fname').value.trim();
    SETTINGS.firmaStrasse = $('#s_fstr').value.trim();
    SETTINGS.firmaPlzOrt = $('#s_fplzort').value.trim();
    SETTINGS.inspektoren = $('#s_insp').value.split('\n').map(l => l.trim()).filter(Boolean).map(l => {
      const p = l.split(';').map(x => x.trim());
      return { kuerzel: (p[0] || '').toUpperCase(), name: p[1] || '', tel: p[2] || '', mail: p[3] || '' };
    }).filter(i => i.kuerzel);
    // Kompatibilität: erster Inspektor füllt weiterhin die alten Einzelfelder (Mail-Signatur, Fallbacks)
    if (SETTINGS.inspektoren[0]) {
      SETTINGS.inspName = SETTINGS.inspektoren[0].name;
      SETTINGS.inspTel = SETTINGS.inspektoren[0].tel;
      SETTINGS.inspMail = SETTINGS.inspektoren[0].mail;
    }
    SETTINGS.erledigungsText = $('#s_erltext').value.trim();
    SETTINGS.infoTexte = $('#s_info').value.split(/^\s*---\s*$/m).map(t => t.trim()).filter(Boolean);
    await saveSettings();
    alert('Einstellungen gespeichert.');
  });
  $('#btnResetS').addEventListener('click', async () => {
    if (!confirm('Alle Einstellungen auf Standard zurücksetzen?')) return;
    SETTINGS = JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
    await saveSettings();
    renderSettings();
  });
}

/* ============================================================
   Start
   ============================================================ */

/* ---- Vollbild-Knopf (Topbar) ---- */

function initFullscreen() {
  const btn = $('#fsbtn');
  const root = document.documentElement;
  const supported = !!(root.requestFullscreen || root.webkitRequestFullscreen);
  if (!supported) { btn.style.display = 'none'; return; }
  const fsEl = () => document.fullscreenElement || document.webkitFullscreenElement;
  const paint = () => {
    btn.classList.toggle('active', !!fsEl());
    btn.textContent = fsEl() ? '✕' : '⛶';
    btn.title = fsEl() ? 'Vollbild verlassen' : 'Vollbild';
  };
  btn.addEventListener('click', () => {
    try {
      const p = fsEl()
        ? (document.exitFullscreen || document.webkitExitFullscreen).call(document)
        : (root.requestFullscreen || root.webkitRequestFullscreen).call(root);
      if (p && p.catch) p.catch(() => {}); // z.B. nicht erlaubt – Knopf bleibt wirkungslos
    } catch (e) { /* dito für synchrone Ablehnung */ }
  });
  document.addEventListener('fullscreenchange', paint);
  document.addEventListener('webkitfullscreenchange', paint);
  paint();
}

async function init() {
  initFullscreen();
  db = await openDB();
  const stored = await dbGet('kv', 'settings');
  if (stored) SETTINGS = Object.assign({}, DEFAULT_SETTINGS, stored);
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
  go('kontrollen');
}

init();
