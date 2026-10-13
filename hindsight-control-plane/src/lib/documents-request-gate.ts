/** Coalesce identical in-flight reads; commit only the current scope and page. */
export class DocumentsRequestGate {
  private context = "";
  private epoch = 0;
  private latest = "";
  private pending = new Map<string, Promise<void>>();

  setContext(context: string) {
    if (context !== this.context) {
      this.context = context;
      this.epoch++;
      this.latest = "";
    }
  }

  run<T>(context: string, page: number, read: () => Promise<T>, start: () => void,
         commit: (value: T) => void, settle: () => void): Promise<void> {
    if (context !== this.context) return Promise.resolve();
    const epoch = this.epoch;
    const key = `${epoch}:${page}`;
    this.latest = key;
    const existing = this.pending.get(key);
    if (existing) return existing;
    start();
    const current = () => this.epoch === epoch && this.latest === key;
    const promise = Promise.resolve().then(read).then(value => {
      if (current()) commit(value);
    }).catch(() => {
      // API client owns error reporting. Stale failures must not alter state.
    }).finally(() => {
      this.pending.delete(key);
      if (current()) settle();
    });
    this.pending.set(key, promise);
    return promise;
  }
}
