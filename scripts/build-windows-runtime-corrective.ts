import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const WINDOWS_COMPILE_BUN_VERSION = "1.4.0";
const WINDOWS_COMPILE_BUN_SHA256 =
  "e6f093d39da486b20262ca8cdd5ed6a9e8bc9c2f275b78e6d3a0c5b28cc95901";
const WINDOWS_COMPILE_BUN_URL = `https://github.com/oven-sh/bun/releases/download/bun-v${WINDOWS_COMPILE_BUN_VERSION}/bun-windows-x64.zip`;

const repoRoot = resolve(import.meta.dirname, "..");
const packageJson = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8")) as {
  packageManager?: string;
};
const normalBunVersion = packageJson.packageManager?.match(/^bun@(.+)$/)?.[1];

const runText = (command: string, args: string[]): string => {
  const result = spawnSync(command, args, { cwd: repoRoot, encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(
      `${command} ${args.join(" ")} failed (${result.status ?? "no exit code"}): ${result.stderr}`,
    );
  }
  return result.stdout.trim();
};

const sha256File = (path: string): string =>
  createHash("sha256").update(readFileSync(path)).digest("hex");

if (process.platform !== "win32" || process.arch !== "x64") {
  throw new Error("This corrective build is only for Windows x64.");
}
if (!normalBunVersion) {
  throw new Error("package.json must declare packageManager as bun@<version>.");
}

const pathBunVersion = runText("bun", ["--version"]);
if (pathBunVersion !== normalBunVersion) {
  throw new Error(
    `PATH Bun must remain the repository packageManager version ${normalBunVersion}; observed ${pathBunVersion}.`,
  );
}

const toolchainRoot = join(
  tmpdir(),
  "executor-windows-runtime-corrective",
  `bun-${WINDOWS_COMPILE_BUN_VERSION}`,
);
const zipPath = join(toolchainRoot, "bun-windows-x64.zip");
const extractRoot = join(toolchainRoot, "extract");
const compilerBun = join(extractRoot, "bun-windows-x64", "bun.exe");

mkdirSync(toolchainRoot, { recursive: true });

if (!existsSync(zipPath) || sha256File(zipPath) !== WINDOWS_COMPILE_BUN_SHA256) {
  const response = await fetch(WINDOWS_COMPILE_BUN_URL);
  if (!response.ok) {
    throw new Error(
      `Failed to download Bun ${WINDOWS_COMPILE_BUN_VERSION}: HTTP ${response.status}`,
    );
  }
  writeFileSync(zipPath, Buffer.from(await response.arrayBuffer()));
}

const downloadedHash = sha256File(zipPath);
if (downloadedHash !== WINDOWS_COMPILE_BUN_SHA256) {
  throw new Error(`Bun ${WINDOWS_COMPILE_BUN_VERSION} archive SHA-256 mismatch: ${downloadedHash}`);
}

if (!existsSync(compilerBun)) {
  rmSync(extractRoot, { recursive: true, force: true });
  mkdirSync(extractRoot, { recursive: true });
  const expand = spawnSync("tar.exe", ["-xf", zipPath, "-C", extractRoot], {
    cwd: repoRoot,
    stdio: "inherit",
  });
  if (expand.status !== 0) {
    throw new Error(`Failed to extract Bun ${WINDOWS_COMPILE_BUN_VERSION}.`);
  }
}

const compilerVersion = runText(compilerBun, ["--version"]);
if (compilerVersion !== WINDOWS_COMPILE_BUN_VERSION) {
  throw new Error(
    `Corrective compiler must be Bun ${WINDOWS_COMPILE_BUN_VERSION}; observed ${compilerVersion}.`,
  );
}

console.log(`Repository Bun: ${pathBunVersion}`);
console.log(`Windows compile Bun: ${compilerVersion}`);
console.log(`Windows compile Bun SHA-256: ${downloadedHash}`);

const buildScript = join(repoRoot, "apps", "cli", "src", "build.ts");
const build = spawnSync(compilerBun, [buildScript, "binary", "--target", "executor-windows-x64"], {
  cwd: repoRoot,
  env: process.env,
  stdio: "inherit",
});
if (build.status !== 0) {
  throw new Error(`Windows corrective binary build failed with exit code ${build.status}.`);
}

const binaryPath = join(
  repoRoot,
  "apps",
  "cli",
  "dist",
  "executor-windows-x64",
  "bin",
  "executor.exe",
);
if (!existsSync(binaryPath)) {
  throw new Error(`Expected Windows binary was not produced: ${binaryPath}`);
}

const binaryVersion = runText(binaryPath, ["--version"]);
const sourceCommit = runText("git", ["rev-parse", "HEAD"]);
console.log(`Source commit: ${sourceCommit}`);
console.log(`Binary version: ${binaryVersion}`);
console.log(`Binary path: ${binaryPath}`);
console.log(`Binary SHA-256: ${sha256File(binaryPath)}`);
console.log("WINDOWS_RUNTIME_CORRECTIVE_BUILD_PASS");
