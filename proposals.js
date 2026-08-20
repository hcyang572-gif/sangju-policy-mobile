// 상주시 정책플랫폼 — 정책참여(시민 제안) Phase A
// Supabase 라이브 read/write. 익명 제안·공감·본인수정/삭제(PIN)·신고.
// app.js 의 전역 헬퍼($, esc, showView, DATA, state)를 그대로 사용한다.
// 기존 지원사업(data.json) 기능과 완전히 분리되어 있어 서로 영향 없음.

"use strict";

(function () {
  /* ---------- 알림·확인 창 (2026-08-20 양호창님 지시) ----------
     ⛔ alert()/confirm() 을 «쓰지 말 것».
        브라우저가 창 맨 윗줄에 「hcyang572-gif.github.io 내용:」 이라는 출처 표기를
        강제로 붙이고(JS 로 못 지운다), 자바스크립트를 멈춰 버튼 상태까지 굳힌다.
     정본은 app.js 의 window.appAlert / window.appConfirm 이다. 아래는 그리로 잇는 다리 —
     app.js 가 아직 안 실려 있거나 옛 캐시가 남은 기기에서만 예전 방식으로 돌아간다. */
  function appAlert(msg, opts) {
    if (window.appAlert) return window.appAlert(msg, opts);
    window.alert(msg); return Promise.resolve(true);
  }
  function appConfirm(msg, opts) {
    if (window.appConfirm) return window.appConfirm(msg, opts);
    return Promise.resolve(window.confirm(msg));
  }

  /* ---------- Supabase 클라이언트 — «앱 전체가 하나»를 쓴다 ----------
     ⭐ 2026-08-20 수정. 예전에는 여기서 createClient 를 «따로» 불러, 시민 1명이
        Supabase 연결을 두 개(사업정보용 + 정책참여용) 열었다. 무료 요금제의
        실시간 동시 연결 한도가 200 이라, 동시 접속 시민이 100명에서 막혔다.
        app.js 의 공용 클라이언트(cloudClient)를 함께 쓰면 그대로 200명이 된다.
     ⚠ 채널 이름이 서로 다르므로(app.js 「benefits-rt-citizen」 /
       여기 「proposals-citizen」) 한 소켓 위에서 간섭 없이 돌아간다.
       app.js 의 재연결도 removeChannel(자기 채널) 만 부르므로 이 구독은 안 끊긴다.
     ⛔ 이 파일에서 removeAllChannels()·realtime.disconnect() 를 «절대» 쓰지 말 것 —
       이제는 사업정보 구독까지 함께 끊긴다.
     ⚠ index.html 은 app.js 를 «먼저» 싣는다(둘 다 defer 아님) → 여기서 부를 때는
       window.cloudClient 가 이미 있다. 그래도 없을 때를 대비해 예전 방식을 남겨 둔다
       (옛 캐시가 남은 기기 대비 — 그때도 앱이 깨지지는 않아야 한다). */
  let sb = null;
  function getClient() {
    if (sb) return sb;
    try {
      if (typeof window.cloudClient === "function") {
        const shared = window.cloudClient();
        if (shared) { sb = shared; return sb; }
      }
      if (!window.supabase || !window.SUPABASE_URL || !window.SUPABASE_ANON_KEY) return null;
      console.warn("[정책참여] 공용 클라이언트를 찾지 못해 따로 연결합니다(연결 2개).");
      sb = window.supabase.createClient(window.SUPABASE_URL, window.SUPABASE_ANON_KEY);
      return sb;
    } catch (e) {
      console.warn("[정책참여] Supabase 초기화 실패:", e);
      return null;
    }
  }

  // ---------- 기기 식별자(voter_key): localStorage UUID 1회 생성·재사용 ----------
  const VOTER_KEY_LS = "sangju_voter_key";
  function voterKey() {
    let k = "";
    try { k = localStorage.getItem(VOTER_KEY_LS) || ""; } catch (e) {}
    if (!k) {
      k = (window.crypto && crypto.randomUUID)
        ? crypto.randomUUID()
        : "v-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 10);
      try { localStorage.setItem(VOTER_KEY_LS, k); } catch (e) {}
    }
    return k;
  }

  // 내가 공감한 제안 id 집합(상세에서 토글 표시용 보조 — 서버 like_count 가 최종 진실)
  const LIKED_LS = "sangju_liked_proposals";
  function likedSet() {
    try { return new Set(JSON.parse(localStorage.getItem(LIKED_LS) || "[]")); }
    catch (e) { return new Set(); }
  }
  function saveLiked(set) {
    try { localStorage.setItem(LIKED_LS, JSON.stringify([...set])); } catch (e) {}
  }

  /* ── 내가 제안한 정책 (2026-08-19) ─────────────────────────────────────────
     「내 신청」 화면에서 «신청한 사업»과 나란히 보여 주기 위해, 제안을 등록한
     기기에 «제안 번호»만 남긴다.
     ⚠ 여기에 개인정보를 넣지 않는다 — 닉네임·PIN·내용은 저장하지 않는다.
        제목·작성일은 «서버가 아직 안 될 때 최소한이라도 보여 주려는» 보조값이고,
        본문은 늘 서버에서 다시 읽는다(상태가 바뀌므로).
     ⚠ 「이 기기에서 지우기」는 조회코드만 지운다 — 제안은 공개 게시물이고
        번호를 지운다고 글이 사라지지 않으므로 함께 지우지 않는다.  */
  const MINE_LS = "sangju_my_proposals";
  const MINE_MAX = 50;
  function loadMine() {
    try {
      const raw = JSON.parse(localStorage.getItem(MINE_LS) || "[]");
      return Array.isArray(raw) ? raw.filter((e) => e && e.id != null) : [];
    } catch (e) { return []; }
  }
  function saveMine(entry) {
    if (!entry || entry.id == null) return;
    try {
      const list = loadMine().filter((e) => String(e.id) !== String(entry.id));
      list.unshift(entry);
      localStorage.setItem(MINE_LS, JSON.stringify(list.slice(0, MINE_MAX)));
    } catch (e) { /* 저장 못 해도 제안 등록 자체는 성공이다 — 조용히 넘어간다 */ }
  }
  function forgetMine(id) {
    try {
      const list = loadMine().filter((e) => String(e.id) !== String(id));
      localStorage.setItem(MINE_LS, JSON.stringify(list));
    } catch (e) { /* 무시 */ }
  }

  // ---------- 상태 ----------
  const PAGE = 20;
  const pstate = { cat: "", sort: "new", page: 0, items: [], end: false, loading: false };
  let currentP = null;        // 현재 상세에서 보고 있는 제안
  let realtimeSub = null;

  const STATUS_BADGE = {
    "접수": { cls: "st-accept", label: "접수" },
    "검토중": { cls: "st-review", label: "검토중" },
    "반영": { cls: "st-done", label: "반영" },
    "불채택": { cls: "st-reject", label: "불채택" },
    "보류": { cls: "st-hold", label: "보류" },
  };
  const STATUS_ORDER = ["접수", "검토중", "반영", "불채택", "보류"];

  /* ── 조회할 «칸» 목록 (2026-08-19) ───────────────────────────────────────
     ⚠ 절대 select("*") 를 쓰지 않는다.
        proposals 에는 본인확인용 PIN 해시(pin_hash)가 들어 있는데, 이것이 익명
        사용자에게 그대로 나가면 «숫자 4자리»라 몇 초 만에 복원되어 남의 제안을
        지우거나 고칠 수 있다. 그래서 supabase/제안PIN_해시_익명노출_차단.sql 에서
        anon 에게는 pin_hash 를 뺀 칸만 허용해 두었다.
        PostgREST 의 select=* 는 «모든 칸»을 요구하므로, pin_hash 권한이 없는
        익명 호출은 통째로 401(42501 permission denied) 이 된다.
        → 화면에서 실제로 쓰는 칸만 «콕 집어» 적는다.
     ⚠ pin_hash 는 어떤 경우에도 이 목록에 넣지 않는다(넣는 순간 다시 401).
     ⚠ 화면에 새 칸을 쓰게 되면 여기 한 곳만 고치고, 먼저 SQL 의 grant select(...)
        목록에 그 칸이 들어 있는지 확인한다.
     허용된 칸: id, title, body, category, author_nick, region,
                status, admin_reply, like_count, is_hidden, created_at, updated_at  */
  // 목록(제안 목록·「내 신청 › 제안한 정책」) — 카드에 보이는 값만.
  //   is_hidden 은 «거르기 조건»으로만 쓰므로 받아 올 필요가 없다.
  const COLS_LIST = "id,title,category,status,like_count,created_at";
  // 상세 — 본문·닉네임·지역·담당부서 답변까지. 수정 화면(PIN)도 이 값을 그대로 채운다.
  const COLS_DETAIL = "id,title,body,category,author_nick,region,status,admin_reply,like_count,created_at";

  const $ = (id) => document.getElementById(id);
  /* 수집·이용 동의 오류 표시 — app.js setFieldError 와 같은 규약
     (빈 문자열이면 감추고, aria-invalid 도 함께 넣고 지운다). */
  /* 🏘 읍·면·동 오류 표시 — app.js setFieldError 와 같은 규약 */
  function setPwRegionErr(msg) {
    const err = $("pwRegionErr"), box = $("pwRegion");
    if (err) { err.textContent = msg || ""; err.hidden = !msg; }
    if (box) { if (msg) box.setAttribute("aria-invalid", "true"); else box.removeAttribute("aria-invalid"); }
  }
  function setPwConsentErr(msg) {
    const err = $("pwConsentErr"), box = $("pwConsent");
    if (err) { err.textContent = msg || ""; err.hidden = !msg; }
    if (box) { if (msg) box.setAttribute("aria-invalid", "true"); else box.removeAttribute("aria-invalid"); }
  }
  // app.js의 전역 esc(클래식 스크립트 전역 렉시컬) 우선, 없으면 동일 규칙으로 이스케이프
  const esc = (typeof window.esc === "function")
    ? window.esc
    : ((s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) =>
        ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])));

  function fmtDate(ts) {
    if (!ts) return "";
    try {
      const d = new Date(ts);
      const m = String(d.getMonth() + 1).padStart(2, "0");
      const day = String(d.getDate()).padStart(2, "0");
      return `${d.getFullYear()}-${m}-${day}`;
    } catch (e) { return ""; }
  }

  // ---------- 오류 원인 분류 ----------
  // 무료 플랜 일시정지·오프라인 등으로 클라우드에 아예 닿지 못한 사고가 있었는데
  // 화면엔 "불러오기 실패"만 떠서 원인 파악이 불가능했다 → 원인별로 문구를 나눈다.
  //   conn   : 네트워크/서버 미응답(브라우저 오프라인, fetch 실패, 5xx, 프로젝트 일시정지)
  //   perm   : 권한(RLS)·인증 거부
  //   setup  : DB 스키마/RPC 미적용(테이블·함수 없음)
  //   other  : 그 밖
  function errKind(e) {
    if (!e) return "other";
    if (typeof navigator !== "undefined" && navigator.onLine === false) return "conn";
    const msg = String(e.message || e || "").toLowerCase();
    const code = String(e.code || e.status || "");
    if (e.name === "TypeError" && msg.indexOf("fetch") >= 0) return "conn";
    if (/failed to fetch|networkerror|network error|load failed|timeout|timed out|econnrefused|fetch failed/.test(msg)) return "conn";
    if (/^(5\d\d|0|429)$/.test(code)) return "conn";
    if (/service unavailable|bad gateway|gateway timeout|temporarily unavailable|paused|infrastructure/.test(msg)) return "conn";
    if (code === "42501" || code === "401" || code === "403" ||
        /row-level security|permission denied|not authorized|jwt|api key/.test(msg)) return "perm";
    if (code === "42P01" || code === "42883" || code === "PGRST202" || code === "PGRST205" ||
        /does not exist|could not find the (table|function)|schema cache/.test(msg)) return "setup";
    return "other";
  }

  // 원인별 안내 + 다시 시도 버튼(빈 목록 자리에 그대로 렌더)
  function errBoxHtml(kind, retryId) {
    const btn = retryId
      ? `<div class="err-actions"><button id="${retryId}" class="err-retry" type="button"><svg class="ic ic-in" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20.4 11a8.5 8.5 0 1 0-.7 4.3"/><path d="M20.5 4.6v6.2h-6.2"/></svg> 다시 시도</button></div>`
      : "";
    if (kind === "conn") {
      return `<div class="empty err-box" role="alert">
        <div class="err-title"><svg class="ic ic-in" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M10.2 9v6M13.8 9v6"/></svg> 클라우드 서비스가 일시적으로 응답하지 않습니다.</div>
        <div class="err-desc">잠시 후 다시 시도해 주세요.<br>계속되면 인터넷 연결 상태를 확인해 주세요.</div>
        ${btn}</div>`;
    }
    if (kind === "perm") {
      return `<div class="empty err-box" role="alert">
        <div class="err-title"><svg class="ic ic-in" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4.5" y="10" width="15" height="10.5" rx="2.5"/><path d="M8 10V7.2a4 4 0 0 1 8 0V10"/></svg> 접근 권한이 없어 불러오지 못했습니다.</div>
        <div class="err-desc">일시적인 설정 문제일 수 있습니다.<br>계속되면 관리 부서로 알려 주세요.</div>
        ${btn}</div>`;
    }
    if (kind === "setup") {
      return `<div class="empty err-box" role="alert">
        <div class="err-title"><svg class="ic ic-in" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14.6 6.6a3.6 3.6 0 0 1 4.9-3.3l-2.7 2.7 1.4 1.4 2.7-2.7a3.6 3.6 0 0 1-4.6 4.7L6.8 18.9a2 2 0 1 1-2.8-2.8z"/></svg> 정책참여 기능을 준비 중입니다.</div>
        <div class="err-desc">DB 설정(SQL) 적용 후 이용할 수 있습니다.</div>
        ${btn}</div>`;
    }
    return `<div class="empty err-box" role="alert">
      <div class="err-title">불러오지 못했습니다.</div>
      <div class="err-desc">잠시 후 다시 시도해 주세요.</div>
      ${btn}</div>`;
  }

  // 목록 영역에 오류 박스를 그리고 '다시 시도' 버튼을 연결
  function showListError(kind) {
    $("ppList").innerHTML = errBoxHtml(kind, "ppRetry");
    const b = $("ppRetry");
    if (b) b.addEventListener("click", reload);
  }

  // 클라이언트 자체가 안 만들어진 경우(설정 파일 누락 등)
  function dbUnavailableMsg() {
    return errBoxHtml("setup", "");
  }

  // 동작(공감·등록·신고 등) 실패 시 alert 문구 — 원인별 구분
  function actionErrMsg(e, what) {
    const kind = errKind(e);
    if (kind === "conn") {
      return "⏸ 클라우드 서비스가 일시적으로 응답하지 않습니다.\n잠시 후 다시 시도해 주세요.";
    }
    if (kind === "perm") {
      return "🔒 접근 권한이 없어 " + what + "하지 못했습니다.\n계속되면 관리 부서로 알려 주세요.";
    }
    if (kind === "setup") {
      return "🛠 아직 준비 중인 기능입니다.\n(DB 설정(SQL) 적용 후 이용할 수 있습니다.)";
    }
    return what + "에 실패했습니다.\n잠시 후 다시 시도해 주세요.";
  }

  // ---------- 분야 목록 채우기 (지원사업 카테고리 재사용) ----------
  function categoryList() {
    // app.js 전역 DATA(지원사업 데이터) 직접 참조 — 분야 카테고리 재사용
    const d = (typeof DATA !== "undefined") ? DATA : null;
    const cats = (d && Array.isArray(d.categories)) ? d.categories : [];
    return cats;
  }
  function fillCategorySelects() {
    const cats = categoryList();
    const filterSel = $("ppCategory");
    if (filterSel && filterSel.options.length === 0) {
      filterSel.innerHTML = `<option value="">전체 분야</option>` +
        cats.map((c) => `<option value="${esc(c)}">${esc(c)}</option>`).join("");
    }
    const writeSel = $("pwCategory");
    if (writeSel && writeSel.options.length === 0) {
      writeSel.innerHTML = (cats.length
        ? cats.map((c) => `<option value="${esc(c)}">${esc(c)}</option>`).join("")
        : `<option value="기타">기타</option>`);
    }
  }

  // ---------- 진입: 목록 화면 ----------
  function open() {
    fillCategorySelects();
    $("topTitle").textContent = "정책참여";
    showView("propose");
    reload();
    subscribeRealtime();
  }

  function reload() {
    rtPending = 0;              // 새로 불러오므로 «밀린 알림»도 지운다
    syncRtBanner();
    pstate.page = 0;
    pstate.items = [];
    pstate.end = false;
    $("ppList").innerHTML = "";
    $("ppListMeta").textContent = "";
    loadMore();
  }

  async function loadMore() {
    if (pstate.loading || pstate.end) return;
    const client = getClient();
    if (!client) { $("ppList").innerHTML = dbUnavailableMsg(); $("ppMore").hidden = true; return; }
    pstate.loading = true;
    $("ppListMeta").textContent = pstate.items.length ? `${pstate.items.length}개 표시` : "불러오는 중...";
    // 첫 쪽이라 화면에 그릴 것이 «아직 없을 때»만 스켈레톤을 깐다(더 보기에서는 쓰지 않는다).
    if (!pstate.items.length && window.skeletonHtml) $("ppList").innerHTML = window.skeletonHtml(3);

    const from = pstate.page * PAGE;
    const to = from + PAGE - 1;
    let q = client.from("proposals").select(COLS_LIST).eq("is_hidden", false);
    if (pstate.cat) q = q.eq("category", pstate.cat);
    if (pstate.sort === "like") q = q.order("like_count", { ascending: false }).order("created_at", { ascending: false });
    else q = q.order("created_at", { ascending: false });
    q = q.range(from, to);

    try {
      const { data, error } = await q;
      if (error) throw error;
      const rows = data || [];
      pstate.items = pstate.items.concat(rows);
      pstate.page += 1;
      if (rows.length < PAGE) pstate.end = true;
      renderList();
    } catch (e) {
      console.warn("[정책참여] 목록 조회 실패:", e);
      // 원인(연결/권한/미설정)에 따라 안내 문구를 구분 + 다시 시도 버튼 제공
      if (pstate.items.length === 0) showListError(errKind(e));
      $("ppListMeta").textContent = "";
      pstate.end = true;
      $("ppMore").hidden = true;
    } finally {
      pstate.loading = false;
    }
  }

  function renderList() {
    const box = $("ppList");
    if (pstate.items.length === 0) {
      // 빈 화면에는 상상주도 캐릭터가 CSS(.empty::before)로 «한 번만» 떠오른다.
      // 장식을 겹쳐 쓰지 않도록 예전의 확성기 아이콘은 뺐다(규격서 0절 깔끔함).
      box.innerHTML = `<div class="empty">아직 등록된 제안이 없습니다.<br>첫 제안을 남겨보세요!</div>`;
      $("ppListMeta").textContent = "0개";
      $("ppMore").hidden = true;
      return;
    }
    box.innerHTML = pstate.items.map((p) => {
      const b = STATUS_BADGE[p.status] || STATUS_BADGE["접수"];
      // 키보드 접근(KWCAG 2.2): role=button + tabindex 로 Tab 이동·Enter/Space 실행 가능
      return `<div class="card pp-card" data-id="${esc(p.id)}" role="button" tabindex="0"
        aria-label="제안 ${esc(p.title)} 상세 보기">
        <div class="pp-card-top">
          <span class="pp-badge ${b.cls}">${esc(b.label)}</span>
          ${p.category ? `<span class="pp-cat">${esc(p.category)}</span>` : ""}
        </div>
        <h3>${esc(p.title)}</h3>
        <div class="pp-card-meta">
          <span class="pp-like"><svg class="ic ic-in" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 21V10l4.5-7 1 .6a2 2 0 0 1 .9 2.2L12.5 9H19a2 2 0 0 1 2 2.4l-1.5 7A2.4 2.4 0 0 1 17 20.5H7z"/><path d="M7 10.5H4V21h3"/></svg> ${Number(p.like_count) || 0}</span>
          <span class="pp-date">${fmtDate(p.created_at)}</span>
        </div>
      </div>`;
    }).join("");
    $("ppListMeta").textContent = `${pstate.items.length}개 표시`;
    $("ppMore").hidden = pstate.end;
    box.querySelectorAll(".pp-card").forEach((el) => {
      const open = () => openDetail(el.dataset.id);
      el.addEventListener("click", open);
      el.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open(); }
      });
    });
  }

  // ---------- 상세 ----------
  function findItem(id) { return pstate.items.find((x) => String(x.id) === String(id)) || null; }

  async function openDetail(id) {
    let p = findItem(id);
    const client = getClient();
    // 항상 최신값으로 갱신 시도(목록 캐시가 오래됐을 수 있음)
    if (client) {
      try {
        const { data, error } = await client.from("proposals").select(COLS_DETAIL).eq("id", id).single();
        if (!error && data) p = data;
      } catch (e) {}
    }
    if (!p) { appAlert("제안을 찾을 수 없습니다."); return; }
    currentP = p;
    $("topTitle").textContent = "제안 상세";
    renderDetail(p);
    showView("pdetail");
  }

  function renderDetail(p) {
    const b = STATUS_BADGE[p.status] || STATUS_BADGE["접수"];
    const liked = likedSet().has(String(p.id));
    const timeline = STATUS_ORDER.map((s) => {
      // 현재 상태 이전 단계는 완료, 현재는 강조, 이후는 흐리게(반영/불채택/보류는 종결 분기)
      let state = "future";
      if (s === p.status) state = "current";
      else {
        const cur = STATUS_ORDER.indexOf(p.status);
        const idx = STATUS_ORDER.indexOf(s);
        if (idx < cur && idx <= 1) state = "past"; // 접수·검토중만 선후 관계
      }
      // 종결 상태(반영/불채택/보류)는 현재 상태가 아니면 숨기지 않고 흐리게 표시
      return `<li class="tl-${state}"><span class="tl-dot"></span>${esc(STATUS_BADGE[s].label)}</li>`;
    }).join("");

    const reply = (p.admin_reply || "").trim();
    $("pdetailContent").innerHTML = `
      <div class="pd-head">
        <span class="pp-badge ${b.cls}">${esc(b.label)}</span>
        ${p.category ? `<span class="pp-cat">${esc(p.category)}</span>` : ""}
      </div>
      <h2 class="pd-title">${esc(p.title)}</h2>
      <div class="pd-meta">닉네임 <b>${esc(p.author_nick || "익명")}</b>${p.region ? " · " + esc(p.region) : ""} · ${fmtDate(p.created_at)}</div>
      <div class="pd-body">${esc(p.body)}</div>

      <div class="pd-like-box">
        <div class="pd-like-count" aria-live="polite"><svg class="ic ic-in" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 21V10l4.5-7 1 .6a2 2 0 0 1 .9 2.2L12.5 9H19a2 2 0 0 1 2 2.4l-1.5 7A2.4 2.4 0 0 1 17 20.5H7z"/><path d="M7 10.5H4V21h3"/></svg> 공감 <b id="pdLikeCount">${Number(p.like_count) || 0}</b></div>
        <button id="pdLikeBtn" class="big-btn full ${liked ? "pp-liked" : "primary"}">${liked ? "공감함 (취소)" : "공감하기"}</button>
      </div>

      <div class="pd-section-title">진행 상황</div>
      <ul class="pd-timeline">${timeline}</ul>

      ${reply ? `<div class="pd-reply"><div class="pd-reply-title"><svg class="ic ic-in" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 14a3 3 0 0 1-3 3H8l-5 4V6a3 3 0 0 1 3-3h12a3 3 0 0 1 3 3z"/></svg> 담당부서 답변</div><div class="pd-reply-body">${esc(reply)}</div></div>` : ""}

      <div class="pd-actions">
        <button id="pdEditDel" class="big-btn full">본인 글 수정/삭제 (PIN)</button>
        <button id="pdReport" class="big-btn full pp-ghost" aria-label="이 제안 신고하기"><svg class="ic ic-in" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 21V4"/><path d="M6 5h11l-2 3.6 2 3.6H6"/></svg> 신고</button>
      </div>
      <p class="apply-note">※ 본 제안은 참고용 의견수렴이며 법적 효력이 없습니다.</p>
    `;
    $("pdLikeBtn").addEventListener("click", () => toggleLike(p));
    $("pdEditDel").addEventListener("click", () => openPinModal(p));
    $("pdReport").addEventListener("click", () => openReportModal(p));
  }

  // ---------- 공감(토글) ----------
  async function toggleLike(p) {
    const client = getClient();
    if (!client) { appAlert("공감 기능을 사용할 수 없습니다.\n(DB 설정 적용 후 가능)"); return; }
    const btn = $("pdLikeBtn");
    btn.disabled = true;
    try {
      const { data, error } = await client.rpc("like_proposal", { p_id: p.id, p_voter: voterKey() });
      if (error) throw error;
      // RPC 가 새 like_count 반환
      const newCount = (typeof data === "number") ? data : (data && data.like_count != null ? data.like_count : null);
      const set = likedSet();
      const wasLiked = set.has(String(p.id));
      if (wasLiked) set.delete(String(p.id)); else set.add(String(p.id));
      saveLiked(set);
      const nowLiked = !wasLiked;
      if (newCount != null) {
        $("pdLikeCount").textContent = newCount;
        p.like_count = newCount;
      }
      // 규격서 14절 «공감 하트» — 눌리면 살짝 커졌다 제자리(.25s), 숫자도 함께 바뀐다.
      //   ⚠ 정보를 움직임에만 담지 않는다: 숫자·버튼 글자(「공감함 (취소)」)가 결과를 말한다.
      //   ⚠ 저감모션 설정에서는 CSS 가 이 애니메이션을 끈다(클래스는 붙되 움직이지 않는다).
      const likeBox = document.querySelector(".pd-like-count");
      if (likeBox) {
        likeBox.classList.remove("like-pop");
        void likeBox.offsetWidth;              // 다시 재생되도록 흐름을 한 번 끊는다
        likeBox.classList.add("like-pop");
      }
      btn.textContent = nowLiked ? "공감함 (취소)" : "공감하기";
      btn.classList.toggle("pp-liked", nowLiked);
      btn.classList.toggle("primary", !nowLiked);
    } catch (e) {
      console.warn("[정책참여] 공감 실패:", e);
      appAlert(actionErrMsg(e, "공감 처리"));
    } finally {
      btn.disabled = false;
    }
  }

  // ---------- 작성 ----------
  // 전화번호·주민번호 패턴(개인정보) 간이 감지
  const RE_PHONE = /01[016789][-\s.]?\d{3,4}[-\s.]?\d{4}/;
  const RE_JUMIN = /\d{6}[-\s]?\d{7}/;

  function openWrite() {
    fillCategorySelects();
    resetWriteForm();   // 수정 모드 흔적 제거(제목·버튼 라벨 복원)
    $("topTitle").textContent = "정책 제안하기";
    $("pwTitle").value = "";
    $("pwBody").value = "";
    $("pwNick").value = "";
    // 🏘 읍·면·동 — 목록은 app.js fillRegionSelect(=data.json 단일 출처)가 채운다.
    //    ⛔ 여기에 행정구역을 적어 넣지 말 것(두 곳이 어긋난다).
    if (window.fillRegionSelect) window.fillRegionSelect($("pwRegion"), "");
    else $("pwRegion").value = "";
    setPwRegionErr("");
    $("pwPin").value = "";
    $("pwHoney").value = "";
    // ⛖ 개인정보 수집·이용 동의는 «올릴 때마다» 새로 받는다.
    if ($("pwConsent")) $("pwConsent").checked = false;
    setPwConsentErr("");
    $("pwAgree").checked = false;
    showView("pwrite");
  }

  async function submitWrite() {
    // 허니팟: 사람이면 비어있음 → 값이 있으면 봇으로 보고 조용히 무시
    if ($("pwHoney").value.trim() !== "") { return; }

    const title = $("pwTitle").value.trim();
    const body = $("pwBody").value.trim();
    const nick = $("pwNick").value.trim();
    const region = $("pwRegion").value.trim();
    const pin = $("pwPin").value.trim();
    const cat = $("pwCategory").value;

    if (!title) { appAlert("제목을 입력해 주세요."); return; }
    if (title.length > 80) { appAlert("제목은 80자 이내로 적어주세요."); return; }
    if (!body) { appAlert("내용을 입력해 주세요."); return; }
    if (body.length > 2000) { appAlert("내용은 2000자 이내로 적어주세요."); return; }
    if (!nick) { appAlert("닉네임을 입력해 주세요. (실명 금지)"); return; }
    /* 🏘 읍·면·동(필수) — 2026-08-20 양호창님 지시. 지역별 정책 수요를 세기 위한 값이다.
       ⚠ 「기타·타지역」이 목록에 있으므로 상주시민이 아니어도 막히지 않는다.
       ⚠ 목록이 아예 없는 환경(옛 data.json)에서는 검사하지 않는다 —
          고를 수가 없는데 막으면 제안 자체가 불가능해진다(기존 방어 원칙).
       ⚠ 안내는 alert() 가 아니라 «그 칸 옆»에 붙인다(수집동의와 같은 방식). */
    if (window.regionList && window.regionList().length && !region) {
      setPwRegionErr("사시는 읍·면·동을 골라 주세요.");
      try { $("pwRegion").focus(); } catch (e) { /* 무시 */ }
      return;
    }
    if (!/^\d{4}$/.test(pin)) { appAlert("수정용 PIN은 숫자 4자리로 입력해 주세요."); return; }
    /* ⚖ 개인정보 수집·이용 동의(필수) — 개인정보 보호법 §15.
       ⛔ 아래 pwAgree(콘텐츠 서약)와 «합치지 말 것» — 목적이 다르면 둘 다 무효가 된다.
       안내는 alert() 가 아니라 «그 칸 옆»에 붙인다(role="alert" 로 낙독기가 그 자리에서 읽는다). */
    if ($("pwConsent") && !$("pwConsent").checked) {
      setPwConsentErr("개인정보 수집·이용에 동의하셔야 제안을 올리실 수 있습니다.");
      try { $("pwConsent").focus(); } catch (e) { /* 무시 */ }
      return;
    }
    if (!$("pwAgree").checked) { appAlert("동의 항목에 체크해 주세요."); return; }

    const combined = title + " " + body + " " + nick;
    if (RE_JUMIN.test(combined)) { appAlert("주민등록번호로 보이는 숫자가 있습니다.\n개인정보는 입력할 수 없습니다."); return; }
    if (RE_PHONE.test(combined)) { appAlert("전화번호로 보이는 숫자가 있습니다.\n개인정보는 입력하지 말아주세요."); return; }

    const client = getClient();
    if (!client) { appAlert("제안 등록 기능을 사용할 수 없습니다.\n(DB 설정(SQL) 적용 후 가능합니다.)"); return; }

    const btn = $("pwSubmit");
    const orig = btn.textContent;
    btn.disabled = true; btn.textContent = "등록 중...";
    try {
      const { data, error } = await client.rpc("create_proposal", {
        p_title: title, p_body: body, p_category: cat,
        p_nick: nick, p_region: region || null, p_pin: pin,
      });
      if (error) throw error;
      // 이 기기에 «제안 번호»를 남긴다 → 「내 신청 › 제안한 정책」에서 상태를 볼 수 있다.
      //   create_proposal 은 proposals 행을 통째로 돌려준다(supabase/phaseA_policy.sql).
      //   ⚠ 서버가 행을 안 주는 환경이라도 등록 자체는 성공이므로 «조용히» 넘어간다.
      if (data && data.id != null) {
        saveMine({ id: data.id, title: data.title || title, at: data.created_at || new Date().toISOString() });
      }
      /* ✅ «정상으로 마쳤을 때» 해야 할 뒷정리 — 순서가 곧 사용자 경험이다(2026-08-20).
         ① 버튼을 되살린다   — 알림보다 «먼저». 안 그러면 「등록 중…」에 멈춘 것으로 보인다.
         ② 작성 칸을 비운다  — 안 비우면 뒤로 갈 때 「작성 중인 내용이 사라집니다」가 뜬다.
                               («제대로 올렸는데 왜 묻나» — 양호창님이 실제로 겪으신 결함)
         ③ 곶감 톡          — 신청 완료와 «같은» 연출(app.js playGotgam)
         ④ 알림창을 닫을 때까지 기다린다
         ⑤ 그 «다음»에 목록으로 돌아가 새로고침
       ⛔ ④와 ⑤의 차례를 바꾸지 말 것.
          goBack() 은 history.back() 이라 popstate 가 «한 박자 뒤»에 온다.
          알림창을 먼저 띄우면 그 popstate 가 «맨 위 모달»인 알림창을 닫아 버려,
          알림이 번쩍이고 사라지면서 목록으로도 못 돌아간다(실제로 그렇게 된다). */
      btn.disabled = false; btn.textContent = orig;      // ①
      clearWriteFields();                                // ②
      resetWriteForm();
      if (window.playGotgam) window.playGotgam("floatGotgam");   // ③
      await appAlert("제안이 등록되었습니다. 감사합니다!", { title: "등록 완료" });  // ④
      goBack();                                          // ⑤
      pstate.sort = "new";
      if ($("ppSort")) $("ppSort").value = "new";
      reload();
    } catch (e) {
      console.warn("[정책참여] 제안 등록 실패:", e);
      appAlert(actionErrMsg(e, "제안 등록"));
    } finally {
      /* 실패·중단했을 때 버튼이 「등록 중…」에 갇히지 않게 하는 마지막 안전장치.
         성공 경로는 위 ①에서 이미 되살리고 라벨도 새로 정했으므로,
         «아직 바쁜 상태로 남아 있을 때»만 되돌린다(라벨이 되돌아가 어긋나지 않게). */
      if (btn.disabled) { btn.disabled = false; btn.textContent = orig; }
    }
  }

  // ---------- 본인 수정/삭제(PIN) ----------
  let pinTarget = null;
  function openPinModal(p) {
    pinTarget = p;
    $("pinInput").value = "";
    $("pinModal").hidden = false;
    if (window.ModalA11y) window.ModalA11y.open("pinModal", closePinModal);  // 포커스 트랩·Esc·복귀
  }
  function closePinModal() {
    $("pinModal").hidden = true;
    pinTarget = null;
    if (window.ModalA11y) window.ModalA11y.close("pinModal");
    syncRtBanner();   // 모달 중 쌓인 알림을 다시 계산(안 하면 영영 안 뜬다)
  }

  async function doPinDelete() {
    const pin = $("pinInput").value.trim();
    if (!/^\d{4}$/.test(pin)) { appAlert("PIN 4자리를 입력해 주세요.\n\nPIN이 기억나지 않으면 화면 아래 «오류 문의»로 연락 주시면 확인 후 도와드립니다."); return; }
    if (!(await appConfirm("정말 이 제안을 삭제할까요?\n되돌릴 수 없습니다.",
      { title: "제안을 지울까요?", okText: "삭제" }))) return;
    const client = getClient();
    if (!client || !pinTarget) { appAlert("삭제할 수 없습니다.\n(DB 설정 적용 후 가능)"); return; }
    try {
      const { error } = await client.rpc("delete_proposal", { p_id: pinTarget.id, p_pin: pin });
      if (error) throw error;
      forgetMine(pinTarget.id);   // 「내 신청 › 제안한 정책」에서도 함께 지운다
      // ⛔ 차례를 바꾸지 말 것 — PIN 모달을 먼저 닫고, 알림을 닫은 «뒤»에 화면을 옮긴다.
      //    goBack() 의 popstate 가 «맨 위 모달»(알림창)을 대신 닫아 버리기 때문이다.
      closePinModal();
      await appAlert("삭제되었습니다.", { title: "삭제 완료" });
      goBack();          // 목록으로
      reload();
    } catch (e) {
      console.warn("[정책참여] 삭제 실패:", e);
      appAlert(errKind(e) === "conn" ? actionErrMsg(e, "삭제")
        : "삭제에 실패했습니다. PIN이 맞는지 확인해 주세요.\n\nPIN이 기억나지 않으면 화면 아래 «오류 문의»로 연락 주시면 확인 후 도와드립니다.");
    }
  }

  function doPinEdit() {
    const pin = $("pinInput").value.trim();
    if (!/^\d{4}$/.test(pin)) { appAlert("PIN 4자리를 입력해 주세요.\n\nPIN이 기억나지 않으면 화면 아래 «오류 문의»로 연락 주시면 확인 후 도와드립니다."); return; }
    if (!pinTarget) return;
    // 수정 화면 재사용: 작성 폼에 기존 내용 채우고 '수정 모드'로 전환
    fillCategorySelects();
    editing = { id: pinTarget.id, pin: pin };
    $("topTitle").textContent = "제안 수정하기";
    $("pwriteTitle").textContent = "제안 수정하기";
    $("pwTitle").value = pinTarget.title || "";
    $("pwBody").value = pinTarget.body || "";
    $("pwNick").value = pinTarget.author_nick || "";
    /* 🏘 읍·면·동 — 예전에는 자유 입력이라 「무양」·「상주 무양동」 같은 값이 있다.
       그대로 넣으면 목록에 없어 select 가 «조용히» 값을 버린다 → 시민이 적어 둔 동네가 사라진다.
       fillRegionSelect 의 keep 인자가 그런 값을 «(예전 입력)» 항목으로 맨 앞에 넣어 살려 둔다. */
    if (window.fillRegionSelect) window.fillRegionSelect($("pwRegion"), pinTarget.region || "");
    else $("pwRegion").value = pinTarget.region || "";
    setPwRegionErr("");
    $("pwPin").value = pin;
    $("pwHoney").value = "";
    // 이미 동의하고 올린 자신의 글을 고치는 중이므로 pwAgree 와 같이 켜 둔다.
    if ($("pwConsent")) $("pwConsent").checked = true;
    setPwConsentErr("");
    $("pwAgree").checked = true;
    if ($("pwCategory") && pinTarget.category) $("pwCategory").value = pinTarget.category;
    // 닉네임/PIN 은 수정 화면에서 변경해도 서버 edit_proposal 은 제목·내용·분야만 갱신
    $("pwSubmit").textContent = "수정 저장";
    closePinModal();
    showView("pwrite");
  }

  let editing = null;   // {id, pin} — 수정 모드일 때만 설정

  async function submitEdit() {
    const title = $("pwTitle").value.trim();
    const body = $("pwBody").value.trim();
    const cat = $("pwCategory").value;
    if (!title) { appAlert("제목을 입력해 주세요."); return; }
    if (!body) { appAlert("내용을 입력해 주세요."); return; }
    const combined = title + " " + body;
    if (RE_JUMIN.test(combined)) { appAlert("주민등록번호로 보이는 숫자가 있습니다."); return; }
    if (RE_PHONE.test(combined)) { appAlert("전화번호로 보이는 숫자가 있습니다."); return; }
    const client = getClient();
    if (!client) { appAlert("수정할 수 없습니다.\n(DB 설정 적용 후 가능)"); return; }

    const btn = $("pwSubmit");
    const orig = btn.textContent;
    btn.disabled = true; btn.textContent = "저장 중...";
    try {
      const { error } = await client.rpc("edit_proposal", {
        p_id: editing.id, p_pin: editing.pin,
        p_title: title, p_body: body, p_category: cat,
      });
      if (error) throw error;
      // 등록과 «같은 차례»로 마무리한다 — 버튼 원복 → 칸 비우기 → 곶감 톡 → 알림 → 이동.
      // (칸을 안 비우면 뒤로 갈 때 「작성 중인 내용이 사라집니다」가 떠 버린다)
      // ⛔ 알림과 goBack() 의 차례를 바꾸지 말 것 — submitWrite 의 주석 참조.
      btn.disabled = false; btn.textContent = orig;
      editing = null;
      clearWriteFields();
      resetWriteForm();
      if (window.playGotgam) window.playGotgam("floatGotgam");
      await appAlert("수정되었습니다.", { title: "수정 완료" });
      goBack();      // 상세→목록 또는 목록으로
      reload();
    } catch (e) {
      console.warn("[정책참여] 수정 실패:", e);
      appAlert(errKind(e) === "conn" ? actionErrMsg(e, "수정")
        : "수정에 실패했습니다. PIN이 맞는지 확인해 주세요.\n\nPIN이 기억나지 않으면 화면 아래 «오류 문의»로 연락 주시면 확인 후 도와드립니다.");
    } finally {
      // 등록과 «같은 규칙» — 성공 경로는 이미 되살렸으므로 바쁜 상태일 때만 되돌린다
      if (btn.disabled) { btn.disabled = false; btn.textContent = orig; }
    }
  }

  // 작성/수정 폼을 작성 기본 상태로 되돌린다
  function resetWriteForm() {
    editing = null;
    $("pwriteTitle").textContent = "정책 제안하기";
    $("pwSubmit").textContent = "제안 등록";
  }

  /* 작성 칸을 «비운다» — 등록·수정을 정상으로 마쳤을 때만 부른다 (2026-08-20).
     ⚠ 왜 필요한가: app.js 의 _isDirtyView() 는 pwrite 화면의
        pwTitle·pwBody·pwNick·pwRegion·pwPin 에 «한 글자라도» 남아 있으면 «작성 중»으로 본다.
        올리기를 마쳤는데 칸이 그대로면, 목록으로 돌아가는 그 순간
        「작성 중인 내용이 사라집니다. 나가시겠습니까?」가 떠 버린다.
     ⛔ 이 함수를 «취소·실패» 자리에서 부르지 말 것 — 그때는 쓰던 내용이 남아야 하고,
        경고도 그대로 떠야 한다(경고 자체를 없애는 것이 아니다).
     ⚠ 읍·면·동은 app.js fillRegionSelect 가 목록의 단일 출처다(openWrite 와 같은 방식). */
  function clearWriteFields() {
    ["pwTitle", "pwBody", "pwNick", "pwPin", "pwHoney"].forEach((id) => {
      const el = $(id);
      if (el) el.value = "";
    });
    const rg = $("pwRegion");
    if (rg) {
      if (window.fillRegionSelect) window.fillRegionSelect(rg, "");
      else rg.value = "";
    }
    setPwRegionErr("");
    setPwConsentErr("");
    if ($("pwConsent")) $("pwConsent").checked = false;
    if ($("pwAgree")) $("pwAgree").checked = false;
  }

  // ---------- 신고 ----------
  let reportTarget = null;
  function openReportModal(p) {
    reportTarget = p;
    $("reportReason").value = "욕설·비방";
    $("reportMemo").value = "";
    $("reportModal").hidden = false;
    if (window.ModalA11y) window.ModalA11y.open("reportModal", closeReportModal);  // 포커스 트랩·Esc·복귀
  }
  function closeReportModal() {
    $("reportModal").hidden = true;
    reportTarget = null;
    if (window.ModalA11y) window.ModalA11y.close("reportModal");
    syncRtBanner();   // 모달 중 쌓인 알림을 다시 계산(안 하면 영영 안 뜬다)
  }

  async function doReport() {
    const reason = $("reportReason").value + ($("reportMemo").value.trim() ? (" - " + $("reportMemo").value.trim()) : "");
    const client = getClient();
    if (!client || !reportTarget) { appAlert("신고할 수 없습니다.\n(DB 설정 적용 후 가능)"); return; }
    try {
      const { error } = await client.rpc("report_proposal", {
        p_id: reportTarget.id, p_reason: reason, p_reporter: voterKey(),
      });
      if (error) throw error;
      // 신고 모달을 «먼저» 닫고 알림을 띄운다(모달 두 겹이 겹쳐 보이지 않게)
      closeReportModal();
      appAlert("신고가 접수되었습니다. 검토 후 조치하겠습니다.", { title: "신고 접수" });
    } catch (e) {
      console.warn("[정책참여] 신고 실패:", e);
      appAlert(actionErrMsg(e, "신고"));
    }
  }

  // ---------- 실시간(선택) ----------
  // ⚠ 예전에는 새 데이터가 들어오면 목록을 즉시 갈아끼웠다. 보고 있던 위치가 사라지고,
  //    모달·작성 중이던 폼까지 영향을 받아 «정지 기능»(KWCAG 6.2.2)이 필요한 자동 변경이었다.
  //    → 이제는 화면을 건드리지 않고 누적 건수만 알림 띠로 알리고, 갱신은 사용자가 누를 때만 한다.
  let rtPending = 0;

  // 모달이 열려 있거나 제안을 작성 중이면 알림 띠도 띄우지 않는다(작업 방해 금지)
  function rtBusy() {
    return !$("pinModal").hidden || !$("reportModal").hidden || !$("view-pwrite").hidden;
  }

  function syncRtBanner() {
    const box = $("ppRtBanner");
    if (!box) return;
    const show = rtPending > 0 && !$("view-propose").hidden && !rtBusy();
    if (show) $("ppRtText").textContent = `새 제안·변경 ${rtPending}건이 있습니다`;
    box.hidden = !show;
  }

  function applyRtRefresh() {
    rtPending = 0;
    syncRtBanner();
    reload();
  }

  function subscribeRealtime() {
    const client = getClient();
    if (!client || realtimeSub) return;
    try {
      realtimeSub = client
        .channel("proposals-citizen")
        .on("postgres_changes", { event: "*", schema: "public", table: "proposals" }, () => {
          rtPending += 1;       // 화면은 그대로 두고 «알림»만
          syncRtBanner();
        })
        .subscribe();
    } catch (e) {
      console.warn("[정책참여] 실시간 구독 실패(무시):", e);
    }
  }

  async function refreshDetailQuietly() {
    const client = getClient();
    if (!client || !currentP) return;
    try {
      const { data, error } = await client.from("proposals").select(COLS_DETAIL).eq("id", currentP.id).single();
      if (!error && data && !$("view-pdetail").hidden) {
        currentP = data;
        renderDetail(data);
      }
    } catch (e) {}
  }

  // ---------- 이벤트 바인딩 ----------
  /* ── 「내 신청 › 제안한 정책」 목록 그리기 (app.js 가 부른다) ────────────────
     기기에 남긴 제안 번호로 서버에서 «지금 상태»를 다시 읽어 온다.
     ⚠ 방어 원칙: 서버 미준비·조회 실패·번호 없음 → 모두 «없음»으로 조용히 끝낸다.
        이 목록 때문에 「내 신청」 화면이 깨지는 일은 없어야 한다.
     ⚠ 신청(ms-card)과 «같은 카드 모양»을 쓰되, 배지는 제안 상태(접수/검토중/반영…)다.
        신청 상태(접수/심사중/승인/반려)와 값이 다르므로 절대 섞지 않는다. */
  async function renderMine(boxId) {
    const box = $(boxId || "mpList");
    if (!box) return;
    const mine = loadMine();
    if (!mine.length) {
      box.innerHTML = `<div class="ms-empty"><p>이 휴대폰에서 올리신 정책제안이 없습니다.</p>
        <p>「정책 제안」에서 제안을 올리시면 이곳에서 검토 진행 상태를 보실 수 있습니다.</p></div>`;
      return;
    }
    const client = getClient();
    let rows = [];
    if (client) {
      if (window.skeletonHtml) box.innerHTML = window.skeletonHtml(Math.min(mine.length, 3));
      try {
        const ids = mine.map((e) => e.id);
        const { data, error } = await client.from("proposals").select(COLS_LIST).in("id", ids);
        if (error) throw error;
        rows = data || [];
      } catch (e) {
        console.warn("[정책참여] 내 제안 조회 실패:", e);
        rows = [];
      }
    }
    if (!rows.length) {
      box.innerHTML = `<div class="ms-empty"><p>지금은 제안의 진행 상태를 불러오지 못했습니다.</p>
        <p>인터넷 연결을 확인하신 뒤 이 화면을 다시 열어 주세요.</p></div>`;
      return;
    }
    // 기기에 남긴 순서(최근 등록이 위)를 그대로 따른다 — 서버 반환 순서는 보장되지 않는다.
    const order = {};
    mine.forEach((e, i) => { order[String(e.id)] = i; });
    rows.sort((a, b) => (order[String(a.id)] ?? 999) - (order[String(b.id)] ?? 999));

    box.innerHTML = rows.map((p) => {
      const b = STATUS_BADGE[p.status] || STATUS_BADGE["접수"];
      return `<div class="ms-card">
        <div class="ms-card-top">
          <span class="pp-badge ${b.cls}">${esc(b.label)}</span>
          ${p.category ? `<span class="pp-cat">${esc(p.category)}</span>` : ""}
        </div>
        <div class="ms-card-title"><button class="ms-open" type="button" data-id="${esc(p.id)}">${esc(p.title)}<span class="ms-open-go" aria-hidden="true">제안 내용 보기 ›</span></button></div>
        <div class="ms-card-meta">올린 날 ${esc(fmtDate(p.created_at))} · 공감 ${Number(p.like_count) || 0}</div>
      </div>`;
    }).join("");
    box.querySelectorAll(".ms-open").forEach((btn) => {
      btn.addEventListener("click", () => openDetail(btn.dataset.id));
    });
  }

  function bind() {
    // 실시간 알림 띠의 «새로고침» — 목록 갱신은 오직 이 클릭으로만 일어난다
    if ($("ppRtBtn")) $("ppRtBtn").addEventListener("click", applyRtRefresh);
    // PIN 분실 안내 → 오류 문의 화면으로(실제 PIN 재설정은 서버 인증이 필요해 범위 밖)
    ["pwPinHelp", "pinHelp"].forEach((id) => {
      const b = $(id);
      if (b) b.addEventListener("click", () => {
        if (!$("pinModal").hidden) closePinModal();
        if (window.openInquiry) window.openInquiry();
      });
    });
    if ($("ppNew")) $("ppNew").addEventListener("click", openWrite);
    if ($("ppMore")) $("ppMore").addEventListener("click", loadMore);
    if ($("ppCategory")) $("ppCategory").addEventListener("change", (e) => { pstate.cat = e.target.value; reload(); });
    if ($("ppSort")) $("ppSort").addEventListener("change", (e) => { pstate.sort = e.target.value; reload(); });

    if ($("pwSubmit")) $("pwSubmit").addEventListener("click", () => {
      if (editing) submitEdit(); else submitWrite();
    });
    // 체크하면 그 자리의 안내를 곧바로 지운다(고쳤는데 빨간 글씨가 남지 않게 — 신청 폼과 같은 규약)
    if ($("pwConsent")) $("pwConsent").addEventListener("change", () => {
      if ($("pwConsent").checked) setPwConsentErr("");
    });
    // 🏘 읍·면·동을 고르면 그 자리의 안내를 곧바로 지운다(신청 폼과 같은 규약)
    if ($("pwRegion")) $("pwRegion").addEventListener("change", () => {
      if ($("pwRegion").value) setPwRegionErr("");
    });
    // PIN은 숫자만
    if ($("pwPin")) $("pwPin").addEventListener("input", (e) => { e.target.value = e.target.value.replace(/[^0-9]/g, ""); });
    if ($("pinInput")) $("pinInput").addEventListener("input", (e) => { e.target.value = e.target.value.replace(/[^0-9]/g, ""); });

    // PIN 모달
    if ($("pinEdit")) $("pinEdit").addEventListener("click", doPinEdit);
    if ($("pinDelete")) $("pinDelete").addEventListener("click", doPinDelete);
    if ($("pinCancel")) $("pinCancel").addEventListener("click", closePinModal);
    if ($("pinModal")) $("pinModal").addEventListener("click", (e) => { if (e.target.id === "pinModal") closePinModal(); });

    // 신고 모달
    if ($("reportSend")) $("reportSend").addEventListener("click", doReport);
    if ($("reportCancel")) $("reportCancel").addEventListener("click", closeReportModal);
    if ($("reportModal")) $("reportModal").addEventListener("click", (e) => { if (e.target.id === "reportModal") closeReportModal(); });
  }

  // app.js init() 가 끝난 뒤(DOM 준비됨) 바인딩. app.js 는 즉시 init() 호출 → DOM 완성 시점 보장 위해 약간 지연.
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bind);
  } else {
    bind();
  }

  // app.js 가 쓰는 전역 노출
  // syncNotice: 화면이 바뀔 때 app.js 의 showView 가 불러 준다.
  // 상세·작성 화면에 있는 동안 도착한 알림은 띠가 숨겨진 채 카운트만 쌓이므로,
  // 목록으로 돌아왔을 때 다시 계산해 주지 않으면 알림이 영영 안 뜬다.
  // renderMine: 「내 신청 › 제안한 정책」 목록을 그린다(app.js msLoadMyProposals 가 부른다).
  window.Proposals = { open, openWrite, resetWriteForm, syncNotice: syncRtBanner, renderMine };
})();
