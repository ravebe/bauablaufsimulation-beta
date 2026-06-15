// GanttVorlage.tsx — Template CSV/XLSX Download
import * as XLSX from "xlsx";

export default function GanttVorlage() {
  function downloadVorlage(format: "xlsx" | "csv") {
    const header = ["Name", "Start", "Ende", "Typ", "Bauabschnitt", "Geschoss", "Etappe", "Objektname", "Layer"];
    const beispiel = [
      ["Erdarbeiten", "01.01.2025", "15.01.2025", "neubau", "BA1", "UG", "1", "Bodenplatte", "Fundament"],
      ["Bestandswand", "01.01.2025", "01.01.2025", "bestand", "BA1", "EG", "", "Wand Beton", "Bestand"],
      ["Abbruch Altbau", "16.01.2025", "20.01.2025", "abbruch", "BA1", "EG", "1", "Altbau Wand", "Abbruch"],
      ["Rohbau EG", "21.01.2025", "15.02.2025", "neubau", "BA1", "EG", "2", "Decke Beton", "Rohbau"],
      ["Gerüst", "01.02.2025", "28.02.2025", "temporaer", "BA1", "EG", "2", "Gerüst", "Temporär"],
    ];

    if (format === "xlsx") {
      const ws = XLSX.utils.aoa_to_sheet([header, ...beispiel]);
      ws["!cols"] = header.map(() => ({ wch: 16 }));
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Gantt-Vorlage");
      XLSX.writeFile(wb, "4D_Gantt_Vorlage.xlsx");
    } else {
      const csv = "\uFEFF" + [header.join(";"), ...beispiel.map(r => r.join(";"))].join("\n");
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a"); a.href = url; a.download = "4D_Gantt_Vorlage.csv"; a.click();
      URL.revokeObjectURL(url);
    }
  }

  return (
    <div style={{ position: "relative", display: "inline-block" }}>
      <button className="tc-btn-secondary" style={{ fontSize: 10, padding: "3px 8px" }}
        onClick={() => downloadVorlage("xlsx")} title="Vorlage herunterladen">
        📋 Vorlage
      </button>
    </div>
  );
}
