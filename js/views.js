/* =========================================================================
   PescaCorral — Vistas (Views global)
   Cada pantalla es una función que devuelve { html, mount? }.
   `html` es el contenido a inyectar; `mount(root)` engancha eventos.
   El router (app.js) elige el "chrome" (topbar/tabbar o sidebar).
   ========================================================================= */
(function (global) {
  'use strict';
  const { icon, esc, toast, modal, confirm, barChart, donut, barcode, qr } = UI;
  const S = () => global.Store;
  const nav = h => { location.hash = h; };

  /* ---------- helpers compartidos ---------- */
  function estadoChip(estado) {
    const map = {
      vigente: ['chip-green', 'Vigente'], vencido: ['chip-gray', 'Vencido'],
      confirmada: ['chip-green', 'Confirmada'], pendiente_pago: ['chip-amber', 'Pendiente de pago'],
      aprobado: ['chip-green', 'Aprobado'], cancelada: ['chip-red', 'Cancelada'],
    };
    const [c, l] = map[estado] || ['chip-gray', estado];
    return '<span class="chip ' + c + '">' + esc(l) + '</span>';
  }
  function roleChip(rol) {
    const r = S().ROLES[rol] || { short: rol };
    const ic = { pescador: 'user', dueno: 'ship', municipio: 'building', admin: 'shield' }[rol] || 'user';
    return '<span class="chip chip-navy">' + icon(ic) + esc(r.short) + '</span>';
  }
  function field(label, inner, hintOrErr) {
    return '<div class="field"><label>' + esc(label) + '</label>' + inner + (hintOrErr || '') + '</div>';
  }

  /* =======================================================================
     AUTH — Login
     ======================================================================= */
  function login() {
    const demos = [
      ['carlos@pescacorral.com', 'Pescador'],
      ['dueno@pescacorral.com', 'Dueño'],
      ['municipio@pescacorral.com', 'Municipio'],
      ['admin@pescacorral.com', 'Sistema'],
    ];
    const html =
      '<div class="auth">' +
      '<div class="auth-top">' +
      '<div class="auth-logo"><img src="icons/icon-192.png" alt="PescaCorral"></div>' +
      '<h1>PescaCorral</h1><p>Pesca embarcada en Dique Cabra Corral</p>' +
      '</div>' +
      '<div class="auth-body">' +
      '<div class="auth-card">' +
      '<h2>Iniciar sesión</h2><p class="sub">Ingresá con tu cuenta para reservar y gestionar permisos.</p>' +
      '<form id="f-login" novalidate>' +
      field('Correo electrónico',
        '<input class="input" type="email" name="email" autocomplete="username" placeholder="tucorreo@ejemplo.com" required>') +
      field('Contraseña',
        '<div class="input-group"><input class="input" type="password" name="pass" autocomplete="current-password" placeholder="••••••••" required>' +
        '<button class="toggle" type="button" data-toggle aria-label="Mostrar">' + icon('eye') + '</button></div>') +
      '<div class="err" id="login-err" style="display:none"></div>' +
      '<button class="btn btn-blue btn-block btn-lg" type="submit">' + icon('log-in') + 'Ingresar</button>' +
      '</form>' +
      '<div class="auth-switch">¿No tenés cuenta? <a href="#/registro">Crear cuenta</a></div>' +
      '<div class="info-box mt-2">' + icon('info') + '<div><b>Cuentas de prueba</b> — tocá una para autocompletar. Clave única: <span class="mono">Pesca2026!</span><div class="seg mt-1" id="demo-chips" style="grid-template-columns:1fr 1fr">' +
      demos.map(d => '<button type="button" class="btn btn-ghost btn-sm" data-demo="' + d[0] + '">' + esc(d[1]) + '</button>').join('') +
      '</div></div></div>' +
      '</div></div></div>';

    function mount(root) {
      const f = root.querySelector('#f-login');
      const errBox = root.querySelector('#login-err');
      root.querySelector('[data-toggle]').addEventListener('click', e => togglePw(e.currentTarget));
      root.querySelectorAll('[data-demo]').forEach(b => b.addEventListener('click', () => {
        f.email.value = b.getAttribute('data-demo'); f.pass.value = 'Pesca2026!'; f.email.focus();
      }));
      f.addEventListener('submit', e => {
        e.preventDefault();
        errBox.style.display = 'none';
        const r = S().login(f.email.value.trim().toLowerCase(), f.pass.value);
        if (!r.ok) { errBox.textContent = r.error; errBox.style.display = 'block'; return; }
        S().setSession(r.user.id);
        toast('¡Hola de nuevo, ' + r.user.nombre.split(' ')[0] + '!', 'ok');
        nav(S().ROLES[r.user.rol].kind === 'admin' ? '#/admin' : '#/home');
      });
    }
    return { html, mount, chrome: 'none' };
  }

  /* =======================================================================
     AUTH — Registro
     ======================================================================= */
  function registro() {
    const html =
      '<div class="auth">' +
      '<div class="auth-top" style="padding-top:34px">' +
      '<div class="auth-logo"><img src="icons/icon-192.png" alt=""></div>' +
      '<h1>Crear cuenta</h1><p>Sumate a la comunidad de pesca de Cabra Corral</p>' +
      '</div>' +
      '<div class="auth-body">' +
      '<div class="auth-card">' +
      '<form id="f-reg" novalidate>' +
      field('Nombre y apellido', '<input class="input" name="nombre" placeholder="Carlos Romero" required>') +
      field('Correo electrónico', '<input class="input" type="email" name="email" placeholder="tucorreo@ejemplo.com" required>') +
      field('Teléfono', '<input class="input" name="tel" placeholder="+54 387 ..." inputmode="tel">') +
      '<div class="field"><label>¿Cómo vas a usar la app?</label><div class="seg" id="role-seg">' +
      '<label><input type="radio" name="rol" value="pescador" checked><span class="opt">' + icon('user') + '<b>Pescador</b><small>Reservar y pescar</small></span></label>' +
      '<label><input type="radio" name="rol" value="dueno"><span class="opt">' + icon('ship') + '<b>Dueño</b><small>Ofrecer catamarán</small></span></label>' +
      '</div></div>' +
      field('Contraseña',
        '<div class="input-group"><input class="input" type="password" name="pass" autocomplete="new-password" placeholder="Creá una contraseña segura" required>' +
        '<button class="toggle" type="button" data-toggle aria-label="Mostrar">' + icon('eye') + '</button></div>' +
        '<div class="pw-bar"><i id="pw-bar-i"></i></div>' +
        '<div class="pw-rules" id="pw-rules">' +
        ['8+ caracteres', 'Una mayúscula', 'Una minúscula', 'Un número', 'Un símbolo']
          .map((t, i) => '<div class="pw-rule" data-k="' + i + '">' + icon('circle') + '<span>' + t + '</span></div>').join('') +
        '</div>') +
      '<div class="err" id="reg-err" style="display:none"></div>' +
      '<button class="btn btn-primary btn-block btn-lg mt-1" type="submit">' + icon('user-plus') + 'Registrarme</button>' +
      '</form>' +
      '<div class="info-box mt-2">' + icon('shield') + '<span>Tus datos se usan solo para gestionar reservas y permisos. La contraseña debe cumplir la política de seguridad municipal.</span></div>' +
      '<div class="auth-switch">¿Ya tenés cuenta? <a href="#/login">Iniciar sesión</a></div>' +
      '</div></div></div>';

    function mount(root) {
      const f = root.querySelector('#f-reg');
      const bar = root.querySelector('#pw-bar-i');
      const rules = root.querySelectorAll('#pw-rules .pw-rule');
      const errBox = root.querySelector('#reg-err');
      root.querySelector('[data-toggle]').addEventListener('click', e => togglePw(e.currentTarget));
      const colors = ['var(--red-500)', 'var(--red-500)', 'var(--amber-500)', 'var(--amber-500)', 'var(--teal-500)', 'var(--green-500)'];
      f.pass.addEventListener('input', () => {
        const p = S().passwordPolicy(f.pass.value);
        const flags = [p.len, p.upper, p.lower, p.number, p.special];
        rules.forEach((el, i) => {
          el.classList.toggle('ok', flags[i]);
          el.querySelector('svg').outerHTML = icon(flags[i] ? 'check-circle' : 'circle');
        });
        // re-query svg after replace
        bar.style.width = (p.score / 5 * 100) + '%';
        bar.style.background = colors[p.score];
      });
      f.addEventListener('submit', e => {
        e.preventDefault();
        errBox.style.display = 'none';
        const data = { nombre: f.nombre.value.trim(), email: f.email.value.trim().toLowerCase(), tel: f.tel.value.trim(), rol: f.rol.value, pass: f.pass.value };
        const r = S().register(data);
        if (!r.ok) { errBox.textContent = r.error; errBox.style.display = 'block'; return; }
        S().setSession(r.user.id);
        toast('Cuenta creada. ¡Bienvenido!', 'ok');
        nav('#/home');
      });
    }
    return { html, mount, chrome: 'none' };
  }

  function togglePw(btn) {
    const inp = btn.parentNode.querySelector('input');
    const show = inp.type === 'password';
    inp.type = show ? 'text' : 'password';
    btn.innerHTML = icon(show ? 'eye-off' : 'eye');
  }

  /* =======================================================================
     PESCADOR — Home
     ======================================================================= */
  function home(ctx) {
    const u = ctx.user;
    const cats = S().catamaranes();
    const próxima = S().reservasDe(u.id).filter(r => r.fecha >= S().todayISO()).sort((a, b) => a.fecha.localeCompare(b.fecha))[0];
    const permisoActivo = S().permisosDe(u.id).find(p => p.estado === 'vigente');

    let proxCard = '';
    if (próxima) {
      const cat = S().catamaran(próxima.catamaranId);
      proxCard =
        '<div class="section-title"><h3>Tu próxima salida</h3></div>' +
        '<div class="card card-pad" style="background:var(--grad-brand);color:#fff;border:0">' +
        '<div class="flex justify-between items-center"><div>' +
        '<div class="micro" style="color:#CFF3ED;letter-spacing:.1em">' + esc(S().fmtDateLong(próxima.fecha)).toUpperCase() + '</div>' +
        '<b style="font-size:1.1rem;font-family:var(--f-display)">' + esc(cat.nombre) + '</b>' +
        '<div style="font-size:.82rem;color:#D9F4EF;margin-top:2px">' + icon('clock') + ' ' + esc(próxima.horario) + ' · ' + icon('users') + ' ' + próxima.lugares.length + ' lugar' + (próxima.lugares.length > 1 ? 'es' : '') + '</div>' +
        '</div>' + (permisoActivo ? '<a class="btn btn-translucent btn-sm" href="#/permiso/' + permisoActivo.id + '">Ver permiso</a>' : '') +
        '</div></div>';
    }

    const html =
      '<div class="hero">' +
      '<span class="place">' + icon('map-pin') + 'Dique Cabra Corral · Salta</span>' +
      '<h1>Viví la mejor experiencia de pesca embarcada</h1>' +
      '<p>Reservá tu lugar, pagá online y llevá tu permiso digital siempre con vos.</p>' +
      '<div class="hero-actions">' +
      '<a class="btn btn-translucent" href="#/catamaranes">' + icon('ship') + 'Reservar ahora</a>' +
      '<a class="btn btn-soft" href="#/historial/permisos">' + icon('ticket') + 'Mis permisos</a>' +
      '</div></div>' +

      (proxCard) +

      '<div class="section-title"><h3>Accesos rápidos</h3></div>' +
      '<div class="qa-grid">' +
      '<a class="qa qa-teal" href="#/catamaranes"><div class="ico">' + icon('ship') + '</div><strong>Catamaranes</strong><span>Ver disponibilidad</span></a>' +
      '<a class="qa qa-amber" href="#/historial/permisos"><div class="ico">' + icon('ticket') + '</div><strong>Permisos</strong><span>Tu permiso digital</span></a>' +
      '<a class="qa qa-red" href="#/historial"><div class="ico">' + icon('calendar') + '</div><strong>Reservas</strong><span>Historial y estado</span></a>' +
      '<a class="qa qa-blue" href="#/perfil"><div class="ico">' + icon('user') + '</div><strong>Perfil</strong><span>Tus datos</span></a>' +
      '</div>' +

      '<div class="section-title"><h3>Catamaranes disponibles</h3><a class="link" href="#/catamaranes">Ver todos</a></div>' +
      cats.slice(0, 3).map(c => boatCard(c, S().todayISO())).join('');

    return { html, chrome: 'mobile', tab: 'home' };
  }

  function boatCard(c, fecha) {
    const disp = S().disponibles(c.id, fecha, c.horario);
    const full = disp <= 0;
    return '<a class="boat' + (full ? ' full' : '') + '" href="#/reserva/' + c.id + '">' +
      '<div class="thumb">' + icon('ship') + '</div>' +
      '<div class="info"><b>' + esc(c.nombre) + '</b>' +
      '<div class="meta">' +
      '<span>' + icon('users') + esc(c.capacidad) + ' lugares</span>' +
      '<span>' + icon('clock') + esc(c.horario) + '</span>' +
      '<span>' + icon('map-pin') + esc(c.zona) + '</span>' +
      '</div>' +
      '<div class="meta mt-0" style="margin-top:5px">' + (full
        ? '<span class="chip chip-red">' + icon('x') + 'Completo</span>'
        : '<span class="chip chip-green">' + icon('check') + disp + ' disponibles</span>') + '</div>' +
      '</div>' +
      '<div class="right"><div class="price">' + S().fmtMoney(c.precio) + '<small>por lugar</small></div>' +
      '<span class="btn btn-soft btn-sm">Ver' + icon('chevron-right') + '</span></div>' +
      '</a>';
  }

  /* =======================================================================
     PESCADOR — Catamaranes (lista + filtros)
     ======================================================================= */
  function catamaranes(ctx) {
    const hoy = S().todayISO();
    const html =
      '<div class="page-head" style="margin-bottom:12px"><div class="pt"><h1 style="font-size:1.4rem">Catamaranes</h1><p>Elegí fecha y horario para ver lugares disponibles.</p></div></div>' +
      '<div class="filter-bar">' +
      '<div class="fld">' + icon('calendar') + '<input type="date" id="f-fecha" value="' + hoy + '" min="' + hoy + '"></div>' +
      '<div class="fld">' + icon('map-pin') + '<select id="f-zona"><option value="">Todas las zonas</option>' +
      S().ZONAS.map(z => '<option>' + esc(z) + '</option>').join('') + '</select></div>' +
      '</div>' +
      '<div id="boat-list" class="list"></div>';

    function mount(root) {
      const fecha = root.querySelector('#f-fecha');
      const zona = root.querySelector('#f-zona');
      const list = root.querySelector('#boat-list');
      function paint() {
        let cats = S().catamaranes();
        if (zona.value) cats = cats.filter(c => c.zona === zona.value);
        list.innerHTML = cats.length ? cats.map(c => boatCard(c, fecha.value || hoy)).join('')
          : emptyState('search', 'Sin resultados', 'No hay catamaranes en esa zona. Probá con otra.');
      }
      fecha.addEventListener('change', paint);
      zona.addEventListener('change', paint);
      paint();
    }
    return { html, mount, chrome: 'mobile', tab: 'catamaranes' };
  }

  function emptyState(ic, title, msg) {
    return '<div class="empty"><div class="ico">' + icon(ic) + '</div><h3>' + esc(title) + '</h3><p>' + esc(msg) + '</p></div>';
  }

  /* =======================================================================
     PESCADOR — Reserva (mapa de lugares)
     ======================================================================= */
  function reserva(ctx) {
    const cat = S().catamaran(ctx.params.catId);
    if (!cat) return notFound('Catamarán no encontrado');
    const fecha = ctx.query.fecha || S().todayISO();
    const horario = cat.horario;
    const ocupados = S().asientosOcupados(cat.id, fecha, horario);

    let grid = '';
    for (let i = 1; i <= cat.capacidad; i++) {
      const taken = ocupados.has(i);
      grid += '<button class="seat ' + (taken ? 'taken' : 'free') + '" data-seat="' + i + '"' + (taken ? ' disabled' : '') + '>' + i + '</button>';
    }

    const html =
      '<a class="btn btn-ghost btn-sm mb-2" href="#/catamaranes">' + icon('arrow-left') + 'Volver</a>' +
      '<div class="reserva-head">' +
      '<div><div class="b">' + esc(cat.nombre) + '</div>' +
      '<div class="s">' + esc(S().fmtDateLong(fecha)) + ' · ' + esc(horario) + ' hs · ' + esc(cat.zona) + '</div></div>' +
      '<div class="price" style="font-family:var(--f-display);font-weight:700;color:var(--navy-700)">' + S().fmtMoney(cat.precio) + '<small style="display:block;font-size:.6rem;color:var(--ink-400);text-align:right">por lugar</small></div>' +
      '</div>' +
      '<div class="deck">' +
      '<div class="bow">' + icon('anchor') + ' Proa</div>' +
      '<div class="seat-grid">' + grid + '</div>' +
      '<div class="legend"><span><i class="li-free"></i>Disponible</span><span><i class="li-taken"></i>Ocupado</span><span><i class="li-sel"></i>Seleccionado</span></div>' +
      '</div>' +
      '<div class="summary" id="sumbox" hidden>' +
      '<div class="row"><span>Lugares seleccionados</span><span class="sel-list" id="sel-list">—</span></div>' +
      '<div class="row total"><span>Total</span><b id="sel-total">' + S().fmtMoney(0) + '</b></div>' +
      '<button class="btn btn-primary btn-block btn-lg" id="btn-confirm">' + icon('check') + 'Confirmar reserva</button>' +
      '</div>';

    function mount(root) {
      const sel = new Set();
      const sumbox = root.querySelector('#sumbox');
      const selList = root.querySelector('#sel-list');
      const selTotal = root.querySelector('#sel-total');
      root.querySelectorAll('.seat.free').forEach(btn => {
        btn.addEventListener('click', () => {
          const n = +btn.getAttribute('data-seat');
          if (sel.has(n)) { sel.delete(n); btn.classList.remove('sel'); btn.classList.add('free'); }
          else { sel.add(n); btn.classList.add('sel'); btn.classList.remove('free'); }
          const arr = [...sel].sort((a, b) => a - b);
          sumbox.hidden = arr.length === 0;
          selList.textContent = arr.length ? arr.join(', ') : '—';
          selTotal.textContent = S().fmtMoney(cat.precio * arr.length);
        });
      });
      root.querySelector('#btn-confirm').addEventListener('click', () => {
        const lugares = [...sel].sort((a, b) => a - b);
        if (!lugares.length) return;
        const r = S().crearReserva({ usuarioId: ctx.user.id, catamaranId: cat.id, fecha, horario, lugares });
        nav('#/pago/' + r.id);
      });
    }
    return { html, mount, chrome: 'mobile', tab: 'catamaranes' };
  }

  /* =======================================================================
     PESCADOR — Pago (simulado) → emite permiso
     ======================================================================= */
  function pago(ctx) {
    const r = S().reserva(ctx.params.reservaId);
    if (!r) return notFound('Reserva no encontrada');
    const cat = S().catamaran(r.catamaranId);

    const html =
      '<div class="page-head" style="margin-bottom:10px"><div class="pt"><h1 style="font-size:1.4rem">Pago</h1><p>Confirmá tu reserva en ' + esc(cat.nombre) + '.</p></div></div>' +
      '<div class="pay-card">' +
      '<div class="pc-top"><span class="pc-brand">PescaCorral</span><span class="pc-chip"></span></div>' +
      '<div class="pc-num" id="pc-num">•••• •••• •••• ••••</div>' +
      '<div class="pc-row"><div><div class="lbl">Titular</div><span id="pc-name">' + esc(ctx.user.nombre.toUpperCase()) + '</span></div>' +
      '<div><div class="lbl">Vence</div><span id="pc-exp">MM/AA</span></div></div>' +
      '</div>' +
      '<div class="amount-due"><div class="l">Total a pagar</div><div class="v">' + S().fmtMoney(r.total) + '</div>' +
      '<div class="micro">' + r.lugares.length + ' lugar' + (r.lugares.length > 1 ? 'es' : '') + ' · ' + esc(S().fmtDate(r.fecha)) + ' · ' + esc(r.horario) + ' hs</div></div>' +
      '<div class="card card-pad">' +
      '<form id="f-pay" novalidate>' +
      field('Número de tarjeta', '<input class="input mono" name="num" inputmode="numeric" maxlength="19" placeholder="4509 9535 6623 3704" required>') +
      '<div class="flex gap-1">' +
      '<div style="flex:1">' + field('Vencimiento', '<input class="input mono" name="exp" inputmode="numeric" maxlength="5" placeholder="08/27" required>') + '</div>' +
      '<div style="flex:1">' + field('CVV', '<input class="input mono" name="cvv" inputmode="numeric" maxlength="4" placeholder="123" required>') + '</div>' +
      '</div>' +
      field('Nombre del titular', '<input class="input" name="name" placeholder="Como figura en la tarjeta" value="' + esc(ctx.user.nombre) + '" required>') +
      '<button class="btn btn-blue btn-block btn-lg mt-1" type="submit">' + icon('lock') + 'Pagar ' + S().fmtMoney(r.total) + '</button>' +
      '<div class="permit-note mt-1">' + icon('shield') + 'Pago de demostración — no se procesan cobros reales.</div>' +
      '</form></div>';

    function mount(root) {
      const f = root.querySelector('#f-pay');
      const pcNum = root.querySelector('#pc-num'), pcExp = root.querySelector('#pc-exp'), pcName = root.querySelector('#pc-name');
      f.num.addEventListener('input', () => {
        let v = f.num.value.replace(/\D/g, '').slice(0, 16);
        f.num.value = v.replace(/(.{4})/g, '$1 ').trim();
        pcNum.textContent = (f.num.value || '•••• •••• •••• ••••').padEnd(19, '•').replace(/(.{4})/g, '$1 ').trim();
      });
      f.exp.addEventListener('input', () => {
        let v = f.exp.value.replace(/\D/g, '').slice(0, 4);
        if (v.length >= 3) v = v.slice(0, 2) + '/' + v.slice(2);
        f.exp.value = v; pcExp.textContent = v || 'MM/AA';
      });
      f.cvv.addEventListener('input', () => { f.cvv.value = f.cvv.value.replace(/\D/g, ''); });
      f.name.addEventListener('input', () => { pcName.textContent = (f.name.value || ctx.user.nombre).toUpperCase(); });
      f.addEventListener('submit', e => {
        e.preventDefault();
        if (f.num.value.replace(/\s/g, '').length < 13 || !f.exp.value || f.cvv.value.length < 3) {
          toast('Revisá los datos de la tarjeta.', 'err'); return;
        }
        const btn = f.querySelector('button[type=submit]');
        btn.disabled = true; btn.innerHTML = icon('clock') + 'Procesando...';
        setTimeout(() => {
          const res = S().pagarReserva(r.id, 'tarjeta');
          showSuccess(res.permiso);
        }, 850);
      });
    }

    function showSuccess(permiso) {
      const m = modal(
        '<div class="success-wrap"><div class="success-circle">' + icon('check') + '</div>' +
        '<h3 style="text-align:center">¡Pago aprobado!</h3>' +
        '<p class="mdesc" style="text-align:center">Tu permiso digital <b class="mono">' + esc(permiso.codigo) + '</b> ya está disponible.</p></div>' +
        '<button class="btn btn-primary btn-block btn-lg" data-go>' + icon('ticket') + 'Ver mi permiso</button>',
        { dismissible: false });
      m.el.querySelector('[data-go]').addEventListener('click', () => { m.close(); nav('#/permiso/' + permiso.id); });
    }
    return { html, mount, chrome: 'mobile', tab: 'catamaranes' };
  }

  /* =======================================================================
     PESCADOR — Permiso digital
     ======================================================================= */
  function permiso(ctx) {
    const p = S().permiso(ctx.params.permisoId);
    if (!p) return notFound('Permiso no encontrado');
    const u = S().usuario(p.usuarioId);
    const cat = S().catamaran(p.catamaranId);
    const vigente = p.estado === 'vigente';
    const payload = ['PescaCorral', p.codigo, u ? u.nombre : '', cat ? cat.nombre : '', p.fechaEmision, p.vencimiento, p.estado].join('|');

    const rows = [
      ['Nº de permiso', p.codigo, true],
      ['Titular', u ? u.nombre : '—', false],
      ['DNI', u ? u.dni : '—', true],
      ['Catamarán', cat ? cat.nombre : '—', false],
      ['Especie habilitada', p.especie, false],
      ['Zona', p.zona, false],
      ['Emisión', S().fmtDate(p.fechaEmision), true],
      ['Vencimiento', S().fmtDate(p.vencimiento), true],
    ];

    const html =
      '<a class="btn btn-ghost btn-sm mb-2" href="#/historial/permisos">' + icon('arrow-left') + 'Volver</a>' +
      '<div class="permit">' +
      '<div class="permit-active' + (vigente ? '' : ' exp') + '">' + icon(vigente ? 'shield-check' : 'clock') + (vigente ? 'Permiso activo' : 'Permiso vencido') + '</div>' +
      '<div class="permit-body">' +
      '<div class="permit-codes">' + barcode(p.codigo) +
      '<div class="qr-wrap">' + qr(payload) + '</div></div>' +
      '<div class="permit-rows">' +
      rows.map(([k, v, mono]) => '<div class="pr"><span class="k">' + esc(k) + '</span><span class="v' + (mono ? ' mono' : '') + '">' + esc(v) + '</span></div>').join('') +
      '<div class="pr"><span class="k">Estado</span><span class="v">' + estadoChip(p.estado) + '</span></div>' +
      '</div>' +
      '<div class="permit-note">' + icon('info') + 'Presentá este permiso ante cualquier control municipal o de Prefectura.</div>' +
      '</div>' +
      '<div class="permit-foot"><button class="btn btn-primary btn-block btn-lg" id="btn-pdf">' + icon('download') + 'Descargar / Imprimir PDF</button></div>' +
      '</div>';

    function mount(root) {
      root.querySelector('#btn-pdf').addEventListener('click', () => window.print());
    }
    return { html, mount, chrome: 'mobile', tab: 'permisos' };
  }

  /* =======================================================================
     PESCADOR — Historial (reservas / permisos)
     ======================================================================= */
  function historial(ctx) {
    const tab0 = ctx.params.tab === 'permisos' ? 'permisos' : 'reservas';
    const html =
      '<div class="page-head" style="margin-bottom:12px"><div class="pt"><h1 style="font-size:1.4rem">Mi actividad</h1><p>Tus reservas y permisos en un solo lugar.</p></div></div>' +
      '<div class="tabs" id="hist-tabs">' +
      '<button data-t="reservas"' + (tab0 === 'reservas' ? ' class="active"' : '') + '>Reservas</button>' +
      '<button data-t="permisos"' + (tab0 === 'permisos' ? ' class="active"' : '') + '>Permisos</button>' +
      '</div><div id="hist-body"></div>';

    function paint(root, t) {
      const body = root.querySelector('#hist-body');
      if (t === 'reservas') {
        const rs = S().reservasDe(ctx.user.id);
        body.innerHTML = rs.length ? '<div class="list">' + rs.map(r => {
          const cat = S().catamaran(r.catamaranId);
          const perm = S().permisoDeReserva(r.id);
          const future = r.fecha >= S().todayISO();
          return '<div class="row-card"' + (perm ? ' data-go="#/permiso/' + perm.id + '"' : '') + '>' +
            '<div class="lead lead-' + (future ? 'teal' : 'blue') + '">' + icon('ship') + '</div>' +
            '<div class="body"><b>' + esc(cat ? cat.nombre : '—') + '</b>' +
            '<div class="sub">' + esc(S().fmtDate(r.fecha)) + ' · ' + esc(r.horario) + ' hs · lugares ' + esc(r.lugares.join(', ')) + '</div></div>' +
            '<div class="trail"><span class="amt">' + S().fmtMoney(r.total) + '</span>' + estadoChip(r.estado) + '</div></div>';
        }).join('') + '</div>'
          : emptyState('calendar', 'Sin reservas todavía', 'Cuando reserves una salida vas a verla acá.') +
          '<a class="btn btn-primary btn-block mt-1" href="#/catamaranes">' + icon('ship') + 'Reservar una salida</a>';
      } else {
        const ps = S().permisosDe(ctx.user.id);
        body.innerHTML = ps.length ? '<div class="list">' + ps.map(p => {
          const cat = S().catamaran(p.catamaranId);
          return '<div class="row-card" data-go="#/permiso/' + p.id + '">' +
            '<div class="lead lead-' + (p.estado === 'vigente' ? 'green' : 'amber') + '">' + icon('ticket') + '</div>' +
            '<div class="body"><b class="mono">' + esc(p.codigo) + '</b>' +
            '<div class="sub">' + esc(cat ? cat.nombre : '—') + ' · ' + esc(p.especie) + ' · vence ' + esc(S().fmtDate(p.vencimiento)) + '</div></div>' +
            '<div class="trail">' + estadoChip(p.estado) + icon('chevron-right') + '</div></div>';
        }).join('') + '</div>'
          : emptyState('ticket', 'Sin permisos', 'Tus permisos digitales aparecen acá luego de reservar y pagar.');
      }
      body.querySelectorAll('[data-go]').forEach(el => el.addEventListener('click', () => nav(el.getAttribute('data-go'))));
    }

    function mount(root) {
      const tabs = root.querySelector('#hist-tabs');
      tabs.querySelectorAll('button').forEach(b => b.addEventListener('click', () => {
        tabs.querySelectorAll('button').forEach(x => x.classList.remove('active'));
        b.classList.add('active'); paint(root, b.getAttribute('data-t'));
      }));
      paint(root, tab0);
    }
    return { html, mount, chrome: 'mobile', tab: 'permisos' };
  }

  /* =======================================================================
     PESCADOR / general — Notificaciones
     ======================================================================= */
  function notificaciones(ctx) {
    const ns = S().notificacionesDe(ctx.user.id);
    const icoFor = t => ({ reserva: 'calendar-check', permiso: 'ticket', recordatorio: 'clock', pago: 'credit-card' }[t] || 'bell');
    const leadFor = t => ({ reserva: 'lead-teal', permiso: 'lead-amber', recordatorio: 'lead-blue', pago: 'lead-green' }[t] || 'lead-blue');
    const html =
      '<div class="page-head" style="margin-bottom:12px"><div class="pt"><h1 style="font-size:1.4rem">Notificaciones</h1><p>Avisos sobre tus reservas y permisos.</p></div></div>' +
      (ns.length ? '<div class="list">' + ns.map(n =>
        '<div class="row-card" style="' + (n.leida ? 'opacity:.7' : '') + '">' +
        '<div class="lead ' + leadFor(n.tipo) + '">' + icon(icoFor(n.tipo)) + '</div>' +
        '<div class="body"><b>' + esc(n.titulo) + (n.leida ? '' : ' <span class="chip chip-teal" style="padding:1px 7px">nuevo</span>') + '</b>' +
        '<div class="sub">' + esc(n.mensaje) + '</div></div></div>').join('') + '</div>'
        : emptyState('bell', 'Todo al día', 'No tenés notificaciones por ahora.'));

    function mount() { setTimeout(() => { S().marcarLeidas(ctx.user.id); if (global.App) global.App.refreshBadges(); }, 600); }
    return { html, mount, chrome: 'mobile', tab: 'home' };
  }

  /* =======================================================================
     PESCADOR / general — Perfil
     ======================================================================= */
  function perfil(ctx) {
    const u = ctx.user;
    const r = S().ROLES[u.rol];
    const nRes = S().reservasDe(u.id).length;
    const nPerm = S().permisosDe(u.id).length;
    const html =
      '<div class="profile-head">' +
      '<div class="pa">' + esc(S().initials(u.nombre)) + '</div>' +
      '<h2>' + esc(u.nombre) + '</h2>' +
      '<span class="role">' + icon('shield') + esc(r.label) + '</span>' +
      '</div>' +
      '<div class="stat-row mt-2">' +
      '<div class="stat"><div class="v">' + nRes + '</div><div class="l">Reservas</div></div>' +
      '<div class="stat"><div class="v">' + nPerm + '</div><div class="l">Permisos</div></div>' +
      '<div class="stat"><div class="v">' + esc(S().fmtDate(u.creado).slice(3)) + '</div><div class="l">Miembro desde</div></div>' +
      '</div>' +
      '<div class="menu-list">' +
      '<button id="m-edit"><span class="mi">' + icon('pencil') + '</span>Editar mis datos<span class="chev">' + icon('chevron-right') + '</span></button>' +
      '<a href="#/historial"><span class="mi">' + icon('calendar') + '</span>Mis reservas<span class="chev">' + icon('chevron-right') + '</span></a>' +
      '<a href="#/historial/permisos"><span class="mi">' + icon('ticket') + '</span>Mis permisos<span class="chev">' + icon('chevron-right') + '</span></a>' +
      '<a href="#/notificaciones"><span class="mi">' + icon('bell') + '</span>Notificaciones<span class="chev">' + icon('chevron-right') + '</span></a>' +
      '</div>' +
      '<div class="menu-list mt-2">' +
      '<button id="m-reset"><span class="mi">' + icon('refresh') + '</span>Restablecer datos de demo<span class="chev">' + icon('chevron-right') + '</span></button>' +
      '<button id="m-logout" class="danger"><span class="mi">' + icon('log-out') + '</span>Cerrar sesión<span class="chev">' + icon('chevron-right') + '</span></button>' +
      '</div>' +
      '<p class="micro center mt-2">PescaCorral · Prototipo TFG · v1.0</p>';

    function mount(root) {
      root.querySelector('#m-logout').addEventListener('click', async () => {
        if (await confirm({ title: 'Cerrar sesión', message: '¿Querés salir de tu cuenta?', ok: 'Cerrar sesión', danger: true })) {
          S().logout(); toast('Sesión cerrada', 'info'); nav('#/login');
        }
      });
      root.querySelector('#m-reset').addEventListener('click', async () => {
        if (await confirm({ title: 'Restablecer demo', message: 'Se borrarán las reservas/permisos creados y se recargarán los datos de ejemplo.', ok: 'Restablecer', danger: true })) {
          S().reset(); toast('Datos restablecidos', 'ok'); location.hash = '#/login'; setTimeout(() => location.reload(), 200);
        }
      });
      root.querySelector('#m-edit').addEventListener('click', () => editProfile(u));
    }
    return { html, mount, chrome: 'mobile', tab: 'perfil' };
  }

  function editProfile(u) {
    const m = modal(
      '<h3>Editar mis datos</h3><p class="mdesc">Actualizá tu información de contacto.</p>' +
      '<form id="f-edit">' +
      field('Nombre y apellido', '<input class="input" name="nombre" value="' + esc(u.nombre) + '" required>') +
      field('Teléfono', '<input class="input" name="tel" value="' + esc(u.tel || '') + '">') +
      field('DNI', '<input class="input mono" name="dni" value="' + esc(u.dni || '') + '" placeholder="00.000.000">') +
      '<div class="actions"><button type="button" class="btn btn-ghost" data-close>Cancelar</button><button type="submit" class="btn btn-primary">Guardar</button></div>' +
      '</form>');
    m.el.querySelector('[data-close]').addEventListener('click', m.close);
    m.el.querySelector('#f-edit').addEventListener('submit', e => {
      e.preventDefault();
      const f = e.target;
      S().updateUser(u.id, { nombre: f.nombre.value.trim(), tel: f.tel.value.trim(), dni: f.dni.value.trim() });
      m.close(); toast('Datos actualizados', 'ok');
      if (global.App) global.App.render();
    });
  }

  /* =======================================================================
     DUEÑO — Home (resumen de flota)
     ======================================================================= */
  function duenoHome(ctx) {
    const mis = S().catamaranesDe(ctx.user.id);
    const hoy = S().todayISO();
    let lugaresHoy = 0, capHoy = 0;
    mis.forEach(c => { capHoy += c.capacidad; lugaresHoy += S().asientosOcupados(c.id, hoy, c.horario).size; });
    const reservasFlota = S().raw.reservas.filter(r => mis.some(c => c.id === r.catamaranId));
    const ingresos = S().raw.pagos.filter(p => reservasFlota.some(r => r.id === p.reservaId) && p.estado === 'aprobado').reduce((a, p) => a + p.monto, 0);

    const html =
      '<div class="hero">' +
      '<span class="place">' + icon('ship') + 'Panel del dueño</span>' +
      '<h1>Hola, ' + esc(ctx.user.nombre.split(' ')[0]) + '</h1>' +
      '<p>Gestioná tus catamaranes y seguí la ocupación de tus salidas.</p>' +
      '<div class="hero-actions"><a class="btn btn-translucent" href="#/mis-catamaranes">' + icon('settings') + 'Mi flota</a>' +
      '<a class="btn btn-soft" href="#/reservas-dueno">' + icon('calendar') + 'Reservas</a></div></div>' +
      '<div class="stat-row mt-2">' +
      '<div class="stat"><div class="v">' + mis.length + '</div><div class="l">Catamaranes</div></div>' +
      '<div class="stat"><div class="v">' + lugaresHoy + '/' + capHoy + '</div><div class="l">Ocupación hoy</div></div>' +
      '<div class="stat"><div class="v" style="font-size:1rem">' + S().fmtMoney(ingresos) + '</div><div class="l">Ingresos totales</div></div>' +
      '</div>' +
      '<div class="section-title"><h3>Mis catamaranes</h3><a class="link" href="#/mis-catamaranes">Gestionar</a></div>' +
      (mis.length ? mis.map(c => boatCard(c, hoy)).join('') : emptyState('ship', 'Sin catamaranes', 'Agregá tu primer catamarán desde "Mi flota".'));
    return { html, chrome: 'mobile', tab: 'home' };
  }

  /* =======================================================================
     DUEÑO — Mis catamaranes (CRUD)
     ======================================================================= */
  function misCatamaranes(ctx) {
    const html =
      '<div class="page-head" style="margin-bottom:12px"><div class="pt"><h1 style="font-size:1.4rem">Mi flota</h1><p>Administrá tus catamaranes, cupos y precios.</p></div>' +
      '<button class="btn btn-primary btn-sm" id="add-cat">' + icon('plus') + 'Agregar</button></div>' +
      '<div id="cat-list" class="list"></div>';

    function paint(root) {
      const list = root.querySelector('#cat-list');
      const mis = S().catamaranesDe(ctx.user.id);
      list.innerHTML = mis.length ? mis.map(c =>
        '<div class="boat">' +
        '<div class="thumb">' + icon('ship') + '</div>' +
        '<div class="info"><b>' + esc(c.nombre) + '</b>' +
        '<div class="meta"><span>' + icon('users') + c.capacidad + '</span><span>' + icon('clock') + esc(c.horario) + '</span><span>' + icon('map-pin') + esc(c.zona) + '</span></div>' +
        '<div class="meta" style="margin-top:5px"><span class="price" style="font-family:var(--f-display);color:var(--navy-700);font-weight:700">' + S().fmtMoney(c.precio) + '</span></div></div>' +
        '<div class="right"><button class="iconbtn" style="background:var(--surface-2);color:var(--teal-700)" data-edit="' + c.id + '">' + icon('pencil') + '</button>' +
        '<button class="iconbtn" style="background:var(--surface-2);color:var(--red-600)" data-del="' + c.id + '">' + icon('trash') + '</button></div>' +
        '</div>').join('')
        : emptyState('ship', 'Sin catamaranes', 'Tocá "Agregar" para registrar tu primer catamarán.');
      list.querySelectorAll('[data-edit]').forEach(b => b.addEventListener('click', () => catForm(ctx, root, S().catamaran(b.getAttribute('data-edit')))));
      list.querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', async () => {
        const c = S().catamaran(b.getAttribute('data-del'));
        if (await confirm({ title: 'Quitar catamarán', message: '¿Dar de baja "' + c.nombre + '"? Dejará de ofrecerse.', ok: 'Quitar', danger: true })) {
          S().removeCatamaran(c.id); toast('Catamarán dado de baja', 'info'); paint(root);
        }
      }));
    }

    function mount(root) {
      root.querySelector('#add-cat').addEventListener('click', () => catForm(ctx, root, null));
      paint(root);
    }
    misCatamaranes._paint = paint;
    return { html, mount, chrome: 'mobile', tab: 'catamaranes' };
  }

  function catForm(ctx, root, cat) {
    const edit = !!cat;
    const c = cat || { nombre: '', capacidad: 16, precio: 7500, horario: '08:00', zona: S().ZONAS[0], descripcion: '' };
    const m = modal(
      '<h3>' + (edit ? 'Editar catamarán' : 'Nuevo catamarán') + '</h3>' +
      '<form id="f-cat">' +
      field('Nombre', '<input class="input" name="nombre" value="' + esc(c.nombre) + '" placeholder="Don Juan II" required>') +
      '<div class="flex gap-1">' +
      '<div style="flex:1">' + field('Capacidad', '<input class="input" type="number" name="capacidad" min="1" max="40" value="' + c.capacidad + '" required>') + '</div>' +
      '<div style="flex:1">' + field('Precio / lugar', '<input class="input" type="number" name="precio" min="0" step="100" value="' + c.precio + '" required>') + '</div>' +
      '</div>' +
      '<div class="flex gap-1">' +
      '<div style="flex:1">' + field('Horario', '<select class="select" name="horario">' + S().HORARIOS.map(h => '<option' + (h === c.horario ? ' selected' : '') + '>' + h + '</option>').join('') + '</select>') + '</div>' +
      '<div style="flex:1">' + field('Zona', '<select class="select" name="zona">' + S().ZONAS.map(z => '<option' + (z === c.zona ? ' selected' : '') + '>' + esc(z) + '</option>').join('') + '</select>') + '</div>' +
      '</div>' +
      field('Descripción', '<textarea class="textarea" name="descripcion" placeholder="Detalles de la embarcación...">' + esc(c.descripcion || '') + '</textarea>') +
      '<div class="actions"><button type="button" class="btn btn-ghost" data-close>Cancelar</button><button type="submit" class="btn btn-primary">' + (edit ? 'Guardar' : 'Crear') + '</button></div>' +
      '</form>');
    m.el.querySelector('[data-close]').addEventListener('click', m.close);
    m.el.querySelector('#f-cat').addEventListener('submit', e => {
      e.preventDefault();
      const f = e.target;
      const data = { nombre: f.nombre.value.trim(), capacidad: +f.capacidad.value, precio: +f.precio.value, horario: f.horario.value, zona: f.zona.value, descripcion: f.descripcion.value.trim() };
      if (!data.nombre) { toast('Poné un nombre.', 'err'); return; }
      if (edit) S().updateCatamaran(cat.id, data);
      else S().addCatamaran(Object.assign({ duenoId: ctx.user.id }, data));
      m.close(); toast(edit ? 'Catamarán actualizado' : 'Catamarán creado', 'ok');
      misCatamaranes._paint(root);
    });
  }

  /* =======================================================================
     DUEÑO — Reservas de su flota
     ======================================================================= */
  function reservasDueno(ctx) {
    const mis = S().catamaranesDe(ctx.user.id);
    const ids = new Set(mis.map(c => c.id));
    const rs = S().raw.reservas.filter(r => ids.has(r.catamaranId)).sort((a, b) => b.fecha.localeCompare(a.fecha)).slice(0, 40);
    const html =
      '<div class="page-head" style="margin-bottom:12px"><div class="pt"><h1 style="font-size:1.4rem">Reservas</h1><p>Movimientos recientes en tus catamaranes.</p></div></div>' +
      (rs.length ? '<div class="list">' + rs.map(r => {
        const cat = S().catamaran(r.catamaranId), u = S().usuario(r.usuarioId);
        return '<div class="row-card"><div class="lead lead-teal">' + icon('calendar') + '</div>' +
          '<div class="body"><b>' + esc(cat ? cat.nombre : '—') + '</b><div class="sub">' + esc(u ? u.nombre : 'Cliente') + ' · ' + esc(S().fmtDate(r.fecha)) + ' · ' + r.lugares.length + ' lugar' + (r.lugares.length > 1 ? 'es' : '') + '</div></div>' +
          '<div class="trail"><span class="amt">' + S().fmtMoney(r.total) + '</span>' + estadoChip(r.estado) + '</div></div>';
      }).join('') + '</div>' : emptyState('calendar', 'Sin reservas', 'Todavía no hay reservas en tus catamaranes.'));
    return { html, chrome: 'mobile', tab: 'reservas' };
  }

  /* =======================================================================
     MUNICIPIO / ADMIN — Dashboard
     ======================================================================= */
  function adminDashboard(ctx) {
    const s = S().statsResumen();
    const serie = S().reservasPorDia(7);
    const flota = S().ocupacionFlota();
    const especie = S().permisosPorEspecie();
    const últimos = S().ultimosPermisos(6);
    const dn = donut([
      { label: 'Lugares ocupados', value: flota.ocupados, color: 'var(--blue-600)' },
      { label: 'Disponibles', value: flota.disponibles, color: 'var(--teal-200)' },
    ], { centerLabel: 'lugares hoy' });

    const kpis = [
      ['Reservas hoy', s.reservasHoy, s.deltaReservas, 'calendar-check', 'var(--blue-100)', 'var(--blue-600)'],
      ['Permisos emitidos', s.permisosEmitidos, null, 'ticket', 'var(--amber-100)', 'var(--sun-600)'],
      ['Ingresos (30 d)', S().fmtMoney(s.ingresosMes), null, 'dollar-sign', 'var(--green-100)', 'var(--green-600)'],
    ];

    const html =
      pageHead('Dashboard', 'Resumen operativo de la pesca embarcada en Cabra Corral.') +
      '<div class="kpi-grid">' + kpis.map(k => kpiCard(k)).join('') + '</div>' +
      '<div class="panel-grid">' +
      '<div class="panel"><div class="ph"><h3>Reservas últimos 7 días</h3><span class="sub">por jornada</span></div>' + barChart(serie) + '</div>' +
      '<div class="panel"><div class="ph"><h3>Ocupación de flota</h3></div>' +
      '<div style="display:flex;justify-content:center">' + dn.svg + '</div>' + dn.legend + '</div>' +
      '</div>' +
      '<div class="panel"><div class="ph"><h3>Permisos recientes</h3><a class="link" href="#/admin/permisos">Ver todos</a></div>' +
      permisosTable(últimos) + '</div>' +
      '<div class="panel-grid mt-0" style="margin-top:0">' +
      '<div class="panel"><div class="ph"><h3>Permisos por especie</h3></div>' + barChart(especie, { color: 'var(--teal-500)' }) + '</div>' +
      '<div class="panel"><div class="ph"><h3>Estado de fauna</h3><a class="link" href="#/admin/fauna">Detalle</a></div>' + faunaMini() + '</div>' +
      '</div>';
    return { html, chrome: 'admin', tab: 'dashboard' };
  }

  function pageHead(title, sub, extra) {
    return '<div class="page-head"><div class="pt"><h1>' + esc(title) + '</h1><p>' + esc(sub) + '</p></div>' +
      (extra || '<div class="daterange">' + icon('calendar') + 'Hoy · ' + esc(S().fmtDate(S().todayISO())) + '</div>') + '</div>';
  }
  function kpiCard([label, value, delta, ic, bg, fg]) {
    let d = '';
    if (delta != null) {
      const up = delta >= 0;
      d = '<div class="kd ' + (up ? 'up' : 'down') + '">' + icon(up ? 'trending-up' : 'trending-down') + (up ? '+' : '') + delta + '%</div>';
    }
    return '<div class="kpi"><div class="kl">' + esc(label) + '</div><div class="kv">' + esc(value) + '</div>' + d +
      '<div class="kico" style="background:' + bg + ';color:' + fg + '">' + icon(ic) + '</div></div>';
  }
  function permisosTable(rows) {
    return '<div class="table-wrap"><table class="data"><thead><tr>' +
      '<th>Código</th><th>Titular</th><th>Catamarán</th><th>Especie</th><th>Emisión</th><th>Estado</th></tr></thead><tbody>' +
      rows.map(p => '<tr><td class="mono">' + esc(p.codigo) + '</td>' +
        '<td><div class="u"><div class="av">' + esc(S().initials(p.usuario ? p.usuario.nombre : '?')) + '</div>' + esc(p.usuario ? p.usuario.nombre : '—') + '</div></td>' +
        '<td>' + esc(p.catamaran ? p.catamaran.nombre : '—') + '</td>' +
        '<td>' + esc(p.especie) + '</td>' +
        '<td>' + esc(S().fmtDate(p.fechaEmision)) + '</td>' +
        '<td>' + estadoChip(p.estado) + '</td></tr>').join('') +
      '</tbody></table></div>';
  }
  function faunaMini() {
    const ind = S().indicadoresFauna();
    return ind.map(i => {
      const col = i.alerta ? 'var(--red-500)' : i.ratio > 0.7 ? 'var(--amber-500)' : 'var(--teal-500)';
      return '<div style="margin-bottom:11px"><div class="gh" style="margin-bottom:6px"><b>' + esc(i.especie) + '</b><span class="micro">' + i.emitidos + ' / ' + i.umbral + '</span></div>' +
        '<div class="track"><i style="width:' + (i.ratio * 100).toFixed(0) + '%;background:' + col + '"></i></div></div>';
    }).join('');
  }

  /* =======================================================================
     ADMIN — Catamaranes (todos)
     ======================================================================= */
  function adminCatamaranes(ctx) {
    const cats = S().catamaranes();
    const html = pageHead('Catamaranes', 'Embarcaciones habilitadas en el dique.') +
      '<div class="panel"><div class="table-wrap"><table class="data"><thead><tr>' +
      '<th>Catamarán</th><th>Dueño</th><th>Capacidad</th><th>Horario</th><th>Zona</th><th>Precio</th><th>Ocupación hoy</th></tr></thead><tbody>' +
      cats.map(c => {
        const d = S().usuario(c.duenoId);
        const occ = S().asientosOcupados(c.id, S().todayISO(), c.horario).size;
        return '<tr><td><div class="u"><div class="av" style="background:var(--grad-teal);border-radius:9px">' + icon('ship') + '</div><b>' + esc(c.nombre) + '</b></div></td>' +
          '<td>' + esc(d ? d.nombre : '—') + '</td><td>' + c.capacidad + '</td><td>' + esc(c.horario) + '</td><td>' + esc(c.zona) + '</td>' +
          '<td>' + S().fmtMoney(c.precio) + '</td><td>' + occ + '/' + c.capacidad + '</td></tr>';
      }).join('') + '</tbody></table></div></div>';
    return { html, chrome: 'admin', tab: 'catamaranes' };
  }

  /* =======================================================================
     ADMIN — Reservas (todas)
     ======================================================================= */
  function adminReservas(ctx) {
    const rs = S().raw.reservas.slice().sort((a, b) => b.fecha.localeCompare(a.fecha)).slice(0, 60);
    const html = pageHead('Reservas', 'Últimas reservas registradas en el sistema.') +
      '<div class="panel"><div class="table-wrap"><table class="data"><thead><tr>' +
      '<th>Cliente</th><th>Catamarán</th><th>Fecha</th><th>Horario</th><th>Lugares</th><th>Total</th><th>Estado</th></tr></thead><tbody>' +
      rs.map(r => {
        const c = S().catamaran(r.catamaranId), u = S().usuario(r.usuarioId);
        return '<tr><td><div class="u"><div class="av">' + esc(S().initials(u ? u.nombre : '?')) + '</div>' + esc(u ? u.nombre : '—') + '</div></td>' +
          '<td>' + esc(c ? c.nombre : '—') + '</td><td>' + esc(S().fmtDate(r.fecha)) + '</td><td>' + esc(r.horario) + '</td>' +
          '<td>' + r.lugares.length + '</td><td>' + S().fmtMoney(r.total) + '</td><td>' + estadoChip(r.estado) + '</td></tr>';
      }).join('') + '</tbody></table></div></div>';
    return { html, chrome: 'admin', tab: 'reservas' };
  }

  /* =======================================================================
     ADMIN — Permisos (todos)
     ======================================================================= */
  function adminPermisos(ctx) {
    const all = S().ultimosPermisos(200);
    const html = pageHead('Permisos', 'Permisos de pesca emitidos.',
      '<button class="btn btn-ghost btn-sm" id="csv-perm">' + icon('download') + 'Exportar CSV</button>') +
      '<div class="panel">' + permisosTable(all) + '</div>';
    function mount(root) {
      root.querySelector('#csv-perm').addEventListener('click', () => downloadCSV('permisos_pescacorral.csv', S().permisosCSV()));
    }
    return { html, mount, chrome: 'admin', tab: 'permisos' };
  }

  /* =======================================================================
     ADMIN — Reportes
     ======================================================================= */
  function adminReportes(ctx) {
    const serie = S().reservasPorDia(7);
    const zona = S().permisosPorZona();
    const especie = S().permisosPorEspecie();
    const s = S().statsResumen();
    const dz = donut(zona.map((z, i) => ({ label: z.label, value: z.value })), { centerLabel: 'permisos' });
    const html =
      pageHead('Reportes', 'Indicadores para el municipio de Coronel Moldes.',
        '<div class="flex gap-1"><button class="btn btn-ghost btn-sm" id="print-rep">' + icon('printer') + 'Imprimir</button>' +
        '<button class="btn btn-primary btn-sm" id="csv-rep">' + icon('download') + 'Exportar CSV</button></div>') +
      '<div class="kpi-grid">' +
      kpiCard(['Reservas (total)', S().raw.reservas.length, null, 'calendar', 'var(--blue-100)', 'var(--blue-600)']) +
      kpiCard(['Permisos vigentes', S().raw.permisos.filter(p => p.estado === 'vigente').length, null, 'shield-check', 'var(--green-100)', 'var(--green-600)']) +
      kpiCard(['Ingresos (30 d)', S().fmtMoney(s.ingresosMes), null, 'dollar-sign', 'var(--teal-100)', 'var(--teal-700)']) +
      '</div>' +
      '<div class="panel"><div class="ph"><h3>Evolución de reservas</h3><span class="sub">últimos 7 días</span></div>' + barChart(serie) + '</div>' +
      '<div class="panel-grid">' +
      '<div class="panel"><div class="ph"><h3>Permisos por especie</h3></div>' + barChart(especie, { color: 'var(--teal-500)' }) + '</div>' +
      '<div class="panel"><div class="ph"><h3>Permisos por zona</h3></div><div style="display:flex;justify-content:center">' + dz.svg + '</div>' + dz.legend + '</div>' +
      '</div>';
    function mount(root) {
      root.querySelector('#csv-rep').addEventListener('click', () => downloadCSV('reporte_permisos_pescacorral.csv', S().permisosCSV()));
      root.querySelector('#print-rep').addEventListener('click', () => window.print());
    }
    return { html, mount, chrome: 'admin', tab: 'reportes' };
  }

  /* =======================================================================
     ADMIN — Usuarios (gestión de roles)
     ======================================================================= */
  function adminUsuarios(ctx) {
    const canEdit = ctx.user.rol === 'admin';
    const html = pageHead('Usuarios', canEdit ? 'Gestión de cuentas y roles del sistema.' : 'Cuentas registradas en el sistema.') +
      '<div class="panel"><div id="users-body"></div></div>';

    function paint(root) {
      const us = S().listUsuarios();
      root.querySelector('#users-body').innerHTML =
        '<div class="table-wrap"><table class="data"><thead><tr>' +
        '<th>Usuario</th><th>Correo</th><th>Rol</th><th>Reservas</th>' + (canEdit ? '<th></th>' : '') + '</tr></thead><tbody>' +
        us.map(u => '<tr><td><div class="u"><div class="av">' + esc(S().initials(u.nombre)) + '</div><b>' + esc(u.nombre) + '</b></div></td>' +
          '<td>' + esc(u.email) + '</td><td>' + roleChip(u.rol) + '</td><td>' + u.reservas + '</td>' +
          (canEdit ? '<td><button class="btn btn-ghost btn-sm" data-role="' + u.id + '">' + icon('settings') + 'Rol</button></td>' : '') +
          '</tr>').join('') + '</tbody></table></div>';
      if (canEdit) root.querySelectorAll('[data-role]').forEach(b => b.addEventListener('click', () => roleModal(root, S().usuario(b.getAttribute('data-role')), paint)));
    }
    function mount(root) { paint(root); }
    return { html, mount, chrome: 'admin', tab: 'usuarios' };
  }

  function roleModal(root, u, repaint) {
    const opts = Object.keys(S().ROLES);
    const m = modal(
      '<h3>Cambiar rol</h3><p class="mdesc">' + esc(u.nombre) + ' — elegí el rol que tendrá en el sistema.</p>' +
      '<div class="menu-list">' + opts.map(k =>
        '<button data-r="' + k + '"><span class="mi">' + icon({ pescador: 'user', dueno: 'ship', municipio: 'building', admin: 'shield' }[k]) + '</span>' +
        esc(S().ROLES[k].label) + (u.rol === k ? '<span class="chev">' + icon('check') + '</span>' : '') + '</button>').join('') +
      '</div><div class="actions" style="margin-top:14px"><button class="btn btn-ghost btn-block" data-close>Cerrar</button></div>');
    m.el.querySelector('[data-close]').addEventListener('click', m.close);
    m.el.querySelectorAll('[data-r]').forEach(b => b.addEventListener('click', () => {
      S().setUserRole(u.id, b.getAttribute('data-r'));
      m.close(); toast('Rol actualizado', 'ok'); repaint(root);
    }));
  }

  /* =======================================================================
     ADMIN — Fauna (monitoreo HU-015)
     ======================================================================= */
  function adminFauna(ctx) {
    const ind = S().indicadoresFauna();
    const alertas = ind.filter(i => i.alerta);
    const html =
      pageHead('Monitoreo de fauna', 'Control de cupos por especie para preservar el recurso íctico.') +
      (alertas.length
        ? '<div class="alert-line alert-warn">' + icon('alert-triangle') + '<div><b>Atención:</b> ' + alertas.map(a => a.especie).join(', ') + ' alcanzó el umbral de permisos. Se sugiere revisar cupos.</div></div>'
        : '<div class="alert-line alert-ok">' + icon('check-circle') + '<div>Todas las especies dentro de los límites recomendados.</div></div>') +
      '<div class="gauge-grid">' +
      ind.map(i => {
        const col = i.alerta ? 'var(--red-500)' : i.ratio > 0.7 ? 'var(--amber-500)' : 'var(--teal-500)';
        return '<div class="gauge"><div class="gh">' + icon('fish') + '<b>' + esc(i.especie) + '</b>' + (i.alerta ? '<span class="chip chip-red">Umbral</span>' : '<span class="chip chip-green">OK</span>') + '</div>' +
          '<div class="track"><i style="width:' + (i.ratio * 100).toFixed(0) + '%;background:' + col + '"></i></div>' +
          '<div class="gm"><span>' + i.emitidos + ' permisos</span><span>límite ' + i.umbral + '</span></div></div>';
      }).join('') +
      '</div>';
    return { html, chrome: 'admin', tab: 'fauna' };
  }

  /* ---------- utilidades ---------- */
  function downloadCSV(filename, csv) {
    const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename; document.body.appendChild(a); a.click();
    setTimeout(() => { a.remove(); URL.revokeObjectURL(url); }, 100);
    toast('CSV exportado', 'ok');
  }
  function notFound(msg) {
    return { html: '<div style="padding:30px 0">' + emptyState('alert-triangle', msg, 'Volvé al inicio e intentá de nuevo.') + '<a class="btn btn-primary btn-block" href="#/home">Ir al inicio</a></div>', chrome: 'mobile', tab: 'home' };
  }

  global.Views = {
    login, registro, home, catamaranes, reserva, pago, permiso, historial, notificaciones, perfil,
    duenoHome, misCatamaranes, reservasDueno,
    adminDashboard, adminCatamaranes, adminReservas, adminPermisos, adminReportes, adminUsuarios, adminFauna,
  };
})(window);
