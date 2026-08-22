const logPath = Bun.argv.at(2);
if (!logPath) {
  throw new Error("The Alchemy log path is required");
}

const log = await Bun.file(logPath).text();
const stage = Bun.env.STAGE;
const accountId = Bun.env.CLOUDFLARE_ACCOUNT_ID;
if (!stage || !accountId) {
  throw new Error("STAGE and CLOUDFLARE_ACCOUNT_ID are required");
}

const url =
  stage === "prod"
    ? "https://x-lookup.mynameistito.com"
    : log.match(/https:\/\/[\w.-]+workers\.dev/gu)?.at(-1);
if (!url) {
  throw new Error(
    "Could not determine the deployed Worker URL from Alchemy output"
  );
}

const workerName = stage === "prod" ? "x-lookup" : `x-lookup-${stage}`;
const logsUrl = `https://dash.cloudflare.com/?to=/${accountId}/workers/services/view/${workerName}/production/logs`;
const outputPath = Bun.env.GITHUB_OUTPUT;
if (!outputPath) {
  throw new Error("GITHUB_OUTPUT is required");
}

const output = await Bun.file(outputPath).text();
await Bun.write(outputPath, `${output}url=${url}\nlogs_url=${logsUrl}\n`);
