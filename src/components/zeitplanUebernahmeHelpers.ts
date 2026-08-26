// zeitplanUebernahmeHelpers.ts — "Berechnete Dauer übernehmen" (Tab Bauteile): überträgt die in Tab
// Kalkulation ermittelte Dauer jedes Tasks in den tatsächlichen Bauablauf (Start/Ende), entlang der
// bestehenden Vorgänger-Kette. Nur möglich, wenn die Mengenermittlung fehlerfrei ist UND jeder Task
// (außer dem ersten) einen Vorgänger hat — siehe pruefeZeitplanBereitschaft().
import type { Task } from "../types";
import { istGruppe, datumPlusTage } from "../types";
import type { Stammdaten } from "./stammdatenHelpers";
import { dauerBerechnetTask } from "./stammdatenHelpers";
import type { Kalender } from "./kalenderHelpers";
import { endDatumAusArbeitstagen } from "./kalenderHelpers";

export interface ZeitplanBereitschaft {
  bereit: boolean;
  fehlerTasks: { id: string; name: string }[];       // Tasks mit mind. einem Gewerk auf mengenQuelle "fehler"
  fehlendeVorgaenger: { id: string; name: string }[]; // Tasks (ausser dem ersten) ohne predecessorId
  keineTasks: boolean;                                // kein einziger (nicht-Gruppen-)Task vorhanden
}

/** Nur "echte" Tasks zählen (keine Gruppen — deren Zeitraum leitet sich aus den Kindern ab, siehe
 *  gruppenDaten(), und sie tragen selbst keine Mengen/Dauer). */
function echteTasks(tasks: Task[]): Task[] {
  return tasks.filter((t, i) => !t.isGroup && !istGruppe(tasks, i));
}

/** Prüft, ob "Berechnete Dauer übernehmen" ausgeführt werden darf. */
export function pruefeZeitplanBereitschaft(tasks: Task[]): ZeitplanBereitschaft {
  const echte = echteTasks(tasks);
  const ersterId = echte[0]?.id;

  const fehlerTasks = echte
    .filter(t => Object.values(t.mengenQuelle ?? {}).includes("fehler"))
    .map(t => ({ id: t.id, name: t.name }));

  const fehlendeVorgaenger = echte
    .filter(t => t.id !== ersterId && !t.predecessorId)
    .map(t => ({ id: t.id, name: t.name }));

  return {
    bereit: echte.length > 0 && fehlerTasks.length === 0 && fehlendeVorgaenger.length === 0,
    fehlerTasks, fehlendeVorgaenger, keineTasks: echte.length === 0,
  };
}

/** Überträgt für jeden echten Task die in Tab Kalkulation berechnete Dauer auf Start/Ende — der
 *  erste Task behält sein bestehendes Startdatum (Anker der Kette), alle anderen starten am Ende
 *  ihres Vorgängers + Wartetage (dieselbe Logik wie kaskadiereNachfolger/ganttSetPredecessor). Geht
 *  rekursiv/memoisiert vor, damit die Reihenfolge im Array keine Rolle spielt. Gruppen werden nicht
 *  verändert, ihre Anzeige leitet sich weiterhin aus den (hier aktualisierten) Kind-Tasks ab. */
export function berechneZeitplanUebernahme(tasks: Task[], stammdaten: Stammdaten, kalender: Kalender): Task[] {
  const byId = new Map(tasks.map(t => [t.id, t]));
  const ersterId = echteTasks(tasks)[0]?.id;
  const geloest = new Map<string, { start: string; end: string }>();
  const inArbeit = new Set<string>();

  function loese(id: string): { start: string; end: string } {
    const cached = geloest.get(id);
    if (cached) return cached;
    const t = byId.get(id);
    if (!t) return { start: "", end: "" };
    if (inArbeit.has(id)) return { start: t.start, end: t.end }; // Zyklus-Schutz (sollte durch istZirkular() nie vorkommen)
    inArbeit.add(id);

    const dauer = dauerBerechnetTask(t, stammdaten);
    const start = (id === ersterId || !t.predecessorId)
      ? t.start
      : (() => { const v = loese(t.predecessorId!); return v.end ? datumPlusTage(v.end, t.lagDays ?? 0) : t.start; })();
    const end = endDatumAusArbeitstagen(start, dauer, kalender);

    const result = { start, end };
    geloest.set(id, result);
    inArbeit.delete(id);
    return result;
  }

  return tasks.map((t, i) => {
    if (t.isGroup || istGruppe(tasks, i)) return t;
    const { start, end } = loese(t.id);
    return { ...t, start, end };
  });
}
