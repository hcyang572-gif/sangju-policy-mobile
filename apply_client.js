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
//    · submitApplication 실패는 throw → 시민앱이 «접수되지 않았습니다»로 안내한다.
//      ⚠ 2026-08-24 이후 신청 메일 발송이 «없어졌다» — 이 통로가 «유일한» 접수 경로다.
//        예전처럼 받쳐 주는 메일이 없으므로, 여기 throw 를 삼키면 신청이 사라진다.
//  → 어떤 경우에도 앱의 다른 기능(사업목록·정책제안)은 멀쩡해야 한다.
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

  // ── 접수번호 — 'YYYYMMDD-HHMMSS-NN' (KST 가정), NN = «난수 10~99» ────────
  //  ⚠⚠ 2026-08-20 결함 수정 — 예전에는 NN 이 «한 제출 안의 순번»이었다.
  //     시민앱은 한 번에 한 사업만 신청하므로 늘 genReceiptNo(1) → «항상 -01».
  //     즉 같은 «초»에 신청한 사람은 모두 똑같은 접수번호를 만들었고,
  //     uq_applications_receipt(unique) 가 그중 한 건만 받고 나머지는 23505 로 거부했다.
  //     → 저장 실패 → 공무원앱에 안 뜸 → 조회코드 없음 → 첨부 못 올림.
  //     (실측 2026-08-20: 5명 동시 제출 × 3회 = 15번 시도 중 12번 거부, 80% 실패)
  //  ⭐ 형식은 서버 폴백 트리거와 «글자 그대로 같다»
  //     (supabase/applications.sql · applications_fill_receipt_no):
  //       to_char(…,'YYYYMMDD-HH24MISS') || '-' ||
  //       lpad(((floor(random()*90))::int + 10)::text, 2, '0')      → NN 은 10~99
  //     자릿수(18자)가 예전과 같으므로 화면·엑셀·검색·PC 대장이 그대로 동작한다.
  //  ⚠ 그래도 «같은 초 + 같은 NN» 이 90분의 1 확률로 나올 수 있다 →
  //     submitApplication 이 23505 를 만나면 번호만 새로 뽑아 «최대 3번» 다시 보낸다
  //     (2026-08-25 부하 실측으로 1회 → 3회 + 지터. 아래 submitApplication 머리말 참조).
  //  ⚠ idx 인자는 부르는 곳을 안 고쳐도 되게 «남겨 둘 뿐» 쓰지 않는다.
  //     한 제출에서 여러 건을 넣어도 난수라 서로 겹치지 않는다.
  function genReceiptNo(idx) {                       // eslint-disable-line no-unused-vars
    var d = new Date();                              // 사용자 브라우저 로컬(KST 가정)
    function p(n, w) { w = w || 2; return String(n).padStart(w, "0"); }
    var base = "" + d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate())
             + "-" + p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds());
    return base + "-" + _receiptSuffix();
  }

  // 접수번호 뒤 두 자리(10~99).
  //  ⚠ 이 난수는 «비밀이 아니다» — 바로 위 genLookupCode 와 성격이 정반대다.
  //    접수번호는 완료 화면·접수대장에 그대로 적히는 «공개된 번호»이고,
  //    이 두 자리는 같은 초의 충돌을 피하려는 표식일 뿐이다(서버 트리거도
  //    비암호학적 random() 을 쓴다). 맞혀도 얻을 것이 없다.
  //    → 그래서 여기서는 Math.random 폴백이 «있어야» 한다. crypto 가 없다고
  //      신청을 막으면, 아무 이득 없이 시민이 접수를 못 하게 될 뿐이다.
  //    ⛔ 반대로 genLookupCode 에는 이 폴백을 «절대» 옮겨 붙이지 말 것.
  //  ⚠ 180 = 90 × 2 — 180 이상이 나오면 다시 뽑아 편향 없이 0~89 를 얻는다.
  function _receiptSuffix() {
    var v = -1;
    try {
      if (window.crypto && window.crypto.getRandomValues) {
        var b = new Uint8Array(1);
        for (var t = 0; t < 8; t++) {
          window.crypto.getRandomValues(b);
          if (b[0] < 180) { v = b[0] % 90; break; }
        }
      }
    } catch (e) { v = -1; }
    if (v < 0) v = Math.floor(Math.random() * 90);
    return String(v + 10);        // 10~99 — 언제나 두 자리(padStart 불필요)
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
      throw new Error("이 브라우저에서는 안전한 확인 번호를 만들 수 없습니다. "
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
  //   실패는 throw → 호출부(시민앱)가 «접수되지 않았습니다»로 안내한다.
//   ⚠ 이 INSERT 가 접수의 «전부»다(2026-08-24 신청 메일 폐지). 실패 = 신청 없음.
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
  //  ⭐ 접수번호가 겹치면(23505) «번호만» 새로 뽑아 다시 보낸다 (2026-08-20 도입)
  //     23505 는 «그 행이 저장되지 않았다»는 뜻이므로 재시도해도 중복 접수가 되지 않는다.
  //
  //  ★★ 2026-08-25 부하 실측 반영 — 재시도 1회 → 3회 + 지터
  //     ────────────────────────────────────────────────────────────────────
  //     실제로 요청을 보내 잰 값:
  //       · 동시 30건 → 120/120 성공. 다만 «첫 시도»에서 15건(12.5%)이 충돌했고
  //         재시도 1회로 전부 구조됐다(= 여유가 한 칸도 없었다).
  //       · 동시 50건 → 1건이 «재시도까지 또 겹쳐» 영구 실패했다. 그 신청은 어디에도
  //         남지 않는다. 2026-08-24 이후 신청 메일이 없어져 이 통로가 «유일한» 접수
  //         경로이므로, 여기서 놓치면 시민의 신청이 그냥 사라진다.
  //     왜 1회로는 모자랐나 — 난수 공간이 90개뿐이라 같은 초에 N명이 몰리면 충돌
  //     확률이 급히 오른다. 게다가 «겹친 둘이 동시에» 재시도하면 두 번째도 같은
  //     순간에 부딪힌다. → ① 횟수를 3회로 늘리고 ② 재시도 사이에 «무작위 지터»를 둬
  //     둘의 재시도 시각을 흩뜨린다. 지터가 없으면 횟수만 늘려도 잘 안 풀린다.
  //     ※ 서버 트리거 쪽(난수 공간 확대·재추첨)은 🩷자물쇠가 함께 고친다.
  //
  //     ⚠ 상한을 올려도 «안전하다» — 근거를 분명히 적어 둔다.
  //       23505 는 서버가 «받지 않았다»고 확실히 대답한 것이다. 「저장은 됐는데 응답만
  //       오류」인 상황(네트워크 끊김·타임아웃)에서는 23505 가 «오지 않는다» — 그때는
  //       _isDupReceipt 가 false 라 곧바로 throw 되고 재시도가 아예 돌지 않는다.
  //       ⛔ 그러므로 재시도의 안전은 «횟수»가 아니라 _isDupReceipt 의 엄격함이 지킨다.
  //          그 함수를 느슨하게 고치는 순간 이 상한도 함께 위험해진다 — 같이 볼 것.
  var RECEIPT_RETRY_MAX = 3;        // 번호를 새로 뽑아 다시 보내는 «최대» 횟수
  var RETRY_JITTER_MIN_MS = 50;     // 재시도 사이 무작위 대기(하한)
  var RETRY_JITTER_MAX_MS = 150;    // 〃 (상한)

  function _retryDelay() {
    return new Promise(function (r) {
      setTimeout(r, RETRY_JITTER_MIN_MS + Math.random() * (RETRY_JITTER_MAX_MS - RETRY_JITTER_MIN_MS));
    });
  }

  async function submitApplication(payload) {
    var sb = client();
    if (!sb) throw new Error("서버에 연결할 수 없습니다. 잠시 후 다시 시도해 주세요.");
    var row = _clean(payload || {});
    var res = await sb.from(TABLE).insert(row);   // ⛔ .select()/.single() 금지 — 위 주석 참조
    for (var i = 0; i < RECEIPT_RETRY_MAX && res.error; i++) {
      // ⚠ «접수번호 충돌»이 아닌 오류는 여기서 곧바로 던진다 — 재시도가 절대 돌지 않는다.
      if (!_isDupReceipt(res.error)) throw res.error;
      await _retryDelay();                        // 겹친 둘이 «또» 같이 부딪히지 않게 흩뜨린다
      row.receipt_no = genReceiptNo();            // 번호만 갈아 끼운다(내용은 그대로)
      res = await sb.from(TABLE).insert(row);
    }
    if (res.error) throw res.error;               // 3번 다 겹쳤다 → 시민에게 실패를 알린다
    return row;                                   // ★ 재시도했으면 «새 접수번호»가 들어 있다
  }

  // ── «접수번호가 겹쳤다» 인가? — 다시 보내면 풀리는 유일한 오류 ──────────
  //  ⚠ applications 에는 unique 제약이 둘이다(supabase/신청첨부.sql):
  //      · uq_applications_receipt        ← 접수번호. 번호를 새로 뽑으면 풀린다.
  //      · uq_applications_attach_ticket  ← 첨부 통행증. 번호를 바꿔도 안 풀린다.
  //    그래서 23505 라는 것만 보고 재시도하면 안 되고, «어느 제약인지»를 가려야 한다.
  //    가리지 못하면(제약 이름이 안 실려 오면) 재시도하지 않는다 — 모르면 안 하는 쪽이 안전하다.
  //
  //  ★★ 이 함수가 submitApplication 재시도의 «유일한 안전장치»다 (2026-08-25 재점검).
  //     재시도 상한을 1 → 3 으로 올렸으므로, 여기가 느슨해지면 같은 신청이 여러 건
  //     쌓이는 «되돌릴 수 없는 사고»가 된다. 세 겹으로 잠근다:
  //       ① 23505(또는 409) 라는 «저장되지 않았다»는 확답이 있어야 한다.
  //          → 네트워크 끊김·타임아웃·5xx 는 여기서 전부 걸러진다. 그때가 진짜 위험한
  //            경우다 — 서버는 저장했는데 응답만 못 받았을 수 있으므로 재시도 금지.
  //       ② 이름을 대는 제약이 «접수번호»여야 한다.
  //       ③ «다른» unique 제약 이름이 보이면 무조건 아니다(첨부 통행증).
  //     ⛔ 세 겹 중 하나라도 빼지 말 것. 특히 ②를 지우고 「23505 면 재시도」로 만들지 말 것.
  function _isDupReceipt(e) {
    if (!e) return false;
    var code = String((e && (e.code || e.status || e.statusCode)) || "");
    var blob = [e.message, e.details, e.hint, e.constraint].map(function (x) {
      return String(x == null ? "" : x);
    }).join(" ");
    // ① «저장되지 않았다»는 확답이 있는가 (없으면 재시도하지 않는다)
    if (code !== "23505" && code !== "409" && !/23505/.test(blob)) return false;
    /* ③ 첨부 통행증(uq_applications_attach_ticket) 충돌은 «번호를 바꿔도 안 풀린다».
       재시도해 봐야 같은 통행증으로 계속 부딪히기만 한다. 이름이 보이면 곧바로 아니라고 답한다.
       ⚠ 한 오류가 대는 제약 이름은 «하나»뿐이라, 진짜 접수번호 충돌이 여기 걸릴 일은 없다. */
    if (/attach_ticket/i.test(blob)) return false;
    // ② 접수번호 제약인가 (제약 이름이 안 실려 오면 false — 모르면 안 하는 쪽이 안전하다)
    return /uq_applications_receipt|receipt_no/i.test(blob);
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

  // ── 🗑 내 신청 «취소(삭제)» (익명) — 서버 함수 cancel_application ────────
  //   supabase/신청취소_260821.sql
  //   왜 여기 있어도 되는가: 위 ⛔ 금지목록의 deleteApplication 과 «성격이 다르다».
  //     · deleteApplication 은 테이블을 직접 지우는 관리자 함수였다(아무 행이나 지운다).
  //     · 이 함수는 «조회코드(50비트 난수) + 접수번호» 가 둘 다 맞는 «한 건»만
  //       서버가 취소 표시(canceled_at)한다. 남의 접수번호를 알아도 그 사람의
  //       조회코드를 모르면 아무것도 지울 수 없다. checkStatus 와 같은 결의 통로다.
  //   · 지우는 것이 아니라 «표시»다(soft delete) — 정책제안 delete_proposal 과 같은 방식.
  //   · 반환: 취소된 행의 조회코드(호출자가 방금 보낸 값 중 하나) → 기기 보관값 정리용.
  //   · 함수가 아직 서버에 없으면(PGRST202) throw → 호출부가 버튼을 조용히 숨긴다.
  //   ⛔ 반환값에 이름·연락처·사업명을 «절대» 더하지 말 것.
  async function cancelApplication(codes, receiptNo) {
    var list = [], i, c;
    var src = codes || [];
    for (i = 0; i < src.length; i++) {
      c = String(src[i] == null ? "" : src[i]).trim();
      if (c.length >= 8 && list.indexOf(c) < 0) list.push(c);
    }
    var rc = String(receiptNo == null ? "" : receiptNo).trim();
    if (!list.length || rc.length < 8) throw new Error("취소할 신청을 찾지 못했습니다.");
    var sb = client();
    if (!sb || !sb.rpc) throw new Error("서버에 연결할 수 없습니다. 잠시 후 다시 시도해 주세요.");
    var res = await sb.rpc("cancel_application", { p_codes: list, p_receipt_no: rc });
    if (res.error) throw res.error;
    return String(res.data == null ? "" : res.data);
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
    // 🗑 «내 신청 취소» — 조회코드+접수번호가 둘 다 맞는 한 건만 취소 표시(위 주석 참조).
    cancelApplication: cancelApplication,
    isRateLimited: isRateLimited,
    isMissingFunction: isMissingFunction,
    // ⛔ listApplications·updateApplication·deleteApplication·subscribeApplications 는
    //    시민앱에서 의도적으로 «노출하지 않습니다»(위 ⛔ 주석 참조). 되살리지 마세요.
    errKind: errKind
  };
})();
