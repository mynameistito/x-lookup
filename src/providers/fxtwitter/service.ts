import { Context } from "effect";

import type { FxTwitterService } from "@/providers/contracts.ts";

/** Application-owned port for the free FxTwitter provider capability. */
export class FxTwitter extends Context.Service<FxTwitter, FxTwitterService>()(
  "x-lookup/application/FxTwitter"
) {}
