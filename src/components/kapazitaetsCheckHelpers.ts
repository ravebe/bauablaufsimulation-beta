// kapazitaetsCheckHelpers.ts — Kran-Personal-Bilanz für die Kranoptik (Tab AVOR, Ansicht "Personal"): je Kran und Zeitraster-Bucket
// die Personenstunden der kranpflichtigen Gewerke an den ihm zugewiesenen Tasks (Spalte "Kräne" in Tab Kalkulation, Task.kraene;
// ein Task mit mehreren Kränen zählt bei jedem anteilig, kranAnteil 0.5/0.33 …) und daraus ein Personal-Richtwert gegen Max. Personen.
import type { Task, Kran, Zeitraster } from "../types";
import type { Kalender } from "./kalenderHelpers";
import type { Stammdaten } from "./stammdatenHelpers";
import { istMengeKranpflichtig } from "./stammdatenHelpers";
import { aufwandJeTagFuerTask } from "./avorHelpers";
import type { ZeitrasterBucket } from "./kranHelpers";
import { zeitrasterBuckets, kranVerfuegbareArbeitstage, kranAnteil } from "./kranHelpers";

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
