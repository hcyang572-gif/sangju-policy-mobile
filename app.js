// 상주시 정책플랫폼 — 모바일 웹앱 (서버 없는 정적 MVP)
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

/* ════════════════════════════════════════════════════════════════════════
   🎨 분야 → 색군 매핑  «단 하나뿐인 출처»       (규격서 19-2 · 2026-08-24 C안)
   ------------------------------------------------------------------------
   ⛔⛔ 분야의 색을 정하는 곳은 이 파일의 이 표 «하나»뿐이다.
        CSS·HTML·다른 함수 어디에도 분야 이름을 다시 적지 말 것.
        (🟢곳간이 C-13 에서 분야를 늘리거나 줄일 수 있다. 그때 고칠 곳도 여기 하나다.)

   여기 있는 것 / 없는 것
     · 여기 있는 것 : «어떤 분야가 어느 색군에 드는가» (아래 FIELD_GROUP)
     · 여기 없는 것 : «그 색군이 무슨 색인가» → style.css 파일 끝 §Ⓕ 의 --fg-* 토큰 한 블록.
       둘을 나눈 이유 — 분야는 자주 바뀌고(데이터), 색값은 거의 안 바뀐다(규격서 19-2).
       한쪽을 고칠 때 다른 쪽을 건드리지 않아도 되게 떼어 두었다.

   ⚠ 키는 «이모지를 뗀 분야명»이다. data.json 의 분야는 「🌾 농림축수산업」처럼
     이모지가 앞에 붙어 오는데, 이모지는 꾸밈이라 언제든 바뀔 수 있다.
     fgKeyOf() 가 앞머리의 이모지·기호·공백을 떼고 한글부터 읽는다.

   ⚠ 안전장치(규격서 19-2) — 표에 «없는» 분야는 임의의 색을 주지 않고 무채색으로 떨어뜨린다.
     색이 «틀리게» 나가면 아무도 못 알아채지만, 무채색이면 «아직 색이 없다»가 바로 보인다.
   ════════════════════════════════════════════════════════════════════════ */
const FIELD_GROUP = {
  // 주거·생활  life
  "주거·부동산": "life", "교통·안전": "life", "1인가구": "life",
  "전입·정착": "life",                              // ★ C-13 신설(2026-08-24)
  // 건강·복지  care
  "건강·의료": "care", "노인·어르신": "care", "장애인": "care", "저소득·기초수급": "care",
  // 농림·환경  farm
  "농림축수산업": "farm", "귀농·귀촌": "farm", "환경·에너지": "farm",
  // 가족·돌봄  family
  "임신·출산": "family", "영유아·보육": "family", "다자녀·가족": "family",
  "한부모·조손": "family", "여성": "family",
  "결혼·신혼부부": "family",                        // ★ C-13 신설(2026-08-24)
  // 일·경제  work
  "일자리·구직": "work", "소상공인·기업": "work", "모집·공모": "work",
  // 배움·문화  learn
  "청소년·교육": "learn", "청년": "learn", "문화·체육·관광": "learn",
  "다문화·외국인": "learn", "보훈·유공자": "learn"
  /* ⌦ 2026-08-24 C-13 — 「행사·축제·공연」 줄을 «지웠다».
     그 분야 자체가 없어지고 「문화·체육·관광」이 흡수했다(🟢곳간 반영, data.json 실측 확인).
     ⛔ 되살리지 말 것. 쓰이지 않는 분야가 표에 남아 있으면, 다음 사람이
        「화면에 안 나오는데?」를 쫓다가 data.json 까지 헛되이 뒤지게 된다. */
};

// 분야명에서 앞머리 이모지·기호·공백을 떼어 «표의 키»로 만든다.
// (「👨‍👩‍👧‍👦 다자녀·가족」처럼 결합 이모지(ZWJ·변형선택자)가 섞여 와도 첫 한글까지 건너뛴다)
function fgKeyOf(cat) {
  const s = String(cat == null ? "" : cat).trim();
  const m = s.match(/[가-힣A-Za-z0-9].*$/);   // 첫 «글자»부터 끝까지
  return (m ? m[0] : s).trim();
}

// 분야 하나 → 색군 id. 표에 없으면 null(= 무채색).
function fieldGroupOf(cat) {
  return FIELD_GROUP[fgKeyOf(cat)] || null;
}

/* 분야명을 «앞머리 이모지»와 «이름» 두 조각으로 가른다.
   ★ 2026-08-24 C-06 — 분야 칩을 «세로 2단»(윗줄 이모지 · 아랫줄 이름)으로 세우기 위해서다.
     한 줄로 두면 「💰 저소득·기초수급」이 430px 폰에서도 2px 넘쳐 4열이 되지 않는다
     (🟠단장 기기 실측). 2단으로 세우면 칩 폭이 절반 이하로 줄어 4열이 들어간다.
   ⚠ 이름은 fgKeyOf 와 «같은 규칙»으로 뽑는다 — 자를 자리를 정하는 곳이 둘이면 어긋난다.
   ⚠ 이름은 언제나 원본의 «뒤쪽»이므로 길이로 잘라 낸다(indexOf 를 쓰면 이름이 앞머리에
     우연히 또 나올 때 엉뚱한 데서 잘린다).
   ⛔ 이름을 줄이거나 「…」으로 자르지 말 것 — 분야 이름은 시민이 고르는 기준이다. */
function splitFieldLabel(cat) {
  const s = String(cat == null ? "" : cat).trim();
  const name = fgKeyOf(s);
  const icon = (name && s.length > name.length) ? s.slice(0, s.length - name.length).trim() : "";
  return { icon, name: name || s };
}

/* 사업 한 건의 «대표 분야» — 카드 머리띠·상세 타일에 쓴다.
   여러 분야에 걸친 사업이 많다(한 사업이 4개까지도 걸린다).

   ★ 2026-08-24 C-13 뒤 고침 — «시민이 방금 고른 분야»를 먼저 쓴다.
     왜: 예전에는 «색이 있는 첫 분야»만 봤다. 그런데 categories 의 차례는
        config.POLICY_CATEGORIES 의 차례라, 「💍 결혼·신혼부부」·「🚚 전입·정착」처럼
        늘 «다른 분야 뒤»에 오는 분야는 머리띠에 한 번도 나오지 못했다.
        실측 — 결혼 8건 중 0건, 전입 9건 중 0건이 자기 이름을 못 달았다.
        그래서 「💍 결혼·신혼부부」로 걸러 놓고도 카드에는 「🎓 청년」이 적혀,
        시민이 «내가 누른 것과 다른 화면»을 보게 된다.
     → 걸러 보고 있는 분야가 «한 개»면 그 분야를 머리띠에 적는다. 시민이 방금 누른 말이
        그대로 카드에 적히는 것이 가장 설명이 필요 없다.
     ⚠ 전체 보기·검색처럼 «고른 분야가 없거나 여럿»일 때는 예전 규칙(첫 분야) 그대로다.
     ⛔ preferred 가 그 사업의 분야가 «아니면» 쓰지 않는다 — 엉뚱한 이름이 적히면 안 된다.

   ⚠ 분야 이름을 이 코드에 적지 않는다 — 차례는 data.json(=config.POLICY_CATEGORIES) 이 정한다.
   돌려주는 값: { label: 화면에 적을 분야명(이모지 포함), group: 색군 id 또는 null } */
function primaryField(p, preferred) {
  const cats = (p && Array.isArray(p.categories)) ? p.categories : [];
  const want = String(preferred == null ? "" : preferred);
  if (want && cats.indexOf(want) >= 0) {
    return { label: want, group: fieldGroupOf(want) };
  }
  for (let i = 0; i < cats.length; i++) {
    const g = fieldGroupOf(cats[i]);
    if (g) return { label: String(cats[i]), group: g };
  }
  if (cats.length) return { label: String(cats[0]), group: null };  // 분야는 있는데 표에 없음 → 무채색
  return { label: "분야 미지정", group: null };
}

/* 지금 «한 분야만» 걸러 보고 있으면 그 이름, 아니면 빈 문자열.
   ⚠ 정본은 여기 하나다 — 목록·상세가 같은 값을 봐야 카드와 상세의 머리띠가 어긋나지 않는다. */
function pickedCategory() {
  return (state.selectedCats && state.selectedCats.size === 1)
    ? [...state.selectedCats][0] : "";
}

// ⚠ 새 화면을 추가하면 «반드시» 이 배열에 이름을 넣는다 — showView 가 여기 적힌 것만
//    보이고/숨기므로, 빠뜨리면 그 화면이 다른 화면 위에 겹쳐 남는다.
//    mscode = 「확인 번호로 내 신청 찾기」(2026-08-19 내 신청 화면에서 분리)
const VIEWS = ["home", "list", "recommend", "detail", "apply", "inquiry", "done",
  "mystatus", "mscode", "propose", "pdetail", "pwrite", "privacy"];

// 첫 렌더가 끝났는지 — showView 의 초점 이동을 «두 번째 화면부터» 적용하기 위한 표시
let _viewReady = false;

// 오류 문의가 전달될 주소(표시용). 실제 발송은 폼메일→Gmail→자동접수가 이 주소로 전달.
const SUPPORT_EMAIL = "hcyang572@korea.kr";

const HOME_TITLE = "상주시 정책플랫폼";

// 화면 전환 슬라이드의 «방향». 규격서 14절 — 앞으로 = 왼쪽으로 밀림, 뒤로 = 오른쪽으로.
//   히스토리(navStack/popstate)와 어긋나면 «어디로 가는지»를 잘못 알려 주게 되므로,
//   방향을 정하는 곳은 여기 한 곳뿐이다: 뒤로 갈 때만 _navBackOne() 이 "back" 으로 바꾼다.
//   showView() 가 한 번 쓰고 곧바로 "fwd" 로 되돌리므로 다음 이동에 새지 않는다.
//   ※ 움직임 자체는 CSS(.view / #app.nav-back .view)가 그리고,
//     prefers-reduced-motion:reduce 에서는 CSS 가 통째로 끈다.
let _navDir = "fwd";

// 내비 스택 항목은 {v: 화면이름, t: 제목}. 뒤로/이후 시 제목까지 복원한다.
function showView(name, push = true) {
  // ⚠ «보던 자리»는 화면을 갈아끼우기 «전»에 읽어야 한다.
  //    먼저 갈아끼우면 새 화면이 짧을 때 문서 높이가 줄면서 브라우저가 스크롤을
  //    0 으로 깎아 버려, 0 이 기록되고 뒤로 왔을 때 맨 위로 튄다(실제로 겪음).
  const _leftY = window.scrollY || window.pageYOffset || 0;
  // 슬라이드 방향을 «화면을 갈아끼우기 전»에 정한다(그래야 새 화면의 첫 프레임부터 맞다).
  const _appEl = $("app");
  if (_appEl) _appEl.classList.toggle("nav-back", _navDir === "back");
  _navDir = "fwd";
  VIEWS.forEach((v) => { $("view-" + v).hidden = v !== name; });
  $("topSub").hidden = name !== "home";   // 부제는 홈에서만 제목 옆에 표시
  /* ★ C-01 (2026-08-24 양호창님 지시) — 푸터(톱니바퀴 · 개인정보 처리방침 · 버전 정보 ·
     앱 아이콘 설치)는 «홈 첫 화면에서만» 보인다.
     왜: 목록·상세·신청처럼 «일하는 화면»에서는 화면 맨 아래가 신청 버튼이어야 한다.
        그 아래에 톱니바퀴·버전 같은 «관리자용 꼬리»가 늘 붙어 있으면, 스크롤을 끝까지
        내렸을 때 마지막에 보이는 것이 할 일이 아니라 군더더기가 된다.
     ⚠ 지우는 것이 아니라 «감추는 것»이다 — 홈으로 돌아오면 그대로 있다.
     ⚠ 푸터가 사라져도 본문이 하단 탭바에 가리지 않도록, style.css §Ⓐ 에서
        main 에 탭바 높이만큼의 아래 여백을 «항상» 준다. */
  const footEl = document.querySelector(".foot");
  if (footEl) footEl.hidden = name !== "home";
  if (push) {
    const top = state.navStack[state.navStack.length - 1];
    if (!top || top.v !== name) {
      // 떠나는 화면의 «보던 자리»를 기록해 둔다 → 뒤로 돌아왔을 때 그대로 복원.
      // (기록하지 않으면 목록→상세→뒤로 에서 목록 맨 위로 튄다)
      if (top) top.y = _leftY;
      state.navStack.push({ v: name, t: $("topTitle").textContent, y: 0 });
      state.fwdStack = [];   // 새 이동 → 앞으로(이후) 기록 초기화
      _armBackTrap();        // 브라우저·OS 뒤로가기를 앱이 받도록 덫을 다시 얹는다
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

// 화면 안의 «뒤로»(상단 ‹ · 하단 «‹ 뒤로» · 오른쪽 스와이프)도 브라우저 뒤로가기를 부른다.
// 이렇게 해야 «버튼으로 뒤로»와 «물리 뒤로가기»가 같은 길을 타서 기록이 어긋나지 않는다.
// (호출 계약은 그대로 — 기존 addEventListener("click", goBack) 들을 고치지 않아도 된다)
function goBack() {
  if (state.navStack.length <= 1) return;
  try { history.back(); } catch (e) { _navBackOne(); }
}

// 실제로 «앱 안에서 한 단계 뒤로» 가는 일꾼. popstate 에서만 부른다.
function _navBackOne() {
  if (state.navStack.length <= 1) return;
  const leaving = state.navStack[state.navStack.length - 1];
  if (leaving) leaving.y = window.scrollY || window.pageYOffset || 0;
  state.fwdStack.push(state.navStack.pop());     // 현재 화면을 '이후'로 보관
  const top = state.navStack[state.navStack.length - 1];
  $("topTitle").textContent = top.t;             // 이전 화면 제목 복원
  _navDir = "back";                              // 전환 슬라이드도 «뒤로»(오른쪽으로)
  showView(top.v, false);
  _restoreScroll(top.y || 0);
}

// 보던 자리 복원 — showView 가 맨 위로 올리고 초점까지 옮긴 «뒤»에 되돌려야 한다.
function _restoreScroll(y) {
  const put = () => { try { window.scrollTo(0, y); } catch (e) {} };
  put();                                   // 곧바로 한 번
  if (window.requestAnimationFrame) {      // 화면이 다시 그려진 뒤 한 번 더
    requestAnimationFrame(() => { put(); requestAnimationFrame(put); });
  }
}

function goForward() {
  if (state.fwdStack.length === 0) return;
  const cur = state.navStack[state.navStack.length - 1];
  if (cur) cur.y = window.scrollY || window.pageYOffset || 0;
  const next = state.fwdStack.pop();
  state.navStack.push(next);
  $("topTitle").textContent = next.t;            // 이후 화면 제목 복원
  showView(next.v, false);
  _restoreScroll(next.y || 0);
  _armBackTrap();                                // 앞으로 갔으니 덫도 다시 얹는다
}

/* ════════════════════════════════════════════════════════════════════
   브라우저·OS 뒤로가기 연동 + 작성 중 이탈 보호
   ────────────────────────────────────────────────────────────────────
   ⚠ 예전에는 pushState/popstate 가 «한 곳도» 없어서, 안드로이드 물리 뒤로가기를
      누르면 경고 없이 앱이 통째로 꺼졌다(홈 화면에 설치해 쓸수록 더 자주 겪음).
   방식: «되돌리기 덫» — 앱 안에 있는 동안 히스토리에 우리 항목 한 칸을 늘 얹어 둔다.
      뒤로가기 → 그 칸이 소모되며 popstate → 우리가 한 단계 처리하고 덫을 다시 얹는다.
      홈에서 더 갈 곳이 없을 때만 덫을 얹지 않아 앱이 닫힌다.
   ⚠ 「덫을 얹는다」를 빼먹으면 그 다음 뒤로가기에 앱이 꺼진다. 새 이동 경로를
      만들면 반드시 _armBackTrap() 이 불리는지 확인할 것.
   ════════════════════════════════════════════════════════════════════ */
const _TRAP = "sjBackTrap";
let _modalStack = [];      // 열려 있는 모달 [{id, close}] — 뒤로가기는 «모달만» 닫는다
let _exitArmed = false;    // 홈에서 «한 번 더 누르면 닫힘» 대기 상태

// 작성 중인지 볼 화면과 입력칸(체크상자는 제외 — 글을 쓴 것이 아니다)
const DIRTY_FIELDS = {
  apply: ["applyName", "applyPhone", "applyMemo"],
  inquiry: ["inquiryMemo", "inquiryContact"],
  /* ★ C-07 (2026-08-24) — 정책제안이 «세 칸»이 되면서 새 textarea 3개를 더했다.
     빠뜨리면 세 칸에만 글을 쓰다 뒤로 갔을 때 «경고 없이» 글이 사라진다.
     ⚠ pwBody 는 «옛 글 수정»에서만 보이는 칸이지만 목록에 그대로 둔다 —
        그 화면에서도 쓰던 글은 지켜져야 한다. 아래 _isDirtyView 가
        «지금 보이는 칸»만 세므로, 숨어 있는 칸의 옛 값이 헛경고를 내지 않는다. */
  pwrite: ["pwTitle", "pwBody", "pwProblem", "pwIdea", "pwEffect", "pwNick", "pwRegion", "pwPin"],
};
const DIRTY_MSG = "작성 중인 내용이 사라집니다. 나가시겠습니까?";

// ⚠ 예전에는 여기에도 _currentView() 가 «한 벌 더» 있었다(화면 목록을 훑어 hidden 이
//    아닌 것을 고르는 방식). 아래쪽(내비 스택 기준)에 같은 이름의 함수가 또 선언돼 있어
//    «나중 선언»이 이겨서, 이 자리의 것은 한 번도 불리지 않는 죽은 코드였다.
//    고쳐도 아무 일이 안 일어나는 함정이라 지웠다 — 정본은 아래 한 곳뿐이다.
//    ⛔ 이 이름의 함수를 다시 만들지 말 것(같은 함정이 되살아난다).

// 지금 화면이 «작성 중»인가 — 한 글자라도 있으면 참. 아무것도 안 썼으면 묻지 않는다.
function _isDirtyView() {
  const ids = DIRTY_FIELDS[_currentView()];
  if (!ids) return false;
  for (let i = 0; i < ids.length; i++) {
    const el = $(ids[i]);
    if (!el) continue;
    /* ⚠ 화면에서 «숨어 있는» 칸은 세지 않는다 (★ 2026-08-24 C-07).
       정책제안 작성 화면은 «세 칸(새 글)»과 «한 칸(옛 글 수정)» 두 모습으로 바뀐다.
       숨은 쪽의 값을 지우지 않고 남겨 두므로(되돌아왔을 때 쓰던 글이 살아 있게),
       숨은 값까지 세면 «비어 있는 화면»인데도 「작성 중인 내용이 사라집니다」가 뜬다.
       offsetParent 는 display:none 인 조상이 하나라도 있으면 null 이라 이 판정에 딱 맞다.
       ⛔ el.hidden 만 보지 말 것 — 부모(#pwLegacyWrap)가 숨은 경우를 놓친다. */
    if (el.offsetParent === null) continue;
    if (String(el.value || "").trim() !== "") return true;
  }
  return false;
}

function _armBackTrap() {
  try {
    if (history.state && history.state[_TRAP]) return;   // 이미 덫 위에 있다
    const st = {};
    st[_TRAP] = true;
    history.pushState(st, "");
  } catch (e) { /* 히스토리를 못 쓰는 환경 — 기존 동작 그대로 */ }
}

function _closeTopModal() {
  if (!_modalStack.length) return false;
  const top = _modalStack[_modalStack.length - 1];
  try { top.close(); } catch (e) { _modalStack.pop(); }
  return true;
}

/* 작성 중 경고를 «이번 한 번만» 건너뛰는 표시.
   자체 확인창(appConfirm)은 네이티브 confirm 과 달리 «기다리지 않는다» —
   popstate 는 이미 지나가 버렸으므로, 「나가기」를 고른 뒤에 다시 뒤로가기를 걸어야 한다.
   그때 또 물으면 영영 못 나가므로 이 표시로 «두 번째 물음»을 건너뛴다.
   ⚠ 반드시 한 번 쓰고 곧바로 내린다(계속 켜 두면 경고가 통째로 죽는다). */
let _skipDirtyOnce = false;
let _skipDirtyTimer = 0;

function _onPopState() {
  // ① 모달이 열려 있으면 «모달만» 닫는다(화면은 그대로, 앱도 안 꺼짐)
  if (_closeTopModal()) { _armBackTrap(); return; }
  // ② 작성 중이면 한 번 묻는다 — 취소하면 있던 자리 그대로
  //    ⛔ window.confirm 으로 되돌리지 말 것 (2026-08-20) — 「…github.io 내용:」 이
  //       군더더기로 붙고, 자바스크립트가 멈춰 화면 상태가 굳는다. appConfirm 을 쓴다.
  if (_isDirtyView() && !_skipDirtyOnce) {
    _armBackTrap();                       // 먼저 제자리를 지켜 둔다(대답을 기다리는 동안)
    // 제목이 이미 「나가시겠습니까?」이므로 본문에서는 그 물음을 뺀다(같은 말을 두 번 하지 않게)
    appConfirm(DIRTY_MSG.replace(/\s*나가시겠습니까\?$/, ""),
      { title: "나가시겠습니까?", okText: "나가기", cancelText: "계속 쓰기" })
      .then((ok) => {
        if (!ok) return;                  // 계속 쓰기 — 있던 자리 그대로
        _skipDirtyOnce = true;
        if (_skipDirtyTimer) clearTimeout(_skipDirtyTimer);
        // 안전장치: 어떤 이유로든 popstate 가 안 오면 표시를 스스로 내린다
        _skipDirtyTimer = window.setTimeout(() => { _skipDirtyOnce = false; _skipDirtyTimer = 0; }, 2000);
        try { history.back(); } catch (e) { _skipDirtyOnce = false; }
      });
    return;
  }
  _skipDirtyOnce = false;
  if (_skipDirtyTimer) { clearTimeout(_skipDirtyTimer); _skipDirtyTimer = 0; }
  // ③ 앱 안에서 한 단계 뒤로
  if (state.navStack.length > 1) { _navBackOne(); _armBackTrap(); return; }
  // ④ 홈(뿌리) — 실수로 앱이 꺼지지 않게 «한 번 더»를 알린 뒤 닫는다
  if (_exitArmed) { _exitArmed = false; try { history.back(); } catch (e) {} return; }
  _exitArmed = true;
  window.setTimeout(function () { _exitArmed = false; }, 2000);
  _toast("한 번 더 누르면 앱이 닫힙니다");
  _armBackTrap();
}

// 브라우저 새로고침·탭 닫기용(앱 «안»의 화면 이동은 위 confirm 이 맡는다)
function _onBeforeUnload(e) {
  if (!_isDirtyView()) return;
  e.preventDefault();
  e.returnValue = "";
  return "";
}

// 짧은 알림 — 인라인 style/script 없이 클래스만 쓴다(CSP 준수)
function _toast(msg) {
  let el = $("sjToast");
  if (!el) {
    el = document.createElement("div");
    el.id = "sjToast";
    el.className = "sj-toast";
    el.setAttribute("role", "status");
    el.setAttribute("aria-live", "polite");
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.classList.add("on");
  window.clearTimeout(_toast._t);
  _toast._t = window.setTimeout(function () { el.classList.remove("on"); }, 2000);
}

function initHistory() {
  // ⚠ 브라우저의 «자동 스크롤 복원»을 끈다.
  //    켜져 있으면 뒤로가기 뒤에 브라우저가 «그 히스토리 칸에 기록해 둔 위치»(0)로
  //    우리 복원값을 덮어써, 목록으로 돌아왔을 때 맨 위로 튄다. 우리가 직접 되돌린다.
  try { if ("scrollRestoration" in history) history.scrollRestoration = "manual"; } catch (e) {}
  try {
    const root = { sjRoot: true };
    history.replaceState(root, "");     // 이 페이지의 첫 칸을 «우리 것»으로 표시
  } catch (e) { /* 무시 */ }
  _armBackTrap();
  window.addEventListener("popstate", _onPopState);
  window.addEventListener("beforeunload", _onBeforeUnload);
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
/* ⭐ proposals.js 도 «이 하나»를 쓴다 (2026-08-20) — 예전에는 정책참여가 자기 클라이언트를
   따로 만들어, 시민 1명이 Supabase 연결을 «2개» 열었다. 무료 요금제 실시간 한도(200)에서
   동시 접속 시민이 100명에 막혔다. 하나로 모으면 그대로 200명이 된다.
   ⚠ 채널은 이름이 다르므로(benefits-rt-citizen / proposals-citizen) 한 소켓 위에서
     서로 간섭 없이 돌아간다. removeChannel 도 «자기 채널만» 떼므로 안전하다.
   ⛔ removeAllChannels()·client.realtime.disconnect() 를 «절대» 쓰지 말 것 —
     이제는 남의 구독까지 함께 끊긴다. */
window.cloudClient = cloudClient;

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

// ── 📎 「비고」 속 «내부 메모» 걸러내기 — config.strip_internal_notes 의 «사본» ──
// 엑셀 비고 열은 시민(📌 접수 안내)과 담당자(내부 메모)를 함께 받는다.
// «※[내부]» 로 시작하는 줄은 담당자끼리 남긴 말이라 시민앱에는 내보내지 않는다.
// data.json 경로는 build_data.py 가 이미 걸러 주지만, Supabase 에서 «직접» 받는
// adaptCloudRow() 경로는 여기서 걸러야 한다(두 경로가 같은 화면을 내야 한다).
// ⚠ 규칙 원본은 config.py 다. 그쪽을 고치면 이 함수도 같이 고칠 것.
const INTERNAL_NOTE_MARK = "※[내부]";
function stripInternalNotes(s) {
  if (s == null) return "";
  return String(s).replace(/\r\n/g, "\n").replace(/\r/g, "\n")
    .split("\n").filter((ln) => !ln.trim().startsWith(INTERNAL_NOTE_MARK))
    .join("\n").trim();
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
    const label = detail ? `자세히 보기 (${urlHost(url)})` : urlHost(url);
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
    // ⚠ «※[내부]» 줄은 담당자 메모라 시민앱에서 지운다(stripInternalNotes 주석 참조)
    "비고": stripInternalNotes(tidyText(txt(r.note))),
    "categories": Array.isArray(r.categories) ? r.categories.filter(Boolean) : [],
    // 📅 «최신순» 정렬용 날짜. benefits 표의 created_at(등록)·updated_at(수정)에서 온다.
    //    · 내장 data.json 에는 이 값이 «없다»(엑셀에 등록일 칸이 없음) → 빈 문자열.
    //      그때는 목록의 정렬 컨트롤 자체를 숨기고 기존 순서를 그대로 쓴다(안전한 폴백).
    //    · 앞머리 «_» 는 «화면 데이터가 아니라 정렬용 부속값»이라는 표시다.
    //      ⛔ dataSignature 에 넣지 말 것 — 내용이 그대로여도 갱신 띠가 뜨는 오탐이 된다.
    "_date": txt(r.created_at) || txt(r.updated_at),
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
//
// ⚠ 행정망(업무망) 대비 폴백 (2026-08-21)
//    공무원 업무망 프록시가 «.json 요청»만 걸러 내는 사례가 있다(화면·글꼴·JS 는 다 뜨는데
//    data.json 만 막혀 「사업 정보를 준비 중입니다」 화면이 뜬다). 그래서 fetch 가 실패하면
//    build_data.py 가 «같은 순간·같은 내용»으로 함께 써 둔 data.js 를 <script> 로 끼워 넣어
//    window.__SANGJU_DATA__ 에서 읽는다. 단일 출처는 여전히 data.json 이고 data.js 는 사본이다.
//    둘 다 실패하면 예전처럼 조용히 null.
function _loadDataScript() {
  return new Promise((resolve) => {
    try {
      if (window.__SANGJU_DATA__) return resolve(window.__SANGJU_DATA__);
      const s = document.createElement("script");
      // 캐시 무효화 — fetch 쪽 cache:"no-store" 와 «같은 뜻»이 되도록 1회용 쿼리를 붙인다.
      s.src = "data.js?nc=" + Date.now();
      s.async = true;
      s.onload = () => resolve(window.__SANGJU_DATA__ || null);
      s.onerror = () => resolve(null);
      (document.head || document.documentElement).appendChild(s);
    } catch (e) {
      resolve(null);
    }
  });
}

async function loadLocalData() {
  try {
    const res = await fetch("data.json", { cache: "no-store" });
    if (!res.ok) throw new Error("HTTP " + res.status);
    const j = await res.json();
    if (!j || !Array.isArray(j.programs) || !j.programs.length) return null;
    return j;
  } catch (e) {
    console.warn("[사업정보] data.json 을 읽지 못했습니다:", e);
    // 폴백 — data.js (행정망에서 .json 이 막힌 경우)
    try {
      const j2 = await _loadDataScript();
      if (j2 && Array.isArray(j2.programs) && j2.programs.length) {
        console.warn("[사업정보] data.js 사본으로 대신 읽었습니다.");
        return j2;
      }
    } catch (e2) {
      console.warn("[사업정보] data.js 사본도 읽지 못했습니다:", e2);
    }
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
  /* 🏘 읍·면·동 목록 — 클라우드에서 오는 것은 «사업 목록»뿐이다. 행정구역은
     내장 data.json(build_data.py 가 만든 것)에만 있으므로 «여기서 그대로 옮겨 담는다».
     ⚠ 이 세 줄을 빼면 클라우드로 뜬 경우 DATA.region_groups 가 사라져,
        신청·정책제안의 읍·면·동 선택칸이 «선택해 주세요» 한 줄만 남는다
        (2026-08-20 실제로 그렇게 비어 있었다 — 아래 always_show·situation_map 과 같은 함정).
     ⛔ 행정구역을 이 파일에 적어 넣어 메우지 말 것. 단일 출처는 data.json 이다. */
  return {
    generated: (local && local.generated) || "",
    always_show: always,
    situation_map: situations,
    regions: (local && local.regions) || [],
    region_groups: (local && local.region_groups) || [],
    region_etc: (local && local.region_etc) || "",
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
      // 규격서 10절 — 화면 코드가 만들어 내는 이모지는 인라인 SVG 로 바꾼다(분야 칩만 예외).
      '<div class="err-title"><svg class="ic ic-in" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M10.2 9v6M13.8 9v6"/></svg> 클라우드 서비스가 일시적으로 응답하지 않습니다.</div>' +
      '<div class="err-desc">잠시 후 다시 시도해 주세요.<br>계속되면 인터넷 연결 상태를 확인해 주세요.</div>' +
      '<div class="err-actions"><button id="initRetry" class="err-retry" type="button"><svg class="ic ic-in" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20.4 11a8.5 8.5 0 1 0-.7 4.3"/><path d="M20.5 4.6v6.2h-6.2"/></svg> 다시 시도</button></div></div>'
    : '<div class="empty err-box" role="alert">' +
      '<div class="err-title">' + '<svg class="ic ic-in" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14.6 6.6a3.6 3.6 0 0 1 4.9-3.3l-2.7 2.7 1.4 1.4 2.7-2.7a3.6 3.6 0 0 1-4.6 4.7L6.8 18.9a2 2 0 1 1-2.8-2.8z"/></svg>' + ' 사업 정보를 준비 중입니다.</div>' +
      '<div class="err-desc">데이터 파일(data.json)을 읽지 못했습니다.<br>잠시 후 다시 시도해 주세요.</div>' +
      '<div class="err-actions"><button id="initRetry" class="err-retry" type="button"><svg class="ic ic-in" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20.4 11a8.5 8.5 0 1 0-.7 4.3"/><path d="M20.5 4.6v6.2h-6.2"/></svg> 다시 시도</button></div></div>';
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
  return ["teamModal", "versionModal", "installModal", "pinModal", "reportModal", "helpModal"]
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
//  · 끊김 대비(2026-08-20): 시연장 와이파이는 흔들린다. WebSocket 이 끊긴 것을
//    «아무도 모르는» 상태가 가장 나쁘다 — 화면은 멀쩡한데 바뀐 내용이 영영 안 온다.
//    ① 구독 상태를 받아 두고(SUBSCRIBED 인지), ② 끊기면 점점 늘어나는 간격으로 다시 붙고,
//    ③ 붙기 전까지는 «보이는 동안만» 20초마다 직접 조회하는 폴백을 돌린다.
//    실시간이 살아 있으면 폴백은 아예 돌지 않으므로 평소 데이터 사용량은 그대로다.
const RT_QUIET_VIEWS = ["home", "list", "recommend", "detail"];
const RT_POLL_MS = 20000;          // 실시간이 죽어 있는 «동안만» 도는 폴백 조회 간격
const RT_BACKOFF = [2000, 4000, 8000, 15000, 30000];   // 재연결 간격(마지막 값에서 고정)
let _rtTimer = null, _rtReloading = false;
let _rtChan = null;                // 지금 붙어 있는 채널(다시 붙기 전에 반드시 떼어 낸다)
let _rtOk = false;                 // 구독이 살아 있는가
let _rtTry = 0;                    // 연속 실패 횟수(백오프 단계)
let _rtRejoinTimer = null, _rtPollTimer = null;
let _rtTag = null;                 // 지금 «유효한» 채널의 신분증(늦게 온 옛 상태 무시용)
let _rtEverOk = false;             // 한 번이라도 붙은 적이 있는가(첫 연결과 재연결 구분)

// 지금 보고 있는 화면 이름 — «정본은 여기 한 곳뿐»이다.
//   _isDirtyView()(작성 중 이탈 보호)·_onBenefitsChanged()(실시간 반영)·
//   msBindVisibility()(내 신청 재조회)가 모두 이 함수를 쓴다.
//   내비 스택의 꼭대기가 곧 화면이므로 DOM 을 훑을 필요가 없다.
function _currentView() {
  const top = state.navStack[state.navStack.length - 1];
  return top ? top.v : "home";
}

// 「같은 내용으로 두 번 새로고침하지 않는다」 — 무한 새로고침 안전판.
//   느린 회선에서는 첫 화면을 내장 data.json 으로 그린다(displaySig = 내장본 서명).
//   그 상태에서 클라우드 조회가 성공하면 서명이 «항상» 달라 새로고침 → 또 내장본 →
//   또 새로고침 … 으로 무한 반복이 된다. 한 번 새로고침한 서명을 적어 두고,
//   돌아와서도 여전히 같은 서명이면 화면을 건드리지 않고 «띠»로만 알린다.
const RT_RELOAD_KEY = "sangju_rt_reload_sig";

async function _onBenefitsChanged() {
  if (_rtReloading) return;
  try {
    const cloud = await loadCloudData();
    if (!cloud || cloud.sig === displaySig) return;   // 실제 변화가 있을 때만
    if (RT_QUIET_VIEWS.indexOf(_currentView()) >= 0) {
      let prev = null;
      try { prev = sessionStorage.getItem(RT_RELOAD_KEY); } catch (e) {}
      if (prev === cloud.sig) {           // 이 내용 때문에 이미 한 번 새로고침했다
        noticeUpdate("사업 정보가 새로 갱신되었습니다");
        return;
      }
      try { sessionStorage.setItem(RT_RELOAD_KEY, cloud.sig); } catch (e) {}
      _rtReloading = true;
      location.reload();
    } else {
      noticeUpdate("사업 정보가 새로 갱신되었습니다");
    }
  } catch (e) { /* 조용히 넘긴다 — 다음 이벤트나 재진입 때 다시 본다 */ }
}

// 실시간이 죽어 있는 동안만 도는 폴백 조회. «보고 있을 때»만 돈다(숨어 있으면 건너뜀).
function _rtStartPoll() {
  if (_rtPollTimer !== null) return;      // ⚠ !_rtPollTimer 로 쓰면 타이머 id 0 을 «없음»으로 오인한다
  _rtPollTimer = setInterval(() => {
    if (document.hidden || _rtOk || _rtReloading) return;
    _onBenefitsChanged();
  }, RT_POLL_MS);
}
function _rtStopPoll() {
  if (_rtPollTimer === null) return;
  clearInterval(_rtPollTimer);
  _rtPollTimer = null;
}

// 구독 상태가 바뀔 때 한 곳에서만 처리한다(폴백 켜기/끄기 + 재연결 예약).
function _rtSetOk(ok) {
  const was = _rtOk;
  _rtOk = !!ok;
  if (_rtOk) {
    _rtTry = 0;
    _rtStopPoll();
    // 끊겼다가 «다시» 붙은 경우에만 그 사이의 변경을 확인한다.
    // (첫 연결에서는 확인하지 않는다 — init 이 방금 클라우드를 읽었다.)
    if (!was && _rtEverOk) _onBenefitsChanged();
    _rtEverOk = true;
  } else {
    _rtStartPoll();
    _rtScheduleRejoin();
  }
}

function _rtScheduleRejoin() {
  if (_rtRejoinTimer !== null) return;
  const wait = RT_BACKOFF[Math.min(_rtTry, RT_BACKOFF.length - 1)];
  _rtTry += 1;
  _rtRejoinTimer = setTimeout(() => {
    _rtRejoinTimer = null;
    if (!_rtOk) initBenefitsRealtime();
  }, wait);
}

function initBenefitsRealtime() {
  const sb = cloudClient();
  if (!sb || !sb.channel) return;                     // 클라우드 미설정이면 예전대로 동작
  try {
    // ★ 신분증을 «떼어 내기 전에» 갈아 끼운다. 옛 채널이 removeChannel 때 즉시 CLOSED 를
    //   알려도 그 콜백은 옛 신분증을 들고 있어 새 채널 상태를 뒤집지 못한다.
    const mine = {};
    _rtTag = mine;
    // 이전 채널이 남아 있으면 반드시 떼어 낸다(같은 이름으로 두 번 붙으면 서버가 거부한다).
    if (_rtChan) {
      try { sb.removeChannel(_rtChan); } catch (e) {}
      _rtChan = null;
    }
    const ch = sb.channel("benefits-rt-citizen")
      .on("postgres_changes", { event: "*", schema: "public", table: "benefits" }, () => {
        clearTimeout(_rtTimer);
        _rtTimer = setTimeout(_onBenefitsChanged, 1500);   // 몰아치는 이벤트를 한 번으로
      })
      .subscribe((status) => {
        // 떼어 낸 옛 채널이 뒤늦게 CLOSED 를 알려도 새 채널 상태를 뒤집지 않게 한다.
        if (_rtTag !== mine) return;
        // SUBSCRIBED 외의 상태(CHANNEL_ERROR·TIMED_OUT·CLOSED)는 «지금 안 온다»는 뜻이다.
        if (status === "SUBSCRIBED") _rtSetOk(true);
        else _rtSetOk(false);
      });
    _rtChan = ch;
  } catch (e) {
    console.warn("[실시간] 사업 구독 실패 — 폴백 조회로 동작합니다:", e);
    _rtSetOk(false);
  }
}

// 네트워크가 돌아왔거나 화면이 다시 보이면 «기다리지 않고» 즉시 다시 붙는다.
function _rtWakeUp() {
  if (_rtOk) return;
  clearTimeout(_rtRejoinTimer); _rtRejoinTimer = null;
  _rtTry = 0;
  initBenefitsRealtime();
  _onBenefitsChanged();      // 붙는 동안 놓친 변경도 바로 확인
}
function initFreshness() {
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) return;
    recheckCloud(false);
    _rtWakeUp();          // 화면이 다시 보이면 끊긴 실시간을 즉시 되살린다
  });
  window.addEventListener("focus", () => recheckCloud(false));
  window.addEventListener("online", () => { recheckCloud(true); _rtWakeUp(); });
  window.addEventListener("offline", () => _rtSetOk(false));
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
  initHistory();          // 브라우저·OS 뒤로가기 연동(덫 얹기 + popstate 받기)
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
// 「처음 1회만」 — 한 번 띄운 뒤로는 홈에 다시 뜨지 않는다(양호창님 결정).
// 지운 것이 아니다: 언제든 헤더 「안내」 › 「홈 화면에 추가하는 법」에서 볼 수 있다.
const A2HS_SEEN_KEY = "sangju_a2hs_seen";
function isStandalone() {
  // 이미 홈 화면 앱으로 실행 중이면 안내가 불필요
  return (window.matchMedia && window.matchMedia("(display-mode: standalone)").matches) ||
         window.navigator.standalone === true;
}
function initA2HS() {
  let dismissed = false, seen = false;
  try { dismissed = localStorage.getItem(A2HS_DISMISS_KEY) === "1"; } catch (e) {}
  try { seen = localStorage.getItem(A2HS_SEEN_KEY) === "1"; } catch (e) {}
  // 홈 상단 안내 띠: «처음 1회»에만 뜬다. 한 번 닫았거나, 이미 한 번 띄웠거나,
  // 이미 설치(standalone) 상태거나, 인앱 브라우저 배너가 떠 있으면(겹침 방지) 숨긴다.
  //
  // ⚠ 예외 한 가지 — a2hs.js 가 «지금 실제로 설치할 수 있다»(beforeinstallprompt)고
  //   알려 준 경우에는 «처음 1회» 규칙보다 우선해 띄운다. 그 순간은 «방법 안내»가 아니라
  //   «버튼 한 번으로 설치»가 가능한 때라, 안내와 성격이 다르다.
  //   (init 이 늦게 끝나 a2hs.js 가 켜 둔 띠를 여기서 다시 끄는 경합도 이 줄이 막는다)
  //   ⛔ 시민이 ✕ 로 «닫은» 경우(dismissed)에는 이 예외도 적용하지 않는다.
  const canInstall = !!window.__a2hsCanInstall;
  const show = !dismissed && !isStandalone() && $("inappBanner").hidden && (canInstall || !seen);
  $("a2hsTip").hidden = !show;
  // 띄운 «그 순간» 봤다고 적어 둔다 → 다음 방문부터는 헤더 「안내」에서만 볼 수 있다.
  if (show) { try { localStorage.setItem(A2HS_SEEN_KEY, "1"); } catch (e) {} }
}

// ---------- 헤더 「안내」 — 설치 방법·불편신고를 한 곳에 ----------
function closeHelp() { $("helpModal").hidden = true; window.ModalA11y && ModalA11y.close("helpModal"); }
function openHelp() {
  $("helpModal").hidden = false;
  window.ModalA11y && ModalA11y.open("helpModal", closeHelp);
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
    } catch (e2) {
      // (2026-08-19) alert() → 화면 안 짧은 알림(_toast). 화면을 가로막지 않는다.
      _toast("주소를 복사하지 못했습니다. 주소창의 주소를 직접 복사해 주세요.");
      return;
    }
  }
  _toast("주소를 복사했어요. 크롬·사파리에 붙여넣어 열어 주세요.");
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
  if (ok) flashCopied($("doneCodeBox"));   // 📋 찰칵 — 복사된 상자를 한 번 밝힌다
  if (msg) {
    msg.textContent = ok
      ? "확인 번호를 복사했습니다. 메모장이나 문자에 붙여넣어 보관해 주세요."
      : "복사하지 못했습니다. 화면의 코드를 직접 적어 주세요.";
  }
}

/* ═══════════════════════════════════════════════════════════════════════
   🔔 신규 사업 알림 배너 — N-08 (★ 2026-08-24, 양호창님이 실제로 쓰시다 발견)
   ───────────────────────────────────────────────────────────────────────
   지시 — 「«새로 추가된 지원사업 11건이 있어요!» 를 한번 확인하거나 X 를 누르면
           다음부터는 안 뜨도록 해줘. 지금은 주기적으로 뜨는 것 같아.」

   ⛔ 무엇이 잘못이었나 (헤드리스로 재현해 확인함)
     ① «본 것» 저장이 «사용자 확인»이 아니라 «페이지 로드»에 묶여 있었다.
        배너를 띄우자마자 현재 목록을 저장해 버려서 —
          · 확인하지 않고 새로고침해도 배너가 사라졌고(알림이 그냥 증발),
          · 정작 «다시 뜨는 것»은 못 막았다.
     ② 이 앱의 사업 목록 «출처는 둘»이다 — 내장 data.json 과 클라우드 benefits.
        그런데 init() 은 Promise.race(cloudP, FIRST_PAINT_MS) 로 «먼저 오는 쪽»을 쓴다.
        즉 «같은 기기·같은 자료»라도 회선 사정에 따라 로드마다 출처가 달라진다.
        두 출처의 사업명이 한 글자라도 다르면(이름 변경·갱신 시차) 출처가 오갈 때마다
        «없던 이름»이 생겨 새 사업으로 오인된다. → 이것이 「주기적으로 뜬다」의 정체다.
        실측: 옛 이름판 ↔ 새 이름판을 오가게 하니 «11건» 배너가 매 방문 다시 떴다
        (양호창님이 보신 숫자와 일치. 2026-08-24 사업명 11건이 실제로 바뀌었다).

   ✅ 어떻게 고쳤나 — 세 겹
     1) 저장을 «보기 / X 를 누른 그때»로 옮겼다(markNewSeen). 누르기 전에는 계속 뜬다 —
        확인하지 않았으니 알림이 남아 있는 것이 맞다.
     2) 닫은 «묶음»의 서명을 따로 기억한다(NEW_DISMISS_KEY). 출처가 오가 계산이 달라져도
        «같은 사업 묶음»이면 다시 띄우지 않는다.
     3) «출처별로 따로» 기억한다(seen.cloud / seen.local). 같은 출처끼리만 견주므로
        출처가 오간 것만으로는 새 사업이 생기지 않는다. 견줄 기록이 없는 출처는
        «첫 방문»으로 보고 조용히 기록만 한다 — 처음 온 분께 126건을 새 사업이라 알릴 수 없다.

   ⚠ localStorage 를 못 쓰는 환경(사생활 보호 모드·저장소 차단)
     읽기가 실패하면 seen 이 비어 «첫 방문»이 되어 배너를 띄우지 않는다.
     즉 «못 쓰면 조용하다» — 매번 뜨는 일은 구조적으로 생기지 않는다.
     한 세션 안에서는 memStore 가 기억하므로 화면 안에서의 동작은 정상이다.
   ⛔ 알림 자체를 없애지 말 것. 새 사업을 알리는 것은 이 앱의 쓸모다. 고친 것은 «반복»뿐이다.
   ═══════════════════════════════════════════════════════════════════════ */
const SEEN_KEY = "sangju_seen_programs";          // 옛 키(단순 배열) — 넘겨받기용으로만 읽는다
const SEEN_KEY_V2 = "sangju_seen_programs_v2";    // {cloud:[이름…], local:[이름…]}
const NEW_DISMISS_KEY = "sangju_new_dismissed";   // {sig:"…"} — 마지막으로 «됐다»고 한 묶음
const SEEN_MAX = 1000;                            // 이름이 바뀔 때마다 쌓이므로 상한을 둔다
let newProgramNames = [];
let newBatchSig = "";
// 저장소를 못 쓸 때 한 세션만 버티는 대체 기억. localStorage 가 되면 쓰이지 않는다.
let memStore = null, memDismiss = null;

function _newSrc() { return DATA && DATA.source === "cloud" ? "cloud" : "local"; }

function _readSeenStore() {
  try {
    const raw = localStorage.getItem(SEEN_KEY_V2);
    if (raw) {
      const o = JSON.parse(raw);
      if (o && typeof o === "object") {
        return { cloud: Array.isArray(o.cloud) ? o.cloud : [],
                 local: Array.isArray(o.local) ? o.local : [] };
      }
    }
    // 넘겨받기 — 옛 키(배열 하나)가 있으면 «두 출처 모두»의 기록으로 삼는다.
    // 한쪽만 채우면 업그레이드 직후 반대쪽 출처에서 126건이 통째로 «새 사업»이 된다.
    const old = JSON.parse(localStorage.getItem(SEEN_KEY) || "[]");
    if (Array.isArray(old) && old.length) return { cloud: old.slice(), local: old.slice() };
  } catch (e) { /* 저장소를 못 읽는다 — 아래 memStore 로 */ }
  return memStore ? { cloud: memStore.cloud.slice(), local: memStore.local.slice() } : null;
}

function _writeSeenStore(store) {
  memStore = { cloud: store.cloud.slice(), local: store.local.slice() };   // 세션 대비는 항상
  try { localStorage.setItem(SEEN_KEY_V2, JSON.stringify(store)); } catch (e) {}
}

function _readDismissSig() {
  try {
    const o = JSON.parse(localStorage.getItem(NEW_DISMISS_KEY) || "null");
    if (o && typeof o.sig === "string") return o.sig;
  } catch (e) {}
  return memDismiss;
}

function _writeDismissSig(sig) {
  memDismiss = sig;
  try { localStorage.setItem(NEW_DISMISS_KEY, JSON.stringify({ sig: sig, at: Date.now() })); } catch (e) {}
}

// 새로 나온 이름 묶음의 서명 — 순서가 달라도 같은 묶음이면 같은 값이 나와야 한다.
function _batchSig(names) { return names.slice().sort().join(""); }

function checkNewPrograms() {
  const names = (DATA.programs || []).map((p) => p.사업명);
  const src = _newSrc();
  const store = _readSeenStore();

  // ① 이 출처로 처음 온 경우 — 배너 없이 «지금 목록»만 기록한다(첫 방문 규칙 유지).
  if (!store || !store[src] || !store[src].length) {
    const base = store || { cloud: [], local: [] };
    base[src] = names.slice(-SEEN_MAX);
    _writeSeenStore(base);
    return;
  }

  const seenSet = new Set(store[src]);
  newProgramNames = names.filter((n) => !seenSet.has(n));
  if (!newProgramNames.length) return;                 // 새 것이 없다 — 저장할 일도 없다

  // ② 이미 «됐다»고 한 묶음이면 다시 띄우지 않는다(출처가 오가 계산이 달라져도 같은 묶음이면 같은 서명).
  newBatchSig = _batchSig(newProgramNames);
  if (newBatchSig && newBatchSig === _readDismissSig()) {
    markNewSeen(false);                                // 조용히 기록만 하고 끝낸다
    return;
  }

  // ③ 띄운다. ⛔ 여기서 저장하지 않는다 — 저장은 «보기 / X 를 누른 그때»(markNewSeen).
  $("newBannerText").textContent = `새로 추가된 지원사업 ${newProgramNames.length}건이 있어요!`;
  $("newBanner").hidden = false;
}

/* 사용자가 «확인»한 순간에만 기록한다. 「보기」로 목록을 열어도 본 것으로 친다
   (양호창님 「한번 확인하거나 X 를 누르면」).
   hideBanner=false 는 ②의 «조용한 기록» 경로 — 배너가 애초에 떠 있지 않다. */
function markNewSeen(hideBanner) {
  const src = _newSrc();
  const store = _readSeenStore() || { cloud: [], local: [] };
  const merged = store[src].concat(newProgramNames.filter((n) => store[src].indexOf(n) < 0));
  store[src] = merged.slice(-SEEN_MAX);               // 상한을 넘으면 오래된 것부터 버린다
  _writeSeenStore(store);
  if (newBatchSig) _writeDismissSig(newBatchSig);
  if (hideBanner !== false) $("newBanner").hidden = true;
}

// ---------- 홈: 카테고리 칩 ----------
function renderCategoryChips() {
  const box = $("categoryChips");
  // 맨 앞의 «전체» 칩 — 홈에 있던 큰 버튼 「전체 사업 보기」를 여기로 옮긴 것이다.
  //   · 홈의 버튼 총량을 상한(3개) 안으로 줄이면서 «전체 보기» 길은 그대로 남긴다.
  //   · data-cat 이 없으므로 «분야 필터»가 아니다 → 아래 분야 칩 바인딩에서 제외하고,
  //     ui.js 의 «자주 찾는 8개만 펴기»(chip-more)에서도 제외한다(.chip-all).
  /* ★ C-06 (2026-08-24 양호창님 결정) — 분야 칩은 «세로 2단»이다.
       ┌──────┐   윗줄 : 이모지(24px)
       │  🌾  │   아랫줄 : 분야 이름(12px, 가운데)
       │농림축│
       │수산업│
       └──────┘
     한 줄로 두면 긴 이름 때문에 폰에서 4열이 물리적으로 불가능했다(단장 실측).
     ⚠ 이모지는 «그대로 둔다» — 규격서 13절 「이모지 금지」의 유일한 예외가 분야 칩이다.
        (ui.js 의 이모지→SVG 치환 표(DYN)에도 분야 이모지는 들어 있지 않다. 확인함.)
     ⚠ aria-label 에 «이름만» 넣는다. 낭독기가 「가방 이모지 청소년 교육」처럼 읽지 않고
        「청소년·교육」이라고 바로 읽는다. 눈으로 보는 정보는 그대로다(색만으로 알리지 않기).
     ⛔ 이름을 줄이지 말 것 — 목록의 단일 출처는 config.POLICY_CATEGORIES 다. */
  box.innerHTML = `<button class="chip chip-all" type="button">전체</button>` +
    DATA.categories.map((c) => {
      const f = splitFieldLabel(c);
      return `<button class="chip chip-2" data-cat="${esc(c)}" aria-label="${esc(f.name)}">`
        + (f.icon ? `<span class="chip-ic">${esc(f.icon)}</span>` : "")
        + `<span class="chip-nm">${esc(f.name)}</span></button>`;
    }).join("");
  const allChip = box.querySelector(".chip-all");
  if (allChip) allChip.addEventListener("click", () => {
    state.selectedCats = new Set();
    openList({ title: "전체 사업" });
  });
  box.querySelectorAll(".chip:not(.chip-all)").forEach((el) => {
    el.addEventListener("click", () => {
      state.selectedCats = new Set([el.dataset.cat]);
      openList({ title: el.dataset.cat });
    });
  });
}

// ---------- 맞춤추천: 상황 체크 ----------
/* ★ C-01 (2026-08-24 양호창님 지시) — «전부 펴 두고, 대신 여러 열로 놓는다».
   예전에는 자주 고르는 8개만 펴고 나머지를 「더 보기 (9)」로 접었다(개수 상한 8).
   그런데 한 열로 세로로 쌓여 있어 8개만 해도 화면을 다 먹었고, 자기에게 해당하는
   상황이 «접힌 쪽»에 있으면 있는 줄도 모르고 지나쳤다 — 분야 칩에서 이미 겪은 일이다.
   → 접기를 없애고, style.css §Ⓐ 의 다중열 격자로 한 화면에 담는다.
     세로 길이는 «접었을 때»보다 오히려 짧아진다(17개 ÷ 2~4열).
   ⛔ 8개만 펴는 방식으로 되돌리지 말 것. 되돌리려면 양호창님 결정이 있어야 한다.
   ※ 상수를 지우지 않고 Infinity 로 둔 이유 — 아래 buildSituationToggle 이
     «숨은 개수 ≤ 0» 이면 버튼을 아예 만들지 않으므로, 한 줄만 되돌리면 옛 동작으로
     돌아갈 수 있다(원복 지점을 한 곳에 남겨 둔다). */
const SITUATION_OPEN = Infinity;

function renderSituations() {
  const box = $("situationList");
  box.innerHTML = DATA.situation_map.map(([label, cat], i) =>
    `<label class="situation${i >= SITUATION_OPEN ? " sit-more" : ""}" data-cat="${esc(cat)}">
       <input type="checkbox" data-i="${i}" /> <span>${esc(label)}</span>
     </label>`).join("");
  buildSituationToggle(box);
  box.querySelectorAll(".situation").forEach((el) => {
    const cb = el.querySelector("input");
    cb.addEventListener("change", () => {
      el.classList.toggle("on", cb.checked);
      if (cb.checked) state.situations.add(el.dataset.cat);
      else state.situations.delete(el.dataset.cat);
    });
  });
}

// 접힌 상황을 펴고 접는 버튼 — 분야 칩의 「분야 전체 보기」와 «같은 모양·같은 말투».
function buildSituationToggle(box) {
  const hidden = DATA.situation_map.length - SITUATION_OPEN;
  const old = document.getElementById("situationMore");
  if (old) old.parentNode.removeChild(old);
  if (hidden <= 0) return;
  const btn = document.createElement("button");
  btn.id = "situationMore";
  btn.type = "button";
  btn.className = "chip-toggle tap";
  btn.setAttribute("aria-controls", "situationList");
  btn.setAttribute("aria-expanded", "false");
  const paint = (open) => {
    // 개수를 «글자»로 적는다 — 접혀 있어도 무엇이 몇 개 더 있는지 알 수 있어야 한다.
    btn.textContent = open ? "접기" : `더 보기 (${hidden})`;
    btn.classList.toggle("is-open", open);
  };
  paint(false);
  btn.addEventListener("click", () => {
    const open = box.classList.toggle("sits-open");
    btn.setAttribute("aria-expanded", open ? "true" : "false");
    paint(open);
  });
  box.parentNode.insertBefore(btn, box.nextSibling);
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
    // ⛔ alert() 로 되돌리지 말 것 (2026-08-19).
    //    브라우저 alert 은 «hcyang572-gif.github.io 내용:» 같은 군더더기를 함께 띄우고,
    //    화면을 가로막아 무엇을 고쳐야 하는지 «그 자리»에서 보이지 않는다.
    //    → 다른 입력 오류와 «같은 방식»(.field-err + role="alert" + 초점 이동)으로 알린다.
    setRecommendErr("나이를 입력하시거나, 해당하는 상황을 하나 이상 골라 주세요.");
    const ageEl = $("ageInput");
    if (ageEl && ageEl.focus) { try { ageEl.focus(); } catch (e) { /* 무시 */ } }
    return;
  }
  setRecommendErr("");
  state.selectedCats = cats;
  /* ⏳ 「찾는 중」 0.6초 — 결과는 이미 손에 있지만 «곧바로» 내놓지 않는다.
     왜: 누르자마자 목록이 튀어나오면 「내가 넣은 나이·상황을 보긴 한 걸까?」 싶어진다.
         0.6초 동안 스켈레톤 두 장을 보여 주면 «나를 위해 찾아봤다»가 되고,
         그 사이에 눈이 상단의 결과 건수(#listMeta)로 옮겨 간다.
     ⚠ 규격서 14절 — 스켈레톤은 1.2s 순환·반짝임 없음. 기존 skeletonHtml() 을 «그대로» 쓴다
       (새 모양을 만들지 않는다 — 정책참여·내 신청과 같은 모양이어야 한다).
     ⚠ 낭독기에는 skeletonHtml() 안의 「불러오는 중입니다.」(role=status)가 읽힌다.
     ⚠ 0.6초 «뒤»에 화면이 저절로 바뀌는 것은 KWCAG 6.2.2 의 «자동 변경»이 아니다 —
       시민이 버튼을 눌러 «시작시킨» 한 번의 동작이 끝나는 것이다(정지 기능 대상 아님).
     ⛔ 시간을 늘리지 말 것. 0.6초를 넘으면 «연출»이 아니라 «느린 앱»이 된다. */
  openList({ title: "맞춤 추천 결과", pending: true });
}

// 맞춤 찾기 안내문 — 빈 문자열이면 숨긴다(다른 화면의 setFieldError 와 같은 규칙).
function setRecommendErr(msg) {
  const el = $("recommendErr");
  if (!el) return;
  el.textContent = msg || "";
  el.hidden = !msg;
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

// ── 목록 정렬 (2026-08-19) ────────────────────────────────────────────────
//  "default" = 지금까지의 순서(공무원앱과 같은 seq→id 순 / data.json 은 엑셀 순).
//  "new"     = 최신순 — 사업 정보의 등록일(_date, 없으면 수정일)이 늦은 것부터.
//  ⚠ 날짜는 «클라우드에서 온 사업 정보»에만 있다. 내장 data.json 만으로 화면이 뜬
//    경우(오프라인·클라우드 지연)에는 값이 하나도 없으므로 정렬 컨트롤을 숨기고
//    기존 순서를 그대로 쓴다 — 아무 일도 못 하는 조작을 화면에 두지 않는다.
//  "team"    = 팀별순 — 담당팀 «가나다순». 같은 팀 안에서는 기본순 그대로.
//              ⚠ 공무원앱 A-11 · PC앱 P-09 와 «글자 단위로 같은» 사양이다.
//                 값 "team" · 이름 「팀별순」 · 목록에서 셋째 자리 · 아래 SORT_TEAM 규칙.
//              날짜와 달리 팀명은 내장 data.json 에도 늘 있으므로 «항상» 고를 수 있다.
let listSort = "default";
function listHasDates() {
  return !!(DATA && DATA.programs && DATA.programs.some((p) => (p._date || "").trim()));
}

/* ── 팀별순 비교 규칙 (A-11 · P-09 공통 사양) ──────────────────────────────
   ① 팀명이 «있는» 사업이 먼저, «없는»(빈 문자열·'-'·'담당팀 확인 필요') 사업이 뒤.
   ② 있는 것끼리는 팀명 가나다순 — localeCompare("ko") · 대소문자/부호 무시하지 않음.
   ③ 팀명이 같으면 0 을 돌려준다 → Array.sort 의 안정성이 «기본순»을 그대로 지킨다.
   ⛔ 팀 «색»(teamColor)이나 팀 개수로 정렬하지 않는다 — 시민이 예측할 수 없다.       */
const TEAM_NONE = ["", "-", "담당팀 확인 필요"];
function teamSortKey(p) {
  const s = ((p && p.팀명) || "").trim();
  return TEAM_NONE.indexOf(s) >= 0 ? "" : s;
}
function compareByTeam(a, b) {
  const ka = teamSortKey(a), kb = teamSortKey(b);
  if (!ka && !kb) return 0;
  if (!ka) return 1;
  if (!kb) return -1;
  return ka.localeCompare(kb, "ko");
}

function syncListToolbar() {
  const bar = $("listToolbar");
  if (!bar) return;
  // 「팀별순」은 언제나 쓸 수 있으므로 정렬 줄 자체는 «항상» 보인다.
  bar.hidden = false;
  const sel = $("listSort");
  if (!sel) return;
  // 「최신순」만 조건부 — 등록일이 하나도 없는 환경에서는 아무 일도 못 하므로 목록에서 뺀다.
  const opt = sel.querySelector('option[value="new"]');
  const ok = listHasDates();
  if (opt) opt.hidden = !ok;
  if (!ok && listSort === "new") listSort = "default";
  sel.value = listSort;
}

let _listPendingTimer = 0;
function openList({ title, onlyNames, pending }) {
  listOnlyNames = onlyNames || null;
  $("topTitle").textContent = title || "사업 목록";
  $("listSearch").value = "";
  renderListDebounced.cancel();   // 이전 화면에서 대기 중이던 검색 렌더는 버린다
  syncListToolbar();
  showView("list");
  // ⏳ 앞선 「찾는 중」이 아직 대기 중이면 취소한다 — 겹치면 옛 결과가 새 결과를 덮어쓴다
  if (_listPendingTimer) { clearTimeout(_listPendingTimer); _listPendingTimer = 0; }
  if (pending && window.skeletonHtml) {
    // 맞춤 추천에서만 온다(runRecommend). 다른 경로는 지금까지처럼 «즉시» 그린다.
    $("listMeta").textContent = "";
    $("listResults").innerHTML = window.skeletonHtml(2);
    _listPendingTimer = window.setTimeout(function () {
      _listPendingTimer = 0;
      // 그 사이 다른 화면으로 갔으면 그리지 않는다(엉뚱한 화면을 덮어쓰지 않게)
      const v = $("view-list");
      if (v && !v.hidden) renderList();
    }, 600);
    return;
  }
  renderList();                    // 목록 진입은 즉시 렌더(지연 없음)
}

/* 스켈레톤 — 목록을 아직 못 불러왔을 때 자리만 잡아 두는 회색 블록.
   규격서 14절: 1.2s 순환·반짝임 없음·데이터가 오면 곧바로 교체.
   ⚠ 정보를 움직임에만 담지 않는다 → 낭독용 「불러오는 중입니다.」를 함께 둔다.
   ⚠ 이미 그릴 내용이 있으면 «부르지 않는다»(캐시로 즉시 뜨는 경우 굳이 애니메이션하지 않음). */
function skeletonHtml(n) {
  let out = '<div class="sk-list" aria-hidden="true">';
  for (let i = 0; i < (n || 3); i++) {
    out += '<div class="sk-card"><span class="sk-line w70"></span>' +
      '<span class="sk-line"></span><span class="sk-line w45"></span></div>';
  }
  return out + '</div><p class="sr-only" role="status">불러오는 중입니다.</p>';
}
window.skeletonHtml = skeletonHtml;   // proposals.js 도 같은 모양을 쓴다

function renderList() {
  const q = $("listSearch").value;
  const cats = (!listOnlyNames && state.selectedCats.size) ? state.selectedCats : null;
  let results = filterPrograms(cats, q);
  if (listOnlyNames) {
    const set = new Set(listOnlyNames);
    results = results.filter((p) => set.has(p.사업명));
  }
  // 최신순 — 날짜가 «없는» 사업은 순서를 흔들지 않도록 뒤로 밀고, 그들끼리는 원래 순서를 지킨다.
  // (Array.prototype.sort 는 최신 브라우저에서 안정 정렬이라 같은 값끼리는 입력 순서가 보존된다)
  if (listSort === "new") {
    results = results.slice().sort((a, b) => {
      const da = (a._date || ""), db = (b._date || "");
      if (!da && !db) return 0;
      if (!da) return 1;
      if (!db) return -1;
      return db < da ? -1 : (db > da ? 1 : 0);   // 내림차순(늦은 날짜가 위)
    });
  } else if (listSort === "team") {
    // 팀별순 — 위 compareByTeam 이 유일한 규칙. 같은 팀 안은 안정 정렬로 기본순 유지.
    results = results.slice().sort(compareByTeam);
  }
  $("listMeta").textContent = `${results.length}개 사업`;
  const box = $("listResults");
  if (results.length === 0) {
    const isAlways = cats && [...cats].some((c) => (DATA.always_show || []).includes(c));
    // 빈 화면에도 «다음에 무엇을 할지»를 둔다(규격서 0절·12절). 버튼은 하나만.
    box.innerHTML = `<p class="empty">${isAlways
      ? "현재 등록된 해당 분야 사업이 없습니다.<br>새로운 사업이 등록되면 이곳에 표시됩니다."
      : "조건에 맞는 사업이 없습니다.<br>검색어나 분야를 바꿔보세요."}
      <button class="empty-action tap" type="button" id="emptyAll">전체 사업 보기</button></p>`;
    const ea = $("emptyAll");
    if (ea) ea.addEventListener("click", () => {
      state.selectedCats = new Set();
      listOnlyNames = null;
      $("listSearch").value = "";
      $("topTitle").textContent = "전체 사업";
      renderList();
    });
    return;
  }
  // 걸러 보고 있는 분야(있으면) — 카드마다 다시 계산하지 않도록 한 번만 읽는다
  const picked = pickedCategory();
  box.innerHTML = results.map((p) => {
    const idx = DATA.programs.indexOf(p);
    const teamName = (p.팀명 || "").trim() || "담당팀 확인 필요";
    // 📌 접수 안내(비고): 마감/재접수 시기 등 — 있는 사업만 짧은 표식
    const note = (p.비고 || "").trim();
    const noteFlag = note
      ? `<span class="note-flag"><svg class="ic ic-in" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 4h6l-1 5 3.4 3v1.6H6.6V12L10 9z"/><path d="M12 13.6V21"/></svg> 받는 방법</span>`
      : "";
    // 키보드 접근(KWCAG 2.2): role=button + tabindex 로 Tab 이동·Enter/Space 실행 가능
    // ⚠ 예전에는 aria-label 로 이름만 읽어줘서, 화면낭독기 이용자에게는 카드 안의
    //    «내용 요약·담당팀·접수 안내»가 통째로 가려졌다(aria-label 이 하위 텍스트를 덮음).
    // → aria-labelledby(제목) + aria-describedby(요약·담당·안내)로 바꿔
    //    보이는 정보를 그대로 읽게 한다. 색만으로 알리지 않도록 '접수 안내 있음'은 글자로도 둔다.
    const did = `cardD${idx}`, mid = `cardM${idx}`;
    // 카드 안에 «상세 열기»와 «신청하기» 두 가지 행동이 있다.
    //   ⚠ 예전처럼 카드 전체를 role="button" 으로 두면, 그 «안»에 또 버튼을 넣을 수 없다
    //      (컨트롤 중첩 — 키보드·낭독기에서 어느 것을 누르는지 알 수 없게 된다).
    //   → 제목을 진짜 <button>(.card-open)으로 만들고, CSS 의 ::after 로 카드 전체를 덮어
    //     «카드 아무 데나 눌러도 상세»가 되게 한다. 신청 버튼만 그 위로 올린다(z-index).
    //     제목 버튼이므로 Tab 이동·Enter/Space 가 브라우저 기본으로 동작한다.
    //   ⚠ 목록에서 바로 신청하면 상세를 안 볼 수 있으므로, 신청서 맨 위에 사업명을 띄운다
    //     (openApply 가 #applyTitle 에 넣는다 — 잘못 신청 방지).
    /* 🎨 C안 «세움» 머리띠 (규격서 19-3) — 분야색 36px 띠 + 흰 본문 + 그림자 --e3.
       · 색은 data-fg 로만 «알린다». 실제 색값은 style.css §Ⓕ 한 블록에 있다.
       · 표에 없는 분야는 data-fg 가 비어 무채색으로 떨어진다(19-2 안전장치).
       · 색만으로 알리지 않도록 띠 «안»에 분야명 글자를 반드시 함께 둔다(규격서 8절).
       · 이모지는 «분야 칩»과 같은 예외로 그대로 둔다(규격서 13절). */
    const fg = primaryField(p, picked);
    // ⚠ 머리띠의 분야명을 aria-describedby 에 «반드시» 넣는다. 넣지 않으면 화면낭독기
    //    이용자에게는 분야가 «색으로만» 전해지는 셈이 된다(= 아무것도 안 전해진다).
    const bid = `cardB${idx}`;
    return `<div class="card c-card" data-idx="${idx}"${fg.group ? ` data-fg="${fg.group}"` : ""}>
      <div class="card-band"><span class="card-band-t" id="${bid}">${esc(fg.label)}</span></div>
      <div class="card-body">
        <h3><button class="card-open" type="button" aria-describedby="${bid} ${did} ${mid}">${esc(p.사업명)}</button></h3>
        <p id="${did}">${esc(previewText(p.내용 || p.대상자상세기준))}</p>
        <span class="card-meta" id="${mid}">
          <span class="team" data-team="${esc(teamName)}" title="${esc(teamName)}">${esc(teamName)}</span>${noteFlag}
        </span>
        <button class="card-apply tap" type="button" aria-label="${esc(p.사업명)} 신청하기">신청하기</button>
      </div>
    </div>`;
  }).join("");
  box.querySelectorAll(".card").forEach((el) => {
    applyTeamColor(el.querySelector(".team"), el.querySelector(".team").dataset.team);
    const idx = parseInt(el.dataset.idx, 10);
    const openBtn = el.querySelector(".card-open");
    if (openBtn) openBtn.addEventListener("click", () => openDetail(idx));
    const applyBtn = el.querySelector(".card-apply");
    if (applyBtn) applyBtn.addEventListener("click", (e) => { e.stopPropagation(); openApply(idx); });
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
  // 본문 칸(내용·대상·이용방법·필요 서류)은 linkifyHtml 로 «이스케이프 + 주소만 링크».
  // 그 밖의 칸(종료일 등)은 순수 텍스트라 esc 만 쓴다.
  /* ★ C-04 (2026-08-24) — 상세 화면을 «글자 나열»에서 «항목별 타일»로.
     예전에는 제목·본문이 위에서 아래로 줄줄이 이어져, 어디까지가 «대상»이고
     어디부터가 «이용 방법»인지 눈으로 끊기 어려웠다.
     → 항목마다 아이콘 + 분야 색군 틴트 머리 + 흰 본문의 «타일»로 세운다(규격서 19-2·19-4).
     ⚠ 만드는 함수는 아래 tile() 하나뿐이다. 새 항목이 생겨도 여기만 쓴다.
     ⚠ wide=true 는 «글이 긴» 항목(내용·대상) — 넓은 화면에서 한 줄을 다 쓴다.
        짧은 항목까지 넓히면 글줄이 길어져 오히려 읽기 나빠진다(규격서 19-4 각주). */
  const tile = (icon, k, innerHtml, wide) => innerHtml
    ? `<section class="d-tile${wide ? " d-tile--wide" : ""}">
         <h3 class="d-tile-k">${icon}<span>${esc(k)}</span></h3>
         <div class="d-tile-v">${innerHtml}</div>
       </section>`
    : "";
  const block = (icon, k, v, wide) => v ? tile(icon, k, linkifyHtml(v), wide) : "";
  const blockText = (icon, k, v, wide) => v ? tile(icon, k, esc(v), wide) : "";
  const blockHtml = (icon, k, html, wide) => html ? tile(icon, k, html, wide) : "";
  /* 이 사업의 «대표 분야» — 머리띠 색과 타일 틴트가 모두 여기서 나온다(분야→색군 표는 파일 위 한 곳).
     ⚠ 목록과 «같은 값»을 쓴다(pickedCategory). 목록 카드에 「💍 결혼·신혼부부」라고 적혀 있었는데
        눌러서 들어온 상세가 「🎓 청년」이면, 시민은 다른 사업을 연 줄 안다. */
  const fg = primaryField(p, pickedCategory());
  /* 분야 칩 — 머리띠에 이미 적힌 «대표 분야»는 빼고 «나머지»만 보여 준다.
     같은 말을 바로 위아래에 두 번 적으면 화면이 어수선해지고, 분야가 하나뿐인 사업에서는
     띠와 칩이 똑같은 글자로 겹쳐 보인다. 분야가 하나뿐이면 칩 줄 자체가 사라진다. */
  const tags = (p.categories || [])
    .filter((c) => String(c) !== fg.label)
    .map((c) => `<span class="t">${esc(c)}</span>`).join("");
  // 담당: 팀명이 없으면 '담당팀 확인 필요'. 팀명은 팀별 색 배지로 표시(색은 렌더 후 주입).
  const team = (p.팀명 || "").trim() || "담당팀 확인 필요";
  const org = (p.기관명 || "").trim();
  const teamBadge = `<span class="team detail-team" data-team="${esc(team)}">${esc(team)}</span>`;
  const chargeHtml = (org ? esc(org) + " · " : "") + teamBadge;
  // 연락처: 전화 걸기 링크
  const tel = (p.연락처 || "").trim();
  const telDigits = tel.replace(/[^0-9+]/g, "");
  const telHtml = tel
    ? `<a class="tel-link" href="tel:${esc(telDigits)}" aria-label="${esc(tel)} 전화 걸기"><svg class="ic ic-in" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6.4 3.6h3l1.5 4-2 1.5a12 12 0 0 0 6 6l1.5-2 4 1.5v3a2 2 0 0 1-2.2 2A17 17 0 0 1 4.4 5.8a2 2 0 0 1 2-2.2z"/></svg> ${esc(tel)}</a>`
    : "";
  /* ☎ 「전화로 문의」 — 앱에서 막히면 어르신은 «결국 전화»를 거신다.
     본문 속 작은 링크(위 telHtml)만으로는 번호를 찾아 눌러야 해서 그 지점에서 이탈한다.
     → 신청 버튼 바로 아래에 «같은 무게»의 큰 버튼을 둔다.
     ⚠ 연락처가 없는 사업에서는 «아예 만들지 않는다» — 눌러도 아무 일이 없는 버튼은
        없느니만 못하다(현재 자료 기준 연락처 없는 사업이 실제로 존재한다).
     ⚠ 주조색(primary)을 쓰지 않는다 — 이 화면의 «주요 버튼»은 「신청하기」 하나다(규격서 0절).
     ⚠ <a href="tel:"> 이므로 PC 브라우저에서는 아무 앱도 열리지 않을 수 있다.
        그래서 버튼 «글자 안»에 번호를 그대로 적어 둔다 — 못 걸어도 번호는 읽힌다. */
  const callHtml = tel
    ? `<a class="big-btn full detail-call" href="tel:${esc(telDigits)}" role="button"
          aria-label="담당 부서 ${esc(tel)} 로 전화 걸기"><svg class="ic ic-in" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6.4 3.6h3l1.5 4-2 1.5a12 12 0 0 0 6 6l1.5-2 4 1.5v3a2 2 0 0 1-2.2 2A17 17 0 0 1 4.4 5.8a2 2 0 0 1 2-2.2z"/></svg> 전화로 문의 ${esc(tel)}</a>`
    : "";
  // 📌 접수 안내(비고) — 접수 마감·재접수 시기 등. 값이 없으면 아무것도 렌더링하지 않는다.
  // 색만으로 구분하지 않도록 아이콘(📌)+'접수 안내' 문구를 함께 두고, role=note 로 읽히게 한다.
  const note = (p.비고 || "").trim();
  const noteHtml = note
    ? `<div class="notice-box" role="note" aria-label="받는 방법">
         <p class="notice-k"><svg class="ic ic-in" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 4h6l-1 5 3.4 3v1.6H6.6V12L10 9z"/><path d="M12 13.6V21"/></svg> 받는 방법</p>
         <p class="notice-v">${linkifyHtml(note)}</p>
       </div>`
    : "";
  // 타일 아이콘 — 인라인 SVG(이모지 금지, 규격서 13절). 아이콘은 «장식»이라 aria-hidden.
  const SV = (d) => `<svg class="ic ic-in" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
  const IC_BOOK = SV('<path d="M4 4.6h5.6a3 3 0 0 1 2.4 1.2 3 3 0 0 1 2.4-1.2H20v13h-5.6a3 3 0 0 0-2.4 1.2 3 3 0 0 0-2.4-1.2H4z"/><path d="M12 5.8v13"/>');
  const IC_PEOPLE = SV('<circle cx="8" cy="7.6" r="2.8"/><circle cx="16.4" cy="9" r="2.4"/><path d="M2.8 19.4a5.2 5.2 0 0 1 10.4 0"/><path d="M14.4 19.4a4.2 4.2 0 0 1 6.8 0"/>');
  const IC_PEN = SV('<path d="M4 20h4.2L20 8.2 15.8 4 4 15.8z"/><path d="m14.4 5.4 4.2 4.2"/>');
  const IC_COPY = SV('<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15h-.5A1.5 1.5 0 0 1 3 13.5v-9A1.5 1.5 0 0 1 4.5 3h9A1.5 1.5 0 0 1 15 4.5V5"/>');
  const IC_CAL = SV('<rect x="3.6" y="5" width="16.8" height="15" rx="2.2"/><path d="M3.6 9.6h16.8"/><path d="M8.4 3.2v3.4M15.6 3.2v3.4"/>');
  const IC_PHONE = SV('<path d="M6.4 3.6h3l1.5 4-2 1.5a12 12 0 0 0 6 6l1.5-2 4 1.5v3a2 2 0 0 1-2.2 2A17 17 0 0 1 4.4 5.8a2 2 0 0 1 2-2.2z"/>');
  /* 「문의」 — 예전에는 «담당»과 «연락처»가 따로 놓여 있었다. 시민이 찾는 것은
     «어디에 물어보나» 하나이므로 한 타일로 합친다(요구 C-04 의 「문의」). */
  const askHtml = [chargeHtml, telHtml].filter(Boolean).join('<span class="d-tile-sep"></span>');
  /* 「지급 시기」 — 아직 자료에 그 칸이 없다(🟢곳간 C-05·C-12 에서 새 필드가 생긴다).
     ⚠ 필드가 생기면 «이 한 줄»만 살아난다 — 화면 코드를 다시 고칠 필요가 없게 미리 읽어 둔다.
     그때까지는 지금 있는 「종료일」을 «신청 마감»으로 보여 준다(없는 말을 지어내지 않는다). */
  const payWhen = String(p.지급시기 || "").trim();
  const whenTile = payWhen
    ? blockText(IC_CAL, "지급 시기", payWhen)
    : blockText(IC_CAL, "신청 마감", p.종료일);
  $("detailContent").innerHTML = `
    <div class="detail-head c-card"${fg.group ? ` data-fg="${fg.group}"` : ""}>
      <div class="card-band"><span class="card-band-t">${esc(fg.label)}</span></div>
      <div class="card-body">
        <h2>${esc(p.사업명)}</h2>
        ${tags ? `<div class="detail-tags">${tags}</div>` : ""}
      </div>
    </div>
    ${noteHtml}
    <div class="detail-tiles"${fg.group ? ` data-fg="${fg.group}"` : ""}>
      ${block(IC_BOOK, "지원 내용", p.내용, true)}
      ${block(IC_PEOPLE, "지원 대상", p.대상자상세기준, true)}
      ${block(IC_PEN, "이용 방법", p.이용방법)}
      ${block(IC_COPY, "필요 서류", p.필요서류)}
      <div id="formsDownload"></div>
      ${whenTile}
      ${blockHtml(IC_PHONE, "문의", askHtml)}
    </div>
    <button class="big-btn primary full" id="detailApply">${SV('<path d="m5 13 4 4 10-11"/>')} 신청하기</button>
    ${callHtml}
  `;
  showView("detail");
  const teamEl = $("detailContent").querySelector(".detail-team");
  if (teamEl) applyTeamColor(teamEl, teamEl.dataset.team);
  $("detailApply").addEventListener("click", () => openApply(idx));
  // 📎 필요 서류 서식 다운로드(Supabase) — 비동기로 채운다.
  // 등록된 서식이 없거나 저장소 미준비면 섹션 자체를 숨긴 채로 둔다(기존 화면 무손상).
  renderFormsDownload(p, idx);
}

// 사업 상세의 «서식 다운로드» 블록을 채운다. 목록은 SangjuForms.listForms 가 정본.
// listForms 는 실패/미준비 시 [] 를 돌려주므로(방어), 없으면 비워 둬서 안 보이게 한다.
async function renderFormsDownload(p, idx) {
  const host = $("formsDownload");
  if (!host || !window.SangjuForms) return;
  // 비어 있을 때는 class 까지 지운다 — 타일 격자 안의 «빈 칸»이 남지 않게(#formsDownload:empty).
  const clear = () => { host.className = ""; host.innerHTML = ""; };
  let rows = [];
  try { rows = await SangjuForms.listForms(p); } catch (e) { rows = []; }
  // 그 사이 다른 사업으로 이동했으면(빠른 전환) 낡은 결과를 반영하지 않는다.
  if (currentIdx !== idx) return;
  if (!rows || !rows.length) { clear(); return; }
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
          <span class="forms-dl-name"><svg class="ic ic-in" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 4.6h5.6a3 3 0 0 1 2.4 1.2 3 3 0 0 1 2.4-1.2H20v13h-5.6a3 3 0 0 0-2.4 1.2 3 3 0 0 0-2.4-1.2H4z"/><path d="M12 5.8v13"/></svg> ${esc(nm)}</span>
          <span class="forms-dl-meta">${esc(metaTxt)}</span>
          <span class="forms-dl-go" aria-hidden="true">내려받기 ⬇</span>
        </a>
      </li>`;
  }).join("");
  if (!items) { clear(); return; }
  // 상세의 다른 항목들과 «같은 타일 모양»(.d-tile) — 새 모양을 만들지 않는다(규격서 0절).
  host.className = "d-tile";
  host.innerHTML = `<h3 class="d-tile-k"><svg class="ic ic-in" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3.6v10.2m0 0-3.4-3.4M12 13.8l3.4-3.4"/><path d="M4.6 15.4v2.8a2 2 0 0 0 2 2h10.8a2 2 0 0 0 2-2v-2.8"/></svg><span>필요 서류 서식 내려받기</span></h3>
    <div class="d-tile-v"><ul class="forms-dl-list">${items}</ul></div>`;
}

/* ════════════════════════════════════════════════════════════════════════
   📎 신청서 파일첨부 — 「통행증(attach_ticket)」 방식   (2026-08-19)
   규약 원본: supabase/신청첨부.sql 머리말. «반드시» 그 순서를 지킨다.
   ------------------------------------------------------------------------
   왜 이 순서인가
     시민은 로그인하지 않는다. 익명에게 저장소를 그냥 열면 «주소만 아는 누구나»
     무한히 파일을 밀어 넣는 창고가 된다. 그래서 «이미 접수된 신청»에 한해
     30분 동안만 열리는 통행증을 두고, 저장소 정책이 그 통행증을 검사한다.
       ① 파일 검증(개수·확장자·용량)  ② 통행증 생성
       ③ applications INSERT (attach_ticket 포함)   ← 여기가 먼저다
       ④ submissions 버킷 업로드                    ← 이때 통행증이 검사된다
       ⑤ attach_application_file() 로 목록 등록      ← 서버가 attachments 를 갱신
       ⑥ close_attach_ticket() 로 통행증 즉시 폐기
     ⛔ ④를 ③보다 «먼저» 하지 말 것 — 검사할 근거가 사라져 무한 업로드가 된다.
     ⛔ .insert().select() 금지 규약 그대로 — 그래서 서버가 준 id 를 받을 수 없고,
        첨부를 id 가 아니라 «접수번호 + 통행증»으로 잇는다.

   서버 준비 전 방어
     SQL 이 아직 실행되지 않은 서버에서는 is_open_attach_ticket 함수가 없다.
     그때는 첨부 UI 를 «조용히» 숨기고, 신청은 지금까지와 똑같이 동작한다.
     ⚠ 이 판정을 건너뛰고 attach_ticket 을 보내면 «컬럼 없음»으로 신청 INSERT
       자체가 실패한다 → 첨부 때문에 접수가 깨진다. 반드시 attachAvail === "ok" 일 때만 보낸다.
   ════════════════════════════════════════════════════════════════════════ */
const ATTACH_MAX = 5;                          // 신청 1건당 개수(서버도 5로 강제)
const ATTACH_MAX_BYTES = 10 * 1024 * 1024;     // 파일당 10MB(버킷 상한과 동일)
const ATTACH_BUCKET = "submissions";
// ⚠ 아래 목록은 supabase/신청첨부.sql 의 화이트리스트와 «반드시 같은 값». 한쪽만 고치지 말 것.
const ATTACH_EXT = ["hwp", "hwpx", "pdf", "docx", "xlsx", "jpg", "jpeg", "png", "heic"];

let attachAvail = "unknown";   // "unknown" | "ok" | "unavailable"
let attachFiles = [];          // 이번 신청에 붙일 File 객체들

function attachExtOf(name) {
  const parts = String(name || "").split(".");
  return parts.length > 1 ? parts.pop().toLowerCase() : "";
}
function attachFmtSize(n) {
  const b = Number(n) || 0;
  if (b < 1024) return b + "B";
  if (b < 1024 * 1024) return (b / 1024).toFixed(0) + "KB";
  return (b / 1024 / 1024).toFixed(1) + "MB";
}
function setAttachErr(msg) {
  const el = $("applyFilesErr");
  if (!el) return;
  el.textContent = msg || "";
  el.hidden = !msg;
}

// 저장경로용 ASCII 이름 — 저장소 키는 ASCII 만 허용한다(한글 파일명은 그대로 못 쓴다).
//   서버 검사식: '^<통행증>/[A-Za-z0-9._-]{1,120}$' 이고,
//   «저장경로의 확장자»와 «원본 파일명의 확장자»가 서로 같아야 통과한다.
//   → 확장자는 원본에서 그대로 떼어 소문자로 붙인다.
function attachSafeName(name, idx) {
  const ext = attachExtOf(name);
  let base = String(name || "");
  if (ext) base = base.slice(0, base.length - ext.length - 1);
  base = base.replace(/[^A-Za-z0-9._-]/g, "_").replace(/_+/g, "_").replace(/^[._-]+/, "");
  base = base.slice(0, 60);
  if (!base) base = "file";
  return String(idx + 1) + "_" + base + (ext ? "." + ext : "");
}

// 서버에 첨부 규약이 준비돼 있는지 «조용히» 확인한다.
//   빈 통행증으로 판정 함수를 부른다 → 있으면 false 를 돌려주고, 없으면 PGRST202.
//   ⚠ 시도 횟수를 세는 함수가 아니므로(되찾기와 다르다) 프로브해도 안전하다.
async function attachProbe() {
  if (attachAvail !== "unknown") return attachAvail;
  const sb = cloudClient();
  if (!sb || !sb.rpc) return attachAvail;
  try {
    const res = await sb.rpc("is_open_attach_ticket", { p_ticket: "" });
    if (res.error) throw res.error;
    attachAvail = "ok";
  } catch (e) {
    const missing = window.SangjuApply && SangjuApply.isMissingFunction
      ? SangjuApply.isMissingFunction(e) : false;
    if (missing) {
      attachAvail = "unavailable";
      console.debug("[첨부] 서버에 첨부 규약이 아직 없어 첨부 칸을 감춥니다.");
    } else {
      console.debug("[첨부] 지금은 확인할 수 없습니다(다음에 다시 확인).");
    }
  }
  paintAttachWrap();
  return attachAvail;
}

// 첨부 칸 노출 — «없다»고 서버가 확인해 준 경우에만 감춘다(모를 때는 보여 준다).
//   모를 때 보여 주는 이유: 제출 시점에 다시 확인해서, 그때도 없으면 첨부만 조용히
//   건너뛰고 신청은 정상 진행하기 때문이다(시민이 잃는 것이 없다).
function paintAttachWrap() {
  const w = $("applyAttachWrap");
  if (w) w.hidden = attachAvail === "unavailable";
}

function renderAttachList() {
  const box = $("applyFileList");
  if (!box) return;
  if (!attachFiles.length) { box.innerHTML = ""; return; }
  box.innerHTML = attachFiles.map((f, i) =>
    `<li><span class="file-name">${esc(f.name)}</span>` +
    `<span class="file-size">${esc(attachFmtSize(f.size))}</span>` +
    `<button class="file-del" type="button" data-i="${i}" ` +
    `aria-label="${esc(f.name)} 빼기">빼기</button></li>`).join("");
  box.querySelectorAll(".file-del").forEach((b) => {
    b.addEventListener("click", () => {
      const i = parseInt(b.dataset.i, 10);
      attachFiles.splice(i, 1);
      renderAttachList();
      setAttachErr("");
      // 지운 버튼 위에 초점이 남지 않게 파일 선택칸으로 돌린다(초점 유실 방지 KWCAG)
      const inp = $("applyFiles");
      if (inp && inp.focus) { try { inp.focus(); } catch (e) { /* 무시 */ } }
    });
  });
}

// 파일 선택 — 개수·확장자·용량을 «여기서» 걸러 낸다(서버도 다시 검사하지만,
// 시민이 올린 뒤에 거절당하는 것보다 고르는 그 자리에서 알려 주는 편이 낫다).
function onAttachPick(e) {
  const picked = Array.prototype.slice.call((e.target && e.target.files) || []);
  const bad = [];
  picked.forEach((f) => {
    if (attachFiles.length >= ATTACH_MAX) { bad.push(f.name + " (개수 초과)"); return; }
    if (ATTACH_EXT.indexOf(attachExtOf(f.name)) < 0) { bad.push(f.name + " (형식)"); return; }
    if (f.size > ATTACH_MAX_BYTES) { bad.push(f.name + " (용량)"); return; }
    if (attachFiles.some((x) => x.name === f.name && x.size === f.size)) return;  // 같은 파일 중복
    attachFiles.push(f);
  });
  e.target.value = "";     // 같은 파일을 다시 고를 수 있게 비운다
  renderAttachList();
  setAttachErr(bad.length
    ? "붙이지 못한 파일이 있습니다 — " + bad.join(", ") +
      ". 최대 " + ATTACH_MAX + "개, 한 개당 10MB, 정해진 형식만 됩니다."
    : "");
}

// 통행증 — 조회코드와 «같은 알파벳»(혼동 글자 제외 대문자+숫자) 26자 = 130비트.
//   서버 검사식이 '^[A-Z0-9]{20,40}$' 이므로 genLookupCode(26) 이 그대로 맞는다.
function makeAttachTicket() {
  if (!(window.SangjuApply && SangjuApply.genLookupCode)) return "";
  try { return SangjuApply.genLookupCode(26); } catch (e) { return ""; }
}

/* 접수가 끝난 «뒤»에 파일을 올린다. 반환: {ok, fail}
   ⚠ 여기서 실패해도 «신청 자체»는 이미 접수됐다 — 절대 접수를 되돌리지 않는다.
      대신 완료 화면에 결과를 정직하게 적어, 시민이 다른 방법을 택할 수 있게 한다. */
async function uploadAttachments(receiptNo, ticket) {
  const out = { ok: 0, fail: 0 };
  if (!attachFiles.length || !ticket || !receiptNo) return out;
  const sb = cloudClient();
  if (!sb || !sb.storage) { out.fail = attachFiles.length; return out; }
  for (let i = 0; i < attachFiles.length; i++) {
    const f = attachFiles[i];
    const path = ticket + "/" + attachSafeName(f.name, i);
    try {
      // upsert:false — 기존 파일 덮어쓰기 금지(서버에도 UPDATE 정책이 없다·이중 방어)
      const up = await sb.storage.from(ATTACH_BUCKET).upload(path, f, { upsert: false });
      if (up.error) throw up.error;
      // 목록 등록 — 실패해도 «예외»가 아니라 0 을 돌려준다(존재 오라클 차단 설계).
      const reg = await sb.rpc("attach_application_file", {
        p_receipt_no: receiptNo,
        p_ticket: ticket,
        p_file_name: f.name,          // 🔒 «원본» 한글 파일명 그대로(서버가 정화한다)
        p_storage_path: path,
        p_size: f.size,
        p_content_type: f.type || null,
      });
      if (reg.error) throw reg.error;
      if (!reg.data) throw new Error("등록 거부");
      out.ok++;
    } catch (e) {
      out.fail++;
      console.warn("[첨부] 올리지 못한 파일:", f.name, e);
    }
  }
  // 일을 마쳤으면 문을 닫는다 — 남은 시간은 순전히 공격 표면이다.
  //   ⚠ 실패는 «무시»한다(접수도 첨부도 이미 끝났고, 30분이면 저절로 닫힌다).
  try { await sb.rpc("close_attach_ticket", { p_receipt_no: receiptNo, p_ticket: ticket }); }
  catch (e) { /* 무시 */ }
  return out;
}

// ---------- 신청 (이메일 생성) ----------
/* 🏘 읍·면·동 선택칸 채우기 — 신청 폼(#applyRegion)·정책제안 폼(#pwRegion) 공용.
   ⚠ 목록의 «단일 출처»는 data.json 이다(build_data.py 가 만든다).
      ⛔ 25개 행정구역을 JS·HTML 에 복사해 넣지 말 것 — 행정구역이 바뀌면 두 곳이 어긋난다.
   ⚠ <optgroup>(읍/면/동/기타)으로 묶는다. 25개를 한 줄로 늘어놓으면 어르신이 찾지 못한다.
   ⚠ 첫 항목은 «선택해 주세요»(빈 값)로 둔다 — 함창읍이 기본으로 잡혀 있으면
      아무 생각 없이 넘겨 통계가 통째로 오염된다(2026-08-20 양호창님 지시).
   ⚠ keep: 목록에 «없는» 값(예전 자유 입력으로 올린 제안을 수정할 때)을 살려 두는 자리.
      그냥 두면 select 가 값을 버려 시민이 적어 둔 동네가 «조용히» 사라진다.
   ⚠ data.json 이 옛 판이라 regions 가 없을 수도 있다 → 그때는 칸을 그대로 두고
      «조용히» 물러난다(기존 방어 원칙). 그 경우 아래 검증도 통과시킨다. */
function regionGroups() {
  if (DATA && Array.isArray(DATA.region_groups) && DATA.region_groups.length) return DATA.region_groups;
  if (DATA && Array.isArray(DATA.regions) && DATA.regions.length) return [["", DATA.regions]];
  return [];
}
function regionList() {
  const out = [];
  regionGroups().forEach(function (g) { (g[1] || []).forEach(function (r) { out.push(r); }); });
  return out;
}
function fillRegionSelect(sel, keep) {
  if (!sel) return;
  const groups = regionGroups();
  if (!groups.length) return;              // 자료가 없으면 손대지 않는다
  const known = regionList();
  sel.innerHTML = "";
  const ph = document.createElement("option");
  ph.value = ""; ph.textContent = "선택해 주세요";
  sel.appendChild(ph);
  // 목록에 없는 옛 값은 «맨 앞»에 임시로 넣어 둔다(내용이 조용히 바뀌지 않게)
  const k = String(keep || "").trim();
  if (k && known.indexOf(k) === -1) {
    const o = document.createElement("option");
    o.value = k; o.textContent = k + " (예전 입력)";
    sel.appendChild(o);
  }
  groups.forEach(function (g) {
    const label = g[0], items = g[1] || [];
    if (!items.length) return;
    if (!label) { items.forEach(function (r) { sel.appendChild(regionOption(r)); }); return; }
    const og = document.createElement("optgroup");
    og.label = label;
    items.forEach(function (r) { og.appendChild(regionOption(r)); });
    sel.appendChild(og);
  });
  sel.value = k || "";
}
function regionOption(name) {
  const o = document.createElement("option");
  o.value = name; o.textContent = name;
  return o;
}
// 정책참여(proposals.js)도 같은 목록·같은 규칙을 쓴다 — 두 벌을 만들지 않는다.
window.fillRegionSelect = fillRegionSelect;
window.regionList = regionList;

function openApply(idx) {
  currentIdx = idx;
  const p = DATA.programs[idx];
  $("topTitle").textContent = "신청하기";
  $("applyTitle").textContent = p.사업명;
  // 📌 접수 안내(비고)는 '제출 직전'에 한 번 더 보여, 마감된 사업에 그냥 신청하지 않게 한다.
  const note = (p.비고 || "").trim();
  $("applyNotice").innerHTML = note
    ? `<div class="notice-box" role="note" aria-label="받는 방법">
         <p class="notice-k"><svg class="ic ic-in" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 4h6l-1 5 3.4 3v1.6H6.6V12L10 9z"/><path d="M12 13.6V21"/></svg> 받는 방법</p>
         <p class="notice-v">${linkifyHtml(note)}</p>
       </div>`
    : "";
  $("applyName").value = "";
  $("applyPhone").value = "";
  $("applyMemo").value = "";
  // 🏘 읍·면·동 — 신청할 때마다 «선택해 주세요»로 되돌린다(앞 신청의 선택이 남으면 안 된다)
  fillRegionSelect($("applyRegion"), "");
  // ⚖ 동의는 «신청할 때마다» 새로 받는다(이전 신청의 체크가 남아 있으면 안 된다).
  $("applyConsent").checked = false;
  // (선택) 동의도 같은 규칙 — 앞 신청의 체크가 남으면 «받은 적 없는 동의»가 된다.
  if ($("applyConsentOptional")) $("applyConsentOptional").checked = false;
  // 📎 첨부도 «신청할 때마다» 비운다 — 앞 신청에 붙였던 파일이 딸려 가면 안 된다.
  attachFiles = [];
  if ($("applyFiles")) $("applyFiles").value = "";
  renderAttachList();
  setAttachErr("");
  paintAttachWrap();
  attachProbe();                // 서버 준비 여부를 «조용히» 확인(실패해도 무해)
  clearApplyErrors();
  // 💾 쓰다 만 내용이 «이 사업»에 있으면 띠로 알린다(저절로 채우지는 않는다).
  //    ⚠ 위에서 칸을 모두 비운 «뒤»에 불러야 한다 — 순서를 바꾸면 띠만 뜨고 값이 지워진다.
  paintApplyDraftBanner();
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
  setFieldError("applyRegion", "applyRegionErr", "");
  setFieldError("applyConsent", "applyConsentErr", "");
  setFieldError("applyConsentOptional", "applyConsentOptErr", "");
  setFormError("applyFormErr", "");
}

// 폼 «전체»에 걸린 안내(접수 실패·설정 미완료 등). 예전에는 alert() 였다 —
// 화면을 가로막지 않고, 낭독기에는 role="alert" 로 그 자리에서 읽힌다.
function setFormError(id, msg) {
  const el = $(id);
  if (!el) return;
  el.textContent = msg || "";
  el.hidden = !msg;
  if (msg && el.scrollIntoView) {
    try { el.scrollIntoView({ block: "center", behavior: "smooth" }); } catch (e) { /* 무시 */ }
  }
}

// ── 연락처 자동 하이픈 (2026-08-19) ──────────────────────────────────────
//  보이는 값만 010-1234-5678 로 다듬는다.
//  ⛔ 서버·메일로는 «숫자만» 보낸다(sendApply 참조) — PC 자동접수.py·접수대장·
//     확인번호 되찾기가 모두 숫자 기준이라, 형식을 바꾸면 그 셋이 함께 깨진다.
function fmtPhone(digits) {
  const d = String(digits || "").replace(/[^0-9]/g, "").slice(0, 11);
  if (d.length <= 3) return d;
  if (d.length <= 7) return d.slice(0, 3) + "-" + d.slice(3);
  if (d.length <= 10) return d.slice(0, 3) + "-" + d.slice(3, 6) + "-" + d.slice(6);
  return d.slice(0, 3) + "-" + d.slice(3, 7) + "-" + d.slice(7);
}

// 입력 중 커서가 튀지 않게 — «커서 앞의 숫자 개수»를 세어 두고, 다시 그린 뒤
// 같은 숫자 개수 뒤로 커서를 돌려놓는다(하이픈이 늘거나 줄어도 자리를 지킨다).
function onPhoneInput(e) {
  const el = e.target;
  const caret = el.selectionStart == null ? el.value.length : el.selectionStart;
  const before = el.value.slice(0, caret).replace(/[^0-9]/g, "").length;
  const out = fmtPhone(el.value);
  if (out !== el.value) {
    el.value = out;
    let pos = 0, cnt = 0;
    while (pos < out.length && cnt < before) {
      if (out.charCodeAt(pos) >= 48 && out.charCodeAt(pos) <= 57) cnt++;
      pos++;
    }
    try { el.setSelectionRange(pos, pos); } catch (err) { /* 일부 브라우저는 tel 에서 미지원 */ }
  }
  setFieldError("applyPhone", "applyPhoneErr", "");   // 고치는 즉시 오류 표시 해제
}

/* 🔁 이중 접수 방지 — «보내는 중»에 한 번 더 들어오지 못하게 막는 빗장.
   ⚠ 버튼 disabled 만으로는 부족하다:
     ① 아래에서 완료 화면을 그리기 전에 msProbe() 를 기다리는 «틈»이 있는데,
        예전에는 그 앞에서 버튼을 이미 되살려 두 번 누르면 두 건이 접수됐다.
     ② 브라우저에 따라 입력칸에서 Enter 를 눌렀을 때 «비활성 제출 버튼»을 무시하고
        폼을 그대로 제출하기도 한다(구형 파이어폭스 계열).
   신청은 되돌릴 수 없는 행동이므로 «코드»로 한 번 더 잠근다. */
let _applySending = false;
// 「신청서 보내기」 버튼의 «원래 모습»(아이콘 포함) — 뜻밖의 오류에서 되돌리기 위해 보관.
let _applySendBtnHtml = "";

/* 뜻밖의 오류로 sendApply 가 중간에 멈췄을 때의 복구.
   예전에는 여기 아무것도 없어서, 예상 못 한 예외가 나면 버튼이 «제출 중…» 인 채로
   영영 잠기고 시민에게는 아무 말도 하지 않았다(무엇이 잘못됐는지 알 길이 없었다). */
function _applyRecover(err) {
  console.error("[신청] 예기치 못한 오류:", err);
  _applySending = false;
  const btn = $("applySend");
  if (btn) {
    btn.disabled = false;
    if (_applySendBtnHtml) btn.innerHTML = _applySendBtnHtml;
  }
  setFormError("applyFormErr",
    "신청 접수 중 문제가 생겼습니다. 잠시 후 다시 시도해 주세요. "
    + "계속 안 되시면 " + SUPPORT_EMAIL + " 로 알려 주세요.");
}

async function sendApply() {
  if (_applySending) return;
  const p = DATA.programs[currentIdx];
  const name = $("applyName").value.trim();
  // 📞 화면에는 하이픈이 있지만(010-1234-5678), 여기서부터는 «숫자만» 쓴다.
  //    ⛔ 하이픈이 붙은 값을 보내지 말 것 — PC 자동접수.py·엑셀 접수대장·
  //       확인번호 되찾기(연락처 뒷 4자리)가 모두 숫자 기준으로 맞춰져 있다.
  const phone = $("applyPhone").value.replace(/[^0-9]/g, "");
  const memo = $("applyMemo").value.trim();
  // 🏘 읍·면·동 — 필수. 통계로 쓰이므로 «고르지 않은 채» 통과시키지 않는다.
  const region = ($("applyRegion") ? $("applyRegion").value : "").trim();

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
    setFieldError("applyPhone", "applyPhoneErr", "연락처를 다시 확인해 주세요. (숫자 10~11자리)");
    firstBad = firstBad || "applyPhone";
  }
  /* 🏘 읍·면·동(필수) — 2026-08-20 양호창님 지시.
     ⚠ 「기타·타지역」이 목록에 있으므로 «고를 수 없어 막히는» 사람은 없다.
        (귀농·귀촌·전입 지원은 아직 상주시민이 아닌 분이 신청한다 — 그분들의 자리다)
     ⚠ data.json 이 옛 판이라 목록이 아예 없는 환경에서는 검사하지 않는다.
        고를 수가 없는데 막으면 신청 자체가 불가능해진다(기존 방어 원칙). */
  if (regionList().length && !region) {
    setFieldError("applyRegion", "applyRegionErr", "사시는 읍·면·동을 골라 주세요.");
    firstBad = firstBad || "applyRegion";
  }
  // ⚖ 개인정보 수집·이용 동의(필수) — 미동의면 «수집 자체»를 하지 않는다.
  //    구 PC앱 apply_view.py 의 차단 로직과 같은 규칙. 절대 건너뛰지 말 것.
  if (!$("applyConsent").checked) {
    setFieldError("applyConsent", "applyConsentErr",
      "(필수) 성명·연락처 수집·이용에 동의하셔야 신청할 수 있습니다.");
    firstBad = firstBad || "applyConsent";
  }
  /* ⚖ (선택) 문의사항·증빙서류 — 개인정보 보호법 §22③
     «선택 항목에 동의하지 않는다»는 이유로 신청을 막으면 안 된다.
       → 선택 칸을 «비워 두면» 동의 없이도 신청은 그대로 접수된다(막지 않는다).
       → 반대로 «적어 두고» 동의는 안 한 경우가 문제다. 그대로 보내면 동의 없이 수집하는 것이고,
         조용히 지워 보내면 시민이 쓴 글이 말없이 사라진다(둘 다 안 된다).
         그래서 «어느 쪽이든 고르실 수 있게» 두 길을 다 알려 주고 한 번만 멈춘다.
     ⛔ 여기서 체크상자를 코드로 켜지 말 것 — 미리 켜 둔 동의는 동의가 아니다.
     ⛔ 여기서 memo·attachFiles 를 몰래 비우지 말 것 — 시민이 쓴 것을 말없이 버리는 셈이다. */
  const wantsOptional = !!memo || (attachFiles && attachFiles.length > 0);
  if (wantsOptional && !$("applyConsentOptional").checked) {
    setFieldError("applyConsentOptional", "applyConsentOptErr",
      "문의사항·증빙서류를 함께 보내시려면 (선택) 항목에 동의해 주세요. "
      + "동의를 원치 않으시면 그 칸을 비우시면 됩니다 — 신청은 그대로 접수됩니다.");
    firstBad = firstBad || "applyConsentOptional";
  }
  if (firstBad) {
    const el = $(firstBad);
    if (el && el.focus) { try { el.focus({ preventScroll: false }); } catch (e) { el.focus(); } }
    return;
  }
  /* 📮 «신청 메일»은 없다 — 2026-08-24 양호창님 지시로 «완전히» 제거했다.
     예전에는 신청 한 건이 두 갈래로 나갔다.
       ① Supabase 저장(공무원앱이 실시간으로 보는 정본)
       ② Web3Forms → 담당 부서 메일 → PC 자동접수.py 가 엑셀 접수대장에 기록
     ②를 없앴으므로 «신청이 남는 곳은 ① 하나뿐»이다. 이 사실이 아래 모든 안내 문구를 바꾼다.
     ⛔ 여기에 access_key·subject·payload 를 다시 만들지 말 것. 시민의 이름·연락처가
        외부 폼메일 서비스로 나가는 통로를 되살리는 일이다(처리방침 5절도 함께 고쳐야 한다).
     ⚠ window.WEB3FORMS_KEY 는 «불편신고»(sendInquiry)가 아직 쓰므로 config.js 에 남아 있다.
        신청 경로에서는 키를 «읽지도 않는다» — 키가 비어 있어도 신청은 정상 접수된다. */

  const btn = $("applySend");
  // ⚠ textContent 로 저장·복원하면 버튼 «안의 SVG 아이콘»이 사라진다(글자만 남는다).
  //    한 번 보내고 나면 아이콘이 영영 돌아오지 않았다 → innerHTML 로 통째로 보관한다.
  //    (되찾기 버튼 #msRecoverBtn 은 원래 이 방식이었다 — 규약을 여기에도 맞춘다)
  const orig = btn.innerHTML;
  _applySending = true;
  btn.disabled = true;
  btn.textContent = "제출 중...";

  /* 접수번호(클라 생성) — Supabase 저장·완료화면 공용. 형식 YYYYMMDD-HHMMSS-NN.
     ⚠ NN 은 «순번»이 아니라 «난수 10~99» 다 (2026-08-20 수정, apply_client.js 주석 참조).
       예전처럼 늘 -01 이면 같은 초에 신청한 시민들이 똑같은 번호를 만들어
       한 명만 저장되고 나머지는 23505 로 거부됐다.
     ⚠ 겹치더라도 submitApplication 이 번호를 새로 뽑아 한 번 다시 보낸다. 그때는
       아래 savedReceipt 가 «서버에 실제로 들어간 번호»로 갱신된다 — 첨부 업로드도
       그 번호를 쓰므로, 여기 receiptNo 를 직접 화면에 쓰지 말 것. */
  const receiptNo = (window.SangjuApply && SangjuApply.genReceiptNo)
    ? SangjuApply.genReceiptNo(1) : "";
  // 🔑 조회코드(클라 생성) — 나중에 «내 신청 현황»을 여는 열쇠.
  //    ⚠ 코드는 Supabase 저장이 «성공했을 때만» 기기에 보관하고 화면에 보여 준다.
  //      저장이 실패하면 조회할 행 자체가 없으므로 코드도 의미가 없다.
  //    ⚠ genLookupCode 는 안전한 난수를 만들 수 없으면 «오류를 낸다»(Math.random 폴백 없음).
  //      그때는 신청을 진행하지 않고 멈춘다 — 예측 가능한 코드로 남의 신청이 열리면 안 된다.
  let lookupCode = "";
  if (window.SangjuApply && SangjuApply.genLookupCode) {
    try {
      lookupCode = SangjuApply.genLookupCode(10);
    } catch (e) {
      _applySending = false;
      btn.disabled = false;
      btn.innerHTML = orig;
      setFormError("applyFormErr", (e && e.message) ||
        "이 브라우저에서는 안전한 확인 번호를 만들 수 없어 신청을 진행할 수 없습니다.");
      return;
    }
  }

  // 📎 첨부 통행증 — «첨부할 파일이 있고, 서버에 첨부 규약이 있을 때만» 만든다.
  //    ⛔ 서버에 컬럼이 없는데 attach_ticket 을 보내면 신청 INSERT 자체가 실패한다.
  //       그래서 여기서 한 번 더 확인한다(화면을 연 뒤에 준비됐을 수도 있으므로).
  let attachTicket = "";
  if (attachFiles.length) {
    try { await attachProbe(); } catch (e) { /* 무시 */ }
    if (attachAvail === "ok") attachTicket = makeAttachTicket();
  }

  /* ── 접수 경로는 «하나»다 (2026-08-24) ────────────────────────────────
     Supabase 저장 = 접수 그 자체. 공무원앱이 실시간으로 보는 정본이고, 여기 실패하면
     신청은 «아무 데도 남지 않는다». 예전처럼 받쳐 주는 메일 경로는 없다.
     ⛔ 그러므로 이 실패를 «조용히» 삼키면 안 된다 — 시민은 접수된 줄 알고 화면을 닫는다.
        실패하면 완료 화면을 «절대» 그리지 않고, 「접수되지 않았으니 다시 신청해 주세요」를
        분명히 말한다(아래 else 가지).
     ⚠ 실패해도 입력하신 값은 그대로 둔다(칸을 비우지 않고, 임시저장도 지우지 않는다) —
        시민이 그 자리에서 버튼만 다시 누르면 되도록. */
  let supaOK = false, supaErr = null;
  let savedReceipt = receiptNo;

  // Supabase 직접 저장 — 개인정보(이름·연락처)가 클라우드로 전송됨(프로토타입·승인됨).
  if (window.SangjuApply && SangjuApply.submitApplication) {
    try {
      const insertRow = {
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
      };
      // 📎 첨부 통행증 — «값이 있을 때만» 키를 «넣는다».
      //    ⛔⛔ null 이라도 키를 넣지 말 것. PostgREST 는 «표에 없는 컬럼»이면
      //       값이 null 이어도 PGRST204 로 INSERT 전체를 거부한다.
      //       신청첨부.sql 을 아직 실행하지 않은 서버에서는 attach_ticket 컬럼이
      //       없으므로, 키를 늘 넣으면 «첨부와 무관한 모든 신청»이 저장되지 않는다.
      //    ⛔ attach_count 는 «절대» 보내지 않는다 — 서버만 올린다(정책이 0 을 강제).
      if (attachTicket) insertRow.attach_ticket = attachTicket;
      /* 🏘 읍·면·동 — 위 attach_ticket 과 «같은 함정»이 있다.
         PostgREST 는 표에 없는 컬럼이면 값이 무엇이든 PGRST204 로 INSERT «전체»를 거부한다.
         그런데 region 은 이제 «필수»라 늘 값이 있으므로, 컬럼이 없는 서버에서는
         attach_ticket 처럼 «값이 있을 때만 넣기»로는 막을 수 없다 —
         그대로 두면 supabase/읍면동_260820.sql 을 실행하기 «전»에 배포될 경우
         모든 신청이 저장에 실패한다 — 받쳐 주는 메일 경로가 없어진 지금은
         그 순간 «신청 자체가 안 된다»(예전에는 메일로라도 접수됐다). 이 되돌림이 더 중요해졌다.
         → 한 번 넣어 보고, «그 컬럼이 없다»는 뜻의 오류면 빼고 «한 번만» 다시 보낸다.
         ⚠ 이 되돌림은 컬럼이 생기면 저절로 안 쓰이게 된다(스스로 낫는 구조).
         ⚠ 이때 읍·면·동은 어디에도 기록되지 않는다(통계만 비고, 접수는 정상).
         ⛔ 재시도를 두 번 이상 돌리지 말 것 — 같은 신청이 두 건 저장될 수 있다. */
      if (region) insertRow.region = region;
      let row;
      try {
        row = await SangjuApply.submitApplication(insertRow);
      } catch (e1) {
        const missingRegion = insertRow.region !== undefined &&
          /region/i.test(String((e1 && (e1.message || e1.details)) || "")) &&
          (function () {
            try { return SangjuApply.errKind(e1) === "setup"; } catch (e2) { return false; }
          })();
        if (!missingRegion) throw e1;
        console.warn("[신청] 서버에 region 컬럼이 아직 없어 읍·면·동을 빼고 다시 보냅니다"
          + " (supabase/읍면동_260820.sql 미적용). 메일에는 그대로 실려 갑니다.");
        delete insertRow.region;
        row = await SangjuApply.submitApplication(insertRow);
      }
      // ✅ 저장 성공 판정 = «throw 없이 끝났는가». «서버가 행을 돌려줬는가»가 아니다.
      //    submitApplication 은 개인정보 테이블에 RETURNING(.select()) 을 쓰지 않으므로
      //    (그러면 익명에게 SELECT 권한이 없어 저장 자체가 거부된다 — apply_client.js 주석 참조)
      //    돌려받는 row 는 «우리가 보낸 행»이다. receipt_no·lookup_code 는 어차피 클라가 만든 값이라
      //    이 판정으로 완료화면·조회코드 보관이 그대로 성립한다.
      supaOK = true;
      if (row && row.receipt_no) savedReceipt = row.receipt_no;
      // 이 기기에 조회코드를 보관 → 다음에 «내 신청 현황»에서 자동으로 조회된다.
      //   ⚠ 보관 조건은 «Supabase 저장 성공»이다(여기 try 안에서만 부른다).
      saveLookupEntry({
        code: lookupCode,
        receipt_no: savedReceipt,
        benefit_name: p.사업명,
        at: new Date().toISOString(),
      });
    } catch (e) {
      supaErr = e;
      /* ⛔ 예전에는 여기가 «조용한 실패»였다 — 메일 경로가 접수를 이어받았으므로
         시민에게 알릴 이유가 없었다. 메일이 사라진 지금 그 침묵은 «거짓»이다.
         → 여기서는 원인만 콘솔에 남기고, 시민 안내는 아래 else 가지가 «접수 실패»로 말한다.
         원인 분류(conn/perm/setup/other)를 함께 남겨 «닿지 못함(conn)»과
         «권한 거부(perm)»를 나중에 구분할 수 있게 한다.
         ⚠ perm 이 반복되면 서버 정책이 아니라 «클라이언트가 RETURNING 을 쓰고 있지 않은지»를
           먼저 의심할 것(2026-08-18 실제 장애 원인). */
      let kind = "";
      try { kind = (window.SangjuApply && SangjuApply.errKind) ? SangjuApply.errKind(e) : ""; } catch (e2) {}
      console.warn("[신청] 접수 실패(경로가 하나뿐이라 이 신청은 어디에도 남지 않음) kind=" + kind + ":", e);
    }
  } else {
    /* 접수 모듈(apply_client.js)이 아예 실려 있지 않은 경우.
       예전에는 메일이 대신 받아 줬지만 이제는 «신청을 받을 방법이 없다» —
       조용히 넘어가지 말고 아래 else 가지가 실패로 안내하게 둔다. */
    supaErr = new Error("apply_client.js 미로딩 — 접수 모듈 없음");
    console.warn("[신청] 접수 모듈(SangjuApply.submitApplication)이 없습니다.");
  }

  // 📎 첨부 업로드 — «접수가 성공한 뒤»에만. 통행증은 그 접수 행에만 열린다.
  let attachMsg = "";
  if (attachFiles.length && supaOK) {
    if (attachTicket) {
      btn.textContent = "서류 올리는 중...";
      btn.disabled = true;
      const r = await uploadAttachments(savedReceipt, attachTicket);
      if (r.ok && !r.fail) attachMsg = `증빙서류 ${r.ok}개를 함께 보냈습니다.`;
      else if (r.ok && r.fail) attachMsg = `증빙서류 ${r.ok}개를 보냈고, ${r.fail}개는 보내지 못했습니다. 담당 부서로 연락해 주세요.`;
      else attachMsg = "증빙서류는 보내지 못했습니다. 신청은 접수되었으니 담당 부서로 연락해 주세요.";
    } else {
      attachMsg = "증빙서류는 보내지 못했습니다. 신청은 접수되었으니 담당 부서로 연락해 주세요.";
    }
  }
  // ⚠ 접수가 실패했으면 첨부 안내를 만들지 않는다 — 완료 화면 자체를 그리지 않으므로
  //    「신청은 접수되었으니」가 붙은 문장이 나가면 안 된다.

  // Supabase 저장이 성공했다 = 서버에 닿았다. 앱을 켤 때 프로브가 네트워크 때문에
  // 실패해 «아직 모름»으로 남아 있다면, 완료 화면을 그리기 «전에» 한 번 더 확인한다.
  // ⚠ 버튼은 이 확인이 끝날 때까지 «잠근 채로» 둔다 — 예전에는 여기서 이미 되살려
  //    두 번 누르면 신청이 두 건 접수될 수 있었다(되돌릴 수 없는 행동이라 치명적).
  if (supaOK && msAvail !== "ok") {
    try { await msProbe(); } catch (e) { /* 확인 못해도 코드는 보여 준다 */ }
  }

  _applySending = false;
  btn.disabled = false;
  btn.innerHTML = orig;

  if (supaOK) {
    // 💾 접수됐으니 이 기기에 남긴 임시 저장을 «즉시» 지운다(보관 규약 ①).
    //    ⚠ 완료 화면을 그리기 «전»에 지운다 — 뒤로 갔다 오면 옛 내용이 되살아나면 안 된다.
    //    ⛔ 이 두 줄은 «성공했을 때만» 부른다. 실패했는데 지우면 시민이 적은 내용이
    //       사라져 처음부터 다시 쓰게 된다(어르신에게는 사실상 포기다).
    clearApplyDraft();
    hideApplyDraftBanner();
    showDone(p, savedReceipt, lookupCode, attachMsg);
    attachFiles = [];             // 완료됐으니 비운다(뒤로 갔다 와도 딸려 가지 않게)
    renderAttachList();
  } else {
    /* ⭐⭐ 접수가 «되지 않았다» — 이 문장이 이번 구조에서 가장 중요하다 (2026-08-24)
       경로가 하나뿐이라, 여기 도달했다는 것은 신청이 어디에도 남지 않았다는 뜻이다.
       시민이 「접수됐겠지」 하고 화면을 닫으면 그대로 사라진다.
       → «접수되지 않았다» + «다시 신청해 주세요»를 «반드시» 함께 말한다.
       ⛔ 「전달되었습니다」·「담당 부서로 접수」 같은 말을 여기에 쓰지 말 것.
       ⛔ 예외 메시지 원문(TypeError: Failed to fetch, 42501 …)을 화면에 붙이지 말 것 —
          시민이 알 수 없는 영어 문구다. 원인은 콘솔에만 남긴다(기존 진단 유지).
       ⚠ 입력하신 값은 칸에 그대로 남아 있고 임시저장도 지우지 않았다 —
          「신청서 보내기」를 한 번 더 누르시면 된다. 그래서 그렇게 안내한다. */
    const detail = (supaErr && supaErr.message) || "";
    console.warn("[신청] 접수 실패 — 원인:", detail, supaErr);
    setFormError("applyFormErr",
      "신청이 접수되지 않았습니다. 적어 주신 내용은 그대로 남아 있으니, "
      + "인터넷 연결을 확인하신 뒤 아래 「신청서 보내기」를 다시 눌러 주세요. "
      + "계속 안 되시면 담당 부서(" + SUPPORT_EMAIL + ")로 알려 주세요.");
    // 오류 안내로 초점을 옮긴다 — 화면 아래쪽이라 못 보고 지나칠 수 있다(가장 위험한 지점).
    const errEl = $("applyFormErr");
    if (errEl) {
      try { errEl.scrollIntoView({ block: "center", behavior: "smooth" }); } catch (e) { /* 무시 */ }
    }
  }
}

// ---------- 개인정보 처리방침 ----------
function openPrivacy() {
  $("topTitle").textContent = "개인정보 처리방침";
  showView("privacy");
}

// ---------- 불편신고 (옛 「오류 문의」) ----------
function openInquiry() {
  $("topTitle").textContent = "불편신고";
  $("inquiryMemo").value = "";
  $("inquiryContact").value = "";
  // ⚖ 동의는 «보낼 때마다» 새로 받는다(앞서 낸 신고의 체크가 남아 있으면 안 된다).
  if ($("inquiryConsent")) $("inquiryConsent").checked = false;
  setFieldError("inquiryConsent", "inquiryConsentErr", "");
  setFormError("inquiryErr", "");
  showView("inquiry");
}

async function sendInquiry() {
  const memo = $("inquiryMemo").value.trim();
  const contact = $("inquiryContact").value.trim();
  setFormError("inquiryErr", "");
  setFieldError("inquiryConsent", "inquiryConsentErr", "");
  if (!memo) {
    // (2026-08-19) alert() → 화면 안 안내. 맞춤 찾기·신청 폼과 «같은 방식».
    setFormError("inquiryErr", "어떤 점이 불편하셨는지 적어 주세요.");
    const el = $("inquiryMemo");
    if (el && el.focus) { try { el.focus(); } catch (err) { /* 무시 */ } }
    return;
  }
  // ⚖ 개인정보 수집·이용 동의(필수) — 미동의면 «수집 자체»를 하지 않는다.
  //    신청 폼(applyConsent)과 «같은 패턴»이다. 절대 건너뛰지 말 것.
  if ($("inquiryConsent") && !$("inquiryConsent").checked) {
    setFieldError("inquiryConsent", "inquiryConsentErr",
      "개인정보 수집·이용에 동의하셔야 신고를 보내실 수 있습니다.");
    const el = $("inquiryConsent");
    if (el && el.focus) { try { el.focus(); } catch (err) { /* 무시 */ } }
    return;
  }
  const key = window.WEB3FORMS_KEY || "";
  if (!key || key.indexOf("여기에") !== -1) {
    setFormError("inquiryErr",
      "보내기 설정이 아직 끝나지 않았습니다. " + SUPPORT_EMAIL + " 로 알려 주세요.");
    return;
  }
  const payload = { type: "inquiry", 문의내용: memo, 연락처: contact, 전달주소: SUPPORT_EMAIL };
  const form = {
    access_key: key,
    // ⚠ 제목의 [오류문의] 태그는 PC 자동접수.py 가 메일을 가려내는 «약속»이다.
    //   화면 문구는 「불편신고」로 바뀌었지만 이 태그는 절대 바꾸지 않는다.
    subject: "[오류문의] 상주시 정책플랫폼(모바일)",
    from_name: "상주시 정책플랫폼(모바일)",
    "문의내용": memo,
    "연락처": contact || "(없음)",
    payload: "@@SJSTART@@" + JSON.stringify(payload) + "@@SJEND@@",
    botcheck: "",
  };
  const btn = $("inquirySend");
  // ⚠ textContent 로 저장·복원하면 버튼 안의 SVG 아이콘이 사라진다(신청 버튼과 같은 결함).
  const orig = btn.innerHTML;
  btn.disabled = true;
  btn.textContent = "보내는 중...";
  /* 📮 이 앱에 남은 «유일한» 메일 발송이다 (2026-08-24)
     사업신청 메일은 완전히 제거됐고, 여기 불편신고만 Web3Forms 를 쓴다.
     시민이 앱 오류를 알릴 다른 길이 없으므로 «그대로 둔다».
     ⛔ 이 경로를 신청 접수에 다시 쓰지 말 것. */
  try {
    const res = await fetch("https://api.web3forms.com/submit", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(form),
    });
    const j = await res.json();
    if (!j.success) throw new Error(j.message || "전송 실패");
    $("topTitle").textContent = "불편신고 완료";
    $("doneProgram").textContent = "불편신고가 접수되었습니다";
    // 직전 신청 완료의 접수번호가 남아있지 않도록 숨긴다(문의는 접수번호가 없음)
    if ($("doneReceipt")) { $("doneReceipt").textContent = ""; $("doneReceipt").hidden = true; }
    // 조회코드 상자·«내 신청 현황» 버튼도 함께 감춘다(문의는 조회 대상이 아님)
    setDoneCode("");
    if ($("doneStatus")) $("doneStatus").hidden = true;
    // 직전 신청의 첨부 안내가 남지 않게 함께 감춘다
    if ($("doneAttach")) { $("doneAttach").textContent = ""; $("doneAttach").hidden = true; }
    document.querySelector("#view-done h2").textContent = "알려 주셔서 감사합니다";
    document.querySelector("#view-done .done-desc").innerHTML =
      "담당자에게 내용이 전달되었습니다.<br>빠르게 확인하겠습니다.";
    state.navStack = [{ v: "home", t: HOME_TITLE }, { v: "done", t: "불편신고 완료" }];
    state.fwdStack = [];
    showView("done", false);
  } catch (e) {
    setFormError("inquiryErr",
      "전송에 실패했습니다. 인터넷 연결을 확인하고 다시 시도해 주세요." +
      (e && e.message ? " (" + e.message + ")" : ""));
  } finally {
    btn.disabled = false;
    btn.innerHTML = orig;
  }
}

/* ⭐ 이 화면은 «접수가 실제로 성공했을 때만» 그린다 (2026-08-24)
     접수 경로가 Supabase 하나뿐이므로, 여기까지 왔다는 것은 정본에 행이 남았다는 뜻이고
     접수번호·확인 번호가 «반드시» 있다.
     ⛔ 실패한 신청을 이 화면으로 보내지 말 것 — 시민이 접수된 줄 알고 화면을 닫는다.
        실패 안내는 sendApply 의 else 가지(#applyFormErr)가 «접수되지 않았습니다»로 말한다.
     ⚠ 예전에 있던 supaOK·cloudWhy 인자와 doneCloudWarn 줄은 «메일로는 접수됐지만
        클라우드 저장은 실패한» 상태를 알리기 위한 것이었다. 그 상태가 사라졌으므로 함께 걷어냈다.
        ⛔ 되살리지 말 것 — 지금 구조에서는 «접수됐지만 조회는 안 됨»이 존재할 수 없다. */
function showDone(p, receiptNo, lookupCode, attachMsg) {
  $("topTitle").textContent = "접수 완료";
  // 문의 완료로 바뀌었던 문구를 신청 완료용으로 복원
  document.querySelector("#view-done h2").textContent = "신청이 접수되었습니다";
  // ⚠ index.html 의 .done-desc 와 «같은 글자»여야 한다(불편신고 완료가 덮어쓴 것을 되돌리는 자리).
  document.querySelector("#view-done .done-desc").innerHTML =
    "신청 내용이 담당 부서로 접수되었습니다.<br>처리 결과는 담당자가 연락처로 안내드립니다.";
  $("doneProgram").textContent = p.사업명;
  // 접수번호(Supabase 저장 성공 시) — 있으면 표시, 없으면 숨김
  const rc = $("doneReceipt");
  if (rc) {
    const no = (receiptNo || "").trim();
    if (no) { rc.textContent = "접수번호 " + no; rc.hidden = false; }
    else { rc.textContent = ""; rc.hidden = true; }
  }
  // 📎 첨부 결과 — 실패도 «숨기지 않고» 알린다(시민이 다른 방법을 택할 수 있어야 한다)
  const at = $("doneAttach");
  if (at) {
    const m = (attachMsg || "").trim();
    at.textContent = m;
    at.hidden = !m;
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
  playGotgam();          // 🎂 곶감 톡 — «신청»이 끝났을 때만(불편신고 완료에서는 부르지 않는다)
}

/* 🎂 곶감 톡 — 시안 B「감빛 숨결」(2026-08-20 양호창님 승낙).
   접수가 끝난 «그 순간»에만 곶감 4알·입자 11개가 «아래에서 위로» 떠올랐다 사라진다.
   왜 이렇게 만드는가:
     · [hidden] 을 풀었다 다시 걸면 display:none → block 이 되면서 CSS 애니메이션이
       «저절로 처음부터» 다시 돈다. 그래서 두 번째 신청에서도 제대로 보인다.
       (클래스만 토글하면 두 번째부터 애니메이션이 다시 시작되지 않는다 — 실제로 겪는 함정)
     · 다 돌고 나면 «반드시» 다시 감춘다. 안 감추면 화면에 곶감 그림 다섯 개가
       투명한 채로 남아 있게 되고(opacity 0), 뒤로 갔다 오면 다시 나타난다.
   ⚠ 규격서 14절 — 자동 반복 금지. 이 함수는 «부를 때 한 번»만 돈다.
   ⚠ 저감모션에서는 CSS 가 .gotgam-rise 를 display:none 으로 끄므로 아무것도 보이지 않는다.
      (그래도 hidden 을 오가는 것은 무해하다 — 그리지 않을 뿐이다)
   ⛔ setInterval 로 계속 뿌리지 말 것. 광과민성 발작 위험 + 규격 위반. */
let _gotgamTimer = 0;
let _gotgamBox = null;     // 지금 돌고 있는 자리(정리할 때 이 자리를 감춘다)
/* boxId 를 주면 그 자리에서 돈다(2026-08-20 — 정책제안 등록 완료에서도 같은 연출).
   기본값은 신청 완료 화면의 #doneGotgam — 기존 호출부(playGotgam())는 한 글자도 안 바뀐다.
   ⚠ 두 자리는 «같은» CSS(.gotgam-rise)를 타므로 연출이 서로 달라질 수 없다.
   ⚠ 타이머는 하나뿐이다 — 두 곳이 겹쳐 돌 일이 없다(신청 완료와 제안 완료는 다른 흐름). */
function playGotgam(boxId) {
  try {
    const box = $(boxId || "doneGotgam");
    if (!box) return;
    // 앞선 연출이 아직 돌고 있으면 «그 자리»부터 정리한다.
    // (타이머만 끄고 넘어가면, 다른 자리의 곶감이 투명한 채 화면에 남는다)
    if (_gotgamTimer) {
      clearTimeout(_gotgamTimer); _gotgamTimer = 0;
      if (_gotgamBox && _gotgamBox !== box) _gotgamBox.hidden = true;
    }
    _gotgamBox = box;
    box.hidden = true;
    // 강제 리플로우 — 이 한 줄이 있어야 «두 번째 신청»에서도 애니메이션이 다시 돈다
    void box.offsetWidth;
    box.hidden = false;
    /* 정리 시각 — «가장 늦게 끝나는 것»보다 뒤여야 한다. 짧으면 연출이 도중에 잘린다.
         곶감 마지막: 지연 480ms + 2180ms = 2660ms
         입자 마지막: 지연 640ms + 2000ms = 2640ms
       → 2660ms 가 끝. 여유를 두어 2900ms 에 정리한다.
       ⛔ 사양(개수·지연·길이)을 바꾸면 이 숫자도 «함께» 다시 계산할 것. */
    _gotgamTimer = window.setTimeout(function () {
      box.hidden = true;
      _gotgamTimer = 0;
      if (_gotgamBox === box) _gotgamBox = null;
    }, 2900);
  } catch (e) { /* 장식이므로 실패해도 아무 일 없다 */ }
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
//    ② ⭐ 2026-08-19 «자동 폴링을 없앴다». 조회는 «이 화면에 들어올 때»와
//       «앱으로 돌아올 때(visibilitychange)» 각각 1회씩만 일어난다.
//    ③ ⭐ 그래서 ⏸ 정지 버튼도 없앴다 — 화면이 «스스로» 바뀌지 않으므로
//       KWCAG 2.2 «정지 기능 제공»의 대상 자체가 없다(움직이는 콘텐츠가 없다).
//       ⛔ 폴링을 되살리려면 정지 버튼도 «함께» 되살려야 한다. 둘은 한 쌍이다.
//       (시민에게는 「지금 새로고침」도 필요 없다 — 들어오면 늘 최신이다)
//    ④ 실제로 달라졌을 때만 다시 그린다(초점·스크롤이 20초마다 튀지 않게).
//    ⑤ 서버에 함수가 «없을 때만»(PGRST202) 진입점을 조용히 숨긴다.
//       ⚠ 네트워크 오류로 숨기지 않는다 — 아래 «3값 프로브» 참조.
//    ⑥ 🧹 이 기기에서 지우기 — 공용 기기에서 앞사람 코드가 남지 않게 스스로 지울 수 있어야 한다.
//    ⑦ 보관 코드는 180일이 지나면 자동으로 사라진다(개인정보 처리방침에 적은 그대로).
//
//  ⭐ 호출 구조 (2026-08-18 개편, 🩷 security-privacy 지적 / 2026-08-19 폴링 폐지)
//     · 예전: 코드마다 1회씩 8초 폴링 → 분당 최대 225회 = «코드 대입 공격»과 트래픽 모양이 같았다.
//     · 배열 함수 check_application_status_many 를 «먼저» 부르고(1회 왕복),
//       그 함수가 아직 서버에 없으면(PGRST202) 단건 함수로 «조용히» 폴백한다.
//     · 2026-08-19: 주기 폴링을 아예 없앴다 → «화면 진입/복귀 시 1회»만 호출했다.
//     · ⭐ 2026-08-25 «되살렸다»(양호창님 지시) — 10초 주기. 없애 두었더니 공무원이 시민
//       안내문을 써도 화면을 열어 둔 시민은 영영 그것을 못 봤다(이 화면의 존재 이유가 지워졌다).
//       대입 공격과의 구분은 «폴링을 없애서»가 아니라 아래 세 가지로 지킨다:
//         ① 배열 함수로 «1회 왕복»에 전부 조회 → 분당 6회(코드 수와 무관하다)
//         ② 이 화면이 보일 때만 · document.hidden 이면 건너뜀
//         ③ 가짜 코드를 서버에 던지지 않는다(프로브는 빈 배열)
//       ⚠ ⏸ 정지 단추는 2026-08-25 양호창님 지시로 없었다. 근거는 msPaintAutoBtn 주석에 있다.
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
/* 🔄 자동 새로고침 주기 — ⭐ 2026-08-25 양호창님 지시로 «되살렸다».
   ─────────────────────────────────────────────────────────────────────
   ⛔ 2026-08-19 에 이것을 없앴던 것이 결함이었다. 공무원이 시민 안내문을 써도,
      화면을 열어 둔 시민은 «영영» 그것을 못 봤다(다시 들어오지 않는 한).
      그것이 이 화면이 있는 이유 자체를 지우고 있었다.
   ⚠ 10초는 «PC앱과 같은 값»이다(webui/app.js 의 AUTO_REFRESH_MS = 10000).
      ⛔ 여기만 다른 숫자로 바꾸지 말 것 — 서로 다른 주기가 둘 돌아다니면 나중에
        한쪽만 고쳐진다. 바꾸려면 세 앱을 함께 바꾼다.
   🔒 2026-08-19 에 없앤 «진짜» 이유는 트래픽 모양이었다 — 코드마다 1건씩 8초 폴링이라
      분당 225회로 «코드 대입 공격»과 구분되지 않았다. 그 문제는 이미 다른 방법으로
      풀려 있다: ① 배열 함수 check_application_status_many 로 «1회 왕복»에 전부 조회,
      ② 이 화면이 «보일 때만» 돌고 document.hidden 이면 건너뜀, ③ 아래 ⏸ 로 시민이 멈춤.
      곧 10초 주기라도 왕복은 «분당 6회»이고, 가짜 코드를 던지지 않는다.
   ⚠⚠ 2026-08-25 양호창님 지시로 ⏸ 정지 단추를 없앨다 — 폴링은 그대로 돌아간다.
      지침(KWCAG 2.2 «정지 기능 제공») 적합 근거는 msPaintAutoBtn 주석에 적어 두었다. */
const MS_POLL_MS = 10000;
/* ⚠ msAuto 는 2026-08-25 부터 «항상 true» 입니다 — 정지 단추를 없앨기 때문입니다.
     ⛔ 다시 false 로 뒤집는 곳을 만들지 마세요 — 끄면 다시 켜는 길이 없습니다.
     ☆ 변수는 남깁니다 — msTick() 이 이 값을 읽습니다. */
let msAuto = true;
let msTimer = null;        // setInterval 손잡이 — 화면에 처음 들어올 때 한 번만 건다

let msAvail = "unknown";   // "unknown" | "ok" | "unavailable"  (위 ⭐ 3값 프로브)
let msBatch = "unknown";   // 배열 호출 함수가 서버에 있는가: "unknown" | "yes" | "no"
let msBusy = false;
let msVisBound = false;    // visibilitychange 리스너를 한 번만 걸기 위한 표시
let msRows = [], msSig = "", msErr = false, msLoaded = false;
let msDeferred = false;    // 목록 안에 초점이 있어 «미뤄 둔» 갱신이 있는가
let msFocusBound = false;
/* 🗑 신청 취소 — 서버에 cancel_application 이 «없다»고 확인됐을 때만 버튼을 숨긴다.
   ⚠ 미리 프로브하지 않는다(헛된 왕복을 만들지 않는다). 시민이 실제로 눌렀을 때
      PGRST202 로 «없다»는 답을 받으면 그때 이 값을 세우고 다시 그린다.
      네트워크 오류로는 숨기지 않는다 — 3값 프로브와 같은 원칙. */
let msCancelUnavail = false;
let msCanceling = false;   // 두 번 눌러 두 번 취소되는 일이 없게

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
// 취소(삭제)한 신청의 조회코드를 기기에서 지운다 — 더 조회할 것이 없는 열쇠를 남기지 않는다.
function removeLookupEntry(code) {
  const c = String(code || "").trim();
  if (!c) return;
  const list = loadLookupEntries().filter((e) => e.code !== c);
  try { localStorage.setItem(LOOKUP_KEY, JSON.stringify(list)); } catch (e) { /* 무시 */ }
}
function saveLookupEntry(entry) {
  if (!entry || !entry.code) return;
  const list = loadLookupEntries().filter((e) => e.code !== entry.code);
  list.push(entry);
  while (list.length > LOOKUP_MAX) list.shift();
  try { localStorage.setItem(LOOKUP_KEY, JSON.stringify(list)); } catch (e) { /* 저장 못해도 앱은 정상 */ }
}

// ── 완료 화면의 조회코드 상자 ──────────────────────────────────────────
/* 📋 복사 「찰칵」 — 어느 상자가 복사됐는지 눈으로 잇게 해 주는 «보조» 신호.
   ⚠ 정보를 움직임에만 담지 않는다(규격서 14절) — 실제 안내는 .code-copy-msg 글자가 한다.
      이 함수가 아무 일도 못 해도 시민은 «복사했습니다» 문구로 결과를 안다.
   ⚠ 클래스를 뗐다 붙여야 «두 번째 복사»에서도 다시 반짝인다(강제 리플로우 한 줄). */
function flashCopied(boxEl) {
  try {
    if (!boxEl) return;
    boxEl.classList.remove("copied");
    void boxEl.offsetWidth;
    boxEl.classList.add("copied");
    window.setTimeout(function () { boxEl.classList.remove("copied"); }, 400);
  } catch (e) { /* 장식이므로 실패해도 아무 일 없다 */ }
}

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
  // 이 휴대폰에 확인 번호는 있는데 «아직 한 번도» 못 불러온 상태 → 스켈레톤으로 자리를 잡는다.
  // (이미 불러온 내용이 있으면 이 줄을 지나지 않는다 — 20초 갱신마다 회색 블록이 번쩍이지 않게)
  if (hasCodes && !msLoaded && !msErr && !msRows.length) { box.innerHTML = skeletonHtml(2); return; }
  /* 서버에 조회 기능이 «없다»고 확인된 경우 — 홈 진입점을 항상 보이게 바꾸면서(2026-08-20)
     여기까지 들어오실 수 있게 됐다. 빈 화면을 보이지 말고 «지금은 왜 안 되는지»를 말한다.
     ⚠ 시민이 잘못한 것이 아니라는 점이 드러나야 한다 — 「준비 중」이라고 분명히 적는다. */
  if (msAvail === "unavailable") {
    box.innerHTML = `<div class="ms-empty"><p>지금은 진행 상태를 확인할 수 없습니다.</p>
      <p>잠시 후 다시 시도해 주세요.<br>
         신청은 정상적으로 접수되며, 처리 결과는 담당자가 연락처로 안내드립니다.</p></div>`;
    return;
  }
  if (msErr) {
    box.innerHTML = `<div class="ms-empty"><p>지금은 진행 상태를 불러오지 못했습니다.</p>
      <p>인터넷 연결을 확인하신 뒤 이 화면을 다시 열어 주세요.</p></div>`;
    return;
  }
  if (!msRows.length) {
    box.innerHTML = hasCodes
      ? `<div class="ms-empty"><p>조회되는 신청 내역이 없습니다.</p>
           <p>아래 「확인 번호로 내 신청 찾기」에서 번호를 넣어 다시 확인해 보세요.</p></div>`
      : `<div class="ms-empty"><p>이 휴대폰에 저장된 신청 내역이 없습니다.</p>
           <p>신청을 마치면 이 화면에서 진행 상태를 보실 수 있습니다.<br>
              다른 기기에서 신청하셨다면 아래 「확인 번호로 내 신청 찾기」를 눌러 주세요.</p></div>`;
    return;
  }
  box.innerHTML = msRows.map((r, i) => {
    const st = (r.status || "접수").trim();
    const reply = (r.citizen_reply || "").trim();
    const nm = (r.benefit_name || "").trim();
    // 🔎 이 신청이 «어떤 사업»이었는지 다시 볼 수 있게 — 사업명으로 목록에서 찾는다.
    //    찾으면 기존 상세 화면으로 가고, 못 찾으면(폐지·이름 변경) 카드 안에서
    //    «왜 못 보는지»만 펼친다. 어느 쪽이든 이 화면이 깨지지 않는다.
    const idx = findProgramIdxByName(nm);
    const titleTxt = esc(nm || "(사업명 없음)");
    const titleHtml = `<button class="ms-open" type="button" data-i="${i}">${titleTxt}` +
      `<span class="ms-open-go" aria-hidden="true">${idx >= 0 ? "사업 내용 보기 ›" : "자세히 ›"}</span></button>`;
    return `<div class="ms-card">
      <div class="ms-card-top">
        <span class="ms-badge ast-${esc(st)}">${esc(st)}</span>
        ${r.receipt_no ? `<span class="ms-rc"><svg class="ic ic-in" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M13.4 3H7a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1V7.6z"/><path d="M13.4 3v4.6H18"/><path d="M9.4 14.2l1.9 1.9 3.4-3.6"/></svg> ${esc(r.receipt_no)}</span>` : ""}
      </div>
      <div class="ms-card-title">${titleHtml}</div>
      <div class="ms-card-meta"><svg class="ic ic-in" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 4h6l-1 5 3.4 3v1.6H6.6V12L10 9z"/><path d="M12 13.6V21"/></svg> 신청 ${esc(msFmtDateTime(r.created_at))}${
        r.updated_at && r.updated_at !== r.created_at
          ? ` · 갱신 ${esc(msFmtDateTime(r.updated_at))}` : ""}</div>
      ${reply ? `<div class="ms-reply"><p class="ms-reply-k"><svg class="ic ic-in" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 14a3 3 0 0 1-3 3H8l-5 4V6a3 3 0 0 1 3-3h12a3 3 0 0 1 3 3z"/></svg> 담당 부서 안내</p>
                   <p class="ms-reply-v">${linkifyHtml(reply)}</p></div>` : ""}
      ${msCanCancel(r) ? `<div class="ms-card-act">
        <button class="ms-cancel" type="button" data-rc="${esc(r.receipt_no)}" data-nm="${titleTxt}">
          <svg class="ic ic-in" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 7h16"/><path d="M9 7V5h6v2"/><path d="M6 7l1 12a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-12"/><path d="M10 11v6M14 11v6"/></svg>
          신청 취소</button>
      </div>` : ""}
      <div class="ms-note" hidden></div>
    </div>`;
  }).join("");
  box.querySelectorAll(".ms-cancel").forEach((btn) => {
    btn.addEventListener("click", () => msCancelApply(btn));
  });
  box.querySelectorAll(".ms-open").forEach((btn) => {
    btn.addEventListener("click", () => {
      const r = msRows[parseInt(btn.dataset.i, 10)];
      if (!r) return;
      const idx = findProgramIdxByName(r.benefit_name);
      if (idx >= 0) { openDetail(idx); return; }
      // 폴백 — 화면을 옮기지 않고 카드 안에서 알린다(막다른 길을 만들지 않는다).
      const card = btn.closest(".ms-card");
      const note = card ? card.querySelector(".ms-note") : null;
      if (!note) return;
      const open = note.hidden;
      note.hidden = !open;
      if (open) {
        note.textContent = "이 사업은 지금 목록에 없어 상세 내용을 보여 드릴 수 없습니다"
          + "(접수가 끝났거나 이름이 바뀐 경우입니다). 진행 상태와 담당 부서 안내는 위에 그대로 있습니다.";
      }
    });
  });
}

/* ════════════════════════════════════════════════════════════════════════
   🗑 신청 취소(삭제) — 시민이 «자기 신청»을 스스로 거둔다 (2026-08-21)
   ------------------------------------------------------------------------
   어떻게 «본인 것만» 지우는가
     서버 함수 cancel_application(조회코드들, 접수번호) 이 «둘 다 맞는 한 건»만
     취소 표시한다(supabase/신청취소_260821.sql). 조회코드는 신청할 때 이 기기가
     만든 50비트 난수라 남의 것을 추측할 수 없다 — 즉 남의 신청은 지울 수 없다.
   무엇이 지워지는가
     applications.canceled_at 에 시각이 찍힌다(soft delete, 정책제안 삭제와 같은 방식).
     시민앱·공무원앱·PC앱 어디에서도 사라지지만 행은 남아 감사기록이 보존된다.
   ⚠ alert/confirm 을 쓰지 않는다 — 앱 안 확인창(appConfirm)과 짧은 알림(_toast).
   ⚠ 「승인/반려」 로 처리가 끝난 건은 버튼을 아예 내보내지 않는다(서버도 거절한다).
   ════════════════════════════════════════════════════════════════════════ */
function msCanCancel(r) {
  if (msCancelUnavail) return false;
  const A = window.SangjuApply;
  if (!A || !A.cancelApplication) return false;
  if (!String((r && r.receipt_no) || "").trim()) return false;
  const st = String((r && r.status) || "접수").trim();
  return st === "접수" || st === "심사중";
}

async function msCancelApply(btn) {
  if (!btn || msCanceling) return;
  const rc = String(btn.dataset.rc || "").trim();
  const nm = String(btn.dataset.nm || "").trim();
  if (!rc) return;
  const ok = await appConfirm(
    `${nm ? nm + "\n" : ""}접수번호 ${rc}\n\n` +
    "이 신청을 취소합니다. 취소하면 담당 부서에서도 내역이 사라지며, 되돌릴 수 없습니다.\n" +
    "다시 신청하시려면 처음부터 새로 신청하셔야 합니다.",
    { title: "신청을 취소할까요?", okText: "신청 취소", cancelText: "그대로 두기" });
  if (!ok) return;

  const A = window.SangjuApply;
  const codes = loadLookupEntries().map((e) => String(e.code || "").trim())
    .filter((c) => c.length >= 8);
  if (!A || !A.cancelApplication || !codes.length) {
    await appAlert("이 휴대폰에서는 취소할 수 없습니다.\n확인 번호를 입력해 조회한 뒤 다시 시도해 주세요.",
      { title: "취소하지 못했습니다" });
    return;
  }

  msCanceling = true;
  const label = btn.textContent;
  btn.disabled = true;
  btn.textContent = "취소하는 중…";
  try {
    const used = await A.cancelApplication(codes, rc);
    if (used) removeLookupEntry(used);
    msAnnounce("신청을 취소했습니다. 목록에서 내역이 사라집니다.");
    try { _toast("신청을 취소했습니다"); } catch (e) { /* 무시 */ }
    await msLoad(true);                 // 서버 기준으로 다시 그린다(취소된 건은 안 온다)
  } catch (e) {
    console.warn("[내신청현황] 취소 실패:", e);
    btn.disabled = false;
    btn.textContent = label;
    if (A.isMissingFunction && A.isMissingFunction(e)) {
      // 서버에 아직 함수가 없다 → 버튼을 조용히 거둔다(막다른 길을 남기지 않는다).
      msCancelUnavail = true;
      msRenderList();
      await appAlert("지금은 앱에서 취소할 수 없습니다.\n담당 부서로 연락 주시면 처리해 드립니다.",
        { title: "취소하지 못했습니다" });
    } else if (A.errKind && A.errKind(e) === "conn") {
      await appAlert("인터넷 연결이 불안정해 취소하지 못했습니다.\n잠시 후 다시 시도해 주세요.",
        { title: "취소하지 못했습니다" });
    } else {
      await appAlert(String((e && e.message) || "취소하지 못했습니다.")
        + "\n\n계속 안 되면 화면 아래 «오류 문의»로 연락 주세요.",
        { title: "취소하지 못했습니다" });
    }
  } finally {
    msCanceling = false;
  }
}

// 사업명으로 DATA.programs 에서 찾기 — 공백 차이는 무시한다(엑셀↔클라우드 표기 흔들림 대비).
// 못 찾으면 -1. DATA 가 아직 없을 수도 있으므로(로딩 중) 방어한다.
function findProgramIdxByName(name) {
  const key = _normName(name);
  if (!key || !DATA || !Array.isArray(DATA.programs)) return -1;
  for (let i = 0; i < DATA.programs.length; i++) {
    if (_normName(DATA.programs[i].사업명) === key) return i;
  }
  return -1;
}

/* ── 내 신청 화면의 두 갈래: 「신청한 사업」 / 「제안한 정책」 ──────────────────
   왜 나누는가: 성격이 다른 두 가지를 한 목록에 섞으면 «무엇의 상태인지»가 흐려진다.
   ⚠ 화면(view)을 나누지 않고 «한 화면 안의 갈래»로 둔 이유 — 뒤로가기 기록에
     갈래 전환이 쌓이면 시민이 뒤로가기를 여러 번 눌러야 목록을 빠져나가게 된다. */
let msTab = "apply";
function msSetTab(which) {
  msTab = which === "proposal" ? "proposal" : "apply";
  const a = $("msPanelApply"), b = $("msPanelProposal");
  const ta = $("msTabApply"), tb = $("msTabProposal");
  if (a) a.hidden = msTab !== "apply";
  if (b) b.hidden = msTab !== "proposal";
  if (ta) { ta.classList.toggle("is-on", msTab === "apply"); ta.setAttribute("aria-pressed", msTab === "apply" ? "true" : "false"); }
  if (tb) { tb.classList.toggle("is-on", msTab === "proposal"); tb.setAttribute("aria-pressed", msTab === "proposal" ? "true" : "false"); }
  if (msTab === "proposal") msLoadMyProposals();
}

// 내가 낸 정책제안 — proposals.js 가 기기에 남긴 제안 번호로 조회해 그린다.
//   ⚠ 서버 미준비·조회 실패는 «조용히 없음»으로 처리한다(기존 방어 원칙).
async function msLoadMyProposals() {
  const box = $("mpList");
  if (!box) return;
  if (!(window.Proposals && window.Proposals.renderMine)) {
    box.innerHTML = `<div class="ms-empty"><p>지금은 제안 목록을 볼 수 없습니다.</p></div>`;
    return;
  }
  try { await window.Proposals.renderMine("mpList"); }
  catch (e) { box.innerHTML = `<div class="ms-empty"><p>지금은 제안 목록을 볼 수 없습니다.</p></div>`; }
}

// 낭독은 «실제로 달라졌을 때만» — 10초마다 같은 말을 읽지 않게 한다.
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
    // 서명에 «오류였는가»까지 넣는다 → 연결이 끊긴 동안 10초마다 같은 화면을 다시 그리지 않는다.
    const sig = (res.failed ? "ERR|" : "OK|") + msSignature(res.rows);
    const changed = force || !msLoaded || sig !== msSig;
    msErr = res.failed;
    msRows = res.rows;
    msSig = sig;
    msLoaded = true;
    if (changed) {
      if (!force && msListHasFocus()) {
        // 초점을 뺏지 않는다 — 벗어나는 즉시(focusout) 또는 다음 주기(10초)에 반영한다.
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

/* 🔄 10초 주기 — «이 화면이 보일 때만». 다른 화면·백그라운드에서는 아무 일도 하지 않는다.
   ⭐ 2026-08-25 복원(양호창님 지시). 아래 네 가지 «건너뛰기»가 이 폴링의 안전장치다:
     ① msAuto 가 꺼져 있으면(시민이 ⏸ 로 멈췄으면) 아무 것도 하지 않는다
     ② 이미 조회 중이면(msBusy) 겹쳐 쏘지 않는다
     ③ 화면이 가려져 있으면(document.hidden) 건너뛴다 — 배터리·트래픽을 아낀다
     ④ 지금 보는 화면이 «내 신청»이 아니면 건너뛴다
   그 뒤 msLoad(false) 가 «서명이 같으면 다시 그리지 않고», «목록 안에 초점이 있으면
   다시 그리기를 미룬다»(msDeferred). 이 장치들은 원래부터 있던 것을 그대로 쓴다.
   ⛔ 여기서 msLoad(true)(=force)를 부르지 말 것 — force 는 «초점 보호»를 건너뛴다.
      10초마다 강제로 다시 그리면 키보드·낭독기 사용자가 목록 맨 앞으로 튕긴다. */
function msTick() {
  msFlushDeferred();            // 미뤄 둔 갱신이 있으면 먼저 반영
  if (!msAuto || msBusy) return;
  if (document.hidden) return;
  if (_currentView() !== "mystatus") return;
  msLoad(false);
}

/* ⛔⛔ 「자동 새로고침 멈추기」 단추 — 2026-08-25 양호창님 지시로 «없앴습니다». 되살리지 마세요.
   > 「모든 앱에서 자동 새로고침 멈추기 버튼은 제거해 줘.
   >   사용자가 뭔지도 모르고 혼란스럽기만 할 거야.」
   ★ 없앤 것은 «단추»뿐입니다 — 자동 새로고침 «기능»은 그대로 돕니다(msAuto 는 항상 true).
   ★ 「확인 〇월 〇일 〇〇:〇〇」(#msUpdated)는 «남겼습니다» — 언제 기준인지는 알 수 있어야
     하고, 그것은 «읽는 글»이라 혼란을 만들지 않습니다(혼란은 «누르는 것»에서 옵니다).
   ⚠ 함수 자체는 남겼습니다 — 부르는 곳이 여럿이라 지우면 그쪽이 다 깨집니다.
     지금은 «아무 일도 하지 않는» 함수입니다. */
function msPaintAutoBtn() { /* 단추를 없앴습니다 — 그릴 것이 없습니다. */ }

// 앱으로 돌아온 «그 순간» 한 번 따라잡는다. 화면이 가려진 동안은 아무 일도 하지 않는다.
function msBindVisibility() {
  if (msVisBound) return;
  msVisBound = true;
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) return;
    if (_currentView() !== "mystatus") return;
    msFlushDeferred();
    try { msLoad(false); } catch (e) { /* 무시 */ }
  });
}

// 🧹 이 기기에서 지우기 — 공용 기기(주민센터·도서관 PC, 가족 태블릿)에서
//    앞사람의 조회코드가 남아 다음 사람에게 신청 내역이 보이는 일이 없어야 한다.
//    ⚠ 지우는 것은 «이 기기의 보관값»뿐 — 신청 자체는 그대로 살아 있다.
async function msClearDevice() {
  const n = loadLookupEntries().length;
  if (!n) {
    // 확인 번호는 없어도 «쓰다 만 신청서»는 남아 있을 수 있다 — 그것만이라도 지운다.
    // (그냥 돌아가 버리면 「지우기」를 눌렀는데 이름·연락처가 그대로 남는다)
    if (loadApplyDraft()) {
      clearApplyDraft();
      hideApplyDraftBanner();
      msAnnounce("이 휴대폰에 임시로 저장된 신청서 내용을 지웠습니다.");
      return;
    }
    msAnnounce("이 휴대폰에 보관된 확인 번호가 없습니다.");
    return;
  }
  const ok = await appConfirm(
    `이 휴대폰에 보관된 확인 번호 ${n}건을 지웁니다.\n` +
    "지운 뒤에는 적어 두신 확인 번호를 다시 입력해야 진행 상태를 보실 수 있습니다.\n" +
    "신청 자체가 취소되지는 않습니다.\n" +
    "쓰다 만 신청서 내용이 남아 있으면 그것도 함께 지웁니다.",
    { title: "이 기기에서 지울까요?", okText: "지우기" });
  if (!ok) return;
  try { localStorage.removeItem(LOOKUP_KEY); } catch (e) { /* 무시 */ }
  // 💾 쓰다 만 신청서(이름·연락처·문의사항)도 «함께» 지운다 — 보관 규약 ④.
  //    공용 기기에서 「이 기기에서 지우기」를 눌렀는데 이름이 남아 있으면 지운 것이 아니다.
  clearApplyDraft();
  hideApplyDraftBanner();
  msRows = []; msSig = ""; msErr = false; msLoaded = true; msDeferred = false;
  msRenderList();
  msPaintEntry();               // 보관 코드가 0건이 되면 홈 진입점도 다시 판단한다
  const up = $("msUpdated");
  if (up) up.textContent = "";
  msAnnounce("이 휴대폰에 보관된 확인 번호를 모두 지웠습니다.");
}

function openMyStatus() {
  $("topTitle").textContent = "내 신청";
  msSetTab("apply");            // 들어오면 언제나 «신청한 사업»부터
  msRenderList();               // 있던 내용을 먼저 그려 빈 화면을 보이지 않게
  showView("mystatus");
  msPaintAutoBtn();             // ⏸ 단추 글자를 지금 상태(켜짐/꺼짐)에 맞춘다
  // 앱을 켤 때 프로브가 «네트워크 때문에» 실패했을 수 있다 → 들어온 김에 다시 확인한다.
  if (msAvail !== "ok") { try { msProbe(); } catch (e) { /* 무시 */ } }
  msLoad(true);                 // 들어온 «그 순간» 한 번 확인(10초를 기다리지 않는다)
  // 목록 안에서 초점이 빠져나가면 미뤄 둔 갱신을 즉시 반영한다(리스너는 한 번만 건다).
  if (!msFocusBound) {
    const box = $("msList");
    if (box) {
      box.addEventListener("focusout", () => setTimeout(msFlushDeferred, 0));
      msFocusBound = true;
    }
  }
  /* 🔄 10초 폴링 — 이 화면에 «처음» 들어올 때 한 번만 건다.
     ⚠ 타이머를 화면을 나갈 때 끄지 않는다 — msTick 이 스스로 «지금 보는 화면»을 확인해
        건너뛰므로 꺼도 되고 안 꺼도 되는데, 껐다 켰다 하면 리스너가 겹쳐 붙는다.
     ⚠ 화면 복귀 시 «한 번 따라잡기»는 아래 msBindVisibility() 가 이미 한다 —
        여기에 visibilitychange 를 또 걸지 말 것(2026-08-19 이전 코드는 두 곳에 걸려 있었다). */
  if (!msTimer) msTimer = setInterval(msTick, MS_POLL_MS);
  msBindVisibility();
}

// 「확인 번호로 내 신청 찾기」 — 내 신청 화면에서 떼어 낸 별도 화면(2026-08-19).
//  ⚠ 되찾기(이름+연락처 뒷4자리) 창구는 «들어올 때마다 접힌 채»로 시작한다.
//    ① 보조 창구라는 성격을 유지하고(펼쳐진 채 남으면 상시 통로처럼 보인다)
//    ② 공용 기기에서 앞사람이 넣은 이름·되찾은 코드가 화면에 남지 않게 한다.
//    ⛔ 이 규칙을 없애지 말 것 — 설계 근거는 supabase/조회코드_되찾기.sql 머리말.
//    ⚠ msRecoverWrap 의 hidden 은 건드리지 않는다 — 서버에 함수가 없어 숨긴 상태를 되살리면 안 된다.
function openMsCode() {
  $("topTitle").textContent = "확인 번호로 찾기";
  const codeEl = $("msCode");
  if (codeEl) codeEl.value = "";
  setFieldError("msCode", "msCodeErr", "");
  if (msRecOpen) msRecToggle();
  else msRecReset();
  showView("mscode");
}

/* 홈의 «내 신청 현황» 진입점 — 2026-08-20 양호창님 지시로 «항상» 보인다.
   ⚠ 예전에는 서버 상태(msAvail)와 기기에 보관된 코드 유무에 따라 나타났다 사라졌다 했다.
      기능적으로는 «할 수 없는 일을 보여 주지 않는» 방어였지만, 어르신께는
      「어제 있던 메뉴가 없어졌다 = 내가 뭘 잘못 눌렀다」로 읽혔다.
      메뉴가 늘 같은 자리에 있고, 눌렀을 때 «지금은 왜 안 되는지» 말해 주는 편이 낫다.
      (하단 탭바의 「내 신청」은 원래도 항상 보였다 — 홈 카드만 달랐던 셈이라 오히려 어긋났다)
   → 안내는 openMyStatus()·msRenderList() 가 맡는다.
   ⛔ 이 함수에 다시 «감추는» 분기를 넣지 말 것. 감추려면 탭바의 「내 신청」도 함께 감춰야
      앞뒤가 맞는데, 그러면 시민이 들어갈 문이 하나도 남지 않는다. */
function msPaintEntry() {
  const el = $("myStatusEntry");
  if (!el) return;
  el.hidden = false;
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
  const codeEl = $("msCode");
  if (!codeEl) return;
  // 코드는 대문자·숫자만 쓴다 → 공백·하이픈을 지우고 대문자로 맞춘다(적어 둔 것을 그대로 넣어도 되게).
  const code = (codeEl.value || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  setFieldError("msCode", "msCodeErr", "");
  if (code.length < 8) {
    setFieldError("msCode", "msCodeErr", "확인 번호를 다시 확인해 주세요. (영문 대문자·숫자 10자리)");
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
  // ⛔ 「접수번호(선택)」로 결과를 걸러 내던 분기는 2026-08-19 삭제됐다.
  //    서버는 «조회코드»만 본다 — 접수번호는 2차 비밀번호가 아니었고, 이미 받아 온
  //    결과를 화면에서 한 번 더 걸러 주는 일에 지나지 않았다. 그런데 칸이 있다는
  //    사실만으로 「둘 다 맞아야 한다」고 읽혀, 없는 번호를 찾아 헤매게 만들었다.
  const matched = rows || [];
  if (!matched.length) {
    setFieldError("msCode", "msCodeErr", "찾은 신청이 없습니다. 확인 번호를 다시 확인해 주세요.");
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
  msPaintEntry();               // 이제 이 기기에도 코드가 있으므로 홈 진입점을 다시 판단
  // 찾았으면 «목록 화면»으로 데려간다 — 결과가 다른 화면에 생기므로 그냥 두면
  // 시민이 «어디서 봐야 하나»를 스스로 찾아야 한다(초점·맥락 유실 방지 KWCAG).
  openMyStatus();
  await msLoad(true);
  msAnnounce(`신청 ${matched.length}건을 찾았습니다. 목록에 추가했습니다.`);
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
  msAnnounce("지금은 확인 번호 되찾기를 이용할 수 없습니다. 적어 두신 확인 번호로 찾아 주세요.");
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
  if (ok) flashCopied($("msRecResult"));   // 📋 찰칵 — 되찾기 상자도 «같은» 신호를 쓴다
  if (msg) {
    msg.textContent = ok
      ? "확인 번호를 복사했습니다. 메모장이나 문자에 붙여넣어 보관해 주세요."
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
  msAnnounce(`확인 번호 ${codes.length}건을 찾았습니다. 목록에 추가했습니다. 번호는 아래 상자에 있으니 적어 두세요.`);
}

/* ══════════════════════════════════════════════════════════════════════
   🚧 BgInert — 모달이 열려 있는 동안 «뒤 본문»을 통째로 비활성으로 만든다 (2026-08-20)
   ────────────────────────────────────────────────────────────────────
   왜 필요한가 — Tab 가둠만으로는 부족하다. 화면낭독기의 «스와이프 탐색»(가상 커서)은
     Tab 순서를 따르지 않아서, 모달이 떠 있어도 뒤쪽 목록·버튼을 계속 읽어 준다.
     브라우저 기본 alert() 은 이것을 자동으로 막아 줬지만, 자체 모달은 직접 해야
     같은 수준이 된다(KWCAG 2.2 «초점 이동» 취지 — 지금 조작할 수 있는 것만 읽히게).
   무엇을 하나 — <body> 의 «형제 덩어리» 중 지금 «맨 위» 모달을 뺀 나머지에
     inert 와 aria-hidden="true" 를 «함께» 건다.
       · inert       = 초점·클릭·낭독을 모두 막는다(요즘 브라우저)
       · aria-hidden = inert 를 모르는 옛 브라우저에서도 «낭독»만은 막는다(병행 이유)
   ⚠ 낭독 전용 알림칸(role="status"/"alert"/"log"·aria-live)은 건드리지 않는다 —
     가려 버리면 「저장했습니다」 같은 안내가 영영 안 읽힌다.
   ⚠ 되돌릴 때는 반드시 «원래 값»으로 되돌린다. 원래 aria-hidden="true" 였던
     장식 요소(곶감 무대 등)의 값을 지워 버리면 그 뒤로 낭독기에 노출된다.
   ⚠ 모달이 겹치면 «맨 위» 것만 살아 있어야 한다 → 새 모달을 열 때·닫을 때마다
     apply(맨위요소) 를 다시 부르면 아래 모달도 배경으로 취급돼 자동으로 잠긴다.
   ⚠ 닫을 때는 «먼저 풀고 나서» 호출 버튼으로 초점을 돌려준다. 순서를 바꾸면
     아직 inert 안에 있는 버튼이라 focus() 가 먹지 않아 초점이 body 로 떨어진다.
   ══════════════════════════════════════════════════════════════════════ */
const BgInert = (function () {
  const marked = new Map();     // 요소 → 원래 aria-hidden 값(원래 없었으면 null)
  const SKIP_TAG = { SCRIPT: 1, LINK: 1, STYLE: 1, TEMPLATE: 1, META: 1, NOSCRIPT: 1 };

  // 낭독 전용 알림칸인가(= 가리면 안 되는 것)
  function isLive(el) {
    if (el.hasAttribute("aria-live")) return true;
    const r = (el.getAttribute("role") || "").toLowerCase();
    return r === "status" || r === "alert" || r === "log";
  }
  function mark(el) {
    if (marked.has(el)) return;                    // 이미 잠갔으면 원래 값을 덮어쓰지 않는다
    marked.set(el, el.hasAttribute("aria-hidden") ? el.getAttribute("aria-hidden") : null);
    el.setAttribute("aria-hidden", "true");
    el.setAttribute("inert", "");
  }
  function unmark(el) {
    if (!marked.has(el)) return;
    const prev = marked.get(el);
    marked.delete(el);
    if (prev === null) el.removeAttribute("aria-hidden");
    else el.setAttribute("aria-hidden", prev);
    el.removeAttribute("inert");
  }
  function clear() {                               // 잠갔던 것을 «전부» 원래대로
    Array.from(marked.keys()).forEach(unmark);     // ⚠ 순회 중 지우므로 키 목록을 먼저 복사한다
  }
  // top = 살아 있어야 할 «맨 위» 모달 요소.
  // ⚠ top 이 없으면(= 모달이 다 닫힘) «전부 푼다». 이 갈래를 빠뜨리면 아래 반복문이
  //   모든 형제를 배경으로 보고 도리어 화면 전체를 잠가 버린다(브라우저 확인에서 잡힌 결함).
  function apply(top) {
    const body = document.body;
    if (!body) return;
    if (!top) { clear(); return; }
    Array.prototype.forEach.call(body.children, function (el) {
      if (el === top || el.contains(top) || SKIP_TAG[el.tagName] || isLive(el)) { unmark(el); return; }
      mark(el);
    });
  }
  return { apply: apply, clear: clear };
})();

// ---------- 모달 접근성: 포커스 트랩 + Esc 닫기 + 호출 버튼으로 복귀 (KWCAG 2.2) ----------
// app.js·proposals.js 두 곳에서 공용으로 쓰도록 전역 노출(window.ModalA11y).
const ModalA11y = (function () {
  const FOCUSABLE = 'a[href], button:not([disabled]), textarea:not([disabled]),' +
    ' input:not([disabled]):not([type="hidden"]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';
  // 모달 id → {keyHandler, opener} 보관(중복 리스너 누적 방지·복귀 대상 기억)
  const active = {};

  // 지금 «맨 위» 모달을 기준으로 배경 비활성(inert)을 다시 건다.
  // 열기·닫기 두 곳에서만 부른다 — 스택(_modalStack)이 곧 «겹친 순서»다.
  function _syncBgInert() {
    const t = _modalStack.length ? _modalStack[_modalStack.length - 1] : null;
    BgInert.apply(t ? document.getElementById(t.id) : null);
  }

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
      // 모달이 겹쳐 열릴 수 있다(예: PIN 모달 위의 «확인» 알림창).
      // 그때 Esc 를 누르면 아래 모달까지 함께 닫히면 안 된다 → «맨 위» 것만 반응한다.
      // (Tab 가둠도 마찬가지 — 지금 보고 있는 모달 안에서만 돌아야 한다)
      const top = _modalStack.length ? _modalStack[_modalStack.length - 1] : null;
      if (top && top.id !== modalId) return;
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
    // 뒤로가기가 «모달만» 닫도록 스택에 얹는다. 다섯 모달의 열기 경로가 모두 이 함수를 지난다.
    _modalStack = _modalStack.filter((m) => m.id !== modalId);
    _modalStack.push({ id: modalId, close: close });
    _armBackTrap();
    // 🚧 배경 비활성 — 낭독기 스와이프 탐색이 뒤 본문으로 새지 않게(모달이 겹치면 맨 위만 살린다).
    //    첫 포커스 «전»에 건다: 호출 버튼이 배경에 있으므로 여기서 초점이 body 로 떨어지고,
    //    바로 아래에서 모달 안 첫 요소로 옮긴다.
    _syncBgInert();

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
    _modalStack = _modalStack.filter((m) => m.id !== modalId);
    const opener = teardown(modalId);
    // 🚧 배경 비활성 다시 계산 — 아래에 모달이 남아 있으면 그것만 살리고, 다 닫혔으면 전부 푼다.
    //    ⚠ 반드시 초점 복귀 «전». 뒤에 두면 아직 inert 안인 버튼이라 focus() 가 먹지 않는다.
    _syncBgInert();
    if (opener && typeof opener.focus === "function") {
      try { opener.focus(); } catch (e) {}
    }
    try { syncUpdateBanner(); } catch (e) { /* 무시 */ }
  }

  return { open, close };
})();
window.ModalA11y = ModalA11y;

/* ════════════════════════════════════════════════════════════════════════
   💬 공용 알림·확인 창 — appAlert() / appConfirm()   (2026-08-20 양호창님 지시)
   ------------------------------------------------------------------------
   왜 만드는가
     ① 브라우저의 alert()/confirm() 은 창 맨 윗줄에 「hcyang572-gif.github.io 내용:」
        이라는 «출처 표기»를 강제로 붙인다. 시민에게는 군더더기이고, JS 로 지울 수 없다.
        지우는 길은 «앱 자체 알림창»으로 바꾸는 것 하나뿐이다.
     ② 네이티브 창은 자바스크립트를 통째로 멈춘다. 그래서 알림이 떠 있는 동안
        「등록 중…」 같은 버튼 상태가 풀리지 않아 «멈춘 앱»으로 보였다(실제 제보).
   쓰는 법
     appAlert("한 줄 알림")                  → Promise<true> (닫히면 풀린다)
     await appConfirm("지울까요?")           → Promise<boolean>
     옵션: {title, okText, cancelText}
   ⛔ 앞으로 alert()/confirm() 을 새로 쓰지 말 것 — 한 곳만 남아도 거기서 출처 표기가 뜬다.
   ⚠ 접근성: 기존 모달과 «같은» ModalA11y 를 지난다 → 초점 이동·Tab 가둠·Esc·
      뒤로가기 한 번에 닫힘·호출 버튼으로 초점 복귀가 모두 그대로 붙는다.
      role 은 확인이 필요하면 alertdialog, 단순 알림이면 dialog 로 바꿔 준다.
   ⚠ 확인창에서는 «취소»가 먼저 초점을 받는다(ModalA11y 가 첫 요소로 옮긴다) —
      실수로 Enter 를 눌러도 지워지지 않게 하려는 것이다.
   ════════════════════════════════════════════════════════════════════════ */
let _askResolve = null;          // 열려 있는 창의 약속(닫힐 때 값을 돌려준다)

function _askFinish(result) {
  const m = $("askModal");
  if (!m || m.hidden) return;
  m.hidden = true;
  ModalA11y.close("askModal");
  const done = _askResolve;
  _askResolve = null;
  if (done) done(result);
}

function _askOpen(msg, opts) {
  opts = opts || {};
  const isConfirm = !!opts.confirm;
  return new Promise((resolve) => {
    const m = $("askModal");
    // 모달 마크업이 없는 환경(옛 캐시 등)에서는 조용히 예전 방식으로 돌아간다.
    // ⚠ 여기서 막아 버리면 «아무 안내도 없이» 실패하는 화면이 된다.
    if (!m) {
      if (isConfirm) { resolve(window.confirm(msg)); return; }
      window.alert(msg); resolve(true); return;
    }
    // 이미 떠 있으면 앞의 것을 «취소»로 끝낸다(약속이 영영 안 풀리는 일이 없게)
    if (_askResolve) { const prev = _askResolve; _askResolve = null; prev(false); }
    const card = $("askCard");
    if (card) card.setAttribute("role", isConfirm ? "alertdialog" : "dialog");
    $("askTitle").textContent = opts.title || (isConfirm ? "확인" : "알림");
    $("askMsg").textContent = String(msg == null ? "" : msg);
    const cancel = $("askCancel");
    cancel.hidden = !isConfirm;
    cancel.textContent = opts.cancelText || "취소";
    $("askOk").textContent = opts.okText || "확인";
    _askResolve = resolve;
    m.hidden = false;
    ModalA11y.open("askModal", () => _askFinish(false));
  });
}

function appAlert(msg, opts) { return _askOpen(msg, Object.assign({}, opts || {}, { confirm: false })); }
function appConfirm(msg, opts) { return _askOpen(msg, Object.assign({}, opts || {}, { confirm: true })); }
window.appAlert = appAlert;
window.appConfirm = appConfirm;

// 버튼 연결은 «한 번만» 한다(열 때마다 붙이면 리스너가 쌓여 여러 번 풀린다)
function bindAskModal() {
  const ok = $("askOk");
  const cancel = $("askCancel");
  if (ok) ok.addEventListener("click", () => _askFinish(true));
  if (cancel) cancel.addEventListener("click", () => _askFinish(false));
}

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
  bindAskModal();      // 💬 공용 알림·확인 창(appAlert/appConfirm)의 두 버튼
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
    if (e.key !== "Enter") return;
    // ⌨ 한글(IME) 조합 중의 Enter 는 «글자를 확정하는 키»다 — 검색을 실행하면 안 된다.
    //    예전에는 「청년」을 치고 Enter 로 마지막 글자를 확정하는 순간 그 Enter 가
    //    그대로 검색으로 새어 나가, 아직 조합이 끝나지 않은 말로 목록이 열렸다.
    //    isComposing 이 없는 구형 브라우저를 위해 keyCode 229(IME 처리 중)도 함께 본다.
    //    확정한 뒤 한 번 더 Enter 를 누르면 검색된다(모든 한글 웹앱의 표준 동작).
    if (e.isComposing || e.keyCode === 229) return;
    state.selectedCats = new Set();
    openList({ title: "검색 결과" });
    $("listSearch").value = e.target.value;
    renderList();
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
  // 고르는 즉시 안내문을 지운다(고쳤는데 빨간 글씨가 남지 않게)
  $("ageInput").addEventListener("input", () => setRecommendErr(""));
  $("situationList").addEventListener("change", () => setRecommendErr(""));
  // 📞 연락처 — 입력하는 동안 010-1234-5678 모양으로 자동으로 맞춘다(커서 유지).
  //    ⛔ 서버로는 여전히 «숫자만» 나간다(sendApply 참조).
  $("applyPhone").addEventListener("input", onPhoneInput);
  // 📎 파일 첨부 선택
  const applyFilesEl = $("applyFiles");
  if (applyFilesEl) applyFilesEl.addEventListener("change", onAttachPick);
  // 목록 정렬(기본순/최신순)
  const listSortEl = $("listSort");
  if (listSortEl) listSortEl.addEventListener("change", (e) => {
    // ⚠ 아는 값만 받는다(A-11·P-09 와 같은 사양) — 모르는 값이 오면 기본순으로.
    const v = e.target.value;
    listSort = (v === "new" || v === "team") ? v : "default";
    renderList();
  });
  // 제출은 form 의 submit 으로 받는다 — 버튼 클릭·Enter·휴대폰 자판 «완료» 모두 동작.
  // (버튼이 type="submit" 이라 click 리스너를 따로 달면 두 번 실행된다)
  _applySendBtnHtml = $("applySend").innerHTML;   // 아이콘까지 그대로 보관(복구용)
  $("applyForm").addEventListener("submit", (e) => {
    e.preventDefault();
    // async 함수라 예외가 «조용한 rejection» 이 된다 → 반드시 받아서 버튼을 되살린다.
    sendApply().catch(_applyRecover);
  });
  // 입력을 고치면 그 칸의 오류 표시를 즉시 지운다(고쳤는데 빨간 글씨가 남지 않게)
  $("applyName").addEventListener("input", () => setFieldError("applyName", "applyNameErr", ""));
  $("applyConsent").addEventListener("change", () => {
    if ($("applyConsent").checked) setFieldError("applyConsent", "applyConsentErr", "");
  });
  // (선택) 동의 — 체크하면 안내를 지우고, 칸을 비워도 안내를 지운다(둘 다 «해결»이므로).
  const applyOptEl = $("applyConsentOptional");
  if (applyOptEl) applyOptEl.addEventListener("change", () => {
    if (applyOptEl.checked) setFieldError("applyConsentOptional", "applyConsentOptErr", "");
  });
  $("applyMemo").addEventListener("input", () => {
    if (!$("applyMemo").value.trim()) setFieldError("applyConsentOptional", "applyConsentOptErr", "");
  });
  // 신청 폼 안에서 처리방침 열기 — 돌아오면 작성 중이던 내용이 남아 있어야 하므로
  // 화면 전환(showView)만 하고 폼은 초기화하지 않는다.
  $("applyPrivacyLink").addEventListener("click", openPrivacy);
  // 불편신고·정책제안 폼 안의 처리방침 링크도 «같은 화면»(#view-privacy)을 연다.
  // ⚠ 눌러도 아무 일이 없는 버튼은 없느니만 못하다 — 요소가 있을 때만 잇는다.
  const inqPrivacyEl = $("inquiryPrivacyLink");
  if (inqPrivacyEl) inqPrivacyEl.addEventListener("click", openPrivacy);
  const pwPrivacyEl = $("pwPrivacyLink");
  if (pwPrivacyEl) pwPrivacyEl.addEventListener("click", openPrivacy);
  const inqConsentEl = $("inquiryConsent");
  if (inqConsentEl) inqConsentEl.addEventListener("change", () => {
    if (inqConsentEl.checked) setFieldError("inquiryConsent", "inquiryConsentErr", "");
  });
  // 푸터의 「오류 문의」 링크는 헤더 「안내」 안으로 옮겨 갔다 — 남아 있으면 그대로 쓴다(옛 캐시 대비).
  const inqLink = $("inquiryLink");
  if (inqLink) inqLink.addEventListener("click", (e) => { e.preventDefault(); openInquiry(); });
  $("inquirySend").addEventListener("click", sendInquiry);
  // ── 헤더 「안내」 ─────────────────────────────────────────────────
  const helpBtnEl = $("helpBtn");
  if (helpBtnEl) helpBtnEl.addEventListener("click", openHelp);
  const helpCloseEl = $("helpClose");
  if (helpCloseEl) helpCloseEl.addEventListener("click", closeHelp);
  const helpModalEl = $("helpModal");
  if (helpModalEl) helpModalEl.addEventListener("click", (e) => {
    if (e.target.id === "helpModal") closeHelp();     // 바깥 누르기로 닫기
  });
  // 안내 › 홈 화면에 추가하는 법 — 모달 중첩을 막으려 「안내」를 먼저 닫는다.
  const helpInstallEl = $("helpInstall");
  if (helpInstallEl) helpInstallEl.addEventListener("click", () => { closeHelp(); openInstallGuide(); });
  // 안내 › 불편신고 — 화면(view-inquiry)으로 넘어가므로 모달을 닫고 간다.
  const helpInquiryEl = $("helpInquiry");
  if (helpInquiryEl) helpInquiryEl.addEventListener("click", () => { closeHelp(); openInquiry(); });
  // 개인정보 처리방침 (푸터 링크 → 전용 화면, '처음으로'로 복귀)
  $("privacyLink").addEventListener("click", openPrivacy);
  // 버전 라벨 + 버전별 개선사항(체인지로그) 모달
  initVersion();
  initFontSize();          // 🔠 글자 크게 보기 — 지난번 선택을 되살리고 버튼을 잇는다
  // 💾 임시 저장 — 「이어서 쓰기」·「지우기」
  const draftRestoreBtn = $("applyDraftRestore");
  if (draftRestoreBtn) draftRestoreBtn.addEventListener("click", restoreApplyDraft);
  const draftDiscardBtn = $("applyDraftDiscard");
  if (draftDiscardBtn) draftDiscardBtn.addEventListener("click", discardApplyDraft);
  // 쓰는 동안 «모아서» 보관한다(글자마다 저장하면 저사양 폰에서 버벅인다).
  // ⚠ 저장 대상은 이 세 칸뿐이다 — 동의 체크·첨부는 «듣지도 않는다»(saveApplyDraft 규약).
  const draftSaveDebounced = debounce(saveApplyDraft, 500);
  ["applyName", "applyPhone", "applyMemo"].forEach(function (id) {
    const el = $(id);
    if (el) el.addEventListener("input", draftSaveDebounced);
  });
  // 🏘 읍·면·동 — 고르면 오류 표시를 즉시 지우고, 선택도 임시 저장에 담는다.
  //    (select 는 input 이 아니라 change 로 듣는다)
  const regionEl = $("applyRegion");
  if (regionEl) regionEl.addEventListener("change", function () {
    if (regionEl.value) setFieldError("applyRegion", "applyRegionErr", "");
    saveApplyDraft();
  });
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
  const msClearBtn = $("msClear");
  // async 함수라 «조용한 rejection» 이 되지 않도록 반드시 받아 준다
  if (msClearBtn) msClearBtn.addEventListener("click", () => { msClearDevice().catch(() => {}); });
  /* ⏸ 자동 새로고침 멈추기/켜기 — 2026-08-25 복원(양호창님 지시).
     ⚠ 껐다가 다시 켜면 «10초를 기다리지 않고» 그 자리에서 한 번 따라잡는다 —
        켰는데 화면이 그대로면 시민은 「안 켜졌나?」 하고 다시 누른다.
     ⚠ 낭독기에는 msAnnounce(role=status·aria-live=polite)로 «무엇이 바뀌었는지» 알린다.
     ⛔ #msRefresh(지금 새로고침)는 되살리지 않는다 — 10초마다 저절로 갱신되므로 할 일이
        없고, 규격서 §0 「한 화면 버튼 3개 상한」에도 걸린다(⏸ · 이 기기에서 지우기 ·
        확인 번호로 찾기 로 이미 셋이다). */
  // 「신청한 사업 / 제안한 정책」 갈래
  const msTabA = $("msTabApply");
  if (msTabA) msTabA.addEventListener("click", () => msSetTab("apply"));
  const msTabP = $("msTabProposal");
  if (msTabP) msTabP.addEventListener("click", () => msSetTab("proposal"));
  // 「확인 번호로 내 신청 찾기」 — 별도 화면으로 이동
  const msCodeEntryBtn = $("msCodeEntry");
  if (msCodeEntryBtn) msCodeEntryBtn.addEventListener("click", openMsCode);
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
  // 신규 사업 알림 배너 — ★ N-08: «본 것» 기록은 여기서만 한다(페이지 로드가 아니라).
  $("newBannerView").addEventListener("click", () => {
    // 「보기」로 목록을 열면 «확인한 것»으로 친다(양호창님 「한번 확인하거나」).
    // ⚠ 목록을 여는 것보다 «먼저» 기록한다 — openList 안에서 무슨 일이 나도 기록은 남는다.
    markNewSeen(true);
    state.selectedCats = new Set();
    openList({ title: "새로 추가된 사업", onlyNames: newProgramNames });
  });
  // 닫으면 버튼이 사라지므로 초점을 본문으로 옮긴다(초점 유실 방지 — KWCAG 6.4.3)
  $("newBannerClose").addEventListener("click", () => {
    markNewSeen(true);            // ★ N-08: X 를 누른 «그때» 기록 → 다음부터 안 뜬다
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
  /* 📲 푸터 「앱 아이콘 설치」 — 공무원앱과 같은 PWA 설치 경로.
     띠(#a2hsTip)는 «한 번 닫으면 다시 안 뜨는» 안내라, 나중에 설치하려면 들어갈 문이 없었다.
     이 버튼은 항상 자리를 지키다가, 이미 설치해 실행 중(standalone)이면 스스로 사라진다.
     ⚠ 설치 실행 자체는 a2hs.js(#installNow) 가 맡는다 — 여기서 prompt() 를 또 부르지 말 것. */
  const installAppBtn = $("installAppBtn");
  if (installAppBtn) {
    const runningStandalone =
      (window.matchMedia && window.matchMedia("(display-mode: standalone)").matches) ||
      window.navigator.standalone === true;
    if (runningStandalone) installAppBtn.hidden = true;
    else {
      installAppBtn.addEventListener("click", openInstallGuide);
      // 설치가 끝나면 곧바로 감춘다(새로고침 전에도 «설치됨»이 반영되게)
      window.addEventListener("appinstalled", () => { installAppBtn.hidden = true; });
    }
  }
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

// ── 새 버전이 준비됐을 때의 «조용한 1회 갱신» 안전장치 ─────────────
// 아래 조건을 «모두» 만족할 때만 새로고침한다. 하나라도 어긋나면 알림 띠만 남긴다.
//   ① 이 탭에서 아직 한 번도 자동 갱신하지 않았다(무한 새로고침 방지)
//   ② 앱을 연 지 20초 안이다(오래 보고 있던 화면을 갑자기 바꾸지 않는다)
//   ③ 홈 화면이다(목록·상세·신청 화면을 보고 있으면 건드리지 않는다)
//   ④ 아직 아무 입력·누름이 없다(작성 중인 신청서를 날리지 않는다)
const _appOpenedAt = Date.now();
let _userTouched = false;
["pointerdown", "keydown", "input"].forEach((ev) => {
  window.addEventListener(ev, () => { _userTouched = true; }, { once: true, passive: true });
});
function reloadIfUntouched() {
  const KEY = "sangju_sw_autoreload";
  if (sessionStorage.getItem(KEY) === "1") return;      // ①
  if (Date.now() - _appOpenedAt > 20000) return;        // ②
  const home = document.getElementById("view-home");
  if (!home || home.hidden) return;                     // ③
  if (_userTouched) return;                             // ④
  sessionStorage.setItem(KEY, "1");
  console.log("[PWA] 첫 화면이라 새 버전으로 조용히 한 번 다시 엽니다.");
  location.reload();
}

// ── PWA 서비스워커 등록 (설치 가능화 + 오프라인 로딩) ─────────────
// 상대경로로 등록 → GitHub Pages 하위경로(/sangju-policy-mobile/)에서도 동작.
// 등록 실패해도 앱 기능에는 영향 없음.
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker
      // updateViaCache:"none" — sw.js 자체도 브라우저 HTTP 캐시(max-age=600)에서
      // 꺼내 쓰지 말고 «항상 서버에서» 확인하게 한다. 이게 없으면 새 서비스워커가
      // 최대 10분 늦게(카톡 인앱 브라우저는 더 오래) 감지된다.
      .register("sw.js", { updateViaCache: "none" })
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
              // 다만 «아직 아무것도 안 한 첫 화면»이라면 조용히 한 번만 다시 그린다.
              // 옛 서비스워커가 index.html 을 cache-first 로 내주던 탓에 새 판이
              // «두 번 열어야» 보이던 문제를 없앤다. 보던 화면·입력이 있으면 하지 않는다.
              try { reloadIfUntouched(); } catch (e) {}
            }
          });
        });
      })
      .catch((err) => {
        console.warn("[PWA] 서비스워커 등록 실패(앱은 정상 동작):", err);
      });
  });
}

/* ══ 🔠 글자 크게 보기 (2단계: 100% ↔ 125%) ═══════════════════════════
   왜 넣는가: 저시력·노안 이용자가 앱을 쓸 수 있는지를 가르는 가장 큰 한 가지다.
     브라우저 확대(핀치)로도 되지만, 어르신은 그 조작을 모르시거나 한 번 확대하면
     좌우로 밀려 원래대로 돌리지 못한다. 앱 안에 «버튼 하나»가 있어야 한다.
   어떻게: html 에 클래스 하나(fontsize-lg)를 붙여 :root 글자 크기를 125% 로 올린다.
     rem 으로 잡아 둔 글자·여백이 «한꺼번에» 따라 커진다.
     px 로 못 박은 골격(입력칸 48px·탭바 62px·아이콘 24px)은 일부러 그대로 둔다 —
     터치 대상까지 커지면 좁은 폰에서 화면 밖으로 밀린다(실측으로 확인).
   ⚠ 헤더가 높아지는 것은 syncTopbarH() 의 ResizeObserver 가 잡아
     .topline·.search-box.sticky 가 저절로 따라온다(2026-08-20 style.css ⓒ절).
   ⚠ 선택은 이 기기에 기억한다. 개인정보가 아니라 «보기 설정»이다(이름·연락처 아님).
   ⚠ localStorage 를 못 쓰는 환경(사파리 비공개 모드 등)에서도 «그 자리에서는» 동작한다 —
     기억만 안 될 뿐이다. 그래서 저장 실패로 기능을 막지 않는다.
   ⛔ 3단계 이상으로 늘리지 말 것 — 누를 때마다 «지금 몇 단계인지» 알기 어려워진다.
   ⛔ maximum-scale·user-scalable=no 를 넣어 브라우저 확대를 막는 식으로 대체하지 말 것
      (KWCAG 2.2 확대 허용 — index.html viewport 주석 참조). */
const FONTSIZE_KEY = "sangju_fontsize";
function applyFontSize(big) {
  try {
    document.documentElement.classList.toggle("fontsize-lg", !!big);
    const btn = $("fontSizeBtn");
    if (btn) {
      btn.setAttribute("aria-pressed", big ? "true" : "false");
      // 낭독기에는 «지금 무엇을 하는 버튼인지»를 알린다(색·굵기만으로 알리지 않는다)
      btn.setAttribute("aria-label", big ? "글자 크기 원래대로" : "글자 크게 보기");
    }
    // 글자가 커지면 헤더도 높아진다 → sticky 기준을 곧바로 다시 잰다.
    // (ResizeObserver 도 잡지만, 그리기 순서에 따라 한 프레임 늦을 수 있어 직접 부른다)
    try { syncTopbarH(); } catch (e) { /* 무시 */ }
    if (window.requestAnimationFrame) requestAnimationFrame(function () {
      try { syncTopbarH(); } catch (e) { /* 무시 */ }
    });
  } catch (e) { /* 무시 */ }
}
function initFontSize() {
  let big = false;
  try { big = localStorage.getItem(FONTSIZE_KEY) === "1"; } catch (e) { /* 저장소를 못 쓰는 환경 */ }
  applyFontSize(big);
  const btn = $("fontSizeBtn");
  if (!btn) return;
  btn.addEventListener("click", function () {
    const next = !document.documentElement.classList.contains("fontsize-lg");
    applyFontSize(next);
    try { localStorage.setItem(FONTSIZE_KEY, next ? "1" : "0"); } catch (e) { /* 기억만 못 할 뿐 */ }
    // 결과를 «글자로도» 알린다 — 화면이 커진 것을 못 보는 이용자도 알아야 한다(규격서 14절)
    try { _toast(next ? "글자를 크게 했습니다" : "글자를 원래대로 되돌렸습니다"); } catch (e) { /* 무시 */ }
  });
}

/* ══ 💾 신청서 임시 저장 ═══════════════════════════════════════════════
   왜 넣는가: 어르신은 입력이 느려 신청서를 쓰다 전화를 받거나 화면을 잘못 눌러
     빠져나가는 일이 잦다. 그때 쓰던 내용이 통째로 사라지면 «다시 처음부터»가 되고,
     대부분 그 자리에서 포기하신다.

   ⚠⚠ 이것은 «개인정보를 이 기기에 남기는» 기능이다. 아래 규약을 반드시 지킬 것.
   ┌── 무엇을 저장하는가 ────────────────────────────────────────────────
   │  · 신청자 이름 · 연락처(입력한 그대로, 하이픈 포함) · 문의사항
   │  · 읍·면·동 (2026-08-20 추가)
   │  · 어느 사업의 신청서였는지(사업명) · 저장 시각
   │
   │  ▸ 읍·면·동을 «넣기로» 한 이유 (2026-08-20 판단):
   │      ① 이미 이름·연락처를 저장하고 있다. 읍·면·동은 25개 구역 중 하나일 뿐이라
   │         그 둘보다 «덜» 특정적이다 — 더 민감한 것을 저장하면서 덜한 것만 빼면 앞뒤가 안 맞는다.
   │      ② 읍·면·동은 이제 «필수»다. 빼 두면 「이어서 쓰기」로 되살린 신청서가
   │         그 칸만 비어 있게 되고, 시민은 다 됐다고 여겨 보내다가 «마지막에» 막힌다.
   │         복구가 오히려 걸림돌이 된다.
   │      ③ 보관 조건은 이름·연락처와 «똑같다» — 24시간·제출 성공 시 즉시 삭제·
   │         「지우기」·「이 기기에서 지우기」. 새로 늘어나는 위험이 없다.
   ├── 무엇을 «저장하지 않는가» ─────────────────────────────────────────
   │  ⛔ 첨부파일 — 용량도 문제지만 증빙서류는 민감도가 가장 높다. 절대 담지 않는다.
   │  ⛔ 개인정보 수집·이용 «동의» 체크 — 동의는 신청할 때마다 새로 받아야 한다.
   │     («지난번에 동의했으니까»로 넘기면 그건 동의가 아니다. openApply 가 매번 끈다)
   │  ⛔ 확인 번호(조회코드) — 그건 별도 보관소(saveLookupEntry)의 몫이다.
   ├── 언제 지우는가 ────────────────────────────────────────────────────
   │  ① 제출에 «성공하면» 즉시 (showDone 직전 — 아래 sendApply 참조)
   │  ② 시민이 「지우기」를 누르면 즉시
   │  ③ 저장한 지 24시간이 지나면 자동으로 (읽을 때 검사해 버린다)
   │     — 24시간으로 정한 이유: 신청서를 쓰다 만 뒤 «다음 날»까지 이어 쓰는 일은
   │       거의 없고, 공용 기기(주민센터·도서관)에 하루를 넘겨 남기면 안 되기 때문이다.
   │  ④ 「내 신청 현황」의 「이 기기에서 지우기」를 누르면 함께 (msClearDevice)
   └─────────────────────────────────────────────────────────────────────
   ⚠ 다른 사업의 신청서를 열면 복구를 «권하지 않는다» — 사업명이 다르면 조용히 무시한다.
     (A 사업에 쓴 문의사항이 B 사업 신청서에 들어가면 잘못된 신청이 접수된다) */
const APPLY_DRAFT_KEY = "sangju_apply_draft";
const APPLY_DRAFT_TTL = 24 * 60 * 60 * 1000;   // 24시간

function saveApplyDraft() {
  try {
    // ⛔ 여기에 동의 체크·첨부파일을 «절대» 넣지 말 것(위 규약 참조).
    const name = $("applyName").value;
    const phone = $("applyPhone").value;
    const memo = $("applyMemo").value;
    const region = $("applyRegion") ? $("applyRegion").value : "";
    // 아무것도 안 썼으면 남기지 않는다(빈 껍데기를 기기에 남길 이유가 없다)
    if (!name.trim() && !phone.trim() && !memo.trim() && !region.trim()) { clearApplyDraft(); return; }
    const p = DATA.programs[currentIdx];
    localStorage.setItem(APPLY_DRAFT_KEY, JSON.stringify({
      benefit_name: (p && p.사업명) || "",
      name: name, phone: phone, memo: memo, region: region,
      at: Date.now(),
    }));
  } catch (e) { /* 저장소를 못 쓰는 환경 — 임시 저장만 안 될 뿐 신청은 그대로 된다 */ }
}

function loadApplyDraft() {
  try {
    const raw = localStorage.getItem(APPLY_DRAFT_KEY);
    if (!raw) return null;
    const d = JSON.parse(raw);
    if (!d || typeof d !== "object") { clearApplyDraft(); return null; }
    // ③ 24시간이 지난 것은 «읽는 김에» 버린다
    if (!d.at || (Date.now() - d.at) > APPLY_DRAFT_TTL) { clearApplyDraft(); return null; }
    return d;
  } catch (e) { clearApplyDraft(); return null; }
}

function clearApplyDraft() {
  try { localStorage.removeItem(APPLY_DRAFT_KEY); } catch (e) { /* 무시 */ }
}

function hideApplyDraftBanner() {
  const b = $("applyDraftBanner");
  if (b) b.hidden = true;
}

/* 신청 화면에 들어올 때 — 같은 사업의 «쓰다 만 내용»이 있으면 띠로 «알리기만» 한다.
   ⚠ 저절로 채우지 않는다. 공용 기기에서 앞사람 이름이 갑자기 칸에 들어차 있으면
     그것대로 놀라운 일이고, 못 보고 그대로 제출하면 남의 이름으로 신청된다. */
function paintApplyDraftBanner() {
  const b = $("applyDraftBanner"), t = $("applyDraftText");
  if (!b || !t) return;
  const d = loadApplyDraft();
  const p = DATA.programs[currentIdx];
  const same = d && p && d.benefit_name === p.사업명;
  if (!same) { b.hidden = true; return; }
  t.textContent = "이 사업에 쓰시던 내용이 남아 있습니다.";
  b.hidden = false;
}

function restoreApplyDraft() {
  const d = loadApplyDraft();
  const p = DATA.programs[currentIdx];
  if (!d || !p || d.benefit_name !== p.사업명) { hideApplyDraftBanner(); return; }
  $("applyName").value = d.name || "";
  $("applyPhone").value = d.phone || "";
  $("applyMemo").value = d.memo || "";
  // 🏘 읍·면·동 — 목록에 없는 값(옛 자료)이면 fillRegionSelect 가 임시 항목으로 살려 둔다
  fillRegionSelect($("applyRegion"), d.region || "");
  // ⛔ 동의 체크는 복구하지 않는다 — 동의는 매번 새로 받는다(위 규약 ②).
  hideApplyDraftBanner();
  clearApplyErrors();
  const el = $("applyName");
  if (el && el.focus) { try { el.focus(); } catch (e) { /* 무시 */ } }
  try { _toast("쓰시던 내용을 불러왔습니다"); } catch (e) { /* 무시 */ }
}

function discardApplyDraft() {
  clearApplyDraft();
  hideApplyDraftBanner();
  try { _toast("임시 저장한 내용을 지웠습니다"); } catch (e) { /* 무시 */ }
}

/* ── 헤더 높이를 재어 sticky 기준(--topbar-h)에 알려 준다 ────────────────
   왜 필요한가(2026-08-20 시연 전 전수 점검에서 실측):
     style.css 는 오랫동안 «헤더는 58px» 이라고 가정하고 .topline(top:58)·
     .search-box.sticky(top:61) 를 붙여 두었다. 그런데 .topbar-titles 는
     flex-wrap 이라 「시민 참여형」이 제목과 한 줄에 안 들어가면 윗줄로 접힌다.
     320~412px 폰에서는 «늘» 접혀 헤더가 71.4px 가 된다.
     → 목록을 내리면 「결과 안에서 찾기」 검색창의 위 10.4px 이 헤더 밑에 깔리고,
       브랜드 라인(.topline)은 통째로 헤더 뒤에 묻혔다.
   고치는 방법: 숫자를 고정하지 말고 «실제로 그려진 높이»를 재서 CSS 에 넘긴다.
     ⚠ getBoundingClientRect().height 에는 padding-top: env(safe-area-inset-top)
       이 이미 포함돼 있다 → CSS 에서 안전영역을 다시 더하지 말 것.
     ⚠ 인라인 <style> 이 아니라 CSSOM(setProperty)이라 CSP(style-src 'self')에 걸리지 않는다.
     ⚠ 실패해도 CSS 기본값(58px)이 남아 예전 동작 그대로다 — 새로 깨지지 않는다.
   언제 다시 재는가: 첫 그리기 · 창 크기/회전 변경 · 헤더 자체의 크기 변화
     (제목이 길어져 줄이 늘거나, 글자 크기를 키우거나, 안전영역이 바뀔 때). */
function syncTopbarH() {
  try {
    const bar = document.querySelector(".topbar");
    if (!bar) return;
    const h = Math.round(bar.getBoundingClientRect().height);
    if (h > 0) document.documentElement.style.setProperty("--topbar-h", h + "px");
  } catch (e) { /* 못 재면 CSS 기본값(58px)으로 둔다 */ }
}
(function initTopbarH() {
  const run = () => syncTopbarH();
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", run);
  else run();
  window.addEventListener("load", run);
  window.addEventListener("resize", run);
  window.addEventListener("orientationchange", run);
  // 헤더 안 글자가 바뀌어 줄 수가 달라질 때도 따라간다(showView 가 제목을 갈아 끼운다).
  try {
    const bar = document.querySelector(".topbar");
    if (bar && window.ResizeObserver) new ResizeObserver(run).observe(bar);
  } catch (e) { /* 지원하지 않는 브라우저 — 위 이벤트들만으로 충분하다 */ }
})();
