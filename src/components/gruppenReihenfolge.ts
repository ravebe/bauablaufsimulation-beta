// gruppenReihenfolge.ts — "Auslastung optimieren" → Reihenfolge «Nach Gruppen»: wer zuerst Personal bekommt, wenn mehrere Arbeiten
// möglich sind. Stufe für Stufe (z.B. Etappe, dann Geschoss, dann Bauteilart) gilt die festgelegte Reihenfolge der Werte (z.B.
// Etappe A → B, UG → EG → OG, Boden → Wände → Stützen → Decken); bei Gleichstand der kritische Pfad. Weich: ist in der vorderen
// Gruppe gerade nichts möglich (Vorgänger, Wartetage, Kran), arbeiten die Leute schon in der nächsten — so geht das Personal von
// selbst zur nächsten Bauteilart, ins nächste Geschoss oder in die nächste Etappe, sobald es dort keine Arbeit mehr hat.
import type { Task, GruppenReihenfolge, PrioStufe } from "../types";
import { istGruppe, getOutlineLevel } from "../types";
import type { Stammdaten } from "./stammdatenHelpers";

/** Gruppen-Namen je Gliederungsebene der Übergruppen eines Tasks (Ebene → Name) */
export function gruppenJeTask(tasks: Task[]): Map<string, Map<number, string>> {
  const ergebnis = new Map<string, Map<number, string>>();
  const stapel: { name: string; level: number }[] = [];
  tasks.forEach((t, i) => {
    const level = getOutlineLevel(t);
    while (stapel.length && stapel[stapel.length - 1].level >= level) stapel.pop();
    ergebnis.set(t.id, new Map(stapel.map(s => [s.level, s.name.trim()])));
    if (istGruppe(tasks, i)) stapel.push({ name: t.name, level });
  });
  return ergebnis;
}

/** Vorhandene Stufen mit ihren Werten in Gantt-Reihenfolge: je Gliederungsebene mit Gruppen (die Tasks enthalten) eine Stufe,
 *  zuletzt die Bauteilart (Kürzel). */
export function gruppenStruktur(tasks: Task[]): PrioStufe[] {
  const jeEbene = new Map<number, string[]>();
  const kuerzel: string[] = [];
  const gruppen = gruppenJeTask(tasks);
  tasks.forEach((t, i) => {
    if (t.isGroup || istGruppe(tasks, i)) return;
    for (const [ebene, name] of gruppen.get(t.id) ?? []) {
      const werte = jeEbene.get(ebene) ?? [];
      if (!werte.includes(name)) werte.push(name);
      jeEbene.set(ebene, werte);
    }
    if (t.bauteilKuerzel && !kuerzel.includes(t.bauteilKuerzel)) kuerzel.push(t.bauteilKuerzel);
  });
  return [
    ...[...jeEbene.entries()].sort((a, b) => a[0] - b[0]).map(([ebene, werte]): PrioStufe => ({ quelle: "gruppe", ebene, werte, aktiv: true })),
    ...(kuerzel.length > 0 ? [{ quelle: "kuerzel", werte: kuerzel, aktiv: true } as PrioStufe] : []),
  ];
}

const stufenSchluessel = (s: PrioStufe) => s.quelle === "gruppe" ? `gruppe|${s.ebene}` : "kuerzel";

/** Gespeicherte Reihenfolge mit dem aktuellen Gantt abgleichen: gespeicherte Stufen und Werte in ihrer Reihenfolge, neue Werte
 *  hinten angehängt, nicht mehr vorhandene entfernt; neue Stufen hinten (Bauteilart bleibt zuletzt, wenn sie es war). */
export function gruppenReihenfolgeAbgleichen(gespeichert: GruppenReihenfolge | undefined, tasks: Task[]): GruppenReihenfolge {
  const struktur = gruppenStruktur(tasks);
  if (!gespeichert) return { stufen: struktur };
  const vorhanden = new Map(struktur.map(s => [stufenSchluessel(s), s]));
  const stufen: PrioStufe[] = [];
  for (const g of gespeichert.stufen) {
    const s = vorhanden.get(stufenSchluessel(g));
    if (!s) continue;
    vorhanden.delete(stufenSchluessel(g));
    stufen.push({ ...g, werte: [...g.werte.filter(w => s.werte.includes(w)), ...s.werte.filter(w => !g.werte.includes(w))] });
  }
  for (const s of vorhanden.values()) {
    const kuerzelIdx = stufen.findIndex(x => x.quelle === "kuerzel");
    if (s.quelle === "gruppe" && kuerzelIdx >= 0 && kuerzelIdx === stufen.length - 1) stufen.splice(kuerzelIdx, 0, s);
    else stufen.push(s);
  }
  return { stufen };
}

/** Rang je Task: je aktiver Stufe die Position seines Werts (Task ohne Wert auf dieser Stufe, z.B. ausserhalb der Gruppen wie eine
 *  Magerbetonsohle zuoberst: -1 = vorne) — kleiner = bekommt zuerst Personal. */
export function rangJeTask(tasks: Task[], reihenfolge: GruppenReihenfolge): Map<string, number[]> {
  const gruppen = gruppenJeTask(tasks);
  const aktive = reihenfolge.stufen.filter(s => s.aktiv);
  const ergebnis = new Map<string, number[]>();
  for (const t of tasks) {
    ergebnis.set(t.id, aktive.map(s => {
      const wert = s.quelle === "kuerzel" ? t.bauteilKuerzel : gruppen.get(t.id)?.get(s.ebene ?? 0);
      if (!wert) return -1;
      const i = s.werte.indexOf(wert);
      return i < 0 ? s.werte.length : i;
    }));
  }
  return ergebnis;
}

/** Ränge vergleichen (Stufe für Stufe) */
export function vergleicheRang(a: number[] | undefined, b: number[] | undefined): number {
  for (let i = 0; i < Math.max(a?.length ?? 0, b?.length ?? 0); i++) {
    const d = (a?.[i] ?? 0) - (b?.[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

/** Anzeige einer Stufe und eines Werts im Dialog */
export function stufenTitel(s: PrioStufe): string {
  return s.quelle === "kuerzel" ? "Bauteilart" : `Gruppenebene ${s.ebene}`;
}
export function wertLabel(s: PrioStufe, wert: string, stammdaten: Stammdaten): string {
  if (s.quelle !== "kuerzel") return wert;
  const bez = stammdaten.gewerke.flatMap(g => g.raten).find(r => r.kuerzel === wert)?.bezeichnung;
  return bez ? `${wert} · ${bez}` : wert;
}
