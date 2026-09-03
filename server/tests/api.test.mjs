import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createSocialServer } from "../src/app.js";

async function withServer(run) {
  const directory = await mkdtemp(join(tmpdir(), "xiaoman-social-"));
  const runtime = createSocialServer({ dbPath: join(directory, "social.sqlite"), staticDir: null, logger: false });
  await new Promise((resolve) => runtime.server.listen(0, "127.0.0.1", resolve));
  const address = runtime.server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;
  try {
    return await run(baseUrl);
  } finally {
    await runtime.close();
    await rm(directory, { recursive: true, force: true });
  }
}

async function request(baseUrl, path, { token, cookie, body, method = "GET" } = {}) {
  const headers = { accept: "application/json" };
  if (body !== undefined) headers["content-type"] = "application/json";
  if (token) headers.authorization = `Bearer ${token}`;
  if (cookie) headers.cookie = cookie;
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  const payload = text ? JSON.parse(text) : null;
  return { response, payload };
}

function authPayload(result) {
  assert.equal(result.response.status, 200);
  const value = result.payload?.data ?? result.payload;
  assert.equal(typeof value?.token, "string");
  assert.equal(value.token.length > 20, true);
  return value;
}

test("guest session is public but private collections require authentication", async () => {
  await withServer(async (baseUrl) => {
    const session = await request(baseUrl, "/api/v1/session");
    assert.equal(session.response.status, 200);
    assert.equal((session.payload.data ?? session.payload).authState, "guest");
    assert.equal((session.payload.data ?? session.payload).user, null);

    const friends = await request(baseUrl, "/api/v1/friends");
    assert.equal(friends.response.status, 401);
    assert.equal(friends.payload.error.code, "UNAUTHORIZED");
  });
});

test("rejects malformed JSON and does not grant CORS to an unknown origin", async () => {
  await withServer(async (baseUrl) => {
    const malformed = await fetch(`${baseUrl}/api/v1/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" , origin: "https://unknown.example" },
      body: "{",
    });
    assert.equal(malformed.status, 400);
    const malformedPayload = JSON.parse(await malformed.text());
    assert.equal(malformedPayload.error.code, "INVALID_INPUT");
    assert.equal(malformed.headers.get("access-control-allow-origin"), null);

    const allowed = await fetch(`${baseUrl}/api/v1/session`, { headers: { origin: "http://localhost:5173" } });
    assert.equal(allowed.status, 200);
    assert.equal(allowed.headers.get("access-control-allow-origin"), "http://localhost:5173");
  });
});

test("registered users can search and complete a two-sided friend request", async () => {
  await withServer(async (baseUrl) => {
    const alice = authPayload(await request(baseUrl, "/api/v1/auth/register", {
      method: "POST",
      body: { username: "alice", password: "alice-password", displayName: "爱丽丝" },
    }));
    const bob = authPayload(await request(baseUrl, "/api/v1/auth/register", {
      method: "POST",
      body: { username: "bob", password: "bob-password", displayName: "鲍勃" },
    }));
    assert.equal(alice.session.user.displayName, "爱丽丝");
    assert.equal(alice.session.user.avatarUrl, null);
    assert.equal(Object.hasOwn(alice.session.user, "display_name"), false);

    const aliceLogin = authPayload(await request(baseUrl, "/api/v1/auth/login", {
      method: "POST",
      body: { username: "alice", password: "alice-password" },
    }));
    assert.equal(aliceLogin.session.user.displayName, "爱丽丝");
    assert.equal(Object.hasOwn(aliceLogin.session.user, "display_name"), false);

    const search = await request(baseUrl, "/api/v1/users/search?q=鲍", { token: alice.token });
    assert.equal(search.response.status, 200);
    const searchItems = search.payload.data?.items ?? search.payload.items ?? search.payload;
    assert.equal(searchItems.some((user) => user.id === bob.session.user.id), true);
    assert.equal(Object.hasOwn(searchItems[0], "password"), false);

    const created = await request(baseUrl, "/api/v1/friend-requests", {
      method: "POST",
      token: alice.token,
      body: { userId: bob.session.user.id },
    });
    assert.equal(created.response.status, 200);
    const friendRequest = created.payload.data ?? created.payload;
    assert.equal(friendRequest.status, "pending");

    const bobRequests = await request(baseUrl, "/api/v1/friend-requests", { token: bob.token });
    const bobItems = bobRequests.payload.data?.items ?? bobRequests.payload.items ?? bobRequests.payload;
    assert.equal(bobItems.some((item) => item.id === friendRequest.id), true);

    const accepted = await request(baseUrl, `/api/v1/friend-requests/${friendRequest.id}`, {
      method: "PATCH",
      token: bob.token,
      body: { response: "accept" },
    });
    assert.equal(accepted.response.status, 204);

    const aliceFriends = await request(baseUrl, "/api/v1/friends", { token: alice.token });
    const friendItems = aliceFriends.payload.data?.items ?? aliceFriends.payload.items ?? aliceFriends.payload;
    assert.equal(friendItems.some((friend) => friend.user.id === bob.session.user.id), true);

    const duplicate = await request(baseUrl, "/api/v1/friend-requests", {
      method: "POST",
      token: alice.token,
      body: { userId: bob.session.user.id },
    });
    assert.equal(duplicate.response.status, 409);
  });
});

test("sessions persist across server recreation without persisting plaintext credentials", async () => {
  const directory = await mkdtemp(join(tmpdir(), "xiaoman-social-persist-"));
  const dbPath = join(directory, "social.sqlite");
  let runtime = createSocialServer({ dbPath, staticDir: null });
  await new Promise((resolve) => runtime.server.listen(0, "127.0.0.1", resolve));
  const firstAddress = runtime.server.address();
  const firstBase = `http://127.0.0.1:${firstAddress.port}`;
  const registered = authPayload(await request(firstBase, "/api/v1/auth/register", {
    method: "POST",
    body: { username: "persisted", password: "persisted-password", displayName: "持久用户" },
  }));
  await runtime.close();

  runtime = createSocialServer({ dbPath, staticDir: null });
  await new Promise((resolve) => runtime.server.listen(0, "127.0.0.1", resolve));
  const secondAddress = runtime.server.address();
  const secondBase = `http://127.0.0.1:${secondAddress.port}`;
  try {
    const session = await request(secondBase, "/api/v1/session", { token: registered.token });
    assert.equal(session.response.status, 200);
    assert.equal((session.payload.data ?? session.payload).user.username, "persisted");
    assert.equal((session.payload.data ?? session.payload).user.displayName, "持久用户");
    assert.equal(Object.hasOwn((session.payload.data ?? session.payload).user, "display_name"), false);
    const databaseDump = runtime.store.exportAuthRowsForTest();
    assert.equal(databaseDump.some((row) => JSON.stringify(row).includes("persisted-password")), false);
  } finally {
    await runtime.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("an HttpOnly cookie can restore a browser session without exposing private data to guests", async () => {
  await withServer(async (baseUrl) => {
    const registered = await request(baseUrl, "/api/v1/auth/register", {
      method: "POST",
      body: { username: "cookieuser", password: "cookie-password", displayName: "Cookie 用户" },
    });
    assert.equal(registered.response.status, 200);
    const setCookie = registered.response.headers.get("set-cookie");
    assert.match(setCookie ?? "", /^xiaoman_session=[^;]+;/);
    const cookie = setCookie.split(";", 1)[0];

    const session = await request(baseUrl, "/api/v1/session", { cookie });
    assert.equal(session.response.status, 200);
    assert.equal((session.payload.data ?? session.payload).user.username, "cookieuser");
    const groups = await request(baseUrl, "/api/v1/groups", { cookie });
    assert.equal(groups.response.status, 200);
  });
});

test("the server serves the built SPA and preserves client-side routes", async () => {
  const directory = await mkdtemp(join(tmpdir(), "xiaoman-social-static-"));
  const publicDirectory = join(directory, "public");
  await import("node:fs/promises").then(({ mkdir }) => mkdir(publicDirectory));
  await writeFile(join(publicDirectory, "index.html"), "<!doctype html><title>小满</title>", "utf8");
  const runtime = createSocialServer({ dbPath: join(directory, "social.sqlite"), staticDir: publicDirectory, logger: false });
  await new Promise((resolve) => runtime.server.listen(0, "127.0.0.1", resolve));
  const address = runtime.server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;
  try {
    const response = await fetch(`${baseUrl}/friends/rooms`);
    assert.equal(response.status, 200);
    assert.match(await response.text(), /小满/);
  } finally {
    await runtime.close();
    await rm(directory, { recursive: true, force: true });
  }
});
