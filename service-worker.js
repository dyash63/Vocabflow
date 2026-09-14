/* VocabFlow service worker
   - Precaches the app shell (index.html, manifest, icons) for offline use
   - Versioned cache name: bump CACHE_VERSION on every deploy to force an update
   - Cleans up old-version caches on activate
   - Network-first for navigations (fresh content when online, cached shell when offline)
   - Cache-first + background revalidate for everything else (icons, CDN scripts, etc.)
*/

const CACHE_VERSION = "v1";
const CACHE_NAME = "vocabflow-" + CACHE_VERSION;

// Paths are relative to this file's location (/Vocabflow/service-worker.js),
// so they resolve correctly under the GitHub Pages project scope.
const APP_SHELL = [
  "./",
  "./index.html",
  "./manifest.json",
  "./icons/icon-180.png",
  "./icons/icon-192.png",
  "./icons/icon-192-maskable.png",
  "./icons/icon-512.png",
  "./icons/icon-512-maskable.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key.startsWith("vocabflow-") && key !== CACHE_NAME)
            .map((key) => caches.delete(key))
        )
      )
      .then(() => self.clients.claim())
  );
});

// Let the page trigger an immediate activation after it detects an update.
self.addEventListener("message", (event) => {
  if (event.data === "SKIP_WAITING") self.skipWaiting();
});

async function networkFirstNavigation(request) {
  const cache = await caches.open(CACHE_NAME);
  try {
    const fresh = await fetch(request);
    cache.put("./index.html", fresh.clone());
    return fresh;
  } catch (err) {
    const cached = (await cache.match(request)) || (await cache.match("./index.html"));
    if (cached) return cached;
    throw err;
  }
}

async function cacheFirstWithRevalidate(request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);

  const networkFetch = fetch(request)
    .then((response) => {
      // Cache good same-origin responses and opaque cross-origin (CDN) responses.
      if (response && (response.ok || response.type === "opaque")) {
        cache.put(request, response.clone());
      }
      return response;
    })
    .catch(() => undefined);

  if (cached) {
    // Serve the cached copy immediately; refresh the cache quietly in the background.
    event_safe(networkFetch);
    return cached;
  }

  const fresh = await networkFetch;
  if (fresh) return fresh;

  return new Response("Offline and no cached version is available yet.", {
    status: 503,
    statusText: "Offline"
  });
}

// Prevents "unhandled promise rejection" noise from the background revalidate fetch.
function event_safe(promise) {
  if (promise && typeof promise.catch === "function") promise.catch(() => {});
}

self.addEventListener("fetch", (event) => {
  const { request } = event;

  if (request.method !== "GET") return;

  if (request.mode === "navigate") {
    event.respondWith(networkFirstNavigation(request));
    return;
  }

  event.respondWith(cacheFirstWithRevalidate(request));
});
