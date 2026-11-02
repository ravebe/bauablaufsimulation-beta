// tagesplan.ts — Wie die Arbeit eines Tages abläuft (Tab AVOR → Tagesablauf, Spalte "Dauer", Überstunden):
//  - Tasks, die "Auslastung optimieren" geplant hat und die seither unverändert sind (Task.tagesArbeit gültig, gleiche Kräne &
//    Personal): genau der dort gerechnete Ablauf — wer von wann bis wann mit wie vielen Leuten an welcher Arbeit.
//  - Alle anderen Tasks: ihre Arbeit des Tages (aufwandJeTagUndPhaseFuerTask, gleichmässig über ihre Tage im Gantt) wird mit dem
//    gemeinsamen Rechenkern (ablaufKern.ts) — denselben Regeln und Zeitschritten wie "Auslastung optimieren" — auf das Personal
//    verteilt, das die geplanten Tasks übrig lassen. Schritte eines Tasks nacheinander, Tasks in der Reihenfolge ihres Starts.
//  - Überstunden: was nach Arbeitsende (Std./Tag) noch gearbeitet wird — Personenstunden je Unternehmer, Kranstunden je Kran.
//  - Belegung je Zeitschritt im Arbeitstag (Kranzeit je Kran, Leute je Pool, Kolonnen): Tagesangaben (Kranzeit) und
//    bereitAberNichtDran — Tasks, deren Vorgänger fertig sind, die aber an diesem Tag nicht arbeiten, mit dem Grund.
import type { Task, Kran, TagesLauf, UnternehmerPersonal } from "../types";
import { vorgaengerListe, istGruppe } from "../types";
import type { Stammdaten } from "./stammdatenHelpers";
import { hatKalkulationsWerte, schritteFuerTask, rateFuerKuerzel, istRateKranpflichtig } from "./stammdatenHelpers";
import type { Kalender } from "./kalenderHelpers";
import { endZeitpunkt, folgeStartZeitpunkt, vergleicheZeitpunkte, ARBEITSBEGINN_MIN } from "./zeitHelpers";
import type { Zeitpunkt } from "./zeitHelpers";
import { kolonnenSchluessel } from "./kranHelpers";
import { aufwandJeTagUndPhaseFuerTask, gueltigeTagesArbeit } from "./avorHelpers";
import type { PhasenAufwand } from "./avorHelpers";
import { kraeneDesTasks } from "./kranHelpers";
import { Zeitschritt, vergebeZeitschritt, slotsProTag, kranSchluessel } from "./ablaufKern";
import type { KernPhase } from "./ablaufKern";

const MAX_TAGE = 5; // Schutz: so weit über den Arbeitstag hinaus wird gerechnet
const EPS = 1e-9;

export interface TagesplanPhase {
  gewerkKey: string; kuerzel: string; arbeit: number; // Personenstunden des Tages
  von: number; bis: number; // Stunden ab Arbeitsbeginn
  personen: number; // grösste Besetzung
  minPersonen: number;
  unterKran: boolean; // aus dem Personal unter dem Kran besetzt
  kranBegrenzt: boolean; // mehr Leute wären frei gewesen, aber die Kranzeit reichte nicht
}
/** quelle: "optimiert" = Ablauf aus «Auslastung optimieren»; "veraltet" = dort geplant, seither aber Termine, Mengen, Stammdaten
 *  oder Kräne & Personal geändert → gleichmässig verteilt und neu gerechnet; "gleichmaessig" = nie optimiert */
export interface TagesplanTask { t: Task; phasen: TagesplanPhase[]; von: number; bis: number; arbeit: number; quelle: "optimiert" | "veraltet" | "gleichmaessig" }
/** Arbeit nach Arbeitsende: Personenstunden je Unternehmer ("" = Position ohne Unternehmer), Kranstunden je Kran-Id */
/** jeUnternehmerDauer: wie lange die Leute des Unternehmers nach Arbeitsende noch arbeiten (h, längste Arbeit) — Überstunden je Person */
export interface Ueberstunden { jeUnternehmer: Map<string, number>; jeKran: Map<string, number>; jeUnternehmerDauer: Map<string, number> }
export const unternehmerLabel = (u: string) => u || "ohne Unternehmer";
/** Gleichzeitig arbeitende Personen: anzahl = Höchstzahl des Tages, um = Zeitpunkt (h ab Arbeitsbeginn), jeGewerkAnSpitze = wie sie
 *  sich in diesem Moment auf die Gewerke verteilen (Summe = anzahl), maxJeGewerk = Höchstzahl jedes Gewerks für sich (zu irgendeiner Zeit) */
export interface ImEinsatz { anzahl: number; um: number; jeGewerkAnSpitze: Map<string, number>; maxJeGewerk: Map<string, number> }
/** Belegung je Zeitschritt des Arbeitstags (slotsProTag): kran = belegte Kranzeit je Kran-Id (0…1 je Zeitschritt), pool = Leute je
 *  Pool ("kranId|Unternehmer"), kolonne = Kolonnen (kolonnenSchluessel) bei der Arbeit, unternehmer = Leute je Unternehmer */
export interface Belegung { kran: Map<string, number[]>; pool: Map<string, number[]>; kolonne: Map<string, boolean[]>; unternehmer: Map<string, number[]> }
export interface Tagesplan { tasks: TagesplanTask[]; dauer: number; arbeit: number; jeGewerk: Map<string, { von: number; bis: number }>; ueberstunden: Ueberstunden;
  arbeitJeGewerk: Map<string, number>; imEinsatz: ImEinsatz; belegung: Belegung }

/** Belegte Kranzeit im Arbeitstag je Kran-Id (h) */
export function kranstundenImArbeitstag(plan: Tagesplan, std: number): Map<string, number> {
  const slotStd = std / slotsProTag();
  return new Map([...plan.belegung.kran].map(([id, werte]) => [id, werte.reduce((s, v) => s + Math.min(1, v), 0) * slotStd]));
}

/** Höchstzahl gleichzeitig arbeitender Personen aus den Arbeitsstücken des Tages (von/bis in h, leute, Gewerk) */
function imEinsatzAus(stuecke: { von: number; bis: number; leute: number; gewerk: string }[]): ImEinsatz {
  const aktivUm = (t: number, gewerk?: string) => stuecke.filter(s => s.von <= t + 1e-9 && s.bis > t + 1e-9 && (!gewerk || s.gewerk === gewerk));
  let anzahl = 0, um = 0;
  for (const t of new Set(stuecke.map(s => s.von))) {
    const n = aktivUm(t).reduce((sum, s) => sum + s.leute, 0);
    if (n > anzahl || (n === anzahl && t < um)) { anzahl = n; um = t; }
  }
  const jeGewerkAnSpitze = new Map<string, number>();
  for (const s of aktivUm(um)) jeGewerkAnSpitze.set(s.gewerk, (jeGewerkAnSpitze.get(s.gewerk) ?? 0) + s.leute);
  const maxJeGewerk = new Map<string, number>();
  for (const s of stuecke) {
    const n = aktivUm(s.von, s.gewerk).reduce((sum, x) => sum + x.leute, 0);
    if (n > (maxJeGewerk.get(s.gewerk) ?? 0)) maxJeGewerk.set(s.gewerk, n);
  }
  return { anzahl, um, jeGewerkAnSpitze, maxJeGewerk };
}

/** Aufwand je Tag und Phase eines Tasks — je Task nur einmal gerechnet, wenn der Tagesplan für viele Tage gebraucht wird */
export type AufwandQuelle = (t: Task) => Map<string, PhasenAufwand[]>;
export function aufwandCache(stammdaten: Stammdaten, kalender: Kalender): AufwandQuelle {
  const cache = new Map<Task, Map<string, PhasenAufwand[]>>();
  return t => {
    let a = cache.get(t);
    if (!a) { a = aufwandJeTagUndPhaseFuerTask(t, stammdaten, kalender); cache.set(t, a); }
    return a;
  };
}

interface SimPhase extends KernPhase { tp: TagesplanPhase }
interface SimTask { schritte: SimPhase[][]; schritt: number; kranIds: string[] }

export function tagesplan(iso: string, tasks: Task[], stammdaten: Stammdaten, kalender: Kalender, kraene: Kran[], aufwand?: AufwandQuelle,
  unternehmer: UnternehmerPersonal[] = []): Tagesplan {
  const std = stammdaten.arbeitszeitStdProTag || 8;
  const N = slotsProTag();
  const slotStd = std / N;
  const kraeneText = kranSchluessel(kraene, unternehmer);
  const pruefung = new Zeitschritt<SimTask>(iso, kraene, slotStd, false, unternehmer); // nur zum Nachschlagen von Pools und verfügbaren Kränen

  const ueberstunden: Ueberstunden = { jeUnternehmer: new Map(), jeKran: new Map(), jeUnternehmerDauer: new Map() };
  /** Teil von [von, bis) nach Arbeitsende als Überstunden: Personenstunden des Unternehmers, Kranstunden der heutigen Kräne */
  const ueberstundenBuchen = (p: KernPhase, kranIdsHeute: string[], von: number, bis: number, leute: number) => {
    const nach = bis - Math.max(von, std);
    if (nach <= EPS) return;
    const u = ueberstunden.jeUnternehmer;
    u.set(p.unternehmer, (u.get(p.unternehmer) ?? 0) + leute * nach);
    ueberstunden.jeUnternehmerDauer.set(p.unternehmer, Math.max(ueberstunden.jeUnternehmerDauer.get(p.unternehmer) ?? 0, bis - std));
    for (const id of kranIdsHeute) {
      ueberstunden.jeKran.set(id, (ueberstunden.jeKran.get(id) ?? 0) + leute / Math.max(1, p.kolonne) * p.kranAnteil / kranIdsHeute.length * nach);
    }
  };

  const belegung: Belegung = { kran: new Map(), pool: new Map(), kolonne: new Map(), unternehmer: new Map() };
  /** Arbeit [von, bis) mit leute in die Belegung je Zeitschritt des Arbeitstags buchen */
  const belegungBuchen = (p: KernPhase, kranIds: string[], von: number, bis: number, leute: number) => {
    const heute = pruefung.kraeneHeute(p, kranIds);
    const pool = pruefung.poolDer(p, kranIds);
    for (let s = Math.max(0, Math.floor(von / slotStd + EPS)); s < N && s * slotStd < bis - EPS; s++) {
      const anteil = (Math.min(bis, (s + 1) * slotStd) - Math.max(von, s * slotStd)) / slotStd;
      if (anteil <= EPS) continue;
      for (const id of heute) {
        const w = belegung.kran.get(id) ?? Array<number>(N).fill(0);
        w[s] += leute / Math.max(1, p.kolonne) * p.kranAnteil / heute.length * anteil;
        belegung.kran.set(id, w);
      }
      if (p.unternehmer) {
        const w = belegung.unternehmer.get(p.unternehmer) ?? Array<number>(N).fill(0);
        w[s] += leute;
        belegung.unternehmer.set(p.unternehmer, w);
      }
      if (pool) {
        const w = belegung.pool.get(pool.key) ?? Array<number>(N).fill(0);
        w[s] += leute;
        belegung.pool.set(pool.key, w);
      } else if (!pruefung.istUnbegrenzt(p.unternehmer)) {
        const key = kolonnenSchluessel(p.gewerkKey, p.unternehmer);
        const w = belegung.kolonne.get(key) ?? Array<boolean>(N).fill(false);
        w[s] = true;
        belegung.kolonne.set(key, w);
      }
    }
  };

  const plan: TagesplanTask[] = [];
  const sim: SimTask[] = [];
  const fest: { phase: KernPhase; kranIds: string[]; lauf: TagesLauf }[] = [];
  // Arbeitsstücke des Tages (wer von wann bis wann) — für «Im Einsatz»; aufeinanderfolgende Zeitschritte derselben Arbeit zusammen
  const stuecke: { von: number; bis: number; leute: number; gewerk: string }[] = [];
  const letztesStueck = new Map<SimPhase, { von: number; bis: number; leute: number; gewerk: string }>();
  const geordnet = tasks.map((t, i) => ({ t, i })).sort((a, b) =>
    (a.t.start + (a.t.startZeit ?? "")).localeCompare(b.t.start + (b.t.startZeit ?? "")) || a.i - b.i);
  for (const { t } of geordnet) {
    const liste = (aufwand ? aufwand(t) : aufwandJeTagUndPhaseFuerTask(t, stammdaten, kalender)).get(iso)?.filter(a => a.personenstunden > EPS) ?? [];
    if (liste.length === 0) continue;
    const kranIds = kraeneDesTasks(t, kraene);
    const gespeichert = gueltigeTagesArbeit(t, stammdaten, kalender);
    const laeufe = gespeichert && t.tagesArbeit!.kraene === kraeneText ? gespeichert[iso] : undefined;
    const tp: TagesplanTask = { t, phasen: [], von: Infinity, bis: 0, arbeit: 0, quelle: laeufe ? "optimiert" : t.tagesArbeit ? "veraltet" : "gleichmaessig" };
    plan.push(tp);
    const jeSchritt = new Map<number, SimPhase[]>();
    for (const a of liste) {
      const kern: KernPhase = { position: a.phase.position, gewerkKey: a.phase.gewerkKey, unternehmer: a.phase.unternehmer ?? "",
        kranpflichtig: a.phase.kranpflichtig, kolonne: Math.max(1, a.phase.kolonne), kranAnteil: a.phase.kranAnteil, rest: a.personenstunden };
      const p: TagesplanPhase = { gewerkKey: a.phase.gewerkKey, kuerzel: a.phase.position.split("::")[1] ?? "", arbeit: a.personenstunden,
        von: Infinity, bis: 0, personen: 0, minPersonen: a.phase.kolonne, unterKran: !!pruefung.poolDer(kern, kranIds), kranBegrenzt: false };
      tp.phasen.push(p);
      tp.arbeit += a.personenstunden;
      if (laeufe) {
        // geplanter Ablauf: so übernehmen, wie "Auslastung optimieren" ihn gerechnet hat
        for (const l of laeufe.filter(x => x.pos === a.phase.position)) {
          p.von = Math.min(p.von, l.von); p.bis = Math.max(p.bis, l.bis); p.personen = Math.max(p.personen, l.leute);
          if (l.kran) p.kranBegrenzt = true;
          fest.push({ phase: kern, kranIds, lauf: l });
          stuecke.push({ von: l.von, bis: l.bis, leute: l.leute, gewerk: kern.gewerkKey });
          ueberstundenBuchen(kern, pruefung.kraeneHeute(kern, kranIds), l.von, l.bis, l.leute);
          belegungBuchen(kern, kranIds, l.von, l.bis, l.leute);
        }
      } else {
        jeSchritt.set(a.schritt, [...(jeSchritt.get(a.schritt) ?? []), { ...kern, tp: p }]);
      }
    }
    if (!laeufe) sim.push({ schritte: [...jeSchritt.entries()].sort((x, y) => x[0] - y[0]).map(([, ps]) => ps), schritt: 0, kranIds });
  }

  // übrige Tasks mit dem Rechenkern auf das Personal verteilen, das die geplanten übrig lassen
  for (let slot = 0; slot < N * MAX_TAGE && sim.some(x => x.schritt < x.schritte.length); slot++) {
    const von = slot * slotStd, bis = von + slotStd;
    const zs = new Zeitschritt<SimTask>(iso, kraene, slotStd, false, unternehmer);
    for (const f of fest) {
      const ueberlappung = Math.min(bis, f.lauf.bis) - Math.max(von, f.lauf.von);
      if (ueberlappung > EPS) zs.vorbelegen(f.phase, f.kranIds, f.lauf.leute, ueberlappung / slotStd);
    }
    const offen = sim.filter(x => x.schritt < x.schritte.length);
    const vergabe = vergebeZeitschritt(zs, offen.map(x => ({ ref: x, phasen: x.schritte[x.schritt], kranIds: x.kranIds })));
    for (const p of zs.kranWartend) (p as SimPhase).tp.kranBegrenzt = true;
    for (const v of vergabe) {
      const p = v.p as SimPhase;
      const arbeit = Math.min(p.rest, v.leute * slotStd);
      p.rest -= arbeit;
      const ende = von + arbeit / v.leute;
      p.tp.von = Math.min(p.tp.von, von);
      p.tp.bis = Math.max(p.tp.bis, ende);
      p.tp.personen = Math.max(p.tp.personen, v.leute);
      if (v.kranBegrenzt) p.tp.kranBegrenzt = true;
      ueberstundenBuchen(p, v.kranIds, von, ende, v.leute);
      belegungBuchen(p, v.ref.kranIds, von, ende, v.leute);
      const letztes = letztesStueck.get(p);
      if (letztes && letztes.leute === v.leute && Math.abs(letztes.bis - von) < EPS) letztes.bis = ende;
      else { const neu = { von, bis: ende, leute: v.leute, gewerk: p.gewerkKey }; stuecke.push(neu); letztesStueck.set(p, neu); }
    }
    for (const x of offen) while (x.schritt < x.schritte.length && x.schritte[x.schritt].every(p => p.rest <= EPS)) x.schritt++;
  }

  const jeGewerk = new Map<string, { von: number; bis: number }>();
  let dauer = 0, arbeit = 0;
  for (const tp of plan) {
    for (const p of tp.phasen) {
      if (!isFinite(p.von)) { p.von = 0; p.bis = 0; } // nicht geschafft (Schutzgrenze)
      tp.von = Math.min(tp.von, p.von); tp.bis = Math.max(tp.bis, p.bis);
      const g = jeGewerk.get(p.gewerkKey);
      jeGewerk.set(p.gewerkKey, { von: Math.min(g?.von ?? Infinity, p.von), bis: Math.max(g?.bis ?? 0, p.bis) });
    }
    if (!isFinite(tp.von)) tp.von = 0;
    dauer = Math.max(dauer, tp.bis);
    arbeit += tp.arbeit;
  }
  const arbeitJeGewerk = new Map<string, number>();
  for (const tp of plan) for (const p of tp.phasen) arbeitJeGewerk.set(p.gewerkKey, (arbeitJeGewerk.get(p.gewerkKey) ?? 0) + p.arbeit);
  return { tasks: plan, dauer, arbeit, jeGewerk, ueberstunden, arbeitJeGewerk, imEinsatz: imEinsatzAus(stuecke), belegung };
}

/** Grund, warum ein bereiter Task am Tag nicht arbeitet: kran = in keinem Zeitschritt genug Kranzeit frei, personal = in keinem
 *  Zeitschritt genug Leute im Pool bzw. innerhalb der Grenze des Unternehmers frei, kolonne = seine Kolonne ist den ganzen Tag an anderer Arbeit, wechselnd = Kran und
 *  Personal abwechselnd belegt, frei = Kran und Personal wären zeitweise frei gewesen (Reihenfolge, Termine im Gantt). */
export type WarteGrund = "kran" | "personal" | "kolonne" | "wechselnd" | "frei";
/** autoVorgaenger = beim letzten Optimieren ergänzte Vorgänger (auf Personal/Kran gewartet), die den Task heute noch zurückhalten;
 *  kranzeitLeer = kranpflichtige Positionen am Kran heute ohne Kranzeit % (gerechnet mit 100 %), z.B. «Schalung · FU» */
export interface BereitWartend { t: Task; bereitSeit: string; grund: WarteGrund; kranIds: string[]; autoVorgaenger: Task[]; kranzeitLeer: string[] }

/** Tasks, deren Vorgänger (ohne die vom Optimieren ergänzten) zu Beginn des Tages fertig sind, die aber an diesem Tag nicht
 *  arbeiten — mit dem Grund aus der Belegung des Tages (Plan): für den ersten Schritt seines Arbeitsablaufs wird je Zeitschritt
 *  geprüft, ob Kranzeit, Pool-Personal bzw. Kolonne für die Mindestbesetzung frei gewesen wären (gleiche Regeln wie ablaufKern). */
export function bereitAberNichtDran(iso: string, tasks: Task[], plan: Tagesplan, stammdaten: Stammdaten, kalender: Kalender, kraene: Kran[],
  unternehmer: UnternehmerPersonal[] = [], max = 6): BereitWartend[] {
  const std = stammdaten.arbeitszeitStdProTag || 8;
  const N = slotsProTag();
  const slotStd = std / N;
  const pruefung = new Zeitschritt<null>(iso, kraene, slotStd, false, unternehmer);
  const tagesBeginn: Zeitpunkt = { datum: iso, min: ARBEITSBEGINN_MIN };
  const byId = new Map(tasks.map(t => [t.id, t]));
  const amTag = new Set(plan.tasks.map(z => z.t.id));
  const ergebnis: BereitWartend[] = [];
  const kandidaten = tasks.map((t, i) => ({ t, i }))
    .filter(({ t, i }) => !t.isGroup && !istGruppe(tasks, i) && !t.meilenstein && t.start > iso && !amTag.has(t.id) && hatKalkulationsWerte(t, stammdaten))
    .sort((a, b) => a.t.start.localeCompare(b.t.start) || a.i - b.i);
  for (const { t } of kandidaten) {
    const auto = new Set(t.optimierung?.vorgaenger ?? []);
    const eigene = vorgaengerListe(t).filter(v => !auto.has(v.id));
    if (eigene.length === 0) continue; // ohne Vorgänger: Start laut Gantt (anderer Hinweis)
    let bereit: Zeitpunkt | null = null, offen = false;
    for (const v of eigene) {
      const vt = byId.get(v.id);
      if (!vt?.end) continue;
      const fs = folgeStartZeitpunkt(endZeitpunkt(vt), v.lagDays, kalender);
      if (vergleicheZeitpunkte(fs, tagesBeginn) > 0) { offen = true; break; }
      if (!bereit || vergleicheZeitpunkte(fs, bereit) > 0) bereit = fs;
    }
    if (offen || !bereit) continue;
    const schritt = schritteFuerTask(t, stammdaten)[0];
    if (!schritt) continue;
    const kranIds = kraeneDesTasks(t, kraene);
    let kranFehlt = true, personalFehlt = true, kolonneFehlt = true, frei = false;
    for (let s = 0; s < N && !frei; s++) {
      let kranOk = true, personalOk = true, kolonneOk = true;
      for (const ph of schritt.phasen) {
        const p: KernPhase = { position: ph.position, gewerkKey: ph.gewerkKey, unternehmer: ph.unternehmer, kranpflichtig: ph.kranpflichtig,
          kolonne: Math.max(1, ph.kolonne), kranAnteil: ph.kranAnteil, rest: ph.personenstunden };
        const heute = pruefung.kraeneHeute(p, kranIds);
        const pool = pruefung.poolDer(p, kranIds);
        const unbegrenzt = pruefung.istUnbegrenzt(p.unternehmer);
        const grenze = pruefung.grenzeVon(p.unternehmer);
        const leute = Math.min(pool ? Math.min(p.kolonne, pruefung.poolGroesseVon(pool.key)) : p.kolonne, unbegrenzt ? Infinity : grenze);
        if (heute.some(id => (plan.belegung.kran.get(id)?.[s] ?? 0) + leute / p.kolonne * p.kranAnteil / heute.length > 1 + 1e-6)) kranOk = false;
        if (pool && (plan.belegung.pool.get(pool.key)?.[s] ?? 0) + leute > pruefung.poolGroesseVon(pool.key) + 1e-6) personalOk = false;
        if (isFinite(grenze) && (plan.belegung.unternehmer.get(p.unternehmer)?.[s] ?? 0) + leute > grenze + 1e-6) personalOk = false;
        if (!pool && !unbegrenzt && plan.belegung.kolonne.get(kolonnenSchluessel(p.gewerkKey, p.unternehmer))?.[s]) kolonneOk = false;
      }
      if (kranOk) kranFehlt = false;
      if (personalOk) personalFehlt = false;
      if (kolonneOk) kolonneFehlt = false;
      if (kranOk && personalOk && kolonneOk) frei = true;
    }
    const grund: WarteGrund = frei ? "frei" : kranFehlt ? "kran" : personalFehlt ? "personal" : kolonneFehlt ? "kolonne" : "wechselnd";
    // Positionen, die heute den Kran belegen und ohne Kranzeit % mit 100 % rechnen
    const kranzeitLeer = new Set<string>();
    if (grund === "kran" || grund === "wechselnd") for (const z of plan.tasks) {
      if (!z.t.bauteilKuerzel || !kraeneDesTasks(z.t, kraene).some(id => kranIds.includes(id))) continue;
      for (const ph of z.phasen) {
        const g = stammdaten.gewerke.find(x => x.key === ph.gewerkKey);
        const r = g ? rateFuerKuerzel(g, z.t.bauteilKuerzel) : undefined;
        if (g && r && istRateKranpflichtig(r, g) && r.kranzeitProzent == null) kranzeitLeer.add(`${g.label} · ${r.kuerzel}`);
      }
    }
    const autoVorgaenger = vorgaengerListe(t).filter(v => auto.has(v.id)).map(v => byId.get(v.id)).filter((x): x is Task => !!x);
    ergebnis.push({ t, bereitSeit: bereit.datum, grund, kranIds, autoVorgaenger, kranzeitLeer: [...kranzeitLeer] });
    if (ergebnis.length >= max) break;
  }
  return ergebnis;
}
