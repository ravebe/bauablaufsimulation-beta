// auslastungOptimieren.ts — "Auslastung optimieren" (Tab Bauteile → Werkzeuge): plant die Tasks so, dass jede Kolonne aus
// Tab Ressourcen voll ausgelastet und nie doppelt belegt ist.
//  - Jeder Task bekommt seine berechnete Dauer (Tab Kalkulation, dauerBerechnetTask) — jedes Gewerk arbeitet darin mit voller
//    Kolonne und voller Arbeitszeit, die Gewerke nacheinander (wie aufwandJeTagFuerTask in avorHelpers.ts).
//  - Jede Leistungsposition (Gewerk + Kürzel, z.B. Schalung · WB) ist EINE Kolonne: Tasks, die sie brauchen, laufen nacheinander
//    statt parallel. Die Kolonne geht von Bauteil zu Bauteil; andere Gewerke desselben Tasks können parallel zu anderen Tasks
//    laufen (z.B. Wand B wird geschalt, während Wand A betoniert wird).
//  - Vorgänger und Wartetage bleiben massgebend (wie "Berechnete Dauer übernehmen"); Tasks ohne Vorgänger beginnen frühestens
//    an ihrem bisherigen Start. Reihenfolge bei Konkurrenz um dieselbe Kolonne: bisheriger Start, dann Gantt-Reihenfolge.
//  - Tasks ohne Kalkulationswerte, Gruppen und Meilensteine bleiben unverändert.
// Gerechnet wird auf einer Achse in Arbeitsminuten ab dem frühesten Arbeitstag, gerastert auf die Zeiteinheit der Simulation.
import type { Task } from "../types";
import { istGruppe, vorgaengerListe } from "../types";
import type { Stammdaten } from "./stammdatenHelpers";
import { dauerBerechnetTask, hatKalkulationsWerte, schritteFuerTask } from "./stammdatenHelpers";
import type { Kalender } from "./kalenderHelpers";
import type { Zeiteinheit, Zeitpunkt } from "./zeitHelpers";
import {
  startZeitpunkt, endZeitpunkt, naechsteArbeitszeit, endeAusArbeitsMinuten, folgeStartZeitpunkt, arbeitsMinutenZwischen,
  vergleicheZeitpunkte, zeitFelder, rasteUhrzeit, MIN_PRO_ARBEITSTAG, ARBEITSBEGINN_MIN, schrittMinuten,
} from "./zeitHelpers";

interface Phase { position: string; von: number; minuten: number }

/** Phasen eines Tasks nach Arbeitsablauf je Kürzel (Schritte nacheinander, Phasen eines Schritts gleichzeitig), gestreckt auf
 *  die berechnete Dauer des Tasks — von/minuten in Arbeitsminuten ab Task-Start. */
function phasenVon(t: Task, stammdaten: Stammdaten, einheit: Zeiteinheit): { phasen: Phase[]; dauer: number } {
  const schritte = schritteFuerTask(t, stammdaten);
  const dauer = Math.max(dauerBerechnetTask(t, stammdaten, einheit) * MIN_PRO_ARBEITSTAG, schrittMinuten(einheit));
  const summe = schritte.reduce((s, x) => s + x.tage, 0);
  // ohne Leistungswerte (z.B. nur manuell übersteuerte Dauer): keine Kolonne belegt
  if (!(summe > 0)) return { phasen: [], dauer };
  const phasen: Phase[] = [];
  let von = 0;
  for (const s of schritte) {
    for (const p of s.phasen) phasen.push({ position: p.position, von, minuten: dauer * p.tage / summe });
    von += dauer * s.tage / summe;
  }
  return { phasen, dauer };
}

/** Neue Termine aller Tasks nach "Auslastung optimieren" (gleiche Reihenfolge wie tasks). */
export function optimiereAuslastung(tasks: Task[], stammdaten: Stammdaten, kalender: Kalender, einheit: Zeiteinheit = "tage"): Task[] {
  const echte = tasks.map((t, i) => ({ t, i })).filter(({ t, i }) => !t.isGroup && !istGruppe(tasks, i) && !!t.start && !!t.end);
  if (echte.length === 0) return tasks;
  const byId = new Map(tasks.map(t => [t.id, t]));
  const planbar = new Set(echte.filter(({ t }) => !t.meilenstein && hatKalkulationsWerte(t, stammdaten)).map(({ t }) => t.id));

  // Achse: Arbeitsminuten ab Arbeitsbeginn des frühesten Starts — Vielfache von schrittMinuten liegen auf Tages-/Halbtags-/
  // Stundengrenzen der Zeiteinheit
  const frueh = echte.map(({ t }) => startZeitpunkt(t)).reduce((a, b) => vergleicheZeitpunkte(a, b) <= 0 ? a : b);
  const anker = naechsteArbeitszeit({ datum: frueh.datum, min: ARBEITSBEGINN_MIN }, kalender);
  const schritt = schrittMinuten(einheit);
  const aufRaster = (m: number) => Math.ceil(m / schritt - 1e-9) * schritt;
  const minutenVon = (p: Zeitpunkt) => vergleicheZeitpunkte(p, anker) <= 0 ? 0 : arbeitsMinutenZwischen(anker, p, kalender);
  const startAus = (m: number): Zeitpunkt => {
    const p = m <= 0 ? anker : naechsteArbeitszeit(endeAusArbeitsMinuten(anker, m, kalender), kalender);
    return einheit === "tage" ? { datum: p.datum, min: ARBEITSBEGINN_MIN } : { datum: p.datum, min: rasteUhrzeit(p.min, "start", einheit) };
  };

  const ergebnis = new Map<string, { start: Zeitpunkt; end: Zeitpunkt }>();
  const belegt = new Map<string, [number, number][]>(); // Leistungsposition → belegte Intervalle [von, bis) in Arbeitsminuten
  const endeVon = (id: string): Zeitpunkt | null => {
    const r = ergebnis.get(id);
    if (r) return r.end;
    const t = byId.get(id);
    return t?.end ? endZeitpunkt(t) : null;
  };

  // Reihenfolge: Vorgänger zuerst (nur planbare zählen als Abhängigkeit), bei Gleichstand bisheriger Start, dann Gantt-Reihenfolge
  const offen = echte.filter(({ t }) => planbar.has(t.id));
  const fertig = new Set<string>();
  const bereit = (t: Task) => vorgaengerListe(t).every(v => !planbar.has(v.id) || fertig.has(v.id));
  const prio = (a: { t: Task; i: number }, b: { t: Task; i: number }) => vergleicheZeitpunkte(startZeitpunkt(a.t), startZeitpunkt(b.t)) || a.i - b.i;

  while (offen.length > 0) {
    const kandidaten = offen.filter(({ t }) => bereit(t)).sort(prio);
    const naechster = kandidaten[0] ?? [...offen].sort(prio)[0]; // Zyklus-Schutz (sollte durch istZirkular() nie vorkommen)
    offen.splice(offen.indexOf(naechster), 1);
    const t = naechster.t;

    // frühester Start: spätester Folge-Start aller Vorgänger, ohne Vorgänger der bisherige Start
    const vorg = vorgaengerListe(t);
    let frueheste: Zeitpunkt | null = null;
    for (const v of vorg) {
      const e = endeVon(v.id);
      if (!e) continue;
      const f = folgeStartZeitpunkt(e, v.lagDays, kalender);
      if (!frueheste || vergleicheZeitpunkte(f, frueheste) > 0) frueheste = f;
    }
    const basis = frueheste ?? naechsteArbeitszeit(startZeitpunkt(t), kalender);
    let s = aufRaster(minutenVon(basis));

    // so lange verschieben, bis keine Phase mit einer bereits belegten Kolonne kollidiert
    const { phasen, dauer } = phasenVon(t, stammdaten, einheit);
    for (let runde = 0; runde < 100000; runde++) {
      let konflikt = 0;
      for (const ph of phasen) {
        const von = s + ph.von, bis = von + ph.minuten;
        for (const [a, b] of belegt.get(ph.position) ?? []) {
          if (a < bis - 1e-6 && b > von + 1e-6) { konflikt = Math.max(konflikt, b - von); }
        }
        if (konflikt > 0) break;
      }
      if (konflikt <= 0) break;
      s = aufRaster(s + konflikt);
    }
    for (const ph of phasen) {
      const liste = belegt.get(ph.position) ?? [];
      liste.push([s + ph.von, s + ph.von + ph.minuten]);
      belegt.set(ph.position, liste);
    }

    const start = startAus(s);
    ergebnis.set(t.id, { start, end: endeAusArbeitsMinuten(start, dauer, kalender) });
    fertig.add(t.id);
  }

  return tasks.map(t => {
    const r = ergebnis.get(t.id);
    return r ? { ...t, ...zeitFelder(r.start, r.end) } : t;
  });
}

/** Tasks, deren Termine sich mit optimiereAuslastung() ändern würden. */
export function auslastungAbweichendeTasks(tasks: Task[], stammdaten: Stammdaten, kalender: Kalender, einheit: Zeiteinheit = "tage"): Task[] {
  const neu = optimiereAuslastung(tasks, stammdaten, kalender, einheit);
  return tasks.filter((t, i) => neu[i].start !== t.start || neu[i].end !== t.end || neu[i].startZeit !== t.startZeit || neu[i].endZeit !== t.endZeit);
}
