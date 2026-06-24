// 상주시 정책 플랫폼 — 클라우드(Supabase) 사업 관리
const sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
const $ = (s) => document.querySelector(s);

let ALL = [], CATS = [], SELCATS = new Set(), sortKey = "seq", page = 0;
const PAGE = 12;
let IS_GUEST = false; // 임시 공개(로그인 없이 입장) 여부

function debounce(fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }
function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[m])); }
function el(t, c) { const e = document.createElement(t); if (c) e.className = c; return e; }

// 기존 세션 있으면 바로 앱
(async () => {
  const { data: { session } } = await sb.auth.getSession();
  if (session) showApp();
})();

$("#loginBtn").onclick = login;
$("#pw").addEventListener("keydown", (e) => { if (e.key === "Enter") login(); });
$("#email").addEventListener("keydown", (e) => { if (e.key === "Enter") $("#pw").focus(); });

// 임시 공개: 로그인 없이 입장(게스트). 정식 로그인은 그대로 유지.
$("#guestBtn").onclick = () => { IS_GUEST = true; showApp(); };
$("#guestBannerClose").onclick = () => $("#guestBanner").classList.add("hidden");

async function login() {
  const email = $("#email").value.trim(), password = $("#pw").value;
  if (!email || !password) { $("#loginErr").textContent = "이메일과 비밀번호를 입력하세요."; return; }
  $("#loginErr").textContent = "로그인 중...";
  const { error } = await sb.auth.signInWithPassword({ email, password });
  if (error) { $("#loginErr").textContent = "로그인 실패: " + error.message; return; }
  showApp();
}

async function showApp() {
  $("#login").classList.add("hidden");
  $("#app").classList.remove("hidden");
  // 게스트(임시 공개)면 안내 배너 표시 + 로그아웃 버튼 문구를 자연스럽게
  if (IS_GUEST) {
    $("#guestBanner").classList.remove("hidden");
    $("#btnLogout").textContent = "로그인 화면으로";
  }
  bindUI();
  bindProposalsUI();
  await loadBenefits();
  subscribeRealtime();
  // 정책제안: 탭 진입 시 1회 로드(초기엔 비활성 섹션이라 미로드 → 첫 탭 전환에서 로드)
  subscribeProposalsRealtime();
}

function bindUI() {
  $("#search").addEventListener("input", debounce(() => { page = 0; render(); }, 300));
  $("#sortSel").addEventListener("change", () => { sortKey = $("#sortSel").value; render(); });
  $("#btnAdd").onclick = () => openEdit(null);
  $("#btnLogout").onclick = async () => {
    // 게스트면 세션이 없으므로 그냥 로그인 화면으로 복귀
    if (!IS_GUEST) { try { await sb.auth.signOut(); } catch (e) {} }
    location.reload();
  };
  $("#mClose").onclick = () => $("#modal").classList.add("hidden");
  $("#modal").addEventListener("click", (e) => { if (e.target.id === "modal") $("#modal").classList.add("hidden"); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") $("#modal").classList.add("hidden"); });
}

async function loadBenefits() {
  const { data, error } = await sb.from("benefits").select("*").order("seq", { nullsFirst: false }).order("id");
  if (error) { console.error(error); $("#list").innerHTML = `<div class="empty">불러오기 실패: ${esc(error.message)}</div>`; return; }
  ALL = data || [];
  CATS = [...new Set(ALL.flatMap((r) => r.categories || []))].sort();
  $("#dbInfo").textContent = `사업 ${ALL.length}건 · 실시간`;
  renderCats();
  render();
}

function subscribeRealtime() {
  sb.channel("benefits-rt")
    .on("postgres_changes", { event: "*", schema: "public", table: "benefits" }, () => loadBenefits())
    .subscribe((status) => { $("#realtimeDot").classList.toggle("off", status !== "SUBSCRIBED"); });
}

function renderCats() {
  const box = $("#catChips"); box.innerHTML = "";
  CATS.forEach((cat) => {
    const c = el("button", "chip" + (SELCATS.has(cat) ? " on" : ""));
    c.textContent = cat;
    c.onclick = () => { SELCATS.has(cat) ? SELCATS.delete(cat) : SELCATS.add(cat); page = 0; renderCats(); render(); };
    box.appendChild(c);
  });
}

function render() {
  const q = $("#search").value.trim().toLowerCase();
  let rows = ALL.filter((r) => {
    if (SELCATS.size) {
      const rc = r.categories || [];
      if (![...SELCATS].some((c) => rc.includes(c))) return false;
    }
    if (q) {
      const blob = `${r.name || ""} ${r.team || ""} ${r.content || ""} ${r.target || ""}`.toLowerCase();
      if (!blob.includes(q)) return false;
    }
    return true;
  });
  if (sortKey === "name") rows.sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")));
  $("#count").textContent = `총 ${rows.length}건`;
  const list = $("#list");
  if (!rows.length) { list.innerHTML = '<div class="empty">조건에 맞는 사업이 없습니다.</div>'; $("#pager").innerHTML = ""; return; }
  const pages = Math.ceil(rows.length / PAGE); if (page >= pages) page = pages - 1; if (page < 0) page = 0;
  const slice = rows.slice(page * PAGE, page * PAGE + PAGE);
  list.innerHTML = "";
  slice.forEach((r) => {
    const team = (r.team || "").trim();
    const content = (r.content || "").replace(/\s+/g, " ").trim();
    const card = el("div", "card");
    card.innerHTML = `<div class="card-main">
        <div class="card-title">📂 ${esc(r.name)}</div>
        <div class="card-desc">${esc(content.slice(0, 90)) || "—"}</div>
      </div>
      <span class="badge ${team ? "" : "warn"}">${team ? esc(team) : "담당팀 확인 필요"}</span>`;
    card.onclick = () => openEdit(r);
    list.appendChild(card);
  });
  renderPager(rows.length, pages);
}

function renderPager(total, pages) {
  const wrap = $("#pager"); wrap.innerHTML = "";
  if (pages <= 1) return;
  const bar = el("div", "pager");
  const mk = (label, p, dis, act) => { const b = el("button", "page-btn" + (act ? " on" : "")); b.textContent = label; if (dis) b.disabled = true; else b.onclick = () => { page = p; render(); }; bar.appendChild(b); };
  mk("‹", page - 1, page <= 0);
  let s = Math.max(0, page - 4), e = Math.min(pages, s + 9); s = Math.max(0, e - 9);
  for (let p = s; p < e; p++) mk(String(p + 1), p, false, p === page);
  mk("›", page + 1, page >= pages - 1);
  wrap.appendChild(bar);
}

// 추가/수정/삭제
const FIELDS = [
  ["사업명", "name", false], ["담당팀", "team", false], ["담당 연락처", "contact", false],
  ["담당자 이메일", "manager_email", false], ["지원 대상", "target", true],
  ["사업 내용", "content", true], ["이용 방법", "method", true], ["필요 서류", "documents", true],
];
// 저장/삭제 실패 메시지: RLS(권한) 거부면 임시공개 안내로 친절하게.
function writeErrMsg(error, verb) {
  const msg = (error && error.message ? error.message : "").toLowerCase();
  const code = error && error.code ? String(error.code) : "";
  const isPerm =
    code === "42501" || // insufficient_privilege (Postgres)
    msg.includes("row-level security") ||
    msg.includes("rls") ||
    msg.includes("permission") ||
    msg.includes("policy") ||
    msg.includes("not authorized") ||
    msg.includes("violates");
  if (isPerm) {
    return "⚠️ 저장 권한이 없습니다.\n아직 임시공개 권한 적용 전이거나 로그인이 필요합니다.\n(관리자에게 권한 개방을 요청하거나 로그인 후 다시 시도해 주세요.)";
  }
  return `${verb} 실패: ` + (error && error.message ? error.message : "알 수 없는 오류");
}

function openEdit(r) {
  $("#mTitle").textContent = r ? "✏ 사업 수정" : "➕ 새 사업 추가";
  let html = "";
  FIELDS.forEach(([label, key, multi]) => {
    const v = r ? (r[key] || "") : "";
    html += `<div class="field"><div class="field-label">${label}</div>` +
      (multi ? `<textarea class="form-textarea" data-k="${key}">${esc(v)}</textarea>`
             : `<input class="form-input" data-k="${key}" value="${esc(v)}">`) + `</div>`;
  });
  html += `<div class="modal-actions"><button id="mSave" class="top-btn solid">💾 저장</button>` +
    (r ? `<button id="mDel" class="top-btn danger">🗑 삭제</button>` : ``) + `</div>`;
  $("#mBody").innerHTML = html;
  $("#mSave").onclick = async () => {
    const obj = {};
    document.querySelectorAll("#mBody [data-k]").forEach((e) => { obj[e.dataset.k] = e.value; });
    if (!(obj.name || "").trim()) { alert("사업명을 입력하세요."); return; }
    if (r) {
      // 낙관적 잠금: 내가 연 이후 다른 담당자가 먼저 수정했는지 updated_at으로 확인
      const { data, error } = await sb.from("benefits")
        .update(obj).eq("id", r.id).eq("updated_at", r.updated_at).select();
      if (error) { alert(writeErrMsg(error, "저장")); return; }
      if (!data || !data.length) {
        alert("⚠️ 다른 담당자가 먼저 이 사업을 수정했습니다.\n최신 내용으로 새로고침하니, 다시 확인 후 수정해 주세요.");
        $("#modal").classList.add("hidden");
        await loadBenefits();
        return;
      }
    } else {
      const { error } = await sb.from("benefits").insert(obj);
      if (error) { alert(writeErrMsg(error, "저장")); return; }
    }
    $("#modal").classList.add("hidden");
    await loadBenefits();
  };
  if (r) $("#mDel").onclick = async () => {
    if (!confirm("이 사업을 삭제하시겠습니까?")) return;
    const res = await sb.from("benefits").delete().eq("id", r.id);
    if (res.error) { alert(writeErrMsg(res.error, "삭제")); return; }
    $("#modal").classList.add("hidden");
    await loadBenefits();
  };
  $("#modal").classList.remove("hidden");
}

/* ============================================================
   🗳 정책제안 관리 (Phase A) — proposals / proposal_reports
   기존 사업관리·로그인·게스트·실시간 무손상. 추가 모듈.
   ============================================================ */
const P_STATUSES = ["접수", "검토중", "반영", "불채택", "보류"];
const REPLY_REQUIRED = new Set(["반영", "불채택"]); // 전환 시 답변/사유 필수
let PALL = [], PCATS = [], P_SELCAT = new Set(), P_STATUS = "전체";
let pSort = "new", pPage = 0, P_LOADED = false;
let P_REPORTS = {}; // proposal_id -> 신고 건수
let pCurrentTab = "benefits";

function bindProposalsUI() {
  $("#tabBenefits").onclick = () => switchTab("benefits");
  $("#tabProposals").onclick = () => switchTab("proposals");
  $("#pSearch").addEventListener("input", debounce(() => { pPage = 0; renderProposals(); }, 300));
  $("#pSortSel").addEventListener("change", () => { pSort = $("#pSortSel").value; renderProposals(); });
  $("#pmClose").onclick = () => $("#pModal").classList.add("hidden");
  $("#pModal").addEventListener("click", (e) => { if (e.target.id === "pModal") $("#pModal").classList.add("hidden"); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") $("#pModal").classList.add("hidden"); });
}

function switchTab(which) {
  pCurrentTab = which;
  const onBenefits = which === "benefits";
  $("#tabBenefits").classList.toggle("on", onBenefits);
  $("#tabProposals").classList.toggle("on", !onBenefits);
  $("#secBenefits").classList.toggle("hidden", !onBenefits);
  $("#secProposals").classList.toggle("hidden", onBenefits);
  if (!onBenefits && !P_LOADED) loadProposals();
}

async function loadProposals() {
  // 공무원은 숨김(is_hidden) 글도 모두 본다 → 필터 없이 전체 조회
  const { data, error } = await sb.from("proposals").select("*").order("created_at", { ascending: false });
  if (error) {
    console.error(error);
    $("#pList").innerHTML = `<div class="empty">불러오기 실패: ${esc(writeErrMsg(error, "불러오기"))}</div>`;
    return;
  }
  PALL = data || [];
  PCATS = [...new Set(PALL.map((r) => r.category).filter(Boolean))].sort();
  P_LOADED = true;
  await loadReportCounts();
  renderPStatusChips();
  renderPCatChips();
  renderProposals();
}

// 신고 건수 집계(신고 확인 표시용). 권한 없으면 조용히 건너뜀.
async function loadReportCounts() {
  P_REPORTS = {};
  try {
    const { data, error } = await sb.from("proposal_reports").select("proposal_id");
    if (error) { return; }
    (data || []).forEach((r) => { P_REPORTS[r.proposal_id] = (P_REPORTS[r.proposal_id] || 0) + 1; });
  } catch (e) { /* 무시 */ }
}

function subscribeProposalsRealtime() {
  sb.channel("proposals-rt")
    .on("postgres_changes", { event: "*", schema: "public", table: "proposals" }, () => { if (P_LOADED) loadProposals(); })
    .subscribe();
}

function renderPStatusChips() {
  const box = $("#pStatusChips"); box.innerHTML = "";
  ["전체", ...P_STATUSES].forEach((st) => {
    const c = el("button", "chip" + (P_STATUS === st ? " on" : ""));
    c.textContent = st;
    c.onclick = () => { P_STATUS = st; pPage = 0; renderPStatusChips(); renderProposals(); };
    box.appendChild(c);
  });
}

function renderPCatChips() {
  const box = $("#pCatChips"); box.innerHTML = "";
  PCATS.forEach((cat) => {
    const c = el("button", "chip" + (P_SELCAT.has(cat) ? " on" : ""));
    c.textContent = cat;
    c.onclick = () => { P_SELCAT.has(cat) ? P_SELCAT.delete(cat) : P_SELCAT.add(cat); pPage = 0; renderPCatChips(); renderProposals(); };
    box.appendChild(c);
  });
}

function fmtDate(s) {
  if (!s) return "";
  const d = new Date(s); if (isNaN(d)) return String(s).slice(0, 10);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function renderProposals() {
  const q = $("#pSearch").value.trim().toLowerCase();
  let rows = PALL.filter((r) => {
    if (P_STATUS !== "전체" && (r.status || "접수") !== P_STATUS) return false;
    if (P_SELCAT.size && !P_SELCAT.has(r.category)) return false;
    if (q) {
      const blob = `${r.title || ""} ${r.body || ""} ${r.author_nick || ""} ${r.region || ""}`.toLowerCase();
      if (!blob.includes(q)) return false;
    }
    return true;
  });
  if (pSort === "like") rows.sort((a, b) => (b.like_count || 0) - (a.like_count || 0));
  else rows.sort((a, b) => String(b.created_at || "").localeCompare(String(a.created_at || "")));

  $("#pCount").textContent = `총 ${rows.length}건`;
  const list = $("#pList");
  if (!rows.length) { list.innerHTML = '<div class="empty">조건에 맞는 제안이 없습니다.</div>'; $("#pPager").innerHTML = ""; return; }

  const pages = Math.ceil(rows.length / PAGE);
  if (pPage >= pages) pPage = pages - 1; if (pPage < 0) pPage = 0;
  const slice = rows.slice(pPage * PAGE, pPage * PAGE + PAGE);
  list.innerHTML = "";
  slice.forEach((r) => {
    const st = r.status || "접수";
    const reps = P_REPORTS[r.id] || 0;
    const card = el("div", "pcard" + (r.is_hidden ? " hidden-row" : ""));
    card.innerHTML = `<div class="pcard-main">
        <div class="pcard-top">
          <span class="st-badge st-${esc(st)}">${esc(st)}</span>
          ${r.category ? `<span class="cat-tag">${esc(r.category)}</span>` : ""}
          ${r.is_hidden ? `<span class="hide-tag">🚫 블라인드</span>` : ""}
          ${reps ? `<span class="report-tag">🚩 신고 ${reps}</span>` : ""}
        </div>
        <div class="pcard-title">${esc(r.title)}</div>
        <div class="pcard-meta">
          <span class="like-tag">👍 ${r.like_count || 0}</span>
          <span>🙍 ${esc(r.author_nick || "익명")}${r.region ? " · " + esc(r.region) : ""}</span>
          <span>🗓 ${esc(fmtDate(r.created_at))}</span>
        </div>
      </div>`;
    card.onclick = () => openProposal(r);
    list.appendChild(card);
  });
  renderPPager(rows.length, pages);
}

function renderPPager(total, pages) {
  const wrap = $("#pPager"); wrap.innerHTML = "";
  if (pages <= 1) return;
  const bar = el("div", "pager");
  const mk = (label, p, dis, act) => {
    const b = el("button", "page-btn" + (act ? " on" : "")); b.textContent = label;
    if (dis) b.disabled = true; else b.onclick = () => { pPage = p; renderProposals(); };
    bar.appendChild(b);
  };
  mk("‹", pPage - 1, pPage <= 0);
  let s = Math.max(0, pPage - 4), e = Math.min(pages, s + 9); s = Math.max(0, e - 9);
  for (let p = s; p < e; p++) mk(String(p + 1), p, false, p === pPage);
  mk("›", pPage + 1, pPage >= pages - 1);
  wrap.appendChild(bar);
}

async function openProposal(r) {
  $("#pmTitle").textContent = "🗳 정책제안 검토";
  const st = r.status || "접수";
  const reps = P_REPORTS[r.id] || 0;
  const optHtml = P_STATUSES.map((s) => `<option value="${s}"${s === st ? " selected" : ""}>${s}</option>`).join("");

  $("#pmBody").innerHTML = `
    <div class="pcard-top" style="margin-bottom:10px;">
      <span class="st-badge st-${esc(st)}">${esc(st)}</span>
      ${r.category ? `<span class="cat-tag">${esc(r.category)}</span>` : ""}
      ${r.is_hidden ? `<span class="hide-tag">🚫 블라인드</span>` : ""}
    </div>
    <div class="field"><div class="field-label">제목</div><div class="field-value">${esc(r.title)}</div></div>
    <div class="field"><div class="field-label">작성</div><div class="field-value">🙍 ${esc(r.author_nick || "익명")}${r.region ? " · " + esc(r.region) : ""} · 🗓 ${esc(fmtDate(r.created_at))} · 👍 ${r.like_count || 0}</div></div>
    <div class="field"><div class="field-label">내용</div><div class="pm-body-text">${esc(r.body || "")}</div></div>
    ${reps ? `<div class="field"><div class="field-label">🚩 신고 ${reps}건</div><div id="pmReports" class="pm-reports">불러오는 중…</div></div>` : ""}
    <div class="field">
      <div class="field-label">진행 상태 변경</div>
      <select id="pmStatus" class="st-select">${optHtml}</select>
    </div>
    <div class="field">
      <div class="field-label">💬 담당부서 답변 / 사유 <span style="color:#C0392B;font-weight:700;">(반영·불채택 전환 시 필수)</span></div>
      <textarea id="pmReply" class="form-textarea" placeholder="시민에게 공개되는 공식 답변·사유를 입력하세요.">${esc(r.admin_reply || "")}</textarea>
    </div>
    <div class="field">
      <label class="toggle-line"><input type="checkbox" id="pmHidden"${r.is_hidden ? " checked" : ""}> 🚫 블라인드(부적절 글 숨김) — 체크 시 시민에게 안 보임</label>
    </div>
    <div class="modal-actions">
      <button id="pmSave" class="nav-btn">💾 저장</button>
    </div>`;

  if (reps) loadReportDetail(r.id);

  $("#pmSave").onclick = async () => {
    const newStatus = $("#pmStatus").value;
    const reply = ($("#pmReply").value || "").trim();
    const isHidden = $("#pmHidden").checked;
    // 반영·불채택 전환 시 답변 필수
    if (REPLY_REQUIRED.has(newStatus) && !reply) {
      alert(`'${newStatus}' 상태로 변경하려면 담당부서 답변/사유를 반드시 입력해야 합니다.`);
      $("#pmReply").focus();
      return;
    }
    const patch = {
      status: newStatus,
      admin_reply: reply || null,
      is_hidden: isHidden,
      updated_at: new Date().toISOString(),
    };
    const { error } = await sb.from("proposals").update(patch).eq("id", r.id);
    if (error) { alert(writeErrMsg(error, "저장")); return; }
    $("#pModal").classList.add("hidden");
    await loadProposals();
  };

  $("#pModal").classList.remove("hidden");
}

async function loadReportDetail(proposalId) {
  const box = $("#pmReports");
  if (!box) return;
  const { data, error } = await sb.from("proposal_reports")
    .select("reason, created_at").eq("proposal_id", proposalId).order("created_at", { ascending: false });
  if (error) { box.textContent = "신고 내역 조회 권한이 없습니다."; return; }
  if (!data || !data.length) { box.textContent = "신고 내역 없음"; return; }
  box.innerHTML = data.map((x) =>
    `<div class="pm-rep-item">• ${esc(x.reason || "(사유 없음)")} <span style="opacity:.6;">(${esc(fmtDate(x.created_at))})</span></div>`
  ).join("");
}
