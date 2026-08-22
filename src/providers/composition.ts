import { Effect, Layer } from "effect";
import { HttpClient } from "effect/unstable/http";

import { FxTwitter, Syndication } from "@/providers/contracts.ts";
import {
  fetchFxConnectionsEffect,
  fetchFxConversationRepliesEffect,
  fetchFxFullThreadEffect,
  fetchFxProfileEffect,
  fetchFxProfileStatusesEffect,
  fetchFxStatusEffect,
  searchFxStatusesEffect,
} from "@/providers/fxtwitter/adapter.ts";
import type { FxReplyRanking } from "@/providers/fxtwitter/types.ts";
import type { ProviderEffect } from "@/providers/http-client.ts";
import { layerLiveHttpClient } from "@/providers/http-client.ts";
import { fetchSyndicationStatusEffect } from "@/providers/syndication/adapter.ts";

const provideClient = <A, E>(
  program: ProviderEffect<A, E>,
  client: HttpClient.HttpClient
): Effect.Effect<A, E> =>
  Effect.provideService(program, HttpClient.HttpClient, client);

const makeFxTwitter = Effect.gen(function* makeFxTwitterService() {
  const client = yield* HttpClient.HttpClient;

  const fetchConnections = Effect.fn("FxTwitter.fetchConnections")(
    (
      handle: string,
      relation: "followers" | "following",
      cursor?: string,
      count = 20
    ) =>
      provideClient(
        fetchFxConnectionsEffect(handle, relation, cursor, count),
        client
      )
  );
  const fetchConversationReplies = Effect.fn(
    "FxTwitter.fetchConversationReplies"
  )((id: string, rankingMode: FxReplyRanking = "likes", limit = 10) =>
    provideClient(
      fetchFxConversationRepliesEffect(id, rankingMode, limit),
      client
    )
  );
  const fetchFullThread = Effect.fn("FxTwitter.fetchFullThread")((id: string) =>
    provideClient(fetchFxFullThreadEffect(id), client)
  );
  const fetchProfile = Effect.fn("FxTwitter.fetchProfile")((handle: string) =>
    provideClient(fetchFxProfileEffect(handle), client)
  );
  const fetchProfileStatuses = Effect.fn("FxTwitter.fetchProfileStatuses")(
    (handle: string, cursor?: string, count = 20) =>
      provideClient(fetchFxProfileStatusesEffect(handle, cursor, count), client)
  );
  const fetchStatus = Effect.fn("FxTwitter.fetchStatus")((id: string) =>
    provideClient(fetchFxStatusEffect(id), client)
  );
  const searchStatuses = Effect.fn("FxTwitter.searchStatuses")(
    (queryText: string, feed: string, cursor?: string, count = 20) =>
      provideClient(
        searchFxStatusesEffect(queryText, feed, cursor, count),
        client
      )
  );

  return FxTwitter.of({
    fetchConnections,
    fetchConversationReplies,
    fetchFullThread,
    fetchProfile,
    fetchProfileStatuses,
    fetchStatus,
    searchStatuses,
  });
});

export const layerFxTwitterWithoutDependencies = Layer.effect(
  FxTwitter,
  makeFxTwitter
);

/** Production FxTwitter adapter backed by the Web-standard fetch HttpClient. */
export const layerFxTwitter = layerFxTwitterWithoutDependencies.pipe(
  Layer.provide(layerLiveHttpClient)
);

const makeSyndication = Effect.gen(function* makeSyndicationService() {
  const client = yield* HttpClient.HttpClient;
  const fetchStatus = Effect.fn("Syndication.fetchStatus")(
    (handle: string, id: string) =>
      provideClient(fetchSyndicationStatusEffect(handle, id), client)
  );
  return Syndication.of({ fetchStatus });
});

export const layerSyndicationWithoutDependencies = Layer.effect(
  Syndication,
  makeSyndication
);

/** Production syndication adapter backed by the Web-standard fetch HttpClient. */
export const layerSyndication = layerSyndicationWithoutDependencies.pipe(
  Layer.provide(layerLiveHttpClient)
);
