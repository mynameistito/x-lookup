import { Option, Result, Schema } from "effect";

import { InvalidBrowseFormat as BrowseFormatError } from "@/domain/errors/invalid-browse-format.ts";
import { InvalidBrowseResource as BrowseResourceError } from "@/domain/errors/invalid-browse-resource.ts";
import { MissingSearchQuery as MissingQueryError } from "@/domain/errors/missing-search-query.ts";

/** Raw count-style query values (`page`, `limit`). */
export type CountValue = string | number | null | undefined;

/** The resources the browse endpoint exposes. */
export const resourceSchema = Schema.Literals([
  "followers",
  "following",
  "profile",
  "search",
]);

/** A parsed browse resource. */
export type BrowseResource = typeof resourceSchema.Type;

/** The search feeds FxTwitter ranks results by. */
export const feedSchema = Schema.Literals(["latest", "media", "top"]);

/** A parsed browse search feed. */
export type BrowseFeed = typeof feedSchema.Type;

/** The output formats the browse endpoint renders. */
export const formatSchema = Schema.Literals(["json", "markdown"]);

/** A parsed browse output format. */
export type BrowseFormat = typeof formatSchema.Type;

/** A browse result page: between 1 and {@link MAX_PAGE} inclusive. */
export type BrowsePage = typeof pageSchema.Type;

/** A browse page size: between 1 and {@link MAX_LIMIT} inclusive. */
export type BrowseLimit = typeof limitSchema.Type;

export const MAX_PAGE = 10;
export const MAX_LIMIT = 50;
export const DEFAULT_LIMIT = 20;
const DEFAULT_FEED: BrowseFeed = "latest";

const pageSchema = Schema.Number.pipe(
  Schema.check(
    Schema.isInt(),
    Schema.isBetween({ maximum: MAX_PAGE, minimum: 1 })
  ),
  Schema.brand("BrowsePage")
);

const limitSchema = Schema.Number.pipe(
  Schema.check(
    Schema.isInt(),
    Schema.isBetween({ maximum: MAX_LIMIT, minimum: 1 })
  ),
  Schema.brand("BrowseLimit")
);

const decodeResource = Schema.decodeUnknownOption(resourceSchema);
const decodeFeed = Schema.decodeUnknownOption(feedSchema);
const decodeFormat = Schema.decodeUnknownOption(formatSchema);
const decodePage = Schema.decodeUnknownOption(pageSchema);
const decodeLimit = Schema.decodeUnknownOption(limitSchema);

const defaultPage: BrowsePage = Option.getOrThrow(decodePage(1));
const defaultLimit: BrowseLimit = Option.getOrThrow(decodeLimit(DEFAULT_LIMIT));

export { InvalidBrowseFormat } from "@/domain/errors/invalid-browse-format.ts";
export { InvalidBrowseResource } from "@/domain/errors/invalid-browse-resource.ts";
export { MissingSearchQuery } from "@/domain/errors/missing-search-query.ts";

/**
 * Parse the browse `resource` parameter.
 *
 * Unlike the convert parameters there is no default: an absent resource is
 * refused with the same error as an unknown one, matching the historical
 * behavior.
 *
 * @param raw - The untrusted resource parameter.
 * @returns The parsed resource, or `InvalidBrowseResource`.
 */
export const parseResource = (
  raw?: string | null
): Result.Result<BrowseResource, BrowseResourceError> => {
  const decoded = raw ? decodeResource(raw) : Option.none();
  return Option.match(decoded, {
    onNone: () =>
      Result.fail(
        new BrowseResourceError({
          code: "invalid_resource",
          input: raw ?? "",
          status: 400,
        })
      ),
    onSome: (value) => Result.succeed(value),
  });
};

/**
 * Parse the browse search `feed` parameter.
 *
 * Unsupported or absent values fall back to `latest`; this parameter never
 * fails, matching the historical behavior.
 *
 * @param raw - The untrusted feed parameter.
 * @returns The parsed feed.
 */
export const parseFeed = (raw?: string | null): BrowseFeed =>
  Option.getOrElse(decodeFeed(raw ?? ""), () => DEFAULT_FEED);

/**
 * Parse the browse `format` parameter; absent or empty selects `markdown`.
 *
 * @param raw - The untrusted format parameter.
 * @returns The parsed format, or `InvalidBrowseFormat`.
 */
export const parseFormat = (
  raw?: string | null
): Result.Result<BrowseFormat, BrowseFormatError> => {
  if (!raw) {
    return Result.succeed("markdown");
  }
  return Option.match(decodeFormat(raw), {
    onNone: () =>
      Result.fail(
        new BrowseFormatError({
          code: "invalid_format",
          input: raw,
          status: 400,
        })
      ),
    onSome: (value) => Result.succeed(value),
  });
};

const positiveIntOr = (raw: CountValue, fallback: number): number => {
  const parsed = Math.trunc(Number(String(raw ?? "")));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

/**
 * Parse the browse `page` parameter.
 *
 * Junk, zero, and negative values fall back to page 1; valid values are
 * clamped to at most {@link MAX_PAGE}. Never fails.
 *
 * @param raw - The untrusted page parameter.
 * @returns The parsed page number.
 */
export const parsePage = (raw: CountValue): BrowsePage => {
  const value = positiveIntOr(raw, 1);
  return Option.getOrElse(
    decodePage(Math.min(value, MAX_PAGE)),
    () => defaultPage
  );
};

/**
 * Parse the browse `limit` parameter.
 *
 * Junk, zero, and negative values fall back to {@link DEFAULT_LIMIT}; valid
 * values are clamped to at most {@link MAX_LIMIT}. Never fails.
 *
 * @param raw - The untrusted limit parameter.
 * @returns The parsed page size.
 */
export const parseLimit = (raw: CountValue): BrowseLimit => {
  const value = positiveIntOr(raw, DEFAULT_LIMIT);
  return Option.getOrElse(
    decodeLimit(Math.min(value, MAX_LIMIT)),
    () => defaultLimit
  );
};

/**
 * Parse the search `q` parameter.
 *
 * The value is trimmed; nothing usable remains → error.
 *
 * @param raw - The untrusted query parameter.
 * @returns The trimmed query text, or `MissingSearchQuery`.
 */
export const parseSearchQuery = (
  raw?: string | null
): Result.Result<string, MissingQueryError> => {
  const query = raw?.trim();
  if (!query) {
    return Result.fail(
      new MissingQueryError({ code: "missing_query", status: 400 })
    );
  }
  return Result.succeed(query);
};
