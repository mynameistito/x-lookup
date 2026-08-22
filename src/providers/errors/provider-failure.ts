import type { FxTwitterFailure } from "@/providers/errors/fxtwitter-failure.ts";
import type { SyndicationFailure } from "@/providers/errors/syndication-failure.ts";

export type ProviderFailure = FxTwitterFailure | SyndicationFailure;
