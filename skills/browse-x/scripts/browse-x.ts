type CommandName = "status" | "profile" | "search" | "followers" | "following";
type Resource = "status" | "profile" | "search" | "list";
interface ResourceAndEndpoint {
  endpoint: string;
  resource: Resource;
  targetParam?: string;
}

const commandNames = new Set<string>([
  "status",
  "profile",
  "search",
  "followers",
  "following",
]);

const isCommandName = (value: string): value is CommandName =>
  commandNames.has(value);

const apiBase =
  process.env.X_API_BASE ??
  process.env.X_MD_API_BASE ??
  "https://x-lookup.mynameistito.com";
const args = process.argv.slice(2);
const values = new Map<string, string>();
const valueOptions = new Set([
  "format",
  "page",
  "limit",
  "cursor",
  "feed",
  "thread",
  "userinfo",
  "context",
  "replies",
]);

const exit = (code: number): never => {
  process.exit(code);
  throw new Error("process.exit returned");
};

const fail = (message: string, code = 2): never => {
  console.error(`browse-x: ${message}`);
  return exit(code);
};

const usage = (code = 2): never => {
  console.error(`Usage:
  bun browse-x.ts <x-status-or-profile-url> [options]
  bun browse-x.ts status <x-status-url> [options]
  bun browse-x.ts profile <handle> [options]
  bun browse-x.ts search <query> [options]
  bun browse-x.ts followers <handle> [options]
  bun browse-x.ts following <handle> [options]

Output: --json, --full, --compact, --format markdown|obsidian, --headers
Lists:  --page 1-10, --limit 1-50, --cursor <cursor>, --feed latest|top|media
Status: --thread off|full|conversation|2-100, --userinfo off|author|all,
        --context full|thread, --replies top|recent|off
  Other:  --nocache, --help

X_API_BASE overrides https://x-lookup.mynameistito.com.`);
  return exit(code);
};

const setValue = (name: string, value: string, option: string): void => {
  const oldValue = values.get(name);
  if (oldValue !== undefined && oldValue !== value) {
    fail(
      `${option} was supplied with conflicting values ('${oldValue}' and '${value}')`
    );
  }
  values.set(name, value);
};

const requireValue = (option: string, value: string | undefined): string => {
  if (!value) {
    return fail(`${option} requires a value`);
  }
  return value;
};

if (args.length === 0) {
  usage();
}
if (args[0] === "-h" || args[0] === "--help") {
  usage(0);
}

let commandName: CommandName | "" = "";
let target: string;
const [first] = args;
if (isCommandName(first)) {
  commandName = first;
  target = requireValue(commandName, args[1]);
  args.splice(0, 2);
} else if (first.startsWith("http://") || first.startsWith("https://")) {
  target = first;
  args.shift();
} else {
  fail(`expected a command or public X URL (got '${first}')`);
}

let jsonRequested = false;
let showHeaders = false;
let nocacheRequested = false;
for (let index = 0; index < args.length; index += 1) {
  const option = args[index];
  switch (option) {
    case "--json": {
      jsonRequested = true;
      break;
    }
    case "--full": {
      setValue("full", "true", "--full/--compact");
      break;
    }
    case "--compact": {
      setValue("full", "false", "--full/--compact");
      break;
    }
    case "--headers": {
      showHeaders = true;
      break;
    }
    case "--nocache": {
      nocacheRequested = true;
      break;
    }
    case "-h":
    case "--help": {
      usage(0);
      break;
    }
    default: {
      if (!valueOptions.has(option.slice(2)) || !option.startsWith("--")) {
        fail(`unknown option '${option}'`);
      }
      const next = args[index + 1];
      if (next === undefined || next.startsWith("--")) {
        fail(`${option} requires a value`);
      }
      setValue(option.slice(2), requireValue(option, next), option);
      index += 1;
    }
  }
}

const value = (name: string): string | undefined => values.get(name);
const matches = (name: string, pattern: RegExp, message: string): void => {
  const current = value(name);
  if (current !== undefined && !pattern.test(current)) {
    fail(message);
  }
};
matches(
  "format",
  /^(?:markdown|obsidian|json)$/u,
  "--format must be markdown, obsidian, or json"
);
matches("page", /^(?:[1-9]|10)$/u, "--page must be an integer from 1 to 10");
matches("limit", /^[1-9][0-9]?$/u, "--limit must be an integer from 1 to 50");
if (value("limit") !== undefined && Number(value("limit")) > 50) {
  fail("--limit must be an integer from 1 to 50");
}
matches(
  "feed",
  /^(?:latest|top|media)$/u,
  "--feed must be latest, top, or media"
);
matches(
  "thread",
  /^(?:off|full|conversation|[0-9]+)$/u,
  "--thread must be off, full, conversation, or an integer from 2 to 100"
);
const threadValue = value("thread");
if (
  threadValue !== undefined &&
  /^[0-9]+$/u.test(threadValue) &&
  (Number(threadValue) < 2 || Number(threadValue) > 100)
) {
  fail("--thread must be off, full, conversation, or an integer from 2 to 100");
}
matches(
  "userinfo",
  /^(?:off|author|all)$/u,
  "--userinfo must be off, author, or all"
);
matches("context", /^(?:full|thread)$/u, "--context must be full or thread");
matches(
  "replies",
  /^(?:top|recent|off)$/u,
  "--replies must be top, recent, or off"
);
if (
  jsonRequested &&
  value("format") !== undefined &&
  value("format") !== "json"
) {
  fail(`--json conflicts with --format ${value("format")}`);
}
if (jsonRequested) {
  values.set("format", "json");
}

const publicXHosts = new Set([
  "twitter.com",
  "www.twitter.com",
  "x.com",
  "www.x.com",
]);
const parsePublicXUrl = (input: string): URL => {
  let parsed: URL;
  try {
    parsed = new URL(input);
  } catch {
    return fail(
      "only public x.com or twitter.com status/profile URLs are supported"
    );
  }
  if (
    !["http:", "https:"].includes(parsed.protocol) ||
    !publicXHosts.has(parsed.hostname)
  ) {
    return fail(
      "only public x.com or twitter.com status/profile URLs are supported"
    );
  }
  return parsed;
};

const resourceAndEndpoint = (): ResourceAndEndpoint => {
  const handle = encodeURIComponent(target.replace(/^@/u, ""));
  if (commandName === "status") {
    parsePublicXUrl(target);
    return {
      endpoint: `${apiBase}/api/convert`,
      resource: "status",
      targetParam: `url=${target}`,
    };
  }
  if (commandName === "profile") {
    return { endpoint: `${apiBase}/${handle}`, resource: "profile" };
  }
  if (commandName === "search") {
    return {
      endpoint: `${apiBase}/search`,
      resource: "search",
      targetParam: `q=${target}`,
    };
  }
  if (commandName === "followers" || commandName === "following") {
    return {
      endpoint: `${apiBase}/${handle}/${commandName}`,
      resource: "list",
    };
  }
  const parsed = parsePublicXUrl(target);
  const segments = parsed.pathname.split("/").filter(Boolean);
  if (segments[1] === "status" && /^[0-9]+$/u.test(segments[2] ?? "")) {
    return {
      endpoint: `${apiBase}/api/convert`,
      resource: "status",
      targetParam: `url=${target}`,
    };
  }
  if (parsed.pathname.length > 1) {
    const [handleFromUrl] = segments;
    if (!handleFromUrl) {
      fail("profile URL must contain a handle");
    }
    return {
      endpoint: `${apiBase}/${encodeURIComponent(handleFromUrl)}`,
      resource: "profile",
    };
  }
  return fail("profile URL must contain a handle");
};

const { resource, endpoint, targetParam } = resourceAndEndpoint();
if (
  resource !== "status" &&
  ["thread", "userinfo", "context", "replies"].some(
    (name) => value(name) !== undefined
  )
) {
  fail("status options are only valid for status requests");
}
if (resource !== "status" && value("format") === "obsidian") {
  fail("--format obsidian is only valid for status requests");
}
if (resource !== "search" && value("feed") !== undefined) {
  fail("--feed is only valid for search");
}
if (
  resource === "status" &&
  ["page", "limit", "cursor", "feed"].some((name) => value(name) !== undefined)
) {
  fail("list options are not valid for status requests");
}

const query = new URLSearchParams();
if (targetParam) {
  const separator = targetParam.indexOf("=");
  query.set(targetParam.slice(0, separator), targetParam.slice(separator + 1));
}
for (const name of [
  "format",
  "full",
  "page",
  "limit",
  "cursor",
  "feed",
  "thread",
  "userinfo",
  "context",
  "replies",
]) {
  const current = value(name);
  if (current !== undefined) {
    query.set(name, current);
  }
}
if (nocacheRequested) {
  query.set("nocache", "true");
}

const accept =
  value("format") === "json" ? "application/json" : "text/markdown";
const fetchResult = async (): Promise<{ body: string; response: Response }> => {
  try {
    const response = await fetch(`${endpoint}?${query}`, {
      headers: { Accept: accept },
      signal: AbortSignal.timeout(30_000),
    });
    return { body: await response.text(), response };
  } catch {
    console.error(`browse-x: request to ${apiBase} failed`);
    return exit(1);
  }
};
const { body, response } = await fetchResult();
if (!response.ok) {
  console.error(`browse-x: HTTP ${response.status} from ${endpoint}`);
  console.error(body);
  exit(1);
}
if (showHeaders) {
  for (const [name, headerValue] of response.headers) {
    console.log(`${name}: ${headerValue}`);
  }
}
process.stdout.write(body);
if (body.length > 0 && !body.endsWith("\n")) {
  process.stdout.write("\n");
}
