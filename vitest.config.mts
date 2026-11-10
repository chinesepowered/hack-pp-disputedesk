import { defineConfig } from "vitest/config";
import os from "node:os";
import path from "node:path";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    // Tests get their own state directory: they must never touch the app's .data/ folder.
    env: { DISPUTEDESK_DATA_DIR: path.join(os.tmpdir(), `disputedesk-test-${process.pid}`), DISPUTEDESK_RECORD: "" },
  },
  resolve: { alias: { "@": path.resolve(import.meta.dirname) } },
});
