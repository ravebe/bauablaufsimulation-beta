// TabAvor.tsx — Cockpit mit Personal-/Kranauslastung und Mengen-Filter, abgeleitet
// aus den in Tab Kalkulation erfassten Mengen/Kürzeln/WBS-Feldern und den Stammdaten aus Ressourcen.
import { useState, useEffect, useMemo } from "react";
import type { SimProjekt, Zeitraster } from "../types";
import { parseDateUniversal, nsKey } from "../types";
import { LEERER_KALENDER } from "./kalenderHelpers";
import { LEERE_STAMMDATEN, hatKranpflichtigeRaten } from "./stammdatenHelpers";
import { personalauslastung, kolonnenJeTag, tagesdauerJeTag, mengenProTag, optimaleTagesleistung } from "./avorHelpers";
import type { TagWert } from "./avorHelpers";
import { kranstundenProKranUndBucket, kranPersonalMaxImBereich, RICHTWERT_PERSONEN_PRO_KRAN, eingeplantesPersonalJeTag, hatKranPersonal, durchschnittlicheAuslastung, kranLuecken, arbeitstageInBereich } from "./kranHelpers";
import { KranLueckenHinweis } from "./KranPersonalEditor";
import Tagesablauf from "./Tagesablauf";
import { optimiereAuslastung } from "./auslastungOptimieren";
import { personenstundenProKranUndBucket, personalRichtwertJeBucket } from "./kapazitaetsCheckHelpers";
import { dreiDZustandAufTagSetzen, tagVonDatum } from "./dreiDHeuteHelper";
import type { ApiInstance } from "../hooks/useApi";
import { TimeSeriesChart, KranBalkenChart, StatTile, CockpitAbschnitt, useEingeklappt, useChartZoom, useChartHoehe, ChartResizeHandle, FARBEN } from "./cockpitCharts";
import type { Serie, KategorieSerie, DetailSpalte, DetailZeile } from "./cockpitCharts";
import { fmtZahl } from "./zahlFormat";
import PunkteMenu from "./PunkteMenu";
import { personalbedarfAlsCsv, alsCsv, csvZahl, datumCh } from "./avorExportHelpers";

function csvHerunterladen(inhalt: string, dateiname: string) {
  const blob = new Blob([inhalt], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = dateiname; a.click();
  URL.revokeObjectURL(url);
}

interface Props { sim: SimProjekt | null; updateSim: (s: SimProjekt) => void; readOnly?: boolean; projectId?: string | null; api?: ApiInstance | null; sharedNadelTag?: React.MutableRefObject<number>; }

function gestapelteSerien(tagWerte: TagWert[], labelFuer: (k: string) => string): { tage: string[]; serien: Serie[] } {
  const tage = tagWerte.map(t => t.tag);
  const summeProKey = new Map<string, number>();
  for (const tw of tagWerte) for (const [k, v] of Object.entries(tw.werte)) summeProKey.set(k, (summeProKey.get(k) ?? 0) + v);
  const sortiert = [...summeProKey.entries()].sort((a, b) => b[1] - a[1]).map(([k]) => k);
  const top = sortiert.slice(0, 7);
  const rest = sortiert.slice(7);
  const serien: Serie[] = top.map((k, i) => ({
    key: k, label: labelFuer(k), color: FARBEN.kategorial[i],
    werte: tagWerte.map(tw => tw.werte[k] ?? 0),
  }));
  if (rest.length > 0) {
    serien.push({ key: "__andere", label: "Andere", color: FARBEN.andere,
      werte: tagWerte.map(tw => rest.reduce((s, k) => s + (tw.werte[k] ?? 0), 0)) });
  }
  return { tage, serien };
}

export default function TabAvor({ sim, updateSim, readOnly, projectId = null, api, sharedNadelTag }: Props) {
  const [mengenGewerkKey, setMengenGewerkKey] = useState<string>("beton");
  const [mengenKuerzel, setMengenKuerzel] = useState<string>(""); // "" = Total (alle Kürzel dieses Gewerks summiert), Default
  const [kranMetrik, setKranMetrik] = useState<"stunden" | "personal">("stunden");
  const { eingeklappt, toggle: toggleEingeklappt } = useEingeklappt(projectId, "avor");
  // ⋮ → Ansicht: arbeitsfreie Wochenenden in allen Diagrammen ausblenden (Standard), projektbezogen gemerkt
  const weKey = nsKey("4d-cockpit-ohne-we-avor", projectId ?? null);
  const [ohneWochenenden, setOhneWochenenden] = useState(() => {
    try { return localStorage.getItem(weKey) !== "0"; } catch { return true; }
  });
  useEffect(() => { try { localStorage.setItem(weKey, ohneWochenenden ? "1" : "0"); } catch { /* ignore */ } }, [ohneWochenenden, weKey]);

  // Klick in eines der Diagramme setzt eine gemeinsame Datums-Markierung (Index, da alle Tagesreihen
  // dieses Tabs denselben Projektzeitraum abdecken) und springt im 3D-Modell auf diesen Tag — siehe
  // onChartTagKlick() weiter unten.
  const [ausgewaehlterTag, setAusgewaehlterTag] = useState<number | null>(null);
  const [klickErgebnis, setKlickErgebnis] = useState<string | null>(null);

  // Alle Daten mit sicheren Fallbacks berechnen (nicht erst nach einem frühen Return), damit die
  // untenstehenden Hooks (useChartZoom/useChartHoehe) in jedem Render in derselben Reihenfolge
  // aufgerufen werden — unabhängig davon, ob am Ende der "Kein Projekt"-Zweig gerendert wird.
  const stammdaten = sim?.stammdaten ?? LEERE_STAMMDATEN;
  const kalender = sim?.kalender ?? LEERER_KALENDER;
  const tasks = sim?.tasks ?? [];

  const personal = personalauslastung(tasks, stammdaten, kalender);
  const personalSerien = gestapelteSerien(personal, k => stammdaten.gewerke.find(g => g.key === k)?.label ?? k);

  const kraene = sim?.kraene ?? [];
  const kranById = new Map(kraene.map(k => [k.id, k]));
  // Ø Auslastung des Gantts und nach "Auslastung optimieren" (Standard: kritischer Pfad, Lücken füllen, aktuelle Zeiteinheit) —
  // nur Vorschau, übernommen wird in Tab Bauteile
  const auslastungKennzahl = useMemo(() => {
    const gantt = durchschnittlicheAuslastung(tasks, kraene, stammdaten, kalender);
    if (gantt == null) return null;
    const optimiert = optimiereAuslastung(tasks, stammdaten, kalender, sim?.zeiteinheit ?? "tage", kraene, "kritischerPfad", true);
    return { gantt, optimiert: durchschnittlicheAuslastung(optimiert, kraene, stammdaten, kalender) };
  }, [tasks, kraene, stammdaten, kalender, sim?.zeiteinheit]);
  const raster: Zeitraster = sim?.zeitraster ?? "monat";
  const { buckets: kranBuckets, serien: kranstundenSerien, ohneKran: kranstundenOhneKran } = kranstundenProKranUndBucket(tasks, kraene, stammdaten, kalender, raster);
  const kranHatBedarf = kranstundenSerien.some(s => s.bedarf.some(v => v > 0)) || kranstundenOhneKran.some(v => v > 0);
  // Kranarbeit an Tagen ohne verfügbaren Kran (oder Task ohne Kran): eigener oranger Balken "Ohne Kran" — Kapazität 0
  const ohneKranSerie = (werte: number[]): KategorieSerie[] => werte.some(v => v > 1e-9)
    ? [{ key: "__ohneKran", label: "Ohne Kran", color: FARBEN.status.warning, werte }] : [];
  const kranBarSerien: KategorieSerie[] = [...kranstundenSerien.map((s, i) => ({
    key: s.kranId, label: s.kranName, color: FARBEN.kategorial[i % FARBEN.kategorial.length], werte: s.bedarf, kapazitaet: s.kapazitaet,
  })), ...ohneKranSerie(kranstundenOhneKran)];
  const luecken = kranLuecken(tasks, kraene, stammdaten, kalender);
  // Personal-Pendant zur Kran-Stunden-Kapazität: je Kran und Zeitraster-Bucket ergibt sich aus den
  // Personenstunden kranpflichtiger Gewerke (nur Kürzel, die in Tab Ressourcen als kranpflichtig markiert
  // sind, und nur Tasks mit einer Kran-Zuweisung aus Tab Kalkulation) ein Personal-Richtwert — Engpass,
  // sobald der über dem je Kran in "Kräne & Verfügbarkeit" hinterlegten Max-Personen-Wert liegt.
  const { buckets: personalKranBuckets, serien: personalKranSerien, ohneKran: personalOhneKran } = personenstundenProKranUndBucket(tasks, kraene, stammdaten, kalender, raster);
  // Personal-Ansicht der Kranoptik (Umschalter neben Kranstunden): Balken = gerundeter Personal-
  // Richtwert je Kran und Zeitraster-Bucket, Kapazitätslinie = Personal unter dem Kran in diesem Zeitraum (Tab Ressourcen →
  // Kräne & Personal, grösster Tageswert; Kran ganz ohne erfasstes Personal: Richtwert 13; mit Personal-Zeilen, aber in diesem
  // Zeitraum ohne Personal: 0 → Engpass).
  const personalBarSerien: KategorieSerie[] = [...personalKranSerien.map((s, i) => {
    const kran = kranById.get(s.kranId);
    const mitPersonal = !!kran && hatKranPersonal([kran]);
    const kapazitaet = personalKranBuckets.map(b => mitPersonal ? kranPersonalMaxImBereich(kran!, b.start, b.end) : RICHTWERT_PERSONEN_PRO_KRAN);
    return {
      key: s.kranId, label: s.kranName, color: FARBEN.kategorial[i % FARBEN.kategorial.length],
      werte: personalKranBuckets.map((_, bi) => personalRichtwertJeBucket(s.personenstunden[bi], s.arbeitstageVerfuegbar[bi], stammdaten.arbeitszeitStdProTag, kapazitaet[bi]).richtwert ?? 0),
      kapazitaet,
    };
  }), ...ohneKranSerie(personalKranBuckets.map((b, bi) => {
    const tage = arbeitstageInBereich(b.start, b.end, kalender);
    return tage > 0 && stammdaten.arbeitszeitStdProTag > 0 ? personalOhneKran[bi] / (tage * stammdaten.arbeitszeitStdProTag) : 0;
  }))];
  const personalKranHatBedarf = personalKranSerien.some(s => s.personenstunden.some(v => v > 0)) || personalOhneKran.some(v => v > 0);

  const gewerkOptionen = stammdaten.gewerke;
  const aktivesGewerk = gewerkOptionen.find(g => g.key === mengenGewerkKey) ?? gewerkOptionen[0];
  const aktiveRate = mengenKuerzel ? aktivesGewerk?.raten.find(r => r.kuerzel === mengenKuerzel) : undefined;
  const mengen = aktivesGewerk ? mengenProTag(tasks, aktivesGewerk.key, kalender, aktiveRate?.kuerzel, stammdaten) : [];
  const optimal = aktiveRate ? optimaleTagesleistung(aktiveRate, stammdaten.arbeitszeitStdProTag) : null;

  // Gemeinsamer Zoom/Scroll aller Diagramme dieses Tabs (Mausrad zoomt zum Cursor, wie im Gantt —
  // Achse wechselt dabei automatisch zwischen Monaten/Wochen/Tagen) + je Diagramm frei per Slider
  // einstellbare Höhe, beides projektbezogen in localStorage gemerkt.
  const tageAnzahl = Math.max(personal.length, mengen.length);
  const zoom = useChartZoom(projectId, "avor", tageAnzahl);
  const [hoehePersonal, setHoehePersonal] = useChartHoehe(projectId, "avor-personal");
  const [hoeheKran, setHoeheKran] = useChartHoehe(projectId, "avor-kran");
  const [hoeheMengen, setHoeheMengen] = useChartHoehe(projectId, "avor-mengen");

  const allStarts = tasks.map(t => parseDateUniversal(t.start)).filter((d): d is Date => !!d);
  const minDate = allStarts.length > 0 ? new Date(Math.min(...allStarts.map(d => d.getTime()))) : null;
  const ausgewaehltesDatumIso = ausgewaehlterTag != null ? personalSerien.tage[ausgewaehlterTag] : null;
  const ausgewaehltesDatumLabel = ausgewaehltesDatumIso
    ? (parseDateUniversal(ausgewaehltesDatumIso)?.toLocaleDateString("de-CH") ?? ausgewaehltesDatumIso)
    : "Heute";

  // Klick in irgendeines der vier Diagramme: gemeinsame Markierung setzen, "geteilte Nadel" (siehe
  // App.tsx) für andere Tabs synchron halten, und — falls ein Modell verbunden ist — den 3D-Zustand
  // auf diesen Tag springen.
  async function onChartTagKlick(iso: string, idx: number) {
    setAusgewaehlterTag(idx);
    setKlickErgebnis(null);
    const datum = parseDateUniversal(iso);
    if (sharedNadelTag && datum) sharedNadelTag.current = datum.getTime();
    if (!api || !minDate) return;
    const tag = tagVonDatum(iso, minDate);
    const aktive = await dreiDZustandAufTagSetzen(api, tasks, minDate, tag, true, (sim?.ausgeschlossen ?? []).map(a => a.guid), true);
    setKlickErgebnis(aktive.length > 0 ? `${aktive.length} Task${aktive.length === 1 ? "" : "s"} aktiv` : "Keine aktiven Tasks");
  }

  if (!sim) return <div style={{ padding: 14, fontSize: 12, color: "var(--tc-text-3)" }}>Kein aktives Projekt ausgewählt</div>;

  const hatKalkulation = sim.tasks.some(t => !t.isGroup && t.bauteilKuerzel && t.mengen && Object.keys(t.mengen).length > 0);
  if (stammdaten.gewerke.length === 0 || !hatKalkulation) {
    return (
      <div style={{ padding: 14, fontSize: 12, color: "var(--tc-text-3)" }}>
        Noch keine Auswertung möglich — zuerst in Tab Ressourcen Stammdaten anlegen und in Tab
        Kalkulation Leistungsposition + Mengen je Task erfassen.
      </div>
    );
  }

  // KPIs
  let peakTag = "–", peakWert = 0;
  for (const tw of personal) {
    const summe = Object.values(tw.werte).reduce((s, v) => s + v, 0);
    if (summe > peakWert) { peakWert = summe; peakTag = tw.tag; }
  }
  const peakTagLabel = peakTag !== "–" ? (parseDateUniversal(peakTag)?.toLocaleDateString("de-CH") ?? peakTag) : null;
  const zeitraeumeUeberKapazitaet = kranBuckets.filter((_, bi) => kranstundenSerien.some(s => s.bedarf[bi] > s.kapazitaet[bi])).length;

  // Personen ↔ Personenstunden: 1 Person (Vollzeit) = Std./Tag aus Tab Ressourcen
  const std = stammdaten.arbeitszeitStdProTag;
  // Tagesangaben (fest über dem Diagramm nach Klick): Arbeit des Tages (Personenstunden) und wie lange das eingeplante
  // Personal dafür braucht — mit Auslastung gegenüber der vollen Arbeitszeit. Eingeplant: Total = Personal unter den Kränen (Tab
  // Ressourcen → Kräne & Personal) + Personen ohne Kran (eingeplantesPersonalJeTag). Je Gewerk so, dass die Zeilen das Total
  // ergeben: "unter Kran" (aus dem Personal des Krans) und/oder die Min. Personen seiner Positionen ohne Kran. Ohne
  // Kranpersonal je Gewerk die Min. Personen seiner aktiven Leistungspositionen (kolonnenJeTag).
  const mitKranPersonal = hatKranPersonal(kraene);
  const kolonnen = kolonnenJeTag(tasks, stammdaten, kalender);
  const eingeplantJeTag = eingeplantesPersonalJeTag(tasks, kraene, stammdaten, kalender, personalSerien.tage);
  const geplantesPersonal = (idx: number) => eingeplantJeTag.get(personalSerien.tage[idx])?.total ?? 0;
  const gewerkEingeplant = (key: string, idx: number) => eingeplantJeTag.get(personalSerien.tage[idx])?.jeGewerk[key];
  /** Personen, mit denen eine Zeile rechnet (null = Gewerk unter dem Kran: teilt sich das Personal des Krans, keine eigene Zahl) */
  const eingeplant = (z: DetailZeile, idx: number): number | null => {
    if (z.art === "total") return geplantesPersonal(idx);
    if (z.art !== "serie") return 0;
    if (!mitKranPersonal) return kolonnen.get(personalSerien.tage[idx])?.[z.key]?.personen ?? 0;
    const g = gewerkEingeplant(z.key, idx);
    return g?.unterKran ? null : g?.ohneKran ?? 0;
  };
  // Total ohne Kranpersonal: Schritte eines Tasks nacheinander (Summe), verschiedene Tasks parallel (Maximum) — siehe
  // tagesdauerJeTag. Mit Kranpersonal sind die Leute desselben Unternehmers Allrounder (Pool) → Arbeit ÷ eingeplantes Personal.
  // Gewerk-Zeilen: Arbeit des Gewerks ÷ seine Personen (unter dem Kran: keine eigene Dauer)
  const tagesdauer = tagesdauerJeTag(tasks, stammdaten, kalender);
  const dauer = (z: DetailZeile, idx: number) => {
    if (z.art === "total" && !mitKranPersonal) { const d = tagesdauer.get(personalSerien.tage[idx]) ?? 0; return d > 0 ? d : null; }
    const k = eingeplant(z, idx); return k != null && k > 0 && z.wert > 0 ? z.wert * std / k : null;
  };
  const personalSpalten: DetailSpalte[] = [
    { titel: "Personen",
      erklaerung: `Personalbedarf des Tages als Vollzeit-Äquivalent = Personenstunden des Tages ÷ ${fmtZahl(std)} h/Tag (Tab Ressourcen).\nPersonenstunden je Task = Menge × Leistungswert, verteilt über die Tage, an denen das Gewerk im Task arbeitet.\nTotal = Summe aller Gewerke. Perfekte Auslastung = eingeplantes Personal (Personal unter dem Kran + Personen ohne Kran).`,
      wert: z => fmtZahl(z.wert) },
    { titel: "Arbeit [h]",
      erklaerung: `Arbeit des Tages in Personenstunden = Personen × ${fmtZahl(std)} h/Tag (Tab Ressourcen).\nEntspricht Menge × Leistungswert der an diesem Tag laufenden Tasks.`,
      wert: z => z.art === "linie" ? "" : fmtZahl(z.wert * std) },
    { titel: "Eingeplant [Pers.]",
      erklaerung: mitKranPersonal
        ? "Total (= Linie Perfekte Auslastung): Personal unter den verfügbaren Kränen (Tab Ressourcen → Kräne & Personal) + Personen ohne Kran.\nGewerk: «unter Kran» = arbeitet mit dem Personal des Krans (Allrounder, teilen sich die Arbeit aller Gewerke unter dem Kran — darum keine eigene Zahl); eine Zahl = Min. Personen seiner Leistungspositionen ohne Kran (nicht kranpflichtig, Task ohne Kran …).\nDie Zahlen der Gewerke ergeben zusammen den Teil «ohne» im Total."
        : "Gewerk: Min. Personen (Tab Ressourcen) der an diesem Tag aktiven Leistungspositionen — jede Position zählt pro Tag nur einmal.\nTotal (= Linie Perfekte Auslastung): Summe der Gewerke.",
      wert: (z, i) => {
        if (z.art === "serie") {
          const e = eingeplant(z, i);
          if (e != null) return e > 0 || z.wert > 0 ? fmtZahl(e) : "0";
          const ohne = gewerkEingeplant(z.key, i)?.ohneKran ?? 0;
          return ohne > 0 ? `unter Kran + ${fmtZahl(ohne)}` : "unter Kran";
        }
        if (z.art !== "total") return "";
        const e = eingeplantJeTag.get(personalSerien.tage[i]);
        // mit Kranpersonal: Aufteilung Kran / ohne Kran direkt sichtbar
        return mitKranPersonal && e && e.kolonnen > 0 ? `${fmtZahl(e.total)} (${fmtZahl(e.kranPersonal)} unter Kran + ${fmtZahl(e.kolonnen)} ohne)` : fmtZahl(geplantesPersonal(i));
      },
      zellenTitel: (z, i) => {
        if (z.art !== "total" || !mitKranPersonal) return undefined;
        const e = eingeplantJeTag.get(personalSerien.tage[i]);
        if (!e) return undefined;
        const zeilen = [`Eingeplant ${fmtZahl(e.total)} Pers. = ${fmtZahl(e.kranPersonal)} unter den Kränen (je Kran sein Personal laut Tab Ressourcen — kranpflichtige Arbeiten ohne passenden Unternehmer zählen darin) + ${fmtZahl(e.kolonnen)} ohne Kran.`];
        if (e.ohnePool.length > 0) {
          zeilen.push("", "Nicht aus dem Personal unter dem Kran besetzt:");
          for (const o of e.ohnePool) zeilen.push(`• ${o.label}: Min. ${fmtZahl(o.kolonne)} Pers. — ${o.grund}${o.unterKran ? " (zählt zum Personal des Krans)" : ""}`);
        }
        return zeilen.join("\n");
      } },
    { titel: "Dauer [h]",
      erklaerung: mitKranPersonal
        ? "Wie lange das eingeplante Personal für die Arbeit des Tages braucht.\nGewerk ohne Kran: Arbeit [h] ÷ seine Personen. Gewerke unter dem Kran teilen sich dessen Personal — sie haben keine eigene Dauer, sie stecken im Total.\nTotal: Arbeit [h] ÷ Eingeplant [Pers.]."
        : "Wie lange das eingeplante Personal für die Arbeit des Tages braucht.\nGewerk: Arbeit [h] ÷ Eingeplant [Pers.].\nTotal: Innerhalb eines Tasks laufen die Schritte nacheinander (Arbeitsablauf je Leistungsposition, z.B. Schalung → Bewehrung → Beton) → Summe ihrer Dauern (Arbeit ÷ Personen); verschiedene Tasks laufen parallel → der längste Task zählt. Arbeiten dieselben Personen (Leistungsposition) an mehreren Tasks, zählt mindestens ihre Summe.",
      wert: (z, i) => { const d = dauer(z, i); return d != null ? fmtZahl(d) : ""; } },
    { titel: "Auslastung",
      erklaerung: `Wie stark der Arbeitstag belegt ist = Dauer [h] ÷ ${fmtZahl(std)} h/Tag (Tab Ressourcen).\nGewerk: Auslastung seiner Personen. Total: wie lange der Tag mit dem eingeplanten Personal dauert.\nUnter 100 % = noch Zeit frei, über 100 % = die Arbeit ist in der normalen Arbeitszeit nicht zu schaffen.`,
      wert: (z, i) => { const d = dauer(z, i); return d != null && std > 0 ? `${fmtZahl(d / std * 100)} %` : ""; } },
  ];
  const farbeJeGewerk = new Map(personalSerien.serien.map(s => [s.key, s.color]));
  const mengenSpalten: DetailSpalte[] = [
    { titel: `Tagesleistung [${aktivesGewerk?.einheit ?? ""}]`,
      erklaerung: "Durchschnittlich nötige Tagesleistung = Menge je Task ÷ Arbeitstage, an denen das Gewerk im Task arbeitet, summiert über alle an diesem Tag laufenden Tasks (gewähltes Gewerk/Leistungsposition).\nOptimal ausgelastete Tagesleistung = was die Min. Personen bei voller Arbeitszeit schaffen (Min. Personen × Std./Tag ÷ Leistungswert, Tab Ressourcen).",
      wert: z => fmtZahl(z.wert) },
    ...(optimal != null && optimal > 0 ? [{ titel: "Auslastung",
      erklaerung: "Nötige Tagesleistung ÷ optimal ausgelastete Tagesleistung.\nUnter 100 % = die Personen sind nicht voll ausgelastet, über 100 % = sie schaffen die Menge nicht in der normalen Arbeitszeit.",
      wert: (z: DetailZeile) => z.art === "serie" ? `${fmtZahl(z.wert / optimal * 100)} %` : "" }] : []),
  ];
  const kranSpalten = [
    { titel: kranMetrik === "stunden" ? "Bedarf [h]" : "Personal Ø [Pers.]",
      erklaerung: kranMetrik === "stunden"
        ? "Kranstunden-Bedarf im Monat/in der Woche = Personenstunden der kranpflichtigen Leistungspositionen ÷ Min. Personen × Kranzeit % (Tab Ressourcen, leer = 100), summiert über die diesem Kran zugewiesenen Tasks (Tab Kalkulation → Kräne; bei mehreren Kränen gleichmässig aufgeteilt)."
        : "Durchschnittliche Personen pro Arbeitstag = Personenstunden der kranpflichtigen Leistungspositionen dieses Krans im Monat/in der Woche ÷ verfügbare Arbeitstage ÷ Std./Tag, gerundet.",
      wert: (s: KategorieSerie, bi: number) => fmtZahl(s.werte[bi] ?? 0) },
    { titel: kranMetrik === "stunden" ? "Kapazität [h]" : "Pers. unter Kran",
      erklaerung: kranMetrik === "stunden"
        ? "Verfügbare Kranzeit = Arbeitstage, an denen der Kran im Monat/in der Woche verfügbar ist (Tab Ressourcen → Kräne & Personal, von/bis), × Std./Tag."
        : "Personal unter dem Kran im Monat/in der Woche (Tab Ressourcen → Kräne & Personal, grösster Tageswert; ohne Personal der Richtwert 13).",
      wert: (s: KategorieSerie, bi: number) => s.kapazitaet ? fmtZahl(s.kapazitaet[bi] ?? 0) : "" },
    { titel: "Auslastung",
      erklaerung: kranMetrik === "stunden" ? "Bedarf ÷ Kapazität. Über 100 % = Engpass (Balken rot)." : "Personal Ø ÷ Personal unter dem Kran. Über 100 % = Engpass (Balken rot).",
      wert: (s: KategorieSerie, bi: number) => {
      const kap = s.kapazitaet?.[bi] ?? 0;
      return kap > 0 ? `${fmtZahl((s.werte[bi] ?? 0) / kap * 100)} %${(s.werte[bi] ?? 0) > kap ? " ← Engpass" : ""}` : "";
    } },
  ];
  const markerEntfernen = () => { setAusgewaehlterTag(null); setKlickErgebnis(null); };
  // Linie "Perfekte Auslastung": eingeplantes Personal des Tages (Kranpersonal + Kolonnen ohne Kran) — arbeitet es die volle
  // Arbeitszeit, deckt es genau den Bedarf; liegt die Fläche darüber, ist es überlastet, darunter nicht ausgelastet
  const perfekteAuslastung = personalSerien.tage.map((_, i) => geplantesPersonal(i));

  // ⋮ → Export: jede Auswertung dieses Tabs als CSV (Excel)
  const exporte = [
    { label: "Personalbedarf je Tag und Leistungsposition", title: "Je Arbeitstag: Personen total, Personenstunden total, Personen je Gewerk und Stunden je Leistungsposition",
      onClick: () => csvHerunterladen(personalbedarfAlsCsv(tasks, stammdaten, kalender), `${sim!.name}_Personalbedarf.csv`) },
    { label: `Kranstunden je Kran (${raster === "monat" ? "Monat" : "Woche"})`, title: "Bedarf und Kapazität je Kran und Zeitraum, wie in der Kranoptik",
      onClick: () => csvHerunterladen(alsCsv([
        ["Zeitraum", "Von", "Bis", ...kranstundenSerien.flatMap(k => [`${k.kranName} Bedarf [h]`, `${k.kranName} Kapazität [h]`, `${k.kranName} Personal [Pers.]`])],
        ...kranBuckets.map((b, bi) => [b.label, datumCh(b.start), datumCh(b.end), ...kranstundenSerien.flatMap(k => {
          const pers = personalBarSerien.find(ps => ps.key === k.kranId)?.werte[bi] ?? 0;
          return [csvZahl(k.bedarf[bi]), csvZahl(k.kapazitaet[bi]), csvZahl(pers)];
        })]),
      ]), `${sim!.name}_Kranstunden.csv`) },
    ...(aktivesGewerk ? [{ label: `Mengen je Tag (${aktivesGewerk.label}${aktiveRate ? ` ${aktiveRate.kuerzel}` : ""})`, title: "Durchschnittlich nötige Tagesleistung wie im Mengen-Filter (aktuelle Auswahl)",
      onClick: () => csvHerunterladen(alsCsv([
        ["Datum", `Menge [${aktivesGewerk.einheit}]`, ...(optimal != null ? [`Optimal ausgelastete Tagesleistung [${aktivesGewerk.einheit}]`] : [])],
        ...mengen.map(m => [datumCh(m.tag), csvZahl(m.menge), ...(optimal != null ? [csvZahl(optimal)] : [])]),
      ]), `${sim!.name}_Mengen_${aktivesGewerk.label}.csv`) }] : []),
  ];

  return (
    <div style={{ padding: 14, fontSize: 12 }} ref={zoom.breitenRef}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 8, marginBottom: 16, position: "sticky", top: 0, background: "#fff", zIndex: 3, paddingBottom: 4 }}>
        <StatTile label="Peak Personalbedarf" title={"Höchste Personenzahl an einem Tag (Vollzeit-Äquivalent = Personenstunden des Tages ÷ Std./Tag aus Tab Ressourcen), summiert über alle laufenden Tasks.\nJe Task arbeiten die Gewerke nacheinander, jedes so lange wie in Tab Kalkulation berechnet (Menge × Leistungswert ÷ Min. Personen ÷ Std./Tag).\nIst ein Task im Gantt länger/kürzer als berechnet, wird die Personenzahl entsprechend kleiner/grösser: Personen = Min. Personen × berechnete ÷ geplante Dauer.\nSo ergeben die Personen über den Task genau die kalkulierten Personenstunden."} wert={
          <>{fmtZahl(peakWert)} Pers.{peakTagLabel && <span style={{ fontSize: 11, fontWeight: 400, color: FARBEN.textSekundaer, marginLeft: 6 }}>{peakTagLabel}</span>}</>
        } />
        <StatTile label={`${raster === "monat" ? "Monate" : "Wochen"} über Kran-Kapazität`}
          title={`Anzahl ${raster === "monat" ? "Monate" : "Wochen"}, in denen bei mindestens einem Kran der Kranstunden-Bedarf über der verfügbaren Kranzeit liegt (Umschalter Monat/Woche in der Kranoptik)`} wert={String(zeitraeumeUeberKapazitaet)} status={zeitraeumeUeberKapazitaet > 0 ? "warning" : "good"} />
        <StatTile label="Ø Auslastung Personal"
          title={"Gantt: Ø Auslastung des aktuellen Bauablaufs — Arbeit aller Tage ÷ (eingeplantes Personal × Std./Tag), eingeplant wie die Linie Perfekte Auslastung (Personal unter dem Kran + Personen ohne Kran).\nOptimiert: dieselbe Rechnung nach «Auslastung optimieren» (kritischer Pfad, Lücken füllen, aktuelle Zeiteinheit).\n\nDie Optimierung ist hier nur eine Vorschau — übernehmen in Tab Bauteile → Werkzeuge → «Auslastung optimieren»."}
          wert={auslastungKennzahl ? (
            <>{fmtZahl(auslastungKennzahl.gantt * 100)} %
              <span style={{ fontSize: 11, fontWeight: 400, color: FARBEN.textSekundaer, marginLeft: 6 }}>Gantt</span>
              {auslastungKennzahl.optimiert != null && Math.abs(auslastungKennzahl.optimiert - auslastungKennzahl.gantt) > 0.0005 && (<>
                <span style={{ margin: "0 6px", color: FARBEN.textSekundaer }}>→</span>{fmtZahl(auslastungKennzahl.optimiert * 100)} %
                <span style={{ fontSize: 11, fontWeight: 400, color: FARBEN.textSekundaer, marginLeft: 6 }}>optimiert</span>
              </>)}
            </>) : "–"} />
        <div style={{ marginLeft: "auto", alignSelf: "flex-start" }}>
          <PunkteMenu title="Ansicht und Export der Auswertungen" abschnitte={[
            { titel: "Ansicht", eintraege: [{
              label: ohneWochenenden ? "Wochenenden einblenden" : "Wochenenden ausblenden",
              title: "Arbeitsfreie Samstage/Sonntage in allen Diagrammen dieses Tabs aus der Zeitachse entfernen — die Wochen trennt dann eine feine graue Linie",
              onClick: () => setOhneWochenenden(v => !v) }] },
            { titel: "Export (CSV)", eintraege: exporte },
          ]} />
        </div>
      </div>
      {ausgewaehltesDatumIso && (!api || klickErgebnis) && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12, marginTop: -8, fontSize: 11, color: "var(--tc-text-3)" }}>
          <span>{!api ? "Klick in ein Diagramm springt zu diesem Tag, aber es ist kein 3D-Modell verbunden" : klickErgebnis}</span>
        </div>
      )}

      <CockpitAbschnitt titel="Personalauslastung" eingeklappt={!!eingeklappt["personal"]} onToggle={() => toggleEingeklappt("personal")}>
        <TimeSeriesChart tage={personalSerien.tage} serien={personalSerien.serien} modus="flaeche-gestapelt" einheit="Pers." totalZeile
          weitereLinien={[{ key: "perfekt", label: mitKranPersonal ? "Perfekte Auslastung (Personal unter dem Kran + Personen ohne Kran)" : "Perfekte Auslastung (Min. Personen)", werte: perfekteAuslastung, farbe: FARBEN.status.good }]}
          formatWert={fmtZahl} kalender={kalender} ohneWochenenden={ohneWochenenden} hoehe={hoehePersonal} detailSpalten={personalSpalten}
          detailUnten={i => <Tagesablauf iso={personalSerien.tage[i]} tasks={tasks} stammdaten={stammdaten} kalender={kalender} farbeJeGewerk={farbeJeGewerk}
            eingeplant={eingeplantJeTag.get(personalSerien.tage[i])} mitKranPersonal={mitKranPersonal} />}
          markerIdx={ausgewaehlterTag} markerLabel={ausgewaehltesDatumLabel} onTagKlick={onChartTagKlick} onMarkerEntfernen={markerEntfernen}
          pxProTag={zoom.pxProTag} onPxProTagChange={zoom.setPxProTag} scrollTag={zoom.scrollTag} onScrollChange={zoom.setScrollTag} />
        <ChartResizeHandle hoehe={hoehePersonal} setHoehe={setHoehePersonal} />
      </CockpitAbschnitt>

      <CockpitAbschnitt titel="Mengen-Filter" eingeklappt={!!eingeklappt["mengen"]} onToggle={() => toggleEingeklappt("mengen")}
        aktionen={
          <div style={{ display: "flex", gap: 4 }}>
            <select value={aktivesGewerk?.key ?? ""} onChange={e => { setMengenGewerkKey(e.target.value); setMengenKuerzel(""); }}
              style={{ fontSize: 11, padding: "3px 5px", border: "1px solid #d4dce4", fontFamily: "inherit" }}>
              {gewerkOptionen.map(g => <option key={g.key} value={g.key}>{g.label}</option>)}
            </select>
            {aktivesGewerk && aktivesGewerk.raten.length > 0 && (
              <select value={mengenKuerzel} onChange={e => setMengenKuerzel(e.target.value)}
                title="Leistungsposition — bestimmt die Optimal-Tagesleistung (Leistungswert × Personen × Arbeitszeit dieser Leistungsposition). Total summiert alle Leistungspositionen dieser Kategorie, ohne Optimal-Referenzlinie."
                style={{ fontSize: 11, padding: "3px 5px", border: "1px solid #d4dce4", fontFamily: "inherit" }}>
                <option value="">Total {aktivesGewerk.label}</option>
                {aktivesGewerk.raten.map(r => <option key={r.kuerzel} value={r.kuerzel}>{r.kuerzel} — {r.bezeichnung}</option>)}
              </select>
            )}
          </div>
        }>
        <TimeSeriesChart tage={mengen.map(m => m.tag)} einheit={aktivesGewerk?.einheit ?? ""}
          serien={[{ key: "menge", label: `Durchschnittlich nötige Tagesleistung${aktiveRate ? ` (${aktiveRate.kuerzel})` : " (Total)"}`, color: FARBEN.kategorial[0], werte: mengen.map(m => m.menge) }]}
          referenzlinie={optimal != null ? { wert: optimal, label: "Optimal ausgelastete Tagesleistung" } : undefined}
          modus="linie" formatWert={fmtZahl}
          kalender={kalender} ohneWochenenden={ohneWochenenden} hoehe={hoeheMengen} detailSpalten={mengenSpalten}
          markerIdx={ausgewaehlterTag} markerLabel={ausgewaehltesDatumLabel} onTagKlick={onChartTagKlick} onMarkerEntfernen={markerEntfernen}
          pxProTag={zoom.pxProTag} onPxProTagChange={zoom.setPxProTag} scrollTag={zoom.scrollTag} onScrollChange={zoom.setScrollTag} />
        <ChartResizeHandle hoehe={hoeheMengen} setHoehe={setHoeheMengen} />
      </CockpitAbschnitt>

      <CockpitAbschnitt titel="Kranoptik" eingeklappt={!!eingeklappt["kran"]} onToggle={() => toggleEingeklappt("kran")}
        aktionen={
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            {(["stunden", "personal"] as const).map(m => (
              <button key={m} onClick={() => setKranMetrik(m)}
                title={m === "stunden" ? "Kranstunden-Bedarf vs. Verfügbarkeit" : "Durchschnittliche Personen pro Arbeitstag je Kran und Monat/Woche (kranpflichtige Gewerke) vs. Personal unter dem Kran — nicht mit den Tageswerten der Personalauslastung vergleichbar"}
                style={{ fontSize: 11, fontWeight: 600, padding: "3px 8px", cursor: "pointer",
                  border: `1px solid ${kranMetrik === m ? "var(--tc-blue)" : "var(--tc-border)"}`,
                  background: kranMetrik === m ? "var(--tc-blue-bg)" : "#fff", color: kranMetrik === m ? "var(--tc-blue)" : "var(--tc-text-2)" }}>
                {m === "stunden" ? "Kranstunden" : "Personal (Ø pro Tag)"}
              </button>
            ))}
            <span style={{ width: 1, alignSelf: "stretch", background: "var(--tc-border)" }} />
            {(["monat", "woche"] as const).map(r => (
              <button key={r} disabled={readOnly} onClick={() => updateSim({ ...sim, zeitraster: r })}
                style={{ fontSize: 11, fontWeight: 600, padding: "3px 8px", cursor: readOnly ? "default" : "pointer",
                  border: `1px solid ${raster === r ? "var(--tc-blue)" : "var(--tc-border)"}`,
                  background: raster === r ? "var(--tc-blue-bg)" : "#fff", color: raster === r ? "var(--tc-blue)" : "var(--tc-text-2)" }}>
                {r === "monat" ? "Monat" : "Woche"}
              </button>
            ))}
            <span title="Richtwerte zur Plausibilisierung, keine exakte Kalkulation" style={{ fontSize: 11, color: "var(--tc-text-3)", cursor: "help" }}>ⓘ</span>
          </div>
        }>
        <KranLueckenHinweis luecken={luecken} kraene={kraene} />
        {kraene.length === 0 && luecken.ohneKran.tage.length === 0 ? (
          <div style={{ fontSize: 11, color: "var(--tc-text-3)" }}>
            Noch keine Kräne angelegt — Tab Ressourcen → Kräne & Personal.
          </div>
        ) : !hatKranpflichtigeRaten(stammdaten) ? (
          <div style={{ fontSize: 11, color: "var(--tc-text-3)" }}>
            Keine Leistungsposition als kranpflichtig markiert (Tab Ressourcen).
          </div>
        ) : kranMetrik === "stunden" ? (
          !kranHatBedarf ? (
            <div style={{ fontSize: 11, color: "var(--tc-text-3)" }}>
              Noch keinen Task einem Kran zugewiesen (Tab Kalkulation → Spalte "Kräne").
            </div>
          ) : (<>
            <KranBalkenChart tage={personalSerien.tage} buckets={kranBuckets} serien={kranBarSerien} einheit="h"
              formatWert={fmtZahl} kalender={kalender} ohneWochenenden={ohneWochenenden} hoehe={hoeheKran}
              markerIdx={ausgewaehlterTag} markerLabel={ausgewaehltesDatumLabel} onTagKlick={onChartTagKlick} onMarkerEntfernen={markerEntfernen} detailSpalten={kranSpalten}
              pxProTag={zoom.pxProTag} onPxProTagChange={zoom.setPxProTag} scrollTag={zoom.scrollTag} onScrollChange={zoom.setScrollTag} />
            <ChartResizeHandle hoehe={hoeheKran} setHoehe={setHoeheKran} />
          </>)
        ) : (
          !personalKranHatBedarf ? (
            <div style={{ fontSize: 11, color: "var(--tc-text-3)" }}>
              Noch keinen Task einem Kran zugewiesen (Tab Kalkulation → Spalte "Kräne").
            </div>
          ) : (<>
            <KranBalkenChart tage={personalSerien.tage} buckets={personalKranBuckets} serien={personalBarSerien} einheit="Pers. (Ø pro Arbeitstag)"
              formatWert={fmtZahl} kalender={kalender} ohneWochenenden={ohneWochenenden} hoehe={hoeheKran}
              markerIdx={ausgewaehlterTag} markerLabel={ausgewaehltesDatumLabel} onTagKlick={onChartTagKlick} onMarkerEntfernen={markerEntfernen} detailSpalten={kranSpalten}
              pxProTag={zoom.pxProTag} onPxProTagChange={zoom.setPxProTag} scrollTag={zoom.scrollTag} onScrollChange={zoom.setScrollTag} />
            <ChartResizeHandle hoehe={hoeheKran} setHoehe={setHoeheKran} />
          </>)
        )}
      </CockpitAbschnitt>
    </div>
  );
}
