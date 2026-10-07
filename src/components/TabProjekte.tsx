import { useState, useEffect, useRef } from "react";
import type { SimModell, SimProjekt, Task } from "../types";
import { darfBearbeiten as darfSimBearbeiten } from "../zugriff";
import type { ApiInstance } from "../hooks/useApi";
import GanttImport from "./GanttImport";
import AutoVerknuepfung from "./AutoVerknuepfung";
import AttributTaskErzeugung from "./AttributTaskErzeugung";
import SimKebabMenu from "./SimKebabMenu";
import ModellVersionen from "./ModellVersionen";
import { stelleVersionUm, wendeUmstellungAn } from "./modellVersionHelpers";
import IfcImportDialog from "./IfcImportDialog";
import type { IfcImportUebernahme } from "./IfcImportDialog";
import { enthaeltBauablauf } from "./ifcImport";
import { ladeTcDateiEnde } from "../hooks/tcDateien";

interface Props {
  api: ApiInstance | null;
  ready: boolean;
  sims: SimProjekt[];
  setSims: React.Dispatch<React.SetStateAction<SimProjekt[]>>;
  aktivId: string | null;
  setAktivId: (id: string) => void;
  geladeneModelle: { id: string; name: string }[];
  userId?: string | null;
  /** Tab "Projekte" ist gerade sichtbar — beim Wechsel wird der Verknüpfungs-Bereich zugeklappt */
  sichtbar?: boolean;
}

export default function TabProjekte({ api, sims, setSims, aktivId, setAktivId, userId, sichtbar = true }: Props) {
  const [aufgeklappt, setAufgeklappt] = useState<string | null>(aktivId);
  // Sim-ID, deren Verknüpfungs-Aktion (Auto-Verknüpfung / Attribut-Tasks) nach Klick auf den Umschalter
  // eingeblendet ist — Klick ausserhalb oder Tab-Wechsel blendet sie wieder aus (Komponente bleibt gemountet,
  // damit Eingaben und ein laufender Vorgang erhalten bleiben).
  const [verknuepfOffen, setVerknuepfOffen] = useState<string | null>(null);
  const verknuepfRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!verknuepfOffen) return;
    const handler = (e: MouseEvent) => {
      if (verknuepfRef.current && !verknuepfRef.current.contains(e.target as Node)) setVerknuepfOffen(null);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [verknuepfOffen]);
  if (!sichtbar && verknuepfOffen) setVerknuepfOffen(null);
  const [neuName, setNeuName] = useState("");
  const [zeigeNeu, setZeigeNeu] = useState(false);
  const [modellLaden, setModellLaden] = useState(false);
  const [modellMsg, setModellMsg] = useState<{ simId: string; typ: "ok" | "err"; text: string } | null>(null);
  const [modellPicker, setModellPicker] = useState<{
    simId: string;
    alle: { id: string; name: string; versionId?: string }[];
    ausgewaehlt: Set<string>;
  } | null>(null);
  const [kopierDialog, setKopierDialog] = useState<{
    simId: string; name: string; tasks: boolean; kalkulation: boolean; mengenWerte: boolean; kraene: boolean; modelle: boolean; stammdaten: boolean; kalender: boolean;
  } | null>(null);
  // modelId → in TC verfügbare, aber noch nicht geladene Versions-ID (neue Revision abgelegt)
  const [neueVersionen, setNeueVersionen] = useState<Record<string, string>>({});
  const [updateDialog, setUpdateDialog] = useState<{ simId: string; modellId: string; modellName: string; neueVersionId: string } | null>(null);
  const [versionWechselLaeuft, setVersionWechselLaeuft] = useState(false);
  const [importAngebot, setImportAngebot] = useState<{ simId: string; modell: SimModell } | null>(null);
  // Immer aktueller Stand für das Polling-Interval unten — verhindert, dass dessen Closure einen
  // veralteten sims-Stand aus dem Render beim Effekt-Setup festhält (Intervall wird bewusst NICHT
  // bei jeder sims-Änderung neu gestartet, siehe exhaustive-deps-Kommentar dort).
  const simsRef = useRef(sims);
  useEffect(() => { simsRef.current = sims; }, [sims]);

  // Vergleicht die in TC aktuell verfügbare Versions-ID jedes zugewiesenen Modells mit der
  // gepinnten Version in der Simulation — bei Abweichung (neue Revision abgelegt) wird das
  // NICHT automatisch geladen, sondern nur für den "Aktualisieren"-Button vorgemerkt.
  async function pruefeNeueVersionen(sim: SimProjekt) {
    if (!api || sim.modelle.length === 0) return;
    try {
      const alle = await api.viewer.getModels();
      const byId = new Map(alle.map(m => [m.id, m]));
      setNeueVersionen(prev => {
        const next = { ...prev };
        for (const m of sim.modelle) {
          const aktuell = byId.get(m.id);
          if (aktuell?.versionId && m.versionId && aktuell.versionId !== m.versionId) {
            next[m.id] = aktuell.versionId;
          } else {
            delete next[m.id];
          }
        }
        return next;
      });
    } catch { /* ignore */ }
  }

  // Solange eine Simulationskarte offen ist, regelmäßig auf neue Modell-Revisionen prüfen
  useEffect(() => {
    if (!aufgeklappt || !api) return;
    const iv = setInterval(() => {
      const sim = simsRef.current.find(s => s.id === aufgeklappt);
      if (sim) pruefeNeueVersionen(sim);
    }, 60000);
    return () => clearInterval(iv);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aufgeklappt, api]);

  async function modellAktualisieren() {
    if (!updateDialog) return;
    const { simId, modellId, neueVersionId } = updateDialog;
    setUpdateDialog(null);
    await versionWechseln(simId, modellId, neueVersionId);
  }

  /** Simulation auf eine andere Modellversion umstellen und die Bauteil-Zuordnungen über die IFC-GUIDs
   *  mitnehmen (Runtime-IDs ändern sich je Version). Reparatur (quelleVersionId gesetzt): Zuordnungen
   *  stammen aus quelleVersionId, die Simulation bleibt auf ihrer aktiven Version. */
  async function versionWechseln(simId: string, modellId: string, zielVersionId: string, quelleVersionId?: string) {
    const sim = simsRef.current.find(s => s.id === simId);
    const modell = sim?.modelle.find(m => m.id === modellId);
    if (!api || !sim || !modell) return;
    const reparatur = quelleVersionId !== undefined;
    const quelle = reparatur ? quelleVersionId : modell.versionId;
    setVersionWechselLaeuft(true);
    const status = (text: string) => setModellMsg({ simId, typ: "ok", text: `⟳ ${text}` });
    try {
      const u = await stelleVersionUm(api, modellId, quelle, zielVersionId, sim.tasks, status);
      setSims(prev => prev.map(s => s.id === simId ? {
        ...s,
        tasks: wendeUmstellungAn(s.tasks, u.mapping),
        modelle: s.modelle.map(m => m.id === modellId ? { ...m, versionId: zielVersionId } : m),
      } : s));
      setNeueVersionen(prev => { const next = { ...prev }; delete next[modellId]; return next; });
      setModellMsg({ simId, typ: "ok", text: `✓ ${reparatur ? "Zuordnungen repariert" : "Version gewechselt"} — ${u.umgestellt} Bauteil-Zuordnung(en) übertragen`
        + (u.nichtGefunden ? `, ${u.nichtGefunden} in dieser Version nicht vorhanden (unverändert gelassen)` : "") });
    } catch (e) {
      // Viewer wieder auf die (unveränderte) gepinnte Version zurück
      try { await api.viewer.toggleModelVersion({ id: modellId, versionId: modell.versionId }, true, false); } catch { /* ignore */ }
      setModellMsg({ simId, typ: "err", text: `${reparatur ? "Reparatur" : "Versionswechsel"} fehlgeschlagen: ${e instanceof Error ? e.message : String(e)} — die Simulation ist unverändert.` });
    } finally {
      setVersionWechselLaeuft(false);
    }
  }

  async function toggleAufgeklappt(id: string) {
    const warOffen = aufgeklappt === id;
    const neuerStatus = warOffen ? null : id;
    setAufgeklappt(neuerStatus);

    // Nur laden wenn Sim NEU geöffnet wird (nicht beim Schließen)
    if (!warOffen && neuerStatus && api) {
      const sim = sims.find(s => s.id === id);
      if (sim && sim.modelle.length > 0) {
        pruefeNeueVersionen(sim);
        const valid = sim.modelle.filter(m =>
          m.id && !m.id.startsWith('model-') && m.id !== 'undefined'
        );
        if (valid.length === 0) return;
        setModellMsg({ simId: id, typ: "ok", text: `⟳ ${valid.length} Modelle werden geladen…` });
        let loaded = 0;
        for (const m of valid) {
          try {
            await api.viewer.toggleModelVersion({ id: m.id, versionId: m.versionId }, true, false);
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
      const alle = await api.viewer.getModels();
      const alleFormatiert = alle.map((m, i) => ({
        id: m.id || (m as any).modelId || `model-${i}`,
        name: m.name || (m as any).fileName || m.id || `Modell ${i + 1}`,
        versionId: m.versionId,
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
    const bisher = new Set(sims.find(s => s.id === modellPicker.simId)?.modelle.map(m => m.id) ?? []);
    setSims(prev => prev.map(s =>
      s.id === modellPicker.simId ? { ...s, modelle: ausgewaehlt } : s
    ));
    setModellMsg({ simId: modellPicker.simId, typ: "ok", text: `✓ ${ausgewaehlt.length} Modelle gespeichert` });
    setModellPicker(null);
    pruefeAufBauablauf(modellPicker.simId, ausgewaehlt.filter(m => !bisher.has(m.id)));
  }

  /** Neu hinzugefügte IFC-Modelle auf einen hinterlegten Bauablauf prüfen (nur das Dateiende laden —
   *  dort liegen die vom IFC-4D-Export angehängten Daten) und ggf. die Übernahme anbieten. */
  async function pruefeAufBauablauf(simId: string, neu: SimModell[]) {
    if (!api) return;
    for (const m of neu.filter(x => /\.ifc$/i.test(x.name))) {
      try {
        setModellMsg({ simId, typ: "ok", text: `⟳ Prüfe ${m.name} auf hinterlegten Bauablauf…` });
        if (enthaeltBauablauf(await ladeTcDateiEnde(api, m.id, m.versionId))) { setImportAngebot({ simId, modell: m }); break; }
      } catch { /* Prüfung ist optional — ohne Zugriff einfach kein Angebot */ }
    }
    setModellMsg(prev => prev?.text.startsWith("⟳ Prüfe") ? { simId, typ: "ok", text: `✓ ${neu.length} Modell(e) hinzugefügt` } : prev);
  }

  function bauablaufUebernehmen(simId: string, modellName: string, u: IfcImportUebernahme) {
    setSims(prev => prev.map(s => {
      if (s.id !== simId) return s;
      // Kräne über den Namen mit bestehenden zusammenführen
      const kraene = [...(s.kraene ?? [])];
      const kranMap = new Map<string, string>();
      for (const k of u.kraene) {
        const vorhanden = kraene.find(x => x.name === k.name);
        if (vorhanden) kranMap.set(k.id, vorhanden.id); else { kraene.push(k); kranMap.set(k.id, k.id); }
      }
      const tasks = u.tasks.map(t => t.kraene ? { ...t, kraene: t.kraene.map(id => kranMap.get(id) ?? id) } : t);
      const kalenderLeer = !s.kalender || (s.kalender.feiertage.length === 0 && (s.kalender.ferien ?? []).length === 0);
      return {
        ...s, tasks, kraene,
        kalender: kalenderLeer && u.kalender ? u.kalender : s.kalender,
        ganttImport: { dateiname: `${modellName} (IFC)`, version: (s.ganttImport?.version ?? 0) + 1 },
        autoVerknuepft: true,
      };
    }));
    setModellMsg({ simId, typ: "ok", text: `✓ Bauablauf übernommen — ${u.bericht.tasks} Tasks, ${u.bericht.bauteile} Bauteile zugeordnet`
      + (u.bericht.nichtGefunden ? `, ${u.bericht.nichtGefunden} Bauteile im Modell nicht gefunden` : "") });
    setImportAngebot(null);
  }

  function modellToggle(id: string) {
    if (!modellPicker) return;
    const neu = new Set(modellPicker.ausgewaehlt);
    neu.has(id) ? neu.delete(id) : neu.add(id);
    setModellPicker({ ...modellPicker, ausgewaehlt: neu });
  }

  function simKopieren() {
    if (!kopierDialog) return;
    const orig = sims.find(s => s.id === kopierDialog.simId);
    if (!orig) return;

    let tasks: Task[] = [];
    if (kopierDialog.tasks) {
      tasks = structuredClone(orig.tasks);
      if (!kopierDialog.kalkulation) {
        for (const t of tasks) {
          delete t.bauteilKuerzel; delete t.kranbereich;
          delete t.mengen; delete t.mengenQuelle; delete t.mengenInfo; delete t.mengenObjekte;
        }
      } else if (!kopierDialog.mengenWerte) {
        // Bauteil-Kürzel/Kranbereich bleiben erhalten, aber Mengen-Werte (berechnet + manuell
        // gesetzt) NICHT — die Kopie berechnet sie über "Mengen aus Bauteilen berechnen" neu.
        for (const t of tasks) {
          delete t.mengen; delete t.mengenQuelle; delete t.mengenInfo; delete t.mengenObjekte;
        }
      }
      // Kräne unabhängig von der Kalkulation-Zuordnung: ohne mitkopierte Kran-Stammdaten (unten)
      // wären Task.kraene-IDs Verweise ins Leere, darum hier separat entfernt.
      if (!kopierDialog.kraene) {
        for (const t of tasks) delete t.kraene;
      }
    }

    const kopie: SimProjekt = {
      id: crypto.randomUUID(),
      name: kopierDialog.name.trim() || `${orig.name} (Kopie)`,
      erstelltAm: new Date().toISOString(),
      erstellerId: userId || undefined,
      tasks,
      ganttImport: kopierDialog.tasks ? orig.ganttImport : undefined,
      modelle: kopierDialog.modelle ? structuredClone(orig.modelle) : [],
      kalender: kopierDialog.kalender && orig.kalender ? structuredClone(orig.kalender) : undefined,
      stammdaten: kopierDialog.stammdaten && orig.stammdaten ? structuredClone(orig.stammdaten) : undefined,
      kraene: kopierDialog.kraene && orig.kraene ? structuredClone(orig.kraene) : undefined,
      zeitraster: kopierDialog.kraene ? orig.zeitraster : undefined,
    };
    setSims(prev => [kopie, ...prev]);
    setAktivId(kopie.id);
    setAufgeklappt(kopie.id);
    setKopierDialog(null);
  }

  function loeschen(simId: string) {
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

  // Aktive Simulation zuoberst, Reihenfolge der übrigen bleibt erhalten
  const angezeigteSims = [...sims].sort((a, b) => {
    if (a.id === aktivId) return -1;
    if (b.id === aktivId) return 1;
    return 0;
  });

  return (
    <div className="tc-setup-content">

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
      {angezeigteSims.map(sim => {
        const offen = aufgeklappt === sim.id;
        const istAktiv = aktivId === sim.id;
        // Personen mit "edit" haben dieselben Rechte wie der Ersteller — Regeln in zugriff.ts
        const darfBearbeiten = darfSimBearbeiten(sim, userId);

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
                <div className="sim-card-name-wrap">
                  <div className="sim-card-name">{sim.name}</div>
                  <div className="sim-card-meta">
                    {fmt(sim.erstelltAm)} · {sim.tasks.length} Tasks
                    {sim.modelle.length > 0 && ` · ${sim.modelle.length} Modell${sim.modelle.length > 1 ? "e" : ""}`}
                  </div>
                </div>
              </div>
              <div className="sim-card-right">
                {istAktiv && <span className="sim-aktiv-badge">Aktiv</span>}
                {offen && (
                  <SimKebabMenu
                    sim={sim}
                    darfBearbeiten={darfBearbeiten}
                    onKopieren={() => setKopierDialog({ simId: sim.id, name: `${sim.name} (Kopie)`, tasks: true, kalkulation: true, mengenWerte: true, kraene: true, modelle: true, stammdaten: true, kalender: true })}
                    onUmbenennen={(neuerName: string) => setSims(prev => prev.map(s => s.id === sim.id ? { ...s, name: neuerName } : s))}
                    onLoeschen={() => loeschen(sim.id)}
                  />
                )}
                <span className="sim-chevron">{offen ? "▲" : "▼"}</span>
              </div>
            </div>

            {/* Sim Body */}
            {offen && (() => {
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
                          const alle = await api.viewer.getModels();
                          const geladen = alle.filter(m => m.state === 'loaded');
                          for (const m of geladen) {
                            const mid = m.id || (m as any).modelId;
                            if (mid && !simIds.has(mid)) {
                              try {
                                await api.viewer.toggleModelVersion({ id: mid, versionId: m.versionId }, false, false);
                              } catch { /* ignore */ }
                            }
                          }
                        } catch { /* ignore */ }

                        let loaded = 0;
                        for (const m of valid) {
                          try {
                            await api.viewer.toggleModelVersion({ id: m.id, versionId: m.versionId }, true, false);
                            loaded++;
                          } catch { /* ignore */ }
                        }
                        pruefeNeueVersionen(sim);
                        setModellMsg({ simId: sim.id, typ: "ok", text: `✓ ${loaded} Modelle geladen` });
                      }
                    }}>
                    ✓ Als aktive Simulation setzen
                  </button>
                )}

                {/* Gantt — Ersteller oder Personen mit Bearbeitungs-Zugriff können importieren; Gantt-Vorlage/Export liegen im ⋮-Menü der Karte */}
                {darfBearbeiten && (
                <>
                <div className="tc-section-label" style={{ marginBottom: 4 }}>Gantt</div>
                <GanttImport
                  onImport={(tasks, dateiname) => setSims(prev =>
                    prev.map(s => s.id === sim.id ? {
                      ...s, tasks, autoVerknuepft: false,
                      ganttImport: { dateiname, version: (s.ganttImport?.version ?? 0) + 1 },
                    } : s)
                  )}
                  taskCount={sim.tasks.length}
                  ganttInfo={sim.ganttImport}
                />

                {sim.modelle.length > 0 && (() => {
                  const offen = verknuepfOffen === sim.id;
                  return (
                <div ref={offen ? verknuepfRef : undefined}>
                  <div style={{ display: "flex", gap: 4, marginTop: 6 }}>
                    {([
                      { modus: "auto" as const, label: "🔗 Auto-Verknüpfung", disabled: !sim.ganttImport,
                        hinweis: sim.autoVerknuepft
                          ? "Die Auto-Verknüpfung wurde bereits ausgeführt. Erneutes Ausführen kann bestehende Bauteil-Zuweisungen überschreiben."
                          : null },
                      { modus: "attribut" as const, label: "🏷️ Attribut-Tasks", disabled: false,
                        hinweis: sim.attributTasksErzeugt
                          ? "Attribut-Tasks wurden bereits erzeugt. Erneutes Erzeugen aktualisiert diese Tasks; nicht mehr vorkommende Kombinationen werden entfernt."
                          : null },
                    ]).map(({ modus, label, disabled, hinweis }) => {
                      const aktiv = offen && (sim.verknuepfungsModus ?? "auto") === modus;
                      return (
                        <button key={modus} disabled={disabled} title={hinweis ?? undefined}
                          onClick={() => {
                            if (aktiv) { setVerknuepfOffen(null); return; }
                            setSims(prev => prev.map(s => s.id === sim.id && (s.verknuepfungsModus ?? "auto") !== modus ? { ...s, verknuepfungsModus: modus } : s)); // unverändert → kein Rückgängig-Schritt
                            setVerknuepfOffen(sim.id);
                          }}
                          style={{
                            flex: 1, padding: "3px 6px", fontSize: 10, fontFamily: "inherit",
                            cursor: disabled ? "not-allowed" : "pointer",
                            background: disabled ? "#f3f4f6" : aktiv ? "#e3f0fb" : "#fff",
                            color: disabled ? "#aaa" : aktiv ? "#1f639c" : "#555",
                            border: `1px solid ${disabled ? "#e4e7ea" : aktiv ? "#8fc0e8" : "#d4dce4"}`, borderRadius: 3,
                            display: "flex", alignItems: "center", justifyContent: "center", gap: 4,
                          }}>
                          {label}
                        </button>
                      );
                    })}
                  </div>
                  {offen && (() => {
                    const hinweis = (sim.verknuepfungsModus ?? "auto") === "auto"
                      ? (sim.autoVerknuepft ? "Die Auto-Verknüpfung wurde bereits ausgeführt — erneutes Ausführen kann bestehende Bauteil-Zuweisungen überschreiben." : null)
                      : (sim.attributTasksErzeugt ? "Attribut-Tasks wurden bereits erzeugt — erneutes Erzeugen aktualisiert diese Tasks." : null);
                    return hinweis ? (
                      <div style={{ marginTop: 6, fontSize: 10, color: "#9A3412", background: "#FFE8CC", border: "1px solid #F8C58C", padding: "4px 6px" }}>
                        {hinweis}
                      </div>
                    ) : null;
                  })()}
                  <div style={{ display: offen ? "block" : "none" }}>

                {(sim.verknuepfungsModus ?? "auto") === "auto" && !sim.ganttImport && sim.modelle.length > 0 && (
                  <div className="alert info" style={{ marginTop: 6 }}>
                    ℹ Bitte zuerst einen Gantt-Zeitplan importieren, oder mit "Attribut-Tasks" weiterarbeiten.
                  </div>
                )}

                {(sim.verknuepfungsModus ?? "auto") === "auto" && !!sim.ganttImport && sim.tasks.length > 0 && sim.modelle.length > 0 && (
                  <AutoVerknuepfung
                    api={api}
                    sim={sim}
                    onUpdate={tasks => setSims(prev =>
                      prev.map(s => s.id === sim.id ? { ...s, tasks, autoVerknuepft: true } : s)
                    )}
                    done={sim.autoVerknuepft}
                  />
                )}

                {sim.verknuepfungsModus === "attribut" && sim.modelle.length > 0 && (
                  <AttributTaskErzeugung
                    api={api}
                    sim={sim}
                    onUpdate={(tasks, konfig) => setSims(prev =>
                      prev.map(s => s.id === sim.id ? { ...s, tasks, attributTasksErzeugt: true, attributKonfig: konfig } : s)
                    )}
                    done={sim.attributTasksErzeugt}
                  />
                )}
                  </div>
                </div>
                  );
                })()}

                <div className="tc-divider" />
                </>
                )}

                {/* Modelle — Liste immer sichtbar, Auswahl nur für Ersteller */}
                <div className="tc-section-label" style={{ marginBottom: 6 }}>
                  Modelle{sim.modelle.length > 0 ? ` (${sim.modelle.length})` : ""}
                </div>

                {sim.modelle.length > 0 && (
                  <div style={{ marginBottom: 6 }}>
                    {sim.modelle.map(m => {
                      const neueVersion = neueVersionen[m.id];
                      return (
                      <div key={m.id} className="modell-row">
                        <svg viewBox="0 0 24 24" width="18" height="18" style={{ flexShrink: 0 }}>
                          <path d="M12 2L2 7v10l10 5 10-5V7L12 2z" fill="none" stroke="#2d7dbd" strokeWidth="1.5"/>
                          <path d="M12 22V12M2 7l10 5 10-5" fill="none" stroke="#2d7dbd" strokeWidth="1.2"/>
                        </svg>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div className="modell-name">{m.name}</div>
                          <div className="modell-id">
                            {m.id}{m.versionId && ` · Version ${m.versionId.slice(0, 8)}`}
                          </div>
                        </div>
                        {neueVersion && darfBearbeiten && (
                          <button className="tc-btn-secondary" style={{ flexShrink: 0, fontSize: 9, padding: "3px 8px", color: "#b8860b", borderColor: "#e8c66b" }}
                            disabled={versionWechselLaeuft}
                            onClick={() => setUpdateDialog({ simId: sim.id, modellId: m.id, modellName: m.name, neueVersionId: neueVersion })}
                            title="In Trimble Connect wurde eine neue Revision abgelegt"
                          >⟳ Aktualisieren</button>
                        )}
                        <ModellVersionen api={api} modell={m} darfBearbeiten={darfBearbeiten} beschaeftigt={versionWechselLaeuft}
                          onWechseln={ziel => versionWechseln(sim.id, m.id, ziel)}
                          onReparieren={quelle => m.versionId && versionWechseln(sim.id, m.id, m.versionId, quelle)} />
                      </div>
                      );
                    })}
                  </div>
                )}

                {darfBearbeiten && (
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

      {kopierDialog && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.4)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center" }}
          onClick={() => setKopierDialog(null)}>
          <div style={{ background: "#fff", width: 420, maxWidth: "92vw", boxShadow: "0 8px 30px rgba(0,0,0,.25)", fontFamily: "var(--tc-font)" }}
            onClick={e => e.stopPropagation()}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 18px", borderBottom: "1px solid var(--tc-border-light)" }}>
              <div style={{ fontSize: 16, fontWeight: 700, color: "var(--tc-text)" }}>Simulation kopieren</div>
              <button className="tc-btn-ghost" style={{ fontSize: 14, padding: "2px 8px" }} onClick={() => setKopierDialog(null)}>✕</button>
            </div>
            <div style={{ padding: "16px 18px" }}>
              <div style={{ fontSize: 9, fontWeight: 600, color: "var(--tc-text-3)", letterSpacing: ".5px", marginBottom: 6 }}>NAME DER KOPIE</div>
              <input className="tc-input" style={{ width: "100%", marginBottom: 16, boxSizing: "border-box" }}
                value={kopierDialog.name} autoFocus
                onChange={e => setKopierDialog({ ...kopierDialog, name: e.target.value })}
                onKeyDown={e => e.key === "Enter" && simKopieren()} />

              <div style={{ fontSize: 9, fontWeight: 600, color: "var(--tc-text-3)", letterSpacing: ".5px", marginBottom: 8 }}>ZU KOPIERENDE INHALTE</div>
              {([
                { key: "tasks", label: "Bauablauf (Tasks, Termine, Struktur)", indent: 0, disabled: false },
                { key: "kalkulation", label: "Bauteil-Kürzel & Kranbereich (Kalkulation-Zuordnung)", indent: 1, disabled: !kopierDialog.tasks },
                { key: "mengenWerte", label: "Berechnete & manuelle Mengen-Werte je Task", indent: 2, disabled: !kopierDialog.tasks || !kopierDialog.kalkulation },
                { key: "kraene", label: "Kräne (Stammdaten, Verfügbarkeit & Zuweisung je Task)", indent: 0, disabled: false },
                { key: "modelle", label: "Zugewiesene Modelle", indent: 0, disabled: false },
                { key: "stammdaten", label: "Stammdaten (Ressourcen)", indent: 0, disabled: false },
                { key: "kalender", label: "Kalender (Arbeitstage/Feiertage/Ferien)", indent: 0, disabled: false },
              ] as const).map(opt => (
                <label key={opt.key} style={{ display: "flex", alignItems: "center", gap: 8, padding: "5px 0",
                  paddingLeft: opt.indent * 20, fontSize: 12,
                  cursor: opt.disabled ? "default" : "pointer", opacity: opt.disabled ? 0.4 : 1 }}>
                  <input type="checkbox" disabled={opt.disabled}
                    checked={opt.disabled ? false : kopierDialog[opt.key]}
                    onChange={e => setKopierDialog({ ...kopierDialog, [opt.key]: e.target.checked })} />
                  {opt.label}
                </label>
              ))}

              <div style={{ display: "flex", gap: 6, marginTop: 18 }}>
                <button className="tc-btn-primary" style={{ flex: 1 }} onClick={simKopieren}>Kopieren</button>
                <button className="tc-btn-secondary" onClick={() => setKopierDialog(null)}>Abbrechen</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {importAngebot && (() => {
        const sim = sims.find(s => s.id === importAngebot.simId);
        return sim ? (
          <IfcImportDialog api={api} sim={sim} modell={importAngebot.modell}
            onUebernehmen={u => bauablaufUebernehmen(sim.id, importAngebot.modell.name, u)}
            onClose={() => setImportAngebot(null)} />
        ) : null;
      })()}

      {updateDialog && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.4)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center" }}
          onClick={() => setUpdateDialog(null)}>
          <div style={{ background: "#fff", width: 420, maxWidth: "92vw", boxShadow: "0 8px 30px rgba(0,0,0,.25)", fontFamily: "var(--tc-font)" }}
            onClick={e => e.stopPropagation()}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 18px", borderBottom: "1px solid var(--tc-border-light)" }}>
              <div style={{ fontSize: 16, fontWeight: 700, color: "var(--tc-text)" }}>Neue Modellversion verfügbar</div>
              <button className="tc-btn-ghost" style={{ fontSize: 14, padding: "2px 8px" }} onClick={() => setUpdateDialog(null)}>✕</button>
            </div>
            <div style={{ padding: "16px 18px" }}>
              <div style={{ fontSize: 12, color: "var(--tc-text-2)", lineHeight: 1.5, marginBottom: 16 }}>
                Für <strong>{updateDialog.modellName}</strong> wurde in Trimble Connect eine neue Revision abgelegt.
                Beim Aktualisieren wird diese neue Version geladen und die bestehenden Bauteil-Zuordnungen der Tasks
                werden über die IFC-GUIDs auf die neue Version übertragen. Bauteile, die es in der neuen Version nicht
                mehr gibt, bleiben unverändert und werden gemeldet.
              </div>
              <div style={{ display: "flex", gap: 6 }}>
                <button className="tc-btn-primary" style={{ flex: 1 }} onClick={modellAktualisieren}>Fortfahren</button>
                <button className="tc-btn-secondary" onClick={() => setUpdateDialog(null)}>Abbrechen</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
