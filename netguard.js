/* ══════════════════════════════════════════════════════════════════════
   netguard.js — 연결 진단 + «접속할 수 없습니다» 안내 (2026-10-15, 양호창님 지시)
   「3개 앱 모두 행정망이나 제한된 환경에서 실행이 안 될 수 있잖아. 그럴 경우 안내 문구가 나와 줘야 할 것 같아.」

   ⭐ 세 앱 공통 — 시민앱(모바일웹/)·공무원앱(cloudui/)은 이 파일을 «글자 단위로 같게» 둔다.
      PC앱(webui/)도 같은 문구를 쓴다. 문구를 바꾸면 세 곳을 함께 바꾼다.
      앱마다 다른 값(앱 주소·QR 그림)은 <script data-app-url data-qr> 속성으로 받는다.

   무엇을 가르나
     (a) offline — 인터넷 자체가 끊김(navigator.onLine === false)
     (b) blocked — 클라우드 서버(Supabase)나 접속 라이브러리(cdn.jsdelivr.net)에 닿지 않음 → 행정망 의심
     (c) json    — 정적 .json 만 막혀 data.js 사본으로 대신 읽음 → 작은 띠로만 알린다(이용 지장 없음)

   어떻게 아나
     ① 앱이 뜰 때 한 번, ② Supabase·Web3Forms 로 가는 fetch 가 «실패할 때»(아래 fetch 감시),
     ③ 문제가 있는 동안 20초마다·online 이벤트 때 다시 확인 → 정상이면 띠가 저절로 사라진다.
     확인 요청은 GET /auth/v1/health 하나뿐이다(6초 제한). ⛔ 서버에 «쓰는» 요청으로 진단하지 말 것.
     apikey 는 헤더가 아니라 쿼리로 보낸다 — 헤더를 붙이면 사전요청(OPTIONS)이 하나 더 생긴다.

   접근성
     · 제목 줄만 role="alert" — 상태가 «바뀔 때만» 다시 그리므로 낭독은 한 번뿐이다(같은 상태 재확인 시 그대로 둔다).
     · 다시 시도 결과·복사 결과는 role="status"(공손 낭독).
     · 색만으로 알리지 않는다 — 경고 삼각형 아이콘 + 2px 테두리 + 글자(규격서 §5 «위험» 3겹).
     · 단추 높이 44px 이상, Esc 로 접기, 펼치면 초점을 제목으로·접으면 «자세히»로 돌려 준다.
     · CSP style-src 'self' — 인라인 style 을 쓰지 않는다(모양은 style.css «연결 안내» 절).

   다른 코드에서 쓰는 법
     · 아무 오류 칸에 <button type="button" class="ng-more" data-ng-open>자세히</button> 를 넣으면
       이 파일이 문서 단위 클릭으로 받아 안내를 펼친다(따로 연결할 것 없음).
     · window.NetGuard.noteJsonFallback() — .json 대신 data.js 로 읽었을 때 부른다.
     · window.NetGuard.check() — 지금 상태를 다시 확인(Promise<"ok"|"offline"|"blocked">).
   ══════════════════════════════════════════════════════════════════════ */
(function () {
  "use strict";
  if (window.NetGuard) return;

  var SCRIPT = document.currentScript;
  var APP_URL = (SCRIPT && SCRIPT.getAttribute("data-app-url")) || (location.origin + location.pathname);
  var QR_SRC = (SCRIPT && SCRIPT.getAttribute("data-qr")) || "";

  // ── 문구(세 앱 공통 — 글자 하나도 다르게 두지 말 것) ──
  var T = {
    blockedTitle: "지금 이 네트워크에서는 플랫폼 서버에 접속할 수 없습니다",
    blockedBody: "행정망(업무망)이나 보안 프로그램이 클라우드 접속을 막고 있을 때 생깁니다. 앱 고장이 아닙니다.",
    offlineTitle: "인터넷에 연결되어 있지 않습니다",
    offlineBody: "와이파이나 모바일 데이터 연결을 확인해 주세요. 다시 연결되면 이 안내는 저절로 사라집니다.",
    howTitle: "이렇게 해 보세요",
    how1: "① 휴대폰이나 인터넷이 되는 PC로 열기(QR·주소 복사)",
    how2: "② 정보통신 담당 부서에 아래 주소 허용 요청",
    domainsSummary: "허용 요청 주소 보기",
    copyDomains: "주소 목록 복사",
    copyUrl: "이 화면 주소 복사",
    canTitle: "지금도 되는 일",
    canBody: "시민앱의 사업 목록·검색·상세 보기(앱에 들어 있는 자료)",
    cantTitle: "지금은 안 되는 일",
    cantBody: "신청 접수·정책제안·공감·로그인·접수 처리",
    retry: "다시 시도",
    more: "자세히",
    fold: "접기",
    checking: "확인하는 중입니다…",
    stillBad: "아직 접속할 수 없습니다. 잠시 후 다시 시도해 주세요.",
    recovered: "플랫폼 서버에 다시 연결되었습니다.",
    copiedDomains: "허용 요청 주소를 복사했습니다.",
    copiedUrl: "이 화면 주소를 복사했습니다.",
    copyFail: "복사하지 못했습니다. 글자를 길게 눌러 직접 복사해 주세요.",
    jsonNote: "일부 자료 파일이 막혀 앱에 들어 있는 사본으로 보여 드리고 있습니다. 이용에는 지장이 없습니다.",
    close: "닫기",
    qrAlt: "이 앱 주소 QR 코드 — 휴대폰 카메라로 비추면 열립니다"
  };
  // 앱마다 «되는 일/안 되는 일»이 다르다 — <script data-can data-cant> 로 덮어쓴다(파일은 두 앱 바이트 동일 유지).
  if (SCRIPT && SCRIPT.getAttribute("data-can")) T.canBody = SCRIPT.getAttribute("data-can");
  if (SCRIPT && SCRIPT.getAttribute("data-cant")) T.cantBody = SCRIPT.getAttribute("data-cant");
  var DOMAINS = [
    ["nalpuhtdruovzulcagtj.supabase.co", "HTTPS 443, wss 443"],
    ["cdn.jsdelivr.net", "HTTPS 443"],
    ["api.web3forms.com", "HTTPS 443"],
    ["hcyang572-gif.github.io", "HTTPS 443"]
  ];

  // ⚠ 공무원앱 config.js 는 «const SUPABASE_URL»(window 속성이 아님), 시민앱은 window.SUPABASE_URL — 둘 다 읽는다.
  /* global SUPABASE_URL, SUPABASE_ANON_KEY */
  var SUPA = String((typeof SUPABASE_URL !== "undefined" ? SUPABASE_URL : window.SUPABASE_URL) || "").replace(/\/+$/, "");
  var ANON = String((typeof SUPABASE_ANON_KEY !== "undefined" ? SUPABASE_ANON_KEY : window.SUPABASE_ANON_KEY) || "");
  var SUPA_HOST = "";
  try { SUPA_HOST = SUPA ? new URL(SUPA).host : ""; } catch (e) { SUPA_HOST = ""; }
  var WATCH_HOSTS = [SUPA_HOST, "api.web3forms.com"].filter(Boolean);

  var _fetch = window.fetch ? window.fetch.bind(window) : null;
  var state = "unknown";      // unknown | ok | offline | blocked
  var expanded = false;
  var jsonNote = false, jsonDismissed = false;
  var probing = null;
  var timer = 0;
  var wasBad = false;
  var lastProbeAt = 0;        // 마지막 진단을 «마친» 시각 — fetch 감시가 진단을 연달아 쏘지 않게 5초 간격을 둔다

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function hostOf(u) {
    try { return new URL(u, location.href).host; } catch (e) { return ""; }
  }
  function online() { return !(typeof navigator !== "undefined" && navigator.onLine === false); }
  function libOk() { return !!(window.supabase && typeof window.supabase.createClient === "function"); }

  // ── 진단(가벼운 GET 하나, 6초 제한) ──
  function probe() {
    if (!online()) return Promise.resolve("offline");
    if (!SUPA || !_fetch) return Promise.resolve(libOk() || !SUPA ? "ok" : "blocked");
    var ctl = (typeof AbortController === "function") ? new AbortController() : null;
    var to = setTimeout(function () { try { if (ctl) ctl.abort(); } catch (e) {} }, 6000);
    var key = ANON;
    var url = SUPA + "/auth/v1/health" + (key ? "?apikey=" + encodeURIComponent(key) : "");
    return _fetch(url, { method: "GET", cache: "no-store", credentials: "omit", signal: ctl ? ctl.signal : undefined })
      .then(function () { return libOk() ? "ok" : "blocked"; },   // 어떤 응답이든 왔으면 «닿았다»
            function () { return online() ? "blocked" : "offline"; })
      .then(function (r) { clearTimeout(to); return r; });
  }
  // force: «다시 시도»·online 이벤트처럼 사람이·브라우저가 직접 부른 경우(5초 간격 무시)
  function check(force) {
    if (probing) return probing;
    if (!force && state !== "unknown" && Date.now() - lastProbeAt < 5000) return Promise.resolve(state);
    probing = probe().then(function (r) { probing = null; lastProbeAt = Date.now(); setState(r); return r; },
                           function () { probing = null; lastProbeAt = Date.now(); return state; });
    return probing;
  }

  // ── fetch 감시 — 클라우드로 가는 요청이 «닿지 못하면» 진단을 돌린다 ──
  //    supabase-js 는 호출할 때마다 전역 fetch 를 찾으므로 여기서 감싸 두면 모두 지나간다.
  if (_fetch) {
    window.fetch = function (input, init) {
      var u = typeof input === "string" ? input : (input && input.url) || "";
      var watched = WATCH_HOSTS.indexOf(hostOf(u)) >= 0;
      var p = _fetch(input, init);
      if (!watched) return p;
      return p.then(function (res) {
        if (state === "blocked" || state === "offline") check();   // 되살아났는지 확인
        return res;
      }, function (err) {
        if (!(err && err.name === "AbortError")) check();
        throw err;
      });
    };
  }

  // ── 화면 ──
  var ICON_WARN = '<svg class="ng-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M10.3 3.9 2.4 17.6A2 2 0 0 0 4.1 20.6h15.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4.5M12 17h.01"/></svg>';
  var ICON_INFO = '<svg class="ng-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/></svg>';

  function root() {
    var el = document.getElementById("ngBanner");
    if (el) return el;
    el = document.createElement("section");
    el.id = "ngBanner";
    el.className = "ng-banner";
    el.setAttribute("aria-label", "연결 안내");
    el.hidden = true;
    (document.body || document.documentElement).appendChild(el);
    el.addEventListener("click", onClick);
    el.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && expanded) { e.preventDefault(); setExpanded(false, true); }
    });
    return el;
  }

  function panelHtml(bad) {
    var title = bad === "offline" ? T.offlineTitle : T.blockedTitle;
    var body = bad === "offline" ? T.offlineBody : T.blockedBody;
    var h = '<div class="ng-head">' + ICON_WARN +
      '<p class="ng-title" id="ngTitle" role="alert" tabindex="-1">' + esc(title) + '</p></div>' +
      '<div class="ng-acts">' +
        '<button type="button" class="ng-btn ng-retry" data-ng="retry">' + esc(T.retry) + '</button>' +
        '<button type="button" class="ng-btn ng-toggle" data-ng="toggle" aria-expanded="' + (expanded ? "true" : "false") +
          '" aria-controls="ngDetail">' + esc(expanded ? T.fold : T.more) + '</button>' +
      '</div>' +
      '<p class="ng-result" id="ngResult" role="status" aria-live="polite"></p>' +
      '<div class="ng-detail" id="ngDetail"' + (expanded ? "" : " hidden") + '>' +
        '<p class="ng-body">' + esc(body) + '</p>';
    if (bad !== "offline") {
      h += '<h2 class="ng-sub">' + esc(T.howTitle) + '</h2>' +
        '<p class="ng-li">' + esc(T.how1) + '</p>' +
        '<div class="ng-open">' +
          (QR_SRC ? '<img class="ng-qr" src="' + esc(QR_SRC) + '" alt="' + esc(T.qrAlt) + '" width="120" height="120">' : "") +
          '<div class="ng-open-r"><p class="ng-url">' + esc(APP_URL) + '</p>' +
          '<button type="button" class="ng-btn" data-ng="copy-url">' + esc(T.copyUrl) + '</button></div>' +
        '</div>' +
        '<p class="ng-li">' + esc(T.how2) + '</p>' +
        '<details class="ng-domains"><summary class="ng-summary">' + esc(T.domainsSummary) + '</summary>' +
          '<ul class="ng-dlist">' + DOMAINS.map(function (d) {
            return '<li><span class="ng-dom">' + esc(d[0]) + '</span> <span class="ng-port">(' + esc(d[1]) + ')</span></li>';
          }).join("") + '</ul>' +
          '<button type="button" class="ng-btn" data-ng="copy-domains">' + esc(T.copyDomains) + '</button>' +
        '</details>';
    }
    h += '<div class="ng-can"><h2 class="ng-sub">' + esc(T.canTitle) + '</h2><p class="ng-li">' + esc(T.canBody) + '</p></div>' +
      '<div class="ng-cant"><h2 class="ng-sub">' + esc(T.cantTitle) + '</h2><p class="ng-li">' + esc(T.cantBody) + '</p></div>' +
      '</div>';
    return h;
  }

  function render() {
    var el = root();
    var bad = (state === "offline" || state === "blocked") ? state : "";
    // 띠가 떠 있는 동안 본문 끝(신청 단추 등)이 띠에 가리지 않게 아래 여백을 준다(style.css body.ng-on).
    if (document.body) document.body.classList.toggle("ng-on", !!bad || (jsonNote && !jsonDismissed && online()));
    if (bad) {
      el.className = "ng-banner ng-bad" + (expanded ? " ng-expanded" : "");
      el.innerHTML = panelHtml(bad);
      el.hidden = false;
      return;
    }
    if (jsonNote && !jsonDismissed && online()) {
      el.className = "ng-banner ng-note";
      el.innerHTML = '<div class="ng-head">' + ICON_INFO +
        '<p class="ng-title ng-note-t" role="status">' + esc(T.jsonNote) + '</p></div>' +
        '<div class="ng-acts"><button type="button" class="ng-btn" data-ng="close-note">' + esc(T.close) + '</button></div>';
      el.hidden = false;
      return;
    }
    el.hidden = true;
    el.innerHTML = "";
  }

  // 상태가 «바뀔 때만» 다시 그린다 — 같은 상태를 다시 그리면 role=alert 가 또 읽힌다.
  function setState(s) {
    var prev = state;
    if (s === prev) return;
    state = s;
    var bad = s === "offline" || s === "blocked";
    if (bad) {
      wasBad = true;
      if (!timer) timer = setInterval(function () { check(true); }, 20000);
      render();
    } else {
      if (timer) { clearInterval(timer); timer = 0; }
      var hadFocus = document.activeElement && root().contains(document.activeElement);
      expanded = false;
      render();
      if (wasBad && s === "ok") {
        wasBad = false;
        say(T.recovered);
        if (hadFocus) focusMain();
      }
    }
  }

  // 띠가 사라진 뒤 알리는 공손 낭독(띠 밖 숨은 칸)
  function say(msg) {
    var r = document.getElementById("ngLive");
    if (!r) {
      r = document.createElement("p");
      r.id = "ngLive";
      r.className = "ng-sr";
      r.setAttribute("role", "status");
      r.setAttribute("aria-live", "polite");
      (document.body || document.documentElement).appendChild(r);
    }
    r.textContent = "";
    setTimeout(function () { r.textContent = msg; }, 60);
  }
  function result(msg) {
    var r = document.getElementById("ngResult");
    if (r) r.textContent = msg; else say(msg);
  }
  function focusMain() {
    var m = document.querySelector("main[tabindex]") || document.getElementById("app");
    if (m && m.focus) { try { m.focus({ preventScroll: true }); } catch (e) {} }
  }

  function setExpanded(on, restoreFocus) {
    expanded = !!on;
    var el = root();
    el.classList.toggle("ng-expanded", expanded);
    var d = document.getElementById("ngDetail");
    if (d) d.hidden = !expanded;
    var t = el.querySelector('[data-ng="toggle"]');
    if (t) { t.setAttribute("aria-expanded", expanded ? "true" : "false"); t.textContent = expanded ? T.fold : T.more; }
    if (expanded) {
      var h = document.getElementById("ngTitle");
      if (h) { try { h.focus({ preventScroll: true }); } catch (e) {} }
      try { el.scrollTop = 0; } catch (e) {}
    } else if (restoreFocus && t) {
      try { t.focus(); } catch (e) {}
    }
  }

  function copy(text, okMsg) {
    function fallback() {
      try {
        var ta = document.createElement("textarea");
        ta.value = text;
        ta.setAttribute("readonly", "");
        ta.className = "ng-sr";
        document.body.appendChild(ta);
        ta.select();
        var ok = document.execCommand && document.execCommand("copy");
        document.body.removeChild(ta);
        result(ok ? okMsg : T.copyFail);
      } catch (e) { result(T.copyFail); }
    }
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(function () { result(okMsg); }, fallback);
        return;
      }
    } catch (e) { /* 아래로 */ }
    fallback();
  }

  function retry(btn) {
    if (btn) { btn.disabled = true; btn.setAttribute("aria-busy", "true"); }
    result(T.checking);
    check(true).then(function (r) {
      if (r !== "ok") {
        var b = root().querySelector('[data-ng="retry"]');
        if (b) { b.disabled = false; b.removeAttribute("aria-busy"); }
        result(T.stillBad);
      }
    });
  }

  function onClick(e) {
    var b = e.target && e.target.closest ? e.target.closest("[data-ng]") : null;
    if (!b) return;
    var a = b.getAttribute("data-ng");
    if (a === "toggle") setExpanded(!expanded, true);
    else if (a === "retry") retry(b);
    else if (a === "copy-url") copy(APP_URL, T.copiedUrl);
    else if (a === "copy-domains") copy(DOMAINS.map(function (d) { return d[0] + " (" + d[1] + ")"; }).join("\n"), T.copiedDomains);
    else if (a === "close-note") { jsonDismissed = true; render(); focusMain(); }
  }

  // 오류 칸 어디서든 «자세히»(data-ng-open) → 안내를 펼친다.
  // 상태를 아직 모르면(또는 정상이라 나왔으면) 한 번 확인한 뒤 펼친다.
  document.addEventListener("click", function (e) {
    var b = e.target && e.target.closest ? e.target.closest("[data-ng-open]") : null;
    if (!b) return;
    e.preventDefault();
    function open() {
      if (state === "offline" || state === "blocked") setExpanded(true);
      else say(T.recovered);
    }
    if (state === "offline" || state === "blocked") open();
    else check(true).then(open);
  });

  window.addEventListener("online", function () { check(true); });
  window.addEventListener("offline", function () { setState("offline"); });

  function start() { check(true); }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();

  window.NetGuard = {
    check: check,
    state: function () { return state; },
    open: function () { if (state === "offline" || state === "blocked") setExpanded(true); },
    noteJsonFallback: function () { if (!jsonNote) { jsonNote = true; render(); } },
    TEXT: T,
    DOMAINS: DOMAINS
  };
})();
