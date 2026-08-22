import { Layer, ManagedRuntime } from "effect";
import { FetchHttpClient } from "effect/unstable/http";
import { NodeFileSystem } from "@effect/platform-node";

import {
  IntegrationsRegistry,
  integrationsRegistryLayer,
} from "@executor-js/integrations-registry";

import { USER_AGENT } from "./installation";

const makeIntegrationsRuntime = () =>
  ManagedRuntime.make(
    integrationsRegistryLayer({ userAgent: USER_AGENT }).pipe(
      Layer.provide(FetchHttpClient.layer),
      Layer.provide(NodeFileSystem.layer),
    ),
  );

type IntegrationsRuntime = ReturnType<typeof makeIntegrationsRuntime>;

// Shared while at least one long-running apps/local surface is alive. The
// runtime is recreated after the final release so a later server in the same
// process can acquire a fresh recurring-refresh scope.
let integrationsRuntime: IntegrationsRuntime | null = null;
let integrationsRuntimeConsumers = 0;

/**
 * Idempotently trigger the registry layer to build, which forks the boot
 * fetch and recurring refresh into the runtime's scope. Fire-and-forget:
 * returns immediately, never throws, never blocks the caller. Failures are
 * absorbed inside the forked fiber and the layer's catchCause handlers.
 */
export const startIntegrationsRefresh = (): (() => Promise<void>) => {
  const runtime = integrationsRuntime ?? (integrationsRuntime = makeIntegrationsRuntime());
  integrationsRuntimeConsumers += 1;
  runtime.runFork(IntegrationsRegistry.asEffect());

  let released = false;
  return async () => {
    if (released) return;
    released = true;
    integrationsRuntimeConsumers -= 1;
    if (integrationsRuntimeConsumers !== 0 || integrationsRuntime !== runtime) return;
    integrationsRuntime = null;
    await runtime.dispose();
  };
};
