// avorHelpers.ts — Tagesreihen für den Tab AVOR (Personal-/Kranauslastung, Mengen-Filter,
// Ertragsoptik), berechnet aus Tasks + Stammdaten + Arbeitstage-Kalender. Reine Funktionen, kein UI.
import type { Task } from "../types";
import { parseDateUniversal } from "../types";
import type { Kalender } from "./kalenderHelpers";
import { istArbeitstag, arbeitstageZwischen } from "./kalenderHelpers";
import type { Stammdaten, Gewerk, Rate } from "./stammdatenHelpers";

export interface TagWert { tag: string; werte: Record<string, number> }

function toIso(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function projektzeitraum(tasks: Task[]): { start: Date; end: Date } | null {
  let minT = Infinity, maxT = -Infinity;
  for (const t of tasks) {
    const s = parseDateUniversal(t.start), e = parseDateUniversal(t.end);
    if (s) minT = Math.min(minT, s.getTime());
    if (e) maxT = Math.max(maxT, e.getTime());
  }
  if (minT === Infinity || maxT === -Infinity) return null;
  return { start: new Date(minT), end: new Date(maxT) };
}

function rateFuer(gewerk: Gewerk, kuerzel: string) {
  return gewerk.raten.find(r => r.kuerzel === kuerzel);
}

/** Läuft t am Kalendertag iso (Task-Start/Ende als YYYY-MM-DD, lexikografisch vergleichbar)? */
function laeuftAn(t: Task, iso: string): boolean {
  return !t.isGroup && !!t.bauteilKuerzel && !!t.mengen && iso >= t.start && iso <= t.end;
}

/** Für jeden Tag im Projektzeitraum: Summe der Kolonnengrösse je Gewerk (nur an Arbeitstagen). */
export function personalauslastung(tasks: Task[], stammdaten: Stammdaten, kalender: Kalender): TagWert[] {
  const zeitraum = projektzeitraum(tasks);
  if (!zeitraum) return [];
  const ergebnis: TagWert[] = [];
  const cur = new Date(zeitraum.start.getTime());
  while (cur.getTime() <= zeitraum.end.getTime()) {
    const iso = toIso(cur);
    const werte: Record<string, number> = {};
    if (istArbeitstag(iso, kalender)) {
      for (const t of tasks) {
        if (!laeuftAn(t, iso)) continue;
        for (const gewerk of stammdaten.gewerke) {
          const menge = t.mengen![gewerk.key];
          if (!menge) continue;
          const rate = rateFuer(gewerk, t.bauteilKuerzel!);
          if (!rate) continue;
          werte[gewerk.key] = (werte[gewerk.key] ?? 0) + rate.anzahlPersonen;
        }
      }
    }
    ergebnis.push({ tag: iso, werte });
    cur.setDate(cur.getDate() + 1);
  }
  return ergebnis;
}

/**
 * Kranauslastung: Anzahl gleichzeitig laufender kranpflichtiger Tasks je Kranbereich (Proxy-Metrik
 * — keine echte Kranphysik/-kapazität, sondern "wie viele Tasks wollen an dem Tag denselben Kran").
 */
export function kranauslastung(tasks: Task[], stammdaten: Stammdaten, kalender: Kalender): TagWert[] {
  const zeitraum = projektzeitraum(tasks);
  if (!zeitraum) return [];
  const kranGewerkKeys = new Set(stammdaten.gewerke.filter(g => g.kranpflichtig).map(g => g.key));
  const ergebnis: TagWert[] = [];
  const cur = new Date(zeitraum.start.getTime());
  while (cur.getTime() <= zeitraum.end.getTime()) {
    const iso = toIso(cur);
    const werte: Record<string, number> = {};
    if (istArbeitstag(iso, kalender) && kranGewerkKeys.size > 0) {
      for (const t of tasks) {
        if (!laeuftAn(t, iso)) continue;
        const hatKranGewerk = Object.keys(t.mengen!).some(k => kranGewerkKeys.has(k) && t.mengen![k] > 0);
        if (!hatKranGewerk) continue;
        const bereich = t.kranbereich?.trim() || "unbekannt";
        werte[bereich] = (werte[bereich] ?? 0) + 1;
      }
    }
    ergebnis.push({ tag: iso, werte });
    cur.setDate(cur.getDate() + 1);
  }
  return ergebnis;
}

/** Menge/Tag für ein Gewerk ("durchschnittlich nötige Tagesleistung"), gleichmässig über die
 *  Arbeitstage jedes Tasks verteilt. Mit kuerzel eingeschränkt auf Tasks dieses Bauteil-Kürzels
 *  (z.B. "BPL"), analog den kürzelweisen Filterblättern im AVOR-Excel-Tool. */
export function mengenProTag(tasks: Task[], gewerkKey: string, kalender: Kalender, kuerzel?: string): { tag: string; menge: number }[] {
  const zeitraum = projektzeitraum(tasks);
  if (!zeitraum) return [];
  const ergebnis: { tag: string; menge: number }[] = [];
  const cur = new Date(zeitraum.start.getTime());
  while (cur.getTime() <= zeitraum.end.getTime()) {
    const iso = toIso(cur);
    let menge = 0;
    if (istArbeitstag(iso, kalender)) {
      for (const t of tasks) {
        if (t.isGroup) continue;
        if (kuerzel && t.bauteilKuerzel !== kuerzel) continue;
        const m = t.mengen?.[gewerkKey];
        if (!m || iso < t.start || iso > t.end) continue;
        menge += m / arbeitstageZwischen(t.start, t.end, kalender);
      }
    }
    ergebnis.push({ tag: iso, menge });
    cur.setDate(cur.getDate() + 1);
  }
  return ergebnis;
}

/** "Optimal ausgelastete Tagesleistung" einer Rate: Menge, die eine voll ausgelastete Kolonne
 *  (anzahlPersonen Personen, arbeitszeitStdProTag Std./Tag) bei ihrem Leistungswert an einem
 *  Arbeitstag schafft — analog der roten Referenzzeile im AVOR-Excel-Tool
 *  ("=(1/Leistungswert)*AnzahlPersonen*ArbeitszeitProTag"). null wenn kein Leistungswert
 *  hinterlegt ist (im Excel-Tool als "-" dargestellt). */
export function optimaleTagesleistung(rate: Rate, arbeitszeitStdProTag: number): number | null {
  if (!rate.leistungswertHProEinheit) return null;
  return (1 / rate.leistungswertHProEinheit) * rate.anzahlPersonen * arbeitszeitStdProTag;
}

/** Kumulierte Ertrags-/Kostenkurve über die Zeit (Ertragsoptik). */
export function ertragsoptik(tasks: Task[], stammdaten: Stammdaten, kalender: Kalender): { tag: string; ertragKum: number; kostenKum: number }[] {
  const zeitraum = projektzeitraum(tasks);
  if (!zeitraum) return [];
  const umsatz = stammdaten.umsatzChfProMannstunde ?? 80;
  const ergebnis: { tag: string; ertragKum: number; kostenKum: number }[] = [];
  let ertragKum = 0, kostenKum = 0;
  const cur = new Date(zeitraum.start.getTime());
  while (cur.getTime() <= zeitraum.end.getTime()) {
    const iso = toIso(cur);
    if (istArbeitstag(iso, kalender)) {
      for (const t of tasks) {
        if (!laeuftAn(t, iso)) continue;
        const arbeitstage = arbeitstageZwischen(t.start, t.end, kalender);
        for (const gewerk of stammdaten.gewerke) {
          const menge = t.mengen![gewerk.key];
          if (!menge) continue;
          const rate = rateFuer(gewerk, t.bauteilKuerzel!);
          if (!rate) continue;
          ertragKum += rate.anzahlPersonen * stammdaten.arbeitszeitStdProTag * umsatz;
          if (rate.chfProEinheit) kostenKum += (menge * rate.chfProEinheit) / arbeitstage;
        }
      }
    }
    ergebnis.push({ tag: iso, ertragKum, kostenKum });
    cur.setDate(cur.getDate() + 1);
  }
  return ergebnis;
}
