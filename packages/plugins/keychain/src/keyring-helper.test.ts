import { describe, expect, it } from "vitest";
import { Effect } from "effect";
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { KEYRING_HELPER_EXECUTABLE_ENV, KEYRING_HELPER_TIMEOUT_ENV } from "./helper-protocol";
import { getPassword, setPassword } from "./keyring";

const withEnv = async <A>(values: Record<string, string>, run: () => Promise<A>): Promise<A> => {
  const previous = new Map<string, string | undefined>();
  for (const [key, value] of Object.entries(values)) {
    previous.set(key, process.env[key]);
    process.env[key] = value;
  }
  try {
    return await run();
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
};

describe("compiled keyring helper isolation", () => {
  it.skipIf(process.platform === "win32")(
    "bounds blocked helpers and keeps set values off argv",
    async () => {
      {
        const dir = mkdtempSync(join(tmpdir(), "executor-keyring-helper-timeout-"));
        const helper = join(dir, "helper.sh");
        const pidFile = join(dir, "pid.txt");
        writeFileSync(
          helper,
          `#!/bin/sh\nprintf '%s' "$$" > ${JSON.stringify(pidFile)}\nwhile :; do :; done\n`,
          { mode: 0o700 },
        );
        chmodSync(helper, 0o700);
        const start = Date.now();
        const failure = await withEnv(
          {
            [KEYRING_HELPER_EXECUTABLE_ENV]: helper,
            [KEYRING_HELPER_TIMEOUT_ENV]: "500",
          },
          () => Effect.runPromise(getPassword("executor-test", "blocked").pipe(Effect.flip)),
        );
        expect(Date.now() - start).toBeLessThan(2_000);
        expect(failure.message).toContain("Failed reading secret");
        const helperPid = Number(readFileSync(pidFile, "utf8"));
        expect(() => process.kill(helperPid, 0)).toThrow();
      }

      {
        const dir = mkdtempSync(join(tmpdir(), "executor-keyring-helper-stdin-"));
        const helper = join(dir, "helper.sh");
        const argvLog = join(dir, "argv.txt");
        const stdinLog = join(dir, "stdin.txt");
        writeFileSync(
          helper,
          `#!/bin/sh\nprintf '%s\\n' "$@" > ${JSON.stringify(argvLog)}\ncat > ${JSON.stringify(stdinLog)}\nprintf '%s\\n' '{"ok":true}'\n`,
          { mode: 0o700 },
        );
        chmodSync(helper, 0o700);
        const value = "do-not-place-this-value-in-argv";
        await withEnv({ [KEYRING_HELPER_EXECUTABLE_ENV]: helper }, () =>
          Effect.runPromise(setPassword("executor-test", "account", value)),
        );
        expect(readFileSync(argvLog, "utf8")).not.toContain(value);
        expect(readFileSync(stdinLog, "utf8")).toContain(value);
      }
    },
    10_000,
  );
});
