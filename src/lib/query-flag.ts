/**
 * Boolean query-flag parsing.
 *
 * The two endpoint families historically accepted different truthy aliases:
 * the convert endpoints also treat `yes` as on, while the browse endpoints
 * do not. The difference is preserved verbatim for compatibility, so each
 * policy gets its own named parser.
 */

/** Raw query values a boolean flag can arrive as. */
export type FlagValue = string | boolean | null | undefined;

const flagFrom =
  (aliases: ReadonlySet<string>) =>
  (raw: FlagValue): boolean => {
    if (raw === true) {
      return true;
    }
    if (raw === false || raw === null || raw === undefined) {
      return false;
    }
    return aliases.has(raw);
  };

/**
 * Parse a convert-endpoint flag (`nocache`, `full`).
 *
 * On when the value is `true`, `"1"`, `"true"`, or `"yes"`; off otherwise
 * (including absent, empty, and any other text). Never fails.
 *
 * @param raw - The untrusted flag value.
 * @returns Whether the flag is on.
 */
export const parseConvertFlag = flagFrom(new Set(["1", "true", "yes"]));

/**
 * Parse a browse-endpoint flag (`full`, `nocache`).
 *
 * On when the value is `true`, `"1"`, or `"true"`; off otherwise. Note that
 * `"yes"` is off here but on for the convert endpoints — historical
 * behavior, kept for compatibility.
 *
 * @param raw - The untrusted flag value.
 * @returns Whether the flag is on.
 */
export const parseBrowseFlag = flagFrom(new Set(["1", "true"]));
