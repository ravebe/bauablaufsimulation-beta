import { useState, useEffect, useRef } from "react";
import { useApi } from "./hooks/useApi";
import { useAuth } from "./hooks/useAuth";
import { useCloudSync } from "./hooks/useCloudSync";
import { usePresence } from "./hooks/usePresence";
import { useUndo } from "./hooks/useUndo";
import { useAusgeschlosseneAusblenden } from "./hooks/useAusgeschlosseneAusblenden";
import { fehlerKontextSetzen } from "./hooks/fehlerMelden";
import type { SimProjekt } from "./types";
import { darfBearbeiten, istSichtbar } from "./zugriff";
import TabProjekte from "./components/TabProjekte";
import TabBauteile from "./components/TabBauteile";
import TabAbspielen from "./components/TabAbspielen";
import TabKalkulation from "./components/TabKalkulation";
import TabRessourcen from "./components/TabRessourcen";
import TabAvor from "./components/TabAvor";
import TabKosten from "./components/TabKosten";
import ZugriffskontrollManager from "./components/ZugriffskontrollManager";
import KalenderManager from "./components/KalenderManager";
import IfcExportDialog from "./components/IfcExportDialog";
import HilfeManager from "./components/HilfeManager";
import VersionsVerlauf from "./components/VersionsVerlauf";
import FehlerGrenze from "./components/FehlerGrenze";
import { useClickOutside } from "./hooks/useClickOutside";
import { stelleSimWiederHer } from "./hooks/syncHelpers";
import "./App.css";

export type Tab = "projekte" | "bauteile" | "abspielen" | "kalkulation" | "ressourcen" | "avor" | "kosten";
export type TabGruppe = "haupt" | "erweitert";
const HAUPT_TABS: Tab[] = ["projekte", "bauteile", "abspielen"];


export default function App() {
  const { api, ready, selektion, aktivesModellId, geladeneModelle, projectId } = useApi();

  const [aktTab, setAktTab] = useState<Tab>("projekte");
  const [tabGruppe, setTabGruppe] = useState<TabGruppe>("haupt");
  const lastHauptTab = useRef<Tab>("projekte");
  const lastErweitertTab = useRef<Tab>("ressourcen");
  useEffect(() => {
    if (HAUPT_TABS.includes(aktTab)) lastHauptTab.current = aktTab;
    else lastErweitertTab.current = aktTab;
  }, [aktTab]);
  const [sims, setSims] = useState<SimProjekt[]>([]);
  const [aktivId, setAktivId] = useState<string | null>(null);
  const sharedNadelTag = useRef<number>(-1);

  // Logik in eigenen Bausteinen (hooks/): Benutzer, Laden/Speichern, Anwesenheit, Rückgängig
  const { userId, userName, userEmail, userFehler, erneutVersuchen: benutzerErneutVersuchen } = useAuth(api);
  // Alle Benutzer-Änderungen laufen über useUndo (updateSim / setSimsMitUndo) → rückgängig machbar
  const { updateSim, setSimsMitUndo, undo, redo, undoLen, redoLen, verlaufLeeren } = useUndo(sims, setSims, userName);
  const { syncStatus, syncFehler, geladen: cloudLoadDone, konflikt, konfliktAufloesen, ladeFehler, ladeHinweis, ladeHinweisSchliessen, erneutLaden } =
    useCloudSync({ api, ready, projectId, sims, setSims, aktivId, setAktivId, onStandErsetzt: verlaufLeeren });
  // Frühere Versionen: undefined = zu, null = alle Simulationen, sonst nur diese Simulation
  const [verlaufSimId, setVerlaufSimId] = useState<string | null | undefined>(undefined);
  // Fehlermeldungen (hooks/fehlerMelden.ts) brauchen Projekt + Benutzer für Zuordnung und Anmeldung
  useEffect(() => { fehlerKontextSetzen({ api, projectId, benutzer: userEmail ?? userName }); }, [api, projectId, userEmail, userName]);

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

  // Zugriffskontrolle — Regeln zentral in zugriff.ts
  const readOnly = !darfBearbeiten(aktiveSim, userId);
  const andererBearbeiter = usePresence(api, aktiveSim, userId, userName);
  // Aus der Simulation entfernte Bauteile im Modell ausgeblendet halten (Tab Bauteile → "Aus Simulation entfernt")
  useAusgeschlosseneAusblenden(api, aktiveSim, geladeneModelle);
  // Nur Sims anzeigen die nicht "none" sind
  const sichtbareSims = sims.filter(s => istSichtbar(s, userId));

  const [headerDropdown, setHeaderDropdown] = useState(false);
  const [headerFilter, setHeaderFilter] = useState<"alle" | "meine" | "freigegeben">("alle");
  const [taskSort, setTaskSort] = useState<"gantt" | "datum" | "aktiv" | "name" | "nummer">("gantt");
  const [sortDropdown, setSortDropdown] = useState(false);
  const [optionsDropdown, setOptionsDropdown] = useState(false);
  const headerDropdownRef = useClickOutside<HTMLDivElement>(headerDropdown, () => setHeaderDropdown(false));
  // Simulation wechseln geht nur in Tab Projekte — Pfeil/Popup dort ausblenden und beim Verlassen
  // schliessen, falls er gerade offen war.
  useEffect(() => { if (aktTab !== "projekte") setHeaderDropdown(false); }, [aktTab]);
  const sortDropdownRef = useClickOutside<HTMLDivElement>(sortDropdown, () => setSortDropdown(false));
  const optionsDropdownRef = useClickOutside<HTMLDivElement>(optionsDropdown, () => setOptionsDropdown(false));
  const [zugriffsManagerOffen, setZugriffsManagerOffen] = useState(false);
  // Dialoge je Simulation (aus dem ⋮ der Simulationskarte bzw. Tab Bauteile/Abspielen für die aktive)
  const [kalenderSimId, setKalenderSimId] = useState<string | null>(null);
  const [ifcExportSimId, setIfcExportSimId] = useState<string | null>(null);
  const kalenderSim = kalenderSimId ? sims.find(s => s.id === kalenderSimId) ?? null : null;
  const ifcExportSim = ifcExportSimId ? sims.find(s => s.id === ifcExportSimId) ?? null : null;
  const aktiveIfcExport = aktiveSim ? () => setIfcExportSimId(aktiveSim.id) : undefined;
  const [hilfeOffen, setHilfeOffen] = useState(false);

  const appRef = useRef<HTMLDivElement>(null);
  const [maximiert, setMaximiert] = useState(false);
  useEffect(() => {
    const onChange = () => setMaximiert(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);
  async function maximierenUmschalten() {
    try {
      if (!document.fullscreenElement) await appRef.current?.requestFullscreen();
      else await document.exitFullscreen();
    } catch { /* vom TC-Host evtl. nicht erlaubt */ }
  }

  const tabToggleButton = (
    <button className="tc-tab-toggle" title={tabGruppe === "haupt" ? "Kalkulation / Ressourcen / Kosten anzeigen" : "Projekte / Bauteile / Abspielen anzeigen"}
      onClick={() => {
        const neueGruppe: TabGruppe = tabGruppe === "haupt" ? "erweitert" : "haupt";
        setTabGruppe(neueGruppe);
        setAktTab(neueGruppe === "haupt" ? lastHauptTab.current : lastErweitertTab.current);
      }}>
      <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" width="14" height="14"
        style={{ display: "inline-block", transform: `rotate(${tabGruppe === "haupt" ? -90 : 90}deg)`, transition: "transform .15s" }}>
        <path d="M4 6l4 4 4-4"/>
      </svg>
    </button>
  );

  return (
    <div ref={appRef} className="tc-app" onClick={() => { setHeaderDropdown(false); setSortDropdown(false); setOptionsDropdown(false); }}>
      {/* Header — Organizer Style */}
      <div className="tc-header-org">
        <div className="tc-header-org-top">
          <div style={{ flex: 1 }}>
            <div className="tc-header-org-title">
              <span className="tc-logo">{tabGruppe === "erweitert" ? "5D" : "4D"}</span> Simulationen
            </div>
            <div ref={headerDropdownRef}>
            <div className={`tc-header-org-sub ${aktTab === "projekte" ? "" : "static"}`}
              onClick={aktTab === "projekte" ? (e => { e.stopPropagation(); setHeaderDropdown(d => !d); setSortDropdown(false); }) : undefined}>
              {aktiveSim ? aktiveSim.name : "Kein Projekt"}{aktTab === "projekte" && ` ${headerDropdown ? "▲" : "▼"}`}
            </div>
            {andererBearbeiter && (
              <div style={{ fontSize: 10, color: "#e8a023", marginTop: 2 }} title="Bearbeitet diese Simulation gerade ebenfalls">
                👥 {andererBearbeiter} ist auch in dieser Simulation
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
          </div>
          <div className="tc-header-org-actions">
            <button className="tc-header-icon-btn" title="Rückgängig" disabled={undoLen === 0}
              onClick={undo} style={{ opacity: undoLen === 0 ? 0.3 : 1 }}>
              <svg viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8">
                <path d="M4 10l4-4M4 10l4 4M5 10h9a3 3 0 0 1 0 6H12"/>
              </svg>
            </button>
            <button className="tc-header-icon-btn" title="Wiederherstellen" disabled={redoLen === 0}
              onClick={redo} style={{ opacity: redoLen === 0 ? 0.3 : 1 }}>
              <svg viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8">
                <path d="M16 10l-4-4M16 10l-4 4M15 10H6a3 3 0 0 0 0 6h3"/>
              </svg>
            </button>
            <div ref={sortDropdownRef} style={{ position: "relative" }}>
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
            <div ref={optionsDropdownRef} style={{ position: "relative" }}>
              <button className="tc-header-icon-btn" title="Optionen"
                onClick={e => { e.stopPropagation(); setOptionsDropdown(d => !d); setHeaderDropdown(false); setSortDropdown(false); }}>
                <svg viewBox="0 0 20 20" width="18" height="18" fill="currentColor">
                  <circle cx="10" cy="4" r="1.5"/><circle cx="10" cy="10" r="1.5"/><circle cx="10" cy="16" r="1.5"/>
                </svg>
              </button>
              {optionsDropdown && (
                <div className="tc-header-dropdown" style={{ right: 0, left: "auto", minWidth: 210 }} onClick={e => e.stopPropagation()}>
                  {/* Export, Kalender, Frühere Versionen: im ⋮ der Simulationskarte (Tab Projekt); Export auch im ⋮ von Tab Bauteile/Abspielen */}
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
            <button className="tc-header-icon-btn" title={maximiert ? "Verkleinern" : "Vergrössern"}
              onClick={e => { e.stopPropagation(); maximierenUmschalten(); }}>
              <svg viewBox="0 0 20 20" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M2 7V2h5"/>
                <path d="M13 2h5v5"/>
                <path d="M2 13v5h5"/>
                <path d="M18 13v5h-5"/>
              </svg>
            </button>
            <button className="tc-header-icon-btn" title="Hilfe zu diesem Tab"
              onClick={e => { e.stopPropagation(); setHilfeOffen(true); }}>
              <svg viewBox="0 0 20 20" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.5">
                <circle cx="10" cy="10" r="7.5"/>
                <path d="M7.8 8a2.2 2.2 0 1 1 3.2 2c-.7.5-1 .9-1 1.7v.3" strokeLinecap="round"/>
                <circle cx="10" cy="14.3" r="0.15" fill="currentColor"/>
              </svg>
            </button>
            {/* Sync Status */}
            <span title={syncStatus === "saved" ? "Cloud gespeichert" : syncStatus === "saving" ? "Speichern…" : syncStatus === "error" ? `Nicht gespeichert: ${syncFehler ?? "Sync-Fehler"}` : api && !cloudLoadDone ? "Cloud-Daten werden geladen — gespeichert wird erst danach" : ""}
              style={{ width: 8, height: 8, borderRadius: "50%", flexShrink: 0,
                background: syncStatus === "saved" ? "#6cc07a" : syncStatus === "saving" ? "#edb94c" : syncStatus === "error" ? "var(--tc-red)" : api && !cloudLoadDone ? "#b8c2cc" : "transparent",
                transition: "background 0.3s" }} />
          </div>
        </div>
      </div>

      {/* Cloud beim Start nicht erreichbar → lokaler Stand sichtbar, Speichern pausiert */}
      {ladeFehler && (
        <div className="alert err" style={{ justifyContent: "space-between", gap: 8 }}>
          <span title={ladeFehler}>⚠ Cloud nicht erreichbar ({ladeFehler}) — angezeigt wird die lokale Kopie, Änderungen werden nicht gespeichert.</span>
          <button className="tc-btn-secondary" style={{ flexShrink: 0, height: 22, fontSize: 11 }}
            onClick={erneutLaden}>Erneut laden</button>
        </div>
      )}

      {ladeHinweis && (
        <div className="alert err" style={{ justifyContent: "space-between", gap: 8 }}>
          <span>⚠ {ladeHinweis}</span>
          <button className="tc-btn-secondary" style={{ flexShrink: 0, height: 22, fontSize: 11 }} onClick={ladeHinweisSchliessen}>OK</button>
        </div>
      )}

      {/* Benutzer nicht ermittelt → alles schreibgeschützt; sonst rätselt man, warum nichts mehr geht */}
      {userFehler && !userId && (
        <div className="alert err" style={{ justifyContent: "space-between", gap: 8 }}>
          <span title={userFehler}>⚠ Benutzer konnte nicht ermittelt werden ({userFehler}) — Bearbeiten, Löschen und Speichern sind gesperrt.</span>
          <button className="tc-btn-secondary" style={{ flexShrink: 0, height: 22, fontSize: 11 }}
            onClick={benutzerErneutVersuchen}>Erneut versuchen</button>
        </div>
      )}

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
        {tabGruppe === "erweitert" && tabToggleButton}
        {tabGruppe === "haupt" ? (<>
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
        </>) : (<>
          <button
            className={`tc-tab ${aktTab === "ressourcen" ? "active" : ""}`}
            onClick={() => setAktTab("ressourcen")}
          >
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" width="16" height="16">
              <circle cx="6" cy="5.5" r="2.3"/>
              <path d="M2 14c0-2.5 1.8-4.2 4-4.2s4 1.7 4 4.2M11 4c1.4 0 2.5 1.1 2.5 2.5S12.4 9 11 9M11.5 9.5c1.7 0 3 1.4 3 3.3"/>
            </svg>
            <span>Ressourcen</span>
          </button>
          <button
            className={`tc-tab ${aktTab === "kalkulation" ? "active" : ""}`}
            onClick={() => setAktTab("kalkulation")}
          >
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" width="16" height="16">
              <rect x="2.5" y="2" width="11" height="12" rx="0.8"/>
              <path d="M5 5.5h6M5 8h6M5 10.5h3.5"/>
            </svg>
            <span>Kalkulation</span>
          </button>
          <button
            className={`tc-tab ${aktTab === "avor" ? "active" : ""}`}
            onClick={() => setAktTab("avor")}
          >
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" width="16" height="16">
              <path d="M2 13.5h12M4 13.5V8M8 13.5V4.5M12 13.5V6.5"/>
            </svg>
            <span>AVOR</span>
          </button>
          <button
            className={`tc-tab ${aktTab === "kosten" ? "active" : ""}`}
            onClick={() => setAktTab("kosten")}
          >
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" width="16" height="16">
              <circle cx="8" cy="8" r="6"/>
              <path d="M9.8 6.2c-.3-.6-1-1-1.9-1-1.2 0-2.1.7-2.1 1.7s.9 1.4 2.1 1.6c1.2.2 2.1.6 2.1 1.6s-.9 1.7-2.1 1.7c-.9 0-1.6-.4-1.9-1M8 4.5v1M8 10.5v1"/>
            </svg>
            <span>Kosten</span>
          </button>
        </>)}
        {tabGruppe === "haupt" && tabToggleButton}
      </div>

      {/* Tab Content */}
      <div className="tc-tab-content">
        <div className="tc-tab-pane" style={{ display: aktTab === "projekte" ? "block" : "none" }}>
          <FehlerGrenze bereich="Tab Projekte">
            <TabProjekte
              api={api}
              ready={ready}
              laedt={!cloudLoadDone && !ladeFehler}
              sims={sichtbareSims}
              setSims={setSimsMitUndo}
              aktivId={aktivId}
              setAktivId={setAktivId}
              geladeneModelle={geladeneModelle}
              userId={userId}
              sichtbar={aktTab === "projekte"}
              onKalender={setKalenderSimId}
              onIfcExport={setIfcExportSimId}
              onVerlauf={setVerlaufSimId}
            />
          </FehlerGrenze>
        </div>
        <div className="tc-tab-pane" style={{ display: aktTab === "bauteile" ? "block" : "none" }}>
          <FehlerGrenze bereich="Tab Bauteile">
            <TabBauteile
              api={api}
              projectId={projectId}
              aktiveSim={aktiveSim}
              updateSim={updateSim}
              selektion={selektion}
              aktivesModellId={aktivesModellId}
              taskSort={taskSort}
              onTaskSort={setTaskSort}
              readOnly={readOnly}
              sharedNadelTag={sharedNadelTag}
              sichtbar={aktTab === "bauteile"}
              onIfcExport={aktiveIfcExport}
            />
          </FehlerGrenze>
        </div>
        <div className="tc-tab-pane" style={{ display: aktTab === "abspielen" ? "block" : "none" }}>
          <FehlerGrenze bereich="Tab Abspielen">
            <TabAbspielen
              api={api}
              projectId={projectId}
              aktiveSim={aktiveSim}
              aktivesModellId={aktivesModellId}
              taskSort={taskSort}
              sharedNadelTag={sharedNadelTag}
              onIfcExport={aktiveIfcExport}
            />
          </FehlerGrenze>
        </div>
        <div className="tc-tab-pane" style={{ display: aktTab === "kalkulation" ? "block" : "none" }}>
          <FehlerGrenze bereich="Tab Kalkulation">
            <TabKalkulation sim={aktiveSim} updateSim={updateSim} readOnly={readOnly} api={api} projectId={projectId} taskSort={taskSort} />
          </FehlerGrenze>
        </div>
        <div className="tc-tab-pane" style={{ display: aktTab === "ressourcen" ? "block" : "none" }}>
          <FehlerGrenze bereich="Tab Ressourcen">
            <TabRessourcen sim={aktiveSim} updateSim={updateSim} readOnly={readOnly} api={api} selektion={selektion} aktivesModellId={aktivesModellId} projectId={projectId} />
          </FehlerGrenze>
        </div>
        <div className="tc-tab-pane" style={{ display: aktTab === "avor" ? "block" : "none" }}>
          <FehlerGrenze bereich="Tab AVOR">
            <TabAvor sim={aktiveSim} updateSim={updateSim} readOnly={readOnly} projectId={projectId} api={api} sharedNadelTag={sharedNadelTag} />
          </FehlerGrenze>
        </div>
        <div className="tc-tab-pane" style={{ display: aktTab === "kosten" ? "block" : "none" }}>
          <FehlerGrenze bereich="Tab Kosten">
            <TabKosten sim={aktiveSim} projectId={projectId} api={api} sharedNadelTag={sharedNadelTag} />
          </FehlerGrenze>
        </div>
      </div>

      <FehlerGrenze bereich="Dialog">
      {zugriffsManagerOffen && <ZugriffskontrollManager api={api} onClose={() => setZugriffsManagerOffen(false)}
        sims={sims} setSims={setSimsMitUndo} aktivId={aktivId} onWechsel={setAktivId} userId={userId} userEmail={userEmail} />}
      {kalenderSim && <KalenderManager sim={kalenderSim} updateSim={updateSim} onClose={() => setKalenderSimId(null)} />}
      {ifcExportSim && <IfcExportDialog sim={ifcExportSim} updateSim={updateSim} readOnly={!darfBearbeiten(ifcExportSim, userId)} api={api} geladeneModelle={geladeneModelle} benutzer={userName} onClose={() => setIfcExportSimId(null)} />}
      {verlaufSimId !== undefined && <VersionsVerlauf api={api} sims={sims} nurSimId={verlaufSimId} darfBearbeiten={s => darfBearbeiten(s, userId)} onClose={() => setVerlaufSimId(undefined)}
        onWiederherstellen={(frueher, modus, standZeit) => setSimsMitUndo(prev => stelleSimWiederHer(prev, frueher, modus, standZeit, userId).sims)} />}
      {hilfeOffen && <HilfeManager initialTab={aktTab} onClose={() => setHilfeOffen(false)} />}
      </FehlerGrenze>
    </div>
  );
}
