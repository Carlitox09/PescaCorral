/* ============================================================================
 *  PescaCorral · js/app.js
 *  Punto de entrada: enrutador por hash (#/ruta), control de sesión y de rol,
 *  y montaje de la vista correspondiente. Funciona como SPA sobre GitHub Pages.
 * ========================================================================== */
import * as D from "./data.js";
import * as V from "./views.js";
import { toast, esc, avisar } from "./ui.js";

const isAdmin = (rol) => rol === "admin_municipal" || rol === "admin_sistema";

/* Tabla de rutas: base -> { view, auth, roles?, alta? }
 *   alta: pantalla del primer ingreso, sólo accesible con el perfil incompleto. */
const ROUTES = {
  login:       { view: V.viewLogin,       auth: false },
  acceso:      { view: V.viewAcceso,      auth: false },   // personal: #/acceso/municipio | #/acceso/admin
  registro:    { view: V.viewRegistro,    auth: true, alta: true },
  home:        { view: V.viewHome,        auth: true },
  catamaranes: { view: V.viewCatamaranes, auth: true },
  reserva:     { view: V.viewReserva,     auth: true },
  permiso:     { view: V.viewPermiso,     auth: true },
  comprobante: { view: V.viewComprobante, auth: true },
  historial:   { view: V.viewHistorial,   auth: true },
  perfil:      { view: V.viewPerfil,      auth: true },
  gestion:     { view: V.viewGestion,     auth: true, roles: ["dueno", "admin_municipal", "admin_sistema"] },
  embarque:    { view: V.viewEmbarque,    auth: true, roles: ["dueno"] },   // lista de embarque de una salida
  admin:       { view: V.viewAdmin,       auth: true, roles: ["admin_municipal", "admin_sistema"] },
  reportes:    { view: V.viewReportes,    auth: true, roles: ["admin_municipal", "admin_sistema"] },
  usuarios:    { view: V.viewUsuarios,    auth: true, roles: ["admin_municipal", "admin_sistema"] },
  avisos:      { view: V.viewAvisos,      auth: true, roles: ["admin_municipal", "admin_sistema"] },
  personal:    { view: V.viewPersonal,    auth: true, roles: ["admin_sistema"] },
};

/* ------------------------------- Parsing --------------------------------- */
function parseHash() {
  const raw = (location.hash || "").replace(/^#/, "") || "/home";
  const [path, qs = ""] = raw.split("?");
  const segs = path.split("/").filter(Boolean);
  const base = segs[0] || "home";
  const params = {};
  new URLSearchParams(qs).forEach((v, k) => (params[k] = v));
  if (base === "reserva" || base === "permiso" || base === "comprobante") params.id = segs[1] || "";
  if (base === "acceso") params.tipo = segs[1] || "municipio";
  return { base, params };
}

/* ----------------------------- Navegación -------------------------------- */
function go(path) {
  const target = "#" + path;
  if (location.hash === target) render();   // misma ruta -> refrescar
  else location.hash = target;              // dispara hashchange -> render
}
const inicioSegunRol = (rol) => (isAdmin(rol) ? "/admin" : "/home");
const aLogin = (msg) => { if (msg) avisar(msg); go(D.rutaIngreso()); };

/* Al volver de Google, un error llega en la URL (?error=… o #error=…).
 * Devuelve el mensaje a mostrar, o null si no hay error. El detalle de la URL
 * no se muestra (cualquiera puede armar un enlace con un texto falso): va a la
 * consola. */
function errorDeIngreso() {
  const q = new URLSearchParams(location.search);
  const h = new URLSearchParams((location.hash || "").replace(/^#/, ""));
  const code = q.get("error") || h.get("error");
  const desc = q.get("error_description") || h.get("error_description");
  if (!code && !desc) return null;
  history.replaceState(null, "", location.pathname);   // limpia la URL
  if (/access_denied/i.test(code || "")) return "Cancelaste el ingreso con Google.";
  if (desc) console.warn("Ingreso con Google:", desc.replace(/\+/g, " "));
  return "No se pudo completar el ingreso con Google. Intentá de nuevo.";
}

/* ------------------------------- Render ---------------------------------- */
let rendering = false;
let token = 0;

async function render() {
  const myToken = ++token;
  if (rendering) return;                    // evita reentradas; el último hash gana
  rendering = true;
  try {
    const errIngreso = errorDeIngreso();
    if (errIngreso) { aLogin(errIngreso); return; }

    const { base, params } = parseHash();
    const route = ROUTES[base] || ROUTES.home;

    let session = null;
    try { session = await D.getSession(); } catch (e) { console.warn(e); }
    if (myToken !== token) return;           // cambió el hash mientras resolvíamos

    // Tras el intercambio del código de Google, se quita ?code= de la barra de direcciones.
    if (session && new URLSearchParams(location.search).has("code"))
      history.replaceState(null, "", location.pathname + location.hash);

    // --- Guardas de acceso ---
    if (!route.auth) {
      // El acceso del personal se muestra aunque haya otra sesión abierta (por
      // ejemplo, la de Google de un pescador): al ingresar, esa sesión se reemplaza.
      const otraCuenta = base === "acceso" && session?.profile?.rol !== D.rolDeAcceso(params.tipo);
      if (session && !otraCuenta) { go(D.perfilCompleto(session.profile) ? inicioSegunRol(session.profile.rol) : "/registro"); return; }
    } else {
      if (!session) { go(D.rutaIngreso()); return; }
      const p = session.profile;
      if (!p) throw new Error("No se pudo cargar tu perfil. Volvé a intentar en unos segundos.");
      if (p.activo === false) {
        await D.signOut();
        aLogin("Tu cuenta está desactivada. Comunicate con el Municipio de Coronel Moldes.");
        return;
      }
      const completo = D.perfilCompleto(p);
      if (!completo && !route.alta) { go("/registro"); return; }   // primer ingreso
      if (completo && route.alta) { go(inicioSegunRol(p.rol)); return; }
      // Los perfiles administrativos entran directo a su panel.
      if (base === "home" && isAdmin(p.rol)) { go("/admin"); return; }
      if (route.roles && !route.roles.includes(p.rol)) {
        toast("No tenés permisos para esa sección.", "err");
        go(inicioSegunRol(p.rol));
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
        <p class="muted">${esc((err && err.message) || "Error inesperado.")}</p>
        <button class="btn btn--primary mt-16" type="button" id="reintentar">Reintentar</button>
      </div>`;
    document.getElementById("reintentar").addEventListener("click", () => { location.hash = "#/home"; location.reload(); });
  } finally {
    rendering = false;
    // Si el hash cambió mientras renderizábamos, volver a procesar.
    if (myToken !== token) render();
  }
}

/* ------------------------------ Arranque --------------------------------- */
window.addEventListener("hashchange", render);

// Re-render ante cambios de sesión o de perfil. La renovación periódica del
// token no redibuja, para no perder lo que el usuario esté cargando; tampoco
// durante el ingreso del personal, que valida el rol antes de navegar.
D.onAuthChange((event) => {
  if (event === "TOKEN_REFRESHED" || event === "INITIAL_SESSION") return;
  if (D.ingresoPersonalEnCurso) return;
  render();
});

// Al volver la conexión se redibuja con datos frescos (y se quita el aviso de
// datos guardados). Si la app estaba usando el cliente sin conexión, se recarga
// para retomar la sesión real, que se renueva sola.
window.addEventListener("online", () => (D.usandoClienteSinConexion() ? location.reload() : render()));

// Personal (usuario y contraseña): la sesión se cierra tras 30 minutos sin
// actividad, para que no quede abierta en una computadora compartida del
// municipio. La última actividad se comparte entre pestañas (localStorage).
const INACTIVIDAD_MS = 30 * 60 * 1000, ACTIVIDAD_KEY = "pescacorral.actividad";
const registrarActividad = () => { try { localStorage.setItem(ACTIVIDAD_KEY, String(Date.now())); } catch {} };
["pointerdown", "keydown"].forEach((ev) => window.addEventListener(ev, registrarActividad, { passive: true }));
async function controlarInactividad() {
  let ultima = 0;
  try { ultima = Number(localStorage.getItem(ACTIVIDAD_KEY)) || 0; } catch {}
  if (!ultima) { registrarActividad(); return; }
  if (Date.now() - ultima < INACTIVIDAD_MS) return;
  const s = await D.getSession().catch(() => null);
  if (s?.user?.metodo === "clave") {
    await D.signOut();
    aLogin("Por seguridad, la sesión se cerró después de 30 minutos sin actividad.");
  }
  registrarActividad();
}
setInterval(controlarInactividad, 60 * 1000);
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") controlarInactividad(); });

// Primer render.
if (!location.hash) location.hash = "#/home";
render();
