import { Option, Schema } from "effect";

const envSchema = Schema.Struct({
  CACHE_TTL_SECONDS: Schema.optional(Schema.String),
});

const decodeEnv = Schema.decodeUnknownOption(envSchema);

/** Runtime configuration after parsing the untrusted Worker environment. */
export type Env = typeof envSchema.Type;

/**
 * Parse the Alchemy/Cloudflare Worker environment at the composition boundary.
 * Invalid runtime shapes retain the historical fallback-to-default behavior.
 */
export const parseEnv = (input: unknown): Env =>
  Option.getOrElse(decodeEnv(input), () => ({}));
