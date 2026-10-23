"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { createAccountClient } = require("../src/account.cjs");

const token = `apc_${"a".repeat(43)}`;
const account = {
  connection_id: "connection-one",
  account: { id: "42", name: "Account", email: "qa@example.test" },
  selected_key: {
    id: "studixly",
    name: "Studixly Key",
    masked: "sk…test",
    is_default: true,
  },
  selection_revision: 1,
  expires_at: "2027-01-01T00:00:00.000Z",
};
const grant = {
  ...account,
  access_token: token,
  token_type: "Bearer",
  expires_in: 7776000,
};
const start = {
  flow_id: "flow-one",
  device_code: "private_device_code",
  user_code: "ABCD-EFGH",
  verification_uri: "https://apixly.ai/connect/flow-one",
  verification_uri_complete:
    "https://apixly.ai/connect/flow-one?user_code=ABCD-EFGH",
  expires_in: 600,
  interval: 5,
};
const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

test("device flow uses host PKCE, fixed endpoints and exposes no redemption proof in its descriptor", async () => {
  const requests = [];
  const api = createAccountClient({
    fetcher: async (url, init) => {
      requests.push({ url, ...init });
      return json(start);
    },
    now: () => 1000,
  });
  const flow = await api.begin();
  assert.deepEqual(flow, {
    userCode: "ABCD-EFGH",
    verificationUri: start.verification_uri_complete,
    expiresAt: 601000,
    intervalMs: 5000,
  });
  const request = requests[0];
  assert.equal(request.url, "https://apixly.ai/api/integrations/connect");
  assert.equal(request.redirect, "error");
  assert.equal(request.headers["cache-control"], "no-store");
  const body = JSON.parse(request.body);
  assert.equal(body.client_id, "vscode");
  assert.equal(body.flow, "device");
  assert.equal(body.code_challenge_method, "S256");
  assert.match(body.code_challenge, /^[A-Za-z0-9_-]{43}$/);
  assert(!request.body.includes("code_verifier"));
  assert(!JSON.stringify(flow).includes(start.device_code));
  assert(!JSON.stringify(flow).includes("code_verifier"));
});

test("poll respects advertised interval and slow_down, then returns token separately from safe metadata", async () => {
  let now = 0;
  const waits = [],
    requests = [],
    statuses = [];
  const responses = [
    json(start),
    json({ error: "authorization_pending", error_description: token }, 400),
    json({ error: "slow_down" }, 400),
    json(grant),
  ];
  const api = createAccountClient({
    now: () => now,
    wait: async (ms) => {
      waits.push(ms);
      now += ms;
    },
    fetcher: async (url, init) => {
      requests.push({ url, ...init });
      return responses.shift();
    },
  });
  const flow = await api.begin();
  const result = await api.poll(flow, {
    onStatus: (value) => statuses.push(value),
  });
  assert.deepEqual(waits, [5000, 5000, 10000]);
  assert.deepEqual(statuses, ["pending", "slow_down"]);
  assert.equal(result.token, token);
  assert.deepEqual(result.metadata, account);
  assert(!JSON.stringify(result.metadata).includes(token));
  const body = JSON.parse(requests[1].body);
  assert.equal(body.device_code, start.device_code);
  assert.equal(body.client_id, "vscode");
  assert.equal(body.grant_type, "urn:ietf:params:oauth:grant-type:device_code");
  assert.match(body.code_verifier, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(
    crypto.createHash("sha256").update(body.code_verifier).digest("base64url"),
    JSON.parse(requests[0].body).code_challenge,
  );
  assert(
    requests
      .slice(1)
      .every((r) => r.url === "https://apixly.ai/api/integrations/token"),
  );
  await assert.rejects(api.poll(flow), /Start a new account connection/);
});

test("device expiry, explicit denial and cancellation stop local polling without retrying", async () => {
  for (const type of ["expired", "denied", "cancelled"]) {
    let now = 0,
      count = 0;
    const controller = new AbortController();
    const api = createAccountClient({
      now: () => now,
      wait: async (ms) => {
        now += ms;
        if (type === "cancelled") controller.abort();
      },
      fetcher: async () => {
        count++;
        return json(
          count === 1
            ? { ...start, ...(type === "expired" ? { expires_in: 2 } : {}) }
            : { error: "access_denied" },
          count === 1 ? 200 : 400,
        );
      },
    });
    const flow = await api.begin();
    await assert.rejects(
      api.poll(flow, { signal: controller.signal }),
      type === "expired"
        ? /expired/
        : type === "denied"
          ? /denied/
          : /cancelled/,
    );
    assert.equal(count, type === "denied" ? 2 : 1);
  }
});

test("verification links reject external origins, credential URLs, fragments and proof parameters", async () => {
  for (const url of [
    "https://evil.example/connect/a",
    "http://apixly.ai/connect/a",
    "https://user@apixly.ai/connect/a",
    "https://apixly.ai/connect/a#proof",
    "https://apixly.ai/not-connect",
    "https://apixly.ai/connect/a?device_code=secret",
    "https://apixly.ai/connect/a?code_verifier=secret",
  ]) {
    const api = createAccountClient({
      fetcher: async () => json({ ...start, verification_uri_complete: url }),
    });
    await assert.rejects(api.begin(), /invalid authorization response/);
  }
});

test("account and key operations forward only connection authorization to fixed routes and project metadata", async () => {
  const requests = [];
  const responses = [
    json({
      ...account,
      access_token: "not-ui",
      api_key: "not-ui",
      account: { ...account.account, jwt: "not-ui" },
    }),
    json({
      data: [
        {
          id: 7,
          name: "Owned",
          masked: "sk…7",
          status: "active",
          expires_at: null,
          is_default: false,
          key: "not-ui",
        },
      ],
      selected_key_id: "studixly",
      selection_revision: 1,
    }),
    json({
      ...account,
      selected_key: { id: 7, name: "Owned", masked: "sk…7", is_default: false },
      selection_revision: 2,
    }),
    new Response(null, { status: 204 }),
  ];
  const api = createAccountClient({
    fetcher: async (url, init) => {
      requests.push({ url, ...init });
      return responses.shift();
    },
  });
  assert.deepEqual(await api.account(token), account);
  const keys = await api.keys(token);
  assert.deepEqual(keys.data[0], {
    id: 7,
    name: "Owned",
    masked: "sk…7",
    status: "active",
    expires_at: null,
    is_default: false,
  });
  assert.equal((await api.selectKey(token, 7)).selection_revision, 2);
  await api.disconnect(token);
  assert.deepEqual(
    requests.map((r) => [r.url.split("/integrations/")[1], r.method]),
    [
      ["account", "GET"],
      ["keys", "GET"],
      ["key", "PUT"],
      ["connection", "DELETE"],
    ],
  );
  assert(
    requests.every(
      (r) =>
        r.headers.authorization === `Bearer ${token}` &&
        r.redirect === "error" &&
        r.headers["cache-control"] === "no-store",
    ),
  );
  assert.deepEqual(JSON.parse(requests[2].body), { key_id: "7" });
  assert(!JSON.stringify(keys).includes("not-ui"));
});

test("auth transport never echoes server errors or secrets, never retries network failure and bounds responses", async () => {
  let count = 0;
  const api = createAccountClient({
    fetcher: async () => {
      count++;
      throw Error(token);
    },
  });
  await assert.rejects(
    api.begin(),
    (e) => e.safe && !e.message.includes(token),
  );
  assert.equal(count, 1);
  const denied = createAccountClient({
    fetcher: async () =>
      json({ error: "invalid_connection", message: token }, 401),
  });
  await assert.rejects(
    denied.account(token),
    (e) => e.code === "unauthorized" && !e.message.includes(token),
  );
  const malformed = createAccountClient({
    fetcher: async () =>
      json({ ...grant, access_token: "website-jwt-not-a-connection" }),
  });
  await assert.rejects(malformed.poll({}), /Start a new account connection/);
  const huge = createAccountClient({
    fetcher: async () => new Response("x".repeat(1024 * 1024 + 1)),
  });
  await assert.rejects(huge.begin(), /invalid authorization response/);
});

test("token grants support the documented expires_in without inventing credentials or requiring expires_at", async () => {
  let now = 1000;
  const { expires_at, ...withoutExpiry } = grant;
  const responses = [json(start), json(withoutExpiry)];
  const api = createAccountClient({
    now: () => now,
    wait: async (ms) => {
      now += ms;
    },
    fetcher: async () => responses.shift(),
  });
  const result = await api.poll(await api.begin());
  assert.equal(
    result.metadata.expires_at,
    new Date(now + 7776000 * 1000).toISOString(),
  );
  for (const badToken of ["website-jwt", "apc_bad\r\nheader", ""]) {
    const values = [json(start), json({ ...grant, access_token: badToken })];
    const bad = createAccountClient({
      wait: async () => {},
      fetcher: async () => values.shift(),
    });
    await assert.rejects(
      bad.poll(await bad.begin()),
      (e) => e.safe && !e.message.includes(badToken || "website-jwt"),
    );
  }
});

test("an unavailable selected Key is a repairable 409 distinct from a revoked connection", async () => {
  const api = createAccountClient({
    fetcher: async () => json({ error: "selected_key_unavailable" }, 409),
  });
  await assert.rejects(
    api.account(token),
    (e) => e.code === "selected_key_unavailable" && /Choose/.test(e.message),
  );
});

test("only explicit invalid connection codes require reconnection; upstream selected-Key rejection remains repairable", async () => {
  for (const status of [401, 403]) {
    const api = createAccountClient({
      fetcher: async () => json({ error: "selected_key_rejected" }, status),
    });
    await assert.rejects(
      api.account(token),
      (e) => e.code === "selected_key_rejected" && /Choose/.test(e.message),
    );
  }
  for (const code of [
    "invalid_connection",
    "expired_connection",
    "revoked_connection",
  ]) {
    const api = createAccountClient({
      fetcher: async () => json({ error: code }, 401),
    });
    await assert.rejects(api.account(token), (e) => e.code === "unauthorized");
  }
  let requests = 0;
  const api = createAccountClient({
    fetcher: async () => {
      requests++;
      return json(account);
    },
  });
  for (const value of [
    "apc_short",
    `apc_${"a".repeat(42)}`,
    `apc_${"a".repeat(44)}`,
    `apc_${"/".repeat(43)}`,
  ])
    await assert.rejects(api.account(value), /Reconnect/);
  assert.equal(requests, 0);
});

test("the server's user_code verification query must exactly match the displayed confirmation code", async () => {
  for (const url of [
    "https://apixly.ai/connect/flow-one?user_code=WRONG",
    "https://apixly.ai/connect/flow-one?user_code=ABCD-EFGH&user_code=ABCD-EFGH",
    "https://apixly.ai/connect/other-flow?user_code=ABCD-EFGH",
    "https://apixly.ai/connect/flow-one?code=ABCD-EFGH",
  ]) {
    const api = createAccountClient({
      fetcher: async () => json({ ...start, verification_uri_complete: url }),
    });
    await assert.rejects(api.begin(), /invalid authorization response/);
  }
});
