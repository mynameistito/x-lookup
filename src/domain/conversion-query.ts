import { Option, Result, Schema } from "effect";

import { InvalidContext as ContextError } from "@/domain/errors/invalid-context.ts";
import { InvalidReplies as RepliesError } from "@/domain/errors/invalid-replies.ts";
import { InvalidUserinfo as UserinfoError } from "@/domain/errors/invalid-userinfo.ts";

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

export { InvalidContext } from "@/domain/errors/invalid-context.ts";
export { InvalidReplies } from "@/domain/errors/invalid-replies.ts";
export { InvalidUserinfo } from "@/domain/errors/invalid-userinfo.ts";

/**
 * Parse the convert `context` parameter; absent or empty selects `full`.
 *
 * @param raw - The untrusted context parameter.
 * @returns The parsed mode, or `InvalidContext`.
 */
export const parseContext = (
  raw?: string | null
): Result.Result<ContextMode, ContextError> => {
  if (!raw || raw === "full") {
    return Result.succeed("full");
  }
  return Option.match(decodeContext(raw), {
    onNone: () =>
      Result.fail(
        new ContextError({ code: "invalid_context", input: raw, status: 400 })
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
): Result.Result<RepliesMode, RepliesError> => {
  if (!raw || raw === "top") {
    return Result.succeed("top");
  }
  return Option.match(decodeReplies(raw), {
    onNone: () =>
      Result.fail(
        new RepliesError({ code: "invalid_replies", input: raw, status: 400 })
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
): Result.Result<UserinfoLevel, UserinfoError> => {
  if (!raw || raw === "off") {
    return Result.succeed("off");
  }
  return Option.match(decodeUserinfo(raw), {
    onNone: () =>
      Result.fail(
        new UserinfoError({
          code: "invalid_userinfo",
          input: raw,
          status: 400,
        })
      ),
    onSome: (value) => Result.succeed(value),
  });
};
