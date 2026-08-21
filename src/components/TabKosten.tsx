// TabKosten.tsx — Kosten-Auswertung aus den Mengen×Stammdaten-Raten je Task, aggregiert nach
// Bauteil-Kürzel. Rein lesend, keine Eingabe (Mengen/Kürzel werden im Tab Kalkulation gepflegt).
import type { SimProjekt } from "../types";
import { istGruppe } from "../types";
import { LEERE_STAMMDATEN, kostenTask } from "./stammdatenHelpers";

interface Props { sim: SimProjekt | null; }

function fmtChf(n: number): string {
  return n.toLocaleString("de-CH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default function TabKosten({ sim }: Props) {
  if (!sim) return <div style={{ padding: 14, fontSize: 12, color: "var(--tc-text-3)" }}>Kein aktives Projekt ausgewählt</div>;

  const stammdaten = sim.stammdaten ?? LEERE_STAMMDATEN;
  const proKuerzel = new Map<string, { summe: number; anzahl: number; bezeichnung: string }>();
  let gesamt = 0;

  sim.tasks.forEach((t, i) => {
    if (t.isGroup || istGruppe(sim.tasks, i) || !t.bauteilKuerzel) return;
    const kosten = kostenTask(t, stammdaten);
    if (kosten <= 0) return;
    gesamt += kosten;
    const bezeichnung = stammdaten.gewerke.flatMap(g => g.raten).find(r => r.kuerzel === t.bauteilKuerzel)?.bezeichnung ?? t.bauteilKuerzel;
    const eintrag = proKuerzel.get(t.bauteilKuerzel) ?? { summe: 0, anzahl: 0, bezeichnung };
    eintrag.summe += kosten;
    eintrag.anzahl += 1;
    proKuerzel.set(t.bauteilKuerzel, eintrag);
  });

  const zeilen = [...proKuerzel.entries()].sort((a, b) => b[1].summe - a[1].summe);

  if (zeilen.length === 0) {
    return (
      <div style={{ padding: 14, fontSize: 12, color: "var(--tc-text-3)" }}>
        Noch keine Kosten — im Tab Kalkulation Bauteil-Kürzel und Mengen erfassen (Stammdaten mit CHF/Einheit hinterlegt in Tab Ressourcen).
      </div>
    );
  }

  return (
    <div style={{ padding: 14, fontSize: 12 }}>
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
