import { Effect } from "effect";
import { HttpClient, HttpClientResponse } from "effect/unstable/http";
import type { HttpClientRequest } from "effect/unstable/http";
import { describe, expect, test } from "vitest";

import {
  fetchFxStatusEffect,
  fetchFxThreadEffect,
} from "../lib/fxtwitter-adapter.js";
import type { ProviderEffect } from "../lib/provider-http.js";

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
});
