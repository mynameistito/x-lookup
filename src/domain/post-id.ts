import { Schema } from "effect";
import type { Brand, Option } from "effect";

/**
 * A numeric X status/post identifier: digits only. Branded so un-normalized
 * user input (e.g. `12a34`) cannot reach the provider adapters.
 */
export type PostId = string & Brand.Brand<"PostId">;

const schema = Schema.String.pipe(
  Schema.refine((value): value is string => /^\d+$/u.test(value), {
    identifier: "PostId",
    message: "not a numeric post id",
  }),
  Schema.brand("PostId")
);

const decode = Schema.decodeUnknownOption(schema);

/**
 * Parse a strictly numeric post id.
 *
 * @param raw - The untrusted id text.
 * @returns The parsed id, or `none` when the text is not entirely digits.
 */
export const parse = (raw: string): Option.Option<PostId> => decode(raw);

/**
 * Extract the digit characters of a raw value.
 *
 * This is the converter's historical `id` query normalization: every
 * non-digit is dropped, then the remainder must still be a non-empty digit
 * string (`"12a34"` → `"1234"`, `"abc"` → `none`).
 *
 * @param raw - The untrusted id text.
 * @returns The digits as a post id, or `none` when none remain.
 */
export const digitsOf = (raw: string): Option.Option<PostId> =>
  decode(raw.replaceAll(/\D/gu, ""));
