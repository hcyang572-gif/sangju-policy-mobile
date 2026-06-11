// 상주시 정책 플랫폼 — 모바일 웹앱 (서버 없는 정적 MVP)
// data.json(빌드 산출물)을 읽어 검색·맞춤추천·상세·신청(이메일)을 제공한다.

"use strict";

let DATA = null;
const state = { selectedCats: new Set(), situations: new Set(), navStack: [] };

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

const VIEWS = ["home", "list", "recommend", "detail", "apply", "done"];

function showView(name, push = true) {
  VIEWS.forEach((v) => { $("view-" + v).hidden = v !== name; });
  if (push && state.navStack[state.navStack.length - 1] !== name) state.navStack.push(name);
  $("backBtn").hidden = state.navStack.length <= 1;
  window.scrollTo(0, 0);
}

function goBack() {
  if (state.navStack.length <= 1) return;
  state.navStack.pop();
  showView(state.navStack[state.navStack.length - 1], false);
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
  state.navStack = ["home"];
  renderCategoryChips();
  renderSituations();
  bindEvents();
  showView("home", false);
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

function openList({ title }) {
  $("topTitle").textContent = title || "사업 목록";
  $("listSearch").value = "";
  showView("list");
  renderList();
}

function renderList() {
  const q = $("listSearch").value;
  const cats = state.selectedCats.size ? state.selectedCats : null;
  const results = filterPrograms(cats, q);
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
      ${p.팀명 ? `<span class="team">${esc(p.팀명)}</span>` : ""}
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
  const tags = (p.categories || []).map((c) => `<span class="t">${esc(c)}</span>`).join("");
  $("detailContent").innerHTML = `
    <h2>${esc(p.사업명)}</h2>
    ${tags ? `<div class="detail-tags">${tags}</div>` : ""}
    ${block("📄 사업 내용", p.내용)}
    ${block("👥 지원 대상", p.대상자상세기준)}
    ${block("📝 이용 방법", p.이용방법)}
    ${block("📎 필요 서류", p.필요서류)}
    ${block("🏢 담당", [p.기관명, p.팀명].filter(Boolean).join(" · "))}
    ${block("☎ 연락처", p.연락처)}
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

function showDone(p) {
  $("topTitle").textContent = "접수 완료";
  $("doneProgram").textContent = p.사업명;
  // 완료 화면 이후 뒤로가기는 홈으로 가도록 스택 정리
  state.navStack = ["home", "done"];
  showView("done", false);
}

// ---------- 이벤트 ----------
function bindEvents() {
  $("backBtn").addEventListener("click", goBack);
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
  $("applySend").addEventListener("click", sendApply);
  $("doneHome").addEventListener("click", () => {
    state.selectedCats = new Set();
    state.navStack = ["home"];
    $("topTitle").textContent = "🍊 상주시 정책 플랫폼";
    showView("home", false);
  });
}

init();
