/** The transport types and constraints shared by public API descriptions. */
export interface ApiParameter {
  readonly name: string;
  readonly description: string;
  readonly required?: boolean;
  readonly default?: string | number | boolean;
  readonly httpValues?: readonly string[];
  readonly values?: readonly string[];
  readonly minimum?: number;
  readonly maximum?: number;
  readonly format?: string;
  readonly minLength?: number;
  readonly pattern?: string;
  readonly httpType: "string" | "integer";
  readonly mcpType: McpParameterType;
}

type McpParameterType = "string" | "integer" | "boolean" | "url";

export type ApiOperation =
  | "browse"
  | "search"
  | "profile"
  | "followers"
  | "following"
  | "conversion";

const browseParameters = {
  cursor: {
    description: "Opaque continuation cursor returned as `nextCursor`.",
    httpType: "string",
    mcpType: "string",
    name: "cursor",
  },
  feed: {
    default: "latest",
    description:
      "Search result ordering. Unsupported values fall back to `latest`.",
    httpType: "string",
    mcpType: "string",
    name: "feed",
    values: ["latest", "media", "top"],
  },
  format: {
    default: "markdown",
    description: "Response representation.",
    httpType: "string",
    mcpType: "string",
    name: "format",
    values: ["markdown", "json"],
  },
  full: {
    default: false,
    description: "Include richer post metrics and user details.",
    httpType: "string",
    httpValues: ["1", "true"],
    mcpType: "boolean",
    name: "full",
  },
  handle: {
    description: "X handle, with an optional leading `@`.",
    httpType: "string",
    mcpType: "string",
    name: "handle",
    pattern: "^@?[A-Za-z0-9_]{1,15}$",
  },
  limit: {
    default: 20,
    description: "Maximum results per response. Values are clamped to 1-50.",
    httpType: "string",
    maximum: 50,
    mcpType: "integer",
    minimum: 1,
    name: "limit",
  },
  nocache: {
    default: false,
    description: "Bypass the application cache.",
    httpType: "string",
    httpValues: ["1", "true"],
    mcpType: "boolean",
    name: "nocache",
  },
  page: {
    default: 1,
    description:
      "Page to fetch when no cursor is supplied. Values are clamped to 1-10.",
    httpType: "string",
    maximum: 10,
    mcpType: "integer",
    minimum: 1,
    name: "page",
  },
  q: {
    description: "Search query, including X operators such as from: or since:.",
    httpType: "string",
    mcpType: "string",
    minLength: 1,
    name: "q",
  },
  resource: {
    description: "Resource to browse.",
    httpType: "string",
    mcpType: "string",
    name: "resource",
    required: true,
    values: ["profile", "search", "followers", "following"],
  },
} satisfies Record<string, ApiParameter>;

const conversionParameters = {
  context: {
    default: "full",
    description: "Conversation context to include.",
    httpType: "string",
    mcpType: "string",
    name: "context",
    values: ["full", "thread"],
  },
  format: {
    default: "markdown",
    description: "Response representation.",
    httpType: "string",
    mcpType: "string",
    name: "format",
    values: ["markdown", "obsidian", "json"],
  },
  full: {
    default: false,
    description: "Set to true to expand rendered metadata.",
    httpType: "string",
    httpValues: ["1", "true", "yes"],
    mcpType: "boolean",
    name: "full",
  },
  handle: {
    description: "Status author handle, used with `id` when `url` is absent.",
    httpType: "string",
    mcpType: "string",
    name: "handle",
    pattern: "^@?[A-Za-z0-9_]{1,15}$",
  },
  id: {
    description:
      "Numeric X status ID, used with `handle` when `url` is absent.",
    httpType: "string",
    mcpType: "string",
    name: "id",
    pattern: "^\\d+$",
  },
  nocache: {
    default: false,
    description: "Set to true to bypass the cache.",
    httpType: "string",
    httpValues: ["1", "true", "yes"],
    mcpType: "boolean",
    name: "nocache",
  },
  replies: {
    default: "top",
    description: "Replies to include around the focal post.",
    httpType: "string",
    mcpType: "string",
    name: "replies",
    values: ["top", "recent", "off"],
  },
  thread: {
    default: "full",
    description:
      "Thread selection: `off`, `full`, `conversation`, or a number from 2 to 100.",
    httpType: "string",
    maximum: 100,
    mcpType: "string",
    minimum: 2,
    name: "thread",
    pattern: "^(?:off|full|conversation|[2-9]|[1-9]\\d|100)$",
    values: ["off", "full", "conversation"],
  },
  url: {
    description: "Public X or Twitter status URL.",
    format: "uri",
    httpType: "string",
    mcpType: "url",
    name: "url",
  },
  userinfo: {
    default: "off",
    description: "Author information included in rendered output.",
    httpType: "string",
    mcpType: "string",
    name: "userinfo",
    values: ["off", "author", "all"],
  },
} satisfies Record<string, ApiParameter>;

const browseCommon = [
  "cursor",
  "page",
  "limit",
  "full",
  "format",
  "nocache",
] as const;

export const apiContract = {
  browse: [
    browseParameters.resource,
    browseParameters.handle,
    browseParameters.q,
    browseParameters.feed,
    ...browseCommon.map((name) => browseParameters[name]),
  ],
  conversion: [
    conversionParameters.url,
    conversionParameters.handle,
    conversionParameters.id,
    conversionParameters.format,
    conversionParameters.thread,
    conversionParameters.context,
    conversionParameters.replies,
    conversionParameters.userinfo,
    conversionParameters.full,
    conversionParameters.nocache,
  ],
  followers: [
    browseParameters.handle,
    ...browseCommon.map((name) => browseParameters[name]),
  ],
  following: [
    browseParameters.handle,
    ...browseCommon.map((name) => browseParameters[name]),
  ],
  profile: [
    browseParameters.handle,
    ...browseCommon.map((name) => browseParameters[name]),
  ],
  search: [
    browseParameters.q,
    browseParameters.feed,
    ...browseCommon.map((name) => browseParameters[name]),
  ],
} satisfies Record<ApiOperation, readonly ApiParameter[]>;
