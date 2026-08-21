import { Effect } from "effect";
import { HttpClient, HttpClientResponse } from "effect/unstable/http";
import type { HttpClientRequest } from "effect/unstable/http";
import { describe, expect, test } from "vitest";

import {
  fetchFxConversationChainEffect,
  fetchFxFullThreadEffect,
  fetchFxStatusEffect,
  fetchFxThreadEffect,
} from "../lib/fxtwitter-adapter.js";
import type { ProviderEffect } from "../lib/provider-http.js";
import { fetchSyndicationStatusEffect } from "../lib/syndication-adapter.js";

const makeClient = (
  respond: (request: HttpClientRequest.HttpClientRequest) => Response
): HttpClient.HttpClient =>
  HttpClient.make((request) =>
    Effect.sync(() => HttpClientResponse.fromWeb(request, respond(request)))
  );

const runWithClient = <A, E>(
  program: ProviderEffect<A, E>,
  client: HttpClient.HttpClient
): Promise<A> =>
  Effect.runPromise(
    program.pipe(Effect.provideService(HttpClient.HttpClient, client))
  );

const requestId = (request: HttpClientRequest.HttpClientRequest): string => {
  const segment = new URL(request.url).pathname.split("/").at(-1) ?? "";
  return decodeURIComponent(segment);
};

describe("FxTwitter provider compatibility", () => {
  test("accepts null quotes and encodes status and thread ids", async () => {
    const requests: string[] = [];
    const client = makeClient((request) => {
      requests.push(request.url);
      if (request.url.includes("/2/thread/")) {
        return Response.json({
          code: 200,
          thread: [{ id: "12/34", text: "thread" }],
        });
      }
      return Response.json({
        code: 200,
        status: { id: "12/34", quote: null, text: "post" },
      });
    });

    const tweet = await runWithClient(fetchFxStatusEffect("12/34"), client);
    const thread = await runWithClient(fetchFxThreadEffect("12/34"), client);

    expect(tweet.quote).toBeUndefined();
    expect(thread[0]?.id).toBe("12/34");
    expect(
      requests.some((url) => url.includes("/2/status/12%2F34"))
    ).toBeTruthy();
    expect(
      requests.some((url) => url.includes("/2/thread/12%2F34"))
    ).toBeTruthy();
  });

  test("preserves parent-chain traversal and full-thread fallback", async () => {
    const client = makeClient((request) => {
      if (request.url.includes("/2/thread/")) {
        return Response.json({
          code: 200,
          thread: [{ id: "3", replying_to: { status: "2" }, text: "post 3" }],
        });
      }
      const id = requestId(request);
      const numericId = Number(id);
      return Response.json({
        code: 200,
        status: {
          id,
          replying_to:
            numericId > 1 ? { status: String(numericId - 1) } : undefined,
          text: `post ${id}`,
        },
      });
    });

    const chain = await runWithClient(
      fetchFxConversationChainEffect("3"),
      client
    );
    const fullThread = await runWithClient(
      fetchFxFullThreadEffect("3"),
      client
    );

    expect(chain.map((tweet) => tweet.id)).toStrictEqual(["1", "2", "3"]);
    expect(fullThread.map((tweet) => tweet.id)).toStrictEqual(["1", "2", "3"]);
  });

  test("resolves parents through the replying_to_status array fallback", async () => {
    const client = makeClient((request) => {
      const id = requestId(request);
      return Response.json({
        code: 200,
        status:
          id === "200"
            ? { id, replying_to: ["alice"], replying_to_status: ["100"] }
            : { id, text: `post ${id}` },
      });
    });

    const chain = await runWithClient(
      fetchFxConversationChainEffect("200"),
      client
    );

    expect(chain.map((tweet) => tweet.id)).toStrictEqual(["100", "200"]);
  });

  test("returns a multi-tweet thread endpoint response directly", async () => {
    const client = makeClient(() =>
      Response.json({
        code: 200,
        thread: [
          { id: "100", text: "root" },
          { id: "200", text: "mid" },
          { id: "300", text: "leaf" },
        ],
      })
    );

    const thread = await runWithClient(fetchFxFullThreadEffect("300"), client);

    expect(thread.map((tweet) => tweet.id)).toStrictEqual([
      "100",
      "200",
      "300",
    ]);
  });

  test("returns a single parentless status without extra requests", async () => {
    let requests = 0;
    const client = makeClient((request) => {
      requests += 1;
      return Response.json({
        code: 200,
        ...(request.url.includes("/2/thread/")
          ? { thread: [{ id: "100", text: "solo" }] }
          : { status: { id: "100", text: "solo" } }),
      });
    });

    const thread = await runWithClient(fetchFxFullThreadEffect("100"), client);

    expect(thread.map((tweet) => tweet.id)).toStrictEqual(["100"]);
    expect(requests).toBe(1);
  });

  test("prevents parent-chain cycles", async () => {
    let requests = 0;
    const client = makeClient((request) => {
      requests += 1;
      const id = requestId(request);
      return Response.json({
        code: 200,
        status: {
          id,
          replying_to: { status: id === "a" ? "b" : "a" },
          text: id,
        },
      });
    });

    const chain = await runWithClient(
      fetchFxConversationChainEffect("a"),
      client
    );

    expect(chain.map((tweet) => tweet.id)).toStrictEqual(["b", "a"]);
    expect(requests).toBe(2);
  });

  test("caps parent-chain traversal at the configured depth", async () => {
    let requests = 0;
    const client = makeClient((request) => {
      requests += 1;
      const id = requestId(request);
      const numericId = Number(id);
      return Response.json({
        code: 200,
        status: {
          id,
          replying_to:
            numericId > 1 ? { status: String(numericId - 1) } : undefined,
          text: id,
        },
      });
    });

    const chain = await runWithClient(
      fetchFxConversationChainEffect("101"),
      client
    );

    expect(chain).toHaveLength(100);
    expect(chain[0]?.id).toBe("2");
    expect(chain.at(-1)?.id).toBe("101");
    expect(requests).toBe(100);
  });

  test("propagates private tweets through parent-chain traversal", async () => {
    const client = makeClient(() =>
      Response.json({ code: 403, message: "PRIVATE_TWEET" })
    );

    await expect(
      runWithClient(fetchFxConversationChainEffect("1"), client)
    ).rejects.toMatchObject({
      _tag: "FxTwitterPrivateTweetError",
      code: "private_tweet",
      status: 404,
    });
  });
});

describe("syndication provider compatibility", () => {
  test("treats null nested quote payloads as absent", async () => {
    const client = makeClient(() =>
      Response.json({
        id_str: "123",
        quoted_status_result: { result: { tweet: null } },
        quoted_tweet: null,
        text: "post",
        user: { screen_name: "alice" },
      })
    );

    const tweet = await runWithClient(
      fetchSyndicationStatusEffect("alice", "123"),
      client
    );

    expect(tweet.quote).toBeUndefined();
  });
});
