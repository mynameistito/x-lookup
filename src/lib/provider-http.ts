import { Effect } from "effect";
import {
  HttpClient,
  HttpClientError,
  HttpClientResponse,
} from "effect/unstable/http";

import { ConvertError } from "./errors.js";
import type { HttpMappedError } from "./errors.js";

export type ProviderEffect<A, E> = Effect.Effect<A, E, HttpClient.HttpClient>;

type ProviderHttpFailure = Error & HttpMappedError;

const toConvertError = (failure: ProviderHttpFailure): ConvertError =>
  new ConvertError(failure.status, failure.message, failure.code);

const liveHttpClient: HttpClient.HttpClient = HttpClient.make(
  (request, url, signal) =>
    Effect.tryPromise({
      catch: (cause) =>
        new HttpClientError.HttpClientError({
          reason: new HttpClientError.TransportError({ cause, request }),
        }),
      try: () =>
        globalThis.fetch(url.href, {
          headers: request.headers,
          method: request.method,
          signal,
        }),
    }).pipe(
      Effect.map((response) => HttpClientResponse.fromWeb(request, response))
    )
);

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
      Effect.provideService(HttpClient.HttpClient, liveHttpClient)
    )
  );
