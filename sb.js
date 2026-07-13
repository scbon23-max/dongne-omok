window.SB = (function () {
  "use strict";
  var c = window.OMOK_CONFIG || {};
  if (c.SUPABASE_URL && c.SUPABASE_ANON_KEY && window.supabase) {
    return window.supabase.createClient(c.SUPABASE_URL, c.SUPABASE_ANON_KEY, {
      realtime: { params: { eventsPerSecond: 20 } }
    });
  }
  return null;
})();
