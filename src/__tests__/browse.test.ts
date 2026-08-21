import { Effect, Layer, Result } from "effect";
import { describe, expect, test } from "vitest";

import {
  browseEffect,
  browseResponse,
  isOriginalPost,
  layerBrowseWithoutDependencies,
} from "../lib/browse.js";
import { layerMemory } from "../lib/cache.js";
import type { FxAuthor, FxListResponse, FxTweet } from "../lib/fxtwitter.js";
import { FxTwitterSearchUnavailableError } from "../lib/provider-errors.js";
import { FxTwitter } from "../lib/provider-service.js";
import type { FxTwitterService } from "../lib/provider-service.js";

const post: FxTweet = {
  author: { screen_name: "ada" },
  id: "1",
  text: "hello",
  url: "https://x.com/ada/status/1",
};

const emptyList = <T>(): FxListResponse<T> => ({ results: [] });

const makeFxTwitter = (
  overrides: Partial<FxTwitterService> = {}
): FxTwitterService => ({
  fetchConnections: () => Effect.succeed(emptyList<FxAuthor>()),
  fetchConversationReplies: () => Effect.succeed([]),
  fetchFullThread: (id) => Effect.succeed([{ id }]),
  fetchProfile: (handle) => Effect.succeed({ screen_name: handle }),
  fetchProfileStatuses: () => Effect.succeed(emptyList<FxTweet>()),
  fetchStatus: (id) => Effect.succeed({ id }),
  searchStatuses: () => Effect.succeed(emptyList<FxTweet>()),
  ...overrides,
});

const browseLayer = (fxTwitter: FxTwitterService) =>
  layerBrowseWithoutDependencies.pipe(
    Layer.provide([
      layerMemory(),
      Layer.succeed(FxTwitter, FxTwitter.of(fxTwitter)),
    ])
  );

const runBrowse = (
  input: Parameters<typeof browseEffect>[0],
  fxTwitter: FxTwitterService
) =>
  Effect.runPromise(
    Effect.result(Effect.provide(browseEffect(input), browseLayer(fxTwitter)))
  );

const requireSuccess = <A, E>(result: Result.Result<A, E>): A => {
  if (Result.isFailure(result)) {
    throw new Error(`expected success: ${String(result.failure)}`);
  }
  return result.success;
};

describe("Browse", () => {
  test("loads profile and posts in parallel, filters replies/reposts, and renders continuations", async () => {
    const result = requireSuccess(
      await runBrowse(
        { handle: "ada", nocache: true, resource: "profile" },
        makeFxTwitter({
          fetchProfile: () =>
            Effect.succeed({ name: "Ada", screen_name: "ada" }),
          fetchProfileStatuses: () =>
            Effect.succeed({
              cursor: { bottom: "next" },
              results: [
                post,
                { ...post, id: "2", replying_to: ["bob"] },
                { ...post, id: "3", reposted_by: "bob" },
              ],
            }),
        })
      )
    );
    expect(result.profile?.screen_name).toBe("ada");
    expect(result.posts?.map((tweet) => tweet.id)).toStrictEqual(["1"]);
    expect(result.markdown).toContain("[@ada](https://x.com/ada)");
    expect(result.markdown).toContain("[Source](https://x.com/ada/status/1)");
    expect(result.markdown).toContain("/ada?cursor=next");
    expect(result.markdown).toContain("/ada?page=2");
  });

  test("walks search cursors sequentially while preserving feed, limits, and continuation metadata", async () => {
    const calls: Array<[string, string, string | undefined, number | undefined]> = [];
    const result = requireSuccess(
      await runBrowse(
        {
          full: true,
          limit: 7,
          page: 2,
          q: "effect",
          resource: "search",
        },
        makeFxTwitter({
          searchStatuses: (query, feed, cursor, count) => {
            calls.push([query, feed, cursor, count]);
            return Effect.succeed(
              cursor === "page-2"
                ? {
                    cursor: { bottom: "page-3" },
                    results: [post],
                  }
                : { cursor: { bottom: "page-2" }, results: [] }
            );
          },
        })
      )
    );
    expect(calls).toStrictEqual([
      ["effect", "latest", undefined, 7],
      ["effect", "latest", "page-2", 7],
    ]);
    expect(result.nextCursor).toBe("page-3");
    expect(result.markdown).toContain("q=effect&feed=latest");
    expect(result.markdown).toContain("full=true");
    expect(result.markdown).toContain("limit=7");
    expect(result.markdown).toContain("cursor=page-3");
    expect(result.markdown).toContain("page=3");
  });

  test("uses an explicit cursor as a single-page continuation", async () => {
    const cursors: Array<string | undefined> = [];
    const result = requireSuccess(
      await runBrowse(
        {
          cursor: "opaque",
          page: 4,
          q: "effect",
          resource: "search",
        },
        makeFxTwitter({
          searchStatuses: (_query, _feed, cursor) => {
            cursors.push(cursor);
            return Effect.succeed({
              cursor: { bottom: "next" },
              results: [post],
            });
          },
        })
      )
    );
    expect(cursors).toStrictEqual(["opaque"]);
    expect(result.page).toBe(4);
    expect(result.nextCursor).toBe("next");
  });

  test.each(["followers", "following"] as const)(
    "dispatches %s with cursor handling and capped limits",
    async (relation) => {
      const calls: Array<[string, string, string | undefined, number | undefined]> = [];
      const result = requireSuccess(
        await runBrowse(
          {
            handle: "ada",
            limit: 999,
            nocache: true,
            resource: relation,
          },
          makeFxTwitter({
            fetchConnections: (handle, selected, cursor, count) => {
              calls.push([handle, selected, cursor, count]);
              return Effect.succeed({
                cursor: { bottom: "next" },
                results: [{ name: "Bob", screen_name: "bob" }],
              });
            },
          })
        )
      );
      expect(calls).toStrictEqual([["ada", relation, undefined, 50]]);
      expect(result.users?.[0]?.screen_name).toBe("bob");
      expect(result.nextCursor).toBe("next");
    }
  );

  test("preserves typed upstream search refusals", async () => {
    const result = await runBrowse(
      { nocache: true, q: "cloudflare", resource: "search" },
      makeFxTwitter({
        searchStatuses: () =>
          Effect.fail(
            new FxTwitterSearchUnavailableError({ operation: "search" })
          ),
      })
    );
    expect(result).toMatchObject({
      _tag: "Failure",
      failure: { code: "search_unavailable", status: 502 },
    });
  });

  test("produces structured JSON and stable response metadata", async () => {
    const result = requireSuccess(
      await runBrowse(
        { full: true, q: "x-lookup", resource: "search" },
        makeFxTwitter({
          searchStatuses: () => Effect.succeed({ results: [post] }),
        })
      )
    );
    const response = browseResponse(result, true);
    expect(response.headers).toMatchObject({
      "Cache-Control": "public, max-age=0, must-revalidate",
      "Content-Type": "application/json; charset=utf-8",
      Vary: "Accept",
      "X-Result-Count": "1",
      "X-Source": "fxtwitter",
    });
    expect(JSON.parse(response.body)).toMatchObject({
      query: "x-lookup",
      resource: "search",
    });
    expect(result.markdown).toContain("0 likes");
  });

  test("rejects Obsidian output before touching providers", async () => {
    let calls = 0;
    const result = await runBrowse(
      { format: "obsidian", handle: "ada", resource: "profile" },
      makeFxTwitter({
        fetchProfile: () => {
          calls += 1;
          return Effect.succeed({ screen_name: "ada" });
        },
      })
    );
    expect(result).toMatchObject({
      _tag: "Failure",
      failure: { code: "invalid_format", status: 400 },
    });
    expect(calls).toBe(0);
  });

  test("separates cache entries by output format at the service seam", async () => {
    let calls = 0;
    const fxTwitter = makeFxTwitter({
      searchStatuses: () => {
        calls += 1;
        return Effect.succeed({ results: [post] });
      },
    });
    const layer = browseLayer(fxTwitter);
    const program = Effect.all([
      Effect.result(
        browseEffect({ format: "json", q: "x-lookup", resource: "search" })
      ),
      Effect.result(
        browseEffect({ format: "json", q: "x-lookup", resource: "search" })
      ),
      Effect.result(
        browseEffect({
          format: "markdown",
          q: "x-lookup",
          resource: "search",
        })
      ),
    ]);
    const [json, repeat, markdown] = await Effect.runPromise(
      Effect.provide(program, layer)
    );
    expect(requireSuccess(json).cache).toBe("miss");
    expect(requireSuccess(repeat).cache).toBe("hit");
    expect(requireSuccess(markdown).cache).toBe("miss");
    expect(calls).toBe(2);
  });
});

describe(isOriginalPost, () => {
  test("identifies replies and reposts without provider effects", () => {
    expect(isOriginalPost(post)).toBeTruthy();
    expect(isOriginalPost({ ...post, replying_to_status: ["9"] })).toBeFalsy();
    expect(
      isOriginalPost({ ...post, reposted_by: { screen_name: "bob" } })
    ).toBeFalsy();
  });
});
