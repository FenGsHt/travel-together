export function createProjectAutosave({ save, delay = 500, onError = console.error } = {}) {
  if (typeof save !== 'function') {
    throw new TypeError('Autosave requires a save function');
  }

  let timer = null;
  let nextSnapshot = null;
  let writeChain = Promise.resolve();

  function report(error) {
    onError(error);
  }

  function persistPending() {
    if (nextSnapshot === null) return writeChain;

    const snapshot = nextSnapshot;
    nextSnapshot = null;
    timer = null;
    writeChain = writeChain
      .catch(report)
      .then(() => save(snapshot));
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
      return timer !== null;
    },
  };
}
