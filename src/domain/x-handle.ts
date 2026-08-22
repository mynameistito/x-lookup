import { Data, Option, Result, Schema } from "effect";

/**
 * A valid X handle: 1–15 characters of `[A-Za-z0-9_]`, without the leading
 * `@`. Branded so a raw, unvalidated string cannot be passed where a parsed
 * handle is required.
 */
export type XHandle = typeof schema.Type;

const HANDLE_PATTERN = /^[A-Za-z0-9_]{1,15}$/u;

const schema = Schema.String.pipe(
  Schema.refine((value): value is string => HANDLE_PATTERN.test(value), {
    identifier: "XHandle",
    message: "not a valid X handle",
  }),
  Schema.brand("XHandle")
);

const decode = Schema.decodeUnknownOption(schema);

/**
 * A handle that fails validation.
 *
 * Carries the normalized (de-`@`-ed) input for diagnosis; it never reaches
 * the external error body, whose message is fixed.
 */
export class InvalidXHandle extends Data.TaggedError("InvalidXHandle")<{
  readonly code: "invalid_handle";
  readonly input: string;
  readonly status: 400;
}> {
  override readonly message = "A valid X handle is required.";
}

/**
 * Parse an X handle from untrusted input.
 *
 * Strips one leading `@` before validating, matching the historical query
 * semantics (`@ada` and `ada` are the same handle).
 *
 * @param raw - The untrusted handle text.
 * @returns The parsed handle, or `InvalidXHandle` when it has anything other
 * than 1–15 letters, digits, or underscores after normalization.
 */
export const parse = (raw: string): Result.Result<XHandle, InvalidXHandle> => {
  const normalized = raw.replace(/^@/u, "");
  return Option.match(decode(normalized), {
    onNone: () =>
      Result.fail(
        new InvalidXHandle({
          code: "invalid_handle",
          input: normalized,
          status: 400,
        })
      ),
    onSome: (value) => Result.succeed(value),
  });
};
