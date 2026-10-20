// avorHelpers.ts — Tagesreihen für den Tab AVOR (Personal-/Kranauslastung, Mengen-Filter,
// Ertragsoptik), berechnet aus Tasks + Stammdaten + Arbeitstage-Kalender. Reine Funktionen, kein UI.
import type { Task } from "../types";
import { parseDateUniversal } from "../types";
import type { Kalender } from "./kalenderHelpers";
import { istArbeitstag } from "./kalenderHelpers";
import { arbeitsAnteilAmTag, dauerTage } from "./zeitHelpers";
import type { Stammdaten, Gewerk, Rate } from "./stammdatenHelpers";
import { istMengeKranpflichtig, hatKranpflichtigeRaten } from "./stammdatenHelpers";

export interface TagWert { tag: string; werte: Record<string, number> }

function toIso(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Gesamtzeitraum aller Tasks (min Start / max Ende) — Grundlage für alle Tagesreihen dieses Moduls
 *  sowie für die Zeitraster-Buckets (Monat/Woche) in kranHelpers.ts. */
export function projektzeitraum(tasks: Task[]): { start: Date; end: Date } | null {
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

/**
 * Personen je Gewerk und Tag für einen Task — nachvollziehbar aus der Kalkulation abgeleitet:
 *  1. Die Gewerke arbeiten nacheinander (Reihenfolge wie in Tab Ressourcen), jedes so lange, wie es laut
 *     Kalkulation braucht: Menge × Leistungswert ÷ (Kolonne × Std./Tag) — dieselbe Rechnung wie die
 *     berechnete Dauer in Tab Kalkulation (dauerGewerk/dauerBerechnetTask in stammdatenHelpers.ts).
 *  2. Ist der Task im Gantt länger oder kürzer als die Summe dieser Dauern, werden alle Phasen im gleichen
 *     Verhältnis gestreckt bzw. gestaucht und die Kolonne entsprechend kleiner bzw. grösser:
 *     Personen = Kolonne × berechnete Dauer ÷ geplante Dauer.
 *  Die Personenstunden je Task bleiben so immer genau die kalkulierten (Menge × Leistungswert); stimmt die
 *  geplante Dauer mit der berechneten überein, erscheinen genau die Kolonnengrössen aus Tab Ressourcen.
 *  Gewerke ohne Leistungswert haben keinen Aufwand und zählen nicht mit. Halbe Tage zählen anteilig.
 */
export function personalJeTagFuerTask(t: Task, stammdaten: Stammdaten, kalender: Kalender): Map<string, Record<string, number>> {
  const ergebnis = new Map<string, Record<string, number>>();
  if (t.isGroup || !t.bauteilKuerzel || !t.mengen || !t.start || !t.end) return ergebnis;
  const std = stammdaten.arbeitszeitStdProTag;
  const phasen: { key: string; kolonne: number; tage: number }[] = [];
  for (const gewerk of stammdaten.gewerke) {
    const menge = t.mengen[gewerk.key];
    const rate = rateFuer(gewerk, t.bauteilKuerzel);
    if (!menge || !rate?.leistungswertHProEinheit || !rate.anzahlPersonen || !std) continue;
    phasen.push({ key: gewerk.key, kolonne: rate.anzahlPersonen, tage: (menge * rate.leistungswertHProEinheit) / (rate.anzahlPersonen * std) });
  }
  const berechnet = phasen.reduce((s, p) => s + p.tage, 0);
  if (berechnet <= 0) return ergebnis;

  // Arbeitstage des Tasks mit ihrem Anteil (ganzer Tag = 1, Halbtag = 0.5)
  const s = parseDateUniversal(t.start), e = parseDateUniversal(t.end);
  if (!s || !e) return ergebnis;
  const tage: { iso: string; anteil: number }[] = [];
  for (const cur = new Date(s.getTime()); cur.getTime() <= e.getTime(); cur.setDate(cur.getDate() + 1)) {
    const iso = toIso(cur);
    const anteil = arbeitsAnteilAmTag(t, iso, kalender);
    if (anteil > 0) tage.push({ iso, anteil });
  }
  const geplant = tage.reduce((sum, tg) => sum + tg.anteil, 0);
  if (geplant <= 0) return ergebnis;

  const faktor = geplant / berechnet; // > 1: im Gantt länger als berechnet → Phasen gestreckt, kleinere Kolonne
  let pos = 0;
  for (const tg of tage) {
    const von = pos, bis = pos + tg.anteil;
    const werte: Record<string, number> = {};
    let phaseVon = 0;
    for (const p of phasen) {
      const phaseBis = phaseVon + p.tage * faktor;
      const ueberlappung = Math.min(bis, phaseBis) - Math.max(von, phaseVon);
      if (ueberlappung > 1e-9) werte[p.key] = (werte[p.key] ?? 0) + (p.kolonne / faktor) * ueberlappung;
      phaseVon = phaseBis;
    }
    ergebnis.set(tg.iso, werte);
    pos = bis;
  }
  return ergebnis;
}

/** Für jeden Tag im Projektzeitraum: Personen je Gewerk, summiert über alle laufenden Tasks (siehe
 *  personalJeTagFuerTask — Gewerke nacheinander, Personen aus dem kalkulierten Aufwand). */
export function personalauslastung(tasks: Task[], stammdaten: Stammdaten, kalender: Kalender): TagWert[] {
  const zeitraum = projektzeitraum(tasks);
  if (!zeitraum) return [];
  const jeTag = new Map<string, Record<string, number>>();
  for (const t of tasks) {
    for (const [iso, werteTask] of personalJeTagFuerTask(t, stammdaten, kalender)) {
      const werte = jeTag.get(iso) ?? {};
      for (const [k, v] of Object.entries(werteTask)) werte[k] = (werte[k] ?? 0) + v;
      jeTag.set(iso, werte);
    }
  }
  const ergebnis: TagWert[] = [];
  const cur = new Date(zeitraum.start.getTime());
  while (cur.getTime() <= zeitraum.end.getTime()) {
    const iso = toIso(cur);
    ergebnis.push({ tag: iso, werte: jeTag.get(iso) ?? {} });
    cur.setDate(cur.getDate() + 1);
  }
  return ergebnis;
}

/** Für jeden Tag im Projektzeitraum: Summe von Task.personalSoll aller an diesem Tag laufenden Tasks
 *  (nur Arbeitstage) — unabhängig von Bauteil-Kürzel/Mengen und den Kolonnengrössen je Kürzel in den
 *  Stammdaten. Basis für die rote "Personal (Soll)"-Referenzlinie über der Personalauslastung in Tab
 *  AVOR (siehe TabAvor.tsx) — ein direkter Vergleich der tatsächlich vorgesehenen Belegschaft mit dem
 *  aus Mengen/Leistungswerten rechnerisch ermittelten Bedarf. */
export function personalSollProTag(tasks: Task[], kalender: Kalender): number[] {
  const zeitraum = projektzeitraum(tasks);
  if (!zeitraum) return [];
  const ergebnis: number[] = [];
  const cur = new Date(zeitraum.start.getTime());
  while (cur.getTime() <= zeitraum.end.getTime()) {
    const iso = toIso(cur);
    let summe = 0;
    if (istArbeitstag(iso, kalender)) {
      for (const t of tasks) {
        if (t.isGroup || !t.personalSoll || iso < t.start || iso > t.end) continue;
        summe += t.personalSoll * arbeitsAnteilAmTag(t, iso, kalender);
      }
    }
    ergebnis.push(summe);
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
  const gibtEsKranpflichtige = hatKranpflichtigeRaten(stammdaten);
  const ergebnis: TagWert[] = [];
  const cur = new Date(zeitraum.start.getTime());
  while (cur.getTime() <= zeitraum.end.getTime()) {
    const iso = toIso(cur);
    const werte: Record<string, number> = {};
    if (istArbeitstag(iso, kalender) && gibtEsKranpflichtige) {
      for (const t of tasks) {
        if (!laeuftAn(t, iso)) continue;
        const hatKranGewerk = Object.keys(t.mengen!).some(k => t.mengen![k] > 0 && istMengeKranpflichtig(stammdaten, k, t.bauteilKuerzel));
        if (!hatKranGewerk) continue;
        const bereich = t.kranbereich?.trim() || "unbekannt";
        werte[bereich] = (werte[bereich] ?? 0) + arbeitsAnteilAmTag(t, iso, kalender);
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
        menge += m * arbeitsAnteilAmTag(t, iso, kalender) / dauerTage(t, kalender);
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
  const personal = new Map(personalauslastung(tasks, stammdaten, kalender).map(tw => [tw.tag, tw.werte]));
  const cur = new Date(zeitraum.start.getTime());
  while (cur.getTime() <= zeitraum.end.getTime()) {
    const iso = toIso(cur);
    if (istArbeitstag(iso, kalender)) {
      // Ertrag = Personen des Tages (wie Personalauslastung) × Std./Tag × Umsatz/Mannstunde
      const personenTag = Object.values(personal.get(iso) ?? {}).reduce((s, v) => s + v, 0);
      ertragKum += personenTag * stammdaten.arbeitszeitStdProTag * umsatz;
      for (const t of tasks) {
        if (!laeuftAn(t, iso)) continue;
        const anteil = arbeitsAnteilAmTag(t, iso, kalender);
        if (!anteil) continue;
        const arbeitstage = dauerTage(t, kalender);
        for (const gewerk of stammdaten.gewerke) {
          const menge = t.mengen![gewerk.key];
          if (!menge) continue;
          const rate = rateFuer(gewerk, t.bauteilKuerzel!);
          if (rate?.chfProEinheit) kostenKum += (menge * rate.chfProEinheit) * anteil / arbeitstage;
        }
      }
    }
    ergebnis.push({ tag: iso, ertragKum, kostenKum });
    cur.setDate(cur.getDate() + 1);
  }
  return ergebnis;
}
