import { createMcpHandler } from "agents/mcp/server";
import { Effect, Layer, Option, Schema } from "effect";
import { HttpEffect } from "effect/unstable/http";

import type { XLookupEnv } from "@/alchemy.run.ts";
import {
  Browse,
  layerBrowseWithoutDependencies,
} from "@/application/browse.ts";
import {
  Conversion,
  layerConversionWithoutDependencies,
} from "@/application/conversion.ts";
import { layerPostLookupWithoutDependencies } from "@/application/post-lookup.ts";
import { makeHttpApplication } from "@/http/router.ts";
import { layerWorker } from "@/infrastructure/cache/service.ts";
import { createMcpServer } from "@/mcp/server.ts";
import { layerFxTwitter, layerSyndication } from "@/providers/composition.ts";
import { envSchema } from "@/runtime/env.ts";
import type { Env } from "@/runtime/env.ts";

const MCP_HOSTNAME_PATTERN =
  /^(?:localhost|127\.0\.0\.1|x-lookup\.mynameistito\.com|x-lookup-[a-z0-9][a-z0-9-]*\.[a-z0-9-]+\.workers\.dev)$/u;

const validMcpOrigin = (request: Request): boolean => {
  const origin = request.headers.get("Origin");
  if (!origin) {
    return true;
  }
  try {
    const parsed = new URL(origin);
    return (
      (parsed.protocol === "http:" || parsed.protocol === "https:") &&
      parsed.hostname.length > 0
    );
  } catch {
    return false;
  }
};

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

const makeRequestHandler = async (workerEnv: XLookupEnv) => {
  const env = Option.getOrElse(
    Schema.decodeUnknownOption(envSchema)(workerEnv),
    () => ({})
  );
  const services = await Effect.runPromise(makeApplicationServices(env));
  return {
    http: HttpEffect.toWebHandler(makeHttpApplication(services)),
    mcp: (request: Request, requestEnv: XLookupEnv, ctx: ExecutionContext) => {
      const { hostname } = new URL(request.url);
      if (!MCP_HOSTNAME_PATTERN.test(hostname) || !validMcpOrigin(request)) {
        return Promise.resolve(new Response("Forbidden", { status: 403 }));
      }
      return createMcpHandler(() => createMcpServer(services), {
        allowedHostnames: [hostname],
        // The endpoint is public and read-only; validate Origin syntax above before allowing cross-origin clients.
        allowedOriginHostnames: "*",
        responseMode: "json",
        route: "/mcp",
      })(request, requestEnv, ctx);
    },
  };
};

let requestHandler: ReturnType<typeof makeRequestHandler> | undefined;

/** Cloudflare runtime handler; the application graph is initialized once. */
export default {
  async fetch(
    request: Request,
    env: XLookupEnv,
    ctx: ExecutionContext
  ): Promise<Response> {
    requestHandler ??= makeRequestHandler(env);
    const handlers = await requestHandler;
    return new URL(request.url).pathname === "/mcp"
      ? handlers.mcp(request, env, ctx)
      : handlers.http(request);
  },
};
