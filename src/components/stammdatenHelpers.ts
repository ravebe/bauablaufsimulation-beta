// stammdatenHelpers.ts — Kalkulations-Stammdaten (Leistungswerte/Personal je Bauteil-Kürzel) und
// die Menge→Tage-Formel aus dem AVOR-Tool (Grundlage für Kalkulation/Ressourcen/Kosten-Tabs).
import type { Task } from "../types";
import { istGruppe } from "../types";

export interface Rate {
  kuerzel: string;
  bezeichnung: string;
  leistungswertHProEinheit: number | null;
  anzahlPersonen: number;
  chfProEinheit: number | null;
  formel?: string; // Menge-Formel aus IFC-Attributen der zugeordneten Bauteile, siehe formelHelpers.ts
  ausschlussFilterIds?: string[]; // IDs der Ausschlussfilter (Stammdaten.ausschlussFilter), die bei der Mengenermittlung dieser Rate greifen — siehe objektAusgeschlossen()
  /** @deprecated durch ausschlussFilterIds ersetzt — nur noch zum Migrieren alter Projekte gelesen, siehe aktiveFilterIds(). */
  oeffnungenAusschliessen?: boolean;
}
export interface Gewerk {
  key: string;
  label: string;
  einheit: string;
  raten: Rate[];
  kranpflichtig?: boolean; // steuert, ob Tasks dieses Gewerks in die Kranauslastung (Tab AVOR) einfliessen
}
/** Ein Ausschlussfilter erkennt Bauteile an einem Attribut/Wert (z.B. Öffnungen, aber genauso jedes
 *  andere Element, das nicht in die Mengenermittlung einer Rate einfliessen soll) — je Rate einzeln
 *  ein-/ausschaltbar über Rate.ausschlussFilterIds, siehe objektAusgeschlossen(). */
export interface AusschlussFilter { id: string; attribut: string; wert: string; }
/** Default-Filter, solange keine eigenen definiert sind — "Reference Object||Common Type" ist das
 *  Attribut, das ladeObjektAttribute() aus product.objectType befüllt (siehe modelHelpers.ts);
 *  "Opening" ist der in der Praxis übliche IFC-Wert für Tür-/Fensteraussparungen. */
export const STANDARD_AUSSCHLUSSFILTER: AusschlussFilter = { id: "standard", attribut: "Reference Object||Common Type", wert: "Opening" };
export interface Stammdaten {
  arbeitszeitStdProTag: number;
  umsatzChfProMannstunde?: number; // für Ertragsoptik (Tab AVOR), Default 80
  gewerke: Gewerk[];
  ausschlussFilter?: AusschlussFilter[];
  /** @deprecated durch ausschlussFilter ersetzt — nur noch zum Migrieren alter Projekte gelesen, siehe ausschlussFilterListe(). */
  oeffnungsFilter?: { attribut: string; wert: string };
}
export const LEERE_STAMMDATEN: Stammdaten = { arbeitszeitStdProTag: 8.5, gewerke: [] };

/** Effektive Filterliste — eigene Filter falls vorhanden, sonst aus dem alten Einzelfeld migriert
 *  (siehe Stammdaten.oeffnungsFilter), sonst der Default. Nie leer, damit Aufrufer nicht extra
 *  auf "kein Filter definiert" prüfen müssen. */
export function ausschlussFilterListe(s: Stammdaten): AusschlussFilter[] {
  if (s.ausschlussFilter && s.ausschlussFilter.length > 0) return s.ausschlussFilter;
  if (s.oeffnungsFilter) return [{ id: STANDARD_AUSSCHLUSSFILTER.id, attribut: s.oeffnungsFilter.attribut, wert: s.oeffnungsFilter.wert }];
  return [STANDARD_AUSSCHLUSSFILTER];
}

/** Für eine Rate aktive Filter-IDs — migriert die alte "oeffnungenAusschliessen"-Checkbox auf den
 *  Standard-Filter, damit bereits aktivierte Ausschlüsse aus älteren Projekten erhalten bleiben. */
export function aktiveFilterIds(r: Rate): string[] {
  if (r.ausschlussFilterIds) return r.ausschlussFilterIds;
  return r.oeffnungenAusschliessen ? [STANDARD_AUSSCHLUSSFILTER.id] : [];
}

/** Signatur aus allen Stammdaten-Feldern, die in die Mengenermittlung (berechneMenge() in
 *  formelHelpers.ts) einfliessen — Formeln je Rate sowie die (effektiv wirksamen) Ausschlussfilter.
 *  Andere Stammdaten-Felder (Leistungswerte, Personal, CHF/Einheit) wirken sich nur auf Dauer/Kosten
 *  aus und ändern die Signatur bewusst NICHT. Grundlage für den "Mengen veraltet"-Hinweis neben dem
 *  Button "Mengen aus Bauteilen berechnen" in Tab Kalkulation: weicht die aktuelle Signatur von der
 *  beim letzten Lauf gespeicherten (SimProjekt.mengenBerechnetSignatur) ab, wurde seither etwas an
 *  den Formeln/Filtern in Tab Ressourcen geändert. */
export function mengenRelevanteSignatur(s: Stammdaten): string {
  const filter = ausschlussFilterListe(s).map(f => ({ id: f.id, attribut: f.attribut, wert: f.wert }));
  const gewerke = s.gewerke.map(g => ({
    key: g.key,
    raten: g.raten.map(r => ({ kuerzel: r.kuerzel, formel: r.formel ?? "", filter: [...aktiveFilterIds(r)].sort() })),
  }));
  return JSON.stringify({ filter, gewerke });
}

/** Stammdaten als JSON-Text für den Datei-Export — 1:1 Rohobjekt, damit der Import verlustfrei zurückspielt. */
export function stammdatenAlsJson(s: Stammdaten): string {
  return JSON.stringify(s, null, 2);
}

/** Parst eine zuvor exportierte Stammdaten-JSON-Datei und validiert grob die Struktur (z.B. aus einem anderen TC-Projekt). */
export function parseStammdatenJson(text: string): Stammdaten {
  const raw = JSON.parse(text);
  if (!raw || typeof raw !== "object" || !Array.isArray(raw.gewerke)) {
    throw new Error("Ungültiges Format — keine Stammdaten-Datei");
  }
  return {
    arbeitszeitStdProTag: typeof raw.arbeitszeitStdProTag === "number" ? raw.arbeitszeitStdProTag : 8.5,
    umsatzChfProMannstunde: typeof raw.umsatzChfProMannstunde === "number" ? raw.umsatzChfProMannstunde : undefined,
    gewerke: raw.gewerke,
    ausschlussFilter: Array.isArray(raw.ausschlussFilter)
      ? raw.ausschlussFilter.filter((f: unknown): f is AusschlussFilter =>
          !!f && typeof f === "object" && typeof (f as any).id === "string" && typeof (f as any).attribut === "string" && typeof (f as any).wert === "string")
      : undefined,
    oeffnungsFilter: raw.oeffnungsFilter && typeof raw.oeffnungsFilter.attribut === "string" && typeof raw.oeffnungsFilter.wert === "string"
      ? raw.oeffnungsFilter : undefined,
  };
}

const CSV_HEADER = ["Gewerk-Schlüssel", "Gewerk", "Einheit", "Kranpflichtig", "Kürzel", "Bezeichnung", "LW [h/Einheit]", "Personen", "CHF/Einheit", "Formel", "Ausschlussfilter", "Menge Ist"];

/** Lesbare Zusammenfassung der für eine Rate aktiven Ausschlussfilter ("Common Type=Opening" o.ä.),
 *  mehrere durch Komma getrennt. Nur zur Information beim CSV-Export, wird beim Reimport ignoriert
 *  (siehe parseStammdatenCsv) — welche Filter greifen, wird ausschliesslich in Tab Ressourcen gepflegt. */
function ausschlussFilterText(r: Rate, alleFilter: AusschlussFilter[]): string {
  const ids = aktiveFilterIds(r);
  if (ids.length === 0) return "";
  return alleFilter.filter(f => ids.includes(f.id)).map(f => `${keyLetzterTeil(f.attribut)}=${f.wert}`).join(", ");
}

function keyLetzterTeil(key: string): string {
  const sep = key.indexOf("||");
  return sep === -1 ? key : key.slice(sep + 2);
}

function csvZelle(v: string): string {
  return /[;"\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

/** Aktuelle Mengen-Ist-Summe eines Kürzels für ein Gewerk aus den Tasks — dieselbe Logik wie die
 *  "Menge Ist"-Spalte in Tab Ressourcen. Nur zur Information beim CSV-Export, wird beim Reimport
 *  ignoriert (siehe parseStammdatenCsv) — die App berechnet Mengen selbst aus den Tasks/Formeln. */
function mengeIstText(kuerzel: string, gewerkKey: string, einheit: string, tasks: Task[]): string {
  const tasksMitKuerzel = tasks.filter((t, i) => !t.isGroup && !istGruppe(tasks, i) && t.bauteilKuerzel === kuerzel);
  if (tasksMitKuerzel.length === 0) return "";
  let summe = 0, problem = false;
  for (const t of tasksMitKuerzel) {
    const menge = t.mengen?.[gewerkKey];
    const quelle = t.mengenQuelle?.[gewerkKey];
    if (quelle === "fehler" || menge === undefined || menge === null) problem = true;
    else summe += menge;
  }
  return `${summe.toLocaleString("de-CH", { maximumFractionDigits: 2 })} ${einheit}${problem ? " (unvollständig)" : ""}`.trim();
}

/** Stammdaten als CSV-Text (Semikolon-getrennt, UTF-8-BOM für Excel) — eine Zeile je Kürzel, plus
 *  eine Leerzeile für Kategorien ohne Kürzel, damit sie beim Reimport erhalten bleiben. Die Spalte
 *  "Gewerk-Schlüssel" referenziert intern die Mengen in den Tasks (task.mengen[gewerk.key]) und
 *  sollte beim Bearbeiten in Excel nicht verändert werden — siehe parseStammdatenCsv(). Die Spalte
 *  "Menge Ist" ist nur zur Information (aktueller Stand aus den Tasks) und wird beim Import ignoriert. */
export function stammdatenAlsCsv(s: Stammdaten, tasks: Task[]): string {
  const alleFilter = ausschlussFilterListe(s);
  const zeilen: string[][] = [CSV_HEADER];
  for (const g of s.gewerke) {
    if (g.raten.length === 0) {
      zeilen.push([g.key, g.label, g.einheit, g.kranpflichtig ? "ja" : "nein", "", "", "", "", "", "", "", ""]);
      continue;
    }
    for (const r of g.raten) {
      zeilen.push([
        g.key, g.label, g.einheit, g.kranpflichtig ? "ja" : "nein",
        r.kuerzel, r.bezeichnung,
        r.leistungswertHProEinheit != null ? String(r.leistungswertHProEinheit) : "",
        String(r.anzahlPersonen),
        r.chfProEinheit != null ? String(r.chfProEinheit) : "",
        r.formel ?? "",
        ausschlussFilterText(r, alleFilter),
        mengeIstText(r.kuerzel, g.key, g.einheit, tasks),
      ]);
    }
  }
  return "﻿" + zeilen.map(z => z.map(csvZelle).join(";")).join("\r\n");
}

/** Minimaler RFC4180-Parser (Semikolon statt Komma) — versteht Anführungszeichen mit eingebetteten
 *  Semikolons/Zeilenumbrüchen/escapten „"" (wie sie Excel beim Speichern erzeugt). */
function parseCsvZeilen(text: string): string[][] {
  const zeilen: string[][] = [];
  let zeile: string[] = [];
  let feld = "";
  let inQuotes = false;
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { feld += '"'; i += 2; continue; }
        inQuotes = false; i++; continue;
      }
      feld += c; i++; continue;
    }
    if (c === '"') { inQuotes = true; i++; continue; }
    if (c === ";") { zeile.push(feld); feld = ""; i++; continue; }
    if (c === "\r") { i++; continue; }
    if (c === "\n") { zeile.push(feld); zeilen.push(zeile); zeile = []; feld = ""; i++; continue; }
    feld += c; i++;
  }
  if (feld !== "" || zeile.length > 0) { zeile.push(feld); zeilen.push(zeile); }
  return zeilen.filter(z => !(z.length === 1 && z[0].trim() === ""));
}

/** Parst eine (in Excel bearbeitete) Stammdaten-CSV-Datei — ersetzt nur die Kategorien/Raten,
 *  Arbeitszeit/Umsatz/Ausschlussfilter bleiben von `bestehende` erhalten. Eine leere "Gewerk-Schlüssel"-
 *  Spalte wird über den Gewerk-Namen einem vorhandenen Gewerk zugeordnet, sonst neu angelegt — damit
 *  bereits erfasste Mengen (task.mengen[gewerk.key]) beim Reimport nicht verwaist. Die Export-Spalten
 *  "Ausschlussfilter" und "Menge Ist" werden bewusst nicht gelesen — reine Information, welche Filter
 *  je Rate greifen wird ausschliesslich in Tab Ressourcen gepflegt (siehe stammdatenAlsCsv). */
export function parseStammdatenCsv(text: string, bestehende: Stammdaten): Stammdaten {
  const zeilen = parseCsvZeilen(text.replace(/^﻿/, ""));
  if (zeilen.length === 0) throw new Error("Leere CSV-Datei");
  const header = zeilen[0];
  const idx = (name: string) => header.findIndex(h => h.trim().toLowerCase() === name.toLowerCase());
  const iKey = idx("Gewerk-Schlüssel"), iLabel = idx("Gewerk"), iEinheit = idx("Einheit"), iKran = idx("Kranpflichtig"),
    iKuerzel = idx("Kürzel"), iBez = idx("Bezeichnung"), iLw = idx("LW [h/Einheit]"), iPers = idx("Personen"),
    iChf = idx("CHF/Einheit"), iFormel = idx("Formel");
  if (iLabel === -1 || iKuerzel === -1) throw new Error('Ungültiges CSV-Format — Spalten "Gewerk" und "Kürzel" erwartet');

  const parseNum = (s: string): number | null => {
    const t = s.trim().replace(",", ".");
    if (!t) return null;
    const n = Number(t);
    return isNaN(n) ? null : n;
  };
  const parseBool = (s: string) => /^(ja|true|1|x|wahr)$/i.test(s.trim());

  // Bestehende Rate je (Gewerk-Key, Kürzel) nachschlagen, um ausschlussFilterIds beim Reimport zu
  // erhalten — die CSV trägt diese Zuordnung nur informativ (Spalte "Ausschlussfilter"), sonst würde
  // ein reiner LW/CHF-Reimport bereits gesetzte Filter-Aktivierungen stillschweigend löschen.
  const bestehendeRaten = new Map<string, Rate>();
  for (const g of bestehende.gewerke) for (const r of g.raten) bestehendeRaten.set(`${g.key} ${r.kuerzel}`, r);

  const gewerkeMap = new Map<string, Gewerk>();
  const keyNachLabel = new Map(bestehende.gewerke.map(g => [g.label.trim().toLowerCase(), g.key]));
  let neuZaehler = 0;
  for (let i = 1; i < zeilen.length; i++) {
    const z = zeilen[i];
    if (z.every(c => !c.trim())) continue;
    const label = (z[iLabel] ?? "").trim();
    if (!label) continue;
    let key = iKey !== -1 ? (z[iKey] ?? "").trim() : "";
    if (!key) key = keyNachLabel.get(label.toLowerCase()) ?? `eigene_${Date.now()}_${neuZaehler++}`;
    let gewerk = gewerkeMap.get(key);
    if (!gewerk) {
      gewerk = { key, label, einheit: (z[iEinheit] ?? "").trim(), raten: [] };
      if (iKran !== -1 && parseBool(z[iKran] ?? "")) gewerk.kranpflichtig = true;
      gewerkeMap.set(key, gewerk);
    }
    const kuerzel = (z[iKuerzel] ?? "").trim();
    if (!kuerzel) continue;
    gewerk.raten.push({
      kuerzel,
      bezeichnung: (z[iBez] ?? "").trim(),
      leistungswertHProEinheit: iLw !== -1 ? parseNum(z[iLw] ?? "") : null,
      anzahlPersonen: (iPers !== -1 ? parseNum(z[iPers] ?? "") : null) ?? 1,
      chfProEinheit: iChf !== -1 ? parseNum(z[iChf] ?? "") : null,
      formel: iFormel !== -1 && (z[iFormel] ?? "").trim() ? z[iFormel].trim() : undefined,
      ausschlussFilterIds: bestehendeRaten.get(`${key} ${kuerzel}`)?.ausschlussFilterIds,
    });
  }
  if (gewerkeMap.size === 0) throw new Error("Keine gültigen Zeilen in der CSV-Datei gefunden");
  return { ...bestehende, gewerke: [...gewerkeMap.values()] };
}

/** Prüft anhand EINES Ausschlussfilters, ob ein Bauteil (dessen flache Pset||Property-Attribute)
 *  darauf passt — Vergleich getrimmt/case-insensitiv, da IFC-Werte je nach Exporter unterschiedlich
 *  geschrieben sind (z.B. "Opening" vs. "opening"). */
export function passtAufFilter(werte: Record<string, string>, filter: AusschlussFilter): boolean {
  if (!filter.attribut || !filter.wert.trim()) return false;
  const wert = werte[filter.attribut];
  return typeof wert === "string" && wert.trim().toLowerCase() === filter.wert.trim().toLowerCase();
}

/** Prüft, ob ein Bauteil von der Mengenermittlung einer Rate ausgeschlossen ist — trifft zu, sobald
 *  IRGENDEINER der für diese Rate aktiven Filter (siehe aktiveFilterIds) auf das Bauteil passt. */
export function objektAusgeschlossen(werte: Record<string, string>, alleFilter: AusschlussFilter[], aktiveIds: string[]): boolean {
  if (aktiveIds.length === 0) return false;
  return alleFilter.some(f => aktiveIds.includes(f.id) && passtAufFilter(werte, f));
}

/** Bekannte Einheiten-Gruppen mit Umrechnungsfaktor zu einer Bezugsgrösse je Gruppe (Masse→kg,
 *  Länge→m, Fläche→m², Volumen→m³) — Basis für einheitUmrechnungsfaktor(). */
const EINHEIT_GRUPPEN: Record<string, number>[] = [
  { t: 1000, kg: 1, g: 0.001 },
  { km: 1000, m: 1, dm: 0.1, cm: 0.01, mm: 0.001 },
  { "m²": 1, "m2": 1, "cm²": 0.0001, "cm2": 0.0001, "mm²": 0.000001, "mm2": 0.000001 },
  { "m³": 1, "m3": 1, "l": 0.001 },
];

/** Faktor, um LW/CHF-Sätze (je Einheit) beim Wechsel von `alt` auf `neu` konsistent umzurechnen —
 *  z.B. "t"→"kg" liefert 0.001 (ein Satz von 3.5 h/t entspricht 0.0035 h/kg). Nur für erkannte
 *  Einheiten-Paare innerhalb derselben Grösse (siehe EINHEIT_GRUPPEN); sonst null (kein automatischer
 *  Vorschlag, z.B. bei "Stk." oder frei erfundenen Einheiten). Achtung: DIESER Faktor gilt für die
 *  RATE (h/Einheit, CHF/Einheit), nicht für eine Menge — eine Menge würde mit 1/Faktor umgerechnet. */
export function einheitUmrechnungsfaktor(alt: string, neu: string): number | null {
  const a = alt.trim().toLowerCase(), n = neu.trim().toLowerCase();
  if (!a || !n || a === n) return null;
  for (const gruppe of EINHEIT_GRUPPEN) {
    const g = Object.fromEntries(Object.entries(gruppe).map(([k, v]) => [k.toLowerCase(), v]));
    if (a in g && n in g) return g[n] / g[a];
  }
  return null;
}

/** Dauer eines einzelnen Gewerks in Tagen: benötigte Personenstunden / verfügbare Personenstunden pro Tag. */
export function dauerGewerk(menge: number, rate: Rate | undefined, arbeitszeitStdProTag: number): number {
  if (!rate || !rate.leistungswertHProEinheit || !menge || !arbeitszeitStdProTag || !rate.anzahlPersonen) return 0;
  return (menge * rate.leistungswertHProEinheit) / (arbeitszeitStdProTag * rate.anzahlPersonen);
}

/** Rundungsregel aus AVOR-Spec: >2 Tage aufrunden, <0.01 vernachlässigbar (0), sonst Mindestdauer 2. */
export function rundeDauer(rohTage: number): number {
  if (rohTage > 2) return Math.ceil(rohTage);
  if (rohTage < 0.01) return 0;
  return 2;
}

function rateFuerKuerzel(gewerk: Gewerk, kuerzel: string): Rate | undefined {
  return gewerk.raten.find(r => r.kuerzel === kuerzel);
}

/** Berechnete Dauer eines Tasks: Summe über alle Gewerke mit hinterlegter Menge, gerundet. */
export function dauerBerechnetTask(task: Task, stammdaten: Stammdaten): number {
  if (!task.bauteilKuerzel || !task.mengen) return 0;
  let roh = 0;
  for (const gewerk of stammdaten.gewerke) {
    const menge = task.mengen[gewerk.key];
    if (!menge) continue;
    roh += dauerGewerk(menge, rateFuerKuerzel(gewerk, task.bauteilKuerzel), stammdaten.arbeitszeitStdProTag);
  }
  return rundeDauer(roh);
}

/** Kosten eines Tasks in CHF: Summe Menge × CHF/Einheit über alle Gewerke mit hinterlegter Menge. */
export function kostenTask(task: Task, stammdaten: Stammdaten): number {
  if (!task.bauteilKuerzel || !task.mengen) return 0;
  let summe = 0;
  for (const gewerk of stammdaten.gewerke) {
    const menge = task.mengen[gewerk.key];
    if (!menge) continue;
    const rate = rateFuerKuerzel(gewerk, task.bauteilKuerzel);
    if (rate?.chfProEinheit) summe += menge * rate.chfProEinheit;
  }
  return summe;
}

/** Alle im Stammdaten-Satz vorkommenden Bauteil-Kürzel, eindeutig und sortiert (für Dropdowns). */
export function alleKuerzel(stammdaten: Stammdaten): string[] {
  const set = new Set<string>();
  for (const gewerk of stammdaten.gewerke) for (const r of gewerk.raten) set.add(r.kuerzel);
  return [...set].sort();
}

/** Gewerke, die für ein Bauteil-Kürzel eine Rate führen — steuert, welche Mengen-Inputs angezeigt werden. */
export function gewerkeFuerKuerzel(stammdaten: Stammdaten, kuerzel: string): Gewerk[] {
  return stammdaten.gewerke.filter(g => g.raten.some(r => r.kuerzel === kuerzel));
}

/** Bezeichnung zu einem Bauteil-Kürzel (aus der ersten passenden Rate über alle Gewerke) — für die
 * Anzeige "Kürzel – Bezeichnung" in Dropdowns. */
export function bezeichnungFuerKuerzel(stammdaten: Stammdaten, kuerzel: string): string {
  for (const gewerk of stammdaten.gewerke) {
    const r = gewerk.raten.find(r => r.kuerzel === kuerzel);
    if (r?.bezeichnung) return r.bezeichnung;
  }
  return "";
}

/** Standard-Stammdaten aus dem AVOR-Tool "LUKS Wolhusen" als Startpunkt (frei editierbar danach). */
export function standardStammdaten(): Stammdaten {
  return {
    arbeitszeitStdProTag: 8.5,
    umsatzChfProMannstunde: 80,
    gewerke: [
      { key: "schalung", label: "Schalung", einheit: "m²", kranpflichtig: true, raten: [
        { kuerzel: "WB", bezeichnung: "Wandschalung", leistungswertHProEinheit: 0.465, anzahlPersonen: 6, chfProEinheit: 46.47 },
        { kuerzel: "WBK", bezeichnung: "Kletterschalung", leistungswertHProEinheit: null, anzahlPersonen: 4, chfProEinheit: null },
        { kuerzel: "SB", bezeichnung: "Stützenschalung", leistungswertHProEinheit: 1.103, anzahlPersonen: 3, chfProEinheit: 104.09 },
        { kuerzel: "BR", bezeichnung: "Brüstungsschalung", leistungswertHProEinheit: 0.654, anzahlPersonen: 3, chfProEinheit: 61.52 },
        { kuerzel: "DB", bezeichnung: "Deckenschalung", leistungswertHProEinheit: 0.376, anzahlPersonen: 8, chfProEinheit: 39.62 },
        { kuerzel: "DBS", bezeichnung: "Deckenschalung Sicht", leistungswertHProEinheit: null, anzahlPersonen: 6, chfProEinheit: null },
        { kuerzel: "UZ", bezeichnung: "Unterzugsschalung", leistungswertHProEinheit: 0.76, anzahlPersonen: 3, chfProEinheit: 71.1 },
        { kuerzel: "BPL", bezeichnung: "Bodenplatte", leistungswertHProEinheit: 0.797, anzahlPersonen: 4, chfProEinheit: 78.92 },
      ] },
      { key: "bewehrung", label: "Bewehrung", einheit: "t", raten: [
        { kuerzel: "BPL", bezeichnung: "Bodenplattenbewehrung", leistungswertHProEinheit: 3.5, anzahlPersonen: 5, chfProEinheit: 1.25 },
        { kuerzel: "WB", bezeichnung: "Wandbewehrung", leistungswertHProEinheit: 4, anzahlPersonen: 4, chfProEinheit: 1.25 },
        { kuerzel: "SB", bezeichnung: "Stützenbewehrung", leistungswertHProEinheit: 6, anzahlPersonen: 4, chfProEinheit: 1.25 },
        { kuerzel: "BR", bezeichnung: "Brüstungsbewehrung", leistungswertHProEinheit: 5, anzahlPersonen: 4, chfProEinheit: 1.4 },
        { kuerzel: "UZ", bezeichnung: "Unterzugsbewehrung", leistungswertHProEinheit: 5, anzahlPersonen: 4, chfProEinheit: 1.4 },
        { kuerzel: "DB", bezeichnung: "Deckenbewehrung", leistungswertHProEinheit: 3.5, anzahlPersonen: 3, chfProEinheit: 1.25 },
      ] },
      { key: "beton", label: "Beton", einheit: "m³", raten: [
        { kuerzel: "BPL", bezeichnung: "Bodenplattenbeton", leistungswertHProEinheit: 0.2, anzahlPersonen: 4, chfProEinheit: 175.95 },
        { kuerzel: "WB", bezeichnung: "Wandbeton", leistungswertHProEinheit: 0.935, anzahlPersonen: 3, chfProEinheit: 253.47 },
        { kuerzel: "SB", bezeichnung: "Stützenbeton", leistungswertHProEinheit: 2.1, anzahlPersonen: 3, chfProEinheit: 353 },
        { kuerzel: "BR", bezeichnung: "Brüstungsbeton", leistungswertHProEinheit: 1.11, anzahlPersonen: 3, chfProEinheit: 264.58 },
        { kuerzel: "UZ", bezeichnung: "Unterzugsbeton", leistungswertHProEinheit: 0.715, anzahlPersonen: 3, chfProEinheit: 228.17 },
        { kuerzel: "DB", bezeichnung: "Deckenbeton", leistungswertHProEinheit: 0.281, anzahlPersonen: 4, chfProEinheit: 188.56 },
      ] },
      { key: "elemente_versetzen", label: "Elemente versetzen", einheit: "Stk./m²", kranpflichtig: true, raten: [
        { kuerzel: "EM", bezeichnung: "Elemente versetzen", leistungswertHProEinheit: 1.875, anzahlPersonen: 2, chfProEinheit: 2 },
      ] },
      { key: "daemmung_horizontal", label: "Dämmung horizontal", einheit: "m²", raten: [
        { kuerzel: "DÄMH", bezeichnung: "Dämmungen horizontal XPS", leistungswertHProEinheit: 0.103, anzahlPersonen: 5, chfProEinheit: 50.55 },
      ] },
      { key: "daemmung_vertikal", label: "Dämmung vertikal", einheit: "m²", raten: [
        { kuerzel: "DÄMV", bezeichnung: "Dämmungen vertikal XPS", leistungswertHProEinheit: 0.173, anzahlPersonen: 4, chfProEinheit: 40.88 },
      ] },
      { key: "mauerwerk", label: "Mauerwerk", einheit: "m²", raten: [
        { kuerzel: "MW", bezeichnung: "Mauerwerk gleichzeitig", leistungswertHProEinheit: 0.2, anzahlPersonen: 3, chfProEinheit: 2 },
      ] },
      { key: "kanalisation", label: "Kanalisation / Werkleitungen", einheit: "m1", raten: [
        { kuerzel: "KANAL", bezeichnung: "Kanalisation / Werkleitungen", leistungswertHProEinheit: 2.193, anzahlPersonen: 4, chfProEinheit: 2 },
      ] },
      { key: "folien", label: "Folien / Betonverbundfolie", einheit: "m²", raten: [
        { kuerzel: "FOL", bezeichnung: "Folien", leistungswertHProEinheit: 2, anzahlPersonen: 6, chfProEinheit: 2 },
      ] },
      { key: "aushub", label: "Aushub / Hinterfüllung", einheit: "m³", raten: [
        { kuerzel: "ERD", bezeichnung: "Aushub / Hinterfüllung", leistungswertHProEinheit: 2, anzahlPersonen: 2, chfProEinheit: 2 },
      ] },
    ],
  };
}

/** Leere Rate ohne Leistungswert/CHF — Platzhalter für Gerüst-Vorlagen ohne reale Referenzzahlen. */
function leer(kuerzel: string, bezeichnung: string): Rate {
  return { kuerzel, bezeichnung, leistungswertHProEinheit: null, anzahlPersonen: 1, chfProEinheit: null };
}

/**
 * Gerüst-Vorlage Innenausbau — nur Gewerke/Kürzel/Einheiten angelegt, KEINE realen Leistungswerte/
 * CHF-Sätze (anders als standardStammdaten(), die aus einer echten AVOR-Excel stammt). Über
 * "Innenausbau hinzufügen" additiv zu bestehenden Stammdaten zumischbar; Werte danach in Tab
 * Ressourcen selbst eintragen.
 */
export function innenausbauGewerke(): Gewerk[] {
  return [
    { key: "trockenbau", label: "Trockenbau", einheit: "m²", raten: [
      leer("TB", "Trockenbauwand"),
      leer("TBD", "Trockenbau-Decke"),
    ] },
    { key: "bodenbelaege", label: "Bodenbeläge", einheit: "m²", raten: [
      leer("BOD", "Bodenbelag"),
    ] },
    { key: "maler", label: "Maler-/Beschichtungsarbeiten", einheit: "m²", raten: [
      leer("MAL", "Malerarbeiten"),
    ] },
    { key: "tueren_fenster_innen", label: "Türen/Fenster innen", einheit: "Stk.", raten: [
      leer("TUE", "Türen/Fenster einbauen"),
    ] },
    { key: "schreiner", label: "Schreinerarbeiten", einheit: "m²", raten: [
      leer("SCHR", "Schreinerarbeiten/Einbaumöbel"),
    ] },
  ];
}

/** Gerüst-Vorlage HLKSSE (Heizung/Lüftung/Klima/Sanitär/Sprinkler/Elektro) — siehe innenausbauGewerke(). */
export function hlksseGewerke(): Gewerk[] {
  return [
    { key: "heizung", label: "Heizung", einheit: "m1", raten: [
      leer("HZ", "Heizungsleitungen"),
    ] },
    { key: "lueftung", label: "Lüftung", einheit: "m1", raten: [
      leer("LUE", "Lüftungskanäle"),
    ] },
    { key: "klima", label: "Klima", einheit: "Stk.", raten: [
      leer("KLI", "Klimageräte"),
    ] },
    { key: "sanitaer", label: "Sanitär", einheit: "Stk.", raten: [
      leer("SAN", "Sanitärapparate/-installation"),
    ] },
    { key: "sprinkler", label: "Sprinkler", einheit: "m1", raten: [
      leer("SPR", "Sprinklerleitungen"),
    ] },
    { key: "elektro", label: "Elektro", einheit: "m1", raten: [
      leer("EL", "Elektroinstallation/Kabeltrassen"),
    ] },
  ];
}

/** Gerüst-Vorlage Tiefbau — siehe innenausbauGewerke(). Bewusst ohne Überschneidung zu den in
 *  standardStammdaten() bereits vorhandenen Gewerken (aushub, kanalisation, folien). */
export function tiefbauGewerke(): Gewerk[] {
  return [
    { key: "baugrubensicherung", label: "Baugrubensicherung", einheit: "m²", raten: [
      leer("BGS", "Baugrubensicherung/Verbau"),
    ] },
    { key: "werkleitungen_tiefbau", label: "Werkleitungen (Tiefbau)", einheit: "m1", raten: [
      leer("WLT", "Werkleitungen verlegen"),
    ] },
    { key: "kanalbau", label: "Kanalbau", einheit: "m1", raten: [
      leer("KANB", "Kanalbau/Schächte"),
    ] },
    { key: "strassenbau", label: "Strassenbau", einheit: "m²", raten: [
      leer("STR", "Strassenbau/Beläge"),
    ] },
    { key: "humusierung", label: "Humusierung/Umgebung", einheit: "m²", raten: [
      leer("HUM", "Humusierung/Umgebungsarbeiten"),
    ] },
  ];
}

/** Gerüst-Vorlage Vorbereitungsarbeiten (eBKP-H Hauptgruppe B) — siehe innenausbauGewerke(). */
export function vorbereitungGewerke(): Gewerk[] {
  return [
    { key: "baustelleneinrichtung", label: "Baustelleneinrichtung", einheit: "psch", raten: [
      leer("BE", "Baustelleneinrichtung"),
    ] },
    { key: "abbruch", label: "Abbrucharbeiten", einheit: "m³", raten: [
      leer("ABBR", "Abbrucharbeiten"),
    ] },
    { key: "altlasten", label: "Altlastensanierung", einheit: "m³", raten: [
      leer("ALT", "Altlastensanierung"),
    ] },
  ];
}

/** Gerüst-Vorlage Fassade (eBKP-H Hauptgruppe E, Äussere Wandbekleidung Gebäude) — siehe innenausbauGewerke(). */
export function fassadeGewerke(): Gewerk[] {
  return [
    { key: "fassadenverkleidung", label: "Fassadenverkleidung", einheit: "m²", kranpflichtig: true, raten: [
      leer("FAS", "Fassadenverkleidung"),
    ] },
    { key: "fenster_aussen", label: "Fenster/Aussentüren", einheit: "Stk.", raten: [
      leer("FEA", "Fenster/Aussentüren einbauen"),
    ] },
    { key: "sonnenschutz", label: "Sonnenschutz", einheit: "m²", raten: [
      leer("SOS", "Sonnenschutzanlagen"),
    ] },
  ];
}

/** Gerüst-Vorlage Bedachung (eBKP-H Hauptgruppe F) — siehe innenausbauGewerke(). */
export function bedachungGewerke(): Gewerk[] {
  return [
    { key: "dachabdichtung", label: "Dachabdichtung", einheit: "m²", raten: [
      leer("DAB", "Dachabdichtung"),
    ] },
    { key: "spenglerarbeiten", label: "Spenglerarbeiten", einheit: "m1", raten: [
      leer("SPG", "Spenglerarbeiten"),
    ] },
    { key: "dacheindeckung", label: "Dacheindeckung", einheit: "m²", raten: [
      leer("DEI", "Dacheindeckung"),
    ] },
  ];
}

/** Gerüst-Vorlage Umgebung (eBKP-H Hauptgruppe I, Umgebung Gebäude) — siehe innenausbauGewerke(). */
export function umgebungGewerke(): Gewerk[] {
  return [
    { key: "umgebungsgestaltung", label: "Umgebungsgestaltung", einheit: "m²", raten: [
      leer("UMG", "Umgebungsgestaltung"),
    ] },
    { key: "wege_plaetze", label: "Wege/Plätze", einheit: "m²", raten: [
      leer("WEG", "Wege/Plätze"),
    ] },
    { key: "bepflanzung", label: "Bepflanzung", einheit: "m²", raten: [
      leer("BEP", "Bepflanzung"),
    ] },
  ];
}

/** Gerüst-Vorlage Untertagbau (eBKP-T Hauptgruppe N) — siehe innenausbauGewerke(). */
export function untertagbauGewerke(): Gewerk[] {
  return [
    { key: "tunnelbau", label: "Tunnelbau", einheit: "m1", raten: [
      leer("TUN", "Tunnelbau/Vortrieb"),
    ] },
    { key: "stollenbau", label: "Stollenbau", einheit: "m1", raten: [
      leer("STO", "Stollenbau"),
    ] },
  ];
}

/** Gerüst-Vorlage Kunstbauten (eBKP-T Hauptgruppe O, Konstruktion Kunstbauten) — siehe innenausbauGewerke(). */
export function kunstbautenGewerke(): Gewerk[] {
  return [
    { key: "brueckenbau", label: "Brückenbau", einheit: "m²", raten: [
      leer("BRU", "Brückenbau"),
    ] },
    { key: "stuetzmauern", label: "Stützmauern", einheit: "m²", raten: [
      leer("STM", "Stützmauern"),
    ] },
  ];
}

/** Gerüst-Vorlage Leitungsbau (eBKP-T Hauptgruppe Q) — siehe innenausbauGewerke(). */
export function leitungsbauGewerke(): Gewerk[] {
  return [
    { key: "gas_wasserleitungen", label: "Gas-/Wasserleitungen", einheit: "m1", raten: [
      leer("GWL", "Gas-/Wasserleitungen verlegen"),
    ] },
    { key: "fernwaerme", label: "Fernwärmeleitungen", einheit: "m1", raten: [
      leer("FWL", "Fernwärmeleitungen verlegen"),
    ] },
  ];
}

/** Gerüst-Vorlage Betriebs-/Sicherheitsanlagen (eBKP-T Hauptgruppe S) — siehe innenausbauGewerke(). */
export function betriebssicherheitGewerke(): Gewerk[] {
  return [
    { key: "signalanlagen", label: "Signalanlagen", einheit: "Stk.", raten: [
      leer("SIG", "Signalanlagen"),
    ] },
    { key: "beleuchtung_tiefbau", label: "Beleuchtung", einheit: "Stk.", raten: [
      leer("BEL", "Beleuchtung"),
    ] },
  ];
}

export interface GewerkeKatalog {
  key: string;
  label: string;
  gewerke: () => Gewerk[];
}

/** Alle per Dropdown wählbaren Gerüst-Vorlagen — additiv zu bestehenden Stammdaten zumischbar
 * (siehe gewerkeHinzufuegen in TabRessourcen.tsx). Rohbau enthält reale Referenzwerte aus der
 * AVOR-Excel, alle anderen sind bewusst leere Gerüste nach eBKP-H/eBKP-T-Logik (Hauptgruppen-
 * Bezeichnungen ohne Ziffern-Codes, siehe CRB-Standard). Nach dem Hinzufügen ist der Kategorie-
 * Titel in Tab Ressourcen frei umbenennbar. */
export const GEWERKE_KATALOGE: GewerkeKatalog[] = [
  { key: "rohbau", label: "Rohbau", gewerke: () => standardStammdaten().gewerke },
  { key: "vorbereitung", label: "Vorbereitungsarbeiten", gewerke: vorbereitungGewerke },
  { key: "innenausbau", label: "Innenausbau", gewerke: innenausbauGewerke },
  { key: "fassade", label: "Fassade", gewerke: fassadeGewerke },
  { key: "bedachung", label: "Bedachung", gewerke: bedachungGewerke },
  { key: "hlksse", label: "HLKSSE", gewerke: hlksseGewerke },
  { key: "umgebung", label: "Umgebung", gewerke: umgebungGewerke },
  { key: "tiefbau", label: "Tiefbau", gewerke: tiefbauGewerke },
  { key: "untertagbau", label: "Untertagbau", gewerke: untertagbauGewerke },
  { key: "kunstbauten", label: "Kunstbauten", gewerke: kunstbautenGewerke },
  { key: "leitungsbau", label: "Leitungsbau", gewerke: leitungsbauGewerke },
  { key: "betriebssicherheit", label: "Betriebs-/Sicherheitsanlagen", gewerke: betriebssicherheitGewerke },
];
