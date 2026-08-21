import {
  fetchFxConnectionsEffect,
  fetchFxConversationChainEffect,
  fetchFxConversationRepliesEffect,
  fetchFxFullThreadEffect,
  fetchFxProfileEffect,
  fetchFxProfileStatusesEffect,
  fetchFxStatusEffect,
  fetchFxThreadEffect,
  searchFxStatusesEffect,
} from "./fxtwitter-adapter.js";
import type {
  FxAuthor,
  FxListResponse,
  FxReplyRanking,
  FxTweet,
} from "./fxtwitter-types.js";
import { runProviderEffect } from "./provider-http.js";

export { getParentStatusId } from "./fxtwitter-types.js";
export type {
  FxArticle,
  FxArticleBlock,
  FxAuthor,
  FxCursor,
  FxListResponse,
  FxMedia,
  FxMediaItem,
  FxMosaic,
  FxPoll,
  FxPollChoice,
  FxReplyingTo,
  FxReplyRanking,
  FxTweet,
  TweetContext,
} from "./fxtwitter-types.js";

export const fetchFxProfile = (handle: string): Promise<FxAuthor> =>
  runProviderEffect(fetchFxProfileEffect(handle));

export const fetchFxProfileStatuses = (
  handle: string,
  cursor?: string,
  count = 20
): Promise<FxListResponse<FxTweet>> =>
  runProviderEffect(fetchFxProfileStatusesEffect(handle, cursor, count));

export const searchFxStatuses = (
  queryText: string,
  feed: string,
  cursor?: string,
  count = 20
): Promise<FxListResponse<FxTweet>> =>
  runProviderEffect(searchFxStatusesEffect(queryText, feed, cursor, count));

export const fetchFxConnections = (
  handle: string,
  relation: "followers" | "following",
  cursor?: string,
  count = 20
): Promise<FxListResponse<FxAuthor>> =>
  runProviderEffect(fetchFxConnectionsEffect(handle, relation, cursor, count));

export const fetchFxStatus = (id: string): Promise<FxTweet> =>
  runProviderEffect(fetchFxStatusEffect(id));

export const fetchFxConversationChain = (id: string): Promise<FxTweet[]> =>
  runProviderEffect(fetchFxConversationChainEffect(id));

export const fetchFxThread = (id: string): Promise<FxTweet[]> =>
  runProviderEffect(fetchFxThreadEffect(id));

export const fetchFxConversationReplies = (
  id: string,
  rankingMode: FxReplyRanking = "likes",
  limit = 10
): Promise<FxTweet[]> =>
  runProviderEffect(fetchFxConversationRepliesEffect(id, rankingMode, limit));

export const fetchFxFullThread = (id: string): Promise<FxTweet[]> =>
  runProviderEffect(fetchFxFullThreadEffect(id));
