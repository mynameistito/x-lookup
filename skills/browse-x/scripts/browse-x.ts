/* eslint-disable curly, no-fallthrough, prefer-destructuring, prefer-named-capture-group, require-unicode-regexp, sort-keys */
/* eslint-disable anti-slop/no-known-value-widening, anti-slop/require-safety-comment-for-type-assertion */

type CommandName = "status" | "profile" | "search" | "followers" | "following";
type Resource = "status" | "profile" | "search" | "list";

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

const fail = (message: string, code = 2): never => {
  console.error(`browse-x: ${message}`);
  process.exit(code);
};

const usage = (code = 2): never => {
  console.error(`Usage:
  node browse-x.ts <x-status-or-profile-url> [options]
  node browse-x.ts status <x-status-url> [options]
  node browse-x.ts profile <handle> [options]
  node browse-x.ts search <query> [options]
  node browse-x.ts followers <handle> [options]
  node browse-x.ts following <handle> [options]

Output: --json, --full, --compact, --format markdown|obsidian, --headers
Lists:  --page 1-10, --limit 1-50, --cursor <cursor>, --feed latest|top|media
Status: --thread off|full|conversation|2-100, --userinfo off|author|all,
        --context full|thread, --replies top|recent|off
Other:  --nocache, --help

X_API_BASE overrides https://x-lookup.mynameistito.com.`);
  process.exit(code);
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
    fail(`${option} requires a value`);
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
const first = args[0];
if (
  ["status", "profile", "search", "followers", "following"].includes(
    first as CommandName
  )
) {
  commandName = first as CommandName;
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
      setValue(option.slice(2), requireValue(option, args[index + 1]), option);
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
  /^(markdown|obsidian|json)$/,
  "--format must be markdown, obsidian, or json"
);
matches("page", /^([1-9]|10)$/, "--page must be an integer from 1 to 10");
matches("limit", /^[1-9][0-9]?$/, "--limit must be an integer from 1 to 50");
if (value("limit") !== undefined && Number(value("limit")) > 50) {
  fail("--limit must be an integer from 1 to 50");
}
matches("feed", /^(latest|top|media)$/, "--feed must be latest, top, or media");
matches(
  "thread",
  /^(off|full|conversation|[0-9]+)$/,
  "--thread must be off, full, conversation, or an integer from 2 to 100"
);
if (
  value("thread") &&
  /^[0-9]+$/.test(value("thread") as string) &&
  (Number(value("thread")) < 2 || Number(value("thread")) > 100)
) {
  fail("--thread must be off, full, conversation, or an integer from 2 to 100");
}
matches(
  "userinfo",
  /^(off|author|all)$/,
  "--userinfo must be off, author, or all"
);
matches("context", /^(full|thread)$/, "--context must be full or thread");
matches(
  "replies",
  /^(top|recent|off)$/,
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

const resourceAndEndpoint = (): {
  resource: Resource;
  endpoint: string;
  targetParam?: string;
} => {
  const handle = target.replace(/^@/, "");
  if (commandName === "status") {
    return {
      resource: "status",
      endpoint: `${apiBase}/api/convert`,
      targetParam: `url=${target}`,
    };
  }
  if (commandName === "profile") {
    return { resource: "profile", endpoint: `${apiBase}/${handle}` };
  }
  if (commandName === "search") {
    return {
      resource: "search",
      endpoint: `${apiBase}/search`,
      targetParam: `q=${target}`,
    };
  }
  if (commandName === "followers" || commandName === "following") {
    return {
      resource: "list",
      endpoint: `${apiBase}/${handle}/${commandName}`,
    };
  }
  if (/\/status\/[0-9]+\/?$/.test(target)) {
    return {
      resource: "status",
      endpoint: `${apiBase}/api/convert`,
      targetParam: `url=${target}`,
    };
  }
  if (/^https:\/\/(www\.)?(x|twitter)\.com\//.test(target)) {
    const handleFromUrl = target
      .replace(/^https?:\/\/[^/]+\//, "")
      .split(/[/?#]/)[0];
    if (!handleFromUrl) {
      fail("profile URL must contain a handle");
    }
    return { endpoint: `${apiBase}/${handleFromUrl}`, resource: "profile" };
  }
  fail("only public x.com or twitter.com status/profile URLs are supported");
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
try {
  const response = await fetch(`${endpoint}?${query}`, {
    headers: { Accept: accept },
  });
  const body = await response.text();
  if (!response.ok) {
    console.error(`browse-x: HTTP ${response.status} from ${endpoint}`);
    console.error(body);
    process.exit(1);
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
} catch {
  console.error(`browse-x: request to ${apiBase} failed`);
  process.exit(1);
}
