import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";

export default defineConfig(({ mode }) => {
  const apiTarget = loadEnv(mode, ".", "SKYOPS_").SKYOPS_DEV_API_TARGET ?? "http://127.0.0.1:8000";
  return {
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: {
      "/health": apiTarget,
      "/missions": apiTarget,
      "/point-cloud": apiTarget,
    },
  },
  };
});
