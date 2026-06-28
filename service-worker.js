/* ============================================================================
 *  PescaCorral · Service Worker
 *  Cachea el "app shell" para funcionamiento offline e instalación (PWA).
 *  Estrategia:
 *   - Navegación (HTML): network-first con fallback a index.html (SPA).
 *   - Recursos propios (css/js/icons/vendor): stale-while-revalidate.
 *   - Llamadas a Supabase (/auth, /rest, /realtime): siempre a la red (no se cachean).
 * ========================================================================== */
const VERSION = "pescacorral-v1.0.0";
const APP_SHELL = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./config.js",
  "./css/styles.css",
  "./js/app.js",
  "./js/data.js",
  "./js/ui.js",
  "./js/charts.js",
  "./js/views.js",
  "./vendor/qrcode.min.js",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/apple-touch-icon.png",
  "./icons/favicon-32.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(VERSION).then((cache) =>
      // No fallar la instalación si algún recurso opcional no está.
      Promise.allSettled(APP_SHELL.map((url) => cache.add(url)))
    ).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);

  // No interceptar llamadas a la API de Supabase (auth / datos en tiempo real).
  if (/supabase\.(co|in)$/.test(url.hostname) || url.hostname.includes("supabase")) {
    return;
  }

  // Navegación: intentar red y, si falla, servir el shell cacheado.
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request).catch(() => caches.match("./index.html"))
    );
    return;
  }

  // Resto: stale-while-revalidate.
  event.respondWith(
    caches.match(request).then((cached) => {
      const network = fetch(request)
        .then((response) => {
          if (response && response.status === 200) {
            const copy = response.clone();
            caches.open(VERSION).then((cache) => cache.put(request, copy));
          }
          return response;
        })
        .catch(() => cached);
      return cached || network;
    })
  );
});
