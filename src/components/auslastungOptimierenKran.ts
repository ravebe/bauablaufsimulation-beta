// auslastungOptimierenKran.ts — "Auslastung optimieren" mit Kranpersonal (Tab Ressourcen → Kräne & Personal): plant die Tasks so,
// dass das Personal unter jedem Kran möglichst voll arbeitet und das Bauprogramm dadurch möglichst kurz wird.
//  - Ressourcen je Arbeitstag: je verfügbarem Kran ein Pool je Unternehmer (Personal laut Kräne & Personal) und die Obergrenze
//    Summe dieses Personals als Höchstzahl für alle Leute an kranpflichtigen Positionen (höchstens MAX_UEBERZUG mehr, wenn
//    sonst Leute untätig wären). Leute desselben Unternehmers sind Allrounder: sie
//    besetzen jede Leistungsposition dieses Unternehmers (Rate.unternehmer) an Tasks dieses Krans (Task.kraene; bei nur einem Kran
//    gelten Tasks ohne Zuweisung als seine, siehe kraeneDesTasks).
//  - Positionen ohne Kran-Pool (nicht kranpflichtig, Task ohne Kran, Unternehmer ohne Personal unter dem Kran) arbeiten wie bisher
//    mit ihrer Kolonne, eine Kolonne nie an zwei Tasks gleichzeitig; kranpflichtige zählen trotzdem zum Personal des Krans.
//  - Je Task gilt der Arbeitsablauf je Kürzel (schritteFuerTask): Schritte nacheinander, Phasen eines Schritts gleichzeitig.
//    Eine Phase arbeitet mit mindestens ihrer Kolonne (bzw. dem ganzen Pool, wenn er kleiner ist) und wird mit freien Leuten
//    desselben Unternehmers bis auf MAX_VERSTAERKUNG × Kolonne verstärkt — sie wird dadurch kürzer.
//  - Vergabe je Zeitschritt (½ Stunde): zuerst laufende Tasks (Mindestbesetzung), dann neue Tasks nach kritischem Pfad (längste
//    Restkette über die Nachfolger zuerst), zuletzt Verstärkung laufender Phasen mit dem übrigen Personal.
//  - Vorgänger und Wartetage bleiben massgebend, Tasks ohne Vorgänger beginnen frühestens an ihrem bisherigen Start (wie die
//    Kolonnen-Variante in auslastungOptimieren.ts). Start/Ende werden auf die Zeiteinheit der Simulation gerastert.
//  - Musste ein Task auf freies Personal warten, bekommt er zusätzlich den Task als Vorgänger, nach dem diese Leute frei wurden
//    (bisherige Vorgänger bleiben) — so bleibt der neue Ablauf beim Ausrichten der Folge-Tasks erhalten.
import type { Task, Kran } from "../types";
import { istGruppe, vorgaengerListe, mitVorgaengern } from "../types";
import type { Stammdaten } from "./stammdatenHelpers";
import { dauerBerechnetTask, hatKalkulationsWerte, schritteFuerTask } from "./stammdatenHelpers";
import type { Kalender } from "./kalenderHelpers";
import type { Zeiteinheit, Zeitpunkt } from "./zeitHelpers";
import {
  startZeitpunkt, endZeitpunkt, naechsteArbeitszeit, endeAusArbeitsMinuten, folgeStartZeitpunkt, arbeitsMinutenZwischen,
  vergleicheZeitpunkte, zeitFelder, rasteUhrzeit, MIN_PRO_ARBEITSTAG, ARBEITSBEGINN_MIN, schrittMinuten,
} from "./zeitHelpers";
import { kranPersonalAmTag, kranPersonalTotalAmTag, istKranVerfuegbarAn, kraeneDesTasks } from "./kranHelpers";

/** Eine Phase bekommt höchstens so viele Leute: Kolonne × MAX_VERSTAERKUNG (mehr Leute an einem Bauteil behindern sich). */
export const MAX_VERSTAERKUNG = 2;
/** So viele Leute darf ein Kran in einem Zeitschritt höchstens über seinem Personal haben — nur wenn sonst Leute untätig wären,
 *  weil die nächste Arbeit mehr Min. Personen braucht als frei sind (z.B. 2 frei, Min. 4 → 2 zusätzlich). */
export const MAX_UEBERZUG = 2;
const EPS = 1e-6;

/** Welche Tasks zuerst Personal bekommen, wenn mehrere gleichzeitig möglich sind: "kritischerPfad" = längste Restkette zuerst
 *  (kürzestes Bauprogramm), "startdatum" = frühester aktueller Start zuerst (wenn das Gantt z.B. nach Etappen statt nach Datum
 *  sortiert ist), "gantt" = Reihenfolge im Gantt (geordnetes Arbeiten, z.B. Achse für Achse). */
export type OptimierReihenfolge = "kritischerPfad" | "startdatum" | "gantt";

/** Restkette je Task in Tagen: eigene berechnete Dauer + längste Restkette seiner Nachfolger (nur unter den übergebenen Tasks). */
export function restkettenJeTask(zuPlanen: Task[], stammdaten: Stammdaten, einheit: Zeiteinheit): Map<string, number> {
  const ids = new Set(zuPlanen.map(t => t.id));
  const nachfolger = new Map<string, string[]>();
  for (const t of zuPlanen) for (const v of vorgaengerListe(t)) {
    if (ids.has(v.id)) nachfolger.set(v.id, [...(nachfolger.get(v.id) ?? []), t.id]);
  }
  const byId = new Map(zuPlanen.map(t => [t.id, t]));
  const ergebnis = new Map<string, number>();
  const kette = (id: string, besucht: Set<string>): number => {
    const bekannt = ergebnis.get(id);
    if (bekannt !== undefined) return bekannt;
    if (besucht.has(id)) return 0; // Zyklus-Schutz
    besucht.add(id);
    const wert = dauerBerechnetTask(byId.get(id)!, stammdaten, einheit) + Math.max(0, ...(nachfolger.get(id) ?? []).map(n => kette(n, besucht)));
    ergebnis.set(id, wert);
    return wert;
  };
  for (const t of zuPlanen) kette(t.id, new Set());
  return ergebnis;
}

interface PhaseZ { position: string; unternehmer: string; kranpflichtig: boolean; kolonne: number; rest: number }
interface TaskZ {
  t: Task; i: number;
  schritte: PhaseZ[][]; schritt: number;
  frueheste: number | null; // Arbeitsminuten, null = Vorgänger noch nicht eingeplant
  erste: number | null; letzte: number; // tatsächliche Arbeit (Arbeitsminuten)
  fertig: boolean; restkette: number;
  fixDauer: number | null; // nur manuell übersteuerte Dauer ohne Leistungswerte: keine Ressourcen, nur Dauer
  ressourcen: Set<string>; ersteRessourcen: Set<string>; // genutzte Pools/Kolonnen (alle bzw. beim ersten Arbeitsschritt)
}

export function optimiereMitKranpersonal(tasks: Task[], stammdaten: Stammdaten, kalender: Kalender, einheit: Zeiteinheit, kraene: Kran[],
  reihenfolge: OptimierReihenfolge = "kritischerPfad"): Task[] {
  const echte = tasks.map((t, i) => ({ t, i })).filter(({ t, i }) => !t.isGroup && !istGruppe(tasks, i) && !!t.start && !!t.end);
  if (echte.length === 0) return tasks;
  const byId = new Map(tasks.map(t => [t.id, t]));
  const kranById = new Map(kraene.map(k => [k.id, k]));
  const std = stammdaten.arbeitszeitStdProTag;

  // Achse wie in auslastungOptimieren.ts: Arbeitsminuten ab Arbeitsbeginn des frühesten Starts
  const frueh = echte.map(({ t }) => startZeitpunkt(t)).reduce((a, b) => vergleicheZeitpunkte(a, b) <= 0 ? a : b);
  const anker = naechsteArbeitszeit({ datum: frueh.datum, min: ARBEITSBEGINN_MIN }, kalender);
  const raster = schrittMinuten(einheit);
  const aufRaster = (m: number) => Math.ceil(m / raster - 1e-9) * raster;
  const abRaster = (m: number) => Math.floor(m / raster + 1e-9) * raster;
  const minutenVon = (p: Zeitpunkt) => vergleicheZeitpunkte(p, anker) <= 0 ? 0 : arbeitsMinutenZwischen(anker, p, kalender);
  const startAus = (m: number): Zeitpunkt => {
    const p = m <= 0 ? anker : naechsteArbeitszeit(endeAusArbeitsMinuten(anker, m, kalender), kalender);
    return einheit === "tage" ? { datum: p.datum, min: ARBEITSBEGINN_MIN } : { datum: p.datum, min: rasteUhrzeit(p.min, "start", einheit) };
  };
  const endeAus = (m: number): Zeitpunkt => endeAusArbeitsMinuten(anker, m, kalender);
  const SLOT = MIN_PRO_ARBEITSTAG / Math.max(1, Math.round(MIN_PRO_ARBEITSTAG / 30));
  const tagCache = new Map<number, string>();
  const tagIso = (tag: number) => {
    let iso = tagCache.get(tag);
    if (!iso) { iso = endeAusArbeitsMinuten(anker, tag * MIN_PRO_ARBEITSTAG + 1, kalender).datum; tagCache.set(tag, iso); }
    return iso;
  };

  // Zustand je planbarem Task
  const zustand = new Map<string, TaskZ>();
  for (const { t, i } of echte) {
    if (t.meilenstein || !hatKalkulationsWerte(t, stammdaten)) continue;
    const schritte = schritteFuerTask(t, stammdaten).map(s => s.phasen.map(p => ({
      position: p.position, unternehmer: p.unternehmer, kranpflichtig: p.kranpflichtig, kolonne: p.kolonne, rest: p.personenstunden * 60,
    })));
    const fixDauer = schritte.length === 0 ? Math.max(dauerBerechnetTask(t, stammdaten, einheit) * MIN_PRO_ARBEITSTAG, raster) : null;
    zustand.set(t.id, { t, i, schritte, schritt: 0, frueheste: null, erste: null, letzte: 0, fertig: false, restkette: 0, fixDauer,
      ressourcen: new Set(), ersteRessourcen: new Set() });
  }
  if (zustand.size === 0 || !std) return tasks;

  // Kritischer Pfad: Restkette = eigene berechnete Dauer + längste Restkette der Nachfolger
  const ketten = restkettenJeTask([...zustand.values()].map(z => z.t), stammdaten, einheit);
  for (const z of zustand.values()) z.restkette = ketten.get(z.t.id) ?? 0;

  const ergebnis = new Map<string, { start: Zeitpunkt; end: Zeitpunkt }>();
  const endeVon = (id: string): Zeitpunkt | null => {
    const r = ergebnis.get(id);
    if (r) return r.end;
    if (zustand.has(id)) return null; // noch nicht eingeplant
    const t = byId.get(id);
    return t?.end ? endZeitpunkt(t) : null;
  };
  /** Frühester Start, sobald alle Vorgänger eingeplant sind (sonst null). */
  const fruehesteVon = (z: TaskZ): number | null => {
    let f: Zeitpunkt | null = null;
    for (const v of vorgaengerListe(z.t)) {
      if (zustand.has(v.id) && !ergebnis.has(v.id)) return null;
      const e = endeVon(v.id);
      if (!e) continue;
      const fs = folgeStartZeitpunkt(e, v.lagDays, kalender);
      if (!f || vergleicheZeitpunkte(fs, f) > 0) f = fs;
    }
    return aufRaster(minutenVon(f ?? naechsteArbeitszeit(startZeitpunkt(z.t), kalender)));
  };
  let vorgaengerGeaendert = true; // frühester Start nur neu prüfen, wenn seit dem letzten Mal ein Task eingeplant wurde
  const freigaben = new Map<string, { id: string; end: Zeitpunkt }[]>(); // Pool/Kolonne → Tasks, die damit fertig wurden
  const zusatzVorgaenger = new Map<string, string>();
  const abschliessen = (z: TaskZ, von: number, bis: number) => {
    z.fertig = true;
    vorgaengerGeaendert = true;
    const startM = abRaster(von);
    const r = { start: startAus(startM), end: endeAus(Math.max(aufRaster(bis), startM + raster)) };
    ergebnis.set(z.t.id, r);
    for (const key of z.ressourcen) freigaben.set(key, [...(freigaben.get(key) ?? []), { id: z.t.id, end: r.end }]);
    // auf Personal gewartet → Vorgänger = zuletzt mit denselben Leuten fertig gewordener Task, der vor diesem Start endet
    if (z.frueheste === null || z.erste === null || z.erste <= z.frueheste + EPS) return;
    const bisher = new Set(vorgaengerListe(z.t).map(v => v.id));
    let bester: { id: string; end: Zeitpunkt } | null = null;
    for (const key of z.ersteRessourcen) for (const f of freigaben.get(key) ?? []) {
      if (f.id === z.t.id || bisher.has(f.id)) continue;
      if (vergleicheZeitpunkte(folgeStartZeitpunkt(f.end, 0, kalender), r.start) > 0) continue;
      if (!bester || vergleicheZeitpunkte(f.end, bester.end) > 0) bester = f;
    }
    if (bester) zusatzVorgaenger.set(z.t.id, bester.id);
  };

  const offen = [...zustand.values()];
  const prio = reihenfolge === "gantt"
    ? (a: TaskZ, b: TaskZ) => a.i - b.i
    : reihenfolge === "startdatum"
    ? (a: TaskZ, b: TaskZ) => vergleicheZeitpunkte(startZeitpunkt(a.t), startZeitpunkt(b.t)) || a.i - b.i
    : (a: TaskZ, b: TaskZ) => b.restkette - a.restkette || vergleicheZeitpunkte(startZeitpunkt(a.t), startZeitpunkt(b.t)) || a.i - b.i;
  const maxSlots = Math.ceil(60 * 260 * MIN_PRO_ARBEITSTAG / SLOT); // Schutz: 60 Jahre
  let slot = 0;

  let anzahlOffen = offen.length;
  while (anzahlOffen > 0 && slot < maxSlots) {
    anzahlOffen = offen.reduce((n, z) => n + (z.fertig ? 0 : 1), 0);
    if (anzahlOffen === 0) break;
    // Vorgänger erledigt → frühester Start bekannt; Tasks ohne Ressourcen (nur Dauer) gleich einplanen
    while (vorgaengerGeaendert) {
      vorgaengerGeaendert = false;
      for (const z of offen) {
        if (z.fertig || z.frueheste !== null) continue;
        const f = fruehesteVon(z);
        if (f === null) continue;
        z.frueheste = f;
        if (z.fixDauer !== null) abschliessen(z, f, f + z.fixDauer);
      }
    }
    const laufend = offen.filter(z => !z.fertig && z.erste !== null).sort(prio);
    const t0 = slot * SLOT;
    const bereit = offen.filter(z => !z.fertig && z.erste === null && z.frueheste !== null && z.frueheste <= t0 + EPS).sort(prio);
    if (laufend.length === 0 && bereit.length === 0) {
      // nichts zu tun: zum nächsten frühesten Start springen
      const naechster = Math.min(...offen.filter(z => !z.fertig && z.frueheste !== null).map(z => z.frueheste!));
      if (!isFinite(naechster)) break; // nur noch Tasks mit uneingeplanten Vorgängern (Zyklus) — unverändert lassen
      slot = Math.max(slot + 1, Math.floor(naechster / SLOT + EPS));
      continue;
    }

    // Ressourcen dieses Zeitschritts
    const iso = tagIso(Math.floor(t0 / MIN_PRO_ARBEITSTAG + EPS));
    // Personal unter dem Kran = Summe seiner Unternehmer an diesem Tag (Tab Ressourcen → Kräne & Personal) — zugleich die
    // Obergrenze für alle Leute an kranpflichtigen Arbeiten dieses Krans. Kran ohne Personal an diesem Tag: keine Grenze.
    const kranFrei = new Map<string, number>();
    const pool = new Map<string, number>(); // "kranId|Unternehmer" → freie Leute
    const poolGroesse = new Map<string, number>();
    const kranTotal = new Map<string, number>();
    const ueberzug = new Map<string, number>(); // Leute über dem Personal des Krans (höchstens MAX_UEBERZUG)
    for (const k of kraene) {
      if (!istKranVerfuegbarAn(k, iso)) continue;
      const total = kranPersonalTotalAmTag(k, iso);
      kranTotal.set(k.id, total > 0 ? total : Infinity);
      kranFrei.set(k.id, total > 0 ? total : Infinity);
      for (const [u, n] of kranPersonalAmTag(k, iso)) { pool.set(`${k.id}|${u}`, n); poolGroesse.set(`${k.id}|${u}`, n); }
    }
    const kolonneBelegt = new Set<string>();
    const vergabe: { z: TaskZ; p: PhaseZ; leute: number; poolKey: string | null; kranId: string | null }[] = [];
    const besetzt = new Set<PhaseZ>();

    /** Leute verfügbar? Mit Überzug nur, wenn beim Kran noch Leute frei sind (sonst untätig) und höchstens MAX_UEBERZUG insgesamt. */
    const reicht = (frei: number, noetig: number, kid: string, mitUeberzug: boolean) =>
      frei >= noetig || (mitUeberzug && frei > 0 && noetig - frei <= MAX_UEBERZUG - (ueberzug.get(kid) ?? 0));
    const abziehen = (kid: string, n: number) => {
      const frei = kranFrei.get(kid)!;
      if (n > frei && isFinite(frei)) ueberzug.set(kid, (ueberzug.get(kid) ?? 0) + n - Math.max(0, frei));
      kranFrei.set(kid, frei - n);
    };

    /** Mindestbesetzung einer Phase vergeben (nichts vergeben = kann in diesem Zeitschritt nicht arbeiten). */
    const besetzen = (z: TaskZ, p: PhaseZ, mitUeberzug: boolean) => {
      const braucht = Math.max(1, Math.ceil(p.rest / SLOT - EPS));
      const kranIds = p.kranpflichtig ? kraeneDesTasks(z.t, kraene) : [];
      // Kran der Phase: verfügbar heute? Sonst warten, solange er später noch verfügbar wird
      const kraeneHeute = kranIds.filter(id => kranFrei.has(id));
      const kranSpaeter = kranIds.some(id => { const b = kranById.get(id)!.verfuegbarBis; return !b || b > iso; });
      if (kranIds.length > 0 && kraeneHeute.length === 0 && kranSpaeter) return;
      // 1) Pool desselben Unternehmers unter einem Kran des Tasks
      for (const kid of kraeneHeute) {
        const key = `${kid}|${p.unternehmer}`;
        if (!p.unternehmer || !poolGroesse.has(key)) continue;
        const mindest = Math.min(p.kolonne, braucht, poolGroesse.get(key)!);
        const frei = Math.min(pool.get(key) ?? 0, kranFrei.get(kid) ?? 0);
        if (reicht(frei, mindest, kid, mitUeberzug)) {
          pool.set(key, pool.get(key)! - mindest);
          abziehen(kid, mindest);
          vergabe.push({ z, p, leute: mindest, poolKey: key, kranId: kid });
          besetzt.add(p);
        }
        return; // Unternehmer hat Personal unter diesem Kran → nur aus dem Pool
      }
      // 2) Min. Personen ohne Pool (eine Kolonne je Leistungsposition), kranpflichtige zählen zum Personal eines Krans des Tasks
      if (kolonneBelegt.has(p.position)) return;
      let kranId: string | null = null;
      if (kraeneHeute.length > 0) {
        kranId = kraeneHeute.find(kid => reicht(kranFrei.get(kid) ?? 0, Math.min(p.kolonne, kranTotal.get(kid)!), kid, mitUeberzug)) ?? null;
        if (!kranId) return;
        abziehen(kranId, Math.min(p.kolonne, kranTotal.get(kranId)!));
      }
      kolonneBelegt.add(p.position);
      vergabe.push({ z, p, leute: p.kolonne, poolKey: null, kranId });
      besetzt.add(p);
    };

    const kandidaten = [...laufend, ...bereit];
    for (const z of kandidaten) {
      for (const p of z.schritte[z.schritt]) if (p.rest > EPS) besetzen(z, p, false);
    }
    // Verstärkung: übriges Personal des Pools auf laufende Phasen desselben Unternehmers/Krans (grösster Rest zuerst)
    for (const v of [...vergabe].filter(v => v.poolKey).sort((a, b) => b.p.rest - a.p.rest)) {
      const sinnvoll = Math.max(1, Math.ceil(v.p.rest / SLOT - EPS));
      const extra = Math.min(pool.get(v.poolKey!) ?? 0, kranFrei.get(v.kranId!) ?? 0, MAX_VERSTAERKUNG * v.p.kolonne - v.leute, sinnvoll - v.leute);
      if (extra > 0) {
        v.leute += extra;
        pool.set(v.poolKey!, pool.get(v.poolKey!)! - extra);
        kranFrei.set(v.kranId!, kranFrei.get(v.kranId!)! - extra);
      }
    }
    // Übrige Leute, die nirgends mehr verstärken können: nächste Arbeit trotzdem starten, wenn ihr höchstens MAX_UEBERZUG fehlen
    for (const z of kandidaten) {
      for (const p of z.schritte[z.schritt]) if (p.rest > EPS && !besetzt.has(p)) besetzen(z, p, true);
    }

    // Arbeit leisten
    for (const v of vergabe) {
      const vorher = v.p.rest;
      v.p.rest = Math.max(0, vorher - v.leute * SLOT);
      const z = v.z;
      if (z.erste === null) z.erste = t0;
      const key = v.poolKey ?? `kolonne|${v.p.position}`;
      z.ressourcen.add(key);
      if (z.erste === t0) z.ersteRessourcen.add(key);
      z.letzte = Math.max(z.letzte, t0 + Math.min(SLOT, vorher / v.leute));
    }
    for (const z of new Set(vergabe.map(v => v.z))) {
      while (z.schritt < z.schritte.length && z.schritte[z.schritt].every(p => p.rest <= EPS)) z.schritt++;
      if (z.schritt >= z.schritte.length) abschliessen(z, z.erste!, z.letzte);
    }
    slot++;
  }

  return tasks.map(t => {
    const r = ergebnis.get(t.id);
    if (!r) return t;
    const neu = { ...t, ...zeitFelder(r.start, r.end) };
    const zusatz = zusatzVorgaenger.get(t.id);
    return zusatz ? mitVorgaengern(neu, [...vorgaengerListe(t), { id: zusatz, lagDays: 0 }]) : neu;
  });
}
