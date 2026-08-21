import { Schema } from "effect";

export const envSchema = Schema.Struct({
  CACHE_TTL_SECONDS: Schema.optional(Schema.String),
});

/** Runtime configuration after parsing the untrusted Worker environment. */
export type Env = typeof envSchema.Type;
