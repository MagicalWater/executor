import { createRequire } from "node:module";
import { spawn } from "node:child_process";

import { Effect } from "effect";

import { KeychainError } from "./errors";
import {
  KEYRING_HELPER_ARGUMENT,
  KEYRING_HELPER_CHILD_ENV,
  KEYRING_HELPER_EXECUTABLE_ENV,
  KEYRING_HELPER_TIMEOUT_ENV,
  type KeyringHelperRequest,
  type KeyringHelperResponse,
} from "./helper-protocol";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_SERVICE_NAME = "executor";
const SERVICE_NAME_ENV = "EXECUTOR_KEYCHAIN_SERVICE_NAME";

// ---------------------------------------------------------------------------
// Platform helpers
// ---------------------------------------------------------------------------

export const isSupportedPlatform = () =>
  process.platform === "darwin" || process.platform === "linux" || process.platform === "win32";

export const displayName = () =>
  process.platform === "darwin"
    ? "macOS Keychain"
    : process.platform === "win32"
      ? "Windows Credential Manager"
      : "Desktop Keyring";

export const resolveServiceName = (explicit?: string): string =>
  explicit?.trim() || process.env[SERVICE_NAME_ENV]?.trim() || DEFAULT_SERVICE_NAME;

// ---------------------------------------------------------------------------
// Lazy-load @napi-rs/keyring (native module)
// ---------------------------------------------------------------------------

type EntryConstructor = (typeof import("@napi-rs/keyring"))["Entry"];

let entryCtorPromise: Promise<EntryConstructor> | null = null;

// In compiled bun binaries (`bun build --compile`) `.node` modules aren't
// included in bunfs and there's no node_modules at runtime, so
// @napi-rs/keyring's loader can't find its platform-specific binding.
// `apps/cli/src/build.ts` copies the .node next to the executor and
// `apps/cli/src/main.ts` exports its absolute path here. We load it
// directly because @napi-rs/keyring@1.2.0's NAPI_RS_NATIVE_LIBRARY_PATH
// branch is buggy (assigns to a local that gets overwritten before return).
const loadEntryCtor = async (): Promise<EntryConstructor> => {
  const directPath = process.env.EXECUTOR_KEYRING_NATIVE_PATH;
  if (directPath) {
    const req = createRequire(import.meta.url);
    return (req(directPath) as { Entry: EntryConstructor }).Entry;
  }
  const { Entry } = await import("@napi-rs/keyring");
  return Entry;
};

const loadEntry = (): Effect.Effect<EntryConstructor, KeychainError> =>
  isSupportedPlatform()
    ? Effect.tryPromise({
        try: async () => {
          entryCtorPromise ??= loadEntryCtor();
          return await entryCtorPromise;
        },
        catch: (cause) =>
          new KeychainError({
            message: "Failed loading native keyring",
            cause,
          }),
      })
    : Effect.fail(
        new KeychainError({
          message: `Failed loading native keyring: unsupported platform '${process.platform}'`,
        }),
      );

const createEntry = (serviceName: string, account: string) =>
  Effect.flatMap(loadEntry(), (Entry) =>
    Effect.try({
      try: () => new Entry(serviceName, account),
      catch: (cause) =>
        new KeychainError({
          message: "Failed creating keyring entry",
          cause,
        }),
    }),
  );

const DEFAULT_HELPER_TIMEOUT_MS = 5_000;

const helperTimeoutMs = (): number => {
  const raw = Number(process.env[KEYRING_HELPER_TIMEOUT_ENV]);
  return Number.isFinite(raw) && raw >= 100 && raw <= 30_000 ? raw : DEFAULT_HELPER_TIMEOUT_MS;
};

const helperExecutable = (): string | null => {
  const value = process.env[KEYRING_HELPER_EXECUTABLE_ENV]?.trim();
  return value ? value : null;
};

const runKeyringHelper = (
  request: KeyringHelperRequest,
): Effect.Effect<KeyringHelperResponse, KeychainError> =>
  Effect.tryPromise({
    try: () =>
      new Promise<KeyringHelperResponse>((resolve, reject) => {
        const executable = helperExecutable();
        if (!executable) {
          reject(new Error("Keyring helper executable is unavailable."));
          return;
        }

        const child = spawn(executable, [KEYRING_HELPER_ARGUMENT], {
          stdio: ["pipe", "pipe", "ignore"],
          env: {
            ...process.env,
            [KEYRING_HELPER_CHILD_ENV]: "1",
          },
        });
        let stdout = "";
        let settled = false;
        let timedOut = false;
        const finish = (result: () => void): void => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          result();
        };
        const timer = setTimeout(() => {
          timedOut = true;
          child.kill("SIGKILL");
        }, helperTimeoutMs());

        child.stdout.setEncoding("utf8");
        child.stdout.on("data", (chunk: string) => {
          stdout += chunk;
          if (stdout.length > 4 * 1024 * 1024) child.kill("SIGKILL");
        });
        child.on("error", (cause) => finish(() => reject(cause)));
        child.on("close", () =>
          finish(() => {
            child.stdin.destroy();
            child.stdout.destroy();
            if (timedOut) {
              reject(new Error(`Keyring helper timed out after ${helperTimeoutMs()} ms.`));
              return;
            }
            try {
              const parsed = JSON.parse(stdout.trim()) as KeyringHelperResponse;
              if (!parsed || typeof parsed !== "object" || typeof parsed.ok !== "boolean") {
                throw new Error("Invalid keyring helper response.");
              }
              resolve(parsed);
            } catch (cause) {
              reject(cause);
            }
          }),
        );

        child.stdin.end(JSON.stringify(request));
      }),
    catch: (cause) =>
      new KeychainError({
        message: "Keyring helper failed.",
        cause,
      }),
  });

const helperOrSync = <A>(
  request: KeyringHelperRequest,
  fromResponse: (response: KeyringHelperResponse) => A,
  sync: () => A,
): Effect.Effect<A, KeychainError> => {
  if (!helperExecutable()) {
    return Effect.try({
      try: sync,
      catch: (cause) => new KeychainError({ message: "Keyring operation failed.", cause }),
    });
  }
  return runKeyringHelper(request).pipe(
    Effect.flatMap((response) =>
      response.ok
        ? Effect.try({
            try: () => fromResponse(response),
            catch: (cause) =>
              new KeychainError({ message: "Invalid keyring helper response.", cause }),
          })
        : Effect.fail(new KeychainError({ message: response.message })),
    ),
  );
};

// ---------------------------------------------------------------------------
// Low-level keychain operations
// ---------------------------------------------------------------------------

export const getPassword = (
  serviceName: string,
  account: string,
): Effect.Effect<string | null, KeychainError> => {
  if (helperExecutable()) {
    return helperOrSync(
      { operation: "get", serviceName, account },
      (response) => ("value" in response ? (response.value ?? null) : null),
      () => null,
    ).pipe(
      Effect.mapError(
        (cause) =>
          new KeychainError({
            message: `Failed reading secret for account '${account}'`,
            cause,
          }),
      ),
    );
  }
  return Effect.flatMap(createEntry(serviceName, account), (entry) =>
    Effect.try({
      try: () => entry.getPassword(),
      catch: (cause) =>
        new KeychainError({ message: `Failed reading secret for account '${account}'`, cause }),
    }),
  );
};

export const setPassword = (
  serviceName: string,
  account: string,
  value: string,
): Effect.Effect<void, KeychainError> => {
  if (helperExecutable()) {
    return helperOrSync(
      { operation: "set", serviceName, account, value },
      () => undefined,
      () => undefined,
    ).pipe(
      Effect.asVoid,
      Effect.mapError((cause) => new KeychainError({ message: "Failed writing secret", cause })),
    );
  }
  return Effect.flatMap(createEntry(serviceName, account), (entry) =>
    Effect.try({
      try: () => entry.setPassword(value),
      catch: (cause) => new KeychainError({ message: "Failed writing secret", cause }),
    }).pipe(Effect.asVoid),
  );
};

export const deletePassword = (
  serviceName: string,
  account: string,
): Effect.Effect<boolean, KeychainError> => {
  if (helperExecutable()) {
    return helperOrSync(
      { operation: "delete", serviceName, account },
      (response) => ("deleted" in response ? response.deleted === true : true),
      () => true,
    ).pipe(
      Effect.mapError(
        (cause) =>
          new KeychainError({
            message: `Failed deleting secret for account '${account}'`,
            cause,
          }),
      ),
    );
  }
  return Effect.flatMap(createEntry(serviceName, account), (entry) =>
    Effect.try({
      try: () => {
        entry.deletePassword();
        return true;
      },
      catch: (cause) =>
        new KeychainError({ message: `Failed deleting secret for account '${account}'`, cause }),
    }),
  );
};
