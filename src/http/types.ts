import type { Effect } from "effect";

import type { BrowseFailure, BrowseService } from "@/application/browse.ts";
import type {
  ConversionService,
  ConvertFailure,
} from "@/application/conversion.ts";
import type { HttpPayload } from "@/http/request.ts";

export interface HttpApplicationServices {
  readonly browse: BrowseService;
  readonly conversion: ConversionService;
}

export type BoundaryFailure = BrowseFailure | ConvertFailure;
export type RoutedPayload = Effect.Effect<HttpPayload, BoundaryFailure>;
