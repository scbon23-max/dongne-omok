/* Unified member management. Account and invitation storage remain independent. */
window.MemberAdmin = (function () {
  "use strict";
  var members = [], filter = "all", busy = false, ready = false, pending = null, db, notify;
  function el(id) { return document.getElementById(id); }
  function status(message, error) {
    el("admin-status").textContent = message;
    el("admin-status").classList.toggle("is-error", !!error);
  }
  function lock(value) {
    busy = value;
    el("admin-modal").querySelectorAll("[data-member-control]").forEach(function (button) { button.disabled = value; });
  }
  function cancel() {
    pending = null;
    el("admin-confirm").classList.add("hidden");
  }
  function button(label, action, member, danger) {
    var node = document.createElement("button");
    node.type = "button";
    node.className = "pbtn" + (danger ? " danger" : "");
    node.textContent = label;
    node.setAttribute("data-member-control", "");
    node.setAttribute("aria-label", member.nickname + " " + label);
    node.disabled = busy;
    node.addEventListener("click", function () {
      if (busy) return;
      pending = { action: action, member: member };
      el("admin-confirm-text").textContent = action === "reset"
        ? member.nickname + "님의 비번을 초기화합니다. 다음에 입력하는 비번이 새 비번이 됩니다."
        : member.registered
          ? member.nickname + "님의 계정과 가입 허용을 함께 삭제합니다. 다시 가입하려면 관리자가 닉네임을 추가해야 합니다."
          : member.nickname + "님을 가입 허용 명단에서 제외합니다.";
      el("admin-confirm-submit").textContent = action === "reset" ? "비번 초기화" : member.registered ? "회원 삭제" : "명단에서 제외";
      el("admin-confirm").classList.remove("hidden");
      el("admin-confirm-cancel").focus();
      el("admin-confirm").scrollIntoView({ block: "nearest" });
    });
    return node;
  }
  function render() {
    var query = el("admin-search").value.trim().toLocaleLowerCase("ko");
    var rows = members.filter(function (m) {
      return (filter === "all" || (filter === "joined" ? m.registered : !m.registered))
        && m.nickname.toLocaleLowerCase("ko").indexOf(query) !== -1;
    });
    var joined = members.filter(function (m) { return m.registered; }).length;
    el("admin-filters").querySelectorAll("[data-member-filter]").forEach(function (node) {
      var value = node.getAttribute("data-member-filter");
      node.textContent = value === "all" ? "전체 " + members.length : value === "joined" ? "가입 완료 " + joined : "가입 전 " + (members.length - joined);
      node.classList.toggle("active", value === filter);
      node.setAttribute("aria-pressed", String(value === filter));
    });
    var box = el("admin-list");
    box.replaceChildren();
    rows.forEach(function (m) {
      var row = document.createElement("div"), info = document.createElement("div"), name = document.createElement("strong"), tags = document.createElement("div");
      row.className = "admin-member-row";
      info.className = "admin-member-info";
      name.textContent = m.nickname;
      tags.className = "admin-member-tags";
      var badge = document.createElement("span");
      badge.className = "admin-member-badge" + (m.registered ? " joined" : "");
      badge.textContent = m.is_admin ? "관리자" : m.registered ? "가입 완료" : "가입 전";
      tags.appendChild(badge);
      if (m.needsPw && m.registered) {
        var reset = document.createElement("span");
        reset.className = "mini-reset";
        reset.textContent = "비번 설정 대기";
        tags.appendChild(reset);
      }
      info.append(name, tags);
      row.appendChild(info);
      if (!m.is_admin) {
        var actions = document.createElement("div");
        actions.className = "admin-member-actions";
        if (m.registered) actions.appendChild(button("비번 초기화", "reset", m, false));
        actions.appendChild(button(m.registered ? "회원 삭제" : "명단에서 제외", "delete", m, true));
        row.appendChild(actions);
      }
      box.appendChild(row);
    });
    if (!rows.length) {
      var empty = document.createElement("p");
      empty.className = "players-hint";
      empty.textContent = query ? "검색 결과가 없어요." : "해당하는 회원이 없어요.";
      box.appendChild(empty);
    }
  }
  async function refresh() {
    lock(true);
    try {
      members = await db.listMembers();
      render();
    } catch (e) {
      status("회원 목록을 불러오지 못했어요. 새로고침을 눌러 다시 확인해 주세요.", true);
    } finally { lock(false); }
  }
  async function submit() {
    if (busy || !pending) return;
    var task = pending;
    lock(true);
    status("처리 중…");
    try {
      var result = task.action === "reset" ? await db.clearPassword(task.member.nickname) : await db.deleteMember(task.member.nickname);
      if (!result || result.error) throw new Error(result && result.message || "처리하지 못했어요. 다시 시도해 주세요.");
      var message = task.member.nickname + (task.action === "reset" ? " 비번이 초기화됐어요." : task.member.registered ? " 계정과 가입 허용을 삭제했어요." : " 가입 허용 명단에서 제외했어요.");
      cancel();
      status(message);
      notify(message);
      await refresh();
    } catch (e) {
      status(e.message || "처리하지 못했어요. 다시 시도해 주세요.", true);
    } finally { lock(false); }
  }
  async function add() {
    if (busy) return;
    var input = el("allow-input"), nick = input.value.trim();
    if (!nick) { input.focus(); return; }
    if (members.some(function (m) { return m.nickname === nick; })) {
      status("이미 목록에 있는 닉네임이에요. 검색해서 확인해 주세요.", true);
      return;
    }
    cancel();
    lock(true);
    try {
      var result = await db.addAllowed(nick);
      if (!result || result.error) throw new Error("추가하지 못했어요. 중복된 닉네임인지 확인하고 다시 시도해 주세요.");
      input.value = "";
      filter = "all";
      el("admin-search").value = "";
      status(nick + "님의 가입을 허용했어요.");
      await refresh();
    } catch (e) { status(e.message || "추가하지 못했어요. 다시 시도해 주세요.", true); }
    finally { lock(false); }
  }
  function init(options) {
    if (ready) return;
    db = options.db;
    notify = options.toast;
    el("allow-add-btn").addEventListener("click", add);
    el("allow-input").addEventListener("keydown", function (event) {
      if (event.key === "Enter" && !event.isComposing) { event.preventDefault(); add(); }
    });
    el("admin-search").addEventListener("input", function () { cancel(); render(); });
    el("admin-filters").querySelectorAll("[data-member-filter]").forEach(function (node) {
      node.addEventListener("click", function () { cancel(); filter = node.getAttribute("data-member-filter"); render(); });
    });
    el("admin-refresh").addEventListener("click", function () { if (!busy) { cancel(); status(""); refresh(); } });
    el("admin-confirm-cancel").addEventListener("click", cancel);
    el("admin-confirm-submit").addEventListener("click", submit);
    ready = true;
  }
  async function open(options) {
    init(options);
    el("admin-modal").classList.remove("hidden");
    if (busy) return;
    cancel();
    status("불러오는 중…");
    await refresh();
    if (el("admin-status").textContent === "불러오는 중…") status("");
  }
  return { open: open };
})();
