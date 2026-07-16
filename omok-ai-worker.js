"use strict";

self.window = self;
importScripts("renju.js", "omok-ai.js", "omok-ai-v2.js?v=ai-promoted-v1-20260716");

self.onmessage = function (event) {
  var data = event.data || {};
  try {
    var move = self.OmokAI.bestMove(data.board, data.color, data.level, data.options || {});
    self.postMessage({
      id: data.id,
      move: move,
      stats: self.OmokAI.getLastStats ? self.OmokAI.getLastStats() : null
    });
  } catch (error) {
    self.postMessage({
      id: data.id,
      move: null,
      error: error && error.message ? error.message : String(error)
    });
  }
};
