// auslastungOptimierenKran.ts — "Auslastung optimieren" (Tab Bauteile → Werkzeuge): plant die Tasks so, dass das Personal möglichst
// voll arbeitet und das Bauprogramm dadurch möglichst kurz wird — mit und ohne Personal unter dem Kran.
//  - Wer in einem Zeitschritt (½ Stunde) welche Arbeit bekommt, entscheidet der gemeinsame Rechenkern (ablaufKern.ts): Pools je
//    Kran und Unternehmer (Tab Ressourcen → Kräne & Personal), Kolonnen je Gewerk + Unternehmer ohne Pool, Mindestbesetzung,
//    Verstärkung bis zum Doppelten, Kranzeit. Derselbe Kern rechnet den Tagesablauf in Tab AVOR (tagesplan.ts).
//  - Je Task gilt der Arbeitsablauf je Kürzel (schritteFuerTask): Schritte nacheinander, Phasen eines Schritts gleichzeitig.
//  - Vergabe je Zeitschritt: zuerst laufende Tasks, dann neue Tasks nach der gewählten Reihenfolge (kritischer Pfad = längste
//    Restkette über die Nachfolger zuerst), zuletzt Verstärkung; mit lueckenFuellen ziehen untätige Leute eines Kran-Pools Tasks
//    ohne Vorgänger vor.
//  - Arbeitstag = Std./Tag (Tab Ressourcen): ein Tag leistet je Person genau so viele Stunden; was keinen Platz mehr hat, geht am
//    nächsten Tag weiter (eine Arbeit darf sich über mehrere Tage ziehen). Bleibt einem Task am Ende eines Tages höchstens
//    UEBERSTUNDEN_ANTEIL seiner Arbeit, wird er am selben Tag in Überstunden fertig statt einen weiteren Tag zu belegen.
//  - Vorgänger und Wartetage bleiben massgebend, Tasks ohne Vorgänger beginnen frühestens an ihrem bisherigen Start. Start/Ende
//    werden auf die Zeiteinheit der Simulation gerastert.
//  - Musste ein Task auf freies Personal warten, bekommt er zusätzlich den Task als Vorgänger, nach dem diese Leute frei wurden
//    (bisherige Vorgänger bleiben) — so bleibt der neue Ablauf beim Ausrichten der Folge-Tasks erhalten.
//  - Den Ablauf jedes Tages (wer von wann bis wann an welcher Arbeit) merkt sich der Task (Task.tagesArbeit) — Tab AVOR zeigt und
//    rechnet genau diesen Ablauf, solange Termine, Mengen, Stammdaten und Kräne & Personal unverändert sind.
import type { Task, Kran, TagesLauf } from "../types";
import { istGruppe, vorgaengerListe, mitVorgaengern, terminSchluessel } from "../types";
import type { Stammdaten } from "./stammdatenHelpers";
import { dauerBerechnetTask, hatKalkulationsWerte, schritteFuerTask } from "./stammdatenHelpers";
import type { Kalender } from "./kalenderHelpers";
import type { Zeiteinheit, Zeitpunkt } from "./zeitHelpers";
import {
  startZeitpunkt, endZeitpunkt, naechsteArbeitszeit, endeAusArbeitsMinuten, folgeStartZeitpunkt, arbeitsMinutenZwischen,
  vergleicheZeitpunkte, zeitFelder, rasteUhrzeit, MIN_PRO_ARBEITSTAG, ARBEITSBEGINN_MIN, schrittMinuten,
} from "./zeitHelpers";
import { kraeneDesTasks } from "./kranHelpers";
import { tagesArbeitBasis } from "./avorHelpers";
import { Zeitschritt, vergebeZeitschritt, slotsProTag, kranSchluessel, UEBERSTUNDEN_ANTEIL } from "./ablaufKern";
import type { KernPhase, KernAufgabe } from "./ablaufKern";
export { MAX_VERSTAERKUNG, MAX_UEBERZUG, UEBERSTUNDEN_ANTEIL } from "./ablaufKern";
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

interface PhaseZ extends KernPhase { gesamt: number; letzteLeute: number } // gesamt = Personenstunden der Phase
interface TaskZ {
  t: Task; i: number; gesamt: number; // Personenstunden aller Phasen
  schritte: PhaseZ[][]; schritt: number;
  frueheste: number | null; // Arbeitsminuten, null = Vorgänger noch nicht eingeplant
  erste: number | null; letzte: number; // tatsächliche Arbeit (Arbeitsminuten)
  fertig: boolean; restkette: number;
  fixDauer: number | null; // nur manuell übersteuerte Dauer ohne Leistungswerte: keine Ressourcen, nur Dauer
  ressourcen: Set<string>; ersteRessourcen: Set<string>; // genutzte Pools/Kolonnen (alle bzw. beim ersten Arbeitsschritt)
  laeufe: Map<number, TagesLauf[]>; // Arbeitstag (Index ab Anker) → Ablauf dieses Tages
}

const r4 = (x: number) => Math.round(x * 1e4) / 1e4;

/** Ein Stück Arbeit an den Ablauf des Tages hängen — direkt anschliessende Stücke derselben Arbeit mit gleicher Besetzung zusammen */
function laufAnhaengen(z: TaskZ, tag: number, l: TagesLauf) {
  const liste = z.laeufe.get(tag) ?? [];
  const letzter = [...liste].reverse().find(x => x.pos === l.pos);
  if (letzter && Math.abs(letzter.bis - l.von) < 1e-9 && letzter.leute === l.leute && !!letzter.kran === !!l.kran) {
    letzter.bis = l.bis;
    letzter.ph += l.ph;
  } else liste.push({ ...l });
  z.laeufe.set(tag, liste);
}

/** lueckenFuellen: wäre Personal unter einem Kran sonst untätig, dürfen Tasks ohne Vorgänger früher als an ihrem bisherigen Start
 *  beginnen (frühester bisheriger Start zuerst) — nur mit Leuten aus dem Kran-Pool, nie über dem Personal des Krans. */
export function optimiereMitKranpersonal(tasks: Task[], stammdaten: Stammdaten, kalender: Kalender, einheit: Zeiteinheit, kraene: Kran[],
  reihenfolge: OptimierReihenfolge = "kritischerPfad", lueckenFuellen = false): Task[] {
  const echte = tasks.map((t, i) => ({ t, i })).filter(({ t, i }) => !t.isGroup && !istGruppe(tasks, i) && !!t.start && !!t.end);
  if (echte.length === 0) return tasks;
  const byId = new Map(tasks.map(t => [t.id, t]));
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
  // Zeitschritte wie im Tagesablauf: N je Arbeitstag, je Person Std./Tag ÷ N Stunden Arbeit (auch wenn die Kalender-Arbeitszeit abweicht)
  const N = slotsProTag();
  const SLOT = MIN_PRO_ARBEITSTAG / N;
  const slotStd = std / N;
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
    const schritte: PhaseZ[][] = schritteFuerTask(t, stammdaten).map(s => s.phasen.map(p => ({
      position: p.position, gewerkKey: p.gewerkKey, unternehmer: p.unternehmer, kranpflichtig: p.kranpflichtig, kolonne: Math.max(1, p.kolonne),
      kranAnteil: p.kranAnteil, rest: p.personenstunden, gesamt: p.personenstunden, letzteLeute: 0,
    })));
    const fixDauer = schritte.length === 0 ? Math.max(dauerBerechnetTask(t, stammdaten, einheit) * MIN_PRO_ARBEITSTAG, raster) : null;
    const gesamt = schritte.flat().reduce((s, p) => s + p.gesamt, 0);
    zustand.set(t.id, { t, i, gesamt, schritte, schritt: 0, frueheste: null, erste: null, letzte: 0, fertig: false, restkette: 0, fixDauer,
      ressourcen: new Set(), ersteRessourcen: new Set(), laeufe: new Map() });
  }
  if (zustand.size === 0 || !std) return tasks;

  // Kritischer Pfad: Restkette = eigene berechnete Dauer + längste Restkette der Nachfolger
  const ketten = restkettenJeTask([...zustand.values()].map(z => z.t), stammdaten, einheit);
  for (const z of zustand.values()) z.restkette = ketten.get(z.t.id) ?? 0;

  const ergebnis = new Map<string, { start: Zeitpunkt; end: Zeitpunkt }>();
  const ablauf = new Map<string, Record<string, TagesLauf[]>>(); // Task → Datum → Ablauf (Task.tagesArbeit)
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
    if (z.laeufe.size > 0) {
      const tage: Record<string, TagesLauf[]> = {};
      for (const [tag, liste] of [...z.laeufe].sort((a, b) => a[0] - b[0])) {
        tage[tagIso(tag)] = liste.map(l => ({ pos: l.pos, von: r4(l.von), bis: r4(l.bis), leute: l.leute, ph: r4(l.ph), ...(l.kran ? { kran: true } : {}) }));
      }
      ablauf.set(z.t.id, tage);
    }
    for (const key of z.ressourcen) freigaben.set(key, [...(freigaben.get(key) ?? []), { id: z.t.id, end: r.end }]);
    // auf Personal gewartet → Vorgänger = zuletzt mit denselben Leuten fertig gewordener Task, der vor diesem Start endet
    if (z.frueheste === null || z.erste === null || z.erste <= z.frueheste + EPS) return;
    // nur nötig, wenn der Task im Gantt (gerastert) wirklich später beginnt, als seine Vorgänger erlauben
    if (vergleicheZeitpunkte(r.start, startAus(z.frueheste)) <= 0) return;
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
  const aufgabe = (z: TaskZ): KernAufgabe<TaskZ> => ({ ref: z, phasen: z.schritte[z.schritt], kranIds: kraeneDesTasks(z.t, kraene) });
  const maxSlots = 60 * 260 * N; // Schutz: 60 Jahre
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
    // Lückenfüller: Tasks ohne Vorgänger, deren bisheriger Start noch kommt (frühester zuerst)
    const fueller = lueckenFuellen
      ? offen.filter(z => !z.fertig && z.erste === null && z.frueheste !== null && z.frueheste > t0 + EPS && vorgaengerListe(z.t).length === 0)
        .sort((a, b) => a.frueheste! - b.frueheste! || a.i - b.i)
      : [];
    if (laufend.length === 0 && bereit.length === 0 && fueller.length === 0) {
      // nichts zu tun: zum nächsten frühesten Start springen
      const naechster = Math.min(...offen.filter(z => !z.fertig && z.frueheste !== null).map(z => z.frueheste!));
      if (!isFinite(naechster)) break; // nur noch Tasks mit uneingeplanten Vorgängern (Zyklus) — unverändert lassen
      slot = Math.max(slot + 1, Math.floor(naechster / SLOT + EPS));
      continue;
    }

    const tag = Math.floor(slot / N);
    const s = slot - tag * N; // Zeitschritt im Tag
    const zs = new Zeitschritt<TaskZ>(tagIso(tag), kraene, slotStd, true);
    const vergabe = vergebeZeitschritt(zs, [...laufend, ...bereit].map(aufgabe), fueller.map(aufgabe));

    // Arbeit leisten
    for (const v of vergabe) {
      const p = v.p as PhaseZ, z = v.ref;
      const arbeit = Math.min(p.rest, v.leute * slotStd);
      p.rest -= arbeit;
      p.letzteLeute = v.leute;
      const anteil = arbeit / (v.leute * slotStd);
      laufAnhaengen(z, tag, { pos: p.position, von: s * slotStd, bis: (s + anteil) * slotStd, leute: v.leute, ph: arbeit, ...(v.kranBegrenzt ? { kran: true } : {}) });
      if (z.erste === null) z.erste = t0;
      z.ressourcen.add(v.ressource);
      if (z.erste === t0) z.ersteRessourcen.add(v.ressource);
      z.letzte = Math.max(z.letzte, t0 + anteil * SLOT);
    }
    for (const z of new Set(vergabe.map(v => v.ref))) {
      while (z.schritt < z.schritte.length && z.schritte[z.schritt].every(p => p.rest <= EPS)) z.schritt++;
      if (z.schritt >= z.schritte.length) abschliessen(z, z.erste!, z.letzte);
    }
    // Tagesende: bleibt einem laufenden Task nur noch wenig Arbeit, wird er heute in Überstunden fertig (statt einen Tag mehr) —
    // seine restlichen Arbeiten nach Arbeitsende, Schritte nacheinander, mit der zuletzt eingesetzten Besetzung
    if (s === N - 1) {
      for (const z of offen) {
        if (z.fertig || z.erste === null || z.gesamt <= EPS) continue;
        const rest = z.schritte.flat().reduce((sum, p) => sum + p.rest, 0);
        if (rest > UEBERSTUNDEN_ANTEIL * z.gesamt + EPS) continue;
        let ab = std;
        for (let i = z.schritt; i < z.schritte.length; i++) {
          let ende = ab;
          for (const p of z.schritte[i]) {
            if (p.rest <= EPS) continue;
            const leute = p.letzteLeute || p.kolonne;
            const bis = ab + p.rest / leute;
            laufAnhaengen(z, tag, { pos: p.position, von: ab, bis, leute, ph: p.rest });
            p.rest = 0;
            ende = Math.max(ende, bis);
          }
          ab = ende;
        }
        z.schritt = z.schritte.length;
        z.letzte = Math.max(z.letzte, (tag + 1) * MIN_PRO_ARBEITSTAG);
        abschliessen(z, z.erste, z.letzte);
      }
    }
    slot++;
  }

  const kraeneText = kranSchluessel(kraene);
  return tasks.map(t => {
    const r = ergebnis.get(t.id);
    if (!r) return t;
    const neu: Task = { ...t, ...zeitFelder(r.start, r.end) };
    const tage = ablauf.get(t.id);
    if (tage) neu.tagesArbeit = { termin: terminSchluessel(neu), basis: tagesArbeitBasis(neu, stammdaten), kraene: kraeneText, tage };
    else delete neu.tagesArbeit;
    const zusatz = zusatzVorgaenger.get(t.id);
    return zusatz ? mitVorgaengern(neu, [...vorgaengerListe(t), { id: zusatz, lagDays: 0 }]) : neu;
  });
}
