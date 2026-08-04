// ════════════════════════════════════════════════════════════════════════
//  서식 스토리지 공용 헬퍼 (SangjuForms) — 「사업별 필요서류 서식」 ①단계
//  규약 출처: _workspace/서식스토리지_클라이언트_규약.md  (🟢 data-engineer)
//  ⚠ 세 앱(cloudui·webui·모바일웹) 공통. 이 파일은 «동일 내용»으로 각 앱에 둔다.
//     규칙(매칭키·sanitize·확장자/용량·URL 기준)을 바꾸면 규약문서 + SQL 주석 +
//     세 앱의 forms.js 를 «동시에» 갱신하고 검수 담당에게 알린다.
//
//  노출: window.SangjuForms = {
//    useClient, benefitKey, sanitizeName, sanitizeFolder, validateFile,
//    formatSize, listForms, uploadForm, deleteForm, BUCKET
//  }
//
//  방어 원칙: forms_storage.sql 이 아직 실행 안 됐으면(테이블·버킷 없음)
//    · listForms 는 조용히 [] 를 돌려준다(콘솔 warn 만) → 화면은 "서식 없음".
//    · uploadForm/deleteForm 은 «원인 있는 Error» 를 throw → 호출부가 안내.
//  → 어떤 경우에도 앱의 다른 기능(신청·목록·맞춤추천)은 멀쩡해야 한다.
// ════════════════════════════════════════════════════════════════════════
window.SangjuForms = (function () {
  "use strict";

  var BUCKET = "forms";          // 서식 원본(공개 버킷)
  var TABLE = "benefit_forms";   // 목록 정본(메타데이터 테이블)

  // ── Supabase 클라이언트 (지연 초기화) ──────────────────────────────
  // 앱이 이미 만든 클라이언트를 useClient(sb) 로 넘겨주면 그걸 쓰고,
  // 아니면 window / 전역 const 의 URL·anon key 로 직접 만든다.
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
      console.warn("[서식] Supabase 초기화 실패:", e);
      return null;
    }
  }

  // ── §1 매칭 키 — «공백을 모두 제거한 사업명». 그 외 어떤 값도 쓰지 않는다 ──
  //   ★ 절대 정책번호를 쓰지 말 것 (2026-08-04 확정)
  //     benefit_forms.benefit_key · applications.benefit_key 에 «이미 쌓인» 값이
  //     전부 사업명 기준이다. 연동이 benefits.policy_no 를 채우기 시작해도 이 규칙은
  //     그대로 둔다 — 바꾸면 등록된 서식이 시민앱에서 안 보이게 된다.
  //   cloud benefits 는 {name}, 모바일 data.json 은 {사업명} → 두 표기 모두 읽는다.
  function benefitKey(b) {
    b = b || {};
    var nm = b.name != null ? b.name : (b.사업명 != null ? b.사업명 : "");
    return String(nm).replace(/\s+/g, "");
  }

  // ── §3 파일명 · 폴더명 sanitize ────────────────────────────────────
  //  ⚠ Supabase Storage 는 «키(경로)에 한글 등 비ASCII 를 허용하지 않는다»(InvalidKey 400).
  //     그래서 storage_path 는 «반드시 ASCII 로만» 만든다.
  //     원본 한글 파일명은 benefit_forms.file_name 에 보존한다(화면 표시 + 다운로드 이름).
  function _asciiHash(s) {                 // 한글 사업명 → 결정적 ASCII 폴더(djb2)
    s = String(s || "");
    var h = 5381;
    for (var i = 0; i < s.length; i++) { h = (((h << 5) + h) + s.charCodeAt(i)) >>> 0; }
    return "b" + h.toString(36);
  }
  function sanitizeName(name) {
    name = String(name || "");
    var dot = name.lastIndexOf(".");
    var base = dot > 0 ? name.slice(0, dot) : name;
    var ext = dot > 0 ? name.slice(dot + 1).toLowerCase() : "";
    // ASCII(영숫자·._-)만 남긴다. 한글 등 비ASCII 는 제거 → 다 지워지면 'file'.
    base = base
      .replace(/\s+/g, "_")
      .replace(/[^A-Za-z0-9._-]/g, "")
      .replace(/_+/g, "_")
      .replace(/^[_.]+|[_.]+$/g, "")
      .slice(0, 60) || "file";
    ext = ext.replace(/[^a-z0-9]/g, "");
    return ext ? base + "." + ext : base;
  }
  function sanitizeFolder(key) {
    // benefit_key 가 한글이면 Storage 키로 못 쓴다 → 결정적 해시로 ASCII 폴더 생성.
    // (매칭은 benefit_forms.benefit_key 컬럼으로 하므로 폴더명은 위치일 뿐 무관)
    var ascii = String(key).replace(/[^A-Za-z0-9._-]/g, "").slice(0, 40);
    return ascii || _asciiHash(key);
  }

  // ── §4 허용 확장자 · 용량(클라이언트 강제) ─────────────────────────
  var ALLOW_EXT = [
    "hwp", "hwpx", "pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx",
    "jpg", "jpeg", "png", "gif", "zip", "txt"
  ];
  var BLOCK_EXT = [
    "exe", "msi", "bat", "cmd", "com", "scr", "pif", "ps1", "sh", "vbs", "vbe",
    "js", "mjs", "jar", "dll", "apk", "app", "py", "php", "pl", "rb", "html",
    "htm", "svg", "wsf", "lnk"
  ];
  var MAX_BYTES = 10 * 1024 * 1024; // 10MB (버킷 file_size_limit 과 동일)

  function validateFile(file) {
    if (!file) return "파일을 선택해 주세요.";
    var ext = (String(file.name || "").split(".").pop() || "").toLowerCase();
    if (ALLOW_EXT.indexOf(ext) === -1 || BLOCK_EXT.indexOf(ext) !== -1)
      return "허용되지 않는 파일 형식입니다(." + ext + "). 허용: " + ALLOW_EXT.join(", ");
    if (file.size > MAX_BYTES)
      return "파일이 너무 큽니다(최대 10MB). 현재 " + (file.size / 1048576).toFixed(1) + "MB";
    return null; // 통과
  }

  // 사람이 읽는 크기 표기(스크린리더 텍스트에도 그대로 사용)
  function formatSize(bytes) {
    var n = Number(bytes);
    if (!Number.isFinite(n) || n <= 0) return "";
    if (n < 1024) return n + " B";
    if (n < 1024 * 1024) return (n / 1024).toFixed(0) + " KB";
    return (n / 1048576).toFixed(1) + " MB";
  }

  // 파일명에 꼬리번호: '이름.hwp' → '이름_2.hwp'
  function withTail(name, num) {
    var dot = name.lastIndexOf(".");
    var base = dot > 0 ? name.slice(0, dot) : name;
    var ext = dot > 0 ? name.slice(dot) : ""; // '.hwp' (점 포함)
    return base + "_" + num + ext;
  }

  function isDuplicateErr(err) {
    var msg = String((err && (err.message || err.error)) || err || "").toLowerCase();
    var st = String((err && (err.statusCode || err.status)) || "");
    return st === "409" || msg.indexOf("already exists") !== -1 ||
      msg.indexOf("duplicate") !== -1 || msg.indexOf("resource already") !== -1;
  }

  // ── §7 조회(목록) — 정본은 benefit_forms 테이블. 실패 시 조용히 [] ──
  async function listForms(benefit) {
    var sb = client();
    if (!sb) return [];
    try {
      var res = await sb
        .from(TABLE)
        .select("*")
        .eq("benefit_key", benefitKey(benefit))
        .order("uploaded_at", { ascending: true });
      if (res.error) {
        // 테이블 미생성(PGRST205)·권한 등 — 앱을 깨지 않고 빈 목록 처리
        console.warn("[서식] 목록 조회 생략:", res.error.message || res.error);
        return [];
      }
      return res.data || [];
    } catch (e) {
      console.warn("[서식] 목록 조회 실패:", e);
      return [];
    }
  }

  // ── §5 업로드 → benefit_forms 기록 (forms, 공무원) ─────────────────
  async function uploadForm(benefit, file) {
    var msg = validateFile(file);
    if (msg) throw new Error(msg);
    var sb = client();
    if (!sb) throw new Error("서버에 연결할 수 없습니다. 잠시 후 다시 시도해 주세요.");

    var folder = sanitizeFolder(benefitKey(benefit));
    var fname = sanitizeName(file.name);

    // 같은 폴더에 같은 이름이 있으면 꼬리번호로 회피(최대 20회)
    var path = "";
    var uploaded = false;
    var lastErr = null;
    for (var i = 1; i <= 20; i++) {
      var cand = i === 1 ? fname : withTail(fname, i);
      var tryPath = folder + "/" + cand;
      var up = await sb.storage
        .from(BUCKET)
        .upload(tryPath, file, { upsert: false, contentType: file.type || undefined });
      if (!up.error) { path = tryPath; uploaded = true; break; }
      lastErr = up.error;
      if (isDuplicateErr(up.error)) continue; // 이름 충돌 → 다음 후보
      break; // 그 외 오류(권한·용량·네트워크)는 즉시 중단
    }
    if (!uploaded) {
      throw new Error(_uploadErrMsg(lastErr));
    }

    // 저장 경로는 ASCII 지만, 다운로드 파일명은 «원본(한글)» 이 되도록 ?download 를 붙인다.
    var pub = sb.storage.from(BUCKET).getPublicUrl(path, { download: file.name });
    var publicUrl = (pub && pub.data && pub.data.publicUrl) || "";

    var row = {
      benefit_key: benefitKey(benefit),
      benefit_name: benefit.name != null ? benefit.name : (benefit.사업명 || ""),
      file_name: file.name,
      storage_path: path,
      public_url: publicUrl,
      size: file.size,
      content_type: file.type || ""
    };
    var ins = await sb.from(TABLE).insert(row).select();
    if (ins.error) {
      // 고아 파일 방지: 테이블 insert 실패하면 방금 올린 객체 롤백
      try { await sb.storage.from(BUCKET).remove([path]); } catch (e) {}
      throw new Error(_tableErrMsg(ins.error));
    }
    return (ins.data && ins.data[0]) || row;
  }

  // ── §5-B 삭제 (Storage + 테이블 동기) ──────────────────────────────
  async function deleteForm(row) {
    var sb = client();
    if (!sb) throw new Error("서버에 연결할 수 없습니다. 잠시 후 다시 시도해 주세요.");
    if (!row) throw new Error("삭제할 서식을 찾을 수 없습니다.");

    var rm = await sb.storage.from(BUCKET).remove([row.storage_path]);
    if (rm.error) throw new Error(_uploadErrMsg(rm.error));
    var del = await sb.from(TABLE).delete().eq("id", row.id);
    if (del.error) throw new Error(_tableErrMsg(del.error));
  }

  // ── 오류 문구(원인별) — 호출부 alert/announce 용 ───────────────────
  function _kind(err) {
    if (typeof navigator !== "undefined" && navigator.onLine === false) return "conn";
    var msg = String((err && (err.message || err.error)) || err || "").toLowerCase();
    var code = String((err && (err.code || err.statusCode || err.status)) || "");
    if (/failed to fetch|networkerror|network error|load failed|timeout|fetch failed/.test(msg)) return "conn";
    if (/^(5\d\d|0|429)$/.test(code)) return "conn";
    if (code === "42501" || code === "401" || code === "403" ||
      /row-level security|\brls\b|permission|policy|not authorized|violates|unauthorized|jwt/.test(msg)) return "perm";
    if (code === "42P01" || code === "PGRST205" || code === "PGRST204" || code === "404" ||
      /does not exist|could not find|not found|schema cache|bucket/.test(msg)) return "setup";
    return "other";
  }
  function _uploadErrMsg(err) {
    var k = _kind(err);
    if (k === "conn") return "⏸ 네트워크가 불안정합니다. 잠시 후 다시 시도해 주세요.";
    if (k === "perm") return "🔒 업로드 권한이 없습니다. 관리자에게 서식 저장소 권한 개방을 요청해 주세요.";
    if (k === "setup") return "🛠 서식 저장소가 아직 준비되지 않았습니다. 관리자에게 forms_storage.sql 적용을 요청해 주세요.";
    return "서식 처리에 실패했습니다: " + ((err && err.message) || "알 수 없는 오류");
  }
  function _tableErrMsg(err) {
    var k = _kind(err);
    if (k === "setup") return "🛠 서식 목록 테이블(benefit_forms)이 아직 없습니다. 관리자에게 forms_storage.sql 적용을 요청해 주세요.";
    return _uploadErrMsg(err);
  }

  return {
    BUCKET: BUCKET,
    useClient: useClient,
    benefitKey: benefitKey,
    sanitizeName: sanitizeName,
    sanitizeFolder: sanitizeFolder,
    validateFile: validateFile,
    formatSize: formatSize,
    listForms: listForms,
    uploadForm: uploadForm,
    deleteForm: deleteForm
  };
})();
