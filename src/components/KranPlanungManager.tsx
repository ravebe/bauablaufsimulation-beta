// KranPlanungManager.tsx — ein Dialog in Tab AVOR, der die beiden bisher getrennten Buttons
// "Kran-Verfügbarkeit" und "Kapazitäts-Check" zu einem zusammenführt: zwei Tabs in sinnvoller
// Reihenfolge — zuerst Kräne anlegen/verfügbar machen (Stammdaten), danach den Kapazitäts-Check, der
// diese Kräne bereits auswertet. Ohne Kräne öffnet der Dialog direkt auf Tab 1, sonst auf Tab 2 (der
// im Alltag häufigere nächste Schritt).
import { useState } from "react";
import type { SimProjekt } from "../types";
import { KranVerfuegbarkeitInhalt } from "./KranVerfuegbarkeitManager";
import { KapazitaetsCheckInhalt } from "./KapazitaetsCheckManager";

interface Props { sim: SimProjekt; updateSim: (s: SimProjekt) => void; readOnly?: boolean; onClose: () => void; }

export default function KranPlanungManager({ sim, updateSim, readOnly, onClose }: Props) {
  const [tab, setTab] = useState<"kraene" | "check">((sim.kraene ?? []).length === 0 ? "kraene" : "check");

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.4)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center" }}
      onClick={onClose}>
      <div style={{ background: "#fff", width: 820, maxWidth: "94vw", maxHeight: "88vh", overflowY: "auto",
        boxShadow: "0 8px 30px rgba(0,0,0,.25)", fontFamily: "var(--tc-font)" }}
        onClick={e => e.stopPropagation()}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 18px 0", borderBottom: "1px solid var(--tc-border-light)" }}>
          <div style={{ display: "flex", gap: 2 }}>
            {([
              { key: "kraene" as const, label: "1. Kräne & Verfügbarkeit" },
              { key: "check" as const, label: "2. Kapazitäts-Check" },
            ]).map(t => (
              <button key={t.key} onClick={() => setTab(t.key)}
                style={{ fontSize: 12, fontWeight: 700, padding: "8px 12px", cursor: "pointer",
                  border: "none", borderBottom: `2px solid ${tab === t.key ? "var(--tc-blue)" : "transparent"}`,
                  background: "none", color: tab === t.key ? "var(--tc-blue)" : "var(--tc-text-2)" }}>
                {t.label}
              </button>
            ))}
          </div>
          <button className="tc-btn-ghost" style={{ fontSize: 14, padding: "2px 8px" }} onClick={onClose}>✕</button>
        </div>

        {tab === "kraene"
          ? <KranVerfuegbarkeitInhalt sim={sim} updateSim={updateSim} readOnly={readOnly} />
          : <KapazitaetsCheckInhalt sim={sim} updateSim={updateSim} readOnly={readOnly} />}
      </div>
    </div>
  );
}
