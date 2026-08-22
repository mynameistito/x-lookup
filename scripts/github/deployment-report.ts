type DeploymentState = "failure" | "in_progress" | "inactive" | "success";

interface GitHubDeployment {
  readonly id: number;
}

interface GitHubComment {
  readonly id: number;
  readonly body?: string | null;
}

interface GitHubContext {
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

const productionStage = "prod";
const workerName = "x-lookup";
const deploymentMarker = "<!-- x-lookup-deployment:";

const env = (name: string): string => {
  const value = Bun.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
};

const optionalEnv = (name: string): string | undefined =>
  Bun.env[name] || undefined;

const repositoryParts = (repository: string): readonly [string, string] => {
  const [owner, name] = repository.split("/");
  if (!owner || !name) {
    throw new Error(`Invalid GITHUB_REPOSITORY: ${repository}`);
  }
  return [owner, name];
};

const context = (): GitHubContext => ({
  accountId: optionalEnv("CLOUDFLARE_ACCOUNT_ID"),
  deployOutcome: optionalEnv("DEPLOY_OUTCOME"),
  deploymentId: optionalEnv("DEPLOYMENT_ID")
    ? Number(env("DEPLOYMENT_ID"))
    : undefined,
  deploymentUrl: optionalEnv("DEPLOYMENT_URL"),
  logsUrl: optionalEnv("CLOUDFLARE_LOGS_URL"),
  pullRequestNumber: optionalEnv("PULL_REQUEST_NUMBER")
    ? Number(env("PULL_REQUEST_NUMBER"))
    : undefined,
  repository: env("GITHUB_REPOSITORY"),
  runId: env("GITHUB_RUN_ID"),
  serverUrl: env("GITHUB_SERVER_URL"),
  sha: env("GITHUB_SHA"),
  stage: env("STAGE"),
  token: env("GITHUB_TOKEN"),
});

const apiRequest = async <T>(
  github: GitHubContext,
  path: string,
  init: RequestInit = {}
): Promise<T> => {
  const response = await fetch(`https://api.github.com${path}`, {
    ...init,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${github.token}`,
      "User-Agent": "x-lookup-deployment-report",
      "X-GitHub-Api-Version": "2022-11-28",
      ...init.headers,
    },
  });
  if (!response.ok) {
    throw new Error(`GitHub API ${response.status}: ${await response.text()}`);
  }
  if (response.status === 204) {
    // SAFETY: A 204 response has no body, and callers only use this request for its side effect.
    return undefined as T;
  }
  // SAFETY: GitHub's endpoint response is parsed at each typed call site.
  return (await response.json()) as T;
};

const deploymentPath = (github: GitHubContext): string => {
  const [owner, repository] = repositoryParts(github.repository);
  return `/repos/${owner}/${repository}/deployments`;
};

const runUrl = (github: GitHubContext): string =>
  `${github.serverUrl}/${github.repository}/actions/runs/${github.runId}`;

const logsUrl = (github: GitHubContext): string => {
  if (github.logsUrl) {
    return github.logsUrl;
  }
  const accountId = env("CLOUDFLARE_ACCOUNT_ID");
  const name =
    github.stage === productionStage
      ? workerName
      : `${workerName}-${github.stage}`;
  return `https://dash.cloudflare.com/?to=/${accountId}/workers/services/view/${name}/production/logs`;
};

const writeOutput = async (name: string, value: string): Promise<void> => {
  const outputPath = env("GITHUB_OUTPUT");
  const output = await Bun.file(outputPath).text();
  await Bun.write(outputPath, `${output}${name}=${value}\n`);
};

const createDeployment = async (github: GitHubContext): Promise<void> => {
  const deployment = await apiRequest<GitHubDeployment>(
    github,
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
    }
  );
  await apiRequest(
    github,
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
  await writeOutput("id", String(deployment.id));
};

const completeDeployment = async (github: GitHubContext): Promise<void> => {
  if (github.deploymentId === undefined) {
    throw new Error("DEPLOYMENT_ID is required to complete a deployment");
  }
  const succeeded = github.deployOutcome === "success";
  await apiRequest(
    github,
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

const formatUpdatedAt = (): string =>
  new Intl.DateTimeFormat("en-US", {
    day: "2-digit",
    hour: "2-digit",
    hour12: true,
    minute: "2-digit",
    month: "short",
    timeZone: "UTC",
    year: "numeric",
  })
    .format(new Date())
    .replaceAll(", ", " ");

const deploymentComment = (github: GitHubContext): string => {
  const succeeded = github.deployOutcome === "success";
  const name =
    github.stage === productionStage
      ? workerName
      : `${workerName}-${github.stage}`;
  const url = github.deploymentUrl || "#";
  const status = succeeded ? "Deployment successful!" : "Deployment failed";
  const displayName = succeeded ? `[${name}](${url})` : name;
  const commitUrl = `${github.serverUrl}/${github.repository}/commit/${github.sha}`;
  const marker = `${deploymentMarker} ${github.stage} -->`;

  return [
    marker,
    `## Deploying with &nbsp;<a href="https://alchemy.run/"><img alt="Alchemy" src="https://raw.githubusercontent.com/${github.repository}/${github.sha}/.github/alchemy.svg" width="16" height="16"></a> &nbsp;Alchemy`,
    "",
    "The latest updates on your project.",
    "",
    "| Status | Name | Latest Commit | Updated (UTC) |",
    "| - | - | - | - |",
    `| ${status} <br>[View logs](${logsUrl(github)}) | ${displayName} | [${github.sha.slice(0, 8)}](${commitUrl}) | ${formatUpdatedAt()} |`,
    "",
    `**GitHub Actions run:** [View deployment diagnostics](${runUrl(github)})`,
  ].join("\n");
};

const commentDeployment = async (github: GitHubContext): Promise<void> => {
  const issueNumber = github.pullRequestNumber;
  if (issueNumber === undefined) {
    throw new Error(
      "PULL_REQUEST_NUMBER is required to comment on a deployment"
    );
  }
  const [owner, repository] = repositoryParts(github.repository);
  const comments = await apiRequest<readonly GitHubComment[]>(
    github,
    `/repos/${owner}/${repository}/issues/${issueNumber}/comments?per_page=100`
  );
  const body = deploymentComment(github);
  const existing = comments.find((comment) =>
    comment.body?.includes(`${deploymentMarker} ${github.stage}`)
  );
  if (existing) {
    await apiRequest(
      github,
      `/repos/${owner}/${repository}/issues/comments/${existing.id}`,
      {
        body: JSON.stringify({ body }),
        method: "PATCH",
      }
    );
    return;
  }
  await apiRequest(
    github,
    `/repos/${owner}/${repository}/issues/${issueNumber}/comments`,
    {
      body: JSON.stringify({ body }),
      method: "POST",
    }
  );
};

const cleanupDeployments = async (github: GitHubContext): Promise<void> => {
  const [owner, repository] = repositoryParts(github.repository);
  const deployments = await apiRequest<readonly GitHubDeployment[]>(
    github,
    `${deploymentPath(github)}?environment=${encodeURIComponent(github.stage)}&per_page=100`
  );
  await Promise.all(
    deployments.map(async (deployment) => {
      await apiRequest(
        github,
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
        `/repos/${owner}/${repository}/deployments/${deployment.id}`,
        {
          method: "DELETE",
        }
      );
    })
  );
};

const command = Bun.argv.at(2);
const github = context();

switch (command) {
  case "create": {
    await createDeployment(github);
    break;
  }
  case "complete": {
    await completeDeployment(github);
    break;
  }
  case "comment": {
    await commentDeployment(github);
    break;
  }
  case "cleanup": {
    await cleanupDeployments(github);
    break;
  }
  default: {
    throw new Error(
      `Unknown deployment report command: ${command ?? "missing"}`
    );
  }
}
