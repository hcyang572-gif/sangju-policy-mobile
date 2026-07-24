// 상주시 정책 플랫폼 — 모바일 웹앱 (서버 없는 정적 MVP)
// data.json(빌드 산출물)을 읽어 검색·맞춤추천·상세·신청(이메일)을 제공한다.

"use strict";

let DATA = null;
const state = { selectedCats: new Set(), situations: new Set(), navStack: [], fwdStack: [] };

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

// 입력 디바운스 — 마지막 입력 후 ms 밀리초가 지나면 «반드시 한 번» 실행한다.
// ★ 공무원앱(webui/app.js)의 검색 디바운스와 동일한 규약(300ms)이라 두 앱 반응이 같다.
// ⚠ 한글(IME) 조합 중에도 input 이벤트는 계속 오므로 «건너뛰지 않고» 타이머만 미룬다.
//    (조합 중이라고 렌더를 막으면 "청년"처럼 조합이 안 끝난 상태에서 결과가 멈춘다 — 과거 결함)
// .cancel(): 화면 전환 등으로 대기 중인 실행이 필요 없어졌을 때 취소.
function debounce(fn, ms) {
  let t = null;
  const wrapped = (...a) => { clearTimeout(t); t = setTimeout(() => { t = null; fn(...a); }, ms); };
  wrapped.cancel = () => { clearTimeout(t); t = null; };
  return wrapped;
}

// ---------- 담당팀별 색 구분(공무원앱과 동일 매핑) ----------
// 팀명 문자열 → 결정적 색(연한 배경+진한 글자, 대비 4.5:1 이상). 같은 팀=같은 색.
// ★ 공무원앱도 동일 함수를 사용하므로 임의 수정 금지(두 앱 색 일치 보장).
const TEAM_PALETTE = [
  { bg: '#E8F0FE', fg: '#1A4480' }, { bg: '#E6F4EA', fg: '#1E6B33' }, { bg: '#FCE8E6', fg: '#A52714' },
  { bg: '#FEF7E0', fg: '#7A5900' }, { bg: '#F3E8FD', fg: '#6A1B9A' }, { bg: '#E0F7FA', fg: '#00695C' },
  { bg: '#FCE4EC', fg: '#AD1457' }, { bg: '#EFEBE9', fg: '#4E342E' }, { bg: '#E8EAF6', fg: '#283593' },
  { bg: '#F1F8E9', fg: '#33691E' }, { bg: '#FFF3E0', fg: '#B33C00' }, { bg: '#ECEFF1', fg: '#37474F' },
  { bg: '#E0F2F1', fg: '#00796B' }, { bg: '#FFEBEE', fg: '#C2185B' }
];
function teamColor(name) {
  const s = (name || '').trim();
  if (!s || s === '담당팀 확인 필요' || s === '-') return null; // 미지정은 색 없음(중립)
  let h = 0; for (let i = 0; i < s.length; i++) { h = (h * 31 + s.charCodeAt(i)) >>> 0; }
  return TEAM_PALETTE[h % TEAM_PALETTE.length];
}
// 팀색을 요소에 입힌다(미지정이면 기존 중립 스타일 유지). 동적값이라 element.style로 주입.
function applyTeamColor(el, name) {
  if (!el) return;
  const c = teamColor(name);
  if (c) { el.style.background = c.bg; el.style.color = c.fg; }
}

const VIEWS = ["home", "list", "recommend", "detail", "apply", "inquiry", "done",
  "propose", "pdetail", "pwrite", "privacy"];

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
  // 정책참여 알림 띠는 «목록 화면일 때만» 보인다 → 화면이 바뀔 때마다 다시 계산한다.
  // (뒤로가기로 목록에 돌아온 경우에도 쌓인 알림이 제대로 뜨게 하려는 것)
  if (window.Proposals && window.Proposals.syncNotice) {
    try { window.Proposals.syncNotice(); } catch (e) { /* 무시 */ }
  }
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
    // 원인 구분: 오프라인·서버 미응답이면 «일시적 응답 없음» 안내, 그 밖은 데이터 파일 문제로 안내.
    // (무료 플랜 일시정지로 서비스가 멈췄을 때 "불러오기 실패"만 떠서 원인 파악이 안 됐던 사고 반영)
    const offline = (typeof navigator !== "undefined" && navigator.onLine === false);
    const netMsg = /failed to fetch|networkerror|network error|load failed|timeout|fetch/i.test(String(e && e.message));
    const conn = offline || netMsg;
    $("app").innerHTML = conn
      ? '<div class="empty err-box" role="alert">' +
        '<div class="err-title">⏸ 클라우드 서비스가 일시적으로 응답하지 않습니다.</div>' +
        '<div class="err-desc">잠시 후 다시 시도해 주세요.<br>계속되면 인터넷 연결 상태를 확인해 주세요.</div>' +
        '<div class="err-actions"><button id="initRetry" class="err-retry" type="button">🔄 다시 시도</button></div></div>'
      : '<div class="empty err-box" role="alert">' +
        '<div class="err-title">🛠 사업 정보를 준비 중입니다.</div>' +
        '<div class="err-desc">데이터 파일(data.json)을 읽지 못했습니다.<br>잠시 후 다시 시도해 주세요.</div>' +
        '<div class="err-actions"><button id="initRetry" class="err-retry" type="button">🔄 다시 시도</button></div></div>';
    const rb = $("initRetry");
    if (rb) rb.addEventListener("click", () => location.reload());
    return;
  }
  state.navStack = [{ v: "home", t: HOME_TITLE }];
  state.fwdStack = [];
  renderCategoryChips();
  renderSituations();
  bindEvents();
  showView("home", false);
  checkNewPrograms();
  initInApp();
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
  // 홈 상단 안내 띠: 한 번 닫았거나, 이미 설치(standalone) 상태거나,
  // 인앱 브라우저 배너가 떠 있으면(겹침 방지) 숨긴다.
  $("a2hsTip").hidden = dismissed || isStandalone() || !$("inappBanner").hidden;
}
function closeInstallGuide() { $("installModal").hidden = true; window.ModalA11y && ModalA11y.close("installModal"); }
function openInstallGuide() {
  $("installModal").hidden = false;
  window.ModalA11y && ModalA11y.open("installModal", closeInstallGuide);
}

// ---------- 인앱 브라우저(카톡·네이버 등) 대응 ----------
const INAPP_DISMISS_KEY = "sangju_inapp_dismissed";
// 카카오톡·네이버·라인·페이스북·인스타·다음 등 주요 인앱 웹뷰 감지
function isInApp() {
  const ua = (navigator.userAgent || "").toLowerCase();
  return /kakaotalk|naver|line\/|fban|fbav|instagram|daumapps|whale|everytimeapp|band|kakaostory/.test(ua);
}
function isIOS() {
  const ua = navigator.userAgent || "";
  return /iphone|ipad|ipod/i.test(ua) ||
    // iPadOS 13+ 는 Mac 처럼 보고하므로 터치 지원으로 보완 판별
    (/macintosh/i.test(ua) && (navigator.maxTouchPoints || 0) > 1);
}
function isAndroid() {
  return /android/i.test(navigator.userAgent || "");
}
// 현재 주소를 안드로이드 크롬으로 강제로 여는 intent:// URL을 만든다.
// 크롬 미설치 시 S.browser_fallback_url 로 폴백.
function buildChromeIntent() {
  const cur = window.location.href;
  const hostPath = window.location.host + window.location.pathname +
                   window.location.search + window.location.hash;
  return "intent://" + hostPath +
    "#Intent;scheme=https;package=com.android.chrome;" +
    "S.browser_fallback_url=" + encodeURIComponent(cur) + ";end";
}
function initInApp() {
  const banner = $("inappBanner");
  let dismissed = false;
  try { dismissed = localStorage.getItem(INAPP_DISMISS_KEY) === "1"; } catch (e) {}
  // 이미 설치 실행(standalone)이거나, 일반 브라우저거나, 닫았으면 숨김
  if (isStandalone() || !isInApp() || dismissed) { banner.hidden = true; return; }

  const txt = $("inappText");
  const openBtn = $("inappOpen");
  const copyBtn = $("inappCopy");
  if (isAndroid()) {
    txt.innerHTML = "앱 설치는 <b>크롬</b>에서 됩니다.<br>아래 버튼으로 크롬에서 열어주세요.";
    openBtn.hidden = false;
    copyBtn.hidden = true;
  } else if (isIOS()) {
    txt.innerHTML = "설치하려면 우측 위 <b>⋯ 메뉴 → ‘Safari로 열기’</b>를 눌러주세요.<br>(주소를 복사해 사파리에 붙여넣어도 됩니다.)";
    openBtn.hidden = true;
    copyBtn.hidden = false;
  } else {
    // 기타 인앱: 일반 안내 + 주소 복사
    txt.innerHTML = "앱 설치는 <b>크롬·사파리 등 기본 브라우저</b>에서 됩니다.<br>주소를 복사해 브라우저에서 열어주세요.";
    openBtn.hidden = true;
    copyBtn.hidden = false;
  }
  banner.hidden = false;
}
// 현재 주소 복사(클립보드 API 실패 시 임시 input 폴백)
async function copyCurrentUrl() {
  const url = window.location.href;
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(url);
    } else { throw new Error("no clipboard api"); }
  } catch (e) {
    try {
      const t = document.createElement("input");
      t.value = url; document.body.appendChild(t);
      t.select(); document.execCommand("copy");
      document.body.removeChild(t);
    } catch (e2) { alert("주소: " + url); return; }
  }
  alert("주소를 복사했어요. 브라우저(크롬·사파리)에 붙여넣어 열어주세요.");
}

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
  renderListDebounced.cancel();   // 이전 화면에서 대기 중이던 검색 렌더는 버린다
  showView("list");
  renderList();                    // 목록 진입은 즉시 렌더(지연 없음)
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
    const teamName = (p.팀명 || "").trim() || "담당팀 확인 필요";
    // 📌 접수 안내(비고): 마감/재접수 시기 등 — 있는 사업만 짧은 표식
    const note = (p.비고 || "").trim();
    const noteFlag = note
      ? `<span class="note-flag"><span aria-hidden="true">📌</span> 접수 안내</span>`
      : "";
    // 키보드 접근(KWCAG 2.2): role=button + tabindex 로 Tab 이동·Enter/Space 실행 가능
    // 색만으로 알리지 않도록 카드 aria-label 에도 '접수 안내 있음'을 덧붙인다
    return `<div class="card" data-idx="${idx}" role="button" tabindex="0"
      aria-label="${esc(p.사업명)}${note ? ", 접수 안내 있음" : ""} 상세 보기">
      <h3>${esc(p.사업명)}</h3>
      <p>${esc(p.내용 || p.대상자상세기준)}</p>
      <span class="card-meta">
        <span class="team" data-team="${esc(teamName)}" title="${esc(teamName)}">${esc(teamName)}</span>${noteFlag}
      </span>
    </div>`;
  }).join("");
  box.querySelectorAll(".card").forEach((el) => {
    applyTeamColor(el.querySelector(".team"), el.querySelector(".team").dataset.team);
    const open = () => openDetail(parseInt(el.dataset.idx, 10));
    el.addEventListener("click", open);
    el.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open(); }
    });
  });
}

// 목록 안 검색은 한 글자마다 전체를 다시 그리지 않고 300ms 모아서 한 번만 그린다.
// (사업이 100건을 넘으면서 타자마다 재렌더는 특히 저사양 폰에서 버벅였다)
const renderListDebounced = debounce(renderList, 300);

// ---------- 상세 ----------
let currentIdx = null;
function openDetail(idx) {
  currentIdx = idx;
  const p = DATA.programs[idx];
  $("topTitle").textContent = "사업 상세";
  const block = (k, v) => v ? `<div class="detail-block"><div class="k">${k}</div><div class="v">${esc(v)}</div></div>` : "";
  const blockHtml = (k, html) => html ? `<div class="detail-block"><div class="k">${k}</div><div class="v">${html}</div></div>` : "";
  const tags = (p.categories || []).map((c) => `<span class="t">${esc(c)}</span>`).join("");
  // 담당: 팀명이 없으면 '담당팀 확인 필요'. 팀명은 팀별 색 배지로 표시(색은 렌더 후 주입).
  const team = (p.팀명 || "").trim() || "담당팀 확인 필요";
  const org = (p.기관명 || "").trim();
  const teamBadge = `<span class="team detail-team" data-team="${esc(team)}">${esc(team)}</span>`;
  const chargeHtml = (org ? esc(org) + " · " : "") + teamBadge;
  // 연락처: 전화 걸기 링크
  const tel = (p.연락처 || "").trim();
  const telDigits = tel.replace(/[^0-9+]/g, "");
  const telHtml = tel
    ? `<a class="tel-link" href="tel:${esc(telDigits)}" aria-label="${esc(tel)} 전화 걸기"><span aria-hidden="true">📞</span> ${esc(tel)}</a>`
    : "";
  // 📌 접수 안내(비고) — 접수 마감·재접수 시기 등. 값이 없으면 아무것도 렌더링하지 않는다.
  // 색만으로 구분하지 않도록 아이콘(📌)+'접수 안내' 문구를 함께 두고, role=note 로 읽히게 한다.
  const note = (p.비고 || "").trim();
  const noteHtml = note
    ? `<div class="notice-box" role="note" aria-label="접수 안내">
         <p class="notice-k"><span aria-hidden="true">📌</span> 접수 안내</p>
         <p class="notice-v">${esc(note)}</p>
       </div>`
    : "";
  $("detailContent").innerHTML = `
    <h2>${esc(p.사업명)}</h2>
    ${tags ? `<div class="detail-tags">${tags}</div>` : ""}
    ${noteHtml}
    ${block("📄 사업 내용", p.내용)}
    ${block("👥 지원 대상", p.대상자상세기준)}
    ${block("📝 이용 방법", p.이용방법)}
    ${block("📎 필요 서류", p.필요서류)}
    <div id="formsDownload"></div>
    ${blockHtml("🏢 담당", chargeHtml)}
    ${blockHtml("☎ 연락처", telHtml)}
    ${block("📅 종료일", p.종료일)}
    <button class="big-btn primary full" id="detailApply">✋ 신청하기</button>
  `;
  showView("detail");
  const teamEl = $("detailContent").querySelector(".detail-team");
  if (teamEl) applyTeamColor(teamEl, teamEl.dataset.team);
  $("detailApply").addEventListener("click", () => openApply(idx));
  // 📎 필요서류 서식 다운로드(Supabase) — 비동기로 채운다.
  // 등록된 서식이 없거나 저장소 미준비면 섹션 자체를 숨긴 채로 둔다(기존 화면 무손상).
  renderFormsDownload(p, idx);
}

// 사업 상세의 «서식 다운로드» 블록을 채운다. 목록은 SangjuForms.listForms 가 정본.
// listForms 는 실패/미준비 시 [] 를 돌려주므로(방어), 없으면 비워 둬서 안 보이게 한다.
async function renderFormsDownload(p, idx) {
  const host = $("formsDownload");
  if (!host || !window.SangjuForms) return;
  let rows = [];
  try { rows = await SangjuForms.listForms(p); } catch (e) { rows = []; }
  // 그 사이 다른 사업으로 이동했으면(빠른 전환) 낡은 결과를 반영하지 않는다.
  if (currentIdx !== idx) return;
  if (!rows || !rows.length) { host.innerHTML = ""; return; }
  const items = rows.map((row) => {
    const nm = String(row.file_name || "서식");
    const ext = (nm.split(".").pop() || "").toUpperCase();
    const size = SangjuForms.formatSize(row.size);
    // 색·아이콘만이 아니라 파일형식·용량을 «텍스트»로 명시(스크린리더/저시력).
    const metaTxt = (ext ? ext + " 파일" : "파일") + (size ? ", " + size : "");
    const url = String(row.public_url || "");
    const aria = esc(nm) + " 내려받기 (" + esc(metaTxt) + ")";
    if (!url) return "";
    return `<li class="forms-dl-item">
        <a class="forms-dl-link" href="${esc(url)}" target="_blank" rel="noopener noreferrer"
           download="${esc(nm)}" aria-label="${aria}">
          <span class="forms-dl-name"><span aria-hidden="true">📄</span> ${esc(nm)}</span>
          <span class="forms-dl-meta">${esc(metaTxt)}</span>
          <span class="forms-dl-go" aria-hidden="true">내려받기 ⬇</span>
        </a>
      </li>`;
  }).join("");
  if (!items) { host.innerHTML = ""; return; }
  host.innerHTML = `<div class="detail-block">
      <div class="k">📎 필요서류 서식 다운로드</div>
      <div class="v"><ul class="forms-dl-list">${items}</ul></div>
    </div>`;
}

// ---------- 신청 (이메일 생성) ----------
function openApply(idx) {
  currentIdx = idx;
  const p = DATA.programs[idx];
  $("topTitle").textContent = "신청하기";
  $("applyTitle").textContent = p.사업명;
  // 📌 접수 안내(비고)는 '제출 직전'에 한 번 더 보여, 마감된 사업에 그냥 신청하지 않게 한다.
  const note = (p.비고 || "").trim();
  $("applyNotice").innerHTML = note
    ? `<div class="notice-box" role="note" aria-label="접수 안내">
         <p class="notice-k"><span aria-hidden="true">📌</span> 접수 안내</p>
         <p class="notice-v">${esc(note)}</p>
       </div>`
    : "";
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

// ---------- 개인정보 처리방침 ----------
function openPrivacy() {
  $("topTitle").textContent = "개인정보 처리방침";
  showView("privacy");
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

// ---------- 모달 접근성: 포커스 트랩 + Esc 닫기 + 호출 버튼으로 복귀 (KWCAG 2.2) ----------
// app.js·proposals.js 두 곳에서 공용으로 쓰도록 전역 노출(window.ModalA11y).
const ModalA11y = (function () {
  const FOCUSABLE = 'a[href], button:not([disabled]), textarea:not([disabled]),' +
    ' input:not([disabled]):not([type="hidden"]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';
  // 모달 id → {keyHandler, opener} 보관(중복 리스너 누적 방지·복귀 대상 기억)
  const active = {};

  function focusables(modal) {
    return Array.prototype.filter.call(
      modal.querySelectorAll(FOCUSABLE),
      (el) => el.offsetParent !== null || el === document.activeElement
    );
  }

  // 모달 열기: 첫 요소로 포커스 이동 + Tab 순환 + Esc 닫기 바인딩
  // close: 닫기 동작(해당 모달의 닫기 함수)
  function open(modalId, close) {
    const modal = document.getElementById(modalId);
    if (!modal) return;
    if (active[modalId]) teardown(modalId);   // 안전: 이전 바인딩 제거
    const opener = document.activeElement;     // 닫을 때 포커스 돌려줄 호출 버튼

    const keyHandler = (e) => {
      if (e.key === "Escape") { e.preventDefault(); close(); return; }
      if (e.key !== "Tab") return;
      const items = focusables(modal);
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", keyHandler, true);
    active[modalId] = { keyHandler, opener };

    // 첫 포커스 이동(렌더 직후)
    const items = focusables(modal);
    if (items.length) items[0].focus();
  }

  function teardown(modalId) {
    const rec = active[modalId];
    if (!rec) return;
    document.removeEventListener("keydown", rec.keyHandler, true);
    delete active[modalId];
    return rec.opener;
  }

  // 모달 닫기 후 호출: 리스너 제거 + 호출 버튼으로 포커스 복귀
  function close(modalId) {
    const opener = teardown(modalId);
    if (opener && typeof opener.focus === "function") {
      try { opener.focus(); } catch (e) {}
    }
  }

  return { open, close };
})();
window.ModalA11y = ModalA11y;

// ---------- 버전 정보 + 버전별 개선사항(체인지로그) ----------
// 데이터 단일 소스: version.js의 window.APP_VERSION / window.APP_CHANGELOG.
function renderChangelog() {
  const box = $("changelogBody");
  if (!box) return;
  const logs = window.APP_CHANGELOG || [];
  box.innerHTML = "";
  logs.forEach((e) => {
    const entry = document.createElement("div");
    entry.className = "cl-entry";

    const head = document.createElement("div");
    head.className = "cl-head";
    const ver = document.createElement("span");
    ver.className = "cl-ver";
    ver.textContent = "v" + (e.version || "");
    head.appendChild(ver);
    if (e.date) {
      const date = document.createElement("span");
      date.className = "cl-date";
      date.textContent = e.date;
      head.appendChild(date);
    }
    entry.appendChild(head);

    if (e.title) {
      const t = document.createElement("div");
      t.className = "cl-title";
      t.textContent = e.title;
      entry.appendChild(t);
    }

    const ul = document.createElement("ul");
    ul.className = "cl-items";
    (e.items || []).forEach((it) => {
      const li = document.createElement("li");
      li.textContent = it;
      ul.appendChild(li);
    });
    entry.appendChild(ul);
    box.appendChild(entry);
  });
}

function initVersion() {
  const v = window.APP_VERSION || "";
  const btn = $("versionBtn");
  if (btn && v) {
    btn.textContent = "v" + v;                  // 단일 소스에서 버전 주입
    // 음성 명령이 «보이는 글자»로 눌리도록 접근명 맨 앞에 화면 텍스트(v0.0.3 등)를 그대로 둔다
    btn.setAttribute("aria-label", "v" + v + " — 버전 정보 및 이용 안내 보기");
  }
  renderChangelog();
  const closeCl = () => { $("versionModal").hidden = true; ModalA11y.close("versionModal"); };
  if (btn) btn.addEventListener("click", () => { $("versionModal").hidden = false; ModalA11y.open("versionModal", closeCl); });
  $("versionClose").addEventListener("click", closeCl);
  $("versionModal").addEventListener("click", (e) => { if (e.target.id === "versionModal") closeCl(); });  // 배경 클릭 닫기
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
      else if (go === "propose") { if (window.Proposals) window.Proposals.open(); }
    });
  });
  $("homeSearch").addEventListener("keydown", (e) => {
    if (e.key === "Enter") { state.selectedCats = new Set(); openList({ title: "검색 결과" }); $("listSearch").value = e.target.value; renderList(); }
  });
  $("homeSearch").addEventListener("search", (e) => {
    if (e.target.value.trim()) { state.selectedCats = new Set(); openList({ title: "검색 결과" }); $("listSearch").value = e.target.value; renderList(); }
  });
  // 목록 검색: 300ms 디바운스(공무원앱과 동일). 조합 중 input 도 그대로 받아 타이머만 미루므로
  // 한글이 완성되기 전에 결과가 멈추는 일이 없고, 입력을 멈추면 300ms 뒤 반드시 한 번 렌더된다.
  $("listSearch").addEventListener("input", renderListDebounced);
  // IME 조합 확정(스페이스·엔터·다른 키) 직후에도 마지막 글자가 확실히 반영되도록 한 번 더 예약.
  $("listSearch").addEventListener("compositionend", renderListDebounced);
  $("recommendRun").addEventListener("click", runRecommend);
  // 연락처는 '-' 없이 숫자만 입력
  $("applyPhone").addEventListener("input", (e) => {
    e.target.value = e.target.value.replace(/[^0-9]/g, "");
  });
  $("applySend").addEventListener("click", sendApply);
  $("inquiryLink").addEventListener("click", (e) => { e.preventDefault(); openInquiry(); });
  $("inquirySend").addEventListener("click", sendInquiry);
  // 개인정보 처리방침 (푸터 링크 → 전용 화면, '처음으로'로 복귀)
  $("privacyLink").addEventListener("click", openPrivacy);
  // 버전 라벨 + 버전별 개선사항(체인지로그) 모달
  initVersion();
  $("privacyHome").addEventListener("click", () => {
    state.selectedCats = new Set();
    state.navStack = [{ v: "home", t: HOME_TITLE }];
    state.fwdStack = [];
    $("topTitle").textContent = HOME_TITLE;
    showView("home", false);
  });
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
  // 팀원 소개 모달 (포커스 트랩·Esc·복귀 적용)
  const closeTeam = () => { $("teamModal").hidden = true; ModalA11y.close("teamModal"); };
  $("teamBtn").addEventListener("click", () => { $("teamModal").hidden = false; ModalA11y.open("teamModal", closeTeam); });
  $("teamClose").addEventListener("click", closeTeam);
  $("teamModal").addEventListener("click", (e) => {
    if (e.target.id === "teamModal") closeTeam();  // 배경 클릭 닫기
  });
  // '홈 화면에 추가' 안내 (홈 띠 + 푸터 링크 → 동일 모달)
  // (HTML 규격상 중첩 버튼이 금지되어 «안내 열기»·«닫기»가 형제 버튼으로 분리됨)
  $("a2hsOpen").addEventListener("click", openInstallGuide);
  $("a2hsClose").addEventListener("click", (e) => {   // ✕: 다시 안 뜨게 닫기
    e.stopPropagation();                              // 부모 띠로 전파 방지
    $("a2hsTip").hidden = true;
    try { localStorage.setItem(A2HS_DISMISS_KEY, "1"); } catch (err) {}
  });
  // 인앱 브라우저 배너: 크롬으로 열기 / 주소 복사 / 닫기
  $("inappOpen").addEventListener("click", () => { window.location.href = buildChromeIntent(); });
  $("inappCopy").addEventListener("click", copyCurrentUrl);
  $("inappClose").addEventListener("click", () => {
    $("inappBanner").hidden = true;
    try { localStorage.setItem(INAPP_DISMISS_KEY, "1"); } catch (err) {}
    initA2HS();   // 인앱 배너가 사라졌으니 설치띠 노출 여부 재평가
  });
  // 버전 정보 모달 › 이용 안내: 다른 브라우저로 열기(항상 접근 가능)
  $("openBrowserLink").addEventListener("click", () => {
    if (isAndroid()) { window.location.href = buildChromeIntent(); }
    else { copyCurrentUrl(); }
  });
  // 버전 정보 모달 › 이용 안내: 홈 화면 추가 방법. 모달 중첩을 막기 위해 버전 모달을 먼저 닫는다.
  $("installLink").addEventListener("click", () => {
    const vm = $("versionModal");
    if (vm && !vm.hidden) { vm.hidden = true; ModalA11y.close("versionModal"); }
    openInstallGuide();
  });
  $("installClose").addEventListener("click", closeInstallGuide);
  $("installModal").addEventListener("click", (e) => {
    if (e.target.id === "installModal") closeInstallGuide();  // 배경 클릭 닫기
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

// ── PWA 서비스워커 등록 (설치 가능화 + 오프라인 로딩) ─────────────
// 상대경로로 등록 → GitHub Pages 하위경로(/sangju-policy-mobile/)에서도 동작.
// 등록 실패해도 앱 기능에는 영향 없음.
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register("sw.js")
      .then((reg) => {
        console.log("[PWA] 서비스워커 등록 성공:", reg.scope);
        // 새 버전 감지 시: 설치 완료되면 즉시 적용(다음 새로고침부터 최신)
        reg.addEventListener("updatefound", () => {
          const sw = reg.installing;
          if (!sw) return;
          sw.addEventListener("statechange", () => {
            if (sw.state === "installed" && navigator.serviceWorker.controller) {
              console.log("[PWA] 새 버전 준비됨 — 새로고침하면 최신으로 갱신됩니다.");
            }
          });
        });
      })
      .catch((err) => {
        console.warn("[PWA] 서비스워커 등록 실패(앱은 정상 동작):", err);
      });
  });
}
