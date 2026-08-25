import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const repoRoot = resolve(import.meta.dirname, "..");

describe("Windows runtime corrective build", () => {
  it("keeps repository Bun pinned while compiling the Windows binary with Bun 1.4.0", () => {
    const packageJson = JSON.parse(readFileSync(resolve(repoRoot, "package.json"), "utf8")) as {
      packageManager?: string;
      scripts?: Record<string, string>;
    };
    const corrective = readFileSync(
      resolve(repoRoot, "scripts", "build-windows-runtime-corrective.ts"),
      "utf8",
    );

    expect(packageJson.packageManager).toBe("bun@1.3.11");
    expect(packageJson.scripts?.["build:windows-runtime-corrective"]).toBe(
      "bun run scripts/build-windows-runtime-corrective.ts",
    );
    expect(corrective).toContain('WINDOWS_COMPILE_BUN_VERSION = "1.4.0"');
    expect(corrective).toContain(
      'WINDOWS_COMPILE_BUN_SHA256 =\n  "e6f093d39da486b20262ca8cdd5ed6a9e8bc9c2f275b78e6d3a0c5b28cc95901"',
    );
    expect(corrective).toContain("PATH Bun must remain the repository packageManager version");
    expect(corrective).toContain("WINDOWS_RUNTIME_CORRECTIVE_BUILD_PASS");
  });
});
