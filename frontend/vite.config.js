// frontend/vite.config.js
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  build: {
    sourcemap: true,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes("node_modules")) return undefined;
          if (/node_modules[\\/]react(?:-dom|-router|-router-dom)?[\\/]|node_modules[\\/]scheduler[\\/]|node_modules[\\/]@remix-run[\\/]router[\\/]/.test(id)) return "vendor-react";
          if (id.includes("node_modules/axios")) return "vendor-http";
          if (id.includes("node_modules/i18next") || id.includes("node_modules/react-i18next")) return "vendor-i18n";
          if (/node_modules[\\/](react-hot-toast|react-toastify|goober)[\\/]/.test(id)) return "vendor-toast";
          if (/node_modules[\\/](react-select|@emotion)[\\/]/.test(id)) return "vendor-select";
          if (/node_modules[\\/](leaflet|react-leaflet)[\\/]/.test(id)) return "vendor-maps";
          if (/node_modules[\\/](jspdf|html2canvas)[\\/]/.test(id)) return "vendor-pdf";
          if (id.includes("node_modules/xlsx")) return "vendor-xlsx";
          return "vendor-misc";
        },
      },
    },
  },
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
