const PRODUCTION_STAGE = "prod";
const PRODUCTION_URL = "https://x-lookup.mynameistito.com";
const WORKER_NAME = "x-lookup";

export interface DeploymentOutputs {
  readonly url: string;
  readonly logs_url: string;
}

/** Environment values required by the Alchemy output entrypoint. */
export interface DeploymentEnvironment {
  readonly accountId: string;
  readonly outputPath: string;
  readonly stage: string;
}

/** Parse the required deployment environment without reading process state. */
export const readDeploymentEnvironment = (
  environment: Record<string, string | undefined>
): DeploymentEnvironment => {
  const stage = environment.STAGE;
  if (!stage) {
    throw new Error("STAGE is required");
  }
  const accountId = environment.CLOUDFLARE_ACCOUNT_ID;
  if (!accountId) {
    throw new Error("CLOUDFLARE_ACCOUNT_ID is required");
  }
  const outputPath = environment.GITHUB_OUTPUT;
  if (!outputPath) {
    throw new Error("GITHUB_OUTPUT is required");
  }
  return { accountId, outputPath, stage };
};

const missingUrlMessage =
  "Could not determine the deployed Worker URL from Alchemy output";

/** Select the URL belonging to the Worker deployed for the requested stage. */
export const parseAlchemyOutput = (log: string, stage: string): string => {
  if (stage === PRODUCTION_STAGE) {
    return PRODUCTION_URL;
  }

  const workerName = `${WORKER_NAME}-${stage}`;
  const candidates = log.match(/https:\/\/[^\s"'<>]+/gu) ?? [];
  const url = candidates
    .map((candidate) => candidate.replaceAll(/[),.;]+$/gu, ""))
    .map((candidate) => {
      try {
        return new URL(candidate);
      } catch {
        return null;
      }
    })
    .find(
      (candidate) =>
        candidate?.protocol === "https:" &&
        candidate.hostname.endsWith(".workers.dev") &&
        candidate.hostname.startsWith(`${workerName}.`)
    );

  if (!url) {
    throw new Error(missingUrlMessage);
  }

  return url.origin;
};

/** Construct the stable values consumed by the deployment-report script. */
export const buildDeploymentOutputs = (
  stage: string,
  accountId: string,
  url: string
): DeploymentOutputs => {
  const workerName =
    stage === PRODUCTION_STAGE ? WORKER_NAME : `${WORKER_NAME}-${stage}`;
  return {
    logs_url: `https://dash.cloudflare.com/?to=/${accountId}/workers/services/view/${workerName}/production/logs`,
    url,
  };
};

/** Serialize outputs using GitHub Actions' existing output names. */
export const formatGitHubOutputs = ({
  url,
  logs_url,
}: DeploymentOutputs): string => `url=${url}\nlogs_url=${logs_url}\n`;

const main = async (): Promise<void> => {
  const logPath = Bun.argv.at(2);
  if (!logPath) {
    throw new Error("The Alchemy log path is required");
  }

  const { accountId, outputPath, stage } = readDeploymentEnvironment(Bun.env);

  const url = parseAlchemyOutput(await Bun.file(logPath).text(), stage);
  const outputs = buildDeploymentOutputs(stage, accountId, url);
  const output = await Bun.file(outputPath).text();
  await Bun.write(outputPath, `${output}${formatGitHubOutputs(outputs)}`);
};

if (import.meta.main) {
  await main();
}
