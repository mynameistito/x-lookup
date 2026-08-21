import { Effect } from "effect";
import type { HttpClient } from "effect/unstable/http";
import { FetchHttpClient } from "effect/unstable/http";

import { ConvertError } from "./errors.js";
import type { HttpMappedError } from "./errors.js";

export type ProviderEffect<A, E> = Effect.Effect<A, E, HttpClient.HttpClient>;

type ProviderHttpFailure = Error & HttpMappedError;

const toConvertError = (failure: ProviderHttpFailure): ConvertError =>
  new ConvertError(failure.status, failure.message, failure.code);

/**
 * Promise compatibility boundary for the existing application layer.
 * Provider adapters remain Effect-native and testable with a supplied HttpClient.
 */
export const runProviderEffect = <A, E extends ProviderHttpFailure>(
  program: ProviderEffect<A, E>
): Promise<A> =>
  Effect.runPromise(
    program.pipe(
      Effect.mapError(toConvertError),
      Effect.provide(FetchHttpClient.layer)
    )
  );
