import { Effect, Layer, Option, Result } from "effect";
import { HttpClient, HttpClientResponse } from "effect/unstable/http";
import { describe, expect, test } from "vitest";

import type {
  FxAuthor,
  FxListResponse,
  FxTweet,
} from "../lib/fxtwitter-types.js";
import { parse as parsePostId } from "../lib/post-id.js";
import {
  FxTwitterNetworkError,
  FxTwitterNotFoundError,
  FxTwitterPrivateTweetError,
  SyndicationNetworkError,
} from "../lib/provider-errors.js";
import { layerFxTwitterWithoutDependencies } from "../lib/provider-service-adapter.js";
import { FxTwitter, Syndication } from "../lib/provider-service.js";
import type {
  FxTwitterService,
  SyndicationService,
} from "../lib/provider-service.js";
import {
  fetchPostsEffect,
  layerPostLookupWithoutDependencies,
} from "../lib/tweet-fetch.js";

const postId = (value: string) => Option.getOrThrow(parsePostId(value));

const makeTweet = (id: string, overrides: Partial<FxTweet> = {}): FxTweet => ({
  id,
  text: `post ${id}`,
  ...overrides,
});

const emptyList = <T>(): FxListResponse<T> => ({ results: [] });

const makeFxTwitter = (
  overrides: Partial<FxTwitterService> = {}
): FxTwitterService => ({
  fetchConnections: () => Effect.succeed(emptyList<FxAuthor>()),
  fetchConversationReplies: () => Effect.succeed([]),
  fetchFullThread: (id) => Effect.succeed([makeTweet(id)]),
  fetchProfile: (handle) => Effect.succeed({ screen_name: handle }),
  fetchProfileStatuses: () => Effect.succeed(emptyList<FxTweet>()),
  fetchStatus: (id) => Effect.succeed(makeTweet(id)),
  searchStatuses: () => Effect.succeed(emptyList<FxTweet>()),
  ...overrides,
});

const makeSyndication = (
  overrides: Partial<SyndicationService> = {}
): SyndicationService => ({
  fetchStatus: (_handle, id) => Effect.succeed(makeTweet(id)),
  ...overrides,
});

const layerFor = (
  fxTwitter: FxTwitterService,
  syndication: SyndicationService = makeSyndication()
) =>
  layerPostLookupWithoutDependencies.pipe(
    Layer.provide([
      Layer.succeed(FxTwitter, FxTwitter.of(fxTwitter)),
      Layer.succeed(Syndication, Syndication.of(syndication)),
    ])
  );

const runLookup = (
  fxTwitter: FxTwitterService,
  syndication: SyndicationService,
  options: {
    context?: "full" | "thread";
    id?: string;
    replies?: "off" | "recent" | "top";
    thread?: "off" | "full";
  } = {}
) =>
  Effect.runPromise(
    Effect.result(
      Effect.provide(
        fetchPostsEffect(
          "ada",
          postId(options.id ?? "3"),
          options.thread ?? "off",
          options.context ?? "full",
          options.replies ?? "top"
        ),
        layerFor(fxTwitter, syndication)
      )
    )
  );

const requireSuccess = <A, E>(result: Result.Result<A, E>): A => {
  if (Result.isFailure(result)) {
    throw new Error(`expected success: ${String(result.failure)}`);
  }
  return result.success;
};

describe("PostLookup", () => {
  test("prefers FxTwitter when status lookup succeeds", async () => {
    const result = requireSuccess(
      await runLookup(makeFxTwitter(), makeSyndication())
    );
    expect(result.source).toBe("fxtwitter");
    expect(result.tweets).toMatchObject([{ context: "post", id: "3" }]);
  });

  test("falls back to syndication after an FxTwitter failure", async () => {
    const result = requireSuccess(
      await runLookup(
        makeFxTwitter({
          fetchStatus: () =>
            Effect.fail(new FxTwitterNetworkError({ operation: "status" })),
        }),
        makeSyndication({
          fetchStatus: (_handle, id) =>
            Effect.succeed(makeTweet(id, { text: "syndicated" })),
        })
      )
    );
    expect(result).toMatchObject({
      source: "syndication",
      tweets: [{ context: "post", id: "3", text: "syndicated" }],
    });
  });

  test("treats private tweets as a hard failure without trying fallback", async () => {
    let syndicationCalls = 0;
    const result = await runLookup(
      makeFxTwitter({
        fetchStatus: () =>
          Effect.fail(new FxTwitterPrivateTweetError({ operation: "status" })),
      }),
      makeSyndication({
        fetchStatus: (_handle, id) => {
          syndicationCalls += 1;
          return Effect.succeed(makeTweet(id));
        },
      })
    );
    expect(result).toMatchObject({
      _tag: "Failure",
      failure: { code: "private_tweet", status: 404 },
    });
    expect(syndicationCalls).toBe(0);
  });

  test("prefers a truthful not-found verdict over a later upstream failure", async () => {
    const result = await runLookup(
      makeFxTwitter({
        fetchStatus: () =>
          Effect.fail(
            new FxTwitterNotFoundError({ kind: "post", operation: "status" })
          ),
      }),
      makeSyndication({
        fetchStatus: () =>
          Effect.fail(new SyndicationNetworkError({ operation: "status" })),
      })
    );
    expect(result).toMatchObject({
      _tag: "Failure",
      failure: { _tag: "FxTwitterNotFoundError", status: 404 },
    });
  });

  test("preserves the final classified upstream error when all providers fail", async () => {
    const result = await runLookup(
      makeFxTwitter({
        fetchStatus: () =>
          Effect.fail(new FxTwitterNetworkError({ operation: "status" })),
      }),
      makeSyndication({
        fetchStatus: () =>
          Effect.fail(new SyndicationNetworkError({ operation: "status" })),
      })
    );
    expect(result).toMatchObject({
      _tag: "Failure",
      failure: { _tag: "SyndicationNetworkError", status: 502 },
    });
  });

  test("uses the real FxTwitter service Layer for parent-chain thread fallback", async () => {
    const client: HttpClient.HttpClient = HttpClient.make((request) =>
      Effect.sync(() => {
        if (request.url.includes("/2/thread/")) {
          return HttpClientResponse.fromWeb(
            request,
            Response.json({
              code: 200,
              thread: [
                {
                  id: "3",
                  replying_to: { status: "2" },
                  text: "post 3",
                },
              ],
            })
          );
        }
        const id = new URL(request.url).pathname.split("/").at(-1) ?? "";
        const numericId = Number(id);
        return HttpClientResponse.fromWeb(
          request,
          Response.json({
            code: 200,
            status: {
              id,
              replying_to:
                numericId > 1 ? { status: String(numericId - 1) } : undefined,
              text: `post ${id}`,
            },
          })
        );
      })
    );
    const fxLayer = layerFxTwitterWithoutDependencies.pipe(
      Layer.provide(Layer.succeed(HttpClient.HttpClient, client))
    );
    const layer = layerPostLookupWithoutDependencies.pipe(
      Layer.provide([
        fxLayer,
        Layer.succeed(Syndication, Syndication.of(makeSyndication())),
      ])
    );
    const result = requireSuccess(
      await Effect.runPromise(
        Effect.result(
          Effect.provide(
            fetchPostsEffect("ada", postId("3"), "full", "full", "off"),
            layer
          )
        )
      )
    );
    expect(
      result.tweets.map((tweet) => [tweet.id, tweet.context])
    ).toStrictEqual([
      ["1", "parent"],
      ["2", "parent"],
      ["3", "post"],
    ]);
  });

  test("filters context=thread to the focal author and preserves annotations", async () => {
    const result = requireSuccess(
      await runLookup(
        makeFxTwitter({
          fetchFullThread: () =>
            Effect.succeed([
              makeTweet("1", { author: { id: "a", screen_name: "ada" } }),
              makeTweet("3", { author: { id: "a", screen_name: "ada" } }),
              makeTweet("4", { author: { id: "b", screen_name: "bob" } }),
              makeTweet("5", { author: { id: "a", screen_name: "ada" } }),
            ]),
        }),
        makeSyndication(),
        { context: "thread", thread: "full" }
      )
    );
    expect(
      result.tweets.map((tweet) => [tweet.id, tweet.context])
    ).toStrictEqual([
      ["1", "parent"],
      ["3", "post"],
      ["5", "thread"],
    ]);
  });

  test("dedupes reply identities while retaining provider reply order", async () => {
    const result = requireSuccess(
      await runLookup(
        makeFxTwitter({
          fetchConversationReplies: () =>
            Effect.succeed([makeTweet("3"), makeTweet("4"), makeTweet("5")]),
          fetchFullThread: () =>
            Effect.succeed([makeTweet("2"), makeTweet("3")]),
        }),
        makeSyndication(),
        { id: "2", thread: "full" }
      )
    );
    expect(
      result.tweets.map((tweet) => [tweet.id, tweet.context])
    ).toStrictEqual([
      ["2", "post"],
      ["3", "thread"],
      ["4", "reply"],
      ["5", "reply"],
    ]);
  });

  test.each([
    { mode: "top" as const, ranking: "likes" },
    { mode: "recent" as const, ranking: "recency" },
    { mode: "off" as const, ranking: null },
  ])(
    "maps replies=$mode to the preserved ranking policy",
    async ({ mode, ranking }) => {
      const rankings: string[] = [];
      const result = requireSuccess(
        await runLookup(
          makeFxTwitter({
            fetchConversationReplies: (_id, replyRanking) => {
              rankings.push(replyRanking ?? "likes");
              return Effect.succeed([makeTweet("4")]);
            },
            fetchFullThread: () => Effect.succeed([makeTweet("3")]),
          }),
          makeSyndication(),
          { replies: mode, thread: "full" }
        )
      );
      expect(rankings[0] ?? null).toBe(ranking);
      expect(result.tweets.some((tweet) => tweet.context === "reply")).toBe(
        mode !== "off"
      );
    }
  );

  test("keeps reply-fetch failure additive and non-fatal", async () => {
    const result = requireSuccess(
      await runLookup(
        makeFxTwitter({
          fetchConversationReplies: () =>
            Effect.fail(
              new FxTwitterNetworkError({ operation: "conversation" })
            ),
          fetchFullThread: () => Effect.succeed([makeTweet("3")]),
        }),
        makeSyndication(),
        { thread: "full" }
      )
    );
    expect(result.tweets).toMatchObject([{ context: "post", id: "3" }]);
  });
});
