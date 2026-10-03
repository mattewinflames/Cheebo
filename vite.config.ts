/// <reference types="vitest" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    host: true,          // ascolta anche in rete (equivale a --host)
    allowedHosts: true,  // accetta gli host dei tunnel (loca.lt, trycloudflare, ecc.)
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          // Firebase in chunk separato — cambia raramente, resta in cache
          "firebase": ["firebase/app", "firebase/firestore", "firebase/app-check", "firebase/auth"],
          // React + router in chunk separato
          "react-vendor": ["react", "react-dom", "react-router-dom"],
        },
      },
    },
    // Soglia warning chunk aumentata (AdminCassa è grande by design)
    chunkSizeWarningLimit: 800,
  },
  test: {
    include: ["src/**/*.test.ts"],
  },
});
