"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function studio() {
  const elements = new Map();
  function element() {
    const classes = new Set();
    return {
      value: "",
      textContent: "",
      className: "",
      dataset: {},
      handlers: {},
      classList: {
        add: (name) => classes.add(name),
        remove: (name) => classes.delete(name),
        toggle: (name, on) => (on ? classes.add(name) : classes.delete(name)),
      },
      addEventListener(type, fn) {
        this.handlers[type] = fn;
      },
      setAttribute() {},
      removeAttribute() {},
      replaceChildren() {},
      append() {},
      scrollIntoView() {},
      querySelector: () => element(),
    };
  }
  const get = (id) => {
    if (!elements.has(id)) elements.set(id, element());
    return elements.get(id);
  };
  const account = element();
  account.dataset.action = "connectAccount";
  const sent = [];
  let receive;
  vm.runInNewContext(
    fs.readFileSync(path.join(__dirname, "../media/studio.js"), "utf8"),
    {
      acquireVsCodeApi: () => ({
        postMessage: (message) => sent.push(message),
      }),
      document: {
        getElementById: get,
        createElement: element,
        querySelectorAll: (selector) =>
          selector === "[data-action]" ? [account] : [],
      },
      window: {
        addEventListener: (type, handler) => {
          if (type === "message") receive = handler;
        },
        ApixlyCreativeControlsUI: {
          installCreativeControls: () => ({
            refresh() {},
            setBusy() {},
            setReference() {},
            canSubmit: () => true,
          }),
        },
      },
    },
  );
  return { get, account, sent, receive: (data) => receive({ data }) };
}

test("a new native authorization flow clears the previous flow error without submitting media", () => {
  const f = studio();
  f.receive({ type: "error", message: "Old account flow returned HTTP 502." });
  assert.equal(f.get("message").className, "message error");
  f.receive({
    type: "authorization",
    userCode: "ABCD-EF12",
    expiresAt: "2026-10-23T14:40:00Z",
  });
  assert.equal(f.get("message").textContent, "");
  assert.equal(f.get("message").className, "message hidden");
  assert.deepEqual(
    f.sent.map((message) => message.type),
    ["ready"],
  );
});

test("a current account failure is still visible after starting the replacement flow", () => {
  const f = studio();
  f.receive({ type: "error", message: "Old failure" });
  f.receive({
    type: "authorization",
    userCode: "ABCD-EF12",
    expiresAt: "2026-10-23T14:40:00Z",
  });
  f.receive({ type: "error", message: "Current connection was denied." });
  assert.equal(f.get("message").textContent, "Current connection was denied.");
  assert.equal(f.get("message").className, "message error");
});

test("background account and catalog updates retain a paid submission-unknown error", () => {
  const f = studio();
  const warning =
    "Submission outcome is unknown. Check Apixly activity before submitting again.";
  f.receive({ type: "error", message: warning });
  f.receive({
    type: "state",
    hasKey: true,
    connection: {
      mode: "account",
      hasConnection: true,
      account: {
        account: { name: "Test owner" },
        selected_key: {
          id: "studixly",
          name: "Studixly Key",
          masked: "••••1234",
        },
      },
      keys: [],
    },
  });
  f.receive({ type: "catalog", available: false, clear: true });
  assert.equal(f.get("message").textContent, warning);
  assert.equal(f.get("message").className, "message error");
  assert.deepEqual(
    f.sent.map((message) => message.type),
    ["ready"],
  );
});
