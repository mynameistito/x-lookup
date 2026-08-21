import type { FxTweet } from "./fxtwitter-types.js";
import { runProviderEffect } from "./provider-http.js";
import { fetchSyndicationStatusEffect } from "./syndication-adapter.js";

export const fetchSyndicationStatus = (
  handle: string,
  id: string
): Promise<FxTweet> =>
  runProviderEffect(fetchSyndicationStatusEffect(handle, id));
