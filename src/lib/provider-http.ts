import { Effect } from "effect";
import { FetchHttpClient, HttpClient } from "effect/unstable/http";

/** An outbound-provider program that requires Effect's standard HttpClient. */
export type ProviderEffect<A, E> = Effect.Effect<A, E, HttpClient.HttpClient>;

/** Run an outbound-provider program with the Web Fetch based production client. */
export const runProviderEffect = <A, E>(
  program: ProviderEffect<A, E>
): Promise<A> =>
  Effect.runPromise(program.pipe(Effect.provide(FetchHttpClient.layer)));
