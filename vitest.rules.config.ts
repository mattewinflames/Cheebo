/// <reference types="vitest" />
import { defineConfig } from "vite";

// Test delle regole Firestore: richiedono l'emulatore, si lanciano con
//   npm.cmd run test:rules
export default defineConfig({
  test: {
    include: ["tests/**/*.test.mjs"],
    testTimeout: 20000,
    hookTimeout: 30000,
    fileParallelism: false, // l'emulatore è uno solo
  },
});
