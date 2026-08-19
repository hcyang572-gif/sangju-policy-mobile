/* 상주시 정책플랫폼 — 서비스워커 (PWA 설치 가능 + 오프라인 로딩)
 * 경로는 모두 상대경로(self.registration.scope 기준)로 다뤄
 * GitHub Pages 하위경로(/sangju-policy-mobile/)에서도 깨지지 않게 함.
 *
 * ═══ v30 에서 고친 «구조적 캐시 결함» ══════════════════════════════
 * 증상: 캐시 이름을 v28→v29 로 올렸는데도 이용자에게 옛 화면이 계속 나왔다.
 * 원인: ① GitHub Pages 응답이 Cache-Control: max-age=600 이라 모든 정적 자원이
 *          브라우저 HTTP 캐시에 10분 남는다.
 *       ② 프리캐시가 그 HTTP 캐시를 그대로 타서 «캐시 이름은 새것(v29),
 *          담긴 내용은 옛것» 이 되었다. Request 의 {cache:"reload"} 는
 *          일부 브라우저(특히 iOS 사파리)가 무시한다.
 *       ③ index.html 이 cache-first 라 새 HTML 이 영영 안 내려왔다.
 *       ④ 카카오톡 인앱 브라우저는 서비스워커를 제한해 ①만 남는다.
 * 대책: ① 프리캐시를 «URL 에 1회용 쿼리(swcb)를 붙여 fetch → 정식 키로 put» 방식으로
 *          바꿔, 어떤 브라우저에서도 HTTP 캐시를 확실히 우회한다.
 *       ② 자원 URL 에 배포 버전 쿼리(?v=ASSET_V)를 붙인다. 배포마다 URL 이 달라져
 *          서비스워커가 없는 환경(카톡 인앱 브라우저)에서도 옛 캐시가 잡히지 않는다.
 *          ⚠ index.html 의 참조 문자열과 아래 목록이 «글자 단위로» 같아야 한다.
 *       ③ 문서(navigate) 요청은 network-first(실패 시 캐시)로 바꿨다.
 * ══════════════════════════════════════════════════════════════════ */

// 배포 버전 — 버전정보.json 의 "version" 및 version.js 의 APP_VERSION 과 항상 같은 값.
// ⚠ 손으로 고치지 말고 루트의 `py -3 자원버전_동기화.py` 를 돌리면
//    이 값과 index.html 의 ?v= 쿼리가 한 번에 맞춰진다.
const ASSET_V = "0.4.2";

const CACHE = "sangju-v32";   // v32: 0.4.2 - 하위 경로 문서(/start/)가 앱 홈 캐시를 덮어쓰던 결함 수정
//      [0.4.2 예정] documentFirst 가 /start/ 같은 하위 페이지 응답까지 «앱 홈 캐시 키»에
//      덮어써, 오프라인에서 앱 홈에 안내 페이지가 뜨던 결함 수정(루트 문서일 때만 루트 키에 저장)
//      + activate 가 공무원앱 캐시(sangju-admin-*)까지 지우던 결함 수정(앱 분리 대칭)
// v29: 🎨 시안 A「감빛 온기」 적용(팔레트·헤더 제목/배지·시정구호 확대·눌림 파동 tap.js) + 표기 「상주시 정책플랫폼」 통일
// v28: 🔑 조회코드 «되찾기» 창구 신설(이름+연락처 뒷4자리 → 조회코드만)
// v27: 신청이 클라우드에 저장되지 않던 문제 수정(개인정보 테이블에 RETURNING 금지)

// scope(예: https://hcyang572-gif.github.io/sangju-policy-mobile/)를 기준으로
// 절대 URL을 만들어 둔다. (서브경로/루트 모두 안전)
const SCOPE = self.registration.scope;
const u = (p) => new URL(p, SCOPE).toString();
// 버전 쿼리를 붙인 경로 — index.html 의 참조와 반드시 같은 문자열이어야 한다.
const vq = (p) => p + "?v=" + ASSET_V;

// 이것이 없으면 앱이 «옛 화면»으로 뜨는 자원 — 반드시 새로 받아야 한다.
const ESSENTIAL = [
  "./",
  "index.html",
  vq("style.css"),
  vq("app.js"),
  vq("proposals.js"),
  vq("config.js"),
  vq("version.js"),
  vq("tap.js"),
  vq("forms.js"),
  vq("apply_client.js"),
  "manifest.json",
];
// 없어도 화면 골격은 뜨는 자원(그림). 실패해도 설치를 막지 않는다.
// data.json 은 일부러 제외 — 항상 최신 우선(network-first).
const OPTIONAL = [
  "icon-192.png",
  "icon-512.png",
  "qr.png",
  "assets/sangsang1.png",
  "assets/gotgam.png",
  // 2026 시정구호(홈 첫 화면) — 오프라인에서도 깨지지 않게 미리 담는다.
  // 두 형태를 다 담는 이유: 설치 후 가로/세로 전환이나 태블릿에서 폭이 바뀌면
  // 반대쪽 파일이 필요해지는데, 그때 오프라인이면 이미지가 사라진다.
  "assets/slogan-stack.png",
  "assets/slogan-wide.png",
];

/* 자원 하나를 «HTTP 캐시를 확실히 우회해» 받아 캐시에 담는다.
 * 핵심: 받아올 때는 1회용 쿼리(swcb=CACHE)를 붙여 브라우저가 캐시를 못 쓰게 하고,
 *       담을 때는 쿼리를 뗀 «정식 키»로 담는다. 그래야 페이지가 요청하는 URL 과 맞는다. */
async function precacheOne(cache, path) {
  const key = u(path);                                   // 캐시에 담을 정식 키
  const bust = key + (key.includes("?") ? "&" : "?") + "swcb=" + CACHE;
  const res = await fetch(new Request(bust, { cache: "reload", credentials: "same-origin" }));
  if (!res || !res.ok) throw new Error("HTTP " + (res ? res.status : "?"));
  await cache.put(key, res);
  return true;
}

// 설치: 자원을 «네트워크에서 새로» 받아 담는다. 하나가 실패해도 설치는 계속한다
// (fetch 핸들러가 캐시 미스 시 네트워크로 다시 받아 스스로 메운다).
self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      let ok = 0, fail = 0;
      await Promise.all(
        ESSENTIAL.map(async (p) => {
          try { await precacheOne(cache, p); ok++; }
          catch (e) { fail++; console.error("[sw] 핵심 자원 프리캐시 실패:", p, e); }
        })
      );
      await Promise.all(
        OPTIONAL.map(async (p) => {
          try { await precacheOne(cache, p); ok++; }
          catch (e) { fail++; console.warn("[sw] 보조 자원 프리캐시 실패(무시):", p, e); }
        })
      );
      console.log("[sw] " + CACHE + " 프리캐시 완료 — 성공 " + ok + " · 실패 " + fail);
      // 새 서비스워커가 곧바로 대기 상태를 건너뛰도록(업데이트 빠르게 적용)
      await self.skipWaiting();
    })()
  );
});

// 활성화: 이 앱의 현재 캐시(CACHE) 외 '시민앱' 옛 캐시만 정리.
// ⚠ Cache Storage 는 «origin 전체가 공유»한다 — 서비스워커 scope 로 격리되지 않는다.
//    caches.keys() 는 scope 와 무관하게 이 origin 의 모든 캐시 이름을 돌려준다.
//    예전엔 (k !== CACHE) 로 «자기 것 빼고 전부» 지웠는데, 그러면 같은 브라우저로
//    공무원앱(/admin/)을 열어 본 이용자는 시민앱 워커가 활성화될 때마다
//    공무원앱 캐시(sangju-admin-*)까지 함께 날아갔다(= 공무원앱이 매번 오프라인 불가).
//    시민앱 접두사 "sangju-" 는 "sangju-admin-" 도 포함하므로 «반드시» 따로 제외한다.
//    → 공무원앱 sw.js 의 「시민앱 캐시는 같은 origin 이라도 건드리지 않는다」와 짝을 이룬다.
//    이 필터를 startsWith("sangju-") 하나로 «단순화하지 말 것».
self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((k) => k.startsWith("sangju-") && !k.startsWith("sangju-admin-") && k !== CACHE)
          .map((k) => caches.delete(k))
      );
      // 열려 있는 모든 탭을 즉시 이 서비스워커가 제어
      await self.clients.claim();
    })()
  );
});

// 메시지: 페이지에서 새 워커 즉시 적용 요청 시 처리
self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") self.skipWaiting();
});

// fetch: 크롬 설치조건 충족을 위해 반드시 핸들러 등록.
// 전략
//  - GET 이외 / 타 출처(Web3Forms 등) 요청은 가로채지 않고 통과(네트워크 그대로).
//  - 문서(navigate) = index.html: network-first (최신 HTML 우선) + 실패 시 캐시 폴백.
//  - data.json: network-first (최신 우선) + 실패 시 캐시 폴백.
//  - 그 외 동일 출처 정적 자원: cache-first + 받아오면 캐시에 보관.
//    (자원은 ?v= 버전 쿼리를 달고 있어, 배포가 바뀌면 URL 자체가 달라져 새로 받는다)
self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  let url;
  try {
    url = new URL(req.url);
  } catch (e) {
    return; // 파싱 불가하면 가로채지 않음
  }

  // 동일 출처가 아니면(외부 API·CDN 등) 그대로 네트워크로 통과
  if (url.origin !== self.location.origin) return;

  // 공무원앱(/admin/) 경로는 시민 서비스워커가 가로채지 않고 통과.
  // → 공무원앱은 자체 서비스워커(sangju-admin-*)가 제어한다(두 앱 완전 분리).
  if (url.pathname.includes("/admin/")) return;

  // 화면(HTML) — 항상 최신 우선. 여기서 최신 HTML 이 내려오면
  // 나머지 자원은 ?v= 쿼리를 타고 자동으로 새 것이 따라온다.
  if (req.mode === "navigate" || url.pathname.endsWith("/") || url.pathname.endsWith("index.html")) {
    event.respondWith(documentFirst(req));
    return;
  }

  // 데이터는 항상 최신을 우선 — network-first
  if (url.pathname.endsWith("data.json")) {
    event.respondWith(networkFirst(req));
    return;
  }

  // 정적 자원 — cache-first
  event.respondWith(cacheFirst(req));
});

// 이 앱의 «루트 문서»인지 판별한다 — documentFirst 가 루트 키에 캐시해도 되는 경우.
// ⚠ scope 아래에는 루트 말고도 «/» 로 끝나는 다른 페이지가 있다(예: 시민앱 안내 페이지 /start/).
//    fetch 라우팅은 pathname.endsWith("/") 만 보므로 그런 페이지도 documentFirst 를 탄다.
//    예전엔 성공 응답을 무조건 u("index.html")·u("./") 에 넣었는데, 그러면 이용자가
//    /start/ 를 한 번만 열어도 «앱 홈의 캐시된 HTML 이 안내 페이지로 덮어써져»
//    오프라인·불안정 네트워크에서 앱 홈에 안내 페이지가 뜬다(카톡 공유 경로에서 흔함).
//    → 루트일 때만 루트 키에 담고, 하위 페이지는 «아예 담지 않는다»(프리캐시 대상도 아님).
//    이 조건을 «성공하면 무조건 캐시»로 단순화하지 말 것.
const SCOPE_PATH = new URL(SCOPE).pathname;
function isAppRoot(href) {
  try {
    const p = new URL(href).pathname;
    return p === SCOPE_PATH || p === SCOPE_PATH + "index.html";
  } catch (e) {
    return false;
  }
}

// 문서 network-first: HTTP 캐시를 건너뛰고(서버 재검증) 받아온다. 실패 시 캐시 폴백.
async function documentFirst(req) {
  const cache = await caches.open(CACHE);
  const root = isAppRoot(req.url);          // 루트 문서일 때만 루트 키를 건드린다
  try {
    const res = await fetch(new Request(req.url, {
      cache: "no-cache",            // 서버에 재검증 — 옛 HTML 이 10분간 남던 문제 차단
      credentials: "same-origin",
      redirect: "follow",
    }));
    if (res && res.ok && res.type === "basic" && root) {
      cache.put(u("index.html"), res.clone());
      cache.put(u("./"), res.clone());
    }
    return res;
  } catch (e) {
    // 루트가 아닌 문서(/start/ 등)는 «자기 URL 로 담긴 것만» 폴백한다.
    // 앱 홈 HTML 을 대신 내주면 주소는 /start/ 인데 내용은 앱인 «가짜 화면»이 된다.
    const cached = (await cache.match(req)) || (root ? await cache.match(u("index.html")) : null);
    if (cached) return cached;
    throw e;
  }
}

// network-first: 네트워크 성공 시 캐시 갱신 후 반환, 실패 시 캐시 폴백
async function networkFirst(req) {
  const cache = await caches.open(CACHE);
  try {
    const res = await fetch(req);
    if (res && res.ok) cache.put(req, res.clone());
    return res;
  } catch (e) {
    const cached = await cache.match(req);
    if (cached) return cached;
    throw e;
  }
}

// cache-first: 캐시에 있으면 즉시 반환, 없으면 네트워크 후 캐시에 보관
async function cacheFirst(req) {
  const cache = await caches.open(CACHE);
  const cached = await cache.match(req);
  if (cached) return cached;
  try {
    const res = await fetch(req);
    // 정상(기본/200) 응답만 캐시(불투명·오류 응답 캐시 방지)
    if (res && res.ok && res.type === "basic") cache.put(req, res.clone());
    return res;
  } catch (e) {
    // 네트워크 실패 시, 탐색(navigate) 요청이면 index.html 로 폴백
    if (req.mode === "navigate") {
      const fallback = await cache.match(u("index.html"));
      if (fallback) return fallback;
    }
    throw e;
  }
}
