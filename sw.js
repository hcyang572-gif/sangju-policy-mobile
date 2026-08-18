/* 상주시 정책플랫폼 — 서비스워커 (PWA 설치 가능 + 오프라인 로딩)
 * 경로는 모두 상대경로(self.registration.scope 기준)로 다뤄
 * GitHub Pages 하위경로(/sangju-policy-mobile/)에서도 깨지지 않게 함.
 * 캐시 버전을 올리려면 아래 CACHE 값을 바꾸면 됨(예: sangju-v2). */
// ⚠ v25: 「내 신청 현황」 화면 신설(index.html·app.js·style.css·apply_client.js).
//    index.html·app.js 는 cache-first 라 «캐시 버전을 올리지 않으면» 기존 이용자에게
//    새 화면이 없는 구버전이 계속 제공된다(진입점이 영영 안 보임).
const CACHE = "sangju-v29";   // v29: 🎨 시안 A「감빛 온기」 적용(팔레트·헤더 제목/배지·시정구호 확대·눌림 파동 tap.js) + 표기 「상주시 정책플랫폼」 통일
// v28: 🔑 조회코드 «되찾기» 창구 신설(이름+연락처 뒷4자리 → 조회코드만)
// v27: 신청이 클라우드에 저장되지 않던 문제 수정(개인정보 테이블에 RETURNING 금지)

// scope(예: https://hcyang572-gif.github.io/sangju-policy-mobile/)를 기준으로
// 절대 URL을 만들어 둔다. (서브경로/루트 모두 안전)
const SCOPE = self.registration.scope;
const u = (p) => new URL(p, SCOPE).toString();

// 미리 캐시할 핵심 정적 자원(상대경로). data.json은 일부러 제외(항상 최신 우선).
const PRECACHE = [
  "./",
  "index.html",
  "style.css",
  "app.js",
  "proposals.js",
  "config.js",
  "version.js",
  "tap.js",
  "forms.js",
  "apply_client.js",
  "manifest.json",
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

// 설치: 핵심 자원을 미리 담되, 하나가 실패해도 install 전체가 실패하지 않게
// 개별 add 를 try/catch 로 감싼다.
self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      await Promise.all(
        PRECACHE.map(async (p) => {
          try {
            await cache.add(new Request(u(p), { cache: "reload" }));
          } catch (e) {
            // 일부 자원이 없거나 실패해도 무시(설치 계속 진행)
            console.warn("[sw] precache 실패(무시):", p, e);
          }
        })
      );
      // 새 서비스워커가 곧바로 대기 상태를 건너뛰도록(업데이트 빠르게 적용)
      await self.skipWaiting();
    })()
  );
});

// 활성화: 현재 버전(CACHE)이 아닌 옛 캐시를 정리한다.
self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))
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
//  - data.json: network-first (최신 우선) + 실패 시 캐시 폴백.
//  - 그 외 동일 출처 정적 자원: cache-first + 받아오면 캐시에 보관.
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

  // 데이터는 항상 최신을 우선 — network-first
  if (url.pathname.endsWith("/data.json") || url.pathname.endsWith("data.json")) {
    event.respondWith(networkFirst(req));
    return;
  }

  // 정적 자원 — cache-first
  event.respondWith(cacheFirst(req));
});

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
