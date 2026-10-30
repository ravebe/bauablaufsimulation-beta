// ablaufRegeln.ts — Ablaufregeln (Tab Ressourcen → Ablaufregeln, SimProjekt.ablaufRegeln): «erst A fertig, dann B», z.B. Elemente erst
// versetzen, wenn die Platte darunter fertig ist, oder die Kanalisation einer Etappe vor ihrem Magerbeton. Jede Regel wählt zwei
// Mengen von Tasks (Gruppe, Bauteilart, Kategorie, Unternehmer, Name) und einen Bezug (überall / in derselben Gruppe / Gruppe
// darunter). Daraus entstehen automatische Vorgänger (Task.regelVorgaenger, blau) — so gelten die Regeln überall, wo Vorgänger
// gelten: Optimieren (jede Reihenfolge), Automatisch nachführen, Nur Dauern übernehmen, Folge-Tasks ausrichten, Gantt, Export.
// Läuft nach jeder Änderung einer Simulation (useUndo.ts, vor dem Nachführen) und bestimmt die Regel-Vorgänger neu: nur nötige
// Verknüpfungen (ist A über einen anderen Vorgänger schon gesichert, entfällt die direkte), keine Zirkelbezüge. Von Hand gesetzte
// Vorgänger bleiben; ein gleicher automatischer (Auto-Vorgänger/Optimieren) wird zum Regel-Vorgänger. Neue Regel-Vorgänger schieben
// Tasks, die zu früh beginnen, samt Nachfolgern nach hinten (nie nach vorne).
import type { Task, AblaufRegel, RegelBedingung, RegelFeld, SimProjekt, GruppenReihenfolge } from "../types";
import { istGruppe, vorgaengerListe, mitVorgaengern, vorgaengerStart, verschiebeAufStart, kaskadiereNachfolger, MAX_VORGAENGER } from "../types";
import type { Stammdaten } from "./stammdatenHelpers";
import { LEERE_STAMMDATEN, alleKuerzel } from "./stammdatenHelpers";
import type { Kalender } from "./kalenderHelpers";
import { LEERER_KALENDER } from "./kalenderHelpers";
import { startZeitpunkt, vergleicheZeitpunkte } from "./zeitHelpers";
import { gruppenJeTask, gruppenStruktur, gruppenReihenfolgeAbgleichen } from "./gruppenReihenfolge";

export const REGEL_FELD_LABEL: Record<RegelFeld, string> = {
  gruppe: "Gruppe", kuerzel: "Bauteilart", kategorie: "Kategorie", unternehmer: "Unternehmer", name: "Task-Name enthält",
};

/** Kategorien (Gewerk-keys) und Unternehmer eines Tasks: Raten seines Bauteil-Kürzels — hat er Mengen, nur die mit Menge. */
function merkmale(t: Task, stammdaten: Stammdaten): { kategorien: Set<string>; unternehmer: Set<string> } {
  const kategorien = new Set<string>(), unternehmer = new Set<string>();
  if (!t.bauteilKuerzel) return { kategorien, unternehmer };
  const mitMenge = !!t.mengen && Object.values(t.mengen).some(m => !!m);
  for (const g of stammdaten.gewerke) {
    const rate = g.raten.find(r => r.kuerzel === t.bauteilKuerzel);
    if (!rate || (mitMenge && !t.mengen![g.key])) continue;
    kategorien.add(g.key);
    if (rate.unternehmer?.trim()) unternehmer.add(rate.unternehmer.trim());
  }
  return { kategorien, unternehmer };
}

type Merkmale = ReturnType<typeof merkmale>;

/** Wirkt die Regel? Eingeschaltet und jede Bedingung mit mindestens einem Wert — eine noch nicht ausgefüllte Bedingung würde
 *  sonst alle Tasks treffen (z.B. Vorlage «Platte darunter», bevor die Bauteilart gewählt ist). */
export function regelWirkt(r: AblaufRegel): boolean {
  return r.aktiv && [...r.vor, ...r.nach].every(b => b.werte.some(w => w.trim()));
}

/** Trifft die Bedingung zu? (einer der Werte) */
function bedingungTrifft(b: RegelBedingung, t: Task, m: Merkmale, gruppen: Map<number, string> | undefined): boolean {
  const werte = b.werte.map(w => w.trim()).filter(Boolean);
  switch (b.feld) {
    case "gruppe": { const g = gruppen?.get(b.ebene ?? 1); return !!g && werte.includes(g); }
    case "kuerzel": return !!t.bauteilKuerzel && werte.includes(t.bauteilKuerzel);
    case "kategorie": return werte.some(w => m.kategorien.has(w));
    case "unternehmer": return werte.some(w => m.unternehmer.has(w));
    case "name": { const n = t.name.toLowerCase(); return werte.some(w => n.includes(w.toLowerCase())); }
  }
}

/** Gleiche Gruppen auf allen Ebenen bis einschliesslich bis (fehlt auf beiden Seiten = gleich) */
function gleicheGruppen(a: Map<number, string> | undefined, b: Map<number, string> | undefined, bis: number): boolean {
  for (let e = 1; e <= bis; e++) if ((a?.get(e) ?? "") !== (b?.get(e) ?? "")) return false;
  return true;
}

export interface RegelErgebnis {
  tasks: Task[];
  /** je Regel-ID: so viele Vorgänger hat sie gesetzt (nach dem Weglassen unnötiger) */
  anzahl: Map<string, number>;
  /** übersprungene Verknüpfungen, die einen Zirkelbezug ergeben hätten */
  zirkel: number;
  /** Tasks mit mehr als MAX_VORGAENGER Vorgängern — die überzähligen Regel-Vorgänger fehlen */
  zuViele: string[];
}

/** Regel-Vorgänger aller Tasks neu bestimmen (siehe Kopf). Ändert sich nichts, kommt dasselbe tasks-Array zurück. */
export function regelnAnwenden(tasks: Task[], regeln: AblaufRegel[], stammdaten: Stammdaten = LEERE_STAMMDATEN,
  reihenfolge?: GruppenReihenfolge, kalender: Kalender = LEERER_KALENDER): RegelErgebnis {
  const anzahl = new Map<string, number>();
  let zirkel = 0;
  const zuViele: string[] = [];

  // 1. bisherige Regel-Vorgänger entfernen — sie werden neu bestimmt
  let erg = tasks.map(t => {
    if (!t.regelVorgaenger?.length) return t;
    const weg = new Set(t.regelVorgaenger);
    return { ...mitVorgaengern(t, vorgaengerListe(t).filter(v => !weg.has(v.id))), regelVorgaenger: undefined };
  });

  const aktive = regeln.filter(regelWirkt);
  if (aktive.length > 0) {
    const echte = erg.filter((t, i) => !t.isGroup && !istGruppe(erg, i));
    const gruppen = gruppenJeTask(erg);
    const merk = new Map(echte.map(t => [t.id, merkmale(t, stammdaten)]));
    const passt = (bed: RegelBedingung[], t: Task) => bed.every(b => bedingungTrifft(b, t, merk.get(t.id)!, gruppen.get(t.id)) !== !!b.nicht);
    const ordnung = reihenfolge ?? gruppenReihenfolgeAbgleichen(undefined, erg);
    const rangAufEbene = (ebene: number, t: Task) => {
      const werte = ordnung.stufen.find(s => s.quelle === "gruppe" && s.ebene === ebene)?.werte ?? [];
      const g = gruppen.get(t.id)?.get(ebene);
      return g ? werte.indexOf(g) : -1;
    };

    // Graph: Task → Vorgänger (bestehende + neue aus Regeln)
    const vorg = new Map<string, Map<string, number>>(erg.map(t => [t.id, new Map(vorgaengerListe(t).map(v => [v.id, v.lagDays]))]));
    const neu = new Map<string, Map<string, { lag: number; regel: string }>>(); // B → A → Regel
    const istVorfahr = (vorfahr: string, von: string): boolean => { // erreicht man vorfahr über die Vorgänger von «von»?
      const besucht = new Set<string>(), stapel = [von];
      while (stapel.length) {
        const id = stapel.pop()!;
        if (id === vorfahr) return true;
        if (besucht.has(id)) continue;
        besucht.add(id);
        for (const v of vorg.get(id)?.keys() ?? []) stapel.push(v);
        for (const v of neu.get(id)?.keys() ?? []) stapel.push(v);
      }
      return false;
    };

    for (const regel of aktive) {
      const as = echte.filter(t => passt(regel.vor, t));
      if (as.length === 0) continue;
      const ebene = regel.ebene ?? 1;
      for (const b of echte) {
        if (!passt(regel.nach, b)) continue;
        let liste = as.filter(a => a.id !== b.id);
        if (regel.bezug === "gleich") liste = liste.filter(a => gleicheGruppen(gruppen.get(a.id), gruppen.get(b.id), ebene));
        else if (regel.bezug === "darunter") {
          // nächste Gruppe davor auf dieser Ebene (fehlt eine, z.B. kein 1.OG, die nächstuntere), gleiche Gruppen darüber
          const rb = rangAufEbene(ebene, b);
          if (rb < 0) continue;
          liste = liste.filter(a => gleicheGruppen(gruppen.get(a.id), gruppen.get(b.id), ebene - 1) && rangAufEbene(ebene, a) >= 0 && rangAufEbene(ebene, a) < rb);
          const naechste = Math.max(-1, ...liste.map(a => rangAufEbene(ebene, a)));
          liste = liste.filter(a => rangAufEbene(ebene, a) === naechste);
        }
        for (const a of liste) {
          const bisher = neu.get(b.id)?.get(a.id);
          if (bisher) { if (regel.wartetage > bisher.lag) neu.get(b.id)!.set(a.id, { lag: regel.wartetage, regel: regel.id }); continue; }
          if (!vorg.get(b.id)!.has(a.id) && istVorfahr(b.id, a.id)) { zirkel++; continue; }
          if (!neu.has(b.id)) neu.set(b.id, new Map());
          neu.get(b.id)!.set(a.id, { lag: regel.wartetage, regel: regel.id });
        }
      }
    }

    // 2. unnötige weglassen: A ist über einen anderen Vorgänger P von B schon gesichert (A → … → P → B), ohne eigene Wartetage
    const vorfahren = new Map<string, Set<string>>();
    const alleVorfahren = (id: string): Set<string> => {
      const fertig = vorfahren.get(id);
      if (fertig) return fertig;
      const s = new Set<string>();
      vorfahren.set(id, s); // gegen Zyklen in alten Daten
      for (const v of [...(vorg.get(id)?.keys() ?? []), ...(neu.get(id)?.keys() ?? [])]) { s.add(v); for (const x of alleVorfahren(v)) s.add(x); }
      return s;
    };
    for (const [b, links] of neu) {
      const andere = [...(vorg.get(b)?.keys() ?? []), ...links.keys()];
      for (const [a, l] of [...links]) {
        if (l.lag > 0 || vorg.get(b)!.has(a)) continue;
        if (andere.some(p => p !== a && alleVorfahren(p).has(a))) links.delete(a);
      }
    }

    // 3. eintragen: von Hand gesetzte gleiche bleiben von Hand, gleiche automatische werden zu Regel-Vorgängern
    erg = erg.map(t => {
      const links = neu.get(t.id);
      if (!links || links.size === 0) return t;
      const bestehend = vorgaengerListe(t);
      const auto = new Set(t.autoVorgaenger ?? []), opt = new Set(t.optimierung?.vorgaenger ?? []);
      const regelIds: string[] = [];
      let liste = bestehend.map(v => {
        const l = links.get(v.id);
        if (!l || (!auto.has(v.id) && !opt.has(v.id))) return v;
        regelIds.push(v.id); auto.delete(v.id); opt.delete(v.id);
        return { id: v.id, lagDays: Math.max(v.lagDays, l.lag) };
      });
      for (const [a, l] of links) if (!bestehend.some(v => v.id === a)) { liste.push({ id: a, lagDays: l.lag }); regelIds.push(a); }
      if (liste.length > MAX_VORGAENGER) { zuViele.push(t.name); liste = liste.slice(0, MAX_VORGAENGER); }
      const behalten = regelIds.filter(id => liste.some(v => v.id === id));
      for (const id of behalten) { const r = links.get(id)!.regel; anzahl.set(r, (anzahl.get(r) ?? 0) + 1); }
      if (behalten.length === 0) return t;
      return { ...mitVorgaengern(t, liste), regelVorgaenger: behalten, autoVorgaenger: auto.size ? [...auto] : undefined,
        optimierung: t.optimierung ? { ...t.optimierung, vorgaenger: [...opt] } : undefined };
    });
  }

  // 4. Tasks mit neuen Regel-Vorgängern, die zu früh beginnen, nach hinten schieben (samt Nachfolgern)
  const linkText = (t: Task) => { const r = new Set(t.regelVorgaenger ?? []); return vorgaengerListe(t).filter(v => r.has(v.id)).map(v => `${v.id}:${v.lagDays}`); };
  const alt = new Map(tasks.map(t => [t.id, new Set(linkText(t))]));
  for (const t of [...erg]) {
    if (!linkText(t).some(l => !alt.get(t.id)?.has(l))) continue;
    const aktuell = erg.find(x => x.id === t.id)!;
    const frueh = vorgaengerStart(erg, aktuell, kalender);
    if (!frueh || !aktuell.start || vergleicheZeitpunkte(frueh, startZeitpunkt(aktuell)) <= 0) continue;
    erg = kaskadiereNachfolger(verschiebeAufStart(erg, t.id, frueh, kalender), t.id, kalender);
  }

  // unveränderte Tasks als dieselben Objekte zurückgeben, ganz unverändert = dasselbe Array
  const schluessel = (t: Task) => JSON.stringify([t.start, t.end, t.startZeit, t.endZeit, t.predecessorId, t.lagDays, t.weitereVorgaenger,
    t.regelVorgaenger, t.autoVorgaenger, t.optimierung?.vorgaenger]);
  let geaendert = false;
  erg = erg.map((t, i) => { if (schluessel(t) === schluessel(tasks[i])) return tasks[i]; geaendert = true; return t; });
  return { tasks: geaendert ? erg : tasks, anzahl, zirkel, zuViele };
}

/** Simulation mit ihren Ablaufregeln abgleichen — ohne Regeln und ohne Regel-Vorgänger unverändert (dasselbe Objekt). */
export function simRegelnAnwenden(sim: SimProjekt): SimProjekt {
  if (!sim.ablaufRegeln?.some(regelWirkt) &&!sim.tasks.some(t => t.regelVorgaenger?.length)) return sim;
  const { tasks } = regelnAnwenden(sim.tasks, sim.ablaufRegeln ?? [], sim.stammdaten ?? LEERE_STAMMDATEN,
    gruppenReihenfolgeAbgleichen(sim.gruppenReihenfolge, sim.tasks), sim.kalender ?? LEERER_KALENDER);
  return tasks === sim.tasks ? sim : { ...sim, tasks };
}

/** Auswahlmöglichkeiten für den Editor: Gruppenebenen mit ihren Gruppen (Reihenfolge wie «Nach Gruppen»), Bauteilarten,
 *  Kategorien und Unternehmer aus Tab Ressourcen. */
export interface RegelOptionen {
  ebenen: { ebene: number; werte: string[] }[];
  kuerzel: { wert: string; label: string }[];
  kategorien: { wert: string; label: string }[];
  unternehmer: string[];
}
export function regelOptionen(tasks: Task[], stammdaten: Stammdaten, reihenfolge?: GruppenReihenfolge): RegelOptionen {
  const ordnung = reihenfolge ?? { stufen: gruppenStruktur(tasks) };
  const bezeichnung = (k: string) => stammdaten.gewerke.flatMap(g => g.raten).find(r => r.kuerzel === k)?.bezeichnung;
  const kuerzel = [...new Set([...alleKuerzel(stammdaten), ...tasks.map(t => t.bauteilKuerzel).filter((k): k is string => !!k)])].sort();
  return {
    ebenen: ordnung.stufen.filter(s => s.quelle === "gruppe").map(s => ({ ebene: s.ebene ?? 1, werte: s.werte })).sort((a, b) => a.ebene - b.ebene),
    kuerzel: kuerzel.map(k => ({ wert: k, label: bezeichnung(k) ? `${k} · ${bezeichnung(k)}` : k })),
    kategorien: stammdaten.gewerke.map(g => ({ wert: g.key, label: g.label })),
    unternehmer: [...new Set(stammdaten.gewerke.flatMap(g => g.raten).map(r => r.unternehmer?.trim()).filter((u): u is string => !!u))].sort(),
  };
}

/** Kurzbeschreibung einer Auswahl, z.B. «Bauteilart DE · Gruppe (Ebene 1) Etappe 1» — leer = «alle Tasks» */
export function auswahlText(bed: RegelBedingung[], optionen: RegelOptionen): string {
  const teile = bed.filter(b => b.werte.some(w => w.trim())).map(b => {
    const label = (w: string) => b.feld === "kategorie" ? optionen.kategorien.find(k => k.wert === w)?.label ?? w : b.feld === "name" ? `«${w}»` : w;
    return `${b.nicht ? "ausser " : ""}${b.feld === "gruppe" ? `Gruppe (Ebene ${b.ebene ?? 1})` : REGEL_FELD_LABEL[b.feld]} ${b.werte.filter(w => w.trim()).map(label).join(" / ")}`;
  });
  if (!teile.length) return "alle Tasks";
  return (bed.every(b => b.nicht || !b.werte.some(w => w.trim())) ? "alle Tasks " : "") + teile.join(" · ");
}

export function bezugText(r: AblaufRegel): string {
  return r.bezug === "ueberall" ? "überall" : r.bezug === "gleich" ? `in derselben Gruppe (Ebene ${r.ebene ?? 1})` : `Gruppe darunter (Ebene ${r.ebene ?? 1})`;
}

// === Export/Import (wie Tab Ressourcen: Datei zum Übertragen in andere Simulationen/Projekte) ===
const FORMAT = "bauablauf-ablaufregeln";

export function regelnAlsJson(regeln: AblaufRegel[]): string {
  return JSON.stringify({ format: FORMAT, version: 1, regeln }, null, 2);
}

const FELDER: RegelFeld[] = ["gruppe", "kuerzel", "kategorie", "unternehmer", "name"];

/** Parst eine exportierte Ablaufregeln-Datei und prüft die Struktur — ungültige Bedingungen werden weggelassen. */
export function parseRegelnJson(text: string): AblaufRegel[] {
  const raw = JSON.parse(text);
  const liste = Array.isArray(raw) ? raw : raw?.regeln;
  if (!Array.isArray(liste) || (!Array.isArray(raw) && raw.format !== FORMAT)) throw new Error("Ungültiges Format — keine Ablaufregeln-Datei");
  const bedingungen = (x: unknown): RegelBedingung[] => (Array.isArray(x) ? x : [])
    .filter(b => b && FELDER.includes(b.feld) && Array.isArray(b.werte))
    .map(b => ({ feld: b.feld, ...(b.feld === "gruppe" ? { ebene: Number(b.ebene) || 1 } : {}), werte: b.werte.map(String), ...(b.nicht ? { nicht: true } : {}) }));
  return liste.filter(r => r && typeof r === "object").map((r, i): AblaufRegel => ({
    id: typeof r.id === "string" && r.id ? r.id : `regel-${Date.now()}-${i}`,
    name: typeof r.name === "string" ? r.name : `Regel ${i + 1}`,
    aktiv: r.aktiv !== false,
    vor: bedingungen(r.vor),
    nach: bedingungen(r.nach),
    bezug: r.bezug === "gleich" || r.bezug === "darunter" ? r.bezug : "ueberall",
    ebene: r.bezug === "gleich" || r.bezug === "darunter" ? Number(r.ebene) || 1 : undefined,
    wartetage: Number.isFinite(Number(r.wartetage)) ? Math.max(0, Math.round(Number(r.wartetage))) : 0,
  }));
}
