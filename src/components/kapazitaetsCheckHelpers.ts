// kapazitaetsCheckHelpers.ts — Bedarfs-/Angebots-Berechnung für den Kapazitäts-Check (Tab AVOR,
// KapazitaetsCheckManager.tsx), je Kran — dieselbe Zuordnung wie Kranoptik und Kran-Personal (Spalte "Kräne" in Tab
// Kalkulation, Task.kraene). Ein Task mit mehreren Kränen zählt bei jedem anteilig (kranAnteil, 0.5/0.33 …).
//
// Kernidee: menge × leistungswertHProEinheit sind bereits Personenstunden — siehe dauerGewerk() in
// stammdatenHelpers.ts. Hier wird diese Grösse über alle Tasks eines Krans aufsummiert und gegen ein frei
// eingegebenes Personal-Budget gestellt; die Kranstunden (Aufwand kranpflichtiger Gewerke ÷ Kolonne, siehe
// kranstundenJeTagFuerTask) gegen die verfügbaren Kranstunden.
import type { Task, Kran, Zeitraster } from "../types";
import { parseDateUniversal } from "../types";
import type { Kalender } from "./kalenderHelpers";
import { dauerTage, startZeitpunkt, endZeitpunkt, vergleicheZeitpunkte } from "./zeitHelpers";
import type { Stammdaten } from "./stammdatenHelpers";
import { rateFuerKuerzel, istMengeKranpflichtig } from "./stammdatenHelpers";
import { aufwandJeTagFuerTask, kranstundenJeTagFuerTask } from "./avorHelpers";
import type { ZeitrasterBucket } from "./kranHelpers";
import { zeitrasterBuckets, kranVerfuegbareArbeitstage, kranAnteil } from "./kranHelpers";

type Zeitraum = { start: string; end: string; startZeit?: string; endZeit?: string };

export interface KranKapazitaet {
  taskAnzahl: number;
  zeitraum: Zeitraum | null;    // frühester Start / spätestes Ende der Tasks dieses Krans
  arbeitstage: number;          // Arbeitstage dieses Zeitraums (inkl. halber Tage/Stunden)
  personenstunden: number;      // Bedarf: Σ Menge × Leistungswert (alle Gewerke) × Kran-Anteil
  kranstunden: number;          // Bedarf: Σ Kranstunden (kranpflichtige Gewerke) × Kran-Anteil
  kranVerfuegbarTage: number;   // Arbeitstage im Zeitraum, an denen der Kran laut Verfügbarkeit steht
}

/** Bedarf und Zeitraum eines Krans aus den ihm zugeordneten Tasks (Task.kraene). */
export function kapazitaetJeKran(tasks: Task[], kran: Kran, stammdaten: Stammdaten, kalender: Kalender): KranKapazitaet {
  let taskAnzahl = 0, personenstunden = 0, kranstunden = 0;
  let zeitraum: Zeitraum | null = null;
  for (const t of tasks) {
    if (t.isGroup || !t.kraene?.includes(kran.id) || !t.bauteilKuerzel || !t.mengen) continue;
    const anteil = kranAnteil(t.kraene.length);
    taskAnzahl++;
    for (const gewerk of stammdaten.gewerke) {
      const menge = t.mengen[gewerk.key];
      const rate = menge ? rateFuerKuerzel(gewerk, t.bauteilKuerzel) : undefined;
      if (menge && rate?.leistungswertHProEinheit) personenstunden += menge * rate.leistungswertHProEinheit * anteil;
    }
    for (const h of kranstundenJeTagFuerTask(t, stammdaten, kalender).values()) kranstunden += h * anteil;
    if (!parseDateUniversal(t.start) || !parseDateUniversal(t.end)) continue;
    if (!zeitraum) { zeitraum = { start: t.start, end: t.end, startZeit: t.startZeit, endZeit: t.endZeit }; continue; }
    if (vergleicheZeitpunkte(startZeitpunkt(t), startZeitpunkt(zeitraum)) < 0) { zeitraum.start = t.start; zeitraum.startZeit = t.startZeit; }
    if (vergleicheZeitpunkte(endZeitpunkt(t), endZeitpunkt(zeitraum)) > 0) { zeitraum.end = t.end; zeitraum.endZeit = t.endZeit; }
  }
  return {
    taskAnzahl, zeitraum, personenstunden, kranstunden,
    arbeitstage: zeitraum ? dauerTage(zeitraum, kalender) : 0,
    kranVerfuegbarTage: zeitraum ? kranVerfuegbareArbeitstage(kran, zeitraum, kalender) : 0,
  };
}

export interface PhasenAuswertung {
  arbeitstage: number;
  bedarfPersonenstunden: number;
  angebotPersonenstunden: number;
  deckung: "ok" | "fehlend";
  fehlendePersonen: number; // 0 wenn deckung "ok" — genauer Wert (Vollzeit-Äquivalent), nicht aufgerundet
}

/** Vergleicht Bedarf (Personenstunden aus Menge×Leistungswert) gegen Angebot (Personen × Arbeitszeit
 *  × Arbeitstage) eines Krans. arbeitstage kommt je nach Modus entweder aus dem echten Zeitraum seiner Tasks
 *  (kapazitaetJeKran) oder aus der frei eingegebenen Sandbox-Dauer. */
export function auswertungPhase(anzahlPersonen: number, bedarfPersonenstunden: number, arbeitszeitStdProTag: number, arbeitstage: number): PhasenAuswertung {
  const angebotPersonenstunden = anzahlPersonen * arbeitszeitStdProTag * arbeitstage;
  const deckung: "ok" | "fehlend" = angebotPersonenstunden >= bedarfPersonenstunden ? "ok" : "fehlend";
  const fehlendePersonen = deckung === "ok" || arbeitszeitStdProTag <= 0 || arbeitstage <= 0
    ? 0
    : (bedarfPersonenstunden - angebotPersonenstunden) / (arbeitszeitStdProTag * arbeitstage);
  return { arbeitstage, bedarfPersonenstunden, angebotPersonenstunden, deckung, fehlendePersonen };
}


// === Kran-Personal-Bilanz (grob, siehe kranHelpers.ts für die analoge Kranstunden-Bilanz in der
// Kranoptik) — nutzt die Kran-Zuordnung (Task.kraene) wie der übrige Kapazitäts-Check. Immer anhand der echten
// Task-Termine (kein Sandbox-Äquivalent — Kran-Zuweisung/Verfügbarkeit sind inhärent terminbasiert). */
export const MAX_PERSONEN_PRO_KRAN = 13;

export interface KranPersonalSerie { kranId: string; kranName: string; personenstunden: number[]; arbeitstageVerfuegbar: number[] }

/** Personenstunden-Bedarf (Menge × Leistungswert kranpflichtiger Gewerke) je Kran und Zeitraster-Bucket
 *  — über die Tage verteilt wie der Aufwand (aufwandJeTagFuerTask in avorHelpers.ts) und bei mehreren zugeordneten Kränen
 *  anteilig aufgeteilt (kranAnteil, 0.5/0.33…). Grundlage für personalRichtwertJeBucket(). */
export function personenstundenProKranUndBucket(tasks: Task[], kraene: Kran[], stammdaten: Stammdaten, kalender: Kalender, raster: Zeitraster): { buckets: ZeitrasterBucket[]; serien: KranPersonalSerie[] } {
  const buckets = zeitrasterBuckets(tasks, raster);
  if (buckets.length === 0 || kraene.length === 0) return { buckets, serien: [] };

  const serien: KranPersonalSerie[] = kraene.map(k => ({
    kranId: k.id, kranName: k.name,
    personenstunden: new Array(buckets.length).fill(0),
    arbeitstageVerfuegbar: buckets.map(b => kranVerfuegbareArbeitstage(k, b, kalender)),
  }));
  const serieByKranId = new Map(serien.map(s => [s.kranId, s]));
  const bucketIndexFuer = (iso: string) => buckets.findIndex(b => iso >= b.start && iso <= b.end);

  for (const t of tasks) {
    if (t.isGroup || !t.kraene || t.kraene.length === 0 || !t.bauteilKuerzel || !t.mengen) continue;
    const beteiligteSerien = t.kraene.map(id => serieByKranId.get(id)).filter((s): s is KranPersonalSerie => !!s);
    if (beteiligteSerien.length === 0) continue;
    const anteil = kranAnteil(t.kraene.length);

    for (const [iso, aufwand] of aufwandJeTagFuerTask(t, stammdaten, kalender)) {
      let personenstunden = 0;
      for (const [k, ph] of Object.entries(aufwand)) if (istMengeKranpflichtig(stammdaten, k, t.bauteilKuerzel)) personenstunden += ph;
      const bi = bucketIndexFuer(iso);
      if (personenstunden > 0 && bi !== -1) for (const s of beteiligteSerien) s.personenstunden[bi] += personenstunden * anteil;
    }
  }
  return { buckets, serien };
}

export interface KranPersonalRichtwert {
  richtwert: number | null; // gerundet, keine Nachkommastellen; null = keine sinnvolle Aussage (Kran nicht verfügbar)
  engpass: boolean; // über maxPersonenProKran ODER Kran im Bucket nicht verfügbar trotz Bedarf
  kranNichtVerfuegbar: boolean;
}

/** Ordnet den Personenstunden-Bedarf eines Kran/Bucket-Paars grob in einen Personal-Richtwert ein
 *  ("ungefährer Personalbedarf") — reine Ampel, keine exakte Personalrechnung. Ohne verfügbaren Kran
 *  im Bucket ist der Bedarf per Definition ungedeckt, unabhängig vom Personal. */
export function personalRichtwertJeBucket(personenstunden: number, arbeitstageVerfuegbar: number, arbeitszeitStdProTag: number, maxPersonenProKran: number = MAX_PERSONEN_PRO_KRAN): KranPersonalRichtwert {
  if (arbeitstageVerfuegbar <= 0 || arbeitszeitStdProTag <= 0) {
    return { richtwert: null, engpass: personenstunden > 0, kranNichtVerfuegbar: personenstunden > 0 };
  }
  // ungerundet (Anzeige mit 2 Nachkommastellen, siehe zahlFormat.tsx) — die Ampel vergleicht den genauen Wert
  const richtwert = personenstunden / (arbeitszeitStdProTag * arbeitstageVerfuegbar);
  return { richtwert, engpass: richtwert > maxPersonenProKran, kranNichtVerfuegbar: false };
}
