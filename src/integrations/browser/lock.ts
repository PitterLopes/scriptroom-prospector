/** One browser job at a time. The Chrome tab is shared state; two jobs typing at once would corrupt both. */
let chain: Promise<unknown> = Promise.resolve();
let depth = 0;

export function withBrowserLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = chain.then(
    async () => {
      depth += 1;
      try {
        return await fn();
      } finally {
        depth -= 1;
      }
    },
    async () => {
      depth += 1;
      try {
        return await fn();
      } finally {
        depth -= 1;
      }
    },
  );
  chain = run.catch(() => undefined);
  return run;
}

export function browserLockHeld(): boolean {
  return depth > 0;
}
