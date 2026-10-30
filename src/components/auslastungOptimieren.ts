// auslastungOptimieren.ts — "Auslastung optimieren" (Tab Bauteile → Werkzeuge): Einstieg und gemeinsame Hilfen. Geplant wird immer
// mit auslastungOptimierenKran.ts und dem gemeinsamen Rechenkern (ablaufKern.ts) — mit Personal unter dem Kran als Pools je Kran
// und Unternehmer, ohne als Kolonnen je Gewerk + Unternehmer (eine Arbeit gleichzeitig, von Arbeit zu Arbeit). Derselbe Kern
// rechnet den Tagesablauf in Tab AVOR, so stimmen Gantt und Auswertungen überein.
//  - Vorgänger und Wartetage bleiben massgebend; Tasks ohne Vorgänger beginnen frühestens an ihrem bisherigen Start.
//  - Tasks ohne Kalkulationswerte, Gruppen und Meilensteine bleiben unverändert.
import type { Task, Kran } from "../types";
import { vorgaengerListe, mitVorgaengern } from "../types";
import type { Stammdaten } from "./stammdatenHelpers";
import type { Kalender } from "./kalenderHelpers";
import type { Zeiteinheit, Zeitpunkt } from "./zeitHelpers";
import { startZeitpunkt, ARBEITSBEGINN_MIN, minZuZeit, zeitZuMin } from "./zeitHelpers";
import { optimiereMitKranpersonal } from "./auslastungOptimierenKran";
import type { OptimierReihenfolge, OptimierOptionen } from "./auslastungOptimierenKran";
export type { OptimierReihenfolge } from "./auslastungOptimierenKran";

const zpText = (p: Zeitpunkt) => `${p.datum} ${minZuZeit(p.min)}`;

/** Ausgangslage fürs Optimieren: automatisch ergänzte Vorgänger eines früheren Optimierens (Task.optimierung) entfernt und, solange
 *  der Start seither unverändert ist, der Start von vor dem Optimieren — so hängt das Ergebnis nicht davon ab, wie oft schon
 *  optimiert wurde. */
function optimierBasis(t: Task): Task {
  const o = t.optimierung;
  if (!o) return t;
  const auto = new Set(o.vorgaenger);
  let basis = auto.size > 0 ? mitVorgaengern(t, vorgaengerListe(t).filter(v => !auto.has(v.id))) : t;
  if (zpText(startZeitpunkt(t)) === o.start) {
    const [datum, zeit] = o.freigabe.split(" ");
    const min = zeitZuMin(zeit, ARBEITSBEGINN_MIN);
    basis = { ...basis, start: datum, startZeit: min === ARBEITSBEGINN_MIN ? undefined : zeit, end: basis.end < datum ? datum : basis.end };
  }
  return basis;
}

/** Ergänzte Vorgänger nur, wo sie nötig sind: gilt ein ergänzter Vorgänger schon über eine Kette anderer Vorgänger des Tasks (ohne
 *  negative Wartetage), ändert er nichts und entfällt — so bleiben nur die Vorgänger, die die Reihenfolge der Optimierung festhalten. */
function nurNoetigeVorgaenger(basis: Task[], roh: Task[]): Task[] {
  const vorg = new Map(roh.map(t => [t.id, vorgaengerListe(t)]));
  const erreicht = (von: string, ziel: string): boolean => {
    const besucht = new Set<string>();
    const stapel = [von];
    while (stapel.length) {
      const id = stapel.pop()!;
      if (id === ziel) return true;
      if (besucht.has(id)) continue;
      besucht.add(id);
      for (const v of vorg.get(id) ?? []) if (v.lagDays >= 0) stapel.push(v.id);
    }
    return false;
  };
  return roh.map((t, i) => {
    if (t === basis[i]) return t;
    const bisher = new Set(vorgaengerListe(basis[i]).map(v => v.id));
    const liste = vorgaengerListe(t);
    const neu = liste.filter(v => !bisher.has(v.id));
    if (neu.length === 0) return t;
    const behalten = liste.filter(v => bisher.has(v.id) || !liste.some(w => w.id !== v.id && w.lagDays >= 0 && erreicht(w.id, v.id)));
    if (behalten.length === liste.length) return t;
    vorg.set(t.id, behalten);
    return mitVorgaengern(t, behalten);
  });
}

/** Neue Termine aller Tasks nach "Auslastung optimieren" (gleiche Reihenfolge wie tasks), geplant mit optimiereMitKranpersonal
 *  (Pools je Kran und Unternehmer, wo Personal unter dem Kran erfasst ist, sonst Kolonnen je Gewerk + Unternehmer). Geplante
 *  Tasks merken sich in Task.optimierung ihren Start von vorher und die ergänzten Vorgänger (siehe optimierBasis) — erneutes
 *  Optimieren ergibt dasselbe Ergebnis. lueckenFuellen und optionen (Nachführen) siehe optimiereMitKranpersonal. */
export function optimiereAuslastung(tasks: Task[], stammdaten: Stammdaten, kalender: Kalender, einheit: Zeiteinheit = "tage", kraene: Kran[] = [],
  reihenfolge: OptimierReihenfolge = "kritischerPfad", lueckenFuellen = false, optionen: OptimierOptionen = {}): Task[] {
  const basis = tasks.map(optimierBasis);
  const roh = optimiereMitKranpersonal(basis, stammdaten, kalender, einheit, kraene, reihenfolge, lueckenFuellen, optionen);
  const geprueft = nurNoetigeVorgaenger(basis, roh);
  return tasks.map((t, i) => {
    const neu = geprueft[i];
    if (roh[i] === basis[i]) return t; // nicht geplant (Gruppe, Meilenstein, ohne Kalkulation) — unverändert
    const bisher = new Set(vorgaengerListe(basis[i]).map(v => v.id));
    const freigabe = t.optimierung && zpText(startZeitpunkt(t)) === t.optimierung.start ? t.optimierung.freigabe : zpText(startZeitpunkt(t));
    return { ...neu, optimierung: { freigabe, start: zpText(startZeitpunkt(neu)), vorgaenger: vorgaengerListe(neu).filter(v => !bisher.has(v.id)).map(v => v.id) } };
  });
}

/** Ergebnis von "Auslastung optimieren" in den aktuellen Stand übernehmen: nur Termine, Vorgänger, Optimierungs-Stand und Ablauf je
 *  Tag (Task.tagesArbeit) — Bauteile, Mengen usw. bleiben, wie sie jetzt sind. */
export function optimierungUebernehmen(aktuell: Task[], ergebnis: Task[]): Task[] {
  const neuById = new Map(ergebnis.map(t => [t.id, t]));
  return aktuell.map(t => {
    const n = neuById.get(t.id);
    if (!n || n === t) return t;
    return { ...t, start: n.start, end: n.end, startZeit: n.startZeit, endZeit: n.endZeit,
      predecessorId: n.predecessorId, lagDays: n.lagDays, weitereVorgaenger: n.weitereVorgaenger, optimierung: n.optimierung, tagesArbeit: n.tagesArbeit };
  });
}

/** Kurze Signatur aller Termine (und Vorgänger) — nach "Auslastung optimieren" in SimProjekt.optimiertStand gemerkt: solange sie
 *  gleich bleibt, sind Abweichungen zur berechneten Dauer gewollt (Verstärkung, Wartezeiten, Raster) und werden nicht gemeldet. */
export function terminSignatur(tasks: Task[]): string {
  let h = 5381;
  for (const t of tasks) {
    const text = `${t.id}|${t.start}|${t.end}|${t.startZeit ?? ""}|${t.endZeit ?? ""}|${vorgaengerListe(t).map(v => v.id + ":" + v.lagDays).join(",")};`;
    for (let i = 0; i < text.length; i++) h = ((h * 33) ^ text.charCodeAt(i)) >>> 0;
  }
  return `${tasks.length}-${h.toString(36)}`;
}

/** Tasks, deren Termine sich mit optimiereAuslastung() ändern würden. */
export function auslastungAbweichendeTasks(tasks: Task[], stammdaten: Stammdaten, kalender: Kalender, einheit: Zeiteinheit = "tage", kraene: Kran[] = []): Task[] {
  // nur Termine vergleichen — ergänzte Vorgänger allein sind keine Abweichung
  const neu = optimiereAuslastung(tasks, stammdaten, kalender, einheit, kraene);
  return tasks.filter((t, i) => neu[i].start !== t.start || neu[i].end !== t.end || neu[i].startZeit !== t.startZeit || neu[i].endZeit !== t.endZeit);
}
