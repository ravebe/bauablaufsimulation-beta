// ZugriffskontrollManager.tsx — UI-Mockup im Organizer-Design (kein echter Datenzugriff/keine echte Durchsetzung).
// Trimble Connect stellt über die Workspace-API keine Connect-Gruppen bereit (nur einzelne Projektmitglieder
// via project.getMembers()) — bis eine echte Datenquelle feststeht, arbeitet dieses Fenster mit Platzhalter-Gruppen.
import { useState } from "react";

interface Zeile { id: string; name: string; zugriff: "edit" | "read" | "none"; }

const OPTIONEN = [
  { key: "edit" as const, label: "Zugriff bearbeiten", icon: "✏", desc: "Inhalt hinzufügen, bearbeiten oder entfernen" },
  { key: "read" as const, label: "Schreibgeschützt", icon: "👁", desc: "Nur Anzeigen von Inhalt" },
  { key: "none" as const, label: "Kein Zugriff", icon: "🚫", desc: "Kein Zugriff auf diese Simulation" },
];

export default function ZugriffskontrollManager({ onClose }: { onClose: () => void }) {
  const [standard, setStandard] = useState<Zeile["zugriff"]>("read");
  const [gruppen, setGruppen] = useState<Zeile[]>([
    { id: "g1", name: "Gruppe A", zugriff: "read" },
    { id: "g2", name: "Gruppe B", zugriff: "none" },
  ]);
  const [offenerDropdown, setOffenerDropdown] = useState<string | null>(null);

  function gruppeHinzufuegen() {
    const buchstabe = String.fromCharCode(65 + gruppen.length);
    setGruppen(g => [...g, { id: `g${g.length + 1}`, name: `Gruppe ${buchstabe}`, zugriff: "none" }]);
  }

  function AccessDropdown({ id, aktuell, onSelect }: { id: string; aktuell: Zeile["zugriff"]; onSelect: (v: Zeile["zugriff"]) => void }) {
    const opt = OPTIONEN.find(o => o.key === aktuell)!;
    return (
      <div style={{ position: "relative" }} onClick={e => e.stopPropagation()}>
        <button className="tc-btn-secondary" style={{ fontSize: 11, padding: "5px 10px", minWidth: 150, justifyContent: "space-between", display: "flex" }}
          onClick={() => setOffenerDropdown(d => d === id ? null : id)}>
          <span>{opt.icon} {opt.label}</span>
          <span>{offenerDropdown === id ? "▲" : "▼"}</span>
        </button>
        {offenerDropdown === id && (
          <div className="tc-header-dropdown" style={{ top: "100%", left: 0, right: "auto", minWidth: 230 }}>
            {OPTIONEN.map(o => (
              <div key={o.key} className={`tc-header-dropdown-item ${aktuell === o.key ? "active" : ""}`}
                onClick={() => { onSelect(o.key); setOffenerDropdown(null); }}>
                <div>
                  <div style={{ fontWeight: 500 }}>{o.icon} {o.label}</div>
                  <div style={{ fontSize: 9, color: "var(--tc-text-3)" }}>{o.desc}</div>
                </div>
                {aktuell === o.key && <span>✓</span>}
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.4)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center" }}
      onClick={onClose}>
      <div style={{ background: "#fff", width: 520, maxWidth: "92vw", maxHeight: "85vh", overflowY: "auto",
        boxShadow: "0 8px 30px rgba(0,0,0,.25)", fontFamily: "var(--tc-font)" }}
        onClick={e => e.stopPropagation()}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 18px", borderBottom: "1px solid var(--tc-border-light)" }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: "var(--tc-text)" }}>Zugriffskontrollmanager</div>
          <button className="tc-btn-ghost" style={{ fontSize: 14, padding: "2px 8px" }} onClick={onClose}>✕</button>
        </div>

        <div style={{ padding: "14px 18px" }}>
          <div style={{ fontSize: 11, color: "var(--tc-text-2)", lineHeight: 1.5, marginBottom: 12 }}>
            Legt fest, welche Gruppen wie auf die 4D-Simulationen dieses Projekts zugreifen dürfen.
            Für eine Gruppe angewendete Zugriffskontrolle setzt den Standardzugriff außer Kraft.
            Ist ein Nutzer in mehreren Gruppen, gilt die am wenigsten einschränkende Regel.
          </div>

          <div style={{ fontSize: 9, fontWeight: 600, color: "var(--tc-text-3)", letterSpacing: ".5px", marginBottom: 6 }}>STANDARDZUGRIFF</div>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 10px",
            border: "1px solid var(--tc-border-light)", marginBottom: 16, background: "var(--tc-bg-hover)" }}>
            <div>
              <div style={{ fontSize: 12, fontWeight: 600 }}>Standardzugriff</div>
              <div style={{ fontSize: 10, color: "var(--tc-text-3)" }}>Alle Projektmitglieder ohne eigene Regel</div>
            </div>
            <AccessDropdown id="standard" aktuell={standard} onSelect={setStandard} />
          </div>

          <div style={{ fontSize: 9, fontWeight: 600, color: "var(--tc-text-3)", letterSpacing: ".5px", marginBottom: 6 }}>ZUGRIFF PRO GRUPPE</div>
          {gruppen.map(g => (
            <div key={g.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 10px",
              borderBottom: "1px solid var(--tc-border-light)" }}>
              <div style={{ fontSize: 12, fontWeight: 500 }}>👥 {g.name}</div>
              <AccessDropdown id={g.id} aktuell={g.zugriff}
                onSelect={v => setGruppen(prev => prev.map(x => x.id === g.id ? { ...x, zugriff: v } : x))} />
            </div>
          ))}

          <button className="tc-btn-secondary" style={{ fontSize: 11, marginTop: 12, padding: "6px 12px" }} onClick={gruppeHinzufuegen}>
            + Zugriffskontrolle für andere Gruppe hinzufügen
          </button>

          <div style={{ fontSize: 9, color: "var(--tc-text-3)", marginTop: 14, fontStyle: "italic" }}>
            Vorschau — Gruppen sind Platzhalter und Einstellungen werden noch nicht gespeichert oder durchgesetzt.
          </div>
        </div>
      </div>
    </div>
  );
}
