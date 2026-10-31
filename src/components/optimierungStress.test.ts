// Stresstest der Optimierung: viele zufällige (aber reproduzierbare) Projekte — Etappen/Geschosse, aufgeteilte Leistungspositionen,
// Kräne mit Zeitfenstern, Feiertage/Ferien, Vorgänger mit Wartetagen, Ablaufregeln, alle Zeiteinheiten und Reihenfolgen — und nach
// jeder Rechnung die Kontrollen: keine NaN, jede Arbeit genau einmal geleistet, Schritte und Vorgänger eingehalten, nur Arbeitstage,
// Rechnung endet (keine Endlosschleife), Regeln/Nachführen stabil (erneut anwenden ändert nichts).
import { describe, it, expect } from "vitest";
import type { Task, Kran, AblaufRegel, SimProjekt } from "../types";
import { vorgaengerStart, istGruppe } from "../types";
import type { Stammdaten, Rate } from "./stammdatenHelpers";
import { LEERE_STAMMDATEN, schritteFuerTask, hatKalkulationsWerte } from "./stammdatenHelpers";
import type { Kalender } from "./kalenderHelpers";
import { istArbeitstag, arbeitstageZwischen } from "./kalenderHelpers";
import type { Zeiteinheit } from "./zeitHelpers";
import { startZeitpunkt, vergleicheZeitpunkte, arbeitsMinutenZwischen, arbeitsMinBis, MIN_PRO_ARBEITSTAG, endeAusArbeitsMinuten, naechsteArbeitszeit, uhrzeitAusArbeitsMin, ARBEITSBEGINN_MIN, ARBEITSENDE_MIN, MITTAG_VON_MIN, MITTAG_BIS_MIN } from "./zeitHelpers";
import { optimiereAuslastung, optimierungUebernehmen } from "./auslastungOptimieren";
import type { OptimierReihenfolge } from "./auslastungOptimieren";
import { gruppenReihenfolgeAbgleichen } from "./gruppenReihenfolge";
import { simRegelnAnwenden } from "./ablaufRegeln";
import { simNachfuehren } from "./nachfuehren";
import { aufwandJeTagFuerTask } from "./avorHelpers";
import { tagesplan } from "./tagesplan";
import { MAX_VERSTAERKUNG } from "./ablaufKern";

// reproduzierbarer Zufall
function zufall(seed: number) {
  let a = seed >>> 0;
  const r = () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  return { r, int: (lo: number, hi: number) => lo + Math.floor(r() * (hi - lo + 1)), aus: <T,>(l: readonly T[]): T => l[Math.floor(r() * l.length)], ja: (p: number) => r() < p };
}

const tagPlus = (iso: string, n: number) => { const d = new Date(iso + "T12:00:00"); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };
const BASIS = "2026-11-02";
const BETON = ["FU", "BPL", "WB", "ST", "DB"] as const;

function projekt(seed: number, gross = false) {
  const z = zufall(seed);
  const unternehmer = ["Bau AG", "Eisen GmbH", "Beton AG", ""];
  const rate = (kuerzel: string, schritte: string[]): Rate => ({
    kuerzel, bezeichnung: kuerzel, leistungswertHProEinheit: z.ja(0.05) ? null : Math.round((0.05 + z.r() * 1.5) * 100) / 100,
    anzahlPersonen: z.ja(0.04) ? 0 : z.int(1, 6), chfProEinheit: null, unternehmer: z.aus(unternehmer), kranpflichtig: z.ja(0.7),
    kranzeitProzent: z.aus([undefined, 0, 20, 50, 100]), schritt: z.aus(schritte),
  });
  const sd: Stammdaten = { ...LEERE_STAMMDATEN, arbeitszeitStdProTag: z.aus([8, 8.5, 9]), gewerke: [
    { key: "sch", label: "Schalung", einheit: "m2", raten: BETON.map(k => rate(k, ["", "1", "1:70/4:30", "1/3", "1:60/3:40", "2"])) },
    { key: "bew", label: "Bewehrung", einheit: "t", raten: BETON.map(k => rate(k, ["", "2", "1/2"])) },
    { key: "bet", label: "Beton", einheit: "m3", raten: BETON.map(k => rate(k, ["", "3", "2"])) },
    { key: "ele", label: "Elemente", einheit: "St", raten: [rate("EM", ["", "1"])] },
    { key: "kan", label: "Kanalisation", einheit: "m", raten: [rate("KANAL", ["", "1"])] },
  ] } as Stammdaten;
  const kal: Kalender = { feiertage: [{ datum: "2026-12-25", name: "W" }, { datum: "2027-01-01", name: "N" }, { datum: "2027-04-02", name: "K" }],
    ferien: z.ja(0.5) ? [{ von: "2026-12-21", bis: "2027-01-03", name: "Ferien" }] : [], ...(z.ja(0.1) ? { freieTageGelten: false } : {}) };

  const tasks: Task[] = [];
  let n = 0;
  const neu = (p: Partial<Task>): Task => {
    const kuerzel = p.bauteilKuerzel;
    const mengen: Record<string, number> = {};
    if (kuerzel) for (const g of sd.gewerke) if (g.raten.some(r => r.kuerzel === kuerzel)) mengen[g.key] = z.ja(0.1) ? 0 : Math.round(z.r() * 120 * 10) / 10;
    const start = tagPlus(BASIS, z.int(-3, gross ? 200 : 60));
    const t: Task = { id: `t${n++}`, name: `${kuerzel ?? "Task"} ${n}`, start, end: tagPlus(start, z.int(0, 8)), typ: "neubau", objektGuids: [],
      ...(kuerzel ? { mengen } : {}), ...p };
    if (z.ja(0.03)) { t.meilenstein = true; t.end = t.start; }
    if (z.ja(0.05) && kuerzel) t.berechneteDauerManuell = z.int(1, 5);
    return t;
  };
  tasks.push(neu({ bauteilKuerzel: "KANAL", name: "Kanalisation Etappe A" }), neu({ name: "Magerbeton Etappe A" }));
  const etappen = gross ? ["Etappe A", "Etappe B", "Etappe C"] : z.aus([["Etappe A"], ["Etappe A", "Etappe B"]]);
  const geschosse = gross ? ["UG", "EG", "1.OG", "2.OG"] : z.aus([["UG", "EG"], ["UG", "EG", "1.OG"]]);
  for (const e of etappen) {
    tasks.push({ id: `g${n++}`, name: e, start: "", end: "", typ: "neubau", objektGuids: [], isGroup: true, outlineLevel: 1 });
    for (const g of geschosse) {
      if (z.ja(0.1)) continue; // Lücke: Geschoss fehlt in dieser Etappe
      tasks.push({ id: `g${n++}`, name: g, start: "", end: "", typ: "neubau", objektGuids: [], isGroup: true, outlineLevel: 2 });
      for (let i = 0; i < (gross ? z.int(25, 35) : z.int(1, 5)); i++)
        tasks.push(neu({ outlineLevel: 3, bauteilKuerzel: z.ja(0.08) ? undefined : z.aus([...BETON, "EM", "WB", "DB"]) }));
    }
  }
  // Vorgänger nur rückwärts (kein Zirkel), manche mit Wartetagen, selten negativ
  const echte = tasks.filter((t, i) => !t.isGroup && !istGruppe(tasks, i));
  echte.forEach((t, i) => {
    if (i === 0 || !z.ja(0.35)) return;
    const liste = [...new Set(Array.from({ length: z.int(1, 2) }, () => echte[z.int(Math.max(0, i - 6), i - 1)].id))];
    const [erster, ...rest] = liste.map(id => ({ id, lagDays: z.ja(0.05) ? -1 : z.int(0, 3) }));
    t.predecessorId = erster.id; t.lagDays = erster.lagDays;
    if (rest.length) t.weitereVorgaenger = rest;
  });
  // Kräne mit Zeitfenstern und Personal je Unternehmer
  const kraene: Kran[] = Array.from({ length: gross ? 2 : z.int(0, 2) }, (_, k) => ({
    id: `k${k}`, name: `Kran ${k}`,
    ...(z.ja(0.3) ? { verfuegbarVon: tagPlus(BASIS, z.int(0, 20)) } : {}), ...(z.ja(0.2) ? { verfuegbarBis: tagPlus(BASIS, z.int(10, 120)) } : {}),
    personal: Array.from({ length: z.int(0, 3) }, (_, i) => ({ id: String(i), unternehmer: z.aus(unternehmer.slice(0, 3)), personen: z.aus([0, 1, 2, 3, 4, 6, 8, 2.5]),
      ...(z.ja(0.2) ? { von: tagPlus(BASIS, z.int(0, 30)) } : {}), ...(z.ja(0.2) ? { bis: tagPlus(BASIS, z.int(20, 90)) } : {}) })),
  }));
  for (const t of echte) if (kraene.length > 1 && z.ja(0.7)) t.kraene = z.ja(0.15) ? kraene.map(k => k.id) : [z.aus(kraene).id];
  const regeln: AblaufRegel[] = [
    { id: "platte", name: "Platte darunter", aktiv: z.ja(0.7), vor: [{ feld: "kuerzel", werte: ["DB"] }], nach: [{ feld: "kuerzel", werte: ["WB", "ST", "EM"] }, { feld: "name", werte: ["9"], nicht: true }], bezug: "darunter", ebene: 2, wartetage: z.int(0, 2) },
    { id: "bopla", name: "Bodenplatte", aktiv: z.ja(0.6), vor: [{ feld: "kuerzel", werte: ["BPL"] }], nach: [{ feld: "kuerzel", werte: ["WB", "ST"] }], bezug: "gleich", ebene: 2, wartetage: 0 },
    { id: "kanal", name: "Kanal", aktiv: z.ja(0.6), vor: [{ feld: "name", werte: ["Kanalisation"] }], nach: [{ feld: "name", werte: ["Magerbeton"] }], bezug: "ueberall", wartetage: 1 },
    { id: "eng", name: "Unternehmer", aktiv: z.ja(0.3), vor: [{ feld: "kategorie", werte: ["sch"] }, { feld: "gruppe", ebene: 1, werte: ["Etappe A"] }], nach: [{ feld: "gruppe", ebene: 1, werte: ["Etappe B"] }], bezug: "ueberall", wartetage: 0 },
  ];
  const einheit = z.aus<Zeiteinheit>(["tage", "tage", "halbtage", "stunden"]);
  const reihenfolge = z.aus<OptimierReihenfolge>(["gruppen", "kritischerPfad", "startdatum", "gantt"]);
  const sim: SimProjekt = { id: "s", name: "Stress", erstelltAm: BASIS, tasks, modelle: [], stammdaten: sd, kalender: kal, kraene, ablaufRegeln: regeln,
    zeiteinheit: einheit === "tage" ? undefined : einheit } as SimProjekt;
  return { sim, sd, kal, kraene, einheit, reihenfolge, luecken: z.ja(0.7), abBeginn: z.ja(0.5), z };
}

const zeit = (iso: string, h: number) => `${iso} ${h.toFixed(4).padStart(9, "0")}`;

/** Alle Kontrollen für das Ergebnis einer Optimierung */
function pruefe(tasks: Task[], sd: Stammdaten, kal: Kalender, geplant: Set<string>, info: string) {
  for (const t of tasks) {
    const text = JSON.stringify([t.start, t.end, t.startZeit, t.endZeit, t.tagesArbeit]);
    expect(text.includes("NaN") || text.includes("Infinity"), `${info} ${t.id}: NaN/Infinity`).toBe(false);
    if (t.isGroup || !t.start) continue;
    expect(/^\d{4}-\d{2}-\d{2}$/.test(t.start) && /^\d{4}-\d{2}-\d{2}$/.test(t.end), `${info} ${t.id}: Datum ${t.start}/${t.end}`).toBe(true);
    expect(t.end >= t.start, `${info} ${t.id}: Ende vor Start`).toBe(true);
  }
  for (const t of tasks) {
    if (!geplant.has(t.id)) continue;
    // Vorgänger eingehalten
    const frueh = vorgaengerStart(tasks, t, kal);
    if (frueh) expect(vergleicheZeitpunkte(frueh, startZeitpunkt(t)) <= 0, `${info} ${t.id} beginnt ${t.start} vor seinem Vorgänger (${frueh.datum})`).toBe(true);
    const schritte = schritteFuerTask(t, sd);
    if (schritte.length === 0 || !t.tagesArbeit) continue;
    // jede Arbeit genau einmal, nur an Arbeitstagen im Zeitraum des Tasks, Läufe in sich stimmig
    const soll = new Map(schritte.flatMap(s => s.phasen.map(p => [p.position, { ph: p.personenstunden, schritt: s.schritt, kolonne: p.kolonne }])));
    const ist = new Map<string, number>();
    const jeSchritt = new Map<number, { von: string; bis: string }>();
    for (const [iso, laeufe] of Object.entries(t.tagesArbeit.tage)) {
      expect(istArbeitstag(iso, kal), `${info} ${t.id}: Arbeit am freien Tag ${iso}`).toBe(true);
      expect(iso >= t.start && iso <= t.end, `${info} ${t.id}: Arbeit ${iso} ausserhalb ${t.start}–${t.end}`).toBe(true);
      for (const l of laeufe) {
        const s = soll.get(l.pos);
        expect(s, `${info} ${t.id}: unbekannte Position ${l.pos}`).toBeTruthy();
        expect(l.leute > 0 && l.bis >= l.von - 1e-6 && l.ph >= -1e-9, `${info} ${t.id}: Lauf ${JSON.stringify(l)}`).toBe(true);
        expect(Math.abs((l.bis - l.von) * l.leute - l.ph) < 0.01 + l.ph * 1e-3, `${info} ${t.id}: Lauf rechnet nicht auf ${JSON.stringify(l)}`).toBe(true);
        expect(l.leute <= MAX_VERSTAERKUNG * Math.max(1, s!.kolonne) + 1e-9, `${info} ${t.id}: ${l.leute} Leute an ${l.pos} (Kolonne ${s!.kolonne})`).toBe(true);
        ist.set(l.pos, (ist.get(l.pos) ?? 0) + l.ph);
        const j = jeSchritt.get(s!.schritt), von = zeit(iso, l.von), bis = zeit(iso, l.bis);
        jeSchritt.set(s!.schritt, { von: !j || von < j.von ? von : j.von, bis: !j || bis > j.bis ? bis : j.bis });
      }
    }
    for (const [pos, s] of soll) expect(Math.abs((ist.get(pos) ?? 0) - s.ph) < 0.01 + s.ph * 1e-4, `${info} ${t.id}: ${pos} geleistet ${ist.get(pos)} statt ${s.ph}`).toBe(true);
    // Schritte nacheinander
    const reihe = [...jeSchritt.entries()].sort((a, b) => a[0] - b[0]);
    for (let i = 1; i < reihe.length; i++) expect(reihe[i][1].von >= reihe[i - 1][1].bis, `${info} ${t.id}: Schritt ${reihe[i][0]} beginnt vor Ende von Schritt ${reihe[i - 1][0]}`).toBe(true);
    // Tab AVOR zählt jede Arbeit einmal
    const avor = new Map<string, number>();
    for (const w of aufwandJeTagFuerTask(t, sd, kal).values()) for (const [g, ph] of Object.entries(w)) avor.set(g, (avor.get(g) ?? 0) + ph);
    for (const s of schritte) for (const p of s.phasen) avor.set(p.gewerkKey, (avor.get(p.gewerkKey) ?? 0) - p.personenstunden);
    for (const [g, d] of avor) expect(Math.abs(d) < 0.02, `${info} ${t.id}: Tab AVOR ${g} weicht um ${d} h ab`).toBe(true);
  }
}

/** geplant = was die Optimierung anfasst (siehe optimiereMitKranpersonal) */
const geplanteIds = (tasks: Task[], sd: Stammdaten) => new Set(tasks.filter((t, i) => !t.isGroup && !istGruppe(tasks, i) && !!t.start && !!t.end && !t.meilenstein && hatKalkulationsWerte(t, sd)).map(t => t.id));

describe("Stresstest Optimierung", () => {
  const ANZAHL = 60;
  it(`${ANZAHL} zufällige Projekte: Regeln + Optimieren + Nachführen ohne Rechenfehler`, () => {
    let langsamste = { ms: 0, seed: 0 };
    for (let seed = 1; seed <= ANZAHL; seed++) {
      const { sim, sd, kal, kraene, einheit, reihenfolge, luecken, abBeginn, z } = projekt(seed);
      const info = `Seed ${seed} (${einheit}, ${reihenfolge}, ${kraene.length} Kräne${abBeginn ? ", ab Projektbeginn" : ""}):`;
      const t0 = performance.now();
      // 1. Regeln anwenden — stabil
      const s1 = simRegelnAnwenden(sim);
      expect(simRegelnAnwenden(s1), `${info} Regeln nicht stabil`).toBe(s1);
      // 2. Optimieren
      const gruppen = gruppenReihenfolgeAbgleichen(undefined, s1.tasks);
      const erg = optimierungUebernehmen(s1.tasks, optimiereAuslastung(s1.tasks, sd, kal, einheit, kraene, reihenfolge, luecken, { gruppen, abBeginn }));
      const geplant = geplanteIds(erg, sd);
      pruefe(erg, sd, kal, geplant, info);
      // Regel-Vorgänger überleben das Optimieren, und es ist nichts mehr zu verschieben
      const s2 = simRegelnAnwenden({ ...s1, tasks: erg });
      expect(s2.tasks, `${info} Regeln nach dem Optimieren nicht stabil`).toBe(erg);
      // 3. Erneut optimieren ergibt dieselben Termine
      const nochmal = optimiereAuslastung(erg, sd, kal, einheit, kraene, reihenfolge, luecken, { gruppen, abBeginn });
      const abw = nochmal.filter((t, i) => t.start !== erg[i].start || t.end !== erg[i].end || t.startZeit !== erg[i].startZeit || t.endZeit !== erg[i].endZeit);
      expect(abw.map(t => t.id), `${info} erneutes Optimieren verschiebt Tasks`).toEqual([]);
      // 4. Nachführen nach einer Änderung (Menge eines Tasks), wie in useUndo.ts — danach stabil
      const auto: SimProjekt = { ...s2, autoNachfuehren: { reihenfolge, luecken, ...(abBeginn ? {} : { abBeginn: false }) }, gruppenReihenfolge: gruppen };
      const ziel = [...geplant][z.int(0, Math.max(0, geplant.size - 1))];
      const geaendert: SimProjekt = { ...auto, tasks: auto.tasks.map(t => t.id === ziel && t.mengen ? { ...t, mengen: Object.fromEntries(Object.entries(t.mengen).map(([k, v]) => [k, v * 1.5 + 3])) } : t) };
      const nach = simNachfuehren(simRegelnAnwenden(geaendert));
      pruefe(nach.tasks, sd, kal, geplanteIds(nach.tasks, sd), `${info} nach Nachführen:`);
      const wieder = simNachfuehren(simRegelnAnwenden(nach));
      expect(wieder, `${info} Nachführen nicht stabil (würde bei jeder Änderung neu rechnen)`).toBe(nach);
      // 5. Tagesablauf in Tab AVOR rechnet an jedem Tag ohne NaN
      const tage = [...new Set(nach.tasks.flatMap(t => Object.keys(t.tagesArbeit?.tage ?? {})))].sort();
      for (const iso of tage.filter((_, i) => i % 7 === 0)) {
        const plan = tagesplan(iso, nach.tasks, sd, kal, kraene);
        expect(Number.isFinite(plan.dauer) && !JSON.stringify(plan).includes("NaN"), `${info} Tagesplan ${iso}`).toBe(true);
      }
      const ms = performance.now() - t0;
      if (ms > langsamste.ms) langsamste = { ms, seed };
    }
    console.log(`Stresstest: langsamstes Projekt Seed ${langsamste.seed}: ${Math.round(langsamste.ms)} ms`);
  }, 300_000);

  it("grosses Projekt (3 Etappen × 4 Geschosse, rund 350 Zeilen, 2 Kräne): Rechenzeit", () => {
    for (const einheit of ["tage", "stunden"] as const) {
      const { sim, sd, kal, kraene, reihenfolge, luecken } = projekt(4242, true);
      const s1 = simRegelnAnwenden(sim);
      const gruppen = gruppenReihenfolgeAbgleichen(undefined, s1.tasks);
      let t0 = performance.now();
      const erg = optimierungUebernehmen(s1.tasks, optimiereAuslastung(s1.tasks, sd, kal, einheit, kraene, reihenfolge, luecken, { gruppen }));
      const optimieren = performance.now() - t0;
      pruefe(erg, sd, kal, geplanteIds(erg, sd), `gross ${einheit}:`);
      // eine Änderung mit Automatisch nachführen (das passiert bei jedem Klick)
      const auto: SimProjekt = { ...s1, tasks: erg, autoNachfuehren: { reihenfolge, luecken }, gruppenReihenfolge: gruppen };
      const ziel = erg.find(t => t.mengen && geplanteIds(erg, sd).has(t.id))!;
      t0 = performance.now();
      const nach = simNachfuehren(simRegelnAnwenden({ ...auto, tasks: auto.tasks.map(t => t.id === ziel.id ? { ...t, mengen: { ...t.mengen, sch: (t.mengen?.sch ?? 0) + 50 } } : t) }));
      const aenderung = performance.now() - t0;
      t0 = performance.now();
      simRegelnAnwenden(nach);
      const nurRegeln = performance.now() - t0;
      pruefe(nach.tasks, sd, kal, geplanteIds(nach.tasks, sd), `gross ${einheit} nach Nachführen:`);
      console.log(`Gross (${einheit}, ${sim.tasks.length} Zeilen): Optimieren ${Math.round(optimieren)} ms, eine Änderung mit Nachführen ${Math.round(aenderung)} ms, Regeln allein ${Math.round(nurRegeln)} ms`);
      expect(optimieren).toBeLessThan(30_000);
    }
  }, 300_000);
});

describe("Arbeitsminuten zwischen zwei Zeitpunkten (vorgezählt)", () => {
  // Referenz: die bisherige Rechnung Tag für Tag (ohne die alte 10-Jahres-Grenze)
  const tagFuerTag = (s: { datum: string; min: number }, e: { datum: string; min: number }, kal: Kalender) => {
    if (s.datum === e.datum && s.min === e.min) return 0;
    const n = Math.round((new Date(e.datum + "T12:00:00").getTime() - new Date(s.datum + "T12:00:00").getTime()) / 86400000);
    let summe = 0;
    for (let i = 0; i <= n; i++) {
      const tag = tagPlus(s.datum, i);
      if (!istArbeitstag(tag, kal)) continue;
      summe += Math.max(0, (i === n ? arbeitsMinBis(e.min) : MIN_PRO_ARBEITSTAG) - (i === 0 ? arbeitsMinBis(s.min) : 0));
    }
    return summe > 0 ? summe : arbeitstageZwischen(s.datum, e.datum, kal) * MIN_PRO_ARBEITSTAG;
  };
  it("gleich wie Tag für Tag — auch über 10 Jahre, über Ferien, Feiertage und Zeitumstellung", () => {
    const z = zufall(7);
    const kalender: Kalender[] = [
      { feiertage: [{ datum: "2026-12-25", name: "W" }, { datum: "2031-08-01", name: "N" }], ferien: [{ von: "2026-12-21", bis: "2027-01-03", name: "F" }] },
      { feiertage: [], ferien: [] },
      { feiertage: [], ferien: [], freieTageGelten: false },
      { feiertage: [], ferien: [{ von: "2027-01-01", bis: "2027-12-31", name: "Jahr" }] },
    ];
    const minuten = [0, 7 * 60, 8 * 60, 10 * 60 + 15, 12 * 60, 12 * 60 + 30, 13 * 60, 16 * 60 + 45, 17 * 60, 23 * 60];
    for (let i = 0; i < 1500; i++) {
      const kal = z.aus(kalender);
      const s = { datum: tagPlus("2025-01-01", z.int(0, 4000)), min: z.aus(minuten) };
      const e = { datum: tagPlus(s.datum, z.aus([0, 0, 1, 2, 5, 30, 400, 4100, -3])), min: z.aus(minuten) };
      expect(arbeitsMinutenZwischen(s, e, kal), `${JSON.stringify(s)} → ${JSON.stringify(e)}`).toBe(tagFuerTag(s, e, kal));
    }
  }, 60_000); // grosszügig: der Build-Rechner (Vercel) ist langsamer als lokal, Vitest bricht sonst nach 5 s ab
  it("Ende nach X Arbeitsminuten: gleich wie Tag für Tag (auch über Jahre und Ferien)", () => {
    const z = zufall(11);
    const kalender: Kalender[] = [
      { feiertage: [{ datum: "2026-12-25", name: "W" }], ferien: [{ von: "2026-12-21", bis: "2027-01-03", name: "F" }] },
      { feiertage: [], ferien: [], freieTageGelten: false },
      { feiertage: [], ferien: [{ von: "2027-02-01", bis: "2027-11-30", name: "lang" }] },
    ];
    const tagFuerTag = (s: { datum: string; min: number }, minuten: number, kal: Kalender) => {
      const p = naechsteArbeitszeit(s, kal);
      let rest = Math.max(1, Math.round(minuten)), datum = p.datum, a = arbeitsMinBis(p.min);
      for (let i = 0; i < 40000; i++) {
        if (istArbeitstag(datum, kal)) {
          if (rest <= MIN_PRO_ARBEITSTAG - a) return { datum, min: uhrzeitAusArbeitsMin(a + rest, "ende") };
          rest -= MIN_PRO_ARBEITSTAG - a;
        }
        datum = tagPlus(datum, 1); a = 0;
      }
      return p;
    };
    for (let i = 0; i < 1500; i++) {
      const kal = z.aus(kalender);
      const s = { datum: tagPlus("2025-01-01", z.int(0, 3000)), min: z.aus([0, 7 * 60, 8 * 60, 10 * 60, 12 * 60 + 15, 13 * 60, 16 * 60 + 59, 17 * 60, 22 * 60]) };
      const m = z.aus([0, 1, 30, 60, 120, MIN_PRO_ARBEITSTAG - 1, MIN_PRO_ARBEITSTAG, MIN_PRO_ARBEITSTAG + 1, 2 * MIN_PRO_ARBEITSTAG, z.int(1, 5000) * 60, z.int(1, 900000)]);
      expect(endeAusArbeitsMinuten(s, m, kal), `${JSON.stringify(s)} + ${m} min`).toEqual(tagFuerTag(s, m, kal));
    }
  }, 60_000);
  it("nächster Arbeitszeitpunkt: gleich wie Tag für Tag", () => {
    const z = zufall(13);
    const kalender: Kalender[] = [
      { feiertage: [{ datum: "2026-12-25", name: "W" }], ferien: [{ von: "2026-12-21", bis: "2027-01-03", name: "F" }] },
      { feiertage: [], ferien: [], freieTageGelten: false },
      { feiertage: [], ferien: [{ von: "2027-02-01", bis: "2037-11-30", name: "sehr lang" }] },
    ];
    const tagFuerTag = (p: { datum: string; min: number }, kal: Kalender) => {
      let datum = p.datum, min = p.min;
      for (let i = 0; i < 4000; i++) {
        if (istArbeitstag(datum, kal)) {
          if (min < ARBEITSBEGINN_MIN) return { datum, min: ARBEITSBEGINN_MIN };
          if (min >= MITTAG_VON_MIN && min < MITTAG_BIS_MIN) return { datum, min: MITTAG_BIS_MIN };
          if (min < ARBEITSENDE_MIN) return { datum, min };
        }
        datum = tagPlus(datum, 1); min = 0;
      }
      return p;
    };
    for (let i = 0; i < 1500; i++) {
      const kal = z.aus(kalender);
      const p = { datum: tagPlus("2025-01-01", z.int(0, 4000)), min: z.int(0, 24 * 60) };
      expect(naechsteArbeitszeit(p, kal), JSON.stringify(p)).toEqual(tagFuerTag(p, kal));
    }
  }, 60_000);
});
