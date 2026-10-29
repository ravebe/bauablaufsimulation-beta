// tagesplan.ts — Wie die Arbeit eines Tages laut Gantt tatsächlich abläuft (Tab AVOR → Tagesablauf und Spalte "Dauer"): die Arbeit
// jedes Tasks an diesem Tag (aufwandJeTagUndPhaseFuerTask) wird in Viertelstunden auf das Personal verteilt — mit denselben Regeln
// wie "Auslastung optimieren" (auslastungOptimierenKran.ts):
//  - Personal unter dem Kran (Tab Ressourcen → Kräne & Personal) ist je Unternehmer ein Team von Allroundern: jede Arbeit bekommt
//    zuerst ihre Min. Personen, übrige Leute verstärken bis auf die doppelten Min. Personen.
//  - Positionen ohne Personal unter dem Kran arbeiten mit ihren Min. Personen, dieselbe Position nie an zwei Tasks gleichzeitig.
//  - Kranzeit: eine kranpflichtige Arbeit belegt den Kran mit Personen ÷ Min. Personen × Kranzeit % — mehr Leute machen eine Arbeit
//    nur schneller, solange der Kran nachkommt.
//  - Schritte eines Tasks nacheinander (Arbeitsablauf je Leistungsposition), Tasks in der Reihenfolge ihres Starts.
//  - Überstunden: was nach Arbeitsende (Std./Tag) noch gearbeitet wird — Personenstunden je Unternehmer, Kranstunden je Kran.
import type { Task, Kran } from "../types";
import type { Stammdaten } from "./stammdatenHelpers";
import type { Kalender } from "./kalenderHelpers";
import { aufwandJeTagUndPhaseFuerTask } from "./avorHelpers";
import type { PhasenAufwand } from "./avorHelpers";
import { kraeneDesTasks, istKranVerfuegbarAn, kranPersonalAmTag } from "./kranHelpers";

const SLOT = 0.25; // Stunden
const MAX_TAGE = 5; // Schutz: so weit über den Arbeitstag hinaus wird gerechnet
const MAX_VERSTAERKUNG = 2;
const EPS = 1e-9;

export interface TagesplanPhase {
  gewerkKey: string; kuerzel: string; arbeit: number; // Personenstunden des Tages
  von: number; bis: number; // Stunden ab Arbeitsbeginn
  personen: number; // grösste Besetzung
  minPersonen: number;
  unterKran: boolean; // aus dem Personal unter dem Kran besetzt
  kranBegrenzt: boolean; // mehr Leute wären frei gewesen, aber die Kranzeit reichte nicht
}
export interface TagesplanTask { t: Task; phasen: TagesplanPhase[]; von: number; bis: number; arbeit: number }
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

interface PhaseZ {
  p: TagesplanPhase; rest: number; kolonne: number; position: string; kranAnteil: number;
  poolKey: string | null; poolGroesse: number; kraene: string[]; unternehmer: string;
}

export function tagesplan(iso: string, tasks: Task[], stammdaten: Stammdaten, kalender: Kalender, kraene: Kran[], aufwand?: AufwandQuelle): Tagesplan {
  const kranById = new Map(kraene.map(k => [k.id, k]));
  const kraeneHeute = kraene.filter(k => istKranVerfuegbarAn(k, iso));
  const poolGroessen = new Map<string, number>();
  for (const k of kraeneHeute) for (const [u, n] of kranPersonalAmTag(k, iso)) poolGroessen.set(`${k.id}|${u}`, n);

  // je Task die Schritte des Tages
  const plan: { tp: TagesplanTask; schritte: PhaseZ[][]; schritt: number }[] = [];
  const geordnet = tasks.map((t, i) => ({ t, i })).sort((a, b) =>
    (a.t.start + (a.t.startZeit ?? "")).localeCompare(b.t.start + (b.t.startZeit ?? "")) || a.i - b.i);
  for (const { t } of geordnet) {
    const liste = (aufwand ? aufwand(t) : aufwandJeTagUndPhaseFuerTask(t, stammdaten, kalender)).get(iso)?.filter(a => a.personenstunden > EPS) ?? [];
    if (liste.length === 0) continue;
    const kranIds = kraeneDesTasks(t, kraene).filter(id => { const k = kranById.get(id); return !!k && istKranVerfuegbarAn(k, iso); });
    const jeSchritt = new Map<number, PhaseZ[]>();
    const tp: TagesplanTask = { t, phasen: [], von: Infinity, bis: 0, arbeit: 0 };
    for (const a of liste) {
      const kr = a.phase.kranpflichtig ? kranIds : [];
      const poolKey = kr.map(id => `${id}|${a.phase.unternehmer}`).find(key => a.phase.unternehmer && (poolGroessen.get(key) ?? 0) > 0) ?? null;
      const p: TagesplanPhase = { gewerkKey: a.phase.gewerkKey, kuerzel: a.phase.position.split("::")[1] ?? "", arbeit: a.personenstunden,
        von: Infinity, bis: 0, personen: 0, minPersonen: a.phase.kolonne, unterKran: !!poolKey, kranBegrenzt: false };
      tp.phasen.push(p);
      tp.arbeit += a.personenstunden;
      const z: PhaseZ = { p, rest: a.personenstunden, kolonne: Math.max(1, a.phase.kolonne), position: a.phase.position, kranAnteil: a.phase.kranAnteil,
        poolKey, poolGroesse: poolKey ? poolGroessen.get(poolKey)! : 0, kraene: kr, unternehmer: a.phase.unternehmer ?? "" };
      jeSchritt.set(a.schritt, [...(jeSchritt.get(a.schritt) ?? []), z]);
    }
    plan.push({ tp, schritte: [...jeSchritt.entries()].sort((x, y) => x[0] - y[0]).map(([, ps]) => ps), schritt: 0 });
  }

  const std = stammdaten.arbeitszeitStdProTag || 8;
  const ueberstunden: Ueberstunden = { jeUnternehmer: new Map(), jeKran: new Map() };
  const maxSlots = Math.ceil(std * MAX_TAGE / SLOT);
  for (let slot = 0; slot < maxSlots; slot++) {
    const offen = plan.filter(x => x.schritt < x.schritte.length);
    if (offen.length === 0) break;
    const t0 = slot * SLOT;
    const kranZeit = new Map(kraeneHeute.map(k => [k.id, 1]));
    const poolFrei = new Map(poolGroessen);
    const positionBelegt = new Set<string>();
    const vergabe: { z: PhaseZ; leute: number }[] = [];
    const belegung = (z: PhaseZ, leute: number) => z.kraene.length > 0 ? leute / z.kolonne * z.kranAnteil / z.kraene.length : 0;
    const kranPlatz = (z: PhaseZ) => z.kraene.length === 0 || z.kranAnteil <= 0 ? Infinity
      : Math.floor(Math.min(...z.kraene.map(id => kranZeit.get(id) ?? 0)) / belegung(z, 1) + 1e-6);
    const kranAbziehen = (z: PhaseZ, leute: number) => { for (const id of z.kraene) kranZeit.set(id, (kranZeit.get(id) ?? 0) - belegung(z, leute)); };

    // 1) Mindestbesetzung je laufender Arbeit
    for (const x of offen) for (const z of x.schritte[x.schritt]) {
      if (z.rest <= EPS) continue;
      const sinnvoll = Math.max(1, Math.ceil(z.rest / SLOT - EPS));
      if (z.poolKey) {
        const mindest = Math.min(z.kolonne, z.poolGroesse, sinnvoll);
        if ((poolFrei.get(z.poolKey) ?? 0) < mindest) continue;
        if (kranPlatz(z) < mindest) { z.p.kranBegrenzt = true; continue; }
        poolFrei.set(z.poolKey, poolFrei.get(z.poolKey)! - mindest);
        kranAbziehen(z, mindest);
        vergabe.push({ z, leute: mindest });
      } else {
        if (positionBelegt.has(z.position)) continue;
        if (kranPlatz(z) < z.kolonne) { z.p.kranBegrenzt = true; continue; }
        positionBelegt.add(z.position);
        kranAbziehen(z, z.kolonne);
        vergabe.push({ z, leute: z.kolonne });
      }
    }
    // 2) übrige Leute des Teams verstärken (grösster Rest zuerst), höchstens doppelte Min. Personen und soweit der Kran nachkommt
    for (const v of [...vergabe].filter(v => v.z.poolKey).sort((a, b) => b.z.rest - a.z.rest)) {
      const frei = poolFrei.get(v.z.poolKey!) ?? 0;
      const wunsch = Math.min(frei, MAX_VERSTAERKUNG * v.z.kolonne - v.leute, Math.max(1, Math.ceil(v.z.rest / SLOT - EPS)) - v.leute);
      if (wunsch <= 0) continue;
      const extra = Math.min(wunsch, kranPlatz(v.z));
      if (extra < wunsch) v.z.p.kranBegrenzt = true;
      if (extra <= 0) continue;
      v.leute += extra;
      poolFrei.set(v.z.poolKey!, frei - extra);
      kranAbziehen(v.z, extra);
    }
    // 3) Arbeit leisten
    for (const v of vergabe) {
      const vorher = v.z.rest;
      v.z.rest = Math.max(0, vorher - v.leute * SLOT);
      const p = v.z.p;
      const ende = t0 + Math.min(SLOT, vorher / v.leute);
      p.von = Math.min(p.von, t0);
      p.bis = Math.max(p.bis, ende);
      // Überstunden: der Teil dieser Viertelstunde nach Arbeitsende
      const nachArbeitsende = ende - Math.max(t0, std);
      if (nachArbeitsende > EPS) {
        const u = ueberstunden.jeUnternehmer;
        u.set(v.z.unternehmer, (u.get(v.z.unternehmer) ?? 0) + v.leute * nachArbeitsende);
        for (const id of v.z.kraene) ueberstunden.jeKran.set(id, (ueberstunden.jeKran.get(id) ?? 0) + belegung(v.z, v.leute) * nachArbeitsende);
      }
      p.personen = Math.max(p.personen, v.leute);
    }
    for (const x of offen) while (x.schritt < x.schritte.length && x.schritte[x.schritt].every(z => z.rest <= EPS)) x.schritt++;
  }

  const jeGewerk = new Map<string, { von: number; bis: number }>();
  let dauer = 0, arbeit = 0;
  for (const { tp } of plan) {
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
  return { tasks: plan.map(x => x.tp), dauer, arbeit, jeGewerk, ueberstunden };
}
