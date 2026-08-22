// oxlint-disable-next-line sonarjs/no-wildcard-import -- SAFETY: namespace import is the documented Alchemy Effect-native Worker style.
import * as Cloudflare from "alchemy/Cloudflare";
import { Effect, Layer, Option, Schema } from "effect";

import { envSchema } from "@/env.ts";
import type { Env } from "@/env.ts";
import { Browse, layerBrowseWithoutDependencies } from "@/lib/browse.ts";
import { layerWorker } from "@/lib/cache.ts";
import {
  Conversion,
  layerConversionWithoutDependencies,
} from "@/lib/converter.ts";
import {
  layerFxTwitter,
  layerSyndication,
} from "@/lib/provider-service-adapter.ts";
import { layerPostLookupWithoutDependencies } from "@/lib/tweet-fetch.ts";
import { makeHttpApplication } from "@/router.ts";

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

export interface WorkerIdentity {
  /**
   * The pinned physical script name, present only in `prod`; other stages let
   * Alchemy derive a stage-isolated physical name.
   */
  readonly name?: string;
  /**
   * The canonical custom domain, attached only in `prod` so preview and local
   * stages can never capture production traffic.
   */
  readonly domain?: string;
}

/**
 * Decide the Worker's resource identity for one Alchemy stage.
 *
 * `prod` pins the physical script name and custom domain so Alchemy adopts
 * the existing Wrangler-era deployment in place. Every other stage (local
 * dev, PR previews) gets the deterministic, stage-scoped name
 * `x-lookup-<stage>`, keeping previews isolated from production without
 * random suffixes.
 */
export const resolveWorkerIdentity = (stage: string): WorkerIdentity =>
  stage === PROD_STAGE
    ? { domain: CUSTOM_DOMAIN, name: WORKER_NAME }
    : { name: `${WORKER_NAME}-${stage}` };

/**
 * Production composition root for application capabilities.
 *
 * Provider, cache/configuration, lookup, browse, and conversion Layers are
 * selected once when the Worker implementation is initialized, not per request.
 */
export const applicationLayer = (
  env: Env
): Layer.Layer<Browse | Conversion> => {
  const cacheLayer = layerWorker(env);
  const providerLayer = Layer.mergeAll(layerFxTwitter, layerSyndication);
  const postLookupLayer = layerPostLookupWithoutDependencies.pipe(
    Layer.provide(providerLayer)
  );
  const browseLayer = layerBrowseWithoutDependencies.pipe(
    Layer.provide([cacheLayer, layerFxTwitter])
  );
  const conversionLayer = layerConversionWithoutDependencies.pipe(
    Layer.provide([cacheLayer, postLookupLayer])
  );
  return Layer.mergeAll(browseLayer, conversionLayer);
};

const makeApplicationServices = (env: Env) =>
  Effect.all({ browse: Browse, conversion: Conversion }).pipe(
    Effect.provide(applicationLayer(env))
  );

/** Runtime implementation graph, independent of the deployment stage. */
const runtimeImplementation = Effect.gen(function* makeXLookupRuntime() {
  const workerEnv = yield* Cloudflare.WorkerEnvironment;
  const env = Option.getOrElse(
    Schema.decodeUnknownOption(envSchema)(workerEnv),
    () => ({})
  );
  const services = yield* makeApplicationServices(env);

  return {
    fetch: makeHttpApplication(services),
  };
});

/**
 * Declare the x-lookup Worker resource for one stage.
 *
 * The stage is resolved by the caller (the stack body reads the Alchemy
 * `Stage` service) so the props are concrete values: the provider's
 * precreate phase consumes raw, unresolved props and cannot accept lazy
 * per-prop Inputs for identity. In `prod` this pins the physical name and
 * custom domain; elsewhere they stay absent so Alchemy derives an isolated,
 * stage-scoped physical name.
 *
 * Alchemy supplies WorkerEnvironment at initialization and
 * HttpServerRequest per fetch event; the application graph is built once
 * and closed over by the fetch Effect.
 */
export const makeXLookupWorker = (stage: string) =>
  Cloudflare.Worker(
    "x-lookup",
    {
      compatibility: { date: "2026-07-11" },
      dev: { host: "127.0.0.1" },
      domain: resolveWorkerIdentity(stage).domain,
      env: WORKER_ENV,
      main: "./src/worker.ts",
      name: resolveWorkerIdentity(stage).name,
      observability: { enabled: stage === PROD_STAGE },
    },
    runtimeImplementation
  );

/** Runtime env contract derived from the Alchemy Worker declaration. */
export type XLookupEnv = Cloudflare.InferEnv<typeof WORKER_ENV>;

/**
 * Default export required by Alchemy's generated Worker entry, which imports
 * the main module's default binding while bundling the deployable script.
 * The runtime resolves the actual handler through the registered resource,
 * so only the binding's existence matters.
 */
export default makeXLookupWorker;
