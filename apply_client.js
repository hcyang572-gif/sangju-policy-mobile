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
//    useClient, benefitKey, genReceiptNo, submitApplication, errKind, TABLE, STATUSES
//  }   ← 시민앱이 실제로 쓰는 것만. 조회·수정·삭제·구독은 노출하지 않는다.
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
    delete out.created_at;
    delete out.updated_at;
    delete out.id;
    if (!out.receipt_no || String(out.receipt_no).trim() === "") {
      out.receipt_no = genReceiptNo(1);
    }
    return out;
  }

  // ── 시민 신청 INSERT (anon) — 성공 시 저장된 행(receipt_no 포함) 반환 ──
  //   실패는 throw → 호출부(시민앱)가 안내. «메일 전송과 독립» 으로 처리한다.
  async function submitApplication(payload) {
    var sb = client();
    if (!sb) throw new Error("서버에 연결할 수 없습니다. 잠시 후 다시 시도해 주세요.");
    var row = _clean(payload || {});
    var res = await sb.from(TABLE).insert(row).select().single();
    if (res.error) throw res.error;
    return res.data;
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
    submitApplication: submitApplication,
    // ⛔ listApplications·updateApplication·deleteApplication·subscribeApplications 는
    //    시민앱에서 의도적으로 «노출하지 않습니다»(위 ⛔ 주석 참조). 되살리지 마세요.
    errKind: errKind
  };
})();
