import { Data, Option, Result, Schema } from "effect";

/** How many posts a full thread renders: between 2 and 100 inclusive. */
export type ThreadLimit = typeof limitSchema.Type;

const limitSchema = Schema.Number.pipe(
  Schema.check(Schema.isInt(), Schema.isBetween({ maximum: 100, minimum: 2 })),
  Schema.brand("ThreadLimit")
);

const decodeLimit = Schema.decodeUnknownOption(limitSchema);

/** The thread limit used when the parameter selects the default full mode. */
const DEFAULT_LIMIT: ThreadLimit = Option.getOrThrow(decodeLimit(100));

/**
 * A parsed `thread` selection.
 *
 * - `off` renders only the focal post.
 * - `full` renders the thread up to {@link ThreadLimit} posts.
 *
 * `cacheToken` preserves the historical cache-key identity of the selection:
 * the default full modes (`full`, `conversation`, absent) share the token
 * `"full"`, while an explicit numeric limit keeps its raw text so that
 * `thread=100` and `thread=full` remain distinct cache entries.
 */
export type ThreadSelection =
  | { readonly _tag: "off"; readonly cacheToken: "off" }
  | {
      readonly _tag: "full";
      readonly cacheToken: string;
      readonly limit: ThreadLimit;
    };

/** The `thread` parameter is neither a mode alias nor a number in range. */
export class InvalidThread extends Data.TaggedError("InvalidThread")<{
  readonly code: "invalid_thread";
  readonly input: string;
  readonly status: 400;
}> {
  override readonly message =
    "`thread` must be `off`, `full`, `conversation`, or a number from 2 to 100.";
}

/**
 * Parse the convert `thread` parameter.
 *
 * `off` disables threading; absent, `full`, and `conversation` select the
 * default full thread (limit 100); an integer from 2 to 100 (after
 * JavaScript numeric coercion and truncation) selects that limit. Numeric
 * aliases such as `2.7` (→ 2) or `1e2` (→ 100) are accepted exactly as
 * before.
 *
 * @param raw - The untrusted thread parameter.
 * @returns The parsed selection with its cache token, or `InvalidThread`.
 */
export const parse = (
  raw?: string | null
): Result.Result<ThreadSelection, InvalidThread> => {
  if (raw === "off") {
    return Result.succeed({ _tag: "off", cacheToken: "off" });
  }
  if (!raw || raw === "full" || raw === "conversation") {
    return Result.succeed({
      _tag: "full",
      cacheToken: "full",
      limit: DEFAULT_LIMIT,
    });
  }
  return Option.match(decodeLimit(Math.trunc(Number(raw))), {
    onNone: () =>
      Result.fail(
        new InvalidThread({ code: "invalid_thread", input: raw, status: 400 })
      ),
    onSome: (limit) => Result.succeed({ _tag: "full", cacheToken: raw, limit }),
  });
};
