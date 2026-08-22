import type { Effect } from "effect";

import type {
  FxTwitterFailure,
  SyndicationFailure,
} from "@/providers/errors.ts";
import type {
  FxAuthor,
  FxListResponse,
  FxReplyRanking,
  FxTweet,
} from "@/providers/fxtwitter/types.ts";

export interface FxTwitterService {
  readonly fetchConnections: (
    handle: string,
    relation: "followers" | "following",
    cursor?: string,
    count?: number
  ) => Effect.Effect<FxListResponse<FxAuthor>, FxTwitterFailure>;
  readonly fetchConversationReplies: (
    id: string,
    rankingMode?: FxReplyRanking,
    limit?: number
  ) => Effect.Effect<FxTweet[], FxTwitterFailure>;
  readonly fetchFullThread: (
    id: string
  ) => Effect.Effect<FxTweet[], FxTwitterFailure>;
  readonly fetchProfile: (
    handle: string
  ) => Effect.Effect<FxAuthor, FxTwitterFailure>;
  readonly fetchProfileStatuses: (
    handle: string,
    cursor?: string,
    count?: number
  ) => Effect.Effect<FxListResponse<FxTweet>, FxTwitterFailure>;
  readonly fetchStatus: (
    id: string
  ) => Effect.Effect<FxTweet, FxTwitterFailure>;
  readonly searchStatuses: (
    queryText: string,
    feed: string,
    cursor?: string,
    count?: number
  ) => Effect.Effect<FxListResponse<FxTweet>, FxTwitterFailure>;
}

export interface SyndicationService {
  readonly fetchStatus: (
    handle: string,
    id: string
  ) => Effect.Effect<FxTweet, SyndicationFailure>;
}

export { FxTwitter } from "@/providers/fxtwitter/service.ts";
export { Syndication } from "@/providers/syndication/service.ts";
