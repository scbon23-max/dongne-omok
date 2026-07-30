"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function fakeClassList(initial = []) {
  const values = new Set(initial);
  return {
    add(...names) {
      names.forEach((name) => values.add(name));
    },
    remove(...names) {
      names.forEach((name) => values.delete(name));
    },
    toggle(name, force) {
      const enabled = force === undefined ? !values.has(name) : !!force;
      if (enabled) values.add(name);
      else values.delete(name);
      return enabled;
    },
    contains(name) {
      return values.has(name);
    },
  };
}

function fakeElement(id = "") {
  let html = "";
  const element = {
    id,
    dataset: {},
    classList: fakeClassList(),
    attributes: {},
    children: [],
    parentNode: null,
    scrollTop: 0,
    clientHeight: 80,
    value: "",
    style: {
      values: {},
      setProperty(name, value) {
        this.values[name] = value;
      },
    },
    appendChild(child) {
      child.parentNode = this;
      this.children.push(child);
      return child;
    },
    removeChild(child) {
      const index = this.children.indexOf(child);
      if (index >= 0) this.children.splice(index, 1);
      child.parentNode = null;
      return child;
    },
    setAttribute(name, value) {
      this.attributes[name] = String(value);
    },
    querySelector() {
      return null;
    },
    querySelectorAll() {
      return [];
    },
    setSelectionRange() {},
  };
  Object.defineProperty(element, "innerHTML", {
    get() {
      return html;
    },
    set(value) {
      html = String(value);
      if (value === "") {
        element.children.forEach((child) => {
          child.parentNode = null;
        });
        element.children = [];
      }
    },
  });
  Object.defineProperty(element, "scrollHeight", {
    get() {
      return element.children.length * 24;
    },
  });
  return element;
}

function loadGameChatHarness(options = {}) {
  const sourcePath = path.join(__dirname, "..", "game.js");
  const source = fs.readFileSync(sourcePath, "utf8");
  const instrumented = source.replace(
    /\}\)\(\);\s*$/,
    `window.__holdemChatAudit = {
      setRoom: function (roomId) {
        curRoomId = roomId;
        curRoomGame = "holdem";
        curGame = "holdem";
      },
      setSession: function (rows) { sessionChat = rows.slice(); },
      getSession: function () { return sessionChat.slice(); },
      renderHistory: renderHoldemChatHistory,
      setFocus: setHoldemChatFocusState,
      pushToast: function (nick, message) {
        pushOverlayToast("holdem", nick, message, "", document.getElementById("holdem-chat-overlay"));
      },
      sendText: function (message, options) {
        return sendChatText("holdem", message, options);
      },
      loadHistory: loadChatHistory,
      resetRoomChat: resetRoomChat
    };
  })();`
  );
  assert.notEqual(instrumented, source, "game.js test hook injection failed");

  const elements = {
    holdemgame: fakeElement("holdemgame"),
    "holdem-chat-overlay": fakeElement("holdem-chat-overlay"),
    "holdem-chat-history": fakeElement("holdem-chat-history"),
    "holdem-chat-input": fakeElement("holdem-chat-input"),
  };
  const document = {
    readyState: "loading",
    activeElement: null,
    documentElement: { clientHeight: 800 },
    body: fakeElement("body"),
    getElementById(id) {
      return elements[id] || null;
    },
    createElement() {
      return fakeElement();
    },
    addEventListener() {},
    removeEventListener() {},
    querySelectorAll() {
      return [];
    },
  };
  const GameCatalog = {
    families() {
      return ["holdem"];
    },
    family(id) {
      return String(id || "").startsWith("holdem") ? "holdem" : id;
    },
    get(id) {
      return {
        id,
        family: "holdem",
        chatLogId: null,
        chatInputId: "holdem-chat-input",
        chatOverlayId: "holdem-chat-overlay",
      };
    },
    all() {
      return [];
    },
    rankableIds() {
      return [];
    },
  };
  const window = {
    GameCatalog,
    Db: options.db || null,
    document,
    addEventListener() {},
    removeEventListener() {},
  };
  const context = {
    window,
    document,
    GameCatalog,
    Db: options.db || null,
    Renju: {
      SIZE: 15,
      BLACK: 1,
      WHITE: 2,
      emptyBoard() {
        return [];
      },
    },
    console,
    Date,
    Math,
    Number,
    Object,
    Array,
    String,
    RegExp,
    JSON,
    Promise,
    Intl,
    URLSearchParams,
    setTimeout() {
      return 1;
    },
    clearTimeout() {},
    setInterval() {
      return 1;
    },
    clearInterval() {},
    localStorage: {
      getItem() {
        return null;
      },
      setItem() {},
    },
    navigator: { userAgent: "" },
    location: { search: "", href: "" },
  };
  vm.createContext(context);
  vm.runInContext(instrumented, context, { filename: "game.js" });
  return {
    audit: window.__holdemChatAudit,
    document,
    elements,
  };
}

function loadKeyboardHarness(options = {}) {
  const sourcePath = path.join(__dirname, "..", "holdem.js");
  const source = fs.readFileSync(sourcePath, "utf8");
  const instrumented = source.replace(
    "setHasSnapshot: function (value) { hasSnapshot = !!value; },",
    `setHasSnapshot: function (value) { hasSnapshot = !!value; },
      setChatOpen: setChatOpen,
      submitChatFromEnter: submitChatFromEnter,
      syncChatKeyboard: syncHoldemChatKeyboard,
      getChatKeyboardWasOpen: function () { return chatKeyboardWasOpen; },`
  );
  assert.notEqual(instrumented, source, "holdem.js test hook injection failed");

  let timerId = 0;
  const timers = new Map();
  function setTimeoutStub(callback, delay) {
    timerId += 1;
    timers.set(timerId, { callback, delay });
    return timerId;
  }
  function clearTimeoutStub(id) {
    timers.delete(id);
  }
  function flushTimers() {
    const pending = Array.from(timers.entries()).sort((left, right) => {
      return left[1].delay - right[1].delay || left[0] - right[0];
    });
    timers.clear();
    pending.forEach((entry) => entry[1].callback());
  }

  const elements = {
    holdemgame: fakeElement("holdemgame"),
    "holdem-chat-input": fakeElement("holdem-chat-input"),
    "holdem-chat-toggle": fakeElement("holdem-chat-toggle"),
    "holdem-chat-history": fakeElement("holdem-chat-history"),
  };
  const document = {
    activeElement: null,
    documentElement: { clientHeight: 800 },
    getElementById(id) {
      return elements[id] || null;
    },
    createElement() {
      return fakeElement();
    },
    addEventListener() {},
    removeEventListener() {},
  };
  elements["holdem-chat-input"].focus = function () {
    document.activeElement = this;
  };
  elements["holdem-chat-input"].blur = function () {
    if (document.activeElement === this) document.activeElement = null;
  };

  const visualViewport = {
    height: Number.isFinite(options.visualViewportHeight) ? options.visualViewportHeight : 500,
    offsetTop: 0,
    scale: Number.isFinite(options.scale) ? options.scale : 1,
    addEventListener() {},
    removeEventListener() {},
  };
  const window = {
    __HOLDEM_TEST__: true,
    document,
    innerWidth: Number.isFinite(options.innerWidth) ? options.innerWidth : 390,
    innerHeight: 800,
    visualViewport,
    matchMedia() {
      return { matches: !!options.desktopPointer };
    },
  };
  const context = {
    window,
    document,
    console,
    Date,
    Math,
    Number,
    Object,
    Array,
    String,
    RegExp,
    JSON,
    Promise,
    Intl,
    setTimeout: setTimeoutStub,
    clearTimeout: clearTimeoutStub,
    setInterval() {
      return 1;
    },
    clearInterval() {},
    requestAnimationFrame(callback) {
      callback();
    },
  };
  vm.createContext(context);
  vm.runInContext(instrumented, context, { filename: "holdem.js" });
  return {
    api: window.TexasHoldem._test,
    elements,
    visualViewport,
    flushTimers,
  };
}

test("opening and closing chat cannot turn history lines into toast lines", () => {
  const { audit, document, elements } = loadGameChatHarness();
  audit.setRoom("room-a");
  audit.setSession(
    Array.from({ length: 8 }, (_, index) => ({
      game: "holdem",
      who: "player-" + index,
      text: "message-" + index,
    }))
  );
  elements["holdem-chat-overlay"].appendChild(fakeElement("existing-toast"));

  document.activeElement = elements["holdem-chat-input"];
  audit.setFocus(true);

  assert.equal(elements["holdem-chat-overlay"].children.length, 0);
  assert.equal(elements["holdem-chat-history"].children.length, 5);
  assert.equal(elements.holdemgame.classList.contains("is-chat-focused"), true);

  document.activeElement = null;
  audit.setFocus(false);

  assert.equal(elements["holdem-chat-history"].children.length, 0);
  assert.equal(elements["holdem-chat-overlay"].children.length, 0);
  assert.equal(elements.holdemgame.classList.contains("is-chat-focused"), false);

  audit.pushToast("me", "sent");
  assert.equal(elements["holdem-chat-overlay"].children.length, 1);
  assert.equal(elements["holdem-chat-history"].children.length, 0);
});

test("the send button path creates exactly one local toast", () => {
  const { audit, elements } = loadGameChatHarness();
  audit.setRoom("room-a");

  assert.equal(audit.sendText("sent once", { suppressOverlay: true }), true);
  assert.equal(elements["holdem-chat-overlay"].children.length, 0);
  assert.equal(audit.getSession().length, 1);

  audit.pushToast("me", "sent once");
  assert.equal(elements["holdem-chat-overlay"].children.length, 1);
});

test("a stale room history response cannot populate the next room", async () => {
  let resolveHistory;
  const db = {
    getChatHistory() {
      return new Promise((resolve) => {
        resolveHistory = resolve;
      });
    },
  };
  const { audit } = loadGameChatHarness({ db });
  audit.setRoom("room-a");
  audit.loadHistory();
  audit.setRoom("room-b");
  audit.resetRoomChat();

  resolveHistory([{ nick: "old-room", text: "stale", created_at: "2026-07-30T00:00:00Z" }]);
  await Promise.resolve();
  await Promise.resolve();

  assert.equal(audit.getSession().length, 0);
});

test("a transient keyboard height drop does not close chat", () => {
  const { api, elements, visualViewport, flushTimers } = loadKeyboardHarness();
  api.setChatOpen(true, false);
  api.syncChatKeyboard(false);
  assert.equal(elements.holdemgame.classList.contains("is-chat-open"), true);
  assert.equal(api.getChatKeyboardWasOpen(), true);

  visualViewport.height = 800;
  api.syncChatKeyboard(true);
  assert.equal(elements.holdemgame.classList.contains("is-chat-open"), true);

  visualViewport.height = 500;
  api.syncChatKeyboard(true);
  flushTimers();
  assert.equal(elements.holdemgame.classList.contains("is-chat-open"), true);
});

test("a settled keyboard close still hides the chat", () => {
  const { api, elements, visualViewport, flushTimers } = loadKeyboardHarness();
  api.setChatOpen(true, false);
  api.syncChatKeyboard(false);

  visualViewport.height = 800;
  api.syncChatKeyboard(true);
  assert.equal(elements.holdemgame.classList.contains("is-chat-open"), true);

  flushTimers();
  assert.equal(elements.holdemgame.classList.contains("is-chat-open"), false);
  assert.equal(elements.holdemgame.style.values["--holdem-keyboard-offset"], "0px");
});

test("pressing Enter on an empty Hold'em chat input closes it", () => {
  const { api, elements } = loadKeyboardHarness();
  elements["holdem-chat-input"].value = "   ";
  api.setChatOpen(true, true);

  api.submitChatFromEnter();

  assert.equal(elements.holdemgame.classList.contains("is-chat-open"), false);
});

test("desktop viewport changes and page zoom never impersonate a mobile keyboard", () => {
  const desktop = loadKeyboardHarness({
    innerWidth: 1280,
    desktopPointer: true,
  });
  desktop.api.setChatOpen(true, false);
  desktop.api.syncChatKeyboard(false);
  assert.equal(desktop.elements.holdemgame.style.values["--holdem-keyboard-offset"], "0px");
  assert.equal(desktop.elements.holdemgame.classList.contains("is-keyboard-open"), false);
  assert.equal(desktop.api.getChatKeyboardWasOpen(), false);

  const zoomed = loadKeyboardHarness({
    innerWidth: 390,
    scale: 1.25,
  });
  zoomed.api.setChatOpen(true, false);
  zoomed.api.syncChatKeyboard(false);
  assert.equal(zoomed.elements.holdemgame.style.values["--holdem-keyboard-offset"], "0px");
  assert.equal(zoomed.elements.holdemgame.classList.contains("is-keyboard-open"), false);
  assert.equal(zoomed.api.getChatKeyboardWasOpen(), false);
});
