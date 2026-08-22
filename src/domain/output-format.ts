import { Data, Option, Result, Schema } from "effect";

/** The output formats the convert endpoint renders. */
export const schema = Schema.Literals(["json", "markdown", "obsidian"]);

/** A parsed convert output format. */
export type OutputFormat = typeof schema.Type;

const decode = Schema.decodeUnknownOption(schema);

/** The `format` parameter is not one of the supported values. */
export class InvalidOutputFormat extends Data.TaggedError(
  "InvalidOutputFormat"
)<{
  readonly code: "invalid_format";
  readonly input: string;
  readonly status: 400;
}> {
  override readonly message =
    "`format` must be `markdown`, `obsidian`, or `json`.";
}

/**
 * Parse the convert `format` parameter.
 *
 * A missing or empty parameter selects `markdown`, matching the historical
 * default; any other unsupported value is refused.
 *
 * @param raw - The untrusted format parameter.
 * @returns The parsed format, or `InvalidOutputFormat`.
 */
export const parse = (
  raw?: string | null
): Result.Result<OutputFormat, InvalidOutputFormat> => {
  if (!raw) {
    return Result.succeed("markdown");
  }
  return Option.match(decode(raw), {
    onNone: () =>
      Result.fail(
        new InvalidOutputFormat({
          code: "invalid_format",
          input: raw,
          status: 400,
        })
      ),
    onSome: (value) => Result.succeed(value),
  });
};
