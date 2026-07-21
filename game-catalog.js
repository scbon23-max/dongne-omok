window.GameCatalog = (function () {
  "use strict";

  // Add new games here first, then wire a family-specific controller in game.js.
  var defs = {
    omok: {
      id: "omok",
      family: "omok",
      name: "오목",
      rankName: "오목 랭킹",
      rankable: true,
      screenId: "game",
      roomStripId: "room-strip-omok",
      chatLogId: "chat-log",
      chatInputId: "chat-input",
      chatOverlayId: "chat-overlay",
      onlineListId: "online-list",
      onlineNumId: "online-num",
      onlineTotalId: "online-total"
    },
    alk: {
      id: "alk",
      family: "alk",
      name: "알까기",
      rankName: "알까기 랭킹",
      rankable: true,
      screenId: "alkgame",
      roomStripId: "room-strip-alk",
      chatLogId: "alk-chat-log",
      chatInputId: "alk-chat-input",
      chatOverlayId: "alk-chat-overlay",
      onlineListId: "alk-online-list",
      onlineNumId: "alk-online-num",
      onlineTotalId: "alk-online-total"
    },
    alk_terr: {
      id: "alk_terr",
      family: "alk",
      name: "점령전",
      rankName: "점령전 랭킹",
      rankable: true,
      screenId: "alkgame",
      roomStripId: "room-strip-alk",
      chatLogId: "alk-chat-log",
      chatInputId: "alk-chat-input",
      chatOverlayId: "alk-chat-overlay",
      onlineListId: "alk-online-list",
      onlineNumId: "alk-online-num",
      onlineTotalId: "alk-online-total"
    },
    catchmind: {
      id: "catchmind",
      family: "catchmind",
      name: "캐치마인드",
      rankName: "캐치마인드 랭킹",
      rankable: true,
      controller: "CatchMind",
      screenId: "catchgame",
      roomStripId: "room-strip-catchmind",
      chatLogId: null,
      chatInputId: "catch-chat-input",
      chatOverlayId: "catch-chat-overlay",
      onlineListId: null,
      onlineNumId: "catch-online-num",
      onlineTotalId: null
    },
    relay: {
      id: "relay",
      family: "relay",
      name: "이어그리기",
      rankName: "이어그리기",
      rankable: false,
      controller: "RelayDrawing",
      screenId: "relaygame",
      roomStripId: "room-strip-relay",
      chatLogId: null,
      chatInputId: "relay-chat-input",
      chatOverlayId: "relay-chat-overlay",
      onlineListId: null,
      onlineNumId: "relay-online-num",
      onlineTotalId: null
    },
    territory: {
      id: "territory",
      family: "territory",
      name: "영역 넓히기",
      rankName: "영역 넓히기",
      rankable: false,
      controller: "TerritoryRush",
      screenId: "territorygame",
      roomStripId: "room-strip-territory",
      chatLogId: null,
      chatInputId: null,
      chatOverlayId: null,
      onlineListId: null,
      onlineNumId: "territory-people-count",
      onlineTotalId: null
    }
  };

  var order = ["omok", "alk", "alk_terr", "catchmind", "relay", "territory"];

  function get(id) {
    return defs[id] || null;
  }

  function family(id) {
    var def = get(id);
    return def ? def.family : id;
  }

  function name(id) {
    var def = get(id);
    return def ? def.name : id;
  }

  function rankName(id) {
    var def = get(id);
    return def ? def.rankName : name(id) + " 랭킹";
  }

  function rankableIds() {
    return order.filter(function (id) { return defs[id] && defs[id].rankable; });
  }

  function all() {
    return order.map(get).filter(Boolean);
  }

  function families() {
    var seen = {};
    return order.map(family).filter(function (f) {
      if (seen[f]) return false;
      seen[f] = true;
      return true;
    });
  }

  return {
    get: get,
    family: family,
    name: name,
    rankName: rankName,
    rankableIds: rankableIds,
    all: all,
    families: families,
    order: order.slice()
  };
})();
