/* =========================================================================
   PescaCorral — Capa de datos (prototipo)
   Persistencia en localStorage. En el sistema real (ver TFG) esta lógica
   vive en el backend Node.js + Express sobre PostgreSQL, con las
   contraseñas cifradas mediante hash. Aquí se simula del lado cliente
   para que el prototipo sea totalmente funcional y demostrable offline.
   ========================================================================= */
(function (global) {
  'use strict';

  const DB_KEY = 'pescacorral_db_v3';
  const SESSION_KEY = 'pescacorral_session_v3';
  const LOCK_KEY = 'pescacorral_locks_v3';

  /* ---------- utilidades ---------- */
  const uid = (p = 'id') => p + '_' + Math.random().toString(36).slice(2, 9);
  const todayISO = () => new Date().toISOString().slice(0, 10);
  const addDays = (iso, d) => { const x = new Date(iso + 'T00:00:00'); x.setDate(x.getDate() + d); return x.toISOString().slice(0, 10); };

  function seededRandom(str) { // determinístico por string
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
    return function () { h += 0x6D2B79F5; let t = h; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  }

  const ROLES = {
    pescador: { label: 'Pescador / Turista', short: 'Pescador', kind: 'mobile' },
    dueno: { label: 'Dueño de Catamarán', short: 'Dueño', kind: 'mobile' },
    municipio: { label: 'Administrador Municipal', short: 'Municipio', kind: 'admin' },
    admin: { label: 'Administrador del Sistema', short: 'Sistema', kind: 'admin' },
  };

  const ESPECIES = ['Pejerrey', 'Dorado', 'Bagre', 'Carpa'];
  const ZONAS = ['Zona Norte', 'Zona Centro', 'Zona Sur', 'Embalse Cabra Corral'];
  const HORARIOS = ['07:00', '07:30', '08:00', '09:00', '14:00', '15:30'];

  /* ---------- datos semilla ---------- */
  function seed() {
    const usuarios = [
      { id: 'u_carlos', nombre: 'Carlos Romero', email: 'carlos@pescacorral.com', pass: 'Pesca2026!', rol: 'pescador', dni: '24.355.789', tel: '+54 387 511 2233', creado: addDays(todayISO(), -120) },
      { id: 'u_ramon', nombre: 'Ramón Díaz', email: 'dueno@pescacorral.com', pass: 'Pesca2026!', rol: 'dueno', dni: '20.118.402', tel: '+54 387 544 8890', creado: addDays(todayISO(), -200) },
      { id: 'u_lucia', nombre: 'Lucía Funes', email: 'municipio@pescacorral.com', pass: 'Pesca2026!', rol: 'municipio', dni: '31.902.115', tel: '+54 387 422 0001', creado: addDays(todayISO(), -260) },
      { id: 'u_admin', nombre: 'Admin Sistema', email: 'admin@pescacorral.com', pass: 'Pesca2026!', rol: 'admin', dni: '27.640.330', tel: '+54 387 400 0000', creado: addDays(todayISO(), -300) },
      { id: 'u_ana', nombre: 'Ana Ruiz', email: 'ana@mail.com', pass: 'Pesca2026!', rol: 'pescador', dni: '33.214.870', tel: '+54 387 588 1212', creado: addDays(todayISO(), -40) },
      { id: 'u_jorge', nombre: 'Jorge Pérez', email: 'jorge@mail.com', pass: 'Pesca2026!', rol: 'pescador', dni: '29.880.654', tel: '+54 387 510 7788', creado: addDays(todayISO(), -22) },
      { id: 'u_marta', nombre: 'Marta Sosa', email: 'marta@mail.com', pass: 'Pesca2026!', rol: 'dueno', dni: '25.447.219', tel: '+54 387 533 9090', creado: addDays(todayISO(), -88) },
    ];

    const catamaranes = [
      { id: 'c_donjuan', nombre: 'Don Juan II', duenoId: 'u_ramon', capacidad: 20, precio: 8000, horario: '08:00', zona: 'Zona Centro', descripcion: 'Catamarán amplio con sombra y caña de pescar incluida.', activo: true },
      { id: 'c_elpato', nombre: 'El Pato', duenoId: 'u_marta', capacidad: 16, precio: 7500, horario: '09:00', zona: 'Zona Norte', descripcion: 'Embarcación ágil ideal para grupos pequeños.', activo: true },
      { id: 'c_victoria', nombre: 'La Victoria', duenoId: 'u_ramon', capacidad: 18, precio: 8500, horario: '07:30', zona: 'Zona Sur', descripcion: 'Salida temprano para pejerrey, con guía local.', activo: true },
      { id: 'c_santarita', nombre: 'Santa Rita', duenoId: 'u_marta', capacidad: 12, precio: 6500, horario: '14:00', zona: 'Embalse Cabra Corral', descripcion: 'Paseo vespertino con equipamiento básico.', activo: true },
    ];

    const reservas = [];
    const permisos = [];
    const pagos = [];
    let permCount = 1;

    // genera actividad histórica de los últimos 30 días para nutrir el dashboard
    const seedUsers = ['u_carlos', 'u_ana', 'u_jorge'];
    for (let d = 30; d >= 0; d--) {
      const fecha = addDays(todayISO(), -d);
      const rnd = seededRandom('act' + fecha);
      const cant = Math.floor(rnd() * 4) + (d % 7 === 0 ? 1 : 0); // algunas reservas por día
      for (let i = 0; i < cant; i++) {
        const cat = catamaranes[Math.floor(rnd() * catamaranes.length)];
        const uId = seedUsers[Math.floor(rnd() * seedUsers.length)];
        const n = Math.floor(rnd() * 3) + 1;
        const lugares = [];
        while (lugares.length < n) { const s = Math.floor(rnd() * cat.capacidad) + 1; if (!lugares.includes(s)) lugares.push(s); }
        const total = cat.precio * lugares.length;
        const rId = uid('r');
        reservas.push({ id: rId, usuarioId: uId, catamaranId: cat.id, fecha, horario: cat.horario, lugares, total, estado: 'confirmada', creado: fecha });
        pagos.push({ id: uid('p'), reservaId: rId, monto: total, metodo: 'tarjeta', estado: 'aprobado', comprobante: 'CMP-' + String(1000 + permCount), fecha });
        const especie = ESPECIES[Math.floor(rnd() * ESPECIES.length)];
        permisos.push({ id: uid('pm'), reservaId: rId, usuarioId: uId, codigo: 'PCC-' + String(10000 + permCount).slice(1), especie, zona: cat.zona, catamaranId: cat.id, fechaEmision: fecha, vencimiento: fecha, estado: d === 0 ? 'vigente' : 'vencido' });
        permCount++;
      }
    }

    // una reserva próxima activa de Carlos (para historial / permiso vigente del demo)
    const futura = addDays(todayISO(), 2);
    const rF = uid('r');
    reservas.push({ id: rF, usuarioId: 'u_carlos', catamaranId: 'c_donjuan', fecha: futura, horario: '08:00', lugares: [12, 13], total: 16000, estado: 'confirmada', creado: todayISO() });
    pagos.push({ id: uid('p'), reservaId: rF, monto: 16000, metodo: 'tarjeta', estado: 'aprobado', comprobante: 'CMP-' + String(1000 + permCount), fecha: todayISO() });
    permisos.push({ id: 'pm_demo', reservaId: rF, usuarioId: 'u_carlos', codigo: 'PCC-0002B', especie: 'Pejerrey', zona: 'Zona Centro', catamaranId: 'c_donjuan', fechaEmision: todayISO(), vencimiento: futura, estado: 'vigente' });

    const notificaciones = [
      { id: uid('n'), usuarioId: 'u_carlos', tipo: 'reserva', titulo: 'Reserva confirmada', mensaje: 'Tu reserva en Don Juan II quedó confirmada para el ' + fmtDate(futura) + '.', leida: false, fecha: todayISO() },
      { id: uid('n'), usuarioId: 'u_carlos', tipo: 'permiso', titulo: 'Permiso digital emitido', mensaje: 'Permiso PCC-0002B disponible. Presentalo desde la app ante cualquier control.', leida: false, fecha: todayISO() },
      { id: uid('n'), usuarioId: 'u_carlos', tipo: 'recordatorio', titulo: 'Recordatorio de salida', mensaje: 'Tu jornada de pesca es en 2 días. La salida es a las 08:00 desde el puerto.', leida: true, fecha: todayISO() },
    ];

    return { usuarios, catamaranes, reservas, permisos, pagos, notificaciones, _seq: permCount };
  }

  /* ---------- persistencia ---------- */
  let data = load();
  function load() {
    try { const raw = localStorage.getItem(DB_KEY); if (raw) return JSON.parse(raw); } catch (e) { }
    const s = seed(); try { localStorage.setItem(DB_KEY, JSON.stringify(s)); } catch (e) { } return s;
  }
  function save() { try { localStorage.setItem(DB_KEY, JSON.stringify(data)); } catch (e) { } }
  function reset() { data = seed(); save(); localStorage.removeItem(SESSION_KEY); localStorage.removeItem(LOCK_KEY); }

  /* ---------- formato ---------- */
  function fmtMoney(n) { return '$ ' + Number(n || 0).toLocaleString('es-AR'); }
  function fmtDate(iso) { if (!iso) return ''; const [y, m, d] = iso.split('-'); return `${d}/${m}/${y}`; }
  function fmtDateLong(iso) { const dt = new Date(iso + 'T00:00:00'); return dt.toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long' }); }
  function initials(name) { return name.split(' ').filter(Boolean).slice(0, 2).map(s => s[0].toUpperCase()).join(''); }

  /* ---------- sesión / auth ---------- */
  function getSession() { try { const id = localStorage.getItem(SESSION_KEY); return id ? data.usuarios.find(u => u.id === id) || null : null; } catch (e) { return null; } }
  function setSession(id) { localStorage.setItem(SESSION_KEY, id); }
  function logout() { localStorage.removeItem(SESSION_KEY); }

  function passwordPolicy(pw) {
    const len = (pw || '').length >= 8;
    const upper = /[A-Z]/.test(pw);
    const lower = /[a-z]/.test(pw);
    const number = /[0-9]/.test(pw);
    const special = /[^A-Za-z0-9]/.test(pw);
    const passed = [len, upper, lower, number, special].filter(Boolean).length;
    return { len, upper, lower, number, special, score: passed, valid: passed === 5 };
  }

  function getLocks() { try { return JSON.parse(localStorage.getItem(LOCK_KEY) || '{}'); } catch (e) { return {}; } }
  function setLocks(l) { localStorage.setItem(LOCK_KEY, JSON.stringify(l)); }

  function register({ nombre, email, tel, rol, pass }) {
    email = (email || '').trim().toLowerCase();
    if (!nombre || !email || !pass) return { ok: false, error: 'Completá los campos obligatorios.' };
    if (data.usuarios.some(u => u.email === email)) return { ok: false, error: 'Ya existe una cuenta con ese correo electrónico.' };
    if (!passwordPolicy(pass).valid) return { ok: false, error: 'La contraseña no cumple con los requisitos de seguridad.' };
    const user = { id: uid('u'), nombre: nombre.trim(), email, tel: tel || '', rol: rol || 'pescador', dni: '', pass, creado: todayISO() };
    data.usuarios.push(user); save(); setSession(user.id);
    return { ok: true, user };
  }

  function login(email, pass) {
    email = (email || '').trim().toLowerCase();
    const locks = getLocks();
    const rec = locks[email];
    if (rec && rec.until && Date.now() < rec.until) {
      const secs = Math.ceil((rec.until - Date.now()) / 1000);
      return { ok: false, error: `Cuenta bloqueada temporalmente. Intentá de nuevo en ${secs}s.`, locked: true };
    }
    const user = data.usuarios.find(u => u.email === email);
    if (!user || user.pass !== pass) {
      const r = locks[email] || { fails: 0 };
      r.fails += 1;
      if (r.fails >= 5) { r.until = Date.now() + 30000; r.fails = 0; locks[email] = r; setLocks(locks); return { ok: false, error: 'Demasiados intentos fallidos. Cuenta bloqueada por 30 segundos.', locked: true }; }
      locks[email] = r; setLocks(locks);
      const restantes = 5 - r.fails;
      return { ok: false, error: `Correo o contraseña incorrectos. ${restantes} intento${restantes === 1 ? '' : 's'} restante${restantes === 1 ? '' : 's'}.` };
    }
    delete locks[email]; setLocks(locks);
    setSession(user.id);
    return { ok: true, user };
  }

  function updateUser(id, patch) { const u = data.usuarios.find(x => x.id === id); if (u) { Object.assign(u, patch); save(); } return u; }
  function setUserRole(id, rol) { return updateUser(id, { rol }); }

  /* ---------- catamaranes ---------- */
  const catamaranes = () => data.catamaranes.filter(c => c.activo);
  const catamaran = (id) => data.catamaranes.find(c => c.id === id);
  const catamaranesDe = (duenoId) => data.catamaranes.filter(c => c.duenoId === duenoId);
  const usuario = (id) => data.usuarios.find(u => u.id === id);

  function addCatamaran(c) { const nc = Object.assign({ id: uid('c'), activo: true }, c); data.catamaranes.push(nc); save(); return nc; }
  function updateCatamaran(id, patch) { const c = catamaran(id); if (c) { Object.assign(c, patch); save(); } return c; }
  function removeCatamaran(id) { const c = catamaran(id); if (c) { c.activo = false; save(); } }

  // asientos ocupados para un catamarán+fecha+horario (reservas reales + ocupación simulada determinística)
  function asientosOcupados(catId, fecha, horario) {
    const cat = catamaran(catId); if (!cat) return new Set();
    const taken = new Set();
    data.reservas.filter(r => r.catamaranId === catId && r.fecha === fecha && r.horario === horario && r.estado !== 'cancelada')
      .forEach(r => r.lugares.forEach(s => taken.add(s)));
    // ocupación ambiental simulada (otros pescadores) — estable por fecha
    const rnd = seededRandom(catId + fecha + horario);
    const extra = Math.floor(rnd() * Math.max(2, cat.capacidad * 0.35));
    let guard = 0;
    while (taken.size < extra && guard++ < 100) { const s = Math.floor(rnd() * cat.capacidad) + 1; taken.add(s); }
    return taken;
  }
  function disponibles(catId, fecha, horario) { const cat = catamaran(catId); return cat ? cat.capacidad - asientosOcupados(catId, fecha, horario).size : 0; }

  /* ---------- reservas / pagos / permisos ---------- */
  function crearReserva({ usuarioId, catamaranId, fecha, horario, lugares }) {
    const cat = catamaran(catamaranId);
    const total = cat.precio * lugares.length;
    const r = { id: uid('r'), usuarioId, catamaranId, fecha, horario, lugares: lugares.slice(), total, estado: 'pendiente_pago', creado: todayISO() };
    data.reservas.push(r); save(); return r;
  }
  function reserva(id) { return data.reservas.find(r => r.id === id); }
  function reservasDe(usuarioId) { return data.reservas.filter(r => r.usuarioId === usuarioId).sort((a, b) => b.fecha.localeCompare(a.fecha)); }
  function permisosDe(usuarioId) { return data.permisos.filter(p => p.usuarioId === usuarioId).sort((a, b) => b.fechaEmision.localeCompare(a.fechaEmision)); }
  function permiso(id) { return data.permisos.find(p => p.id === id); }
  function permisoDeReserva(rId) { return data.permisos.find(p => p.reservaId === rId); }

  function pagarReserva(reservaId, metodo) {
    const r = reserva(reservaId); if (!r) return { ok: false };
    const pago = { id: uid('p'), reservaId, monto: r.total, metodo: metodo || 'tarjeta', estado: 'aprobado', comprobante: 'CMP-' + String(1000 + (data._seq++)), fecha: todayISO() };
    data.pagos.push(pago);
    r.estado = 'confirmada';
    const cat = catamaran(r.catamaranId);
    const codigo = 'PCC-' + String(10000 + data._seq).slice(1);
    const pm = { id: uid('pm'), reservaId, usuarioId: r.usuarioId, codigo, especie: 'Pejerrey', zona: cat.zona, catamaranId: cat.id, fechaEmision: todayISO(), vencimiento: r.fecha, estado: 'vigente' };
    data.permisos.push(pm);
    notificar(r.usuarioId, 'reserva', 'Reserva confirmada', `Tu reserva en ${cat.nombre} quedó confirmada para el ${fmtDate(r.fecha)}.`);
    notificar(r.usuarioId, 'permiso', 'Permiso digital emitido', `Permiso ${codigo} disponible para presentar ante cualquier control.`);
    save();
    return { ok: true, pago, permiso: pm };
  }

  function pagoDeReserva(rId) { return data.pagos.find(p => p.reservaId === rId); }

  /* ---------- notificaciones ---------- */
  function notificar(usuarioId, tipo, titulo, mensaje) { data.notificaciones.unshift({ id: uid('n'), usuarioId, tipo, titulo, mensaje, leida: false, fecha: todayISO() }); save(); }
  function notificacionesDe(usuarioId) { return data.notificaciones.filter(n => n.usuarioId === usuarioId); }
  function noLeidas(usuarioId) { return notificacionesDe(usuarioId).filter(n => !n.leida).length; }
  function marcarLeidas(usuarioId) { data.notificaciones.forEach(n => { if (n.usuarioId === usuarioId) n.leida = true; }); save(); }

  /* ---------- estadísticas (municipio) ---------- */
  function statsResumen() {
    const hoy = todayISO();
    const reservasHoy = data.reservas.filter(r => r.fecha === hoy).length;
    const ayer = addDays(hoy, -1);
    const reservasAyer = data.reservas.filter(r => r.fecha === ayer).length || 1;
    const permisosEmitidos = data.permisos.length;
    const ingresos = data.pagos.filter(p => p.estado === 'aprobado').reduce((a, p) => a + p.monto, 0);
    const ingresosMes = data.pagos.filter(p => p.estado === 'aprobado' && p.fecha >= addDays(hoy, -30)).reduce((a, p) => a + p.monto, 0);
    return {
      reservasHoy, permisosEmitidos, ingresos, ingresosMes,
      deltaReservas: Math.round(((reservasHoy - reservasAyer) / reservasAyer) * 100),
      usuariosActivos: new Set(data.reservas.map(r => r.usuarioId)).size,
    };
  }
  function reservasPorDia(dias = 7) {
    const out = [];
    for (let i = dias - 1; i >= 0; i--) {
      const f = addDays(todayISO(), -i);
      const dt = new Date(f + 'T00:00:00');
      out.push({ label: ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'][dt.getDay()], value: data.reservas.filter(r => r.fecha === f).length, fecha: f });
    }
    return out;
  }
  function ocupacionFlota() {
    const hoy = todayISO();
    let ocupados = 0, total = 0;
    catamaranes().forEach(c => { total += c.capacidad; ocupados += asientosOcupados(c.id, hoy, c.horario).size; });
    return { ocupados, disponibles: total - ocupados, total };
  }
  function permisosPorEspecie() {
    const m = {}; ESPECIES.forEach(e => m[e] = 0);
    data.permisos.forEach(p => { m[p.especie] = (m[p.especie] || 0) + 1; });
    return Object.entries(m).map(([k, v]) => ({ label: k, value: v }));
  }
  function permisosPorZona() {
    const m = {};
    data.permisos.forEach(p => { m[p.zona] = (m[p.zona] || 0) + 1; });
    return Object.entries(m).map(([k, v]) => ({ label: k, value: v }));
  }
  function ultimosPermisos(n = 8) {
    return data.permisos.slice().sort((a, b) => b.fechaEmision.localeCompare(a.fechaEmision)).slice(0, n)
      .map(p => ({ ...p, usuario: usuario(p.usuarioId), catamaran: catamaran(p.catamaranId) }));
  }
  // indicadores ambientales (Tabla 2 del TFG) + umbral de alerta para fauna
  function indicadoresFauna() {
    const porEspecie = permisosPorEspecie();
    const UMBRAL = { Pejerrey: 60, Dorado: 20, Bagre: 30, Carpa: 30 };
    return porEspecie.map(e => ({ especie: e.label, emitidos: e.value, umbral: UMBRAL[e.label] || 40, ratio: Math.min(1, e.value / (UMBRAL[e.label] || 40)), alerta: e.value >= (UMBRAL[e.label] || 40) }));
  }

  function listUsuarios() { return data.usuarios.map(u => ({ ...u, reservas: data.reservas.filter(r => r.usuarioId === u.id).length })); }

  /* ---------- export CSV (reportes) ---------- */
  function permisosCSV() {
    const head = ['Codigo', 'Usuario', 'DNI', 'Catamaran', 'Especie', 'Zona', 'Emision', 'Vencimiento', 'Estado'];
    const rows = data.permisos.map(p => { const u = usuario(p.usuarioId), c = catamaran(p.catamaranId); return [p.codigo, u ? u.nombre : '', u ? u.dni : '', c ? c.nombre : '', p.especie, p.zona, p.fechaEmision, p.vencimiento, p.estado]; });
    return [head, ...rows].map(r => r.map(x => `"${String(x).replace(/"/g, '""')}"`).join(',')).join('\n');
  }

  /* ---------- API pública ---------- */
  global.Store = {
    ROLES, ESPECIES, ZONAS, HORARIOS,
    fmtMoney, fmtDate, fmtDateLong, initials, todayISO, addDays,
    reset, getSession, setSession, logout,
    passwordPolicy, register, login, updateUser, setUserRole, usuario, listUsuarios,
    catamaranes, catamaran, catamaranesDe, addCatamaran, updateCatamaran, removeCatamaran,
    asientosOcupados, disponibles,
    crearReserva, reserva, reservasDe, pagarReserva, pagoDeReserva,
    permiso, permisosDe, permisoDeReserva,
    notificar, notificacionesDe, noLeidas, marcarLeidas,
    statsResumen, reservasPorDia, ocupacionFlota, permisosPorEspecie, permisosPorZona, ultimosPermisos, indicadoresFauna,
    permisosCSV,
    get raw() { return data; },
  };
})(window);
