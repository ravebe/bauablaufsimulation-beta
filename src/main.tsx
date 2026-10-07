import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import FehlerGrenze from "./components/FehlerGrenze";
import { globaleFehlerAbfangen } from "./hooks/fehlerMelden";
import "./App.css";

globaleFehlerAbfangen();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <FehlerGrenze bereich="der Extension">
      <App />
    </FehlerGrenze>
  </React.StrictMode>
);
