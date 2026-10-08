/* ============================================================================
 *  PescaCorral · js/sw-registro.js
 *  Registro del Service Worker y actualización automática: cuando se publica
 *  una versión nueva, el service worker nuevo toma el control. Si la página
 *  recién se abrió, se recarga sola; si el usuario ya la estaba usando, se
 *  ofrece actualizar para no perder lo que esté cargando.
 *  (Archivo aparte y no en index.html: la política de seguridad de contenido
 *  no permite scripts escritos dentro de la página.)
 * ========================================================================== */
if ("serviceWorker" in navigator) {
  const abierta = Date.now();
  const habiaControlador = Boolean(navigator.serviceWorker.controller);
  let recargando = false;
  const recargar = () => { if (!recargando) { recargando = true; location.reload(); } };
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (!habiaControlador) return;                      // primera instalación: nada que actualizar
    if (Date.now() - abierta < 15000) { recargar(); return; }
    if (document.getElementById("aviso-version")) return;
    const aviso = document.createElement("div");
    aviso.id = "aviso-version";
    aviso.className = "aviso-version";
    aviso.innerHTML = '<span>Hay una versión nueva de PescaCorral.</span><button type="button">Actualizar</button>';
    aviso.querySelector("button").addEventListener("click", recargar);
    document.body.appendChild(aviso);
  });
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("service-worker.js", { updateViaCache: "none" }).then((reg) => {
      // Al volver a la app (por ejemplo, desde segundo plano en el celular) se busca una versión nueva.
      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "visible") reg.update().catch(() => {});
      });
    }).catch((err) => {
      console.warn("No se pudo registrar el Service Worker:", err);
    });
  });
}
