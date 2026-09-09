export function createProjectAutosave({ save, delay = 500, onError = console.error } = {}) {
  if (typeof save !== 'function') {
    throw new TypeError('Autosave requires a save function');
  }

  let timer = null;
  let nextSnapshot = null;
  let writeChain = Promise.resolve();
  let pendingWrites = 0;

  function report(error) {
    onError(error);
  }

  function persistPending() {
    if (nextSnapshot === null) return writeChain;

    const snapshot = nextSnapshot;
    nextSnapshot = null;
    timer = null;
    pendingWrites += 1;
    writeChain = writeChain
      .catch(report)
      .then(async () => {
        try {
          return await save(snapshot);
        } finally {
          pendingWrites -= 1;
        }
      });
    return writeChain;
  }

  return {
    schedule(snapshot) {
      nextSnapshot = snapshot;
      if (timer !== null) clearTimeout(timer);
      timer = setTimeout(() => {
        persistPending().catch(report);
      }, delay);
    },

    flush() {
      if (timer !== null) clearTimeout(timer);
      return persistPending();
    },

    pending() {
      return timer !== null || nextSnapshot !== null || pendingWrites > 0;
    },
  };
}
