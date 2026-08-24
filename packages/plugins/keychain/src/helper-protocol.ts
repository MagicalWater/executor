export const KEYRING_HELPER_ARGUMENT = "--executor-internal-keyring-helper";
export const KEYRING_HELPER_CHILD_ENV = "EXECUTOR_INTERNAL_KEYRING_HELPER";
export const KEYRING_HELPER_EXECUTABLE_ENV = "EXECUTOR_KEYRING_HELPER_EXECUTABLE";
export const KEYRING_HELPER_TIMEOUT_ENV = "EXECUTOR_KEYRING_HELPER_TIMEOUT_MS";

export type KeyringHelperRequest =
  | {
      readonly operation: "get";
      readonly serviceName: string;
      readonly account: string;
    }
  | {
      readonly operation: "set";
      readonly serviceName: string;
      readonly account: string;
      readonly value: string;
    }
  | {
      readonly operation: "delete";
      readonly serviceName: string;
      readonly account: string;
    };

export type KeyringHelperResponse =
  | { readonly ok: true; readonly value?: string | null; readonly deleted?: boolean }
  | { readonly ok: false; readonly message: string };
