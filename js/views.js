/* ============================================================================
 *  PescaCorral · js/views.js
 *  Render de todas las pantallas de la PWA. Cada vista arma su HTML, lo monta
 *  con U.mount() y conecta sus eventos. Reciben un `ctx` con:
 *    { session, go(path), rerender(), params }
 * ========================================================================== */
import * as D from "./data.js";
import * as U from "./ui.js";
import { barChart, donutChart, progressBar, CHART_COLORS } from "./charts.js";

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
    <span class="topbar__title">${U.esc(title)}</span>
    <span class="topbar__spacer"></span>
    ${bell
      ? `<button class="topbar__btn bell" data-bell aria-label="Notificaciones">
           ${U.icon("bell", { size: 22 })}
           ${unread ? `<span class="bell__dot">${unread > 9 ? "9+" : unread}</span>` : ""}
         </button>`
      : ""}
  </header>`;
}

function bottomNav(active, rol) {
  let items;
  if (rol === "dueno") {
    items = [
      ["home", "Inicio", "home", "#/home"],
      ["catamaranes", "Catamaranes", "boat", "#/catamaranes"],
      ["gestion", "Gestión", "grid", "#/gestion"],
      ["perfil", "Perfil", "user", "#/perfil"],
    ];
  } else {
    items = [
      ["home", "Inicio", "home", "#/home"],
      ["catamaranes", "Reservar", "boat", "#/catamaranes"],
      ["historial", "Historial", "calendar", "#/historial"],
      ["perfil", "Perfil", "user", "#/perfil"],
    ];
  }
  return `<nav class="bottomnav">${items.map(([key, label, ic, href]) =>
    `<a href="${href}" class="${active === key ? "active" : ""}">${U.icon(ic, { size: 22 })}<span>${label}</span></a>`
  ).join("")}</nav>`;
}

function appShell({ active = null, rol = "pescador", topbarHtml = "", bodyHtml = "" }) {
  const showNav = active !== null && !isAdmin(rol);
  return `<div class="app"><div class="shell">
    ${topbarHtml}
    <div class="shell__body${showNav ? "" : " no-nav"}">${bodyHtml}</div>
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
    ["gestion", "Catamaranes", "boat", "#/gestion"],
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
  U.mount(`<div class="auth">
    <div class="auth__head">
      <span class="logo">${U.logoMark(52)}</span>
      <h1>PescaCorral</h1>
      <p>Reservas y permisos de pesca · ${U.esc(CFG.LUGAR || "Dique Cabra Corral")}</p>
    </div>
    <div class="auth__card-wrap">
      <div class="auth__card">
        <h2>Ingresá a tu cuenta</h2>
        <p class="sub">Usá tu cuenta de Google para reservar lugares y gestionar tus permisos de pesca. Si es tu primer ingreso, la cuenta se crea en el momento.</p>
        <button class="btn btn--google btn--block btn--lg" id="btn-google" type="button">${GOOGLE_G}<span>Continuar con Google</span></button>
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
  </div>`);

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
      btn.disabled = false; label.textContent = "Continuar con Google";
    }
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
  U.mount(`<div class="auth">
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
  </div>`);

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
  U.mount(`<div class="auth">
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
  </div>`);

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
  const [reservas, permisos, notifs, cats] = await Promise.all([
    D.listReservas(), D.listPermisos(), D.listNotificaciones(), D.disponibilidad(hoy, "manana"),
  ]);
  const unread = notifs.filter((n) => !n.leida).length;
  const proxima = reservas.filter((r) => r.estado !== "cancelada" && r.fecha >= hoy).sort((a, b) => a.fecha < b.fecha ? -1 : 1)[0];
  const permisoVigente = permisos.find((p) => p.estado === "vigente");
  const disponibles = cats.filter((c) => c.estado === "activa").slice(0, 2);

  const quick = [
    ["Reservar salida", "Elegí catamarán y lugares", "boat", "t1", "#/catamaranes"],
    ["Mis permisos", "Permisos digitales con QR", "ticket", "t2", "#/historial?tab=permisos"],
    ["Historial", "Tus reservas anteriores", "calendar", "t3", "#/historial"],
    ["Mi perfil", "Datos y configuración", "user", "t4", "#/perfil"],
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
        <input class="input" type="date" id="f-fecha" value="${fecha}" min="${U.todayISO()}" />
        <select class="select turno" id="f-turno">
          <option value="manana"${turno === "manana" ? " selected" : ""}>Mañana</option>
          <option value="tarde"${turno === "tarde" ? " selected" : ""}>Tarde</option>
        </select>
      </div>
      <p class="muted" style="margin:-6px 2px 14px;font-weight:600">${U.icon("calendar", { size: 14 })} ${U.fmtDateLong(fecha)} · Turno ${U.turnoLabel(turno)}</p>
      <div id="boat-list">${cats.map((c) => boatCard(c, fecha, turno)).join("")}</div>
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
    <div class="boat__img">${U.icon("boat", { size: 46, stroke: 1.6 })}</div>
    <div class="boat__main">
      <h3>${U.esc(c.nombre)}</h3>
      <div class="boat__meta">${U.icon("users", { size: 13 })} ${c.capacidad} lugares ${c.habilitacion ? "· Hab. " + U.esc(c.habilitacion) : ""}</div>
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
            <h3>${U.esc(cat.nombre)}</h3>
            <div class="muted" style="font-weight:600;margin-top:2px">${U.fmtMoney(cat.precio)} / lugar · ${cat.capacidad} lugares</div>
          </div>
          <div class="boat__img" style="width:54px;height:54px">${U.icon("boat", { size: 30, stroke: 1.6 })}</div>
        </div>
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
    const falta = !n ? "Elegí tus lugares" : modoPermiso === "propio" && !permisoValido ? "Verificá tu permiso" : null;
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

  const cargar = async () => {
    [ocupacion, mios] = await Promise.all([D.ocupacionPorTurno(catId, fecha), D.misLugares(catId, fecha)]);
    pintarTurnos(); pintarMios(); pintarAsientos(); refreshSummary();
  };
  await cargar();

  U.$("#seatmap").addEventListener("click", (e) => {
    const btn = e.target.closest(".seat");
    if (!btn || btn.disabled) return;
    const id = btn.dataset.lugar;
    if (seleccion.has(id)) seleccion.delete(id); else seleccion.add(id);
    btn.classList.toggle("seat--selected", seleccion.has(id));
    btn.setAttribute("aria-pressed", String(seleccion.has(id)));
    refreshSummary();
  });

  const cambiarTurno = async (t) => {
    if (t === turno) return;
    turno = t; seleccion.clear();
    pintarTurnos(); pintarMios(); pintarAsientos(); refreshSummary();
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
        lugares: [...seleccion],
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
 * del lado derecho. */
function planoCatamaran(lugares, ocupados, seleccion, propios = new Set()) {
  const total = lugares.length;
  const filas = Math.ceil(total / 2);
  const zonas = { proa: [], centro: [], popa: [] };
  for (let f = 0; f < filas; f++) zonas[f * 3 < filas ? "proa" : f * 3 < filas * 2 ? "centro" : "popa"].push(f);
  const asientos = lugares.map((l, i) => {
    const pos = D.posicionLugar(i + 1, total);
    const occ = ocupados.has(l.id);
    const mio = propios.has(l.id);
    const sel = seleccion.has(l.id);
    const estado = mio ? "tu lugar" : occ ? "ocupado" : "libre";
    const cls = mio ? "seat seat--mio" : occ ? "seat seat--occupied" : sel ? "seat seat--selected" : "seat";
    return `<button type="button" class="${cls}" data-lugar="${l.id}" ${occ || mio ? "disabled" : `aria-pressed="${sel}"`}
      style="grid-row:${pos.fila + 1};grid-column:${pos.lado === "estribor" ? 3 : 1}"
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

  U.mount(appShell({
    active: null, rol: p.rol,
    topbarHtml: topbar({ title: "Comprobante", back: !nuevo, bell: false }),
    bodyHtml: `
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
  const [reservas, permisos, notifs] = await Promise.all([D.listReservas(), D.listPermisos(), D.listNotificaciones()]);
  const unread = notifs.filter((n) => !n.leida).length;
  const hoy = U.todayISO();

  const reservasHtml = reservas.length ? reservas.map((r) => {
    const b = U.estadoReservaBadge(r.estado);
    const cancelable = r.estado === "confirmada" && r.fecha >= hoy;
    return `<div class="row-item row-item--wrap">
      <div class="row-item__ic">${U.icon("boat", { size: 20 })}</div>
      <div class="row-item__main">
        <h4>${U.esc(r.catamaran_nombre)}</h4>
        ${r.numero ? `<small>${U.esc(r.numero)}</small>` : ""}
        <small>${U.fmtDate(r.fecha)} · ${U.turnoLabel(r.turno)} · ${r.cantidad_lugares} lugar${r.cantidad_lugares > 1 ? "es" : ""} · ${U.fmtMoney(r.monto_total)}</small>
      </div>
      <span class="badge ${b.cls}">${b.label}</span>
      <div class="row-item__actions">
          <a class="btn btn--soft btn--sm" href="#/comprobante/${r.id}">Comprobante</a>
          ${r.permiso_id ? `<a class="btn btn--soft btn--sm" href="#/permiso/${r.permiso_id}">Permiso</a>` : ""}
          ${cancelable ? `<button class="btn btn--danger btn--sm" data-anular="${r.id}">Anular</button>` : ""}
        </div>
    </div>`;
  }).join("") : emptyState("Sin reservas todavía", "Cuando reserves una salida, aparecerá acá.", "calendar");

  const permisosHtml = permisos.length ? permisos.map((per) => {
    const cls = per.estado === "vencido" ? "is-vencido" : per.estado === "anulado" ? "is-anulado" : "";
    const b = U.estadoPermisoBadge(per.estado);
    return `<a class="permit-mini" href="#/permiso/${per.id}" style="margin-bottom:10px">
      <div class="permit-mini__badge ${cls}">${U.icon("ticket", { size: 22 })}</div>
      <div class="grow"><h4>${U.esc(per.numero)}</h4><small>${U.esc(per.especie_nombre)} · ${per.fecha ? U.fmtDate(per.fecha) : "—"}</small></div>
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
            <div class="field grow"><label>Nombre</label><input class="input" id="pf-nombre" value="${U.esc(p.nombre)}"/></div>
            <div class="field grow"><label>Apellido</label><input class="input" id="pf-apellido" value="${U.esc(p.apellido || "")}"/></div>
          </div>
          <div class="field"><label>Teléfono</label><input class="input" id="pf-tel" value="${U.esc(p.telefono || "")}"/></div>
          <div class="field"><label>DNI</label><input class="input" id="pf-dni" value="${U.esc(p.dni || "")}"/></div>
          <button class="btn btn--primary btn--block" type="submit">${U.icon("check", { size: 18 })} Guardar cambios</button>
        </form>
      </div>

      ${(p.rol === "dueno") ? `<a class="btn btn--outline btn--block mt-12" href="#/gestion">${U.icon("boat", { size: 18 })} Gestionar mis catamaranes</a>` : ""}
      ${isAdmin(p.rol) ? `<a class="btn btn--outline btn--block mt-12" href="#/admin">${U.icon("grid", { size: 18 })} Ir al panel municipal</a>` : ""}

      <h2 class="section-title mt-24">Notificaciones</h2>
      <div class="card card--flat">
        <label class="flex between items-center" style="cursor:pointer;gap:12px">
          <span><b>Recordatorios de salida</b><br><small class="muted">Aviso el día previo y el día de tu reserva.</small></span>
          <input type="checkbox" id="pf-recordatorios" ${D.prefRecordatorios() ? "checked" : ""} style="width:22px;height:22px;accent-color:var(--blue-600)"/>
        </label>
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
 *  NOTIFICACIONES (drawer modal)
 * ========================================================================== */
async function openNotificaciones(ctx) {
  const notifs = await D.listNotificaciones();
  const body = notifs.length ? `<div class="notif-list">${notifs.map((n) => `
    <div class="notif ${n.leida ? "" : "unread"}">
      <h4>${U.esc(n.titulo)}</h4>
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
          <h3>Reservas por día · ${U.fmtDate(from)} a ${U.fmtDate(to)}</h3>
          ${barChart(serie, { height: 230, color: "#8E1F2F" })}
        </div>
        <div class="panel">
          <h3>Permisos por especie</h3>
          ${donutChart(especieData, { centerTop: String(resumen.permisos_total), centerSub: "permisos" })}
        </div>
      </div>
      <div class="grid-2">
        <div class="panel">
          <h3>Ocupación por catamarán · ${U.fmtDate(to)} (mañana y tarde)</h3>
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
          <h3>Últimos permisos emitidos</h3>
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
          <h3>Evolución mensual de reservas</h3>
          ${barChart(mesData, { height: 230, color: "#C9821E" })}
        </div>
        <div class="panel">
          <h3>Distribución de permisos por especie</h3>
          ${donutChart(especieData, { centerTop: String(resumen.permisos_total), centerSub: "permisos" })}
        </div>
      </div>
      <div class="panel">
        <h3>${U.icon("alert-triangle", { size: 18 })} Monitoreo de fauna · presión pesquera</h3>
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
        <h3>${U.icon("mail", { size: 18 })} Reportes enviados al municipio</h3>
        <table class="table">
          <thead><tr><th>Fecha</th><th>Reporte</th><th>Destinatario</th><th>Origen</th></tr></thead>
          <tbody>${enviados.map((r) => `<tr>
            <td style="white-space:nowrap">${U.fmtDateTime(r.created_at || r.fecha)}</td>
            <td><b>${U.esc(r.titulo)}</b><br><small class="muted">Permisos: ${r.datos?.resumen?.permisos_total ?? "—"} · Reservas: ${r.datos?.resumen?.reservas_total ?? "—"}</small></td>
            <td>${U.esc(r.destinatario)}</td>
            <td><span class="badge ${r.origen === "automatico" ? "badge--info" : "badge--ok"}">${r.origen === "automatico" ? "Automático" : "Manual"}</span></td>
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
  const usuarios = await D.listUsuarios();
  // Desde la aplicación sólo se gestionan las cuentas del público (tipo de
  // cuenta y estado); las del personal, desde la base de datos.
  const roles = ["pescador", "dueno"];

  U.mount(adminLayout({
    active: "usuarios",
    title: "Usuarios",
    subtitle: `${usuarios.length} cuentas registradas`,
    body: `<div class="panel">
      <table class="table">
        <thead><tr><th>Usuario</th><th>Contacto</th><th>DNI</th><th>Rol</th><th>Cuenta</th></tr></thead>
        <tbody>${usuarios.map((u) => D.esRolPersonal(u.rol) ? `<tr>
          <td><b>${U.esc(u.nombre)} ${U.esc(u.apellido || "")}</b></td>
          <td><small class="muted">${U.esc(u.email)}<br>${U.esc(u.telefono || "—")}</small></td>
          <td>${U.esc(u.dni || "—")}</td>
          <td><b>${U.esc(U.rolLabel(u.rol))}</b><br><small class="muted">Personal</small></td>
          <td>${u.activo !== false ? "Activa" : "Desactivada"}</td>
        </tr>` : `<tr>
          <td><b>${U.esc(u.nombre)} ${U.esc(u.apellido || "")}</b></td>
          <td><small class="muted">${U.esc(u.email)}<br>${U.esc(u.telefono || "—")}</small></td>
          <td>${U.esc(u.dni || "—")}</td>
          <td>
            <select class="select" data-rol="${u.id}" style="padding:8px 10px;font-size:.85rem">
              ${roles.map((r) => `<option value="${r}"${u.rol === r ? " selected" : ""}>${U.rolLabel(r)}</option>`).join("")}
            </select>
          </td>
          <td>
            <select class="select" data-activo="${u.id}" style="padding:8px 10px;font-size:.85rem">
              <option value="1"${u.activo !== false ? " selected" : ""}>Activa</option>
              <option value="0"${u.activo === false ? " selected" : ""}>Desactivada</option>
            </select>
          </td>
        </tr>`).join("")}</tbody>
      </table>
      <p class="panel__foot">Desde acá se cambia el tipo de cuenta (pescador o dueño) y el estado de las cuentas del público. Una cuenta desactivada no puede ingresar y sus sesiones se cierran. Las cuentas del personal se gestionan desde la base de datos. Los cambios se aplican al instante.</p>
    </div>`,
  }, ctx));
  wireAdmin(ctx);

  U.$$("[data-rol]").forEach((sel) => sel.addEventListener("change", async () => {
    try { await D.setRol(sel.dataset.rol, sel.value); U.toast("Rol actualizado", "ok"); }
    catch (err) { U.toast(err.message, "err"); }
  }));
  U.$$("[data-activo]").forEach((sel) => sel.addEventListener("change", async () => {
    const activo = sel.value === "1";
    try { await D.setActivo(sel.dataset.activo, activo); U.toast(activo ? "Cuenta activada" : "Cuenta desactivada", "ok"); }
    catch (err) { U.toast(err.message, "err"); }
  }));
}

/* ============================================================================
 *  GESTIÓN DE CATAMARANES (dueño / admin)
 * ========================================================================== */
export async function viewGestion(ctx) {
  const p = ctx.session.profile;
  const admin = isAdmin(p.rol);
  const cats = await D.listCatamaranes();
  const propios = admin ? cats : cats.filter((c) => c.id_propietario === p.id);

  const list = propios.length ? propios.map((c) => `
    <div class="boat" style="margin-bottom:12px">
      <div class="boat__img">${U.icon("boat", { size: 46, stroke: 1.6 })}</div>
      <div class="boat__main">
        <h3>${U.esc(c.nombre)}</h3>
        <div class="boat__meta">${U.icon("users", { size: 13 })} ${c.capacidad} lugares · ${U.fmtMoney(c.precio)}/lugar</div>
        <span class="badge ${c.estado === "activa" ? "badge--ok" : c.estado === "mantenimiento" ? "badge--warn" : "badge--muted"}" style="margin-top:6px">${estadoCatLabel(c.estado)}</span>
      </div>
      <button class="btn btn--soft btn--sm" data-edit="${c.id}">${U.icon("edit", { size: 16 })} Editar</button>
    </div>`).join("") : emptyState("Sin catamaranes", "Agregá tu primer catamarán para empezar a recibir reservas.", "boat");

  const headerActions = `<button class="btn btn--cta btn--sm" data-nuevo>${U.icon("plus", { size: 16 })} Nuevo</button>`;

  if (admin) {
    U.mount(adminLayout({ active: "gestion", title: "Catamaranes", subtitle: `${propios.length} embarcaciones`, actions: headerActions, body: `<div class="panel">${list}</div>` }, ctx));
    wireAdmin(ctx);
  } else {
    const notifs = await D.listNotificaciones();
    const unread = notifs.filter((n) => !n.leida).length;
    U.mount(appShell({
      active: "gestion", rol: p.rol,
      topbarHtml: topbar({ title: "Mis catamaranes", bell: true, unread }),
      bodyHtml: `<div class="section-title">Embarcaciones ${headerActions}</div>${list}`,
    }));
    wireChrome(ctx);
  }

  const cb = byIdMap(cats);
  U.$("[data-nuevo]")?.addEventListener("click", () => catamaranModal(ctx, null));
  U.$$("[data-edit]").forEach((b) => b.addEventListener("click", () => catamaranModal(ctx, cb[b.dataset.edit])));
}

function estadoCatLabel(e) { return ({ activa: "Activa", inactiva: "Inactiva", mantenimiento: "Mantenimiento" }[e] || e); }
function byIdMap(arr) { const m = {}; arr.forEach((x) => (m[x.id] = x)); return m; }

function catamaranModal(ctx, cat) {
  const edit = Boolean(cat);
  U.modal({
    title: edit ? "Editar catamarán" : "Nuevo catamarán",
    body: `
      <div class="field"><label>Nombre</label><input class="input" id="c-nombre" value="${U.esc(cat?.nombre || "")}" placeholder="Don Juan II"/></div>
      <div class="field"><label>Descripción</label><input class="input" id="c-desc" value="${U.esc(cat?.descripcion || "")}" placeholder="Catamarán techado…"/></div>
      <div class="flex gap-12">
        <div class="field grow"><label>Capacidad</label><input class="input" id="c-cap" type="number" min="1" value="${cat?.capacidad || 12}" ${edit ? "disabled" : ""}/></div>
        <div class="field grow"><label>Precio / lugar</label><input class="input" id="c-precio" type="number" min="0" value="${cat?.precio || 8000}"/></div>
      </div>
      <div class="field"><label>N° de habilitación</label><input class="input" id="c-hab" value="${U.esc(cat?.habilitacion || "")}" placeholder="HAB-2024-000"/></div>
      <div class="field"><label>Estado</label>
        <select class="select" id="c-estado">
          ${["activa", "mantenimiento", "inactiva"].map((e) => `<option value="${e}"${cat?.estado === e ? " selected" : ""}>${estadoCatLabel(e)}</option>`).join("")}
        </select>
      </div>
      ${edit ? `<p class="field__hint">La capacidad no se puede cambiar porque define los asientos ya creados.</p>` : ""}
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
          if (!edit && !(Number.isInteger(capacidad) && capacidad >= 1 && capacidad <= 60)) { U.toast("La capacidad debe ser un número entero entre 1 y 60.", "err"); return false; }
          if (!(data.precio >= 0) || U.$("#c-precio").value === "") { U.toast("Ingresá un precio por lugar válido.", "err"); return false; }
          if (!data.habilitacion) { U.toast("Ingresá el número de habilitación municipal.", "err"); return false; }
          try {
            if (edit) await D.updateCatamaran(cat.id, data);
            else await D.crearCatamaran({ ...data, capacidad });
            U.closeModal(); U.toast(edit ? "Catamarán actualizado" : "Catamarán creado", "ok"); ctx.rerender();
          } catch (err) { U.toast(err.message, "err"); return false; }
        },
      },
    ],
  });
}

/* ============================================================================
 *  ESTADO VACÍO
 * ========================================================================== */
function emptyState(titulo, texto, ic = "info") {
  return `<div class="empty">${U.icon(ic, { size: 56, stroke: 1.5 })}<h3>${U.esc(titulo)}</h3><p>${U.esc(texto)}</p></div>`;
}
