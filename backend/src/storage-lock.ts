// Single-process storage lock. The SQLite deployment runs one API/worker instance.
// Keeps attachment deletions/uploads from racing a database + file backup.
let tail: Promise<void> = Promise.resolve();
export async function lockStorage(): Promise<() => void> {
  let release!: () => void;
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });
  const previous = tail;
  tail = previous.then(() => current);
  await previous;
  let done = false;
  return () => {
    if (!done) {
      done = true;
      release();
    }
  };
}
