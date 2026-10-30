// zeitHelpers.ts — Zeiteinheit Tage / Halbtage / Uhrzeit (wie MS Project) mit der Arbeitszeit aus Tab Ressourcen (Beginn, Mittag,
// Ende; Standard 08:00–12:00 / 13:00–17:00). Ein Task trägt optional eine Start- und Endzeit (Task.startZeit / Task.endZeit, "HH:MM");
// fehlen sie, gilt Arbeitsbeginn bzw. -ende — damit ist die Tage-Logik genau der Sonderfall "ganzer Arbeitstag" und alle Tages-Regeln
// (Arbeitstage, Wartetage als Kalendertage, freie Tage) gelten unverändert. Gerechnet wird in echten Arbeitsminuten:
// 1 Arbeitstag = MIN_PRO_ARBEITSTAG (z.B. 8,5 h = 510 min).
import { parseDateUniversal } from "../types";
import type { Kalender } from "./kalenderHelpers";
import { istArbeitstag, arbeitstageZwischen } from "./kalenderHelpers";

export type Zeiteinheit = "tage" | "halbtage" | "stunden";
export const ZEITEINHEIT_LABEL: Record<Zeiteinheit, string> = { tage: "Tage", halbtage: "Halbtage", stunden: "Uhrzeit" };

// Arbeitszeit der aktiven Simulation (Tab Ressourcen, Stammdaten.arbeitszeit) — gesetzt über setzeArbeitszeit() beim
// Rendern von App.tsx. Bewusst modulweite Werte (ES-Module-Live-Bindings), damit alle Zeit-Funktionen ohne zusätzlichen
// Parameter dieselbe Arbeitszeit verwenden. Ohne Aufruf (z.B. in Tests) gilt 08:00–12:00 / 13:00–17:00 = 8 h.
export let ARBEITSBEGINN_MIN = 8 * 60;
export let MITTAG_VON_MIN = 12 * 60;
export let MITTAG_BIS_MIN = 13 * 60;
export let ARBEITSENDE_MIN = 17 * 60;
export let MIN_PRO_ARBEITSTAG = 480;
let VORMITTAG_MIN = 240; // Arbeitsminuten bis zur Mittagspause
let aktiveZeiteinheit: Zeiteinheit = "tage";

/** Arbeitszeit eines Tages als Uhrzeiten "HH:MM" — Std./Tag ergibt sich daraus (arbeitszeitStunden). */
export interface Arbeitszeit { beginn: string; mittagVon: string; mittagBis: string; ende: string }
export const STANDARD_ARBEITSZEIT: Arbeitszeit = { beginn: "08:00", mittagVon: "12:00", mittagBis: "13:00", ende: "17:00" };

/** Fehlertext, wenn die Uhrzeiten keine gültige Arbeitszeit ergeben (Beginn < Mittag von ≤ Mittag bis < Ende), sonst null. */
export function pruefeArbeitszeit(az: Arbeitszeit): string | null {
  if ([az.beginn, az.mittagVon, az.mittagBis, az.ende].some(z => typeof z !== "string")) return "Uhrzeiten im Format HH:MM eingeben";
  const b = zeitZuMin(az.beginn, -1), mv = zeitZuMin(az.mittagVon, -1), mb = zeitZuMin(az.mittagBis, -1), e = zeitZuMin(az.ende, -1);
  if ([b, mv, mb, e].some(m => m < 0 || m > 24 * 60)) return "Uhrzeiten im Format HH:MM eingeben";
  if (!(b < mv)) return "Beginn muss vor dem Mittag liegen";
  if (!(mv <= mb)) return "Mittag bis darf nicht vor Mittag von liegen";
  if (!(mb < e)) return "Ende muss nach dem Mittag liegen";
  return null;
}

/** Arbeitsstunden pro Tag einer Arbeitszeit (Vormittag + Nachmittag). */
export function arbeitszeitStunden(az: Arbeitszeit): number {
  return ((zeitZuMin(az.mittagVon, 0) - zeitZuMin(az.beginn, 0)) + (zeitZuMin(az.ende, 0) - zeitZuMin(az.mittagBis, 0))) / 60;
}

/** Arbeitszeit für Projekte, die noch keine Uhrzeiten haben: aus den bisherigen Std./Tag abgeleitet, Mittag 12–13 Uhr und
 *  Ende 17:00 (8,5 h → Beginn 07:30, 8 h → 08:00) — die Kalkulation (Std./Tag) bleibt damit unverändert. */
export function arbeitszeitAusStunden(std: number): Arbeitszeit {
  const min = Math.round((std > 0 ? std : 8) * 60);
  if (min > 240 && min < 12 * 60) return { ...STANDARD_ARBEITSZEIT, beginn: minZuZeit(16 * 60 - min) };
  const halb = Math.round(min / 2); // sehr kurze/lange Tage: gleichmässig um den Mittag
  return { beginn: minZuZeit(Math.max(0, 12 * 60 - halb)), mittagVon: "12:00", mittagBis: "13:00", ende: minZuZeit(Math.min(24 * 60, 13 * 60 + min - halb)) };
}

/** Arbeitszeit (und Zeiteinheit, für das Einrasten auf Halbtage) der aktiven Simulation setzen; ungültige Werte → Standard. */
export function setzeArbeitszeit(az: Arbeitszeit | undefined, einheit: Zeiteinheit = "tage"): void {
  const gueltig = az && !pruefeArbeitszeit(az) ? az : STANDARD_ARBEITSZEIT;
  ARBEITSBEGINN_MIN = zeitZuMin(gueltig.beginn, 8 * 60);
  MITTAG_VON_MIN = zeitZuMin(gueltig.mittagVon, 12 * 60);
  MITTAG_BIS_MIN = zeitZuMin(gueltig.mittagBis, 13 * 60);
  ARBEITSENDE_MIN = zeitZuMin(gueltig.ende, 17 * 60);
  VORMITTAG_MIN = MITTAG_VON_MIN - ARBEITSBEGINN_MIN;
  MIN_PRO_ARBEITSTAG = VORMITTAG_MIN + (ARBEITSENDE_MIN - MITTAG_BIS_MIN);
  aktiveZeiteinheit = einheit;
}

/** Ein Zeitpunkt: Datum (YYYY-MM-DD) + Minuten seit Mitternacht */
export interface Zeitpunkt { datum: string; min: number }

export function zeitZuMin(z: string | undefined, standard: number): number {
  const m = z?.match(/^(\d{1,2}):(\d{2})/);
  return m ? Number(m[1]) * 60 + Number(m[2]) : standard;
}
export function minZuZeit(min: number): string {
  return `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(Math.round(min % 60)).padStart(2, "0")}`;
}

type MitZeit = { start: string; end: string; startZeit?: string; endZeit?: string; meilenstein?: boolean };
export const startZeitpunkt = (t: MitZeit): Zeitpunkt => ({ datum: t.start, min: zeitZuMin(t.startZeit, ARBEITSBEGINN_MIN) });
// Meilenstein: Dauer 0 — Ende = Start (ein Zeitpunkt, z.B. Freitag 17:00)
export const endZeitpunkt = (t: MitZeit): Zeitpunkt => t.meilenstein ? startZeitpunkt(t) : ({ datum: t.end, min: zeitZuMin(t.endZeit, ARBEITSENDE_MIN) });

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

/** Arbeitsminuten eines Arbeitstags bis zur Uhrzeit (0 … MIN_PRO_ARBEITSTAG). */
export function arbeitsMinBis(min: number): number {
  if (min <= ARBEITSBEGINN_MIN) return 0;
  if (min <= MITTAG_VON_MIN) return min - ARBEITSBEGINN_MIN;
  if (min <= MITTAG_BIS_MIN) return VORMITTAG_MIN;
  if (min <= ARBEITSENDE_MIN) return VORMITTAG_MIN + (min - MITTAG_BIS_MIN);
  return MIN_PRO_ARBEITSTAG;
}

/** Uhrzeit zu einer Arbeitsminute des Tages; genau am Mittag ist ein Start "Mittag bis", ein Ende "Mittag von". */
export function uhrzeitAusArbeitsMin(a: number, art: "start" | "ende"): number {
  if (a < VORMITTAG_MIN) return ARBEITSBEGINN_MIN + a;
  if (a === VORMITTAG_MIN) return art === "ende" ? MITTAG_VON_MIN : MITTAG_BIS_MIN;
  return MITTAG_BIS_MIN + (Math.min(a, MIN_PRO_ARBEITSTAG) - VORMITTAG_MIN);
}

/** Wählbare Uhrzeiten je Zeiteinheit: Halbtage = Beginn/Mittag; Uhrzeit = Beginn, jede volle Stunde und Mittag/Ende. */
export function zeitOptionen(einheit: Zeiteinheit, art: "start" | "ende"): number[] {
  if (einheit === "halbtage") return art === "start" ? [ARBEITSBEGINN_MIN, MITTAG_BIS_MIN] : [MITTAG_VON_MIN, ARBEITSENDE_MIN];
  if (einheit === "tage") return [art === "start" ? ARBEITSBEGINN_MIN : ARBEITSENDE_MIN];
  const volle = (von: number, bis: number) => { const r: number[] = []; for (let h = Math.floor(von / 60) + 1; h * 60 < bis; h++) r.push(h * 60); return r; };
  return art === "start"
    ? [ARBEITSBEGINN_MIN, ...volle(ARBEITSBEGINN_MIN, MITTAG_VON_MIN), MITTAG_BIS_MIN, ...volle(MITTAG_BIS_MIN, ARBEITSENDE_MIN)]
    : [...volle(ARBEITSBEGINN_MIN, MITTAG_VON_MIN), MITTAG_VON_MIN, ...volle(MITTAG_BIS_MIN, ARBEITSENDE_MIN), ARBEITSENDE_MIN];
}

/** Uhrzeit auf die nächstgelegene wählbare Uhrzeit der Zeiteinheit runden (gemessen in Arbeitsminuten). */
export function rasteUhrzeit(min: number, art: "start" | "ende", einheit: Zeiteinheit): number {
  const a = arbeitsMinBis(min);
  let best = min, abstand = Infinity;
  for (const o of zeitOptionen(einheit, art)) {
    const d = Math.abs(arbeitsMinBis(o) - a);
    if (d < abstand) { abstand = d; best = o; }
  }
  return best;
}

/** Im Modus Halbtage: Zeitpunkt auf den nächstgelegenen Halbtag einrasten (Start: Beginn/Mittag bis, Ende: Mittag von/Ende,
 *  ggf. Ende des vorigen bzw. Beginn des nächsten Arbeitstags). Nötig, weil Vor- und Nachmittag verschieden lang sein können —
 *  ein Vormittags-Task (z.B. 4,5 h), der auf den Nachmittag (4 h) verschoben wird, bleibt so genau ein Halbtag. */
function aufHalbtagEinrasten(p: Zeitpunkt, art: "start" | "ende", kal: Kalender): Zeitpunkt {
  if (aktiveZeiteinheit !== "halbtage") return p;
  const a = arbeitsMinBis(p.min);
  if (art === "ende") {
    if (a < VORMITTAG_MIN / 2) return letzteArbeitszeit({ datum: tagPlus(p.datum, -1), min: 24 * 60 }, kal);
    return { datum: p.datum, min: a < (VORMITTAG_MIN + MIN_PRO_ARBEITSTAG) / 2 ? MITTAG_VON_MIN : ARBEITSENDE_MIN };
  }
  if (a >= (VORMITTAG_MIN + MIN_PRO_ARBEITSTAG) / 2) return naechsteArbeitszeit({ datum: tagPlus(p.datum, 1), min: 0 }, kal);
  return { datum: p.datum, min: a < VORMITTAG_MIN / 2 ? ARBEITSBEGINN_MIN : MITTAG_BIS_MIN };
}

// Arbeitstage je Kalender vorgezählt (laufende Summe ab BASIS_UTC): kum[k] = Arbeitstage vor Tag k. So rechnet
// arbeitsMinutenZwischen jede Spanne sofort statt Tag für Tag — der Optimierer ruft sie sehr oft auf — und ohne Obergrenze
// (bisher 3660 Tage: lag ein Termin mehr als 10 Jahre nach dem frühesten Start, rechnete der Optimierer falsche Zeiten).
const BASIS_UTC = Date.UTC(1950, 0, 1);
const MAX_TAG_NR = 200 * 366;
const kumJeKalender = new WeakMap<Kalender, number[]>();
const tagNr = (d: Date) => Math.round((Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) - BASIS_UTC) / 86400000);
function arbeitstageVor(kal: Kalender, nr: number): number {
  let kum = kumJeKalender.get(kal);
  if (!kum) { kum = [0]; kumJeKalender.set(kal, kum); }
  while (kum.length <= nr) {
    const k = kum.length - 1, d = new Date(BASIS_UTC + k * 86400000);
    kum.push(kum[k] + (istArbeitstag(iso(new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())), kal) ? 1 : 0));
  }
  return kum[nr];
}

/** Ist Tag nr ein Arbeitstag? / Erster Arbeitstag ab Tag nr (MAX_TAG_NR, wenn keiner im vorgezählten Bereich) */
const istArbeitstagNr = (kal: Kalender, nr: number) => arbeitstageVor(kal, nr + 1) > arbeitstageVor(kal, nr);
function naechsterArbeitstagNr(kal: Kalender, nr: number, anzahl = 1): number {
  const ziel = arbeitstageVor(kal, nr) + anzahl; // so viele Arbeitstage ab nr bis und mit dem gesuchten Tag
  let lo = nr, hi = nr;
  while (hi < MAX_TAG_NR && arbeitstageVor(kal, hi + 1) < ziel) { lo = hi + 1; hi = Math.min(MAX_TAG_NR, nr + (hi - nr + 1) * 2); }
  if (hi >= MAX_TAG_NR) return MAX_TAG_NR;
  while (lo < hi) { const m = (lo + hi) >> 1; if (arbeitstageVor(kal, m + 1) >= ziel) hi = m; else lo = m + 1; }
  return lo;
}
const nrZuIso = (nr: number) => { const d = new Date(BASIS_UTC + nr * 86400000); return iso(new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())); };

/** Frühester Arbeitszeitpunkt am oder nach p (Mittagspause, Abend und freie Tage werden übersprungen). */
export function naechsteArbeitszeit(p: Zeitpunkt, kal: Kalender): Zeitpunkt {
  let datum = p.datum, min = p.min;
  const pd = parseDateUniversal(datum), pn = pd ? tagNr(pd) : -1;
  if (pn >= 0 && pn < MAX_TAG_NR) { // über die vorgezählten Arbeitstage statt Tag für Tag (gleiche Regel wie die Schleife unten)
    if (istArbeitstagNr(kal, pn)) {
      if (min < ARBEITSBEGINN_MIN) return { datum, min: ARBEITSBEGINN_MIN };
      if (min >= MITTAG_VON_MIN && min < MITTAG_BIS_MIN) return { datum, min: MITTAG_BIS_MIN };
      if (min < ARBEITSENDE_MIN) return { datum, min };
    }
    const n = naechsterArbeitstagNr(kal, pn + 1);
    if (n - pn < 4000) return { datum: nrZuIso(n), min: ARBEITSBEGINN_MIN };
    if (n < MAX_TAG_NR) return p; // wie die Schleife: kein Arbeitstag in den nächsten 4000 Tagen
  }
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
  if (s.datum === e.datum && s.min === e.min) return 0; // ein Zeitpunkt (Meilenstein)
  const sd = parseDateUniversal(s.datum), ed = parseDateUniversal(e.datum);
  if (!sd || !ed) return MIN_PRO_ARBEITSTAG;
  let summe = 0;
  const sn = tagNr(sd), en = tagNr(ed), n = en - sn;
  if (n >= 0 && sn >= 0 && en < MAX_TAG_NR) {
    // erster Tag ab s, letzter Tag bis e, dazwischen ganze Arbeitstage (gleiche Rechnung wie Tag für Tag)
    const ersterIstArbeitstag = istArbeitstagNr(kal, sn);
    if (n === 0) summe = ersterIstArbeitstag ? Math.max(0, arbeitsMinBis(e.min) - arbeitsMinBis(s.min)) : 0;
    else {
      if (ersterIstArbeitstag) summe += MIN_PRO_ARBEITSTAG - arbeitsMinBis(s.min);
      if (istArbeitstagNr(kal, en)) summe += arbeitsMinBis(e.min);
      summe += (arbeitstageVor(kal, en) - arbeitstageVor(kal, sn + 1)) * MIN_PRO_ARBEITSTAG;
    }
  } else {
    for (let i = 0; i <= n; i++) { // ausserhalb 1950 bis 2150: Tag für Tag
      const tag = iso(new Date(sd.getFullYear(), sd.getMonth(), sd.getDate() + i));
      if (!istArbeitstag(tag, kal)) continue;
      const von = i === 0 ? arbeitsMinBis(s.min) : 0;
      const bis = i === n ? arbeitsMinBis(e.min) : MIN_PRO_ARBEITSTAG;
      summe += Math.max(0, bis - von);
    }
  }
  return summe > 0 ? summe : arbeitstageZwischen(s.datum, e.datum, kal) * MIN_PRO_ARBEITSTAG;
}

/** Ende, wenn ab s genau `minuten` Arbeitsminuten gearbeitet wird (mindestens 1 Minute). */
export function endeAusArbeitsMinuten(s: Zeitpunkt, minuten: number, kal: Kalender): Zeitpunkt {
  const p = naechsteArbeitszeit(s, kal);
  let rest = Math.max(1, Math.round(minuten));
  let datum = p.datum, a = arbeitsMinBis(p.min);
  // schnell über die vorgezählten Arbeitstage: der n-te Arbeitstag nach p (statt Tag für Tag — der Optimierer rechnet so jeden
  // Zeitschritt ab Projektbeginn um); gleiche Rechnung wie die Schleife unten
  const pd = parseDateUniversal(datum);
  const pn = pd ? tagNr(pd) : -1;
  if (pn >= 0 && pn < MAX_TAG_NR && istArbeitstagNr(kal, pn)) {
    if (rest <= MIN_PRO_ARBEITSTAG - a) return aufHalbtagEinrasten({ datum, min: uhrzeitAusArbeitsMin(a + rest, "ende") }, "ende", kal);
    rest -= MIN_PRO_ARBEITSTAG - a;
    const tage = Math.ceil(rest / MIN_PRO_ARBEITSTAG); // so viele weitere Arbeitstage, im letzten bleibt rest − (tage − 1) × Tag
    const tag = naechsterArbeitstagNr(kal, pn + 1, tage);
    if (tag < MAX_TAG_NR) return aufHalbtagEinrasten({ datum: nrZuIso(tag), min: uhrzeitAusArbeitsMin(rest - (tage - 1) * MIN_PRO_ARBEITSTAG, "ende") }, "ende", kal);
    rest += MIN_PRO_ARBEITSTAG - a; // ausserhalb des vorgezählten Bereichs: Schleife unten
  }
  for (let i = 0; i < 40000; i++) {
    if (istArbeitstag(datum, kal)) {
      const verfuegbar = MIN_PRO_ARBEITSTAG - a;
      if (rest <= verfuegbar) return aufHalbtagEinrasten({ datum, min: uhrzeitAusArbeitsMin(a + rest, "ende") }, "ende", kal);
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
      if (rest <= b) return aufHalbtagEinrasten({ datum, min: uhrzeitAusArbeitsMin(b - rest, "start") }, "start", kal);
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

/** Dauer eines Tasks in Arbeitstagen (echte Arbeitsstunden ÷ Std./Tag: bei 8,5 h ist eine Stunde 1/8,5 Tag). */
export function dauerTage(t: MitZeit, kal: Kalender): number {
  if (t.meilenstein) return 0;
  return arbeitsMinutenZwischen(startZeitpunkt(t), endZeitpunkt(t), kal) / MIN_PRO_ARBEITSTAG;
}

// Raster auf der Tagesachse (Gantt/Abspielen, siehe tagesAnteil): ganze Tage, Halbtage (Mittag = Tagesmitte) oder ~Stunden —
// Uhrzeiten rasten danach auf die wählbaren Zeiten ein (rasteUhrzeit).
const SCHRITT: Record<Zeiteinheit, number> = { tage: 1, halbtage: 0.5, stunden: 1 / 8 };
export const schrittTage = (e: Zeiteinheit = "tage") => SCHRITT[e];
/** Kleinste Dauer der Zeiteinheit in Arbeitsminuten (Tag, halber Tag, Stunde). */
export const schrittMinuten = (e: Zeiteinheit = "tage") => e === "stunden" ? 60 : e === "halbtage" ? MIN_PRO_ARBEITSTAG / 2 : MIN_PRO_ARBEITSTAG;

/** Aufrunden auf die Zeiteinheit (ganze Tage, halbe Tage oder echte Stunden der Arbeitszeit). */
export function rundeAufEinheit(tage: number, e: Zeiteinheit = "tage"): number {
  const s = schrittMinuten(e) / MIN_PRO_ARBEITSTAG;
  return Math.ceil(tage / s - 1e-9) * s;
}

/** Anzeige einer Dauer: "3d", "2,5d" oder "2d 3h". */
export function fmtDauer(tage: number, e: Zeiteinheit = "tage"): string {
  if (e === "tage") return `${Math.max(1, Math.round(tage))}d`;
  if (e === "halbtage") return `${String(Math.round(tage * 2) / 2).replace(".", ",")}d`;
  const ganze = Math.floor(tage + 1e-9);
  const std = Math.round((tage - ganze) * MIN_PRO_ARBEITSTAG / 60 * 10) / 10;
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

/** Zeitpunkt eines Meilensteins: innerhalb der Arbeitszeit eines Arbeitstags (auch genau 17:00) bleibt er, sonst rückt er auf die nächste Arbeitszeit. */
export function meilensteinZeitpunkt(p: Zeitpunkt, kal: Kalender): Zeitpunkt {
  return istArbeitstag(p.datum, kal) && p.min >= ARBEITSBEGINN_MIN && p.min <= ARBEITSENDE_MIN ? p : naechsteArbeitszeit(p, kal);
}
/** Task-Felder eines Meilensteins (Start = Ende, nur eine Uhrzeit). */
export function meilensteinFelder(p: Zeitpunkt): { start: string; end: string; startZeit: string | undefined; endZeit: undefined } {
  return { start: p.datum, end: p.datum, startZeit: p.min === ARBEITSBEGINN_MIN ? undefined : minZuZeit(p.min), endZeit: undefined };
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
  if (t.meilenstein) return startPos(t, min);
  return tagIndex(t.end || t.start, min) + tagesAnteil(zeitZuMin(t.endZeit, ARBEITSENDE_MIN));
}

/** Anteil eines Arbeitstags (0 … 1), den der Task am Datum arbeitet — 0 an freien Tagen und ausserhalb des Tasks. Bei ganzen
 *  Tagen immer 0 oder 1, bei Halbtagen/Uhrzeit auch Bruchteile. Grundlage der Tagesreihen (Personal, Kran, Kosten …). */
export function arbeitsAnteilAmTag(t: MitZeit, datum: string, kal: Kalender): number {
  if (t.meilenstein || !t.start || !t.end || datum < t.start || datum > t.end || !istArbeitstag(datum, kal)) return 0;
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
  return `${datum} ${minZuZeit(uhrzeitAusTagesAnteil(Math.min(anteil, 1), anteil >= 1 ? "ende" : "start"))}`;
}

/** Position im Tag (0 … 1) für Gantt-Balken und Abspielen: Vormittag = erste, Nachmittag = zweite Tageshälfte (je linear nach
 *  Arbeitszeit) — der Mittag liegt so immer in der Tagesmitte, auch wenn Vor- und Nachmittag verschieden lang sind. Nur
 *  Darstellung; gerechnet wird mit echten Arbeitsminuten (arbeitsAnteilAmTag, dauerTage). */
export function tagesAnteil(min: number): number {
  const a = arbeitsMinBis(min);
  return a <= VORMITTAG_MIN ? 0.5 * a / VORMITTAG_MIN : 0.5 + 0.5 * (a - VORMITTAG_MIN) / (MIN_PRO_ARBEITSTAG - VORMITTAG_MIN);
}
/** Umkehrung von tagesAnteil: Uhrzeit zu einer Position im Tag. */
export function uhrzeitAusTagesAnteil(anteil: number, art: "start" | "ende"): number {
  const a = anteil <= 0.5 ? anteil * 2 * VORMITTAG_MIN : VORMITTAG_MIN + (anteil - 0.5) * 2 * (MIN_PRO_ARBEITSTAG - VORMITTAG_MIN);
  return uhrzeitAusArbeitsMin(Math.round(a), art);
}

/** Uhrzeiten eines Tasks auf eine gröbere Zeiteinheit runden (beim Umstellen Uhrzeit → Halbtage → Tage). */
export function rundeZeitenAufEinheit<T extends MitZeit>(t: T, e: Zeiteinheit): T {
  if (e === "stunden") return t;
  if (e === "tage") return { ...t, startZeit: undefined, endZeit: undefined };
  const s = zeitZuMin(t.startZeit, ARBEITSBEGINN_MIN), en = zeitZuMin(t.endZeit, ARBEITSENDE_MIN);
  const sNeu = s < MITTAG_VON_MIN ? ARBEITSBEGINN_MIN : MITTAG_BIS_MIN;
  const eNeu = en <= MITTAG_BIS_MIN ? MITTAG_VON_MIN : ARBEITSENDE_MIN;
  return { ...t, startZeit: sNeu === ARBEITSBEGINN_MIN ? undefined : minZuZeit(sNeu), endZeit: eNeu === ARBEITSENDE_MIN ? undefined : minZuZeit(eNeu) };
}

/** Welche Zeiteinheit brauchen diese Tasks? Nur Beginn/Mittag/Ende → Halbtage, andere Uhrzeiten → Uhrzeit, keine → Tage. */
export function benoetigteZeiteinheit(tasks: MitZeit[]): Zeiteinheit {
  let halb = false;
  for (const t of tasks) {
    if (t.meilenstein) continue; // Meilensteine liegen oft auf 17:00 (Ende des Vorgängers) — kein Grund für eine feinere Einheit
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
