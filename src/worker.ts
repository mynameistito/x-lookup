// oxlint-disable-next-line sonarjs/no-wildcard-import -- SAFETY: namespace import is the documented Alchemy Effect-native Worker style.
import * as Cloudflare from "alchemy/Cloudflare";
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

/**
 * Production composition root for application capabilities.
 *
 * Provider, cache/configuration, lookup, browse, and conversion Layers are
 * selected once when the Worker implementation is initialized, not per request.
 */
export const applicationLayer = (env: Env): Layer.Layer<Browse | Conversion> => {
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
    domain: "x-lookup.mynameistito.com",
    env: {
      CACHE_TTL_SECONDS: "3600",
    },
    main: import.meta.url,
    name: "x-lookup",
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
export type XLookupEnv = Cloudflare.InferEnv<typeof XLookupWorker>;

export default XLookupWorker;
