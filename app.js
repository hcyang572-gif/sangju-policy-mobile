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
  "mystatus", "propose", "pdetail", "pwrite", "privacy"];

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
// 실시간 반영(2026-08-18) — 공무원앱·PC앱에서 사업을 고치면 시민 화면도 몇 초 안에 따라온다.
//  · 위 방침(재진입·포커스 시 재조회)은 «화면을 안 보고 있을 때» 를 위한 것이고,
//    이건 «보고 있는 동안» 을 위한 것이다. 셋을 나란히 놓고 쓰는 자리에서 시민앱만
//    반응이 없으면 연동이 안 되는 것처럼 보인다.
//  · 얌전하게 쓴다:
//    ① 이벤트가 한꺼번에 쏟아져도(한 번 동기화에 수십 행) 1.5초로 «묶어서» 한 번만 처리한다.
//    ② 실제로 내용이 달라졌을 때만 움직인다(서명 비교).
//    ③ 읽기만 하는 화면이면 스스로 새로고침하고, 신청서·문의를 «쓰는 중»이면
//       화면을 건드리지 않고 알림 띠만 올린다 — 입력하던 내용이 날아가면 안 된다.
//  · 정책제안(proposals)은 proposals.js 가 이미 따로 구독한다(중복 구독하지 않는다).
const RT_QUIET_VIEWS = ["home", "list", "recommend", "detail"];
let _rtTimer = null, _rtReloading = false;

function _currentView() {
  const top = state.navStack[state.navStack.length - 1];
  return top ? top.v : "home";
}

async function _onBenefitsChanged() {
  if (_rtReloading) return;
  try {
    const cloud = await loadCloudData();
    if (!cloud || cloud.sig === displaySig) return;   // 실제 변화가 있을 때만
    if (RT_QUIET_VIEWS.indexOf(_currentView()) >= 0) {
      _rtReloading = true;
      location.reload();
    } else {
      noticeUpdate("사업 정보가 새로 갱신되었습니다");
    }
  } catch (e) { /* 조용히 넘긴다 — 다음 이벤트나 재진입 때 다시 본다 */ }
}

function initBenefitsRealtime() {
  const sb = cloudClient();
  if (!sb || !sb.channel) return;                     // 클라우드 미설정이면 예전대로 동작
  try {
    sb.channel("benefits-rt-citizen")
      .on("postgres_changes", { event: "*", schema: "public", table: "benefits" }, () => {
        clearTimeout(_rtTimer);
        _rtTimer = setTimeout(_onBenefitsChanged, 1500);   // 몰아치는 이벤트를 한 번으로
      })
      .subscribe();
  } catch (e) {
    console.warn("[실시간] 사업 구독 실패 — 재진입 시 재조회로 동작합니다:", e);
  }
}
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
  initBenefitsRealtime();
  initMyStatus();   // 서버에 조회 함수가 있을 때만 «내 신청 현황» 진입점을 보인다(실패해도 무해)

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

// 🔑 조회코드 복사 — 결과는 alert 대신 «상자 안 안내문»으로 알린다(작업 흐름을 끊지 않게).
async function copyLookupCode() {
  const code = ($("doneCode") ? $("doneCode").textContent : "").trim();
  const msg = $("doneCodeMsg");
  if (!code) return;
  let ok = false;
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(code);
      ok = true;
    } else { throw new Error("no clipboard api"); }
  } catch (e) {
    try {
      const t = document.createElement("input");
      t.value = code; document.body.appendChild(t);
      t.select(); document.execCommand("copy");
      document.body.removeChild(t);
      ok = true;
    } catch (e2) { ok = false; }
  }
  if (msg) {
    msg.textContent = ok
      ? "조회코드를 복사했습니다. 메모장이나 문자에 붙여넣어 보관해 주세요."
      : "복사하지 못했습니다. 화면의 코드를 직접 적어 주세요.";
  }
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
  // 🔑 조회코드(클라 생성) — 나중에 «내 신청 현황»을 여는 열쇠.
  //    ⚠ 메일(Web3Forms) 본문에는 «넣지 않는다». 메일 경로(PC 자동접수)는 엑셀 접수대장에
  //      기록할 뿐 Supabase 행을 만들지 않아, 그 코드로는 조회되지 않는다.
  //      → 코드는 Supabase 저장이 «성공했을 때만» 기기에 보관하고 화면에 보여 준다.
  //    ⚠ genLookupCode 는 안전한 난수를 만들 수 없으면 «오류를 낸다»(Math.random 폴백 없음).
  //      그때는 신청을 진행하지 않고 멈춘다 — 예측 가능한 코드로 남의 신청이 열리면 안 된다.
  let lookupCode = "";
  if (window.SangjuApply && SangjuApply.genLookupCode) {
    try {
      lookupCode = SangjuApply.genLookupCode(10);
    } catch (e) {
      btn.disabled = false;
      btn.textContent = orig;
      alert((e && e.message) ||
        "이 브라우저에서는 안전한 조회코드를 만들 수 없어 신청을 진행할 수 없습니다.");
      return;
    }
  }

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
        lookup_code:    lookupCode || null,   // 빈 문자열이면 null 로 — 서버 정책이 '없거나 8~32자'만 받는다
        // status·admin_memo·citizen_reply·created_at 은 보내지 않음(서버 기본 '접수'/트리거)
      });
      // ✅ 저장 성공 판정 = «throw 없이 끝났는가». «서버가 행을 돌려줬는가»가 아니다.
      //    submitApplication 은 개인정보 테이블에 RETURNING(.select()) 을 쓰지 않으므로
      //    (그러면 익명에게 SELECT 권한이 없어 저장 자체가 거부된다 — apply_client.js 주석 참조)
      //    돌려받는 row 는 «우리가 보낸 행»이다. receipt_no·lookup_code 는 어차피 클라가 만든 값이라
      //    이 판정으로 완료화면·조회코드 보관이 그대로 성립한다.
      supaOK = true;
      if (row && row.receipt_no) savedReceipt = row.receipt_no;
      // 이 기기에 조회코드를 보관 → 다음에 «내 신청 현황»에서 자동으로 조회된다.
      //   ⚠ 보관 조건은 여전히 «Supabase 저장 성공»이다(여기 try 안에서만 부른다).
      //     메일만 나간 접수는 Supabase 행이 없어 그 코드로 조회되지 않는다.
      saveLookupEntry({
        code: lookupCode,
        receipt_no: savedReceipt,
        benefit_name: p.사업명,
        at: new Date().toISOString(),
      });
    } catch (e) {
      supaErr = e;
      // «조용한 실패» — 시민에게는 알리지 않는다(접수 자체는 메일 경로로 이어진다).
      //   시민을 불안하게 만들 이유가 없고, 시민이 할 수 있는 조치도 없다.
      //   대신 원인 분류(conn/perm/setup/other)를 콘솔에 함께 남겨,
      //   «닿지 못함(conn)»과 «권한 거부(perm)»를 나중에 구분할 수 있게 한다.
      //   ⚠ perm 이 반복되면 서버 정책이 아니라 «클라이언트가 RETURNING 을 쓰고 있지 않은지»를
      //     먼저 의심할 것(2026-08-18 실제 장애 원인).
      let kind = "";
      try { kind = (window.SangjuApply && SangjuApply.errKind) ? SangjuApply.errKind(e) : ""; } catch (e2) {}
      console.warn("[신청] Supabase 저장 실패(메일 경로로 접수 진행) kind=" + kind + ":", e);
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

  // Supabase 저장이 성공했다 = 서버에 닿았다. 앱을 켤 때 프로브가 네트워크 때문에
  // 실패해 «아직 모름»으로 남아 있다면, 완료 화면을 그리기 «전에» 한 번 더 확인한다.
  if (supaOK && msAvail !== "ok") {
    try { await msProbe(); } catch (e) { /* 확인 못해도 코드는 보여 준다 */ }
  }

  if (supaOK || mailOK) {
    // 접수번호·조회코드는 Supabase 저장이 성공했을 때만 표시(그 값이 공무원앱과 공유되는 정본).
    showDone(p, supaOK ? savedReceipt : "", supaOK ? lookupCode : "");
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
    // 조회코드 상자·«내 신청 현황» 버튼도 함께 감춘다(문의는 조회 대상이 아님)
    setDoneCode("");
    if ($("doneStatus")) $("doneStatus").hidden = true;
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

function showDone(p, receiptNo, lookupCode) {
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
  // 🔑 조회코드 안내 — 저장이 성공했고, 서버에 조회 함수가 «없다고 확인되지 않았을 때» 보여 준다.
  //    (함수가 «없다»고 확인된 서버에서만 감춘다. «아직 모름»이면 보여 준다 —
  //     네트워크가 잠깐 흔들렸다는 이유로 시민이 코드를 못 받는 일이 없어야 한다.)
  setDoneCode(msCodeUIVisible() ? lookupCode : "");
  // «내 신청 현황 보기» 버튼도 같은 기준
  if ($("doneStatus")) $("doneStatus").hidden = !(msCodeUIVisible() && (lookupCode || "").trim());
  // 완료 화면 이후 뒤로가기는 홈으로 가도록 스택 정리
  state.navStack = [{ v: "home", t: HOME_TITLE }, { v: "done", t: "접수 완료" }];
  state.fwdStack = [];
  showView("done", false);
}

// ════════════════════════════════════════════════════════════════════════
//  🧾 내 신청 현황 — 시민이 «자기 신청»의 진행 상태를 스스로 본다 (2026-08-18)
//  ----------------------------------------------------------------------
//  왜 이렇게 만드는가
//    applications 에는 이름·연락처가 들어 있어 익명 조회를 RLS 로 막아 두었다(그 문은 열지 않는다).
//    대신 서버 함수 check_application_status(조회코드) 가 «상태 몇 줄»만 돌려준다.
//    → 이 화면은 신청할 때 만든 조회코드로 그 함수만 부른다.
//  지키는 규칙
//    ① 화면에 «이름·연락처»를 다시 뿌리지 않는다 — 서버 함수도 애초에 주지 않는다.
//    ② 20초 폴링은 «이 화면이 눈에 보일 때만» 돈다(다른 화면·백그라운드에서는 아무 일도 하지 않는다).
//    ③ ⏸ 정지 버튼을 둔다 — 스스로 바뀌는 화면은 멈출 수 있어야 한다(KWCAG 2.2 «정지 기능 제공»).
//    ④ 실제로 달라졌을 때만 다시 그린다(초점·스크롤이 20초마다 튀지 않게).
//    ⑤ 서버에 함수가 «없을 때만»(PGRST202) 진입점을 조용히 숨긴다.
//       ⚠ 네트워크 오류로 숨기지 않는다 — 아래 «3값 프로브» 참조.
//    ⑥ 🧹 이 기기에서 지우기 — 공용 기기에서 앞사람 코드가 남지 않게 스스로 지울 수 있어야 한다.
//    ⑦ 보관 코드는 180일이 지나면 자동으로 사라진다(개인정보 처리방침에 적은 그대로).
//
//  ⭐ 폴링 구조 (2026-08-18 개편, 🩷 security-privacy 지적)
//     · 코드마다 1회씩 8초 폴링 → 분당 최대 225회 = «코드 대입 공격»과 트래픽 모양이 같았다.
//     · 이제 배열 함수 check_application_status_many 를 «먼저» 부르고(1회 왕복),
//       그 함수가 아직 서버에 없으면(PGRST202) 단건 함수로 «조용히» 폴백한다.
//     · 주기는 8초 → 20초.
//
//  ⭐ 3값 프로브 (2026-08-18, 🔴 reviewer 가 찾은 실제 버그의 수정)
//     예전에는 앱을 켤 때 프로브를 «딱 한 번» 던져 실패하면 msAvailable=false 로 굳었다.
//     그때 마침 네트워크가 불안정하면(콜드스타트 직후 흔하다) 그 세션 내내
//     신청이 성공해도 조회코드 상자와 진입점이 숨겨졌다 = 시민이 코드를 못 받았다.
//     → 이제 상태를 3값으로 둔다.
//        "unknown"     : 아직 모름(네트워크 실패 포함) → 코드는 «보여 주고», 나중에 다시 확인
//        "ok"          : 함수가 있다 → 진입점 노출
//        "unavailable" : 함수가 «없다»고 서버가 명확히 답했다(PGRST202) → 조용히 숨김
//     다시 확인하는 시점: ① 「내 신청 현황」에 들어올 때 ② 신청이 Supabase 에 저장된 직후.
// ════════════════════════════════════════════════════════════════════════
const LOOKUP_KEY = "sangju_lookup_codes";   // [{code, receipt_no, benefit_name, at}]
const LOOKUP_MAX = 30;                      // 기기에 보관할 최대 건수(오래된 것부터 버림)
const LOOKUP_TTL_MS = 180 * 24 * 60 * 60 * 1000;   // 보관 코드 자동 만료 — 180일
const LOOKUP_TOUCH_MS = 12 * 60 * 60 * 1000;       // «마지막 확인일» 갱신 주기(잦은 쓰기 방지)
const MS_POLL_MS = 20000;                   // 폴링 주기 20초(예전 8초 — 위 ⭐ 참조)

let msAvail = "unknown";   // "unknown" | "ok" | "unavailable"  (위 ⭐ 3값 프로브)
let msBatch = "unknown";   // 배열 호출 함수가 서버에 있는가: "unknown" | "yes" | "no"
let msAuto = true;         // ⏸ 자동 새로고침 on/off
let msTimer = null, msBusy = false;
let msRows = [], msSig = "", msErr = false, msLoaded = false;
let msDeferred = false;    // 목록 안에 초점이 있어 «미뤄 둔» 갱신이 있는가
let msFocusBound = false;

// 조회코드 상자·«내 신청 현황» 버튼을 보여 줄까?
//   «없다»고 서버가 확인해 준 경우에만 감춘다 — 모를 때는 보여 준다(코드를 못 받는 사고 방지).
function msCodeUIVisible() { return msAvail !== "unavailable"; }

// ── 기기 보관(localStorage) ────────────────────────────────────────────
// 읽을 때마다 180일이 지난 항목을 «걸러서 되쓴다» — 오래된 코드가 기기에 남지 않게.
function loadLookupEntries() {
  let list = [];
  try {
    const raw = JSON.parse(localStorage.getItem(LOOKUP_KEY) || "[]");
    list = Array.isArray(raw) ? raw.filter((e) => e && typeof e.code === "string") : [];
  } catch (e) { return []; }
  const now = Date.now();
  let changed = false;
  const kept = [];
  list.forEach((e) => {
    const t = Date.parse(e.at || "");
    if (isNaN(t)) {
      // 날짜가 없거나 깨진 옛 기록 — 지금 시각을 찍어 두고 여기서부터 180일을 센다.
      e.at = new Date(now).toISOString();
      changed = true;
      kept.push(e);
      return;
    }
    if (now - t < LOOKUP_TTL_MS) kept.push(e);
    else changed = true;                       // 180일 경과 → 버린다
  });
  if (changed) {
    try { localStorage.setItem(LOOKUP_KEY, JSON.stringify(kept)); } catch (e) { /* 무시 */ }
  }
  return kept;
}

// 조회에 성공한 코드의 «마지막 확인일»을 갱신한다(180일은 마지막 확인일부터 센다).
//   20초마다 저장소에 쓰지 않도록 12시간에 한 번만 찍는다.
function touchLookupEntries(codes) {
  if (!codes || !codes.length) return;
  const now = Date.now();
  const list = loadLookupEntries();
  let changed = false;
  list.forEach((e) => {
    if (codes.indexOf(e.code) < 0) return;
    const t = Date.parse(e.at || "");
    if (isNaN(t) || now - t > LOOKUP_TOUCH_MS) { e.at = new Date(now).toISOString(); changed = true; }
  });
  if (changed) {
    try { localStorage.setItem(LOOKUP_KEY, JSON.stringify(list)); } catch (e) { /* 무시 */ }
  }
}
function saveLookupEntry(entry) {
  if (!entry || !entry.code) return;
  const list = loadLookupEntries().filter((e) => e.code !== entry.code);
  list.push(entry);
  while (list.length > LOOKUP_MAX) list.shift();
  try { localStorage.setItem(LOOKUP_KEY, JSON.stringify(list)); } catch (e) { /* 저장 못해도 앱은 정상 */ }
}

// ── 완료 화면의 조회코드 상자 ──────────────────────────────────────────
function setDoneCode(code) {
  const box = $("doneCodeBox"), out = $("doneCode"), msg = $("doneCodeMsg");
  if (!box || !out) return;
  const c = (code || "").trim();
  out.textContent = c;
  box.hidden = !c;
  if (msg) msg.textContent = "";
}

// ── 날짜·시각 표기 (YYYY-MM-DD HH:MM) ──────────────────────────────────
function msFmtDateTime(ts) {
  if (!ts) return "";
  try {
    const d = new Date(ts);
    if (isNaN(d.getTime())) return "";
    const p = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
  } catch (e) { return ""; }
}

// ── 조회 ───────────────────────────────────────────────────────────────
// 보관한 코드들을 «한 번의 호출»로 조회해 접수번호로 중복을 정리하고 최신순으로 돌려준다.
//   ① check_application_status_many(배열) — 기본 경로(왕복 1회)
//   ② 그 함수가 서버에 없으면(PGRST202) 단건 check_application_status 로 폴백
//      (양호창님이 대시보드에서 SQL 을 실행하기 «전»까지는 이 경로로 돈다)
async function msFetchRows() {
  const A = window.SangjuApply;
  if (!A || !A.checkStatus) return { rows: [], failed: false };
  const codes = [];
  loadLookupEntries().forEach((e) => {
    const c = String(e.code || "").trim();
    if (c.length >= 8 && codes.indexOf(c) < 0) codes.push(c);
  });
  if (!codes.length) return { rows: [], failed: false };

  let packs = null, failed = false;

  // ① 배열 1회 호출
  if (A.checkStatusMany && msBatch !== "no") {
    try {
      packs = [await A.checkStatusMany(codes)];
      msBatch = "yes";
    } catch (e) {
      if (A.isMissingFunction && A.isMissingFunction(e)) {
        msBatch = "no";      // 서버에 아직 없다 → 아래 단건 경로로 조용히 내려간다
        packs = null;
      } else {
        return { rows: [], failed: true };   // 네트워크·서버 오류 → 다음 주기에 다시
      }
    }
  }

  // ② 단건 폴백
  if (packs === null) {
    let bad = 0;
    packs = await Promise.all(codes.map(async (c) => {
      try { return await A.checkStatus(c); }
      catch (e) { bad++; return []; }      // 한 코드가 실패해도 나머지는 보여 준다
    }));
    failed = bad === codes.length;
  }

  const seen = {}, rows = [];
  packs.forEach((pack) => (pack || []).forEach((r) => {
    const k = String(r.receipt_no || "") + "|" + String(r.benefit_name || "");
    if (seen[k]) return;
    seen[k] = 1; rows.push(r);
  }));
  rows.sort((a, b) => String(b.created_at || "").localeCompare(String(a.created_at || "")));
  if (!failed) touchLookupEntries(codes);   // «마지막 확인일» 갱신(180일 만료의 기준)
  return { rows: rows, failed: failed };
}

// 화면에 그릴 «서명» — 이 값이 같으면 다시 그리지 않는다(초점·스크롤 보존).
function msSignature(rows) {
  return (rows || []).map((r) =>
    [r.receipt_no, r.status, r.updated_at, (r.citizen_reply || "").length].join("|")
  ).join(";");
}

function msRenderList() {
  const box = $("msList");
  if (!box) return;
  const hasCodes = loadLookupEntries().length > 0;
  if (msErr) {
    box.innerHTML = `<div class="ms-empty"><p>지금은 진행 상태를 불러오지 못했습니다.</p>
      <p>인터넷 연결을 확인하신 뒤 «지금 새로고침»을 눌러 주세요.</p></div>`;
    return;
  }
  if (!msRows.length) {
    box.innerHTML = hasCodes
      ? `<div class="ms-empty"><p>조회되는 신청 내역이 없습니다.</p>
           <p>아래 칸에 조회코드를 넣어 다시 확인해 보세요.</p></div>`
      : `<div class="ms-empty"><p>이 휴대폰에 저장된 신청 내역이 없습니다.</p>
           <p>신청을 마치면 이 화면에서 진행 상태를 보실 수 있습니다.<br>
              다른 기기에서 신청하셨다면 아래에 조회코드를 넣어 주세요.</p></div>`;
    return;
  }
  box.innerHTML = msRows.map((r) => {
    const st = (r.status || "접수").trim();
    const reply = (r.citizen_reply || "").trim();
    return `<div class="ms-card">
      <div class="ms-card-top">
        <span class="ms-badge ast-${esc(st)}">${esc(st)}</span>
        ${r.receipt_no ? `<span class="ms-rc"><span aria-hidden="true">🧾</span> ${esc(r.receipt_no)}</span>` : ""}
      </div>
      <div class="ms-card-title">${esc(r.benefit_name || "(사업명 없음)")}</div>
      <div class="ms-card-meta"><span aria-hidden="true">🗓</span> 신청 ${esc(msFmtDateTime(r.created_at))}${
        r.updated_at && r.updated_at !== r.created_at
          ? ` · 갱신 ${esc(msFmtDateTime(r.updated_at))}` : ""}</div>
      ${reply ? `<div class="ms-reply"><p class="ms-reply-k"><span aria-hidden="true">💬</span> 담당 부서 안내</p>
                   <p class="ms-reply-v">${linkifyHtml(reply)}</p></div>` : ""}
    </div>`;
  }).join("");
}

// 낭독은 «실제로 달라졌을 때만» — 20초마다 같은 말을 읽지 않게 한다.
function msAnnounce(msg) {
  const el = $("msAnnounce");
  if (el) el.textContent = msg || "";
}

// 목록 «안»에 초점이 있는가 — 안내문 속 링크에 초점을 둔 채로 innerHTML 을 갈아엎으면
// 초점이 사라진다(KWCAG 2.2 «초점 이동과 표시»). 그동안은 다시 그리기를 미룬다.
function msListHasFocus() {
  const box = $("msList");
  const a = document.activeElement;
  return !!(box && a && a !== document.body && box.contains(a));
}

// 미뤄 둔 갱신을 «초점이 목록을 벗어난 뒤» 반영한다.
function msFlushDeferred() {
  if (!msDeferred || msListHasFocus()) return;
  msDeferred = false;
  msRenderList();
}

async function msLoad(force) {
  if (msBusy) return;
  msBusy = true;
  try {
    const res = await msFetchRows();
    // 서명에 «오류였는가»까지 넣는다 → 연결이 끊긴 동안 20초마다 같은 화면을 다시 그리지 않는다.
    const sig = (res.failed ? "ERR|" : "OK|") + msSignature(res.rows);
    const changed = force || !msLoaded || sig !== msSig;
    msErr = res.failed;
    msRows = res.rows;
    msSig = sig;
    msLoaded = true;
    if (changed) {
      if (!force && msListHasFocus()) {
        // 초점을 뺏지 않는다 — 벗어나는 즉시(focusout) 또는 다음 주기에 반영한다.
        msDeferred = true;
        msAnnounce("진행 상태가 갱신되었습니다. 목록에서 초점을 옮기시면 화면에 반영됩니다.");
      } else {
        msDeferred = false;
        msRenderList();
        if (!res.failed && res.rows.length) {
          msAnnounce(`신청 ${res.rows.length}건의 진행 상태를 갱신했습니다.`);
        }
      }
    }
    const up = $("msUpdated");
    if (up) up.textContent = res.failed ? "" : "확인 " + msFmtDateTime(new Date().toISOString());
  } catch (e) {
    // 자동 갱신 때문에 앱이 멈추는 일은 없어야 한다 — 다음 주기에 다시 시도한다.
    console.debug("[내신청현황] 이번 조회 실패, 다음에 다시 시도합니다.");
  } finally {
    msBusy = false;
  }
}

// 20초 폴링 — «이 화면이 보일 때만». 다른 화면·백그라운드에서는 아무 일도 하지 않는다.
function msTick() {
  msFlushDeferred();            // 미뤄 둔 갱신이 있으면 먼저 반영
  if (!msAuto || msBusy) return;
  if (document.hidden) return;
  if (_currentView() !== "mystatus") return;
  msLoad(false);
}

function msPaintAutoBtn() {
  const b = $("msAutoBtn");
  if (!b) return;
  b.innerHTML = msAuto
    ? '<span aria-hidden="true">⏸</span> 자동 새로고침 멈추기'
    : '<span aria-hidden="true">▶</span> 자동 새로고침 켜기';
  b.setAttribute("aria-label", msAuto
    ? "자동 새로고침 멈추기 — 지금은 20초마다 진행 상태가 저절로 갱신됩니다."
    : "자동 새로고침 켜기 — 지금은 진행 상태가 저절로 갱신되지 않습니다.");
}

// 🧹 이 기기에서 지우기 — 공용 기기(주민센터·도서관 PC, 가족 태블릿)에서
//    앞사람의 조회코드가 남아 다음 사람에게 신청 내역이 보이는 일이 없어야 한다.
//    ⚠ 지우는 것은 «이 기기의 보관값»뿐 — 신청 자체는 그대로 살아 있다.
function msClearDevice() {
  const n = loadLookupEntries().length;
  if (!n) { msAnnounce("이 기기에 보관된 조회코드가 없습니다."); return; }
  const ok = confirm(
    `이 기기에 보관된 조회코드 ${n}건을 지웁니다.\n` +
    "지운 뒤에는 적어 두신 조회코드를 다시 입력해야 진행 상태를 보실 수 있습니다.\n" +
    "신청 자체가 취소되지는 않습니다.\n" +
    "지울까요?");
  if (!ok) return;
  try { localStorage.removeItem(LOOKUP_KEY); } catch (e) { /* 무시 */ }
  msRows = []; msSig = ""; msErr = false; msLoaded = true; msDeferred = false;
  msRenderList();
  msPaintEntry();               // 보관 코드가 0건이 되면 홈 진입점도 다시 판단한다
  const up = $("msUpdated");
  if (up) up.textContent = "";
  msAnnounce("이 기기에 보관된 조회코드를 모두 지웠습니다.");
}

function openMyStatus() {
  $("topTitle").textContent = "내 신청 현황";
  msRenderList();               // 있던 내용을 먼저 그려 빈 화면을 보이지 않게
  showView("mystatus");
  msPaintAutoBtn();
  // 🔑 되찾기 창구는 «들어올 때마다 접힌 채»로 시작한다.
  //   ① 보조 링크라는 성격을 유지하고(펼쳐진 채 남으면 상시 통로처럼 보인다)
  //   ② 공용 기기에서 앞사람이 넣은 이름·되찾은 코드가 화면에 남지 않게 한다.
  //   ⚠ msRecoverWrap 의 hidden 은 건드리지 않는다 — 서버에 함수가 없어 숨긴 상태를 되살리면 안 된다.
  if (msRecOpen) msRecToggle();
  else msRecReset();
  // 앱을 켤 때 프로브가 «네트워크 때문에» 실패했을 수 있다 → 들어온 김에 다시 확인한다.
  if (msAvail !== "ok") { try { msProbe(); } catch (e) { /* 무시 */ } }
  msLoad(true);                 // 들어온 «그 순간» 한 번 확인(20초를 기다리지 않는다)
  // 목록 안에서 초점이 빠져나가면 미뤄 둔 갱신을 즉시 반영한다(리스너는 한 번만 건다).
  if (!msFocusBound) {
    const box = $("msList");
    if (box) {
      box.addEventListener("focusout", () => setTimeout(msFlushDeferred, 0));
      msFocusBound = true;
    }
  }
  if (!msTimer) {
    msTimer = setInterval(msTick, MS_POLL_MS);
    // 화면이 가려져 있는 동안은 건너뛰므로, 다시 앞으로 나온 «그 순간» 한 번 따라잡는다.
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) { try { msTick(); } catch (e) { /* 무시 */ } }
    });
  }
}

// 홈의 «내 신청 현황» 진입점 노출.
//   · "ok"          → 보인다
//   · "unavailable" → 감춘다(서버에 함수가 «없다»고 확인된 경우에만)
//   · "unknown"     → 이 기기에 보관된 조회코드가 «있으면» 보인다.
//     ⚠ 마지막 줄이 중요하다. 아직 모른다고 무조건 감추면, 오프라인으로 앱을 연 이용자는
//       화면에 들어갈 수 없고 → 들어가야 다시 확인하므로 → 영영 못 들어가는 막다른 길이 된다.
function msPaintEntry() {
  const el = $("myStatusEntry");
  if (!el) return;
  if (msAvail === "ok") { el.hidden = false; return; }
  if (msAvail === "unavailable") { el.hidden = true; return; }
  el.hidden = loadLookupEntries().length === 0;
}

// 서버에 조회 함수가 있는지 «조용히» 확인한다. (위 ⭐ 3값 프로브)
//  ① 배열 함수부터 빈 배열로 불러 본다 — 가짜 코드를 서버에 던지지 않는다.
//  ② 배열 함수가 «없다»고 하면(PGRST202) 단건 함수를 무작위 코드로 불러 본다
//     (단건 함수는 배열 인자를 받지 않아 빈 프로브를 만들 수 없다. 무작위 코드라
//      개인정보가 오가지 않고, 8자 이상이라 서버는 «해당 없음»만 답한다).
//  ③ 성공 → "ok" / «함수 없음» → "unavailable" / 그 밖(네트워크) → "unknown" 으로 «남겨 둔다».
//     ⚠ ③의 마지막이 핵심이다. 네트워크 오류를 «영구 불가»로 굳히면, 신청이 실제로
//       성공해도 조회코드가 시민 눈에 보이지 않는 사고가 난다(2026-08-18 수정).
async function msProbe() {
  if (msAvail === "unavailable") return msAvail;   // 이미 «없다»고 확인된 서버
  const A = window.SangjuApply;
  if (!(A && A.checkStatus && A.genLookupCode)) return msAvail;

  // ① 배열 함수 — 빈 배열 프로브
  if (A.checkStatusMany && msBatch !== "no") {
    try {
      await A.checkStatusMany([]);
      msBatch = "yes";
      msAvail = "ok";
      msPaintEntry();
      return msAvail;
    } catch (e) {
      if (A.isMissingFunction && A.isMissingFunction(e)) {
        msBatch = "no";                            // 아직 SQL 미실행 → ②로 내려간다
      } else {
        console.debug("[내신청현황] 지금은 확인할 수 없습니다(다음에 다시 확인).");
        msPaintEntry();
        return msAvail;                            // "unknown" 유지 — 굳히지 않는다
      }
    }
  }

  // ② 단건 함수
  try {
    await A.checkStatus(A.genLookupCode(10));
    msAvail = "ok";
  } catch (e) {
    if (A.isMissingFunction && A.isMissingFunction(e)) {
      msAvail = "unavailable";
      console.debug("[내신청현황] 서버에 조회 함수가 없어 진입점을 감춥니다.");
    } else {
      console.debug("[내신청현황] 지금은 확인할 수 없습니다(다음에 다시 확인).");
    }
  }
  msPaintEntry();
  return msAvail;
}

async function initMyStatus() {
  await msProbe();
}

// 조회코드 직접 입력 — 기기를 바꾼 분을 위한 통로.
async function msLookupByCode() {
  const codeEl = $("msCode"), rcEl = $("msReceipt");
  if (!codeEl) return;
  // 코드는 대문자·숫자만 쓴다 → 공백·하이픈을 지우고 대문자로 맞춘다(적어 둔 것을 그대로 넣어도 되게).
  const code = (codeEl.value || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  const rc = (rcEl ? rcEl.value : "").trim();
  setFieldError("msCode", "msCodeErr", "");
  if (code.length < 8) {
    setFieldError("msCode", "msCodeErr", "조회코드를 다시 확인해 주세요. (영문 대문자·숫자 10자리)");
    codeEl.focus();
    return;
  }
  const btn = $("msLookup");
  const orig = btn ? btn.textContent : "";
  if (btn) { btn.disabled = true; btn.textContent = "조회 중..."; }
  let rows = null;
  try {
    rows = await SangjuApply.checkStatus(code);
  } catch (e) {
    setFieldError("msCode", "msCodeErr",
      "지금은 조회할 수 없습니다. 인터넷 연결을 확인하고 다시 시도해 주세요.");
    codeEl.focus();
    return;
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = orig; }
  }
  // ⚠ 접수번호는 «2차 비밀번호»가 아니다 — 서버는 조회코드만 본다.
  //   여기서 하는 일은 이미 받아 온 결과에서 «보고 싶은 건만 골라 주는» 것뿐이므로,
  //   오류 문구도 두 값을 대조한 것처럼 읽히지 않게 쓴다(2026-08-18 🩷 지적).
  let matched = rows || [];
  if (rc) matched = matched.filter((r) => String(r.receipt_no || "").trim() === rc);
  if (!matched.length) {
    setFieldError("msCode", "msCodeErr", rc
      ? "이 조회코드로 찾은 신청 중에 그 접수번호와 같은 건이 없습니다. 접수번호를 지우고 조회하시면 이 코드의 신청을 모두 보실 수 있습니다."
      : "조회되는 신청이 없습니다. 조회코드를 다시 확인해 주세요.");
    codeEl.focus();
    return;
  }
  // 찾았으면 이 기기에도 보관한다 → 다음부터는 코드를 넣지 않아도 보인다.
  saveLookupEntry({
    code: code,
    receipt_no: matched[0].receipt_no || "",
    benefit_name: matched[0].benefit_name || "",
    at: new Date().toISOString(),
  });
  codeEl.value = "";
  if (rcEl) rcEl.value = "";
  msPaintEntry();               // 이제 이 기기에도 코드가 있으므로 홈 진입점을 다시 판단
  await msLoad(true);
  msAnnounce(`신청 ${matched.length}건을 찾았습니다. 목록에 추가했습니다.`);
  focusMain();
}

// ════════════════════════════════════════════════════════════════════════
//  🔑 조회코드 «되찾기» — 코드를 적어 두지 않고 기기를 바꾼 분을 위한 보조 창구
//     (2026-08-18 설계: 🩷 security-privacy / supabase/조회코드_되찾기.sql)
//  ----------------------------------------------------------------------
//  무엇인가
//    이름 + 연락처 뒷 4자리가 모두 맞으면 «조회코드만» 돌려받는다. 그 코드를 기기에
//    보관하고 곧바로 기존 「내 신청 현황」 경로(checkStatusMany)를 탄다.
//    → 여기에 «새 목록 화면»을 만들지 않는다. 되찾은 다음은 기존 화면 그대로다.
//
//  왜 «상태»가 아니라 «코드»만인가
//    이름+뒷4자리는 조회코드(50비트)보다 훨씬 약한 열쇠다. 이것으로 상태를 «바로»
//    보여 주면 기기를 바꾼 시민은 볼 때마다 이 문을 쓰게 되고, 그러면 정상 이용과
//    무차별 대입의 트래픽 모양이 같아져 시도 제한을 걸 수 없게 된다.
//    코드만 돌려주면 이 문은 «기기를 바꾼 그 한 번»만 쓰인다.
//
//  ⛔ 여기서 하지 말 것
//    · 이 진입점을 홈이나 화면 위쪽으로 올리지 말 것(보조 링크로 둔다).
//    · 0건일 때 «그런 이름이 없다 / 동명이인이 있다»처럼 이유를 알려 주지 말 것.
//      찍어 보는 사람에게 «정답에 가까워졌다»는 신호가 된다. 서버도 둘을 구분해 주지 않는다.
//    · 함수가 있는지 «프로브»하지 말 것 — 서버는 형식 검사 «전에» 시도 횟수를 센다
//      (10분 10회). 프로브 한 번이 시민의 실제 시도 한 번을 잡아먹는다.
//      → 함수 유무는 시민이 실제로 눌렀을 때의 응답(PGRST202)으로 배운다.
// ════════════════════════════════════════════════════════════════════════
let msRecOpen = false;      // 패널이 펼쳐져 있는가
let msRecBusy = false;      // 되찾기 요청 진행 중(중복 제출 방지)

// 오류 문구는 두 칸이 함께 쓰지만(msRecErr 하나), aria-invalid 는 «틀린 칸»에만 건다.
function msRecSetErr(msg, whichId) {
  const err = $("msRecErr");
  if (err) { err.textContent = msg || ""; err.hidden = !msg; }
  ["msRecName", "msRecPhone4"].forEach((id) => {
    const el = $(id);
    if (!el) return;
    if (msg && id === whichId) el.setAttribute("aria-invalid", "true");
    else el.removeAttribute("aria-invalid");
  });
}

// 진입점 «조용히 숨김» — 서버에 recover_lookup_codes 가 «없다»고 확인된 경우에만.
//   ⚠ 네트워크 오류로 숨기지 않는다(내 신청 현황의 3값 프로브와 같은 원칙).
//   숨긴 뒤에도 앱의 다른 기능은 멀쩡해야 한다.
function msRecHideEntry() {
  const wrap = $("msRecoverWrap");
  if (wrap) wrap.hidden = true;
  msRecOpen = false;
  // 초점이 사라지는 버튼 위에 남지 않게 조회코드 입력칸으로 옮긴다(초점 유실 방지 KWCAG).
  const codeEl = $("msCode");
  if (codeEl) { try { codeEl.focus(); } catch (e) { /* 무시 */ } }
  // 낭독 이용자에게는 «사라졌다»는 사실만 담백하게 알린다(서버 사정을 설명하지 않는다).
  msAnnounce("지금은 조회코드 되찾기를 이용할 수 없습니다. 적어 두신 조회코드로 조회해 주세요.");
}

function msRecToggle() {
  const panel = $("msRecoverPanel"), btn = $("msRecoverToggle");
  if (!panel || !btn) return;
  msRecOpen = !msRecOpen;
  panel.hidden = !msRecOpen;
  btn.setAttribute("aria-expanded", msRecOpen ? "true" : "false");
  if (msRecOpen) {
    const nm = $("msRecName");
    if (nm) { try { nm.focus(); } catch (e) { /* 무시 */ } }
  } else {
    // 닫을 때는 입력·결과를 지운다 — 공용 기기에 이름이 남지 않게.
    msRecReset();
  }
}

function msRecReset() {
  ["msRecName", "msRecPhone4"].forEach((id) => { const el = $(id); if (el) el.value = ""; });
  msRecSetErr("");
  const box = $("msRecResult");
  if (box) box.hidden = true;
  const codes = $("msRecCodes");
  if (codes) codes.textContent = "";
  const msg = $("msRecCopyMsg");
  if (msg) msg.textContent = "";
}

// 되찾은 코드 복사 — 완료 화면과 같은 방식(alert 대신 상자 안 안내문).
async function msRecCopyCodes() {
  const text = ($("msRecCodes") ? $("msRecCodes").textContent : "").trim();
  const msg = $("msRecCopyMsg");
  if (!text) return;
  let ok = false;
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(text);
      ok = true;
    } else { throw new Error("no clipboard api"); }
  } catch (e) {
    try {
      const t = document.createElement("input");
      t.value = text; document.body.appendChild(t);
      t.select(); document.execCommand("copy");
      document.body.removeChild(t);
      ok = true;
    } catch (e2) { ok = false; }
  }
  if (msg) {
    msg.textContent = ok
      ? "조회코드를 복사했습니다. 메모장이나 문자에 붙여넣어 보관해 주세요."
      : "복사하지 못했습니다. 화면의 코드를 직접 적어 주세요.";
  }
}

async function msRecoverSubmit() {
  if (msRecBusy) return;
  const nameEl = $("msRecName"), p4El = $("msRecPhone4");
  if (!nameEl || !p4El) return;
  const A = window.SangjuApply;
  if (!(A && A.recoverLookupCodes)) { msRecHideEntry(); return; }

  const name = (nameEl.value || "").trim();
  const p4 = (p4El.value || "").replace(/[^0-9]/g, "");
  msRecSetErr("");
  const resBox = $("msRecResult");
  if (resBox) resBox.hidden = true;

  // ── 입력 검증 — «첫 번째» 틀린 칸으로 초점을 옮긴다(KWCAG 오류 정정 안내)
  if (name.length < 2) {
    msRecSetErr("이름을 두 글자 이상 넣어 주세요.", "msRecName");
    nameEl.focus(); return;
  }
  if (name.length > 40) {
    msRecSetErr("이름이 너무 깁니다. 신청서에 적으신 이름만 넣어 주세요.", "msRecName");
    nameEl.focus(); return;
  }
  if (p4.length !== 4) {
    msRecSetErr("연락처 뒷 4자리를 숫자 네 자리로 넣어 주세요.", "msRecPhone4");
    p4El.focus(); return;
  }

  const btn = $("msRecoverBtn");
  const orig = btn ? btn.innerHTML : "";
  msRecBusy = true;
  if (btn) { btn.disabled = true; btn.textContent = "찾는 중..."; }

  let codes = null;
  try {
    codes = await A.recoverLookupCodes(name, p4);
  } catch (e) {
    // ① 시도 횟수 제한 — «틀렸다»가 아니라 «잠시 뒤에»라고 안내한다.
    if (A.isRateLimited && A.isRateLimited(e)) {
      msRecSetErr("조회 시도가 너무 많습니다. 10분 뒤에 다시 시도해 주세요.");
      nameEl.focus();
    // ② 서버에 함수가 «없다» — 진입점을 조용히 숨긴다(앱의 다른 기능은 멀쩡하다).
    } else if (A.isMissingFunction && A.isMissingFunction(e)) {
      msRecHideEntry();
    // ③ 그 밖(네트워크·일시 오류) — «영구 실패»로 굳히지 않는다.
    } else {
      msRecSetErr("잠시 후 다시 시도해 주세요.");
      nameEl.focus();
    }
    return;
  } finally {
    msRecBusy = false;
    if (btn) { btn.disabled = false; btn.innerHTML = orig; }
  }

  // ── 0건 — ⛔ 이유를 알려 주지 않는다(못 찾음·동명이인을 구분해 주면 힌트가 된다)
  if (!codes || !codes.length) {
    msRecSetErr("일치하는 신청을 찾지 못했습니다. 이름과 연락처 뒷 4자리를 확인해 주세요. "
      + "계속 찾을 수 없으면 담당 부서로 문의해 주세요.");
    nameEl.focus();
    return;
  }

  // ── 찾았다 → ① 기기에 보관 ② 기존 「내 신청 현황」 경로로 그대로 넘긴다
  //   ⚠ 사업명·접수번호는 이 함수가 «주지 않는다»(일부러). 빈 값으로 넣어 두면
  //     바로 이어지는 msLoad 가 상태 조회 결과로 화면을 채운다.
  const at = new Date().toISOString();
  codes.forEach((c) => saveLookupEntry({ code: c, receipt_no: "", benefit_name: "", at: at }));

  // 되찾은 코드를 보여 준다 — 다음에 또 기기를 바꾸면 이 문을 다시 쓰게 되므로 «적어 두세요».
  const out = $("msRecCodes");
  if (out) out.textContent = codes.join("\n");
  if (resBox) resBox.hidden = false;
  const copyMsg = $("msRecCopyMsg");
  if (copyMsg) copyMsg.textContent = "";
  // 이름은 화면에 남기지 않는다(공용 기기 배려). 되찾은 코드는 위 상자에 남는다.
  nameEl.value = ""; p4El.value = "";

  // 되찾은 코드 상자로 초점을 옮긴다 — 버튼 «아래»에 결과가 생기므로, 초점을 옮기지 않으면
  // 키보드·낭독기 이용자는 무엇이 생겼는지 스스로 찾아 내려가야 한다(KWCAG 초점 이동·상태 알림).
  if (resBox) { try { resBox.focus(); } catch (e) { /* 무시 */ } }

  msPaintEntry();          // 이제 이 기기에도 코드가 있으므로 홈 진입점을 다시 판단
  await msLoad(true);      // ③ 그 다음은 «기존 화면 그대로»
  msAnnounce(`조회코드 ${codes.length}건을 찾았습니다. 목록에 추가했습니다. 코드는 아래 상자에 있으니 적어 두세요.`);
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
      else if (go === "mystatus") { openMyStatus(); }
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
  // ── 🧾 내 신청 현황 ────────────────────────────────────────────────
  const doneStatusBtn = $("doneStatus");
  if (doneStatusBtn) doneStatusBtn.addEventListener("click", openMyStatus);
  const doneCodeCopy = $("doneCodeCopy");
  if (doneCodeCopy) doneCodeCopy.addEventListener("click", copyLookupCode);
  const msRefreshBtn = $("msRefresh");
  if (msRefreshBtn) msRefreshBtn.addEventListener("click", () => msLoad(true));
  const msClearBtn = $("msClear");
  if (msClearBtn) msClearBtn.addEventListener("click", msClearDevice);
  const msAutoBtn = $("msAutoBtn");
  if (msAutoBtn) msAutoBtn.addEventListener("click", () => {
    msAuto = !msAuto;
    msPaintAutoBtn();
    msAnnounce(msAuto ? "자동 새로고침을 켰습니다. 20초마다 진행 상태가 갱신됩니다."
                      : "자동 새로고침을 멈췄습니다. 새로고침을 누를 때만 갱신됩니다.");
    if (msAuto) msTick();
  });
  const msForm = $("msForm");
  if (msForm) msForm.addEventListener("submit", (e) => { e.preventDefault(); msLookupByCode(); });
  const msCodeEl = $("msCode");
  if (msCodeEl) msCodeEl.addEventListener("input", () => setFieldError("msCode", "msCodeErr", ""));
  // 🔑 조회코드 되찾기(보조 창구) — 접기·펴기 / 제출 / 복사 / 입력 시 오류문구 지우기
  const msRecToggleBtn = $("msRecoverToggle");
  if (msRecToggleBtn) msRecToggleBtn.addEventListener("click", msRecToggle);
  const msRecForm = $("msRecoverForm");
  if (msRecForm) msRecForm.addEventListener("submit", (e) => { e.preventDefault(); msRecoverSubmit(); });
  const msRecCopyBtn = $("msRecCopy");
  if (msRecCopyBtn) msRecCopyBtn.addEventListener("click", msRecCopyCodes);
  ["msRecName", "msRecPhone4"].forEach((id) => {
    const el = $(id);
    if (el) el.addEventListener("input", () => { if (el.getAttribute("aria-invalid")) msRecSetErr(""); });
  });
  // 뒷 4자리는 숫자만 — 붙여넣기·한글 자판으로 들어온 글자를 그 자리에서 걸러 준다.
  const msRecP4 = $("msRecPhone4");
  if (msRecP4) msRecP4.addEventListener("input", () => {
    const v = (msRecP4.value || "").replace(/[^0-9]/g, "").slice(0, 4);
    if (v !== msRecP4.value) msRecP4.value = v;
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
