import { useState, useRef, useCallback, useEffect } from "react";
import type { SimProjekt, Task } from "../types";
import type { ApiInstance } from "../hooks/useApi";

interface Props {
  api: ApiInstance | null;
  aktiveSim: SimProjekt | null;
  aktivesModellId: string | null;
}

interface TaskGruppe { datum: string; tage: number; tasks: Task[]; }

const FARBEN = { neubau: "#22C55E", bestand: "#999999", abbruch: "#EAB308" };

function sleep(ms: number) { return new Promise<void>(r => setTimeout(r, ms)); }

function parseDatum(s: string): Date | null {
  if (!s) return null;
  const d = new Date(s + "T00:00:00");
  return isNaN(d.getTime()) ? null : d;
}

function tageDiff(a: Date, b: Date): number {
  return Math.round((b.getTime() - a.getTime()) / 86400000);
}

function datumBeiTag(min: Date, tag: number): string {
  const d = new Date(min.getTime() + tag * 86400000);
  return d.toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" });
}

export default function TabAbspielen({ api, aktiveSim, aktivesModellId }: Props) {
  const [sekProTag, setSekProTag] = useState(0.5);
  const [laeuft, setLaeuft] = useState(false);
  const [currentTag, setCurrentTag] = useState(0);
  const [status, setStatus] = useState<string | null>(null);
  const stopRef = useRef(false);
  const animRef = useRef<number | null>(null);
  const lastTimeRef = useRef(0);
  const aktivierteGruppen = useRef(new Set<number>());

  const modellIds = [...new Set([
    ...(aktiveSim?.modelle.map(m => m.id) ?? []),
    ...(aktivesModellId ? [aktivesModellId] : [])
  ])].filter(Boolean);

  // Tasks mit Bauteilen + gültigem Datum, gruppiert nach Startdatum
  const { gruppen, minDate, maxDate, totalTage } = (() => {
    const tasks = (aktiveSim?.tasks ?? []).filter(t => t.objektGuids.length > 0 && t.start);
    if (tasks.length === 0) return { gruppen: [] as TaskGruppe[], minDate: null, maxDate: null, totalTage: 0 };

    const daten = tasks.map(t => parseDatum(t.start!)).filter(Boolean) as Date[];
    const min = new Date(Math.min(...daten.map(d => d.getTime())));
    const max = new Date(Math.max(...daten.map(d => d.getTime())));
    const total = Math.max(1, tageDiff(min, max));

    const map = new Map<string, Task[]>();
    for (const t of tasks) {
      if (!map.has(t.start)) map.set(t.start, []);
      map.get(t.start)!.push(t);
    }

    const g: TaskGruppe[] = [...map.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([datum, tasks]) => ({ datum, tage: tageDiff(min, parseDatum(datum)!), tasks }));

    return { gruppen: g, minDate: min, maxDate: max, totalTage: total };
  })();

  // Cleanup animation on unmount
  useEffect(() => () => { if (animRef.current) cancelAnimationFrame(animRef.current); }, []);

  // --- API Hilfsfunktionen ---
  function zuModelObjects(guids: string[]): { modelId: string; objectRuntimeIds: number[] }[] {
    const byModel = new Map<string, number[]>();
    for (const g of guids) {
      if (!g.includes(":::")) continue;
      const sep = g.indexOf(":::"); const mid = g.slice(0, sep); const rId = Number(g.slice(sep + 3));
      if (mid && !isNaN(rId)) { if (!byModel.has(mid)) byModel.set(mid, []); byModel.get(mid)!.push(rId); }
    }
    return [...byModel.entries()].map(([modelId, rIds]) => ({ modelId, objectRuntimeIds: [...new Set(rIds)] }));
  }

  async function sichtbarkeit(guids: string[], visible: boolean) {
    if (!api || guids.length === 0) return;
    for (const mo of zuModelObjects(guids)) {
      try { await api.viewer.setObjectState({ modelObjectIds: [mo] } as any, { visible } as any); } catch {}
    }
  }

  async function farbeSetzen(guids: string[], color: string | null) {
    if (!api || guids.length === 0) return;
    for (const mo of zuModelObjects(guids)) {
      try { await api.viewer.setObjectState({ modelObjectIds: [mo] } as any, { color } as any); } catch {}
    }
  }

  async function selektieren(guids: string[]) {
    if (!api || guids.length === 0) return;
    try { await (api.viewer as any).setSelection({ modelObjectIds: zuModelObjects(guids) }, "set"); } catch {}
  }

  // --- Zustand bei einem bestimmten Tag komplett aufbauen ---
  async function zustandBeiTag(tag: number) {
    if (!api || !aktiveSim) return;

    // 1. Alles ausblenden + Farben entfernen
    for (const mid of modellIds) {
      try { await api.viewer.setObjectState({ modelObjectIds: [{ modelId: mid }] } as any, { visible: false, color: null } as any); } catch {}
    }

    const selGuids: string[] = [];

    for (const g of gruppen) {
      if (g.tage <= tag) {
        // Gruppe ist aktiviert
        for (const t of g.tasks) {
          if (t.typ === "neubau") {
            await sichtbarkeit(t.objektGuids, true);
            // Nur aktuelle Gruppe farbig + selektiert
            if (g.tage === Math.floor(tag)) {
              await farbeSetzen(t.objektGuids, FARBEN.neubau);
              selGuids.push(...t.objektGuids);
            }
          } else if (t.typ === "abbruch") {
            // Abbruch: nach Aktivierung ausgeblendet
            await sichtbarkeit(t.objektGuids, false);
          } else {
            // Bestand: grau, immer sichtbar, nicht selektiert
            await sichtbarkeit(t.objektGuids, true);
            await farbeSetzen(t.objektGuids, FARBEN.bestand);
          }
        }
      } else {
        // Gruppe noch nicht aktiviert
        for (const t of g.tasks) {
          if (t.typ === "abbruch") {
            // Abbruch steht noch (noch nicht abgerissen)
            await sichtbarkeit(t.objektGuids, true);
          } else if (t.typ === "bestand") {
            await sichtbarkeit(t.objektGuids, true);
            await farbeSetzen(t.objektGuids, FARBEN.bestand);
          }
          // Neubau bleibt ausgeblendet
        }
      }
    }

    if (selGuids.length > 0) await selektieren(selGuids);

    // Status
    const aktuelleGruppe = gruppen.find(g => g.tage === Math.floor(tag));
    if (aktuelleGruppe) {
      const namen = aktuelleGruppe.tasks.map(t => {
        const icon = t.typ === "neubau" ? "🟢" : t.typ === "abbruch" ? "🟡" : "⚫";
        return `${icon} ${t.name}`;
      }).join(", ");
      setStatus(namen);
    }
  }

  // --- Gruppe inkrementell aktivieren (für Playback) ---
  async function gruppeAktivieren(g: TaskGruppe) {
    const selGuids: string[] = [];

    for (const t of g.tasks) {
      if (t.typ === "neubau") {
        await sichtbarkeit(t.objektGuids, true);
        await farbeSetzen(t.objektGuids, FARBEN.neubau);
        selGuids.push(...t.objektGuids);
      } else if (t.typ === "abbruch") {
        await farbeSetzen(t.objektGuids, FARBEN.abbruch);
        selGuids.push(...t.objektGuids);
        // Nach kurzer Pause ausblenden
        setTimeout(async () => {
          await sichtbarkeit(t.objektGuids, false);
          await farbeSetzen(t.objektGuids, null);
        }, Math.max(1000, sekProTag * 800));
      }
      // Bestand: keine Änderung (bleibt grau + sichtbar)
    }

    if (selGuids.length > 0) await selektieren(selGuids);

    const namen = g.tasks.map(t => {
      const icon = t.typ === "neubau" ? "🟢" : t.typ === "abbruch" ? "🟡" : "⚫";
      return `${icon} ${t.name}`;
    }).join(", ");
    setStatus(`${g.datum} · ${namen}`);
  }

  // Vorherige Gruppe: Farbe entfernen (nur neubau, abbruch ist schon weg)
  async function gruppeFarbeEntfernen(g: TaskGruppe) {
    for (const t of g.tasks) {
      if (t.typ === "neubau") await farbeSetzen(t.objektGuids, null);
    }
  }

  // --- Startzustand ---
  async function startzustand() {
    if (!api || !aktiveSim) return;
    aktivierteGruppen.current.clear();

    // Schritt 1: ALLES ausblenden — nichts sichtbar
    setStatus("⟳ Alles ausblenden…");
    for (const mid of modellIds) {
      try { await api.viewer.setObjectState({ modelObjectIds: [{ modelId: mid }] } as any, { visible: false, color: null } as any); } catch {}
    }
    try { await (api.viewer as any).setSelection({ modelObjectIds: [] }, "set"); } catch {}
    await sleep(800);

    // Schritt 2: Bestand (grau) + Abbruch einblenden
    setStatus("⟳ Bestand + Abbruch einblenden…");
    for (const g of gruppen) {
      for (const t of g.tasks) {
        if (t.typ === "bestand") {
          await sichtbarkeit(t.objektGuids, true);
          await farbeSetzen(t.objektGuids, FARBEN.bestand);
        } else if (t.typ === "abbruch") {
          await sichtbarkeit(t.objektGuids, true);
        }
      }
    }
    await sleep(600);

    setCurrentTag(0);
    setStatus("✓ Bereit");
  }

  // --- Playback mit requestAnimationFrame ---
  const starten = useCallback(async () => {
    if (!api || !aktiveSim || laeuft || modellIds.length === 0 || gruppen.length === 0) return;
    stopRef.current = false;
    setLaeuft(true);

    await startzustand();

    lastTimeRef.current = performance.now();

    function frame(now: number) {
      if (stopRef.current) return;
      const delta = (now - lastTimeRef.current) / 1000; // Sekunden seit letztem Frame
      lastTimeRef.current = now;

      const tageProSekunde = sekProTag > 0 ? 1 / sekProTag : 1;
      const neuerTag = currentTagRef.current + delta * tageProSekunde;

      if (neuerTag >= totalTage) {
        setCurrentTag(totalTage);
        currentTagRef.current = totalTage;
        setLaeuft(false);
        setStatus("✓ Simulation abgeschlossen");
        return;
      }

      setCurrentTag(neuerTag);
      currentTagRef.current = neuerTag;

      // Prüfe ob neue Gruppen aktiviert werden müssen
      for (let i = 0; i < gruppen.length; i++) {
        if (gruppen[i].tage <= neuerTag && !aktivierteGruppen.current.has(i)) {
          aktivierteGruppen.current.add(i);
          // Vorherige Farbe entfernen
          if (i > 0) {
            const prevIdx = [...aktivierteGruppen.current].sort((a, b) => a - b);
            const prev = prevIdx[prevIdx.length - 2];
            if (prev !== undefined) gruppeFarbeEntfernen(gruppen[prev]);
          }
          gruppeAktivieren(gruppen[i]);
        }
      }

      animRef.current = requestAnimationFrame(frame);
    }

    currentTagRef.current = 0;
    animRef.current = requestAnimationFrame(frame);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, aktiveSim, laeuft, sekProTag, modellIds, gruppen, totalTage]);

  const currentTagRef = useRef(0);
  useEffect(() => { currentTagRef.current = currentTag; }, [currentTag]);

  function stoppen() {
    stopRef.current = true;
    if (animRef.current) { cancelAnimationFrame(animRef.current); animRef.current = null; }
    setLaeuft(false);
    setStatus("■ Gestoppt");
  }

  // --- Manueller Slider ---
  async function sliderChange(tag: number) {
    if (laeuft) return;
    setCurrentTag(tag);
    currentTagRef.current = tag;
    aktivierteGruppen.current.clear();
    gruppen.forEach((g, i) => { if (g.tage <= tag) aktivierteGruppen.current.add(i); });
    await zustandBeiTag(tag);
  }

  // --- Klick auf Task-Gruppe in Timeline ---
  async function zuGruppe(gruppenIndex: number) {
    if (laeuft || gruppenIndex < 0 || gruppenIndex >= gruppen.length) return;
    const tag = gruppen[gruppenIndex].tage;
    setCurrentTag(tag);
    currentTagRef.current = tag;
    aktivierteGruppen.current.clear();
    gruppen.forEach((g, i) => { if (g.tage <= tag) aktivierteGruppen.current.add(i); });
    await zustandBeiTag(tag);
  }

  // Reset
  async function reset() {
    if (!api) return;
    stoppen();
    setCurrentTag(0); currentTagRef.current = 0;
    aktivierteGruppen.current.clear();
    setStatus("⟳ Reset…");
    try { await api.viewer.reset(); } catch {}
    try { await (api.viewer as any).setSelection({ modelObjectIds: [] }, "set"); } catch {}
    setStatus("↺ Modell zurückgesetzt");
  }

  if (!aktiveSim) {
    return (
      <div className="tc-empty">
        <div className="tc-empty-icon">▶</div>
        <div className="tc-empty-title">Keine aktive Simulation</div>
        <div className="tc-empty-sub">Tab „Projekte" → Simulation aktivieren</div>
      </div>
    );
  }

  const fortschritt = totalTage > 0 ? Math.round((currentTag / totalTage) * 100) : 0;
  const aktuellesDatum = minDate ? datumBeiTag(minDate, currentTag) : "";

  return (
    <div className="tc-setup-content">

      {/* Einstellungen */}
      <div className="player-card">
        <div className="detail-block-title">Einstellungen</div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 11 }}>
          <span style={{ flex: 1, color: "var(--tc-text-2)" }}>Sekunden pro Tag</span>
          <input type="number" min={0.1} max={10} step={0.1} value={sekProTag}
            onChange={e => setSekProTag(Number(e.target.value))} disabled={laeuft}
            className="player-sek-input" />
        </div>
        <div style={{ fontSize: 9, color: "var(--tc-text-3)", marginTop: 3 }}>
          Gesamtdauer: ~{totalTage > 0 ? Math.round(totalTage * sekProTag) : 0}s für {totalTage} Tage
        </div>
      </div>

      {/* Steuerung */}
      <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
        {!laeuft ? (
          <button className="tc-btn-green" style={{ flex: 1 }}
            disabled={!api || modellIds.length === 0 || gruppen.length === 0}
            onClick={starten}>▶ Starten</button>
        ) : (
          <button className="tc-btn-danger" style={{ flex: 1 }} onClick={stoppen}>■ Stoppen</button>
        )}
        <button className="tc-btn-secondary" disabled={laeuft || !api}
          onClick={reset} title="Reset">↺</button>
      </div>

      {/* Timeline-Slider */}
      {totalTage > 0 && minDate && maxDate && (
        <div style={{ marginTop: 10 }}>
          <div style={{ textAlign: "center", fontSize: 13, fontWeight: 700, color: "var(--tc-text)", marginBottom: 4 }}>
            {aktuellesDatum}
          </div>
          <input type="range" min={0} max={totalTage} step={0.5} value={currentTag}
            onChange={e => sliderChange(Number(e.target.value))} disabled={laeuft}
            style={{ width: "100%" }} />
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 9, color: "var(--tc-text-3)" }}>
            <span>{minDate.toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" })}</span>
            <span>{maxDate.toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" })}</span>
          </div>
        </div>
      )}

      {/* Fortschritt */}
      {(laeuft || currentTag > 0) && (
        <div className="player-card" style={{ marginTop: 6 }}>
          <div className="player-progress">
            <div className="player-progress-fill" style={{ width: `${fortschritt}%`, transition: laeuft ? "none" : "width 0.3s" }} />
          </div>
        </div>
      )}

      {/* Task-Gruppen-Liste */}
      <div className="detail-block-title" style={{ marginTop: 8, marginBottom: 4 }}>
        Timeline ({gruppen.length} Zeitpunkte, {gruppen.reduce((s, g) => s + g.tasks.length, 0)} Tasks)
      </div>
      <div className="player-card" style={{ padding: 0, overflow: "hidden" }}>
        {gruppen.length === 0 ? (
          <div style={{ padding: 10, fontSize: 11, color: "var(--tc-text-3)", textAlign: "center" }}>
            Keine Tasks mit Bauteilen + Startdatum
          </div>
        ) : (
          gruppen.map((g, gi) => {
            const istAktiv = g.tage <= currentTag && (gi === gruppen.length - 1 || gruppen[gi + 1].tage > currentTag);
            const istVorbei = !istAktiv && g.tage < currentTag;
            return (
              <div key={g.datum} style={{ borderBottom: "1px solid var(--tc-border)", cursor: laeuft ? "default" : "pointer" }}
                onClick={() => zuGruppe(gi)}>
                <div style={{
                  padding: "4px 8px", fontSize: 9, fontWeight: 600,
                  color: istAktiv ? "var(--tc-blue)" : istVorbei ? "var(--tc-text-3)" : "var(--tc-text-2)",
                  background: istAktiv ? "#EFF6FF" : "transparent",
                  display: "flex", justifyContent: "space-between",
                }}>
                  <span>{istAktiv ? "▶ " : ""}{g.datum}</span>
                  <span>{g.tasks.length} Task{g.tasks.length > 1 ? "s" : ""}</span>
                </div>
                {g.tasks.map(task => (
                  <div key={task.id} className={`player-task-row ${istAktiv ? "aktiv" : ""}`}
                    style={{ paddingLeft: 16, opacity: istVorbei ? 0.5 : 1 }}>
                    <span className={`task-row-dot ${task.typ}`} />
                    <span className="player-task-name">{task.name}</span>
                    <span className="task-row-count">
                      <span style={{ color: "var(--tc-blue)" }}>⬡ {task.objektGuids.length}</span>
                    </span>
                  </div>
                ))}
              </div>
            );
          })
        )}
      </div>

      {/* Legende */}
      <div className="player-legende">
        <div className="detail-block-title" style={{ marginBottom: 6 }}>Legende</div>
        <div className="legende-row"><span style={{ color: FARBEN.neubau }}>●</span><span>Neubau — erscheint + markiert</span></div>
        <div className="legende-row"><span style={{ color: FARBEN.bestand }}>●</span><span>Bestand — grau, bleibt sichtbar</span></div>
        <div className="legende-row"><span style={{ color: FARBEN.abbruch }}>●</span><span>Abbruch — gelb, dann ausgeblendet</span></div>
      </div>

      {modellIds.length === 0 && (
        <div className="alert err" style={{ marginTop: 8 }}>
          Kein Modell — Objekt im Viewer anklicken oder in Tab „Projekte" Modelle speichern
        </div>
      )}

      {status && (
        <div className={`alert ${status.startsWith("✓") ? "ok" : status.startsWith("■") || status.startsWith("!") ? "err" : "info"}`}
          style={{ marginTop: 8 }}>{status}</div>
      )}
    </div>
  );
}