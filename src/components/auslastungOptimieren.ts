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
import type { Task, Kran } from "../types";
import { istGruppe, vorgaengerListe, mitVorgaengern } from "../types";
import type { Stammdaten } from "./stammdatenHelpers";
import { dauerBerechnetTask, hatKalkulationsWerte, schritteFuerTask } from "./stammdatenHelpers";
import type { Kalender } from "./kalenderHelpers";
import type { Zeiteinheit, Zeitpunkt } from "./zeitHelpers";
import {
  startZeitpunkt, endZeitpunkt, naechsteArbeitszeit, endeAusArbeitsMinuten, folgeStartZeitpunkt, arbeitsMinutenZwischen,
  vergleicheZeitpunkte, zeitFelder, rasteUhrzeit, MIN_PRO_ARBEITSTAG, ARBEITSBEGINN_MIN, schrittMinuten, minZuZeit, zeitZuMin,
} from "./zeitHelpers";
import { hatKranPersonal } from "./kranHelpers";
import { optimiereMitKranpersonal, restkettenJeTask } from "./auslastungOptimierenKran";
import type { OptimierReihenfolge } from "./auslastungOptimierenKran";
export type { OptimierReihenfolge } from "./auslastungOptimierenKran";

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

const zpText = (p: Zeitpunkt) => `${p.datum} ${minZuZeit(p.min)}`;

/** Ausgangslage fürs Optimieren: automatisch ergänzte Vorgänger eines früheren Optimierens (Task.optimierung) entfernt und, solange
 *  der Start seither unverändert ist, der Start von vor dem Optimieren — so hängt das Ergebnis nicht davon ab, wie oft schon
 *  optimiert wurde. */
function optimierBasis(t: Task): Task {
  const o = t.optimierung;
  if (!o) return t;
  const auto = new Set(o.vorgaenger);
  let basis = auto.size > 0 ? mitVorgaengern(t, vorgaengerListe(t).filter(v => !auto.has(v.id))) : t;
  if (zpText(startZeitpunkt(t)) === o.start) {
    const [datum, zeit] = o.freigabe.split(" ");
    const min = zeitZuMin(zeit, ARBEITSBEGINN_MIN);
    basis = { ...basis, start: datum, startZeit: min === ARBEITSBEGINN_MIN ? undefined : zeit, end: basis.end < datum ? datum : basis.end };
  }
  return basis;
}

/** Ergänzte Vorgänger nur, wo sie nötig sind: gilt ein ergänzter Vorgänger schon über eine Kette anderer Vorgänger des Tasks (ohne
 *  negative Wartetage), ändert er nichts und entfällt — so bleiben nur die Vorgänger, die die Reihenfolge der Optimierung festhalten. */
function nurNoetigeVorgaenger(basis: Task[], roh: Task[]): Task[] {
  const vorg = new Map(roh.map(t => [t.id, vorgaengerListe(t)]));
  const erreicht = (von: string, ziel: string): boolean => {
    const besucht = new Set<string>();
    const stapel = [von];
    while (stapel.length) {
      const id = stapel.pop()!;
      if (id === ziel) return true;
      if (besucht.has(id)) continue;
      besucht.add(id);
      for (const v of vorg.get(id) ?? []) if (v.lagDays >= 0) stapel.push(v.id);
    }
    return false;
  };
  return roh.map((t, i) => {
    if (t === basis[i]) return t;
    const bisher = new Set(vorgaengerListe(basis[i]).map(v => v.id));
    const liste = vorgaengerListe(t);
    const neu = liste.filter(v => !bisher.has(v.id));
    if (neu.length === 0) return t;
    const behalten = liste.filter(v => bisher.has(v.id) || !liste.some(w => w.id !== v.id && w.lagDays >= 0 && erreicht(w.id, v.id)));
    if (behalten.length === liste.length) return t;
    vorg.set(t.id, behalten);
    return mitVorgaengern(t, behalten);
  });
}

/** Neue Termine aller Tasks nach "Auslastung optimieren" (gleiche Reihenfolge wie tasks). Ist in Tab Ressourcen Personal unter
 *  den Kränen erfasst, plant optimiereMitKranpersonal (Pools je Kran und Unternehmer), sonst diese Kolonnen-Variante. Geplante
 *  Tasks merken sich in Task.optimierung ihren Start von vorher und die ergänzten Vorgänger (siehe optimierBasis) — erneutes
 *  Optimieren ergibt dasselbe Ergebnis. lueckenFuellen siehe optimiereMitKranpersonal. */
export function optimiereAuslastung(tasks: Task[], stammdaten: Stammdaten, kalender: Kalender, einheit: Zeiteinheit = "tage", kraene: Kran[] = [],
  reihenfolge: OptimierReihenfolge = "kritischerPfad", lueckenFuellen = false): Task[] {
  const basis = tasks.map(optimierBasis);
  const roh = hatKranPersonal(kraene)
    ? optimiereMitKranpersonal(basis, stammdaten, kalender, einheit, kraene, reihenfolge, lueckenFuellen)
    : optimiereKolonnen(basis, stammdaten, kalender, einheit, reihenfolge);
  const geprueft = nurNoetigeVorgaenger(basis, roh);
  return tasks.map((t, i) => {
    const neu = geprueft[i];
    if (roh[i] === basis[i]) return t; // nicht geplant (Gruppe, Meilenstein, ohne Kalkulation) — unverändert
    const bisher = new Set(vorgaengerListe(basis[i]).map(v => v.id));
    const freigabe = t.optimierung && zpText(startZeitpunkt(t)) === t.optimierung.start ? t.optimierung.freigabe : zpText(startZeitpunkt(t));
    return { ...neu, optimierung: { freigabe, start: zpText(startZeitpunkt(neu)), vorgaenger: vorgaengerListe(neu).filter(v => !bisher.has(v.id)).map(v => v.id) } };
  });
}

function optimiereKolonnen(tasks: Task[], stammdaten: Stammdaten, kalender: Kalender, einheit: Zeiteinheit, reihenfolge: OptimierReihenfolge): Task[] {
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
  const belegt = new Map<string, [number, number, string][]>(); // Leistungsposition → belegte Intervalle [von, bis) in Arbeitsminuten + Task
  const zusatzVorgaenger = new Map<string, string>(); // Task, der auf eine Kolonne warten musste → Task, nach dem sie frei wurde
  const endeVon = (id: string): Zeitpunkt | null => {
    const r = ergebnis.get(id);
    if (r) return r.end;
    const t = byId.get(id);
    return t?.end ? endZeitpunkt(t) : null;
  };

  // Reihenfolge: Vorgänger zuerst (nur planbare zählen als Abhängigkeit), dann nach Option kritischer Pfad (längste Restkette,
  // bei Gleichstand bisheriger Start, dann Gantt-Reihenfolge), Startdatum (bisheriger Start, dann Gantt) oder Gantt-Reihenfolge
  const offen = echte.filter(({ t }) => planbar.has(t.id));
  const fertig = new Set<string>();
  const bereit = (t: Task) => vorgaengerListe(t).every(v => !planbar.has(v.id) || fertig.has(v.id));
  const ketten = restkettenJeTask(offen.map(o => o.t), stammdaten, einheit);
  const prio = reihenfolge === "gantt"
    ? (a: { t: Task; i: number }, b: { t: Task; i: number }) => a.i - b.i
    : reihenfolge === "startdatum"
    ? (a: { t: Task; i: number }, b: { t: Task; i: number }) => vergleicheZeitpunkte(startZeitpunkt(a.t), startZeitpunkt(b.t)) || a.i - b.i
    : (a: { t: Task; i: number }, b: { t: Task; i: number }) => (ketten.get(b.t.id) ?? 0) - (ketten.get(a.t.id) ?? 0)
      || vergleicheZeitpunkte(startZeitpunkt(a.t), startZeitpunkt(b.t)) || a.i - b.i;

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
    let blockiert: string | null = null; // Task, dessen Kolonne zuletzt im Weg war
    for (let runde = 0; runde < 100000; runde++) {
      let konflikt = 0;
      for (const ph of phasen) {
        const von = s + ph.von, bis = von + ph.minuten;
        for (const [a, b, id] of belegt.get(ph.position) ?? []) {
          if (a < bis - 1e-6 && b > von + 1e-6 && b - von > konflikt) { konflikt = b - von; blockiert = id; }
        }
        if (konflikt > 0) break;
      }
      if (konflikt <= 0) break;
      s = aufRaster(s + konflikt);
    }
    for (const ph of phasen) {
      const liste = belegt.get(ph.position) ?? [];
      liste.push([s + ph.von, s + ph.von + ph.minuten, t.id]);
      belegt.set(ph.position, liste);
    }

    const start = startAus(s);
    ergebnis.set(t.id, { start, end: endeAusArbeitsMinuten(start, dauer, kalender) });
    fertig.add(t.id);
    // auf die Kolonne gewartet → der blockierende Task wird zusätzlicher Vorgänger, sofern er vor diesem Start endet
    const vorher = blockiert ? ergebnis.get(blockiert) : undefined;
    if (blockiert && vorher && !vorg.some(v => v.id === blockiert) && vergleicheZeitpunkte(folgeStartZeitpunkt(vorher.end, 0, kalender), start) <= 0) {
      zusatzVorgaenger.set(t.id, blockiert);
    }
  }

  return tasks.map(t => {
    const r = ergebnis.get(t.id);
    if (!r) return t;
    const neu = { ...t, ...zeitFelder(r.start, r.end), tagesArbeit: undefined }; // Kolonnen arbeiten gleichmässig über die Dauer
    const zusatz = zusatzVorgaenger.get(t.id);
    return zusatz ? mitVorgaengern(neu, [...vorgaengerListe(t), { id: zusatz, lagDays: 0 }]) : neu;
  });
}

/** Kurze Signatur aller Termine (und Vorgänger) — nach "Auslastung optimieren" in SimProjekt.optimiertStand gemerkt: solange sie
 *  gleich bleibt, sind Abweichungen zur berechneten Dauer gewollt (Verstärkung, Wartezeiten, Raster) und werden nicht gemeldet. */
export function terminSignatur(tasks: Task[]): string {
  let h = 5381;
  for (const t of tasks) {
    const text = `${t.id}|${t.start}|${t.end}|${t.startZeit ?? ""}|${t.endZeit ?? ""}|${vorgaengerListe(t).map(v => v.id + ":" + v.lagDays).join(",")};`;
    for (let i = 0; i < text.length; i++) h = ((h * 33) ^ text.charCodeAt(i)) >>> 0;
  }
  return `${tasks.length}-${h.toString(36)}`;
}

/** Tasks, deren Termine sich mit optimiereAuslastung() ändern würden. */
export function auslastungAbweichendeTasks(tasks: Task[], stammdaten: Stammdaten, kalender: Kalender, einheit: Zeiteinheit = "tage", kraene: Kran[] = []): Task[] {
  // nur Termine vergleichen — ergänzte Vorgänger allein sind keine Abweichung
  const neu = optimiereAuslastung(tasks, stammdaten, kalender, einheit, kraene);
  return tasks.filter((t, i) => neu[i].start !== t.start || neu[i].end !== t.end || neu[i].startZeit !== t.startZeit || neu[i].endZeit !== t.endZeit);
}
