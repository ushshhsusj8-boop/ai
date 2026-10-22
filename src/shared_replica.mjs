import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export function createSharedReplica(store, { url, token, queueFile, fetchImpl = fetch }) {
  let queue = existsSync(queueFile) ? JSON.parse(readFileSync(queueFile, "utf8")) : [];
  if (!Array.isArray(queue)) throw new Error("Conversation synchronization queue is invalid");
  let running;
  let stopped = false;
  let nextAttempt = 0;
  const saveQueue = (next) => {
    mkdirSync(dirname(queueFile), { recursive: true, mode: 0o750 });
    writeFileSync(`${queueFile}.tmp`, JSON.stringify(next), { mode: 0o600 });
    renameSync(`${queueFile}.tmp`, queueFile);
    queue = next;
  };
  const request = async (method, body) => {
    const response = await fetchImpl(new URL("/api/shared-conversations", url), {
      method, headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) throw new Error(`Shared cloud synchronization returned ${response.status}`);
    return response.json();
  };
  const synchronize = () => {
    if (running) return running;
    if (stopped || Date.now() < nextAttempt) return Promise.resolve();
    running = (async () => {
      try {
        // Remove only the exact acknowledged version; a new local edit may arrive during POST.
        for (const pending of [...queue]) {
          await request("POST", pending);
          saveQueue(queue.filter((entry) => entry !== pending));
        }
        const data = await request("GET");
        if (!Array.isArray(data.conversations)) throw new Error("Invalid shared cloud response");
        const pendingIds = new Set(queue.map((entry) => entry.conversation.id));
        store.mergeRemote(data.conversations.filter((item) => !pendingIds.has(item.id)));
        nextAttempt = Date.now() + 10_000;
      } catch (error) {
        nextAttempt = Date.now() + 15_000;
        console.warn(JSON.stringify({ event: "shared_sync_pending", pending: queue.length, error: error.message }));
      } finally { running = undefined; }
    })();
    return running;
  };
  const timer = setInterval(() => { void synchronize(); }, 15_000);
  timer.unref();
  return {
    async list() { await synchronize(); return store.list(); },
    upsert(conversation, editKey) {
      const saved = store.upsert(conversation, editKey);
      saveQueue([...queue.filter((entry) => entry.conversation.id !== conversation.id), { conversation, editKey }]);
      nextAttempt = 0;
      void synchronize();
      return saved;
    },
    remove(id, editKey) {
      store.remove(id, editKey);
      const conversation = store.list().find((entry) => entry.id === id);
      saveQueue([...queue.filter((entry) => entry.conversation.id !== id), { conversation, editKey }]);
      nextAttempt = 0;
      void synchronize();
      return true;
    },
    async synchronize() { nextAttempt = 0; await synchronize(); },
    close() { stopped = true; clearInterval(timer); },
  };
}
