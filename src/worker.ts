// oxlint-disable-next-line sonarjs/no-wildcard-import -- SAFETY: namespace import is the documented Alchemy Effect-native Worker style.
import * as Cloudflare from "alchemy/Cloudflare";
import { Stage } from "alchemy/Stage";
import { Effect, Layer, Option, Schema } from "effect";

import { envSchema } from "./env.js";
import type { Env } from "./env.js";
import { Browse, layerBrowseWithoutDependencies } from "./lib/browse.js";
import { layerWorker } from "./lib/cache.js";
import {
  Conversion,
  layerConversionWithoutDependencies,
} from "./lib/converter.js";
import {
  layerFxTwitter,
  layerSyndication,
} from "./lib/provider-service-adapter.js";
import { layerPostLookupWithoutDependencies } from "./lib/tweet-fetch.js";
import { makeHttpApplication } from "./router.js";

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
 * the existing Wrangler-era deployment in place; every other stage (local
 * dev, PR previews) derives an isolated identity.
 */
export const resolveWorkerIdentity = (stage: string): WorkerIdentity =>
  stage === PROD_STAGE ? { domain: CUSTOM_DOMAIN, name: WORKER_NAME } : {};

/** The stage-resolved Worker identity used by the resource declaration. */
const workerIdentity = Stage.pipe(Effect.map(resolveWorkerIdentity));

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

/**
 * Effect-native Alchemy Worker resource and runtime implementation.
 *
 * Alchemy supplies WorkerEnvironment at initialization and HttpServerRequest per
 * fetch event. The concrete application graph is built once and closed over by
 * the fetch Effect.
 */
export const XLookupWorker = Cloudflare.Worker(
  "x-lookup",
  {
    compatibility: { date: "2026-08-01" },
    // Stage-resolved inputs: identity is pinned in `prod` and derived for
    // every other stage, so previews never touch the production resource.
    domain: workerIdentity.pipe(Effect.map((identity) => identity.domain)),
    env: WORKER_ENV,
    main: "./src/worker.ts",
    name: workerIdentity.pipe(Effect.map((identity) => identity.name)),
    observability: { enabled: true },
  },
  Effect.gen(function* makeXLookupWorker() {
    const workerEnv = yield* Cloudflare.WorkerEnvironment;
    const env = Option.getOrElse(
      Schema.decodeUnknownOption(envSchema)(workerEnv),
      () => ({})
    );
    const services = yield* makeApplicationServices(env);

    return {
      fetch: makeHttpApplication(services),
    };
  })
);

/** Runtime env contract derived from the Alchemy Worker declaration. */
export type XLookupEnv = Cloudflare.InferEnv<typeof WORKER_ENV>;

export default XLookupWorker;
