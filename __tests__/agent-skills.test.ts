import { describe, expect, test } from "vitest";

import {
  AGENT_SKILLS_SCHEMA,
  agentSkillsIndex,
  xLookupSkillMarkdown,
} from "@/agent-skills.ts";

describe("Agent Skills discovery", () => {
  test("builds RFC 0.2.0 metadata from the checked-in skill", async () => {
    const index = await agentSkillsIndex();
    const [skill] = index.skills;

    expect(index.$schema).toBe(AGENT_SKILLS_SCHEMA);
    expect(skill).toMatchObject({
      description: expect.stringContaining("Reads public X"),
      digest: expect.stringMatching(/^sha256:[0-9a-f]{64}$/u),
      name: "x-lookup",
      type: "skill-md",
      url: "/.well-known/agent-skills/x-lookup/SKILL.md",
    });

    const digest = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(xLookupSkillMarkdown())
    );
    const expected = `sha256:${Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
    expect(skill?.digest).toBe(expected);
  });
});
