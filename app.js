// 상주시 정책 플랫폼 — 모바일 웹앱 (서버 없는 정적 MVP)
// data.json(빌드 산출물)을 읽어 검색·맞춤추천·상세·신청(이메일)을 제공한다.

"use strict";

let DATA = null;
const state = { selectedCats: new Set(), situations: new Set(), navStack: [], fwdStack: [] };

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

const VIEWS = ["home", "list", "recommend", "detail", "apply", "inquiry", "done"];

// 오류 문의가 전달될 주소(표시용). 실제 발송은 폼메일→Gmail→자동접수가 이 주소로 전달.
const SUPPORT_EMAIL = "hcyang572@korea.kr";

const HOME_TITLE = "상주시 정책 플랫폼";

// 내비 스택 항목은 {v: 화면이름, t: 제목}. 뒤로/이후 시 제목까지 복원한다.
function showView(name, push = true) {
  VIEWS.forEach((v) => { $("view-" + v).hidden = v !== name; });
  $("topSub").hidden = name !== "home";   // 부제는 홈에서만 제목 옆에 표시
  if (push) {
    const top = state.navStack[state.navStack.length - 1];
    if (!top || top.v !== name) {
      state.navStack.push({ v: name, t: $("topTitle").textContent });
      state.fwdStack = [];   // 새 이동 → 앞으로(이후) 기록 초기화
    }
  }
  _updateNavButtons();
  window.scrollTo(0, 0);
}

function _updateNavButtons() {
  const canBack = state.navStack.length > 1;
  $("backBtn").hidden = !canBack;
  $("fabBack").hidden = !canBack;
}

function goBack() {
  if (state.navStack.length <= 1) return;
  state.fwdStack.push(state.navStack.pop());     // 현재 화면을 '이후'로 보관
  const top = state.navStack[state.navStack.length - 1];
  $("topTitle").textContent = top.t;             // 이전 화면 제목 복원
  showView(top.v, false);
}

function goForward() {
  if (state.fwdStack.length === 0) return;
  const next = state.fwdStack.pop();
  state.navStack.push(next);
  $("topTitle").textContent = next.t;            // 이후 화면 제목 복원
  showView(next.v, false);
}

// ---------- 데이터 로딩 ----------
async function init() {
  try {
    const res = await fetch("data.json", { cache: "no-store" });
    DATA = await res.json();
  } catch (e) {
    $("app").innerHTML = '<p class="empty">데이터를 불러오지 못했습니다.<br>data.json 을 먼저 생성해 주세요 (build_data.py).</p>';
    return;
  }
  state.navStack = [{ v: "home", t: HOME_TITLE }];
  state.fwdStack = [];
  renderCategoryChips();
  renderSituations();
  bindEvents();
  showView("home", false);
  checkNewPrograms();
  initA2HS();
}

// ---------- 홈 화면에 추가(앱처럼 쓰기) 안내 ----------
const A2HS_DISMISS_KEY = "sangju_a2hs_dismissed";
function isStandalone() {
  // 이미 홈 화면 앱으로 실행 중이면 안내가 불필요
  return (window.matchMedia && window.matchMedia("(display-mode: standalone)").matches) ||
         window.navigator.standalone === true;
}
function initA2HS() {
  let dismissed = false;
  try { dismissed = localStorage.getItem(A2HS_DISMISS_KEY) === "1"; } catch (e) {}
  // 홈 상단 안내 띠: 한 번 닫았거나 이미 설치(standalone) 상태면 숨김
  $("a2hsTip").hidden = dismissed || isStandalone();
}
function openInstallGuide() { $("installModal").hidden = false; }

// 지난 방문 이후 새로 추가된 사업을 감지해 홈에 알림 배너를 띄운다(localStorage 기반).
const SEEN_KEY = "sangju_seen_programs";
let newProgramNames = [];
function checkNewPrograms() {
  const names = DATA.programs.map((p) => p.사업명);
  let seen = [];
  try { seen = JSON.parse(localStorage.getItem(SEEN_KEY) || "[]"); } catch (e) { seen = []; }
  if (Array.isArray(seen) && seen.length) {
    const seenSet = new Set(seen);
    newProgramNames = names.filter((n) => !seenSet.has(n));
    if (newProgramNames.length) {
      $("newBannerText").textContent = `🆕 새로 추가된 지원사업 ${newProgramNames.length}건이 있어요!`;
      $("newBanner").hidden = false;
    }
  }
  // 이번 방문 기준으로 현재 목록을 '본 것'으로 저장(다음 추가분만 알림)
  try { localStorage.setItem(SEEN_KEY, JSON.stringify(names)); } catch (e) {}
}

// ---------- 홈: 카테고리 칩 ----------
function renderCategoryChips() {
  const box = $("categoryChips");
  box.innerHTML = DATA.categories.map((c) =>
    `<button class="chip" data-cat="${esc(c)}">${esc(c)}</button>`).join("");
  box.querySelectorAll(".chip").forEach((el) => {
    el.addEventListener("click", () => {
      state.selectedCats = new Set([el.dataset.cat]);
      openList({ title: el.dataset.cat });
    });
  });
}

// ---------- 맞춤추천: 상황 체크 ----------
function renderSituations() {
  const box = $("situationList");
  box.innerHTML = DATA.situation_map.map(([label, cat], i) =>
    `<label class="situation" data-cat="${esc(cat)}">
       <input type="checkbox" data-i="${i}" /> <span>${esc(label)}</span>
     </label>`).join("");
  box.querySelectorAll(".situation").forEach((el) => {
    const cb = el.querySelector("input");
    cb.addEventListener("change", () => {
      el.classList.toggle("on", cb.checked);
      if (cb.checked) state.situations.add(el.dataset.cat);
      else state.situations.delete(el.dataset.cat);
    });
  });
}

// 나이 → 연령 카테고리 (PC 앱 _age_categories 동일 규칙)
function ageCategories(age) {
  const c = [];
  if (age == null || isNaN(age)) return c;
  if (age <= 5) c.push("🧸 영유아·보육");
  if (age >= 6 && age <= 18) c.push("🎒 청소년·교육");
  if (age >= 19 && age <= 39) c.push("🎓 청년");
  if (age >= 65) c.push("👴 노인·어르신");
  return c;
}

function runRecommend() {
  const ageRaw = $("ageInput").value.trim();
  const age = ageRaw === "" ? null : parseInt(ageRaw, 10);
  const cats = new Set(state.situations);
  ageCategories(age).forEach((c) => cats.add(c));
  if (cats.size === 0) {
    alert("나이를 입력하거나, 해당하는 상황을 하나 이상 선택해 주세요.");
    return;
  }
  state.selectedCats = cats;
  openList({ title: "맞춤 추천 결과" });
}

// ---------- 목록 ----------
function filterPrograms(catSet, query) {
  const q = (query || "").trim().toLowerCase();
  return DATA.programs.filter((p) => {
    if (catSet && catSet.size > 0) {
      if (!p.categories.some((c) => catSet.has(c))) return false;
    }
    if (q) {
      const hay = (p.사업명 + " " + p.내용 + " " + p.대상자상세기준 + " " + p.팀명).toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

let listOnlyNames = null;   // 특정 사업명만 보여줄 때(예: 신규 사업) 사용
function openList({ title, onlyNames }) {
  listOnlyNames = onlyNames || null;
  $("topTitle").textContent = title || "사업 목록";
  $("listSearch").value = "";
  showView("list");
  renderList();
}

function renderList() {
  const q = $("listSearch").value;
  const cats = (!listOnlyNames && state.selectedCats.size) ? state.selectedCats : null;
  let results = filterPrograms(cats, q);
  if (listOnlyNames) {
    const set = new Set(listOnlyNames);
    results = results.filter((p) => set.has(p.사업명));
  }
  $("listMeta").textContent = `${results.length}개 사업`;
  const box = $("listResults");
  if (results.length === 0) {
    const isAlways = cats && [...cats].some((c) => (DATA.always_show || []).includes(c));
    box.innerHTML = `<p class="empty">${isAlways
      ? "현재 등록된 해당 분야 사업이 없습니다.<br>새로운 사업이 등록되면 이곳에 표시됩니다."
      : "조건에 맞는 사업이 없습니다.<br>검색어나 분야를 바꿔보세요."}</p>`;
    return;
  }
  box.innerHTML = results.map((p) => {
    const idx = DATA.programs.indexOf(p);
    return `<div class="card" data-idx="${idx}">
      <h3>${esc(p.사업명)}</h3>
      <p>${esc(p.내용 || p.대상자상세기준)}</p>
      <span class="team">${esc((p.팀명 || "").trim() || "담당팀 확인 필요")}</span>
    </div>`;
  }).join("");
  box.querySelectorAll(".card").forEach((el) => {
    el.addEventListener("click", () => openDetail(parseInt(el.dataset.idx, 10)));
  });
}

// ---------- 상세 ----------
let currentIdx = null;
function openDetail(idx) {
  currentIdx = idx;
  const p = DATA.programs[idx];
  $("topTitle").textContent = "사업 상세";
  const block = (k, v) => v ? `<div class="detail-block"><div class="k">${k}</div><div class="v">${esc(v)}</div></div>` : "";
  const blockHtml = (k, html) => html ? `<div class="detail-block"><div class="k">${k}</div><div class="v">${html}</div></div>` : "";
  const tags = (p.categories || []).map((c) => `<span class="t">${esc(c)}</span>`).join("");
  // 담당: 팀명이 없으면 '담당팀 확인 필요'
  const team = (p.팀명 || "").trim() || "담당팀 확인 필요";
  const charge = [p.기관명, team].filter(Boolean).join(" · ");
  // 연락처: 전화 걸기 링크
  const tel = (p.연락처 || "").trim();
  const telDigits = tel.replace(/[^0-9+]/g, "");
  const telHtml = tel
    ? `<a class="tel-link" href="tel:${esc(telDigits)}">${esc(tel)} <span class="tel-ico">📞</span></a>`
    : "";
  $("detailContent").innerHTML = `
    <h2>${esc(p.사업명)}</h2>
    ${tags ? `<div class="detail-tags">${tags}</div>` : ""}
    ${block("📄 사업 내용", p.내용)}
    ${block("👥 지원 대상", p.대상자상세기준)}
    ${block("📝 이용 방법", p.이용방법)}
    ${block("📎 필요 서류", p.필요서류)}
    ${block("🏢 담당", charge)}
    ${blockHtml("☎ 연락처", telHtml)}
    ${block("📅 종료일", p.종료일)}
    <button class="big-btn primary full" id="detailApply">✋ 신청하기</button>
  `;
  showView("detail");
  $("detailApply").addEventListener("click", () => openApply(idx));
}

// ---------- 신청 (이메일 생성) ----------
function openApply(idx) {
  currentIdx = idx;
  const p = DATA.programs[idx];
  $("topTitle").textContent = "신청하기";
  $("applyTitle").textContent = p.사업명;
  $("applyName").value = "";
  $("applyPhone").value = "";
  $("applyMemo").value = "";
  showView("apply");
}

async function sendApply() {
  const p = DATA.programs[currentIdx];
  const name = $("applyName").value.trim();
  const phone = $("applyPhone").value.trim();
  const memo = $("applyMemo").value.trim();
  if (!name || !phone) {
    alert("이름과 연락처를 입력해 주세요.");
    return;
  }
  const key = window.WEB3FORMS_KEY || "";
  if (!key || key.indexOf("여기에") !== -1) {
    alert("신청 접수 설정이 아직 완료되지 않았습니다.\n관리자에게 문의해 주세요.");
    return;
  }

  // 기계 판독용 페이로드(공무원 PC 자동접수가 파싱) — 마커로 감싼다
  const payload = {
    사업명: p.사업명, 신청자: name, 연락처: phone, 문의사항: memo,
    담당팀: p.팀명, 담당자이메일: p.담당자이메일, 기관명: p.기관명,
  };
  const form = {
    access_key: key,
    subject: `[모바일신청] ${p.사업명} - ${name}`,
    from_name: "상주시 정책 플랫폼(모바일)",
    "사업명": p.사업명,
    "신청자": name,
    "연락처": phone,
    "문의사항": memo || "(없음)",
    "담당팀": p.팀명 || "-",
    "담당자이메일": p.담당자이메일 || "-",
    payload: "@@SJSTART@@" + JSON.stringify(payload) + "@@SJEND@@",
    botcheck: "",
  };

  const btn = $("applySend");
  const orig = btn.textContent;
  btn.disabled = true;
  btn.textContent = "제출 중...";
  try {
    const res = await fetch("https://api.web3forms.com/submit", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(form),
    });
    const j = await res.json();
    if (!j.success) throw new Error(j.message || "전송 실패");
    showDone(p);
  } catch (e) {
    alert("전송에 실패했습니다.\n인터넷 연결을 확인하고 다시 시도해 주세요.\n\n(" + e.message + ")");
  } finally {
    btn.disabled = false;
    btn.textContent = orig;
  }
}

// ---------- 오류 문의 ----------
function openInquiry() {
  $("topTitle").textContent = "오류 · 문의(개발자)";
  $("inquiryMemo").value = "";
  $("inquiryContact").value = "";
  showView("inquiry");
}

async function sendInquiry() {
  const memo = $("inquiryMemo").value.trim();
  const contact = $("inquiryContact").value.trim();
  if (!memo) {
    alert("문의 내용을 입력해 주세요.");
    return;
  }
  const key = window.WEB3FORMS_KEY || "";
  if (!key || key.indexOf("여기에") !== -1) {
    alert("문의 전송 설정이 아직 완료되지 않았습니다.\n관리자에게 문의해 주세요.");
    return;
  }
  const payload = { type: "inquiry", 문의내용: memo, 연락처: contact, 전달주소: SUPPORT_EMAIL };
  const form = {
    access_key: key,
    subject: "[오류문의] 상주시 정책 플랫폼(모바일)",
    from_name: "상주시 정책 플랫폼(모바일)",
    "문의내용": memo,
    "연락처": contact || "(없음)",
    payload: "@@SJSTART@@" + JSON.stringify(payload) + "@@SJEND@@",
    botcheck: "",
  };
  const btn = $("inquirySend");
  const orig = btn.textContent;
  btn.disabled = true;
  btn.textContent = "보내는 중...";
  try {
    const res = await fetch("https://api.web3forms.com/submit", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(form),
    });
    const j = await res.json();
    if (!j.success) throw new Error(j.message || "전송 실패");
    $("topTitle").textContent = "문의 완료";
    $("doneProgram").textContent = "문의가 접수되었습니다";
    document.querySelector("#view-done h2").textContent = "문의해 주셔서 감사합니다";
    document.querySelector("#view-done .done-desc").innerHTML =
      "담당자에게 문의 내용이 전달되었습니다.<br>빠르게 확인하겠습니다.";
    state.navStack = [{ v: "home", t: HOME_TITLE }, { v: "done", t: "문의 완료" }];
    state.fwdStack = [];
    showView("done", false);
  } catch (e) {
    alert("전송에 실패했습니다.\n인터넷 연결을 확인하고 다시 시도해 주세요.\n\n(" + e.message + ")");
  } finally {
    btn.disabled = false;
    btn.textContent = orig;
  }
}

function showDone(p) {
  $("topTitle").textContent = "접수 완료";
  // 문의 완료로 바뀌었던 문구를 신청 완료용으로 복원
  document.querySelector("#view-done h2").textContent = "신청이 접수되었습니다";
  document.querySelector("#view-done .done-desc").innerHTML =
    "담당 부서로 신청 내용이 전달되었습니다.<br>처리 결과는 담당자가 연락처로 안내드립니다.";
  $("doneProgram").textContent = p.사업명;
  // 완료 화면 이후 뒤로가기는 홈으로 가도록 스택 정리
  state.navStack = [{ v: "home", t: HOME_TITLE }, { v: "done", t: "접수 완료" }];
  state.fwdStack = [];
  showView("done", false);
}

// ---------- 이벤트 ----------
function bindEvents() {
  $("backBtn").addEventListener("click", goBack);
  $("fabBack").addEventListener("click", goBack);
  _bindSwipe();
  document.querySelectorAll("[data-go]").forEach((el) => {
    el.addEventListener("click", () => {
      const go = el.dataset.go;
      if (go === "all") { state.selectedCats = new Set(); openList({ title: "전체 사업" }); }
      else if (go === "recommend") { $("topTitle").textContent = "맞춤 찾기"; showView("recommend"); }
    });
  });
  $("homeSearch").addEventListener("keydown", (e) => {
    if (e.key === "Enter") { state.selectedCats = new Set(); openList({ title: "검색 결과" }); $("listSearch").value = e.target.value; renderList(); }
  });
  $("homeSearch").addEventListener("search", (e) => {
    if (e.target.value.trim()) { state.selectedCats = new Set(); openList({ title: "검색 결과" }); $("listSearch").value = e.target.value; renderList(); }
  });
  $("listSearch").addEventListener("input", renderList);
  $("recommendRun").addEventListener("click", runRecommend);
  // 연락처는 '-' 없이 숫자만 입력
  $("applyPhone").addEventListener("input", (e) => {
    e.target.value = e.target.value.replace(/[^0-9]/g, "");
  });
  $("applySend").addEventListener("click", sendApply);
  $("inquiryLink").addEventListener("click", (e) => { e.preventDefault(); openInquiry(); });
  $("inquirySend").addEventListener("click", sendInquiry);
  $("doneHome").addEventListener("click", () => {
    state.selectedCats = new Set();
    state.navStack = [{ v: "home", t: HOME_TITLE }];
    state.fwdStack = [];
    $("topTitle").textContent = HOME_TITLE;
    showView("home", false);
  });
  // 신규 사업 알림 배너
  $("newBannerView").addEventListener("click", () => {
    state.selectedCats = new Set();
    openList({ title: "새로 추가된 사업", onlyNames: newProgramNames });
  });
  $("newBannerClose").addEventListener("click", () => { $("newBanner").hidden = true; });
  // 팀원 소개 모달
  $("teamBtn").addEventListener("click", () => { $("teamModal").hidden = false; });
  $("teamClose").addEventListener("click", () => { $("teamModal").hidden = true; });
  $("teamModal").addEventListener("click", (e) => {
    if (e.target.id === "teamModal") $("teamModal").hidden = true;  // 배경 클릭 닫기
  });
  // '홈 화면에 추가' 안내 (홈 띠 + 푸터 링크 → 동일 모달)
  $("a2hsTip").addEventListener("click", (e) => {
    if (e.target.id === "a2hsClose") {          // ✕: 다시 안 뜨게 닫기
      $("a2hsTip").hidden = true;
      try { localStorage.setItem(A2HS_DISMISS_KEY, "1"); } catch (err) {}
      return;
    }
    openInstallGuide();
  });
  $("installLink").addEventListener("click", openInstallGuide);   // 푸터: 언제든 다시 보기
  $("installClose").addEventListener("click", () => { $("installModal").hidden = true; });
  $("installModal").addEventListener("click", (e) => {
    if (e.target.id === "installModal") $("installModal").hidden = true;  // 배경 클릭 닫기
  });
}

// 좌우 스와이프로 이전/이후 전환 (오른쪽으로 밀기 = 뒤로, 왼쪽으로 밀기 = 이후)
function _bindSwipe() {
  let x0 = 0, y0 = 0, t0 = 0, tracking = false;
  const MIN_DIST = 60;     // 최소 이동 거리(px)
  const MAX_OFF = 60;      // 세로 흔들림 허용치(px)
  const MAX_TIME = 600;    // 최대 시간(ms) — 너무 느린 동작은 무시

  document.addEventListener("touchstart", (e) => {
    if (e.touches.length !== 1) { tracking = false; return; }
    // 입력창에서 시작한 제스처는 텍스트 선택과 충돌하므로 제외
    const tag = (e.target.tagName || "").toLowerCase();
    if (tag === "input" || tag === "textarea") { tracking = false; return; }
    const t = e.touches[0];
    x0 = t.clientX; y0 = t.clientY; t0 = Date.now(); tracking = true;
  }, { passive: true });

  document.addEventListener("touchend", (e) => {
    if (!tracking) return;
    tracking = false;
    const t = e.changedTouches[0];
    const dx = t.clientX - x0;
    const dy = t.clientY - y0;
    const dt = Date.now() - t0;
    if (dt > MAX_TIME) return;
    if (Math.abs(dx) < MIN_DIST) return;
    if (Math.abs(dy) > MAX_OFF || Math.abs(dx) < Math.abs(dy) * 1.5) return; // 가로 우세일 때만
    if (dx > 0) goBack();      // → 오른쪽: 뒤로(이전)
    else goForward();          // ← 왼쪽: 이후
  }, { passive: true });
}

init();
