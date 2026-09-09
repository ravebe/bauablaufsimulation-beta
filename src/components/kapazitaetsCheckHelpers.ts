// kapazitaetsCheckHelpers.ts — Bedarfs-/Angebots-Berechnung für den Kapazitäts-Check (Tab AVOR,
// KapazitaetsCheckManager.tsx). Phasen werden über das freie Textfeld Task.kranbereich gebildet
// (dieselbe Gruppierung wie in kranauslastung() aus avorHelpers.ts).
//
// Kernidee: menge × leistungswertHProEinheit sind bereits Personenstunden — siehe dauerGewerk() in
// stammdatenHelpers.ts, wo genau diese Grösse durch (arbeitszeitStdProTag × rate.anzahlPersonen)
// geteilt wird, um eine Dauer in Tagen zu erhalten. Hier wird dieselbe Personenstunden-Grösse über
// alle Tasks eines Kranbereichs aufsummiert und stattdessen gegen ein frei eingegebenes
// Personal-Budget der Phase gestellt (statt gegen rate.anzahlPersonen).
import type { Task } from "../types";
import { parseDateUniversal } from "../types";
import type { Kalender } from "./kalenderHelpers";
import { arbeitstageZwischen } from "./kalenderHelpers";
import type { Stammdaten } from "./stammdatenHelpers";
import { rateFuerKuerzel, istMengeKranpflichtig } from "./stammdatenHelpers";
import { kranauslastung } from "./avorHelpers";

/** Kranbereich-Schlüssel eines Tasks — leeres/fehlendes Feld landet im "unbekannt"-Sammeltopf,
 *  analog zu kranauslastung() in avorHelpers.ts. */
export function kranbereichVonTask(t: Task): string {
  return t.kranbereich?.trim() || "unbekannt";
}

/** Personenstunden-Bedarf je Kranbereich: Σ menge × leistungswertHProEinheit über alle Gewerke mit
 *  hinterlegter Menge, für alle nicht-Gruppen-Tasks mit Bauteil-Kürzel. */
export function personenstundenBedarfProKranbereich(tasks: Task[], stammdaten: Stammdaten): Map<string, number> {
  const ergebnis = new Map<string, number>();
  for (const t of tasks) {
    if (t.isGroup || !t.bauteilKuerzel || !t.mengen) continue;
    const bereich = kranbereichVonTask(t);
    let summe = ergebnis.get(bereich) ?? 0;
    for (const gewerk of stammdaten.gewerke) {
      const menge = t.mengen[gewerk.key];
      if (!menge) continue;
      const rate = rateFuerKuerzel(gewerk, t.bauteilKuerzel);
      if (!rate?.leistungswertHProEinheit) continue;
      summe += menge * rate.leistungswertHProEinheit;
    }
    ergebnis.set(bereich, summe);
  }
  return ergebnis;
}

/** Zeitraum (min Start / max Ende) je Kranbereich — Grundlage für die Arbeitstage-Anzahl im
 *  Gantt-Modus (echte Termine statt frei eingegebener Sandbox-Dauer). */
export function zeitraumProKranbereich(tasks: Task[]): Map<string, { start: string; end: string }> {
  const ergebnis = new Map<string, { start: string; end: string }>();
  for (const t of tasks) {
    if (t.isGroup || !t.bauteilKuerzel || !t.mengen) continue;
    const s = parseDateUniversal(t.start), e = parseDateUniversal(t.end);
    if (!s || !e) continue;
    const bereich = kranbereichVonTask(t);
    const bestehend = ergebnis.get(bereich);
    if (!bestehend) { ergebnis.set(bereich, { start: t.start, end: t.end }); continue; }
    if (t.start < bestehend.start) bestehend.start = t.start;
    if (t.end > bestehend.end) bestehend.end = t.end;
  }
  return ergebnis;
}

/** Kran-Spitzenbedarf je Kranbereich im Gantt-Modus: höchste Anzahl gleichzeitig aktiver
 *  kranpflichtiger Tasks an einem Tag (Tages-Maximum aus der bestehenden kranauslastung()). */
export function kranSpitzenbedarfProKranbereich(tasks: Task[], stammdaten: Stammdaten, kalender: Kalender): Map<string, number> {
  const tagWerte = kranauslastung(tasks, stammdaten, kalender);
  const ergebnis = new Map<string, number>();
  for (const tw of tagWerte) {
    for (const [bereich, wert] of Object.entries(tw.werte)) {
      ergebnis.set(bereich, Math.max(ergebnis.get(bereich) ?? 0, wert));
    }
  }
  return ergebnis;
}

/** Sandbox-Fallback ohne Termine: reine Anzahl kranpflichtiger Tasks je Kranbereich, ohne Aussage
 *  über tatsächliche Gleichzeitigkeit (die gibt es ohne Termine nicht). */
export function kranpflichtigeTaskAnzahlProKranbereich(tasks: Task[], stammdaten: Stammdaten): Map<string, number> {
  const ergebnis = new Map<string, number>();
  for (const t of tasks) {
    if (t.isGroup || !t.bauteilKuerzel || !t.mengen) continue;
    const hatKranGewerk = Object.keys(t.mengen).some(k => t.mengen![k] > 0 && istMengeKranpflichtig(stammdaten, k, t.bauteilKuerzel));
    if (!hatKranGewerk) continue;
    const bereich = kranbereichVonTask(t);
    ergebnis.set(bereich, (ergebnis.get(bereich) ?? 0) + 1);
  }
  return ergebnis;
}

export interface PhasenAuswertung {
  arbeitstage: number;
  bedarfPersonenstunden: number;
  angebotPersonenstunden: number;
  deckung: "ok" | "fehlend";
  fehlendePersonen: number; // 0 wenn deckung "ok"
}

/** Vergleicht Bedarf (Personenstunden aus Menge×Leistungswert) gegen Angebot (Personen × Arbeitszeit
 *  × Arbeitstage) einer Phase. arbeitstage kommt je nach Modus entweder aus dem echten Kranbereich-
 *  Zeitraum (arbeitstageZwischen) oder aus der frei eingegebenen Sandbox-Dauer. */
export function auswertungPhase(anzahlPersonen: number, bedarfPersonenstunden: number, arbeitszeitStdProTag: number, arbeitstage: number): PhasenAuswertung {
  const angebotPersonenstunden = anzahlPersonen * arbeitszeitStdProTag * arbeitstage;
  const deckung: "ok" | "fehlend" = angebotPersonenstunden >= bedarfPersonenstunden ? "ok" : "fehlend";
  const fehlendePersonen = deckung === "ok" || arbeitszeitStdProTag <= 0 || arbeitstage <= 0
    ? 0
    : Math.ceil((bedarfPersonenstunden - angebotPersonenstunden) / (arbeitszeitStdProTag * arbeitstage));
  return { arbeitstage, bedarfPersonenstunden, angebotPersonenstunden, deckung, fehlendePersonen };
}

/** Arbeitstage einer Phase im Gantt-Modus aus ihrem echten Kranbereich-Zeitraum. */
export function arbeitstageGanttModus(bereich: string, zeitraeume: Map<string, { start: string; end: string }>, kalender: Kalender): number {
  const z = zeitraeume.get(bereich);
  return z ? arbeitstageZwischen(z.start, z.end, kalender) : 0;
}
