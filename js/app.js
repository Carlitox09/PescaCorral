/* =========================================================================
   PescaCorral — App (router + shell + PWA)  →  App global
   Router por hash, elige "chrome" según el rol (mobile vs sidebar),
   protege rutas, pinta badges de notificaciones y administra la PWA.
   ========================================================================= */
(function (global) {
  'use strict';
  const { icon, esc } = UI;
  const S = () => global.Store;
  const root = () => document.getElementById('app');

  let deferredPrompt = null;
  let installDismissed = false;

  /* ---------- navegación de tabs por rol ---------- */
  const PESCADOR_TABS = [
    ['home', 'Inicio', 'home', '#/home'],
    ['catamaranes', 'Reservar', 'ship', '#/catamaranes'],
    ['permisos', 'Permisos', 'ticket', '#/historial/permisos'],
    ['perfil', 'Perfil', 'user', '#/perfil'],
  ];
  const DUENO_TABS = [
    ['home', 'Inicio', 'home', '#/home'],
    ['catamaranes', 'Mi flota', 'ship', '#/mis-catamaranes'],
    ['reservas', 'Reservas', 'calendar', '#/reservas-dueno'],
    ['perfil', 'Perfil', 'user', '#/perfil'],
  ];
  const ADMIN_NAV = [
    ['dashboard', 'Dashboard', 'layout-dashboard', '#/admin'],
    ['catamaranes', 'Catamaranes', 'ship', '#/admin/catamaranes'],
    ['reservas', 'Reservas', 'calendar', '#/admin/reservas'],
    ['permisos', 'Permisos', 'ticket', '#/admin/permisos'],
    ['reportes', 'Reportes', 'bar-chart', '#/admin/reportes'],
    ['usuarios', 'Usuarios', 'users', '#/admin/usuarios'],
    ['fauna', 'Fauna', 'fish', '#/admin/fauna'],
  ];

  /* ---------- parseo del hash ---------- */
  function parseHash() {
    let h = location.hash.replace(/^#\/?/, '');
    let query = {};
    const qi = h.indexOf('?');
    if (qi >= 0) { h.slice(qi + 1).split('&').forEach(kv => { const [k, v] = kv.split('='); if (k) query[decodeURIComponent(k)] = decodeURIComponent(v || ''); }); h = h.slice(0, qi); }
    const parts = h.split('/').filter(Boolean);
    return { parts, query };
  }

  /* ---------- resolución de ruta → vista ---------- */
  function resolve(parts, ctx) {
    const V = global.Views;
    const rol = ctx.user ? ctx.user.rol : null;
    const p0 = parts[0] || '';

    if (p0 === 'login') return V.login();
    if (p0 === 'registro') return V.registro();

    if (p0 === 'admin') {
      const sub = parts[1] || '';
      const map = { '': V.adminDashboard, catamaranes: V.adminCatamaranes, reservas: V.adminReservas, permisos: V.adminPermisos, reportes: V.adminReportes, usuarios: V.adminUsuarios, fauna: V.adminFauna };
      return (map[sub] || V.adminDashboard)(ctx);
    }

    switch (p0) {
      case '':
      case 'home':
        return rol === 'dueno' ? V.duenoHome(ctx) : V.home(ctx);
      case 'catamaranes': return V.catamaranes(ctx);
      case 'reserva': ctx.params.catId = parts[1]; return V.reserva(ctx);
      case 'pago': ctx.params.reservaId = parts[1]; return V.pago(ctx);
      case 'permiso': ctx.params.permisoId = parts[1]; return V.permiso(ctx);
      case 'historial': ctx.params.tab = parts[1] || ''; return V.historial(ctx);
      case 'notificaciones': return V.notificaciones(ctx);
      case 'perfil': return V.perfil(ctx);
      case 'mis-catamaranes': return V.misCatamaranes(ctx);
      case 'reservas-dueno': return V.reservasDueno(ctx);
      default: return V.home(ctx);
    }
  }

  /* ---------- guardias ---------- */
  function guard(parts, user) {
    const p0 = parts[0] || '';
    const isAuthPage = p0 === 'login' || p0 === 'registro';
    if (!user && !isAuthPage) return '#/login';
    if (user && isAuthPage) return S().ROLES[user.rol].kind === 'admin' ? '#/admin' : '#/home';
    if (user) {
      const kind = S().ROLES[user.rol].kind;
      if (p0 === 'admin' && kind !== 'admin') return '#/home';
      if ((p0 === 'mis-catamaranes' || p0 === 'reservas-dueno') && user.rol !== 'dueno') return '#/home';
      if ((p0 === '' || p0 === 'home' || p0 === 'catamaranes' || p0 === 'reserva' || p0 === 'pago' || p0 === 'historial') && kind === 'admin') return '#/admin';
    }
    return null;
  }

  /* ---------- chrome (shells) ---------- */
  function topbar(user) {
    const n = S().noLeidas(user.id);
    return '<header class="topbar">' +
      '<a class="brand" href="#/home"><span class="mark"><img src="icons/icon-192.png" alt=""></span>Pesca<b>Corral</b></a>' +
      '<span class="spacer"></span>' +
      '<div class="top-actions">' +
      '<a class="iconbtn" href="#/notificaciones" aria-label="Notificaciones">' + icon('bell') + (n ? '<span class="badge-dot" id="bell-badge">' + (n > 9 ? '9+' : n) + '</span>' : '') + '</a>' +
      '<a class="avatar" href="#/perfil" aria-label="Perfil">' + esc(S().initials(user.nombre)) + '</a>' +
      '</div></header>';
  }
  function tabbar(items, active) {
    return '<nav class="tabbar">' + items.map(([key, label, ic, href]) =>
      '<a href="' + href + '"' + (key === active ? ' class="active"' : '') + '>' + icon(ic) + '<span>' + esc(label) + '</span></a>').join('') + '</nav>';
  }
  function sidebar(user, active) {
    const r = S().ROLES[user.rol];
    return '<aside class="sidebar">' +
      '<div class="side-brand"><span class="mark"><img src="icons/icon-192.png" alt=""></span>Pesca<b style="color:var(--sun-500)">Corral</b></div>' +
      '<nav class="side-nav">' + ADMIN_NAV.map(([key, label, ic, href]) =>
        '<a href="' + href + '"' + (key === active ? ' class="active"' : '') + '>' + icon(ic) + esc(label) + '</a>').join('') + '</nav>' +
      '<div class="side-foot"><div class="su"><div class="avatar">' + esc(S().initials(user.nombre)) + '</div>' +
      '<div><div style="color:#fff;font-weight:700;font-size:.82rem">' + esc(user.nombre) + '</div><div>' + esc(r.short) + '</div></div></div>' +
      '<button class="btn btn-translucent btn-sm btn-block mt-1" id="side-logout">' + icon('log-out') + 'Salir</button></div>' +
      '</aside>';
  }

  function banners() {
    let b = '';
    if (!navigator.onLine) b += '<div class="banner banner-offline">' + icon('wifi-off') + '<span>Estás sin conexión. La app sigue funcionando con los datos guardados.</span></div>';
    if (deferredPrompt && !installDismissed) b += '<div class="banner banner-install" id="install-banner">' + icon('download') + '<span>Instalá PescaCorral en tu dispositivo.</span>' +
      '<button class="btn btn-soft btn-sm" id="btn-install">Instalar</button><span class="x" id="install-x">' + icon('x') + '</span></div>';
    return b;
  }

  /* ---------- render principal ---------- */
  function render() {
    const { parts, query } = parseHash();
    const user = S().getSession();
    const redirect = guard(parts, user);
    if (redirect) { if (location.hash !== redirect) { location.hash = redirect; return; } }

    const ctx = { user, params: {}, query };
    const view = resolve(parts, ctx);
    const chrome = view.chrome || 'none';
    const app = root();

    document.body.classList.remove('app-mobile', 'admin');

    if (chrome === 'none') {
      app.innerHTML = view.html;
    } else if (chrome === 'admin') {
      document.body.classList.add('admin');
      app.innerHTML = sidebar(user, view.tab) +
        '<main class="content">' + banners() + view.html + '</main>';
    } else { // mobile
      document.body.classList.add('app-mobile');
      const tabs = user && user.rol === 'dueno' ? DUENO_TABS : PESCADOR_TABS;
      app.innerHTML = topbar(user) +
        '<main class="content">' + banners() + view.html + '</main>' +
        tabbar(tabs, view.tab);
    }

    // montaje específico de la vista
    if (typeof view.mount === 'function') view.mount(app);
    wireChrome(app);
    window.scrollTo(0, 0);
  }

  function wireChrome(app) {
    const sl = app.querySelector('#side-logout');
    if (sl) sl.addEventListener('click', async () => {
      if (await UI.confirm({ title: 'Cerrar sesión', message: '¿Salir del panel?', ok: 'Salir', danger: true })) { S().logout(); UI.toast('Sesión cerrada', 'info'); location.hash = '#/login'; }
    });
    const bi = app.querySelector('#btn-install');
    if (bi) bi.addEventListener('click', doInstall);
    const ix = app.querySelector('#install-x');
    if (ix) ix.addEventListener('click', () => { installDismissed = true; const el = app.querySelector('#install-banner'); if (el) el.remove(); });
  }

  function refreshBadges() {
    const user = S().getSession(); if (!user) return;
    const n = S().noLeidas(user.id);
    const badge = document.getElementById('bell-badge');
    if (badge && !n) badge.remove();
    else if (badge) badge.textContent = n > 9 ? '9+' : n;
  }

  /* ---------- PWA: instalación ---------- */
  function doInstall() {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    deferredPrompt.userChoice.finally(() => { deferredPrompt = null; const el = document.getElementById('install-banner'); if (el) el.remove(); });
  }
  window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); deferredPrompt = e; const u = S().getSession(); if (u) render(); });
  window.addEventListener('appinstalled', () => { deferredPrompt = null; UI.toast('¡App instalada!', 'ok'); });

  /* ---------- conexión ---------- */
  window.addEventListener('online', () => { UI.toast('Conexión restablecida', 'ok'); render(); });
  window.addEventListener('offline', () => { UI.toast('Sin conexión', 'info'); render(); });

  /* ---------- service worker ---------- */
  function registerSW() {
    if ('serviceWorker' in navigator && location.protocol !== 'file:') {
      navigator.serviceWorker.register('service-worker.js').catch(() => {});
    }
  }

  /* ---------- arranque ---------- */
  window.addEventListener('hashchange', render);
  document.addEventListener('DOMContentLoaded', () => {
    if (!location.hash) {
      const u = S().getSession();
      location.hash = u ? (S().ROLES[u.rol].kind === 'admin' ? '#/admin' : '#/home') : '#/login';
    }
    render();
    registerSW();
  });

  global.App = { render, refreshBadges, nav: h => { location.hash = h; } };
})(window);
