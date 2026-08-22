import { Context } from "effect";

import type { SyndicationService } from "@/providers/contracts.ts";

/** Application-owned port for the Twitter syndication fallback capability. */
export class Syndication extends Context.Service<
  Syndication,
  SyndicationService
>()("x-lookup/application/Syndication") {}
