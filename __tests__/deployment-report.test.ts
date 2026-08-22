import { describe, expect, test } from "vitest";

import {
  cleanupDeployments,
  commentDeployment,
  completeDeployment,
  createDeployment,
  deploymentComment,
  readContext,
} from "../scripts/github/deployment-report.ts";
import type {
  GitHubContext,
  GitHubRequest,
} from "../scripts/github/deployment-report.ts";

const context = (overrides: Partial<GitHubContext> = {}): GitHubContext => ({
  accountId: "account",
  repository: "owner/repository",
  runId: "42",
  serverUrl: "https://github.com",
  sha: "1234567890abcdef",
  stage: "pr-7",
  token: "token",
  ...overrides,
});

type JsonBody =
  | Readonly<Record<string, boolean | null | number | string>>
  | readonly Readonly<Record<string, boolean | null | number | string>>[];

const response = (body: JsonBody, init?: ResponseInit): Response =>
  Response.json(body, init);
const rawResponse = (body: string, init?: ResponseInit): Response =>
  new Response(body, init);

const deps = (
  responses: Response[],
  calls: { url: string; init?: RequestInit }[] = []
): GitHubRequest => ({
  request: (url, init) => {
    calls.push({ init, url });
    const nextResponse = responses.shift();
    if (!nextResponse) {
      return Promise.reject(new Error(`Unexpected request: ${url}`));
    }
    return Promise.resolve(nextResponse);
  },
});

describe("deployment reporting", () => {
  test("prefers the deployment SHA when resolving a preview context", () => {
    expect(
      readContext({
        CLOUDFLARE_ACCOUNT_ID: "account",
        DEPLOYMENT_SHA: "preview-sha",
        GITHUB_REPOSITORY: "owner/repository",
        GITHUB_RUN_ID: "42",
        GITHUB_SERVER_URL: "https://github.com",
        GITHUB_SHA: "workflow-sha",
        GITHUB_TOKEN: "token",
        STAGE: "pr-7",
      }).sha
    ).toBe("preview-sha");
  });

  test("creates a deployment, marks it in progress, and writes its output id", async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    const output: string[] = [];
    const request = deps(
      [response({ id: 17 }), new Response(null, { status: 204 })],
      calls
    );
    await createDeployment(context({ sha: "abc", stage: "prod" }), {
      ...request,
      writeOutput: (name, value) => {
        output.push(`${name}=${value}`);
        return Promise.resolve();
      },
    });

    expect(JSON.parse(String(calls[0].init?.body))).toStrictEqual({
      auto_merge: false,
      description: "Alchemy prod deployment",
      environment: "prod",
      production_environment: true,
      ref: "abc",
      required_contexts: [],
      transient_environment: false,
    });
    expect(JSON.parse(String(calls[1].init?.body))).toStrictEqual({
      description: "Deploying the Alchemy stack",
      log_url: "https://github.com/owner/repository/actions/runs/42",
      state: "in_progress",
    });
    expect(output).toStrictEqual(["id=17"]);
  });

  test.each([
    ["success", "success", "Deployment is live"],
    ["failure", "failure", "Deployment failed"],
  ])("completes a %s deployment", async (outcome, state, description) => {
    const calls: { url: string; init?: RequestInit }[] = [];
    await completeDeployment(
      context({
        deployOutcome: outcome,
        deploymentId: 17,
        logsUrl: "https://logs",
      }),
      deps([new Response(null, { status: 204 })], calls)
    );
    expect(JSON.parse(String(calls[0].init?.body))).toStrictEqual({
      description,
      log_url: "https://logs",
      state,
    });
  });

  test("renders production and preview metadata deterministically", () => {
    const comment = deploymentComment(
      context({ deployOutcome: "success", deploymentUrl: "https://preview" }),
      new Date("2026-08-22T13:14:00.000Z")
    );
    expect(comment).toContain("[x-lookup-pr-7](https://preview)");
    expect(comment).toContain(
      "[12345678](https://github.com/owner/repository/commit/1234567890abcdef)"
    );
    expect(comment).toContain("Aug 22 2026 01:14 PM");
    expect(
      deploymentComment(
        context({ stage: "prod" }),
        new Date("2026-08-22T13:14:00.000Z")
      )
    ).toContain("| x-lookup |");
  });

  test("updates a marker comment found after the first 100 comments", async () => {
    const comments = Array.from({ length: 100 }, (_, id) => ({
      body: "other",
      id: id + 1,
    }));
    const calls: { url: string; init?: RequestInit }[] = [];
    await commentDeployment(
      context({ deployOutcome: "success", pullRequestNumber: 7 }),
      {
        ...deps(
          [
            response(comments, {
              headers: {
                Link: '<https://api.github.com/repos/owner/repository/issues/7/comments?page=2>; rel="next"',
              },
            }),
            response([
              { body: "<!-- x-lookup-deployment: pr-7 --> old", id: 1001 },
            ]),
            response({ ok: true }),
          ],
          calls
        ),
        now: () => new Date("2026-08-22T13:14:00.000Z"),
      }
    );
    expect(calls.map(({ url, init }) => [url, init?.method])).toStrictEqual([
      [
        "https://api.github.com/repos/owner/repository/issues/7/comments?per_page=100",
        undefined,
      ],
      [
        "https://api.github.com/repos/owner/repository/issues/7/comments?page=2",
        undefined,
      ],
      [
        "https://api.github.com/repos/owner/repository/issues/comments/1001",
        "PATCH",
      ],
    ]);
  });

  test("creates a comment when the deployment marker is absent", async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    await commentDeployment(context({ pullRequestNumber: 7 }), {
      ...deps([response([]), response({ ok: true })], calls),
      now: () => new Date("2026-08-22T13:14:00.000Z"),
    });
    expect(calls[1].init?.method).toBe("POST");
    expect(calls[1].url).toBe(
      "https://api.github.com/repos/owner/repository/issues/7/comments"
    );
  });

  test("does not confuse a shorter stage marker with a longer stage", async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    await commentDeployment(context({ pullRequestNumber: 7, stage: "pr-1" }), {
      ...deps(
        [
          response([
            { body: "<!-- x-lookup-deployment: pr-10 --> old", id: 10 },
          ]),
          response({ ok: true }),
        ],
        calls
      ),
      now: () => new Date("2026-08-22T13:14:00.000Z"),
    });
    expect(calls[1].init?.method).toBe("POST");
  });

  test("cleans up more than 100 deployments in status-before-delete order", async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    const first = Array.from({ length: 100 }, (_, index) => ({
      id: index + 1,
    }));
    const second = [{ id: 101 }];
    const responses = [
      response(first, {
        headers: {
          Link: '<https://api.github.com/repos/owner/repository/deployments?page=2>; rel="next"',
        },
      }),
      response(second),
      ...Array.from({ length: 202 }, () => new Response(null, { status: 204 })),
    ];
    await cleanupDeployments(context(), deps(responses, calls));
    expect(calls).toHaveLength(204);
    expect(
      calls.slice(2, 6).map(({ url, init }) => [url, init?.method])
    ).toStrictEqual([
      [
        "https://api.github.com/repos/owner/repository/deployments/1/statuses",
        "POST",
      ],
      ["https://api.github.com/repos/owner/repository/deployments/1", "DELETE"],
      [
        "https://api.github.com/repos/owner/repository/deployments/2/statuses",
        "POST",
      ],
      ["https://api.github.com/repos/owner/repository/deployments/2", "DELETE"],
    ]);
    expect(calls.at(-2)?.url).toContain("/deployments/101/statuses");
  });

  test("rejects missing environment and malformed API responses", async () => {
    expect(() => readContext({})).toThrow(
      "Missing required environment variable: GITHUB_REPOSITORY"
    );
    await Promise.all(
      ["not-a-number", 0, 1.5].map((id) =>
        expect(
          createDeployment(context(), deps([response({ id })]))
        ).rejects.toThrow("invalid deployment")
      )
    );
    await expect(
      createDeployment(context(), deps([rawResponse("nope")]))
    ).rejects.toThrow("invalid JSON response");
  });

  test("refuses cleanup of production or malformed preview stages", async () => {
    await expect(
      cleanupDeployments(context({ stage: "prod" }), deps([]))
    ).rejects.toThrow("Refusing to clean up non-preview stage");
    await expect(
      cleanupDeployments(context({ stage: "pr-1abc" }), deps([]))
    ).rejects.toThrow("Refusing to clean up non-preview stage");
  });
});
