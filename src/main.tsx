import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import FehlerGrenze from "./components/FehlerGrenze";
import { globaleFehlerAbfangen } from "./hooks/fehlerMelden";
import "./App.css";

globaleFehlerAbfangen();

// Mausrad darf Zahlenfelder nie verändern (nur manuelle Eingabe) — ausser Sekunden pro Tag in Tab Abspielen (Klasse "pfeile-immer").
// Beim Scrollen über einem fokussierten Zahlenfeld wird es verlassen; die Seite scrollt normal weiter.
document.addEventListener("wheel", () => {
  const el = document.activeElement;
  if (el instanceof HTMLInputElement && el.type === "number" && !el.classList.contains("pfeile-immer")) el.blur();
}, { passive: true, capture: true });

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <FehlerGrenze bereich="der Extension">
      <App />
    </FehlerGrenze>
  </React.StrictMode>
);
