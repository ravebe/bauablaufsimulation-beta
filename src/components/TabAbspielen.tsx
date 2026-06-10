import { useState, useRef, useCallback } from "react";
import type { SimProjekt } from "../types";
import type { ApiInstance } from "../hooks/useApi";

interface Props {
  api: ApiInstance | null;
  aktiveSim: SimProjekt | null;
  aktivesModellId: string | null;
}

export default function TabAbspielen({ api, aktiveSim, aktivesModellId }: Props) {
  const [sekProTask, setSekProTask] = useState(3);
  const [laeuft, setLaeuft] = useState(false);
  const [aktivIndex, setAktivIndex] = useState(-1);
  const [status, setStatus] = useState<string | null>(null);
  const stopRef = useRef(false);

  const modellIds = [...new Set([
    ...(aktiveSim?.modelle.map(m => m.id) ?? []),
    ...(aktivesModellId ? [aktivesModellId] : [])
  ])].filter(Boolean);

  function sleep(ms: number) {
    return new Promise<void>(resolve => setTimeout(resolve, ms));
  }

  // Objekte aus "modelId:::rId" Format in setSelection-Struktur umwandeln
  function objektZuSelection(objektGuids: string[]): { modelId: string; objectRuntimeIds: number[] }[] {
    const byModel = new Map<string, number[]>();
    const legacy: number[] = [];
    for (const g of objektGuids) {
      if (g.includes(":::")) {
        const sep = g.indexOf(":::");
        const mid = g.slice(0, sep);
        const rId = Number(g.slice(sep + 3));
        if (mid && !isNaN(rId)) {
          if (!byModel.has(mid)) byModel.set(mid, []);
          byModel.get(mid)!.push(rId);
        }
      } else {
        const rId = Number(g);
        if (!isNaN(rId) && rId > 0) legacy.push(rId);
      }
    }
    if (legacy.length > 0 && modellIds.length > 0) {
      if (!byModel.has(modellIds[0])) byModel.set(modellIds[0], []);
      byModel.get(modellIds[0])!.push(...legacy);
    }
    return [...byModel.entries()].map(([modelId, objectRuntimeIds]) => ({ modelId, objectRuntimeIds: [...new Set(objectRuntimeIds)] }));
  }

  // Reset — alle Objekte wieder einblenden
  async function reset() {
    if (!api) return;
    setAktivIndex(-1);
    setStatus("⟳ Reset…");
    try {
      await api.viewer.reset();
    } catch {
      for (const mid of modellIds) {
        try {
          await api.viewer.setObjectState([{ modelId: mid }], { visible: true, color: null });
        } catch { /* ignore */ }
      }
    }
    try { await api.viewer.setSelection([]); } catch { /* ignore */ }
    setStatus("↺ Alle Bauteile eingeblendet");
  }

  const starten = useCallback(async () => {
    if (!api || !aktiveSim || laeuft || modellIds.length === 0) return;
    stopRef.current = false;
    setLaeuft(true);
    setAktivIndex(-1);

    const tasks = aktiveSim.tasks.filter(t => t.objektGuids.length > 0);

    // 1. Alle Objekte ausblenden: setObjectState ohne objectRuntimeIds = ALLE
    setStatus("⟳ Alle Objekte ausblenden…");
    for (const mid of modellIds) {
      try {
        await api.viewer.setObjectState([{ modelId: mid }], { visible: false });
      } catch { /* ignore */ }
    }
    try { await api.viewer.setSelection([]); } catch { /* ignore */ }

    if (stopRef.current) { setLaeuft(false); setStatus("■ Gestoppt"); return; }

    // 2. Tasks nacheinander: Bauteile einblenden + markieren
    for (let i = 0; i < tasks.length; i++) {
      if (stopRef.current) break;
      const task = tasks[i];
      const guids = task.objektGuids.filter(Boolean);
      setAktivIndex(i);
      setStatus(`▶ ${task.name} · ${guids.length} Bauteile`);

      if (guids.length > 0) {
        const selection = objektZuSelection(guids);
        for (const { modelId, objectRuntimeIds } of selection) {
          try {
            await api.viewer.setObjectState(
              [{ modelId, objectRuntimeIds }],
              { visible: true }
            );
          } catch { /* ignore */ }
        }
        try { await (api.viewer as any).setSelection(selection); } catch { /* ignore */ }
      }

      await sleep(sekProTask * 1000);
    }

    if (!stopRef.current) {
      setStatus("✓ Simulation abgeschlossen");
      setAktivIndex(-1);
    } else {
      setStatus("■ Gestoppt");
    }
    setLaeuft(false);
  }, [api, aktiveSim, aktivesModellId, laeuft, sekProTask, modellIds]);

  function stoppen() {
    stopRef.current = true;
    setLaeuft(false);
    setStatus("■ Gestoppt");
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

  const mitBauteilen = aktiveSim.tasks.filter(t => t.objektGuids.length > 0);
  const fortschritt = aktivIndex >= 0 && mitBauteilen.length > 0
    ? Math.round(((aktivIndex + 1) / mitBauteilen.length) * 100)
    : 0;

  return (
    <div className="tc-setup-content">

      <div className="player-card">
        <div className="detail-block-title">Einstellungen</div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 11 }}>
          <span style={{ flex: 1, color: "var(--tc-text-2)" }}>Sekunden pro Task</span>
          <input type="number" min={1} max={30}
            value={sekProTask}
            onChange={e => setSekProTask(Number(e.target.value))}
            disabled={laeuft}
            className="player-sek-input"
          />
        </div>
        <div style={{ fontSize: 9, color: "var(--tc-text-3)", marginTop: 4 }}>
          Start: alle ausblenden → Task für Task einblenden & markieren
        </div>
      </div>

      {laeuft && (
        <div className="player-card">
          <div className="detail-block-title">Fortschritt</div>
          <div className="player-progress">
            <div className="player-progress-fill" style={{ width: `${fortschritt}%` }} />
          </div>
          <div style={{ fontSize: 10, color: "var(--tc-blue)", textAlign: "center", fontWeight: 500 }}>
            Task {aktivIndex + 1} / {mitBauteilen.length}
            {mitBauteilen[aktivIndex] && ` · ${mitBauteilen[aktivIndex].name}`}
          </div>
        </div>
      )}

      <div className="detail-block-title" style={{ marginBottom: 4 }}>
        Tasks ({mitBauteilen.length} mit Bauteilen)
      </div>
      <div className="player-card" style={{ padding: 0, overflow: "hidden" }}>
        {aktiveSim.tasks.length === 0 ? (
          <div style={{ padding: "10px", fontSize: 11, color: "var(--tc-text-3)", textAlign: "center" }}>
            Noch keine Tasks — Gantt importieren
          </div>
        ) : (
          aktiveSim.tasks.map(task => {
            const istAktiv = laeuft && mitBauteilen[aktivIndex]?.id === task.id;
            const hatBauteile = task.objektGuids.length > 0;
            return (
              <div key={task.id} className={`player-task-row ${istAktiv ? "aktiv" : ""} ${!hatBauteile ? "leer" : ""}`}>
                <span style={{ width: 14, fontSize: 10 }}>{istAktiv ? "▶" : ""}</span>
                <span className={`task-row-dot ${task.typ}`} />
                <span className="player-task-name">{task.name}</span>
                <span className="task-row-count">
                  {hatBauteile
                    ? <span style={{ color: "var(--tc-blue)" }}>⬡ {task.objektGuids.length}</span>
                    : <span style={{ color: "var(--tc-border)" }}>∅</span>}
                </span>
              </div>
            );
          })
        )}
      </div>

      <div style={{ display: "flex", gap: 6, marginTop: 10 }}>
        {!laeuft ? (
          <button className="tc-btn-green" style={{ flex: 1 }}
            disabled={!api || modellIds.length === 0 || mitBauteilen.length === 0}
            onClick={starten}>
            ▶ Starten
          </button>
        ) : (
          <button className="tc-btn-danger" style={{ flex: 1 }} onClick={stoppen}>
            ■ Stoppen
          </button>
        )}
        <button className="tc-btn-secondary"
          disabled={laeuft || !api}
          onClick={reset}
          title="Alle Bauteile wieder einblenden">↺</button>
      </div>

      {modellIds.length === 0 && (
        <div className="alert err" style={{ marginTop: 8 }}>
          ! Kein Modell — Objekt im Viewer anklicken oder in Tab „Projekte" Modelle speichern
        </div>
      )}

      {status && (
        <div className={`alert ${status.startsWith("✓") ? "ok" : status.startsWith("!") ? "err" : "info"}`}
          style={{ marginTop: 8 }}>
          {status}
        </div>
      )}

      <div className="player-legende">
        <div className="detail-block-title" style={{ marginBottom: 6 }}>Ablauf</div>
        <div className="legende-row"><span style={{ fontSize: 10, color: "var(--tc-text-3)" }}>1.</span><span>Alle Objekte werden <strong>ausgeblendet</strong></span></div>
        <div className="legende-row"><span style={{ fontSize: 10, color: "var(--tc-text-3)" }}>2.</span><span>Task für Task: Bauteile <strong>einblenden & markieren</strong></span></div>
        <div className="legende-row"><span style={{ fontSize: 10, color: "var(--tc-text-3)" }}>3.</span><span>Nach {sekProTask} Sek. → nächster Task</span></div>
      </div>
    </div>
  );
}
