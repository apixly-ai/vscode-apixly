// biome-ignore-all lint/suspicious/useAwait: Async doubles match SecretStorage and account APIs.
"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  createCredentialSession,
  CONNECTION_KEY,
  AUTH_MODE,
  MANUAL_KEY,
} = require("../src/credentials.cjs");
const metadata = {
  connection_id: "c1",
  account: { id: "42", name: "QA", email: "qa@example.test" },
  selected_key: {
    id: "studixly",
    name: "Studixly Key",
    masked: "sk…123",
    is_default: true,
  },
  selection_revision: 1,
  expires_at: "2027-01-01T00:00:00Z",
};
function setup(initial = {}) {
  const secrets = new Map(Object.entries(initial)),
    state = new Map(),
    calls = [],
    factories = [];
  const context = {
    secrets: {
      get: async (key) => secrets.get(key),
      store: async (key, value) => secrets.set(key, value),
      delete: async (key) => secrets.delete(key),
    },
    globalState: {
      get: (key, fallback) => state.get(key) ?? fallback,
      update: async (key, value) => state.set(key, value),
    },
  };
  let selected = metadata;
  const accountClient = {
    begin: async () => ({
      userCode: "ABCD",
      verificationUri: "https://apixly.ai/connect/a",
      expiresAt: 10000,
      intervalMs: 5000,
    }),
    poll: async () => ({ token: "apc_private_connection", metadata: selected }),
    cancel: () => {},
    account: async (token) => {
      calls.push(["account", token]);
      return selected;
    },
    keys: async (token) => {
      calls.push(["keys", token]);
      return {
        data: [
          {
            id: "studixly",
            name: "Studixly Key",
            masked: "sk…123",
            is_default: true,
            status: "active",
            expires_at: null,
          },
          {
            id: "7",
            name: "Quota Key",
            masked: "sk…007",
            is_default: false,
            status: "active",
            expires_at: null,
          },
        ],
        selected_key_id: selected.selected_key.id,
        selection_revision: selected.selection_revision,
      };
    },
    selectKey: async (token, id) => {
      calls.push(["select", token, id]);
      selected = {
        ...metadata,
        selected_key: {
          id,
          name: "Quota Key",
          masked: "sk…007",
          is_default: false,
        },
        selection_revision: 2,
      };
      return selected;
    },
    disconnect: async (token) => {
      calls.push(["disconnect", token]);
    },
  };
  const session = createCredentialSession({
    context,
    accountClient,
    clientFactory: (credential, options) => {
      factories.push({ credential, options });
      return { ready: true };
    },
  });
  return { session, context, secrets, state, calls, factories, accountClient };
}
test("existing manual keys remain compatible, and connection tokens are routed only through the account relay", async () => {
  const f = setup({ [MANUAL_KEY]: "private-manual" });
  const manual = await f.session.resolve();
  assert.match(manual.identity, /^manual:[a-f0-9]{64}$/);
  assert.deepEqual(f.factories[0], {
    credential: "private-manual",
    options: { mode: "manual" },
  });
  assert.equal(f.calls.length, 0);
  const pending = [];
  await f.session.connect({
    openExternal: async (uri) => pending.push(uri),
    onPending: (flow) => pending.push(flow),
  });
  assert.equal(f.secrets.get(CONNECTION_KEY), "apc_private_connection");
  assert.equal(f.state.get(AUTH_MODE), "account");
  const resolved = await f.session.resolve();
  assert.match(resolved.identity, /^account:[a-f0-9]{64}$/);
  assert.deepEqual(f.factories.at(-1), {
    credential: "apc_private_connection",
    options: { mode: "account" },
  });
  const view = await f.session.view();
  assert.equal(view.mode, "account");
  assert.equal(view.hasCredential, true);
  assert.deepEqual(view.account, metadata);
  assert(
    !JSON.stringify({ view, pending, state: [...f.state] }).includes(
      "apc_private",
    ),
  );
  assert(
    !JSON.stringify({ view, pending, state: [...f.state] }).includes(
      "private-manual",
    ),
  );
});
test("selecting an owned key invalidates catalog identity without changing a model or generating", async () => {
  const f = setup();
  await f.session.connect({ openExternal: async () => true });
  const old = (await f.session.resolve()).identity;
  const events = [];
  f.session.subscribe(() => events.push("changed"));
  await f.session.selectKey("7");
  const changed = await f.session.resolve();
  assert.notEqual(changed.identity, old);
  assert.equal((await f.session.view()).account.selected_key.id, "7");
  assert(f.calls.some((c) => c[0] === "select" && c[2] === "7"));
  assert(events.length > 0);
  assert(
    ![...f.state.keys()].some((key) =>
      /model|prompt|token|password/i.test(key),
    ),
  );
});
test("credential mutations are blocked for the complete active task lifetime", async () => {
  const f = setup({ [MANUAL_KEY]: "key" });
  const release = f.session.hold();
  for (const operation of [
    () => f.session.connect({}),
    () => f.session.setManual("new"),
    () => f.session.clearManual(),
    () => f.session.selectKey("7"),
    () => f.session.disconnect(),
  ])
    await assert.rejects(operation(), /Stop waiting/);
  assert.equal(f.calls.length, 0);
  assert.equal(f.secrets.get(MANUAL_KEY), "key");
  release();
  release();
  await f.session.setManual("new");
  assert.equal(f.secrets.get(MANUAL_KEY), "new");
});
test("disconnect revokes the connection and clears its secret without silently falling back to a saved manual key", async () => {
  const f = setup({ [MANUAL_KEY]: "old-manual" });
  await f.session.connect({ openExternal: async () => true });
  await f.session.disconnect();
  assert(!f.secrets.has(CONNECTION_KEY));
  assert.equal(f.secrets.get(MANUAL_KEY), "old-manual");
  assert.equal((await f.session.view()).hasCredential, false);
  await assert.rejects(f.session.resolve(), /Connect your Apixly account/);
  assert.equal(f.calls.filter((c) => c[0] === "disconnect").length, 1);
  await f.session.useManual();
  assert.equal((await f.session.view()).mode, "manual");
});
test("revoked account connections never fall back to manual mode and expose only a safe reconnect error", async () => {
  const f = setup({
    [MANUAL_KEY]: "old-manual",
    [CONNECTION_KEY]: "apc_private_connection",
  });
  f.state.set(AUTH_MODE, "account");
  f.accountClient.account = async () => {
    throw Object.assign(Error("Reconnect your account."), {
      safe: true,
      code: "unauthorized",
    });
  };
  await assert.rejects(f.session.resolve(), /Reconnect/);
  assert.equal(f.factories.length, 0);
  assert.equal((await f.session.view()).mode, "account");
});
test("cancelled connection and a late token grant cannot replace the active manual credential", async () => {
  const f = setup({ [MANUAL_KEY]: "manual" });
  let release;
  f.accountClient.poll = async () =>
    await new Promise((resolve) => {
      release = resolve;
    });
  const connecting = f.session.connect({ openExternal: async () => true });
  for (let i = 0; i < 20 && !release; i++)
    await new Promise((resolve) => setImmediate(resolve));
  assert(release);
  assert.throws(() => f.session.hold(), /connection/);
  f.session.cancelConnect();
  release({ token: "apc_late_private", metadata });
  await assert.rejects(connecting, /cancelled/);
  assert(!f.secrets.has(CONNECTION_KEY));
  assert.equal((await f.session.view()).mode, "manual");
  assert(
    f.calls.some((c) => c[0] === "disconnect" && c[1] === "apc_late_private"),
  );
});

test("a selected-Key 409 preserves account credentials and owned Key choices for repair without manual fallback", async () => {
  const f = setup({
    [MANUAL_KEY]: "manual",
    [CONNECTION_KEY]: "apc_private_connection",
  });
  f.state.set(AUTH_MODE, "account");
  f.accountClient.account = async () => {
    throw Object.assign(Error("Choose an active Key."), {
      safe: true,
      code: "selected_key_unavailable",
    });
  };
  const view = await f.session.view({ refresh: true });
  assert.equal(view.mode, "account");
  assert.equal(view.hasCredential, false);
  assert.equal(view.hasConnection, true);
  assert.equal(view.keys.length, 2);
  assert.match(view.error, /Choose/);
  await assert.rejects(f.session.resolve(), /Choose/);
  assert.equal(f.factories.length, 0);
  await f.session.selectKey("7");
  assert.equal((await f.session.view()).hasCredential, true);
  assert.equal((await f.session.resolve()).client.ready, true);
  assert.equal(f.secrets.get(CONNECTION_KEY), "apc_private_connection");
});

test("reconnecting revokes the superseded plugin connection instead of orphaning its token", async () => {
  const f = setup({ [CONNECTION_KEY]: "apc_previous_connection" });
  await f.session.connect({ openExternal: async () => true });
  assert(
    f.calls.some(
      (c) => c[0] === "disconnect" && c[1] === "apc_previous_connection",
    ),
  );
  assert.equal(f.secrets.get(CONNECTION_KEY), "apc_private_connection");
  f.accountClient.disconnect = async () => {
    throw Object.assign(Error("already revoked"), {
      safe: true,
      code: "unauthorized",
    });
  };
  await f.session.disconnect();
  assert(!f.secrets.has(CONNECTION_KEY));
});

test("account refresh failures remain visible while preserving same-account Key metadata", async () => {
  const f = setup();
  await f.session.connect({ openExternal: async () => true });
  f.accountClient.keys = async () => {
    throw Error("private body or credential");
  };
  const view = await f.session.view({ refresh: true });
  assert.match(view.error, /Could not refresh/);
  assert(!view.error.includes("private"));
  assert.equal(view.keys.length, 2);
  assert.equal(view.hasCredential, false);
});

test("a late SecretStorage read cannot publish the previous credential mode", async () => {
  const f = setup({ [MANUAL_KEY]: "manual" });
  let release;
  const original = f.context.secrets.get;
  let delayed = true;
  f.context.secrets.get = async (key) => {
    if (key === MANUAL_KEY && delayed) {
      delayed = false;
      return await new Promise((resolve) => {
        release = resolve;
      });
    }
    return original(key);
  };
  const old = f.session.view();
  await new Promise((resolve) => setImmediate(resolve));
  await f.session.connect({ openExternal: async () => true });
  release("manual");
  assert.equal((await old).mode, "account");
});

test("upstream selected-Key rejection preserves the account connection and permits explicit Key repair", async () => {
  const f = setup({ [CONNECTION_KEY]: "apc_private_connection" });
  f.state.set(AUTH_MODE, "account");
  f.accountClient.account = async () => {
    throw Object.assign(Error("Choose another active Key."), {
      safe: true,
      code: "selected_key_rejected",
    });
  };
  const view = await f.session.view({ refresh: true });
  assert.equal(view.hasConnection, true);
  assert.equal(view.keys.length, 2);
  assert.equal(f.secrets.get(CONNECTION_KEY), "apc_private_connection");
  await f.session.selectKey("7");
  assert.equal((await f.session.view()).hasCredential, true);
});
