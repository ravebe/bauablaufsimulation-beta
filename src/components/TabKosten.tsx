// TabKosten.tsx — Kosten-Auswertung aus den Mengen×Stammdaten-Raten je Task, aggregiert nach
// Bauteil-Kürzel. Rein lesend, keine Eingabe (Mengen/Kürzel werden im Tab Kalkulation gepflegt).
import { useState } from "react";
import type { SimProjekt } from "../types";
import { istGruppe, parseDateUniversal } from "../types";
import type { ApiInstance } from "../hooks/useApi";
import { LEERER_KALENDER } from "./kalenderHelpers";
import { LEERE_STAMMDATEN, kostenTask } from "./stammdatenHelpers";
import { ertragsoptik } from "./avorHelpers";
import { dreiDZustandAufTagSetzen, tagVonDatum } from "./dreiDHeuteHelper";
import { StatTile, CategoryBarChart, TimeSeriesChart, CockpitAbschnitt, useEingeklappt, FARBEN } from "./cockpitCharts";

interface Props { sim: SimProjekt | null; projectId?: string | null; api?: ApiInstance | null; sharedNadelTag?: React.MutableRefObject<number>; }

function fmtChf(n: number): string {
  return n.toLocaleString("de-CH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function heuteIsoUndDatum(): { iso: string; datum: Date } {
  const datum = new Date();
  datum.setHours(0, 0, 0, 0);
  const iso = `${datum.getFullYear()}-${String(datum.getMonth() + 1).padStart(2, "0")}-${String(datum.getDate()).padStart(2, "0")}`;
  return { iso, datum };
}

export default function TabKosten({ sim, projectId = null, api, sharedNadelTag }: Props) {
  const { eingeklappt, toggle: toggleEingeklappt } = useEingeklappt(projectId, "kosten");
  const [heuteLaeuft, setHeuteLaeuft] = useState(false);
  const [heuteErgebnis, setHeuteErgebnis] = useState<string | null>(null);

  if (!sim) return <div style={{ padding: 14, fontSize: 12, color: "var(--tc-text-3)" }}>Kein aktives Projekt ausgewählt</div>;

  const stammdaten = sim.stammdaten ?? LEERE_STAMMDATEN;
  const kalender = sim.kalender ?? LEERER_KALENDER;
  const proKuerzel = new Map<string, { summe: number; anzahl: number; bezeichnung: string }>();
  const kostenProGewerk = new Map<string, number>();
  let gesamt = 0, tasksMitKosten = 0, gesamtTaskAnzahl = 0;

  sim.tasks.forEach((t, i) => {
    if (t.isGroup || istGruppe(sim.tasks, i)) return;
    gesamtTaskAnzahl += 1;
    if (!t.bauteilKuerzel || !t.mengen) return;
    const kosten = kostenTask(t, stammdaten);
    if (kosten <= 0) return;
    gesamt += kosten;
    tasksMitKosten += 1;
    const bezeichnung = stammdaten.gewerke.flatMap(g => g.raten).find(r => r.kuerzel === t.bauteilKuerzel)?.bezeichnung ?? t.bauteilKuerzel;
    const eintrag = proKuerzel.get(t.bauteilKuerzel) ?? { summe: 0, anzahl: 0, bezeichnung };
    eintrag.summe += kosten;
    eintrag.anzahl += 1;
    proKuerzel.set(t.bauteilKuerzel, eintrag);
    for (const gewerk of stammdaten.gewerke) {
      const menge = t.mengen[gewerk.key];
      if (!menge) continue;
      const rate = gewerk.raten.find(r => r.kuerzel === t.bauteilKuerzel);
      if (rate?.chfProEinheit) kostenProGewerk.set(gewerk.key, (kostenProGewerk.get(gewerk.key) ?? 0) + menge * rate.chfProEinheit);
    }
  });

  const zeilen = [...proKuerzel.entries()].sort((a, b) => b[1].summe - a[1].summe);
  const gewerkeMitKosten = [...kostenProGewerk.entries()].sort((a, b) => b[1] - a[1]);
  const ertrag = ertragsoptik(sim.tasks, stammdaten, kalender);
  const topEintrag = zeilen[0];
  const topAnteilProzent = topEintrag && gesamt > 0 ? (topEintrag[1].summe / gesamt) * 100 : 0;

  // "Heute"-Bezug: Position im kumulierten Verlauf + 3D-Baufortschritt von heute.
  const { iso: heuteIso, datum: heute } = heuteIsoUndDatum();
  const heuteIdxRoh = ertrag.findIndex(e => e.tag === heuteIso);
  const vorProjektstart = ertrag.length > 0 && heuteIso < ertrag[0].tag;
  const heuteIdx = heuteIdxRoh >= 0 ? heuteIdxRoh : (vorProjektstart ? -1 : ertrag.length - 1);
  const kostenHeute = heuteIdx >= 0 ? ertrag[heuteIdx].kostenKum : 0;

  const allStarts = sim.tasks.map(t => parseDateUniversal(t.start)).filter((d): d is Date => !!d);
  const minDate = allStarts.length > 0 ? new Date(Math.min(...allStarts.map(d => d.getTime()))) : null;

  async function heuteIm3dZeigen() {
    if (!api || !minDate) return;
    setHeuteLaeuft(true);
    setHeuteErgebnis(null);
    if (sharedNadelTag) sharedNadelTag.current = heute.getTime();
    const tag = tagVonDatum(heuteIso, minDate);
    const aktive = await dreiDZustandAufTagSetzen(api, sim!.tasks, minDate, tag, true);
    setHeuteLaeuft(false);
    setHeuteErgebnis(aktive.length > 0 ? `${aktive.length} Task${aktive.length === 1 ? "" : "s"} aktiv am ${heute.toLocaleDateString("de-CH")}` : `Keine aktiven Tasks am ${heute.toLocaleDateString("de-CH")}`);
  }

  if (zeilen.length === 0) {
    return (
      <div style={{ padding: 14, fontSize: 12, color: "var(--tc-text-3)" }}>
        Noch keine Kosten — im Tab Kalkulation Bauteil-Kürzel und Mengen erfassen (Stammdaten mit CHF/Einheit hinterlegt in Tab Ressourcen).
      </div>
    );
  }

  return (
    <div style={{ padding: 14, fontSize: 12 }}>
      <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        <StatTile label="Gesamtkosten" wert={`${fmtChf(gesamt)} CHF`} />
        <StatTile label="Kosten heute" wert={`${fmtChf(kostenHeute)} CHF`} sub={heute.toLocaleDateString("de-CH")} />
        <StatTile label="Tasks mit Kosten" wert={`${tasksMitKosten}/${gesamtTaskAnzahl}`} />
        {topEintrag && (
          <StatTile label="Größte Kostenposition" wert={`${topEintrag[0]} · ${topAnteilProzent.toFixed(0)}%`} sub={topEintrag[1].bezeichnung} />
        )}
      </div>

      {api && minDate && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
          <button className="tc-btn-secondary" style={{ fontSize: 11, padding: "5px 10px" }} disabled={heuteLaeuft} onClick={heuteIm3dZeigen}
            title="Zeigt den Baufortschritt von heute im 3D-Modell und markiert heute im Kosten-Diagramm">
            {heuteLaeuft ? "Wird aktualisiert…" : "Heute im 3D-Modell zeigen"}
          </button>
          {heuteErgebnis && <span style={{ fontSize: 10, color: "var(--tc-text-3)" }}>{heuteErgebnis}</span>}
        </div>
      )}

      {gewerkeMitKosten.length > 0 && (
        <CockpitAbschnitt titel="Kosten je Gewerk" eingeklappt={!!eingeklappt["gewerk"]} onToggle={() => toggleEingeklappt("gewerk")}>
          <CategoryBarChart einheit="CHF" formatWert={fmtChf}
            kategorien={gewerkeMitKosten.map(([key]) => stammdaten.gewerke.find(g => g.key === key)?.label ?? key)}
            serien={[{ key: "kosten", label: "Kosten", color: FARBEN.kategorial[0], werte: gewerkeMitKosten.map(([, v]) => v) }]} />
        </CockpitAbschnitt>
      )}

      {ertrag.length > 0 && (
        <CockpitAbschnitt titel="Kosten kumuliert" eingeklappt={!!eingeklappt["kumuliert"]} onToggle={() => toggleEingeklappt("kumuliert")}>
          <TimeSeriesChart tage={ertrag.map(e => e.tag)} einheit="CHF" formatWert={fmtChf} modus="linie"
            markerIdx={heuteIdx >= 0 ? heuteIdx : null}
            serien={[{ key: "kosten", label: "Kosten (kumuliert)", color: FARBEN.kategorial[0], werte: ertrag.map(e => e.kostenKum) }]} />
        </CockpitAbschnitt>
      )}

      <div style={{ display: "flex", gap: 6, fontSize: 9, color: "var(--tc-text-3)", padding: "4px 0", fontWeight: 600, position: "sticky", top: 0, background: "#fff", zIndex: 3 }}>
        <span style={{ width: 60 }}>Kürzel</span>
        <span style={{ flex: 1 }}>Bezeichnung</span>
        <span style={{ width: 50, textAlign: "right" }}>Tasks</span>
        <span style={{ width: 100, textAlign: "right" }}>Summe CHF</span>
      </div>
      {zeilen.map(([kuerzel, e]) => (
        <div key={kuerzel} style={{ display: "flex", alignItems: "center", gap: 6, padding: "5px 0", borderBottom: "1px solid var(--tc-border-light)" }}>
          <span style={{ width: 60, fontWeight: 600 }}>{kuerzel}</span>
          <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{e.bezeichnung}</span>
          <span style={{ width: 50, textAlign: "right", color: "#888" }}>{e.anzahl}</span>
          <span style={{ width: 100, textAlign: "right" }}>{fmtChf(e.summe)}</span>
        </div>
      ))}
      <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 0 0", fontWeight: 700 }}>
        <span style={{ flex: 1, textAlign: "right" }}>Gesamt</span>
        <span style={{ width: 100, textAlign: "right" }}>{fmtChf(gesamt)}</span>
      </div>
    </div>
  );
}
