export interface ArdHost {
  readonly displayName: string;
  readonly identifier: string;
}

export interface ArdEntry {
  readonly identifier: string;
  readonly displayName: string;
  readonly type: string;
  readonly url: string;
  readonly representativeQueries: readonly string[];
}

export interface ArdCatalog {
  readonly specVersion: string;
  readonly host: ArdHost;
  readonly entries: readonly ArdEntry[];
}

export const ARD_CONTENT_TYPE = "application/json";

const absoluteUrl = (origin: string, path: string): string =>
  new URL(path, origin).toString();

export const ardCatalog = (origin: string): ArdCatalog => {
  const host = new URL(origin).hostname;

  return {
    entries: [
      {
        displayName: "x-lookup OpenAPI schema",
        identifier: `urn:air:${host}:api:openapi`,
        representativeQueries: [
          "convert an X post into Markdown",
          "look up a public X profile",
          "search public X posts",
        ],
        type: "application/vnd.oai.openapi+json;version=3.1",
        url: absoluteUrl(origin, "/openapi.json"),
      },
      {
        displayName: "x-lookup agent skill",
        identifier: `urn:air:${host}:skill:x-lookup`,
        representativeQueries: [
          "how do I use x-lookup to read an X post",
          "fetch an X thread as Markdown",
          "find public X posts by search query",
        ],
        type: "text/markdown",
        url: absoluteUrl(origin, "/.well-known/agent-skills/x-lookup/SKILL.md"),
      },
    ],
    host: {
      displayName: "x-lookup",
      identifier: `did:web:${host}`,
    },
    specVersion: "1.0",
  };
};

export const ardCatalogJson = (origin: string): string =>
  JSON.stringify(ardCatalog(origin));
