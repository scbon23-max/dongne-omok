window.SB = (function () {
  "use strict";
  var c = window.OMOK_CONFIG || {};
  if (c.SUPABASE_URL && c.SUPABASE_ANON_KEY && window.supabase) {
    var realtimeDebug = /(?:^|[?&])realtimeDebug=1(?:&|$)/.test(window.location.search || "");
    var params = { eventsPerSecond: 20 };
    var client = null;

    if (realtimeDebug) params.log_level = "info";

    function reportHeartbeat(status, latency) {
      var detail = {
        status: String(status || "unknown"),
        latency: Number.isFinite(Number(latency)) ? Math.max(0, Math.round(Number(latency))) : null,
        at: Date.now()
      };
      window.DONGNE_REALTIME_HEALTH = detail;
      try {
        window.dispatchEvent(new CustomEvent("dongne-realtime-heartbeat", { detail: detail }));
      } catch (e) {}

      if (detail.status === "disconnected" && client && client.realtime &&
          typeof client.realtime.connect === "function") {
        setTimeout(function () {
          try {
            if (!client.realtime.getChannels || client.realtime.getChannels().length) {
              client.realtime.connect();
            }
          } catch (e) {}
        }, 0);
      }
    }

    var realtimeOptions = {
      params: params,
      worker: true,
      heartbeatCallback: reportHeartbeat
    };
    if (realtimeDebug) {
      realtimeOptions.logLevel = "info";
      realtimeOptions.logger = function (kind, message, data) {
        if (window.console && console.info) console.info("[realtime:" + kind + "] " + message, data);
      };
    }

    client = window.supabase.createClient(c.SUPABASE_URL, c.SUPABASE_ANON_KEY, {
      realtime: realtimeOptions
    });
    return client;
  }
  return null;
})();
