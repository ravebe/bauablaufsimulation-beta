// tagesplan.ts — Wie die Arbeit eines Tages abläuft (Tab AVOR → Tagesablauf, Spalte "Dauer", Überstunden):
//  - Tasks, die "Auslastung optimieren" geplant hat und die seither unverändert sind (Task.tagesArbeit gültig, gleiche Kräne &
//    Personal): genau der dort gerechnete Ablauf — wer von wann bis wann mit wie vielen Leuten an welcher Arbeit.
//  - Alle anderen Tasks: ihre Arbeit des Tages (aufwandJeTagUndPhaseFuerTask, gleichmässig über ihre Tage im Gantt) wird mit dem
//    gemeinsamen Rechenkern (ablaufKern.ts) — denselben Regeln und Zeitschritten wie "Auslastung optimieren" — auf das Personal
//    verteilt, das die geplanten Tasks übrig lassen. Schritte eines Tasks nacheinander, Tasks in der Reihenfolge ihres Starts.
//  - Überstunden: was nach Arbeitsende (Std./Tag) noch gearbeitet wird — Personenstunden je Unternehmer, Kranstunden je Kran.
import type { Task, Kran, TagesLauf } from "../types";
import type { Stammdaten } from "./stammdatenHelpers";
import type { Kalender } from "./kalenderHelpers";
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
export interface Ueberstunden { jeUnternehmer: Map<string, number>; jeKran: Map<string, number> }
export const unternehmerLabel = (u: string) => u || "ohne Unternehmer";
export interface Tagesplan { tasks: TagesplanTask[]; dauer: number; arbeit: number; jeGewerk: Map<string, { von: number; bis: number }>; ueberstunden: Ueberstunden }

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

export function tagesplan(iso: string, tasks: Task[], stammdaten: Stammdaten, kalender: Kalender, kraene: Kran[], aufwand?: AufwandQuelle): Tagesplan {
  const std = stammdaten.arbeitszeitStdProTag || 8;
  const N = slotsProTag();
  const slotStd = std / N;
  const kraeneText = kranSchluessel(kraene);
  const pruefung = new Zeitschritt<SimTask>(iso, kraene, slotStd, false); // nur zum Nachschlagen von Pools und verfügbaren Kränen

  const ueberstunden: Ueberstunden = { jeUnternehmer: new Map(), jeKran: new Map() };
  /** Teil von [von, bis) nach Arbeitsende als Überstunden: Personenstunden des Unternehmers, Kranstunden der heutigen Kräne */
  const ueberstundenBuchen = (p: KernPhase, kranIdsHeute: string[], von: number, bis: number, leute: number) => {
    const nach = bis - Math.max(von, std);
    if (nach <= EPS) return;
    const u = ueberstunden.jeUnternehmer;
    u.set(p.unternehmer, (u.get(p.unternehmer) ?? 0) + leute * nach);
    for (const id of kranIdsHeute) {
      ueberstunden.jeKran.set(id, (ueberstunden.jeKran.get(id) ?? 0) + leute / Math.max(1, p.kolonne) * p.kranAnteil / kranIdsHeute.length * nach);
    }
  };

  const plan: TagesplanTask[] = [];
  const sim: SimTask[] = [];
  const fest: { phase: KernPhase; kranIds: string[]; lauf: TagesLauf }[] = [];
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
          ueberstundenBuchen(kern, pruefung.kraeneHeute(kern, kranIds), l.von, l.bis, l.leute);
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
    const zs = new Zeitschritt<SimTask>(iso, kraene, slotStd, false);
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
  return { tasks: plan, dauer, arbeit, jeGewerk, ueberstunden };
}
