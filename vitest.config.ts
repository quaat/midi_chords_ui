import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url))
    }
  },
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
    globals: true,
    // Vitest 2 does not fake performance.now() by default; the transport, replay and input
    // clocks read it, so the timer-driven tests need it on the fake clock too.
    fakeTimers: {
      toFake: ["setTimeout", "clearTimeout", "setImmediate", "clearImmediate", "setInterval", "clearInterval", "Date", "performance"]
    }
  }
});
