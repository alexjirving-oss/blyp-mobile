import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Note: do not use define:{ global:'globalThis' } — it breaks lodash CJS interop.
// Login boot no longer pulls buffer/recharts; Cognito bundle is clean under Rolldown.
export default defineConfig({
  plugins: [react()],
});
