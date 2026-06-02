import { useState, useRef, useCallback } from "react";
import type { SimProjekt, Task } from "../types";
import type { ApiInstance } from "../hooks/useApi";

interface Props {
  api: ApiInstance | null;
  ready: boolean;
  aktiveSim: SimProjekt | null;
}

export default function TabAbspielen({ api, ready, aktiveSim }: Props) {
  const [sekProTask, setSekProTask] = useState(3);
  const [laeuft, setLaeuft] = useState(false);
  const [aktivIndex, setAktivIndex] = useState(-1);
  const [status, setStatus] = useState<string | null>(null);
  const stopRef = useRef(false);

  const modelId = aktiveSim?.modelle[0]?.id ?? null;

  // Alle Runtime IDs aller Tasks sammeln
  function alleIds(): number[] {
    if (!aktiveSim) return [];
    const set = new Set<number>();
    for (const t of aktiveSim.tasks) {
      for (const g of t.objektGuids) {
        const n = Number(g);
        if (!isNaN(n)) set.add(n);
      }
    }
    return [...set];
  }

  function taskIds(task: Task): number[] {
    return task.objektGuids.map(Number).filter(n => !isNaN(n));
  }

  function sleep(ms: number) {
    return new Promise<void>(resolve => setTimeout(resolve, ms));
  }

  async function reset() {
    if (!api || !modelId) return;
    setAktivIndex(-1);
    setStatus(null);
    const ids = alleIds();
    if (ids.length > 0) {
      await api.viewer.setObjectsState(modelId, ids, { visible: true, color: null });
    }
    setStatus("↺ Reset: alle Bauteile eingeblendet");
  }

  const starten = useCallback(async () => {
    if (!api || !modelId || !aktiveSim || laeuft) return;
    stopRef.current = false;
    setLaeuft(true);
    setAktivIndex(-1);
    setStatus(null);

    const tasks = aktiveSim.tasks.filter(t => t.objektGuids.length > 0);

    // Initialer Zustand: neubau → ausblenden
    for (const t of aktiveSim.tasks) {
      if (t.typ === "neubau") {
        const ids = taskIds(t);
        if (ids.length > 0) {
          await api.viewer.setObjectsState(modelId, ids, { visible: false });
        }
      }
    }

    for (let i = 0; i < tasks.length; i++) {
      if (stopRef.current) break;
      const task = tasks[i];
      const ids = taskIds(task);
      setAktivIndex(i);
      setStatus(`▶ ${task.name} · ${ids.length} Bauteile`);

      if (ids.length === 0) {
        await sleep(sekProTask * 1000);
        continue;
      }

      if (task.typ === "neubau") {
        // Einblenden und markieren
        await api.viewer.setObjectsState(modelId, ids, { visible: true });
        await api.viewer.setSelection(ids);
      } else if (task.typ === "abbruch") {
        // Gelb markieren
        await api.viewer.setObjectsState(modelId, ids, {
          color: { r: 255, g: 165, b: 0, a: 255 }
        });
        await sleep(2000);
        if (!stopRef.current) {
          // Ausblenden
          await api.viewer.setObjectsState(modelId, ids, { visible: false });
        }
      }
      // bestand: keine Änderung

      await sleep(sekProTask * 1000);
    }

    if (!stopRef.current) {
      setStatus("✓ Simulation abgeschlossen");
      setAktivIndex(-1);
    } else {
      setStatus("■ Gestoppt");
    }
    setLaeuft(false);
  }, [api, modelId, aktiveSim, laeuft, sekProTask]);

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
        <div className="tc-empty-sub">Bitte zuerst im Tab „Projekte" eine Simulation aktivieren</div>
      </div>
    );
  }

  const mitBauteilen = aktiveSim.tasks.filter(t => t.objektGuids.length > 0);
  const fortschritt = aktivIndex >= 0 && mitBauteilen.length > 0
    ? Math.round(((aktivIndex + 1) / mitBauteilen.length) * 100)
    : 0;

  return (
    <div className="tc-setup-content">
      {/* Einstellungen */}
      <div className="player-card">
        <div className="detail-block-title">Einstellungen</div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 11 }}>
          <span style={{ flex: 1, color: "var(--tc-text-2)" }}>Sekunden pro Task</span>
          <input
            type="number"
            min={1}
            max={30}
            value={sekProTask}
            onChange={e => setSekProTask(Number(e.target.value))}
            disabled={laeuft}
            className="player-sek-input"
          />
        </div>
        <div style={{ fontSize: 9, color: "var(--tc-text-3)", marginTop: 4 }}>
          Abbruch: 2 Sek. gelb → ausgeblendet · Bestand: immer sichtbar
        </div>
      </div>

      {/* Fortschritt */}
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

      {/* Task Liste */}
      <div className="detail-block-title" style={{ marginBottom: 4 }}>
        Tasks ({mitBauteilen.length} mit Bauteilen)
      </div>
      <div className="player-card" style={{ padding: 0, overflow: "hidden" }}>
        {aktiveSim.tasks.length === 0 ? (
          <div style={{ padding: "10px", fontSize: 11, color: "var(--tc-text-3)", textAlign: "center" }}>
            Noch keine Tasks — Gantt importieren
          </div>
        ) : (
          aktiveSim.tasks.map((task) => {
            const istAktiv = laeuft && mitBauteilen[aktivIndex]?.id === task.id;
            const hatBauteile = task.objektGuids.length > 0;
            return (
              <div
                key={task.id}
                className={`player-task-row ${istAktiv ? "aktiv" : ""} ${!hatBauteile ? "leer" : ""}`}
              >
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

      {/* Steuerung */}
      <div style={{ display: "flex", gap: 6, marginTop: 10 }}>
        {!laeuft ? (
          <button
            className="tc-btn-green"
            style={{ flex: 1 }}
            disabled={!ready || !modelId || mitBauteilen.length === 0}
            onClick={starten}
          >
            ▶ Starten
          </button>
        ) : (
          <button className="tc-btn-danger" style={{ flex: 1 }} onClick={stoppen}>
            ■ Stoppen
          </button>
        )}
        <button
          className="tc-btn-secondary"
          disabled={laeuft || !api || !modelId}
          onClick={reset}
          title="Reset"
        >
          ↺
        </button>
      </div>

      {!modelId && (
        <div className="alert err" style={{ marginTop: 8 }}>
          ! Kein Modell in der Simulation — in Tab „Projekte" Modelle übernehmen
        </div>
      )}

      {/* Status */}
      {status && (
        <div className={`alert ${status.startsWith("✓") ? "ok" : status.startsWith("!") ? "err" : "info"}`}
          style={{ marginTop: 8 }}>
          {status}
        </div>
      )}

      {/* Legende */}
      <div className="player-legende">
        <div className="detail-block-title" style={{ marginBottom: 6 }}>Legende</div>
        <div className="legende-row"><span className="task-row-dot neubau" />
          <span><strong>neubau</strong> — unsichtbar → eingeblendet</span></div>
        <div className="legende-row"><span className="task-row-dot bestand" />
          <span><strong>bestand</strong> — immer sichtbar, keine Animation</span></div>
        <div className="legende-row"><span className="task-row-dot abbruch" />
          <span><strong>abbruch</strong> — 2 Sek. gelb → ausgeblendet</span></div>
      </div>
    </div>
  );
}
