/* 상주시 정책플랫폼(시민용) — 「홈 화면에 추가」 원터치 설치 안내      (2026-08-19)
 * ══════════════════════════════════════════════════════════════════════
 * 공무원앱 cloudui/a2hs.js 와 «같은 뼈대»이되, 시민앱 사정에 맞춰 두 가지를 더했다.
 *   ① 아이폰(사파리) 전용 안내 — iOS 에는 beforeinstallprompt 사건이 «없다».
 *      그래서 공무원앱처럼 그 사건만 기다리면 아이폰 이용자는 설치 안내를 영영 못 본다.
 *      → 사파리로 열었고 아직 설치 전이면, 「공유 버튼 → 홈 화면에 추가」를 글로 안내한다.
 *   ② 인앱 브라우저(카톡·네이버 등)에서는 «아무것도 하지 않는다».
 *      그쪽은 app.js 의 #inappBanner 가 「크롬으로 열기」를 안내하는 자리다.
 *      두 안내가 겹치면 홈 화면 위쪽이 띠 두 개로 막힌다.
 *
 * 무엇을 켜고 끄는가 (HTML 의 hidden 만 만진다 — 인라인 style·on* 는 CSP 로 금지)
 *   · #a2hsTip      홈 상단 안내 띠 (app.js initA2HS 가 «처음 1회»만 띄운다)
 *   · #a2hsInstall  그 띠 안의 「홈 화면에 추가」 버튼   ← 설치 가능할 때만
 *   · #installNow   설치 안내 모달 안의 「지금 홈 화면에 추가」 ← 설치 가능할 때만
 *   · #installIosHint 모달 안 아이폰 전용 한 줄 안내      ← 아이폰일 때만
 *
 * ⚠ app.js 와의 관계
 *   app.js 의 initA2HS() 는 «처음 1회만» 띠를 띄운다(A2HS_SEEN_KEY).
 *   그러나 «진짜 설치할 수 있게 된 순간»은 그보다 늦게 온다(beforeinstallprompt).
 *   그때는 이 파일이 띠를 다시 켠다 — 단, 시민이 ✕ 로 «닫은» 적이 있으면 켜지 않는다.
 *   (닫힘 표시는 app.js 와 «같은 열쇠» sangju_a2hs_dismissed 를 쓴다)
 *
 * ⚠ 이 파일은 안내 전용이다. 신청·조회 등 업무 로직과 아무 관계가 없다.
 *   실패해도(구형 브라우저·저장소 차단) 앱의 다른 기능은 그대로 동작해야 한다.
 */
(function () {
  "use strict";

  // app.js 의 A2HS_DISMISS_KEY 와 «같은 값»이어야 한다. 한쪽만 고치지 말 것.
  var DISMISS_KEY = "sangju_a2hs_dismissed";
  var deferred = null;          // beforeinstallprompt 이벤트를 잡아 둔 것

  function $(id) { return document.getElementById(id); }

  function installedAlready() {
    return (window.matchMedia && window.matchMedia("(display-mode: standalone)").matches) ||
           window.navigator.standalone === true;
  }
  function dismissed() {
    try { return localStorage.getItem(DISMISS_KEY) === "1"; } catch (e) { return false; }
  }
  function remember() {
    try { localStorage.setItem(DISMISS_KEY, "1"); } catch (e) { /* 이번 화면에서만 감춘다 */ }
  }

  // 인앱 웹뷰 판정 — app.js isInApp() 과 «같은 목록». 한쪽만 고치면 두 배너가 겹친다.
  function isInApp() {
    var ua = (navigator.userAgent || "").toLowerCase();
    return /kakaotalk|naver|line\/|fban|fbav|instagram|daumapps|whale|everytimeapp|band|kakaostory/.test(ua);
  }
  function isIOS() {
    var ua = navigator.userAgent || "";
    return /iphone|ipad|ipod/i.test(ua) ||
      (/macintosh/i.test(ua) && (navigator.maxTouchPoints || 0) > 1);
  }
  // 아이폰의 «사파리»인가 — 크롬·엣지 등 iOS 대체 브라우저는 홈 화면 추가가 제한된다.
  function isIOSSafari() {
    if (!isIOS()) return false;
    var ua = navigator.userAgent || "";
    return !/CriOS|FxiOS|EdgiOS|OPiOS|Whale/i.test(ua);
  }
  // 인앱 배너가 화면에 떠 있는가 — 떠 있으면 우리는 물러난다(겹침 방지).
  function inappShown() {
    var b = $("inappBanner");
    return !!(b && !b.hidden);
  }

  // 안내 띠를 «설치 버튼이 달린 모습»으로 켠다.
  function showTipWithInstall() {
    if (installedAlready() || dismissed() || inappShown()) return;
    var tip = $("a2hsTip"), btn = $("a2hsInstall");
    if (!tip || !btn) return;
    btn.hidden = false;
    tip.classList.add("has-install");   // 「방법 보기 ›」는 CSS 가 숨긴다(군더더기)
    tip.hidden = false;
  }

  function hideTip() {
    var tip = $("a2hsTip"), btn = $("a2hsInstall");
    if (btn) btn.hidden = true;
    if (tip) { tip.classList.remove("has-install"); tip.hidden = true; }
    var now = $("installNow");
    if (now) now.hidden = true;
  }

  // 실제 설치 요청. 브라우저가 준 이벤트는 «한 번만» 쓸 수 있다.
  function doPrompt() {
    if (!deferred) { hideTip(); return; }
    var d = deferred;
    deferred = null;
    window.__a2hsCanInstall = false;   // 한 번 쓴 이벤트는 다시 못 쓴다
    hideTip();
    try { d.prompt(); } catch (e) { return; }
    // 취소해도 다시 조르지 않는다(설치 여부와 무관하게 안내는 여기서 끝).
    if (d.userChoice && d.userChoice.then) d.userChoice.then(function () { remember(); });
    else remember();
  }

  // ── 브라우저가 «설치할 수 있다»고 알려 줄 때 ─────────────────────────
  window.addEventListener("beforeinstallprompt", function (e) {
    e.preventDefault();          // 브라우저 기본 배너를 미루고 우리 안내로 대신한다
    deferred = e;
    // app.js initA2HS() 가 «처음 1회» 규칙으로 띠를 끄지 않도록 알린다.
    //   (app.js 의 init 은 비동기라 이 사건보다 늦게 끝날 수 있다 — 경합 방지)
    window.__a2hsCanInstall = true;
    var now = $("installNow");
    if (now) now.hidden = false;   // 모달을 열어 보는 경로에서도 바로 설치할 수 있게
    showTipWithInstall();
  });

  window.addEventListener("appinstalled", function () {
    window.__a2hsCanInstall = false;
    remember();
    hideTip();
  });

  document.addEventListener("DOMContentLoaded", function () {
    var btn = $("a2hsInstall");
    if (btn) btn.addEventListener("click", doPrompt);
    var now = $("installNow");
    if (now) now.addEventListener("click", doPrompt);

    // ── 아이폰(사파리) — beforeinstallprompt 가 «없다» ────────────────
    //    설치 버튼을 만들 수 없으므로 «방법»을 글로 안내한다.
    //    모달의 아이폰 절차는 원래 있던 것이고, 여기서는 한 줄 요약을 켠다.
    if (isIOSSafari() && !installedAlready() && !isInApp()) {
      var hint = $("installIosHint");
      if (hint) hint.hidden = false;
      // 띠는 app.js 가 «처음 1회» 규칙으로 이미 판단해 두었다.
      // 아이폰에서는 그 판단을 존중한다(설치 버튼이 생기는 것이 아니라 «안내»뿐이므로,
      // 매번 다시 띄우면 화면만 좁아진다). 언제든 헤더 「안내」에서 볼 수 있다.
    }

    // 인앱 브라우저에서는 우리 띠를 확실히 접어 둔다(app.js 의 인앱 배너에 자리를 준다).
    if (inappShown()) hideTip();
  });
})();
