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
  /* ⭐ 2026-08-25 — 「이 기기에서 내가 쓴 글인가」 판정(상세 화면이 쓴다).
     ⚠ id 는 반드시 String 으로 견준다 — 서버는 숫자, localStorage 는 문자로 돌아오므로
        그냥 === 로 견주면 «내 글인데 못 알아보는» 사고가 난다.
        위 saveMine·forgetMine 이 String 비교를 쓰는 것과 같은 이유다.
     ⛔ 이것은 «무엇을 보여 줄까»의 판단일 뿐 권한 검사가 아니다.
        localStorage 는 이용자가 마음대로 고칠 수 있다. 수정·삭제의 진짜 관문은
        PIN(edit_proposal·delete_proposal)이고 서버가 지킨다 — 여기에 기대지 말 것. */
  function isMineProposal(id) {
    if (id == null) return false;
    const key = String(id);
    return loadMine().some((e) => String(e.id) === key);
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
  //   ★ 2026-08-24 C-07 — proposal_no(접수번호 표시)·comment_count(의견 수 배지)를 «더했다».
  const COLS_LIST = "id,title,category,status,like_count,created_at,proposal_no,comment_count";
  // 상세 — 본문·닉네임·지역·담당부서 답변까지. 수정 화면(PIN)도 이 값을 그대로 채운다.
  //   ★ 2026-08-24 C-07 — 템플릿 세 칸(body_problem·body_idea·body_effect)을 «더했다».
  //     ⚠ body 는 «그대로 둔다». 옛 글과, body 만 읽는 곳(내보내기·보고서)이 깨지지 않아야 한다.
  const COLS_DETAIL = "id,title,body,category,author_nick,region,status,admin_reply,like_count,created_at"
    + ",proposal_no,comment_count,body_problem,body_idea,body_effect";

  /* ════════════════════════════════════════════════════════════════════
     ⭐ C-07 예시 문안 — «이 파일의 이 표 하나»가 정본
     --------------------------------------------------------------------
     양호창님 지시 — 「기대효과와 그 밖의 것들도 예시를 넉넉히 보여서
     자연스럽고 쉽게 작성하도록 유도해줘.」

     ⛔ 한 벌(제목·1칸·2칸·3칸)이 «같은 사연의 앞뒤»여야 한다.
        칸마다 따로 굴리면 교통 문제 + 육아 제안 + 환경 효과가 섞여 오히려 헷갈린다.
        그래서 「다른 예시 보기」는 네 곳을 «한꺼번에» 바꾼다.
     ⛔ 문안 원칙 — 존댓말 · 공무원을 탓하지 않는 어조 · «구체적 숫자·지명».
        막연한 「불편합니다」가 아니라 「40분에 한 대」처럼 쓴다. 시민이 이 결을 따라 쓰면
        담당 부서가 «바로 검토할 수 있는 글»이 된다.
     ⚠ cats 는 «분야 이름 목록»이 아니라 «어느 분야를 고른 사람에게 먼저 보여 줄지»의 힌트다.
        이모지를 뗀 이름으로 적는다(app.js fgKeyOf 가 같은 방식으로 키를 만든다).
        ⛔ 이 값으로 분야 «목록»을 만들지 말 것 — 목록의 단일 출처는 config.POLICY_CATEGORIES
           → data.json → DATA.categories 다(fillCategorySelects 참조).
        ⚠ 분야가 바뀌어도(예: C-13) 여기는 «고치지 않아도 된다» — 맞는 벌이 없으면
           그냥 첫 벌부터 보여 준다. 예시는 «권하는» 장치일 뿐 검사·차단에 쓰지 않는다.
     ════════════════════════════════════════════════════════════════════ */
  const PW_EXAMPLES = [
    {
      cats: ["교통·안전"],
      title: "함창–시청 출근 시간대 직통버스 운행",
      problem: "함창읍에서 시내버스로 시청에 가려면 한 번에 가는 노선이 없어 두 번 갈아타야 합니다. 아침에는 40분에 한 대뿐이라 한 대를 놓치면 지각합니다.",
      idea: "출근 시간대(7~9시)만이라도 함창–시청 직통 버스를 하루 두 번 운행해 주시면 좋겠습니다.",
      effect: "통근·통학하는 주민의 이동 시간이 30분가량 줄고, 갈아탈 곳에서 오래 기다리는 불편이 없어집니다."
    },
    {
      cats: ["영유아·보육", "다자녀·가족"],
      title: "읍·면 지역 시간제 보육 자리 확대",
      problem: "아이를 키우다 갑자기 일이 생기면 맡길 곳이 없습니다. 어린이집은 오후에 끝나고, 시간제 보육은 자리가 늘 차 있습니다.",
      idea: "읍·면 지역에도 시간제 보육 자리를 늘리고, 당일 신청이 가능하도록 해 주시면 좋겠습니다.",
      effect: "갑작스러운 병원 진료나 경조사에도 아이를 안심하고 맡길 수 있어, 부모가 일을 그만두지 않아도 됩니다."
    },
    {
      cats: ["노인·어르신", "건강·의료"],
      title: "마을회관으로 찾아오는 진료 차량 운영",
      problem: "저희 마을에서 보건지소까지 걸어서 30분이 걸립니다. 어르신들이 무릎이 아파 진료를 미루다 병을 키우십니다.",
      idea: "한 달에 두 번이라도 마을회관으로 찾아오는 진료 차량을 운영해 주시면 좋겠습니다.",
      effect: "거동이 불편한 어르신도 정기적으로 혈압·혈당을 확인하실 수 있어, 큰 병으로 번지는 것을 미리 막을 수 있습니다."
    },
    {
      cats: ["환경·에너지"],
      title: "분리수거장 간이 지붕 설치",
      problem: "저희 단지 분리수거장에 지붕이 없어 비가 오면 종이류가 젖어 뒤엉킵니다. 수거해 가시는 분들도 고생이 많으십니다.",
      idea: "이용량이 많은 곳부터 간이 지붕을 설치해 주시면 좋겠습니다.",
      effect: "재활용되는 양이 늘고, 젖은 쓰레기가 썩으면서 나던 냄새와 벌레도 줄어듭니다."
    },
    {
      cats: ["청년", "문화·체육·관광"],
      title: "저녁 시간 청년 공유 공간 개방",
      problem: "저녁에 청년들이 모여 공부하거나 이야기 나눌 공간이 마땅치 않습니다. 카페는 일찍 닫고 도서관도 저녁에 문을 닫습니다.",
      idea: "시 유휴 공간이나 폐교를 저녁 시간대에 청년 공유 공간으로 열어 주시면 좋겠습니다.",
      effect: "청년들이 상주에 머물 이유가 하나 늘고, 스터디나 창업 모임이 자연스럽게 생겨납니다."
    }
  ];
  // 칸별 글자 상한 — ⚠ supabase/제안템플릿_260824.sql 의 검사와 «같은 값»이어야 한다.
  //    (서버가 정본이다. 여기 값은 «서버에 가기 전에 친절히 알려 주기» 위한 것뿐이다.)
  const PW_MAX = { title: 80, problem: 700, idea: 700, effect: 400 };

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

  /* ══════════════════════════════════════════════════════════════════════
     🏷 제안 세 칸의 «라벨» — 값의 단 하나뿐인 출처 (⭐ 2026-08-25 양호창님 확정)
     ────────────────────────────────────────────────────────────────────
     > 「시민앱의 제안상세 화면과 공무원앱의 정책제안 검토의 내용이 달라.
     >   «공무원앱을 기준으로» 3개 앱을 통일해줘」 (양호창님)
     ⇒ 값은 «공무원앱 그대로»다 — cloudui/app.js openProposal() 의 tpl 배열.
       (예전 시민앱 값: 「어떤 점이 불편하신가요?」·「어떻게 하면 좋을까요?」·
        「이렇게 되면 무엇이 좋아질까요?」 — 폐기)
     ⚠⚠ 입력 폼과 상세가 «같은 말»이어야 한다 — 시민이 「내가 쓴 그 칸이 이건가?」를
        다시 생각하지 않게. 그래서 상세만 바꾸지 않고 «입력 폼까지» 함께 바꿨다.
        아래 paintPartLabels() 가 index.html 의 라벨 세 개를 이 상수로 덮어쓴다.
        ⛔ index.html 의 라벨 글자를 여기와 «다르게» 고치지 말 것 — JS 가 이깁니다.
     ⛔ 저장 본문의 «머리표»([불편한 점]·[제안 내용]·[기대 효과])는 «다른 것»이며
        건드리지 않는다 — 서버(create_proposal_v2)가 옛 글 호환용 body 를 만들 때 쓰는
        값이고, 화면 라벨과 뜻이 같을 필요가 없다. 바꾸면 이미 저장된 글과 어긋난다.
        (supabase/제안템플릿_260824.sql 41~78행)
     ══════════════════════════════════════════════════════════════════════ */
  const PART_LABELS = {
    problem: "무엇이 문제인가요",
    idea:    "어떻게 하면 좋을까요",
    effect:  "무엇이 나아질까요",
  };
  /* 입력 폼(index.html)의 라벨 세 개를 위 상수로 맞춘다. 뒤에 붙은 «*»·«(없으면 비워 두세요)»
     같은 표식은 그대로 두고 «묻는 말»만 갈아 끼운다(첫 자식 텍스트 노드). */
  function paintPartLabels() {
    [["pwProblem", "problem"], ["pwIdea", "idea"], ["pwEffect", "effect"]].forEach(([id, key]) => {
      const lab = document.querySelector(`label[for="${id}"]`);
      if (!lab) return;
      const t = [...lab.childNodes].find((n) => n.nodeType === 3 && n.textContent.trim());
      if (t) t.textContent = PART_LABELS[key] + " ";
    });
  }

  /* 날짜 + 시각(YYYY-MM-DD HH:MM) — app.js 의 msFmtDateTime 을 그대로 쓴다.
     ⚠ 새로 만들지 않는다. 그 함수가 «내 신청 현황»에서도 쓰는 표기이고,
        공무원앱 cloudui/app.js 의 fmtDateTime 과도 «같은 꼴»이다(세 화면이 같아 보인다).
     ⚠ 스크립트 읽는 차례 때문에 없을 수도 있으니 날짜만이라도 나오게 떨어뜨린다. */
  function fmtDateTime(ts) {
    if (typeof window.msFmtDateTime === "function") return window.msFmtDateTime(ts);
    return fmtDate(ts);
  }

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

  /* ── ⭐ C-07 예시 보이기 ────────────────────────────────────────────────
     · 예시는 «지워지지 않는 글»이다(placeholder 가 아니다).
     · 「다른 예시 보기」는 제목·1칸·2칸·3칸을 «한꺼번에» 다음 벌로 넘긴다.
     · 고른 분야에 맞는 벌이 있으면 «그 벌부터» 보여 준다.
     · 바뀐 사실은 aria-live 영역(#pwExLive)이 낭독기 이용자에게 알린다. */
  let pwExIdx = 0;

  // 지금 고른 분야에 «맞는» 예시 벌의 번호. 없으면 -1.
  //   ⚠ 분야 이름 비교는 app.js fgKeyOf 와 «같은 방식»(앞머리 이모지를 떼고 본다).
  //     app.js 가 아직 안 실린 옛 캐시 환경을 대비해 같은 일을 하는 대체 구현을 둔다.
  function exKey(cat) {
    if (typeof window.fgKeyOf === "function") return window.fgKeyOf(cat);
    const t = String(cat == null ? "" : cat).trim();
    const m = t.match(/[가-힣A-Za-z0-9].*$/);
    return (m ? m[0] : t).trim();
  }
  function exIndexForCategory(cat) {
    const k = exKey(cat);
    if (!k) return -1;
    for (let i = 0; i < PW_EXAMPLES.length; i++) {
      if (PW_EXAMPLES[i].cats.indexOf(k) >= 0) return i;
    }
    return -1;
  }

  // 예시 한 벌을 화면에 얹는다. announce=true 면 낭독기에도 «바뀌었다»를 알린다.
  function paintExample(announce) {
    const ex = PW_EXAMPLES[pwExIdx % PW_EXAMPLES.length];
    if (!ex) return;
    const put = (id, v) => {
      const el = $(id);
      if (!el) return;
      const slot = el.querySelector(".pw-ex-v");
      if (slot) slot.textContent = v;
    };
    put("pwExTitle", ex.title);
    put("pwExProblem", ex.problem);
    put("pwExIdea", ex.idea);
    put("pwExEffect", ex.effect);
    if (announce && $("pwExLive")) {
      $("pwExLive").textContent =
        `예시가 바뀌었습니다. ${pwExIdx + 1}번째 예시 — ${ex.title}`;
    }
  }
  function nextExample() {
    pwExIdx = (pwExIdx + 1) % PW_EXAMPLES.length;
    paintExample(true);
  }
  // 분야를 고르면 그 분야에 맞는 예시로 갈아 끼운다(맞는 벌이 없으면 그대로 둔다).
  function syncExampleToCategory() {
    const sel = $("pwCategory");
    if (!sel) return;
    const i = exIndexForCategory(sel.value);
    if (i >= 0 && i !== pwExIdx) { pwExIdx = i; paintExample(true); }
  }

  /* 글자 수 세기 — 서버가 700/700/400 에서 «거절»하기 전에 화면에서 먼저 알린다.
     ⚠ aria-live 를 붙이지 않는다. 한 글자마다 낭독하면 글을 쓸 수가 없다.
        상한을 넘는 «사건»은 제출할 때 field 오류로 따로 알린다. */
  function paintCount(taId, outId, max) {
    const ta = $(taId), out = $(outId);
    if (!ta || !out) return;
    const n = String(ta.value || "").length;
    out.textContent = n;
    out.parentNode.classList.toggle("is-over", n > max);
  }
  function paintAllCounts() {
    paintCount("pwProblem", "pwProblemCount", PW_MAX.problem);
    paintCount("pwIdea", "pwIdeaCount", PW_MAX.idea);
    paintCount("pwEffect", "pwEffectCount", PW_MAX.effect);
  }

  /* 폼을 «템플릿(세 칸)» 또는 «옛 글(한 칸)» 모습으로 바꾼다.
     ⚠ 숨기는 쪽의 값을 지우지 않는다 — 되돌아왔을 때 쓰던 내용이 남아 있어야 한다.
        대신 제출·«작성 중» 판정은 지금 보이는 쪽만 본다(isLegacyMode 참조). */
  let legacyMode = false;      // true = 옛 글 수정 중(칸 하나)
  function setLegacyMode(on) {
    legacyMode = !!on;
    const tpl = ["pwProblem", "pwIdea", "pwEffect"];
    tpl.forEach((id) => {
      const ta = $(id);
      if (!ta) return;
      // label·예시·글자수까지 함께 감춰야 «빈 라벨만 남는» 화면이 되지 않는다
      const lab = document.querySelector(`label[for="${id}"]`);
      if (lab) lab.hidden = legacyMode;
      ta.hidden = legacyMode;
    });
    ["pwExProblem", "pwExIdea", "pwExEffect"].forEach((id) => {
      const el = $(id); if (el) el.hidden = legacyMode;
    });
    document.querySelectorAll("#view-pwrite .pw-count").forEach((el) => { el.hidden = legacyMode; });
    const bar = document.querySelector("#view-pwrite .pw-ex-bar");
    if (bar) bar.hidden = legacyMode;
    // 제목 예시는 옛 글 수정에서도 도움이 되므로 «남긴다»(제목 규칙은 그대로다).
    const wrap = $("pwLegacyWrap");
    if (wrap) wrap.hidden = !legacyMode;
  }
  // app.js 의 «작성 중» 판정이 지금 보이는 칸만 보게 한다(DIRTY_FIELDS 와 한 쌍).
  window.ppIsLegacyWrite = function () { return legacyMode; };

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
        <!-- ⚠ title 속성 — 제목은 «두 줄»에서 …로 잘린다(2026-08-25 카드 높이 통일).
             마우스를 올리면 온전한 제목이 뜬다. 낭독기에는 위 aria-label 이 이미 전문을 준다. -->
        <h3 title="${esc(p.title)}">${esc(p.title)}</h3>
        <div class="pp-card-meta">
          <span class="pp-like"><svg class="ic ic-in" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 21V10l4.5-7 1 .6a2 2 0 0 1 .9 2.2L12.5 9H19a2 2 0 0 1 2 2.4l-1.5 7A2.4 2.4 0 0 1 17 20.5H7z"/><path d="M7 10.5H4V21h3"/></svg> ${Number(p.like_count) || 0}</span>
          <span class="pp-cmt"><svg class="ic ic-in" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 14a3 3 0 0 1-3 3H8l-5 4V6a3 3 0 0 1 3-3h12a3 3 0 0 1 3 3z"/></svg> ${Number(p.comment_count) || 0}</span>
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

  /* ★ C-07 — 상세 본문 그리기.
     새 글(세 칸이 있는 글)은 «나눠» 보여 주고, 옛 글은 body 한 덩어리 그대로 보여 준다.
     ⛔ 옛 글을 억지로 쪼개지 않는다(사양서 6절 «옛 글 호환»).
     ⚠ 판정 기준은 body_problem 하나다 — 서버가 create_proposal_v2 에서만 채운다.
     ⚠ 라벨은 «작성 폼과 같은 말»이어야 한다. 화면마다 말이 달라지면
        시민이 「내가 쓴 그 칸이 이건가?」를 다시 생각해야 한다.
        → 그래서 위 PART_LABELS 한 곳에서 «입력 폼과 상세가 함께» 가져다 쓴다. */
  function proposalBodyHtml(p) {
    const q = (v) => String(v == null ? "" : v).trim();
    const problem = q(p.body_problem), idea = q(p.body_idea), effect = q(p.body_effect);
    if (!problem) return `<div class="pd-body">${esc(p.body)}</div>`;   // 옛 글
    const part = (k, v) => v
      ? `<section class="pd-part">
           <h3 class="pd-part-k">${esc(k)}</h3>
           <div class="pd-part-v">${esc(v)}</div>
         </section>`
      : "";
    return `<div class="pd-parts">
        ${part(PART_LABELS.problem, problem)}
        ${part(PART_LABELS.idea, idea)}
        ${part(PART_LABELS.effect, effect)}
      </div>`;
  }

  function renderDetail(p) {
    const b = STATUS_BADGE[p.status] || STATUS_BADGE["접수"];
    const bodyHtml = proposalBodyHtml(p);
    /* 접수번호 — «표시만» 한다.
       ⛔ 조회·본인확인의 열쇠로 쓰지 말 것(🩷자물쇠 규약). 본인확인은 PIN 이 한다.
          번호는 규칙적이라 남의 번호를 쉽게 짐작할 수 있다 — 열쇠가 되는 순간 남의 글을 만진다. */
    const pno = String(p.proposal_no || "").trim();
    const noHtml = pno
      ? `<p class="pd-no"><span class="pd-no-k">접수번호</span> <span class="pd-no-v">${esc(pno)}</span></p>`
      : "";
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
    /* ⭐ 2026-08-25 — 「본인 글 수정/삭제」를 «내 글»에만 큰 버튼으로 둔다.
       · 예전에는 모든 글에 큰 버튼이 붙어, 남이 쓴 글에서도 마치 내가 고칠 수 있는 것처럼 보였다.
       · 그렇다고 아주 감추면 «기기를 바꾸거나 브라우저 기록을 지운 진짜 본인»이 길을 잃는다.
         → 내 글 목록에 없는 글에서는 «작은 글씨 링크»로 남긴다.
           눌렀을 때 열리는 창은 똑같다(openPinModal) — 길은 그대로 살아 있고 무게만 줄인다.
       ⚠ 아래 이벤트 연결부는 갈래에 따라 id 가 달라지므로 반드시 «있는지 보고» 묶는다.
          없는 id 에 addEventListener 를 걸면 그 줄에서 멈춰 renderComments(p) 까지 안 돌아
          「의견이 통째로 사라지는」 회귀가 난다. */
    const mine = isMineProposal(p.id);
    const editHtml = mine
      ? `<button id="pdEditDel" type="button" class="big-btn full">본인 글 수정/삭제 (PIN)</button>`
      : "";
    const editLinkHtml = mine
      ? ""
      : `<button id="pdEditDelLink" type="button" class="cmt-act pd-mine-link">내가 쓴 글인가요? PIN으로 수정·삭제</button>`;
    $("pdetailContent").innerHTML = `
      <div class="pd-head">
        <span class="pp-badge ${b.cls}">${esc(b.label)}</span>
        ${p.category ? `<span class="pp-cat">${esc(p.category)}</span>` : ""}
      </div>
      <h2 class="pd-title">${esc(p.title)}</h2>
      <!-- ⭐ 2026-08-25 — 작성 시각을 «분»까지 보인다(공무원앱 검토 화면과 같은 표기).
           예전에는 날짜만 보여, 같은 날 올린 여러 제안의 앞뒤를 시민이 알 수 없었다.
           ⚠ 표기 함수는 app.js 의 msFmtDateTime «하나»를 쓴다(공무원앱 fmtDateTime 과 같은 꼴).
              ⛔ 여기에 날짜 만드는 코드를 새로 적지 말 것. -->
      <div class="pd-meta">닉네임 <b>${esc(p.author_nick || "익명")}</b>${p.region ? " · " + esc(p.region) : ""} · ${esc(fmtDateTime(p.created_at))}</div>
      ${noHtml}
      ${bodyHtml}

      <div class="pd-like-box">
        <div class="pd-like-count" aria-live="polite"><svg class="ic ic-in" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 21V10l4.5-7 1 .6a2 2 0 0 1 .9 2.2L12.5 9H19a2 2 0 0 1 2 2.4l-1.5 7A2.4 2.4 0 0 1 17 20.5H7z"/><path d="M7 10.5H4V21h3"/></svg> 공감 <b id="pdLikeCount">${Number(p.like_count) || 0}</b></div>
        <button id="pdLikeBtn" class="big-btn full ${liked ? "pp-liked" : "primary"}">${liked ? "공감함 (취소)" : "공감하기"}</button>
      </div>

      <div class="pd-section-title">진행 상황</div>
      <ul class="pd-timeline">${timeline}</ul>

      ${reply ? `<div class="pd-reply"><div class="pd-reply-title"><svg class="ic ic-in" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 14a3 3 0 0 1-3 3H8l-5 4V6a3 3 0 0 1 3-3h12a3 3 0 0 1 3 3z"/></svg> 담당부서 답변</div><div class="pd-reply-body">${esc(reply)}</div></div>` : ""}

      <div class="pd-actions">
        ${editHtml}
        <button id="pdReport" class="big-btn full pp-ghost" aria-label="이 제안 신고하기"><svg class="ic ic-in" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 21V4"/><path d="M6 5h11l-2 3.6 2 3.6H6"/></svg> 신고</button>
        ${editLinkHtml}
      </div>
      <div id="pdComments" class="cmt-wrap"></div>

      <p class="apply-note">※ 본 제안은 참고용 의견수렴이며 법적 효력이 없습니다.</p>
    `;
    $("pdLikeBtn").addEventListener("click", () => toggleLike(p));
    /* 큰 버튼(내 글)이든 작은 링크(그 밖의 글)든 «누르면 같은 창»이 열린다.
       ⛔ $("pdEditDel") 을 무조건 부르지 말 것 — 갈래에 따라 그 id 가 없어
          TypeError 로 아래 renderComments(p) 까지 통째로 멈춘다. */
    const editEl = $("pdEditDel") || $("pdEditDelLink");
    if (editEl) editEl.addEventListener("click", () => openPinModal(p));
    $("pdReport").addEventListener("click", () => openReportModal(p));
    // 💬 의견(댓글·답글) — 비동기로 채운다. 실패해도 상세 화면은 그대로 살아 있어야 한다.
    renderComments(p);
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
    // ★ C-07 — 새 제안은 «언제나» 템플릿(세 칸)이다. 옛 글 모드는 수정에서만 켜진다.
    setLegacyMode(false);
    paintPartLabels();          // 입력 폼 라벨을 PART_LABELS 한 곳에서 맞춘다
    ["pwProblem", "pwIdea", "pwEffect"].forEach((id) => { if ($(id)) $(id).value = ""; });
    paintAllCounts();
    // 고른 분야에 맞는 예시부터 보여 준다(맞는 벌이 없으면 첫 벌).
    const exi0 = exIndexForCategory($("pwCategory") ? $("pwCategory").value : "");
    pwExIdx = exi0 >= 0 ? exi0 : 0;
    paintExample(false);
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
    /* ★ C-07 — 내용은 «세 칸»이다.
       ⛔ 세 칸을 이어 붙인 body 를 여기서 만들지 말 것. 서버(compose_proposal_body)가 만든다.
          앱과 서버 두 곳에 이어붙이기 규약이 생기면 반드시 어긋난다(사양서 5절). */
    const problem = ($("pwProblem") ? $("pwProblem").value : "").trim();
    const idea = ($("pwIdea") ? $("pwIdea").value : "").trim();
    const effect = ($("pwEffect") ? $("pwEffect").value : "").trim();
    const nick = $("pwNick").value.trim();
    const region = $("pwRegion").value.trim();
    const pin = $("pwPin").value.trim();
    const cat = $("pwCategory").value;

    if (!title) { appAlert("제목을 입력해 주세요."); return; }
    if (title.length > PW_MAX.title) { appAlert("제목은 80자 이내로 적어주세요."); return; }
    if (!problem) { appAlert(`「${PART_LABELS.problem}」 칸을 적어 주세요.`); return; }
    if (problem.length > PW_MAX.problem) { appAlert(`「${PART_LABELS.problem}」 칸은 700자 이내로 적어주세요.`); return; }
    if (!idea) { appAlert(`「${PART_LABELS.idea}」 칸을 적어 주세요.`); return; }
    if (idea.length > PW_MAX.idea) { appAlert(`「${PART_LABELS.idea}」 칸은 700자 이내로 적어주세요.`); return; }
    /* ⛔ 「무엇이 나아질까요」(PART_LABELS.effect)가 비어 있는지 «묻지 않는다».
       사양서 2절 — 3번 칸은 선택이며, 비어 있어도 경고·재확인 없이 그대로 제출된다.
       권하되 막지 않는다. 강요하면 제안 자체를 포기한다. */
    if (effect.length > PW_MAX.effect) { appAlert(`「${PART_LABELS.effect}」 칸은 400자 이내로 적어주세요.`); return; }
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

    const combined = [title, problem, idea, effect, nick].join(" ");
    if (RE_JUMIN.test(combined)) { appAlert("주민등록번호로 보이는 숫자가 있습니다.\n개인정보는 입력할 수 없습니다."); return; }
    if (RE_PHONE.test(combined)) { appAlert("전화번호로 보이는 숫자가 있습니다.\n개인정보는 입력하지 말아주세요."); return; }

    const client = getClient();
    if (!client) { appAlert("제안 등록 기능을 사용할 수 없습니다.\n(DB 설정(SQL) 적용 후 가능합니다.)"); return; }

    const btn = $("pwSubmit");
    const orig = btn.textContent;
    btn.disabled = true; btn.textContent = "등록 중...";
    try {
      /* ★ C-07 — create_proposal_v2 (supabase/제안템플릿_260824.sql)
         인자 이름·차례는 «서버 정의 그대로»다. 하나라도 어긋나면 함수를 못 찾는다.
           create_proposal_v2(p_title, p_problem, p_idea, p_effect, p_category, p_nick, p_region, p_pin)
         ⚠ p_effect 는 빈 문자열을 그대로 보낸다 — 서버가 btrim 뒤 빈 절을 «통째로 뺀다».
         ⛔ p_body 를 보내지 말 것. body 는 서버가 compose_proposal_body 로 만든다. */
      const { data, error } = await client.rpc("create_proposal_v2", {
        p_title: title, p_problem: problem, p_idea: idea, p_effect: effect,
        p_category: cat, p_nick: nick, p_region: region || null, p_pin: pin,
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
    /* ★ C-07 «옛 글 호환» — 여기가 이 기능에서 가장 조심할 자리다.
       판정 기준은 단 하나: body_problem 이 비어 있으면 «옛 글»이다(사양서 6절).
         · 옛 글  → 지금까지 쓰던 칸 하나(pwBody) + 옛 RPC(edit_proposal)
         · 새 글  → 세 칸(pwProblem·pwIdea·pwEffect) + edit_proposal_v2
       ⛔ 옛 글을 억지로 세 칸으로 쪼개지 말 것 — 어디서 끊을지 알 수 없다.
          그리고 «없던 칸을 나눠 적는 숙제»를 옛 글 작성자에게 내는 셈이 된다. */
    const isLegacy = !String(pinTarget.body_problem || "").trim();
    setLegacyMode(isLegacy);
    if (isLegacy) {
      $("pwBody").value = pinTarget.body || "";
      ["pwProblem", "pwIdea", "pwEffect"].forEach((id) => { if ($(id)) $(id).value = ""; });
    } else {
      $("pwBody").value = "";
      if ($("pwProblem")) $("pwProblem").value = pinTarget.body_problem || "";
      if ($("pwIdea")) $("pwIdea").value = pinTarget.body_idea || "";
      if ($("pwEffect")) $("pwEffect").value = pinTarget.body_effect || "";
    }
    paintAllCounts();
    // 수정 화면에서도 예시는 그대로 보인다(고쳐 쓰실 때 길잡이가 된다).
    const exiE = exIndexForCategory(pinTarget.category || "");
    pwExIdx = exiE >= 0 ? exiE : 0;
    paintExample(false);
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
    const problem = ($("pwProblem") ? $("pwProblem").value : "").trim();
    const idea = ($("pwIdea") ? $("pwIdea").value : "").trim();
    const effect = ($("pwEffect") ? $("pwEffect").value : "").trim();
    const cat = $("pwCategory").value;
    if (!title) { appAlert("제목을 입력해 주세요."); return; }
    if (title.length > PW_MAX.title) { appAlert("제목은 80자 이내로 적어주세요."); return; }
    if (legacyMode) {
      // 옛 글 — 지금까지와 «똑같이» 검사한다(규칙을 바꾸면 고칠 수 없는 글이 생긴다).
      if (!body) { appAlert("내용을 입력해 주세요."); return; }
      if (body.length > 2000) { appAlert("내용은 2000자 이내로 적어주세요."); return; }
    } else {
      if (!problem) { appAlert(`「${PART_LABELS.problem}」 칸을 적어 주세요.`); return; }
      if (problem.length > PW_MAX.problem) { appAlert(`「${PART_LABELS.problem}」 칸은 700자 이내로 적어주세요.`); return; }
      if (!idea) { appAlert(`「${PART_LABELS.idea}」 칸을 적어 주세요.`); return; }
      if (idea.length > PW_MAX.idea) { appAlert(`「${PART_LABELS.idea}」 칸은 700자 이내로 적어주세요.`); return; }
      // ⛔ effect 는 비어도 묻지 않는다(작성과 같은 규칙).
      if (effect.length > PW_MAX.effect) { appAlert(`「${PART_LABELS.effect}」 칸은 400자 이내로 적어주세요.`); return; }
    }
    const combined = legacyMode ? (title + " " + body) : [title, problem, idea, effect].join(" ");
    if (RE_JUMIN.test(combined)) { appAlert("주민등록번호로 보이는 숫자가 있습니다."); return; }
    if (RE_PHONE.test(combined)) { appAlert("전화번호로 보이는 숫자가 있습니다."); return; }
    const client = getClient();
    if (!client) { appAlert("수정할 수 없습니다.\n(DB 설정 적용 후 가능)"); return; }

    const btn = $("pwSubmit");
    const orig = btn.textContent;
    btn.disabled = true; btn.textContent = "저장 중...";
    try {
      /* ★ C-07 — 옛 글은 «옛 RPC 그대로», 새 글은 _v2.
           edit_proposal   (p_id, p_pin, p_title, p_body, p_category)
           edit_proposal_v2(p_id, p_pin, p_title, p_problem, p_idea, p_effect, p_category)
         ⛔ 옛 글에 _v2 를 쓰지 말 것 — 세 칸이 빈 채로 저장되어 본문이 통째로 사라진다. */
      const { error } = legacyMode
        ? await client.rpc("edit_proposal", {
          p_id: editing.id, p_pin: editing.pin,
          p_title: title, p_body: body, p_category: cat,
        })
        : await client.rpc("edit_proposal_v2", {
          p_id: editing.id, p_pin: editing.pin,
          p_title: title, p_problem: problem, p_idea: idea, p_effect: effect, p_category: cat,
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
    // ★ C-07 — «옛 글 수정» 흔적을 반드시 지운다. 안 지우면 다음에 새 제안을 쓸 때
    //   칸 하나짜리 옛 화면이 그대로 뜬다(그 상태로 올리면 create_proposal_v2 가 빈 칸을 거절).
    setLegacyMode(false);
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
    // ★ C-07 — 새 칸 셋을 «반드시» 함께 비운다. 빠뜨리면 등록을 마치고 목록으로 갈 때
    //   app.js 의 _isDirtyView() 가 「작성 중인 내용이 사라집니다」를 띄운다.
    ["pwTitle", "pwBody", "pwProblem", "pwIdea", "pwEffect", "pwNick", "pwPin", "pwHoney"].forEach((id) => {
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
    paintAllCounts();
  }

  /* ══════════════════════════════════════════════════════════════════════
     💬 C-07 의견(댓글·답글)                                   2026-08-24
     ----------------------------------------------------------------------
     DB 규약 : supabase/제안댓글_260824.sql  (🩷자물쇠 확정 · 적용·검증 완료)
       표   : proposal_comments — 비밀 칸이 «하나도 없다» → select("*") 가 허용된다.
              ⚠ proposals · proposal_likes 와 다른 점이다. 그 둘은 칸 권한을 회수해서
                 select("*") 가 통째로 401 이 된다. 여기서 흉내 내 칸을 나열하면,
                 나중에 칸이 늘 때마다 앱이 «조용히» 낡은 목록으로 읽게 된다.
       PIN  : proposal_comment_pins — 아무 역할에도 권한이 없다(RPC 만 들여다본다).
       RPC  : add_proposal_comment(p_proposal_id, p_parent_id, p_body, p_nick, p_pin)
              edit_comment(p_id, p_pin, p_body) · delete_comment(p_id, p_pin)
              report_comment(p_id, p_reason, p_reporter)
     ----------------------------------------------------------------------
     화면 규칙
       · 답글은 «1단까지»(댓글 → 답글). 답글에는 답글 버튼을 두지 않는다
         (서버 트리거도 막지만, 누를 수 있는데 실패하는 버튼을 두지 않는다).
       · 공무원 답글은 is_official 로 «배지 + 다른 색». 색만으로 알리지 않도록
         「담당 부서」라는 글자를 함께 둔다(규격서 8절).
       · 지워진 의견은 자리만 남긴다 — 서버가 내용·닉네임을 «실제로 비워» 보낸다.
       · 익명이 남기므로 PIN 이 곧 열쇠다. 비워 두면 나중에 못 고치고 못 지운다 —
         그 사실을 «미리» 글로 알린다(나중에 알면 늦다).
     ══════════════════════════════════════════════════════════════════════ */
  const CMT_MAX = 500;                 // ⚠ 서버 검사와 같은 값(제안댓글_260824.sql)
  let cmtP = null;                     // 지금 상세에 떠 있는 제안
  let cmtRows = [];                    // 마지막으로 읽어 온 의견들

  function cmtCountOf(p) { return Number(p && p.comment_count) || 0; }

  async function renderComments(p) {
    cmtP = p;
    const host = $("pdComments");
    if (!host) return;
    const client = getClient();
    if (!client) { host.innerHTML = ""; return; }   // DB 미준비 — 조용히 접는다(기존 방어 원칙)
    host.innerHTML = `<div class="pd-section-title">의견</div>` +
      (window.skeletonHtml ? window.skeletonHtml(2) : `<p class="cmt-loading">불러오는 중입니다.</p>`);
    let rows = [];
    try {
      /* ✅ select("*") 를 «일부러» 쓴다 — 위 머리말 참조. 이 표에는 비밀 칸이 없고,
         칸을 나열하면 칸이 늘 때마다 세 앱이 함께 낡는다(🩷자물쇠 설계). */
      const { data, error } = await client
        .from("proposal_comments")
        .select("*")
        .eq("proposal_id", p.id)
        .order("created_at", { ascending: true });
      if (error) throw error;
      rows = data || [];
    } catch (e) {
      console.warn("[정책참여] 의견 조회 실패:", e);
      // 상세 화면 전체를 깨뜨리지 않는다 — 의견만 «못 불러왔다»고 알리고 쓰기는 열어 둔다.
      host.innerHTML = `<div class="pd-section-title">의견</div>
        <p class="cmt-err" role="status">지금은 의견을 불러오지 못했습니다. 인터넷 연결을 확인해 주세요.</p>`
        + cmtFormHtml(null);
      bindCmtForm(host.querySelector(".cmt-form"));
      return;
    }
    // 그 사이 다른 제안으로 갔으면 낡은 결과를 그리지 않는다(빠른 전환 방어)
    if (!cmtP || String(cmtP.id) !== String(p.id)) return;
    cmtRows = rows;
    paintComments(host, rows);
  }

  function paintComments(host, rows) {
    const tops = rows.filter((r) => !r.parent_id);
    const kids = {};
    rows.filter((r) => r.parent_id).forEach((r) => {
      (kids[String(r.parent_id)] = kids[String(r.parent_id)] || []).push(r);
    });
    const n = rows.length;
    const listHtml = tops.length
      ? `<ul class="cmt-list">` + tops.map((c) => {
        const replies = kids[String(c.id)] || [];
        return `<li class="cmt-item">
            ${cmtHtml(c, false)}
            ${replies.length ? `<ul class="cmt-replies">${replies.map((r) => `<li>${cmtHtml(r, true)}</li>`).join("")}</ul>` : ""}
            <div class="cmt-reply-slot" data-parent="${esc(c.id)}"></div>
          </li>`;
      }).join("") + `</ul>`
      : `<p class="cmt-empty">아직 남겨진 의견이 없습니다. 첫 의견을 남겨 주세요.</p>`;
    host.innerHTML =
      `<div class="pd-section-title">의견 <span class="cmt-n">${n}</span></div>
       ${listHtml}
       <div class="cmt-write-box">
         <h3 class="cmt-write-k">의견 남기기</h3>
         ${cmtFormHtml(null)}
       </div>`;
    host.querySelectorAll(".cmt-form").forEach(bindCmtForm);
    host.querySelectorAll("[data-cmt-act]").forEach((btn) => {
      btn.addEventListener("click", () => onCmtAction(btn.dataset.cmtAct, btn.dataset.cmtId));
    });
  }

  // 의견 한 개 — 지워진 것 / 공무원 답글 / 보통 의견 세 갈래
  function cmtHtml(c, isReply) {
    if (c.is_deleted) {
      return `<div class="cmt cmt-gone${isReply ? " is-reply" : ""}">
          <p class="cmt-body">삭제된 의견입니다.</p>
        </div>`;
    }
    const official = !!c.is_official;
    const dept = String(c.official_dept || "").trim();
    /* 공무원 답글임을 «배지 글자»로 알린다 — 색만으로 알리지 않는다(규격서 8절).
       ⛔ official_dept 에는 부서명만 온다(사람 이름·이메일은 서버가 넣지 않는다). */
    const badge = official
      ? `<span class="cmt-badge cmt-official-badge"><svg class="ic ic-in" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3.2 20 7v5.4c0 4.3-3.2 7.2-8 8.4-4.8-1.2-8-4.1-8-8.4V7z"/><path d="m8.8 12 2.2 2.2 4.2-4.4"/></svg> 담당 부서${dept ? " · " + esc(dept) : ""}</span>`
      : "";
    const acts = official
      // 공무원 답글은 시민이 고치거나 지울 수 없다(신고만 가능)
      ? `<button type="button" class="cmt-act" data-cmt-act="report" data-cmt-id="${esc(c.id)}">신고</button>`
      : `${isReply ? "" : `<button type="button" class="cmt-act" data-cmt-act="reply" data-cmt-id="${esc(c.id)}">답글</button>`}
         <button type="button" class="cmt-act" data-cmt-act="mine" data-cmt-id="${esc(c.id)}">수정·삭제</button>
         <button type="button" class="cmt-act" data-cmt-act="report" data-cmt-id="${esc(c.id)}">신고</button>`;
    return `<div class="cmt${official ? " is-official" : ""}${isReply ? " is-reply" : ""}" data-id="${esc(c.id)}">
        <div class="cmt-head">
          <span class="cmt-nick">${esc(c.author_nick || "익명")}</span>
          ${badge}
          <span class="cmt-date">${esc(fmtDate(c.created_at))}</span>
        </div>
        <p class="cmt-body">${esc(c.body)}</p>
        <div class="cmt-acts">${acts}</div>
        <div class="cmt-panel" data-panel="${esc(c.id)}"></div>
      </div>`;
  }

  /* 의견 쓰기 폼 — 댓글과 답글이 «같은 모양»을 쓴다(새 모양을 만들지 않는다, 규격서 0절).
     parentId 가 있으면 답글이다. */
  function cmtFormHtml(parentId) {
    const pid = parentId ? esc(parentId) : "";
    return `<form class="cmt-form" data-parent="${pid}">
        <div class="cmt-form-row">
          <label class="sr-only" for="cmtNick-${pid || "new"}">닉네임</label>
          <input id="cmtNick-${pid || "new"}" class="text-input cmt-in-nick" type="text" maxlength="20" placeholder="닉네임 (실명 금지)" autocomplete="off" />
          <label class="sr-only" for="cmtPin-${pid || "new"}">수정용 PIN 4자리</label>
          <input id="cmtPin-${pid || "new"}" class="text-input cmt-in-pin" type="tel" inputmode="numeric" maxlength="4" placeholder="PIN 4자리" autocomplete="off" />
        </div>
        <label class="sr-only" for="cmtBody-${pid || "new"}">의견 내용</label>
        <textarea id="cmtBody-${pid || "new"}" class="text-input cmt-in-body" rows="3" maxlength="${CMT_MAX}"
                  placeholder="${parentId ? "답글을 적어 주세요." : "이 제안에 대한 생각을 적어 주세요."}"></textarea>
        <p class="cmt-help">PIN 은 <b>내가 남긴 의견을 나중에 고치거나 지울 때만</b> 씁니다.
          비워 두시면 올린 뒤에는 고치거나 지우실 수 없습니다.<br>
          실명·전화번호 등 개인정보는 적지 말아 주세요.</p>
        <p class="field-err cmt-form-err" role="alert" hidden></p>
        <button type="submit" class="big-btn primary full cmt-send">${parentId ? "답글 남기기" : "의견 남기기"}</button>
      </form>`;
  }

  function bindCmtForm(form) {
    if (!form || form.dataset.bound) return;
    form.dataset.bound = "1";
    form.addEventListener("submit", (e) => { e.preventDefault(); sendComment(form); });
    const pin = form.querySelector(".cmt-in-pin");
    if (pin) pin.addEventListener("input", (ev) => { ev.target.value = ev.target.value.replace(/[^0-9]/g, ""); });
  }

  function cmtFormErr(form, msg) {
    const el = form.querySelector(".cmt-form-err");
    if (!el) { if (msg) appAlert(msg); return; }
    el.textContent = msg || "";
    el.hidden = !msg;
  }

  async function sendComment(form) {
    const nick = form.querySelector(".cmt-in-nick").value.trim();
    const pin = form.querySelector(".cmt-in-pin").value.trim();
    const body = form.querySelector(".cmt-in-body").value.trim();
    const parent = form.dataset.parent || null;
    if (!body) { cmtFormErr(form, "내용을 적어 주세요."); return; }
    if (body.length > CMT_MAX) { cmtFormErr(form, "의견은 " + CMT_MAX + "자 이내로 적어 주세요."); return; }
    if (!nick) { cmtFormErr(form, "닉네임을 적어 주세요. (실명은 적지 마세요)"); return; }
    // PIN 은 «선택»이지만, 적으실 거면 4자리여야 한다(서버도 같은 검사).
    if (pin && !/^\d{4}$/.test(pin)) { cmtFormErr(form, "PIN 은 숫자 4자리로 적어 주세요."); return; }
    const combined = nick + " " + body;
    if (RE_JUMIN.test(combined)) { cmtFormErr(form, "주민등록번호로 보이는 숫자가 있습니다. 개인정보는 적을 수 없습니다."); return; }
    if (RE_PHONE.test(combined)) { cmtFormErr(form, "전화번호로 보이는 숫자가 있습니다. 개인정보는 적지 말아 주세요."); return; }
    cmtFormErr(form, "");
    const client = getClient();
    if (!client) { cmtFormErr(form, "지금은 의견을 남길 수 없습니다."); return; }
    const btn = form.querySelector(".cmt-send");
    const orig = btn.textContent;
    btn.disabled = true; btn.textContent = "올리는 중...";
    try {
      const { error } = await client.rpc("add_proposal_comment", {
        p_proposal_id: cmtP.id,
        p_parent_id: parent || null,          // ⚠ null 이면 «댓글», 있으면 그 댓글의 답글
        p_body: body, p_nick: nick, p_pin: pin || "",
      });
      if (error) throw error;
      btn.disabled = false; btn.textContent = orig;
      // 서버가 comment_count 를 트리거로 올린다 → 다시 읽어 화면을 맞춘다.
      if (cmtP) cmtP.comment_count = cmtCountOf(cmtP) + 1;
      await renderComments(cmtP);
    } catch (e) {
      console.warn("[정책참여] 의견 등록 실패:", e);
      cmtFormErr(form, cmtRpcMsg(e, "의견 등록"));
    } finally {
      if (btn.disabled) { btn.disabled = false; btn.textContent = orig; }
    }
  }

  /* 서버가 raise exception 으로 준 «사람이 읽는 말»을 그대로 보여 준다.
     (도배 방지·글자 수·개인정보 차단 문구가 모두 서버에 한국어로 적혀 있다.
      앱에서 다시 지어내면 두 곳의 말이 어긋난다.) */
  function cmtRpcMsg(e, what) {
    if (errKind(e) === "conn") return actionErrMsg(e, what);
    const m = (e && (e.message || e.hint || e.details)) ? String(e.message || e.hint || e.details) : "";
    const clean = m.replace(/^ERROR:\s*/i, "").trim();
    return clean || (what + "에 실패했습니다. 잠시 후 다시 시도해 주세요.");
  }

  // 눌린 자리에서 «그 자리»에 패널을 편다(답글 / 수정·삭제 / 신고)
  function cmtSel(base, id) {
    // CSS.escape 가 없는 옛 브라우저를 위해 속성 선택자를 직접 만든다
    const v = String(id).replace(/["\\]/g, "\\$&");
    return document.querySelector(base + '="' + v + '"]');
  }

  function onCmtAction(act, id) {
    const row = cmtRows.find((r) => String(r.id) === String(id));
    if (!row) return;
    if (act === "report") { openReportModal({ id: row.id }, "comment"); return; }
    if (act === "reply") {
      const slot = cmtSel(".cmt-reply-slot[data-parent", id);
      if (!slot) return;
      if (slot.innerHTML) { slot.innerHTML = ""; return; }        // 한 번 더 누르면 접는다
      slot.innerHTML = cmtFormHtml(id);
      bindCmtForm(slot.querySelector(".cmt-form"));
      const ta = slot.querySelector(".cmt-in-body");
      if (ta) { try { ta.focus(); } catch (err) { /* 무시 */ } }
      return;
    }
    if (act === "mine") {
      const panel = cmtSel(".cmt-panel[data-panel", id);
      if (!panel) return;
      if (panel.innerHTML) { panel.innerHTML = ""; return; }
      /* 본인 확인은 «PIN» 이 한다 — 접수번호나 닉네임으로 확인하지 않는다.
         ⚠ 모달을 새로 만들지 않고 «그 의견 자리»에 편다. 어느 의견을 고치는지가
            화면에서 보이므로 엉뚱한 글을 지우는 사고가 줄어든다. */
      panel.innerHTML = `<div class="cmt-mine">
          <label class="sr-only">PIN 4자리</label>
          <input class="text-input cmt-mine-pin" type="tel" inputmode="numeric" maxlength="4" placeholder="PIN 4자리" autocomplete="off" />
          <textarea class="text-input cmt-mine-body" rows="3" maxlength="${CMT_MAX}"></textarea>
          <p class="field-err cmt-mine-err" role="alert" hidden></p>
          <div class="cmt-mine-acts">
            <button type="button" class="big-btn cmt-mine-save">수정 저장</button>
            <button type="button" class="big-btn pp-danger cmt-mine-del">삭제</button>
            <button type="button" class="big-btn cmt-mine-cancel">취소</button>
          </div>
        </div>`;
      const pinEl = panel.querySelector(".cmt-mine-pin");
      const bodyEl = panel.querySelector(".cmt-mine-body");
      bodyEl.value = row.body || "";
      pinEl.addEventListener("input", (ev) => { ev.target.value = ev.target.value.replace(/[^0-9]/g, ""); });
      panel.querySelector(".cmt-mine-cancel").addEventListener("click", () => { panel.innerHTML = ""; });
      panel.querySelector(".cmt-mine-save").addEventListener("click", () => editComment(row, panel));
      panel.querySelector(".cmt-mine-del").addEventListener("click", () => deleteComment(row, panel));
      try { pinEl.focus(); } catch (err) { /* 무시 */ }
    }
  }

  function minePanelErr(panel, msg) {
    const el = panel.querySelector(".cmt-mine-err");
    if (!el) return;
    el.textContent = msg || "";
    el.hidden = !msg;
  }

  async function editComment(row, panel) {
    const pin = panel.querySelector(".cmt-mine-pin").value.trim();
    const body = panel.querySelector(".cmt-mine-body").value.trim();
    if (!/^\d{4}$/.test(pin)) { minePanelErr(panel, "PIN 4자리를 넣어 주세요."); return; }
    if (!body) { minePanelErr(panel, "내용을 적어 주세요."); return; }
    if (body.length > CMT_MAX) { minePanelErr(panel, "의견은 " + CMT_MAX + "자 이내로 적어 주세요."); return; }
    minePanelErr(panel, "");
    const client = getClient();
    if (!client) { minePanelErr(panel, "지금은 고치실 수 없습니다."); return; }
    const btn = panel.querySelector(".cmt-mine-save");
    btn.disabled = true;
    try {
      const { error } = await client.rpc("edit_comment", { p_id: row.id, p_pin: pin, p_body: body });
      if (error) throw error;
      await renderComments(cmtP);
    } catch (e) {
      console.warn("[정책참여] 의견 수정 실패:", e);
      btn.disabled = false;
      minePanelErr(panel, cmtRpcMsg(e, "의견 수정"));
    }
  }

  async function deleteComment(row, panel) {
    const pin = panel.querySelector(".cmt-mine-pin").value.trim();
    if (!/^\d{4}$/.test(pin)) { minePanelErr(panel, "PIN 4자리를 넣어 주세요."); return; }
    // 되돌릴 수 없는 동작이므로 반드시 한 번 묻는다(규격서 12절).
    const ok = await appConfirm("이 의견을 지우시겠습니까?\n지운 뒤에는 되돌릴 수 없습니다.", { title: "의견 삭제" });
    if (!ok) return;
    minePanelErr(panel, "");
    const client = getClient();
    if (!client) { minePanelErr(panel, "지금은 지우실 수 없습니다."); return; }
    const btn = panel.querySelector(".cmt-mine-del");
    btn.disabled = true;
    try {
      const { error } = await client.rpc("delete_comment", { p_id: row.id, p_pin: pin });
      if (error) throw error;
      if (cmtP) cmtP.comment_count = Math.max(0, cmtCountOf(cmtP) - 1);
      await renderComments(cmtP);
    } catch (e) {
      console.warn("[정책참여] 의견 삭제 실패:", e);
      btn.disabled = false;
      minePanelErr(panel, cmtRpcMsg(e, "의견 삭제"));
    }
  }

  // ---------- 신고 ----------
  let reportTarget = null;
  /* ★ C-07 — 같은 신고 모달을 «제안»과 «의견» 두 곳이 함께 쓴다.
     새 모달을 만들지 않는다(규격서 0절 — 이 앱의 모달은 이렇게 생겼다는 감각을 지킨다).
     kind 는 "proposal"(기본) 또는 "comment". 부르는 RPC 만 갈린다.
     ⚠ 화면 부제를 바꿔 «무엇을 신고하는지» 눈으로 보이게 한다 — 두 버튼이 같은 창을
        띄우는데 무엇을 신고하는지 안 보이면 엉뚱한 것을 신고하게 된다. */
  let reportKind = "proposal";
  function openReportModal(p, kind) {
    reportTarget = p;
    reportKind = (kind === "comment") ? "comment" : "proposal";
    const sub = document.querySelector("#reportModal .install-sub");
    const ttl = $("reportModalTitle");
    if (ttl) ttl.textContent = (reportKind === "comment") ? "의견 신고" : "제안 신고";
    if (sub) sub.textContent = (reportKind === "comment")
      ? "이 «의견»의 부적절한 내용을 알려주세요"
      : "이 «제안»의 부적절한 내용을 알려주세요";
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
    /* ★ C-07 (2026-08-25) — 이중 제출 빗장. 위 sendComment 와 «같은 규약».
       느린 회선에서 응답이 늦으면 시민은 안 눌린 줄 알고 한 번 더 누른다. 그러면
       같은 신고가 두 건 쌓이고, 신고 5건이면 자동으로 숨겨지는 규칙 때문에 «혼자서»
       남의 글을 절반 가까이 지울 수 있게 된다(제안·의견 모두 해당).
       ⚠ 어떻게 끝나든 반드시 빗장을 푼다 — finally 를 지우면 실패했을 때 영영 못 누른다. */
    const btn = $("reportSend");
    if (btn && btn.disabled) return;          // 이미 보내는 중
    const origText = btn ? btn.textContent : "";
    if (btn) { btn.disabled = true; btn.textContent = "보내는 중..."; }
    try {
      /* 두 RPC 는 인자 이름·차례가 «같다» — report_proposal(p_id,p_reason,p_reporter) ·
         report_comment(p_id,p_reason,p_reporter). 이름만 갈아 끼운다.
         ⚠ 서로 다른 표를 보므로 «제안 신고»와 «의견 신고»는 따로 쌓인다(둘 다 5명 누적 시 자동 숨김). */
      const fn = (reportKind === "comment") ? "report_comment" : "report_proposal";
      const { error } = await client.rpc(fn, {
        p_id: reportTarget.id, p_reason: reason, p_reporter: voterKey(),
      });
      if (error) throw error;
      const wasComment = (reportKind === "comment");
      // 신고 모달을 «먼저» 닫고 알림을 띄운다(모달 두 겹이 겹쳐 보이지 않게)
      closeReportModal();
      appAlert("신고가 접수되었습니다. 검토 후 조치하겠습니다.", { title: "신고 접수" });
      // 의견 신고는 누적으로 «감춰질» 수 있으므로 목록을 다시 읽어 화면을 맞춘다.
      if (wasComment && cmtP) { try { renderComments(cmtP); } catch (err) { /* 무시 */ } }
    } catch (e) {
      console.warn("[정책참여] 신고 실패:", e);
      appAlert(actionErrMsg(e, "신고"));
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = origText; }
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

  /* ★ 2026-08-24 (🩵물결 지적) — «지금 무언가 쓰고 있는가».
     ────────────────────────────────────────────────────────────────────────
     상세 화면을 실시간으로 다시 그리면 #pdetailContent 의 innerHTML 이 통째로
     갈린다. 그 안에 의견 쓰기 폼이 «들어 있으므로», 쓰던 글과 커서가 함께 사라진다.
     ⛔⛔ 입력 유실은 실시간보다 «나쁘다». 시민이 세 줄 쓰다 날리면 다시 쓰지 않는다.
     → 아래 중 하나라도 참이면 다시 그리지 않고 «배너만» 올린다.
        ① 초점이 상세 화면 안의 입력칸에 있다 (한 글자도 안 썼어도 «쓰려는 중»이다)
        ② 의견 폼·수정 패널의 어느 칸에든 글자가 있다
        ③ 제안 작성·수정 폼(세 칸 포함)에 글자가 있다  ← _isDirtyView 가 판정
     ⚠ ①이 없으면 «빈 칸에 커서를 두고 생각 중»인 사람의 커서를 빼앗게 된다.
     ⚠ 배너는 그대로 쌓이므로 «놓치는 것»은 없다 — 다 쓰고 나면 눌러서 보면 된다. */
  function cmtTyping() {
    // ① 초점이 상세 화면 «안»의 입력칸에 있는가
    const a = document.activeElement;
    if (a && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName)) {
      const host = $("view-pdetail");
      if (host && !host.hidden && host.contains(a)) return true;
    }
    // ② 의견 폼·수정 패널에 «쓰다 만 글»이 있는가
    const sels = ".cmt-in-nick, .cmt-in-pin, .cmt-in-body, .cmt-mine-pin, .cmt-mine-body";
    const list = document.querySelectorAll(sels);
    for (let i = 0; i < list.length; i++) {
      if (String(list[i].value || "").trim() !== "") return true;
    }
    // ③ 제안 작성·수정 폼(app.js 가 «지금 보이는 칸»만 센다)
    try { if (window._isDirtyView && window._isDirtyView()) return true; } catch (e) { /* 무시 */ }
    return false;
  }

  function syncRtBanner() {
    const box = $("ppRtBanner");
    if (box) {
      const show = rtPending > 0 && !$("view-propose").hidden && !rtBusy();
      if (show) $("ppRtText").textContent = `새 제안·변경 ${rtPending}건이 있습니다`;
      box.hidden = !show;
    }
    /* ★ 2026-08-24 — 의견 실시간 구독을 «화면에 맞춰» 여닫는다.
       이 함수는 app.js 의 showView() 가 화면이 바뀔 때마다 window.Proposals.syncNotice 로
       부르는 «유일하게 믿을 수 있는 길목»이다. 상세에 들어오면 열리고, 어떤 경로로
       나가든 닫힌다. 멱등이라 여러 번 불려도 안전하다.
       ⚠ 배너가 없는 화면(box 가 null)에서도 «반드시» 여기까지 와야 하므로,
         위의 조기 return 을 if 로 감쌌다. 되돌리면 구독이 안 닫힌다. */
    try { syncCommentSub(); } catch (e) { /* 실시간이 실패해도 화면은 멀쩡해야 한다 */ }
  }

  function applyRtRefresh() {
    rtPending = 0;
    syncRtBanner();
    reload();
  }

  /* ★ 2026-08-24 (🩵물결 지적으로 메운 구멍) — 상세를 열어 둔 채로도 «남의 의견»이 보인다.
     ────────────────────────────────────────────────────────────────────────
     예전에는 이 핸들러가 배너만 올렸다. 그래서 시민 A 가 제안 상세를 열어 두고 있을 때
     시민 B 가 댓글을 달면 A 의 화면에는 «영영» 나타나지 않았다.
     「세 앱이 아무 조작 없이 맞물린다」는 이 프로젝트의 설계가 의견에서만 깨져 있었다.

     구독이 «둘»인 이유 — 표가 둘이고, 각자 말하는 것이 다르다.
       ① proposals   … 댓글이 «늘고 줄 때» (트리거가 comment_count 를 고쳐 UPDATE 가 난다)
                        + 제안 자체의 상태·공감·본문 변화. «목록»의 관심사다.
       ② proposal_comments … 댓글 «그 자체». 본문 수정(edit_comment)은 count 를 바꾸지
                        않으므로 ①에는 «아무 신호도 나지 않는다». 상세 화면의 관심사다.
     ★ 2026-08-24 정정 (🩷자물쇠 결정 · 🩵물결 검수) — 여기 예전에 「proposal_comments 전용
       구독을 만들지 말 것」이라 적혀 있었다. «틀렸다». 그때는 ②가 없어 공무원이 답글을
       고쳐도 시민 화면이 영영 그대로였다. supabase/제안댓글_260824.sql:340 참조 —
       고칠 곳은 «표(트리거)»가 아니라 «화면(구독)»이라는 것이 자물쇠의 결정이다.
       ⛔ 트리거의 「update of is_hidden, is_deleted」 한정을 넓혀서 풀려고 하지 말 것.
          (댓글 오타 하나에 proposals 가 통째로 방송되고, 공무원앱의 «최근 변경»이 흔들린다)

     ⚠ 두 구독이 «같은 타이머»(_rtQuietTimer)를 쓴다 — 새 댓글 하나는 ①②를 동시에
       깨우므로, 타이머가 따로면 화면을 «두 번» 다시 그린다. 반드시 하나로 묶어 둔다.
     ⚠ 1500ms 는 app.js 의 benefits 구독과 «같은 값»이다(한 번에 수십 행이 쏟아져도 한 번만). */
  const RT_QUIET_MS = 1500;
  let _rtQuietTimer = 0;

  /* 상세 화면을 «조용히» 다시 그리도록 예약한다 — ①②가 함께 쓰는 단 하나의 길목.
     ⛔ 여기를 우회해서 refreshDetailQuietly() 를 직접 부르지 말 것 —
        디바운스와 cmtTyping() 두 보호막이 «모두» 이 안에 있다. 빠뜨리면
        시민이 의견을 쓰는 도중에 화면이 갈려 쓰던 글이 날아간다. */
  function scheduleDetailRefresh() {
    // 상세를 보고 있지 않으면 여기까지 — 목록은 지금까지처럼 사용자가 누를 때만 갱신한다.
    if ($("view-pdetail").hidden) return;
    if (_rtQuietTimer) clearTimeout(_rtQuietTimer);
    _rtQuietTimer = setTimeout(() => {
      _rtQuietTimer = 0;
      // ⚠ «타이머가 끝나는 그 순간»에 다시 판정한다. 1.5초 사이에 시민이 타자를 시작했을 수 있다.
      if ($("view-pdetail").hidden || cmtTyping()) return;   // 배너는 이미 올라가 있다
      refreshDetailQuietly();
    }, RT_QUIET_MS);
  }

  function onProposalsChanged() {
    rtPending += 1;              // 배너 카운트는 «언제나» 쌓는다(놓치는 것이 없게)
    syncRtBanner();
    scheduleDetailRefresh();
  }

  /* ② proposal_comments 핸들러.
     ⛔ rtPending 을 «올리지 않는다». 새 댓글은 ①이 이미 세고 있어 두 번 세면 「2건」이 된다.
        본문 수정은 애초에 «목록»에서 갱신할 거리가 없다(댓글 수가 그대로다).
        → 이 구독은 «지금 보고 있는 상세»를 다시 그리는 일에만 쓴다. */
  function onCommentsChanged() {
    scheduleDetailRefresh();
  }

  /* ══════════════════════════════════════════════════════════════════════════
     🔌 실시간 «끊김 대비» — app.js 의 규약을 그대로 옮겨 왔다   (2026-08-25)
     ──────────────────────────────────────────────────────────────────────────
     무엇이 문제였나 — 예전 subscribeRealtime 은 이랬다:

         if (!client || realtimeSub) return;
         realtimeSub = client.channel("proposals-citizen")…​.subscribe();   // 콜백 없음

     ① 상태 콜백이 «없어서» 끊긴 것을 아무도 모른다.
     ② 그 `realtimeSub` 검사가 «죽은 채널»도 «있다»로 세어, 다시 붙는 길을 영영 막는다.
     ③ 폴백 폴링도 없어, 끊긴 동안에는 새 제안·새 의견이 «하나도» 안 온다.
     결과: 시연장 와이파이가 한 번 흔들리면 그 뒤로 정책참여 실시간이 «영영» 죽는다.
     화면은 멀쩡해 보이므로 아무도 눈치채지 못한다 — 가장 나쁜 종류의 고장이다.

     어떻게 고쳤나 — 새로 설계하지 않았다. app.js 가 사업정보 구독에서 이미 쓰고 있는
     네 가지를 «그대로» 옮겼다(_rtSetOk / _rtStartPoll / _rtScheduleRejoin / _rtWakeUp).
       ① 상태 콜백으로 살았는지 죽었는지 «안다»
       ② 죽으면 2·4·8·15·30초(±30% 지터)로 다시 붙는다
       ③ 붙기 전까지는 «보고 있는 동안만» 20초마다 직접 조회해 메운다
       ④ 화면이 다시 보이거나 인터넷이 돌아오면 기다리지 않고 즉시 다시 붙는다
     ⛔ 여기에 «다른» 재연결 방식을 새로 만들지 말 것 — 두 규약이 생기면 서로 싸운다.
     ⛔ removeAllChannels()·realtime.disconnect() 는 여전히 금지(이 파일 머리말) —
        사업정보 구독까지 함께 끊긴다. 자기 채널만 removeChannel 한다.
     ⚠ 제안 구독과 의견 구독은 «한 소켓» 위에 있다. 그래서 폴백·재접속 예약은 하나로
        묶어 굴리고, «무엇을 다시 열지»만 각자 판단한다(_ppRtOk / _cmtOk).
     ══════════════════════════════════════════════════════════════════════════ */
  const PP_RT_POLL_MS = 20000;                            // app.js RT_POLL_MS 와 같은 값
  const PP_RT_BACKOFF = [2000, 4000, 8000, 15000, 30000]; // app.js RT_BACKOFF 와 같은 값
  let _ppRtOk = false;          // 제안 구독이 살아 있는가
  let _ppConnecting = false;    // 지금 붙는 중인가(첫 SUBSCRIBED 를 기다리는 동안)
  let _ppEverOk = false;        // 한 번이라도 붙은 적이 있는가(첫 연결과 재연결 구분)
  let _ppRtTry = 0;             // 연속 실패 횟수(백오프 단계)
  let _ppRtTag = null;          // 지금 «유효한» 채널의 신분증(늦게 온 옛 상태 무시용)
  let _ppRejoinTimer = null, _ppPollTimer = null;
  let _ppSig = null;            // 마지막으로 확인한 목록 서명(폴백이 변화를 알아채는 수단)
  let _cmtOk = true;            // 의견 구독이 «원하는 대로»인가(닫혀 있어야 해서 닫힌 것도 true)
  let _cmtTag = null;
  let _ppWakeBound = false;

  function _ppJitter(ms) {
    // app.js 의 _jitter 를 함께 쓴다. 옛 캐시로 app.js 가 낡았을 때만 여기 폴백이 쓰인다.
    if (typeof window._jitter === "function") return window._jitter(ms);
    return Math.round(ms * (0.7 + Math.random() * 0.6));
  }

  /* 목록의 «지금 상태» 서명 — 실시간이 죽었을 때 변화를 알아채는 유일한 수단.
     ⚠ 첫 쪽(최신 20건)만 본다. 시민이 실제로 보는 것이 그것이고, 전체를 훑으면
        폴백 한 번이 목록 조회만큼 무거워진다.
     ⚠ 첫 호출은 «기준»만 잡고 false 를 준다(들어오자마자 헛배너가 뜨지 않게). */
  async function _ppSigChanged() {
    const client = getClient();
    if (!client) return false;
    try {
      const { data, error } = await client.from("proposals")
        .select("id,status,like_count,comment_count")
        .eq("is_hidden", false)
        .order("created_at", { ascending: false })
        .limit(PAGE);
      if (error) throw error;
      const sig = (data || []).map((r) =>
        [r.id, r.status, r.like_count, r.comment_count].join(":")).join("|");
      if (_ppSig === null) { _ppSig = sig; return false; }
      if (sig === _ppSig) return false;
      _ppSig = sig;
      return true;
    } catch (e) {
      return false;                 // 폴백이 실패해도 화면은 멀쩡해야 한다(조용히)
    }
  }

  /* 의견의 서명 — 기준은 «마지막으로 그려 놓은» cmtRows 다(따로 보관할 상태가 없다).
     ⚠ body 는 길이만 센다. 폴백은 «달라졌는가»만 알면 되고, 본문 전체를 비교하면
        긴 의견이 많은 제안에서 쓸데없이 무겁다.
     ⚠ 본문 «수정»은 comment_count 를 바꾸지 않으므로 위 목록 서명에는 안 잡힌다 —
        그래서 이 서명이 따로 필요하다(구독 ②가 하던 일을 폴백에서 대신한다). */
  function _cmtSigOf(rows) {
    return (rows || []).map((r) => [r.id,
      String(r.body == null ? "" : r.body).length,
      r.is_hidden ? 1 : 0, r.is_deleted ? 1 : 0].join(":")).join("|");
  }
  async function _ppCommentsChanged() {
    const client = getClient();
    if (!client || !cmtP) return false;
    try {
      const { data, error } = await client.from("proposal_comments").select("*")
        .eq("proposal_id", cmtP.id).order("created_at", { ascending: true });
      if (error) throw error;
      return _cmtSigOf(data || []) !== _cmtSigOf(cmtRows);
    } catch (e) {
      return false;
    }
  }

  // 정책참여를 «지금 보고 있는가» — 폴백은 보고 있을 때만 돈다(배터리·데이터 아끼기).
  function _ppWatching() {
    if (document.hidden) return false;
    return !$("view-propose").hidden || !$("view-pdetail").hidden;
  }

  /* 폴백 폴링 — 실시간이 죽어 있는 «동안만» 돈다.
     ⚠ setInterval 이 아니라 «스스로 다시 예약하는 setTimeout» 이다(app.js 와 같은 이유) —
        고정 간격이면 같은 자리의 시민 30명이 영원히 나란히 조회한다. */
  function _ppStartPoll() {
    if (_ppPollTimer !== null) return;
    const tick = async () => {
      _ppPollTimer = null;
      if (_ppRtOk && _cmtOk) return;        // 실시간이 살아났다 → 폴백은 여기서 끝
      if (_ppWatching()) {
        try {
          if (await _ppSigChanged()) onProposalsChanged();
          else if (!$("view-pdetail").hidden && await _ppCommentsChanged()) scheduleDetailRefresh();
        } catch (e) { /* 조용히 — 폴백 실패가 화면을 깨뜨리지 않는다 */ }
      }
      _ppPollTimer = setTimeout(tick, _ppJitter(PP_RT_POLL_MS));
    };
    _ppPollTimer = setTimeout(tick, _ppJitter(PP_RT_POLL_MS));
  }
  function _ppStopPoll() {
    if (_ppPollTimer === null) return;
    clearTimeout(_ppPollTimer);
    _ppPollTimer = null;
  }

  // 다시 붙기 예약 — 제안·의견 중 «죽은 것만» 다시 연다.
  function _ppScheduleRejoin() {
    if (_ppRejoinTimer !== null) return;
    const wait = _ppJitter(PP_RT_BACKOFF[Math.min(_ppRtTry, PP_RT_BACKOFF.length - 1)]);
    _ppRtTry += 1;
    _ppRejoinTimer = setTimeout(() => {
      _ppRejoinTimer = null;
      if (!_ppRtOk) subscribeRealtime();
      if (!_cmtOk) { try { syncCommentSub(); } catch (e) { /* 무시 */ } }
      if (!_ppRtOk || !_cmtOk) _ppScheduleRejoin();   // 아직 못 붙었으면 다음 단계로
    }, wait);
  }

  // 구독이 죽었을 때 «항상 함께» 하는 두 가지(폴백 켜기 + 다시 붙기 예약).
  function _ppDegrade() { _ppStartPoll(); _ppScheduleRejoin(); }

  // 끊겨 있던 동안 놓친 것을 메운다(다시 붙은 «직후»에만 부른다).
  async function _ppCatchUp() {
    if (!_ppWatching()) return;
    try {
      if (await _ppSigChanged()) onProposalsChanged();
      if (!$("view-pdetail").hidden) scheduleDetailRefresh();   // 의견도 놓쳤을 수 있다
    } catch (e) { /* 무시 */ }
  }

  function _ppSetOk(ok) {
    const was = _ppRtOk;
    _ppRtOk = !!ok;
    _ppConnecting = false;
    if (_ppRtOk) {
      _ppRtTry = 0;
      if (_cmtOk) _ppStopPoll();
      // 끊겼다가 «다시» 붙은 경우에만 그 사이의 변경을 확인한다(첫 연결에서는 reload 가 방금 읽었다).
      if (!was && _ppEverOk) _ppCatchUp();
      _ppEverOk = true;
    } else {
      _ppDegrade();
    }
  }

  // 화면이 다시 보이거나 인터넷이 돌아오면 «기다리지 않고» 즉시 다시 붙는다.
  function _ppWakeUp() {
    if (_ppRtOk && _cmtOk) return;
    clearTimeout(_ppRejoinTimer); _ppRejoinTimer = null;
    _ppRtTry = 0;
    if (!_ppRtOk) subscribeRealtime();
    try { syncCommentSub(); } catch (e) { /* 무시 */ }
    _ppCatchUp();
  }
  /* ⚠ 이 리스너는 정책참여를 «한 번이라도 연 뒤»에만 걸린다(subscribeRealtime 에서 호출).
     정책참여를 안 쓰는 시민에게는 아무 일도 일어나지 않는다 — 기존 동작 그대로다. */
  function _ppBindWake() {
    if (_ppWakeBound) return;
    _ppWakeBound = true;
    document.addEventListener("visibilitychange", () => { if (!document.hidden) _ppWakeUp(); });
    window.addEventListener("online", _ppWakeUp);
    window.addEventListener("offline", () => _ppSetOk(false));
  }

  function subscribeRealtime() {
    const client = getClient();
    if (!client || !client.channel) return;
    /* ⛔ 예전의 `if (realtimeSub) return;` 이 바로 그 결함이었다 — «죽은 채널»도
       «있다»로 세어 재구독을 영영 막았다. 이제는 «살아 있거나 붙는 중»일 때만 건너뛴다.
       (open() 이 정책참여에 들어올 때마다 부르므로 이 멱등성 자체는 필요하다) */
    if (realtimeSub && (_ppRtOk || _ppConnecting)) return;
    _ppBindWake();
    try {
      // ★ 신분증을 «떼어 내기 전에» 갈아 끼운다(app.js initBenefitsRealtime 과 같은 이유) —
      //   옛 채널이 removeChannel 때 즉시 CLOSED 를 알려도 새 채널 상태를 뒤집지 못한다.
      const mine = {};
      _ppRtTag = mine;
      if (realtimeSub) {
        try { client.removeChannel(realtimeSub); } catch (e) { /* 무시 */ }
        realtimeSub = null;
      }
      _ppConnecting = true;
      realtimeSub = client
        .channel("proposals-citizen")
        .on("postgres_changes", { event: "*", schema: "public", table: "proposals" }, onProposalsChanged)
        .subscribe((status) => {
          if (_ppRtTag !== mine) return;        // 떼어 낸 옛 채널의 뒤늦은 보고는 무시
          // SUBSCRIBED 외(CHANNEL_ERROR·TIMED_OUT·CLOSED)는 «지금 안 온다»는 뜻이다.
          _ppSetOk(status === "SUBSCRIBED");
        });
    } catch (e) {
      console.warn("[정책참여] 실시간 구독 실패 — 폴백 조회로 동작합니다:", e);
      realtimeSub = null;
      _ppSetOk(false);
    }
  }

  /* ── ② 댓글 구독 — «상세 화면을 보는 동안에만» 열어 둔다 ──────────────────
     왜 상시가 아닌가: 목록에는 댓글 본문이 없다. 늘 열어 두면 시(市) 전체의 모든
     댓글이 모든 시민에게 방송되는 셈이라, 쓸모없는 연결과 통신만 남는다.
     ⚠ 여닫는 곳은 syncRtBanner() 한 곳뿐이다 — app.js 의 showView() 가 «화면이 바뀔
       때마다» 그것을 부르므로(app.js §showView 의 syncNotice 호출), 뒤로가기·스와이프·
       홈 버튼 등 «어떤 경로로 상세를 떠나든» 반드시 닫힌다. 나갈 길마다 따로 적으면
       언젠가 한 길을 빠뜨린다.
     ⚠ 서버쪽 filter 로 «이 제안의 댓글»만 받는다. 그래야 옆 제안 댓글에 깨지 않는다.
        └ 이 구독이 «못 받는» 경우가 둘 있다. 둘 다 ① proposals 구독이 대신 받으므로
          놓치는 것은 없다 — 그래서 filter 를 빼거나 RLS 를 풀 이유가 없다.
            · 완전 삭제(답글 없는 본인 삭제·공무원 삭제) — DELETE 의 old 에는 기본
              replica identity 상 id 밖에 없어 이 filter 에 걸리지 않는다.
            · 숨김 처리(is_hidden=true) — 정책 pcomments_read_public 이 「is_hidden=false」라
              바뀐 뒤의 행이 anon 의 RLS 를 통과하지 못해 방송되지 않는다.
          두 경우 모두 comment_count 가 바뀌어 트리거가 proposals 를 갱신한다 → ①이 받는다.
     ⛔ removeAllChannels() 를 쓰지 말 것(이 파일 머리말) — 사업정보 구독까지 끊긴다. */
  let cmtSub = null;
  let cmtSubPid = "";

  function syncCommentSub() {
    const wantPid = (!$("view-pdetail").hidden && currentP) ? String(currentP.id) : "";
    if (wantPid === cmtSubPid) return;      // 이미 맞다 — 아무것도 하지 않는다(멱등)
    const client = getClient();
    if (!client) return;
    // 열려 있던 것을 먼저 닫는다(상세를 떠났거나, 다른 제안 상세로 옮겨 갔거나)
    if (cmtSub) {
      try { client.removeChannel(cmtSub); } catch (e) { /* 무시 */ }
      cmtSub = null;
      cmtSubPid = "";
    }
    if (!wantPid) {
      // 닫혀 있어야 해서 닫힌 것 — 이것도 «원하는 대로»이므로 건강한 상태다.
      _cmtOk = true;
      if (_ppRtOk) _ppStopPoll();           // 제안 구독이 살아 있으면 폴백은 필요 없다
      return;
    }
    try {
      /* ★ 2026-08-25 — 여기에도 «상태 콜백»을 붙였다.
         예전에는 .subscribe() 를 인자 없이 불러, 이 채널이 죽어도 아무도 몰랐다.
         게다가 위의 `wantPid === cmtSubPid` 멱등 검사가 «죽은 채널»을 «열려 있다»로
         세어, 상세에 머무는 한 다시 열릴 길이 없었다(제안 구독과 똑같은 결함).
         → 죽으면 cmtSubPid 를 비워 «다음 호출이 다시 열 수 있게» 만들고,
           _ppDegrade() 로 폴백·재접속을 켠다(제안 구독과 한 몸으로 굴린다). */
      const mine = {};
      _cmtTag = mine;
      cmtSub = client
        .channel("pcomments-citizen-" + wantPid)
        .on("postgres_changes",
            { event: "*", schema: "public", table: "proposal_comments", filter: "proposal_id=eq." + wantPid },
            onCommentsChanged)
        .subscribe((status) => {
          if (_cmtTag !== mine) return;     // 떼어 낸 옛 채널의 뒤늦은 보고는 무시
          if (status === "SUBSCRIBED") {
            _cmtOk = true;
            if (_ppRtOk) _ppStopPoll();
            return;
          }
          _cmtOk = false;
          cmtSubPid = "";                   // ⚠ 이 한 줄이 «다시 열 수 있는 문»이다
          _ppDegrade();
        });
      cmtSubPid = wantPid;
      _cmtOk = true;                        // 붙는 중 — SUBSCRIBED 가 오면 그대로 유지된다
    } catch (e) {
      cmtSub = null; cmtSubPid = ""; _cmtOk = false;
      console.warn("[정책참여] 의견 실시간 구독 실패 — 폴백 조회로 동작합니다:", e);
      _ppDegrade();
    }
  }

  /* 상세를 «조용히» 다시 그린다 — 시민이 아무것도 누르지 않았는데 화면이 바뀌는 자리라
     지켜야 할 것이 셋 있다.
       ① 보던 자리(스크롤)를 유지한다. 의견이 하나 늘면 문서가 길어져 글이 밀린다.
       ② 초점을 빼앗지 않는다 → 부르기 «전»에 cmtTyping() 으로 걸러 두었다.
       ③ 제안 본문을 못 읽어 왔더라도 «의견만이라도» 맞춘다(이 기능의 목적이 의견이다).
     ⚠ renderDetail() 이 끝에서 renderComments() 를 부른다 — 여기서 또 부르면 두 번 읽는다.
        그래서 ③의 «못 읽었을 때»에만 따로 부른다. */
  async function refreshDetailQuietly() {
    const client = getClient();
    if (!client || !currentP) return;
    const keepY = window.scrollY || window.pageYOffset || 0;      // ①
    try {
      const { data, error } = await client.from("proposals").select(COLS_DETAIL).eq("id", currentP.id).single();
      if ($("view-pdetail").hidden) return;                        // 그 사이 화면을 떠났다
      if (!error && data) {
        currentP = data;
        renderDetail(data);            // ← 이 안에서 renderComments(data) 가 불린다
      } else {
        renderComments(currentP);      // ③ 본문은 못 읽었어도 의견은 맞춘다
      }
      // 다시 그린 뒤 보던 자리로 되돌린다(브라우저가 스크롤을 0 으로 깎는 것을 막는다)
      try { window.scrollTo(0, keepY); } catch (e) { /* 무시 */ }
    } catch (e) { /* 조용히 — 실시간 갱신이 실패해도 화면은 그대로 살아 있다 */ }
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
        <div class="ms-card-meta">올린 날 ${esc(fmtDate(p.created_at))} · 공감 ${Number(p.like_count) || 0} · 의견 ${Number(p.comment_count) || 0}${p.proposal_no ? " · 접수번호 " + esc(p.proposal_no) : ""}</div>
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
    /* ★ C-07 — 「다른 예시 보기」·글자 수 세기·분야 연동
       ⚠ 「다른 예시 보기」는 제목·1칸·2칸·3칸을 «한꺼번에» 다음 벌로 넘긴다(사양서 3.2-2).
          칸마다 따로 굴리면 교통 문제 + 육아 제안 + 환경 효과가 섞여 오히려 헷갈린다. */
    if ($("pwExNext")) $("pwExNext").addEventListener("click", nextExample);
    if ($("pwCategory")) $("pwCategory").addEventListener("change", syncExampleToCategory);
    [["pwProblem", "pwProblemCount", "problem"], ["pwIdea", "pwIdeaCount", "idea"],
     ["pwEffect", "pwEffectCount", "effect"]].forEach(([ta, out, key]) => {
      const el = $(ta);
      // ⚠ 한글(IME) 조합 중에도 input 은 계속 온다 — 그대로 세면 된다(막지 않는다).
      if (el) el.addEventListener("input", () => paintCount(ta, out, PW_MAX[key]));
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
