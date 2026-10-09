/* ============================================================================
 *  PescaCorral · Service Worker
 *  Cachea el "app shell" para funcionamiento offline e instalación (PWA).
 *  Estrategia:
 *   - Navegación (HTML): network-first con fallback a index.html (SPA).
 *   - Recursos propios (css/js/icons/vendor): network-first revalidando con el
 *     servidor, para que un cambio publicado se vea en la próxima carga; la copia
 *     en caché sólo se usa sin conexión.
 *   - Recursos externos (fotos de perfil de Google): stale-while-revalidate.
 *   - Llamadas a Supabase (/auth, /rest, /realtime): siempre a la red (no se cachean).
 * ========================================================================== */
const VERSION = "pescacorral-v1.13.0";
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
  "./js/sw-registro.js",
  "./vendor/qrcode.min.js",
  "./vendor/supabase.min.js",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/apple-touch-icon.png",
  "./icons/favicon-32.png",
  "./Municipio/",
  "./Admin/",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(VERSION).then((cache) =>
      // No fallar la instalación si algún recurso opcional no está. "reload" evita
      // guardar una copia vieja que el navegador todavía tenga en su caché HTTP.
      Promise.allSettled(APP_SHELL.map((url) => cache.add(new Request(url, { cache: "reload" }))))
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

  // Navegación: intentar red (revalidando con el servidor) y, si falla, servir el
  // shell cacheado. Una respuesta redirigida (p. ej. /Municipio -> /Municipio/) se
  // devuelve como redirección, que es lo que admite una navegación.
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request.url, { cache: "no-cache", credentials: "same-origin" })
        .then((r) => (r.redirected ? Response.redirect(r.url, 302) : r))
        .catch(() => caches.match(request).then((r) => r || caches.match("./index.html")))
    );
    return;
  }

  // Recursos propios: red primero (revalidando con el servidor) y caché sin conexión.
  if (url.origin === self.location.origin) {
    event.respondWith(
      fetch(new Request(request, { cache: "no-cache" }))
        .then((response) => {
          if (response && response.status === 200) {
            const copy = response.clone();
            caches.open(VERSION).then((cache) => cache.put(request, copy));
          }
          return response;
        })
        .catch(() => caches.match(request))
    );
    return;
  }

  // Externos: stale-while-revalidate.
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
