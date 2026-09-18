// kranHelpers.ts — Kran-Stammdaten (SimProjekt.kraene) und Zeitraster-Buckets (Monat/Woche) für die
// Kran-Verfügbarkeitsmatrix (Tab AVOR) sowie — ab Etappe 3 — die Kranoptik/Kapazitäts-Check-Auswertung.
// Reine Funktionen, kein UI. Verfügbarkeit ist bewusst grob: ein zusammenhängender von/bis-Zeitraum je
// Kran, keine Perioden-Liste (siehe Kran in types.ts).
import type { Task, Kran, Zeitraster } from "../types";
import { parseDateUniversal } from "../types";
import type { Kalender } from "./kalenderHelpers";
import { istArbeitstag, getKW } from "./kalenderHelpers";
import { projektzeitraum } from "./avorHelpers";
import type { Stammdaten } from "./stammdatenHelpers";
import { istMengeKranpflichtig } from "./stammdatenHelpers";

function toIso(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export interface ZeitrasterBucket { key: string; label: string; start: string; end: string }

/** Teilt den Projektzeitraum (min/max Task-Termine) in Monats- oder Wochen-Buckets — Spalten der
 *  Kran-Verfügbarkeitsmatrix und, ab Etappe 3, der Kranoptik-Zeitreihe. Leer, wenn keine Tasks mit
 *  Terminen vorhanden sind. */
export function zeitrasterBuckets(tasks: Task[], raster: Zeitraster): ZeitrasterBucket[] {
  const zeitraum = projektzeitraum(tasks);
  if (!zeitraum) return [];
  const buckets: ZeitrasterBucket[] = [];

  if (raster === "woche") {
    const montagVon = (d: Date) => { const x = new Date(d.getFullYear(), d.getMonth(), d.getDate()); const dow = (x.getDay() + 6) % 7; x.setDate(x.getDate() - dow); return x; };
    const cur = montagVon(zeitraum.start);
    const endWoche = montagVon(zeitraum.end);
    while (cur.getTime() <= endWoche.getTime()) {
      const start = new Date(cur);
      const end = new Date(cur); end.setDate(end.getDate() + 6);
      buckets.push({ key: toIso(start), label: `KW${getKW(start)}`, start: toIso(start), end: toIso(end) });
      cur.setDate(cur.getDate() + 7);
    }
    return buckets;
  }

  const cur = new Date(zeitraum.start.getFullYear(), zeitraum.start.getMonth(), 1);
  const endMonat = new Date(zeitraum.end.getFullYear(), zeitraum.end.getMonth(), 1);
  while (cur.getTime() <= endMonat.getTime()) {
    const start = new Date(cur.getFullYear(), cur.getMonth(), 1);
    const end = new Date(cur.getFullYear(), cur.getMonth() + 1, 0);
    buckets.push({
      key: `${cur.getFullYear()}-${String(cur.getMonth() + 1).padStart(2, "0")}`,
      label: start.toLocaleDateString("de-CH", { month: "short", year: "2-digit" }),
      start: toIso(start), end: toIso(end),
    });
    cur.setMonth(cur.getMonth() + 1);
  }
  return buckets;
}

/** Überlappt der Verfügbarkeitszeitraum des Krans mit diesem Bucket? (grob, für die Matrix-Anzeige —
 *  ohne Rücksicht auf Wochenenden/Feiertage innerhalb des Buckets, siehe kranVerfuegbareArbeitstage). */
export function kranAktivInBucket(kran: Kran, bucket: { start: string; end: string }): boolean {
  const von = kran.verfuegbarVon ?? "0000-01-01";
  const bis = kran.verfuegbarBis ?? "9999-12-31";
  return von <= bucket.end && bis >= bucket.start;
}

/** Ist der Kran an diesem einzelnen Kalendertag verfügbar? */
export function istKranVerfuegbarAn(kran: Kran, iso: string): boolean {
  if (kran.verfuegbarVon && iso < kran.verfuegbarVon) return false;
  if (kran.verfuegbarBis && iso > kran.verfuegbarBis) return false;
  return true;
}

/** Arbeitstage eines Zeitraums, ohne Mindestwert 1 (anders als arbeitstageZwischen() in
 *  kalenderHelpers.ts, die für Task-Dauern nie 0 liefern darf) — hier ist 0 ein gültiges, wichtiges
 *  Ergebnis (Kran in diesem Bucket nicht verfügbar → keine Kapazität). */
function arbeitstageInBereich(start: string, end: string, kalender: Kalender): number {
  if (start > end) return 0;
  const s = parseDateUniversal(start), e = parseDateUniversal(end);
  if (!s || !e) return 0;
  let count = 0;
  const cur = new Date(s.getTime());
  while (cur.getTime() <= e.getTime()) {
    if (istArbeitstag(toIso(cur), kalender)) count++;
    cur.setDate(cur.getDate() + 1);
  }
  return count;
}

/** Verfügbare Arbeitstage eines Krans innerhalb eines Buckets (Verfügbarkeitszeitraum auf den Bucket
 *  geclippt) — Grundlage für die Kran-Kapazität in Kranoptik/Kapazitäts-Check (Etappe 3/4). */
export function kranVerfuegbareArbeitstage(kran: Kran, bucket: { start: string; end: string }, kalender: Kalender): number {
  const start = kran.verfuegbarVon && kran.verfuegbarVon > bucket.start ? kran.verfuegbarVon : bucket.start;
  const end = kran.verfuegbarBis && kran.verfuegbarBis < bucket.end ? kran.verfuegbarBis : bucket.end;
  return arbeitstageInBereich(start, end, kalender);
}

/** Neuen Kran mit fortlaufendem Namen ("Kran 1", "Kran 2", …) anlegen. */
export function neuerKran(bestehende: Kran[]): Kran {
  let n = bestehende.length + 1;
  const namen = new Set(bestehende.map(k => k.name));
  while (namen.has(`Kran ${n}`)) n++;
  return { id: crypto.randomUUID(), name: `Kran ${n}` };
}

/** Anteilsfaktor eines Tasks an EINEM seiner zugeordneten Kräne — bei mehreren Kränen (Schnittstellen-
 *  Task zwischen zwei Kränen) IMMER automatisch gleichmässig verteilt (2→0.5, 3→0.33…), siehe
 *  Task.kraene in types.ts. Nie manuell einstellbar (Scheingenauigkeit vermeiden). */
export function kranAnteil(anzahlKraeneAmTask: number): number {
  return anzahlKraeneAmTask > 0 ? 1 / anzahlKraeneAmTask : 0;
}

/** Entfernt einen gelöschten Kran aus allen Task-Zuordnungen (Datenintegrität, siehe kranEntfernen()
 *  in KranVerfuegbarkeitManager.tsx) — leert Task.kraene vollständig, wenn dies der letzte zugeordnete
 *  Kran war, damit keine toten IDs zurückbleiben. */
export function kranAusTasksEntfernen(tasks: Task[], kranId: string): Task[] {
  return tasks.map(t => {
    if (!t.kraene?.includes(kranId)) return t;
    const neu = t.kraene.filter(id => id !== kranId);
    return { ...t, kraene: neu.length > 0 ? neu : undefined };
  });
}

export interface KranstundenSerie { kranId: string; kranName: string; bedarf: number[]; kapazitaet: number[] }

/** Geplante Kranstunden je Kran und Zeitraster-Bucket (Monat/Woche) gegen die aus der Verfügbarkeit
 *  abgeleitete Kapazität — Grundlage der Kranoptik (Tab AVOR). Bedarf: für jeden Arbeitstag eines
 *  kranpflichtigen Tasks (mind. ein Gewerk mit Menge > 0 als kranpflichtig markiert) gilt der Kran mit
 *  vollem arbeitszeitStdProTag als beansprucht, bei mehreren zugeordneten Kränen anteilig gleichmässig
 *  verteilt (kranAnteil — 0.5/0.33…). Bewusst grob (Plausibilisierung), keine Stunden-genaue Einsatzplanung. */
export function kranstundenProKranUndBucket(tasks: Task[], kraene: Kran[], stammdaten: Stammdaten, kalender: Kalender, raster: Zeitraster): { buckets: ZeitrasterBucket[]; serien: KranstundenSerie[] } {
  const buckets = zeitrasterBuckets(tasks, raster);
  if (buckets.length === 0 || kraene.length === 0) return { buckets, serien: [] };

  const serien: KranstundenSerie[] = kraene.map(k => ({
    kranId: k.id, kranName: k.name,
    bedarf: new Array(buckets.length).fill(0),
    kapazitaet: buckets.map(b => kranVerfuegbareArbeitstage(k, b, kalender) * stammdaten.arbeitszeitStdProTag),
  }));
  const serieByKranId = new Map(serien.map(s => [s.kranId, s]));
  const bucketIndexFuer = (iso: string) => buckets.findIndex(b => iso >= b.start && iso <= b.end);

  for (const t of tasks) {
    if (t.isGroup || !t.kraene || t.kraene.length === 0 || !t.mengen) continue;
    const hatKranGewerk = Object.keys(t.mengen).some(k => (t.mengen![k] ?? 0) > 0 && istMengeKranpflichtig(stammdaten, k, t.bauteilKuerzel));
    if (!hatKranGewerk) continue;
    const beteiligteSerien = t.kraene.map(id => serieByKranId.get(id)).filter((s): s is KranstundenSerie => !!s);
    if (beteiligteSerien.length === 0) continue;
    const anteil = kranAnteil(t.kraene.length);

    const start = parseDateUniversal(t.start), end = parseDateUniversal(t.end);
    if (!start || !end) continue;
    const cur = new Date(start.getTime());
    while (cur.getTime() <= end.getTime()) {
      const iso = toIso(cur);
      if (istArbeitstag(iso, kalender)) {
        const bi = bucketIndexFuer(iso);
        if (bi !== -1) for (const s of beteiligteSerien) s.bedarf[bi] += stammdaten.arbeitszeitStdProTag * anteil;
      }
      cur.setDate(cur.getDate() + 1);
    }
  }
  return { buckets, serien };
}
