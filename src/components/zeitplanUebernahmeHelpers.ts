// zeitplanUebernahmeHelpers.ts — "Berechnete Dauer übernehmen" (Tab Bauteile): überträgt die in Tab
// Kalkulation ermittelte Dauer jedes Tasks in den tatsächlichen Bauablauf (Start/Ende), entlang der
// bestehenden Vorgänger-Kette. Nur möglich, wenn die Mengenermittlung fehlerfrei ist — siehe
// pruefeZeitplanBereitschaft(). Ein fehlender Vorgänger ist dabei kein Ausschlusskriterium mehr:
// berechneZeitplanUebernahme() verankert einen Task ohne predecessorId einfach an seinem bisherigen
// Startdatum (siehe loese() unten), das funktioniert unabhängig von der Vorgänger-Kette.
import type { Task } from "../types";
import { istGruppe, vorgaengerListe } from "../types";
import type { Stammdaten } from "./stammdatenHelpers";
import { dauerBerechnetTask, gewerkeFuerKuerzel, hatKalkulationsWerte } from "./stammdatenHelpers";
import type { Kalender } from "./kalenderHelpers";
import type { Zeiteinheit, Zeitpunkt } from "./zeitHelpers";
import { startZeitpunkt, endZeitpunkt, naechsteArbeitszeit, endeAusArbeitsMinuten, folgeStartZeitpunkt, vergleicheZeitpunkte, zeitFelder, MIN_PRO_ARBEITSTAG, schrittMinuten } from "./zeitHelpers";

export interface ZeitplanBereitschaft {
  bereit: boolean;
  fehlerTasks: { id: string; name: string }[]; // Tasks mit mind. einem für ihr aktuelles Kürzel relevanten Gewerk auf mengenQuelle "fehler"
  keineTasks: boolean;                          // kein einziger (nicht-Gruppen-)Task vorhanden
}

/** Nur "echte" Tasks zählen (keine Gruppen — deren Zeitraum leitet sich aus den Kindern ab, siehe
 *  gruppenDaten(), und sie tragen selbst keine Mengen/Dauer). */
function echteTasks(tasks: Task[]): Task[] {
  return tasks.filter((t, i) => !t.isGroup && !istGruppe(tasks, i));
}

/** Prüft, ob "Berechnete Dauer übernehmen" ausgeführt werden darf. Ein Task gilt nur dann als
 *  fehlerhaft, wenn ein für sein AKTUELLES Kürzel relevantes Gewerk auf "fehler" steht — genau die
 *  Gewerke, die Tab Kalkulation auch tatsächlich anzeigt (siehe renderZelle "mengen" dort). Ohne
 *  diesen Abgleich blieben veraltete mengenQuelle-Einträge (z.B. von einem zuvor gewählten Kürzel
 *  oder einem inzwischen entfernten Gewerk) unsichtbar in Tab Kalkulation, aber blockierten hier
 *  trotzdem — Tasks ohne Kürzel, ohne Menge oder mit rein manuellen Eingaben erzeugen so nie einen
 *  Fehler. */
export function pruefeZeitplanBereitschaft(tasks: Task[], stammdaten: Stammdaten): ZeitplanBereitschaft {
  const echte = echteTasks(tasks);

  const fehlerTasks = echte
    .filter(t => {
      if (!t.bauteilKuerzel) return false;
      const relevanteKeys = new Set(gewerkeFuerKuerzel(stammdaten, t.bauteilKuerzel).map(g => g.key));
      return Object.entries(t.mengenQuelle ?? {}).some(([key, quelle]) => quelle === "fehler" && relevanteKeys.has(key));
    })
    .map(t => ({ id: t.id, name: t.name }));

  return {
    bereit: echte.length > 0 && fehlerTasks.length === 0,
    fehlerTasks, keineTasks: echte.length === 0,
  };
}

/** Überträgt für jeden echten Task die in Tab Kalkulation berechnete Dauer auf Start/Ende — der
 *  erste Task behält sein bestehendes Startdatum (Anker der Kette), alle anderen starten am Ende
 *  ihres Vorgängers + Wartetage (dieselbe Logik wie kaskadiereNachfolger/ganttSetPredecessor). Geht
 *  rekursiv/memoisiert vor, damit die Reihenfolge im Array keine Rolle spielt. Gruppen werden nicht
 *  verändert, ihre Anzeige leitet sich weiterhin aus den (hier aktualisierten) Kind-Tasks ab.
 *  Tasks ohne hinterlegte Kalkulationswerte (hatKalkulationsWerte() false) bleiben unangetastet —
 *  sonst würde "berechnete Dauer" 0 Tage ergeben und den Task fälschlich auf Start=Ende zusammenziehen. */
export function berechneZeitplanUebernahme(tasks: Task[], stammdaten: Stammdaten, kalender: Kalender, einheit: Zeiteinheit = "tage"): Task[] {
  const byId = new Map(tasks.map(t => [t.id, t]));
  const ersterId = echteTasks(tasks)[0]?.id;
  const geloest = new Map<string, { start: Zeitpunkt; end: Zeitpunkt }>();
  const inArbeit = new Set<string>();

  function loese(id: string): { start: Zeitpunkt; end: Zeitpunkt } | null {
    const cached = geloest.get(id);
    if (cached) return cached;
    const t = byId.get(id);
    if (!t) return null;
    if (inArbeit.has(id)) return { start: startZeitpunkt(t), end: endZeitpunkt(t) }; // Zyklus-Schutz (sollte durch istZirkular() nie vorkommen)
    inArbeit.add(id);

    let result: { start: Zeitpunkt; end: Zeitpunkt };
    if (!hatKalkulationsWerte(t, stammdaten)) {
      result = { start: startZeitpunkt(t), end: endZeitpunkt(t) };
    } else {
      // Tasks laufen nur an Arbeitstagen: ein Anker-Start auf Wochenende/Feiertag/Ferien rückt auf den nächsten Arbeitstag
      const vorg = vorgaengerListe(t);
      // mehrere Vorgänger: der späteste Folge-Start gewinnt
      const start = (id === ersterId || vorg.length === 0)
        ? naechsteArbeitszeit(startZeitpunkt(t), kalender)
        : (() => {
            let s: Zeitpunkt | null = null;
            for (const v of vorg) { const e = loese(v.id)?.end; if (e?.datum) { const f = folgeStartZeitpunkt(e, v.lagDays, kalender); if (!s || vergleicheZeitpunkte(f, s) > 0) s = f; } }
            return s ?? naechsteArbeitszeit(startZeitpunkt(t), kalender);
          })();
      // berechnete Dauer (Arbeitstage, auf die Zeiteinheit gerundet) → Ende in Arbeitszeit; Tasks laufen nur in der Arbeitszeit
      const dauer = dauerBerechnetTask(t, stammdaten, einheit);
      result = { start, end: endeAusArbeitsMinuten(start, Math.max(dauer * MIN_PRO_ARBEITSTAG, schrittMinuten(einheit)), kalender) };
    }

    geloest.set(id, result);
    inArbeit.delete(id);
    return result;
  }

  return tasks.map((t, i) => {
    if (t.isGroup || istGruppe(tasks, i)) return t;
    const r = loese(t.id);
    return r ? { ...t, ...zeitFelder(r.start, r.end) } : t;
  });
}

/** true, wenn berechneZeitplanUebernahme() gegenüber den aktuellen Start-/Endterminen tatsächlich
 *  etwas ändern würde — steuert, ob der Button "Berechnete Dauer übernehmen" hervorgehoben wird
 *  oder (bei bereits übernommenem Stand) neutral/grau bleibt. */
export function zeitplanHatAenderungen(tasks: Task[], stammdaten: Stammdaten, kalender: Kalender, einheit: Zeiteinheit = "tage"): boolean {
  const neu = berechneZeitplanUebernahme(tasks, stammdaten, kalender, einheit);
  return neu.some((t, i) => t.start !== tasks[i].start || t.end !== tasks[i].end || t.startZeit !== tasks[i].startZeit || t.endZeit !== tasks[i].endZeit);
}
