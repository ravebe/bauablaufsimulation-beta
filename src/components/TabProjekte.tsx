import { useState } from "react";
import type { SimProjekt } from "../types";
import type { ApiInstance } from "../hooks/useApi";
import GanttImport from "./GanttImport";

interface Props {
  api: ApiInstance | null;
  ready: boolean;
  sims: SimProjekt[];
  setSims: React.Dispatch<React.SetStateAction<SimProjekt[]>>;
  aktivId: string | null;
  setAktivId: (id: string) => void;
  geladeneModelle: { id: string; name: string }[];
}

export default function TabProjekte({ api, sims, setSims, aktivId, setAktivId }: Props) {
  const [aufgeklappt, setAufgeklappt] = useState<string | null>(aktivId);
  const [neuName, setNeuName] = useState("");
  const [zeigeNeu, setZeigeNeu] = useState(false);
  const [menuOffen, setMenuOffen] = useState<string | null>(null);
  const [modellLaden, setModellLaden] = useState(false);
  const [modellMsg, setModellMsg] = useState<{ simId: string; typ: "ok" | "err"; text: string } | null>(null);
  const [modellPicker, setModellPicker] = useState<{
    simId: string;
    alle: { id: string; name: string }[];
    ausgewaehlt: Set<string>;
  } | null>(null);

  function toggleAufgeklappt(id: string) {
    setAufgeklappt(prev => prev === id ? null : id);
    setMenuOffen(null);
  }

  function neuErstellen() {
    if (!neuName.trim()) return;
    const sim: SimProjekt = {
      id: crypto.randomUUID(),
      name: neuName.trim(),
      erstelltAm: new Date().toISOString(),
      tasks: [],
      modelle: [],
    };
    setSims(prev => [sim, ...prev]);
    setAktivId(sim.id);
    setAufgeklappt(sim.id);
    setNeuName("");
    setZeigeNeu(false);
  }

  // Modelle laden → Checkbox-Picker öffnen
  async function modelleUebernehmen(simId: string) {
    setModellLaden(true);
    setModellMsg(null);
    if (!api) {
      setModellMsg({ simId, typ: "err", text: "TC API nicht verbunden" });
      setModellLaden(false);
      return;
    }
    try {
      const alle = await api.viewer.getModels() as any[];
      const alleFormatiert = alle.map((m: any, i: number) => ({
        id: m.modelId || m.id || m.fileId || m.modelVersionId || `model-${i}`,
        name: m.name || m.fileName || m.label || m.modelId || `Modell ${i + 1}`
      }));
  const simModelle = sims.find(s => s.id === simId)?.modelle ?? [];
const vorauswahl = new Set<string>(simModelle.map(m => m.id));
      setModellPicker({ simId, alle: alleFormatiert, ausgewaehlt: vorauswahl });
    } catch (e) {
      setModellMsg({ simId, typ: "err", text: `Fehler: ${e instanceof Error ? e.message : String(e)}` });
    } finally {
      setModellLaden(false);
    }
  }

  // Ausgewählte Modelle aus Picker speichern
  function modellPickerSpeichern() {
    if (!modellPicker) return;
    const ausgewaehlt = modellPicker.alle.filter(m => modellPicker.ausgewaehlt.has(m.id));
    if (ausgewaehlt.length === 0) {
      setModellMsg({ simId: modellPicker.simId, typ: "err", text: "Mindestens 1 Modell auswählen" });
      return;
    }
    setSims(prev => prev.map(s =>
      s.id === modellPicker.simId ? { ...s, modelle: ausgewaehlt } : s
    ));
    setModellMsg({ simId: modellPicker.simId, typ: "ok", text: `✓ ${ausgewaehlt.length} Modelle gespeichert` });
    setModellPicker(null);
  }

  function modellToggle(id: string) {
    if (!modellPicker) return;
    const neu = new Set(modellPicker.ausgewaehlt);
    neu.has(id) ? neu.delete(id) : neu.add(id);
    setModellPicker({ ...modellPicker, ausgewaehlt: neu });
  }

  function loeschen(simId: string) {
    setMenuOffen(null);
    if (!confirm("Simulation wirklich löschen?")) return;
    setSims(prev => prev.filter(s => s.id !== simId));
    if (aktivId === simId) {
      const rest = sims.filter(s => s.id !== simId);
      if (rest.length > 0) setAktivId(rest[0].id);
    }
  }

  const fmt = (iso: string) => {
    try { return new Date(iso).toLocaleDateString("de-DE"); } catch { return iso; }
  };

  return (
    <div className="tc-setup-content" onClick={() => setMenuOffen(null)}>

      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
        <span className="tc-section-label">Simulationen</span>
        <button className="tc-btn-primary" style={{ padding: "4px 12px", fontSize: 10 }}
          onClick={() => setZeigeNeu(v => !v)}>
          + Neu
        </button>
      </div>

      {/* Neue Simulation */}
      {zeigeNeu && (
        <div className="sim-neu-form">
          <input
            className="tc-input"
            placeholder="Name der Simulation…"
            value={neuName}
            onChange={e => setNeuName(e.target.value)}
            onKeyDown={e => e.key === "Enter" && neuErstellen()}
            autoFocus
          />
          <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
            <button className="tc-btn-primary" style={{ flex: 1 }} onClick={neuErstellen}>Erstellen</button>
            <button className="tc-btn-secondary" onClick={() => { setZeigeNeu(false); setNeuName(""); }}>Abbrechen</button>
          </div>
        </div>
      )}

      {/* Leer */}
      {sims.length === 0 && !zeigeNeu && (
        <div className="tc-empty">
          <div className="tc-empty-icon">📊</div>
          <div className="tc-empty-title">Keine Simulationen</div>
          <div className="tc-empty-sub">Klicke + Neu um zu starten</div>
        </div>
      )}

      {/* Sim Liste */}
      {sims.map(sim => {
        const offen = aufgeklappt === sim.id;
        const istAktiv = aktivId === sim.id;

        return (
          <div key={sim.id} className={`sim-card ${istAktiv ? "aktiv" : ""}`}>

            {/* Sim Header */}
            <div className="sim-card-header" onClick={() => toggleAufgeklappt(sim.id)}>
              <div className="sim-card-left">
                <span style={{ fontSize: 18 }}>📊</span>
                <div>
                  <div className="sim-card-name">{sim.name}</div>
                  <div className="sim-card-meta">
                    {fmt(sim.erstelltAm)} · {sim.tasks.length} Tasks
                    {sim.modelle.length > 0 && ` · ${sim.modelle.length} Modell${sim.modelle.length > 1 ? "e" : ""}`}
                  </div>
                </div>
              </div>
              <div className="sim-card-right">
                {istAktiv && <span className="sim-aktiv-badge">Aktiv</span>}
                <div style={{ position: "relative" }} onClick={e => e.stopPropagation()}>
                  <button
                    style={{ background: "none", border: "none", cursor: "pointer", fontSize: 16, color: "var(--tc-text-3)", padding: "0 4px" }}
                    onClick={() => setMenuOffen(prev => prev === sim.id ? null : sim.id)}
                  >⋮</button>
                  {menuOffen === sim.id && (
                    <div style={{
                      position: "absolute", right: 0, top: "100%", background: "white",
                      border: "0.5px solid var(--tc-border)", borderRadius: 5,
                      boxShadow: "0 2px 8px rgba(0,0,0,.12)", zIndex: 100, minWidth: 150,
                    }}>
                      <button
                        style={{ display: "block", width: "100%", padding: "8px 14px", background: "none", border: "none", textAlign: "left", fontSize: 11, color: "var(--tc-red)", cursor: "pointer" }}
                        onClick={() => loeschen(sim.id)}
                      >🗑 Simulation löschen</button>
                    </div>
                  )}
                </div>
                <span className="sim-chevron">{offen ? "▲" : "▼"}</span>
              </div>
            </div>

            {/* Sim Body */}
            {offen && (
              <div className="sim-card-body">
                {!istAktiv && (
                  <button className="tc-btn-primary" style={{ width: "100%", marginBottom: 8 }}
                    onClick={() => setAktivId(sim.id)}>
                    ✓ Als aktive Simulation setzen
                  </button>
                )}

                {/* Gantt */}
                <div className="tc-section-label" style={{ marginBottom: 4 }}>Gantt</div>
                <GanttImport
                  onImport={tasks => setSims(prev =>
                    prev.map(s => s.id === sim.id ? { ...s, tasks } : s)
                  )}
                  taskCount={sim.tasks.length}
                />

                <div className="tc-divider" />

                {/* Modelle */}
                <div className="tc-section-label" style={{ marginBottom: 6 }}>
                  Modelle{sim.modelle.length > 0 ? ` (${sim.modelle.length})` : ""}
                </div>

                {sim.modelle.length > 0 && (
                  <div style={{ marginBottom: 6 }}>
                    {sim.modelle.map(m => (
                      <div key={m.id} className="modell-row">
                        <span>🏗️</span>
                        <div style={{ flex: 1 }}>
                          <div className="modell-name">{m.name}</div>
                          <div className="modell-id">{m.id}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                <button
                  className="tc-btn-secondary"
                  style={{ width: "100%" }}
                  disabled={modellLaden}
                  onClick={e => { e.stopPropagation(); modelleUebernehmen(sim.id); }}
                >
                  {modellLaden ? "⟳ Lade…" : "⟳ Modelle auswählen…"}
                </button>

                {/* Checkbox Picker */}
                {modellPicker?.simId === sim.id && (
                  <div style={{ marginTop: 8, border: "1px solid var(--tc-border)", borderRadius: 6, overflow: "hidden" }} onClick={e => e.stopPropagation()}>
                    <div style={{ padding: "6px 8px", background: "var(--tc-bg-2)", borderBottom: "1px solid var(--tc-border)", fontSize: 10, fontWeight: 600, display: "flex", justifyContent: "space-between" }}>
                      <span>Modelle auswählen ({modellPicker.ausgewaehlt.size} ✓)</span>
                      <button style={{ background: "none", border: "none", cursor: "pointer", fontSize: 10, color: "var(--tc-text-3)" }} onClick={() => setModellPicker(null)}>✕</button>
                    </div>
                    <div style={{ maxHeight: 160, overflowY: "auto" }}>
                      {modellPicker.alle.map(m => (
                        <label key={m.id} style={{ display: "flex", alignItems: "center", gap: 6, padding: "4px 8px", cursor: "pointer", fontSize: 10, borderBottom: "0.5px solid var(--tc-border)" }}>
                          <input type="checkbox"
                            checked={modellPicker.ausgewaehlt.has(m.id)}
                            onChange={() => modellToggle(m.id)}
                          />
                          <span style={{ color: "var(--tc-text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{m.name}</span>
                        </label>
                      ))}
                    </div>
                    <div style={{ padding: 6, display: "flex", gap: 4 }}>
                      <button className="tc-btn-primary" style={{ flex: 1, fontSize: 10 }} onClick={modellPickerSpeichern}>
                        ✓ Speichern ({modellPicker.ausgewaehlt.size})
                      </button>
                      <button className="tc-btn-secondary" style={{ fontSize: 10 }} onClick={() => setModellPicker(null)}>Abbrechen</button>
                    </div>
                  </div>
                )}

                {modellMsg?.simId === sim.id && (
                  <div className={`alert ${modellMsg.typ}`} style={{ marginTop: 6 }}>
                    {modellMsg.typ === "ok" ? "✓" : "!"} {modellMsg.text}
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}