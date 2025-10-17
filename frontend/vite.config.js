// frontend/vite.config.js
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  build: { sourcemap: true },
  plugins: [react()],
  server: {
    proxy: {
      "/api": {
        target: "https://travella-fullstack-production.up.railway.app",
        changeOrigin: true,
        secure: true,
      },
    },
  },
});
