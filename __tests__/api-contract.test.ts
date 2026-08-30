import { describe, expect, test } from "vitest";

import { apiContract } from "@/domain/api-contract.ts";
import { openApiDocument } from "@/metadata/api-catalog.ts";

const document = openApiDocument("https://example.com");

const parametersAt = (path: string) =>
  document.paths[path]?.get.parameters ?? [];

const httpDefault = (parameter: {
  readonly default?: string | number | boolean;
}) => {
  if (parameter.default === true) {
    return "true";
  }
  if (parameter.default === false) {
    return "false";
  }
  return parameter.default;
};

describe("public API contract", () => {
  test("keeps canonical operation parameter sets stable", () => {
    expect(
      Object.fromEntries(
        Object.entries(apiContract).map(([operation, parameters]) => [
          operation,
          parameters.map(({ name }) => name),
        ])
      )
    ).toStrictEqual({
      browse: [
        "resource",
        "handle",
        "q",
        "feed",
        "cursor",
        "page",
        "limit",
        "full",
        "format",
        "nocache",
      ],
      conversion: [
        "url",
        "handle",
        "id",
        "format",
        "thread",
        "context",
        "replies",
        "userinfo",
        "full",
        "nocache",
      ],
      followers: [
        "handle",
        "cursor",
        "page",
        "limit",
        "full",
        "format",
        "nocache",
      ],
      following: [
        "handle",
        "cursor",
        "page",
        "limit",
        "full",
        "format",
        "nocache",
      ],
      profile: [
        "handle",
        "cursor",
        "page",
        "limit",
        "full",
        "format",
        "nocache",
      ],
      search: [
        "q",
        "feed",
        "cursor",
        "page",
        "limit",
        "full",
        "format",
        "nocache",
      ],
    });
  });

  test("projects canonical defaults, ranges, enums, descriptions, and HTTP types", () => {
    const projections = [
      ["browse", "/api/browse"],
      ["conversion", "/api/convert"],
    ] as const;
    for (const [operation, path] of projections) {
      const parameters = parametersAt(path);
      for (const contractParameter of apiContract[operation]) {
        const documented = parameters.find(
          ({ name }) => name === contractParameter.name
        );
        expect(documented).toBeDefined();
        expect(documented).toMatchObject({
          description: contractParameter.description,
          schema: {
            default: httpDefault(contractParameter),
            enum: contractParameter.httpValues ?? contractParameter.values,
            maximum: contractParameter.maximum,
            minimum: contractParameter.minimum,
            type: contractParameter.httpType,
          },
        });
      }
    }
  });

  test("records the deliberate HTTP string versus MCP typed distinction", () => {
    expect(
      apiContract.browse.find(({ name }) => name === "page")
    ).toMatchObject({
      httpType: "string",
      mcpType: "integer",
    });
    expect(
      apiContract.browse.find(({ name }) => name === "full")
    ).toMatchObject({
      httpType: "string",
      mcpType: "boolean",
    });
  });
});
