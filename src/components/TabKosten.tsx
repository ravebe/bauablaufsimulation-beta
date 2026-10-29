// TabKosten.tsx — Ertrag, Lohnkosten und Marge aus den Mengen × Stammdaten-Raten je Task, gruppiert nach Gewerk und
// Bauteil-Kürzel. Rein lesend, keine Eingabe (Mengen/Kürzel werden im Tab Kalkulation gepflegt).
//  - Ertrag     = Menge × Einheitspreis (Tab Ressourcen "Einheitspreis [CHF/Einh.]")
//  - Lohnkosten = Menge × Leistungswert × Lohnansatz (Tab Ressourcen "Lohnansatz [CHF/h]")
//  - Marge      = Ertrag − Lohnkosten
// Siehe ertragUndLohnJeGewerk() in stammdatenHelpers.ts und ertragsoptik() in avorHelpers.ts (Verlauf über die Zeit).
import { useState } from "react";
import type { SimProjekt } from "../types";
import { istGruppe, parseDateUniversal } from "../types";
import type { ApiInstance } from "../hooks/useApi";
import { LEERER_KALENDER } from "./kalenderHelpers";
import { LEERE_STAMMDATEN, ertragUndLohnJeGewerk } from "./stammdatenHelpers";
import { ertragsoptik } from "./avorHelpers";
import { dreiDZustandAufTagSetzen, tagVonDatum } from "./dreiDHeuteHelper";
import { StatTile, CategoryBarChart, TimeSeriesChart, CockpitAbschnitt, useEingeklappt, FARBEN } from "./cockpitCharts";

interface Props { sim: SimProjekt | null; projectId?: string | null; api?: ApiInstance | null; sharedNadelTag?: React.MutableRefObject<number>; }

import { fmtZahlFix2 } from "./zahlFormat";
// Tab Kosten: Beträge und Prozente immer mit genau 2 Nachkommastellen
const fmtChf = fmtZahlFix2;

type Summe = { ertrag: number; lohnkosten: number };
const LEER: Summe = { ertrag: 0, lohnkosten: 0 };
const plus = (a: Summe, b: Summe): Summe => ({ ertrag: a.ertrag + b.ertrag, lohnkosten: a.lohnkosten + b.lohnkosten });

function heuteIsoUndDatum(): { iso: string; datum: Date } {
  const datum = new Date();
  datum.setHours(0, 0, 0, 0);
  const iso = `${datum.getFullYear()}-${String(datum.getMonth() + 1).padStart(2, "0")}-${String(datum.getDate()).padStart(2, "0")}`;
  return { iso, datum };
}

export default function TabKosten({ sim, projectId = null, api, sharedNadelTag }: Props) {
  const { eingeklappt, toggle: toggleEingeklappt } = useEingeklappt(projectId, "kosten");
  // null = Stammdaten-Reihenfolge (wie Tab Ressourcen), sonst höchster/niedrigster Ertrag zuoberst —
  // sortiert sowohl die Gewerk-Gruppen (nach Gesamtsumme) als auch die Kürzel-Zeilen darin.
  const [kostenSortRichtung, setKostenSortRichtung] = useState<"desc" | "asc" | null>(null);
  // Klick ins kumulierte Diagramm setzt eine Tages-Markierung und springt — wie in Tab AVOR —
  // im 3D-Modell auf diesen Tag. Ohne Auswahl markiert das Diagramm weiterhin "Heute".
  const [ausgewaehlterTag, setAusgewaehlterTag] = useState<number | null>(null);
  const [klickErgebnis, setKlickErgebnis] = useState<string | null>(null);

  if (!sim) return <div style={{ padding: 14, fontSize: 12, color: "var(--tc-text-3)" }}>Kein aktives Projekt ausgewählt</div>;

  const stammdaten = sim.stammdaten ?? LEERE_STAMMDATEN;
  const kalender = sim.kalender ?? LEERER_KALENDER;

  // Summen je Gewerk und je (Gewerk, Kürzel) — anzahl = Tasks mit Menge in diesem Gewerk
  const jeGewerk = new Map<string, Summe>();
  const jeGewerkKuerzel = new Map<string, Summe & { anzahl: number }>();
  let gesamt: Summe = LEER;
  sim.tasks.forEach((t, i) => {
    if (t.isGroup || istGruppe(sim.tasks, i) || !t.bauteilKuerzel) return;
    for (const [gewerkKey, w] of ertragUndLohnJeGewerk(t, stammdaten)) {
      gesamt = plus(gesamt, w);
      jeGewerk.set(gewerkKey, plus(jeGewerk.get(gewerkKey) ?? LEER, w));
      const key = `${gewerkKey}::${t.bauteilKuerzel}`;
      const bisher = jeGewerkKuerzel.get(key) ?? { ...LEER, anzahl: 0 };
      jeGewerkKuerzel.set(key, { ...plus(bisher, w), anzahl: bisher.anzahl + 1 });
    }
  });
  const marge = gesamt.ertrag - gesamt.lohnkosten;
  const margeProzent = gesamt.ertrag > 0 ? (marge / gesamt.ertrag) * 100 : 0;
  const lohnansatz = stammdaten.umsatzChfProMannstunde ?? 80;

  const gewerkeMitWerten = stammdaten.gewerke.filter(g => { const s = jeGewerk.get(g.key); return s && (s.ertrag > 0 || s.lohnkosten > 0); });
  const ertrag = ertragsoptik(sim.tasks, stammdaten, kalender);

  // Gruppierte Liste unten — wie Tab Ressourcen: jede Kategorie mit Titel + Summen, darunter JEDES dort konfigurierte
  // Kürzel, auch wenn (noch) keine Menge erfasst ist. Ein Kürzel mit Raten in mehreren Gewerken (z.B. "WB" in Schalung
  // UND Beton) erscheint bewusst mehrfach — je Gewerk mit dem dortigen Teilbetrag.
  const gewerkeGruppiert = stammdaten.gewerke.filter(g => g.raten.length > 0).map(g => ({
    g,
    summe: jeGewerk.get(g.key) ?? LEER,
    raten: g.raten.map(r => ({ r, ...(jeGewerkKuerzel.get(`${g.key}::${r.kuerzel}`) ?? { ...LEER, anzahl: 0 }) })),
  }));
  const gewerkeAnzeige = !kostenSortRichtung ? gewerkeGruppiert : (() => {
    const richt = kostenSortRichtung === "desc" ? -1 : 1;
    return [...gewerkeGruppiert]
      .map(e => ({ ...e, raten: [...e.raten].sort((a, b) => (a.ertrag - b.ertrag) * richt) }))
      .sort((a, b) => (a.summe.ertrag - b.summe.ertrag) * richt);
  })();

  // "Heute"-Bezug: Position im kumulierten Verlauf + 3D-Baufortschritt von heute.
  const { iso: heuteIso, datum: heute } = heuteIsoUndDatum();
  const heuteIdxRoh = ertrag.findIndex(e => e.tag === heuteIso);
  const vorProjektstart = ertrag.length > 0 && heuteIso < ertrag[0].tag;
  const heuteIdx = heuteIdxRoh >= 0 ? heuteIdxRoh : (vorProjektstart ? -1 : ertrag.length - 1);
  const ertragHeute = heuteIdx >= 0 ? ertrag[heuteIdx].ertragKum : 0;
  const lohnHeute = heuteIdx >= 0 ? ertrag[heuteIdx].kostenKum : 0;

  const allStarts = sim.tasks.map(t => parseDateUniversal(t.start)).filter((d): d is Date => !!d);
  const minDate = allStarts.length > 0 ? new Date(Math.min(...allStarts.map(d => d.getTime()))) : null;

  const aktiverMarkerIdx = ausgewaehlterTag ?? (heuteIdx >= 0 ? heuteIdx : null);
  const ausgewaehltesDatumIso = ausgewaehlterTag != null ? ertrag[ausgewaehlterTag]?.tag ?? null : null;
  const aktivesMarkerLabel = ausgewaehltesDatumIso
    ? (parseDateUniversal(ausgewaehltesDatumIso)?.toLocaleDateString("de-CH") ?? ausgewaehltesDatumIso)
    : "Heute";

  // Klick ins kumulierte Diagramm: Markierung setzen, "geteilte Nadel" (siehe App.tsx) für
  // andere Tabs synchron halten und — falls ein Modell verbunden ist — den 3D-Zustand auf diesen Tag
  // springen, genau wie onChartTagKlick in Tab AVOR.
  async function onChartTagKlick(iso: string, idx: number) {
    setAusgewaehlterTag(idx);
    setKlickErgebnis(null);
    const datum = parseDateUniversal(iso);
    if (sharedNadelTag && datum) sharedNadelTag.current = datum.getTime();
    if (!api || !minDate) return;
    const tag = tagVonDatum(iso, minDate);
    const aktive = await dreiDZustandAufTagSetzen(api, sim!.tasks, minDate, tag, true, (sim!.ausgeschlossen ?? []).map(a => a.guid));
    setKlickErgebnis(aktive.length > 0 ? `${aktive.length} Task${aktive.length === 1 ? "" : "s"} aktiv` : "Keine aktiven Tasks");
  }

  if (stammdaten.gewerke.length === 0) {
    return (
      <div style={{ padding: 14, fontSize: 12, color: "var(--tc-text-3)" }}>
        Noch keine Werte — im Tab Ressourcen zuerst Kategorien/Leistungspositionen mit Einheitspreis und Leistungswert anlegen, dann in Tab Kalkulation Leistungsposition und Mengen erfassen.
      </div>
    );
  }

  const spalte = (breite: number): React.CSSProperties => ({ width: breite, textAlign: "right", flexShrink: 0 });
  const margeFarbe = (m: number) => m < 0 ? "var(--tc-red)" : undefined;

  return (
    <div style={{ padding: 14, fontSize: 12 }}>
      <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        <StatTile label="Ertrag" title={"Summe über alle Tasks und Gewerke: Menge × Einheitspreis (CHF/Einh. aus Tab Ressourcen)."} wert={`${fmtChf(gesamt.ertrag)} CHF`} sub="Menge × Einheitspreis" />
        <StatTile label="Lohnkosten" title={"Summe über alle Tasks und Gewerke: Personenstunden (Menge × Leistungswert) × Umsatz CHF/Mannstunde aus Tab Ressourcen."} wert={`${fmtChf(gesamt.lohnkosten)} CHF`} sub={`Personenstunden × ${fmtChf(lohnansatz)} CHF/h`} />
        <StatTile label="Marge" title={"Ertrag minus Lohnkosten über das ganze Projekt, in Prozent vom Ertrag."} wert={`${fmtChf(marge)} CHF`} sub={`${fmtZahlFix2(margeProzent)} % vom Ertrag`} status={marge >= 0 ? "good" : "critical"} />
        <StatTile label="Stand heute" title={"Marge der bis heute (laut Gantt) ausgeführten Arbeiten: kumulierter Ertrag minus kumulierte Lohnkosten bis zum heutigen Tag."} wert={`${fmtChf(ertragHeute - lohnHeute)} CHF`}
          sub={`${heute.toLocaleDateString("de-CH")} · Ertrag ${fmtChf(ertragHeute)} − Lohn ${fmtChf(lohnHeute)}`} />
      </div>

      {ausgewaehltesDatumIso && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12, fontSize: 11, color: "var(--tc-text-3)" }}>
          <span>📍 {aktivesMarkerLabel}{!api && " — Klick ins Diagramm springt zu diesem Tag, aber es ist kein 3D-Modell verbunden"}{klickErgebnis && api ? ` — ${klickErgebnis}` : ""}</span>
        </div>
      )}

      {gewerkeMitWerten.length > 0 && (
        <CockpitAbschnitt titel="Ertrag, Lohnkosten und Marge je Gewerk" eingeklappt={!!eingeklappt["gewerk"]} onToggle={() => toggleEingeklappt("gewerk")}>
          <CategoryBarChart einheit="CHF" formatWert={fmtChf}
            kategorien={gewerkeMitWerten.map(g => g.label || g.key)}
            serien={[
              { key: "ertrag", label: "Ertrag", color: FARBEN.kategorial[0], werte: gewerkeMitWerten.map(g => jeGewerk.get(g.key)!.ertrag) },
              { key: "lohn", label: "Lohnkosten", color: FARBEN.kategorial[1], werte: gewerkeMitWerten.map(g => jeGewerk.get(g.key)!.lohnkosten) },
              { key: "marge", label: "Marge", color: FARBEN.kategorial[2], werte: gewerkeMitWerten.map(g => jeGewerk.get(g.key)!.ertrag - jeGewerk.get(g.key)!.lohnkosten) },
            ]} />
        </CockpitAbschnitt>
      )}

      {ertrag.length > 0 && (
        <CockpitAbschnitt titel="Ertrag, Lohnkosten und Marge kumuliert" eingeklappt={!!eingeklappt["kumuliert"]} onToggle={() => toggleEingeklappt("kumuliert")}>
          <TimeSeriesChart tage={ertrag.map(e => e.tag)} einheit="CHF" formatWert={fmtChf} modus="linie"
            markerIdx={aktiverMarkerIdx} markerLabel={aktivesMarkerLabel} onTagKlick={onChartTagKlick}
            serien={[
              { key: "ertrag", label: "Ertrag (kumuliert)", color: FARBEN.kategorial[0], werte: ertrag.map(e => e.ertragKum) },
              { key: "lohn", label: "Lohnkosten (kumuliert)", color: FARBEN.kategorial[1], werte: ertrag.map(e => e.kostenKum) },
              { key: "marge", label: "Marge (kumuliert)", color: FARBEN.kategorial[2], werte: ertrag.map(e => e.ertragKum - e.kostenKum) },
            ]} />
        </CockpitAbschnitt>
      )}

      <div style={{ display: "flex", gap: 6, fontSize: 9, color: "var(--tc-text-3)", padding: "4px 0", fontWeight: 600, position: "sticky", top: 0, background: "#fff", zIndex: 3 }}>
        <span style={{ width: 110, flexShrink: 0 }}>Leistungsposition</span>
        <span style={{ flex: 1, minWidth: 0 }}>Bezeichnung</span>
        <span style={{ ...spalte(100), display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 3, cursor: "pointer", userSelect: "none" }}
          onClick={() => setKostenSortRichtung(r => r === "desc" ? "asc" : r === "asc" ? null : "desc")}
          title="Nach Ertrag sortieren (höchster zuoberst)">
          Ertrag CHF
          {kostenSortRichtung && <span style={{ fontSize: 8 }}>{kostenSortRichtung === "desc" ? "▼" : "▲"}</span>}
        </span>
        <span style={spalte(100)}>Lohnkosten CHF</span>
        <span style={spalte(100)}>Marge CHF</span>
      </div>
      {gewerkeAnzeige.map(({ g, summe, raten }) => (
        <div key={g.key} style={{ marginBottom: 10 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "6px 0 3px", fontWeight: 700, fontSize: 12, borderBottom: "1px solid var(--tc-border)" }}>
            <span style={{ flex: 1, minWidth: 0 }}>{g.label || "(ohne Namen)"}</span>
            <span style={spalte(100)}>{fmtChf(summe.ertrag)}</span>
            <span style={spalte(100)}>{fmtChf(summe.lohnkosten)}</span>
            <span style={{ ...spalte(100), color: margeFarbe(summe.ertrag - summe.lohnkosten) }}>{fmtChf(summe.ertrag - summe.lohnkosten)}</span>
          </div>
          {raten.map(({ r, ertrag: e, lohnkosten: l, anzahl }) => {
            const leer = anzahl === 0;
            return (
              <div key={r.kuerzel} style={{ display: "flex", alignItems: "center", gap: 6, padding: "5px 0", borderBottom: "1px solid var(--tc-border-light)", color: leer ? "#aaa" : undefined }}>
                <span style={{ width: 110, flexShrink: 0, fontWeight: 600 }}>{r.kuerzel}</span>
                <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.bezeichnung}</span>
                <span style={spalte(100)}>{fmtChf(e)}</span>
                <span style={spalte(100)}>{fmtChf(l)}</span>
                <span style={{ ...spalte(100), color: leer ? undefined : margeFarbe(e - l) }}>{fmtChf(e - l)}</span>
              </div>
            );
          })}
        </div>
      ))}
      <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 0 0", fontWeight: 700 }}>
        <span style={{ flex: 1, textAlign: "right" }}>Gesamt</span>
        <span style={spalte(100)}>{fmtChf(gesamt.ertrag)}</span>
        <span style={spalte(100)}>{fmtChf(gesamt.lohnkosten)}</span>
        <span style={{ ...spalte(100), color: margeFarbe(marge) }}>{fmtChf(marge)}</span>
      </div>
    </div>
  );
}
