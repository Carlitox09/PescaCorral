/* ============================================================================
 *  PescaCorral · js/app.js
 *  Punto de entrada: enrutador por hash (#/ruta), control de sesión y de rol,
 *  y montaje de la vista correspondiente. Funciona como SPA sobre GitHub Pages.
 * ========================================================================== */
import * as D from "./data.js";
import * as V from "./views.js";
import { toast } from "./ui.js";

const isAdmin = (rol) => rol === "admin_municipal" || rol === "admin_sistema";

/* Tabla de rutas: base -> { view, auth, roles? } */
const ROUTES = {
  login:       { view: V.viewLogin,       auth: false },
  registro:    { view: V.viewRegistro,    auth: false },
  home:        { view: V.viewHome,        auth: true },
  catamaranes: { view: V.viewCatamaranes, auth: true },
  reserva:     { view: V.viewReserva,     auth: true },
  permiso:     { view: V.viewPermiso,     auth: true },
  historial:   { view: V.viewHistorial,   auth: true },
  perfil:      { view: V.viewPerfil,      auth: true },
  gestion:     { view: V.viewGestion,     auth: true, roles: ["dueno", "admin_municipal", "admin_sistema"] },
  admin:       { view: V.viewAdmin,       auth: true, roles: ["admin_municipal", "admin_sistema"] },
  reportes:    { view: V.viewReportes,    auth: true, roles: ["admin_municipal", "admin_sistema"] },
  usuarios:    { view: V.viewUsuarios,    auth: true, roles: ["admin_municipal", "admin_sistema"] },
};

/* ------------------------------- Parsing --------------------------------- */
function parseHash() {
  const raw = (location.hash || "").replace(/^#/, "") || "/home";
  const [path, qs = ""] = raw.split("?");
  const segs = path.split("/").filter(Boolean);
  const base = segs[0] || "home";
  const params = {};
  new URLSearchParams(qs).forEach((v, k) => (params[k] = v));
  if (base === "reserva" || base === "permiso") params.id = segs[1] || "";
  return { base, params };
}

/* ----------------------------- Navegación -------------------------------- */
function go(path) {
  const target = "#" + path;
  if (location.hash === target) render();   // misma ruta -> refrescar
  else location.hash = target;              // dispara hashchange -> render
}

/* ------------------------------- Render ---------------------------------- */
let rendering = false;
let token = 0;

async function render() {
  const myToken = ++token;
  if (rendering) return;                    // evita reentradas; el último hash gana
  rendering = true;
  try {
    const { base, params } = parseHash();
    const route = ROUTES[base] || ROUTES.home;

    let session = null;
    try { session = await D.getSession(); } catch (e) { console.warn(e); }
    if (myToken !== token) return;           // cambió el hash mientras resolvíamos

    // --- Guardas de acceso ---
    if (!route.auth) {
      // login / registro: si ya hay sesión, ir a la pantalla principal
      if (session) { go(isAdmin(session.profile.rol) ? "/admin" : "/home"); return; }
    } else {
      if (!session) { go("/login"); return; }
      // admins entran directo a su panel cuando piden "home"
      if (base === "home" && isAdmin(session.profile.rol)) { go("/admin"); return; }
      if (route.roles && !route.roles.includes(session.profile.rol)) {
        toast("No tenés permisos para esa sección.", "err");
        go(isAdmin(session.profile.rol) ? "/admin" : "/home");
        return;
      }
    }

    const ctx = { session, params, go, rerender: render };
    await route.view(ctx);
  } catch (err) {
    console.error("Error al renderizar la vista:", err);
    document.getElementById("app").innerHTML = `
      <div class="empty" style="min-height:100dvh;display:grid;place-content:center">
        <h3>Ups, algo salió mal</h3>
        <p class="muted">${(err && err.message) ? String(err.message) : "Error inesperado."}</p>
        <button class="btn btn--primary mt-16" onclick="location.hash='#/home';location.reload()">Reintentar</button>
      </div>`;
  } finally {
    rendering = false;
    // Si el hash cambió mientras renderizábamos, volver a procesar.
    if (myToken !== token) render();
  }
}

/* ------------------------------ Arranque --------------------------------- */
window.addEventListener("hashchange", render);

// Re-render ante cambios de autenticación (login/logout, refresh de token).
D.onAuthChange(() => render());

// Primer render.
if (!location.hash) location.hash = "#/home";
render();
