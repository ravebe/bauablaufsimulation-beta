// kapazitaetsCheckHelpers.ts — Bedarfs-/Angebots-Berechnung für den Kapazitäts-Check (Tab AVOR,
// KapazitaetsCheckManager.tsx). Phasen werden über das freie Textfeld Task.kranbereich gebildet
// (dieselbe Gruppierung wie in kranauslastung() aus avorHelpers.ts).
//
// Kernidee: menge × leistungswertHProEinheit sind bereits Personenstunden — siehe dauerGewerk() in
// stammdatenHelpers.ts, wo genau diese Grösse durch (arbeitszeitStdProTag × rate.anzahlPersonen)
// geteilt wird, um eine Dauer in Tagen zu erhalten. Hier wird dieselbe Personenstunden-Grösse über
// alle Tasks eines Kranbereichs aufsummiert und stattdessen gegen ein frei eingegebenes
// Personal-Budget der Phase gestellt (statt gegen rate.anzahlPersonen).
import type { Task, Kran, Zeitraster } from "../types";
import { parseDateUniversal } from "../types";
import type { Kalender } from "./kalenderHelpers";
import { arbeitstageZwischen, istArbeitstag } from "./kalenderHelpers";
import type { Stammdaten } from "./stammdatenHelpers";
import { rateFuerKuerzel, istMengeKranpflichtig } from "./stammdatenHelpers";
import { kranauslastung } from "./avorHelpers";
import type { ZeitrasterBucket } from "./kranHelpers";
import { zeitrasterBuckets, kranVerfuegbareArbeitstage, kranAnteil } from "./kranHelpers";

function toIso(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

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

// === Kran-Personal-Bilanz (grob, siehe kranHelpers.ts für die analoge Kranstunden-Bilanz in der
// Kranoptik) — nutzt ausschliesslich die strukturierte Kran-Zuordnung (Task.kraene) statt des freien
// Kranbereich-Texts, damit hier kein zweites Kran-Datenmodell entsteht. Immer anhand der echten
// Task-Termine (kein Sandbox-Äquivalent — Kran-Zuweisung/Verfügbarkeit sind inhärent terminbasiert). */
export const MAX_PERSONEN_PRO_KRAN = 13;

export interface KranPersonalSerie { kranId: string; kranName: string; personenstunden: number[]; arbeitstageVerfuegbar: number[] }

/** Personenstunden-Bedarf (Menge × Leistungswert kranpflichtiger Gewerke) je Kran und Zeitraster-Bucket
 *  — gleichmässig über die Arbeitstage jedes Tasks verteilt und bei mehreren zugeordneten Kränen
 *  anteilig aufgeteilt (kranAnteil, 0.5/0.33…). Grundlage für personalRichtwertJeBucket(). */
export function personenstundenProKranUndBucket(tasks: Task[], kraene: Kran[], stammdaten: Stammdaten, kalender: Kalender, raster: Zeitraster): { buckets: ZeitrasterBucket[]; serien: KranPersonalSerie[] } {
  const buckets = zeitrasterBuckets(tasks, raster);
  if (buckets.length === 0 || kraene.length === 0) return { buckets, serien: [] };

  const serien: KranPersonalSerie[] = kraene.map(k => ({
    kranId: k.id, kranName: k.name,
    personenstunden: new Array(buckets.length).fill(0),
    arbeitstageVerfuegbar: buckets.map(b => kranVerfuegbareArbeitstage(k, b, kalender)),
  }));
  const serieByKranId = new Map(serien.map(s => [s.kranId, s]));
  const bucketIndexFuer = (iso: string) => buckets.findIndex(b => iso >= b.start && iso <= b.end);

  for (const t of tasks) {
    if (t.isGroup || !t.kraene || t.kraene.length === 0 || !t.bauteilKuerzel || !t.mengen) continue;
    let taskPersonenstunden = 0;
    for (const gewerk of stammdaten.gewerke) {
      const menge = t.mengen[gewerk.key];
      if (!menge || !istMengeKranpflichtig(stammdaten, gewerk.key, t.bauteilKuerzel)) continue;
      const rate = rateFuerKuerzel(gewerk, t.bauteilKuerzel);
      if (!rate?.leistungswertHProEinheit) continue;
      taskPersonenstunden += menge * rate.leistungswertHProEinheit;
    }
    if (taskPersonenstunden <= 0) continue;
    const beteiligteSerien = t.kraene.map(id => serieByKranId.get(id)).filter((s): s is KranPersonalSerie => !!s);
    if (beteiligteSerien.length === 0) continue;
    const anteil = kranAnteil(t.kraene.length);

    const arbeitstageDesTasks = arbeitstageZwischen(t.start, t.end, kalender);
    const proArbeitstag = taskPersonenstunden / arbeitstageDesTasks;

    const start = parseDateUniversal(t.start), end = parseDateUniversal(t.end);
    if (!start || !end) continue;
    const cur = new Date(start.getTime());
    while (cur.getTime() <= end.getTime()) {
      const iso = toIso(cur);
      if (istArbeitstag(iso, kalender)) {
        const bi = bucketIndexFuer(iso);
        if (bi !== -1) for (const s of beteiligteSerien) s.personenstunden[bi] += proArbeitstag * anteil;
      }
      cur.setDate(cur.getDate() + 1);
    }
  }
  return { buckets, serien };
}

export interface KranPersonalRichtwert {
  richtwert: number | null; // gerundet, keine Nachkommastellen; null = keine sinnvolle Aussage (Kran nicht verfügbar)
  engpass: boolean; // über maxPersonenProKran ODER Kran im Bucket nicht verfügbar trotz Bedarf
  kranNichtVerfuegbar: boolean;
}

/** Ordnet den Personenstunden-Bedarf eines Kran/Bucket-Paars grob in einen Personal-Richtwert ein
 *  ("ungefährer Personalbedarf") — reine Ampel, keine exakte Personalrechnung. Ohne verfügbaren Kran
 *  im Bucket ist der Bedarf per Definition ungedeckt, unabhängig vom Personal. */
export function personalRichtwertJeBucket(personenstunden: number, arbeitstageVerfuegbar: number, arbeitszeitStdProTag: number, maxPersonenProKran: number = MAX_PERSONEN_PRO_KRAN): KranPersonalRichtwert {
  if (arbeitstageVerfuegbar <= 0 || arbeitszeitStdProTag <= 0) {
    return { richtwert: null, engpass: personenstunden > 0, kranNichtVerfuegbar: personenstunden > 0 };
  }
  const richtwert = Math.round(personenstunden / (arbeitszeitStdProTag * arbeitstageVerfuegbar));
  return { richtwert, engpass: richtwert > maxPersonenProKran, kranNichtVerfuegbar: false };
}
