window.MemberAccessWatch = (function () {
  "use strict";
  var generation = 0, timer = null, onFocus = null;
  function stop() {
    generation++;
    if (timer !== null) window.clearInterval(timer);
    if (onFocus) window.removeEventListener("focus", onFocus);
    timer = null; onFocus = null;
  }
  function start(nick, read, leave) {
    stop();
    var current = generation, busy = false, last = 0;
    async function check() {
      if (busy || current !== generation || Date.now() - last < 10000) return;
      busy = true; last = Date.now();
      try {
        var result = await read(nick);
        if (current === generation && result && result.known === true && result.departed === true) {
          stop();
          await leave();
        }
      } catch (e) {
        // An unavailable membership source is not evidence of departure.
      } finally { busy = false; }
    }
    timer = window.setInterval(check, 60000);
    onFocus = check;
    window.addEventListener("focus", onFocus);
    check();
  }
  return { start: start, stop: stop };
})();
