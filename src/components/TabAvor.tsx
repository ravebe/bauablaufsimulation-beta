// TabAvor.tsx — Cockpit mit Personal-/Kranauslastung, Mengen-Filter und Ertragsoptik, abgeleitet
// aus den in Tab Kalkulation erfassten Mengen/Kürzeln/WBS-Feldern und den Stammdaten aus Ressourcen.
import { useState } from "react";
import type { SimProjekt } from "../types";
import { LEERER_KALENDER } from "./kalenderHelpers";
import { LEERE_STAMMDATEN } from "./stammdatenHelpers";
import { personalauslastung, kranauslastung, mengenProTag, ertragsoptik, optimaleTagesleistung } from "./avorHelpers";
import type { TagWert } from "./avorHelpers";
import { TimeSeriesChart, StatTile, CockpitAbschnitt, useEingeklappt, useChartZoom, useChartHoehe, ChartResizeHandle, FARBEN } from "./cockpitCharts";
import type { Serie } from "./cockpitCharts";

interface Props { sim: SimProjekt | null; projectId?: string | null; }

const KRAN_KAPAZITAET = 1; // Annahme: 1 Kran je Kranbereich — Werte darüber = mehrere Tasks wollen gleichzeitig denselben Kran

function fmtChf(n: number): string {
  return n.toLocaleString("de-CH", { maximumFractionDigits: 0 });
}

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

export default function TabAvor({ sim, projectId = null }: Props) {
  const [mengenGewerkKey, setMengenGewerkKey] = useState<string>("beton");
  const [mengenKuerzel, setMengenKuerzel] = useState<string>("");
  const { eingeklappt, toggle: toggleEingeklappt } = useEingeklappt(projectId, "avor");

  // Alle Daten mit sicheren Fallbacks berechnen (nicht erst nach einem frühen Return), damit die
  // untenstehenden Hooks (useChartZoom/useChartHoehe) in jedem Render in derselben Reihenfolge
  // aufgerufen werden — unabhängig davon, ob am Ende der "Kein Projekt"-Zweig gerendert wird.
  const stammdaten = sim?.stammdaten ?? LEERE_STAMMDATEN;
  const kalender = sim?.kalender ?? LEERER_KALENDER;
  const tasks = sim?.tasks ?? [];

  const personal = personalauslastung(tasks, stammdaten, kalender);
  const personalSerien = gestapelteSerien(personal, k => stammdaten.gewerke.find(g => g.key === k)?.label ?? k);

  const kran = kranauslastung(tasks, stammdaten, kalender);
  const kranSerien = gestapelteSerien(kran, k => k === "unbekannt" ? "Ohne Kranbereich" : k);
  const kranGibtEsDaten = kranSerien.serien.length > 0 && stammdaten.gewerke.some(g => g.kranpflichtig);

  const gewerkOptionen = stammdaten.gewerke;
  const aktivesGewerk = gewerkOptionen.find(g => g.key === mengenGewerkKey) ?? gewerkOptionen[0];
  const aktiveRate = aktivesGewerk?.raten.find(r => r.kuerzel === mengenKuerzel) ?? aktivesGewerk?.raten[0];
  const mengen = aktivesGewerk ? mengenProTag(tasks, aktivesGewerk.key, kalender, aktiveRate?.kuerzel) : [];
  const optimal = aktiveRate ? optimaleTagesleistung(aktiveRate, stammdaten.arbeitszeitStdProTag) : null;

  const ertrag = ertragsoptik(tasks, stammdaten, kalender);

  // Gemeinsamer Zoom/Scroll aller Diagramme dieses Tabs (Mausrad zoomt zum Cursor, wie im Gantt —
  // Achse wechselt dabei automatisch zwischen Monaten/Wochen/Tagen) + je Diagramm frei per Slider
  // einstellbare Höhe, beides projektbezogen in localStorage gemerkt.
  const tageAnzahl = Math.max(personal.length, kran.length, mengen.length, ertrag.length);
  const zoom = useChartZoom(projectId, "avor", tageAnzahl);
  const [hoehePersonal, setHoehePersonal] = useChartHoehe(projectId, "avor-personal");
  const [hoeheKran, setHoeheKran] = useChartHoehe(projectId, "avor-kran");
  const [hoeheMengen, setHoeheMengen] = useChartHoehe(projectId, "avor-mengen");
  const [hoeheErtrag, setHoeheErtrag] = useChartHoehe(projectId, "avor-ertrag");

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
  const tageUeberKapazitaet = kran.filter(tw => Object.values(tw.werte).some(v => v > KRAN_KAPAZITAET)).length;
  const letzteErtragszeile = ertrag[ertrag.length - 1];
  const marge = letzteErtragszeile ? letzteErtragszeile.ertragKum - letzteErtragszeile.kostenKum : 0;

  return (
    <div style={{ padding: 14, fontSize: 12 }} ref={zoom.breitenRef}>
      <div style={{ display: "flex", gap: 8, marginBottom: 16, position: "sticky", top: 0, background: "#fff", zIndex: 3, paddingBottom: 4 }}>
        <StatTile label="Peak Personalbedarf" wert={`${peakWert} Pers.`} sub={peakTag !== "–" ? peakTag : undefined} />
        <StatTile label="Tage über Kran-Kapazität" wert={String(tageUeberKapazitaet)} status={tageUeberKapazitaet > 0 ? "warning" : "good"} />
        <StatTile label="Marge (kumuliert)" wert={`${fmtChf(marge)} CHF`} status={marge >= 0 ? "good" : "critical"} />
      </div>

      <CockpitAbschnitt titel="Personalauslastung" eingeklappt={!!eingeklappt["personal"]} onToggle={() => toggleEingeklappt("personal")}>
        <TimeSeriesChart tage={personalSerien.tage} serien={personalSerien.serien} modus="flaeche-gestapelt" einheit="Personen"
          formatWert={v => String(Math.round(v))} kalender={kalender} hoehe={hoehePersonal}
          pxProTag={zoom.pxProTag} onPxProTagChange={zoom.setPxProTag} scrollTag={zoom.scrollTag} onScrollChange={zoom.setScrollTag} />
        <ChartResizeHandle hoehe={hoehePersonal} setHoehe={setHoehePersonal} />
      </CockpitAbschnitt>

      <CockpitAbschnitt titel="Kranauslastung" eingeklappt={!!eingeklappt["kran"]} onToggle={() => toggleEingeklappt("kran")}>
        {!kranGibtEsDaten ? (
          <div style={{ fontSize: 11, color: "var(--tc-text-3)" }}>
            Kein Gewerk als kranpflichtig markiert (Tab Ressourcen) oder keine Tasks mit Kranbereich erfasst.
          </div>
        ) : (<>
          <TimeSeriesChart tage={kranSerien.tage} serien={kranSerien.serien} modus="linie" einheit="gleichzeitig"
            referenzlinie={{ wert: KRAN_KAPAZITAET, label: "Kapazität" }} formatWert={v => String(Math.round(v))}
            kalender={kalender} hoehe={hoeheKran}
            pxProTag={zoom.pxProTag} onPxProTagChange={zoom.setPxProTag} scrollTag={zoom.scrollTag} onScrollChange={zoom.setScrollTag} />
          <ChartResizeHandle hoehe={hoeheKran} setHoehe={setHoeheKran} />
        </>)}
      </CockpitAbschnitt>

      <CockpitAbschnitt titel="Mengen-Filter" eingeklappt={!!eingeklappt["mengen"]} onToggle={() => toggleEingeklappt("mengen")}
        aktionen={
          <div style={{ display: "flex", gap: 4 }}>
            <select value={aktivesGewerk?.key ?? ""} onChange={e => { setMengenGewerkKey(e.target.value); setMengenKuerzel(""); }}
              style={{ fontSize: 11, padding: "3px 5px", border: "1px solid #d4dce4", fontFamily: "inherit" }}>
              {gewerkOptionen.map(g => <option key={g.key} value={g.key}>{g.label}</option>)}
            </select>
            {aktivesGewerk && aktivesGewerk.raten.length > 0 && (
              <select value={aktiveRate?.kuerzel ?? ""} onChange={e => setMengenKuerzel(e.target.value)}
                title="Bauteil-Kürzel — bestimmt die Optimal-Tagesleistung (Leistungswert × Personen × Arbeitszeit dieses Kürzels)"
                style={{ fontSize: 11, padding: "3px 5px", border: "1px solid #d4dce4", fontFamily: "inherit" }}>
                {aktivesGewerk.raten.map(r => <option key={r.kuerzel} value={r.kuerzel}>{r.kuerzel} — {r.bezeichnung}</option>)}
              </select>
            )}
          </div>
        }>
        <TimeSeriesChart tage={mengen.map(m => m.tag)} einheit={aktivesGewerk?.einheit ?? ""}
          serien={[{ key: "menge", label: "Durchschnittlich nötige Tagesleistung", color: FARBEN.kategorial[0], werte: mengen.map(m => m.menge) }]}
          referenzlinie={optimal != null ? { wert: optimal, label: "Optimal ausgelastete Tagesleistung" } : undefined}
          modus="linie" formatWert={v => v.toLocaleString("de-CH", { maximumFractionDigits: 1 })}
          kalender={kalender} hoehe={hoeheMengen}
          pxProTag={zoom.pxProTag} onPxProTagChange={zoom.setPxProTag} scrollTag={zoom.scrollTag} onScrollChange={zoom.setScrollTag} />
        <ChartResizeHandle hoehe={hoeheMengen} setHoehe={setHoeheMengen} />
      </CockpitAbschnitt>

      <CockpitAbschnitt titel="Ertragsoptik" eingeklappt={!!eingeklappt["ertrag"]} onToggle={() => toggleEingeklappt("ertrag")}>
        <TimeSeriesChart tage={ertrag.map(e => e.tag)} einheit="CHF" formatWert={fmtChf} modus="linie"
          serien={[
            { key: "ertrag", label: "Ertrag (kumuliert)", color: FARBEN.kategorial[0], werte: ertrag.map(e => e.ertragKum) },
            { key: "kosten", label: "Kosten (kumuliert)", color: FARBEN.kategorial[1], werte: ertrag.map(e => e.kostenKum) },
          ]} kalender={kalender} hoehe={hoeheErtrag}
          pxProTag={zoom.pxProTag} onPxProTagChange={zoom.setPxProTag} scrollTag={zoom.scrollTag} onScrollChange={zoom.setScrollTag} />
        <ChartResizeHandle hoehe={hoeheErtrag} setHoehe={setHoeheErtrag} />
      </CockpitAbschnitt>
    </div>
  );
}
