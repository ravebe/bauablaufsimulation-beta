// GruppenReihenfolgeEditor.tsx — Dialog "Auslastung optimieren" → Reihenfolge «Nach Gruppen»: Stufen (Gruppenebenen des Gantts,
// Bauteilart) ein-/ausschalten und ordnen, je Stufe die Werte ordnen (ziehen oder ‹ ›). Was vorne steht, bekommt zuerst Personal.
import { useState } from "react";
import type { GruppenReihenfolge, PrioStufe } from "../types";
import type { Stammdaten } from "./stammdatenHelpers";
import { stufenTitel, wertLabel } from "./gruppenReihenfolge";
import Hinweis from "./Hinweis";

const verschieben = <T,>(liste: T[], von: number, nach: number): T[] => {
  if (nach < 0 || nach >= liste.length || von === nach) return liste;
  const neu = [...liste];
  const [x] = neu.splice(von, 1);
  neu.splice(nach, 0, x);
  return neu;
};

const knopf: React.CSSProperties = { border: "1px solid var(--tc-border)", background: "#fff", cursor: "pointer", fontSize: 10, padding: "0 4px", lineHeight: "16px", color: "var(--tc-text-2)" };

export default function GruppenReihenfolgeEditor({ wert, stammdaten, onChange }: { wert: GruppenReihenfolge; stammdaten: Stammdaten; onChange: (neu: GruppenReihenfolge) => void }) {
  const [ziehe, setZiehe] = useState<{ si: number; wi: number } | null>(null);
  const stufeSetzen = (si: number, s: PrioStufe) => onChange({ stufen: wert.stufen.map((x, i) => i === si ? s : x) });

  if (wert.stufen.length === 0) {
    return <div style={{ marginTop: 6, fontSize: 11, color: "var(--tc-text-3)" }}>Das Gantt hat noch keine Gruppen und keine Bauteil-Kürzel — es gilt der kritische Pfad.</div>;
  }
  return (
    <div style={{ marginTop: 6, padding: "8px 10px", background: "#fff", border: "1px solid var(--tc-border-light)", fontSize: 11 }}>
      <Hinweis>
        Wer weiter vorne steht, bekommt zuerst Personal — Stufe für Stufe von oben nach unten (z.B. zuerst Etappe, dann Geschoss, dann
        Bauteilart), bei Gleichstand der kritische Pfad. Weich: ist in der vorderen Gruppe gerade nichts möglich (Vorgänger, Wartetage,
        Kran), arbeiten die Leute schon in der nächsten — so gehen sie von selbst zur nächsten Bauteilart, ins nächste Geschoss oder in
        die nächste Etappe, sobald sie keine Arbeit mehr haben. Gleichnamige Gruppen zählen gleich (z.B. «UG» in jeder Etappe). Tasks
        ausserhalb der Gruppen (z.B. Magerbetonsohle zuoberst) kommen zuerst. Werte ziehen oder mit ‹ › verschieben.
      </Hinweis>
      {wert.stufen.map((s, si) => (
        <div key={`${s.quelle}-${s.ebene ?? ""}`} style={{ marginTop: 6, opacity: s.aktiv ? 1 : 0.5 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <input type="checkbox" checked={s.aktiv} onChange={e => stufeSetzen(si, { ...s, aktiv: e.target.checked })}
              title="Stufe berücksichtigen" style={{ margin: 0 }} />
            <span style={{ fontWeight: 600, minWidth: 104 }}>{si + 1}. {stufenTitel(s)}</span>
            <button type="button" style={knopf} disabled={si === 0} title="Stufe nach oben (zählt früher)"
              onClick={() => onChange({ stufen: verschieben(wert.stufen, si, si - 1) })}>▲</button>
            <button type="button" style={knopf} disabled={si === wert.stufen.length - 1} title="Stufe nach unten"
              onClick={() => onChange({ stufen: verschieben(wert.stufen, si, si + 1) })}>▼</button>
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 3, paddingLeft: 18 }}>
            {s.werte.map((w, wi) => (
              <span key={w} draggable
                onDragStart={() => setZiehe({ si, wi })}
                onDragOver={e => { if (ziehe?.si === si) e.preventDefault(); }}
                onDrop={e => { e.preventDefault(); if (ziehe?.si === si) stufeSetzen(si, { ...s, werte: verschieben(s.werte, ziehe.wi, wi) }); setZiehe(null); }}
                onDragEnd={() => setZiehe(null)}
                title="Ziehen, um die Reihenfolge zu ändern"
                style={{ display: "inline-flex", alignItems: "center", gap: 3, padding: "1px 4px", background: "#fff", cursor: "grab",
                  border: `1px solid ${ziehe?.si === si && ziehe.wi === wi ? "var(--tc-blue)" : "var(--tc-border)"}`, whiteSpace: "nowrap" }}>
                <button type="button" style={{ ...knopf, border: "none", padding: 0 }} disabled={wi === 0} title="Nach vorne"
                  onClick={() => stufeSetzen(si, { ...s, werte: verschieben(s.werte, wi, wi - 1) })}>‹</button>
                <span style={{ color: "var(--tc-text-3)" }}>{wi + 1}.</span> {wertLabel(s, w, stammdaten)}
                <button type="button" style={{ ...knopf, border: "none", padding: 0 }} disabled={wi === s.werte.length - 1} title="Nach hinten"
                  onClick={() => stufeSetzen(si, { ...s, werte: verschieben(s.werte, wi, wi + 1) })}>›</button>
              </span>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
