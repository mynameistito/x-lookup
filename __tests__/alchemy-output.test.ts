import { describe, expect, test } from "vitest";

import {
  buildDeploymentOutputs,
  formatGitHubOutputs,
  parseAlchemyOutput,
  readDeploymentEnvironment,
} from "../scripts/deployment/alchemy-output.ts";

describe(parseAlchemyOutput, () => {
  test("uses the stable production custom domain", () => {
    expect(parseAlchemyOutput("no URL is needed", "prod")).toBe(
      "https://x-lookup.mynameistito.com"
    );
  });

  test("selects the preview URL for the requested Worker among candidates", () => {
    expect(
      parseAlchemyOutput(
        [
          "State URL: https://state.example.workers.dev",
          "Worker URL: https://x-lookup-pr-37.account.workers.dev",
          "Other URL: https://x-lookup-pr-38.account.workers.dev",
        ].join("\n"),
        "pr-37"
      )
    ).toBe("https://x-lookup-pr-37.account.workers.dev");
  });

  test.each(["not a URL", "https://x-lookup-pr-37.example.com"])(
    "rejects output without a deployed preview URL: %s",
    (log) => {
      expect(() => parseAlchemyOutput(log, "pr-37")).toThrow(
        "Could not determine the deployed Worker URL from Alchemy output"
      );
    }
  );
});

describe("deployment outputs", () => {
  test.each([
    ["STAGE", { CLOUDFLARE_ACCOUNT_ID: "account", GITHUB_OUTPUT: "output" }],
    ["CLOUDFLARE_ACCOUNT_ID", { GITHUB_OUTPUT: "output", STAGE: "prod" }],
    ["GITHUB_OUTPUT", { CLOUDFLARE_ACCOUNT_ID: "account", STAGE: "prod" }],
  ])("rejects missing %s", (name, environment) => {
    expect(() => readDeploymentEnvironment(environment)).toThrow(
      `${name} is required`
    );
  });

  test("constructs stable deployment outputs", () => {
    const outputs = buildDeploymentOutputs(
      "pr-37",
      "account-123",
      "https://x-lookup-pr-37.account.workers.dev"
    );

    expect(outputs).toStrictEqual({
      logs_url:
        "https://dash.cloudflare.com/?to=/account-123/workers/services/view/x-lookup-pr-37/production/logs",
      url: "https://x-lookup-pr-37.account.workers.dev",
    });
    expect(formatGitHubOutputs(outputs)).toBe(
      "url=https://x-lookup-pr-37.account.workers.dev\nlogs_url=https://dash.cloudflare.com/?to=/account-123/workers/services/view/x-lookup-pr-37/production/logs\n"
    );
  });
});
