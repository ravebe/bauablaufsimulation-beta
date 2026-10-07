import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // Build-Zeitpunkt — wird bei Fehlermeldungen mitgeschickt (hooks/fehlerMelden.ts), damit klar ist,
  // welche Version beim Benutzer lief
  define: { __APP_BUILD__: JSON.stringify(new Date().toISOString().slice(0, 16)) },
})
