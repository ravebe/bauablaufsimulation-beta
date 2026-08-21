// stammdatenHelpers.ts — Kalkulations-Stammdaten (Leistungswerte/Personal je Bauteil-Kürzel) und
// die Menge→Tage-Formel aus dem AVOR-Tool (Grundlage für Kalkulation/Ressourcen/Kosten-Tabs).
import type { Task } from "../types";

export interface Rate {
  kuerzel: string;
  bezeichnung: string;
  leistungswertHProEinheit: number | null;
  anzahlPersonen: number;
  chfProEinheit: number | null;
}
export interface Gewerk {
  key: string;
  label: string;
  einheit: string;
  raten: Rate[];
}
export interface Stammdaten {
  arbeitszeitStdProTag: number;
  gewerke: Gewerk[];
}
export const LEERE_STAMMDATEN: Stammdaten = { arbeitszeitStdProTag: 8.5, gewerke: [] };

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

/** Standard-Stammdaten aus dem AVOR-Tool "LUKS Wolhusen" als Startpunkt (frei editierbar danach). */
export function standardStammdaten(): Stammdaten {
  return {
    arbeitszeitStdProTag: 8.5,
    gewerke: [
      { key: "schalung", label: "Schalung", einheit: "m²", raten: [
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
      { key: "elemente_versetzen", label: "Elemente versetzen", einheit: "Stk./m²", raten: [
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
