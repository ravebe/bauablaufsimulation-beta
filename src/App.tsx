import { useState, useEffect, useRef, useCallback } from "react";
import { useApi, cloudSave, cloudLoad, sendPresence } from "./hooks/useApi";
import type { SimProjekt, Zugriff } from "./types";
import { SIMS_KEY, AKTIV_KEY, nsKey } from "./types";
import TabProjekte from "./components/TabProjekte";
import TabBauteile from "./components/TabBauteile";
import TabAbspielen from "./components/TabAbspielen";
import ZugriffskontrollManager from "./components/ZugriffskontrollManager";
import KalenderManager from "./components/KalenderManager";
import { EXPORT_FORMATE } from "./components/ganttExportFormate";
import "./App.css";

type Tab = "projekte" | "bauteile" | "abspielen";

export default function App() {
  const { api, ready, selektion, aktivesModellId, geladeneModelle, projectId } = useApi();

  const [aktTab, setAktTab] = useState<Tab>("projekte");
  const [sims, setSims] = useState<SimProjekt[]>([]);
  const [aktivId, setAktivId] = useState<string | null>(null);
  const [syncStatus, setSyncStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [userId, setUserId] = useState<string | null>(null);
  const [userName, setUserName] = useState<string>("");
  const [andererBearbeiter, setAndererBearbeiter] = useState<string | null>(null);
  const [cloudLoadDone, setCloudLoadDone] = useState(false);
  const [konflikt, setKonflikt] = useState(false);
  const cloudVersion = useRef(0);
  const cloudInitDone = useRef(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sharedNadelTag = useRef<number>(-1);
  const undoStack = useRef<SimProjekt[]>([]);
  const redoStack = useRef<SimProjekt[]>([]); // stores timestamp (ms)

  // User ID laden
  useEffect(() => {
    if (!api) return;
    (async () => {
      try {
        const user = await (api as any).user.getUser();
        if (user?.id) {
          setUserId(user.id);
          const name = [user.firstName, user.lastName].filter(Boolean).join(" ").trim();
          setUserName(name || user.email || "Kollege");
          console.log("[Auth] User:", user.id);
        }
      } catch { /* ignore */ }
    })();
  }, [api]);

  // 1. localStorage laden (sobald bekannt ist, ob/welches Projekt aktiv ist)
  useEffect(() => {
    if (!ready) return;
    try {
      const raw = localStorage.getItem(nsKey(SIMS_KEY, projectId));
      if (raw) setSims(JSON.parse(raw));
      const aid = localStorage.getItem(nsKey(AKTIV_KEY, projectId));
      if (aid) setAktivId(aid);
    } catch { /* ignore */ }
  }, [ready, projectId]);

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
        if (data && typeof data.version === "number") cloudVersion.current = data.version;
      } catch (e) { console.warn("[CloudSync] Cloud-Load Fehler:", e); }
      finally { setCloudLoadDone(true); }
    })();
  }, [api]);

  // Bei Speicher-Konflikt: aktuelle Cloud-Version übernehmen und weiterarbeiten
  const konfliktAufloesen = useCallback(async () => {
    if (!api) return;
    try {
      const data = await cloudLoad(api);
      if (data) {
        if (Array.isArray(data.sims)) {
          setSims(data.sims as SimProjekt[]);
          localStorage.setItem(nsKey(SIMS_KEY, projectId), JSON.stringify(data.sims));
        }
        if (data.aktivId) setAktivId(data.aktivId as string);
        if (typeof data.version === "number") cloudVersion.current = data.version;
      }
    } catch { /* ignore */ }
    setKonflikt(false);
  }, [api, projectId]);

  // 3. localStorage + Cloud speichern (debounced)
  // Speichervorgänge werden strikt nacheinander abgearbeitet (Queue) — sonst können sich
  // zwei sich überschneidende Speichervorgänge (z.B. Debounce + Sofort-Speichern beim
  // Tab-Wechsel) gegenseitig als "Konflikt" blockieren und danach speichert gar nichts mehr.
  const saveQueue = useRef<Promise<void>>(Promise.resolve());
  const saveToCloud = useCallback((simsData: SimProjekt[], aid: string | null) => {
    saveQueue.current = saveQueue.current.then(async () => {
      localStorage.setItem(nsKey(SIMS_KEY, projectId), JSON.stringify(simsData));
      if (aid) localStorage.setItem(nsKey(AKTIV_KEY, projectId), aid);
      if (!api) return;
      setSyncStatus("saving");
      try {
        // Sicherheitsnetz: ein leerer Zustand darf bestehende Cloud-Daten nie stillschweigend
        // überschreiben (Schutz gegen Timing-Bugs, fehlgeschlagenes Laden etc.)
        if (simsData.length === 0) {
          const bestehend = await cloudLoad(api);
          if (bestehend && Array.isArray(bestehend.sims) && bestehend.sims.length > 0) {
            console.warn("[CloudSync] Speichern übersprungen — Cloud hat noch Daten, lokal aber leer");
            setSyncStatus("idle");
            return;
          }
        }
        const result = await cloudSave(api, { sims: simsData, aktivId: aid }, cloudVersion.current);
        if (result.ok) {
          cloudVersion.current = result.version;
          setSyncStatus("saved");
          setTimeout(() => setSyncStatus("idle"), 2000);
        } else if (result.conflict) {
          // Jemand anderes hat zwischenzeitlich gespeichert — nicht überschreiben,
          // sondern den Nutzer entscheiden lassen (Banner mit "Neu laden")
          setKonflikt(true);
          setSyncStatus("error");
        } else {
          setSyncStatus("error");
        }
      } catch { setSyncStatus("error"); }
    });
  }, [api, projectId]);

  useEffect(() => {
    // Erst speichern, wenn der initiale Ladevorgang (Cloud) abgeschlossen ist —
    // sonst überschreibt der leere Startzustand echte Cloud-Daten (Race Condition).
    // Bei einem ungelösten Speicher-Konflikt pausieren, bis der Nutzer neu geladen hat.
    if (!ready || !cloudLoadDone || konflikt) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => saveToCloud(sims, aktivId), 400);
    return () => { if (saveTimer.current) clearTimeout(saveTimer.current); };
  }, [sims, aktivId, saveToCloud, ready, cloudLoadDone, konflikt]);

  // Sicherheitsnetz: beim Tab-Wechsel/Schließen sofort speichern statt auf die
  // (kurze) Verzögerung zu warten — verhindert Datenverlust bei schnellem Reload
  useEffect(() => {
    const sofortSpeichern = () => {
      if (document.visibilityState === "visible") return; // nur beim Verlassen/Verstecken, nicht beim Zurückkommen
      if (konflikt) return; // bei ungelöstem Konflikt nicht blind weiterspeichern
      if (saveTimer.current) { clearTimeout(saveTimer.current); saveTimer.current = null; saveToCloud(sims, aktivId); }
    };
    document.addEventListener("visibilitychange", sofortSpeichern);
    window.addEventListener("pagehide", sofortSpeichern);
    return () => {
      document.removeEventListener("visibilitychange", sofortSpeichern);
      window.removeEventListener("pagehide", sofortSpeichern);
    };
  }, [sims, aktivId, saveToCloud, konflikt]);

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

  // Anwesenheit: leichter Heartbeat alle 25s, nur wenn die aktive Simulation
  // mit Bearbeitungsrechten für andere geteilt ist — zeigt den Namen des anderen
  // Bearbeiters an, falls er/sie gerade ebenfalls in derselben Simulation ist.
  // Kein zusätzliches Dauer-Polling nebenher, nur dieser eine Heartbeat.
  const aktiveSimRef = useRef(aktiveSim);
  useEffect(() => { aktiveSimRef.current = aktiveSim; });
  useEffect(() => {
    if (!api || !userId) { setAndererBearbeiter(null); return; }
    let abgebrochen = false;
    const heartbeat = async () => {
      const sim = aktiveSimRef.current;
      if (!sim) { if (!abgebrochen) setAndererBearbeiter(null); return; }
      const z = sim.zugriff;
      const binErsteller = sim.erstellerId === userId;
      const meinZugriff: Zugriff = binErsteller ? "edit" : (z?.[userId] ?? z?.["__default__"] ?? "read");
      if (meinZugriff !== "edit") { if (!abgebrochen) setAndererBearbeiter(null); return; }
      const geteiltMitBearbeitung = z?.["__default__"] === "edit" ||
        Object.entries(z ?? {}).some(([uid, zz]) => uid !== "__default__" && uid !== userId && zz === "edit");
      if (!geteiltMitBearbeitung) { if (!abgebrochen) setAndererBearbeiter(null); return; }
      const presence = await sendPresence(api, sim.id, userId, userName || "Kollege");
      if (abgebrochen) return;
      const andere = Object.entries(presence).find(([uid, e]) => uid !== userId && e.simId === sim.id);
      setAndererBearbeiter(andere ? andere[1].name : null);
    };
    heartbeat();
    const interval = setInterval(heartbeat, 25000);
    return () => { abgebrochen = true; clearInterval(interval); };
  }, [api, userId, userName]);

  // Nur Sims anzeigen die nicht "none" sind
  const sichtbareSims = sims.filter(s => {
    if (istErsteller(s)) return true;
    if (!userId) return true;
    const z = s.zugriff?.[userId] ?? s.zugriff?.["__default__"] ?? "read";
    return z !== "none";
  });

  function updateSim(updated: SimProjekt) {
    // Undo: aktuellen Stand speichern bevor Änderung
    const current = sims.find(s => s.id === updated.id);
    if (current) {
      undoStack.current = [...undoStack.current.slice(-14), current];
      redoStack.current = [];
      setUndoTick(t => t + 1);
    }
    setSims(prev => prev.map(s => s.id === updated.id ? updated : s));
  }

  function undo() {
    if (undoStack.current.length === 0 || !aktivId) return;
    const prev = undoStack.current.pop()!;
    const current = sims.find(s => s.id === aktivId);
    if (current) redoStack.current.push(current);
    setSims(s => s.map(sim => sim.id === prev.id ? prev : sim));
    setUndoTick(t => t + 1);
  }

  function redo() {
    if (redoStack.current.length === 0 || !aktivId) return;
    const next = redoStack.current.pop()!;
    const current = sims.find(s => s.id === aktivId);
    if (current) undoStack.current.push(current);
    setSims(s => s.map(sim => sim.id === next.id ? next : sim));
    setUndoTick(t => t + 1);
  }

  const [headerDropdown, setHeaderDropdown] = useState(false);
  const [headerFilter, setHeaderFilter] = useState<"alle" | "meine" | "freigegeben">("alle");
  const [taskSort, setTaskSort] = useState<"gantt" | "datum" | "aktiv" | "name" | "nummer">("gantt");
  const [sortDropdown, setSortDropdown] = useState(false);
  const [optionsDropdown, setOptionsDropdown] = useState(false);
  const [exportSubOffen, setExportSubOffen] = useState(false);
  const [zugriffsManagerOffen, setZugriffsManagerOffen] = useState(false);
  const [kalenderManagerOffen, setKalenderManagerOffen] = useState(false);
  const [, setUndoTick] = useState(0);

  return (
    <div className="tc-app" onClick={() => { setHeaderDropdown(false); setSortDropdown(false); setOptionsDropdown(false); setExportSubOffen(false); }}>
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
            {andererBearbeiter && (
              <div style={{ fontSize: 10, color: "#e8a023", marginTop: 2 }} title="Bearbeitet diese Simulation gerade ebenfalls">
                👥 {andererBearbeiter} ist auch hier
              </div>
            )}
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
            <button className="tc-header-icon-btn" title="Rückgängig" disabled={undoStack.current.length === 0}
              onClick={undo} style={{ opacity: undoStack.current.length === 0 ? 0.3 : 1 }}>
              <svg viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8">
                <path d="M4 10l4-4M4 10l4 4M5 10h9a3 3 0 0 1 0 6H12"/>
              </svg>
            </button>
            <button className="tc-header-icon-btn" title="Wiederherstellen" disabled={redoStack.current.length === 0}
              onClick={redo} style={{ opacity: redoStack.current.length === 0 ? 0.3 : 1 }}>
              <svg viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8">
                <path d="M16 10l-4-4M16 10l-4 4M15 10H6a3 3 0 0 0 0 6h3"/>
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
                    { key: "name" as const, label: "Nach Name", desc: "Alphabetisch A–Z" },
                    { key: "nummer" as const, label: "Nach Nummer", desc: "Zahlen aufsteigend 1, 2 … 100" },
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
              <button className="tc-header-icon-btn" title="Optionen"
                onClick={e => { e.stopPropagation(); setOptionsDropdown(d => !d); setExportSubOffen(false); setHeaderDropdown(false); setSortDropdown(false); }}>
                <svg viewBox="0 0 20 20" width="18" height="18" fill="currentColor">
                  <circle cx="10" cy="4" r="1.5"/><circle cx="10" cy="10" r="1.5"/><circle cx="10" cy="16" r="1.5"/>
                </svg>
              </button>
              {optionsDropdown && (
                <div className="tc-header-dropdown" style={{ right: 0, left: "auto", minWidth: 210 }} onClick={e => e.stopPropagation()}>
                  <div className="tc-header-dropdown-item" style={{ opacity: aktiveSim ? 1 : 0.4, cursor: aktiveSim ? "pointer" : "default" }}
                    onClick={() => aktiveSim && setExportSubOffen(o => !o)}>
                    <div>
                      <div style={{ fontWeight: 500 }}>Export</div>
                      <div style={{ fontSize: 9, color: "var(--tc-text-3)" }}>Tasks der aktiven Simulation</div>
                    </div>
                    <span>{exportSubOffen ? "▲" : "▼"}</span>
                  </div>
                  {exportSubOffen && aktiveSim && EXPORT_FORMATE.map(f => (
                    <div key={f.key} className="tc-header-dropdown-item" style={{ paddingLeft: 24, fontSize: 10 }}
                      onClick={() => { f.run(aktiveSim.tasks, aktiveSim.name, aktiveSim.kalender); setExportSubOffen(false); setOptionsDropdown(false); }}>
                      {f.label}
                    </div>
                  ))}
                  <div className="tc-header-dropdown-item" style={{ opacity: aktiveSim ? 1 : 0.4, cursor: aktiveSim ? "pointer" : "default" }}
                    onClick={() => { if (aktiveSim) { setKalenderManagerOffen(true); setOptionsDropdown(false); } }}>
                    <div>
                      <div style={{ fontWeight: 500 }}>Kalender / Feiertage</div>
                      <div style={{ fontSize: 9, color: "var(--tc-text-3)" }}>Arbeitstage der aktiven Simulation</div>
                    </div>
                  </div>
                  <div className="tc-header-dropdown-item" style={{ opacity: 0.4, cursor: "default" }}>
                    <div>
                      <div style={{ fontWeight: 500 }}>Ressourcen einrichten</div>
                      <div style={{ fontSize: 9, color: "var(--tc-text-3)" }}>Bald verfügbar</div>
                    </div>
                  </div>
                  <div className="tc-header-dropdown-item"
                    onClick={() => { setZugriffsManagerOffen(true); setOptionsDropdown(false); }}>
                    <div>
                      <div style={{ fontWeight: 500 }}>Zugriffskontrolle verwalten</div>
                      <div style={{ fontSize: 9, color: "var(--tc-text-3)" }}>Für alle Gruppen</div>
                    </div>
                  </div>
                </div>
              )}
            </div>
            {/* Sync Status */}
            <span title={syncStatus === "saved" ? "Cloud gespeichert" : syncStatus === "saving" ? "Speichern…" : syncStatus === "error" ? "Sync-Fehler" : ""}
              style={{ width: 8, height: 8, borderRadius: "50%", flexShrink: 0,
                background: syncStatus === "saved" ? "#6cc07a" : syncStatus === "saving" ? "#edb94c" : syncStatus === "error" ? "#ff6b6b" : "transparent",
                transition: "background 0.3s" }} />
          </div>
        </div>
      </div>

      {/* Speicher-Konflikt: jemand anderes hat zwischenzeitlich gespeichert */}
      {konflikt && (
        <div className="alert err" style={{ justifyContent: "space-between" }}>
          <span>⚠ Jemand anderes hat inzwischen gespeichert. Deine letzten Änderungen wurden noch nicht übernommen.</span>
          <button className="tc-btn-primary" style={{ fontSize: 10, padding: "3px 10px", flexShrink: 0, marginLeft: 8 }}
            onClick={konfliktAufloesen}>
            ↻ Neu laden
          </button>
        </div>
      )}

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
            projectId={projectId}
            aktiveSim={aktiveSim}
            updateSim={updateSim}
            selektion={selektion}
            aktivesModellId={aktivesModellId}
            taskSort={taskSort}
            readOnly={readOnly}
            sharedNadelTag={sharedNadelTag}
            sichtbar={aktTab === "bauteile"}
          />
        </div>
        <div style={{ display: aktTab === "abspielen" ? "block" : "none" }}>
          <TabAbspielen
            api={api}
            projectId={projectId}
            aktiveSim={aktiveSim}
            aktivesModellId={aktivesModellId}
            taskSort={taskSort}
            sharedNadelTag={sharedNadelTag}
          />
        </div>
      </div>

      {zugriffsManagerOffen && <ZugriffskontrollManager api={api} onClose={() => setZugriffsManagerOffen(false)} />}
      {kalenderManagerOffen && aktiveSim && <KalenderManager sim={aktiveSim} updateSim={updateSim} onClose={() => setKalenderManagerOffen(false)} />}
    </div>
  );
}
