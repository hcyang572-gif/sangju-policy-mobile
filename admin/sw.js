/* 상주정책(공무원용) — 서비스워커 (PWA 설치 + 오프라인 로딩)
 * 경로는 모두 상대경로(self.registration.scope 기준 = /sangju-policy-mobile/admin/)로 다뤄
 * 시민앱 서비스워커와 캐시·범위가 완전히 분리되도록 CACHE 이름을 다르게 둔다.
 * 캐시 버전을 올리려면 아래 CACHE 값을 바꾸면 됨(예: sangju-admin-v2). */
const CACHE = "sangju-admin-v3";

// scope(예: https://hcyang572-gif.github.io/sangju-policy-mobile/admin/)를 기준으로
// 절대 URL을 만들어 둔다. (서브경로에서도 안전)
const SCOPE = self.registration.scope;
const u = (p) => new URL(p, SCOPE).toString();

// 미리 캐시할 공무원앱(/admin/) 자체 정적 자원만(상대경로).
const PRECACHE = [
  "./",
  "index.html",
  "style.css",
  "app.js",
  "config.js",
  "manifest.json",
  "assets/icon-admin-192.png",
  "assets/icon-admin-512.png",
  "assets/sangsang1.png",
  "assets/gotgam.png",
];

// 설치: 핵심 자원을 미리 담되, 하나가 실패해도 install 전체가 실패하지 않게 개별 try/catch.
self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      await Promise.all(
        PRECACHE.map(async (p) => {
          try {
            await cache.add(new Request(u(p), { cache: "reload" }));
          } catch (e) {
            console.warn("[admin-sw] precache 실패(무시):", p, e);
          }
        })
      );
      await self.skipWaiting();
    })()
  );
});

// 활성화: 이 앱의 현재 캐시(CACHE) 외 '관리자' 옛 캐시만 정리.
// 시민앱 캐시(sangju-*)는 같은 origin이라도 건드리지 않는다(앱 분리).
self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((k) => k.startsWith("sangju-admin-") && k !== CACHE)
          .map((k) => caches.delete(k))
      );
      await self.clients.claim();
    })()
  );
});

// 메시지: 새 워커 즉시 적용 요청 처리
self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") self.skipWaiting();
});

// fetch: 크롬 설치조건 충족을 위해 핸들러 등록.
//  - GET 이외 / 타 출처(Supabase·CDN 등) 요청은 가로채지 않고 통과(네트워크 그대로).
//  - 이 서비스워커는 자신의 scope(/admin/) 하위만 제어한다(브라우저 기본 동작).
//  - 동일 출처 정적 자원: cache-first + 받아오면 캐시에 보관.
self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  let url;
  try {
    url = new URL(req.url);
  } catch (e) {
    return;
  }

  // 동일 출처가 아니면(Supabase API·CDN 등) 그대로 네트워크로 통과
  if (url.origin !== self.location.origin) return;

  // 정적 자원 — cache-first
  event.respondWith(cacheFirst(req));
});

// cache-first: 캐시에 있으면 즉시 반환, 없으면 네트워크 후 캐시에 보관
async function cacheFirst(req) {
  const cache = await caches.open(CACHE);
  const cached = await cache.match(req);
  if (cached) return cached;
  try {
    const res = await fetch(req);
    if (res && res.ok && res.type === "basic") cache.put(req, res.clone());
    return res;
  } catch (e) {
    if (req.mode === "navigate") {
      const fallback = await cache.match(u("index.html"));
      if (fallback) return fallback;
    }
    throw e;
  }
}
