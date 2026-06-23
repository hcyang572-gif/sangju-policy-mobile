// 상주시 정책 플랫폼 — 클라우드(Supabase) 사업 관리
const sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
const $ = (s) => document.querySelector(s);

let ALL = [], CATS = [], SELCATS = new Set(), sortKey = "seq", page = 0;
const PAGE = 12;

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
  bindUI();
  await loadBenefits();
  subscribeRealtime();
}

function bindUI() {
  $("#search").addEventListener("input", debounce(() => { page = 0; render(); }, 300));
  $("#sortSel").addEventListener("change", () => { sortKey = $("#sortSel").value; render(); });
  $("#btnAdd").onclick = () => openEdit(null);
  $("#btnLogout").onclick = async () => { await sb.auth.signOut(); location.reload(); };
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
      if (error) { alert("저장 실패: " + error.message); return; }
      if (!data || !data.length) {
        alert("⚠️ 다른 담당자가 먼저 이 사업을 수정했습니다.\n최신 내용으로 새로고침하니, 다시 확인 후 수정해 주세요.");
        $("#modal").classList.add("hidden");
        await loadBenefits();
        return;
      }
    } else {
      const { error } = await sb.from("benefits").insert(obj);
      if (error) { alert("저장 실패: " + error.message); return; }
    }
    $("#modal").classList.add("hidden");
    await loadBenefits();
  };
  if (r) $("#mDel").onclick = async () => {
    if (!confirm("이 사업을 삭제하시겠습니까?")) return;
    const res = await sb.from("benefits").delete().eq("id", r.id);
    if (res.error) { alert("삭제 실패: " + res.error.message); return; }
    $("#modal").classList.add("hidden");
    await loadBenefits();
  };
  $("#modal").classList.remove("hidden");
}
