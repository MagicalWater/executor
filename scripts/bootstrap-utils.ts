import { existsSync } from "node:fs";
import { resolve } from "node:path";

type Exists = (path: string) => boolean;

export function hasInstalledVitestBin(repoRoot: string, exists: Exists = existsSync): boolean {
  return ["vitest", "vitest.exe", "vitest.bunx"].some((name) =>
    exists(resolve(repoRoot, "node_modules", ".bin", name)),
  );
}
