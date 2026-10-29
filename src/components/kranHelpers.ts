// kranHelpers.ts — Kran-Stammdaten (SimProjekt.kraene) und Zeitraster-Buckets (Monat/Woche) für die
// Kranoptik (Tab AVOR), dazu Kranpersonal je Tag (Tab Ressourcen → Kräne & Personal) für Perfekte Auslastung und Optimierung.
// Reine Funktionen, kein UI. Verfügbarkeit ist bewusst grob: ein zusammenhängender von/bis-Zeitraum je
// Kran, keine Perioden-Liste (siehe Kran in types.ts).
import type { Task, Kran, Zeitraster } from "../types";
import { parseDateUniversal } from "../types";
import type { Kalender } from "./kalenderHelpers";
import { istArbeitstag, getKW } from "./kalenderHelpers";
import { projektzeitraum, kranstundenJeTagFuerTask, aufwandJeTagUndPhaseFuerTask, personalauslastung } from "./avorHelpers";
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
 *  geclippt) — Grundlage für die Kran-Kapazität in der Kranoptik. */
export function kranVerfuegbareArbeitstage(kran: Kran, bucket: { start: string; end: string }, kalender: Kalender): number {
  const start = kran.verfuegbarVon && kran.verfuegbarVon > bucket.start ? kran.verfuegbarVon : bucket.start;
  const end = kran.verfuegbarBis && kran.verfuegbarBis < bucket.end ? kran.verfuegbarBis : bucket.end;
  return arbeitstageInBereich(start, end, kalender);
}

/** Richtwert: so viele Personen kann ein Kran etwa versorgen — nur als Hinweis in Tab Ressourcen, keine Grenze in der Rechnung
 *  (die Grenze ist das erfasste Personal unter dem Kran, siehe kranPersonalTotalAmTag). */
export const RICHTWERT_PERSONEN_PRO_KRAN = 13;

/** Personal je Unternehmer unter dem Kran an diesem Tag (Tab Ressourcen → Kräne & Personal) — leer, wenn der Kran nicht
 *  verfügbar ist. Mehrere Zeilen desselben Unternehmers, die sich überschneiden, addieren sich. */
export function kranPersonalAmTag(kran: Kran, iso: string): Map<string, number> {
  const jeUnternehmer = new Map<string, number>();
  if (!istKranVerfuegbarAn(kran, iso)) return jeUnternehmer;
  for (const p of kran.personal ?? []) {
    const name = p.unternehmer.trim();
    if (!name || !(p.personen > 0)) continue;
    if ((p.von && iso < p.von) || (p.bis && iso > p.bis)) continue;
    jeUnternehmer.set(name, (jeUnternehmer.get(name) ?? 0) + p.personen);
  }
  return jeUnternehmer;
}

/** Personal unter dem Kran an diesem Tag = Summe seiner Unternehmer (0, wenn nicht verfügbar) — zugleich die Höchstzahl der
 *  Leute an kranpflichtigen Arbeiten dieses Krans. */
export function kranPersonalTotalAmTag(kran: Kran, iso: string): number {
  let summe = 0;
  for (const v of kranPersonalAmTag(kran, iso).values()) summe += v;
  return summe;
}

/** Grösstes Tagespersonal unter dem Kran in einem Zeitraum (Kalendertage, z.B. Monat/Woche der Kranoptik). */
export function kranPersonalMaxImBereich(kran: Kran, start: string, end: string): number {
  let max = 0;
  const s = parseDateUniversal(start), e = parseDateUniversal(end);
  if (!s || !e) return 0;
  for (const cur = new Date(s.getTime()); cur.getTime() <= e.getTime(); cur.setDate(cur.getDate() + 1)) max = Math.max(max, kranPersonalTotalAmTag(kran, toIso(cur)));
  return max;
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
 *  abgeleitete Kapazität — Grundlage der Kranoptik (Tab AVOR). Bedarf je Task: Aufwand der kranpflichtigen
 *  Gewerke ÷ Kolonne (Einsatzzeit der Kolonne laut Leistungswert, siehe kranstundenJeTagFuerTask in
 *  avorHelpers.ts), bei mehreren zugeordneten Kränen anteilig gleichmässig verteilt (kranAnteil — 0.5/0.33…). */
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
    const kranIds = kraeneDesTasks(t, kraene);
    if (t.isGroup || kranIds.length === 0 || !t.mengen) continue;
    const hatKranGewerk = Object.keys(t.mengen).some(k => (t.mengen![k] ?? 0) > 0 && istMengeKranpflichtig(stammdaten, k, t.bauteilKuerzel));
    if (!hatKranGewerk) continue;
    const beteiligteSerien = kranIds.map(id => serieByKranId.get(id)).filter((s): s is KranstundenSerie => !!s);
    if (beteiligteSerien.length === 0) continue;
    const anteil = kranAnteil(kranIds.length);

    for (const [iso, stunden] of kranstundenJeTagFuerTask(t, stammdaten, kalender)) {
      const bi = bucketIndexFuer(iso);
      if (bi !== -1) for (const s of beteiligteSerien) s.bedarf[bi] += stunden * anteil;
    }
  }
  return { buckets, serien };
}

/** Kräne eines Tasks: die in Tab Kalkulation (Spalte Kräne) zugewiesenen — gibt es nur einen Kran, gelten Tasks ohne Zuweisung
 *  automatisch als Tasks dieses Krans. */
export function kraeneDesTasks(t: Task, kraene: Kran[]): string[] {
  const zugewiesen = (t.kraene ?? []).filter(id => kraene.some(k => k.id === id));
  if (zugewiesen.length > 0) return zugewiesen;
  return kraene.length === 1 ? [kraene[0].id] : [];
}

/** Leistungsposition eines Tages, die nicht aus einem Kran-Pool besetzt wird, mit Grund (Anzeige in Tab AVOR). */
export interface OhnePool { position: string; label: string; kolonne: number; grund: string; unterKran: boolean }
export interface EingeplantTag { kranPersonal: number; kolonnen: number; total: number; ohnePool: OhnePool[] }

/** Eingeplantes Personal je Tag (Linie "Perfekte Auslastung" und Total "Eingeplant" in Tab AVOR):
 *  - Kranpersonal: je an diesem Tag verfügbaren Kran das Personal seiner Unternehmer (Tab Ressourcen → Kräne & Personal) plus die
 *    Kolonnen kranpflichtiger Positionen an Tasks dieses Krans, die nicht aus seinem Pool kommen (Unternehmer ohne Personal unter
 *    dem Kran) — zusammen höchstens das Personal des Krans, wie in "Auslastung optimieren". Auch an Tagen ohne Arbeit, damit nicht
 *    ausgelastetes Personal sichtbar wird.
 *  - Kolonnen ohne Kran: nicht kranpflichtige Positionen und Tasks ohne Kran (bei nur einem Kran gelten alle Tasks als seine) —
 *    ihre Kolonne aus Tab Ressourcen, je Position und Tag einmal.
 *  ohnePool nennt je Tag die Positionen, die nicht aus einem Kran-Pool besetzt werden, mit Grund. */
export function eingeplantesPersonalJeTag(tasks: Task[], kraene: Kran[], stammdaten: Stammdaten, kalender: Kalender, tage: string[]): Map<string, EingeplantTag> {
  const kranById = new Map(kraene.map(k => [k.id, k]));
  const gewerkLabel = new Map(stammdaten.gewerke.map(g => [g.key, g.label]));
  const ausserhalbJeTag = new Map<string, Map<string, number>>(); // Tag → Leistungsposition → Kolonne (ohne Kran)
  const unterKranJeTag = new Map<string, Map<string, Map<string, number>>>(); // Tag → Kran → Leistungsposition → Kolonne
  const ohnePoolJeTag = new Map<string, Map<string, OhnePool>>();
  for (const t of tasks) {
    const kranIds = kraeneDesTasks(t, kraene);
    for (const [iso, liste] of aufwandJeTagUndPhaseFuerTask(t, stammdaten, kalender)) {
      for (const a of liste) {
        if (!(a.personenstunden > 1e-9)) continue;
        const kraeneHeute = a.phase.kranpflichtig ? kranIds.filter(id => istKranVerfuegbarAn(kranById.get(id)!, iso)) : [];
        if (kraeneHeute.some(id => (kranPersonalAmTag(kranById.get(id)!, iso).get(a.phase.unternehmer) ?? 0) > 0)) continue; // aus dem Pool
        const grund = !a.phase.kranpflichtig ? "nicht kranpflichtig"
          : kranIds.length === 0 ? "Task ohne Kran (Tab Kalkulation → Kräne)"
          : kraeneHeute.length === 0 ? "Kran an diesem Tag nicht verfügbar"
          : !a.phase.unternehmer ? "kein Unternehmer bei der Leistungsposition (Tab Ressourcen)"
          : `${a.phase.unternehmer} hat kein Personal unter dem Kran`;
        const kuerzel = a.phase.position.split("::")[1] ?? "";
        const ohne = ohnePoolJeTag.get(iso) ?? new Map<string, OhnePool>();
        ohne.set(a.phase.position, { position: a.phase.position, label: `${gewerkLabel.get(a.phase.gewerkKey) ?? a.phase.gewerkKey} · ${kuerzel}`,
          kolonne: a.phase.kolonne, grund, unterKran: kraeneHeute.length > 0 });
        ohnePoolJeTag.set(iso, ohne);
        if (kraeneHeute.length > 0) {
          const jeKran = unterKranJeTag.get(iso) ?? new Map<string, Map<string, number>>();
          const jePos = jeKran.get(kraeneHeute[0]) ?? new Map<string, number>();
          jePos.set(a.phase.position, a.phase.kolonne);
          jeKran.set(kraeneHeute[0], jePos);
          unterKranJeTag.set(iso, jeKran);
        } else {
          const jePos = ausserhalbJeTag.get(iso) ?? new Map<string, number>();
          jePos.set(a.phase.position, a.phase.kolonne);
          ausserhalbJeTag.set(iso, jePos);
        }
      }
    }
  }
  const summe = (m: Map<string, number> | undefined) => [...(m?.values() ?? [])].reduce((s, v) => s + v, 0);
  const ergebnis = new Map<string, EingeplantTag>();
  for (const iso of tage) {
    let kranPersonal = 0;
    if (istArbeitstag(iso, kalender)) for (const k of kraene) {
      if (!istKranVerfuegbarAn(k, iso)) continue;
      // Personal unter dem Kran ist die Grenze; Min. Personen ohne Pool an seinen Tasks zählen darin (ohne Personal: keine Grenze)
      const pool = kranPersonalTotalAmTag(k, iso);
      kranPersonal += pool > 0 ? pool : summe(unterKranJeTag.get(iso)?.get(k.id));
    }
    const kolonnen = summe(ausserhalbJeTag.get(iso));
    ergebnis.set(iso, { kranPersonal, kolonnen, total: kranPersonal + kolonnen, ohnePool: [...(ohnePoolJeTag.get(iso)?.values() ?? [])] });
  }
  return ergebnis;
}

/** true, sobald bei irgendeinem Kran Personal erfasst ist. */
export function hatKranPersonal(kraene: Kran[]): boolean {
  return kraene.some(k => (k.personal ?? []).some(p => p.unternehmer.trim() && p.personen > 0));
}

/** Ø Auslastung des eingeplanten Personals über das ganze Bauprogramm (Vorschau "Auslastung optimieren"): Arbeit aller Tage
 *  (Personenstunden) ÷ (eingeplantes Personal × Std./Tag), nur Arbeitstage mit eingeplantem Personal. null ohne Personal. */
export function durchschnittlicheAuslastung(tasks: Task[], kraene: Kran[], stammdaten: Stammdaten, kalender: Kalender): number | null {
  const personal = personalauslastung(tasks, stammdaten, kalender);
  const eingeplant = eingeplantesPersonalJeTag(tasks, kraene, stammdaten, kalender, personal.map(p => p.tag));
  let arbeit = 0, kapazitaet = 0;
  for (const tw of personal) {
    const e = eingeplant.get(tw.tag)?.total ?? 0;
    if (!(e > 0)) continue;
    arbeit += Object.values(tw.werte).reduce((s, v) => s + v, 0);
    kapazitaet += e;
  }
  return kapazitaet > 0 ? arbeit / kapazitaet : null;
}
