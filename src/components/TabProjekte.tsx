import { useState, useRef } from "react";
import type { SimProjekt, TcModel } from "../types";
import type { ApiInstance } from "../hooks/useApi";
import GanttImport from "./GanttImport";

interface Props {
  api: ApiInstance | null;
  ready: boolean;
  sims: SimProjekt[];
  setSims: React.Dispatch<React.SetStateAction<SimProjekt[]>>;
  aktivId: string | null;
  setAktivId: (id: string) => void;
}

export default function TabProjekte({ api, ready, sims, setSims, aktivId, setAktivId }: Props) {
  const [aufgeklappt, setAufgeklappt] = useState<string | null>(aktivId);
  const [neuName, setNeuName] = useState("");
  const [zeigeNeu, setZeigeNeu] = useState(false);
  const [modellLaden, setModellLaden] = useState(false);
  const [modellMsg, setModellMsg] = useState<{ typ: "ok" | "err"; text: string } | null>(null);
  const [umbenennen, setUmbenennen] = useState<string | null>(null);
  const [umbName, setUmbName] = useState("");
  const nameRef = useRef<HTMLInputElement>(null);

  function toggleAufgeklappt(id: string) {
    setAufgeklappt(prev => prev === id ? null : id);
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

  async function modelleUebernehmen(simId: string) {
    if (!api) return;
    setModellLaden(true);
    setModellMsg(null);
    try {
      const modelle: TcModel[] = await api.viewer.getModels();
      if (!modelle || modelle.length === 0) {
        setModellMsg({ typ: "err", text: "Keine Modelle im Viewer geladen" });
        return;
      }
      setSims(prev => prev.map(s =>
        s.id === simId
          ? { ...s, modelle: modelle.map(m => ({ id: m.modelId, name: m.name || m.fileName || m.modelId })) }
          : s
      ));
      setModellMsg({ typ: "ok", text: `${modelle.length} Modell(e) übernommen` });
    } catch (e) {
      setModellMsg({ typ: "err", text: `Fehler: ${e instanceof Error ? e.message : String(e)}` });
    } finally {
      setModellLaden(false);
    }
  }

  function loeschen(simId: string) {
    if (!confirm("Simulation wirklich löschen?")) return;
    setSims(prev => prev.filter(s => s.id !== simId));
    if (aktivId === simId) {
      const rest = sims.filter(s => s.id !== simId);
      if (rest.length > 0) setAktivId(rest[0].id);
    }
  }

  function startUmbenennen(sim: SimProjekt) {
    setUmbenennen(sim.id);
    setUmbName(sim.name);
    setTimeout(() => nameRef.current?.focus(), 50);
  }

  function umbenennenSpeichern(simId: string) {
    if (!umbName.trim()) return;
    setSims(prev => prev.map(s => s.id === simId ? { ...s, name: umbName.trim() } : s));
    setUmbenennen(null);
  }

  const fmt = (iso: string) => {
    try { return new Date(iso).toLocaleDateString("de-DE"); } catch { return iso; }
  };

  return (
    <div className="tc-setup-content">

      {/* Header Zeile */}
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

      {/* Keine Simulationen */}
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
                  {umbenennen === sim.id ? (
                    <input
                      ref={nameRef}
                      className="tc-input-inline"
                      value={umbName}
                      onChange={e => setUmbName(e.target.value)}
                      onKeyDown={e => {
                        if (e.key === "Enter") umbenennenSpeichern(sim.id);
                        if (e.key === "Escape") setUmbenennen(null);
                        e.stopPropagation();
                      }}
                      onClick={e => e.stopPropagation()}
                    />
                  ) : (
                    <div className="sim-card-name">{sim.name}</div>
                  )}
                  <div className="sim-card-meta">
                    {fmt(sim.erstelltAm)} · {sim.tasks.length} Tasks
                    {sim.modelle.length > 0 && ` · ${sim.modelle.length} Modell(e)`}
                  </div>
                </div>
              </div>
              <div className="sim-card-right">
                {istAktiv && <span className="sim-aktiv-badge">Aktiv</span>}
                <span className="sim-chevron">{offen ? "▲" : "▼"}</span>
              </div>
            </div>

            {/* Aufgeklappt */}
            {offen && (
              <div className="sim-card-body">

                {/* Aktivieren */}
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

                {/* Modelle */}
                <div className="tc-divider" />
                <div className="tc-section-label" style={{ marginBottom: 4 }}>Modelle aus Viewer</div>

                {sim.modelle.length === 0 ? (
                  <div className="alert info" style={{ marginBottom: 6 }}>
                    Noch keine Modelle — Modell im TC Viewer laden, dann übernehmen
                  </div>
                ) : (
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
                  disabled={!ready || modellLaden}
                  onClick={() => { setModellMsg(null); modelleUebernehmen(sim.id); }}
                >
                  {modellLaden ? "⟳ Lade…" : "⟳ Geladene Modelle übernehmen"}
                </button>

                {modellMsg && (
                  <div className={`alert ${modellMsg.typ}`} style={{ marginTop: 6 }}>
                    {modellMsg.typ === "ok" ? "✓" : "!"} {modellMsg.text}
                  </div>
                )}

                {/* Aktionen */}
                <div className="tc-divider" />
                <div style={{ display: "flex", gap: 6 }}>
                  <button className="tc-btn-secondary" style={{ flex: 1 }}
                    onClick={() => startUmbenennen(sim)}>
                    ✏ Umbenennen
                  </button>
                  <button className="tc-btn-danger" style={{ flex: 1 }}
                    onClick={() => loeschen(sim.id)}>
                    🗑 Löschen
                  </button>
                </div>
              </div>
            )}
          </div>
        );
      })}

      {/* Verbindungs-Status */}
      {!ready && (
        <div className="alert info" style={{ marginTop: 10 }}>
          ⟳ Verbinde mit TC Viewer…
        </div>
      )}
    </div>
  );
}
