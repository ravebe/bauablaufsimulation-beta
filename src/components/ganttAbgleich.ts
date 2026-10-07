// ganttAbgleich.ts — beim erneuten Gantt-Import (Excel/CSV/XML/MS Project) die bisherigen Tasks den neuen
// zuordnen, damit Bauteil-Verknüpfungen und Kalkulationsdaten erhalten bleiben. Vorher ersetzte der Import
// die ganze Task-Liste — alle Verknüpfungen waren weg.
// Zuordnung: 1. gleicher Pfad (Gruppen + Name, z.B. "Rohbau › UG › Wand 01"), 2. gleicher Name, falls auf
// beiden Seiten eindeutig. Gruppen werden mit abgeglichen (nur für stabile IDs).
import type { Task } from "../types";
import { getOutlineLevel } from "../types";

const norm = (s: string) => s.trim().replace(/\s+/g, " ").toLowerCase();

/** Pfad je Task: Namen aller übergeordneten Gruppen + eigener Name */
function pfade(tasks: Task[]): string[] {
  const stapel: { ebene: number; name: string }[] = [];
  return tasks.map(t => {
    const ebene = getOutlineLevel(t);
    while (stapel.length && stapel[stapel.length - 1].ebene >= ebene) stapel.pop();
    const pfad = [...stapel.map(e => e.name), norm(t.name)].join(" › ");
    stapel.push({ ebene, name: norm(t.name) });
    return pfad;
  });
}

// Was die Datei nicht enthält und darum vom bisherigen Task übernommen wird
const BEHALTEN: (keyof Task)[] = ["mengen", "mengenQuelle", "mengenInfo", "mengenObjekte", "berechneteDauerManuell",
  "kraene", "kranbereich", "personalSoll", "attrGruppe"];

export interface AbgleichErgebnis {
  tasks: Task[];
  zugeordnet: number;          // neue Tasks, die einem bisherigen zugeordnet wurden
  bauteileUebernommen: number;
  wegfallend: { tasks: number; bauteile: number }; // bisherige Tasks mit Bauteilen ohne Gegenstück
}

export function gleicheGanttAb(alt: Task[], neu: Task[]): AbgleichErgebnis {
  const altPfade = pfade(alt), neuPfade = pfade(neu);
  const frei = new Set(alt.map((_, i) => i));
  const zuordnung = new Map<number, number>(); // neuIdx → altIdx

  // 1. gleicher Pfad
  const altNachPfad = new Map<string, number[]>();
  altPfade.forEach((p, i) => altNachPfad.set(p, [...(altNachPfad.get(p) ?? []), i]));
  neuPfade.forEach((p, ni) => {
    const kandidat = (altNachPfad.get(p) ?? []).find(ai => frei.has(ai) && !!alt[ai].isGroup === !!neu[ni].isGroup);
    if (kandidat !== undefined) { zuordnung.set(ni, kandidat); frei.delete(kandidat); }
  });

  // 2. gleicher Name, wenn unter den noch offenen auf beiden Seiten eindeutig
  const zaehle = (liste: { name: string }[]) => liste.reduce((m, t) => m.set(norm(t.name), (m.get(norm(t.name)) ?? 0) + 1), new Map<string, number>());
  const offenNeu = neu.map((t, i) => ({ t, i })).filter(e => !zuordnung.has(e.i));
  const offenAlt = [...frei].map(i => ({ t: alt[i], i }));
  const nNeu = zaehle(offenNeu.map(e => e.t)), nAlt = zaehle(offenAlt.map(e => e.t));
  for (const { t, i } of offenNeu) {
    const n = norm(t.name);
    if (nNeu.get(n) !== 1 || nAlt.get(n) !== 1) continue;
    const a = offenAlt.find(e => norm(e.t.name) === n && !!e.t.isGroup === !!t.isGroup);
    if (a && frei.has(a.i)) { zuordnung.set(i, a.i); frei.delete(a.i); }
  }

  // Übernehmen: bisherige ID, Bauteile (falls die Datei keine eigenen mitbringt), Kalkulationsdaten
  const idNeuZuAlt = new Map<string, string>();
  let bauteileUebernommen = 0;
  const tasks = neu.map((t, ni) => {
    const ai = zuordnung.get(ni);
    if (ai === undefined) return t;
    const a = alt[ai];
    idNeuZuAlt.set(t.id, a.id);
    const r: Task = { ...t, id: a.id };
    if (!t.isGroup && t.objektGuids.length === 0 && a.objektGuids.length > 0) {
      r.objektGuids = a.objektGuids;
      bauteileUebernommen += a.objektGuids.length;
    }
    if (!r.bauteilKuerzel && a.bauteilKuerzel) r.bauteilKuerzel = a.bauteilKuerzel;
    for (const k of BEHALTEN) if (r[k] === undefined && a[k] !== undefined) (r as unknown as Record<string, unknown>)[k] = a[k];
    return r;
  });
  // Vorgänger verweisen auf die IDs aus der Datei → auf die übernommenen IDs umstellen
  const mitVorgaengern = tasks.map(t => (t.predecessorId && idNeuZuAlt.has(t.predecessorId) ? { ...t, predecessorId: idNeuZuAlt.get(t.predecessorId) } : t));

  const weg = [...frei].map(i => alt[i]).filter(t => t.objektGuids.length > 0);
  return {
    tasks: mitVorgaengern,
    zugeordnet: zuordnung.size,
    bauteileUebernommen,
    wegfallend: { tasks: weg.length, bauteile: weg.reduce((s, t) => s + t.objektGuids.length, 0) },
  };
}
