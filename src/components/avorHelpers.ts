// avorHelpers.ts — Tagesreihen für den Tab AVOR (Personal-/Kranauslastung, Mengen-Filter,
// Ertragsoptik), berechnet aus Tasks + Stammdaten + Arbeitstage-Kalender. Reine Funktionen, kein UI.
import type { Task, TagesLauf } from "../types";
import { parseDateUniversal, terminSchluessel } from "../types";
import type { Kalender } from "./kalenderHelpers";
import { istArbeitstag } from "./kalenderHelpers";
import { arbeitsAnteilAmTag, dauerTage } from "./zeitHelpers";
import type { Stammdaten, Gewerk, Rate, TaskPhase } from "./stammdatenHelpers";
import { istMengeKranpflichtig, schritteFuerTask, kranzeitAnteil } from "./stammdatenHelpers";

export interface TagWert { tag: string; werte: Record<string, number> }

function toIso(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Gesamtzeitraum aller Tasks (min Start / max Ende) — Grundlage für alle Tagesreihen dieses Moduls
 *  sowie für die Zeitraster-Buckets (Monat/Woche) in kranHelpers.ts. */
export function projektzeitraum(tasks: Task[]): { start: Date; end: Date } | null {
  let minT = Infinity, maxT = -Infinity;
  for (const t of tasks) {
    const s = parseDateUniversal(t.start), e = parseDateUniversal(t.end);
    if (s) minT = Math.min(minT, s.getTime());
    if (e) maxT = Math.max(maxT, e.getTime());
  }
  if (minT === Infinity || maxT === -Infinity) return null;
  return { start: new Date(minT), end: new Date(maxT) };
}

function rateFuer(gewerk: Gewerk, kuerzel: string) {
  return gewerk.raten.find(r => r.kuerzel === kuerzel);
}

/** Läuft t am Kalendertag iso (Task-Start/Ende als YYYY-MM-DD, lexikografisch vergleichbar)? */
function laeuftAn(t: Task, iso: string): boolean {
  return !t.isGroup && !!t.bauteilKuerzel && !!t.mengen && iso >= t.start && iso <= t.end;
}

/** Leistungspositionen eines Tasks mit Arbeit, Min. Personen, Unternehmer, Kranzeit und Ablauf sowie Std./Tag als Text — ein
 *  gespeicherter Ablauf (Task.tagesArbeit) gilt nur, solange er gleich bleibt (Mengen oder Tab Ressourcen geändert → ungültig). */
export function tagesArbeitBasis(t: Task, stammdaten: Stammdaten): string {
  const text = JSON.stringify([stammdaten.arbeitszeitStdProTag, schritteFuerTask(t, stammdaten).map(s => [s.schritt, s.phasen.map(p =>
    [p.position, p.unternehmer, p.kranpflichtig, p.kolonne, Math.round(p.kranAnteil * 1e6), Math.round(p.personenstunden * 1e6)])])]);
  let h = 5381;
  for (let i = 0; i < text.length; i++) h = ((h * 33) ^ text.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

/** Gespeicherter Ablauf aus "Auslastung optimieren", wenn er noch gilt: gleiche Termine, gleiche Leistungspositionen/Mengen, alle
 *  Tage Arbeitstage — sonst null. */
export function gueltigeTagesArbeit(t: Task, stammdaten: Stammdaten, kalender: Kalender): Record<string, TagesLauf[]> | null {
  const ta = t.tagesArbeit;
  if (!ta?.tage || ta.termin !== terminSchluessel(t) || ta.basis !== tagesArbeitBasis(t, stammdaten)) return null;
  return Object.keys(ta.tage).every(iso => istArbeitstag(iso, kalender)) ? ta.tage : null;
}

/** Aufwand eines Tasks an einem Tag in einer Phase (Schritt + Leistungsposition), siehe aufwandJeTagUndPhaseFuerTask. */
export interface PhasenAufwand { schritt: number; phase: TaskPhase; personenstunden: number }

/**
 * Aufwand (Personenstunden) je Tag und Phase für einen Task — die gemeinsame Grundlage aller Auswertungen in Tab AVOR
 * (Personal, Ertrag, Kosten im Zeitverlauf, Kranstunden, Kran-Personal):
 *  1. Je Gewerk ist der Aufwand Menge × Leistungswert (Personenstunden). Der Ablauf folgt "Arbeitsablauf je Kürzel" (Tab
 *     Ressourcen, siehe schritteFuerTask): Schritte nacheinander, Phasen eines Schritts gleichzeitig, jede so lange, wie sie laut
 *     Kalkulation braucht: Aufwand ÷ (Kolonne × Std./Tag) — dieselbe Rechnung wie die berechnete Dauer in Tab Kalkulation.
 *  2. Ist der Task im Gantt länger oder kürzer als die Summe der Schritte, werden alle Phasen im gleichen Verhältnis gestreckt
 *     bzw. gestaucht — derselbe Aufwand verteilt sich auf mehr bzw. weniger Tage.
 *  Summe über alle Tage = Menge × Leistungswert, unabhängig von der Dauer im Gantt. Gewerke ohne Leistungswert haben keinen
 *  Aufwand. Halbe Tage/Stunden zählen mit ihrem Anteil am Arbeitstag.
 *  Ausnahme: hat "Auslastung optimieren" die Arbeit des Tasks auf die Tage verteilt (Task.tagesArbeit) und sind seine Termine
 *  seither gleich, gilt diese Verteilung — so wie Personal und Kran die Arbeit dort im Arbeitstag geschafft haben.
 */
export function aufwandJeTagUndPhaseFuerTask(t: Task, stammdaten: Stammdaten, kalender: Kalender): Map<string, PhasenAufwand[]> {
  const ergebnis = new Map<string, PhasenAufwand[]>();
  if (t.isGroup || !t.bauteilKuerzel || !t.mengen || !t.start || !t.end) return ergebnis;
  const schritte = schritteFuerTask(t, stammdaten);
  const berechnet = schritte.reduce((s, x) => s + x.tage, 0);
  if (berechnet <= 0) return ergebnis;

  // Ablauf aus "Auslastung optimieren" — nur, wenn er zu Terminen, Mengen und Leistungspositionen passt
  const verteilt = gueltigeTagesArbeit(t, stammdaten, kalender);
  if (verteilt) {
    for (const iso of Object.keys(verteilt).sort()) {
      const jePos = new Map<string, number>();
      for (const l of verteilt[iso]) jePos.set(l.pos, (jePos.get(l.pos) ?? 0) + l.ph);
      const liste: PhasenAufwand[] = [];
      for (const s of schritte) for (const p of s.phasen) {
        const ph = jePos.get(p.position) ?? 0;
        if (ph > 1e-9) liste.push({ schritt: s.schritt, phase: p, personenstunden: ph });
      }
      if (liste.length > 0) ergebnis.set(iso, liste);
    }
    return ergebnis;
  }

  // Arbeitstage des Tasks mit ihrem Anteil (ganzer Tag = 1, Halbtag = 0.5)
  const s = parseDateUniversal(t.start), e = parseDateUniversal(t.end);
  if (!s || !e) return ergebnis;
  const tage: { iso: string; anteil: number }[] = [];
  for (const cur = new Date(s.getTime()); cur.getTime() <= e.getTime(); cur.setDate(cur.getDate() + 1)) {
    const iso = toIso(cur);
    const anteil = arbeitsAnteilAmTag(t, iso, kalender);
    if (anteil > 0) tage.push({ iso, anteil });
  }
  const geplant = tage.reduce((sum, tg) => sum + tg.anteil, 0);
  if (geplant <= 0) return ergebnis;

  const faktor = geplant / berechnet; // > 1: im Gantt länger als berechnet → Phasen gestreckt
  let pos = 0;
  for (const tg of tage) {
    const von = pos, bis = pos + tg.anteil;
    const liste: PhasenAufwand[] = [];
    let schrittVon = 0;
    for (const s of schritte) {
      for (const p of s.phasen) {
        const laenge = p.tage * faktor, phaseBis = schrittVon + laenge;
        const ueberlappung = Math.min(bis, phaseBis) - Math.max(von, schrittVon);
        if (ueberlappung > 1e-9 && laenge > 0) liste.push({ schritt: s.schritt, phase: p, personenstunden: p.personenstunden * ueberlappung / laenge });
      }
      schrittVon += s.tage * faktor;
    }
    ergebnis.set(tg.iso, liste);
    pos = bis;
  }
  return ergebnis;
}

/** Aufwand (Personenstunden) je Gewerk und Tag für einen Task — Summe der Phasen aus aufwandJeTagUndPhaseFuerTask. */
export function aufwandJeTagFuerTask(t: Task, stammdaten: Stammdaten, kalender: Kalender): Map<string, Record<string, number>> {
  const ergebnis = new Map<string, Record<string, number>>();
  for (const [iso, liste] of aufwandJeTagUndPhaseFuerTask(t, stammdaten, kalender)) {
    const werte: Record<string, number> = {};
    for (const a of liste) werte[a.phase.gewerkKey] = (werte[a.phase.gewerkKey] ?? 0) + a.personenstunden;
    ergebnis.set(iso, werte);
  }
  return ergebnis;
}

/** Personen (Vollzeit-Äquivalent) je Gewerk und Tag für einen Task: Aufwand des Tages ÷ Std./Tag (siehe
 *  aufwandJeTagFuerTask). Stimmt die Dauer im Gantt mit der berechneten überein, sind das genau die
 *  Kolonnengrössen aus Tab Ressourcen, sonst Kolonne × berechnete ÷ geplante Dauer. */
export function personalJeTagFuerTask(t: Task, stammdaten: Stammdaten, kalender: Kalender): Map<string, Record<string, number>> {
  const ergebnis = new Map<string, Record<string, number>>();
  for (const [iso, aufwand] of aufwandJeTagFuerTask(t, stammdaten, kalender)) {
    const werte: Record<string, number> = {};
    for (const [k, ph] of Object.entries(aufwand)) werte[k] = ph / stammdaten.arbeitszeitStdProTag;
    ergebnis.set(iso, werte);
  }
  return ergebnis;
}

/** Eingeplantes Personal je Tag und Gewerk ohne Kranpersonal = Kolonnen wie im Rechenkern (ablaufKern.ts): je Gewerk + Unternehmer
 *  eine Kolonne, die immer nur an einer Arbeit gleichzeitig arbeitet und von Arbeit zu Arbeit geht. Sie zählt an einem Tag nur
 *  einmal, mit den grössten Min. Personen der Leistungspositionen, an denen sie an diesem Tag arbeitet (z.B. Wandschalung 4 und
 *  Deckenschalung 6 derselben Unternehmung → 6 Personen, nicht 10). Verschiedene Unternehmer eines Gewerks addieren sich.
 *  kolonnen = Anzahl Kolonnen, personen = Summe ihrer Grössen. Grundlage für Eingeplant/Auslastung und "Perfekte Auslastung". */
export function kolonnenJeTag(tasks: Task[], stammdaten: Stammdaten, kalender: Kalender): Map<string, Record<string, { kolonnen: number; personen: number }>> {
  const jeTag = new Map<string, Map<string, Map<string, number>>>(); // Tag → Gewerk → Unternehmer → grösste Min. Personen
  for (const t of tasks) {
    for (const [iso, liste] of aufwandJeTagUndPhaseFuerTask(t, stammdaten, kalender)) {
      const jeGewerk = jeTag.get(iso) ?? new Map<string, Map<string, number>>();
      for (const a of liste) {
        if (!(a.personenstunden > 1e-9) || !a.phase.kolonne) continue;
        const jeUnternehmer = jeGewerk.get(a.phase.gewerkKey) ?? new Map<string, number>();
        jeUnternehmer.set(a.phase.unternehmer, Math.max(jeUnternehmer.get(a.phase.unternehmer) ?? 0, a.phase.kolonne));
        jeGewerk.set(a.phase.gewerkKey, jeUnternehmer);
      }
      jeTag.set(iso, jeGewerk);
    }
  }
  const ergebnis = new Map<string, Record<string, { kolonnen: number; personen: number }>>();
  for (const [iso, jeGewerk] of jeTag) {
    const werte: Record<string, { kolonnen: number; personen: number }> = {};
    for (const [k, jeU] of jeGewerk) werte[k] = { kolonnen: jeU.size, personen: [...jeU.values()].reduce((s, v) => s + v, 0) };
    ergebnis.set(iso, werte);
  }
  return ergebnis;
}

/** Kranstunden je Tag für einen Task: Aufwand der kranpflichtigen Gewerke ÷ Kolonne × Kranzeit (Tab Ressourcen, leer = 100 %) —
 *  die Zeit, in der die Kolonne laut Leistungswert am Bauteil arbeitet, davon der Anteil mit Kran (z.B. Stütze 6 Personenstunden
 *  ÷ 3 Personen × 50 % = 1 Kranstunde), verteilt wie der Aufwand (aufwandJeTagFuerTask). Nicht kranpflichtige Gewerke zählen nicht. */
export function kranstundenJeTagFuerTask(t: Task, stammdaten: Stammdaten, kalender: Kalender): Map<string, number> {
  const ergebnis = new Map<string, number>();
  for (const [iso, aufwand] of aufwandJeTagFuerTask(t, stammdaten, kalender)) {
    let stunden = 0;
    for (const [k, ph] of Object.entries(aufwand)) {
      if (!istMengeKranpflichtig(stammdaten, k, t.bauteilKuerzel)) continue;
      const gewerk = stammdaten.gewerke.find(g => g.key === k);
      const rate = gewerk ? rateFuer(gewerk, t.bauteilKuerzel!) : undefined;
      if (rate?.anzahlPersonen) stunden += ph / rate.anzahlPersonen * kranzeitAnteil(rate);
    }
    if (stunden > 0) ergebnis.set(iso, stunden);
  }
  return ergebnis;
}

/** Leistungsposition = Gewerk + Bauteil-Kürzel (eine Rate in Tab Ressourcen, z.B. "Schalung · WB Wandschalung"). */
export interface Leistungsposition { key: string; gewerkKey: string; gewerk: string; kuerzel: string; bezeichnung: string }

/** Personalbedarf je Arbeitstag, aufgeschlüsselt nach Leistungsposition (Personenstunden) — dieselbe Rechnung wie die
 *  Personalauslastung (aufwandJeTagFuerTask), nur feiner gegliedert. Grundlage des Exports in Tab AVOR. Positionen in der
 *  Reihenfolge von Tab Ressourcen, nur solche mit Aufwand. */
export function personalbedarfJeLeistungsposition(tasks: Task[], stammdaten: Stammdaten, kalender: Kalender): {
  positionen: Leistungsposition[]; tage: { tag: string; stunden: Record<string, number> }[];
} {
  const jeTag = new Map<string, Record<string, number>>();
  const benutzt = new Set<string>();
  for (const t of tasks) {
    for (const [iso, aufwand] of aufwandJeTagFuerTask(t, stammdaten, kalender)) {
      const werte = jeTag.get(iso) ?? {};
      for (const [gewerkKey, ph] of Object.entries(aufwand)) {
        const key = `${gewerkKey}::${t.bauteilKuerzel}`;
        werte[key] = (werte[key] ?? 0) + ph;
        benutzt.add(key);
      }
      jeTag.set(iso, werte);
    }
  }
  const positionen: Leistungsposition[] = [];
  for (const g of stammdaten.gewerke) for (const r of g.raten) {
    const key = `${g.key}::${r.kuerzel}`;
    if (benutzt.has(key)) positionen.push({ key, gewerkKey: g.key, gewerk: g.label || g.key, kuerzel: r.kuerzel, bezeichnung: r.bezeichnung });
  }
  const zeitraum = projektzeitraum(tasks);
  const tage: { tag: string; stunden: Record<string, number> }[] = [];
  if (zeitraum) {
    for (const cur = new Date(zeitraum.start.getTime()); cur.getTime() <= zeitraum.end.getTime(); cur.setDate(cur.getDate() + 1)) {
      const iso = toIso(cur);
      if (istArbeitstag(iso, kalender)) tage.push({ tag: iso, stunden: jeTag.get(iso) ?? {} });
    }
  }
  return { positionen, tage };
}

/** Für jeden Tag im Projektzeitraum: Personen je Gewerk, summiert über alle laufenden Tasks (siehe
 *  personalJeTagFuerTask — Gewerke nacheinander, Personen aus dem kalkulierten Aufwand). */
export function personalauslastung(tasks: Task[], stammdaten: Stammdaten, kalender: Kalender): TagWert[] {
  const zeitraum = projektzeitraum(tasks);
  if (!zeitraum) return [];
  const jeTag = new Map<string, Record<string, number>>();
  for (const t of tasks) {
    for (const [iso, werteTask] of personalJeTagFuerTask(t, stammdaten, kalender)) {
      const werte = jeTag.get(iso) ?? {};
      for (const [k, v] of Object.entries(werteTask)) werte[k] = (werte[k] ?? 0) + v;
      jeTag.set(iso, werte);
    }
  }
  const ergebnis: TagWert[] = [];
  const cur = new Date(zeitraum.start.getTime());
  while (cur.getTime() <= zeitraum.end.getTime()) {
    const iso = toIso(cur);
    ergebnis.push({ tag: iso, werte: jeTag.get(iso) ?? {} });
    cur.setDate(cur.getDate() + 1);
  }
  return ergebnis;
}

/** Menge/Tag für ein Gewerk ("durchschnittlich nötige Tagesleistung"). Mit stammdaten verteilt wie der Aufwand
 *  (aufwandJeTagFuerTask — Gewerke je Task nacheinander, also z.B. Beton erst am Ende), damit Mengen-Filter und
 *  Personalauslastung dieselben Tage zeigen; ohne Leistungswert (kein Aufwand) bzw. ohne stammdaten gleichmässig über die
 *  Arbeitstage des Tasks. Mit kuerzel eingeschränkt auf Tasks dieses Bauteil-Kürzels (z.B. "BPL"), analog den kürzelweisen
 *  Filterblättern im AVOR-Excel-Tool. */
export function mengenProTag(tasks: Task[], gewerkKey: string, kalender: Kalender, kuerzel?: string, stammdaten?: Stammdaten): { tag: string; menge: number }[] {
  const zeitraum = projektzeitraum(tasks);
  if (!zeitraum) return [];
  // je Task: Anteil des Gewerk-Aufwands je Tag (Summe 1) — nur wenn es Aufwand gibt
  const anteilJeTask = new Map<string, Map<string, number>>();
  if (stammdaten) {
    for (const t of tasks) {
      if (t.isGroup || !t.mengen?.[gewerkKey] || (kuerzel && t.bauteilKuerzel !== kuerzel)) continue;
      const proTag = new Map<string, number>();
      let summe = 0;
      for (const [iso, aufwand] of aufwandJeTagFuerTask(t, stammdaten, kalender)) {
        const ph = aufwand[gewerkKey] ?? 0;
        if (ph > 0) { proTag.set(iso, ph); summe += ph; }
      }
      if (summe > 0) { for (const [iso, ph] of proTag) proTag.set(iso, ph / summe); anteilJeTask.set(t.id, proTag); }
    }
  }
  const ergebnis: { tag: string; menge: number }[] = [];
  const cur = new Date(zeitraum.start.getTime());
  while (cur.getTime() <= zeitraum.end.getTime()) {
    const iso = toIso(cur);
    let menge = 0;
    if (istArbeitstag(iso, kalender)) {
      for (const t of tasks) {
        if (t.isGroup) continue;
        if (kuerzel && t.bauteilKuerzel !== kuerzel) continue;
        const m = t.mengen?.[gewerkKey];
        if (!m || iso < t.start || iso > t.end) continue;
        const anteile = anteilJeTask.get(t.id);
        menge += anteile ? m * (anteile.get(iso) ?? 0) : m * arbeitsAnteilAmTag(t, iso, kalender) / dauerTage(t, kalender);
      }
    }
    ergebnis.push({ tag: iso, menge });
    cur.setDate(cur.getDate() + 1);
  }
  return ergebnis;
}

/** "Optimal ausgelastete Tagesleistung" einer Rate: Menge, die eine voll ausgelastete Kolonne
 *  (anzahlPersonen Personen, arbeitszeitStdProTag Std./Tag) bei ihrem Leistungswert an einem
 *  Arbeitstag schafft — analog der roten Referenzzeile im AVOR-Excel-Tool
 *  ("=(1/Leistungswert)*AnzahlPersonen*ArbeitszeitProTag"). null wenn kein Leistungswert
 *  hinterlegt ist (im Excel-Tool als "-" dargestellt). */
export function optimaleTagesleistung(rate: Rate, arbeitszeitStdProTag: number): number | null {
  if (!rate.leistungswertHProEinheit) return null;
  return (1 / rate.leistungswertHProEinheit) * rate.anzahlPersonen * arbeitszeitStdProTag;
}

/** Kumulierte Ertrags-/Kostenkurve über die Zeit (Ertragsoptik):
 *  - Ertrag = Menge × Einheitspreis (Rate.chfProEinheit, Tab Ressourcen "Einheitspreis [CHF/Einh.]")
 *  - Kosten = Personenstunden (Menge × Leistungswert) × Lohnansatz (Stammdaten.umsatzChfProMannstunde, "Lohnansatz [CHF/h]")
 *  Beides fällt je Gewerk im selben Verhältnis an wie sein Aufwand (Gewerke je Task nacheinander); ein Gewerk ohne
 *  Leistungswert (kein Aufwand) verteilt seinen Ertrag gleichmässig über die Arbeitszeit des Tasks. */
export function ertragsoptik(tasks: Task[], stammdaten: Stammdaten, kalender: Kalender): { tag: string; ertragKum: number; kostenKum: number }[] {
  const zeitraum = projektzeitraum(tasks);
  if (!zeitraum) return [];
  const lohnansatz = stammdaten.umsatzChfProMannstunde ?? 80;
  const ergebnis: { tag: string; ertragKum: number; kostenKum: number }[] = [];
  let ertragKum = 0, kostenKum = 0;
  const aufwandJeTask = new Map(tasks.map(t => [t.id, aufwandJeTagFuerTask(t, stammdaten, kalender)]));
  const aufwandGesamtJeTask = new Map([...aufwandJeTask].map(([id, jeTag]) => {
    const summe: Record<string, number> = {};
    for (const w of jeTag.values()) for (const [k, v] of Object.entries(w)) summe[k] = (summe[k] ?? 0) + v;
    return [id, summe] as const;
  }));
  const cur = new Date(zeitraum.start.getTime());
  while (cur.getTime() <= zeitraum.end.getTime()) {
    const iso = toIso(cur);
    if (istArbeitstag(iso, kalender)) {
      for (const t of tasks) {
        if (!laeuftAn(t, iso)) continue;
        const anteil = arbeitsAnteilAmTag(t, iso, kalender);
        if (!anteil) continue;
        const aufwandTag = aufwandJeTask.get(t.id)?.get(iso) ?? {};
        for (const gewerk of stammdaten.gewerke) {
          const menge = t.mengen![gewerk.key];
          if (!menge) continue;
          const ph = aufwandTag[gewerk.key] ?? 0;
          kostenKum += ph * lohnansatz;
          const rate = rateFuer(gewerk, t.bauteilKuerzel!);
          if (!rate?.chfProEinheit) continue;
          const gesamt = aufwandGesamtJeTask.get(t.id)?.[gewerk.key] ?? 0;
          ertragKum += menge * rate.chfProEinheit * (gesamt > 0 ? ph / gesamt : anteil / dauerTage(t, kalender));
        }
      }
    }
    ergebnis.push({ tag: iso, ertragKum, kostenKum });
    cur.setDate(cur.getDate() + 1);
  }
  return ergebnis;
}
