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

  return (
    <div className="tc-app">
      {/* Header */}
      <div className="tc-header">
        <div className="tc-header-left">
          <span className="tc-logo">4D</span>
          <span className="tc-header-title">
            {aktiveSim ? aktiveSim.name : "Bauablauf"}
          </span>
        </div>
        <div className="tc-header-right">
          {taskCount > 0 && (
            <span className="tc-task-badge">{taskCount} Tasks</span>
          )}
          <span className={`tc-dot ${ready ? "on" : "off"}`} title={ready ? "Verbunden" : fehler ?? "Verbinde…"} />
          <svg width="15" height="15" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" style={{ opacity: 0.7, cursor: "pointer" }}>
            <circle cx="10" cy="10" r="2.5"/><path d="M10 2v2M10 16v2M2 10h2M16 10h2M4.22 4.22l1.42 1.42M14.36 14.36l1.42 1.42M4.22 15.78l1.42-1.42M14.36 5.64l1.42-1.42"/>
          </svg>
        </div>
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
