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

/** true, wenn für den Task mindestens ein Mengen-Wert hinterlegt ist, der in dauerBerechnetTask()
 *  tatsächlich einfließt — ohne das wäre "berechnete Dauer" nicht wirklich berechnet, sondern schlicht 0
 *  (siehe berechneZeitplanUebernahme() in zeitplanUebernahmeHelpers.ts, das solche Tasks deshalb unangetastet lässt). */
export function hatKalkulationsWerte(task: Task, stammdaten: Stammdaten): boolean {
  if (!task.bauteilKuerzel || !task.mengen) return false;
  return stammdaten.gewerke.some(gewerk => !!task.mengen![gewerk.key]);
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

/** Erzeugt Gewerke aus offiziellen eBKP-Elementgruppen (Code, Bezeichnung, Start-Einheit). Kürzel
 *  ist bewusst der echte eBKP-Code (statt einer erfundenen Abkürzung), damit er sich in Kostenplänen
 *  und Reporting wiedererkennen lässt. Die Einheit ist ein praxisüblicher Startwert — keine normierte
 *  CRB-Bezugsgrösse (die Norm definiert Bezugsgrössen nur zur Kostenkennwertbildung, nicht als
 *  verbindliche Mengeneinheit) — und in Tab Ressourcen frei überschreibbar, ebenso wie Kategorie- und
 *  Kürzel-Bezeichnungen. */
function ebkp(eintraege: [code: string, bezeichnung: string, einheit: string][]): Gewerk[] {
  return eintraege.map(([code, bezeichnung, einheit]) => ({
    key: code, label: `${code} ${bezeichnung}`, einheit, raten: [leer(code, bezeichnung)],
  }));
}

/** eBKP-H Hauptgruppe B «Vorbereitung» — Elementgruppen nach SN 506 511:2020. */
export function ebkpHVorbereitungGewerke(): Gewerk[] {
  return ebkp([
    ["B01", "Untersuchung, Aufnahme, Messung", "psch"],
    ["B02", "Baustelleneinrichtung", "psch"],
    ["B03", "Provisorium", "psch"],
    ["B04", "Erschliessung durch Werkleitungen", "m1"],
    ["B05", "Rodung, Rückbau", "m³"],
    ["B06", "Baugrube", "m³"],
    ["B07", "Baugrundverbesserung, Bauwerkssicherung", "m²"],
    ["B08", "Gerüst", "m²"],
    ["B09", "Anpassung angrenzendes Bauwerk", "psch"],
  ]);
}

/** eBKP-H Hauptgruppe C «Konstruktion Gebäude» — Elementgruppen nach SN 506 511:2020. */
export function ebkpHKonstruktionGewerke(): Gewerk[] {
  return ebkp([
    ["C01", "Fundament, Bodenplatte", "m²"],
    ["C02", "Wandkonstruktion", "m²"],
    ["C03", "Stützenkonstruktion", "Stk."],
    ["C04", "Deckenkonstruktion, Dachkonstruktion", "m²"],
    ["C05", "Ergänzende Leistung zu Konstruktion", "psch"],
  ]);
}

/** eBKP-H Hauptgruppe D «Technik Gebäude» — Elementgruppen nach SN 506 511:2020. */
export function ebkpHTechnikGewerke(): Gewerk[] {
  return ebkp([
    ["D01", "Elektroanlage", "m1"],
    ["D02", "Gebäudeautomation", "Stk."],
    ["D03", "Sicherheitsanlage", "Stk."],
    ["D04", "Technische Brandschutzanlage", "Stk."],
    ["D05", "Wärmetechnische Anlage", "Stk."],
    ["D06", "Kältetechnische Anlage", "Stk."],
    ["D07", "Lufttechnische Anlage", "m1"],
    ["D08", "Wassertechnische Anlage", "m1"],
    ["D09", "Abwassertechnische Anlage", "m1"],
    ["D10", "Gastechnische Anlage", "m1"],
    ["D11", "Anlage für Spezialmedien", "m1"],
    ["D12", "Beförderungsanlage", "Stk."],
  ]);
}

/** eBKP-H Hauptgruppe E «Äussere Wandbekleidung Gebäude» — Elementgruppen nach SN 506 511:2020. */
export function ebkpHFassadeGewerke(): Gewerk[] {
  return ebkp([
    ["E01", "Äussere Wandbekleidung unter Terrain", "m²"],
    ["E02", "Äussere Wandbekleidung über Terrain", "m²"],
    ["E03", "Element in Aussenwand", "Stk."],
  ]);
}

/** eBKP-H Hauptgruppe F «Bedachung Gebäude» — Elementgruppen nach SN 506 511:2020. */
export function ebkpHBedachungGewerke(): Gewerk[] {
  return ebkp([
    ["F01", "Dachhaut", "m²"],
    ["F02", "Element zu Dach", "m²"],
  ]);
}

/** eBKP-H Hauptgruppe G «Ausbau Gebäude» — Elementgruppen nach SN 506 511:2020. */
export function ebkpHAusbauGewerke(): Gewerk[] {
  return ebkp([
    ["G01", "Trennwand, Innentür, Innentor", "Stk."],
    ["G02", "Bodenbelag", "m²"],
    ["G03", "Wandbekleidung", "m²"],
    ["G04", "Deckenbekleidung", "m²"],
    ["G05", "Einbauten, Schutzeinrichtung zu Ausbau", "Stk."],
    ["G06", "Ergänzende Leistung zu Ausbau", "psch"],
  ]);
}

/** eBKP-H Hauptgruppe H «Nutzungsspezifische Anlage Gebäude» — Elementgruppen nach SN 506 511:2020. */
export function ebkpHNutzungsspezifischGewerke(): Gewerk[] {
  return ebkp([
    ["H01", "Produktionsanlage", "psch"],
    ["H02", "Laboranlage", "psch"],
    ["H03", "Grossküche", "psch"],
    ["H04", "Wäscherei-, Reinigungsanlage", "psch"],
    ["H05", "Anlage für Gesundheit", "psch"],
    ["H06", "Anlage für Bildung, Kultur", "psch"],
    ["H07", "Sportanlage, Freizeitanlage", "psch"],
    ["H08", "Anlage für Erholung", "psch"],
    ["H09", "Weitere nutzungsspezifische Anlage", "psch"],
  ]);
}

/** eBKP-H Hauptgruppe I «Umgebung Gebäude» — Elementgruppen nach SN 506 511:2020. */
export function ebkpHUmgebungGewerke(): Gewerk[] {
  return ebkp([
    ["I01", "Umgebungsgestaltung", "m²"],
    ["I02", "Bauwerk in der Umgebung", "Stk."],
    ["I03", "Grünfläche", "m²"],
    ["I04", "Hartfläche", "m²"],
    ["I05", "Technik Umgebung", "psch"],
    ["I06", "Ausstattung Umgebung", "Stk."],
  ]);
}

/** eBKP-H Hauptgruppe J «Ausstattung Gebäude» — Elementgruppen nach SN 506 511:2020. */
export function ebkpHAusstattungGewerke(): Gewerk[] {
  return ebkp([
    ["J01", "Mobiliar", "Stk."],
    ["J02", "Kleininventar", "Stk."],
    ["J03", "Textilien", "Stk."],
    ["J04", "Kunst am Bau", "Stk."],
  ]);
}

/** eBKP-T Hauptgruppe L «Vorbereitung Tiefbau» — Elementgruppen nach SN 506 512:2026. */
export function ebkpTVorbereitungGewerke(): Gewerk[] {
  return ebkp([
    ["L01", "Untersuchung, Aufnahme, Messung", "psch"],
    ["L02", "Baustelleneinrichtung", "psch"],
    ["L03", "Provisorium", "psch"],
    ["L04", "Rückbau Bauwerk", "m³"],
    ["L05", "Wiederherstellung, Schadensbehebung", "psch"],
    ["L06", "Gerüst", "m²"],
  ]);
}

/** eBKP-T Hauptgruppe M «Erdbau, Spezialtiefbau» — Elementgruppen nach SN 506 512:2026. */
export function ebkpTErdbauGewerke(): Gewerk[] {
  return ebkp([
    ["M01", "Erdbewegung", "m³"],
    ["M02", "Grabenloser Leitungsbau", "m1"],
    ["M03", "Materialbewirtschaftung", "m³"],
    ["M04", "Belasteter Standort", "m³"],
    ["M05", "Erdbausicherung", "m²"],
    ["M06", "Baugrundverbesserung", "m²"],
    ["M07", "Sicherung, Verbauung", "m²"],
    ["M08", "Landschaftsgestaltung", "m²"],
  ]);
}

/** eBKP-T Hauptgruppe N «Untertagbau» — Elementgruppen nach SN 506 512:2026. */
export function ebkpTUntertagbauGewerke(): Gewerk[] {
  return ebkp([
    ["N01", "Vortrieb Untertagbau", "m1"],
    ["N02", "Sicherung Untertagbau", "m1"],
    ["N03", "Ausbau Untertagbau", "m1"],
    ["N04", "Innenausbau, Kabelrohranlage Untertagbau", "m1"],
  ]);
}

/** eBKP-T Hauptgruppe O «Konstruktion Kunstbauten» — Elementgruppen nach SN 506 512:2026. */
export function ebkpTKunstbautenGewerke(): Gewerk[] {
  return ebkp([
    ["O01", "Fundament", "m³"],
    ["O02", "Wand, Stütze, Stützenreihe", "m³"],
    ["O03", "Platte, Träger", "m³"],
    ["O04", "Unterbau Brücke", "m²"],
    ["O05", "Überbau Brücke", "m²"],
    ["O06", "Brückenlager, Fahrbahnübergang", "Stk."],
    ["O07", "Spezialkonstruktion", "psch"],
    ["O08", "Ergänzung zu Konstruktion Kunstbauten", "psch"],
  ]);
}

/** eBKP-T Hauptgruppe P «Hülle, Ausbau» — Elementgruppen nach SN 506 512:2026. */
export function ebkpTHuelleAusbauGewerke(): Gewerk[] {
  return ebkp([
    ["P01", "Oberfläche aussen", "m²"],
    ["P02", "Oberfläche innen", "m²"],
    ["P03", "Einbaute aussen", "Stk."],
    ["P04", "Einbaute innen", "Stk."],
    ["P05", "Ergänzung zu Ausbau", "psch"],
  ]);
}

/** eBKP-T Hauptgruppe Q «Leitungsbau» — Elementgruppen nach SN 506 512:2026. */
export function ebkpTLeitungsbauGewerke(): Gewerk[] {
  return ebkp([
    ["Q01", "Entwässerung", "m1"],
    ["Q02", "Kanalisation", "m1"],
    ["Q03", "Wasserversorgung", "m1"],
    ["Q04", "Gasversorgung", "m1"],
    ["Q05", "Fernwärme, Fernkälte", "m1"],
    ["Q06", "Rohrblock", "m1"],
    ["Q07", "Kabelkanal", "m1"],
    ["Q08", "Bauwerke zu Kabelanlage", "Stk."],
    ["Q09", "Rohrleitungsanlage", "m1"],
  ]);
}

/** eBKP-T Hauptgruppe R «Fahrbahn» — Elementgruppen nach SN 506 512:2026. */
export function ebkpTFahrbahnGewerke(): Gewerk[] {
  return ebkp([
    ["R01", "Oberbau Strasse", "m²"],
    ["R02", "Markierung, Signal", "m1"],
    ["R03", "Bahntrasse", "m1"],
    ["R04", "Fahrleitung", "m1"],
    ["R05", "Sicherungsanlage", "Stk."],
    ["R06", "Rückhaltesystem", "m1"],
    ["R07", "Ergänzung zu Fahrbahn", "psch"],
    ["R08", "Ausstattung Umgebung", "Stk."],
    ["R09", "Kunst am Bau", "Stk."],
  ]);
}

/** eBKP-T Hauptgruppe S «Betriebs-, Sicherheitsanlage» — Elementgruppen nach SN 506 512:2026. */
export function ebkpTBetriebssicherheitGewerke(): Gewerk[] {
  return ebkp([
    ["S01", "Energieversorgung", "m1"],
    ["S02", "Beleuchtung", "Stk."],
    ["S03", "Lufttechnische Anlage", "m1"],
    ["S04", "Verkehrsbeeinflussung", "Stk."],
    ["S05", "Überwachungsanlage", "Stk."],
    ["S06", "Automation, Kommunikations-, Leitanlage", "Stk."],
    ["S07", "Sicherheitsanlage", "Stk."],
    ["S08", "Brandschutz", "Stk."],
    ["S09", "Beförderungsanlage", "Stk."],
  ]);
}

/** eBKP-T Hauptgruppe T «Ausrüstung» — Elementgruppen nach SN 506 512:2026. */
export function ebkpTAusruestungGewerke(): Gewerk[] {
  return ebkp([
    ["T01", "Elektroanlage", "m1"],
    ["T02", "Wärmetechnische Anlage", "Stk."],
    ["T03", "Kältetechnische Anlage", "Stk."],
    ["T04", "Lufttechnische Anlage Gebäude", "m1"],
    ["T05", "Wassertechnische Anlage", "m1"],
    ["T06", "Abwassertechnische Anlage", "m1"],
    ["T07", "Gastechnische Anlage", "m1"],
    ["T08", "Anlage für Spezialmedien", "m1"],
  ]);
}

export interface GewerkeKatalog {
  key: string;
  label: string;
  gewerke: () => Gewerk[];
}

/** Alle per Dropdown wählbaren Vorlagen — additiv zu bestehenden Stammdaten zumischbar (siehe
 * gewerkeHinzufuegen in TabRessourcen.tsx). "Rohbau" enthält reale Referenzwerte aus der AVOR-Excel;
 * alle eBKP-Vorlagen bilden die offiziellen Hauptgruppen B–J (eBKP-H, Hochbau, SN 506 511:2020) bzw.
 * L–T (eBKP-T, Tiefbau, SN 506 512:2026) ab — je Elementgruppe ein Gewerk mit dem echten eBKP-Code
 * als Kürzel, ohne reale Leistungswerte/CHF-Sätze (siehe ebkp()). Die rein finanziellen/administrativen
 * Hauptgruppen A/V/W/Y/Z (Grundstück, Planungskosten, Nebenkosten, Reserve, MWST) sind bewusst
 * ausgeklammert, da sie keine im Bauablauf terminierbaren Bauteile/Leistungen darstellen. Nach dem
 * Hinzufügen ist der Kategorie-Titel in Tab Ressourcen frei umbenennbar. */
export const GEWERKE_KATALOGE: GewerkeKatalog[] = [
  { key: "rohbau", label: "Rohbau", gewerke: () => standardStammdaten().gewerke },
  { key: "ebkph_b", label: "eBKP-H · B Vorbereitung", gewerke: ebkpHVorbereitungGewerke },
  { key: "ebkph_c", label: "eBKP-H · C Konstruktion Gebäude", gewerke: ebkpHKonstruktionGewerke },
  { key: "ebkph_d", label: "eBKP-H · D Technik Gebäude", gewerke: ebkpHTechnikGewerke },
  { key: "ebkph_e", label: "eBKP-H · E Äussere Wandbekleidung Gebäude", gewerke: ebkpHFassadeGewerke },
  { key: "ebkph_f", label: "eBKP-H · F Bedachung Gebäude", gewerke: ebkpHBedachungGewerke },
  { key: "ebkph_g", label: "eBKP-H · G Ausbau Gebäude", gewerke: ebkpHAusbauGewerke },
  { key: "ebkph_h", label: "eBKP-H · H Nutzungsspezifische Anlage Gebäude", gewerke: ebkpHNutzungsspezifischGewerke },
  { key: "ebkph_i", label: "eBKP-H · I Umgebung Gebäude", gewerke: ebkpHUmgebungGewerke },
  { key: "ebkph_j", label: "eBKP-H · J Ausstattung Gebäude", gewerke: ebkpHAusstattungGewerke },
  { key: "ebkpt_l", label: "eBKP-T · L Vorbereitung Tiefbau", gewerke: ebkpTVorbereitungGewerke },
  { key: "ebkpt_m", label: "eBKP-T · M Erdbau, Spezialtiefbau", gewerke: ebkpTErdbauGewerke },
  { key: "ebkpt_n", label: "eBKP-T · N Untertagbau", gewerke: ebkpTUntertagbauGewerke },
  { key: "ebkpt_o", label: "eBKP-T · O Konstruktion Kunstbauten", gewerke: ebkpTKunstbautenGewerke },
  { key: "ebkpt_p", label: "eBKP-T · P Hülle, Ausbau", gewerke: ebkpTHuelleAusbauGewerke },
  { key: "ebkpt_q", label: "eBKP-T · Q Leitungsbau", gewerke: ebkpTLeitungsbauGewerke },
  { key: "ebkpt_r", label: "eBKP-T · R Fahrbahn", gewerke: ebkpTFahrbahnGewerke },
  { key: "ebkpt_s", label: "eBKP-T · S Betriebs-, Sicherheitsanlage", gewerke: ebkpTBetriebssicherheitGewerke },
  { key: "ebkpt_t", label: "eBKP-T · T Ausrüstung", gewerke: ebkpTAusruestungGewerke },
];
