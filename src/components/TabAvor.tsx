// TabAvor.tsx — Cockpit mit Personal-/Kranauslastung und Mengen-Filter, abgeleitet
// aus den in Tab Kalkulation erfassten Mengen/Kürzeln/WBS-Feldern und den Stammdaten aus Ressourcen.
import { useState, useEffect } from "react";
import type { SimProjekt, Zeitraster } from "../types";
import { parseDateUniversal, nsKey } from "../types";
import { LEERER_KALENDER } from "./kalenderHelpers";
import { LEERE_STAMMDATEN, hatKranpflichtigeRaten } from "./stammdatenHelpers";
import { personalauslastung, kolonnenJeTag, personalSollProTag, mengenProTag, optimaleTagesleistung } from "./avorHelpers";
import type { TagWert } from "./avorHelpers";
import { kranstundenProKranUndBucket } from "./kranHelpers";
import { personenstundenProKranUndBucket, personalRichtwertJeBucket, MAX_PERSONEN_PRO_KRAN } from "./kapazitaetsCheckHelpers";
import { dreiDZustandAufTagSetzen, tagVonDatum } from "./dreiDHeuteHelper";
import type { ApiInstance } from "../hooks/useApi";
import { TimeSeriesChart, KranBalkenChart, StatTile, CockpitAbschnitt, useEingeklappt, useChartZoom, useChartHoehe, ChartResizeHandle, FARBEN } from "./cockpitCharts";
import type { Serie, KategorieSerie, DetailSpalte, DetailZeile } from "./cockpitCharts";
import KranPlanungManager from "./KranPlanungManager";
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
  const [kranPlanungOffen, setKranPlanungOffen] = useState(false);
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
  const personalSoll = personalSollProTag(tasks, kalender);
  const personalSollGesetzt = personalSoll.some(v => v > 0);

  const kraene = sim?.kraene ?? [];
  const kranById = new Map(kraene.map(k => [k.id, k]));
  const raster: Zeitraster = sim?.zeitraster ?? "monat";
  const { buckets: kranBuckets, serien: kranstundenSerien } = kranstundenProKranUndBucket(tasks, kraene, stammdaten, kalender, raster);
  const kranHatBedarf = kranstundenSerien.some(s => s.bedarf.some(v => v > 0));
  const kranBarSerien: KategorieSerie[] = kranstundenSerien.map((s, i) => ({
    key: s.kranId, label: s.kranName, color: FARBEN.kategorial[i % FARBEN.kategorial.length], werte: s.bedarf, kapazitaet: s.kapazitaet,
  }));
  // Personal-Pendant zur Kran-Stunden-Kapazität: je Kran und Zeitraster-Bucket ergibt sich aus den
  // Personenstunden kranpflichtiger Gewerke (nur Kürzel, die in Tab Ressourcen als kranpflichtig markiert
  // sind, und nur Tasks mit einer Kran-Zuweisung aus Tab Kalkulation) ein Personal-Richtwert — Engpass,
  // sobald der über dem je Kran in "Kräne & Verfügbarkeit" hinterlegten Max-Personen-Wert liegt.
  const { buckets: personalKranBuckets, serien: personalKranSerien } = personenstundenProKranUndBucket(tasks, kraene, stammdaten, kalender, raster);
  // Personal-Ansicht der Kranoptik (Umschalter neben Kranstunden): Balken = gerundeter Personal-
  // Richtwert je Kran und Zeitraster-Bucket, Kapazitätslinie = dessen fixer Max-Personen-Wert (anders
  // als bei Kranstunden nicht zeitraum-abhängig, da Max. Personen eine statische Kran-Eigenschaft ist).
  const personalBarSerien: KategorieSerie[] = personalKranSerien.map((s, i) => {
    const maxPersonenDiesesKrans = kranById.get(s.kranId)?.maxPersonen ?? MAX_PERSONEN_PRO_KRAN;
    return {
      key: s.kranId, label: s.kranName, color: FARBEN.kategorial[i % FARBEN.kategorial.length],
      werte: personalKranBuckets.map((_, bi) => personalRichtwertJeBucket(s.personenstunden[bi], s.arbeitstageVerfuegbar[bi], stammdaten.arbeitszeitStdProTag, maxPersonenDiesesKrans).richtwert ?? 0),
      kapazitaet: personalKranBuckets.map(() => maxPersonenDiesesKrans),
    };
  });
  const personalKranHatBedarf = personalKranSerien.some(s => s.personenstunden.some(v => v > 0));

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
    const aktive = await dreiDZustandAufTagSetzen(api, tasks, minDate, tag, true, (sim?.ausgeschlossen ?? []).map(a => a.guid));
    setKlickErgebnis(aktive.length > 0 ? `${aktive.length} Task${aktive.length === 1 ? "" : "s"} aktiv` : "Keine aktiven Tasks");
  }

  if (!sim) return <div style={{ padding: 14, fontSize: 12, color: "var(--tc-text-3)" }}>Kein aktives Projekt ausgewählt</div>;

  const hatKalkulation = sim.tasks.some(t => !t.isGroup && t.bauteilKuerzel && t.mengen && Object.keys(t.mengen).length > 0);
  if (stammdaten.gewerke.length === 0 || !hatKalkulation) {
    return (
      <div style={{ padding: 14, fontSize: 12, color: "var(--tc-text-3)" }}>
        Noch keine Auswertung möglich — zuerst in Tab Ressourcen Stammdaten anlegen und in Tab
        Kalkulation Bauteil-Kürzel + Mengen je Task erfassen.
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
  const tageUeberPersonalSoll = personal.filter((tw, i) => {
    const soll = personalSoll[i] ?? 0;
    return soll > 0 && Object.values(tw.werte).reduce((s, v) => s + v, 0) > soll;
  }).length;

  // Personen ↔ Personenstunden: 1 Person (Vollzeit) = Std./Tag aus Tab Ressourcen
  const std = stammdaten.arbeitszeitStdProTag;
  // Tagesangaben (fest über dem Diagramm nach Klick): Arbeit des Tages (Personenstunden) und wie lange das eingeplante
  // Personal (Kolonnen aus Tab Ressourcen, je Leistungsposition nur einmal, siehe kolonnenJeTag) dafür braucht — mit
  // Auslastung gegenüber der vollen Arbeitszeit
  const kolonnen = kolonnenJeTag(tasks, stammdaten, kalender);
  const geplantesPersonal = (idx: number) => Object.values(kolonnen.get(personalSerien.tage[idx]) ?? {}).reduce((s, k) => s + k.personen, 0);
  const eingeplant = (z: DetailZeile, idx: number) =>
    z.art === "total" ? geplantesPersonal(idx) : z.art === "serie" ? kolonnen.get(personalSerien.tage[idx])?.[z.key]?.personen ?? 0 : 0;
  const dauer = (z: DetailZeile, idx: number) => { const k = eingeplant(z, idx); return k > 0 && z.wert > 0 ? z.wert * std / k : null; };
  const personalSpalten: DetailSpalte[] = [
    { titel: "Personen", wert: z => fmtZahl(z.wert) },
    { titel: "Arbeit [h]", wert: z => z.art === "linie" ? "" : fmtZahl(z.wert * std) },
    { titel: "Eingeplant [Pers.]", wert: (z, i) => z.art === "total" || z.art === "serie" ? fmtZahl(eingeplant(z, i)) : "" },
    { titel: "Dauer [h]", wert: (z, i) => { const d = dauer(z, i); return d != null ? fmtZahl(d) : ""; } },
    { titel: "Auslastung", wert: (z, i) => { const d = dauer(z, i); return d != null && std > 0 ? `${fmtZahl(d / std * 100)} %` : ""; } },
  ];
  const mengenSpalten: DetailSpalte[] = [
    { titel: `Tagesleistung [${aktivesGewerk?.einheit ?? ""}]`, wert: z => fmtZahl(z.wert) },
    ...(optimal != null && optimal > 0 ? [{ titel: "Auslastung", wert: (z: DetailZeile) => z.art === "serie" ? `${fmtZahl(z.wert / optimal * 100)} %` : "" }] : []),
  ];
  const kranSpalten = [
    { titel: kranMetrik === "stunden" ? "Bedarf [h]" : "Personal Ø [Pers.]", wert: (s: KategorieSerie, bi: number) => fmtZahl(s.werte[bi] ?? 0) },
    { titel: kranMetrik === "stunden" ? "Kapazität [h]" : "Max. Personen", wert: (s: KategorieSerie, bi: number) => s.kapazitaet ? fmtZahl(s.kapazitaet[bi] ?? 0) : "" },
    { titel: "Auslastung", wert: (s: KategorieSerie, bi: number) => {
      const kap = s.kapazitaet?.[bi] ?? 0;
      return kap > 0 ? `${fmtZahl((s.werte[bi] ?? 0) / kap * 100)} %${(s.werte[bi] ?? 0) > kap ? " ← Engpass" : ""}` : "";
    } },
  ];
  const markerEntfernen = () => { setAusgewaehlterTag(null); setKlickErgebnis(null); };
  // Linie "Perfekte Auslastung": eingeplantes Personal des Tages — arbeitet es die volle Arbeitszeit, deckt es genau den
  // Bedarf; liegt die Fläche darüber, ist es überlastet, darunter nicht ausgelastet
  const perfekteAuslastung = personalSerien.tage.map((_, i) => geplantesPersonal(i));

  // ⋮ → Export: jede Auswertung dieses Tabs als CSV (Excel)
  const exporte = [
    { label: "Personalbedarf je Tag und Leistungsposition", title: "Je Arbeitstag: Personen total, Personenstunden total, Personen je Gewerk und Stunden je Leistungsposition (Gewerk + Kürzel)",
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
        <StatTile label="Peak Personalbedarf" title={"Höchste Personenzahl an einem Tag (Vollzeit-Äquivalent = Personenstunden des Tages ÷ Std./Tag aus Tab Ressourcen), summiert über alle laufenden Tasks.\nJe Task arbeiten die Gewerke nacheinander, jedes so lange wie in Tab Kalkulation berechnet (Menge × Leistungswert ÷ Kolonne ÷ Std./Tag).\nIst ein Task im Gantt länger/kürzer als berechnet, wird die Kolonne entsprechend kleiner/grösser: Personen = Kolonne × berechnete ÷ geplante Dauer.\nSo ergeben die Personen über den Task genau die kalkulierten Personenstunden."} wert={
          <>{fmtZahl(peakWert)} Pers.{peakTagLabel && <span style={{ fontSize: 11, fontWeight: 400, color: FARBEN.textSekundaer, marginLeft: 6 }}>{peakTagLabel}</span>}</>
        } />
        {personalSollGesetzt && (
          <StatTile label="Tage über Personal (Soll)" title={"Anzahl Arbeitstage, an denen der berechnete Personalbedarf (Summe aller Gewerke, wie im Diagramm Personalauslastung) höher ist als Personal (Soll).\nPersonal (Soll) = Summe der in Tab Kalkulation erfassten Personal (Soll) aller an diesem Tag laufenden Tasks; Tage ohne Soll zählen nicht."} wert={String(tageUeberPersonalSoll)} status={tageUeberPersonalSoll > 0 ? "warning" : "good"} />
        )}
        <StatTile label={`${raster === "monat" ? "Monate" : "Wochen"} über Kran-Kapazität`}
          title={`Anzahl ${raster === "monat" ? "Monate" : "Wochen"}, in denen bei mindestens einem Kran der Kranstunden-Bedarf über der verfügbaren Kranzeit liegt (Umschalter Monat/Woche in der Kranoptik)`} wert={String(zeitraeumeUeberKapazitaet)} status={zeitraeumeUeberKapazitaet > 0 ? "warning" : "good"} />
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
      {ausgewaehltesDatumIso && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12, marginTop: -8, fontSize: 11, color: "var(--tc-text-3)" }}>
          <span>📍 {ausgewaehltesDatumLabel}{!api && " — Klick in ein Diagramm springt zu diesem Tag, aber es ist kein 3D-Modell verbunden"}{klickErgebnis && api ? ` — ${klickErgebnis}` : ""}</span>
        </div>
      )}

      <CockpitAbschnitt titel="Personalauslastung" eingeklappt={!!eingeklappt["personal"]} onToggle={() => toggleEingeklappt("personal")}>
        <TimeSeriesChart tage={personalSerien.tage} serien={personalSerien.serien} modus="flaeche-gestapelt" einheit="Pers." totalZeile
          referenzlinie={personalSollGesetzt ? { label: "Personal (Soll)", werte: personalSoll } : undefined}
          weitereLinien={[{ key: "perfekt", label: "Perfekte Auslastung (Kolonnen)", werte: perfekteAuslastung, farbe: FARBEN.status.good }]}
          formatWert={fmtZahl} kalender={kalender} ohneWochenenden={ohneWochenenden} hoehe={hoehePersonal} detailSpalten={personalSpalten}
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
                title="Bauteil-Kürzel — bestimmt die Optimal-Tagesleistung (Leistungswert × Personen × Arbeitszeit dieses Kürzels). Total summiert alle Kürzel dieser Kategorie, ohne Optimal-Referenzlinie."
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
            <button className="tc-btn-secondary" style={{ fontSize: 11, fontWeight: 600, height: "auto", padding: "3px 8px", borderRadius: 0 }}
              onClick={() => setKranPlanungOffen(true)}
              title="Kräne anlegen, ihre Verfügbarkeit festlegen und Personal-/Kran-Budget je Bauphase gegen den Bedarf prüfen">
              Kranplanung
            </button>
            <span style={{ width: 1, alignSelf: "stretch", background: "var(--tc-border)" }} />
            {(["stunden", "personal"] as const).map(m => (
              <button key={m} onClick={() => setKranMetrik(m)}
                title={m === "stunden" ? "Kranstunden-Bedarf vs. Verfügbarkeit" : "Durchschnittliche Personen pro Arbeitstag je Kran und Monat/Woche (kranpflichtige Gewerke) vs. dessen Max. Personen — nicht mit den Tageswerten der Personalauslastung vergleichbar"}
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
        {kraene.length === 0 ? (
          <div style={{ fontSize: 11, color: "var(--tc-text-3)" }}>
            Noch keine Kräne angelegt — siehe Button "Kranplanung" oben rechts.
          </div>
        ) : !hatKranpflichtigeRaten(stammdaten) ? (
          <div style={{ fontSize: 11, color: "var(--tc-text-3)" }}>
            Kein Kürzel als kranpflichtig markiert (Tab Ressourcen).
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

      {kranPlanungOffen && (
        <KranPlanungManager sim={sim} updateSim={updateSim} readOnly={readOnly} onClose={() => setKranPlanungOffen(false)} />
      )}
    </div>
  );
}
