import { useState } from "react";
import type { SimProjekt } from "../types";
import type { ApiInstance } from "../hooks/useApi";
import GanttImport from "./GanttImport";
import GanttExport from "./GanttExport";
import GanttVorlage from "./GanttVorlage";
import AutoVerknuepfung from "./AutoVerknuepfung";

interface Props {
  api: ApiInstance | null;
  ready: boolean;
  sims: SimProjekt[];
  setSims: React.Dispatch<React.SetStateAction<SimProjekt[]>>;
  aktivId: string | null;
  setAktivId: (id: string) => void;
  geladeneModelle: { id: string; name: string }[];
  userId?: string | null;
}

export default function TabProjekte({ api, sims, setSims, aktivId, setAktivId, userId }: Props) {
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

  async function toggleAufgeklappt(id: string) {
    const warOffen = aufgeklappt === id;
    const neuerStatus = warOffen ? null : id;
    setAufgeklappt(neuerStatus);
    setMenuOffen(null);

    // Nur laden wenn Sim NEU geöffnet wird (nicht beim Schließen)
    if (!warOffen && neuerStatus && api) {
      const sim = sims.find(s => s.id === id);
      if (sim && sim.modelle.length > 0) {
        const valid = sim.modelle.filter(m =>
          m.id && !m.id.startsWith('model-') && m.id !== 'undefined'
        );
        if (valid.length === 0) return;
        setModellMsg({ simId: id, typ: "ok", text: `⟳ ${valid.length} Modelle werden geladen…` });
        let loaded = 0;
        for (const m of valid) {
          try {
            await (api.viewer as any).toggleModelVersion({ id: m.id, versionId: m.id }, true, false);
            loaded++;
          } catch (e) {
            setModellMsg({ simId: id, typ: "err", text: `Fehler: ${e instanceof Error ? e.message : String(e)}` });
            return;
          }
        }
        setModellMsg({ simId: id, typ: "ok", text: `✓ ${loaded} Modelle geladen` });
      }
    }
  }

  function neuErstellen() {
    if (!neuName.trim()) return;
    const sim: SimProjekt = {
      id: crypto.randomUUID(),
      name: neuName.trim(),
      erstelltAm: new Date().toISOString(),
      erstellerId: userId || undefined,
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
                <span style={{ flexShrink: 0 }}>
                  <svg viewBox="0 0 20 20" width="20" height="20" fill="none" stroke="#8a9baa" strokeWidth="1.5">
                    <rect x="3" y="10" width="3" height="7" rx="0.5" fill="#c4cdd6"/><rect x="8.5" y="6" width="3" height="11" rx="0.5" fill="#a0adb8"/><rect x="14" y="3" width="3" height="14" rx="0.5" fill="#8a9baa"/>
                  </svg>
                </span>
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
                      boxShadow: "0 2px 8px rgba(0,0,0,.12)", zIndex: 100, minWidth: 200,
                    }}>
                      {(!!userId && sim.erstellerId === userId) && (
                      <>
                      <div style={{ padding: "6px 14px", fontSize: 10, color: "var(--tc-text-3)", fontWeight: 600, borderBottom: "1px solid #eef1f4" }}>
                        Zugriff für Projektmitglieder
                      </div>
                      {([
                        { key: "edit", label: "Zugriff bearbeiten", icon: "✏", desc: "Inhalt hinzufügen, bearbeiten" },
                        { key: "read", label: "Schreibgeschützt", icon: "👁", desc: "Nur Anzeigen von Inhalt" },
                        { key: "none", label: "Kein Zugriff", icon: "🚫", desc: "Projekt wird ausgeblendet" },
                      ] as const).map(opt => {
                        const aktDefault = sim.zugriff?.["__default__"] ?? "read";
                        const istAktiv = aktDefault === opt.key;
                        return (
                        <button key={opt.key}
                          style={{ display: "block", width: "100%", padding: "6px 14px", background: istAktiv ? "#f0f7ff" : "none", border: "none", textAlign: "left", fontSize: 11, cursor: "pointer", borderBottom: "0.5px solid #eef1f4" }}
                          onClick={() => {
                            setSims(prev => prev.map(s => s.id === sim.id ? {
                              ...s,
                              zugriff: { ...(s.zugriff || {}), __default__: opt.key }
                            } : s));
                            setMenuOffen(null);
                          }}
                        >
                          <div style={{ fontWeight: 500 }}>{opt.icon} {opt.label} {istAktiv && "✓"}</div>
                          {opt.desc && <div style={{ fontSize: 9, color: "var(--tc-text-3)" }}>{opt.desc}</div>}
                        </button>
                        );
                      })}
                      </>
                      )}
                      {(!!userId && sim.erstellerId === userId) && (
                      <button
                        style={{ display: "block", width: "100%", padding: "8px 14px", background: "none", border: "none", textAlign: "left", fontSize: 11, color: "var(--tc-red)", cursor: "pointer" }}
                        onClick={() => loeschen(sim.id)}
                      >🗑 Simulation löschen</button>
                      )}
                    </div>
                  )}
                </div>
                <span className="sim-chevron">{offen ? "▲" : "▼"}</span>
              </div>
            </div>

            {/* Sim Body */}
            {offen && (() => {
              const istErsteller = !!userId && sim.erstellerId === userId;
              return (
              <div className="sim-card-body">
                {!istAktiv && (
                  <button className="tc-btn-primary" style={{ width: "100%", marginBottom: 8 }}
                    onClick={async () => {
                      setAktivId(sim.id);
                      if (api && sim.modelle.length > 0) {
                        const valid = sim.modelle.filter(m =>
                          m.id && !m.id.startsWith('model-') && m.id !== 'undefined'
                        );
                        if (valid.length === 0) return;
                        setModellMsg({ simId: sim.id, typ: "ok", text: "⟳ Modelle werden umgeschaltet…" });

                        const simIds = new Set(valid.map(m => m.id));
                        try {
                          const alle = await api.viewer.getModels() as any[];
                          const geladen = alle.filter((m: any) => m.state === 'loaded');
                          for (const m of geladen) {
                            const mid = m.id || m.modelId;
                            if (mid && !simIds.has(mid)) {
                              try {
                                await (api.viewer as any).toggleModelVersion({ id: mid, versionId: mid }, false, false);
                              } catch { /* ignore */ }
                            }
                          }
                        } catch { /* ignore */ }

                        let loaded = 0;
                        for (const m of valid) {
                          try {
                            await (api.viewer as any).toggleModelVersion({ id: m.id, versionId: m.id }, true, false);
                            loaded++;
                          } catch { /* ignore */ }
                        }
                        setModellMsg({ simId: sim.id, typ: "ok", text: `✓ ${loaded} Modelle geladen` });
                      }
                    }}>
                    ✓ Als aktive Simulation setzen
                  </button>
                )}

                {/* Gantt — nur Ersteller kann importieren */}
                {istErsteller && (
                <>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                  <span className="tc-section-label">Gantt</span>
                  <div style={{ display: "flex", gap: 4 }}>
                    <GanttVorlage />
                    {sim.tasks.length > 0 && <GanttExport tasks={sim.tasks} simName={sim.name} />}
                  </div>
                </div>
                <GanttImport
                  onImport={tasks => setSims(prev =>
                    prev.map(s => s.id === sim.id ? { ...s, tasks, autoVerknuepft: false } : s)
                  )}
                  taskCount={sim.tasks.length}
                />

                {sim.tasks.length > 0 && sim.modelle.length > 0 && (
                  <AutoVerknuepfung
                    api={api}
                    sim={sim}
                    onUpdate={tasks => setSims(prev =>
                      prev.map(s => s.id === sim.id ? { ...s, tasks, autoVerknuepft: true } : s)
                    )}
                    done={sim.autoVerknuepft}
                  />
                )}

                <div className="tc-divider" />
                </>
                )}

                {/* Modelle — Liste immer sichtbar, Auswahl nur für Ersteller */}
                <div className="tc-section-label" style={{ marginBottom: 6 }}>
                  Modelle{sim.modelle.length > 0 ? ` (${sim.modelle.length})` : ""}
                </div>

                {sim.modelle.length > 0 && (
                  <div style={{ marginBottom: 6 }}>
                    {sim.modelle.map(m => (
                      <div key={m.id} className="modell-row">
                        <svg viewBox="0 0 24 24" width="18" height="18" style={{ flexShrink: 0 }}>
                          <path d="M12 2L2 7v10l10 5 10-5V7L12 2z" fill="none" stroke="#2d7dbd" strokeWidth="1.5"/>
                          <path d="M12 22V12M2 7l10 5 10-5" fill="none" stroke="#2d7dbd" strokeWidth="1.2"/>
                        </svg>
                        <div style={{ flex: 1 }}>
                          <div className="modell-name">{m.name}</div>
                          <div className="modell-id">{m.id}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {istErsteller && (
                <>
                <button
                  className="tc-btn-secondary"
                  style={{ width: "100%" }}
                  disabled={modellLaden}
                  onClick={e => { e.stopPropagation(); modelleUebernehmen(sim.id); }}
                >
                  {modellLaden ? "⟳ Lade…" : "⟳ Modelle auswählen…"}
                </button>

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
                </>
                )}

                {modellMsg?.simId === sim.id && (
                  <div className={`alert ${modellMsg.typ}`} style={{ marginTop: 6 }}>
                    {modellMsg.typ === "ok" ? "✓" : "!"} {modellMsg.text}
                  </div>
                )}
              </div>
              );
            })()}
          </div>
        );
      })}
    </div>
  );
}
