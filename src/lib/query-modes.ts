import { Data, Option, Result, Schema } from "effect";

/** How much conversation context surrounds the focal post. */
export type ContextMode = typeof contextSchema.Type;

const contextSchema = Schema.Literals(["full", "thread"]);

/** Which replies accompany the focal post. */
export type RepliesMode = typeof repliesSchema.Type;

const repliesSchema = Schema.Literals(["off", "recent", "top"]);

/** How much author information the renderer includes. */
export type UserinfoLevel = typeof userinfoSchema.Type;

const userinfoSchema = Schema.Literals(["all", "author", "off"]);

const decodeContext = Schema.decodeUnknownOption(contextSchema);
const decodeReplies = Schema.decodeUnknownOption(repliesSchema);
const decodeUserinfo = Schema.decodeUnknownOption(userinfoSchema);

/** The `context` parameter is not `full` or `thread`. */
export class InvalidContext extends Data.TaggedError("InvalidContext")<{
  readonly code: "invalid_context";
  readonly input: string;
  readonly status: 400;
}> {
  override readonly message = "`context` must be `full` or `thread`.";
}

/** The `replies` parameter is not `top`, `recent`, or `off`. */
export class InvalidReplies extends Data.TaggedError("InvalidReplies")<{
  readonly code: "invalid_replies";
  readonly input: string;
  readonly status: 400;
}> {
  override readonly message = "`replies` must be `top`, `recent`, or `off`.";
}

/** The `userinfo` parameter is not `off`, `author`, or `all`. */
export class InvalidUserinfo extends Data.TaggedError("InvalidUserinfo")<{
  readonly code: "invalid_userinfo";
  readonly input: string;
  readonly status: 400;
}> {
  override readonly message = "`userinfo` must be `off`, `author`, or `all`.";
}

/**
 * Parse the convert `context` parameter; absent or empty selects `full`.
 *
 * @param raw - The untrusted context parameter.
 * @returns The parsed mode, or `InvalidContext`.
 */
export const parseContext = (
  raw?: string | null
): Result.Result<ContextMode, InvalidContext> => {
  if (!raw || raw === "full") {
    return Result.succeed("full");
  }
  return Option.match(decodeContext(raw), {
    onNone: () =>
      Result.fail(
        new InvalidContext({ code: "invalid_context", input: raw, status: 400 })
      ),
    onSome: (value) => Result.succeed(value),
  });
};

/**
 * Parse the convert `replies` parameter; absent or empty selects `top`.
 *
 * @param raw - The untrusted replies parameter.
 * @returns The parsed mode, or `InvalidReplies`.
 */
export const parseReplies = (
  raw?: string | null
): Result.Result<RepliesMode, InvalidReplies> => {
  if (!raw || raw === "top") {
    return Result.succeed("top");
  }
  return Option.match(decodeReplies(raw), {
    onNone: () =>
      Result.fail(
        new InvalidReplies({ code: "invalid_replies", input: raw, status: 400 })
      ),
    onSome: (value) => Result.succeed(value),
  });
};

/**
 * Parse the convert `userinfo` parameter; absent or empty selects `off`.
 *
 * @param raw - The untrusted userinfo parameter.
 * @returns The parsed level, or `InvalidUserinfo`.
 */
export const parseUserinfo = (
  raw?: string | null
): Result.Result<UserinfoLevel, InvalidUserinfo> => {
  if (!raw || raw === "off") {
    return Result.succeed("off");
  }
  return Option.match(decodeUserinfo(raw), {
    onNone: () =>
      Result.fail(
        new InvalidUserinfo({
          code: "invalid_userinfo",
          input: raw,
          status: 400,
        })
      ),
    onSome: (value) => Result.succeed(value),
  });
};
