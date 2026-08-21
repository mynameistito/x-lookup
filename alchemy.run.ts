// oxlint-disable-next-line sonarjs/no-wildcard-import -- SAFETY: namespace import is the documented Alchemy stack style; the CLI contract lives on the module namespace.
import * as Alchemy from "alchemy";
// oxlint-disable-next-line sonarjs/no-wildcard-import -- SAFETY: namespace import keeps Cloudflare providers and state addressable under one name.
import * as Cloudflare from "alchemy/Cloudflare";
import { Stage } from "alchemy/Stage";
// oxlint-disable-next-line sonarjs/no-wildcard-import -- SAFETY: namespace import matches Effect's recommended style and keeps the stack readable as Effect.gen.
import * as Effect from "effect/Effect";

import { makeXLookupWorker } from "./src/worker.js";

export { makeXLookupWorker, resolveWorkerIdentity } from "./src/worker.js";
export type { WorkerIdentity, XLookupEnv } from "./src/worker.js";

/**
 * The stack's build program: resolves the current stage so the Worker
 * declaration receives concrete identity props, registers the Effect-native
 * resource, and returns its public URL. Tests execute this against Alchemy's
 * in-memory state, so stack validation remains credential-free.
 */
export const buildXLookupStack = Effect.gen(function* buildXLookupStack() {
  const stage = yield* Stage;
  const worker = yield* makeXLookupWorker(stage);

  return {
    url: worker.url,
  };
});

/** The x-lookup Alchemy stack consumed by the CLI. */
export default Alchemy.Stack(
  "x-lookup",
  {
    providers: Cloudflare.providers(),
    state: Cloudflare.state(),
  },
  buildXLookupStack
);
