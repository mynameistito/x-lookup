// oxlint-disable-next-line sonarjs/no-wildcard-import -- SAFETY: namespace import is the documented Alchemy stack style; the CLI contract lives on the module namespace.
import * as Alchemy from "alchemy";
// oxlint-disable-next-line sonarjs/no-wildcard-import -- SAFETY: namespace import keeps Cloudflare resource families (Worker, providers, state, InferEnv) addressable under one name.
import * as Cloudflare from "alchemy/Cloudflare";
// oxlint-disable-next-line sonarjs/no-wildcard-import -- SAFETY: namespace import matches Effect's recommended style and keeps the program readable as Effect.gen.
import * as Effect from "effect/Effect";

/**
 * The `x-lookup` Worker as an Alchemy resource.
 *
 * Mirrors `wrangler.jsonc` one-to-one so this stack can become the source of
 * truth at cutover: same physical script name, entrypoint, compatibility date,
 * observability flag, `CACHE_TTL_SECONDS` var, and custom domain. Until the
 * deployment cutover, `wrangler.jsonc` remains the active deployment path and
 * this stack is validated type- and construction-time only (no credentials
 * needed).
 */
export const XLookupWorker = Cloudflare.Worker("x-lookup", {
  compatibility: { date: "2026-08-01" },
  domain: "x-lookup.mynameistito.com",
  env: {
    CACHE_TTL_SECONDS: "3600",
  },
  main: "./src/worker.ts",
  name: "x-lookup",
  observability: { enabled: true },
});

/**
 * The runtime `env` contract of {@link XLookupWorker}, derived from its
 * declared bindings. Literal string vars map to `string`.
 */
export type XLookupEnv = Cloudflare.InferEnv<typeof XLookupWorker>;

/**
 * The `x-lookup` Alchemy stack.
 *
 * Exported as the default export because the Alchemy CLI loads the stack
 * entrypoint's default export. Building the value is pure and lazy — nothing
 * contacts Cloudflare until an `alchemy` command runs the program, so
 * typechecking and importing this file are credential-free.
 */
export default Alchemy.Stack(
  "x-lookup",
  {
    providers: Cloudflare.providers(),
    state: Cloudflare.state(),
  },
  Effect.gen(function* buildXLookupStack() {
    const worker = yield* XLookupWorker;

    return {
      url: worker.url,
    };
  })
);
