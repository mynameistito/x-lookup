import { match as matchOption } from "effect/Option";
import {
  decodeUnknownOption,
  Null,
  Number as NumberSchema,
  optional,
  String as StringSchema,
  Struct,
  Union,
} from "effect/Schema";

type DeploymentState = "failure" | "in_progress" | "inactive" | "success";

export interface GitHubDeployment {
  readonly id: number;
}
export interface GitHubComment {
  readonly id: number;
  readonly body?: string | null;
}
export interface GitHubContext {
  readonly token: string;
  readonly repository: string;
  readonly sha: string;
  readonly serverUrl: string;
  readonly runId: string;
  readonly stage: string;
  readonly accountId?: string;
  readonly deploymentId?: number;
  readonly deploymentUrl?: string;
  readonly logsUrl?: string;
  readonly deployOutcome?: string;
  readonly pullRequestNumber?: number;
}
export interface GitHubRequest {
  readonly request: (url: string, init?: RequestInit) => Promise<Response>;
  readonly now?: () => Date;
  readonly writeOutput?: (name: string, value: string) => Promise<void>;
}
type Environment = Record<string, string | undefined>;
type JsonValue =
  | boolean
  | null
  | number
  | string
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue };

const productionStage = "prod";
const workerName = "x-lookup";
const deploymentMarker = "<!-- x-lookup-deployment:";
const githubApi = "https://api.github.com";

const requiredEnv = (environment: Environment, name: string): string => {
  const value = environment[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
};
const optionalEnv = (
  environment: Environment,
  name: string
): string | undefined => environment[name] || undefined;
const parseNumberEnv = (
  environment: Environment,
  name: string
): number | undefined => {
  const value = optionalEnv(environment, name);
  if (value === undefined) {
    return undefined;
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`Invalid ${name}: ${value}`);
  }
  return parsed;
};

export const repositoryParts = (
  repository: string
): readonly [string, string] => {
  const parts = repository.split("/");
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    throw new Error(`Invalid GITHUB_REPOSITORY: ${repository}`);
  }
  return [parts[0], parts[1]];
};
export const readContext = (environment: Environment): GitHubContext => ({
  accountId: optionalEnv(environment, "CLOUDFLARE_ACCOUNT_ID"),
  deployOutcome: optionalEnv(environment, "DEPLOY_OUTCOME"),
  deploymentId: parseNumberEnv(environment, "DEPLOYMENT_ID"),
  deploymentUrl: optionalEnv(environment, "DEPLOYMENT_URL"),
  logsUrl: optionalEnv(environment, "CLOUDFLARE_LOGS_URL"),
  pullRequestNumber: parseNumberEnv(environment, "PULL_REQUEST_NUMBER"),
  repository: requiredEnv(environment, "GITHUB_REPOSITORY"),
  runId: requiredEnv(environment, "GITHUB_RUN_ID"),
  serverUrl: requiredEnv(environment, "GITHUB_SERVER_URL"),
  sha:
    optionalEnv(environment, "DEPLOYMENT_SHA") ??
    requiredEnv(environment, "GITHUB_SHA"),
  stage: requiredEnv(environment, "STAGE"),
  token: requiredEnv(environment, "GITHUB_TOKEN"),
});

const deploymentSchema = Struct({ id: NumberSchema });
const commentSchema = Struct({
  body: optional(Union([Null, StringSchema])),
  id: NumberSchema,
});
const decodeDeployment = decodeUnknownOption(deploymentSchema);
const decodeComment = decodeUnknownOption(commentSchema);

const parseDeployment = (value: JsonValue): GitHubDeployment =>
  matchOption(decodeDeployment(value), {
    onNone: () => {
      throw new Error("GitHub API returned an invalid deployment");
    },
    onSome: (deployment) => deployment,
  });
const parseDeployments = (value: JsonValue): readonly GitHubDeployment[] => {
  if (!Array.isArray(value)) {
    throw new TypeError("GitHub API returned an invalid deployments list");
  }
  return value.map((item) => parseDeployment(item));
};
const parseComment = (value: JsonValue): GitHubComment =>
  matchOption(decodeComment(value), {
    onNone: () => {
      throw new Error("GitHub API returned an invalid comment");
    },
    onSome: (comment) => comment,
  });
const parseComments = (value: JsonValue): readonly GitHubComment[] => {
  if (!Array.isArray(value)) {
    throw new TypeError("GitHub API returned an invalid comments list");
  }
  return value.map((item) => parseComment(item));
};

const nextLink = (link: string | null): string | undefined =>
  link?.match(/<(?<url>[^>]+)>;\s*rel="next"/u)?.groups?.url;
const headers = (github: GitHubContext): HeadersInit => ({
  Accept: "application/vnd.github+json",
  Authorization: `Bearer ${github.token}`,
  "Content-Type": "application/json",
  "User-Agent": "x-lookup-deployment-report",
  "X-GitHub-Api-Version": "2022-11-28",
});
const requestUrl = (path: string): string =>
  path.startsWith("http") ? path : `${githubApi}${path}`;

const responseJson = async (response: Response): Promise<JsonValue> => {
  try {
    return await response.json();
  } catch {
    throw new Error(`GitHub API ${response.status}: invalid JSON response`);
  }
};
function apiRequest<T>(
  github: GitHubContext,
  request: GitHubRequest["request"],
  path: string,
  init: RequestInit,
  parse: (value: JsonValue) => T
): Promise<T>;
function apiRequest(
  github: GitHubContext,
  request: GitHubRequest["request"],
  path: string,
  init?: RequestInit,
  parse?: (value: JsonValue) => JsonValue
): Promise<JsonValue | undefined>;
async function apiRequest<T>(
  github: GitHubContext,
  request: GitHubRequest["request"],
  path: string,
  init: RequestInit = {},
  parse?: (value: JsonValue) => T
): Promise<T | JsonValue | undefined> {
  const response = await request(requestUrl(path), {
    ...init,
    headers: { ...headers(github), ...init.headers },
  });
  if (!response.ok) {
    throw new Error(`GitHub API ${response.status}: ${await response.text()}`);
  }
  if (response.status === 204) {
    return undefined;
  }
  const value = await responseJson(response);
  return parse ? parse(value) : value;
}
const paged = async <T>(
  github: GitHubContext,
  request: GitHubRequest["request"],
  url: string,
  parse: (value: JsonValue) => readonly T[]
): Promise<readonly T[]> => {
  const response = await request(requestUrl(url), { headers: headers(github) });
  if (!response.ok) {
    throw new Error(`GitHub API ${response.status}: ${await response.text()}`);
  }
  const values = parse(await responseJson(response));
  const next = nextLink(response.headers.get("link"));
  return next
    ? [...values, ...(await paged(github, request, next, parse))]
    : values;
};

const deploymentPath = (github: GitHubContext): string => {
  const [owner, repository] = repositoryParts(github.repository);
  return `/repos/${owner}/${repository}/deployments`;
};
export const runUrl = (github: GitHubContext): string =>
  `${github.serverUrl}/${github.repository}/actions/runs/${github.runId}`;
export const logsUrl = (github: GitHubContext): string => {
  if (github.logsUrl) {
    return github.logsUrl;
  }
  if (!github.accountId) {
    throw new Error("CLOUDFLARE_ACCOUNT_ID is required for logs URL");
  }
  const name =
    github.stage === productionStage
      ? workerName
      : `${workerName}-${github.stage}`;
  return `https://dash.cloudflare.com/?to=/${github.accountId}/workers/services/view/${name}/production/logs`;
};
const defaultWriteOutput = async (
  name: string,
  value: string
): Promise<void> => {
  const path = requiredEnv(Bun.env, "GITHUB_OUTPUT");
  await Bun.write(path, `${await Bun.file(path).text()}${name}=${value}\n`);
};

export const createDeployment = async (
  github: GitHubContext,
  deps: GitHubRequest
): Promise<void> => {
  const deployment = await apiRequest(
    github,
    deps.request,
    deploymentPath(github),
    {
      body: JSON.stringify({
        auto_merge: false,
        description: `Alchemy ${github.stage} deployment`,
        environment: github.stage,
        production_environment: github.stage === productionStage,
        ref: github.sha,
        required_contexts: [],
        transient_environment: github.stage !== productionStage,
      }),
      method: "POST",
    },
    parseDeployment
  );
  await apiRequest(
    github,
    deps.request,
    `${deploymentPath(github)}/${deployment.id}/statuses`,
    {
      body: JSON.stringify({
        description: "Deploying the Alchemy stack",
        log_url: runUrl(github),
        state: "in_progress" satisfies DeploymentState,
      }),
      method: "POST",
    }
  );
  await (deps.writeOutput ?? defaultWriteOutput)("id", String(deployment.id));
};
export const completeDeployment = async (
  github: GitHubContext,
  deps: GitHubRequest
): Promise<void> => {
  if (github.deploymentId === undefined) {
    throw new Error("DEPLOYMENT_ID is required to complete a deployment");
  }
  const succeeded = github.deployOutcome === "success";
  await apiRequest(
    github,
    deps.request,
    `${deploymentPath(github)}/${github.deploymentId}/statuses`,
    {
      body: JSON.stringify({
        description: succeeded ? "Deployment is live" : "Deployment failed",
        environment_url: github.deploymentUrl,
        log_url: logsUrl(github),
        state: (succeeded ? "success" : "failure") satisfies DeploymentState,
      }),
      method: "POST",
    }
  );
};
export const deploymentComment = (
  github: GitHubContext,
  now = new Date()
): string => {
  const succeeded = github.deployOutcome === "success";
  const name =
    github.stage === productionStage
      ? workerName
      : `${workerName}-${github.stage}`;
  const url = github.deploymentUrl || "#";
  const status = succeeded ? "Deployment successful!" : "Deployment failed";
  const displayName = succeeded ? `[${name}](${url})` : name;
  const commit = `[${github.sha.slice(0, 8)}](${github.serverUrl}/${github.repository}/commit/${github.sha})`;
  const updated = new Intl.DateTimeFormat("en-US", {
    day: "2-digit",
    hour: "2-digit",
    hour12: true,
    minute: "2-digit",
    month: "short",
    timeZone: "UTC",
    year: "numeric",
  })
    .format(now)
    .replaceAll(", ", " ");
  return [
    `${deploymentMarker} ${github.stage} -->`,
    `## Deploying with &nbsp;<a href="https://alchemy.run/"><img alt="Alchemy" src="https://raw.githubusercontent.com/${github.repository}/${github.sha}/.github/alchemy.svg" width="16" height="16"></a> &nbsp;Alchemy`,
    "",
    "The latest updates on your project.",
    "",
    "| Status | Name | Latest Commit | Updated (UTC) |",
    "| - | - | - | - |",
    `| ${status} <br>[View logs](${logsUrl(github)}) | ${displayName} | ${commit} | ${updated} |`,
    "",
    `**GitHub Actions run:** [View deployment diagnostics](${runUrl(github)})`,
  ].join("\n");
};
export const commentDeployment = async (
  github: GitHubContext,
  deps: GitHubRequest
): Promise<void> => {
  if (github.pullRequestNumber === undefined) {
    throw new Error(
      "PULL_REQUEST_NUMBER is required to comment on a deployment"
    );
  }
  const [owner, repository] = repositoryParts(github.repository);
  const comments = await paged(
    github,
    deps.request,
    `/repos/${owner}/${repository}/issues/${github.pullRequestNumber}/comments?per_page=100`,
    parseComments
  );
  const existing = comments.find((comment) =>
    comment.body?.includes(`${deploymentMarker} ${github.stage} -->`)
  );
  const path = existing
    ? `/repos/${owner}/${repository}/issues/comments/${existing.id}`
    : `/repos/${owner}/${repository}/issues/${github.pullRequestNumber}/comments`;
  await apiRequest(github, deps.request, path, {
    body: JSON.stringify({
      body: deploymentComment(github, deps.now?.() ?? new Date()),
    }),
    method: existing ? "PATCH" : "POST",
  });
};
export const cleanupDeployments = async (
  github: GitHubContext,
  deps: GitHubRequest
): Promise<void> => {
  if (!/^pr-[1-9]\d*$/u.test(github.stage)) {
    throw new Error(`Refusing to clean up non-preview stage: ${github.stage}`);
  }
  const [owner, repository] = repositoryParts(github.repository);
  const deployments = await paged(
    github,
    deps.request,
    `${deploymentPath(github)}?environment=${encodeURIComponent(github.stage)}&per_page=100`,
    parseDeployments
  );
  const clean = async (index: number): Promise<void> => {
    const deployment = deployments[index];
    if (!deployment) {
      return;
    }
    await apiRequest(
      github,
      deps.request,
      `${deploymentPath(github)}/${deployment.id}/statuses`,
      {
        body: JSON.stringify({
          description: "Pull request closed",
          state: "inactive" satisfies DeploymentState,
        }),
        method: "POST",
      }
    );
    await apiRequest(
      github,
      deps.request,
      `/repos/${owner}/${repository}/deployments/${deployment.id}`,
      { method: "DELETE" }
    );
    await clean(index + 1);
  };
  await clean(0);
};

const main = async (): Promise<void> => {
  const github = readContext(Bun.env);
  const deps: GitHubRequest = {
    request: fetch,
    writeOutput: defaultWriteOutput,
  };
  switch (Bun.argv.at(2)) {
    case "create": {
      await createDeployment(github, deps);
      break;
    }
    case "complete": {
      await completeDeployment(github, deps);
      break;
    }
    case "comment": {
      await commentDeployment(github, deps);
      break;
    }
    case "cleanup": {
      await cleanupDeployments(github, deps);
      break;
    }
    default: {
      throw new Error(
        `Unknown deployment report command: ${Bun.argv.at(2) ?? "missing"}`
      );
    }
  }
};
if (import.meta.main) {
  await main();
}
