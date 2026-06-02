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
  const { api, ready, fehler, selektion, aktivesModellId } = useApi();

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
          <div className="tc-logo">4D</div>
          <span className="tc-header-title">
            {aktiveSim ? aktiveSim.name : "Bauablauf"}
          </span>
        </div>
        <div className="tc-header-right">
          {taskCount > 0 && (
            <span className="tc-task-badge">{taskCount} Tasks</span>
          )}
          <span className={`tc-dot ${ready ? "on" : "off"}`} title={ready ? "Verbunden" : fehler ?? "Verbinde…"} />
        </div>
      </div>

      {/* Tabs */}
      <div className="tc-tabs">
        <button
          className={aktTab === "projekte" ? "active" : ""}
          onClick={() => setAktTab("projekte")}
        >
          <span className="tc-tab-icon">📊</span>
          <span>Projekte</span>
        </button>
        <button
          className={aktTab === "bauteile" ? "active" : ""}
          onClick={() => setAktTab("bauteile")}
        >
          <span className="tc-tab-icon">🔧</span>
          <span>Bauteile</span>
        </button>
        <button
          className={aktTab === "abspielen" ? "active" : ""}
          onClick={() => setAktTab("abspielen")}
        >
          <span className="tc-tab-icon">▶</span>
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
            ready={ready}
            aktiveSim={aktiveSim}
          />
        )}
      </div>
    </div>
  );
}
