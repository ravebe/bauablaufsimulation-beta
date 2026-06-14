import { useState, useEffect } from "react";
import { useApi } from "./hooks/useApi";
import type { SimProjekt } from "./types";
import { SIMS_KEY, AKTIV_KEY } from "./types";
import TabProjekte from "./components/TabProjekte";
import TabBauteile from "./components/TabBauteile";
import TabAbspielen from "./components/TabAbspielen";
import "./App.css";

type Tab = "projekte" | "bauteile" | "abspielen";

export default function App() {
  const { api, ready, fehler, selektion, aktivesModellId, geladeneModelle } = useApi();

  const [aktTab, setAktTab] = useState<Tab>("projekte");
  const [sims, setSims] = useState<SimProjekt[]>([]);
  const [aktivId, setAktivId] = useState<string | null>(null);

  // localStorage laden
  useEffect(() => {
    try {
      const raw = localStorage.getItem(SIMS_KEY);
      if (raw) setSims(JSON.parse(raw));
      const aid = localStorage.getItem(AKTIV_KEY);
      if (aid) setAktivId(aid);
    } catch { /* ignore */ }
  }, []);

  // localStorage speichern
  useEffect(() => {
    localStorage.setItem(SIMS_KEY, JSON.stringify(sims));
  }, [sims]);

  useEffect(() => {
    if (aktivId) localStorage.setItem(AKTIV_KEY, aktivId);
  }, [aktivId]);

  const aktiveSim = sims.find(s => s.id === aktivId) ?? null;

  function updateSim(updated: SimProjekt) {
    setSims(prev => prev.map(s => s.id === updated.id ? updated : s));
  }

  const taskCount = aktiveSim?.tasks.length ?? 0;

  const [headerDropdown, setHeaderDropdown] = useState(false);
  const [headerFilter, setHeaderFilter] = useState<"alle" | "meine" | "freigegeben">("alle");

  return (
    <div className="tc-app" onClick={() => setHeaderDropdown(false)}>
      {/* Header — Organizer Style */}
      <div className="tc-header-org">
        <div className="tc-header-org-top">
          <div style={{ flex: 1 }}>
            <div className="tc-header-org-title">
              <span className="tc-logo">4D</span> Simulationen
            </div>
            <div className="tc-header-org-sub" onClick={e => { e.stopPropagation(); setHeaderDropdown(d => !d); }}>
              {aktiveSim ? aktiveSim.name : "Kein Projekt"} {headerDropdown ? "▲" : "▼"}
            </div>
            {headerDropdown && (
              <div className="tc-header-dropdown" onClick={e => e.stopPropagation()}>
                <div className={`tc-header-dropdown-item ${headerFilter === "meine" ? "active" : ""}`}
                  onClick={() => { setHeaderFilter("meine"); setHeaderDropdown(false); }}>
                  Von mir erstellt {headerFilter === "meine" && "✓"}
                </div>
                <div className={`tc-header-dropdown-item ${headerFilter === "alle" ? "active" : ""}`}
                  onClick={() => { setHeaderFilter("alle"); setHeaderDropdown(false); }}>
                  Alle Simulationen {headerFilter === "alle" && "✓"}
                </div>
              </div>
            )}
          </div>
          <div className="tc-header-org-actions">
            <button className="tc-header-icon-btn" title="Neue Simulation"
              onClick={() => setAktTab("projekte")}>
              <svg viewBox="0 0 20 20" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.4">
                <rect x="2" y="4" width="16" height="13" rx="1.5"/><path d="M2 7h16"/><path d="M6 4V2"/><path d="M14 4V2"/>
                <circle cx="14" cy="11" r="3.5" fill="#2d7dbd" stroke="#2d7dbd"/><path d="M14 9.5v3M12.5 11h3" stroke="#fff" strokeWidth="1.5"/>
              </svg>
            </button>
            <button className="tc-header-icon-btn" title="Filter">
              <svg viewBox="0 0 20 20" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M3 6h14M5 10h10M7 14h6"/>
              </svg>
            </button>
            <div style={{ position: "relative" }}>
              <button className="tc-header-icon-btn" title="Optionen">
                <svg viewBox="0 0 20 20" width="18" height="18" fill="currentColor">
                  <circle cx="10" cy="4" r="1.5"/><circle cx="10" cy="10" r="1.5"/><circle cx="10" cy="16" r="1.5"/>
                </svg>
              </button>
            </div>
          </div>
        </div>
        {/* Task-Info */}
        {taskCount > 0 && (
          <div className="tc-header-org-info">
            <span className="tc-task-badge-org">{taskCount} Tasks</span>
            <span className={`tc-dot ${ready ? "on" : "off"}`} title={ready ? "Verbunden" : fehler ?? "Verbinde…"} />
          </div>
        )}
      </div>

      {/* Tabs */}
      <div className="tc-tabs">
        <button
          className={`tc-tab ${aktTab === "projekte" ? "active" : ""}`}
          onClick={() => setAktTab("projekte")}
        >
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" width="16" height="16">
            <rect x="2" y="2" width="5" height="5" rx="0.5"/><rect x="9" y="2" width="5" height="5" rx="0.5"/>
            <rect x="2" y="9" width="5" height="5" rx="0.5"/><rect x="9" y="9" width="5" height="5" rx="0.5"/>
          </svg>
          <span>Projekte</span>
        </button>
        <button
          className={`tc-tab ${aktTab === "bauteile" ? "active" : ""}`}
          onClick={() => setAktTab("bauteile")}
        >
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" width="16" height="16">
            <path d="M8 1.5L14.5 5v6L8 14.5 1.5 11V5L8 1.5z"/>
            <path d="M8 14.5V8M1.5 5L8 8M14.5 5L8 8"/>
          </svg>
          <span>Bauteile</span>
        </button>
        <button
          className={`tc-tab ${aktTab === "abspielen" ? "active" : ""}`}
          onClick={() => setAktTab("abspielen")}
        >
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" width="16" height="16">
            <path d="M4 2l10 6-10 6V2z"/>
          </svg>
          <span>Abspielen</span>
        </button>
      </div>

      {/* Tab Content */}
      <div className="tc-tab-content">
        {aktTab === "projekte" && (
          <TabProjekte
            api={api}
            ready={ready}
            sims={sims}
            setSims={setSims}
            aktivId={aktivId}
            setAktivId={setAktivId}
            geladeneModelle={geladeneModelle}
          />
        )}
        {aktTab === "bauteile" && (
          <TabBauteile
            api={api}
            aktiveSim={aktiveSim}
            updateSim={updateSim}
            selektion={selektion}
            aktivesModellId={aktivesModellId}
          />
        )}
        {aktTab === "abspielen" && (
          <TabAbspielen
            api={api}
            aktiveSim={aktiveSim}
            aktivesModellId={aktivesModellId}
          />
        )}
      </div>
    </div>
  );
}
