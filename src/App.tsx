import { useState, useEffect, useRef, useCallback } from "react";
import { useApi, cloudSave, cloudLoad } from "./hooks/useApi";
import type { SimProjekt, Zugriff } from "./types";
import { SIMS_KEY, AKTIV_KEY } from "./types";
import TabProjekte from "./components/TabProjekte";
import TabBauteile from "./components/TabBauteile";
import TabAbspielen from "./components/TabAbspielen";
import "./App.css";

type Tab = "projekte" | "bauteile" | "abspielen";

export default function App() {
  const { api, ready, selektion, aktivesModellId, geladeneModelle } = useApi();

  const [aktTab, setAktTab] = useState<Tab>("projekte");
  const [sims, setSims] = useState<SimProjekt[]>([]);
  const [aktivId, setAktivId] = useState<string | null>(null);
  const [syncStatus, setSyncStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [userId, setUserId] = useState<string | null>(null);
  const cloudInitDone = useRef(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // User ID laden
  useEffect(() => {
    if (!api) return;
    (async () => {
      try {
        const user = await (api as any).user.getUser();
        if (user?.id) { setUserId(user.id); console.log("[Auth] User:", user.id); }
      } catch { /* ignore */ }
    })();
  }, [api]);

  // 1. localStorage laden (sofort)
  useEffect(() => {
    try {
      const raw = localStorage.getItem(SIMS_KEY);
      if (raw) setSims(JSON.parse(raw));
      const aid = localStorage.getItem(AKTIV_KEY);
      if (aid) setAktivId(aid);
    } catch { /* ignore */ }
  }, []);

  // 2. Cloud laden (wenn API ready)
  useEffect(() => {
    if (!api || cloudInitDone.current) return;
    cloudInitDone.current = true;
    (async () => {
      try {
        const data = await cloudLoad(api);
        if (data && Array.isArray(data.sims) && data.sims.length > 0) {
          const cloudSims = data.sims as SimProjekt[];
          // Merge: Cloud-Daten mit lokalen mergen (Cloud gewinnt bei gleichem ID)
          setSims(prev => {
            const merged = new Map<string, SimProjekt>();
            for (const s of prev) merged.set(s.id, s);
            for (const s of cloudSims) merged.set(s.id, s); // Cloud überschreibt lokal
            return [...merged.values()];
          });
          if (data.aktivId) setAktivId(data.aktivId as string);
          console.log("[CloudSync] Cloud-Daten geladen:", cloudSims.length, "Simulationen");
        }
      } catch (e) { console.warn("[CloudSync] Cloud-Load Fehler:", e); }
    })();
  }, [api]);

  // 3. localStorage + Cloud speichern (debounced)
  const saveToCloud = useCallback(async (simsData: SimProjekt[], aid: string | null) => {
    localStorage.setItem(SIMS_KEY, JSON.stringify(simsData));
    if (aid) localStorage.setItem(AKTIV_KEY, aid);
    if (!api) return;
    setSyncStatus("saving");
    try {
      const ok = await cloudSave(api, { sims: simsData, aktivId: aid });
      setSyncStatus(ok ? "saved" : "error");
      if (ok) setTimeout(() => setSyncStatus("idle"), 2000);
    } catch { setSyncStatus("error"); }
  }, [api]);

  useEffect(() => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => saveToCloud(sims, aktivId), 1500);
    return () => { if (saveTimer.current) clearTimeout(saveTimer.current); };
  }, [sims, aktivId, saveToCloud]);

  const aktiveSim = sims.find(s => s.id === aktivId) ?? null;

  // Auto-Migration: Alte Sims ohne erstellerId → aktueller User wird Ersteller
  useEffect(() => {
    if (!userId) return;
    let changed = false;
    const updated = sims.map(s => {
      if (!s.erstellerId) { changed = true; return { ...s, erstellerId: userId }; }
      return s;
    });
    if (changed) setSims(updated);
  }, [userId, sims.length]);

  // Zugriffskontrolle
  function istErsteller(sim: SimProjekt | null): boolean {
    if (!sim) return false;
    if (!userId) return false;
    return sim.erstellerId === userId;
  }

  function getZugriff(sim: SimProjekt | null): Zugriff {
    if (!sim) return "read";
    if (istErsteller(sim)) return "edit";
    if (!userId) return "read";
    // Erst user-spezifisch, dann default, dann "read"
    return sim.zugriff?.[userId] ?? sim.zugriff?.["__default__"] ?? "read";
  }
  const aktZugriff = getZugriff(aktiveSim);
  const readOnly = aktZugriff !== "edit";

  // Nur Sims anzeigen die nicht "none" sind
  const sichtbareSims = sims.filter(s => {
    if (istErsteller(s)) return true;
    if (!userId) return true;
    const z = s.zugriff?.[userId] ?? s.zugriff?.["__default__"] ?? "read";
    return z !== "none";
  });

  function updateSim(updated: SimProjekt) {
    setSims(prev => prev.map(s => s.id === updated.id ? updated : s));
  }

  const [headerDropdown, setHeaderDropdown] = useState(false);
  const [headerFilter, setHeaderFilter] = useState<"alle" | "meine" | "freigegeben">("alle");
  const [taskSort, setTaskSort] = useState<"gantt" | "datum" | "aktiv">("gantt");
  const [sortDropdown, setSortDropdown] = useState(false);

  return (
    <div className="tc-app" onClick={() => { setHeaderDropdown(false); setSortDropdown(false); }}>
      {/* Header — Organizer Style */}
      <div className="tc-header-org">
        <div className="tc-header-org-top">
          <div style={{ flex: 1 }}>
            <div className="tc-header-org-title">
              <span className="tc-logo">4D</span> Simulationen
            </div>
            <div className="tc-header-org-sub" onClick={e => { e.stopPropagation(); setHeaderDropdown(d => !d); setSortDropdown(false); }}>
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
            <div style={{ position: "relative" }}>
              <button className={`tc-header-icon-btn ${taskSort !== "gantt" ? "active-filter" : ""}`} title="Sortierung"
                onClick={e => { e.stopPropagation(); setSortDropdown(d => !d); setHeaderDropdown(false); }}>
                <svg viewBox="0 0 20 20" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <path d="M3 6h14M5 10h10M7 14h6"/>
                </svg>
              </button>
              {sortDropdown && (
                <div className="tc-header-dropdown" style={{ right: 0, left: "auto", minWidth: 160 }} onClick={e => e.stopPropagation()}>
                  {([
                    { key: "gantt" as const, label: "Gantt-Reihenfolge", desc: "Wie importiert" },
                    { key: "datum" as const, label: "Nach Datum", desc: "Frühestes Ende zuerst" },
                    { key: "aktiv" as const, label: "Aktive zuerst", desc: "Markierte Objekte oben" },
                  ]).map(opt => (
                    <div key={opt.key} className={`tc-header-dropdown-item ${taskSort === opt.key ? "active" : ""}`}
                      onClick={() => { setTaskSort(opt.key); setSortDropdown(false); }}>
                      <div>
                        <div style={{ fontWeight: 500 }}>{opt.label}</div>
                        <div style={{ fontSize: 9, color: "var(--tc-text-3)" }}>{opt.desc}</div>
                      </div>
                      {taskSort === opt.key && <span>✓</span>}
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div style={{ position: "relative" }}>
              <button className="tc-header-icon-btn" title="Optionen">
                <svg viewBox="0 0 20 20" width="18" height="18" fill="currentColor">
                  <circle cx="10" cy="4" r="1.5"/><circle cx="10" cy="10" r="1.5"/><circle cx="10" cy="16" r="1.5"/>
                </svg>
              </button>
            </div>
            {/* Sync Status */}
            <span title={syncStatus === "saved" ? "Cloud gespeichert" : syncStatus === "saving" ? "Speichern…" : syncStatus === "error" ? "Sync-Fehler" : ""}
              style={{ width: 8, height: 8, borderRadius: "50%", flexShrink: 0,
                background: syncStatus === "saved" ? "#6cc07a" : syncStatus === "saving" ? "#edb94c" : syncStatus === "error" ? "#ff6b6b" : "transparent",
                transition: "background 0.3s" }} />
          </div>
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
            sims={sichtbareSims}
            setSims={setSims}
            aktivId={aktivId}
            setAktivId={setAktivId}
            geladeneModelle={geladeneModelle}
            userId={userId}
          />
        )}
        <div style={{ display: aktTab === "bauteile" ? "block" : "none" }}>
          <TabBauteile
            api={api}
            aktiveSim={aktiveSim}
            updateSim={updateSim}
            selektion={selektion}
            aktivesModellId={aktivesModellId}
            taskSort={taskSort}
            readOnly={readOnly}
          />
        </div>
        <div style={{ display: aktTab === "abspielen" ? "block" : "none" }}>
          <TabAbspielen
            api={api}
            aktiveSim={aktiveSim}
            aktivesModellId={aktivesModellId}
            taskSort={taskSort}
          />
        </div>
      </div>
    </div>
  );
}
