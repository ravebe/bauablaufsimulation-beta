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
import { istGruppe, getOutlineLevel, vorgaengerListe, mitVorgaengern, vorgaengerStart, verschiebeAufStart, MAX_VORGAENGER } from "../types";
import type { Stammdaten } from "./stammdatenHelpers";
import { LEERE_STAMMDATEN, alleKuerzel } from "./stammdatenHelpers";
import type { Kalender } from "./kalenderHelpers";
import { LEERER_KALENDER } from "./kalenderHelpers";
import { startZeitpunkt, vergleicheZeitpunkte } from "./zeitHelpers";
import { gruppenJeTask, gruppenStruktur, gruppenReihenfolgeAbgleichen, bauablaufReihenfolge } from "./gruppenReihenfolge";

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

export interface RegelErgebnis {
  tasks: Task[];
  /** je Regel-ID: so viele Vorgänger hat sie gesetzt (nach dem Weglassen unnötiger) */
  anzahl: Map<string, number>;
  /** übersprungene Verknüpfungen, die einen Zirkelbezug ergeben hätten */
  zirkel: number;
  /** Tasks mit mehr als MAX_VORGAENGER Vorgängern — die überzähligen Regel-Vorgänger fehlen */
  zuViele: string[];
}

/** Tasks (ids), die vor dem Ende ihrer Vorgänger (+ Wartetage) beginnen, auf den frühestmöglichen Start schieben — samt allen
 *  Nachfolgern, die dadurch zu früh beginnen; nie nach vorne. Über eine Nachfolger-Liste statt das ganze Gantt je Schritt (wie
 *  kaskadiereNachfolger), damit es auch bei sehr vielen Tasks schnell bleibt. Gruppen: verschiebt sich ein Task, kann sich das
 *  Ende seiner Übergruppen ändern — deren Nachfolger werden mitgeprüft; eine verschobene Gruppe nimmt ihre Kinder mit. */
function nachHintenSchieben(tasks: Task[], ids: string[], kalender: Kalender): Task[] {
  let erg = tasks;
  const nachfolger = new Map<string, string[]>();
  for (const t of tasks) for (const v of vorgaengerListe(t)) nachfolger.set(v.id, [...(nachfolger.get(v.id) ?? []), t.id]);
  // Übergruppen je Task (Gliederung), Kinder je Gruppe
  const uebergruppen = new Map<string, string[]>(), kinder = new Map<string, string[]>();
  const stapel: { id: string; level: number }[] = [];
  tasks.forEach((t, i) => {
    const level = getOutlineLevel(t);
    while (stapel.length && stapel[stapel.length - 1].level >= level) stapel.pop();
    uebergruppen.set(t.id, stapel.map(s => s.id));
    for (const s of stapel) kinder.set(s.id, [...(kinder.get(s.id) ?? []), t.id]);
    if (istGruppe(tasks, i)) stapel.push({ id: t.id, level });
  });
  const index = new Map(tasks.map((t, i) => [t.id, i])); // verschiebeAufStart behält die Reihenfolge
  const queue = [...ids];
  let schritte = 0;
  const maxSchritte = (tasks.length + 1) * (MAX_VORGAENGER + 1) * 4; // Schutz gegen Zyklen in alten Daten
  while (queue.length > 0 && schritte++ < maxSchritte) {
    const id = queue.shift()!;
    const t = erg[index.get(id) ?? -1];
    if (!t || !t.start) continue;
    const frueh = vorgaengerStart(erg, t, kalender, index);
    if (!frueh || vergleicheZeitpunkte(frueh, startZeitpunkt(t)) <= 0) continue;
    erg = verschiebeAufStart(erg, id, frueh, kalender);
    // geändert: der Task selbst, seine Übergruppen (Ende) und bei einer Gruppe ihre Kinder → deren Nachfolger prüfen
    for (const x of [id, ...(uebergruppen.get(id) ?? []), ...(kinder.get(id) ?? [])]) for (const n of nachfolger.get(x) ?? []) queue.push(n);
  }
  return erg;
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
    const raenge = new Map<number, Map<string, number>>(); // Ebene → Gruppe → Position in der Reihenfolge
    const rangAufEbene = (ebene: number, t: Task) => {
      let r = raenge.get(ebene);
      if (!r) {
        r = new Map((ordnung.stufen.find(s => s.quelle === "gruppe" && s.ebene === ebene)?.werte ?? []).map((w, i) => [w, i]));
        raenge.set(ebene, r);
      }
      const g = gruppen.get(t.id)?.get(ebene);
      return g ? r.get(g) ?? -1 : -1;
    };
    // Gruppen eines Tasks auf den Ebenen 1 … bis als Schlüssel (gleicher Schlüssel = dieselben Gruppen, wie gleicheGruppen)
    const pfad = (t: Task, bis: number) => { const g = gruppen.get(t.id); let k = ""; for (let e = 1; e <= bis; e++) k += (g?.get(e) ?? "") + "\u0001"; return k; };

    // Graph: Task → Vorgänger und Task → Nachfolger (bestehende + neue aus Regeln)
    const vorg = new Map<string, Map<string, number>>(erg.map(t => [t.id, new Map(vorgaengerListe(t).map(v => [v.id, v.lagDays]))]));
    const nachf = new Map<string, Set<string>>();
    const nachfolgerDazu = (a: string, b: string) => { let s = nachf.get(a); if (!s) { s = new Set(); nachf.set(a, s); } s.add(b); };
    for (const [b, m] of vorg) for (const a of m.keys()) nachfolgerDazu(a, b);
    const neu = new Map<string, Map<string, { lag: number; regel: string }>>(); // B → A → Regel
    /** alle Nachfolger von id über alle Stufen — A → B ergäbe einen Zirkel, wenn A darunter ist */
    const nachkommen = (id: string): Set<string> => {
      const besucht = new Set<string>(), stapel = [id];
      while (stapel.length) for (const n of nachf.get(stapel.pop()!) ?? []) if (!besucht.has(n)) { besucht.add(n); stapel.push(n); }
      return besucht;
    };

    for (const regel of aktive) {
      const as = echte.filter(t => passt(regel.vor, t));
      if (as.length === 0) continue;
      const ebene = regel.ebene ?? 1;
      // A nach Gruppen vorsortiert: «gleich» = dieselben Gruppen bis zur Ebene, «darunter» = dieselben Gruppen darüber
      const index = new Map<string, Task[]>();
      if (regel.bezug !== "ueberall") for (const a of as) {
        const k = pfad(a, regel.bezug === "gleich" ? ebene : ebene - 1);
        index.set(k, [...(index.get(k) ?? []), a]);
      }
      for (const b of echte) {
        if (!passt(regel.nach, b)) continue;
        let liste: Task[];
        if (regel.bezug === "ueberall") liste = as;
        else if (regel.bezug === "gleich") liste = index.get(pfad(b, ebene)) ?? [];
        else {
          // nächste Gruppe davor auf dieser Ebene (fehlt eine, z.B. kein 1.OG, die nächstuntere), gleiche Gruppen darüber
          const rb = rangAufEbene(ebene, b);
          if (rb < 0) continue;
          const kandidaten = (index.get(pfad(b, ebene - 1)) ?? []).filter(a => { const r = rangAufEbene(ebene, a); return r >= 0 && r < rb; });
          const naechste = kandidaten.reduce((m, a) => Math.max(m, rangAufEbene(ebene, a)), -1);
          liste = kandidaten.filter(a => rangAufEbene(ebene, a) === naechste);
        }
        let unten: Set<string> | null = null; // Nachkommen von B — ändern sich durch neue Verknüpfungen A → B nicht
        for (const a of liste) {
          if (a.id === b.id) continue;
          const bisher = neu.get(b.id)?.get(a.id);
          if (bisher) { if (regel.wartetage > bisher.lag) neu.get(b.id)!.set(a.id, { lag: regel.wartetage, regel: regel.id }); continue; }
          if (!vorg.get(b.id)!.has(a.id)) {
            unten ??= nachkommen(b.id);
            if (unten.has(a.id)) { zirkel++; continue; }
          }
          if (!neu.has(b.id)) neu.set(b.id, new Map());
          neu.get(b.id)!.set(a.id, { lag: regel.wartetage, regel: regel.id });
          nachfolgerDazu(a.id, b.id);
        }
      }
    }

    // 2. unnötige weglassen: A ist über einen anderen Vorgänger P von B schon gesichert (A → … → P → B), ohne eigene Wartetage.
    //    Nur über Verknüpfungen, die stehen bleiben: nicht die vom Optimieren ergänzten (das Optimieren entfernt sie zuerst und
    //    bestimmt sie neu — die Regel gälte dann nicht) und keine mit negativen Wartetagen (sichern die Reihenfolge nicht).
    const byId = new Map(erg.map(t => [t.id, t]));
    const stabil = (id: string): string[] => {
      const t = byId.get(id);
      const opt = new Set(t?.optimierung?.vorgaenger ?? []);
      return [...(vorg.get(id) ?? [])].filter(([v, lag]) => lag >= 0 && !opt.has(v)).map(([v]) => v);
    };
    // Vorfahren je Task als Bit-Menge (1 Bit je Task) — so bleibt das auch bei breiten Regeln (z.B. «Etappe A vor Etappe B» mit
    // Hunderten von Verknüpfungen je Task) schnell
    const nr = new Map(erg.map((t, i) => [t.id, i]));
    const W = Math.ceil(erg.length / 32);
    const bit = (m: Uint32Array, j: number) => (m[j >> 5] & (1 << (j & 31))) !== 0;
    const vorfahren: (Uint32Array | undefined)[] = [];
    const inArbeit = new Uint8Array(erg.length);
    const alleVorfahren = (i: number): Uint32Array => {
      const fertig = vorfahren[i];
      if (fertig) return fertig;
      const s = new Uint32Array(W);
      if (inArbeit[i]) return s; // Zyklus in alten Daten
      inArbeit[i] = 1;
      for (const v of [...stabil(erg[i].id), ...(neu.get(erg[i].id)?.keys() ?? [])]) {
        const j = nr.get(v);
        if (j === undefined) continue;
        s[j >> 5] |= 1 << (j & 31);
        const x = alleVorfahren(j);
        for (let w = 0; w < W; w++) s[w] |= x[w];
      }
      vorfahren[i] = s;
      return s;
    };
    for (const [b, links] of neu) {
      const kandidaten = [...links].filter(([a, l]) => l.lag <= 0 && !vorg.get(b)!.has(a)).map(([a]) => a);
      if (kandidaten.length === 0) continue;
      const gesichert = new Uint32Array(W); // alles, was über einen Vorgänger von B schon vorher fertig ist
      for (const p of [...stabil(b), ...links.keys()]) {
        const j = nr.get(p);
        if (j === undefined) continue;
        const x = alleVorfahren(j);
        for (let w = 0; w < W; w++) gesichert[w] |= x[w];
      }
      for (const a of kandidaten) {
        const j = nr.get(a)!;
        if (bit(gesichert, j) && !bit(alleVorfahren(j), j)) links.delete(a); // (nicht bei einem Zyklus über A selbst)
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
  const pruefen = erg.filter(t => linkText(t).some(l => !alt.get(t.id)?.has(l))).map(t => t.id);
  if (pruefen.length > 0) erg = nachHintenSchieben(erg, pruefen, kalender);

  // unveränderte Tasks als dieselben Objekte zurückgeben, ganz unverändert = dasselbe Array. Die Reihenfolge der Vorgänger zählt
  // nicht (Regel-Vorgänger werden oben entfernt und hinten wieder angehängt) — sonst änderte sich die Termin-Signatur
  // (terminSignatur) bei jedem Anwenden, und «aus der Optimierung» ginge verloren.
  const sortiert = (l: string[] | undefined) => [...(l ?? [])].sort();
  const schluessel = (t: Task) => JSON.stringify([t.start, t.end, t.startZeit, t.endZeit, sortiert(vorgaengerListe(t).map(v => `${v.id}:${v.lagDays}`)),
    sortiert(t.regelVorgaenger), sortiert(t.autoVorgaenger), sortiert(t.optimierung?.vorgaenger)]);
  let geaendert = false;
  erg = erg.map((t, i) => { if (schluessel(t) === schluessel(tasks[i])) return tasks[i]; geaendert = true; return t; });
  return { tasks: geaendert ? erg : tasks, anzahl, zirkel, zuViele };
}

/** Simulation mit ihren Ablaufregeln abgleichen — ohne Regeln und ohne Regel-Vorgänger unverändert (dasselbe Objekt). */
export function simRegelnAnwenden(sim: SimProjekt): SimProjekt {
  if (!sim.ablaufRegeln?.some(regelWirkt) &&!sim.tasks.some(t => t.regelVorgaenger?.length)) return sim;
  const { tasks } = regelnAnwenden(sim.tasks, sim.ablaufRegeln ?? [], sim.stammdaten ?? LEERE_STAMMDATEN,
    bauablaufReihenfolge(sim), sim.kalender ?? LEERER_KALENDER);
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

// === Export/Import «Bauablauf» (Tab Ressourcen → Bauablauf: Reihenfolge der Gruppen und Bauteilarten + Ablaufregeln) — Datei zum
// Übertragen in andere Simulationen/Projekte, wie die Ressourcen. Version 1 enthielt nur die Regeln und bleibt lesbar.
const FORMAT = "bauablauf-ablaufregeln";

export function regelnAlsJson(regeln: AblaufRegel[], gruppenReihenfolge?: GruppenReihenfolge): string {
  return JSON.stringify({ format: FORMAT, version: 2, regeln, ...(gruppenReihenfolge ? { gruppenReihenfolge } : {}) }, null, 2);
}

const FELDER: RegelFeld[] = ["gruppe", "kuerzel", "kategorie", "unternehmer", "name"];

/** Parst eine exportierte Bauablauf-Datei: Regeln und (ab Version 2) die Reihenfolge der Gruppen und Bauteilarten. */
export function parseBauablaufJson(text: string): { regeln: AblaufRegel[]; gruppenReihenfolge?: GruppenReihenfolge } {
  const raw = JSON.parse(text);
  const stufen = Array.isArray(raw?.gruppenReihenfolge?.stufen) ? raw.gruppenReihenfolge.stufen as unknown[] : null;
  const gruppenReihenfolge: GruppenReihenfolge | undefined = stufen ? { stufen: stufen
    .filter((s): s is Record<string, unknown> => !!s && typeof s === "object" && (s as { quelle?: unknown }).quelle !== undefined)
    .filter(s => (s.quelle === "gruppe" || s.quelle === "kuerzel") && Array.isArray(s.werte))
    .map(s => ({ quelle: s.quelle as "gruppe" | "kuerzel", ...(s.quelle === "gruppe" ? { ebene: Number(s.ebene) || 1 } : {}),
      werte: (s.werte as unknown[]).map(String), aktiv: s.aktiv !== false })) } : undefined;
  return { regeln: parseRegelnJson(text), ...(gruppenReihenfolge ? { gruppenReihenfolge } : {}) };
}

/** Parst die Regeln einer exportierten Bauablauf-/Ablaufregeln-Datei und prüft die Struktur — ungültige Bedingungen werden weggelassen. */
export function parseRegelnJson(text: string): AblaufRegel[] {
  const raw = JSON.parse(text);
  const liste = Array.isArray(raw) ? raw : raw?.regeln;
  if (!Array.isArray(liste) || (!Array.isArray(raw) && raw.format !== FORMAT)) throw new Error("Ungültiges Format — keine Bauablauf-Datei");
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
