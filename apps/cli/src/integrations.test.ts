import { describe, expect, it } from "@effect/vitest";

import { shouldFetchIntegrationsForCliArgs } from "./integrations";

describe("shouldFetchIntegrationsForCliArgs", () => {
  it("skips the one-shot registry sidecar for daemon lifecycle commands", () => {
    expect(shouldFetchIntegrationsForCliArgs(["bun", "executor", "daemon", "run"])).toBe(false);
    expect(shouldFetchIntegrationsForCliArgs(["bun", "executor", "daemon", "stop"])).toBe(false);
  });

  it("recognizes daemon after global options", () => {
    expect(
      shouldFetchIntegrationsForCliArgs([
        "bun",
        "executor",
        "--log-level",
        "debug",
        "daemon",
        "run",
      ]),
    ).toBe(false);
    expect(
      shouldFetchIntegrationsForCliArgs([
        "bun",
        "executor",
        "--log-level=debug",
        "daemon",
        "status",
      ]),
    ).toBe(false);
  });

  it("keeps the one-shot refresh for ordinary CLI commands", () => {
    expect(shouldFetchIntegrationsForCliArgs(["bun", "executor", "tools", "list"])).toBe(true);
    expect(shouldFetchIntegrationsForCliArgs(["bun", "executor", "call", "daemon"])).toBe(true);
  });
});
