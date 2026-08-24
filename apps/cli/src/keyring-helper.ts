// Hidden child-process entrypoint used only by compiled Executor CLI binaries.
// The parent sends the request (and any secret value) over stdin so credentials
// never appear in argv. Native keyring calls remain synchronous here, but this
// process is disposable: the parent can SIGKILL it on timeout without blocking
// the daemon's Bun event loop.
import { readFileSync, writeSync } from "node:fs";
import { createRequire } from "node:module";

const KEYRING_HELPER_ARGUMENT = "--executor-internal-keyring-helper";
const KEYRING_HELPER_CHILD_ENV = "EXECUTOR_INTERNAL_KEYRING_HELPER";

type KeyringHelperRequest =
  | { readonly operation: "get"; readonly serviceName: string; readonly account: string }
  | {
      readonly operation: "set";
      readonly serviceName: string;
      readonly account: string;
      readonly value: string;
    }
  | { readonly operation: "delete"; readonly serviceName: string; readonly account: string };

type KeyringHelperResponse =
  | { readonly ok: true; readonly value?: string | null; readonly deleted?: boolean }
  | { readonly ok: false; readonly message: string };

type NativeEntry = {
  getPassword: () => string | null;
  setPassword: (value: string) => void;
  deletePassword: () => void;
};
type NativeEntryConstructor = new (service: string, account: string) => NativeEntry;

const isHelperChild =
  process.env[KEYRING_HELPER_CHILD_ENV] === "1" && process.argv.includes(KEYRING_HELPER_ARGUMENT);

if (isHelperChild) {
  const writeAndExit = (response: KeyringHelperResponse, code: number): never => {
    writeSync(1, `${JSON.stringify(response)}\n`);
    process.exit(code);
  };

  try {
    const nativePath = process.env.EXECUTOR_KEYRING_NATIVE_PATH;
    if (!nativePath) {
      writeAndExit({ ok: false, message: "Keyring native binding is unavailable." }, 2);
    }
    const requiredNativePath = nativePath as string;

    const request = JSON.parse(readFileSync(0, "utf8")) as KeyringHelperRequest;
    const req = createRequire(import.meta.url);
    const { Entry } = req(requiredNativePath) as { Entry: NativeEntryConstructor };
    const entry = new Entry(request.serviceName, request.account);

    if (request.operation === "get") {
      writeAndExit({ ok: true, value: entry.getPassword() }, 0);
    }
    if (request.operation === "set") {
      entry.setPassword(request.value);
      writeAndExit({ ok: true }, 0);
    }
    entry.deletePassword();
    writeAndExit({ ok: true, deleted: true }, 0);
  } catch {
    writeAndExit({ ok: false, message: "Keyring helper operation failed." }, 1);
  }
}
