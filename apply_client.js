// ════════════════════════════════════════════════════════════════════════
//  신청 접수 공용 헬퍼 (SangjuApply) — 「앱 직접 접수(실시간)」 ②단계
//  규약 출처: _workspace/신청접수_클라이언트_규약.md  (🟢 data-engineer)
//  백엔드: supabase/applications.sql (테이블·RLS·Realtime, 양호창님이 대시보드 실행)
//
//  ⚠⚠ 이 사본은 «시민앱(모바일웹) 전용»입니다 — 다른 두 앱과 «일부러» 다릅니다.
//     예전에는 세 앱(cloudui·모바일웹·webui)에 byte-identical 로 두었지만,
//     2026-08-04 🟡 egov-compliance 지적으로 시민앱에서만 관리자용 함수
//     (listApplications·updateApplication·deleteApplication·subscribeApplications)를
//     «삭제»했습니다. 공개 웹앱에 개인정보 조회 경로를 두지 않기 위함입니다.
//     → cloudui/apply_client.js 와 내용이 다른 것이 «정상»입니다.
//       «동기화가 안 됐네» 하고 되돌리지 마세요(자세한 사유는 아래 ⛔ 주석).
//     공통 규칙(매칭키·접수번호·insert 페이로드·상태값)을 바꿀 때는 여전히
//     규약문서 + SQL 주석 + 세 앱을 «동시에» 갱신하고 검수 담당에게 알린다.
//
//  노출: window.SangjuApply = {
//    useClient, benefitKey, genReceiptNo, genLookupCode, submitApplication,
//    checkStatus, checkStatusMany, recoverLookupCodes,
//    isMissingFunction, isRateLimited, errKind, TABLE, STATUSES
//  }   ← 시민앱이 실제로 쓰는 것만. 조회·수정·삭제·구독은 노출하지 않는다.
//
//  ⭐ checkStatus 는 «테이블 조회»가 아니다 (2026-08-18)
//     아래 ⛔ 금지목록(listApplications 등)과 헷갈리지 말 것. checkStatus 는
//     applications 테이블을 읽지 않고, 서버 함수 check_application_status(코드) 를
//     호출한다(supabase/application_status.sql). 그 함수는
//       · 조회코드를 «정확히 아는» 행만 찾고(8자 미만이면 무조건 빈 결과),
//       · 접수번호·사업명·상태·시민안내문·일시만 돌려준다 — 이름·연락처는 «없다».
//     즉 개인정보 테이블의 문은 계속 잠겨 있고(익명 SELECT 금지), 시민 본인이
//     자기 코드로 «상태 몇 줄»만 확인하는 통로다. 절대 여기에 컬럼을 더 넣지 말 것.
//
//  방어 원칙: applications.sql 이 아직 실행 안 됐으면(테이블 없음·PGRST205)
//    · submitApplication 실패는 throw → 시민앱이 안내(메일 전송과 «독립»)
//  → 어떤 경우에도 앱의 다른 기능(사업목록·정책제안·메일신청)은 멀쩡해야 한다.
//
//  ⚠ 상태값은 «접수 / 심사중 / 승인 / 반려» 4값(PC config.APPLICATION_STATUSES 와 동일).
// ════════════════════════════════════════════════════════════════════════
window.SangjuApply = (function () {
  "use strict";

  var TABLE = "applications";
  // PC config.APPLICATION_STATUSES 와 «반드시» 동일한 4값. SQL CHECK 제약과도 일치.
  var STATUSES = ["접수", "심사중", "승인", "반려"];

  // ── Supabase 클라이언트 (지연 초기화) ──────────────────────────────
  // 앱이 이미 만든 클라이언트를 useClient(sb) 로 넘기면 그걸 쓰고,
  // 아니면 window / 전역 const 의 URL·anon key 로 직접 만든다(forms.js 와 동일 패턴).
  var _sb = null;
  function useClient(c) { if (c) _sb = c; }
  function client() {
    if (_sb) return _sb;
    try {
      var url =
        (typeof window !== "undefined" && window.SUPABASE_URL) ||
        (typeof SUPABASE_URL !== "undefined" && SUPABASE_URL) || "";
      var key =
        (typeof window !== "undefined" && window.SUPABASE_ANON_KEY) ||
        (typeof SUPABASE_ANON_KEY !== "undefined" && SUPABASE_ANON_KEY) || "";
      if (!window.supabase || !url || !key) return null;
      _sb = window.supabase.createClient(url, key);
      return _sb;
    } catch (e) {
      console.warn("[신청접수] Supabase 초기화 실패:", e);
      return null;
    }
  }

  // ── 매칭 키 — forms.js benefitKey 와 «값이 같아야» 함 ──
  //   «공백을 모두 제거한 사업명». ★ 절대 정책번호를 쓰지 말 것 (2026-08-04 확정)
  //   이미 쌓인 benefit_key 가 전부 사업명 기준이라, 바꾸면 기존 서식·접수 연결이 끊긴다.
  //   cloud benefits 는 {name}, 모바일 data.json 은 {사업명} — 둘 다 읽음.
  function benefitKey(b) {
    b = b || {};
    var nm = b.name != null ? b.name : (b.사업명 != null ? b.사업명 : "");
    return String(nm).replace(/\s+/g, "");
  }

  // ── 접수번호 — PC(applications_io) 포맷 'YYYYMMDD-HHMMSS-NN' (KST 가정) ──
  //   단일 사업 신청이면 -01, 한 제출에서 N개면 -01,-02… 비우면 서버 트리거가 폴백.
  function genReceiptNo(idx) {
    idx = idx || 1;
    var d = new Date();                              // 사용자 브라우저 로컬(KST 가정)
    function p(n, w) { w = w || 2; return String(n).padStart(w, "0"); }
    var base = "" + d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate())
             + "-" + p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds());
    return base + "-" + p(idx);
  }

  // ── 조회코드(lookup_code) 생성 — 시민이 «내 신청 현황»을 여는 열쇠 ──────
  //  · 서버가 만들지 않고 «시민 기기»에서 만든다. 만든 값은 insert 페이로드와
  //    기기 localStorage 양쪽에 들어간다(기기에 없으면 시민이 적어 둔 코드로 입력).
  //  · 혼동되는 글자를 뺀 32자 알파벳: O·0 / I·1·l 을 모두 제외하고 대문자만 쓴다.
  //    (전화로 불러 주거나 종이에 적어 다시 입력하는 상황을 전제로 한 선택)
  //    10자 × 32종 = 50비트 → 남의 코드를 찍어서 맞힐 수 없다.
  //  · ⛔ Math.random 폴백을 두지 않는다 (2026-08-18, 🩷 security-privacy 지적)
  //    Math.random 은 «예측 가능»한 난수라, 그것으로 만든 코드는 50비트가 사실상 0비트가 된다
  //    (남의 조회코드를 계산해 낼 수 있다 = 남의 신청 상태·안내문을 볼 수 있다).
  //    crypto.getRandomValues 는 https 가 아닌 http 환경에서도 쓸 수 있어(secure context 제약이
  //    없는 API) 폴백의 실익이 없다. → 없으면 «조용히 내려가지» 말고 신청을 막고 오류를 낸다.
  //    ⚠ 256 을 32 로 나눌 때 나머지가 없으므로 모듈로 편향이 없다(256 = 32 × 8).
  var LOOKUP_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  function genLookupCode(len) {
    var n = len || 10, out = "", i;
    var bytes = null;
    try {
      if (window.crypto && window.crypto.getRandomValues) {
        bytes = new Uint8Array(n);
        window.crypto.getRandomValues(bytes);
      }
    } catch (e) { bytes = null; }
    if (!bytes) {
      throw new Error("이 브라우저에서는 안전한 조회코드를 만들 수 없습니다. "
        + "브라우저를 최신으로 올리시거나 다른 브라우저에서 신청해 주세요.");
    }
    for (i = 0; i < n; i++) {
      out += LOOKUP_ALPHABET.charAt(bytes[i] % LOOKUP_ALPHABET.length);
    }
    return out;
  }

  // 서버가 관리하는 필드는 클라가 절대 넣지 않는다(RLS with check 위반 방지).
  //   status·admin_memo·created_at·updated_at·id 를 방어적으로 제거.
  //   receipt_no 가 비어 있으면 클라에서 채운다(서버 트리거는 안전망).
  function _clean(payload) {
    var out = {};
    for (var k in payload) {
      if (Object.prototype.hasOwnProperty.call(payload, k)) out[k] = payload[k];
    }
    delete out.status;
    delete out.admin_memo;
    // citizen_reply(공무원이 쓰는 시민 안내문)도 클라가 넣지 않는다 —
    // 신청자가 자기 화면에 보일 답변을 스스로 써 넣는 일이 없어야 한다.
    delete out.citizen_reply;
    delete out.created_at;
    delete out.updated_at;
    delete out.id;
    if (!out.receipt_no || String(out.receipt_no).trim() === "") {
      out.receipt_no = genReceiptNo(1);
    }
    return out;
  }

  // ── 시민 신청 INSERT (anon) — 성공 시 «보낸 행»(receipt_no 포함)을 그대로 반환 ──
  //   실패는 throw → 호출부(시민앱)가 안내. «메일 전송과 독립» 으로 처리한다.
  //
  //  ⛔⛔ 여기에 «절대» .select() 를 붙이지 마세요 (2026-08-18, 실제 장애로 확인)
  //     .insert(row).select() 는 서버에서 `INSERT … RETURNING` 이 된다.
  //     PostgreSQL 은 RETURNING 이 붙는 순간 INSERT 권한뿐 아니라 그 행에 대한
  //     «SELECT 권한(정책)»까지 함께 요구한다. applications 는 이름·연락처가 든
  //     개인정보 테이블이라 익명(anon)에게 SELECT 정책이 «없는 것이 정상»이고,
  //     그래서 저장이 통째로 거부됐다(REST 로 재현: Prefer: return=representation →
  //     401, 헤더를 빼면 201 성공). 서버 정책은 «정상»이었고 클라이언트가 문제였다.
  //     ⚠ 이때 나오는 문구가 하필 "new row violates row-level security policy" 라
  //       «INSERT 정책이 없다»로 오인하기 쉽다 — 그 함정에 빠지지 말 것.
  //     ⛔ 해결책으로 «익명 SELECT 정책을 여는» 방법은 금지다(🩷 자물쇠 확정).
  //       RETURNING 을 통과시키는 SELECT 정책은 보통의 조회도 함께 통과시켜,
  //       created_at 을 최근 몇 초로 좁혀도 그 사이 접수된 다른 시민의
  //       이름·연락처·문의내용이 누구에게나 열린다.
  //
  //  반환값: 서버가 돌려준 행이 아니라 «우리가 보낸 행»(_clean 을 거친 row).
  //     receipt_no·lookup_code 는 클라가 만들어 보내는 값이라 서버 왕복 없이도 확정이다.
  //     (receipt_no 를 비워 보내면 서버 트리거가 채우지만, 이 앱은 항상 채워 보낸다.)
  //  성공 판정: «반환된 행이 있는가»가 아니라 «throw 없이 끝났는가»로 본다.
  async function submitApplication(payload) {
    var sb = client();
    if (!sb) throw new Error("서버에 연결할 수 없습니다. 잠시 후 다시 시도해 주세요.");
    var row = _clean(payload || {});
    var res = await sb.from(TABLE).insert(row);   // ⛔ .select()/.single() 금지 — 위 주석 참조
    if (res.error) throw res.error;
    return row;
  }

  // ── 내 신청 «상태» 조회 (익명) — 테이블이 아니라 «서버 함수»를 부른다 ──
  //   supabase/application_status.sql 의 check_application_status(p_code)
  //   반환: [{receipt_no, benefit_name, status, citizen_reply, created_at, updated_at}]
  //   · 코드가 8자 미만이면 서버가 «무조건» 빈 결과를 준다(빈 값으로 남의 행이 걸리는 사고 방지).
  //     클라에서도 미리 걸러 헛된 왕복을 줄인다.
  //   · 함수가 아직 없는 환경(PGRST202)에서는 throw → 호출부가 진입점을 «조용히» 숨긴다.
  //     (앱의 다른 기능은 어떤 경우에도 멀쩡해야 한다는 기존 방어 원칙 그대로)
  async function checkStatus(code) {
    var c = String(code == null ? "" : code).trim();
    if (c.length < 8) return [];
    var sb = client();
    if (!sb || !sb.rpc) throw new Error("서버에 연결할 수 없습니다. 잠시 후 다시 시도해 주세요.");
    var res = await sb.rpc("check_application_status", { p_code: c });
    if (res.error) throw res.error;
    return res.data || [];
  }

  // ── 내 신청 «상태» 여러 건 조회 (익명, 배열 1회 호출) ───────────────────
  //   supabase/application_status.sql 의 check_application_status_many(p_codes text[])
  //   왜 배열인가 (2026-08-18, 🩷 security-privacy 지적)
  //     기기에 보관된 코드를 «한 건씩» 폴링하면 분당 수백 회 호출이 되어,
  //     정상 사용과 «코드 대입 공격»의 트래픽 모양이 같아진다 → 나중에 속도 제한을 걸 수 없다.
  //     배열로 한 번에 물으면 «1회 호출 = 1명의 정상 조회»가 되어 구분이 생긴다.
  //   ⚠ 이 함수가 아직 서버에 없을 수 있다(양호창님이 대시보드에서 SQL 을 실행하기 전).
  //     그때는 PGRST202 로 실패하므로, 호출부가 isMissingFunction 으로 «함수 없음»을 가려내
  //     단건 checkStatus 로 조용히 폴백한다. 네트워크 오류와 «함수 없음»은 반드시 구분한다.
  //   · 빈 배열로 부르면 «함수가 있는지»만 확인하는 프로브가 된다(가짜 코드를 던지지 않는다).
  async function checkStatusMany(codes) {
    var list = [], i, c;
    var src = codes || [];
    for (i = 0; i < src.length; i++) {
      c = String(src[i] == null ? "" : src[i]).trim();
      if (c.length >= 8 && list.indexOf(c) < 0) list.push(c);
    }
    var sb = client();
    if (!sb || !sb.rpc) throw new Error("서버에 연결할 수 없습니다. 잠시 후 다시 시도해 주세요.");
    var res = await sb.rpc("check_application_status_many", { p_codes: list });
    if (res.error) throw res.error;
    return res.data || [];
  }

  // ── 🔑 조회코드 «되찾기» (익명) — 이름 + 연락처 뒷 4자리 ────────────────
  //   supabase/조회코드_되찾기.sql 의 recover_lookup_codes(p_name, p_phone4)
  //
  //   ⭐ 이 함수가 돌려주는 것은 «조회코드뿐»이다 — 사업명·상태·안내문·접수번호를
  //      주지 않는다(일부러). 코드를 받은 뒤 기존 checkStatusMany 로 물으면 다 나온다.
  //      「상태를 보여 주는 두 번째 문」 이 아니라 「잃어버린 열쇠를 되찾아 주는 창구」다.
  //      ⛔ 반환 컬럼을 늘려 달라는 요구가 오면 SQL 파일 머리말을 함께 읽고 거절할 것.
  //
  //   ⚠ .rpc(..., {}, { get: true }) 로 부르지 말 것.
  //     이 함수는 시도 횟수를 «쓰기» 때문에 volatile 이다 — GET 은 읽기전용 트랜잭션이라 실패한다.
  //   ⚠ «프로브»하지 말 것(checkStatusMany([]) 같은 빈 호출을 흉내내지 말 것).
  //     서버는 입력 형식을 검사하기 «전에» 시도 횟수부터 센다(10분에 10회). 형식이 틀린
  //     호출로 횟수 제한을 피해 가는 길을 막으려고 일부러 그 순서로 만든 것이라,
  //     프로브 한 번이 시민의 실제 시도 한 번을 잡아먹는다.
  //     → 함수가 있는지는 «시민이 실제로 눌렀을 때» 응답으로 배운다(PGRST202 → 진입점 숨김).
  //
  //   반환: 조회코드 «문자열» 배열 0~10개.
  //     ※ 서버는 [{lookup_code:"..."}] «객체 배열»을 주므로 여기서 펴서 돌려준다.
  //   0건과 «동명이인이라 안 준다»는 서버에서 이미 구분되지 않는다(둘 다 0건). 호출부도
  //   이유를 캐묻거나 시민에게 알려 주지 말 것 — 찍어 보는 사람에게 힌트가 된다.
  async function recoverLookupCodes(name, phone4) {
    var nm = String(name == null ? "" : name).trim();
    var p4 = String(phone4 == null ? "" : phone4).replace(/[^0-9]/g, "");
    // 서버도 막지만 여기서 먼저 거른다 — 형식이 틀린 호출로 «시도 횟수»를 태우지 않기 위해.
    if (nm.length < 2 || nm.length > 40 || p4.length !== 4) return [];
    var sb = client();
    if (!sb || !sb.rpc) throw new Error("서버에 연결할 수 없습니다. 잠시 후 다시 시도해 주세요.");
    var res = await sb.rpc("recover_lookup_codes", { p_name: nm, p_phone4: p4 });
    if (res.error) throw res.error;
    var rows = res.data || [], out = [], i, c;
    for (i = 0; i < rows.length; i++) {
      c = String((rows[i] && rows[i].lookup_code) || "").trim();
      if (c && out.indexOf(c) < 0) out.push(c);
    }
    return out;
  }

  // ── «시도 횟수 제한에 걸렸다» 인가? ────────────────────────────────────
  //   recover_lookup_codes 가 10분에 10회를 넘기면 P0001 + hint 'RATE_LIMIT' 으로 막는다.
  //   이때는 «틀렸다»가 아니라 «잠시 뒤에»라고 안내해야 한다(입력을 고치라고 하면 안 된다).
  function isRateLimited(e) {
    if (!e) return false;
    if (String((e && e.code) || "") === "P0001") return true;
    if (/RATE_LIMIT/i.test(String((e && e.hint) || ""))) return true;
    return false;
  }

  // ── «서버에 그 함수가 없다» 인가? (네트워크 오류와 구분) ────────────────
  //   PostgREST 는 없는 함수를 부르면 PGRST202 + "Could not find the function ... in the schema cache"
  //   를 준다. 이 경우에만 «영구 불가»로 처리하고, 그 밖(연결 끊김·타임아웃·5xx)은
  //   «아직 모름»으로 남겨 나중에 다시 시도해야 한다.
  function isMissingFunction(e) {
    if (!e) return false;
    var code = String((e && (e.code || e.status || e.statusCode)) || "");
    var msg = String((e && (e.message || e.error || e.details || e.hint)) || "").toLowerCase();
    if (code === "PGRST202" || code === "42883") return true;
    if (/could not find the function/.test(msg)) return true;
    if (/function .*does not exist/.test(msg)) return true;
    return false;
  }

  // ┌──────────────────────────────────────────────────────────────────┐
  // │ ⛔ 여기에 «조회·수정·삭제·구독» 함수를 다시 넣지 마세요.          │
  // │    listApplications / updateApplication / deleteApplication /     │
  // │    subscribeApplications 는 이 시민앱 사본에서 «의도적으로»      │
  // │    삭제했습니다(2026-08-04, 🟡 egov-compliance 지적).             │
  // │    cloudui/apply_client.js 에는 그대로 있고 앞으로도 있어야 합니다.│
  // │    → 두 사본이 다른 것이 «정상»입니다. 동기화하지 마세요.        │
  // └──────────────────────────────────────────────────────────────────┘
  // 왜: applications 에는 신청자 이름·연락처·문의내용(개인정보)이 들어 있습니다.
  //     시민앱은 «공개» 웹앱이라 여기 있는 함수는 누구나 브라우저 콘솔에서
  //     호출할 수 있습니다. 실제로 RLS 임시 개방(rls_temp_open.sql) 상태에서는
  //     anon 키만으로 접근이 되어, 노출해 두면 콘솔 한 줄로 전체 접수 명단을
  //     읽을 수 있었습니다(개인정보 보호법 §29 안전조치 의무 위반 소지).
  //     시민앱에 필요한 건 «신청 제출»(submitApplication) 하나뿐입니다.
  // ⚠ RLS 를 정식(로그인 공무원만)으로 되돌려도 이 사본은 원복하지 않습니다.
  //    «필요한 것만 노출»이 원칙이고, 시민앱은 이 함수들을 쓸 일이 없습니다.

  // ── 오류 원인 분류(호출부 안내·다시시도 판단용) ──
  //   conn=연결/서버 · perm=권한(RLS) · setup=테이블 미생성 · other=그밖
  function errKind(e) {
    if (!e) return "other";
    if (typeof navigator !== "undefined" && navigator.onLine === false) return "conn";
    var msg = String((e && (e.message || e.error)) || e || "").toLowerCase();
    var code = String((e && (e.code || e.status || e.statusCode)) || "");
    if (e.name === "TypeError" && msg.indexOf("fetch") >= 0) return "conn";
    if (/failed to fetch|networkerror|network error|load failed|timeout|timed out|fetch failed/.test(msg)) return "conn";
    if (/^(5\d\d|0|429)$/.test(code)) return "conn";
    if (/service unavailable|bad gateway|gateway timeout|temporarily unavailable|paused/.test(msg)) return "conn";
    if (code === "42501" || code === "401" || code === "403" ||
        /row-level security|permission denied|not authorized|jwt|api key/.test(msg)) return "perm";
    if (code === "42P01" || code === "PGRST205" || code === "PGRST204" || code === "404" ||
        /does not exist|could not find the (table|column)|schema cache/.test(msg)) return "setup";
    return "other";
  }

  return {
    TABLE: TABLE,
    STATUSES: STATUSES,
    useClient: useClient,
    benefitKey: benefitKey,
    genReceiptNo: genReceiptNo,
    genLookupCode: genLookupCode,
    submitApplication: submitApplication,
    // ✅ checkStatus 는 «상태 몇 줄»만 돌려주는 서버 함수 호출이다(위 ⭐ 주석 참조).
    //    아래 ⛔ 금지목록과 성격이 다르므로 함께 지우지 말 것.
    checkStatus: checkStatus,
    //    배열 1회 호출판(없는 서버에서는 PGRST202 → 호출부가 checkStatus 로 폴백).
    checkStatusMany: checkStatusMany,
    // 🔑 조회코드를 «잊었을 때» 되찾는 보조 창구(이름+연락처 뒷4자리 → 조회코드만).
    //    위 ⛔ 금지목록과 성격이 다르다 — 개인정보를 «주지 않고» 열쇠만 돌려준다.
    recoverLookupCodes: recoverLookupCodes,
    isRateLimited: isRateLimited,
    isMissingFunction: isMissingFunction,
    // ⛔ listApplications·updateApplication·deleteApplication·subscribeApplications 는
    //    시민앱에서 의도적으로 «노출하지 않습니다»(위 ⛔ 주석 참조). 되살리지 마세요.
    errKind: errKind
  };
})();
