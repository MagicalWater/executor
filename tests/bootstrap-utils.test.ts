import { describe, expect, it } from "vitest";

import { hasInstalledVitestBin } from "../scripts/bootstrap-utils";

describe("hasInstalledVitestBin", () => {
  it("accepts the Unix vitest shim", () => {
    expect(
      hasInstalledVitestBin("repo", (candidate) =>
        candidate.replaceAll("\\", "/").endsWith("node_modules/.bin/vitest"),
      ),
    ).toBe(true);
  });

  it("accepts the Windows Bun executable shim", () => {
    expect(
      hasInstalledVitestBin("repo", (candidate) =>
        candidate.replaceAll("\\", "/").endsWith("node_modules/.bin/vitest.exe"),
      ),
    ).toBe(true);
  });

  it("accepts the Windows Bun launcher shim", () => {
    expect(
      hasInstalledVitestBin("repo", (candidate) =>
        candidate.replaceAll("\\", "/").endsWith("node_modules/.bin/vitest.bunx"),
      ),
    ).toBe(true);
  });

  it("rejects a missing vitest install", () => {
    expect(hasInstalledVitestBin("repo", () => false)).toBe(false);
  });
});
