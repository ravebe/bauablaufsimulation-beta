// autoVorgaenger.ts — Werkzeug «Auto-Vorgänger» (Tab Bauteile → Werkzeuge): verknüpft Tasks und Gruppen automatisch.
//  - "gantt": streng der Gantt-Reihenfolge nach (Task 2 ← Task 1, Task 3 ← Task 2 …) — alles nacheinander.
//  - "daten": nach den aktuellen Terminen — jeder Task bekommt den Task als Vorgänger, der als letzter endet, bevor er beginnt;
//    was gleichzeitig läuft, bleibt parallel. Tasks ohne Termine werden der Gantt-Reihenfolge nach angehängt.
//  Gruppen nur mit ihren Geschwistern (gleiche Ebene, gleiche Übergruppe), nie eine Untergruppe an die eigene Übergruppe.
//  Vorgänger eines früheren «Auto-Vorgänger» (Task.autoVorgaenger) werden neu bestimmt; Tasks mit anderen Vorgängern (von Hand
//  oder vom Optimieren) bleiben unverändert. Eine Verknüpfung, die einen Zirkelbezug ergäbe, wird übersprungen.
import type { Task } from "../types";
import { istGruppe, getOutlineLevel, vorgaengerListe, mitVorgaengern, zirkelPfad, gruppenDaten } from "../types";
import { startZeitpunkt, endZeitpunkt, vergleicheZeitpunkte } from "./zeitHelpers";

export type AutoVorgaengerModus = "gantt" | "daten";

/** Paare [Task, Vorgänger] nach den aktuellen Terminen: je Element der Vorgänger mit dem spätesten Ende, das nicht nach seinem
 *  Start liegt (bei gleichem Ende der spätere in der Liste); ohne Termine der vorherige in der Liste. */
function paareNachDaten(elemente: { id: string; start: string; end: string; startZeit?: string; endZeit?: string }[]): [string, string][] {
  const paare: [string, string][] = [];
  elemente.forEach((e, i) => {
    if (!e.start || !e.end) { if (i > 0) paare.push([e.id, elemente[i - 1].id]); return; }
    const s = startZeitpunkt(e);
    let bester: { id: string; ende: ReturnType<typeof endZeitpunkt> } | null = null;
    for (const v of elemente) {
      if (v.id === e.id || !v.start || !v.end) continue;
      const ende = endZeitpunkt(v);
      if (vergleicheZeitpunkte(ende, s) >= 0 || vergleicheZeitpunkte(startZeitpunkt(v), s) >= 0) continue;
      if (!bester || vergleicheZeitpunkte(ende, bester.ende) >= 0) bester = { id: v.id, ende };
    }
    if (bester) paare.push([e.id, bester.id]);
  });
  return paare;
}

export function autoVorgaengerSetzen(tasks: Task[], modus: AutoVorgaengerModus): Task[] {
  // 1. Vorgänger eines früheren «Auto-Vorgänger» entfernen — sie werden neu bestimmt
  let neu = tasks.map(t => {
    if (!t.autoVorgaenger?.length) return t;
    const weg = new Set(t.autoVorgaenger);
    return { ...mitVorgaengern(t, vorgaengerListe(t).filter(v => !weg.has(v.id))), autoVorgaenger: undefined };
  });

  // 2. Paare bestimmen: Gruppen unter Geschwistern, Tasks über alle Gruppen hinweg
  const geschwister = new Map<string, Task[]>(); // Übergruppe + Ebene → Gruppen
  const stapel: { id: string; level: number }[] = [];
  neu.forEach((t, i) => {
    const level = getOutlineLevel(t);
    while (stapel.length && stapel[stapel.length - 1].level >= level) stapel.pop();
    if (istGruppe(neu, i)) {
      const key = `${stapel[stapel.length - 1]?.id ?? ""}|${level}`;
      const d = gruppenDaten(neu, i);
      geschwister.set(key, [...(geschwister.get(key) ?? []), { ...t, start: d.start, end: d.end, startZeit: undefined, endZeit: undefined }]);
      stapel.push({ id: t.id, level });
    }
  });
  const echte = neu.filter((_, i) => !istGruppe(neu, i));
  const kette = (liste: { id: string }[]): [string, string][] => liste.slice(1).map((x, i) => [x.id, liste[i].id]);
  const paare: [string, string][] = modus === "gantt"
    ? [...[...geschwister.values()].flatMap(kette), ...kette(echte)]
    : [...[...geschwister.values()].flatMap(paareNachDaten), ...paareNachDaten(echte)];

  // 3. nur Tasks/Gruppen ohne Vorgänger verknüpfen, ohne Zirkelbezug
  for (const [id, predId] of paare) {
    const t = neu.find(x => x.id === id);
    if (!t || vorgaengerListe(t).length > 0 || zirkelPfad(neu, id, predId)) continue;
    neu = neu.map(x => x.id === id ? { ...mitVorgaengern(x, [{ id: predId, lagDays: 0 }]), autoVorgaenger: [predId] } : x);
  }
  return neu;
}
