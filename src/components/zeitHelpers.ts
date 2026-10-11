// zeitHelpers.ts — Zeiteinheit Tage / Halbtage / Uhrzeit (wie MS Project): Arbeitszeit 08:00–12:00 und 13:00–17:00 (8 h/Tag).
// Ein Task trägt optional eine Start- und Endzeit (Task.startZeit / Task.endZeit, "HH:MM"); fehlen sie, gilt 08:00 bzw. 17:00 —
// damit ist die Tage-Logik genau der Sonderfall "ganzer Arbeitstag" und alle Tages-Regeln (Arbeitstage, Wartetage als Kalendertage,
// freie Tage) gelten unverändert. Gerechnet wird in Arbeitsminuten: 1 Arbeitstag = 480 min.
import { parseDateUniversal } from "../types";
import type { Kalender } from "./kalenderHelpers";
import { istArbeitstag, arbeitstageZwischen } from "./kalenderHelpers";

export type Zeiteinheit = "tage" | "halbtage" | "stunden";
export const ZEITEINHEIT_LABEL: Record<Zeiteinheit, string> = { tage: "Tage", halbtage: "Halbtage", stunden: "Uhrzeit" };

export const ARBEITSBEGINN_MIN = 8 * 60;   // 08:00
export const MITTAG_VON_MIN = 12 * 60;     // 12:00
export const MITTAG_BIS_MIN = 13 * 60;     // 13:00
export const ARBEITSENDE_MIN = 17 * 60;    // 17:00
export const MIN_PRO_ARBEITSTAG = 480;

/** Ein Zeitpunkt: Datum (YYYY-MM-DD) + Minuten seit Mitternacht */
export interface Zeitpunkt { datum: string; min: number }

export function zeitZuMin(z: string | undefined, standard: number): number {
  const m = z?.match(/^(\d{1,2}):(\d{2})/);
  return m ? Number(m[1]) * 60 + Number(m[2]) : standard;
}
export function minZuZeit(min: number): string {
  return `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(Math.round(min % 60)).padStart(2, "0")}`;
}

type MitZeit = { start: string; end: string; startZeit?: string; endZeit?: string };
export const startZeitpunkt = (t: MitZeit): Zeitpunkt => ({ datum: t.start, min: zeitZuMin(t.startZeit, ARBEITSBEGINN_MIN) });
export const endZeitpunkt = (t: MitZeit): Zeitpunkt => ({ datum: t.end, min: zeitZuMin(t.endZeit, ARBEITSENDE_MIN) });

/** Task-Felder aus Start/Ende — Standardzeiten (08:00 / 17:00) werden nicht gespeichert. */
export function zeitFelder(s: Zeitpunkt, e: Zeitpunkt): { start: string; end: string; startZeit: string | undefined; endZeit: string | undefined } {
  return {
    start: s.datum, end: e.datum,
    startZeit: s.min === ARBEITSBEGINN_MIN ? undefined : minZuZeit(s.min),
    endZeit: e.min === ARBEITSENDE_MIN ? undefined : minZuZeit(e.min),
  };
}

function iso(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function tagPlus(datum: string, n: number): string {
  const d = parseDateUniversal(datum);
  if (!d) return datum;
  return iso(new Date(d.getFullYear(), d.getMonth(), d.getDate() + n));
}

/** Arbeitsminuten eines Arbeitstags bis zur Uhrzeit (0 … 480). */
export function arbeitsMinBis(min: number): number {
  if (min <= ARBEITSBEGINN_MIN) return 0;
  if (min <= MITTAG_VON_MIN) return min - ARBEITSBEGINN_MIN;
  if (min <= MITTAG_BIS_MIN) return 240;
  if (min <= ARBEITSENDE_MIN) return min - ARBEITSBEGINN_MIN - 60;
  return MIN_PRO_ARBEITSTAG;
}

/** Uhrzeit zu einer Arbeitsminute des Tages; genau am Mittag ist ein Start 13:00, ein Ende 12:00. */
export function uhrzeitAusArbeitsMin(a: number, art: "start" | "ende"): number {
  if (a < 240) return ARBEITSBEGINN_MIN + a;
  if (a === 240) return art === "ende" ? MITTAG_VON_MIN : MITTAG_BIS_MIN;
  return MITTAG_BIS_MIN + (Math.min(a, MIN_PRO_ARBEITSTAG) - 240);
}

/** Frühester Arbeitszeitpunkt am oder nach p (Mittagspause, Abend und freie Tage werden übersprungen). */
export function naechsteArbeitszeit(p: Zeitpunkt, kal: Kalender): Zeitpunkt {
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
}

/** Spätester Arbeitszeitpunkt am oder vor p (für ein Ende). */
export function letzteArbeitszeit(p: Zeitpunkt, kal: Kalender): Zeitpunkt {
  let datum = p.datum, min = p.min;
  for (let i = 0; i < 4000; i++) {
    if (istArbeitstag(datum, kal)) {
      if (min > ARBEITSENDE_MIN) return { datum, min: ARBEITSENDE_MIN };
      if (min > MITTAG_VON_MIN && min <= MITTAG_BIS_MIN) return { datum, min: MITTAG_VON_MIN };
      if (min > ARBEITSBEGINN_MIN) return { datum, min };
    }
    datum = tagPlus(datum, -1); min = 24 * 60;
  }
  return p;
}

/** Arbeitsminuten von s bis e. Liegt in der Spanne kein Arbeitstag (Ferien, Sa–So), zählen die Kalendertage als Arbeitstage
 *  (gleiche Regel wie arbeitstageZwischen). */
export function arbeitsMinutenZwischen(s: Zeitpunkt, e: Zeitpunkt, kal: Kalender): number {
  const sd = parseDateUniversal(s.datum), ed = parseDateUniversal(e.datum);
  if (!sd || !ed) return MIN_PRO_ARBEITSTAG;
  let summe = 0;
  const n = Math.min(3660, Math.round((ed.getTime() - sd.getTime()) / 86400000));
  for (let i = 0; i <= n; i++) {
    const tag = iso(new Date(sd.getFullYear(), sd.getMonth(), sd.getDate() + i));
    if (!istArbeitstag(tag, kal)) continue;
    const von = i === 0 ? arbeitsMinBis(s.min) : 0;
    const bis = i === n ? arbeitsMinBis(e.min) : MIN_PRO_ARBEITSTAG;
    summe += Math.max(0, bis - von);
  }
  return summe > 0 ? summe : arbeitstageZwischen(s.datum, e.datum, kal) * MIN_PRO_ARBEITSTAG;
}

/** Ende, wenn ab s genau `minuten` Arbeitsminuten gearbeitet wird (mindestens 1 Minute). */
export function endeAusArbeitsMinuten(s: Zeitpunkt, minuten: number, kal: Kalender): Zeitpunkt {
  const p = naechsteArbeitszeit(s, kal);
  let rest = Math.max(1, Math.round(minuten));
  let datum = p.datum, a = arbeitsMinBis(p.min);
  for (let i = 0; i < 40000; i++) {
    if (istArbeitstag(datum, kal)) {
      const verfuegbar = MIN_PRO_ARBEITSTAG - a;
      if (rest <= verfuegbar) return { datum, min: uhrzeitAusArbeitsMin(a + rest, "ende") };
      rest -= verfuegbar;
    }
    datum = tagPlus(datum, 1); a = 0;
  }
  return p;
}

/** Start, wenn bis e genau `minuten` Arbeitsminuten gearbeitet werden (Umkehrung von endeAusArbeitsMinuten). */
export function startAusArbeitsMinuten(e: Zeitpunkt, minuten: number, kal: Kalender): Zeitpunkt {
  const p = letzteArbeitszeit(e, kal);
  let rest = Math.max(1, Math.round(minuten));
  let datum = p.datum, b = arbeitsMinBis(p.min);
  for (let i = 0; i < 40000; i++) {
    if (istArbeitstag(datum, kal)) {
      if (rest <= b) return { datum, min: uhrzeitAusArbeitsMin(b - rest, "start") };
      rest -= b;
    }
    datum = tagPlus(datum, -1); b = MIN_PRO_ARBEITSTAG;
  }
  return p;
}

/** Start eines Nachfolgers wie MS Project mit verstrichenen Wartetagen: Ende des Vorgängers + Wartetage (Kalendertage), dann der
 *  nächste Arbeitszeitpunkt. Endet der Vorgänger um 12:00, beginnt der Nachfolger (ohne Wartetage) am selben Tag um 13:00; endet er
 *  um 17:00, am nächsten Arbeitstag um 08:00 — bei ganzen Tagen ist das genau die Tages-Regel. */
export function folgeStartZeitpunkt(vorgaengerEnde: Zeitpunkt, wartetage: number, kal: Kalender): Zeitpunkt {
  return naechsteArbeitszeit({ datum: tagPlus(vorgaengerEnde.datum, Math.round(wartetage || 0)), min: vorgaengerEnde.min }, kal);
}

export function vergleicheZeitpunkte(a: Zeitpunkt, b: Zeitpunkt): number {
  return a.datum < b.datum ? -1 : a.datum > b.datum ? 1 : a.min - b.min;
}

/** Dauer eines Tasks in Arbeitstagen (Halbtag = 0.5, Stunde = 0.125). */
export function dauerTage(t: MitZeit, kal: Kalender): number {
  return arbeitsMinutenZwischen(startZeitpunkt(t), endZeitpunkt(t), kal) / MIN_PRO_ARBEITSTAG;
}

const SCHRITT: Record<Zeiteinheit, number> = { tage: 1, halbtage: 0.5, stunden: 1 / 8 };
export const schrittTage = (e: Zeiteinheit = "tage") => SCHRITT[e];

/** Aufrunden auf die Zeiteinheit (ganze Tage, halbe Tage oder Stunden). */
export function rundeAufEinheit(tage: number, e: Zeiteinheit = "tage"): number {
  const s = SCHRITT[e];
  return Math.ceil(tage / s - 1e-9) * s;
}

/** Anzeige einer Dauer: "3d", "2,5d" oder "2d 3h". */
export function fmtDauer(tage: number, e: Zeiteinheit = "tage"): string {
  if (e === "tage") return `${Math.max(1, Math.round(tage))}d`;
  if (e === "halbtage") return `${String(Math.round(tage * 2) / 2).replace(".", ",")}d`;
  const ganze = Math.floor(tage + 1e-9);
  const std = Math.round((tage - ganze) * 8 * 10) / 10;
  if (std === 0) return `${ganze}d`;
  return ganze > 0 ? `${ganze}d ${String(std).replace(".", ",")}h` : `${String(std).replace(".", ",")}h`;
}

/** Zusatz zur Datumsanzeige: Halbtage "VM"/"NM", Uhrzeit "13:00" — bei Standardzeiten leer. */
export function fmtZeitZusatz(min: number, art: "start" | "ende", e: Zeiteinheit = "tage"): string {
  if (e === "tage") return "";
  const standard = art === "start" ? ARBEITSBEGINN_MIN : ARBEITSENDE_MIN;
  if (min === standard) return "";
  if (e === "halbtage") return art === "start" ? (min >= MITTAG_BIS_MIN ? " NM" : "") : (min <= MITTAG_VON_MIN ? " VM" : "");
  return ` ${minZuZeit(min)}`;
}

/** Tag-Index eines Datums ab min (0 = Tag von min). */
export function tagIndex(datum: string, min: Date): number {
  const d = parseDateUniversal(datum);
  return d ? Math.round((d.getTime() - min.getTime()) / 86400000) : 0;
}

/** Position des Task-Starts auf der Tagesachse (Tag-Index + Tagesanteil: 08:00 = n, 13:00 = n + 0.5). */
export function startPos(t: MitZeit, min: Date): number {
  return tagIndex(t.start, min) + tagesAnteil(zeitZuMin(t.startZeit, ARBEITSBEGINN_MIN));
}

/** Position des Task-Endes (exklusiv: ein ganzer Tag n endet bei n + 1, ein Ende 12:00 bei n + 0.5).
 *  Ein Task ist aktiv für startPos <= tag < endPos; bei ganzen Tagen identisch mit "Starttag <= Tag <= Endtag". */
export function endPos(t: MitZeit, min: Date): number {
  return tagIndex(t.end || t.start, min) + tagesAnteil(zeitZuMin(t.endZeit, ARBEITSENDE_MIN));
}

/** Anteil eines Arbeitstags (0 … 1), den der Task am Datum arbeitet — 0 an freien Tagen und ausserhalb des Tasks. Bei ganzen
 *  Tagen immer 0 oder 1, bei Halbtagen/Uhrzeit auch Bruchteile. Grundlage der Tagesreihen (Personal, Kran, Kosten …). */
export function arbeitsAnteilAmTag(t: MitZeit, datum: string, kal: Kalender): number {
  if (!t.start || !t.end || datum < t.start || datum > t.end || !istArbeitstag(datum, kal)) return 0;
  const von = datum === t.start ? arbeitsMinBis(zeitZuMin(t.startZeit, ARBEITSBEGINN_MIN)) : 0;
  const bis = datum === t.end ? arbeitsMinBis(zeitZuMin(t.endZeit, ARBEITSENDE_MIN)) : MIN_PRO_ARBEITSTAG;
  return Math.max(0, bis - von) / MIN_PRO_ARBEITSTAG;
}

/** Anzeige "09.11.2026" bzw. mit Zeit "09.11.2026 NM" / "09.11.2026 13:30" für eine Position auf der Tagesachse. */
export function datumZeitBeiPos(min: Date, pos: number, e: Zeiteinheit = "tage", maxTag?: number): string {
  let tag = Math.floor(pos + 1e-9), anteil = pos - tag;
  if (maxTag !== undefined && tag >= maxTag) { tag = maxTag - 1; anteil = 1; }
  const d = new Date(min.getFullYear(), min.getMonth(), min.getDate() + tag);
  const datum = d.toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" });
  if (e === "tage") return datum;
  if (e === "halbtage") return `${datum} ${anteil < 0.5 ? "VM" : "NM"}`;
  return `${datum} ${minZuZeit(uhrzeitAusArbeitsMin(Math.round(Math.min(anteil, 1) * MIN_PRO_ARBEITSTAG), anteil >= 1 ? "ende" : "start"))}`;
}

/** Position im Tag (0 … 1) für die Gantt-Balken: Arbeitszeit bis zu dieser Uhrzeit / 8 h. */
export const tagesAnteil = (min: number) => arbeitsMinBis(min) / MIN_PRO_ARBEITSTAG;

/** Uhrzeiten eines Tasks auf eine gröbere Zeiteinheit runden (beim Umstellen Uhrzeit → Halbtage → Tage). */
export function rundeZeitenAufEinheit<T extends MitZeit>(t: T, e: Zeiteinheit): T {
  if (e === "stunden") return t;
  if (e === "tage") return { ...t, startZeit: undefined, endZeit: undefined };
  const s = zeitZuMin(t.startZeit, ARBEITSBEGINN_MIN), en = zeitZuMin(t.endZeit, ARBEITSENDE_MIN);
  const sNeu = s < MITTAG_VON_MIN ? ARBEITSBEGINN_MIN : MITTAG_BIS_MIN;
  const eNeu = en <= MITTAG_BIS_MIN ? MITTAG_VON_MIN : ARBEITSENDE_MIN;
  return { ...t, startZeit: sNeu === ARBEITSBEGINN_MIN ? undefined : minZuZeit(sNeu), endZeit: eNeu === ARBEITSENDE_MIN ? undefined : minZuZeit(eNeu) };
}

/** Welche Zeiteinheit brauchen diese Tasks? Nur 08/12/13/17 Uhr → Halbtage, andere Uhrzeiten → Uhrzeit, keine → Tage. */
export function benoetigteZeiteinheit(tasks: MitZeit[]): Zeiteinheit {
  let halb = false;
  for (const t of tasks) {
    for (const z of [t.startZeit, t.endZeit]) {
      if (!z) continue;
      const m = zeitZuMin(z, -1);
      if ([ARBEITSBEGINN_MIN, MITTAG_VON_MIN, MITTAG_BIS_MIN, ARBEITSENDE_MIN].includes(m)) halb = true;
      else return "stunden";
    }
  }
  return halb ? "halbtage" : "tage";
}
export const feinerAls = (a: Zeiteinheit, b: Zeiteinheit) => SCHRITT[a] < SCHRITT[b];

/** Start-/Endzeit für einen importierten Task: Standardzeiten (Start 08:00, Ende 17:00) und reine Daten ergeben undefined. */
export function importZeit(v: unknown, art: "start" | "ende"): string | undefined {
  const z = leseUhrzeit(v);
  if (!z) return undefined;
  return z === minZuZeit(art === "start" ? ARBEITSBEGINN_MIN : ARBEITSENDE_MIN) ? undefined : z;
}

/** Uhrzeit aus einem importierten Wert lesen ("2026-11-09T13:00", "09.11.2026 13:30", Excel-Seriennummer mit Bruchteil).
 *  00:00 (reines Datum) ergibt undefined. */
export function leseUhrzeit(v: unknown): string | undefined {
  if (typeof v === "number") {
    const anteil = v - Math.floor(v);
    const min = Math.round(anteil * 24 * 60);
    return min > 0 && min < 24 * 60 ? minZuZeit(min) : undefined;
  }
  const m = String(v ?? "").match(/[T\s](\d{1,2}):(\d{2})/);
  if (!m) return undefined;
  const min = Number(m[1]) * 60 + Number(m[2]);
  return min > 0 ? minZuZeit(min) : undefined;
}
