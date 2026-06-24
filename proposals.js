// 상주시 정책 플랫폼 — 정책참여(시민 제안) Phase A
// Supabase 라이브 read/write. 익명 제안·공감·본인수정/삭제(PIN)·신고.
// app.js 의 전역 헬퍼($, esc, showView, DATA, state)를 그대로 사용한다.
// 기존 지원사업(data.json) 기능과 완전히 분리되어 있어 서로 영향 없음.

"use strict";

(function () {
  // ---------- Supabase 클라이언트 (지연 초기화) ----------
  let sb = null;
  function getClient() {
    if (sb) return sb;
    try {
      if (!window.supabase || !window.SUPABASE_URL || !window.SUPABASE_ANON_KEY) return null;
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

  // ---------- 상태 ----------
  const PAGE = 20;
  const pstate = { cat: "", sort: "new", page: 0, items: [], end: false, loading: false };
  let currentP = null;        // 현재 상세에서 보고 있는 제안
  let realtimeSub = null;

  const STATUS_BADGE = {
    "접수": { cls: "st-accept", label: "접수" },
    "검토중": { cls: "st-review", label: "검토중" },
    "반영": { cls: "st-done", label: "반영 ✅" },
    "불채택": { cls: "st-reject", label: "불채택" },
    "보류": { cls: "st-hold", label: "보류" },
  };
  const STATUS_ORDER = ["접수", "검토중", "반영", "불채택", "보류"];

  const $ = (id) => document.getElementById(id);
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

  function dbUnavailableMsg() {
    return `<div class="empty">정책참여 기능을 불러올 수 없습니다.<br>
      (DB 설정(SQL) 적용 후 이용 가능합니다.)<br>
      잠시 후 다시 시도해 주세요.</div>`;
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

    const from = pstate.page * PAGE;
    const to = from + PAGE - 1;
    let q = client.from("proposals").select("*").eq("is_hidden", false);
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
      if (pstate.items.length === 0) $("ppList").innerHTML = dbUnavailableMsg();
      pstate.end = true;
      $("ppMore").hidden = true;
    } finally {
      pstate.loading = false;
    }
  }

  function renderList() {
    const box = $("ppList");
    if (pstate.items.length === 0) {
      box.innerHTML = `<div class="empty">아직 등록된 제안이 없습니다.<br>첫 제안을 남겨보세요! 🗳</div>`;
      $("ppListMeta").textContent = "0개";
      $("ppMore").hidden = true;
      return;
    }
    box.innerHTML = pstate.items.map((p) => {
      const b = STATUS_BADGE[p.status] || STATUS_BADGE["접수"];
      return `<div class="card pp-card" data-id="${esc(p.id)}">
        <div class="pp-card-top">
          <span class="pp-badge ${b.cls}">${esc(b.label)}</span>
          ${p.category ? `<span class="pp-cat">${esc(p.category)}</span>` : ""}
        </div>
        <h3>${esc(p.title)}</h3>
        <div class="pp-card-meta">
          <span class="pp-like">👍 ${Number(p.like_count) || 0}</span>
          <span class="pp-date">${fmtDate(p.created_at)}</span>
        </div>
      </div>`;
    }).join("");
    $("ppListMeta").textContent = `${pstate.items.length}개 표시`;
    $("ppMore").hidden = pstate.end;
    box.querySelectorAll(".pp-card").forEach((el) => {
      el.addEventListener("click", () => openDetail(el.dataset.id));
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
        const { data, error } = await client.from("proposals").select("*").eq("id", id).single();
        if (!error && data) p = data;
      } catch (e) {}
    }
    if (!p) { alert("제안을 찾을 수 없습니다."); return; }
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
        <div class="pd-like-count">👍 공감 <b id="pdLikeCount">${Number(p.like_count) || 0}</b></div>
        <button id="pdLikeBtn" class="big-btn full ${liked ? "pp-liked" : "primary"}">${liked ? "👍 공감함 (취소)" : "👍 공감하기"}</button>
      </div>

      <div class="pd-section-title">진행 상황</div>
      <ul class="pd-timeline">${timeline}</ul>

      ${reply ? `<div class="pd-reply"><div class="pd-reply-title">💬 담당부서 답변</div><div class="pd-reply-body">${esc(reply)}</div></div>` : ""}

      <div class="pd-actions">
        <button id="pdEditDel" class="big-btn full">본인 글 수정/삭제 (PIN)</button>
        <button id="pdReport" class="big-btn full pp-ghost">🚩 신고</button>
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
    if (!client) { alert("공감 기능을 사용할 수 없습니다.\n(DB 설정 적용 후 가능)"); return; }
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
      btn.textContent = nowLiked ? "👍 공감함 (취소)" : "👍 공감하기";
      btn.classList.toggle("pp-liked", nowLiked);
      btn.classList.toggle("primary", !nowLiked);
    } catch (e) {
      console.warn("[정책참여] 공감 실패:", e);
      alert("공감 처리에 실패했습니다.\n잠시 후 다시 시도해 주세요.\n(DB 설정 미적용 시 동작하지 않습니다.)");
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
    $("pwRegion").value = "";
    $("pwPin").value = "";
    $("pwHoney").value = "";
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

    if (!title) { alert("제목을 입력해 주세요."); return; }
    if (title.length > 80) { alert("제목은 80자 이내로 적어주세요."); return; }
    if (!body) { alert("내용을 입력해 주세요."); return; }
    if (body.length > 2000) { alert("내용은 2000자 이내로 적어주세요."); return; }
    if (!nick) { alert("닉네임을 입력해 주세요. (실명 금지)"); return; }
    if (!/^\d{4}$/.test(pin)) { alert("수정용 PIN은 숫자 4자리로 입력해 주세요."); return; }
    if (!$("pwAgree").checked) { alert("동의 항목에 체크해 주세요."); return; }

    const combined = title + " " + body + " " + nick;
    if (RE_JUMIN.test(combined)) { alert("주민등록번호로 보이는 숫자가 있습니다.\n개인정보는 입력할 수 없습니다."); return; }
    if (RE_PHONE.test(combined)) { alert("전화번호로 보이는 숫자가 있습니다.\n개인정보는 입력하지 말아주세요."); return; }

    const client = getClient();
    if (!client) { alert("제안 등록 기능을 사용할 수 없습니다.\n(DB 설정(SQL) 적용 후 가능합니다.)"); return; }

    const btn = $("pwSubmit");
    const orig = btn.textContent;
    btn.disabled = true; btn.textContent = "등록 중...";
    try {
      const { data, error } = await client.rpc("create_proposal", {
        p_title: title, p_body: body, p_category: cat,
        p_nick: nick, p_region: region || null, p_pin: pin,
      });
      if (error) throw error;
      alert("제안이 등록되었습니다. 감사합니다! 🗳");
      // 목록으로 복귀 + 새로고침
      goBack();
      pstate.sort = "new";
      if ($("ppSort")) $("ppSort").value = "new";
      reload();
    } catch (e) {
      console.warn("[정책참여] 제안 등록 실패:", e);
      alert("제안 등록에 실패했습니다.\n잠시 후 다시 시도해 주세요.\n(DB 설정 미적용 시 동작하지 않습니다.)");
    } finally {
      btn.disabled = false; btn.textContent = orig;
    }
  }

  // ---------- 본인 수정/삭제(PIN) ----------
  let pinTarget = null;
  function openPinModal(p) {
    pinTarget = p;
    $("pinInput").value = "";
    $("pinModal").hidden = false;
  }
  function closePinModal() { $("pinModal").hidden = true; pinTarget = null; }

  async function doPinDelete() {
    const pin = $("pinInput").value.trim();
    if (!/^\d{4}$/.test(pin)) { alert("PIN 4자리를 입력해 주세요."); return; }
    if (!confirm("정말 이 제안을 삭제할까요? 되돌릴 수 없습니다.")) return;
    const client = getClient();
    if (!client || !pinTarget) { alert("삭제할 수 없습니다.\n(DB 설정 적용 후 가능)"); return; }
    try {
      const { error } = await client.rpc("delete_proposal", { p_id: pinTarget.id, p_pin: pin });
      if (error) throw error;
      alert("삭제되었습니다.");
      closePinModal();
      goBack();          // 목록으로
      reload();
    } catch (e) {
      console.warn("[정책참여] 삭제 실패:", e);
      alert("삭제에 실패했습니다. PIN이 맞는지 확인해 주세요.");
    }
  }

  function doPinEdit() {
    const pin = $("pinInput").value.trim();
    if (!/^\d{4}$/.test(pin)) { alert("PIN 4자리를 입력해 주세요."); return; }
    if (!pinTarget) return;
    // 수정 화면 재사용: 작성 폼에 기존 내용 채우고 '수정 모드'로 전환
    fillCategorySelects();
    editing = { id: pinTarget.id, pin: pin };
    $("topTitle").textContent = "제안 수정하기";
    $("pwriteTitle").textContent = "✏ 제안 수정하기";
    $("pwTitle").value = pinTarget.title || "";
    $("pwBody").value = pinTarget.body || "";
    $("pwNick").value = pinTarget.author_nick || "";
    $("pwRegion").value = pinTarget.region || "";
    $("pwPin").value = pin;
    $("pwHoney").value = "";
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
    if (!title) { alert("제목을 입력해 주세요."); return; }
    if (!body) { alert("내용을 입력해 주세요."); return; }
    const combined = title + " " + body;
    if (RE_JUMIN.test(combined)) { alert("주민등록번호로 보이는 숫자가 있습니다."); return; }
    if (RE_PHONE.test(combined)) { alert("전화번호로 보이는 숫자가 있습니다."); return; }
    const client = getClient();
    if (!client) { alert("수정할 수 없습니다.\n(DB 설정 적용 후 가능)"); return; }

    const btn = $("pwSubmit");
    const orig = btn.textContent;
    btn.disabled = true; btn.textContent = "저장 중...";
    try {
      const { error } = await client.rpc("edit_proposal", {
        p_id: editing.id, p_pin: editing.pin,
        p_title: title, p_body: body, p_category: cat,
      });
      if (error) throw error;
      alert("수정되었습니다.");
      editing = null;
      resetWriteForm();
      goBack();      // 상세→목록 또는 목록으로
      reload();
    } catch (e) {
      console.warn("[정책참여] 수정 실패:", e);
      alert("수정에 실패했습니다. PIN이 맞는지 확인해 주세요.");
    } finally {
      btn.disabled = false; btn.textContent = orig;
    }
  }

  // 작성/수정 폼을 작성 기본 상태로 되돌린다
  function resetWriteForm() {
    editing = null;
    $("pwriteTitle").textContent = "🗳 정책 제안하기";
    $("pwSubmit").textContent = "제안 등록";
  }

  // ---------- 신고 ----------
  let reportTarget = null;
  function openReportModal(p) {
    reportTarget = p;
    $("reportReason").value = "욕설·비방";
    $("reportMemo").value = "";
    $("reportModal").hidden = false;
  }
  function closeReportModal() { $("reportModal").hidden = true; reportTarget = null; }

  async function doReport() {
    const reason = $("reportReason").value + ($("reportMemo").value.trim() ? (" - " + $("reportMemo").value.trim()) : "");
    const client = getClient();
    if (!client || !reportTarget) { alert("신고할 수 없습니다.\n(DB 설정 적용 후 가능)"); return; }
    try {
      const { error } = await client.rpc("report_proposal", {
        p_id: reportTarget.id, p_reason: reason, p_reporter: voterKey(),
      });
      if (error) throw error;
      alert("신고가 접수되었습니다. 검토 후 조치하겠습니다.");
      closeReportModal();
    } catch (e) {
      console.warn("[정책참여] 신고 실패:", e);
      alert("신고에 실패했습니다.\n잠시 후 다시 시도해 주세요.");
    }
  }

  // ---------- 실시간(선택) ----------
  function subscribeRealtime() {
    const client = getClient();
    if (!client || realtimeSub) return;
    try {
      realtimeSub = client
        .channel("proposals-citizen")
        .on("postgres_changes", { event: "*", schema: "public", table: "proposals" }, () => {
          // 목록 화면일 때만 가볍게 새로고침
          if (!$("view-propose").hidden) reload();
          // 상세 화면이면 현재 글 공감수·상태 갱신
          else if (!$("view-pdetail").hidden && currentP) refreshDetailQuietly();
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
      const { data, error } = await client.from("proposals").select("*").eq("id", currentP.id).single();
      if (!error && data && !$("view-pdetail").hidden) {
        currentP = data;
        renderDetail(data);
      }
    } catch (e) {}
  }

  // ---------- 이벤트 바인딩 ----------
  function bind() {
    if ($("ppNew")) $("ppNew").addEventListener("click", openWrite);
    if ($("ppMore")) $("ppMore").addEventListener("click", loadMore);
    if ($("ppCategory")) $("ppCategory").addEventListener("change", (e) => { pstate.cat = e.target.value; reload(); });
    if ($("ppSort")) $("ppSort").addEventListener("change", (e) => { pstate.sort = e.target.value; reload(); });

    if ($("pwSubmit")) $("pwSubmit").addEventListener("click", () => {
      if (editing) submitEdit(); else submitWrite();
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
  window.Proposals = { open, openWrite, resetWriteForm };
})();
