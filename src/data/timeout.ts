/** Marker for a promise that did not settle in time, or rejected. */
export const TIMED_OUT = Symbol("timed out");

/**
 * Race `p` against a timer; a rejection reads as no answer too. Offline, supabase-js can sit on a request for
 * half a minute (it retries the token refresh with backoff, and reads retry
 * on their own), which a splash screen or a headless notification run
 * cannot afford; the request keeps going and is simply not waited for.
 */
export function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | typeof TIMED_OUT> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(TIMED_OUT), ms);
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      () => {
        clearTimeout(timer);
        resolve(TIMED_OUT);
      },
    );
  });
}
