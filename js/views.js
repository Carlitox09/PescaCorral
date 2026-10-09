/* ============================================================================
 *  PescaCorral · js/views.js
 *  Render de todas las pantallas de la PWA. Cada vista arma su HTML, lo monta
 *  con U.mount() y conecta sus eventos. Reciben un `ctx` con:
 *    { session, go(path), rerender(), params }
 * ========================================================================== */
import * as D from "./data.js";
import * as U from "./ui.js";
import { barChart, barChartPar, donutChart, progressBar, CHART_COLORS } from "./charts.js";

const CFG = window.PESCACORRAL_CONFIG || {};
const isAdmin = (rol) => rol === "admin_municipal" || rol === "admin_sistema";

/* --------------------------- QR (offline) -------------------------------- */
function qrSvg(text) {
  try {
    const qr = window.qrcode(0, "M");
    qr.addData(text || "PCC");
    qr.make();
    return qr.createSvgTag({ cellSize: 4, margin: 1, scalable: true });
  } catch (e) {
    return '<div class="muted">QR no disponible</div>';
  }
}

/* ====================== Piezas de “chrome” compartidas ==================== */
function topbar({ title, back = false, bell = true, plain = false, unread = 0 }) {
  return `<header class="topbar${plain ? " topbar--plain" : ""}">
    ${back
      ? `<button class="topbar__btn" data-back aria-label="Volver">${U.icon("chevron-left", { size: 22 })}</button>`
      : `<span class="topbar__logo">${U.logoMark(34)}</span>`}
    <h1 class="topbar__title">${U.esc(title)}</h1>
    <span class="topbar__spacer"></span>
    ${bell
      ? `<button class="topbar__btn bell" data-bell aria-label="Notificaciones${unread ? `, ${unread > 9 ? "9+" : unread} sin leer` : ""}">
           ${U.icon("bell", { size: 22 })}
           ${unread ? `<span class="bell__dot">${unread > 9 ? "9+" : unread}</span>` : ""}
         </button>`
      : ""}
  </header>`;
}

function bottomNav(active, rol) {
  // El dueño tiene todo lo del pescador (también sale a pescar) y su flota.
  const items = [
    ["home", "Inicio", "home", "#/home"],
    ["catamaranes", "Reservar", "boat", "#/catamaranes"],
    ["historial", "Historial", "calendar", "#/historial"],
    ...(rol === "dueno" ? [["gestion", "Mi flota", "steering", "#/gestion"]] : []),
    ["perfil", "Perfil", "user", "#/perfil"],
  ];
  return `<nav class="bottomnav">${items.map(([key, label, ic, href]) =>
    `<a href="${href}" class="${active === key ? "active" : ""}">${U.icon(ic, { size: 22 })}<span>${label}</span></a>`
  ).join("")}</nav>`;
}

function appShell({ active = null, rol = "pescador", topbarHtml = "", bodyHtml = "" }) {
  const showNav = active !== null && !isAdmin(rol);
  const offline = D.sinConexion();
  return `<div class="app"><div class="shell">
    ${topbarHtml}
    ${offline ? `<div class="offline-bar" role="status">${U.icon("wifi-off", { size: 16 })}<span>Sin conexión estable · datos guardados el ${U.fmtDateTime(new Date(offline).toISOString())}. Para reservar y pagar necesitás internet.</span></div>` : ""}
    <main class="shell__body${showNav ? "" : " no-nav"}">${bodyHtml}</main>
    ${showNav ? bottomNav(active, rol) : ""}
  </div></div>`;
}

function wireChrome(ctx) {
  U.$("[data-back]")?.addEventListener("click", () => history.length > 1 ? history.back() : ctx.go("/home"));
  U.$("[data-bell]")?.addEventListener("click", () => openNotificaciones(ctx));
}

/* Layout de escritorio para perfiles administrativos. */
function adminLayout({ active, title, subtitle = "", actions = "", body = "" }, ctx) {
  const p = ctx.session.profile;
  const nav = [
    ["panel", "Panel", "grid", "#/admin"],
    ["reportes", "Reportes", "bar-chart", "#/reportes"],
    ["usuarios", "Usuarios", "users", "#/usuarios"],
    ["avisos", "Avisos", "megaphone", "#/avisos"],
    ["gestion", "Catamaranes", "boat", "#/gestion"],
    ...(p.rol === "admin_sistema" ? [["personal", "Personal", "key", "#/personal"]] : []),
  ];
  const links = nav.map(([key, label, ic, href]) =>
    `<a href="${href}" class="${active === key ? "active" : ""}">${U.icon(ic, { size: 19 })}<span>${label}</span></a>`
  ).join("");

  return `<div class="admin">
    <aside class="sidebar" id="sidebar">
      <div class="sidebar__brand">${U.logoMark(34)}<b>PescaCorral</b></div>
      ${links}
      <div class="sidebar__spacer"></div>
      <div class="sidebar__user">
        <b>${U.esc(p.nombre)} ${U.esc(p.apellido || "")}</b>
        ${U.rolLabel(p.rol)}
        <button class="nav" data-logout style="margin-top:10px">${U.icon("logout", { size: 19 })}<span>Cerrar sesión</span></button>
      </div>
    </aside>
    <main class="admin__main">
      <div class="admin__mobilebar">
        ${U.logoMark(30)}<b>PescaCorral</b>
        <button class="menu-btn" data-toggle-sidebar aria-label="Menú">${U.icon("menu", { size: 22 })}</button>
      </div>
      <div class="admin__topbar">
        <div><h1>${U.esc(title)}</h1>${subtitle ? `<p>${U.esc(subtitle)}</p>` : ""}</div>
        <div class="flex gap-8 items-center">${actions}</div>
      </div>
      ${body}
    </main>
  </div>`;
}

function wireAdmin(ctx) {
  const admin = U.$(".admin");
  const toggle = () => admin?.classList.toggle("drawer-open");
  U.$("[data-toggle-sidebar]")?.addEventListener("click", () => {
    toggle();
    if (admin.classList.contains("drawer-open")) {
      const scrim = document.createElement("div");
      scrim.className = "scrim";
      scrim.addEventListener("click", () => { admin.classList.remove("drawer-open"); scrim.remove(); });
      admin.appendChild(scrim);
    } else {
      U.$(".scrim", admin)?.remove();
    }
  });
  // Cierra el drawer al navegar
  U.$$("#sidebar a").forEach((a) => a.addEventListener("click", () => admin.classList.remove("drawer-open")));
  U.$("[data-logout]")?.addEventListener("click", () => salir(ctx));
}

/* ============================================================================
 *  AUTENTICACIÓN · ingreso exclusivo con cuenta de Google
 * ========================================================================== */
/* Logotipo "G" de Google, a color, según los lineamientos de marca. */
const GOOGLE_G = `<svg class="g-logo" viewBox="0 0 48 48" width="20" height="20" aria-hidden="true">
  <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
  <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
  <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>
  <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
</svg>`;

export async function viewLogin(ctx) {
  const demo = D.MODE === "demo";
  const recordada = D.cuentaGoogleRecordada();
  const textoBoton = recordada ? `Continuar como ${recordada.nombre || recordada.email}` : "Continuar con Google";
  U.mount(`<main class="auth">
    <div class="auth__head">
      <span class="logo">${U.logoMark(52)}</span>
      <h1>PescaCorral</h1>
      <p>Reservas y permisos de pesca · ${U.esc(CFG.LUGAR || "Dique Cabra Corral")}</p>
    </div>
    <div class="auth__card-wrap">
      <div class="auth__card">
        <h2>Ingresá a tu cuenta</h2>
        <p class="sub">Usá tu cuenta de Google para reservar lugares y gestionar tus permisos de pesca. Si es tu primer ingreso, la cuenta se crea en el momento.</p>
        <button class="btn btn--google btn--block btn--lg" id="btn-google" type="button">${GOOGLE_G}<span>${U.esc(textoBoton)}</span></button>
        ${recordada ? `<p class="auth__otra"><small class="muted">${U.esc(recordada.email)}</small> · <button type="button" class="link" id="btn-otra">Usar otra cuenta</button></p>` : ""}
        <div class="field__error hide mt-12" id="login-err"></div>
        <ul class="auth__points">
          <li>${U.icon("shield", { size: 16 })}<span>PescaCorral no recibe ni guarda tu contraseña.</span></li>
          <li>${U.icon("lock", { size: 16 })}<span>La verificación de tu identidad la realiza Google.</span></li>
        </ul>
      </div>
      ${demo ? `<div class="auth__demo">
        <b>Modo demostración.</b> El ingreso con Google se simula: elegí una de las cuentas de ejemplo o usá otra para probar el primer ingreso.
      </div>` : ""}
    </div>
    <div class="auth__foot">${U.esc(CFG.MUNICIPIO || "Municipio de Coronel Moldes")}</div>
  </main>`);

  const errBox = U.$("#login-err");
  const previo = U.aviso();
  if (previo) showErr(errBox, previo);
  const btn = U.$("#btn-google");
  const label = btn.querySelector("span");
  btn.addEventListener("click", async () => {
    errBox.classList.add("hide");
    U.borrarAviso();
    if (demo) { selectorCuentasDemo(ctx); return; }
    btn.disabled = true; label.textContent = "Conectando con Google…";
    try {
      await D.signInWithGoogle();          // redirige a Google
    } catch (err) {
      showErr(errBox, err.message);
      btn.disabled = false; label.textContent = textoBoton;
    }
  });
  U.$("#btn-otra")?.addEventListener("click", async () => {
    errBox.classList.add("hide");
    try { await D.signInWithGoogle({ otraCuenta: true }); }   // al volver, queda recordada la cuenta elegida
    catch (err) { showErr(errBox, err.message); }
  });
}

/* ---- Acceso del personal: #/acceso/municipio y #/acceso/admin ----
 * Se llega desde /Municipio y /Admin. Usuario y contraseña asignados por la
 * administración; no hay registro abierto. */
export async function viewAcceso(ctx) {
  const tipo = ctx.params.tipo === "admin" ? "admin" : "municipio";
  const demo = D.MODE === "demo";
  const titulo = tipo === "admin" ? "Acceso de administración" : "Acceso municipal";
  const sub = tipo === "admin"
    ? "Ingreso del administrador del sistema."
    : `Ingreso del personal del ${U.esc(CFG.MUNICIPIO || "Municipio de Coronel Moldes")}.`;
  U.mount(`<main class="auth">
    <div class="auth__head">
      <span class="logo">${U.logoMark(52)}</span>
      <h1>PescaCorral</h1>
      <p>${titulo} · ${U.esc(CFG.LUGAR || "Dique Cabra Corral")}</p>
    </div>
    <div class="auth__card-wrap">
      <form class="auth__card" id="acc-form" novalidate>
        <h2>${titulo}</h2>
        <p class="sub">${sub} Usá el usuario y la contraseña que te asignó la administración.</p>
        ${ctx.session ? `<div class="nota mt-8" style="margin-bottom:14px">${U.icon("info", { size: 18 })}<span>Tenés abierta la sesión de <b>${U.esc(ctx.session.user.email || "otra cuenta")}</b>${ctx.session.profile ? ` (${U.esc(U.rolLabel(ctx.session.profile.rol))})` : ""}. Al ingresar con el usuario del personal, esa sesión se cierra.</span></div>` : ""}
        <div class="field"><label for="acc-user">Usuario</label>
          <input class="input" id="acc-user" autocomplete="username" autocapitalize="none" spellcheck="false" placeholder="${tipo}" value="${U.esc(ctx.params.u || "")}"/></div>
        <div class="field"><label for="acc-pass">Contraseña</label>
          <input class="input" id="acc-pass" type="password" autocomplete="current-password"/>
          <label class="field__hint" style="display:flex;align-items:center;gap:6px;cursor:pointer"><input type="checkbox" id="acc-ver"/> Mostrar contraseña</label></div>
        <div class="field__error hide" id="acc-err"></div>
        <button class="btn btn--primary btn--block btn--lg mt-8" type="submit" id="acc-btn">Ingresar</button>
        <ul class="auth__points">
          <li>${U.icon("shield", { size: 16 })}<span>Las cuentas del personal las crea la administración; no hay registro abierto.</span></li>
          <li>${U.icon("lock", { size: 16 })}<span>Tu contraseña se guarda cifrada y PescaCorral no la conoce.</span></li>
        </ul>
      </form>
      ${demo ? `<div class="auth__demo">
        <b>Modo demostración.</b> Usuario <b>${tipo}</b> y contraseña <b>${tipo === "admin" ? "Admin.2026" : "Municipio.2026"}</b>.
      </div>` : ""}
    </div>
    <div class="auth__foot"><a href="#/login" data-publico>¿Sos pescador, turista o dueño de catamarán? Ingresá con Google</a></div>
  </main>`);

  const errBox = U.$("#acc-err");
  const previo = U.aviso();
  if (previo) showErr(errBox, previo);
  U.$(ctx.params.u ? "#acc-pass" : "#acc-user").focus();
  const btn = U.$("#acc-btn");
  U.$("#acc-ver").addEventListener("change", (e) => { U.$("#acc-pass").type = e.target.checked ? "text" : "password"; });
  U.$("[data-publico]").addEventListener("click", () => D.usarIngresoPublico());
  U.$("#acc-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    errBox.classList.add("hide");
    U.borrarAviso();
    btn.disabled = true; btn.textContent = "Ingresando…";
    try {
      await D.signInPersonal({ usuario: U.$("#acc-user").value, clave: U.$("#acc-pass").value, tipo });
      ctx.go("/admin");
    } catch (err) {
      // El mensaje se guarda como aviso para sobrevivir al redibujo por cierre de sesión.
      U.avisar(err.message);
      ctx.go(`/acceso/${tipo}?u=${encodeURIComponent(U.$("#acc-user").value.trim())}`);
    }
  });
}

/* Cierre de sesión: vuelve a la pantalla de ingreso que corresponde. */
async function salir(ctx) {
  const destino = D.rutaIngreso();
  await D.signOut();
  ctx.go(destino);
}

/* Modo demostración: reproduce el selector de cuentas de Google. */
async function selectorCuentasDemo(ctx) {
  const cuentas = await D.listarCuentasDemo();
  const m = U.modal({
    title: "Elegí una cuenta",
    body: `
      <p class="muted" style="margin-top:-8px;font-size:.88rem">para continuar a PescaCorral · simulación del ingreso con Google</p>
      <div class="acct-list">
        ${cuentas.map((c) => `
          <button class="acct" type="button" data-email="${U.esc(c.email)}">
            <span class="acct__av">${U.esc(U.initials(c.nombre, c.apellido))}</span>
            <span class="acct__txt"><b>${U.esc(`${c.nombre} ${c.apellido}`.trim())}</b><small>${U.esc(c.email)}</small></span>
          </button>`).join("")}
        <button class="acct" type="button" data-otra>
          <span class="acct__av acct__av--plus">${U.icon("user", { size: 18 })}</span>
          <span class="acct__txt"><b>Usar otra cuenta</b><small>Simula el primer ingreso de un usuario nuevo</small></span>
        </button>
      </div>
      <div class="hide" id="acct-nueva">
        <div class="field mt-12"><label for="an-nombre">Nombre y apellido</label><input class="input" id="an-nombre" placeholder="Ana Ruiz"/></div>
        <div class="field"><label for="an-email">Correo de la cuenta de Google</label><input class="input" id="an-email" type="email" placeholder="ana.ruiz@gmail.com"/></div>
        <div class="field__error hide" id="an-err"></div>
        <button class="btn btn--primary btn--block" type="button" id="an-ok">Continuar</button>
      </div>`,
  });
  const entrar = async (datos) => {
    try {
      await D.signInDemo(datos);
      U.closeModal();
      ctx.go("/home");                     // el enrutador decide: alta, panel o inicio
    } catch (err) {
      showErr(U.$("#an-err", m.root), err.message);
      U.$("#acct-nueva", m.root).classList.remove("hide");
    }
  };
  U.$$(".acct[data-email]", m.root).forEach((b) => b.addEventListener("click", () => entrar({ email: b.dataset.email })));
  U.$("[data-otra]", m.root).addEventListener("click", () => {
    U.$("#acct-nueva", m.root).classList.remove("hide");
    U.$("#an-nombre", m.root).focus();
  });
  U.$("#an-ok", m.root).addEventListener("click", () =>
    entrar({ email: U.$("#an-email", m.root).value, nombre: U.$("#an-nombre", m.root).value }));
}

/* ---- Alta en el primer ingreso (HU-001): datos que Google no provee ---- */
const soloDigitos = (s) => String(s || "").replace(/\D/g, "");
const formatoDNI = (s) => soloDigitos(s).replace(/\B(?=(\d{3})+(?!\d))/g, ".");

export async function viewRegistro(ctx) {
  const p = ctx.session.profile || {};
  const admin = isAdmin(p.rol);
  const avatar = ctx.session.user.avatar;
  U.mount(`<main class="auth">
    <div class="auth__head" style="clip-path:polygon(0 0,100% 0,100% 86%,0 100%);padding-bottom:54px">
      <span class="logo">${avatar
        ? `<img class="auth__avatar" src="${U.esc(avatar)}" alt="" referrerpolicy="no-referrer"/>`
        : U.logoMark(48)}</span>
      <h1>Completá tu perfil</h1>
      <p>Un último paso para crear tu cuenta en PescaCorral.</p>
    </div>
    <div class="auth__card-wrap">
      <div class="auth__card">
        <h2>Datos personales</h2>
        <p class="sub">Se usan sólo para tus reservas y para emitir tus permisos de pesca.</p>
        <form id="f-reg" novalidate>
          <div class="field">
            <label>Cuenta de Google</label>
            <div class="input input--readonly">${GOOGLE_G}<span>${U.esc(ctx.session.user.email)}</span></div>
          </div>
          <div class="flex gap-12">
            <div class="field grow"><label for="r-nombre">Nombre *</label><input class="input" id="r-nombre" autocomplete="given-name" value="${U.esc(p.nombre || "")}"/></div>
            <div class="field grow"><label for="r-apellido">Apellido *</label><input class="input" id="r-apellido" autocomplete="family-name" value="${U.esc(p.apellido || "")}"/></div>
          </div>
          <div class="flex gap-12">
            <div class="field grow"><label for="r-dni">DNI *</label><input class="input" id="r-dni" inputmode="numeric" placeholder="24.356.789" value="${U.esc(p.dni || "")}"/></div>
            <div class="field grow"><label for="r-tel">Teléfono</label><input class="input" id="r-tel" inputmode="tel" autocomplete="tel" placeholder="+54 387 …" value="${U.esc(p.telefono || "")}"/></div>
          </div>
          ${admin ? "" : `<div class="field">
            <label for="r-rol">Tipo de cuenta *</label>
            <select class="select" id="r-rol">
              <option value="pescador"${p.rol === "dueno" ? "" : " selected"}>Pescador / Turista</option>
              <option value="dueno"${p.rol === "dueno" ? " selected" : ""}>Dueño de catamarán</option>
            </select>
            <div class="field__hint">Una vez creada la cuenta, el tipo sólo puede modificarlo la administración municipal.</div>
          </div>`}
          <div class="field__error hide" id="reg-err"></div>
          <button class="btn btn--primary btn--block btn--lg" type="submit" id="reg-btn">Crear cuenta</button>
        </form>
        <button class="btn btn--soft btn--block mt-12" type="button" data-cancel>Cancelar y salir</button>
      </div>
    </div>
    <div class="auth__foot">* Campos obligatorios</div>
  </main>`);

  const dni = U.$("#r-dni");
  dni.addEventListener("blur", () => { if (soloDigitos(dni.value)) dni.value = formatoDNI(dni.value); });
  U.$("[data-cancel]").addEventListener("click", async () => { await D.signOut(); ctx.go("/login"); });

  U.$("#f-reg").addEventListener("submit", async (e) => {
    e.preventDefault();
    const errBox = U.$("#reg-err"); errBox.classList.add("hide");
    const campos = [["#r-nombre", "Nombre"], ["#r-apellido", "Apellido"], ["#r-dni", "DNI"]];
    const faltan = [];
    campos.forEach(([sel, nom]) => {
      const el = U.$(sel); const vacio = !el.value.trim();
      el.classList.toggle("input--error", vacio);
      if (vacio) faltan.push(nom);
    });
    if (faltan.length) { showErr(errBox, `Completá los campos obligatorios: ${faltan.join(", ")}.`); return; }
    const d = soloDigitos(dni.value);
    if (d.length < 7 || d.length > 8) {
      dni.classList.add("input--error");
      showErr(errBox, "Ingresá un DNI válido, de 7 u 8 dígitos."); return;
    }
    const btn = U.$("#reg-btn"); btn.disabled = true; btn.textContent = "Creando cuenta…";
    try {
      await D.completarPerfil({
        nombre: U.$("#r-nombre").value.trim(), apellido: U.$("#r-apellido").value.trim(),
        dni: formatoDNI(d), telefono: U.$("#r-tel").value.trim(),
        rol: admin ? undefined : U.$("#r-rol").value,
      });
      U.toast("¡Cuenta creada! Te damos la bienvenida a PescaCorral.", "ok");
      ctx.go("/home");
    } catch (err) {
      showErr(errBox, err.message); btn.disabled = false; btn.textContent = "Crear cuenta";
    }
  });
}

function showErr(box, msg) { if (!box) return; box.textContent = msg; box.classList.remove("hide"); }

/* ============================================================================
 *  HOME
 * ========================================================================== */
export async function viewHome(ctx) {
  const p = ctx.session.profile;
  const hoy = U.todayISO();
  try { await D.generarRecordatorios(); } catch (e) { console.warn(e); }
  const dueno = p.rol === "dueno";
  const [reservas, permisos, notifs, cats, gastos] = await Promise.all([
    D.listReservas(), D.listPermisos(), D.listNotificaciones(), D.disponibilidad(hoy, "manana"),
    dueno ? D.listGastos().catch(() => []) : [],
  ]);
  const unread = notifs.filter((n) => !n.leida).length;
  // Sólo las salidas propias (el dueño también recibe las de sus pasajeros).
  const proxima = reservas.filter((r) => r.id_usuario === p.id && r.estado !== "cancelada" && r.fecha >= hoy).sort((a, b) => a.fecha < b.fecha ? -1 : 1)[0];
  const permisoVigente = permisos.find((p) => p.estado === "vigente");
  const disponibles = cats.filter((c) => c.estado === "activa").slice(0, 2);

  const quick = [
    ["Reservar salida", "Elegí catamarán y lugares", "boat", "t1", "#/catamaranes"],
    ["Mis permisos", "Permisos digitales con QR", "ticket", "t2", "#/historial?tab=permisos"],
    ["Historial", "Tus reservas anteriores", "calendar", "t3", "#/historial"],
    ["Mi perfil", "Datos y configuración", "user", "t4", "#/perfil"],
    ...(dueno ? [
      ["Mi flota", "Catamaranes y lugares", "steering", "t3", "#/gestion"],
      ["Finanzas", "Ganancias y pérdidas", "bar-chart", "t4", "#/gestion?tab=finanzas"],
    ] : []),
  ];

  U.mount(appShell({
    active: "home", rol: p.rol,
    topbarHtml: topbar({ title: "PescaCorral", back: false, bell: true, unread }),
    bodyHtml: `
      <section class="hero">
        <span class="hero__chip">${U.icon("map-pin", { size: 15 })} ${U.esc(CFG.LUGAR || "Dique Cabra Corral")}</span>
        <h1>Hola, ${U.esc(p.nombre)} 👋</h1>
        <p>Reservá tu salida de pesca y obtené tu permiso municipal al instante.</p>
        <div class="hero__actions">
          <a class="btn btn--cta" href="#/catamaranes">${U.icon("boat", { size: 18 })} Reservar salida</a>
          <a class="btn btn--ghost" href="${permisoVigente ? "#/permiso/" + permisoVigente.id : "#/historial?tab=permisos"}">${U.icon("ticket", { size: 18 })} Mi permiso</a>
        </div>
      </section>

      ${proxima ? `
      <h2 class="section-title">Próxima salida</h2>
      <div class="card">
        <div class="flex between items-center">
          <div>
            <h3 style="font-size:1.1rem;font-weight:800">${U.esc(proxima.catamaran_nombre)}</h3>
            <div class="muted" style="font-weight:600;margin-top:2px">${U.icon("calendar", { size: 14 })} ${U.fmtDateLong(proxima.fecha)}</div>
            <div class="muted" style="font-weight:600">${U.icon("clock", { size: 14 })} Turno ${U.turnoLabel(proxima.turno)} · ${proxima.cantidad_lugares} lugar${proxima.cantidad_lugares > 1 ? "es" : ""}</div>
          </div>
          <span class="badge ${U.estadoReservaBadge(proxima.estado).cls}"><span class="dot"></span>${U.estadoReservaBadge(proxima.estado).label}</span>
        </div>
        ${proxima.permiso_id ? `<a class="btn btn--outline btn--block mt-12" href="#/permiso/${proxima.permiso_id}">${U.icon("qr", { size: 18 })} Ver permiso digital</a>` : ""}
      </div>` : ""}

      ${dueno ? panelFlota(p, cats, reservas, gastos, hoy) : ""}

      <h2 class="section-title mt-16">Accesos rápidos</h2>
      <div class="quickgrid">
        ${quick.map(([t, s, ic, tone, href]) =>
          `<a class="quick" href="${href}">
            <div class="quick__ic ${tone}">${U.icon(ic, { size: 22 })}</div>
            <h3>${t}</h3><small>${s}</small>
          </a>`).join("")}
      </div>

      <h2 class="section-title mt-24">Catamaranes hoy <a class="muted-link" href="#/catamaranes">Ver todos</a></h2>
      ${disponibles.map((c) => boatCard(c, hoy, "manana")).join("") || `<p class="muted">No hay catamaranes disponibles.</p>`}
      ${creditoFotos(disponibles)}
    `,
  }));
  wireChrome(ctx);
}

/* ============================================================================
 *  CATAMARANES
 * ========================================================================== */
export async function viewCatamaranes(ctx) {
  const p = ctx.session.profile;
  const fecha = ctx.params.fecha || U.todayISO();
  const turno = ctx.params.turno || "manana";
  const [cats, notifs] = await Promise.all([D.disponibilidad(fecha, turno), D.listNotificaciones()]);
  const unread = notifs.filter((n) => !n.leida).length;

  U.mount(appShell({
    active: "catamaranes", rol: p.rol,
    topbarHtml: topbar({ title: "Catamaranes", bell: true, unread }),
    bodyHtml: `
      <div class="filters">
        <input class="input" type="date" id="f-fecha" aria-label="Fecha de la salida" value="${fecha}" min="${U.todayISO()}" />
        <select class="select turno" id="f-turno" aria-label="Turno">
          <option value="manana"${turno === "manana" ? " selected" : ""}>Mañana</option>
          <option value="tarde"${turno === "tarde" ? " selected" : ""}>Tarde</option>
        </select>
      </div>
      <p class="muted" style="margin:-6px 2px 14px;font-weight:600">${U.icon("calendar", { size: 14 })} ${U.fmtDateLong(fecha)} · Turno ${U.turnoLabel(turno)}</p>
      <div id="boat-list">${cats.map((c) => boatCard(c, fecha, turno)).join("")}</div>
      ${creditoFotos(cats)}
    `,
  }));
  wireChrome(ctx);

  const update = () => {
    const f = U.$("#f-fecha").value || U.todayISO();
    const t = U.$("#f-turno").value;
    ctx.go(`/catamaranes?fecha=${f}&turno=${t}`);
  };
  U.$("#f-fecha").addEventListener("change", update);
  U.$("#f-turno").addEventListener("change", update);
}

function boatCard(c, fecha, turno) {
  const mantenimiento = c.estado !== "activa";
  const qs = fecha ? `?fecha=${fecha}&turno=${turno || "manana"}` : "";
  const conDispo = typeof c.libres === "number";
  const agotado = conDispo && c.libres === 0;
  const dispo = conDispo
    ? (agotado ? `<span class="badge badge--danger" style="margin-top:4px">Sin disponibilidad</span>`
               : `<span class="badge ${c.libres <= 3 ? "badge--warn" : "badge--ok"}" style="margin-top:4px">${c.libres} libres de ${c.capacidad}</span>`)
    : "";
  return `<div class="boat" style="margin-bottom:12px">
    <div class="boat__img">${portada(c)}</div>
    <div class="boat__main">
      <h2>${U.esc(c.nombre)}</h2>
      <div class="boat__meta">${U.icon("users", { size: 13 })} ${c.capacidad} lugares ${c.habilitacion ? "· Hab. " + U.esc(c.habilitacion) : ""}</div>
      ${c.descripcion ? `<p class="boat__desc">${U.esc(c.descripcion)}</p>` : ""}
      <div class="boat__price">${U.fmtMoney(c.precio)} <small>/ lugar</small></div>
      ${mantenimiento ? "" : dispo}
    </div>
    <div style="align-self:stretch;display:flex;flex-direction:column;justify-content:center">
      ${mantenimiento
        ? `<span class="badge badge--warn">${U.icon("settings", { size: 13 })} Mantenimiento</span>`
        : agotado
          ? `<button class="btn btn--soft btn--sm" disabled>Completo</button>`
          : `<a class="btn btn--cta btn--sm" href="#/reserva/${c.id}${qs}">Reservar</a>`}
    </div>
  </div>`;
}

/* ============================================================================
 *  RESERVA DE LUGARES
 *  1. Lugares en el plano del catamarán · 2. Permiso de pesca (comprar uno o
 *  usar el que ya tiene) · 3. Medio de pago. Al pagar se muestra el comprobante.
 * ========================================================================== */
const MEDIOS_PAGO = [
  ["tarjeta", "credit-card", "Tarjeta", "Crédito o débito"],
  ["mercadopago", "wallet", "Mercado Pago", "Con tu cuenta"],
  ["efectivo", "cash", "Efectivo", "En la boletería del muelle"],
];
const TIPOS_PERMISO = [["diario", "Diario"], ["semanal", "Semanal"], ["anual", "Anual"]];
const lugaresTexto = (nums) => nums.slice().sort((a, b) => a - b).join(", ");

export async function viewReserva(ctx) {
  const p = ctx.session.profile;
  const catId = ctx.params.id;
  let fecha = ctx.params.fecha || U.todayISO();
  let turno = ctx.params.turno === "tarde" ? "tarde" : "manana";

  const [cat, lugares, especies, tarifas, permisos] = await Promise.all([
    D.getCatamaran(catId), D.getLugares(catId), D.listEspecies(), D.listTarifasPermiso(), D.listPermisos(),
  ]);
  if (!cat) { U.mount(appShell({ active: null, rol: p.rol, topbarHtml: topbar({ title: "Reservar", back: true, bell: false }), bodyHtml: emptyState("Catamarán no encontrado", "Volvé a la lista de catamaranes.", "boat") })); wireChrome(ctx); return; }

  const seleccion = new Set();
  let ocupacion = { manana: [], tarde: [] };
  let mios = [];
  let modoPermiso = "comprar";        // comprar | propio
  let permisoValido = null;           // resultado de D.validarPermiso
  let metodo = "tarjeta";
  const numeroDe = (id) => lugares.find((l) => l.id === id)?.numero;

  U.mount(appShell({
    active: null, rol: p.rol,
    topbarHtml: topbar({ title: "Reservar lugares", back: true, bell: false }),
    bodyHtml: `
      <div class="card">
        <div class="reserva-head">
          <div>
            <h2>${U.esc(cat.nombre)}</h2>
            <div class="muted" style="font-weight:600;margin-top:2px">${U.fmtMoney(cat.precio)} / lugar · ${cat.capacidad} lugares</div>
          </div>
          <div class="boat__img" style="width:54px;height:54px">${portada(cat, 30)}</div>
        </div>
        ${cat.descripcion ? `<p class="boat__desc" style="-webkit-line-clamp:4">${U.esc(cat.descripcion)}</p>` : ""}
        ${(cat.fotos || []).length ? `<div class="galeria" role="region" tabindex="0" aria-label="Fotos de ${U.esc(cat.nombre)}">${cat.fotos.map((f, i) =>
          `<img src="${U.esc(D.urlFoto(f))}" alt="Foto ${i + 1} de ${U.esc(cat.nombre)}" loading="lazy" data-foto>`).join("")}</div>${creditoFotos([cat])}` : ""}
        <div class="field mt-12" style="margin-bottom:10px"><label for="r-fecha">Fecha de la salida</label>
          <input class="input" type="date" id="r-fecha" value="${fecha}" min="${U.todayISO()}"/></div>
        <label class="field-label">Turno</label>
        <div class="segmented" id="r-turno" role="radiogroup" aria-label="Turno"></div>
        <div id="r-mios"></div>
      </div>

      <h2 class="section-title mt-16"><span><span class="paso">1</span>Elegí tus lugares</span></h2>
      <p class="muted" style="font-size:.84rem;margin:-6px 2px 10px">Vista desde arriba, con la proa adelante. Los números siguen el sentido de las agujas del reloj desde la proa, por estribor.</p>
      <div id="seatmap"></div>
      <div class="seat-legend">
        <span><i class="lg-free"></i>Libre</span>
        <span><i class="lg-sel"></i>Elegido</span>
        <span><i class="lg-occ"></i>Ocupado</span>
        <span><i class="lg-mio"></i>Tuyo</span>
      </div>
      <div id="r-pasajeros"></div>

      <h2 class="section-title mt-24"><span><span class="paso">2</span>Permiso de pesca</span></h2>
      <div class="opciones opciones--2" role="radiogroup" aria-label="Permiso de pesca">
        <button type="button" class="opcion is-on" role="radio" aria-checked="true" data-permiso="comprar">
          ${U.icon("plus-circle", { size: 22 })}<b>Comprar permiso</b><small>Se emite con la reserva</small></button>
        <button type="button" class="opcion" role="radio" aria-checked="false" data-permiso="propio">
          ${U.icon("ticket", { size: 22 })}<b>Ya tengo permiso</b><small>Ingresá su número</small></button>
      </div>
      <div class="card card--flat mt-12" id="permiso-comprar">
        <div class="field"><label for="r-especie">Especie a pescar</label>
          <select class="select" id="r-especie">${especies.map((e) => `<option value="${e.id}">${U.esc(e.nombre)}</option>`).join("")}</select>
        </div>
        <label class="field-label">Tipo de permiso</label>
        <div class="opciones opciones--3" role="radiogroup" aria-label="Tipo de permiso">
          ${TIPOS_PERMISO.map(([k, label], i) => `<button type="button" class="opcion opcion--sm${i === 0 ? " is-on" : ""}" role="radio" aria-checked="${i === 0}" data-tipo="${k}">
            <b>${label}</b><small>${tarifas[k] ? U.fmtMoney(tarifas[k]) : "Sin cargo"}</small></button>`).join("")}
        </div>
      </div>
      <div class="card card--flat mt-12 hide" id="permiso-propio">
        <div class="field" style="margin-bottom:8px"><label for="r-numperm">Número de permiso</label>
          <div class="flex gap-8">
            <input class="input grow" id="r-numperm" placeholder="PCC-000215" autocapitalize="characters" spellcheck="false"/>
            <button class="btn btn--outline" type="button" id="r-verificar">Verificar</button>
          </div>
        </div>
        <div id="r-misperm"></div>
        <div id="r-permres" class="mt-8"></div>
      </div>

      <h2 class="section-title mt-24"><span><span class="paso">3</span>Medio de pago</span></h2>
      <div class="opciones opciones--3" role="radiogroup" aria-label="Medio de pago">
        ${MEDIOS_PAGO.map(([k, ic, label, sub], i) => `<button type="button" class="opcion opcion--sm${i === 0 ? " is-on" : ""}" role="radio" aria-checked="${i === 0}" data-metodo="${k}">
          ${U.icon(ic, { size: 22 })}<b>${label}</b><small>${sub}</small></button>`).join("")}
      </div>

      <div class="summary mt-16" id="summary"></div>
      <p class="muted center mt-8" style="font-size:.78rem">La pasarela de pago es simulada en este prototipo: no se realiza ningún cobro real.</p>

      <div class="paybar" aria-live="polite">
        <div class="paybar__total"><small id="paybar-cant">Elegí tus lugares</small><b id="paybar-total">${U.fmtMoney(0)}</b></div>
        <button class="btn btn--cta btn--lg" id="confirm-btn" disabled>
          ${U.icon("credit-card", { size: 20 })} Pagar y confirmar
        </button>
      </div>
    `,
  }));
  wireChrome(ctx);

  const summaryEl = U.$("#summary");
  const confirmBtn = U.$("#confirm-btn");
  const tipoActual = () => U.$("[data-tipo].is-on")?.dataset.tipo || "diario";
  const marcar = (grupo, btn) => U.$$(grupo).forEach((b) => { const on = b === btn; b.classList.toggle("is-on", on); b.setAttribute("aria-checked", String(on)); });

  const refreshSummary = () => {
    const n = seleccion.size;
    const montoLugares = n * cat.precio;
    const montoPermiso = modoPermiso === "comprar" ? Number(tarifas[tipoActual()] || 0) : 0;
    const total = n ? montoLugares + montoPermiso : 0;
    const nums = [...seleccion].map(numeroDe);
    summaryEl.innerHTML = `
      <div class="flex between"><span>Lugares${n ? ` (${n} × ${U.fmtMoney(cat.precio)})` : ""}</span><b>${U.fmtMoney(montoLugares)}</b></div>
      ${modoPermiso === "comprar"
        ? `<div class="flex between mt-8"><span>Permiso ${U.tipoPermisoLabel(tipoActual()).toLowerCase()}</span><b>${montoPermiso ? U.fmtMoney(montoPermiso) : "Sin cargo"}</b></div>`
        : `<div class="flex between mt-8"><span>Permiso propio${permisoValido ? " " + U.esc(permisoValido.numero) : ""}</span><b>${permisoValido ? "Sin cargo" : "Sin verificar"}</b></div>`}
      <div class="flex between mt-8 total"><span><b>Total a pagar</b></span><b>${U.fmtMoney(total)}</b></div>
      ${n ? `<div class="muted mt-8" style="font-size:.8rem">Lugares: ${nums.sort((a, b) => a - b).map((x) => `${x} (${D.ubicacionLugar(x, lugares.length)})`).join(", ")} · Turno ${U.turnoLabel(turno).toLowerCase()} · ${U.fmtDate(fecha)}</div>` : ""}`;
    U.$("#paybar-total").textContent = U.fmtMoney(total);
    const falta = !n ? "Elegí tus lugares"
      : n > 1 && errorAcompanantes() ? "Completá los pasajeros"
      : modoPermiso === "propio" && !permisoValido ? "Verificá tu permiso" : null;
    U.$("#paybar-cant").textContent = falta || `${n} lugar${n > 1 ? "es" : ""} · ${U.turnoLabel(turno).toLowerCase()}`;
    confirmBtn.disabled = Boolean(falta);
  };

  const pintarTurnos = () => {
    const total = lugares.length;
    U.$("#r-turno").innerHTML = ["manana", "tarde"].map((t) => {
      const libres = Math.max(0, total - ocupacion[t].length);
      const on = t === turno;
      return `<button type="button" role="radio" aria-checked="${on}" class="${on ? "is-on" : ""}" data-turno="${t}">
        <b>${U.turnoLabel(t)}</b><small>${libres ? `${libres} libre${libres > 1 ? "s" : ""}` : "Completo"}</small></button>`;
    }).join("");
  };

  const pintarMios = () => {
    const box = U.$("#r-mios");
    const aca = mios.filter((m) => m.turno === turno).map((m) => numeroDe(m.id_lugar));
    const otro = mios.filter((m) => m.turno !== turno).map((m) => numeroDe(m.id_lugar));
    const otroTurno = turno === "manana" ? "tarde" : "manana";
    box.innerHTML = [
      aca.length ? `<div class="nota nota--agua mt-12">${U.icon("check-circle", { size: 18 })}<span>Ya tenés ${aca.length > 1 ? "los lugares" : "el lugar"} <b>${lugaresTexto(aca)}</b> en este turno. ${aca.length > 1 ? "Están marcados" : "Está marcado"} como "Tuyo".</span></div>` : "",
      otro.length ? `<div class="nota mt-12">${U.icon("info", { size: 18 })}<span>Ya tenés ${otro.length > 1 ? "los lugares" : "el lugar"} <b>${lugaresTexto(otro)}</b> reservado${otro.length > 1 ? "s" : ""} en el turno <b>${U.turnoLabel(otroTurno).toLowerCase()}</b> de este día.</span><button type="button" class="btn btn--soft btn--sm" data-ir-turno="${otroTurno}">Ver turno ${U.turnoLabel(otroTurno).toLowerCase()}</button></div>` : "",
    ].join("");
  };

  const pintarAsientos = () => {
    const ocup = new Set(ocupacion[turno]);
    const propios = new Set(mios.filter((m) => m.turno === turno).map((m) => m.id_lugar));
    U.$("#seatmap").innerHTML = planoCatamaran(lugares, ocup, seleccion, propios);
  };

  // Pasajeros (lista de embarque): el primer lugar es del titular; para cada uno
  // más se piden el nombre y el DNI de quien lo ocupa.
  const acompanantes = new Map();   // id del lugar -> { nombre, dni }
  const lugaresOrdenados = () => [...seleccion].sort((a, b) => numeroDe(a) - numeroDe(b));
  const listaAcompanantes = () => lugaresOrdenados().slice(1).map((id) => acompanantes.get(id) || { nombre: "", dni: "" });
  function errorAcompanantes() {
    try { D.validarAcompanantes(listaAcompanantes(), seleccion.size, p.dni); return null; } catch (e) { return e.message; }
  }
  const pintarPasajeros = () => {
    const ids = lugaresOrdenados();
    const box = U.$("#r-pasajeros");
    if (ids.length < 2) { box.innerHTML = ""; return; }
    box.innerHTML = `<h3 class="pasajeros__titulo">Pasajeros</h3>
      <p class="muted" style="font-size:.84rem;margin:0 2px 10px">Para la lista de embarque del catamarán: nombre y DNI de quien ocupa cada lugar.</p>
      <div class="pasajero"><span class="pasajero__lugar">${numeroDe(ids[0])}</span>
        <span class="grow"><b>${U.esc(`${p.nombre} ${p.apellido || ""}`.trim())}</b><small class="muted d-block">Vos, titular de la reserva · DNI ${U.esc(p.dni || "—")}</small></span></div>
      ${ids.slice(1).map((id) => {
        const a = acompanantes.get(id) || {}, n = numeroDe(id);
        return `<div class="pasajero"><span class="pasajero__lugar">${n}</span>
          <input class="input grow" data-acomp="${id}" data-campo="nombre" value="${U.esc(a.nombre || "")}" placeholder="Nombre y apellido" maxlength="80" autocomplete="off" aria-label="Nombre y apellido de quien ocupa el lugar ${n}"/>
          <input class="input pasajero__dni" data-acomp="${id}" data-campo="dni" value="${U.esc(a.dni || "")}" placeholder="DNI" inputmode="numeric" maxlength="10" autocomplete="off" aria-label="DNI de quien ocupa el lugar ${n}"/>
        </div>`;
      }).join("")}
      <p class="field__error" id="r-pasajeros-error" role="alert"></p>`;
    avisarPasajeros();
  };
  // Con todos los datos escritos, se dice qué falta corregir (por ejemplo, un DNI repetido).
  const avisarPasajeros = () => {
    const el = U.$("#r-pasajeros-error");
    if (!el) return;
    const completos = listaAcompanantes().every((a) => String(a.nombre || "").trim() && String(a.dni || "").trim());
    el.textContent = completos ? errorAcompanantes() || "" : "";
  };
  U.$("#r-pasajeros").addEventListener("input", (e) => {
    const el = e.target.closest("[data-acomp]");
    if (!el) return;
    acompanantes.set(el.dataset.acomp, { ...(acompanantes.get(el.dataset.acomp) || {}), [el.dataset.campo]: el.value });
    avisarPasajeros(); refreshSummary();
  });

  const cargar = async () => {
    [ocupacion, mios] = await Promise.all([D.ocupacionPorTurno(catId, fecha), D.misLugares(catId, fecha)]);
    pintarTurnos(); pintarMios(); pintarAsientos(); pintarPasajeros(); refreshSummary();
  };
  await cargar();

  U.$("#seatmap").addEventListener("click", (e) => {
    const btn = e.target.closest(".seat");
    if (!btn || btn.disabled) return;
    const id = btn.dataset.lugar;
    if (seleccion.has(id)) seleccion.delete(id); else seleccion.add(id);
    btn.classList.toggle("seat--selected", seleccion.has(id));
    btn.setAttribute("aria-pressed", String(seleccion.has(id)));
    pintarPasajeros(); refreshSummary();
  });

  const cambiarTurno = async (t) => {
    if (t === turno) return;
    turno = t; seleccion.clear();
    pintarTurnos(); pintarMios(); pintarAsientos(); pintarPasajeros(); refreshSummary();
  };
  U.$("#r-turno").addEventListener("click", (e) => { const b = e.target.closest("[data-turno]"); if (b) cambiarTurno(b.dataset.turno); });
  U.$("#r-mios").addEventListener("click", (e) => { const b = e.target.closest("[data-ir-turno]"); if (b) cambiarTurno(b.dataset.irTurno); });
  U.$("#r-fecha").addEventListener("change", async () => {
    fecha = U.$("#r-fecha").value || U.todayISO();
    seleccion.clear();
    if (permisoValido) { permisoValido = null; U.$("#r-permres").innerHTML = ""; }
    pintarMisPermisos();
    await cargar();
  });

  /* --- Permiso: comprar o usar uno propio --- */
  const resPermiso = U.$("#r-permres");
  const pintarMisPermisos = () => {
    // Permisos propios vigentes que cubren la fecha elegida (desde la salida para la que se emitieron hasta su vencimiento).
    const dia = (ts) => { const d = new Date(ts); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
    const sirven = permisos.filter((x) => x.id_usuario === ctx.session.user.id && x.estado === "vigente"
      && (x.fecha || dia(x.fecha_emision)) <= fecha && dia(x.fecha_vencimiento) >= fecha);
    U.$("#r-misperm").innerHTML = sirven.length
      ? `<div class="field__hint" style="margin-top:0">Tus permisos vigentes para esta fecha:</div><div class="chips">${sirven.slice(0, 6).map((x) => `<button type="button" class="chip" data-usar="${U.esc(x.numero)}">${U.esc(x.numero)} · ${U.tipoPermisoLabel(x.tipo)}</button>`).join("")}</div>`
      : "";
  };
  pintarMisPermisos();
  const verificar = async () => {
    const num = U.$("#r-numperm").value.trim();
    permisoValido = null; refreshSummary();
    if (!num) { resPermiso.innerHTML = `<div class="nota nota--error">${U.icon("alert-triangle", { size: 18 })}<span>Ingresá el número de tu permiso.</span></div>`; return; }
    const b = U.$("#r-verificar"); b.disabled = true; b.textContent = "Verificando…";
    try {
      permisoValido = await D.validarPermiso(num, fecha);
      U.$("#r-numperm").value = permisoValido.numero;
      resPermiso.innerHTML = `<div class="nota nota--ok">${U.icon("check-circle", { size: 18 })}<span>Permiso <b>${U.esc(permisoValido.numero)}</b> válido · ${U.tipoPermisoLabel(permisoValido.tipo)}${permisoValido.especie ? " · " + U.esc(permisoValido.especie) : ""} · vale hasta el ${U.fmtDate(permisoValido.hasta)}.</span></div>`;
    } catch (err) {
      resPermiso.innerHTML = `<div class="nota nota--error">${U.icon("alert-triangle", { size: 18 })}<span>${U.esc(err.message)}</span></div>`;
    } finally {
      b.disabled = false; b.textContent = "Verificar"; refreshSummary();
    }
  };
  U.$("#r-verificar").addEventListener("click", verificar);
  U.$("#r-numperm").addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); verificar(); } });
  U.$("#r-numperm").addEventListener("input", () => { if (permisoValido) { permisoValido = null; resPermiso.innerHTML = ""; refreshSummary(); } });
  U.$("#r-misperm").addEventListener("click", (e) => { const b = e.target.closest("[data-usar]"); if (b) { U.$("#r-numperm").value = b.dataset.usar; verificar(); } });

  U.$$("[data-permiso]").forEach((b) => b.addEventListener("click", () => {
    modoPermiso = b.dataset.permiso;
    marcar("[data-permiso]", b);
    U.$("#permiso-comprar").classList.toggle("hide", modoPermiso !== "comprar");
    U.$("#permiso-propio").classList.toggle("hide", modoPermiso !== "propio");
    if (modoPermiso === "propio" && !U.$("#r-numperm").value) U.$("#r-numperm").focus();
    refreshSummary();
  }));
  U.$$("[data-tipo]").forEach((b) => b.addEventListener("click", () => { marcar("[data-tipo]", b); refreshSummary(); }));
  U.$$("[data-metodo]").forEach((b) => b.addEventListener("click", () => { metodo = b.dataset.metodo; marcar("[data-metodo]", b); }));

  const labelBtn = `${U.icon("credit-card", { size: 20 })} Pagar y confirmar`;
  confirmBtn.addEventListener("click", async () => {
    if (!seleccion.size) return;
    const errorPasajeros = seleccion.size > 1 ? errorAcompanantes() : null;
    if (errorPasajeros) { U.toast(errorPasajeros, "err"); U.$("#r-pasajeros input")?.focus(); return; }
    if (modoPermiso === "propio" && !permisoValido) { await verificar(); if (!permisoValido) return; }
    const montoPermiso = modoPermiso === "comprar" ? Number(tarifas[tipoActual()] || 0) : 0;
    const monto = seleccion.size * cat.precio + montoPermiso;
    // 1) Pago (pasarela simulada, HU-007). Si se rechaza, no se reserva ni se emite permiso.
    const pago = await pagoModal({ metodo, monto, lugares: seleccion.size, catamaran: cat.nombre, permiso: modoPermiso === "comprar" ? `Permiso ${U.tipoPermisoLabel(tipoActual()).toLowerCase()}` : null, montoPermiso, email: ctx.session.user.email });
    if (!pago) return;                              // canceló
    confirmBtn.disabled = true; confirmBtn.innerHTML = "Procesando…";
    try {
      const res = await D.crearReserva({
        catamaranId: catId, fecha, turno,
        lugares: lugaresOrdenados(),
        acompanantes: listaAcompanantes(),
        metodo,
        tipoPermiso: tipoActual(),
        especieId: U.$("#r-especie").value,
        numeroPermiso: modoPermiso === "propio" ? permisoValido.numero : null,
        autorizacion: pago.autorizacion,
      });
      U.toast("Pago aprobado · Reserva confirmada", "ok");
      ctx.go(`/comprobante/${res.reserva_id}?nuevo=1`);
    } catch (err) {
      U.toast(err.message || "No se pudo completar la reserva.", "err");
      confirmBtn.disabled = false;
      confirmBtn.innerHTML = labelBtn;
      seleccion.clear();
      await cargar();
    }
  });
}

/* Modal de pago simulado. Resuelve con el resultado aprobado o null si se cancela.
 * Permite reintentar dentro del mismo modal cuando la pasarela rechaza. */
function pagoModal({ metodo, monto, lugares, catamaran, permiso = null, montoPermiso = 0, email = "" }) {
  return new Promise((resolve) => {
    let resolved = false;
    const done = (v) => { if (!resolved) { resolved = true; resolve(v); } };
    const campos = {
      tarjeta: `
        <div class="field mt-12"><label for="pg-num">Número de tarjeta</label><input class="input" id="pg-num" inputmode="numeric" autocomplete="cc-number" placeholder="4111 1111 1111 1111" value="4111 1111 1111 1111"/></div>
        <div class="field"><label for="pg-tit">Titular</label><input class="input" id="pg-tit" autocomplete="cc-name" placeholder="Como figura en la tarjeta"/></div>
        <div class="flex gap-12">
          <div class="field grow"><label for="pg-ven">Vencimiento</label><input class="input" id="pg-ven" autocomplete="cc-exp" placeholder="MM/AA"/></div>
          <div class="field grow"><label for="pg-cvv">CVV</label><input class="input" id="pg-cvv" inputmode="numeric" autocomplete="cc-csc" placeholder="123" maxlength="4"/></div>
        </div>
        <p class="field__hint">Pasarela simulada. Tarjeta de prueba aprobada: 4111 1111 1111 1111 · rechazada: cualquier número terminado en 0000.</p>`,
      mercadopago: `
        <div class="pago-mp mt-12">${U.icon("wallet", { size: 22 })}<span>Vas a confirmar el pago con tu cuenta de Mercado Pago.</span></div>
        <div class="field mt-12"><label for="pg-mp">Correo de tu cuenta de Mercado Pago</label><input class="input" id="pg-mp" type="email" autocomplete="email" value="${U.esc(email)}"/></div>
        <p class="field__hint">Pasarela simulada: el pago se aprueba al confirmar.</p>`,
      efectivo: `
        <div class="pago-mp mt-12">${U.icon("cash", { size: 22 })}<span>Abonás en efectivo en la boletería municipal del muelle. Al confirmar, el cobro queda registrado y se emite el comprobante.</span></div>
        <p class="field__hint">Simulación del cobro en boletería.</p>`,
    };
    const m = U.modal({
      title: `Pago · ${U.metodoPagoLabel(metodo)}`,
      dismissable: false,
      body: `
        <div class="summary" style="margin-top:0">
          <div class="flex between"><span>${U.esc(catamaran)}</span><b>${lugares} lugar${lugares > 1 ? "es" : ""}</b></div>
          ${permiso ? `<div class="flex between mt-8"><span>${U.esc(permiso)}</span><b>${montoPermiso ? U.fmtMoney(montoPermiso) : "Sin cargo"}</b></div>` : ""}
          <div class="flex between mt-8 total"><span><b>Total</b></span><b>${U.fmtMoney(monto)}</b></div>
        </div>
        ${campos[metodo] || campos.efectivo}
        <div class="field__error hide" id="pg-err"></div>`,
      actions: [
        { label: "Cancelar", variant: "btn--soft", onClick: () => done(null) },
        {
          label: metodo === "efectivo" ? "Registrar pago" : "Confirmar pago", variant: "btn--cta", close: false,
          onClick: async () => {
            const errBox = U.$("#pg-err"); errBox.classList.add("hide");
            const btn = U.$('[data-act="1"]', m.root); btn.disabled = true; btn.textContent = "Autorizando…";
            const tarjeta = metodo === "tarjeta" ? {
              numero: U.$("#pg-num").value, titular: U.$("#pg-tit").value,
              vencimiento: U.$("#pg-ven").value, cvv: U.$("#pg-cvv").value,
            } : {};
            const cuenta = metodo === "mercadopago" ? U.$("#pg-mp").value : "";
            const res = await D.procesarPago({ metodo, monto, tarjeta, cuenta });
            if (res.aprobado) { U.closeModal(); done(res); return false; }
            // Pago fallido (HU-007 · criterio 2): se informa y se permite reintentar.
            showErr(errBox, res.motivo || "Pago rechazado.");
            btn.disabled = false; btn.textContent = "Reintentar pago";
            return false;
          },
        },
      ],
    });
    if (metodo === "tarjeta") {
      const num = U.$("#pg-num");
      num.addEventListener("input", () => { num.value = num.value.replace(/\D/g, "").slice(0, 19).replace(/(\d{4})(?=\d)/g, "$1 "); });
      const ven = U.$("#pg-ven");
      ven.addEventListener("input", () => { const d = ven.value.replace(/\D/g, "").slice(0, 4); ven.value = d.length > 2 ? d.slice(0, 2) + "/" + d.slice(2) : d; });
    }
  });
}

/* Plano del catamarán visto desde arriba: proa arriba, popa abajo, estribor a
 * la derecha y babor a la izquierda. Los asientos siguen el sentido horario
 * desde la proa (ver D.posicionLugar): con 20 lugares, el 6 queda en el centro
 * del lado derecho. Con `lectura` (salidas del dueño) los lugares no se eligen:
 * los ocupados se muestran como vendidos. */
function planoCatamaran(lugares, ocupados, seleccion, propios = new Set(), { lectura = false } = {}) {
  const total = lugares.length;
  const filas = Math.ceil(total / 2);
  const zonas = { proa: [], centro: [], popa: [] };
  for (let f = 0; f < filas; f++) zonas[f * 3 < filas ? "proa" : f * 3 < filas * 2 ? "centro" : "popa"].push(f);
  const asientos = lugares.map((l, i) => {
    const pos = D.posicionLugar(i + 1, total);
    const occ = ocupados.has(l.id);
    const mio = propios.has(l.id);
    const sel = seleccion.has(l.id);
    const estado = mio ? "tu lugar" : occ ? (lectura ? "vendido" : "ocupado") : "libre";
    const celda = `grid-row:${pos.fila + 1};grid-column:${pos.lado === "estribor" ? 3 : 1}`;
    if (lectura) return `<span class="seat${occ ? " seat--vendido" : ""}" style="${celda}" role="img"
      aria-label="Lugar ${l.numero}, ${pos.lado}, ${pos.zona}, ${estado}" title="Lugar ${l.numero} · ${estado}">${l.numero}</span>`;
    const cls = mio ? "seat seat--mio" : occ ? "seat seat--occupied" : sel ? "seat seat--selected" : "seat";
    return `<button type="button" class="${cls}" data-lugar="${l.id}" ${occ || mio ? "disabled" : `aria-pressed="${sel}"`}
      style="${celda}"
      title="Lugar ${l.numero} · ${pos.lado}, ${pos.zona}" aria-label="Lugar ${l.numero}, ${pos.lado}, ${pos.zona}, ${estado}">${mio ? U.icon("check", { size: 16, stroke: 3 }) : ""}${l.numero}</button>`;
  }).join("");
  const centro = Object.entries(zonas).filter(([, fs]) => fs.length).map(([zona, fs]) => `
    <div class="barco__zona barco__zona--${zona}" style="grid-row:${fs[0] + 1} / span ${fs.length}">
      ${zona === "proa" ? `<span class="barco__cabina">${U.icon("steering", { size: 22 })}<small>Cabina</small></span>` : ""}
      <span class="barco__zona-nombre">${zona === "proa" ? "Proa" : zona === "centro" ? "Centro" : "Popa"}</span>
    </div>`).join("");
  return `<div class="barco">
    <div class="barco__rotulo">${U.icon("chevron-left", { size: 14, stroke: 2.6, cls: "barco__flecha" })}Proa · adelante</div>
    <svg class="barco__proa" viewBox="0 0 300 74" preserveAspectRatio="none" aria-hidden="true">
      <path d="M0 74 V40 C0 22 10 8 26 0 C42 8 52 22 52 40 V74 Z" class="casco"/>
      <path d="M300 74 V40 C300 22 290 8 274 0 C258 8 248 22 248 40 V74 Z" class="casco"/>
      <path d="M52 74 V52 Q150 30 248 52 V74 Z" class="cubierta"/>
      <path d="M52 52 Q150 30 248 52" class="baranda"/>
      <path d="M26 6 V60 M274 6 V60" class="quilla"/>
    </svg>
    <div class="barco__cubierta">
      <span class="barco__lado barco__lado--babor">Babor · izquierda</span>
      <span class="barco__lado barco__lado--estribor">Estribor · derecha</span>
      <div class="barco__grilla" style="grid-template-rows:repeat(${filas}, 44px)">${centro}${asientos}</div>
    </div>
    <svg class="barco__popa" viewBox="0 0 300 58" preserveAspectRatio="none" aria-hidden="true">
      <path d="M0 0 H300 V14 H0 Z" class="cubierta"/>
      <path d="M0 0 H52 V24 Q52 30 46 30 H6 Q0 30 0 24 Z M248 0 H300 V24 Q300 30 294 30 H254 Q248 30 248 24 Z" class="casco"/>
      <rect x="14" y="30" width="24" height="18" rx="5" class="motor"/>
      <rect x="262" y="30" width="24" height="18" rx="5" class="motor"/>
      <path d="M8 54 Q26 48 44 54 M256 54 Q274 48 292 54" class="estela"/>
    </svg>
    <div class="barco__rotulo barco__rotulo--popa">Popa · motores</div>
  </div>`;
}

/* ============================================================================
 *  COMPROBANTE (reserva + pago + permiso)
 * ========================================================================== */
function textoComprobante(c) {
  return [
    `*Reserva ${c.numero}* · ${CFG.LUGAR || "Dique Cabra Corral"}`,
    `Catamarán: ${c.catamaran}`,
    `Salida: ${U.fmtDate(c.fecha)} · turno ${U.turnoLabel(c.turno).toLowerCase()}`,
    `Lugares: ${c.lugares.map((n) => `${n} (${D.ubicacionLugar(n, c.capacidad || c.lugares.length)})`).join(", ")}`,
    c.acompanantes?.length ? `Acompañantes: ${c.acompanantes.map((a) => `${a.nombre} (lugar ${a.lugar})`).join(", ")}` : "",
    c.permiso ? `Permiso de pesca: ${c.permiso.numero} (${U.tipoPermisoLabel(c.permiso.tipo).toLowerCase()})` : "",
    c.pago ? `Pago: ${c.pago.comprobante} · ${U.metodoPagoLabel(c.pago.metodo)} · ${U.fmtMoney(c.monto_total)}` : "",
    CFG.MUNICIPIO || "Municipio de Coronel Moldes",
  ].filter(Boolean).join("\n");
}

function imagenComprobante(c) {
  const filas = [
    ["Catamarán", c.catamaran],
    ["Salida", `${U.fmtDate(c.fecha)} · ${U.turnoLabel(c.turno)}`],
    ["Lugares", lugaresTexto(c.lugares)],
    ["Titular", c.titular?.nombre || "—"],
    ["Permiso", c.permiso ? `${c.permiso.numero} · ${U.tipoPermisoLabel(c.permiso.tipo)}` : "—"],
    ["Comprobante", c.pago?.comprobante || "—"],
    ["Medio de pago", c.pago ? U.metodoPagoLabel(c.pago.metodo) : "—"],
    ["Fecha de pago", c.pago ? U.fmtDateTime(c.pago.fecha_pago) : "—"],
  ];
  return U.tarjetaImagen({
    banda: { texto: c.estado === "cancelada" ? "RESERVA CANCELADA" : "RESERVA CONFIRMADA", color: c.estado === "cancelada" ? "#B42318" : "#2E7D4F" },
    titulo: c.numero, destacado: { label: "Total abonado", valor: U.fmtMoney(c.monto_total) }, filas,
    pie: "Presentá este comprobante al embarcar.",
    lugar: CFG.LUGAR || "Dique Cabra Corral", municipio: CFG.MUNICIPIO || "Municipio de Coronel Moldes",
  });
}

export async function viewComprobante(ctx) {
  const p = ctx.session.profile;
  const c = await D.getComprobante(ctx.params.id);
  if (!c) { U.mount(appShell({ active: null, rol: p.rol, topbarHtml: topbar({ title: "Comprobante", back: true, bell: false }), bodyHtml: emptyState("Comprobante no encontrado", "Revisá tus reservas en el historial.", "receipt") })); wireChrome(ctx); return; }
  const nuevo = ctx.params.nuevo === "1";
  const per = c.permiso;
  const perBadge = per ? U.estadoPermisoBadge(per.estado) : null;
  const resBadge = U.estadoReservaBadge(c.estado);
  const fila = (k, v) => `<div class="permit__row"><span>${U.esc(k)}</span><b>${v}</b></div>`;
  // Reserva de un pasajero en un catamarán del dueño: sólo la salida y los lugares.
  const pasajero = c.id_usuario !== p.id && !isAdmin(p.rol);
  if (pasajero) {
    U.mount(appShell({
      active: null, rol: p.rol,
      topbarHtml: topbar({ title: "Reserva", back: true, bell: false }),
      bodyHtml: `
        <section class="doc" id="comprobante">
          <div class="doc__head">${U.icon("boat", { size: 18 })}<span>Reserva de un pasajero</span><span class="badge ${resBadge.cls}">${resBadge.label}</span></div>
          <div class="doc__numero"><small>N° de reserva</small><b>${U.esc(c.numero)}</b></div>
          <div class="permit__body">
            ${fila("Catamarán", U.esc(c.catamaran))}
            ${fila("Fecha de salida", U.fmtDate(c.fecha))}
            ${fila("Turno", U.turnoLabel(c.turno))}
            <div class="permit__row permit__row--col"><span>Lugares</span>
              <div class="chips">${c.lugares.map((n) => `<span class="chip chip--lugar"><b>${n}</b> ${U.esc(D.ubicacionLugar(n, c.capacidad || c.lugares.length))}</span>`).join("")}</div></div>
            <div class="permit__row doc__total"><span>Total de la reserva</span><b>${U.fmtMoney(c.monto_total)}</b></div>
          </div>
        </section>
        <p class="muted center mt-12" style="font-size:.8rem">${U.icon("shield", { size: 14 })} El nombre y el DNI del titular están en la lista de embarque de la salida. El correo, el teléfono, el pago y el permiso sólo los ven el pasajero y el Municipio. Al embarcar, pedile su permiso digital.</p>
      `,
    }));
    wireChrome(ctx);
    return;
  }

  U.mount(appShell({
    active: null, rol: p.rol,
    topbarHtml: topbar({ title: "Comprobante", back: !nuevo, bell: false }),
    bodyHtml: `
      ${nuevo ? `<div id="invitar-push"></div>` : ""}
      ${nuevo ? `<div class="exito">
        <span class="exito__ic">${U.icon("check", { size: 34, stroke: 3 })}</span>
        <h2>¡Listo! Tu reserva está confirmada</h2>
        <p>Guardá o compartí este comprobante: lo vas a presentar al embarcar junto con tu permiso.</p>
      </div>` : ""}

      <section class="doc" id="comprobante">
        <div class="doc__head">${U.icon("boat", { size: 18 })}<span>Reserva de catamarán</span><span class="badge ${resBadge.cls}">${resBadge.label}</span></div>
        <div class="doc__numero"><small>N° de reserva</small><b>${U.esc(c.numero)}</b></div>
        <div class="permit__body">
          ${fila("Catamarán", U.esc(c.catamaran))}
          ${fila("Fecha de salida", U.fmtDate(c.fecha))}
          ${fila("Turno", U.turnoLabel(c.turno))}
          ${fila("Titular", U.esc(c.titular?.nombre || "—"))}
          <div class="permit__row permit__row--col"><span>Lugares</span>
            <div class="chips">${c.lugares.map((n) => `<span class="chip chip--lugar"><b>${n}</b> ${U.esc(D.ubicacionLugar(n, c.capacidad || c.lugares.length))}</span>`).join("")}</div></div>
          ${c.acompanantes?.length ? `<div class="permit__row permit__row--col"><span>Acompañantes</span>
            <div class="pasajeros-lista">${c.acompanantes.map((a) => `<div><b>${a.lugar}</b><span>${U.esc(a.nombre)}</span><small>DNI ${U.esc(a.dni)}</small></div>`).join("")}</div></div>` : ""}
        </div>
      </section>

      <section class="doc mt-16">
        <div class="doc__head">${U.icon("receipt", { size: 18 })}<span>Comprobante de pago</span>${c.pago ? `<span class="badge ${c.pago.estado === "aprobado" ? "badge--ok" : "badge--warn"}">${c.pago.estado === "aprobado" ? "Aprobado" : U.esc(c.pago.estado)}</span>` : ""}</div>
        <div class="doc__numero"><small>N° de comprobante</small><b>${U.esc(c.pago?.comprobante || "—")}</b></div>
        <div class="permit__body">
          ${c.pago ? fila("Fecha y hora", U.fmtDateTime(c.pago.fecha_pago)) : ""}
          ${c.pago ? fila("Medio de pago", U.esc(U.metodoPagoLabel(c.pago.metodo))) : ""}
          ${c.pago?.autorizacion ? fila("Autorización", U.esc(c.pago.autorizacion)) : ""}
          ${fila(`Lugares (${c.cantidad_lugares} × ${U.fmtMoney(c.precio_lugar)})`, U.fmtMoney(c.monto_lugares))}
          ${per ? fila(per.propio ? `Permiso propio ${per.numero}` : `Permiso ${U.tipoPermisoLabel(per.tipo).toLowerCase()}`, c.monto_permiso ? U.fmtMoney(c.monto_permiso) : "Sin cargo") : ""}
          <div class="permit__row doc__total"><span>Total abonado</span><b>${U.fmtMoney(c.monto_total)}</b></div>
        </div>
      </section>

      ${per ? `<section class="doc mt-16">
        <div class="doc__head">${U.icon("ticket", { size: 18 })}<span>Permiso de pesca</span><span class="badge ${perBadge.cls}">${perBadge.label}</span></div>
        <div class="doc__numero"><small>N° de permiso</small><b>${U.esc(per.numero)}</b></div>
        <div class="permit__body">
          ${fila("Tipo", U.tipoPermisoLabel(per.tipo))}
          ${fila("Especie", U.esc(per.especie))}
          ${fila("Vence", U.fmtDate(per.fecha_vencimiento))}
          ${fila("Origen", per.propio ? "Permiso que ya tenías" : "Emitido con esta reserva")}
        </div>
        <div class="permit__actions"><a class="btn btn--outline btn--block" href="#/permiso/${per.id}">${U.icon("qr", { size: 18 })} Ver permiso con código QR</a></div>
      </section>` : ""}

      <div class="stack mt-16">
        <button class="btn btn--primary btn--block" data-share>${U.icon("share", { size: 18 })} Compartir comprobante</button>
        <button class="btn btn--soft btn--block" data-print>${U.icon("download", { size: 18 })} Descargar PDF</button>
        ${nuevo ? `<a class="btn btn--outline btn--block" href="#/home">${U.icon("home", { size: 18 })} Volver al inicio</a>` : ""}
      </div>
    `,
  }));
  wireChrome(ctx);
  if (nuevo) invitarAvisos(U.$("#invitar-push"));
  U.$("[data-print]").addEventListener("click", () => window.print());
  U.$("[data-share]").addEventListener("click", () => U.compartir({
    titulo: `Reserva ${c.numero}`, texto: textoComprobante(c),
    imagen: imagenComprobante(c), archivo: `reserva-${c.numero}.png`,
  }));
}

/* ============================================================================
 *  PERMISO DIGITAL
 * ========================================================================== */
function textoPermiso(permiso) {
  return [
    `*Permiso de pesca ${permiso.numero}* · ${U.estadoPermisoBadge(permiso.estado).label}`,
    `Titular: ${permiso.titular_nombre} (DNI ${permiso.titular_dni})`,
    `Especie: ${permiso.especie_nombre} · ${U.tipoPermisoLabel(permiso.tipo)}`,
    permiso.fecha ? `Salida: ${U.fmtDate(permiso.fecha)}${permiso.turno ? " · turno " + U.turnoLabel(permiso.turno).toLowerCase() : ""} · ${permiso.catamaran_nombre}` : "",
    `Vence: ${U.fmtDate(permiso.fecha_vencimiento)}`,
    `${CFG.LUGAR || "Dique Cabra Corral"} · ${CFG.MUNICIPIO || "Municipio de Coronel Moldes"}`,
  ].filter(Boolean).join("\n");
}

function imagenPermiso(permiso) {
  const banda = permiso.estado === "vencido" ? { texto: "PERMISO VENCIDO", color: "#8E827C" }
    : permiso.estado === "anulado" ? { texto: "PERMISO ANULADO", color: "#B42318" }
    : { texto: "PERMISO VIGENTE", color: "#2E7D4F" };
  return U.tarjetaImagen({
    banda, qr: permiso.codigo_qr, titulo: permiso.numero,
    filas: [
      ["Titular", permiso.titular_nombre], ["DNI", permiso.titular_dni],
      ["Especie", permiso.especie_nombre], ["Catamarán", permiso.catamaran_nombre],
      ["Fecha de salida", permiso.fecha ? U.fmtDate(permiso.fecha) : "—"],
      ["Tipo", U.tipoPermisoLabel(permiso.tipo)], ["Vencimiento", U.fmtDate(permiso.fecha_vencimiento)],
    ],
    pie: "Presentá este permiso al personal de control.",
    lugar: CFG.LUGAR || "Dique Cabra Corral", municipio: CFG.MUNICIPIO || "Municipio de Coronel Moldes",
  });
}

export async function viewPermiso(ctx) {
  const p = ctx.session.profile;
  const permiso = await D.getPermiso(ctx.params.id);
  if (!permiso) { U.mount(appShell({ active: null, rol: p.rol, topbarHtml: topbar({ title: "Permiso", back: true, bell: false }), bodyHtml: emptyState("Permiso no encontrado", "Puede haber sido anulado.", "ticket") })); wireChrome(ctx); return; }

  const estadoCls = permiso.estado === "vencido" ? "is-vencido" : permiso.estado === "anulado" ? "is-anulado" : "";
  const estadoTxt = permiso.estado === "vencido" ? "PERMISO VENCIDO" : permiso.estado === "anulado" ? "PERMISO ANULADO" : "PERMISO VIGENTE";

  U.mount(appShell({
    active: null, rol: p.rol,
    topbarHtml: topbar({ title: "Permiso digital", back: true, bell: false }),
    bodyHtml: `
      <div class="permit" id="permit">
        <div class="permit__head ${estadoCls}">${estadoTxt}</div>
        <div class="permit__qr">${qrSvg(permiso.codigo_qr)}</div>
        <div class="center" style="margin:-2px 0 6px"><b style="font-size:1.25rem;letter-spacing:.5px">${U.esc(permiso.numero)}</b></div>
        <div class="permit__body">
          ${permitRow("Titular", permiso.titular_nombre)}
          ${permitRow("DNI", permiso.titular_dni)}
          ${permitRow("Especie", permiso.especie_nombre)}
          ${permitRow("Catamarán", permiso.catamaran_nombre)}
          ${permitRow("Fecha de salida", permiso.fecha ? U.fmtDate(permiso.fecha) : "—")}
          ${permitRow("Turno", permiso.turno ? U.turnoLabel(permiso.turno) : "—")}
          ${permitRow("Tipo", U.tipoPermisoLabel(permiso.tipo))}
          ${permitRow("Emisión", U.fmtDate(permiso.fecha_emision))}
          ${permitRow("Vencimiento", U.fmtDate(permiso.fecha_vencimiento))}
          ${permiso.monto_total ? permitRow("Importe abonado", U.fmtMoney(permiso.monto_total)) : ""}
          ${permiso.pago_comprobante ? permitRow("Comprobante de pago", `${permiso.pago_comprobante} · ${U.metodoPagoLabel(permiso.pago_metodo)}`) : ""}
        </div>
        <div class="permit__actions stack">
          <button class="btn btn--primary btn--block" data-share>${U.icon("share", { size: 18 })} Compartir</button>
          <button class="btn btn--soft btn--block" data-print>${U.icon("download", { size: 18 })} Descargar PDF</button>
          ${permiso.reserva_id ? `<a class="btn btn--outline btn--block" href="#/comprobante/${permiso.reserva_id}">${U.icon("receipt", { size: 18 })} Ver comprobante de la reserva</a>` : ""}
        </div>
      </div>
      <p class="muted center mt-12" style="font-size:.8rem">${U.icon("shield", { size: 14 })} Presentá este permiso al personal de control. El código QR permite validar su autenticidad.</p>
    `,
  }));
  wireChrome(ctx);

  U.$("[data-print]")?.addEventListener("click", () => window.print());
  U.$("[data-share]")?.addEventListener("click", () => U.compartir({
    titulo: `Permiso ${permiso.numero}`, texto: textoPermiso(permiso),
    imagen: imagenPermiso(permiso), archivo: `permiso-${permiso.numero}.png`,
  }));
}
function permitRow(label, value) {
  return `<div class="permit__row"><span>${U.esc(label)}</span><b>${U.esc(value)}</b></div>`;
}

/* ============================================================================
 *  HISTORIAL (reservas / permisos)
 * ========================================================================== */
export async function viewHistorial(ctx) {
  const p = ctx.session.profile;
  const tab = ctx.params.tab === "permisos" ? "permisos" : "reservas";
  const [todas, permisos, notifs] = await Promise.all([D.listReservas(), D.listPermisos(), D.listNotificaciones()]);
  const unread = notifs.filter((n) => !n.leida).length;
  const hoy = U.todayISO();
  // Sólo las reservas propias: las de los pasajeros del dueño están en Mi flota › Salidas.
  const reservas = todas.filter((r) => r.id_usuario === p.id);

  const reservasHtml = reservas.length ? reservas.map((r) => {
    const b = U.estadoReservaBadge(r.estado);
    const cancelable = r.estado === "confirmada" && r.fecha >= hoy;
    const lugares = r.lugares?.length
      ? `Lugar${r.lugares.length > 1 ? "es" : ""} ${r.lugares.join(", ")}`
      : `${r.cantidad_lugares} lugar${r.cantidad_lugares > 1 ? "es" : ""}`;
    return `<div class="row-item row-item--wrap">
      <div class="row-item__ic">${U.icon("boat", { size: 20 })}</div>
      <div class="row-item__main">
        <h2>${U.esc(r.catamaran_nombre)}</h2>
        ${r.numero ? `<small>${U.esc(r.numero)}</small>` : ""}
        <small>${U.fmtDate(r.fecha)} · ${U.turnoLabel(r.turno)} · ${lugares} · ${U.fmtMoney(r.monto_total)}</small>
      </div>
      <span class="badge ${b.cls}">${b.label}</span>
      <div class="row-item__actions">
          <a class="btn btn--soft btn--sm" href="#/comprobante/${r.id}">Comprobante</a>
          ${r.permiso_id ? `<a class="btn btn--soft btn--sm" href="#/permiso/${r.permiso_id}">Permiso</a>` : ""}
          ${cancelable ? `<button class="btn btn--danger btn--sm" data-anular="${r.id}">Anular</button>` : ""}
        </div>
    </div>`;
  }).join("") : emptyState("Sin reservas todavía", p.rol === "dueno" ? "Cuando reserves una salida como pasajero, aparecerá acá. Las reservas de tus catamaranes están en Mi flota." : "Cuando reserves una salida, aparecerá acá.", "calendar");

  const permisosHtml = permisos.length ? permisos.map((per) => {
    const cls = per.estado === "vencido" ? "is-vencido" : per.estado === "anulado" ? "is-anulado" : "";
    const b = U.estadoPermisoBadge(per.estado);
    return `<a class="permit-mini" href="#/permiso/${per.id}" style="margin-bottom:10px">
      <div class="permit-mini__badge ${cls}">${U.icon("ticket", { size: 22 })}</div>
      <div class="grow"><h2>${U.esc(per.numero)}</h2><small>${U.esc(per.especie_nombre)} · ${per.fecha ? U.fmtDate(per.fecha) : "—"}</small></div>
      <span class="badge ${b.cls}">${b.label}</span>
    </a>`;
  }).join("") : emptyState("Sin permisos todavía", "Tus permisos digitales aparecerán acá.", "ticket");

  U.mount(appShell({
    active: "historial", rol: p.rol,
    topbarHtml: topbar({ title: "Historial", bell: true, unread }),
    bodyHtml: `
      <div class="tabs">
        <button class="${tab === "reservas" ? "active" : ""}" data-tab="reservas">Reservas</button>
        <button class="${tab === "permisos" ? "active" : ""}" data-tab="permisos">Permisos</button>
      </div>
      <div id="tab-body">${tab === "reservas" ? reservasHtml : permisosHtml}</div>
    `,
  }));
  wireChrome(ctx);

  U.$$("[data-tab]").forEach((b) => b.addEventListener("click", () => ctx.go(`/historial?tab=${b.dataset.tab}`)));
  U.$$("[data-anular]").forEach((b) => b.addEventListener("click", async () => {
    const ok = await U.confirmDialog({ title: "Anular reserva", message: "Se cancelará la reserva y su permiso quedará anulado. ¿Confirmás?", okLabel: "Sí, anular", okVariant: "btn--primary" });
    if (!ok) return;
    try { await D.anularReserva(b.dataset.anular); U.toast("Reserva anulada", "ok"); ctx.rerender(); }
    catch (err) { U.toast(err.message, "err"); }
  }));
}

/* ============================================================================
 *  PERFIL
 * ========================================================================== */
export async function viewPerfil(ctx) {
  const p = ctx.session.profile;
  const conClave = ctx.session.user.metodo === "clave";
  const notifs = await D.listNotificaciones();
  const unread = notifs.filter((n) => !n.leida).length;

  U.mount(appShell({
    active: "perfil", rol: p.rol,
    topbarHtml: topbar({ title: "Perfil", bell: true, unread }),
    bodyHtml: `
      <div class="profile-hero">
        <div class="avatar">${ctx.session.user.avatar
          ? `<img src="${U.esc(ctx.session.user.avatar)}" alt="" referrerpolicy="no-referrer"/>`
          : U.initials(p.nombre, p.apellido)}</div>
        <div class="center">
          <h2>${U.esc(p.nombre)} ${U.esc(p.apellido || "")}</h2>
          <div class="muted" style="font-weight:600">${U.esc(p.email)}</div>
          <span class="badge badge--info mt-8">${U.icon("shield", { size: 13 })} ${U.rolLabel(p.rol)}</span>
        </div>
      </div>

      <h2 class="section-title">Datos personales</h2>
      <div class="card card--flat">
        <form id="f-perfil">
          <div class="flex gap-12">
            <div class="field grow"><label for="pf-nombre">Nombre</label><input class="input" id="pf-nombre" value="${U.esc(p.nombre)}"/></div>
            <div class="field grow"><label for="pf-apellido">Apellido</label><input class="input" id="pf-apellido" value="${U.esc(p.apellido || "")}"/></div>
          </div>
          <div class="field"><label for="pf-tel">Teléfono</label><input class="input" id="pf-tel" value="${U.esc(p.telefono || "")}"/></div>
          <div class="field"><label for="pf-dni">DNI</label><input class="input" id="pf-dni" value="${U.esc(p.dni || "")}"/></div>
          <button class="btn btn--primary btn--block" type="submit">${U.icon("check", { size: 18 })} Guardar cambios</button>
        </form>
      </div>

      ${(p.rol === "dueno") ? `<a class="btn btn--outline btn--block mt-12" href="#/gestion">${U.icon("steering", { size: 18 })} Ir a Mi flota</a>` : ""}
      ${isAdmin(p.rol) ? `<a class="btn btn--outline btn--block mt-12" href="#/admin">${U.icon("grid", { size: 18 })} Ir al panel municipal</a>` : ""}

      <h2 class="section-title mt-24">Notificaciones</h2>
      <div class="card card--flat">
        <label class="flex between items-center" style="cursor:pointer;gap:12px">
          <span><b>Recordatorios de salida</b><br><small class="muted">Aviso el día previo y el día de tu reserva.</small></span>
          <input type="checkbox" id="pf-recordatorios" ${D.prefRecordatorios() ? "checked" : ""} style="width:22px;height:22px;accent-color:var(--blue-600)"/>
        </label>
        <div id="pf-push"></div>
      </div>

      <h2 class="section-title mt-24">Cuenta</h2>
      <div class="card card--flat">
        ${conClave
          ? `<div class="permit__row"><span>Ingreso</span><b>${U.icon("lock", { size: 16 })} Usuario y contraseña</b></div>
        <div class="permit__row"><span>Usuario</span><b>${U.esc(String(ctx.session.user.email || "").split("@")[0])}</b></div>`
          : `<div class="permit__row"><span>Ingreso</span><b>${GOOGLE_G} Cuenta de Google</b></div>
        <div class="permit__row"><span>Correo</span><b>${U.esc(ctx.session.user.email)}</b></div>`}
        <div class="permit__row"><span>Modo de datos</span><b>${D.MODE === "demo" ? "Demostración (local)" : "Supabase (en la nube)"}</b></div>
        <p class="field__hint mt-8">${conClave ? "La contraseña de las cuentas del personal la asigna y la renueva la administración del sistema." : "La contraseña y la verificación en dos pasos se administran desde tu cuenta de Google."}</p>
        ${D.MODE === "supabase" && !conClave ? `<a class="btn btn--outline btn--block mt-12" href="https://myaccount.google.com/security" target="_blank" rel="noopener">${U.icon("shield", { size: 18 })} Seguridad de mi cuenta de Google</a>` : ""}
        ${D.MODE === "demo" ? `<button class="btn btn--soft btn--block mt-12" data-reset>${U.icon("refresh", { size: 18 })} Reiniciar datos de demo</button>` : ""}
      </div>

      <button class="btn btn--danger btn--block mt-16" data-logout>${U.icon("logout", { size: 18 })} Cerrar sesión</button>
      <p class="muted center mt-16" style="font-size:.78rem">PescaCorral · ${U.esc(CFG.MUNICIPIO || "Municipio de Coronel Moldes")}</p>
    `,
  }));
  wireChrome(ctx);

  if (!isAdmin(p.rol)) panelAvisosTelefono(U.$("#pf-push"));
  U.$("#f-perfil").addEventListener("submit", async (e) => {
    e.preventDefault();
    const obligatorios = [["#pf-nombre", "nombre"], ["#pf-apellido", "apellido"], ["#pf-dni", "DNI"]];
    const faltan = obligatorios.filter(([sel]) => !U.$(sel).value.trim());
    obligatorios.forEach(([sel]) => U.$(sel).classList.toggle("input--error", !U.$(sel).value.trim()));
    if (faltan.length) { U.toast(`Completá: ${faltan.map(([, n]) => n).join(", ")}.`, "err"); return; }
    const dniDig = U.$("#pf-dni").value.replace(/\D/g, "");
    if (dniDig.length < 7 || dniDig.length > 8) { U.toast("Ingresá un DNI válido, de 7 u 8 dígitos.", "err"); U.$("#pf-dni").classList.add("input--error"); return; }
    try {
      await D.updateProfile({
        nombre: U.$("#pf-nombre").value.trim(), apellido: U.$("#pf-apellido").value.trim(),
        telefono: U.$("#pf-tel").value.trim(), dni: dniDig.replace(/\B(?=(\d{3})+(?!\d))/g, "."),
      });
      U.toast("Perfil actualizado", "ok");
      ctx.rerender();
    } catch (err) { U.toast(err.message, "err"); }
  });
  U.$("#pf-recordatorios")?.addEventListener("change", (e) => {
    D.setPrefRecordatorios(e.target.checked);
    U.toast(e.target.checked ? "Recordatorios activados" : "Recordatorios desactivados", "ok");
  });
  U.$("[data-reset]")?.addEventListener("click", async () => {
    const ok = await U.confirmDialog({ title: "Reiniciar demo", message: "Se restauran los datos de ejemplo y se cierra la sesión. ¿Continuar?", okLabel: "Reiniciar" });
    if (!ok) return;
    await D.resetDemo(); U.toast("Datos de demo restaurados", "ok"); ctx.go("/login");
  });
  U.$("[data-logout]")?.addEventListener("click", () => salir(ctx));
}

/* ============================================================================
 *  AVISOS AL TELÉFONO (Web Push): activar o desactivar en este dispositivo
 * ========================================================================== */
const TEXTO_PUSH = {
  activo: "Activados en este teléfono: te llegan los avisos de tus salidas, del municipio y los recordatorios, aunque la aplicación esté cerrada.",
  inactivo: "Recibí en el teléfono los avisos de tus salidas (por ejemplo, si se suspende o está por zarpar), del municipio y los recordatorios, aunque la aplicación esté cerrada.",
  bloqueado: "Las notificaciones de este sitio están bloqueadas. Habilitalas en la configuración del navegador para recibir los avisos.",
  instalar: "En iPhone, primero agregá PescaCorral a la pantalla de inicio (Compartir › Agregar a inicio) y abrila desde ahí para activar los avisos.",
};

async function panelAvisosTelefono(box) {
  if (!box) return;
  const estado = await D.estadoPush();
  if (estado === "no-disponible") { box.innerHTML = ""; return; }
  box.innerHTML = `<div class="push-panel">
    <span><b>Avisos en el teléfono</b><small class="muted d-block">${U.esc(TEXTO_PUSH[estado])}</small></span>
    ${estado === "activo" ? `<button type="button" class="btn btn--soft btn--sm" data-push="off">Desactivar</button>`
      : estado === "inactivo" ? `<button type="button" class="btn btn--primary btn--sm" data-push="on">${U.icon("bell", { size: 16 })} Activar</button>` : ""}
  </div>`;
  U.$("[data-push]", box)?.addEventListener("click", async (e) => {
    const b = e.currentTarget; b.disabled = true;
    try {
      if (b.dataset.push === "on") { await D.activarPush(); U.toast("Avisos activados en este teléfono", "ok"); }
      else { await D.desactivarPush(); U.toast("Avisos desactivados en este teléfono", "ok"); }
    } catch (err) { U.toast(err.message, "err"); }
    panelAvisosTelefono(box);
  });
}

/* Después de reservar: si el teléfono admite avisos y no están activados, se ofrecen. */
async function invitarAvisos(box) {
  if (!box || await D.estadoPush() !== "inactivo") return;
  box.innerHTML = `<div class="nota nota--agua" style="margin-bottom:14px">${U.icon("bell", { size: 18 })}
    <span>Activá los avisos en el teléfono para enterarte al instante si tu salida se suspende o está por zarpar.</span>
    <button type="button" class="btn btn--primary btn--sm" data-push="on">Activar</button></div>`;
  U.$("[data-push]", box).addEventListener("click", async () => {
    try { await D.activarPush(); box.innerHTML = ""; U.toast("Avisos activados en este teléfono", "ok"); }
    catch (err) { U.toast(err.message, "err"); }
  });
}

/* ============================================================================
 *  NOTIFICACIONES (drawer modal)
 * ========================================================================== */
async function openNotificaciones(ctx) {
  const notifs = await D.listNotificaciones();
  const body = notifs.length ? `<div class="notif-list">${notifs.map((n) => `
    <div class="notif ${n.leida ? "" : "unread"}">
      ${n.tipo === "aviso" ? `<span class="notif__tag">${U.icon("megaphone", { size: 14 })} Aviso del ${U.esc(CFG.MUNICIPIO || "municipio")}</span>` : ""}
      ${n.tipo === "salida" ? `<span class="notif__tag">${U.icon("boat", { size: 14 })} ${U.esc(n.reserva?.catamaran?.nombre || "Tu catamarán")}${n.reserva ? ` · salida del ${U.fmtDate(n.reserva.fecha)}, turno ${U.turnoLabel(n.reserva.turno).toLowerCase()}` : ""}</span>` : ""}
      <h3>${U.esc(n.titulo)}</h3>
      <p>${U.esc(n.mensaje)}</p>
      <small>${U.fmtRelative(n.created_at)}</small>
    </div>`).join("")}</div>`
    : `<div class="empty">${U.icon("bell", { size: 40 })}<h3>Sin notificaciones</h3><p>Te avisaremos cuando haya novedades.</p></div>`;

  U.modal({
    title: "Notificaciones",
    body,
    actions: notifs.some((n) => !n.leida)
      ? [{ label: "Marcar todo como leído", variant: "btn--primary", onClick: async () => { await D.marcarLeidas(); ctx.rerender(); } }]
      : [],
  });
}

/* ============================================================================
 *  PANEL MUNICIPAL (dashboard)
 * ========================================================================== */
export async function viewAdmin(ctx) {
  // Filtros (HU-013 · criterio 2): rango de fechas y embarcación.
  const hoy = U.todayISO();
  const to = /^\d{4}-\d{2}-\d{2}$/.test(ctx.params.to || "") ? ctx.params.to : hoy;
  const from = /^\d{4}-\d{2}-\d{2}$/.test(ctx.params.from || "") && ctx.params.from <= to ? ctx.params.from : U.addDaysISO(to, -13);
  const catSel = ctx.params.cat || "";

  const [resumen, porDia, porEspecie, dispo, ultimos] = await Promise.all([
    D.dashboardResumen(), D.reservasPorDia({ from, to }),
    D.permisosPorEspecie(), D.disponibilidad(to), D.ultimosPermisos(6),
  ]);
  // Ocupación "en tiempo real" del día seleccionado (fin del rango), por embarcación.
  const ocupacionAll = dispo.map((c) => ({ id: c.id, nombre: c.nombre, capacidad: Number(c.plazas), lugares_ocupados: c.ocupados }));
  const ocupacion = catSel ? ocupacionAll.filter((o) => o.id === catSel) : ocupacionAll;

  // Serie diaria del período (rellena ceros; agrupa por semana si el rango es largo)
  const nDias = Math.round((new Date(to) - new Date(from)) / 86400000) + 1;
  const dias = [];
  for (let i = nDias - 1; i >= 0; i--) {
    const iso = U.addDaysISO(to, -i);
    const row = porDia.find((d) => d.fecha === iso);
    dias.push({ label: nDias > 21 ? U.fmtDateShort(iso) : iso.slice(8), value: row ? Number(row.cantidad_reservas) : 0 });
  }
  const serie = nDias > 31
    ? dias.reduce((acc, d, i) => { const k = Math.floor(i / 7); (acc[k] ||= { label: "sem " + (k + 1), value: 0 }).value += d.value; return acc; }, [])
    : dias;
  const reservasPeriodo = porDia.reduce((s, d) => s + Number(d.cantidad_reservas), 0);
  const ingresosPeriodo = porDia.reduce((s, d) => s + Number(d.ingresos), 0);
  const especieData = porEspecie.filter((e) => e.permisos_emitidos > 0).map((e, i) => ({ label: e.especie, value: Number(e.permisos_emitidos), color: CHART_COLORS[i % CHART_COLORS.length] }));

  U.mount(adminLayout({
    active: "panel",
    title: "Panel municipal",
    subtitle: `${CFG.MUNICIPIO || "Municipio de Coronel Moldes"} · ${CFG.LUGAR || "Dique Cabra Corral"}`,
    actions: `
      <input class="input" type="date" id="pa-from" value="${from}" max="${to}" style="width:auto;padding:8px 10px;font-size:.85rem" aria-label="Desde"/>
      <span class="muted">a</span>
      <input class="input" type="date" id="pa-to" value="${to}" max="${hoy}" style="width:auto;padding:8px 10px;font-size:.85rem" aria-label="Hasta"/>
      <select class="select" id="pa-cat" style="width:auto;padding:8px 10px;font-size:.85rem" aria-label="Embarcación">
        <option value="">Todas las embarcaciones</option>
        ${ocupacionAll.map((o) => `<option value="${o.id}"${o.id === catSel ? " selected" : ""}>${U.esc(o.nombre)}</option>`).join("")}
      </select>
      <button class="btn btn--soft btn--sm" data-pdf>${U.icon("file-text", { size: 16 })} PDF</button>`,
    body: `
      <div class="kpis">
        ${kpi("Reservas hoy", resumen.reservas_hoy, `${reservasPeriodo} en el período`, "up")}
        ${kpi("Permisos vigentes", resumen.permisos_vigentes, `${resumen.permisos_total} emitidos`, "up")}
        ${kpi("Ingresos del período", U.fmtMoney(ingresosPeriodo), `${U.fmtMoney(resumen.ingresos_total)} acumulado`, "up")}
      </div>
      <div class="grid-2">
        <div class="panel">
          <h2>Reservas por día · ${U.fmtDate(from)} a ${U.fmtDate(to)}</h2>
          ${barChart(serie, { height: 230, color: "#8E1F2F" })}
        </div>
        <div class="panel">
          <h2>Permisos por especie</h2>
          ${donutChart(especieData, { centerTop: String(resumen.permisos_total), centerSub: "permisos" })}
        </div>
      </div>
      <div class="grid-2">
        <div class="panel">
          <h2>Ocupación por catamarán · ${U.fmtDate(to)} (mañana y tarde)</h2>
          <table class="table">
            <thead><tr><th>Catamarán</th><th>Ocupación</th><th style="text-align:right">Lugares</th></tr></thead>
            <tbody>${ocupacion.map((o) => {
              return `<tr><td>${U.esc(o.nombre)}</td>
                <td style="min-width:120px">${progressBar(o.lugares_ocupados, o.capacidad)}</td>
                <td style="text-align:right">${o.lugares_ocupados}/${o.capacidad}</td></tr>`;
            }).join("") || `<tr><td colspan="3" class="muted">Sin datos.</td></tr>`}</tbody>
          </table>
        </div>
        <div class="panel">
          <h2>Últimos permisos emitidos</h2>
          <table class="table">
            <thead><tr><th>N°</th><th>Especie</th><th>Estado</th></tr></thead>
            <tbody>${ultimos.map((u) => {
              const b = U.estadoPermisoBadge(u.estado);
              return `<tr><td><b>${U.esc(u.numero)}</b><br><small class="muted">${U.esc(u.titular)}</small></td>
                <td>${U.esc(u.especie)}</td><td><span class="badge ${b.cls}">${b.label}</span></td></tr>`;
            }).join("")}</tbody>
          </table>
        </div>
      </div>
    `,
  }, ctx));
  wireAdmin(ctx);

  const applyFilters = () => {
    const f = U.$("#pa-from").value || from, t = U.$("#pa-to").value || to, c = U.$("#pa-cat").value;
    ctx.go(`/admin?from=${f}&to=${t}${c ? "&cat=" + c : ""}`);
  };
  ["#pa-from", "#pa-to", "#pa-cat"].forEach((s) => U.$(s)?.addEventListener("change", applyFilters));
  U.$("[data-pdf]")?.addEventListener("click", () => window.print());
}

function kpi(label, value, delta, dir) {
  return `<div class="kpi"><div class="kpi__label">${U.esc(label)}</div>
    <div class="kpi__value">${value}</div>
    <div class="kpi__delta ${dir}">${U.icon(dir === "down" ? "trending-up" : "trending-up", { size: 14 })} ${U.esc(delta)}</div></div>`;
}

/* ============================================================================
 *  REPORTES
 * ========================================================================== */
export async function viewReportes(ctx) {
  // Cierre de período automático (HU-009): garantiza un reporte mensual aunque no haya pg_cron.
  try { await D.asegurarReporteMensual(); } catch (e) { console.warn("Reporte mensual:", e.message); }
  const [resumen, porDiaAll, porEspecie, alertas, enviados] = await Promise.all([
    D.dashboardResumen(), D.reservasPorDia({}), D.permisosPorEspecie(), D.alertasFauna(), D.listReportes(8).catch(() => []),
  ]);

  // Agrupar por mes (últimos 6 meses)
  const meses = new Map();
  porDiaAll.forEach((d) => {
    const m = d.fecha.slice(0, 7);
    const e = meses.get(m) || { reservas: 0, ingresos: 0 };
    e.reservas += Number(d.cantidad_reservas); e.ingresos += Number(d.ingresos); meses.set(m, e);
  });
  const ML = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
  const mesData = [...meses.entries()].sort().slice(-6).map(([m, v]) => ({ label: ML[Number(m.slice(5)) - 1], value: v.reservas }));
  const especieData = porEspecie.filter((e) => e.permisos_emitidos > 0).map((e, i) => ({ label: e.especie, value: Number(e.permisos_emitidos), color: CHART_COLORS[i % CHART_COLORS.length] }));

  U.mount(adminLayout({
    active: "reportes",
    title: "Reportes",
    subtitle: "Indicadores de actividad y monitoreo de fauna",
    actions: `<button class="btn btn--soft btn--sm" data-csv>${U.icon("download", { size: 16 })} CSV</button>
              <button class="btn btn--soft btn--sm" data-pdf>${U.icon("file-text", { size: 16 })} PDF</button>
              <button class="btn btn--primary btn--sm" data-enviar>${U.icon("mail", { size: 16 })} Enviar al municipio</button>`,
    body: `
      <div class="kpis">
        ${kpi("Reservas totales", resumen.reservas_total, "histórico", "up")}
        ${kpi("Ingresos totales", U.fmtMoney(resumen.ingresos_total), "acumulado", "up")}
        ${kpi("Alertas de fauna", resumen.alertas_activas, "activas", resumen.alertas_activas ? "down" : "up")}
      </div>
      <div class="grid-2">
        <div class="panel">
          <h2>Evolución mensual de reservas</h2>
          ${barChart(mesData, { height: 230, color: "#C9821E" })}
        </div>
        <div class="panel">
          <h2>Distribución de permisos por especie</h2>
          ${donutChart(especieData, { centerTop: String(resumen.permisos_total), centerSub: "permisos" })}
        </div>
      </div>
      <div class="panel">
        <h2>${U.icon("alert-triangle", { size: 18 })} Monitoreo de fauna · presión pesquera</h2>
        ${alertas.length ? alertas.map((a) => {
          const pct = a.umbral ? Math.round((a.permisos_emitidos / a.umbral) * 100) : 0;
          return `<div style="margin-bottom:16px">
            <div class="flex between" style="margin-bottom:6px">
              <b>${U.esc(a.especie)} <span class="muted" style="font-weight:600">· período ${U.esc(a.periodo)}</span></b>
              <span class="badge ${pct >= 90 ? "badge--danger" : "badge--warn"}">${a.permisos_emitidos}/${a.umbral} · ${pct}%</span>
            </div>
            ${progressBar(a.permisos_emitidos, a.umbral)}
          </div>`;
        }).join("") : `<p class="muted">No hay alertas activas. La presión pesquera está dentro de los umbrales.</p>`}
        <p class="panel__foot">La alerta se genera automáticamente cuando los permisos del mes de una especie alcanzan el 80 % del umbral, que se configura según los estudios de la dirección de fauna.</p>
      </div>
      <div class="panel">
        <h2>${U.icon("mail", { size: 18 })} Reportes enviados al municipio</h2>
        <table class="table table--tarjetas">
          <thead><tr><th>Fecha</th><th>Reporte</th><th>Destinatario</th><th>Origen</th></tr></thead>
          <tbody>${enviados.map((r) => `<tr>
            <td data-label="Fecha" style="white-space:nowrap">${U.fmtDateTime(r.created_at || r.fecha)}</td>
            <td data-label="Reporte"><b>${U.esc(r.titulo)}</b><br><small class="muted">Permisos: ${r.datos?.resumen?.permisos_total ?? "—"} · Reservas: ${r.datos?.resumen?.reservas_total ?? "—"}</small></td>
            <td data-label="Destinatario">${U.esc(r.destinatario)}</td>
            <td data-label="Origen"><span class="badge ${r.origen === "automatico" ? "badge--info" : "badge--ok"}">${r.origen === "automatico" ? "Automático" : "Manual"}</span></td>
          </tr>`).join("") || `<tr><td colspan="4" class="muted">Todavía no se enviaron reportes.</td></tr>`}</tbody>
        </table>
        <p class="panel__foot">Cada envío queda registrado con fecha, destinatario y una instantánea de los indicadores. El cierre mensual se genera automáticamente.</p>
      </div>
    `,
  }, ctx));
  wireAdmin(ctx);

  U.$("[data-enviar]")?.addEventListener("click", async (e) => {
    const btn = e.currentTarget; btn.disabled = true;
    try {
      const r = await D.enviarReporteMunicipio("general", "manual");
      U.toast(`Reporte enviado al ${r?.destinatario || r?.parametros?.destinatario || "municipio"}`, "ok");
      ctx.rerender();
    } catch (err) { U.toast(err.message || "No se pudo enviar el reporte.", "err"); btn.disabled = false; }
  });
  U.$("[data-pdf]")?.addEventListener("click", () => window.print());
  U.$("[data-csv]")?.addEventListener("click", () => {
    const rows = porEspecie.map((e) => ({ especie: e.especie, permisos_emitidos: e.permisos_emitidos, umbral: e.umbral_permisos }));
    U.downloadText("reporte-permisos-por-especie.csv", U.toCSV(rows, [{ key: "especie", label: "Especie" }, { key: "permisos_emitidos", label: "Permisos emitidos" }, { key: "umbral", label: "Umbral" }]));
    U.toast("CSV descargado", "ok");
  });
}

/* ============================================================================
 *  USUARIOS (admin)
 * ========================================================================== */
export async function viewUsuarios(ctx) {
  const [usuarios, cats] = await Promise.all([D.listUsuarios(), D.listCatamaranes()]);
  const barcos = (id) => cats.filter((c) => c.id_propietario === id).length;
  const cantBarcos = (n) => `${n} ${n === 1 ? "catamarán" : "catamaranes"}`;
  // Desde la aplicación sólo se gestionan las cuentas del público (tipo de
  // cuenta y estado); las del personal, en Personal.
  const roles = ["pescador", "dueno"];
  const fila = (u) => {
    const personal = D.esRolPersonal(u.rol);
    const n = u.rol === "dueno" ? barcos(u.id) : 0;
    const buscar = [u.nombre, u.apellido, u.email, u.dni, u.telefono].filter(Boolean).join(" ").toLowerCase();
    return `<tr data-buscar="${U.esc(buscar)}" data-tipo="${personal ? "personal" : U.esc(u.rol)}" data-activa="${u.activo !== false}">
      <td data-label="Usuario"><b>${U.esc(u.nombre)} ${U.esc(u.apellido || "")}</b>${u.perfil_completo === false ? `<br><small class="muted">Alta sin completar</small>` : ""}</td>
      <td data-label="Contacto"><small class="muted">${U.esc(u.email)}<br>${U.esc(u.telefono || "—")}</small></td>
      <td data-label="DNI">${U.esc(u.dni || "—")}</td>
      <td data-label="Tipo de cuenta"><span class="td-valor">${personal
        ? `<b>${U.esc(U.rolLabel(u.rol))}</b><small class="muted">Personal</small>`
        : `<select class="select select--sm" data-rol="${u.id}" data-nombre="${U.esc(u.nombre)}" data-actual="${U.esc(u.rol)}" aria-label="Tipo de cuenta de ${U.esc(u.nombre)}">
            ${roles.map((r) => `<option value="${r}"${u.rol === r ? " selected" : ""}>${U.rolLabel(r)}</option>`).join("")}
          </select><small class="muted${u.rol === "dueno" ? "" : " hide"}" data-barcos>${cantBarcos(n)}</small>`}</span></td>
      <td data-label="Estado">${personal
        ? (u.activo !== false ? "Activa" : "Desactivada")
        : `<select class="select select--sm" data-activo="${u.id}" aria-label="Estado de la cuenta de ${U.esc(u.nombre)}">
            <option value="1"${u.activo !== false ? " selected" : ""}>Activa</option>
            <option value="0"${u.activo === false ? " selected" : ""}>Desactivada</option>
          </select>`}</td>
    </tr>`;
  };

  U.mount(adminLayout({
    active: "usuarios",
    title: "Usuarios",
    subtitle: `${usuarios.length} cuentas registradas`,
    body: `<div class="filters filters--admin">
        <input class="input" type="search" id="us-buscar" placeholder="Buscar por nombre, correo o DNI" aria-label="Buscar usuarios" autocomplete="off"/>
        <select class="select" id="us-ver" aria-label="Mostrar">
          <option value="">Todas las cuentas</option>
          <option value="pescador">Pescadores y turistas</option>
          <option value="dueno">Dueños de catamarán</option>
          <option value="personal">Personal</option>
          <option value="inactivas">Desactivadas</option>
        </select>
      </div>
      <div class="panel">
      <table class="table table--tarjetas">
        <thead><tr><th>Usuario</th><th>Contacto</th><th>DNI</th><th>Tipo de cuenta</th><th>Estado</th></tr></thead>
        <tbody>${usuarios.map(fila).join("")}</tbody>
      </table>
      <p class="muted center hide" id="us-vacio">No hay cuentas que coincidan con la búsqueda.</p>
      <p class="panel__foot">Desde acá se cambia el tipo de cuenta (pescador o dueño) y el estado de las cuentas del público. Una cuenta desactivada no puede ingresar y sus sesiones se cierran. Las cuentas del personal las da de alta y las gestiona el administrador del sistema, en Personal. Los cambios se aplican al instante.</p>
    </div>`,
  }, ctx));
  wireAdmin(ctx);

  const filtrar = () => {
    const q = U.$("#us-buscar").value.trim().toLowerCase();
    const ver = U.$("#us-ver").value;
    let visibles = 0;
    U.$$("tbody tr[data-buscar]").forEach((tr) => {
      const ok = (!q || tr.dataset.buscar.includes(q))
        && (!ver || (ver === "inactivas" ? tr.dataset.activa === "false" : tr.dataset.tipo === ver));
      tr.classList.toggle("hide", !ok);
      visibles += ok;
    });
    U.$("#us-vacio").classList.toggle("hide", visibles > 0);
  };
  U.$("#us-buscar").addEventListener("input", filtrar);
  U.$("#us-ver").addEventListener("change", filtrar);

  U.$$("[data-rol]").forEach((sel) => sel.addEventListener("change", async () => {
    const anterior = sel.dataset.actual, n = barcos(sel.dataset.rol);
    if (anterior === "dueno" && sel.value === "pescador" && n > 0) {
      const ok = await U.confirmDialog({
        title: "Pasar a pescador",
        message: `${sel.dataset.nombre} tiene ${cantBarcos(n)} a su nombre. Como pescador no podrá administrarlos ni ver sus finanzas, y siguen publicados. Para traspasarlos, asignalos a otro dueño en Catamaranes. ¿Cambiar el tipo de cuenta?`,
        okLabel: "Cambiar",
      });
      if (!ok) { sel.value = anterior; return; }
    }
    try {
      await D.setRol(sel.dataset.rol, sel.value);
      sel.dataset.actual = sel.value;
      sel.closest("tr").dataset.tipo = sel.value;
      sel.parentElement.querySelector("[data-barcos]")?.classList.toggle("hide", sel.value !== "dueno");
      U.toast(`Tipo de cuenta: ${U.rolLabel(sel.value)}`, "ok");
    } catch (err) { sel.value = anterior; U.toast(err.message, "err"); }
  }));
  U.$$("[data-activo]").forEach((sel) => sel.addEventListener("change", async () => {
    const activo = sel.value === "1";
    try {
      await D.setActivo(sel.dataset.activo, activo);
      sel.closest("tr").dataset.activa = String(activo);
      U.toast(activo ? "Cuenta activada" : "Cuenta desactivada", "ok");
    } catch (err) { sel.value = activo ? "0" : "1"; U.toast(err.message, "err"); }
  }));
}

/* ============================================================================
 *  AVISOS (municipio y administración): publicar un aviso que llega a la
 *  campanita de los usuarios elegidos
 * ========================================================================== */
export async function viewAvisos(ctx) {
  const [avisos, usuarios] = await Promise.all([D.listAvisos(), D.listUsuarios()]);
  const publico = usuarios.filter((u) => !D.esRolPersonal(u.rol) && u.activo !== false && u.perfil_completo !== false)
    .sort((a, b) => `${a.nombre} ${a.apellido}`.localeCompare(`${b.nombre} ${b.apellido}`));
  const destinoTxt = (a) => a.destino === "usuario"
    ? `${U.esc(`${a.destinatario?.nombre || ""} ${a.destinatario?.apellido || ""}`.trim() || "Un usuario")}`
    : U.esc(D.DESTINOS_AVISO[a.destino] || a.destino);

  U.mount(adminLayout({
    active: "avisos",
    title: "Avisos",
    subtitle: "Mensajes de la administración para los usuarios",
    body: `<div class="panel">
        <h2>${U.icon("megaphone", { size: 18 })} Nuevo aviso</h2>
        <form id="av-form" novalidate>
          <div class="field"><label for="av-destino">Destinatarios</label>
            <select class="select" id="av-destino">
              ${Object.entries(D.DESTINOS_AVISO).map(([k, v]) => `<option value="${k}">${v}</option>`).join("")}
            </select></div>
          <div class="field hide" id="av-usuario-campo"><label for="av-usuario">Usuario</label>
            <select class="select" id="av-usuario">
              <option value="">Elegí un usuario</option>
              ${publico.map((u) => `<option value="${u.id}">${U.esc(`${u.nombre} ${u.apellido || ""}`.trim())} · ${U.esc(u.email)}</option>`).join("")}
            </select></div>
          <div class="field"><label for="av-titulo">Título</label>
            <input class="input" id="av-titulo" maxlength="80" placeholder="Por ejemplo: Dique cerrado por crecida"/></div>
          <div class="field"><label for="av-mensaje">Mensaje</label>
            <textarea class="input" id="av-mensaje" rows="4" maxlength="500" placeholder="Escribí el aviso tal como lo van a leer los usuarios."></textarea>
            <div class="field__hint" id="av-cuenta">0 / 500</div></div>
          <div class="field__error hide" id="av-err"></div>
          <div class="nota nota--agua">${U.icon("bell", { size: 18 })}<span>El aviso se publica al instante y llega como notificación a la campanita de cada destinatario.</span>
            <button class="btn btn--primary" type="submit" id="av-btn">${U.icon("send", { size: 16 })} Publicar aviso</button></div>
        </form>
      </div>
      <div class="panel">
        <h2>Avisos publicados</h2>
        <table class="table">
          <thead><tr><th>Fecha</th><th>Aviso</th><th>Destinatarios</th><th>Publicado por</th></tr></thead>
          <tbody>${avisos.map((a) => `<tr>
            <td style="white-space:nowrap">${U.fmtDateTime(a.created_at)}</td>
            <td><b>${U.esc(a.titulo)}</b><br><small class="muted">${U.esc(a.mensaje)}</small></td>
            <td>${destinoTxt(a)}<br><small class="muted">${a.destinatarios} ${a.destinatarios === 1 ? "persona" : "personas"}</small></td>
            <td>${U.esc(`${a.autor?.nombre || ""} ${a.autor?.apellido || ""}`.trim() || "—")}</td>
          </tr>`).join("") || `<tr><td colspan="4" class="muted">Todavía no se publicaron avisos.</td></tr>`}</tbody>
        </table>
        <p class="panel__foot">Cada aviso queda registrado con su fecha, quién lo publicó y cuántas personas lo recibieron.</p>
      </div>`,
  }, ctx));
  wireAdmin(ctx);

  const destino = U.$("#av-destino"), campoUsuario = U.$("#av-usuario-campo"), mensaje = U.$("#av-mensaje");
  const errBox = U.$("#av-err"), btn = U.$("#av-btn");
  destino.addEventListener("change", () => campoUsuario.classList.toggle("hide", destino.value !== "usuario"));
  mensaje.addEventListener("input", () => { U.$("#av-cuenta").textContent = `${mensaje.value.length} / 500`; });
  U.$("#av-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    errBox.classList.add("hide");
    const datos = { titulo: U.$("#av-titulo").value, mensaje: mensaje.value, destino: destino.value, idUsuario: U.$("#av-usuario").value || null };
    const cuantos = destino.value === "usuario" ? "a esa persona" : `a ${D.DESTINOS_AVISO[destino.value].toLowerCase()}`;
    const ok = await U.confirmDialog({ title: "Publicar aviso", message: `El aviso "${datos.titulo.trim()}" se va a enviar ${cuantos}. ¿Confirmás?`, okLabel: "Publicar", okVariant: "btn--primary" });
    if (!ok) return;
    btn.disabled = true;
    try {
      const r = await D.publicarAviso(datos);
      U.toast(`Aviso publicado · ${r.destinatarios} ${r.destinatarios === 1 ? "persona" : "personas"}`, "ok");
      ctx.rerender();
    } catch (err) {
      showErr(errBox, err.message); btn.disabled = false;
    }
  });
}

/* ============================================================================
 *  PERSONAL (sólo administrador del sistema): alta de cuentas del municipio y
 *  de la administración, cambio de contraseña y activación
 * ========================================================================== */
export async function viewPersonal(ctx) {
  const yo = ctx.session.profile.id;
  const personal = (await D.listUsuarios()).filter((u) => D.esRolPersonal(u.rol))
    .sort((a, b) => a.rol.localeCompare(b.rol) || D.usuarioPersonal(a.email).localeCompare(D.usuarioPersonal(b.email)));

  U.mount(adminLayout({
    active: "personal",
    title: "Personal",
    subtitle: "Cuentas del municipio y de la administración",
    actions: `<button class="btn btn--cta btn--sm" data-nueva>${U.icon("plus", { size: 16 })} Nueva cuenta</button>`,
    body: `<div class="panel">
      <table class="table table--tarjetas">
        <thead><tr><th>Usuario</th><th>Nombre</th><th>Rol</th><th>Ingresa por</th><th>Cuenta</th><th><span class="sr-only">Acciones</span></th></tr></thead>
        <tbody>${personal.map((u) => `<tr>
          <td data-label="Usuario"><b>${U.esc(D.usuarioPersonal(u.email))}</b></td>
          <td data-label="Nombre">${U.esc(`${u.nombre} ${u.apellido || ""}`.trim())}</td>
          <td data-label="Rol">${U.esc(U.rolLabel(u.rol))}</td>
          <td data-label="Ingresa por"><small class="muted">${u.rol === "admin_sistema" ? "/Admin" : "/Municipio"}</small></td>
          <td data-label="Cuenta">${u.id === yo ? "Activa (tu cuenta)" : `
            <select class="select select--sm" data-activo="${u.id}" aria-label="Estado de la cuenta de ${U.esc(u.nombre)}">
              <option value="1"${u.activo !== false ? " selected" : ""}>Activa</option>
              <option value="0"${u.activo === false ? " selected" : ""}>Desactivada</option>
            </select>`}</td>
          <td data-label=""><button class="btn btn--soft btn--sm" data-clave="${u.id}" data-usuario="${U.esc(D.usuarioPersonal(u.email))}">${U.icon("key", { size: 16 })} Contraseña</button></td>
        </tr>`).join("")}</tbody>
      </table>
      <p class="panel__foot">El personal municipal ingresa por /Municipio y el administrador del sistema por /Admin, con el usuario y la contraseña que se definen acá. El rol de una cuenta se fija al crearla. Una cuenta desactivada no puede ingresar y sus sesiones se cierran.</p>
    </div>`,
  }, ctx));
  wireAdmin(ctx);

  U.$$("[data-activo]").forEach((sel) => sel.addEventListener("change", async () => {
    const activo = sel.value === "1";
    try { await D.setActivo(sel.dataset.activo, activo); U.toast(activo ? "Cuenta activada" : "Cuenta desactivada", "ok"); }
    catch (err) { U.toast(err.message, "err"); ctx.rerender(); }
  }));
  U.$$("[data-clave]").forEach((b) => b.addEventListener("click", () => claveModal(ctx, b.dataset.clave, b.dataset.usuario)));
  U.$("[data-nueva]").addEventListener("click", () => cuentaPersonalModal(ctx));
}

const REQUISITOS_CLAVE = "Al menos 12 caracteres, con minúsculas, mayúsculas, números y símbolos.";
function camposClave() {
  return `
    <div class="field"><label for="pc-clave">Contraseña</label>
      <input class="input" id="pc-clave" type="password" autocomplete="new-password"/>
      <div class="field__hint">${REQUISITOS_CLAVE}</div></div>
    <div class="field"><label for="pc-clave2">Repetí la contraseña</label>
      <input class="input" id="pc-clave2" type="password" autocomplete="new-password"/>
      <label class="field__hint" style="display:flex;align-items:center;gap:6px;cursor:pointer"><input type="checkbox" id="pc-ver"/> Mostrar contraseña</label></div>
    <div class="field__error hide" id="pc-err"></div>`;
}
function wireCamposClave() {
  U.$("#pc-ver").addEventListener("change", (e) => {
    U.$("#pc-clave").type = U.$("#pc-clave2").type = e.target.checked ? "text" : "password";
  });
}
function leerClave() {
  const clave = U.$("#pc-clave").value;
  if (!D.claveSegura(clave)) throw new Error(`La contraseña no cumple los requisitos. ${REQUISITOS_CLAVE}`);
  if (clave !== U.$("#pc-clave2").value) throw new Error("Las contraseñas no coinciden.");
  return clave;
}

function cuentaPersonalModal(ctx) {
  U.modal({
    title: "Nueva cuenta del personal",
    body: `
      <div class="field"><label for="pc-rol">Rol</label>
        <select class="select" id="pc-rol">
          <option value="admin_municipal">${U.rolLabel("admin_municipal")}</option>
          <option value="admin_sistema">${U.rolLabel("admin_sistema")}</option>
        </select>
        <div class="field__hint">La administración municipal ingresa por /Municipio; el administrador del sistema, por /Admin.</div></div>
      <div class="field"><label for="pc-usuario">Usuario</label>
        <input class="input" id="pc-usuario" autocapitalize="none" spellcheck="false" maxlength="30" placeholder="por ejemplo: jperez"/>
        <div class="field__hint">Entre 3 y 30 caracteres: letras minúsculas, números, punto o guiones.</div></div>
      <div class="flex gap-12">
        <div class="field grow"><label for="pc-nombre">Nombre</label><input class="input" id="pc-nombre" autocomplete="off"/></div>
        <div class="field grow"><label for="pc-apellido">Apellido</label><input class="input" id="pc-apellido" autocomplete="off"/></div>
      </div>
      ${camposClave()}`,
    actions: [
      { label: "Cancelar", variant: "btn--soft" },
      {
        label: "Crear cuenta", variant: "btn--primary", close: false,
        onClick: async () => {
          const errBox = U.$("#pc-err"); errBox.classList.add("hide");
          try {
            const r = await D.crearCuentaPersonal({
              usuario: U.$("#pc-usuario").value, nombre: U.$("#pc-nombre").value, apellido: U.$("#pc-apellido").value,
              rol: U.$("#pc-rol").value, clave: leerClave(),
            });
            U.closeModal();
            U.toast(`Cuenta creada: ${r.usuario} ingresa por ${r.rol === "admin_sistema" ? "/Admin" : "/Municipio"}`, "ok");
            ctx.rerender();
          } catch (err) { showErr(errBox, err.message); return false; }
        },
      },
    ],
  });
  wireCamposClave();
  U.$("#pc-usuario").focus();
}

function claveModal(ctx, userId, usuario) {
  U.modal({
    title: `Contraseña de ${usuario}`,
    body: `<p class="muted" style="margin-top:-6px;margin-bottom:14px">La contraseña anterior deja de funcionar y se cierran las sesiones abiertas de esa cuenta.</p>${camposClave()}`,
    actions: [
      { label: "Cancelar", variant: "btn--soft" },
      {
        label: "Guardar", variant: "btn--primary", close: false,
        onClick: async () => {
          const errBox = U.$("#pc-err"); errBox.classList.add("hide");
          try {
            await D.cambiarClavePersonal(userId, leerClave());
            U.closeModal(); U.toast("Contraseña actualizada", "ok");
          } catch (err) { showErr(errBox, err.message); return false; }
        },
      },
    ],
  });
  wireCamposClave();
  U.$("#pc-clave").focus();
}

/* ============================================================================
 *  GESTIÓN DE CATAMARANES (dueño / admin)
 * ========================================================================== */
export async function viewGestion(ctx) {
  const p = ctx.session.profile;
  if (!isAdmin(p.rol)) return viewFlota(ctx);
  // Administración: todos los catamaranes, con su dueño; un dueño puede tener varios.
  const [cats, usuarios] = await Promise.all([D.listCatamaranes(), D.listUsuarios()]);
  const duenos = usuarios.filter((u) => u.rol === "dueno" && u.activo !== false && u.perfil_completo !== false);
  const nombreDe = (id) => { const u = usuarios.find((x) => x.id === id); return u ? `${u.nombre} ${u.apellido || ""}`.trim() : "Sin dueño asignado"; };
  const list = cats.length ? cats.map((c) => tarjetaCatamaran(c, null, nombreDe(c.id_propietario))).join("") : emptyState("Sin catamaranes", "Agregá el primer catamarán.", "boat");
  U.mount(adminLayout({
    active: "gestion", title: "Catamaranes", subtitle: `${cats.length} embarcaciones`,
    actions: `<button class="btn btn--cta btn--sm" data-nuevo>${U.icon("plus", { size: 16 })} Nuevo</button>`,
    body: `<div class="panel">${list}<p class="panel__foot">Cada catamarán puede asignarse a un dueño, y un dueño puede tener varios. Al asignarlo, el dueño lo administra desde Mi flota.</p></div>`,
  }, ctx));
  wireAdmin(ctx);
  const cb = byIdMap(cats);
  U.$("[data-nuevo]")?.addEventListener("click", () => catamaranModal(ctx, null, 0, duenos));
  U.$$("[data-edit]").forEach((b) => b.addEventListener("click", () => catamaranModal(ctx, cb[b.dataset.edit], 0, duenos)));
}

function estadoCatLabel(e) { return ({ activa: "Activa", inactiva: "Inactiva", mantenimiento: "Mantenimiento" }[e] || e); }
function byIdMap(arr) { const m = {}; arr.forEach((x) => (m[x.id] = x)); return m; }

/* Crédito de las fotos de ejemplo de la demostración (licencia CC BY 3.0). */
const creditoFotos = (cats) => (cats.some((c) => (c.fotos || []).some(D.esFotoDemo))
  ? `<p class="credito-fotos">${U.esc(D.CREDITO_FOTOS_DEMO)}</p>` : "");

/* Foto de portada del catamarán (o el ícono, si no tiene fotos). */
function portada(c, size = 46) {
  const f = (c.fotos || [])[0];
  return f ? `<img src="${U.esc(D.urlFoto(f))}" alt="Foto de ${U.esc(c.nombre)}" loading="lazy" data-foto>` : U.icon("boat", { size, stroke: 1.6 });
}

function tarjetaCatamaran(c, futuras = null, dueno = null) {
  return `<div class="boat boat--gestion" style="margin-bottom:12px">
    <div class="boat__img">${portada(c)}</div>
    <div class="boat__main">
      <h2>${U.esc(c.nombre)}</h2>
      <div class="boat__meta">${U.icon("users", { size: 13 })} ${c.capacidad} lugares · ${U.fmtMoney(c.precio)}/lugar${c.habilitacion ? " · Hab. " + U.esc(c.habilitacion) : ""}</div>
      ${dueno !== null ? `<div class="boat__meta">${U.icon("user", { size: 13 })} ${U.esc(dueno)}</div>` : ""}
      ${c.descripcion ? `<p class="boat__desc">${U.esc(c.descripcion)}</p>` : ""}
      <div class="flex gap-8 items-center" style="flex-wrap:wrap;margin-top:6px">
        <span class="badge ${c.estado === "activa" ? "badge--ok" : c.estado === "mantenimiento" ? "badge--warn" : "badge--muted"}">${estadoCatLabel(c.estado)}</span>
        ${(c.fotos || []).length ? `<small class="muted" style="font-weight:600">${c.fotos.length} foto${c.fotos.length > 1 ? "s" : ""}</small>` : ""}
        ${futuras !== null ? `<small class="muted" style="font-weight:600">${futuras ? `${futuras} reserva${futuras > 1 ? "s" : ""} desde hoy` : "Sin reservas próximas"}</small>` : ""}
      </div>
    </div>
    <button class="btn btn--soft btn--sm" data-edit="${c.id}">${U.icon("edit", { size: 16 })} Editar</button>
  </div>`;
}

/* ============================================================================
 *  MI FLOTA (dueño de catamarán, HU-003): catamaranes, salidas y finanzas
 * ========================================================================== */
const TABS_FLOTA = [["catamaranes", "Catamaranes"], ["salidas", "Salidas"], ["finanzas", "Finanzas"]];

/* Inicio del dueño: resumen de su flota. */
function panelFlota(p, cats, reservas, gastos, hoy) {
  const propios = cats.filter((c) => c.id_propietario === p.id);
  if (!propios.length) return `
    <h2 class="section-title">Mi flota</h2>
    <div class="card card--flat flota-vacia">
      <span class="flota-vacia__ic">${U.icon("steering", { size: 26 })}</span>
      <div><b>Cargá tu catamarán</b><p class="muted">Registralo con su descripción, la cantidad de lugares y el precio por lugar para empezar a recibir reservas.</p></div>
      <a class="btn btn--cta btn--block" href="#/gestion?nuevo=1">${U.icon("plus", { size: 18 })} Cargar mi catamarán</a>
    </div>`;
  const periodo = hoy.slice(0, 7);
  const f = D.finanzasDueno({ reservas, gastos, catamaranes: propios, periodo });
  const salidas = D.salidasDeFlota(reservas, propios).filter((s) => s.fecha >= hoy);
  const vendidosHoy = salidas.filter((s) => s.fecha === hoy).reduce((n, s) => n + s.lugares, 0);
  const plazasHoy = propios.filter((c) => c.estado === "activa").reduce((n, c) => n + Number(c.capacidad) * 2, 0);
  return `
    <h2 class="section-title">Mi flota <a class="muted-link" href="#/gestion">Ver todo</a></h2>
    <div class="stats">
      ${stat("Lugares vendidos hoy", `${vendidosHoy}/${plazasHoy}`, "Mañana y tarde")}
      ${stat(`Ingresos de ${U.fmtMes(periodo).split(" ")[0]}`, U.fmtMoney(f.ingresos), `${f.lugares} lugar${f.lugares === 1 ? "" : "es"}`)}
      ${stat("Resultado del mes", U.fmtMoney(f.resultado), f.resultado >= 0 ? "Ganancia" : "Pérdida", f.resultado >= 0 ? "pos" : "neg")}
    </div>
    ${salidas.length ? `<div class="card card--flat mt-12">
      <h3 class="card__titulo">Próximas salidas</h3>
      ${salidas.slice(0, 3).map(salidaFila).join("")}
      ${salidas.length > 3 ? `<a class="muted-link mt-8" style="display:inline-block" href="#/gestion?tab=salidas">Ver las ${salidas.length} salidas</a>` : ""}
    </div>` : `<p class="muted mt-8" style="font-size:.86rem">Todavía no hay reservas próximas en tus catamaranes.</p>`}`;
}

function stat(label, valor, sub = "", tono = "") {
  return `<div class="stat${tono ? " stat--" + tono : ""}"><small>${U.esc(label)}</small><b>${valor}</b>${sub ? `<span>${U.esc(sub)}</span>` : ""}</div>`;
}

const salidaFila = (s) => `<a class="salida-fila" href="#/gestion?tab=salidas">
  <span class="salida-fila__fecha">${U.esc(U.fmtDateShort(s.fecha))}</span>
  <span class="grow"><b>${U.esc(s.catamaran.nombre)}</b><small>Turno ${U.turnoLabel(s.turno).toLowerCase()} · ${s.reservas.length} reserva${s.reservas.length > 1 ? "s" : ""}</small></span>
  <span class="badge ${badgeOcupacion(s)}">${s.lugares}/${s.capacidad}</span></a>`;

const badgeOcupacion = (s) => (s.lugares >= s.capacidad ? "badge--danger" : s.lugares / s.capacidad >= 0.7 ? "badge--warn" : "badge--ok");

async function viewFlota(ctx) {
  const p = ctx.session.profile;
  const tab = TABS_FLOTA.some(([k]) => k === ctx.params.tab) ? ctx.params.tab : "catamaranes";
  const [cats, reservas, gastos, notifs] = await Promise.all([
    D.listCatamaranes(), D.listReservas(), D.listGastos().catch((e) => { console.warn(e); return null; }), D.listNotificaciones(),
  ]);
  const unread = notifs.filter((n) => !n.leida).length;
  const propios = cats.filter((c) => c.id_propietario === p.id);
  const vista = tab === "salidas" ? flotaSalidas(ctx, propios, reservas)
    : tab === "finanzas" ? flotaFinanzas(ctx, propios, reservas, gastos)
    : flotaCatamaranes(ctx, propios, reservas);

  U.mount(appShell({
    active: "gestion", rol: p.rol,
    topbarHtml: topbar({ title: "Mi flota", bell: true, unread }),
    bodyHtml: `
      <div class="tabs" role="tablist" aria-label="Mi flota">
        ${TABS_FLOTA.map(([k, label]) => `<button role="tab" aria-selected="${k === tab}" class="${k === tab ? "active" : ""}" data-tab="${k}">${label}</button>`).join("")}
      </div>
      ${vista.html}`,
  }));
  wireChrome(ctx);
  U.$$("[data-tab]").forEach((b) => b.addEventListener("click", () => ctx.go(b.dataset.tab === "catamaranes" ? "/gestion" : `/gestion?tab=${b.dataset.tab}`)));
  vista.wire();
}

/* ---- Catamaranes: alta y edición ---- */
function flotaCatamaranes(ctx, propios, reservas) {
  const hoy = U.todayISO();
  const futuras = (id) => reservas.filter((r) => r.id_catamaran === id && r.estado === "confirmada" && r.fecha >= hoy).length;
  const html = propios.length ? `
    <div class="section-title">Tus catamaranes <button class="btn btn--cta btn--sm" data-nuevo>${U.icon("plus", { size: 16 })} Nuevo</button></div>
    ${propios.map((c) => tarjetaCatamaran(c, futuras(c.id))).join("")}
    ${creditoFotos(propios)}
    <p class="muted center mt-12" style="font-size:.8rem">${U.icon("info", { size: 14 })} Los pescadores ven tus catamaranes activos al reservar, con su descripción, sus lugares y su precio.</p>`
    : `${emptyState("Todavía no cargaste tu catamarán", "Registralo con su descripción, la cantidad de lugares y el precio por lugar para empezar a recibir reservas.", "boat")}
       <button class="btn btn--cta btn--block" data-nuevo>${U.icon("plus", { size: 18 })} Cargar mi catamarán</button>`;
  return {
    html,
    wire: () => {
      const cb = byIdMap(propios);
      U.$$("[data-nuevo]").forEach((b) => b.addEventListener("click", () => catamaranModal(ctx, null)));
      U.$$("[data-edit]").forEach((b) => b.addEventListener("click", () => catamaranModal(ctx, cb[b.dataset.edit], futuras(b.dataset.edit))));
      // Desde el inicio ("Cargar mi catamarán") se abre el alta directamente.
      if (ctx.params.nuevo === "1") { history.replaceState(null, "", "#/gestion"); catamaranModal(ctx, null); }
    },
  };
}

/* ---- Salidas: ocupación de cada fecha y turno ---- */
function flotaSalidas(ctx, propios, reservas) {
  const hoy = U.todayISO();
  const anteriores = ctx.params.ver === "anteriores";
  const catSel = propios.some((c) => c.id === ctx.params.cat) ? ctx.params.cat : "";
  const flota = catSel ? propios.filter((c) => c.id === catSel) : propios;
  let salidas = D.salidasDeFlota(reservas, flota).filter((s) => (anteriores ? s.fecha < hoy : s.fecha >= hoy));
  if (anteriores) salidas = salidas.reverse().slice(0, 30);
  const filtroUrl = (ver, cat) => `/gestion?tab=salidas${ver ? "&ver=anteriores" : ""}${cat ? "&cat=" + cat : ""}`;

  const lista = salidas.map((s) => `
    <details class="salida card card--flat" data-salida="${U.esc(s.clave)}">
      <summary>
        <span class="grow">
          <b>${U.esc(U.fmtDateLong(s.fecha))}</b>
          <small>Turno ${U.turnoLabel(s.turno).toLowerCase()} · ${U.esc(s.catamaran.nombre)}</small>
        </span>
        <span class="badge ${badgeOcupacion(s)}">${s.lugares}/${s.capacidad}</span>
      </summary>
      ${progressBar(s.lugares, s.capacidad)}
      <div class="flex between mt-8 salida__datos"><span>${s.reservas.length} reserva${s.reservas.length > 1 ? "s" : ""} · ${s.lugares} lugar${s.lugares > 1 ? "es" : ""} vendido${s.lugares > 1 ? "s" : ""}</span><b>${U.fmtMoney(s.ingresos)}</b></div>
      <div class="salida__detalle"></div>
    </details>`).join("");

  const html = `
    <div class="segmented" role="radiogroup" aria-label="Salidas">
      <button type="button" role="radio" aria-checked="${!anteriores}" class="${anteriores ? "" : "is-on"}" data-ver="">Próximas</button>
      <button type="button" role="radio" aria-checked="${anteriores}" class="${anteriores ? "is-on" : ""}" data-ver="anteriores">Anteriores</button>
    </div>
    ${propios.length > 1 ? `<select class="select mt-12" id="sa-cat" aria-label="Catamarán">
      <option value="">Todos tus catamaranes</option>
      ${propios.map((c) => `<option value="${c.id}"${c.id === catSel ? " selected" : ""}>${U.esc(c.nombre)}</option>`).join("")}
    </select>` : ""}
    <div class="mt-12">${lista || emptyState(anteriores ? "Sin salidas anteriores" : "Sin reservas próximas", propios.length ? "Las salidas aparecen acá cuando los pescadores reservan lugares en tus catamaranes." : "Primero cargá tu catamarán en la pestaña Catamaranes.", "calendar")}</div>
    ${salidas.length ? `<p class="muted center mt-12" style="font-size:.8rem">${U.icon("shield", { size: 14 })} En la lista de embarque ves el nombre y el DNI de cada titular. El correo, el teléfono, el pago y el permiso sólo los ven el pasajero y el Municipio. Al embarcar, pedile su permiso digital.</p>` : ""}`;

  return {
    html,
    wire: () => {
      U.$$("[data-ver]").forEach((b) => b.addEventListener("click", () => ctx.go(filtroUrl(b.dataset.ver, catSel))));
      U.$("#sa-cat")?.addEventListener("change", (e) => ctx.go(filtroUrl(anteriores, e.target.value)));
      // Al abrir una salida: plano con los lugares vendidos y sus reservas. Los
      // lugares habilitados van del 1 a la capacidad (cambiar_capacidad), así que
      // el plano se arma sin consultar la base y se ve también sin conexión.
      const porClave = new Map(salidas.map((s) => [s.clave, s]));
      U.$$("details.salida").forEach((det) => det.addEventListener("toggle", () => {
        const box = U.$(".salida__detalle", det);
        if (!det.open || box.dataset.listo) return;
        box.dataset.listo = "1";
        const s = porClave.get(det.dataset.salida);
        const lugares = Array.from({ length: s.capacidad }, (_, i) => ({ id: String(i + 1), numero: i + 1 }));
        const vendidos = new Set(s.reservas.flatMap((r) => r.lugares || []).map(String));
        const embarque = `#/embarque?cat=${s.catamaran.id}&fecha=${s.fecha}&turno=${s.turno}`;
        box.innerHTML = `<div class="salida__acciones">
            <a class="btn btn--outline btn--sm" href="${embarque}">${U.icon("users", { size: 16 })} Lista de embarque</a>
            ${s.fecha >= hoy ? `<button type="button" class="btn btn--primary btn--sm" data-avisar>${U.icon("megaphone", { size: 16 })} Avisar a los pasajeros</button>` : ""}
          </div>
          ${planoCatamaran(lugares, vendidos, new Set(), new Set(), { lectura: true })}
          <div class="seat-legend"><span><i class="lg-free"></i>Libre</span><span><i class="lg-vendido"></i>Vendido</span></div>
          <div class="mt-12">${s.reservas.map((r) => `<div class="row-item">
            <div class="row-item__ic">${U.icon("ticket", { size: 18 })}</div>
            <div class="row-item__main"><h2>${U.esc(r.numero || "Reserva")}${r.id_usuario === ctx.session.profile.id ? " · Tuya" : ""}</h2>
              <small>Lugar${(r.lugares || []).length > 1 ? "es" : ""} ${U.esc((r.lugares || []).join(", ") || String(r.cantidad_lugares))} · ${U.fmtMoney(D.ingresoReserva(r))}</small></div>
            <a class="btn btn--soft btn--sm" href="#/comprobante/${r.id}">Detalle</a>
          </div>`).join("")}</div>`;
        U.$("[data-avisar]", box)?.addEventListener("click", () => avisoSalidaModal(ctx, s));
      }));
    },
  };
}

/* Aviso del dueño a todos los que reservaron una salida (llega a su campanita). */
const PLANTILLAS_AVISO = [
  ["zarpe", "Estamos por zarpar", (s, f, t) => `${s.catamaran.nombre} está por salir del muelle (salida del ${f}, turno ${t}). Acercate con tu permiso digital.`],
  ["suspendida", "Salida suspendida", (s, f, t) => `La salida del ${f}, turno ${t}, en ${s.catamaran.nombre} se suspende por mal tiempo. Nos vamos a comunicar para reprogramarla.`],
  ["demora", "Salida demorada", (s, f, t) => `La salida del ${f}, turno ${t}, se demora. Te avisamos cuando estemos por zarpar.`],
  ["otro", "", () => ""],
];

function avisoSalidaModal(ctx, s) {
  const fecha = U.fmtDate(s.fecha), turno = U.turnoLabel(s.turno).toLowerCase();
  const personas = new Set(s.reservas.filter((r) => r.estado === "confirmada").map((r) => r.id_usuario)).size;
  U.modal({
    title: "Avisar a los pasajeros",
    body: `
      <p class="muted" style="margin-bottom:12px">${U.esc(s.catamaran.nombre)} · ${U.esc(U.fmtDateLong(s.fecha))} · turno ${U.esc(turno)}</p>
      <div class="chips" role="radiogroup" aria-label="Tipo de aviso" style="margin:0 0 12px">
        ${PLANTILLAS_AVISO.map(([k, titulo], i) => `<button type="button" class="chip${i === 0 ? " is-on" : ""}" role="radio" aria-checked="${i === 0}" data-plantilla="${k}">${k === "otro" ? "Otro" : U.esc(titulo)}</button>`).join("")}
      </div>
      <div class="field"><label for="av-titulo">Título</label><input class="input" id="av-titulo" maxlength="80"/></div>
      <div class="field"><label for="av-mensaje">Mensaje</label><textarea class="input" id="av-mensaje" maxlength="500" rows="4"></textarea></div>
      <p class="field__hint">${U.icon("shield", { size: 13 })} Le llega a ${personas} persona${personas === 1 ? "" : "s"} con reserva confirmada en esta salida, en la campanita de la aplicación y, a quienes activaron los avisos, también en el teléfono. No ves sus datos.</p>`,
    actions: [
      { label: "Cancelar", variant: "btn--soft" },
      {
        label: "Enviar aviso", variant: "btn--primary", close: false,
        onClick: async () => {
          const btn = U.$("#app-modal [data-act='1']"); btn.disabled = true;
          try {
            const n = await D.avisarPasajeros({ catamaranId: s.catamaran.id, fecha: s.fecha, turno: s.turno, titulo: U.$("#av-titulo").value, mensaje: U.$("#av-mensaje").value });
            U.closeModal(); U.toast(`Aviso enviado a ${n} pasajero${n === 1 ? "" : "s"}`, "ok");
          } catch (err) { U.toast(err.message, "err"); btn.disabled = false; }
          return false;
        },
      },
    ],
  });
  const usar = (k) => {
    const [, titulo, texto] = PLANTILLAS_AVISO.find((x) => x[0] === k);
    U.$$("[data-plantilla]").forEach((b) => { const on = b.dataset.plantilla === k; b.classList.toggle("is-on", on); b.setAttribute("aria-checked", String(on)); });
    U.$("#av-titulo").value = titulo; U.$("#av-mensaje").value = texto(s, fecha, turno);
    if (k === "otro") U.$("#av-titulo").focus();
  };
  U.$$("[data-plantilla]").forEach((b) => b.addEventListener("click", () => usar(b.dataset.plantilla)));
  usar("zarpe");
}

/* ============================================================================
 *  LISTA DE EMBARQUE (dueño): titulares de las reservas de una salida, con su
 *  nombre y DNI, para imprimir o descargar (por ejemplo, para Prefectura).
 * ========================================================================== */
export async function viewEmbarque(ctx) {
  const p = ctx.session.profile;
  const catId = ctx.params.cat || "", fecha = /^\d{4}-\d{2}-\d{2}$/.test(ctx.params.fecha || "") ? ctx.params.fecha : U.todayISO();
  const turno = ctx.params.turno === "tarde" ? "tarde" : "manana";
  const cat = (await D.listCatamaranes()).find((c) => c.id === catId);
  let filas = [], error = "";
  try { filas = cat ? await D.listaEmbarque(catId, fecha, turno) : []; } catch (e) { error = e.message; }
  const reservas = new Set(filas.map((f) => f.numero)).size;
  const sinRegistrar = filas.filter((f) => !f.pasajero).length;
  const fila = (k, v) => `<div class="permit__row"><span>${U.esc(k)}</span><b>${v}</b></div>`;

  U.mount(appShell({
    active: null, rol: p.rol,
    topbarHtml: topbar({ title: "Lista de embarque", back: true, bell: false }),
    bodyHtml: !cat ? emptyState("Salida no encontrada", "Volvé a Mi flota y abrí la salida.", "calendar") : `
      <section class="doc embarque">
        <div class="doc__head">${U.icon("users", { size: 18 })}<span>Lista de embarque</span></div>
        <div class="permit__body">
          ${fila("Catamarán", U.esc(cat.nombre))}
          ${cat.habilitacion ? fila("Habilitación", U.esc(cat.habilitacion)) : ""}
          ${fila("Salida", `${U.esc(U.fmtDateLong(fecha))} · turno ${U.esc(U.turnoLabel(turno).toLowerCase())}`)}
          ${fila("Responsable", U.esc(`${p.nombre} ${p.apellido || ""}`.trim()))}
          ${fila("Pasajeros", `${filas.length} lugar${filas.length === 1 ? "" : "es"} · ${reservas} reserva${reservas === 1 ? "" : "s"}`)}
        </div>
        ${error ? `<div class="nota nota--error" style="margin:0 18px 16px">${U.icon("alert-triangle", { size: 18 })}<span>${U.esc(error)}</span></div>` : filas.length ? `
        <table class="table embarque__tabla">
          <thead><tr><th>Lugar</th><th>Pasajero</th><th>DNI</th></tr></thead>
          <tbody>${filas.map((f) => `<tr>
            <td>${f.lugar}</td>
            <td>${f.pasajero ? `<b>${U.esc(f.pasajero)}</b>` : `<span class="muted">Acompañante sin registrar</span>`}
              <small class="muted d-block">${f.titular ? "Titular" : "Acompañante"} · ${U.esc(f.numero)}</small></td>
            <td>${U.esc(f.dni || "—")}</td>
          </tr>`).join("")}</tbody>
        </table>
        <p class="embarque__firma">Firma del responsable: ______________________________</p>` : `<p class="muted center" style="padding:0 18px 18px">No hay reservas para esta salida.</p>`}
      </section>
      ${sinRegistrar > 0 ? `<p class="muted center mt-12" style="font-size:.8rem">${U.icon("info", { size: 14 })} ${sinRegistrar} lugar${sinRegistrar === 1 ? "" : "es"} de reservas hechas antes de que se pidieran los acompañantes: anotá su nombre y DNI al embarcar.</p>` : ""}
      ${filas.length ? `<div class="stack mt-16">
        <button class="btn btn--primary btn--block" data-print>${U.icon("download", { size: 18 })} Imprimir o guardar en PDF</button>
        <button class="btn btn--soft btn--block" data-csv>${U.icon("file-text", { size: 18 })} Descargar CSV (Excel)</button>
      </div>` : ""}
      <p class="muted center mt-12" style="font-size:.8rem">${U.icon("shield", { size: 14 })} Sólo ves el nombre y el DNI de los pasajeros de tus salidas. El correo, el teléfono, el pago y el permiso sólo los ven el pasajero y el Municipio.</p>`,
  }));
  wireChrome(ctx);
  U.$("[data-print]")?.addEventListener("click", () => window.print());
  U.$("[data-csv]")?.addEventListener("click", () => {
    U.downloadText(`embarque-${(cat.nombre || "salida").replace(/\s+/g, "-").toLowerCase()}-${fecha}-${turno}.csv`, U.toCSV(
      filas.map((f) => ({ lugar: f.lugar, pasajero: f.pasajero || "(sin registrar)", dni: f.dni || "", tipo: f.titular ? "Titular" : "Acompañante", reserva: f.numero })),
      [{ key: "lugar", label: "Lugar" }, { key: "pasajero", label: "Pasajero" }, { key: "dni", label: "DNI" }, { key: "tipo", label: "Tipo" }, { key: "reserva", label: "Reserva" }]));
    U.toast("CSV descargado", "ok");
  });
}

/* ---- Finanzas: ganancias y pérdidas del mes ---- */
const ICONO_GASTO = { combustible: "wallet", mantenimiento: "settings", personal: "users", seguro: "shield", amarre: "map-pin", impuestos: "file-text", otros: "receipt" };

function flotaFinanzas(ctx, propios, reservas, gastosLeidos) {
  const gastos = gastosLeidos || [];   // null: no se pudieron leer (se avisa)
  const mesActual = U.todayISO().slice(0, 7);
  const periodo = /^\d{4}-\d{2}$/.test(ctx.params.mes || "") && ctx.params.mes <= mesActual ? ctx.params.mes : mesActual;
  const catSel = propios.some((c) => c.id === ctx.params.cat) ? ctx.params.cat : "";
  const f = D.finanzasDueno({ reservas, gastos, catamaranes: propios, periodo, catId: catSel });
  const gan = f.resultado >= 0;
  const margen = f.ingresos ? Math.round((f.resultado / f.ingresos) * 100) : null;
  const nombreCat = (id) => propios.find((c) => c.id === id)?.nombre || "General de la flota";
  const categorias = Object.entries(f.porCategoria).sort((a, b) => b[1] - a[1])
    .map(([k, v], i) => ({ label: D.CATEGORIAS_GASTO[k] || k, value: v, color: CHART_COLORS[i % CHART_COLORS.length] }));
  const filtroUrl = (mes, cat) => `/gestion?tab=finanzas&mes=${mes}${cat ? "&cat=" + cat : ""}`;
  const fila = (nombre, ing, gas) => `<div class="fin-fila"><span>${U.esc(nombre)}</span><span>${U.fmtMoney(ing)}</span><span>${U.fmtMoney(gas)}</span><b class="${ing - gas >= 0 ? "pos" : "neg"}">${U.fmtMoney(ing - gas)}</b></div>`;

  if (!propios.length) return {
    html: `${emptyState("Sin catamaranes", "Cargá tu catamarán para llevar sus ingresos y gastos.", "bar-chart")}
      <a class="btn btn--cta btn--block" href="#/gestion?nuevo=1">${U.icon("plus", { size: 18 })} Cargar mi catamarán</a>`,
    wire: () => {},
  };

  const html = `
    <div class="filters">
      <input class="input" type="month" id="fi-mes" value="${periodo}" max="${mesActual}" aria-label="Mes"/>
    </div>
    ${propios.length > 1 ? `<select class="select" id="fi-cat" aria-label="Catamarán" style="margin:-6px 0 16px">
      <option value="">Toda la flota</option>
      ${propios.map((c) => `<option value="${c.id}"${c.id === catSel ? " selected" : ""}>${U.esc(c.nombre)}</option>`).join("")}
    </select>` : ""}

    ${gastosLeidos ? "" : `<div class="nota nota--error" style="margin-bottom:12px">${U.icon("alert-triangle", { size: 18 })}<span>No se pudieron cargar tus gastos: el resultado muestra sólo los ingresos. Volvé a intentar con conexión.</span></div>`}
    <section class="resultado resultado--${gan ? "pos" : "neg"}" aria-live="polite">
      <small>Resultado de ${U.esc(U.fmtMes(periodo))}${catSel ? " · " + U.esc(nombreCat(catSel)) : ""}</small>
      <b>${U.fmtMoney(f.resultado)}</b>
      <span>${gan ? "Ganancia" : "Pérdida"}${margen !== null ? ` · margen ${margen} %` : ""}</span>
    </section>
    <div class="stats mt-12">
      ${stat("Ingresos", U.fmtMoney(f.ingresos), `${f.lugares} lugar${f.lugares === 1 ? "" : "es"} en ${f.salidas} salida${f.salidas === 1 ? "" : "s"}`, "pos")}
      ${stat("Gastos", U.fmtMoney(f.gastos), `${f.gastosDelMes.length} registrado${f.gastosDelMes.length === 1 ? "" : "s"}`, "neg")}
      ${stat("Ocupación", `${f.ocupacion} %`, "Promedio por salida")}
    </div>

    <div class="card card--flat mt-16">
      <h2 class="card__titulo">Ingresos y gastos · últimos 6 meses</h2>
      ${barChartPar(f.serie.map((m) => ({ label: U.fmtMes(m.periodo, true), a: m.ingresos, b: m.gastos })), { nombreA: "Ingresos", nombreB: "Gastos", fmt: U.fmtMoney, height: 170 })}
      <div class="fin-tabla mt-12">
        <div class="fin-fila fin-fila--head"><span>Mes</span><span>Ingresos</span><span>Gastos</span><span>Resultado</span></div>
        ${f.serie.slice().reverse().map((m) => fila(U.fmtMes(m.periodo).replace(" de ", " "), m.ingresos, m.gastos)).join("")}
      </div>
    </div>

    <div class="card card--flat mt-12">
      <h2 class="card__titulo">Gastos por categoría</h2>
      <div class="dona-apilada">${donutChart(categorias, { size: 150, thickness: 26, fmt: U.fmtMoney })}</div>
    </div>

    ${!catSel && propios.length ? `<div class="card card--flat mt-12">
      <h2 class="card__titulo">Por catamarán</h2>
      <div class="fin-tabla">
        <div class="fin-fila fin-fila--head"><span>Catamarán</span><span>Ingresos</span><span>Gastos</span><span>Resultado</span></div>
        ${f.porCatamaran.map((c) => fila(c.nombre, c.ingresos, c.gastos)).join("")}
        ${f.generales ? fila("Gastos generales", 0, f.generales) : ""}
      </div>
    </div>` : ""}

    <h2 class="section-title mt-24">Gastos de ${U.esc(U.fmtMes(periodo).split(" ")[0])} <button class="btn btn--cta btn--sm" data-gasto-nuevo>${U.icon("plus", { size: 16 })} Registrar</button></h2>
    ${f.gastosDelMes.length ? f.gastosDelMes.map((g) => `<div class="row-item row-item--wrap">
      <div class="row-item__ic">${U.icon(ICONO_GASTO[g.categoria] || "receipt", { size: 18 })}</div>
      <div class="row-item__main">
        <h3>${U.esc(D.CATEGORIAS_GASTO[g.categoria] || g.categoria)}</h3>
        <small>${g.descripcion ? U.esc(g.descripcion) + " · " : ""}${U.esc(nombreCat(g.id_catamaran))} · ${U.fmtDate(g.fecha)}</small>
      </div>
      <b class="neg">${U.fmtMoney(g.monto)}</b>
      <div class="row-item__actions">
        <button class="btn btn--soft btn--sm" data-gasto-editar="${g.id}">${U.icon("edit", { size: 15 })} Editar</button>
        <button class="btn btn--danger btn--sm" data-gasto-borrar="${g.id}">Eliminar</button>
      </div>
    </div>`).join("") : `<p class="muted" style="font-size:.88rem">No registraste gastos en este mes. Cargá el combustible, el mantenimiento, los sueldos y los demás gastos para conocer tu resultado real.</p>`}

    <button class="btn btn--soft btn--block mt-16" data-csv>${U.icon("download", { size: 18 })} Descargar el mes en CSV (Excel)</button>
    <p class="muted center mt-12" style="font-size:.78rem">Ingresos: lugares vendidos en reservas confirmadas o realizadas, según la fecha de la salida. El permiso de pesca se cobra para el Municipio y no se suma. El pago es simulado en este prototipo.</p>`;

  return {
    html,
    wire: () => {
      const ir = () => ctx.go(filtroUrl(U.$("#fi-mes").value || periodo, U.$("#fi-cat")?.value || ""));
      U.$("#fi-mes").addEventListener("change", ir);
      U.$("#fi-cat")?.addEventListener("change", ir);
      const porId = byIdMap(f.gastosDelMes);
      U.$("[data-gasto-nuevo]").addEventListener("click", () => gastoModal(ctx, propios, null, catSel));
      U.$$("[data-gasto-editar]").forEach((b) => b.addEventListener("click", () => gastoModal(ctx, propios, porId[b.dataset.gastoEditar])));
      U.$$("[data-gasto-borrar]").forEach((b) => b.addEventListener("click", async () => {
        const g = porId[b.dataset.gastoBorrar];
        const ok = await U.confirmDialog({ title: "Eliminar gasto", message: `Se elimina el gasto de ${D.CATEGORIAS_GASTO[g.categoria] || g.categoria} por ${U.fmtMoney(g.monto)} del ${U.fmtDate(g.fecha)}. ¿Confirmás?`, okLabel: "Eliminar" });
        if (!ok) return;
        try { await D.eliminarGasto(g.id); U.toast("Gasto eliminado", "ok"); ctx.rerender(); }
        catch (err) { U.toast(err.message, "err"); }
      }));
      U.$("[data-csv]").addEventListener("click", () => {
        const filas = [
          ...f.reservas.map((r) => ({ fecha: U.fmtDate(r.fecha), tipo: "Ingreso", concepto: `Reserva ${r.numero || ""} · ${r.cantidad_lugares} lugar(es) · turno ${U.turnoLabel(r.turno).toLowerCase()}`, catamaran: nombreCat(r.id_catamaran), monto: D.ingresoReserva(r) })),
          ...f.gastosDelMes.map((g) => ({ fecha: U.fmtDate(g.fecha), tipo: "Gasto", concepto: `${D.CATEGORIAS_GASTO[g.categoria] || g.categoria}${g.descripcion ? " · " + g.descripcion : ""}`, catamaran: nombreCat(g.id_catamaran), monto: -Number(g.monto) })),
        ];
        filas.push({ fecha: "", tipo: "Resultado", concepto: gan ? "Ganancia" : "Pérdida", catamaran: catSel ? nombreCat(catSel) : "Toda la flota", monto: f.resultado });
        U.downloadText(`finanzas-${periodo}.csv`, U.toCSV(filas, [
          { key: "fecha", label: "Fecha" }, { key: "tipo", label: "Tipo" }, { key: "concepto", label: "Concepto" },
          { key: "catamaran", label: "Catamarán" }, { key: "monto", label: "Monto" },
        ]));
        U.toast("CSV descargado", "ok");
      });
    },
  };
}

function gastoModal(ctx, propios, gasto, catInicial = "") {
  const edit = Boolean(gasto);
  const catActual = edit ? gasto.id_catamaran || "" : catInicial;
  U.modal({
    title: edit ? "Editar gasto" : "Registrar gasto",
    body: `
      <div class="flex gap-12">
        <div class="field grow"><label for="g-fecha">Fecha</label><input class="input" type="date" id="g-fecha" value="${U.esc(gasto?.fecha || U.todayISO())}"/></div>
        <div class="field grow"><label for="g-monto">Monto</label><input class="input" type="number" id="g-monto" min="1" step="1" inputmode="numeric" value="${gasto ? Number(gasto.monto) : ""}" placeholder="45000"/></div>
      </div>
      <div class="field"><label for="g-cat">Categoría</label>
        <select class="select" id="g-cat">${Object.entries(D.CATEGORIAS_GASTO).map(([k, v]) => `<option value="${k}"${gasto?.categoria === k ? " selected" : ""}>${U.esc(v)}</option>`).join("")}</select></div>
      <div class="field"><label for="g-barco">Catamarán</label>
        <select class="select" id="g-barco">
          <option value="">General de la flota</option>
          ${propios.map((c) => `<option value="${c.id}"${c.id === catActual ? " selected" : ""}>${U.esc(c.nombre)}</option>`).join("")}
        </select></div>
      <div class="field"><label for="g-desc">Descripción (opcional)</label><input class="input" id="g-desc" maxlength="120" value="${U.esc(gasto?.descripcion || "")}" placeholder="Nafta para la semana"/></div>`,
    actions: [
      { label: "Cancelar", variant: "btn--soft" },
      {
        label: edit ? "Guardar" : "Registrar", variant: "btn--primary", close: false,
        onClick: async () => {
          try {
            await D.guardarGasto({
              id: gasto?.id || null, idCatamaran: U.$("#g-barco").value || null, fecha: U.$("#g-fecha").value,
              categoria: U.$("#g-cat").value, descripcion: U.$("#g-desc").value, monto: U.$("#g-monto").value,
            });
            U.closeModal(); U.toast(edit ? "Gasto actualizado" : "Gasto registrado", "ok"); ctx.rerender();
          } catch (err) { U.toast(err.message, "err"); }
          return false;
        },
      },
    ],
  });
}

/* Alta y edición de un catamarán. `duenos` (sólo la administración): cuentas a
 * las que se puede asignar; un dueño puede tener varios catamaranes. */
function catamaranModal(ctx, cat, futuras = 0, duenos = null) {
  const edit = Boolean(cat);
  // Fotos: las ya guardadas ({ ruta }) y las nuevas, reducidas y por subir ({ blob, vista }).
  const fotos = (cat?.fotos || []).map((ruta) => ({ ruta }));
  const pintarFotos = () => {
    U.$("#c-fotos").innerHTML = fotos.map((f, i) => `<div class="foto-mini">
        <img src="${U.esc(f.vista || D.urlFoto(f.ruta))}" alt="Foto ${i + 1} de ${fotos.length}"/>
        ${i === 0 ? `<span class="foto-mini__portada">Portada</span>` : `<button type="button" class="foto-mini__btn foto-mini__btn--portada" data-portada="${i}" aria-label="Usar la foto ${i + 1} como portada">${U.icon("check", { size: 14, stroke: 3 })}</button>`}
        <button type="button" class="foto-mini__btn" data-quitar="${i}" aria-label="Quitar la foto ${i + 1}">${U.icon("x", { size: 14, stroke: 3 })}</button>
      </div>`).join("") || `<p class="muted" style="font-size:.84rem;margin:0">Sin fotos todavía.</p>`;
    U.$("#c-fotos-agregar").classList.toggle("hide", fotos.length >= D.MAX_FOTOS);
  };
  U.modal({
    title: edit ? "Editar catamarán" : "Nuevo catamarán",
    body: `
      <div class="field"><label for="c-nombre">Nombre</label><input class="input" id="c-nombre" maxlength="60" value="${U.esc(cat?.nombre || "")}" placeholder="Don Juan II"/></div>
      <div class="field"><label for="c-desc">Descripción</label><textarea class="input" id="c-desc" maxlength="300" rows="3" placeholder="Catamarán techado, con baño y sombra. Equipo de pesca incluido.">${U.esc(cat?.descripcion || "")}</textarea>
        <div class="field__hint">La ven los pescadores al elegir dónde reservar.</div></div>
      <div class="field"><span class="field-label" id="c-fotos-titulo">Fotos (hasta ${D.MAX_FOTOS})</span>
        <div class="fotos-editor" id="c-fotos" role="group" aria-labelledby="c-fotos-titulo"></div>
        <label class="btn btn--soft btn--sm mt-8" id="c-fotos-agregar" for="c-fotos-input">${U.icon("plus", { size: 16 })} Agregar fotos</label>
        <input type="file" id="c-fotos-input" accept="image/jpeg,image/png,image/webp" multiple class="sr-only"/>
        <div class="field__hint">La primera es la portada. Se ven en la lista de catamaranes y al reservar.</div></div>
      <div class="flex gap-12">
        <div class="field grow"><label for="c-cap">Cantidad de lugares</label><input class="input" id="c-cap" type="number" min="1" max="60" inputmode="numeric" value="${cat?.capacidad || 12}"/></div>
        <div class="field grow"><label for="c-precio">Precio por lugar</label><input class="input" id="c-precio" type="number" min="0" inputmode="numeric" value="${cat?.precio ?? 8000}"/></div>
      </div>
      ${edit ? `<p class="field__hint" style="margin:-6px 0 14px">Si cambiás la cantidad de lugares se rehace el plano. No se pueden quitar lugares que tengan reservas desde hoy.</p>` : ""}
      <div class="field"><label for="c-hab">N° de habilitación municipal</label><input class="input" id="c-hab" value="${U.esc(cat?.habilitacion || "")}" placeholder="HAB-2024-000"/></div>
      ${duenos ? `<div class="field"><label for="c-dueno">Dueño</label>
        <select class="select" id="c-dueno">
          <option value="">Sin dueño asignado</option>
          ${duenos.map((u) => `<option value="${u.id}"${cat?.id_propietario === u.id ? " selected" : ""}>${U.esc(`${u.nombre} ${u.apellido || ""}`.trim())} · ${U.esc(u.email)}</option>`).join("")}
        </select>
        <div class="field__hint">El dueño lo administra desde Mi flota. Un dueño puede tener varios catamaranes.</div></div>` : ""}
      <div class="field"><label for="c-estado">Estado</label>
        <select class="select" id="c-estado">
          ${["activa", "mantenimiento", "inactiva"].map((e) => `<option value="${e}"${cat?.estado === e ? " selected" : ""}>${estadoCatLabel(e)}</option>`).join("")}
        </select>
        <div class="field__hint">${futuras ? `Tiene ${futuras} reserva${futuras > 1 ? "s" : ""} desde hoy: si lo pasás a mantenimiento o inactivo, esas reservas se mantienen y no se reciben nuevas.` : "En mantenimiento o inactivo no recibe reservas."}</div>
      </div>
    `,
    actions: [
      { label: "Cancelar", variant: "btn--soft" },
      {
        label: edit ? "Guardar" : "Crear", variant: "btn--primary", close: false,
        onClick: async () => {
          const data = {
            nombre: U.$("#c-nombre").value.trim(),
            descripcion: U.$("#c-desc").value.trim(),
            precio: Number(U.$("#c-precio").value),
            habilitacion: U.$("#c-hab").value.trim(),
            estado: U.$("#c-estado").value,
          };
          // HU-003 · criterio 1: formulario incompleto o con datos inválidos.
          const capacidad = Number(U.$("#c-cap").value);
          if (!data.nombre) { U.toast("Ingresá el nombre del catamarán.", "err"); return false; }
          if (!(Number.isInteger(capacidad) && capacidad >= 1 && capacidad <= 60)) { U.toast("La cantidad de lugares debe ser un número entero entre 1 y 60.", "err"); return false; }
          if (!(data.precio >= 0) || U.$("#c-precio").value === "") { U.toast("Ingresá un precio por lugar válido.", "err"); return false; }
          if (!data.habilitacion) { U.toast("Ingresá el número de habilitación municipal.", "err"); return false; }
          const btn = U.$("#app-modal [data-act='1']"); btn.disabled = true; btn.textContent = "Guardando…";
          let id = cat?.id;
          try {
            if (edit) {
              // Primero la cantidad de lugares: si no se puede, no se guarda nada.
              if (capacidad !== Number(cat.capacidad)) await D.cambiarCapacidad(cat.id, capacidad);
              await D.updateCatamaran(cat.id, data);
            } else {
              id = await D.crearCatamaran({ ...data, capacidad });
            }
            const dueno = U.$("#c-dueno");
            if (dueno && dueno.value !== (cat?.id_propietario || "")) await D.asignarPropietario(id, dueno.value || null);
            // Fotos: se suben las nuevas, se guarda el orden y se borran las quitadas.
            const antes = cat?.fotos || [];
            const rutas = [];
            for (const f of fotos) rutas.push(f.ruta || await D.subirFotoCatamaran(id, f.blob));
            if (JSON.stringify(rutas) !== JSON.stringify(antes)) await D.setFotosCatamaran(id, rutas);
            await D.borrarFotosCatamaran(antes.filter((r) => !rutas.includes(r)));
            U.closeModal(); U.toast(edit ? "Catamarán actualizado" : "Catamarán creado", "ok"); ctx.rerender();
          } catch (err) {
            if (!edit && id) {   // se creó, pero falló el dueño o alguna foto: se sigue desde Editar
              U.closeModal(); U.toast(`El catamarán se creó, pero ${err.message.charAt(0).toLowerCase()}${err.message.slice(1)}`, "err"); ctx.rerender();
              return false;
            }
            U.toast(err.message, "err"); btn.disabled = false; btn.textContent = edit ? "Guardar" : "Crear";
          }
          return false;
        },
      },
    ],
  });
  pintarFotos();
  U.$("#c-fotos").addEventListener("click", (e) => {
    const q = e.target.closest("[data-quitar]"), pt = e.target.closest("[data-portada]");
    if (q) { const [f] = fotos.splice(Number(q.dataset.quitar), 1); if (f.vista) URL.revokeObjectURL(f.vista); }
    else if (pt) { const [f] = fotos.splice(Number(pt.dataset.portada), 1); fotos.unshift(f); }
    else return;
    pintarFotos();
  });
  U.$("#c-fotos-input").addEventListener("change", async (e) => {
    const archivos = [...e.target.files].slice(0, D.MAX_FOTOS - fotos.length);
    e.target.value = "";
    for (const archivo of archivos) {
      try {
        // En la demostración se guardan en el dispositivo: más chicas.
        const blob = D.MODE === "demo" ? await U.reducirFoto(archivo, 640, 0.7) : await U.reducirFoto(archivo);
        fotos.push({ blob, vista: URL.createObjectURL(blob) });
      } catch (err) { U.toast(err.message, "err"); }
    }
    pintarFotos();
  });
}

/* ============================================================================
 *  ESTADO VACÍO
 * ========================================================================== */
function emptyState(titulo, texto, ic = "info") {
  return `<div class="empty">${U.icon(ic, { size: 56, stroke: 1.5 })}<h3>${U.esc(titulo)}</h3><p>${U.esc(texto)}</p></div>`;
}
