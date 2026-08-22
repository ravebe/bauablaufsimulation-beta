import { useState } from "react";
import type { Task } from "../types";
import { EXPORT_FORMATE } from "./ganttExportFormate";

interface Props {
  tasks: Task[];
  simName: string;
}

export default function GanttExport({ tasks, simName }: Props) {
  const [offen, setOffen] = useState(false);

  if (tasks.length === 0) return null;

  return (
    <div style={{ position: "relative", display: "inline-block" }}>
      <button className="tc-btn-secondary" style={{ fontSize: 10, padding: "3px 8px" }}
        onClick={e => { e.stopPropagation(); setOffen(o => !o); }}>
        Export
      </button>
      {offen && (
        <div style={{
          position: "absolute", right: 0, top: "100%", marginTop: 2, background: "#fff",
          border: "1px solid var(--tc-border)", boxShadow: "0 2px 8px rgba(0,0,0,.12)",
          zIndex: 100, minWidth: 140, fontSize: 11,
        }} onClick={e => e.stopPropagation()}>
          {EXPORT_FORMATE.map((f, i) => (
            <div key={f.key}
              style={{ padding: "6px 10px", cursor: "pointer", borderBottom: i < EXPORT_FORMATE.length - 1 ? "1px solid #eef1f4" : "none" }}
              onMouseEnter={e => (e.currentTarget.style.background = "#f5f9fc")}
              onMouseLeave={e => (e.currentTarget.style.background = "")}
              onClick={() => { f.run(tasks, simName); setOffen(false); }}>
              {f.label}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
