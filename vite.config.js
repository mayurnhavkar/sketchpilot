import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import claudeBridge from "./server/plugin.js";

export default defineConfig({
  plugins: [react(), claudeBridge()],
  define: { "process.env.IS_PREACT": JSON.stringify("false") },
});
