// biome-ignore-all lint/suspicious/useAwait: Async doubles match VS Code Thenable interfaces.
"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { createCommands, registerStudio } = require("../src/extension.cjs");

function fixture() {
  const values = new Map();
  const registered = new Map();
  const notices = [];
  const prompts = [];
  const context = {
    subscriptions: [],
    secrets: {
      store: async (k, v) => values.set(k, v),
      get: async (k) => values.get(k),
      delete: async (k) => values.delete(k),
    },
    globalState: {
      get: () => [],
      update: async () => {
        /* No task history is needed by these command tests. */
      },
    },
  };
  const vscode = {
    commands: {
      registerCommand: (name, fn) => {
        registered.set(name, fn);
        return {
          dispose() {
            /* Test double has no resources. */
          },
        };
      },
    },
    workspace: { isTrusted: true, workspaceFolders: [] },
    window: {
      showInputBox: async (options) => {
        prompts.push(options);
        return "private-key";
      },
      showInformationMessage: async (message) => {
        notices.push(message);
      },
      showErrorMessage: async (message) => {
        notices.push(message);
      },
    },
  };
  return { values, registered, notices, prompts, context, vscode };
}

test("registers discoverable media commands and only SecretStorage holds API key", async () => {
  const f = fixture();
  createCommands(f.context, f.vscode);
  assert.equal(f.registered.size, 7);
  await f.registered.get("apixlyMedia.setApiKey")();
  assert.equal(f.prompts[0].password, true);
  assert.equal(f.values.get("apixlyMedia.apiKey"), "private-key");
  assert.ok(f.notices.every((message) => !message.includes("private-key")));
  await f.registered.get("apixlyMedia.clearApiKey")();
  assert.equal(f.values.size, 0);
});

test("classic commands use the selected account provider and hold credentials until their operation ends", async () => {
  const f = fixture();
  let resolved = 0,
    holds = 0,
    released = 0;
  const credentials = {
    resolve: async () => {
      resolved++;
      return { client: {} };
    },
    hold: () => {
      holds++;
      return () => {
        released++;
      };
    },
  };
  f.context.secrets.get = async () => {
    throw Error("classic commands must use the active account provider");
  };
  f.vscode.window.showInputBox = async () => undefined;
  const actions = createCommands(f.context, f.vscode, { credentials });
  assert.equal(actions.credentials, credentials);
  assert.equal(f.registered.size, 7);
  await f.registered.get("apixlyMedia.generateImage")();
  assert.equal(resolved, 1);
  assert.equal(holds, 1);
  assert.equal(released, 1);
  assert.equal(f.notices.length, 0);
});

test("untrusted workspace cannot submit paid generation or read a secret", async () => {
  const f = fixture();
  f.vscode.workspace.isTrusted = false;
  f.context.secrets.get = async () => {
    throw new Error("Must not read key");
  };
  let created = 0;
  createCommands(f.context, f.vscode, {
    clientFactory: () => {
      created++;
      throw new Error("Must not submit");
    },
  });
  await f.registered.get("apixlyMedia.generateImage")();
  assert.equal(created, 0);
  assert.ok(f.notices.some((message) => /trusted/i.test(message)));
});

test("unexpected errors never expose internal error bodies in notifications", async () => {
  const f = fixture();
  f.context.secrets.store = async () => {
    throw new Error("private-key implementation error");
  };
  createCommands(f.context, f.vscode);
  await f.registered.get("apixlyMedia.setApiKey")();
  assert.ok(f.notices.every((message) => !message.includes("private-key")));
});

for (const operation of ["generateImage", "editImage", "generateVideo"]) {
  test(`${operation} command submits once, remembers safe task metadata and saves selected asset`, async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "apixly-command-"));
    try {
      const f = fixture();
      const kind = operation === "generateVideo" ? "video" : "image";
      const destination = path.join(
        root,
        kind === "image" ? "result.png" : "result.mp4",
      );
      const stored = new Map();
      const received = [];
      const input = ["exact-model", "private prompt", "{}"];
      if (kind === "video") input.push("https://example.com/ref.png");
      const reference = {
        scheme: "file",
        path: path.join(root, "ref.png"),
        fsPath: path.join(root, "ref.png"),
      };
      f.values.set("apixlyMedia.apiKey", "private-key");
      f.context.globalState.get = (key, fallback) =>
        stored.get(key) ?? fallback;
      f.context.globalState.update = async (key, value) => {
        stored.set(key, value);
      };
      f.vscode.workspace.workspaceFolders = [
        { uri: { scheme: "file", fsPath: root } },
      ];
      f.vscode.workspace.fs = {
        stat: async () => ({ size: 3 }),
        readFile: async () => Buffer.from([1, 2, 3]),
      };
      f.vscode.Uri = { file: (file) => ({ scheme: "file", fsPath: file }) };
      f.vscode.ProgressLocation = { Notification: 15 };
      f.vscode.window.showInputBox = async () => input.shift();
      f.vscode.window.showWarningMessage = async () => "Submit paid request";
      f.vscode.window.showOpenDialog = async (options) =>
        options.title.startsWith("Choose an optional")
          ? undefined
          : [reference];
      f.vscode.window.withProgress = async (_options, callback) =>
        callback(
          {
            report() {
              /* No UI in offline tests. */
            },
          },
          {
            onCancellationRequested: () => ({
              dispose() {
                /* No subscription in mock. */
              },
            }),
          },
        );
      f.vscode.window.showSaveDialog = async () => ({
        scheme: "file",
        fsPath: destination,
      });
      const fake = {
        videoCapabilities: async () => [
          { model: "exact-model", modes: ["image2video"], max_input_images: 8 },
        ],
        submitImage: async (request) => {
          received.push(request);
          return { id: "task-1", status: "queued" };
        },
        submitVideo: async (request) => {
          received.push(request);
          return { id: "task-1", status: "queued" };
        },
        status: async () => ({
          status: "succeeded",
          assets: [{ url: "https://cdn.example.com/result" }],
        }),
        download: async () => ({
          extension: kind === "image" ? ".png" : ".mp4",
          bytes: Buffer.from("finished media"),
        }),
      };
      createCommands(f.context, f.vscode, {
        clientFactory: (key) => {
          assert.equal(key, "private-key");
          return fake;
        },
      });
      await f.registered.get(`apixlyMedia.${operation}`)();
      assert.equal(received.length, 1);
      assert.equal(received[0].model, "exact-model");
      if (operation === "editImage") {
        assert.deepEqual(received[0].refs[0].bytes, Buffer.from([1, 2, 3]));
      }
      if (kind === "video") {
        assert.deepEqual(received[0].params.images, [
          "https://example.com/ref.png",
        ]);
      }
      assert.equal(await fs.readFile(destination, "utf8"), "finished media");
      const history = stored.get("apixlyMedia.tasks");
      assert.equal(history[0].id, "task-1");
      assert.ok(!JSON.stringify(history).includes("private"));
      assert.ok(f.notices.some((message) => message.includes("saved 1 asset")));
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
}

test("ambiguous server failure tells the user to check activity before another submission", async () => {
  const f = fixture();
  const input = ["exact-model", "prompt", "{}"];
  f.values.set("apixlyMedia.apiKey", "private-key");
  f.vscode.window.showInputBox = async () => input.shift();
  f.vscode.window.showWarningMessage = async () => "Submit paid request";
  let submissions = 0;
  createCommands(f.context, f.vscode, {
    clientFactory: () => ({
      submitImage: async () => {
        submissions++;
        throw Object.assign(new Error("Apixly request returned HTTP 503."), {
          safe: true,
          unknownOutcome: true,
        });
      },
    }),
  });
  await f.registered.get("apixlyMedia.generateImage")();
  assert.equal(submissions, 1);
  assert.ok(
    f.notices.some(
      (message) =>
        message.includes("outcome is unknown") &&
        message.includes("Check Apixly activity"),
    ),
  );
});

test("the real panel message listener exists before its initial HTML can send ready", async () => {
  const f = fixture();
  let received;
  let close;
  f.context.extensionPath = path.join(os.tmpdir(), "apixly-extension-fixture");
  f.context.globalStorageUri = {
    fsPath: path.join(os.tmpdir(), "apixly-storage-fixture"),
  };
  f.vscode.ViewColumn = { One: 1 };
  f.vscode.Uri = { file: (fsPath) => ({ fsPath }) };
  const webview = {
    cspSource: "vscode-resource:",
    asWebviewUri: (uri) => ({ toString: () => uri.fsPath }),
    onDidReceiveMessage: (callback) => {
      received = callback;
      return {
        dispose() {
          /* Mock registration. */
        },
      };
    },
    postMessage: () => undefined,
  };
  Object.defineProperty(webview, "html", {
    set: () => assert.equal(typeof received, "function"),
  });
  f.vscode.window.createWebviewPanel = () => ({
    webview,
    reveal() {
      /* No actual window. */
    },
    onDidDispose: (callback) => {
      close = callback;
      return {
        dispose() {
          /* Mock registration. */
        },
      };
    },
    dispose() {
      /* No actual window. */
    },
  });
  const open = registerStudio(f.context, f.vscode, {});
  open();
  assert.equal(typeof received, "function");
  close();
});

test("key setup completes without waiting for an informational notification to be dismissed", async () => {
  const f = fixture();
  f.vscode.window.showInformationMessage = () => new Promise(() => undefined);
  createCommands(f.context, f.vscode);
  const completed = await Promise.race([
    f.registered
      .get("apixlyMedia.setApiKey")()
      .then(() => true),
    new Promise((resolve) => setImmediate(() => resolve(false))),
  ]);
  assert.equal(completed, true);
  assert.equal(f.values.get("apixlyMedia.apiKey"), "private-key");
});

test("public image-edit command rejects mask arguments before prompting or submitting", async () => {
  const f = fixture();
  createCommands(f.context, f.vscode);
  await f.registered.get("apixlyMedia.editImage")({ mask: "unqualified" });
  assert.equal(f.prompts.length, 0);
  assert.ok(f.notices.some((message) => /mask.*not available/i.test(message)));
});

test("an open Studio observes classic-command SecretStorage changes and releases its subscription", async () => {
  const f = fixture();
  let changed;
  let close;
  let released = false;
  const messages = [];
  f.context.extensionPath = path.join(os.tmpdir(), "apixly-extension-fixture");
  f.context.globalStorageUri = {
    fsPath: path.join(os.tmpdir(), "apixly-storage-fixture"),
  };
  f.context.secrets.onDidChange = (callback) => {
    changed = callback;
    return {
      dispose() {
        released = true;
      },
    };
  };
  f.vscode.ViewColumn = { One: 1 };
  f.vscode.Uri = { file: (fsPath) => ({ fsPath }) };
  const webview = {
    cspSource: "vscode-resource:",
    asWebviewUri: (uri) => ({ toString: () => uri.fsPath }),
    onDidReceiveMessage: () => ({
      dispose() {
        /* Test subscription. */
      },
    }),
    postMessage: async (message) => messages.push(message),
  };
  f.vscode.window.createWebviewPanel = () => ({
    webview,
    reveal() {
      /* Test window. */
    },
    onDidDispose: (callback) => {
      close = callback;
      return {
        dispose() {
          /* Test registration. */
        },
      };
    },
    dispose() {
      /* Test panel. */
    },
  });
  registerStudio(f.context, f.vscode, {})();
  assert.equal(typeof changed, "function");
  await changed({ key: "apixlyMedia.apiKey" });
  assert.ok(
    messages.some(
      (message) => message.type === "state" && message.hasKey === false,
    ),
  );
  close();
  assert.equal(released, true);
});

test("a one-shot task check releases its lock without waiting for a success notice dismissal", async () => {
  const f = fixture();
  f.values.set("apixlyMedia.apiKey", "private-key");
  let reads = 0;
  f.vscode.window.showQuickPick = async () => ({
    job: { kind: "image", id: "existing", model: "exact", status: "queued" },
  });
  f.vscode.window.showInformationMessage = () => new Promise(() => undefined);
  createCommands(f.context, f.vscode, {
    clientFactory: () => ({
      status: async () => {
        reads++;
        return { status: "queued", assets: [] };
      },
    }),
  });
  const check = f.registered.get("apixlyMedia.checkTask");
  const finished = await Promise.race([
    check().then(() => true),
    new Promise((resolve) => setImmediate(() => resolve(false))),
  ]);
  assert.equal(finished, true);
  await check();
  assert.equal(reads, 2);
});
