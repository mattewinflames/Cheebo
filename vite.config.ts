/// <reference types="vitest" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    host: true,          // ascolta anche in rete (equivale a --host)
    allowedHosts: true,  // accetta gli host dei tunnel (loca.lt, trycloudflare, ecc.)
  },
  test: {
    // solo i test unitari: quelli delle regole stanno in tests/ e richiedono
    // l'emulatore Firestore, quindi si lanciano a parte con `test:rules`
    include: ["src/**/*.test.ts"],
  },
});
