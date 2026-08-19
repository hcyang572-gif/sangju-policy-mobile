/* ===============================================================
   ui.js - 시각 레이어 (아이콘 · 분야 칩 · 하단 탭바)
   ---------------------------------------------------------------
   확정 시안 A「감빛 온기」의 «형태»를 실제 앱에 옮기는 층.
     (1) 앱이 그려 낸 이모지를 인라인 SVG 선 아이콘으로 바꾼다(24px, currentColor)
     (2) 분야 칩은 «전부» 펴 둔다(2026-08-19 접기 폐지 — 격자 정렬은 style.css)
     (3) 하단 탭바 4개의 «홈» 버튼과 «현재 화면» 강조를 맡는다
   ! app.js·proposals.js 의 로직·계약(id·class·data-*)에 전혀 관여하지 않는다.
      - 분야 칩의 data-cat 값(이모지 포함 원본 문자열)은 «건드리지 않는다» — 필터 키다.
      - 보이는 글자만 바꾸고, 아이콘은 aria-hidden 이라 낭독 내용은 그대로다.
   ! CSP: 인라인 <script>·style= 을 쓰지 않는다(외부 파일 + classList 만 사용).
   =============================================================== */
(function () {
  "use strict";

  var P = {"call": "<path d=\"M6.4 3.6h3l1.5 4-2 1.5a12 12 0 0 0 6 6l1.5-2 4 1.5v3a2 2 0 0 1-2.2 2A17 17 0 0 1 4.4 5.8a2 2 0 0 1 2-2.2z\"/>", "chat": "<path d=\"M21 14a3 3 0 0 1-3 3H8l-5 4V6a3 3 0 0 1 3-3h12a3 3 0 0 1 3 3z\"/>", "chev": "<path d=\"M9.5 5.5 16 12l-6.5 6.5\"/>", "link": "<path d=\"M10 13.6a4 4 0 0 0 5.7 0l3-3a4 4 0 1 0-5.7-5.7l-1.2 1.2\"/><path d=\"M14 10.4a4 4 0 0 0-5.7 0l-3 3a4 4 0 1 0 5.7 5.7l1.2-1.2\"/>", "pencil": "<path d=\"M4 20h4.2L20 8.2 15.8 4 4 15.8z\"/><path d=\"m14.4 5.4 4.2 4.2\"/>", "pin": "<path d=\"M9 4h6l-1 5 3.4 3v1.6H6.6V12L10 9z\"/><path d=\"M12 13.6V21\"/>", "receipt": "<path d=\"M13.4 3H7a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1V7.6z\"/><path d=\"M13.4 3v4.6H18\"/><path d=\"M9.4 14.2l1.9 1.9 3.4-3.6\"/>", "refresh": "<path d=\"M20.4 11a8.5 8.5 0 1 0-.7 4.3\"/><path d=\"M20.5 4.6v6.2h-6.2\"/>", "search": "<circle cx=\"11\" cy=\"11\" r=\"7\"/><path d=\"M16.5 16.5 21 21\"/>", "speak": "<path d=\"M4 9.5h3.2L14 5v14l-6.8-4.5H4z\"/><path d=\"M17.4 9.2a4.4 4.4 0 0 1 0 5.6\"/>", "star": "<path d=\"M12 3.6l2.5 5.3 5.7.8-4.1 4 1 5.7-5.1-2.8-5.1 2.8 1-5.7-4.1-4 5.7-.8z\"/>", "thumb": "<path d=\"M7 21V10l4.5-7 1 .6a2 2 0 0 1 .9 2.2L12.5 9H19a2 2 0 0 1 2 2.4l-1.5 7A2.4 2.4 0 0 1 17 20.5H7z\"/><path d=\"M7 10.5H4V21h3\"/>", "tools": "<path d=\"M14.6 6.6a3.6 3.6 0 0 1 4.9-3.3l-2.7 2.7 1.4 1.4 2.7-2.7a3.6 3.6 0 0 1-4.6 4.7L6.8 18.9a2 2 0 1 1-2.8-2.8z\"/>"};
  var DYN = {"📌": "pin", "📞": "call", "🧾": "receipt", "💬": "chat", "🆕": "star", "🔗": "link", "👍": "thumb", "🔄": "refresh", "🛠": "tools", "🗳": "speak", "✏": "pencil", "🔍": "search"};
  // (2026-08-19) 「자주 찾는 8개」 목록 FREQ 는 «분야 접기»와 함께 삭제됐다 — 되살리지 말 것.

  function svg(name, cls) {
    if (!P[name]) return "";
    return '<svg class="' + (cls || "ic") + '" viewBox="0 0 24 24" fill="none" ' +
      'stroke="currentColor" stroke-width="2" stroke-linecap="round" ' +
      'stroke-linejoin="round" aria-hidden="true">' + P[name] + '</svg>';
  }

  // 앞머리 장식 이모지(와 뒤따르는 공백)를 떼어 «글자만» 남긴다. 데이터 원본은 그대로 둔다.
  function plain(s) {
    s = String(s || "");
    var out = "";
    for (var i = 0; i < s.length; i++) {
      var c = s.charCodeAt(i);
      var isEmoji = (c >= 0x2190 && c <= 0x2BFF) || (c >= 0xD800 && c <= 0xDFFF) ||
        c === 0x200D || c === 0xFE0F || c === 0x20E3;
      if (out === "" && (isEmoji || c === 32)) continue;   // 앞머리만 잘라 낸다
      out += s.charAt(i);
    }
    return out.trim();
  }

  // --- (1) 분야 칩: «전부 보이게» 유지 ---------------------------
  // ⚠ 2026-08-19 변경(양호창님 지시) — 예전에는 자주 찾는 8개(FREQ)만 펴 두고
  //    나머지를 .chip-more 로 접은 뒤 「분야 전체 보기」 버튼으로 열게 했다.
  //    분야는 «무엇이 있는지 한눈에 보이는 것»이 핵심이라, 접혀 있으면 자기 분야가
  //    있는 줄 모르고 돌아가는 일이 생겼다. → 이제 전부 편다.
  //    들쭉날쭉함은 style.css 의 «행렬 그리드»(.chips)가 대신 잡는다.
  // ⛔ 접기를 되살리지 말 것. 되살리려면 style.css 의 .chip-more 규칙부터 함께 복원해야 한다.
  // ! 분야 칩은 «컬러 이모지 그대로» 둔다 — 규격서 13절, 이모지 금지의 «유일한 예외».
  //   ① 분야를 고르는 자리에서는 컬러 이모지가 한눈에 구분되고 어르신도 알아보기 쉽다.
  //   ② 이 라벨은 config.py → data.json → 세 앱으로 흐르는 «데이터»라,
  //      화면에서만 바꾸면 앱마다 달라 보인다.  → 아이콘으로 바꾸지 말 것.
  function upgradeChips() {
    var box = document.getElementById("categoryChips");
    if (!box) return;
    var chips = box.querySelectorAll(".chip");
    if (!chips.length) return;
    // 옛 버전의 흔적을 지운다(캐시된 옛 화면이 남아 있는 기기 대비).
    box.classList.remove("chips-open");
    Array.prototype.forEach.call(chips, function (el) {
      el.classList.remove("chip-more");
    });
    // 「분야 전체 보기」 토글이 남아 있으면 걷어 낸다.
    //   ⚠ 맞춤 찾기의 「더 보기」(#situationMore)도 같은 .chip-toggle 을 쓰므로,
    //     «분야 칩 상자의 형제»인 것만 골라 지운다(id 로 한 번 더 걸러 낸다).
    var t = box.parentNode.querySelector(".chip-toggle");
    if (t && t.id !== "situationMore") t.parentNode.removeChild(t);
  }

  // --- (2) 앱이 그려 낸 장식 이모지 -> SVG ----------------------
  function upgradeEmoji(root) {
    var list = (root || document).querySelectorAll('[aria-hidden="true"]');
    Array.prototype.forEach.call(list, function (el) {
      if (el.getAttribute("data-iconized")) return;
      if (el.children.length) return;                    // 이미 SVG 등이 있으면 건너뜀
      var txt = (el.textContent || "").trim();
      if (!DYN[txt]) return;
      el.innerHTML = svg(DYN[txt]);
      el.setAttribute("data-iconized", "1");
      el.classList.add("ic-wrap");
    });
    // 글자 안에 섞인 앞머리 이모지(예: 「새로 추가된…」·「제안 수정하기」)는 글자만 남긴다
    ["newBannerText", "pwriteTitle"].forEach(function (id) {
      var el = document.getElementById(id);
      if (!el || el.children.length) return;
      var s = el.textContent || "";
      var p = plain(s);
      if (p && p !== s) el.textContent = p;
    });
  }

  // --- (3) 하단 탭바 -------------------------------------------
  // 탭 강조 대응표. «확인 번호로 찾기»(mscode)는 내 신청에서 갈라져 나온 화면이므로
  // 그 화면에서도 「내 신청」 탭이 켜져 있어야 한다(어디에 있는지 잃지 않게).
  var VIEW_OF = { home: "home", recommend: "recommend", propose: "propose", mystatus: "mystatus" };
  var TAB_ALIAS = { mscode: "mystatus", pdetail: "propose", pwrite: "propose" };

  function goHome() {
    // #privacyHome·#doneHome 의 처리와 «같은 순서»를 그대로 따른다(app.js 무수정).
    try {
      state.selectedCats = new Set();
      state.navStack = [{ v: "home", t: HOME_TITLE }];
      state.fwdStack = [];
      document.getElementById("topTitle").textContent = HOME_TITLE;
      showView("home", false);
    } catch (e) {
      location.reload();
    }
  }

  function currentView() {
    var vs = document.querySelectorAll("#app .view");
    for (var i = 0; i < vs.length; i++) {
      if (!vs[i].hidden) return vs[i].id.replace("view-", "");
    }
    return "home";
  }

  function syncTabs() {
    var bar = document.getElementById("tabBar");
    if (!bar) return;
    var now = currentView();
    if (TAB_ALIAS[now]) now = TAB_ALIAS[now];
    Array.prototype.forEach.call(bar.querySelectorAll(".tabbar-btn"), function (b) {
      var on = VIEW_OF[b.getAttribute("data-tab")] === now;
      b.classList.toggle("is-on", on);
      if (on) b.setAttribute("aria-current", "page");
      else b.removeAttribute("aria-current");
    });
    // 「내 신청」은 서버에 조회 함수가 있을 때만 쓸 수 있다 -> 홈 진입점과 «같은 조건»으로 노출
    var entry = document.getElementById("myStatusEntry");
    var msTab = bar.querySelector('[data-tab="mystatus"]');
    if (entry && msTab) msTab.hidden = !!entry.hidden;
  }

  function initTabs() {
    var bar = document.getElementById("tabBar");
    if (!bar) return;
    var homeBtn = bar.querySelector('[data-tab="home"]');
    if (homeBtn) homeBtn.addEventListener("click", goHome);
    syncTabs();
  }

  // --- 실행 + 화면이 바뀔 때마다 다시 맞춘다 --------------------
  function refresh() {
    upgradeChips();
    upgradeEmoji();
    syncTabs();
  }

  function start() {
    initTabs();
    refresh();
    var app = document.getElementById("app");
    if (app && window.MutationObserver) {
      var mo = new MutationObserver(function () {
        if (mo._t) return;
        mo._t = setTimeout(function () { mo._t = null; refresh(); }, 60);
      });
      mo.observe(app, {
        childList: true, subtree: true,
        attributes: true, attributeFilter: ["hidden"]
      });
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start);
  } else {
    start();
  }
})();
