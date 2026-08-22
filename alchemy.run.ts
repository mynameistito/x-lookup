// oxlint-disable-next-line sonarjs/no-wildcard-import -- SAFETY: namespace import is the documented Alchemy stack style; the CLI contract lives on the module namespace.
import * as Alchemy from "alchemy";
// oxlint-disable-next-line sonarjs/no-wildcard-import -- SAFETY: namespace import keeps Cloudflare providers and state addressable under one name.
import * as Cloudflare from "alchemy/Cloudflare";
import { Stage } from "alchemy/Stage";
// oxlint-disable-next-line sonarjs/no-wildcard-import -- SAFETY: namespace import matches Effect's recommended style and keeps the stack readable as Effect.gen.
import * as Effect from "effect/Effect";

interface WorkerEnvBindings {
  readonly CACHE_TTL_SECONDS: string;
}

const WORKER_ENV = {
  CACHE_TTL_SECONDS: "3600",
} satisfies WorkerEnvBindings;

/** The only stage that serves the pinned production Worker and custom domain. */
const PROD_STAGE = "prod";

/** Physical Cloudflare Worker script name shared with the pre-Alchemy deploy. */
const WORKER_NAME = "x-lookup";

/** The production custom domain attached to the Worker in `prod`. */
const CUSTOM_DOMAIN = "x-lookup.mynameistito.com";

/** Stage-specific physical identity for the deployed Worker. */
export interface WorkerIdentity {
  /** The pinned physical script name, present only in `prod`. */
  readonly name?: string;
  /** The canonical custom domain, attached only in `prod`. */
  readonly domain?: string;
}

/** Resolve the Worker's isolated script name and optional production domain. */
export const resolveWorkerIdentity = (stage: string): WorkerIdentity =>
  stage === PROD_STAGE
    ? { domain: CUSTOM_DOMAIN, name: WORKER_NAME }
    : { name: `${WORKER_NAME}-${stage}` };

/** Declare the x-lookup Worker and its deployment-time configuration. */
export const makeXLookupWorker = (stage: string) => {
  const identity = resolveWorkerIdentity(stage);

  return Cloudflare.Worker("x-lookup", {
    compatibility: { date: "2026-07-04" },
    dev: { host: "127.0.0.1" },
    domain: identity.domain,
    env: WORKER_ENV,
    main: "./src/worker.ts",
    name: identity.name,
    observability: { enabled: stage === PROD_STAGE },
  });
};

/** Runtime environment inferred from the Worker's declared variables. */
export type XLookupEnv = Cloudflare.InferEnv<typeof WORKER_ENV>;

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
