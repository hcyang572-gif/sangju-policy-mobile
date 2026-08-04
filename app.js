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

// 첫 렌더가 끝났는지 — showView 의 초점 이동을 «두 번째 화면부터» 적용하기 위한 표시
let _viewReady = false;

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
  // 사업 정보 갱신 알림 띠도 화면(작성 중 여부)에 따라 다시 계산한다.
  try { syncUpdateBanner(); } catch (e) { /* 무시 */ }
  window.scrollTo(0, 0);
  // 화면이 바뀌면 초점을 새 화면(본문)으로 옮긴다 — KWCAG 6.1.2 «초점 이동».
  // 이 앱은 한 페이지 안에서 화면만 갈아끼우므로, 그냥 두면 «방금 누른 카드»가
  // 사라지면서 초점이 <body> 로 떨어진다(다음 Tab 이 문서 처음부터 시작).
  // ※ 초기 렌더(첫 홈 진입)에서는 옮기지 않는다 — 페이지를 연 직후 초점을 뺏으면
  //   낭독기가 «건너뛰기 링크»부터 읽지 못한다.
  if (_viewReady) { try { focusMain(); } catch (e) { /* 무시 */ } }
  _viewReady = true;
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

// ════════════════════════════════════════════════════════════════════════
//  데이터 로딩 — 클라우드(Supabase benefits) «우선» + data.json 폴백
//  ----------------------------------------------------------------------
//  PC 관리앱에서 「홈페이지 연동」을 하면 그 결과가 Supabase benefits 로 올라간다.
//  예전에는 시민앱이 data.json(정적 파일)만 읽어서, 연동 결과가 화면에 보이기까지
//  «엑셀 → 자동배포 폴링(60초) → build_data → push → GitHub Pages 빌드»로
//  2~3분이 걸렸다. 이제는 benefits 를 먼저 읽어 «즉시» 최신을 보여준다.
//
//  ⚠ 폴백은 «정상 동작»이다 — 클라우드 실패(네트워크·권한·0건·지연)는 시민에게
//     오류로 보이지 않는다. 조용히 data.json 으로 그린다.
//  ⚠ 0건은 성공으로 보지 않는다(표가 비었는데 화면까지 비면 사고) → 폴백.
//  ⚠ 시민앱은 benefits 에 «읽기»만 한다. 절대 쓰지 않는다.
//  ⚠ 서비스워커(sw.js)는 타 출처 요청을 가로채지 않으므로 Supabase 응답은
//     캐시에 갇히지 않는다(= 항상 최신).
// ════════════════════════════════════════════════════════════════════════

const CLOUD_TIMEOUT_MS = 3500;   // 클라우드 조회 최대 대기(넘으면 폴백이 이긴다)
const FIRST_PAINT_MS = 1200;     // 첫 화면을 클라우드로 그리려고 기다리는 시간
const RECHECK_MIN_MS = 30000;    // 재확인 최소 간격(과도한 조회 방지)

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

// data.json 을 읽지 못한 «드문» 경우에만 쓰는 기본값.
// ⚠ build_data.py 의 ALWAYS_SHOW / situation_map 과 «동일하게» 유지할 것.
const FALLBACK_ALWAYS_SHOW = ["🏡 귀농·귀촌"];
const FALLBACK_SITUATION_MAP = [
  ["임신 중이거나 출산 예정", "👶 임신·출산"],
  ["영유아·미취학 아동 자녀가 있음", "🧸 영유아·보육"],
  ["초·중·고 학생 자녀가 있음", "📚 청소년·교육"],
  ["자녀가 2명 이상(다자녀 가구)", "👨‍👩‍👧‍👦 다자녀·가족"],
  ["한부모·조손 가정", "👩‍👦 한부모·조손"],
  ["1인 가구", "👤 1인가구"],
  ["다문화·외국인 가정", "🌏 다문화·외국인"],
  ["가구원 중 장애가 있음", "♿ 장애인"],
  ["기초생활수급·차상위·저소득", "💰 저소득·기초수급"],
  ["농업·축산·임업 종사", "🌾 농림축수산업"],
  ["귀농·귀촌 (예정 또는 정착)", "🏡 귀농·귀촌"],
  ["소상공인·창업 준비 중", "🏪 소상공인·기업"],
  ["구직 중·취업 준비 중", "💼 일자리·구직"],
  ["무주택·주거 지원이 필요", "🏠 주거·부동산"],
  ["국가유공자·보훈 대상", "🎖️ 보훈·유공자"],
  ["여성(경력단절 등)", "👩 여성"],
  ["건강·의료 지원이 필요", "🏥 건강·의료"],
];

// ── 공용 Supabase 클라이언트 ────────────────────────────────────────────
// forms.js·apply_client.js 가 각자 만들던 클라이언트를 하나로 모아 쓴다
// (같은 URL·anon key. GoTrue 인스턴스 중복 경고도 줄어든다).
let _cloudSb = null;
function cloudClient() {
  if (_cloudSb) return _cloudSb;
  try {
    const url = window.SUPABASE_URL || "";
    const key = window.SUPABASE_ANON_KEY || "";
    if (!window.supabase || !url || !key) return null;
    _cloudSb = window.supabase.createClient(url, key);
    try { window.SangjuForms && SangjuForms.useClient(_cloudSb); } catch (e) {}
    try { window.SangjuApply && SangjuApply.useClient(_cloudSb); } catch (e) {}
    return _cloudSb;
  } catch (e) {
    console.warn("[사업정보] Supabase 초기화 실패(내장 데이터로 동작):", e);
    return null;
  }
}

// ── 텍스트 정돈 — config.py tidy_text 와 «같은 규칙»(단일 출처는 config.py) ──
// 공백/빈 줄 정돈만 하고 «URL 은 살린다». 시민앱은 웹이라 본문 속 주소가 곧
// 신청하러 가는 문이다(정부24·복지로·상주시 누리집). 예전에는 PC 표시용 규칙인
// config.clean_text 를 그대로 써서 URL 을 지웠는데, 그러면 정보가 사라질 뿐 아니라
// 「정부24(https://www.gov.kr) 접수」가 「정부24( 접수」로 남아 문장이 깨졌다.
// 링크로 바꾸는 일은 화면 직전의 linkifyHtml() 이 맡는다(XSS 방지 포함).
// 이 함수는 «멱등»이라 이미 정돈된 값(data.json)에 다시 적용해도 결과가 같다.
//
// healOrphanParens: 예전 규칙으로 «이미 망가진» 값이 Supabase 에 남아 있어도
//   시민에게 깨진 문장을 보이지 않게 한다(클라우드 재동기화 전까지의 안전망).
//   ★ config.py heal_orphan_parens 와 «글자 그대로 같은 규칙» — 브라우저에서 돌아야 해서
//     어쩔 수 없이 두는 사본이다. config.py 를 고치면 여기도 반드시 같이 고칠 것.
//   ⚠ 먼저 «본문 전체»의 괄호 짝을 센다. 줄 단위로만 보면 여러 줄에 걸친 정상 괄호
//     (「…전입한 자 (」 + 다음 줄 「※ 단, …신청가능)」)에서 여는 괄호만 지워 버려
//     멀쩡한 문장을 되레 깨뜨린다(2026-08-04 검수 지적, 실데이터 1건).
function healOrphanParens(text) {
  const t = String(text);
  if ((t.match(/\(/g) || []).length === (t.match(/\)/g) || []).length) return t;
  return t.split("\n").map((ln) => {
    const open = (ln.match(/\(/g) || []).length;
    const close = (ln.match(/\)/g) || []).length;
    if (open <= close) return ln;                 // 괄호가 짝이면 손대지 않는다
    return ln.replace(/\(\s*$/, "")               // 줄 끝에 남은 여는 괄호
             .replace(/\(\s+/g, " ")              // 「( 접수」 → 「 접수」
             .replace(/[ \t]{2,}/g, " ").trim();
  }).join("\n");
}
function tidyText(s) {
  if (s == null) return "";
  let t = String(s).replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  t = t.split("\n").map((ln) => ln.replace(/[ \t]+/g, " ").trim()).join("\n");
  return healOrphanParens(t.replace(/\n{3,}/g, "\n\n").trim());
}

// ── 본문 속 주소를 «안전한 링크»로 ───────────────────────────────────────
// 원칙(전자정부 웹품질 지침·KWCAG 2.2):
//  · XSS 방지 — 데이터 문자열은 전부 esc() 로 이스케이프하고, 링크는 «우리가 만든»
//    <a> 태그로만 만든다. href 에 넣는 주소는 정규식이 http/https 로 시작하는
//    것만 잡으므로 javascript:·data: 같은 스킴은 애초에 들어올 수 없다(이중 확인).
//  · 새 창 열림을 알린다 — 눈에 보이는 ↗ 표식 + 화면낭독기용 '(새 창 열림)' 문구.
//  · 링크 이름만으로 목적지를 안다 — 「여기를 클릭」 금지. 주소의 호스트를 그대로 쓴다
//    (예: www.gov.kr). '자세히 보기: 주소' 형태는 「자세히 보기 (호스트)」 버튼으로.
const _URL_SCAN_RE = /(자세히\s*보기\s*[:：]?\s*)?(https?:\/\/[^\s<>"']+)/g;

// 주소 뒤에 붙은 문장부호를 떼어 본문으로 되돌린다.
// 「정부24(https://www.gov.kr) 접수」의 ') 접수' 나 「…kr)로 신청」의 ')로 신청' 처럼
// 괄호 앞에서 끊어 주지 않으면 주소에 한글·닫는 괄호가 섞여 링크가 깨진다.
function splitUrlTail(raw) {
  let url = raw;
  let depth = 0;
  for (let i = 0; i < url.length; i++) {
    const c = url[i];
    if (c === "(") depth++;
    else if (c === ")") {
      if (depth === 0) { return [url.slice(0, i), url.slice(i)]; }  // 짝 없는 ')' 에서 끊는다
      depth--;
    }
  }
  let tail = "";
  while (url.length && ".,;:!?·\"'」』”’".indexOf(url[url.length - 1]) >= 0) {
    tail = url[url.length - 1] + tail;
    url = url.slice(0, -1);
  }
  return [url, tail];
}

// 링크에 보일 이름 — 주소의 호스트(예: www.gov.kr, ihappycare.kr:4050).
// ⚠ new URL() 은 한글 도메인을 punycode(xn--…)로 바꿔 읽을 수 없게 만든다 → 직접 자른다.
function urlHost(u) {
  const m = /^https?:\/\/([^/?#]+)/i.exec(u);
  return m ? m[1] : u;
}

// 목록 카드의 «요약 한 줄»용 — 카드 자체가 role="button" 이라 그 안에 링크를 넣을 수
// 없다(버튼 안의 링크는 키보드·보조기기에서 동작이 어긋난다). 그래서 요약에서는
// 긴 주소를 호스트만 남긴 «글자»로 줄인다. 상세 화면에서 진짜 링크로 보여 주므로
// 정보가 사라지지 않는다.
function previewText(s) {
  const text = String(s == null ? "" : s);
  _URL_SCAN_RE.lastIndex = 0;
  return text.replace(_URL_SCAN_RE, (whole, detail, raw) => {
    const [url, tail] = splitUrlTail(raw);
    if (!/^https?:\/\//i.test(url)) return whole;
    return (detail ? "자세히 보기: " : "") + urlHost(url) + tail;
  });
}

// 여러 줄 텍스트 → 이스케이프된 HTML(+ 링크). 반환값만 innerHTML 에 넣는다.
function linkifyHtml(s) {
  const text = String(s == null ? "" : s);
  let out = "";
  let last = 0;
  _URL_SCAN_RE.lastIndex = 0;
  let m;
  while ((m = _URL_SCAN_RE.exec(text)) !== null) {
    const [url, tail] = splitUrlTail(m[2]);
    // 이중 확인: 우리가 href 에 넣는 값은 반드시 http(s) 로 시작한다.
    if (!/^https?:\/\//i.test(url)) continue;
    const detail = !!m[1];                       // '자세히 보기: 주소' 형태인가
    out += esc(text.slice(last, m.index));
    const href = esc(url);
    const label = detail ? `🔗 자세히 보기 (${urlHost(url)})` : urlHost(url);
    out += `<a class="${detail ? "link-btn" : "ext-link"}" href="${href}"`
      + ` target="_blank" rel="noopener noreferrer" title="${href}">`
      + `${esc(label)}<span aria-hidden="true"> ↗</span>`
      + `<span class="sr-only"> (새 창 열림)</span></a>`;
    out += esc(tail);
    last = m.index + m[0].length;
  }
  out += esc(text.slice(last));
  return out;
}
// 빈값 표기 정규화 — 엑셀/DB에서 넘어온 'nan'·'null' 문자열을 빈칸으로.
function txt(v) {
  const s = String(v == null ? "" : v).trim();
  return ["nan", "none", "null", "undefined"].indexOf(s.toLowerCase()) >= 0 ? "" : s;
}

// ── 중복 정리 — PC _dedupe_keep_latest / build_data.dedupe_keep_latest 동일 규칙 ──
// 같은 사업명이 여러 건이면 «정책번호가 큰 것 → 나중 행» 1건만 남긴다.
function _normName(s) { return String(s == null ? "" : s).replace(/\s+/g, "").trim(); }
function _pidOf(r) {
  const p = String(r && r.policy_no != null ? r.policy_no : "").trim();
  if (!p) return -1;
  const n = Number(p);
  return Number.isFinite(n) ? Math.trunc(n) : -1;
}
function dedupeKeepLatest(rows) {
  const best = new Map();
  rows.forEach((r, i) => {
    const key = _normName(r.name);
    if (!key) return;
    const pid = _pidOf(r);
    const prev = best.get(key);
    if (!prev || pid > prev.pid || (pid === prev.pid && i > prev.i)) best.set(key, { pid, i, r });
  });
  const seen = new Set();
  const out = [];
  rows.forEach((r) => {
    const key = _normName(r.name);
    if (!key) { out.push(r); return; }
    if (seen.has(key)) return;
    seen.add(key);
    out.push(best.get(key).r);
  });
  return out;
}

// ── 스키마 어댑터 — benefits 행 → data.json 아이템과 «동일한 형태» ────────
// 화면·검색·맞춤추천·상세·신청 코드는 아래 형태만 알면 되므로 한 줄도 바뀌지 않는다.
//
// 기관명·종료일(supabase/add_org_end_columns.sql, 2026-08-04):
//   · 기관명 → org_name,  종료일 → end_date (PC앱이 'YYYY-MM-DD' 로 정규화해 넣는다.
//     data.json 과 같은 형식이므로 «여기서 추가 변환하지 않는다» — 못 읽은 값은 원문 보존)
//   · ⚠ DDL 은 사람이 직접 실행하는 원칙이라 «아직 컬럼이 없을 수» 있다.
//     그때는 응답에 키 자체가 없으므로 txt() 가 빈 문자열을 돌려주고,
//     화면은 해당 줄을 통째로 생략한다(= 지금까지와 같은 모습, 깨지지 않음).
//   · 값을 지어내지 않는다. 컬럼이 없으면 빈 값이 정답이다.
function adaptCloudRow(r) {
  return {
    "사업명": txt(r.name),
    "내용": tidyText(txt(r.content)),
    "대상자상세기준": tidyText(txt(r.target)),
    "이용방법": tidyText(txt(r.method)),
    "필요서류": tidyText(txt(r.documents)),
    "기관명": txt(r.org_name),          // 컬럼 미생성 시 "" (화면에서 생략)
    "팀명": txt(r.team),
    "연락처": txt(r.contact),
    "담당자이메일": txt(r.manager_email),
    "종료일": txt(r.end_date),          // 컬럼 미생성 시 "" (화면에서 생략)
    "비고": tidyText(txt(r.note)),
    "categories": Array.isArray(r.categories) ? r.categories.filter(Boolean) : [],
  };
}

// 분야 칩 목록 — build_data.py 와 «동일» (사업에 붙은 분야 ∪ 항상 보일 분야, 기호 제외 정렬)
function _catSortKey(s) { return String(s).replace(/[^가-힣A-Za-z0-9]/g, ""); }
function buildCategoryList(programs, alwaysShow) {
  const found = new Set();
  (programs || []).forEach((p) => (p.categories || []).forEach((c) => found.add(c)));
  (alwaysShow || []).forEach((c) => found.add(c));
  return Array.from(found).sort((a, b) => {
    const ka = _catSortKey(a), kb = _catSortKey(b);
    return ka < kb ? -1 : (ka > kb ? 1 : 0);
  });
}

// ── 내용 서명 — «화면에 보이는 내용»이 달라졌는지 판정용 ──────────────────
// ⚠ 기관명·종료일은 «일부러» 뺀다. benefits 의 org_name·end_date 컬럼은 사람이
//    SQL 을 실행해야 생기므로, 실행 전에는 클라우드 값이 비어 있고 data.json 에는
//    값이 있다. 이걸 비교에 넣으면 내용이 그대로인데도 «갱신되었습니다» 띠가
//    계속 뜬다(오탐). 두 값만 바뀌는 경우는 드물어 실익보다 손해가 크다.
function _hash(s) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  return h.toString(36);
}
function dataSignature(programs) {
  const list = programs || [];
  const body = list.map((p) => [
    p.사업명, p.내용, p.대상자상세기준, p.이용방법, p.필요서류,
    p.팀명, p.연락처, p.담당자이메일, p.비고, (p.categories || []).join(","),
  ].join("")).join("");
  return list.length + ":" + _hash(body);
}

// ── 조회 ────────────────────────────────────────────────────────────────
// 내장 데이터(data.json). 실패해도 throw 하지 않고 null 을 준다.
async function loadLocalData() {
  try {
    const res = await fetch("data.json", { cache: "no-store" });
    if (!res.ok) throw new Error("HTTP " + res.status);
    const j = await res.json();
    if (!j || !Array.isArray(j.programs) || !j.programs.length) return null;
    return j;
  } catch (e) {
    console.warn("[사업정보] data.json 을 읽지 못했습니다:", e);
    return null;
  }
}

// 클라우드(benefits). 정렬은 공무원앱(cloudui)과 «동일» — seq(빈값 뒤) → id.
// 타임아웃(CLOUD_TIMEOUT_MS)을 반드시 건다. 실패/0건이면 null.
async function loadCloudData() {
  const sb = cloudClient();
  if (!sb) return null;
  let ctrl = null;
  try {
    let q = sb.from("benefits").select("*").order("seq", { nullsFirst: false }).order("id");
    if (typeof AbortController !== "undefined" && typeof q.abortSignal === "function") {
      ctrl = new AbortController();
      q = q.abortSignal(ctrl.signal);
    }
    const timeout = delay(CLOUD_TIMEOUT_MS).then(() => {
      try { if (ctrl) ctrl.abort(); } catch (e) {}
      return { __timeout: true };
    });
    const res = await Promise.race([Promise.resolve(q), timeout]);
    if (!res || res.__timeout) {
      console.warn("[사업정보] 클라우드 응답 지연 — 내장 데이터로 표시합니다.");
      return null;
    }
    if (res.error) throw res.error;
    const rows = res.data || [];
    if (!rows.length) return null;            // 0건은 성공으로 보지 않는다 → 폴백
    const programs = dedupeKeepLatest(rows).map(adaptCloudRow).filter((p) => p.사업명);
    if (!programs.length) return null;
    return { programs: programs, sig: dataSignature(programs) };
  } catch (e) {
    console.warn("[사업정보] 클라우드 조회 실패 — 내장 데이터로 표시합니다:", e);
    return null;
  }
}

// 클라우드 사업목록 + 내장 데이터의 정적 설정(항상 보일 분야·상황 목록)을 합친다.
function buildCloudData(local, programs) {
  const always = (local && local.always_show && local.always_show.length)
    ? local.always_show : FALLBACK_ALWAYS_SHOW;
  const situations = (local && Array.isArray(local.situation_map) && local.situation_map.length)
    ? local.situation_map : FALLBACK_SITUATION_MAP;
  return {
    generated: (local && local.generated) || "",
    always_show: always,
    situation_map: situations,
    categories: buildCategoryList(programs, always),
    programs: programs,
    source: "cloud",
  };
}

function showInitError(e) {
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
}

// ── 갱신 «알림»(자동 교체 아님) ──────────────────────────────────────────
// v0.0.4 원칙: 새 내용이 생겨도 화면을 저절로 바꾸지 않는다. 띠로 알리고,
// 시민이 «새로고침»을 누를 때만 반영한다(KWCAG 6.2.2 자동 변경 금지).
let displaySig = "";        // 지금 화면에 그려진 사업 정보의 서명
let updatePending = false;  // 아직 반영하지 않은 갱신이 있는가
let updateMsg = "사업 정보가 새로 갱신되었습니다";
let lastCloudCheck = 0;
let cloudChecking = false;

// 초점을 «문서 맨 처음»으로 되돌린다 — KWCAG 2.2 「6.4.3 초점 이동과 표시」.
// 알림 띠를 닫으면 초점을 쥐고 있던 닫기 버튼이 사라지는데, 그대로 두면 초점이
// <body> 로 떨어져 «다음 Tab 이 문서 처음부터» 시작한다(키보드 이용자 혼란).
// → 본문(#app, tabindex="-1")으로 옮겨 다음 Tab 이 본문에서 이어지게 한다.
// ★ 공무원앱 webui/app.js focusDocumentStart() 와 같은 규약.
function focusMain() {
  const m = $("app");
  if (!m || !m.focus) return;
  try { m.focus({ preventScroll: true }); } catch (e) { try { m.focus(); } catch (e2) {} }
}

// 갱신 알림 켜기(화면은 그대로 — 시민이 «새로고침»을 누를 때만 반영)
function noticeUpdate(msg) {
  updatePending = true;
  if (msg) updateMsg = msg;
  syncUpdateBanner();
}

// 신청서 작성·문의·제안 작성 중이거나 모달이 열려 있으면 띠를 띄우지 않는다(작업 방해 금지)
function updateBusy() {
  const busyViews = ["apply", "inquiry", "pwrite", "done"];
  if (busyViews.some((v) => { const el = $("view-" + v); return el && !el.hidden; })) return true;
  return ["teamModal", "versionModal", "installModal", "pinModal", "reportModal"]
    .some((id) => { const m = $(id); return m && !m.hidden; });
}

function syncUpdateBanner() {
  const box = $("dataRtBanner");
  if (!box) return;
  const show = updatePending && !updateBusy();
  if (show) $("dataRtText").textContent = updateMsg;
  box.hidden = !show;
}

// 클라우드를 다시 조회해 «내용이 달라졌으면» 알림만 켠다(화면은 그대로).
async function recheckCloud(force) {
  if (cloudChecking) return;
  const now = Date.now();
  if (!force && now - lastCloudCheck < RECHECK_MIN_MS) return;
  lastCloudCheck = now;
  cloudChecking = true;
  try {
    const cloud = await loadCloudData();
    if (cloud && cloud.sig !== displaySig) noticeUpdate("사업 정보가 새로 갱신되었습니다");
  } finally {
    cloudChecking = false;
  }
}

// 최신성 반영 방식: «상시 연결(Realtime)» 이 아니라 «재진입·포커스 시 재조회(폴링)».
//  · 시민앱은 오래 열어두는 앱이 아니고, 화면 복귀 시 한 번만 확인하면 충분하다.
//  · 상시 WebSocket 은 배터리·데이터·동시접속을 계속 소모한다(공무원앱만 사용).
function initFreshness() {
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) recheckCloud(false);
  });
  window.addEventListener("focus", () => recheckCloud(false));
  window.addEventListener("online", () => recheckCloud(true));
}

async function init() {
  // ⏱ 첫 화면 예산은 «init 진입 시점»부터 잰다(절대 예산).
  //    예전에는 await localP 뒤에 타이머를 걸어서, 실제 대기가
  //    «data.json 로드 시간 + 1.2초»가 됐다(느린 회선에서 첫 화면이 그만큼 늦어짐).
  const budget = delay(FIRST_PAINT_MS).then(() => ({ ready: false, v: null }));
  const localP = loadLocalData();   // 동일 출처(빠름) — 실패해도 null
  const cloudP = loadCloudData();   // 타임아웃 내장 — 실패/0건이면 null

  const local = await localP;
  // 클라우드가 «충분히 빨리» 오면 그걸로 첫 화면을 그린다(가장 최신).
  // 늦으면 기다리지 않고 내장 데이터로 먼저 그린다 — 빈 화면을 오래 보이지 않게.
  const first = await Promise.race([
    cloudP.then((v) => ({ ready: true, v: v })),
    budget,
  ]);
  let cloud = first.ready ? first.v : null;
  // 폴백이 아예 없으면(내장 데이터도 못 읽음) 클라우드를 끝까지 기다린다.
  if (!cloud && !local) cloud = await cloudP;

  if (cloud) DATA = buildCloudData(local, cloud.programs);
  else if (local) DATA = local;
  else { showInitError(new Error("데이터를 불러오지 못했습니다")); return; }

  displaySig = dataSignature(DATA.programs);

  state.navStack = [{ v: "home", t: HOME_TITLE }];
  state.fwdStack = [];
  renderCategoryChips();
  renderSituations();
  bindEvents();
  showView("home", false);
  checkNewPrograms();
  initInApp();
  initA2HS();
  initFreshness();

  // 내장 데이터로 먼저 그린 경우: 늦게 도착한 클라우드는 «알림»만 띄운다.
  if (!cloud) {
    cloudP.then((late) => {
      if (late && late.sig !== displaySig) noticeUpdate("사업 정보가 새로 갱신되었습니다");
    });
  }
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
    // ⚠ 예전에는 aria-label 로 이름만 읽어줘서, 화면낭독기 이용자에게는 카드 안의
    //    «내용 요약·담당팀·접수 안내»가 통째로 가려졌다(aria-label 이 하위 텍스트를 덮음).
    // → aria-labelledby(제목) + aria-describedby(요약·담당·안내)로 바꿔
    //    보이는 정보를 그대로 읽게 한다. 색만으로 알리지 않도록 '접수 안내 있음'은 글자로도 둔다.
    const tid = `cardT${idx}`, did = `cardD${idx}`, mid = `cardM${idx}`;
    return `<div class="card" data-idx="${idx}" role="button" tabindex="0"
      aria-labelledby="${tid}" aria-describedby="${did} ${mid}">
      <h3 id="${tid}">${esc(p.사업명)}</h3>
      <p id="${did}">${esc(previewText(p.내용 || p.대상자상세기준))}</p>
      <span class="card-meta" id="${mid}">
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
  // 본문 칸(내용·대상·이용방법·필요서류)은 linkifyHtml 로 «이스케이프 + 주소만 링크».
  // 그 밖의 칸(종료일 등)은 순수 텍스트라 esc 만 쓴다.
  const block = (k, v) => v ? `<div class="detail-block"><div class="k">${k}</div><div class="v">${linkifyHtml(v)}</div></div>` : "";
  const blockText = (k, v) => v ? `<div class="detail-block"><div class="k">${k}</div><div class="v">${esc(v)}</div></div>` : "";
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
         <p class="notice-v">${linkifyHtml(note)}</p>
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
    ${blockText("📅 종료일", p.종료일)}
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
         <p class="notice-v">${linkifyHtml(note)}</p>
       </div>`
    : "";
  $("applyName").value = "";
  $("applyPhone").value = "";
  $("applyMemo").value = "";
  // ⚖ 동의는 «신청할 때마다» 새로 받는다(이전 신청의 체크가 남아 있으면 안 된다).
  $("applyConsent").checked = false;
  clearApplyErrors();
  showView("apply");
}

// ── 입력 오류 표시 (KWCAG 7.3.1 «오류 정정») ──────────────────────────────
// 예전에는 alert() 한 줄로 "이름과 연락처를 입력해 주세요"만 띄워서
//  · 어느 칸이 잘못됐는지 알 수 없고  · 초점이 옮겨가지 않아 다시 찾아 들어가야 했다.
// → 이제 «해당 칸 옆»에 오류를 붙이고(aria-describedby 로 연결·role=alert 로 낭독),
//   aria-invalid 로 오류 상태를 알리고, 첫 오류 칸으로 «초점»을 옮긴다.
function setFieldError(inputId, errId, msg) {
  const input = $(inputId), err = $(errId);
  if (err) { err.textContent = msg || ""; err.hidden = !msg; }
  if (input) {
    if (msg) input.setAttribute("aria-invalid", "true");
    else input.removeAttribute("aria-invalid");
  }
}
function clearApplyErrors() {
  setFieldError("applyName", "applyNameErr", "");
  setFieldError("applyPhone", "applyPhoneErr", "");
  setFieldError("applyConsent", "applyConsentErr", "");
}

async function sendApply() {
  const p = DATA.programs[currentIdx];
  const name = $("applyName").value.trim();
  const phone = $("applyPhone").value.trim();
  const memo = $("applyMemo").value.trim();

  // 검증 — 위에서부터 순서대로 확인하고, «첫 번째» 오류 칸으로 초점을 옮긴다.
  clearApplyErrors();
  let firstBad = null;
  if (!name) {
    setFieldError("applyName", "applyNameErr", "신청자 이름을 입력해 주세요.");
    firstBad = firstBad || "applyName";
  }
  if (!phone) {
    setFieldError("applyPhone", "applyPhoneErr", "연락처를 입력해 주세요.");
    firstBad = firstBad || "applyPhone";
  } else if (phone.length < 10) {
    setFieldError("applyPhone", "applyPhoneErr", "연락처를 다시 확인해 주세요. (- 없이 숫자 10~11자리)");
    firstBad = firstBad || "applyPhone";
  }
  // ⚖ 개인정보 수집·이용 동의(필수) — 미동의면 «수집 자체»를 하지 않는다.
  //    구 PC앱 apply_view.py 의 차단 로직과 같은 규칙. 절대 건너뛰지 말 것.
  if (!$("applyConsent").checked) {
    setFieldError("applyConsent", "applyConsentErr",
      "개인정보 수집·이용에 동의하셔야 신청할 수 있습니다.");
    firstBad = firstBad || "applyConsent";
  }
  if (firstBad) {
    const el = $(firstBad);
    if (el && el.focus) { try { el.focus({ preventScroll: false }); } catch (e) { el.focus(); } }
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

  // 접수번호(클라 생성) — Supabase 저장·완료화면 공용. PC 포맷 YYYYMMDD-HHMMSS-01.
  const receiptNo = (window.SangjuApply && SangjuApply.genReceiptNo)
    ? SangjuApply.genReceiptNo(1) : "";

  // ── 두 경로를 «독립» 실행 ──────────────────────────────────────────────
  //  (1) Supabase 저장 = «접수»의 정본(공무원앱 실시간 접수)  (2) 메일 = 보조 알림.
  //  ⚠ 어느 하나가 실패해도 다른 하나로 접수되면 «완료»로 본다(둘 다 실패해야 실패 안내).
  //  ⚠ applications 테이블이 아직 없을 수 있으므로(미실행) Supabase 실패는 삼키고
  //     기존 메일 경로(PC 자동접수)가 접수를 이어받게 한다 — 앱이 깨지지 않게 방어.
  let supaOK = false, mailOK = false, supaErr = null, mailErr = null;
  let savedReceipt = receiptNo;

  // (1) Supabase 직접 저장 — 개인정보(이름·연락처)가 클라우드로 전송됨(프로토타입·승인됨).
  if (window.SangjuApply && SangjuApply.submitApplication) {
    try {
      const row = await SangjuApply.submitApplication({
        receipt_no:     receiptNo,
        benefit_name:   p.사업명,
        benefit_key:    SangjuApply.benefitKey(p),
        applicant_name: name,
        phone:          phone,
        memo:           memo,
        team:           p.팀명 || "",
        manager_email:  p.담당자이메일 || "",
        source:         "모바일",
        // status·admin_memo·created_at 은 보내지 않음(서버 기본 '접수'/트리거)
      });
      supaOK = true;
      if (row && row.receipt_no) savedReceipt = row.receipt_no;
    } catch (e) {
      supaErr = e;
      console.warn("[신청] Supabase 저장 실패(메일 경로로 접수 진행):", e);
    }
  }

  // (2) 메일(Web3Forms) — 기존 로직 그대로. Supabase 성공/실패와 무관하게 항상 발송.
  try {
    const res = await fetch("https://api.web3forms.com/submit", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(form),
    });
    const j = await res.json();
    if (!j.success) throw new Error(j.message || "전송 실패");
    mailOK = true;
  } catch (e) {
    mailErr = e;
    console.warn("[신청] 메일 전송 실패:", e);
  }

  btn.disabled = false;
  btn.textContent = orig;

  if (supaOK || mailOK) {
    // 접수번호는 Supabase 저장이 성공했을 때만 표시(그 값이 공무원앱과 공유되는 정본).
    showDone(p, supaOK ? savedReceipt : "");
  } else {
    const detail = (supaErr && supaErr.message) || (mailErr && mailErr.message) || "";
    alert("신청 접수에 실패했습니다.\n인터넷 연결을 확인하고 다시 시도해 주세요.\n\n(" + detail + ")");
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
    // 직전 신청 완료의 접수번호가 남아있지 않도록 숨긴다(문의는 접수번호가 없음)
    if ($("doneReceipt")) { $("doneReceipt").textContent = ""; $("doneReceipt").hidden = true; }
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

function showDone(p, receiptNo) {
  $("topTitle").textContent = "접수 완료";
  // 문의 완료로 바뀌었던 문구를 신청 완료용으로 복원
  document.querySelector("#view-done h2").textContent = "신청이 접수되었습니다";
  document.querySelector("#view-done .done-desc").innerHTML =
    "담당 부서로 신청 내용이 전달되었습니다.<br>처리 결과는 담당자가 연락처로 안내드립니다.";
  $("doneProgram").textContent = p.사업명;
  // 접수번호(Supabase 저장 성공 시) — 있으면 표시, 없으면 숨김
  const rc = $("doneReceipt");
  if (rc) {
    const no = (receiptNo || "").trim();
    if (no) { rc.textContent = "접수번호 " + no; rc.hidden = false; }
    else { rc.textContent = ""; rc.hidden = true; }
  }
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
  // ★ 모달이 열려 있는 동안은 갱신 알림 띠를 억제하므로(작업 방해 금지),
  //   닫히는 «이 시점»에 다시 계산해야 한다. 안 하면 모달을 닫아도 띠가
  //   다음 화면 이동 때까지 안 뜬다. 다섯 모달의 닫기 경로가 모두 이 함수를
  //   지나므로 여기 한 곳에서 처리한다(app.js 3개 + proposals.js 2개).
  function close(modalId) {
    const opener = teardown(modalId);
    if (opener && typeof opener.focus === "function") {
      try { opener.focus(); } catch (e) {}
    }
    try { syncUpdateBanner(); } catch (e) { /* 무시 */ }
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
    setFieldError("applyPhone", "applyPhoneErr", "");   // 고치는 즉시 오류 표시 해제
  });
  // 제출은 form 의 submit 으로 받는다 — 버튼 클릭·Enter·휴대폰 자판 «완료» 모두 동작.
  // (버튼이 type="submit" 이라 click 리스너를 따로 달면 두 번 실행된다)
  $("applyForm").addEventListener("submit", (e) => { e.preventDefault(); sendApply(); });
  // 입력을 고치면 그 칸의 오류 표시를 즉시 지운다(고쳤는데 빨간 글씨가 남지 않게)
  $("applyName").addEventListener("input", () => setFieldError("applyName", "applyNameErr", ""));
  $("applyConsent").addEventListener("change", () => {
    if ($("applyConsent").checked) setFieldError("applyConsent", "applyConsentErr", "");
  });
  // 신청 폼 안에서 처리방침 열기 — 돌아오면 작성 중이던 내용이 남아 있어야 하므로
  // 화면 전환(showView)만 하고 폼은 초기화하지 않는다.
  $("applyPrivacyLink").addEventListener("click", openPrivacy);
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
  // 닫으면 버튼이 사라지므로 초점을 본문으로 옮긴다(초점 유실 방지 — KWCAG 6.4.3)
  $("newBannerClose").addEventListener("click", () => {
    $("newBanner").hidden = true;
    focusMain();
  });
  // 사업 정보 갱신 알림 띠 — «새로고침»을 눌러야 반영(자동 교체 없음)
  const dataRtBtn = $("dataRtBtn");
  if (dataRtBtn) dataRtBtn.addEventListener("click", () => location.reload());
  const dataRtClose = $("dataRtClose");
  if (dataRtClose) dataRtClose.addEventListener("click", () => {
    updatePending = false;
    syncUpdateBanner();
    focusMain();   // 닫기 버튼이 사라지므로 초점을 본문으로(초점 유실 방지)
  });
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
              // 예전엔 콘솔에만 알려서, 이미 방문한 이용자는 «앱을 두 번 열어야»
              // 새 버전이 적용됐다. 이제 갱신 알림 띠로 알려 «한 번»에 끝낸다.
              // (자동 새로고침은 하지 않는다 — 보던 화면이 저절로 바뀌면 안 됨)
              try { noticeUpdate("앱이 새 버전으로 준비되었습니다"); } catch (e) {}
            }
          });
        });
      })
      .catch((err) => {
        console.warn("[PWA] 서비스워커 등록 실패(앱은 정상 동작):", err);
      });
  });
}
