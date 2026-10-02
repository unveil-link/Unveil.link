import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

const root = (p: string) => fileURLToPath(new URL(p, import.meta.url));

// Mirrors tsconfig `paths` ("@/*" -> ["./src/*", "./*"]) so tests can import app modules that use the "@/" alias.
export default defineConfig({
  resolve: {
    alias: [
      { find: /^@\/(server|app)\//, replacement: root("./src/$1/") },
      { find: /^@\//, replacement: root("./") },
    ],
  },
});
