// TabKosten.tsx — Kosten-Auswertung aus den Mengen×Stammdaten-Raten je Task, aggregiert nach
// Bauteil-Kürzel. Rein lesend, keine Eingabe (Mengen/Kürzel werden im Tab Kalkulation gepflegt).
import type { SimProjekt } from "../types";
import { istGruppe } from "../types";
import { LEERER_KALENDER } from "./kalenderHelpers";
import { LEERE_STAMMDATEN, kostenTask } from "./stammdatenHelpers";
import { ertragsoptik } from "./avorHelpers";
import { StatTile, CategoryBarChart, TimeSeriesChart, FARBEN } from "./cockpitCharts";

interface Props { sim: SimProjekt | null; }

function fmtChf(n: number): string {
  return n.toLocaleString("de-CH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default function TabKosten({ sim }: Props) {
  if (!sim) return <div style={{ padding: 14, fontSize: 12, color: "var(--tc-text-3)" }}>Kein aktives Projekt ausgewählt</div>;

  const stammdaten = sim.stammdaten ?? LEERE_STAMMDATEN;
  const kalender = sim.kalender ?? LEERER_KALENDER;
  const proKuerzel = new Map<string, { summe: number; anzahl: number; bezeichnung: string }>();
  const kostenProGewerk = new Map<string, number>();
  let gesamt = 0, tasksMitKosten = 0;

  sim.tasks.forEach((t, i) => {
    if (t.isGroup || istGruppe(sim.tasks, i) || !t.bauteilKuerzel || !t.mengen) return;
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
        <StatTile label="Tasks mit Kosten" wert={String(tasksMitKosten)} />
        <StatTile label="Ø Kosten/Task" wert={`${fmtChf(tasksMitKosten > 0 ? gesamt / tasksMitKosten : 0)} CHF`} />
      </div>

      {gewerkeMitKosten.length > 0 && (
        <div style={{ marginBottom: 20 }}>
          <div style={{ fontSize: 10, fontWeight: 600, color: "var(--tc-text-3)", letterSpacing: ".5px", marginBottom: 6 }}>KOSTEN JE GEWERK</div>
          <CategoryBarChart einheit="CHF" formatWert={fmtChf}
            kategorien={gewerkeMitKosten.map(([key]) => stammdaten.gewerke.find(g => g.key === key)?.label ?? key)}
            serien={[{ key: "kosten", label: "Kosten", color: FARBEN.kategorial[0], werte: gewerkeMitKosten.map(([, v]) => v) }]} />
        </div>
      )}

      {ertrag.length > 0 && (
        <div style={{ marginBottom: 20 }}>
          <div style={{ fontSize: 10, fontWeight: 600, color: "var(--tc-text-3)", letterSpacing: ".5px", marginBottom: 6 }}>KOSTEN KUMULIERT</div>
          <TimeSeriesChart tage={ertrag.map(e => e.tag)} einheit="CHF" formatWert={fmtChf} modus="linie"
            serien={[{ key: "kosten", label: "Kosten (kumuliert)", color: FARBEN.kategorial[0], werte: ertrag.map(e => e.kostenKum) }]} />
        </div>
      )}

      <div style={{ display: "flex", gap: 6, fontSize: 9, color: "var(--tc-text-3)", padding: "0 0 4px", fontWeight: 600 }}>
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
