import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createSharedConversationStore } from "../src/shared_conversations.mjs";
import { createSharedReplica } from "../src/shared_replica.mjs";

test("offline conversations survive restart and later synchronize both ways without losing chats", async () => {
  const directory = mkdtempSync(join(tmpdir(), "huawei-replica-"));
  const queueFile = join(directory, "queue.json");
  const localFile = join(directory, "local.json");
  const cloud = createSharedConversationStore(join(directory, "cloud.json"));
  const key = "publisher-key-abcdefghijklmnopqrstuvwxyz";
  const now = Date.now();
  const make = (id, content) => ({ id, title: id, provider: "deepseek", model: "deepseek-flash", createdAt: now,
    updatedAt: now, messages: [{ role: "user", content, createdAt: now }] });
  let online = false;
  const fetchImpl = async (_url, options) => {
    if (!online) return new Response("offline", { status: 503 });
    if (options.method === "POST") {
      const body = JSON.parse(options.body);
      return Response.json({ conversation: cloud.upsert(body.conversation, body.editKey) });
    }
    return Response.json({ conversations: cloud.list() });
  };
  let replica;
  try {
    replica = createSharedReplica(createSharedConversationStore(localFile), { url: "https://example.test", token: "private", queueFile, fetchImpl });
    replica.upsert(make("local-chat-001", "saved offline"), key);
    await replica.synchronize();
    assert.equal(JSON.parse(readFileSync(queueFile, "utf8")).length, 1);
    replica.close();
    cloud.upsert(make("remote-chat-001", "from another visitor"), key);
    online = true;
    replica = createSharedReplica(createSharedConversationStore(localFile), { url: "https://example.test", token: "private", queueFile, fetchImpl });
    await replica.synchronize();
    assert.equal(cloud.list().length, 2);
    assert.equal((await replica.list()).length, 2);
    assert.deepEqual(JSON.parse(readFileSync(queueFile, "utf8")), []);
    assert.equal(JSON.stringify(await replica.list()).includes(key), false);
    const changed = make("local-chat-001", "saved offline");
    changed.messages.push({ role: "assistant", content: "new response", createdAt: now });
    changed.updatedAt = now + 1;
    replica.upsert(changed, key);
    await replica.synchronize();
    assert.equal(cloud.list().find(c => c.id === changed.id).messages.length, 2);
    assert.equal((await replica.list()).find(c => c.id === "remote-chat-001").messages.length, 1);
  } finally { replica?.close(); rmSync(directory, { recursive: true, force: true }); }
});
