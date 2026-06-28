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
  U.$("[data-logout]")?.addEventListener("click", async () => { await D.signOut(); ctx.go("/login"); });
}

/* ============================================================================
 *  AUTENTICACIÓN
 * ========================================================================== */
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
        <h2>Iniciar sesión</h2>
        <p class="sub">Ingresá con tu cuenta para reservar y gestionar tus permisos.</p>
        <form id="f-login" novalidate>
          <div class="field">
            <label for="email">Email</label>
            <input class="input" id="email" type="email" autocomplete="email" placeholder="tu@email.com" required />
          </div>
          <div class="field">
            <label for="pwd">Contraseña</label>
            <div class="input-group">
              <input class="input" id="pwd" type="password" autocomplete="current-password" placeholder="Tu contraseña" required />
              <button type="button" class="input-group__btn" data-toggle-pwd aria-label="Mostrar">${U.icon("eye", { size: 20 })}</button>
            </div>
          </div>
          <div class="field__error hide" id="login-err"></div>
          <button class="btn btn--primary btn--block btn--lg" type="submit" id="login-btn">Ingresar</button>
        </form>
      </div>
      ${demo ? `<div class="auth__demo">
        <b>Modo demo.</b> Probá con cuentas de ejemplo (contraseña <b>Demo1234!</b>):<br>
        pescador@demo.com · dueno@demo.com · municipio@demo.com · admin@demo.com
      </div>` : ""}
    </div>
    <div class="auth__foot">¿No tenés cuenta? <a href="#/registro">Registrate</a></div>
  </div>`);

  togglePwd();
  if (demo) U.$("#email").value = "pescador@demo.com";

  U.$("#f-login").addEventListener("submit", async (e) => {
    e.preventDefault();
    const email = U.$("#email").value.trim();
    const pwd = U.$("#pwd").value;
    const errBox = U.$("#login-err");
    errBox.classList.add("hide");
    if (!email || !pwd) { showErr(errBox, "Completá email y contraseña."); return; }
    const btn = U.$("#login-btn"); btn.disabled = true; btn.textContent = "Ingresando…";
    try {
      await D.signIn(email, pwd);
      const s = await D.getSession();
      ctx.go(isAdmin(s?.profile?.rol) ? "/admin" : "/home");
    } catch (err) {
      showErr(errBox, err.message);
      btn.disabled = false; btn.textContent = "Ingresar";
    }
  });
}

export async function viewRegistro(ctx) {
  const especies = []; // no necesario aquí
  U.mount(`<div class="auth">
    <div class="auth__head" style="clip-path:polygon(0 0,100% 0,100% 86%,0 100%);padding-bottom:54px">
      <span class="logo">${U.logoMark(48)}</span>
      <h1>Crear cuenta</h1>
      <p>Sumate a PescaCorral en pocos pasos.</p>
    </div>
    <div class="auth__card-wrap">
      <div class="auth__card">
        <h2>Datos personales</h2>
        <p class="sub">Tus datos quedan protegidos y se usan sólo para tus reservas y permisos.</p>
        <form id="f-reg" novalidate>
          <div class="flex gap-12">
            <div class="field grow"><label>Nombre</label><input class="input" id="r-nombre" required placeholder="Carlos"/></div>
            <div class="field grow"><label>Apellido</label><input class="input" id="r-apellido" placeholder="Romero"/></div>
          </div>
          <div class="field"><label>Email</label><input class="input" id="r-email" type="email" autocomplete="email" required placeholder="tu@email.com"/></div>
          <div class="flex gap-12">
            <div class="field grow"><label>Teléfono</label><input class="input" id="r-tel" placeholder="+54 387 …"/></div>
            <div class="field grow"><label>DNI</label><input class="input" id="r-dni" placeholder="24.356.789"/></div>
          </div>
          <div class="field">
            <label>Tipo de cuenta</label>
            <select class="select" id="r-rol">
              <option value="pescador">Pescador / Turista</option>
              <option value="dueno">Dueño de catamarán</option>
            </select>
          </div>
          <div class="field">
            <label>Contraseña</label>
            <div class="input-group">
              <input class="input" id="r-pwd" type="password" autocomplete="new-password" required placeholder="Creá una contraseña segura"/>
              <button type="button" class="input-group__btn" data-toggle-pwd aria-label="Mostrar">${U.icon("eye", { size: 20 })}</button>
            </div>
            <div class="pwd-meter" id="pwd-meter">${"<span></span>".repeat(5)}</div>
            <ul class="pwd-rules" id="pwd-rules"></ul>
          </div>
          <div class="field">
            <label>Repetir contraseña</label>
            <input class="input" id="r-pwd2" type="password" autocomplete="new-password" required placeholder="Repetí la contraseña"/>
            <div class="field__error hide" id="pwd2-err">Las contraseñas no coinciden.</div>
          </div>
          <div class="field__error hide" id="reg-err"></div>
          <button class="btn btn--primary btn--block btn--lg" type="submit" id="reg-btn">Crear cuenta</button>
        </form>
      </div>
    </div>
    <div class="auth__foot">¿Ya tenés cuenta? <a href="#/login">Iniciá sesión</a></div>
  </div>`);

  togglePwd();
  const pwd = U.$("#r-pwd");
  const renderRules = () => {
    const st = U.passwordStrength(pwd.value);
    const meter = U.$$("#pwd-meter span");
    const colors = ["#e6ebf3", "#ef4444", "#f59e0b", "#f59e0b", "#22c55e", "#16a34a"];
    meter.forEach((s, i) => { s.style.background = i < st.score ? colors[st.score] : "var(--border)"; });
    U.$("#pwd-rules").innerHTML = st.rules.map((r) =>
      `<li class="${r.ok ? "ok" : ""}"><span class="tick">${r.ok ? "✓" : ""}</span>${r.label}</li>`
    ).join("");
  };
  renderRules();
  pwd.addEventListener("input", renderRules);

  U.$("#f-reg").addEventListener("submit", async (e) => {
    e.preventDefault();
    const v = (id) => U.$(id).value.trim();
    const nombre = v("#r-nombre"), email = v("#r-email"), pass = U.$("#r-pwd").value, pass2 = U.$("#r-pwd2").value;
    const errBox = U.$("#reg-err"); errBox.classList.add("hide");
    const st = U.passwordStrength(pass);
    if (!nombre || !email) { showErr(errBox, "Completá nombre y email."); return; }
    if (!st.valid) { showErr(errBox, "La contraseña no cumple todos los requisitos de seguridad."); return; }
    if (pass !== pass2) { U.$("#pwd2-err").classList.remove("hide"); return; }
    U.$("#pwd2-err").classList.add("hide");
    const btn = U.$("#reg-btn"); btn.disabled = true; btn.textContent = "Creando…";
    try {
      await D.signUp({ nombre, apellido: v("#r-apellido"), email, telefono: v("#r-tel"), dni: v("#r-dni"), rol: U.$("#r-rol").value, password: pass });
      const s = await D.getSession();
      if (s) { U.toast("¡Cuenta creada!", "ok"); ctx.go(isAdmin(s.profile.rol) ? "/admin" : "/home"); }
      else { U.toast("Revisá tu email para confirmar la cuenta.", "info"); ctx.go("/login"); }
    } catch (err) {
      showErr(errBox, err.message); btn.disabled = false; btn.textContent = "Crear cuenta";
    }
  });
}

function togglePwd() {
  U.$$("[data-toggle-pwd]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const input = btn.parentElement.querySelector("input");
      const show = input.type === "password";
      input.type = show ? "text" : "password";
      btn.innerHTML = U.icon(show ? "eye-off" : "eye", { size: 20 });
    });
  });
}
function showErr(box, msg) { box.textContent = msg; box.classList.remove("hide"); }

/* ============================================================================
 *  HOME
 * ========================================================================== */
export async function viewHome(ctx) {
  const p = ctx.session.profile;
  const [reservas, permisos, notifs, cats] = await Promise.all([
    D.listReservas(), D.listPermisos(), D.listNotificaciones(), D.listCatamaranes(),
  ]);
  const unread = notifs.filter((n) => !n.leida).length;
  const hoy = U.todayISO();
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

      <h2 class="section-title mt-24">Catamaranes disponibles <a class="muted-link" href="#/catamaranes">Ver todos</a></h2>
      ${disponibles.map((c) => boatCard(c)).join("") || `<p class="muted">No hay catamaranes disponibles.</p>`}
    `,
  }));
  wireChrome(ctx);
  wireBoatCards(ctx);
}

/* ============================================================================
 *  CATAMARANES
 * ========================================================================== */
export async function viewCatamaranes(ctx) {
  const p = ctx.session.profile;
  const [cats, notifs] = await Promise.all([D.listCatamaranes(), D.listNotificaciones()]);
  const unread = notifs.filter((n) => !n.leida).length;
  const fecha = ctx.params.fecha || U.todayISO();
  const turno = ctx.params.turno || "manana";

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
  wireBoatCards(ctx);

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
  return `<div class="boat" style="margin-bottom:12px">
    <div class="boat__img" style="color:#0c4a72">${U.icon("boat", { size: 46, stroke: 1.6 })}</div>
    <div class="boat__main">
      <h3>${U.esc(c.nombre)}</h3>
      <div class="boat__meta">${U.icon("users", { size: 13 })} ${c.capacidad} lugares ${c.habilitacion ? "· Hab. " + U.esc(c.habilitacion) : ""}</div>
      <div class="boat__price">${U.fmtMoney(c.precio)} <small>/ lugar</small></div>
    </div>
    <div style="align-self:stretch;display:flex;flex-direction:column;justify-content:center">
      ${mantenimiento
        ? `<span class="badge badge--warn">${U.icon("settings", { size: 13 })} Mantenimiento</span>`
        : `<a class="btn btn--cta btn--sm" href="#/reserva/${c.id}${qs}">Reservar</a>`}
    </div>
  </div>`;
}
function wireBoatCards() { /* navegación por href; sin JS extra */ }

/* ============================================================================
 *  RESERVA DE LUGARES
 * ========================================================================== */
export async function viewReserva(ctx) {
  const p = ctx.session.profile;
  const catId = ctx.params.id;
  let fecha = ctx.params.fecha || U.todayISO();
  let turno = ctx.params.turno || "manana";

  const [cat, lugares, especies] = await Promise.all([
    D.getCatamaran(catId), D.getLugares(catId), D.listEspecies(),
  ]);
  if (!cat) { U.mount(appShell({ active: null, rol: p.rol, topbarHtml: topbar({ title: "Reservar", back: true, bell: false }), bodyHtml: emptyState("Catamarán no encontrado", "Volvé a la lista de catamaranes.", "boat") })); wireChrome(ctx); return; }

  const seleccion = new Set();
  let ocupados = new Set(await D.getOcupacion(catId, fecha));

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
          <div class="boat__img" style="width:54px;height:54px;color:#0c4a72">${U.icon("boat", { size: 30, stroke: 1.6 })}</div>
        </div>
        <div class="filters mt-12">
          <input class="input" type="date" id="r-fecha" value="${fecha}" min="${U.todayISO()}"/>
          <select class="select turno" id="r-turno">
            <option value="manana"${turno === "manana" ? " selected" : ""}>Mañana</option>
            <option value="tarde"${turno === "tarde" ? " selected" : ""}>Tarde</option>
          </select>
        </div>
      </div>

      <h2 class="section-title mt-16">Elegí tus lugares</h2>
      <div class="seatmap" id="seatmap">${seatGrid(lugares, ocupados, seleccion)}</div>
      <div class="seat-legend">
        <span><i class="lg-free"></i>Libre</span>
        <span><i class="lg-sel"></i>Elegido</span>
        <span><i class="lg-occ"></i>Ocupado</span>
      </div>

      <h2 class="section-title mt-16">Permiso y pago</h2>
      <div class="card card--flat">
        <div class="field"><label>Especie a pescar</label>
          <select class="select" id="r-especie">${especies.map((e) => `<option value="${e.id}">${U.esc(e.nombre)}</option>`).join("")}</select>
        </div>
        <div class="flex gap-12">
          <div class="field grow"><label>Tipo de permiso</label>
            <select class="select" id="r-tipo">
              <option value="diario">Diario</option><option value="semanal">Semanal</option><option value="anual">Anual</option>
            </select>
          </div>
          <div class="field grow"><label>Medio de pago</label>
            <select class="select" id="r-metodo">
              <option value="tarjeta">Tarjeta</option><option value="transferencia">Transferencia</option>
              <option value="mercadopago">Mercado Pago</option><option value="efectivo">Efectivo</option>
            </select>
          </div>
        </div>
      </div>

      <div class="summary mt-16" id="summary"></div>
      <button class="btn btn--cta btn--block btn--lg mt-16" id="confirm-btn" disabled>
        ${U.icon("check-circle", { size: 20 })} Confirmar reserva y pago
      </button>
      <p class="muted center mt-8" style="font-size:.78rem">El pago es simulado en esta demostración.</p>
    `,
  }));
  wireChrome(ctx);

  const summaryEl = U.$("#summary");
  const confirmBtn = U.$("#confirm-btn");
  const refreshSummary = () => {
    const n = seleccion.size;
    const total = n * cat.precio;
    summaryEl.innerHTML = `
      <div class="flex between"><span>Lugares seleccionados</span><b>${n}</b></div>
      <div class="flex between mt-8"><span>Precio por lugar</span><b>${U.fmtMoney(cat.precio)}</b></div>
      <div class="flex between mt-8 total"><span><b>Total a pagar</b></span><b>${U.fmtMoney(total)}</b></div>
      ${n ? `<div class="muted mt-8" style="font-size:.8rem">Lugares: ${[...seleccion].map((id) => lugares.find((l) => l.id === id).numero).sort((a, b) => a - b).join(", ")}</div>` : ""}`;
    confirmBtn.disabled = n === 0;
  };
  refreshSummary();

  U.$("#seatmap").addEventListener("click", (e) => {
    const btn = e.target.closest(".seat");
    if (!btn || btn.classList.contains("seat--occupied")) return;
    const id = btn.dataset.lugar;
    if (seleccion.has(id)) { seleccion.delete(id); btn.classList.remove("seat--selected"); }
    else { seleccion.add(id); btn.classList.add("seat--selected"); }
    refreshSummary();
  });

  const reloadSeats = async () => {
    fecha = U.$("#r-fecha").value || U.todayISO();
    turno = U.$("#r-turno").value;
    seleccion.clear();
    ocupados = new Set(await D.getOcupacion(catId, fecha));
    U.$("#seatmap").innerHTML = seatGrid(lugares, ocupados, seleccion);
    refreshSummary();
  };
  U.$("#r-fecha").addEventListener("change", reloadSeats);
  U.$("#r-turno").addEventListener("change", () => { turno = U.$("#r-turno").value; });

  confirmBtn.addEventListener("click", async () => {
    if (!seleccion.size) return;
    confirmBtn.disabled = true; confirmBtn.innerHTML = "Procesando…";
    try {
      const res = await D.crearReserva({
        catamaranId: catId, fecha, turno,
        lugares: [...seleccion],
        metodo: U.$("#r-metodo").value,
        tipoPermiso: U.$("#r-tipo").value,
        especieId: U.$("#r-especie").value,
      });
      U.toast("Reserva confirmada · " + res.numero_permiso, "ok");
      ctx.go("/permiso/" + res.permiso_id);
    } catch (err) {
      U.toast(err.message || "No se pudo completar la reserva.", "err");
      confirmBtn.disabled = false;
      confirmBtn.innerHTML = `${U.icon("check-circle", { size: 20 })} Confirmar reserva y pago`;
      await reloadSeats();
    }
  });
}

function seatGrid(lugares, ocupados, seleccion) {
  return lugares.map((l) => {
    const occ = ocupados.has(l.id);
    const sel = seleccion.has(l.id);
    const cls = occ ? "seat seat--occupied" : sel ? "seat seat--selected" : "seat";
    return `<button class="${cls}" data-lugar="${l.id}" ${occ ? "disabled" : ""} title="Lugar ${l.numero} · ${U.esc(l.ubicacion || "")}">${l.numero}</button>`;
  }).join("");
}

/* ============================================================================
 *  PERMISO DIGITAL
 * ========================================================================== */
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
        </div>
        <div class="permit__actions stack">
          <button class="btn btn--primary btn--block" data-print>${U.icon("download", { size: 18 })} Descargar PDF</button>
          <button class="btn btn--soft btn--block" data-share>${U.icon("share", { size: 18 })} Compartir</button>
        </div>
      </div>
      <p class="muted center mt-12" style="font-size:.8rem">${U.icon("shield", { size: 14 })} Presentá este permiso al personal de control. El código QR permite validar su autenticidad.</p>
    `,
  }));
  wireChrome(ctx);

  U.$("[data-print]")?.addEventListener("click", () => window.print());
  U.$("[data-share]")?.addEventListener("click", async () => {
    const txt = `Permiso de pesca ${permiso.numero} · ${permiso.titular_nombre} · ${CFG.MUNICIPIO || "Municipio de Coronel Moldes"}`;
    if (navigator.share) { try { await navigator.share({ title: "Permiso PescaCorral", text: txt }); } catch {} }
    else if (navigator.clipboard) { await navigator.clipboard.writeText(txt); U.toast("Datos copiados al portapapeles", "ok"); }
    else U.toast("Compartir no disponible en este dispositivo", "info");
  });
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
    return `<div class="row-item">
      <div class="row-item__ic">${U.icon("boat", { size: 20 })}</div>
      <div class="row-item__main">
        <h4>${U.esc(r.catamaran_nombre)}</h4>
        <small>${U.fmtDate(r.fecha)} · ${U.turnoLabel(r.turno)} · ${r.cantidad_lugares} lugar${r.cantidad_lugares > 1 ? "es" : ""} · ${U.fmtMoney(r.monto_total)}</small>
      </div>
      <div style="display:flex;flex-direction:column;gap:6px;align-items:flex-end">
        <span class="badge ${b.cls}">${b.label}</span>
        <div class="flex gap-8">
          ${r.permiso_id ? `<a class="btn btn--soft btn--sm" href="#/permiso/${r.permiso_id}">Permiso</a>` : ""}
          ${cancelable ? `<button class="btn btn--danger btn--sm" data-anular="${r.id}">Anular</button>` : ""}
        </div>
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
  const notifs = await D.listNotificaciones();
  const unread = notifs.filter((n) => !n.leida).length;

  U.mount(appShell({
    active: "perfil", rol: p.rol,
    topbarHtml: topbar({ title: "Perfil", bell: true, unread }),
    bodyHtml: `
      <div class="profile-hero">
        <div class="avatar">${U.initials(p.nombre, p.apellido)}</div>
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

      <h2 class="section-title mt-24">Cuenta</h2>
      <div class="card card--flat">
        <div class="permit__row"><span>Modo de datos</span><b>${D.MODE === "demo" ? "Demostración (local)" : "Supabase (en la nube)"}</b></div>
        ${D.MODE === "demo" ? `<button class="btn btn--soft btn--block mt-12" data-reset>${U.icon("refresh", { size: 18 })} Reiniciar datos de demo</button>` : ""}
      </div>

      <button class="btn btn--danger btn--block mt-16" data-logout>${U.icon("logout", { size: 18 })} Cerrar sesión</button>
      <p class="muted center mt-16" style="font-size:.78rem">PescaCorral · ${U.esc(CFG.MUNICIPIO || "Municipio de Coronel Moldes")}</p>
    `,
  }));
  wireChrome(ctx);

  U.$("#f-perfil").addEventListener("submit", async (e) => {
    e.preventDefault();
    try {
      await D.updateProfile({ nombre: U.$("#pf-nombre").value.trim(), apellido: U.$("#pf-apellido").value.trim(), telefono: U.$("#pf-tel").value.trim(), dni: U.$("#pf-dni").value.trim() });
      U.toast("Perfil actualizado", "ok");
      ctx.rerender();
    } catch (err) { U.toast(err.message, "err"); }
  });
  U.$("[data-reset]")?.addEventListener("click", async () => {
    const ok = await U.confirmDialog({ title: "Reiniciar demo", message: "Se restauran los datos de ejemplo y se cierra la sesión. ¿Continuar?", okLabel: "Reiniciar" });
    if (!ok) return;
    await D.resetDemo(); U.toast("Datos de demo restaurados", "ok"); ctx.go("/login");
  });
  U.$("[data-logout]")?.addEventListener("click", async () => { await D.signOut(); ctx.go("/login"); });
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
  const [resumen, porDia, porEspecie, ocupacion, ultimos] = await Promise.all([
    D.dashboardResumen(), D.reservasPorDia({ from: U.addDaysISO(U.todayISO(), -13), to: U.todayISO() }),
    D.permisosPorEspecie(), D.ocupacionCatamaranes(), D.ultimosPermisos(6),
  ]);

  // Serie de 14 días (rellena ceros)
  const dias = [];
  for (let i = 13; i >= 0; i--) {
    const iso = U.addDaysISO(U.todayISO(), -i);
    const row = porDia.find((d) => d.fecha === iso);
    dias.push({ label: iso.slice(8), value: row ? Number(row.cantidad_reservas) : 0 });
  }
  const especieData = porEspecie.filter((e) => e.permisos_emitidos > 0).map((e, i) => ({ label: e.especie, value: Number(e.permisos_emitidos), color: CHART_COLORS[i % CHART_COLORS.length] }));

  U.mount(adminLayout({
    active: "panel",
    title: "Panel municipal",
    subtitle: `${CFG.MUNICIPIO || "Municipio de Coronel Moldes"} · ${CFG.LUGAR || "Dique Cabra Corral"}`,
    actions: `<span class="daterange">${U.icon("calendar", { size: 15 })} Últimos 30 días</span>`,
    body: `
      <div class="kpis">
        ${kpi("Reservas hoy", resumen.reservas_hoy, "+ activas", "up")}
        ${kpi("Permisos vigentes", resumen.permisos_vigentes, `${resumen.permisos_total} emitidos`, "up")}
        ${kpi("Ingresos totales", U.fmtMoney(resumen.ingresos_total), "acumulado", "up")}
      </div>
      <div class="grid-2">
        <div class="panel">
          <h3>Reservas por día (últimos 14)</h3>
          ${barChart(dias, { height: 230, color: "#1b5fc4" })}
        </div>
        <div class="panel">
          <h3>Permisos por especie</h3>
          ${donutChart(especieData, { centerTop: String(resumen.permisos_total), centerSub: "permisos" })}
        </div>
      </div>
      <div class="grid-2">
        <div class="panel">
          <h3>Ocupación por catamarán</h3>
          <table class="table">
            <thead><tr><th>Catamarán</th><th>Ocupación</th><th style="text-align:right">Lugares</th></tr></thead>
            <tbody>${ocupacion.map((o) => {
              const pct = o.capacidad ? Math.round((o.lugares_ocupados / o.capacidad) * 100) : 0;
              return `<tr><td>${U.esc(o.nombre)}</td>
                <td style="min-width:120px">${progressBar(o.lugares_ocupados, o.capacidad)}</td>
                <td style="text-align:right">${o.lugares_ocupados}/${o.capacidad}</td></tr>`;
            }).join("")}</tbody>
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
  const [resumen, porDiaAll, porEspecie, alertas] = await Promise.all([
    D.dashboardResumen(), D.reservasPorDia({}), D.permisosPorEspecie(), D.alertasFauna(),
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
              <button class="btn btn--primary btn--sm" data-pdf>${U.icon("file-text", { size: 16 })} PDF</button>`,
    body: `
      <div class="kpis">
        ${kpi("Reservas totales", resumen.reservas_total, "histórico", "up")}
        ${kpi("Ingresos totales", U.fmtMoney(resumen.ingresos_total), "acumulado", "up")}
        ${kpi("Alertas de fauna", resumen.alertas_activas, "activas", resumen.alertas_activas ? "down" : "up")}
      </div>
      <div class="grid-2">
        <div class="panel">
          <h3>Evolución mensual de reservas</h3>
          ${barChart(mesData, { height: 230, color: "#14a89a" })}
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
        <p class="panel__foot">El umbral de permisos por especie se configura según los estudios de la dirección de fauna.</p>
      </div>
    `,
  }, ctx));
  wireAdmin(ctx);

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
  const yo = ctx.session.profile.id;
  const roles = ["pescador", "dueno", "admin_municipal", "admin_sistema"];

  U.mount(adminLayout({
    active: "usuarios",
    title: "Usuarios",
    subtitle: `${usuarios.length} cuentas registradas`,
    body: `<div class="panel">
      <table class="table">
        <thead><tr><th>Usuario</th><th>Contacto</th><th>DNI</th><th>Rol</th></tr></thead>
        <tbody>${usuarios.map((u) => `<tr>
          <td><b>${U.esc(u.nombre)} ${U.esc(u.apellido || "")}</b></td>
          <td><small class="muted">${U.esc(u.email)}<br>${U.esc(u.telefono || "—")}</small></td>
          <td>${U.esc(u.dni || "—")}</td>
          <td>
            <select class="select" data-rol="${u.id}" style="padding:8px 10px;font-size:.85rem" ${u.id === yo ? "disabled" : ""}>
              ${roles.map((r) => `<option value="${r}"${u.rol === r ? " selected" : ""}>${U.rolLabel(r)}</option>`).join("")}
            </select>
          </td>
        </tr>`).join("")}</tbody>
      </table>
      <p class="panel__foot">No podés cambiar tu propio rol. Los cambios se aplican al instante.</p>
    </div>`,
  }, ctx));
  wireAdmin(ctx);

  U.$$("[data-rol]").forEach((sel) => sel.addEventListener("change", async () => {
    try { await D.setRol(sel.dataset.rol, sel.value); U.toast("Rol actualizado", "ok"); }
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
      <div class="boat__img" style="color:#0c4a72">${U.icon("boat", { size: 46, stroke: 1.6 })}</div>
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
          if (!data.nombre) { U.toast("Poné un nombre", "err"); return false; }
          try {
            if (edit) await D.updateCatamaran(cat.id, data);
            else await D.crearCatamaran({ ...data, capacidad: Number(U.$("#c-cap").value) });
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
