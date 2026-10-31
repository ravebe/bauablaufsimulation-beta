// GruppenReihenfolgeEditor.tsx — Tab Ressourcen → Bauablauf → 2. Reihenfolge der Gruppen und Bauteilarten: Stufen (Gruppenebenen des
// Gantts, Bauteilart) ein-/ausschalten und ordnen, je Stufe die Werte ordnen (ziehen oder ‹ ›). Was vorne steht, bekommt beim
// Optimieren «Nach Gruppen» zuerst Personal; die Werte einer Gruppenebene gelten zugleich als unten → oben für «Gruppe darunter».
import { useState } from "react";
import type { GruppenReihenfolge, PrioStufe } from "../types";
import type { Stammdaten } from "./stammdatenHelpers";
import { stufenTitel, wertTitel } from "./gruppenReihenfolge";

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
    <div style={{ padding: "6px 10px 8px", background: "#fff", border: "1px solid var(--tc-border-light)", fontSize: 11 }}>
      <div style={{ color: "var(--tc-text-3)", marginBottom: 2 }}>Werte ziehen oder mit ‹ › verschieben, Stufen mit ▲ ▼ ordnen, Haken = Stufe beim Optimieren
        berücksichtigen. <b>weich</b> = Vorrang beim Personal (mit Reihenfolge «Nach Gruppen»), <b>fest</b> = ein Wert beginnt erst, wenn alle
        vorderen fertig sind (Gruppenebene: innerhalb derselben Gruppen darüber, z.B. EG erst nach dem ganzen UG derselben Etappe).</div>
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
            <span style={{ display: "inline-flex", marginLeft: 8 }}>
              {([[false, "weich", "Vorrang beim Personal: wer weiter vorne steht, bekommt zuerst Leute (mit Reihenfolge «Nach Gruppen»); andere dürfen gleichzeitig arbeiten"],
                [true, "fest", s.quelle === "kuerzel"
                  ? "Fest: eine Bauteilart beginnt erst, wenn alle vorderen Bauteilarten derselben Gruppen fertig sind — sehr streng (keine Bauteilarten parallel), meist ist «weich» besser"
                  : "Fest: eine Gruppe beginnt erst, wenn alle Tasks der vorderen Gruppen fertig sind (innerhalb derselben Gruppen darüber, z.B. EG erst nach dem ganzen UG derselben Etappe)"]] as const).map(([streng, label, title]) => (
                <button key={label} type="button" title={title} onClick={() => stufeSetzen(si, { ...s, streng: streng || undefined })}
                  style={{ ...knopf, padding: "0 6px", fontWeight: !!s.streng === streng ? 700 : 400,
                    background: !!s.streng === streng ? (streng ? "#fdf1ee" : "var(--tc-blue-bg)") : "#fff",
                    color: !!s.streng === streng ? (streng ? "#b5452b" : "var(--tc-blue)") : "var(--tc-text-3)",
                    borderColor: !!s.streng === streng ? (streng ? "#e3b3a6" : "var(--tc-blue)") : "var(--tc-border)" }}>{label}</button>
              ))}
            </span>
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 3, paddingLeft: 18 }}>
            {s.werte.map((w, wi) => (
              <span key={w} draggable
                onDragStart={() => setZiehe({ si, wi })}
                onDragOver={e => { if (ziehe?.si === si) e.preventDefault(); }}
                onDrop={e => { e.preventDefault(); if (ziehe?.si === si) stufeSetzen(si, { ...s, werte: verschieben(s.werte, ziehe.wi, wi) }); setZiehe(null); }}
                onDragEnd={() => setZiehe(null)}
                title={wertTitel(s, w, stammdaten)}
                style={{ display: "inline-flex", alignItems: "center", gap: 3, padding: "1px 4px", background: "#fff", cursor: "grab",
                  border: `1px solid ${ziehe?.si === si && ziehe.wi === wi ? "var(--tc-blue)" : "var(--tc-border)"}`, whiteSpace: "nowrap" }}>
                <button type="button" style={{ ...knopf, border: "none", padding: 0 }} disabled={wi === 0} title="Nach vorne"
                  onClick={() => stufeSetzen(si, { ...s, werte: verschieben(s.werte, wi, wi - 1) })}>‹</button>
                <span style={{ color: "var(--tc-text-3)" }}>{wi + 1}.</span> {w}
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
