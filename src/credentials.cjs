"use strict";
const { createAccountClient } = require("./account.cjs");
const { createClient } = require("./core.cjs");
const { catalogIdentity } = require("./catalog-cache.cjs");
const MANUAL_KEY = "apixlyMedia.apiKey";
const CONNECTION_KEY = "apixlyMedia.connectionToken";
const AUTH_MODE = "apixlyMedia.authMode";
const problem = (message) => Object.assign(new Error(message), { safe: true });

function createCredentialSession({
  context,
  accountClient = createAccountClient(),
  clientFactory = (key, options) => createClient(key, undefined, options),
}) {
  let metadata;
  let accountError;
  let keys = [];
  let loading;
  let active = 0;
  let mutating = false;
  let attempt;
  let epoch = 0;
  const listeners = new Set();
  const mode = () =>
    context.globalState.get(AUTH_MODE) === "account" ? "account" : "manual";
  const changed = () => {
    for (const listener of listeners)
      Promise.resolve()
        .then(listener)
        .catch(() => undefined);
  };
  async function mutation(work) {
    if (active || mutating)
      throw problem(
        "Stop waiting for the current task or account connection before changing credentials.",
      );
    mutating = true;
    try {
      return await work();
    } finally {
      mutating = false;
      changed();
    }
  }
  async function loadAccount(token, force = false) {
    if (loading) return loading;
    if (metadata && !force) return metadata;
    const current = epoch;
    loading = (async () => {
      let next;
      try {
        next = await accountClient.account(token);
      } catch (error) {
        if (current !== epoch || mode() !== "account")
          throw problem("The active account changed. Try again.");
        accountError = error.safe
          ? error
          : problem("Could not refresh your account. Try again explicitly.");
        if (
          ["selected_key_unavailable", "selected_key_rejected"].includes(
            error.code,
          )
        ) {
          const listed = await accountClient.keys(token);
          if (current === epoch) keys = listed.data;
        } else if (error.code === "unauthorized") {
          metadata = undefined;
          keys = [];
        }
        throw accountError;
      }
      const listed = await accountClient.keys(token);
      if (current !== epoch || mode() !== "account")
        throw problem(
          "The active account changed. Try again with the selected account.",
        );
      if (
        next.selection_revision !== listed.selection_revision ||
        String(next.selected_key.id) !== String(listed.selected_key_id)
      )
        throw problem(
          "The selected API Key changed during refresh. Refresh your account again.",
        );
      metadata = next;
      keys = listed.data;
      accountError = undefined;
      return metadata;
    })()
      .catch((error) => {
        if (current !== epoch)
          throw problem("The active account changed. Try again.");
        accountError = error.safe
          ? error
          : problem("Could not refresh your account. Try again explicitly.");
        throw accountError;
      })
      .finally(() => {
        loading = undefined;
      });
    return loading;
  }
  const session = {
    subscribe(listener) {
      listeners.add(listener);
      return { dispose: () => listeners.delete(listener) };
    },
    hold() {
      if (mutating)
        throw problem(
          "Finish or cancel the account connection before starting a task.",
        );
      active++;
      let released = false;
      return () => {
        if (!released) {
          released = true;
          active--;
          changed();
        }
      };
    },
    async view({ refresh = false } = {}) {
      const current = mode();
      const currentEpoch = epoch;
      const credential = await context.secrets.get(
        current === "account" ? CONNECTION_KEY : MANUAL_KEY,
      );
      if (current === "account" && credential && refresh)
        await loadAccount(credential, true).catch(() => undefined);
      if (currentEpoch !== epoch || current !== mode())
        return session.view({ refresh });
      return {
        mode: current,
        hasCredential: Boolean(
          credential && !(current === "account" && accountError),
        ),
        hasConnection: Boolean(current === "account" && credential),
        error: current === "account" ? (accountError?.message ?? null) : null,
        account: current === "account" ? (metadata ?? null) : null,
        keys: current === "account" ? keys : [],
        busy: Boolean(active || mutating),
        connecting: Boolean(attempt),
      };
    },
    async resolve({ refreshAccount = false } = {}) {
      const current = mode();
      const currentEpoch = epoch;
      const credential = await context.secrets.get(
        current === "account" ? CONNECTION_KEY : MANUAL_KEY,
      );
      if (currentEpoch !== epoch || current !== mode())
        throw problem("The active credentials changed. Try again.");
      if (!credential)
        throw problem(
          current === "account"
            ? "Connect your Apixly account to continue, or explicitly choose manual API key mode."
            : "Connect an Apixly account or set a manual API key first.",
        );
      const account =
        current === "account"
          ? await loadAccount(credential, refreshAccount)
          : undefined;
      if (current === "account" && accountError) throw accountError;
      if (currentEpoch !== epoch || current !== mode())
        throw problem("The active credentials changed. Try again.");
      return {
        client: clientFactory(credential, { mode: current }),
        identity:
          current === "account"
            ? catalogIdentity({
                mode: "account",
                connectionId: account.connection_id,
                accountId: account.account.id,
                keyId: account.selected_key.id,
                revision: account.selection_revision,
              })
            : catalogIdentity({ mode: "manual", key: credential }),
      };
    },
    async connect({ openExternal, onPending = () => undefined } = {}) {
      return mutation(async () => {
        const controller = new AbortController();
        attempt = controller;
        let flow;
        try {
          flow = await accountClient.begin(controller.signal);
          if (controller.signal.aborted)
            throw problem("Account connection cancelled.");
          await onPending(flow);
          if (
            typeof openExternal !== "function" ||
            (await openExternal(flow.verificationUri)) === false
          )
            throw problem(
              "Open the Apixly authorization link in your browser, then connect again.",
            );
          const grant = await accountClient.poll(flow, {
            signal: controller.signal,
          });
          if (controller.signal.aborted) {
            await accountClient.disconnect(grant.token).catch(() => undefined);
            throw problem("Account connection cancelled.");
          }
          const previous = await context.secrets.get(CONNECTION_KEY);
          if (previous && previous !== grant.token) {
            try {
              await accountClient.disconnect(previous);
            } catch (error) {
              if (error.code !== "unauthorized") {
                await accountClient
                  .disconnect(grant.token)
                  .catch(() => undefined);
                throw problem(
                  "Could not replace the previous connection. Reconnect again explicitly.",
                );
              }
            }
          }
          epoch++;
          metadata = grant.metadata;
          accountError = undefined;
          keys = [];
          await context.secrets.store(CONNECTION_KEY, grant.token);
          await context.globalState.update(AUTH_MODE, "account");
          // The returned grant is already authoritative; fetch only safe Key metadata.
          const listed = await accountClient.keys(grant.token);
          if (listed.selection_revision === metadata.selection_revision)
            keys = listed.data;
          return await session.view();
        } finally {
          if (flow) accountClient.cancel(flow);
          attempt = undefined;
        }
      });
    },
    cancelConnect() {
      attempt?.abort();
    },
    async refresh() {
      if (mode() === "account") {
        const token = await context.secrets.get(CONNECTION_KEY);
        if (!token) throw problem("Connect your Apixly account to continue.");
        await loadAccount(token, true);
      }
      changed();
      return session.view();
    },
    async selectKey(id) {
      return mutation(async () => {
        if (mode() !== "account")
          throw problem(
            "Connect your Apixly account before choosing an account Key.",
          );
        const token = await context.secrets.get(CONNECTION_KEY);
        if (!token) throw problem("Connect your Apixly account to continue.");
        const next = await accountClient.selectKey(token, id);
        epoch++;
        metadata = next;
        accountError = undefined;
        const listed = await accountClient.keys(token);
        keys =
          listed.selection_revision === next.selection_revision
            ? listed.data
            : [];
        return session.view();
      });
    },
    async disconnect() {
      return mutation(async () => {
        const token = await context.secrets.get(CONNECTION_KEY);
        if (token) {
          try {
            await accountClient.disconnect(token);
          } catch (error) {
            if (error.code !== "unauthorized") throw error;
          }
        }
        epoch++;
        metadata = undefined;
        accountError = undefined;
        keys = [];
        await context.secrets.delete(CONNECTION_KEY);
        // Retain account mode: disconnect never selects a saved manual key implicitly.
        await context.globalState.update(AUTH_MODE, "account");
      });
    },
    async setManual(key) {
      return mutation(async () => {
        if (typeof key !== "string" || !key.trim() || /[\r\n]/.test(key))
          throw problem("Enter a valid Apixly API key.");
        await context.secrets.store(MANUAL_KEY, key.trim());
        epoch++;
        metadata = undefined;
        accountError = undefined;
        keys = [];
        await context.globalState.update(AUTH_MODE, "manual");
      });
    },
    async useManual() {
      return mutation(async () => {
        epoch++;
        metadata = undefined;
        accountError = undefined;
        keys = [];
        await context.globalState.update(AUTH_MODE, "manual");
      });
    },
    async clearManual() {
      return mutation(async () => {
        epoch++;
        await context.secrets.delete(MANUAL_KEY);
      });
    },
    dispose() {
      epoch++;
      attempt?.abort();
      listeners.clear();
      metadata = undefined;
      keys = [];
    },
  };
  return session;
}

module.exports = {
  createCredentialSession,
  CONNECTION_KEY,
  AUTH_MODE,
  MANUAL_KEY,
};
