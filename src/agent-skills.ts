import xLookupSkill from "../skills/x-lookup/SKILL.md?raw";

export const AGENT_SKILLS_SCHEMA =
  "https://schemas.agentskills.io/discovery/0.2.0/schema.json";

const SKILL_CACHE_CONTROL = "public, max-age=3600, immutable";
const SKILL_MARKDOWN_CONTENT_TYPE = "text/markdown; charset=utf-8";
const INDEX_CONTENT_TYPE = "application/json; charset=utf-8";

export interface AgentSkillEntry {
  readonly name: string;
  readonly type: "skill-md";
  readonly description: string;
  readonly url: string;
  readonly digest: string;
}

export interface AgentSkillsIndex {
  readonly $schema: string;
  readonly skills: readonly AgentSkillEntry[];
}

const frontmatterValue = (skill: string, key: string): string => {
  const frontmatter = /^---\r?\n(?<contents>[\s\S]*?)\r?\n---/u.exec(skill)
    ?.groups?.contents;
  if (!frontmatter) {
    throw new Error("Agent skill is missing YAML frontmatter");
  }

  const match = new RegExp(
    `(?:^|\\r?\\n)${key}:\\s*(?<value>.*?)(?=\\r?\\n\\w[\\w-]*:|$)`,
    "su"
  ).exec(frontmatter);
  if (!match?.groups?.value) {
    throw new Error(`Agent skill is missing frontmatter field: ${key}`);
  }

  return match.groups.value
    .replace(/^>-?[ \t]*/u, "")
    .replaceAll(/\s+/gu, " ")
    .trim();
};

const sha256 = async (contents: string): Promise<string> => {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(contents)
  );
  const hex = Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("");
  return `sha256:${hex}`;
};

const skillEntry = async (
  name: string,
  contents: string
): Promise<AgentSkillEntry> => ({
  description: frontmatterValue(contents, "description"),
  digest: await sha256(contents),
  name: frontmatterValue(contents, "name"),
  type: "skill-md",
  url: `/.well-known/agent-skills/${name}/SKILL.md`,
});

export const agentSkillsIndex = async (): Promise<AgentSkillsIndex> => ({
  $schema: AGENT_SKILLS_SCHEMA,
  skills: [await skillEntry("x-lookup", xLookupSkill)],
});

export const agentSkillsIndexJson = async (): Promise<string> =>
  JSON.stringify(await agentSkillsIndex());

export const xLookupSkillMarkdown = (): string => xLookupSkill;

export const agentSkillsHeaders = (contentType: string) => ({
  "Cache-Control": SKILL_CACHE_CONTROL,
  "Content-Type": contentType,
});

export const agentSkillsIndexContentType = INDEX_CONTENT_TYPE;
export const agentSkillsMarkdownContentType = SKILL_MARKDOWN_CONTENT_TYPE;
