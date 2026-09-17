/* ============================================================================
 *  PescaCorral · js/data.js
 *  Capa de datos única para toda la app. Expone SIEMPRE la misma API, sin
 *  importar si los datos vienen de:
 *    · MODO SUPABASE  -> si config.js tiene URL + anon key (PostgreSQL real + RLS)
 *    · MODO DEMO      -> si no hay credenciales (datos sembrados en localStorage)
 *
 *  El MODO DEMO permite probar y presentar la PWA sin backend (ideal defensa TFG).
 * ========================================================================== */

const CFG = (typeof window !== "undefined" && window.PESCACORRAL_CONFIG) || {};
const HAS_SUPABASE = Boolean(CFG.SUPABASE_URL && CFG.SUPABASE_ANON_KEY);
export const MODE = HAS_SUPABASE ? "supabase" : "demo";

const DEMO_KEY = "pescacorral.demo.v1";
const DEMO_PASS = "Demo1234!";

/* Política de acceso (TFG · sección Seguridad / HU-002):
 *   bloqueo temporal de la cuenta tras MAX_INTENTOS fallidos consecutivos. */
export const MAX_INTENTOS = 3;
export const BLOQUEO_MINUTOS = 15;
const LOCK_KEY = "pescacorral.intentos.v1";      // fallback local (modo demo / sin migración)
const RECOVERY_KEY = "pescacorral.recovery";      // recuperación de contraseña en curso (por pestaña)
const PREF_RECORDATORIOS = "pescacorral.pref.recordatorios";

let sb = null;                 // cliente supabase (lazy)
const authListeners = new Set();

/* ============================================================================
 *  INICIALIZACIÓN
 * ========================================================================== */
let _ready = null;
function ready() {
  if (_ready) return _ready;
  _ready = (async () => {
    if (MODE === "supabase") {
      const { createClient } = await import("https://esm.sh/@supabase/supabase-js@2");
      sb = createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY, {
        auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
      });
      sb.auth.onAuthStateChange((event) => {
        // El enlace de "olvidé mi contraseña" vuelve a la app con una sesión de
        // recuperación: se marca para que el enrutador lleve a #/restablecer.
        if (event === "PASSWORD_RECOVERY") {
          try { sessionStorage.setItem(RECOVERY_KEY, JSON.stringify({ demo: false })); } catch {}
        }
        authListeners.forEach((fn) => fn(event));
      });
    } else {
      seedDemo();
    }
  })();
  return _ready;
}

/* ============================================================================
 *  MODO DEMO · almacén local
 * ========================================================================== */
function loadDB() {
  try { return JSON.parse(localStorage.getItem(DEMO_KEY)) || null; }
  catch { return null; }
}
function saveDB(db) { localStorage.setItem(DEMO_KEY, JSON.stringify(db)); }
let DB = null;

const uid = () =>
  (crypto.randomUUID && crypto.randomUUID()) ||
  "id-" + Math.random().toString(16).slice(2) + Date.now().toString(16);

/* PRNG determinista (mulberry32) para que los datos demo sean estables. */
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const isoFromOffset = (days, h = 12) => {
  const d = new Date(); d.setDate(d.getDate() + days); d.setHours(h, 0, 0, 0);
  return d;
};
const dateISO = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const todayISO = () => dateISO(new Date());

function seedDemo() {
  DB = loadDB();
  if (DB && DB.__v === 2) return;

  const rnd = mulberry32(20260628);
  const pick = (arr) => arr[Math.floor(rnd() * arr.length)];

  /* --- Especies (fauna) --- */
  const especies = [
    { id: uid(), nombre: "Pejerrey", nombre_cientifico: "Odontesthes bonariensis", umbral_permisos: 400, descripcion: "Especie emblemática del dique, principal objetivo de la pesca deportiva." },
    { id: uid(), nombre: "Dorado", nombre_cientifico: "Salminus brasiliensis", umbral_permisos: 150, descripcion: "Pesca con devolución obligatoria en temporada de veda." },
    { id: uid(), nombre: "Bagre", nombre_cientifico: "Rhamdia quelen", umbral_permisos: 300, descripcion: "Especie de fondo, abundante en zonas de menor corriente." },
    { id: uid(), nombre: "Carpa", nombre_cientifico: "Cyprinus carpio", umbral_permisos: 500, descripcion: "Especie introducida, sin restricciones de captura." },
  ];
  const pejerrey = especies[0];

  /* --- Usuarios demo --- */
  const uPescador = { id: uid(), nombre: "Carlos", apellido: "Romero", email: "pescador@demo.com", telefono: "+54 387 4123456", dni: "24.356.789", rol: "pescador", activo: true, created_at: isoFromOffset(-120).toISOString() };
  const uDueno    = { id: uid(), nombre: "Juan", apellido: "Pérez", email: "dueno@demo.com", telefono: "+54 387 4998877", dni: "20.111.222", rol: "dueno", activo: true, created_at: isoFromOffset(-200).toISOString() };
  const uMuni     = { id: uid(), nombre: "Laura", apellido: "Gómez", email: "municipio@demo.com", telefono: "+54 387 4100100", dni: "27.654.321", rol: "admin_municipal", activo: true, created_at: isoFromOffset(-300).toISOString() };
  const uAdmin    = { id: uid(), nombre: "Sofía", apellido: "Díaz", email: "admin@demo.com", telefono: "+54 387 4555000", dni: "30.222.111", rol: "admin_sistema", activo: true, created_at: isoFromOffset(-300).toISOString() };
  const usuarios = [uPescador, uDueno, uMuni, uAdmin];

  /* --- Catamaranes (datos de los prototipos del TFG) --- */
  const catData = [
    { nombre: "Don Juan II", capacidad: 20, precio: 8000, estado: "activa",        prop: uDueno.id, hab: "HAB-2024-018", desc: "Catamarán techado con baño y cocina. Salidas diarias al espejo de agua." },
    { nombre: "El Pato",     capacidad: 16, precio: 7500, estado: "activa",        prop: uDueno.id, hab: "HAB-2024-007", desc: "Embarcación familiar, ideal para grupos pequeños y principiantes." },
    { nombre: "La Victoria", capacidad: 18, precio: 8500, estado: "activa",        prop: null,      hab: "HAB-2023-031", desc: "Cubierta amplia y sombra. Equipamiento de pesca incluido." },
    { nombre: "Don Pescador",capacidad: 12, precio: 9500, estado: "activa",        prop: null,      hab: "HAB-2024-022", desc: "Salidas premium con guía de pesca especializado." },
    { nombre: "Lago Azul",   capacidad: 14, precio: 8000, estado: "mantenimiento", prop: null,      hab: "HAB-2022-014", desc: "Temporalmente fuera de servicio por mantenimiento de motor." },
  ];
  const catamaranes = [], lugares = [];
  for (const c of catData) {
    const id = uid();
    catamaranes.push({ id, id_propietario: c.prop, nombre: c.nombre, descripcion: c.desc, capacidad: c.capacidad, precio: c.precio, habilitacion: c.hab, estado: c.estado, created_at: isoFromOffset(-150).toISOString() });
    const ubic = ["proa", "babor", "estribor", "popa"];
    for (let n = 1; n <= c.capacidad; n++)
      lugares.push({ id: uid(), id_catamaran: id, numero: n, ubicacion: ubic[(n - 1) % 4], activo: true });
  }
  const activos = catamaranes.filter((c) => c.estado === "activa");

  /* --- Reservas / asientos / pagos / permisos sintéticos --- */
  const reservas = [], reserva_lugar = [], pagos = [], permisos = [], notificaciones = [];
  let seq = 215;
  const metodos = ["tarjeta", "transferencia", "mercadopago", "efectivo"];
  const lugaresDe = (catId) => lugares.filter((l) => l.id_catamaran === catId);
  const ocupadoSet = new Set(); // `${lugarId}|${fecha}`

  function crearReservaDemo({ cat, fecha, turno, nLugares, especie, estadoReserva, tipo, titular }) {
    const libres = lugaresDe(cat.id).filter((l) => !ocupadoSet.has(`${l.id}|${fecha}`));
    if (!libres.length) return;
    const elegidos = [];
    for (let k = 0; k < nLugares && libres.length; k++) {
      const idx = Math.floor(rnd() * libres.length);
      elegidos.push(libres.splice(idx, 1)[0]);
    }
    const monto = cat.precio * elegidos.length;
    const rId = uid();
    reservas.push({ id: rId, id_usuario: titular.id, id_catamaran: cat.id, fecha, turno, estado: estadoReserva, cantidad_lugares: elegidos.length, monto_total: monto, created_at: new Date(fecha + "T10:00:00").toISOString() });
    const cancel = estadoReserva === "cancelada";
    for (const l of elegidos) {
      reserva_lugar.push({ id: uid(), id_reserva: rId, id_lugar: l.id, fecha, estado: cancel ? "cancelada" : "confirmada" });
      if (!cancel) ocupadoSet.add(`${l.id}|${fecha}`);
    }
    pagos.push({ id: uid(), id_reserva: rId, monto, metodo: pick(metodos), estado: cancel ? "rechazado" : "aprobado", comprobante: "CMP-" + rId.replace(/-/g, "").slice(0, 10).toUpperCase(), fecha_pago: new Date(fecha + "T10:05:00").toISOString() });

    const numero = "PCC-" + String(seq++).padStart(6, "0");
    const emision = new Date(fecha + "T10:05:00");
    const vence = new Date(emision);
    if (tipo === "anual") vence.setFullYear(vence.getFullYear() + 1);
    else if (tipo === "semanal") vence.setDate(vence.getDate() + 7);
    else vence.setHours(23, 59, 0, 0);
    let estadoP = cancel ? "anulado" : (vence.getTime() < Date.now() ? "vencido" : "vigente");
    permisos.push({
      id: uid(), id_reserva: rId, id_usuario: titular.id, id_especie: especie.id,
      numero, tipo, codigo_qr: `${numero}|${titular.id}|${fecha}`,
      fecha_emision: emision.toISOString(), fecha_vencimiento: vence.toISOString(), estado: estadoP,
    });
    return { rId, numero };
  }

  // Histórico: ~38 reservas entre hace 30 días y hoy.
  const especiePesos = [pejerrey, pejerrey, pejerrey, especies[2], especies[1], especies[3]];
  for (let i = 0; i < 38; i++) {
    const off = -Math.floor(rnd() * 30);
    const fecha = dateISO(isoFromOffset(off));
    const cat = pick(activos);
    const past = off < 0;
    const estadoReserva = i % 19 === 0 ? "cancelada" : (past ? (rnd() < 0.7 ? "completada" : "confirmada") : "confirmada");
    crearReservaDemo({ cat, fecha, turno: rnd() < 0.6 ? "manana" : "tarde", nLugares: 1 + Math.floor(rnd() * 4), especie: pick(especiePesos), estadoReserva, tipo: rnd() < 0.85 ? "diario" : (rnd() < 0.5 ? "semanal" : "anual"), titular: uPescador });
  }

  // Reservas próximas (hoy + 3 días) en los catamaranes visibles, para que la
  // grilla de asientos muestre lugares ocupados al demostrar la reserva.
  const donJuan = catamaranes.find((c) => c.nombre === "Don Juan II");
  const elPato  = catamaranes.find((c) => c.nombre === "El Pato");
  [[donJuan, 0, 6], [donJuan, 1, 4], [elPato, 0, 3], [elPato, 2, 5], [donJuan, 2, 8]].forEach(([cat, off, n]) =>
    crearReservaDemo({ cat, fecha: dateISO(isoFromOffset(off)), turno: "manana", nLugares: n, especie: pejerrey, estadoReserva: "confirmada", tipo: "diario", titular: uPescador })
  );

  // La reserva más reciente del pescador queda destacada con su permiso "estrella".
  permisos.slice(-1).forEach((p) => { /* asegura vigente para la demo */ if (p.estado === "vencido") p.estado = "vigente"; });

  /* --- Notificaciones del pescador --- */
  const ultReservas = reservas.filter((r) => r.id_usuario === uPescador.id && r.estado !== "cancelada").slice(-3).reverse();
  ultReservas.forEach((r, i) => {
    notificaciones.push({ id: uid(), id_usuario: uPescador.id, tipo: "reserva", titulo: "Reserva confirmada", mensaje: `Tu reserva del ${r.fecha.split("-").reverse().join("/")} fue confirmada.`, leida: i > 0, created_at: new Date(r.fecha + "T10:06:00").toISOString() });
  });
  notificaciones.push({ id: uid(), id_usuario: uPescador.id, tipo: "recordatorio", titulo: "Recordatorio de salida", mensaje: "Recordá presentar tu permiso digital al embarcar.", leida: false, created_at: isoFromOffset(-1, 9).toISOString() });

  /* --- Alertas de fauna (HU-015) con números realistas para la demo --- */
  const periodo = (() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`; })();
  const alertas = [
    { id: uid(), id_especie: pejerrey.id, periodo, permisos_emitidos: 372, umbral: 400, estado: "activa", created_at: isoFromOffset(-2).toISOString() },
    { id: uid(), id_especie: especies[1].id, periodo, permisos_emitidos: 138, umbral: 150, estado: "activa", created_at: isoFromOffset(-3).toISOString() },
    { id: uid(), id_especie: especies[2].id, periodo, permisos_emitidos: 210, umbral: 300, estado: "activa", created_at: isoFromOffset(-5).toISOString() },
  ];

  DB = { __v: 2, usuarios, especies, catamaranes, lugares, reservas, reserva_lugar, pagos, permisos, notificaciones, alertas, reportes: [], seq, passwords: {}, session: null };
  saveDB(DB);
}

function persist() { if (DB) saveDB(DB); }
function emitAuth(event = "DEMO") { authListeners.forEach((fn) => fn(event)); }

/* ---- helpers demo ---- */
const byId = (arr, id) => arr.find((x) => x.id === id);
function demoSessionUser() {
  if (!DB?.session?.userId) return null;
  return byId(DB.usuarios, DB.session.userId) || null;
}
function demoPassword(email) {
  return DB.passwords[email] || DEMO_PASS; // cuentas sembradas usan Demo1234!
}
function applyPermisoEstado(p) {
  if (p.estado === "anulado") return p;
  if (p.estado !== "vencido" && new Date(p.fecha_vencimiento).getTime() < Date.now())
    return { ...p, estado: "vencido" };
  return p;
}

/* ============================================================================
 *  AUTENTICACIÓN
 * ========================================================================== */
export function onAuthChange(fn) {
  authListeners.add(fn);
  return () => authListeners.delete(fn);
}

export async function getSession() {
  await ready();
  if (MODE === "supabase") {
    const { data } = await sb.auth.getSession();
    if (!data.session) return null;
    const profile = await fetchProfileSupabase(data.session.user.id);
    return { user: { id: data.session.user.id, email: data.session.user.email }, profile };
  }
  const u = demoSessionUser();
  return u ? { user: { id: u.id, email: u.email }, profile: u } : null;
}

async function fetchProfileSupabase(id) {
  const { data, error } = await sb.from("usuario").select("*").eq("id", id).single();
  if (error) return null;
  return data;
}

/* ---- Bloqueo temporal por intentos fallidos (HU-002 · criterio 3) ----
 * En modo Supabase el registro vive en la tabla intento_acceso (funciones
 * acceso_bloqueado / registrar_intento_acceso, ver database/migrations/002).
 * Si esas funciones no existen todavía, se usa un registro local por email. */
function loadLocks() { try { return JSON.parse(localStorage.getItem(LOCK_KEY)) || {}; } catch { return {}; } }
function saveLocks(l) { try { localStorage.setItem(LOCK_KEY, JSON.stringify(l)); } catch {} }
function lockEstadoLocal(email) {
  const l = loadLocks(); const e = l[email];
  if (!e) return { bloqueado: false, intentos: 0, restantes: MAX_INTENTOS, minutos: 0 };
  if (e.hasta && e.hasta > Date.now())
    return { bloqueado: true, intentos: e.intentos, restantes: 0, minutos: Math.max(1, Math.ceil((e.hasta - Date.now()) / 60000)) };
  if (e.hasta && e.hasta <= Date.now()) { delete l[email]; saveLocks(l); return { bloqueado: false, intentos: 0, restantes: MAX_INTENTOS, minutos: 0 }; }
  return { bloqueado: false, intentos: e.intentos, restantes: Math.max(0, MAX_INTENTOS - e.intentos), minutos: 0 };
}
function registrarIntentoLocal(email, exitoso) {
  const l = loadLocks();
  if (exitoso) { delete l[email]; saveLocks(l); return lockEstadoLocal(email); }
  const prev = l[email];
  const e = prev && !(prev.hasta && prev.hasta <= Date.now()) ? prev : { intentos: 0, hasta: null };
  e.intentos += 1;
  if (e.intentos >= MAX_INTENTOS) e.hasta = Date.now() + BLOQUEO_MINUTOS * 60000;
  l[email] = e; saveLocks(l);
  return lockEstadoLocal(email);
}
function normalizarLock(d) {
  const intentos = Number(d.intentos) || 0;
  return { bloqueado: Boolean(d.bloqueado), intentos, restantes: Math.max(0, MAX_INTENTOS - intentos), minutos: Number(d.minutos_restantes) || 0 };
}
const esFuncionInexistente = (err) => /PGRST202|could not find the function|does not exist/i.test(String(err?.message || err?.code || ""));

async function lockEstado(email) {
  if (MODE === "supabase") {
    const { data, error } = await sb.rpc("acceso_bloqueado", { p_email: email });
    if (!error && data) return normalizarLock(data);
    if (error && !esFuncionInexistente(error)) console.warn("acceso_bloqueado:", error.message);
  }
  return lockEstadoLocal(email);
}
async function registrarIntento(email, exitoso) {
  if (MODE === "supabase") {
    const { data, error } = await sb.rpc("registrar_intento_acceso", { p_email: email, p_exitoso: exitoso });
    if (!error && data) return normalizarLock(data);
    if (error && !esFuncionInexistente(error)) console.warn("registrar_intento_acceso:", error.message);
  }
  return registrarIntentoLocal(email, exitoso);
}
/** Estado de bloqueo de una cuenta (para mostrarlo en la pantalla de login). */
export async function estadoBloqueo(email) {
  await ready();
  return lockEstado((email || "").trim().toLowerCase());
}
function msgBloqueo(estado) {
  const min = estado.minutos || BLOQUEO_MINUTOS;
  return `Cuenta bloqueada temporalmente por ${MAX_INTENTOS} intentos fallidos consecutivos. ` +
         `Volvé a intentar en ${min} minuto${min === 1 ? "" : "s"} o recuperá tu contraseña.`;
}
const esCredencialInvalida = (msg = "") => /invalid login|invalid credentials|invalid_credentials/i.test(msg);

export async function signIn(email, password) {
  await ready();
  email = (email || "").trim().toLowerCase();
  const previo = await lockEstado(email);
  if (previo.bloqueado) throw new Error(msgBloqueo(previo));

  let ok = false;
  if (MODE === "supabase") {
    const { error } = await sb.auth.signInWithPassword({ email, password });
    ok = !error;
    // Errores que no son "credencial incorrecta" (p. ej. email sin confirmar) no cuentan como intento.
    if (error && !esCredencialInvalida(error.message)) throw new Error(traducirAuth(error.message));
  } else {
    const u = DB.usuarios.find((x) => x.email.toLowerCase() === email);
    ok = Boolean(u && demoPassword(u.email) === password);
    if (ok) { DB.session = { userId: u.id }; persist(); }
  }

  const estado = await registrarIntento(email, ok);
  if (!ok) {
    if (estado.bloqueado) throw new Error(msgBloqueo(estado));
    const r = estado.restantes;
    throw new Error(`Email o contraseña incorrectos. ${r === 1 ? "Te queda 1 intento" : `Te quedan ${r} intentos`} antes del bloqueo temporal.`);
  }
  if (MODE === "demo") emitAuth("SIGNED_IN");
  return true;
}

/* ---- Recuperación de contraseña por correo electrónico (Seguridad) ---- */
export async function solicitarRecuperacion(email) {
  await ready();
  email = (email || "").trim().toLowerCase();
  if (!email) throw new Error("Ingresá tu email.");
  if (MODE === "supabase") {
    // Supabase envía un enlace; al volver, la app detecta PASSWORD_RECOVERY y muestra #/restablecer.
    const redirectTo = location.origin + location.pathname;
    const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo });
    if (error) throw new Error(traducirAuth(error.message));
    return { simulado: false };
  }
  // Demo: no hay correo real; el "enlace" se simula habilitando el cambio de clave en esta pestaña.
  const existe = DB.usuarios.some((x) => x.email.toLowerCase() === email);
  if (existe) { try { sessionStorage.setItem(RECOVERY_KEY, JSON.stringify({ email, demo: true })); } catch {} }
  return { simulado: true, existe };
}
export function recuperacionPendiente() {
  try { return JSON.parse(sessionStorage.getItem(RECOVERY_KEY)); } catch { return null; }
}
export function limpiarRecuperacion() { try { sessionStorage.removeItem(RECOVERY_KEY); } catch {} }

export async function actualizarPassword(nueva) {
  await ready();
  if (MODE === "supabase") {
    const { error } = await sb.auth.updateUser({ password: nueva });
    if (error) throw new Error(traducirAuth(error.message));
    const { data } = await sb.auth.getSession();
    if (data.session?.user?.email) await registrarIntento(data.session.user.email.toLowerCase(), true);
    limpiarRecuperacion(); emitAuth("USER_UPDATED");
    return true;
  }
  const rec = recuperacionPendiente();
  if (!rec?.email) throw new Error("No hay una recuperación de contraseña en curso.");
  const u = DB.usuarios.find((x) => x.email.toLowerCase() === rec.email);
  if (!u) throw new Error("La cuenta no existe.");
  DB.passwords[u.email.toLowerCase()] = nueva;
  registrarIntentoLocal(u.email.toLowerCase(), true);   // se levanta cualquier bloqueo
  DB.session = { userId: u.id }; persist();
  limpiarRecuperacion(); emitAuth("USER_UPDATED");
  return true;
}

export async function signUp({ nombre, apellido, email, telefono, dni, rol = "pescador", password }) {
  await ready();
  email = (email || "").trim().toLowerCase();
  if (MODE === "supabase") {
    const { error } = await sb.auth.signUp({
      email, password,
      options: { data: { nombre, apellido, telefono, dni, rol } },
    });
    if (error) throw new Error(traducirAuth(error.message));
    return true;
  }
  if (DB.usuarios.some((x) => x.email.toLowerCase() === email))
    throw new Error("Ya existe una cuenta con ese email.");
  const u = { id: uid(), nombre, apellido: apellido || "", email, telefono: telefono || "", dni: dni || "", rol, activo: true, created_at: new Date().toISOString() };
  DB.usuarios.push(u);
  DB.passwords[email] = password;
  DB.session = { userId: u.id };
  persist(); emitAuth();
  return true;
}

export async function signOut() {
  await ready();
  if (MODE === "supabase") { await sb.auth.signOut(); return; }
  DB.session = null; persist(); emitAuth();
}

export async function updateProfile(patch) {
  await ready();
  if (MODE === "supabase") {
    const { data: s } = await sb.auth.getSession();
    const id = s.session?.user?.id;
    const { error } = await sb.from("usuario").update(patch).eq("id", id);
    if (error) throw new Error(error.message);
    emitAuth();
    return true;
  }
  const u = demoSessionUser();
  Object.assign(u, patch); persist(); emitAuth();
  return true;
}

function traducirAuth(msg = "") {
  const m = msg.toLowerCase();
  if (m.includes("invalid login") || m.includes("invalid credentials")) return "Email o contraseña incorrectos.";
  if (m.includes("already registered") || m.includes("already exists")) return "Ya existe una cuenta con ese email.";
  if (m.includes("not confirmed")) return "Tenés que confirmar tu email antes de ingresar.";
  if (m.includes("rate limit") || m.includes("too many")) return "Demasiados intentos. Esperá unos minutos y volvé a probar.";
  if (m.includes("same password") || m.includes("different from the old")) return "La nueva contraseña debe ser distinta de la anterior.";
  if (m.includes("auth session missing") || m.includes("session")) return "El enlace de recuperación no es válido o expiró. Solicitá uno nuevo.";
  if (m.includes("password")) return "La contraseña no cumple los requisitos mínimos.";
  if (m.includes("email")) return "Revisá el email ingresado.";
  return msg || "No se pudo completar la operación.";
}

/* ============================================================================
 *  CATAMARANES Y LUGARES
 * ========================================================================== */
export async function listCatamaranes() {
  await ready();
  if (MODE === "supabase") {
    const { data, error } = await sb.from("catamaran").select("*").order("nombre");
    if (error) throw error; return data;
  }
  return [...DB.catamaranes].sort((a, b) => a.nombre.localeCompare(b.nombre));
}

export async function getCatamaran(id) {
  await ready();
  if (MODE === "supabase") {
    const { data, error } = await sb.from("catamaran").select("*").eq("id", id).single();
    if (error) throw error; return data;
  }
  return byId(DB.catamaranes, id) || null;
}

export async function getLugares(catId) {
  await ready();
  if (MODE === "supabase") {
    const { data, error } = await sb.from("lugar").select("*").eq("id_catamaran", catId).order("numero");
    if (error) throw error; return data;
  }
  return DB.lugares.filter((l) => l.id_catamaran === catId).sort((a, b) => a.numero - b.numero);
}

/* Lugares ocupados (confirmados) en una fecha, para todos los catamaranes.
 * En Supabase se lee la vista v_lugares_ocupados (migración 002), que muestra
 * la ocupación sin revelar quién reservó; si no existe, se consulta la tabla
 * (limitada por RLS a lo que el usuario puede ver). */
async function ocupadosPorFecha(fecha) {
  if (MODE === "supabase") {
    let rows = null;
    const v = await sb.from("v_lugares_ocupados").select("id_lugar, id_catamaran").eq("fecha", fecha);
    if (!v.error) rows = v.data;
    else {
      const t = await sb.from("reserva_lugar").select("id_lugar, lugar!inner(id_catamaran)").eq("fecha", fecha).eq("estado", "confirmada");
      if (t.error) throw t.error;
      rows = t.data.map((r) => ({ id_lugar: r.id_lugar, id_catamaran: r.lugar?.id_catamaran }));
    }
    return rows;
  }
  const lugarCat = new Map(DB.lugares.map((l) => [l.id, l.id_catamaran]));
  return DB.reserva_lugar.filter((rl) => rl.fecha === fecha && rl.estado === "confirmada")
    .map((rl) => ({ id_lugar: rl.id_lugar, id_catamaran: lugarCat.get(rl.id_lugar) }));
}

/** Devuelve un array con los IDs de lugar ocupados para esa fecha. */
export async function getOcupacion(catId, fecha) {
  await ready();
  return (await ocupadosPorFecha(fecha)).filter((r) => r.id_catamaran === catId).map((r) => r.id_lugar);
}

/** Catamaranes con lugares libres/ocupados para una fecha (HU-004). */
export async function disponibilidad(fecha) {
  await ready();
  const [cats, ocupados] = await Promise.all([listCatamaranes(), ocupadosPorFecha(fecha)]);
  const porCat = new Map();
  ocupados.forEach((r) => porCat.set(r.id_catamaran, (porCat.get(r.id_catamaran) || 0) + 1));
  return cats.map((c) => {
    const ocup = porCat.get(c.id) || 0;
    return { ...c, ocupados: ocup, libres: Math.max(0, Number(c.capacidad) - ocup) };
  });
}

/* ============================================================================
 *  PAGO (HU-007) · pasarela simulada
 *  El prototipo no se integra con una pasarela real: simula la autorización.
 *  Reglas de prueba: tarjeta/Mercado Pago requieren número (13-19 dígitos),
 *  vencimiento MM/AA vigente y CVV; un número terminado en 0000 se rechaza
 *  (escenario "pago fallido" de la matriz de casos de prueba).
 * ========================================================================== */
export async function procesarPago({ metodo = "tarjeta", monto = 0, tarjeta = {} } = {}) {
  await new Promise((r) => setTimeout(r, 700));   // latencia de la pasarela
  if (!(Number(monto) > 0)) return { aprobado: false, motivo: "El importe a pagar no es válido." };
  if (metodo === "tarjeta" || metodo === "mercadopago") {
    const num = String(tarjeta.numero || "").replace(/\s+/g, "");
    if (!/^\d{13,19}$/.test(num)) return { aprobado: false, motivo: "Número de tarjeta inválido." };
    if (!String(tarjeta.titular || "").trim()) return { aprobado: false, motivo: "Ingresá el nombre del titular." };
    const mv = /^(\d{2})\/(\d{2})$/.exec(String(tarjeta.vencimiento || "").trim());
    if (!mv || +mv[1] < 1 || +mv[1] > 12) return { aprobado: false, motivo: "Vencimiento inválido (usá MM/AA)." };
    const hoy = new Date();
    if (2000 + +mv[2] < hoy.getFullYear() || (2000 + +mv[2] === hoy.getFullYear() && +mv[1] < hoy.getMonth() + 1))
      return { aprobado: false, motivo: "La tarjeta está vencida." };
    if (!/^\d{3,4}$/.test(String(tarjeta.cvv || ""))) return { aprobado: false, motivo: "Código de seguridad inválido." };
    if (num.endsWith("0000")) return { aprobado: false, motivo: "Transacción rechazada por la entidad emisora. Probá con otro medio de pago." };
  }
  return { aprobado: true, autorizacion: "AUT-" + Math.random().toString(36).slice(2, 8).toUpperCase() };
}

export async function crearReserva({ catamaranId, fecha, turno, lugares, metodo = "tarjeta", tipoPermiso = "diario", especieId = null }) {
  await ready();
  if (MODE === "supabase") {
    const { data, error } = await sb.rpc("crear_reserva_completa", {
      p_id_catamaran: catamaranId, p_fecha: fecha, p_turno: turno,
      p_lugares: lugares, p_metodo_pago: metodo, p_tipo_permiso: tipoPermiso, p_id_especie: especieId,
    });
    if (error) throw new Error(error.message);
    return data;
  }
  // Demo: replica la lógica del RPC crear_reserva_completa.
  const u = demoSessionUser();
  const cat = byId(DB.catamaranes, catamaranId);
  if (!cat) throw new Error("El catamarán no existe.");
  if (!lugares?.length) throw new Error("Elegí al menos un lugar.");
  for (const lid of lugares) {
    const ocupado = DB.reserva_lugar.some((rl) => rl.id_lugar === lid && rl.fecha === fecha && rl.estado === "confirmada");
    if (ocupado) throw new Error("Uno de los lugares ya fue reservado. Actualizá la grilla.");
  }
  const monto = cat.precio * lugares.length;
  const rId = uid();
  DB.reservas.push({ id: rId, id_usuario: u.id, id_catamaran: cat.id, fecha, turno: turno || "manana", estado: "confirmada", cantidad_lugares: lugares.length, monto_total: monto, created_at: new Date().toISOString() });
  for (const lid of lugares)
    DB.reserva_lugar.push({ id: uid(), id_reserva: rId, id_lugar: lid, fecha, estado: "confirmada" });
  DB.pagos.push({ id: uid(), id_reserva: rId, monto, metodo, estado: "aprobado", comprobante: "CMP-" + rId.replace(/-/g, "").slice(0, 10).toUpperCase(), fecha_pago: new Date().toISOString() });

  const numero = "PCC-" + String(DB.seq++).padStart(6, "0");
  const emision = new Date();
  const vence = new Date(fecha + "T23:59:00");
  if (tipoPermiso === "anual") { vence.setTime(new Date(fecha).getTime()); vence.setFullYear(vence.getFullYear() + 1); }
  else if (tipoPermiso === "semanal") { vence.setTime(new Date(fecha).getTime()); vence.setDate(vence.getDate() + 7); }
  const pId = uid();
  const codigo = `${numero}|${u.id}|${fecha}`;
  DB.permisos.push({ id: pId, id_reserva: rId, id_usuario: u.id, id_especie: especieId, numero, tipo: tipoPermiso, codigo_qr: codigo, fecha_emision: emision.toISOString(), fecha_vencimiento: vence.toISOString(), estado: "vigente" });
  DB.notificaciones.unshift({ id: uid(), id_usuario: u.id, tipo: "reserva", titulo: "Reserva confirmada", mensaje: `Tu reserva del ${fecha.split("-").reverse().join("/")} fue confirmada. Permiso ${numero}.`, leida: false, created_at: emision.toISOString() });
  persist();
  return { reserva_id: rId, permiso_id: pId, numero_permiso: numero, monto_total: monto, codigo_qr: codigo, fecha_vencimiento: vence.toISOString() };
}

export async function anularReserva(reservaId) {
  await ready();
  if (MODE === "supabase") {
    const { error } = await sb.rpc("anular_reserva", { p_id_reserva: reservaId });
    if (error) throw new Error(error.message);
    return true;
  }
  const r = byId(DB.reservas, reservaId);
  if (!r) throw new Error("La reserva no existe.");
  r.estado = "cancelada";
  DB.reserva_lugar.filter((rl) => rl.id_reserva === reservaId).forEach((rl) => (rl.estado = "cancelada"));
  DB.permisos.filter((p) => p.id_reserva === reservaId).forEach((p) => (p.estado = "anulado"));
  persist();
  return true;
}

/* ============================================================================
 *  RESERVAS Y PERMISOS DEL USUARIO
 * ========================================================================== */
function scopeReservasDemo(u) {
  if (u.rol === "admin_municipal" || u.rol === "admin_sistema") return DB.reservas;
  if (u.rol === "dueno") {
    const mis = new Set(DB.catamaranes.filter((c) => c.id_propietario === u.id).map((c) => c.id));
    return DB.reservas.filter((r) => mis.has(r.id_catamaran));
  }
  return DB.reservas.filter((r) => r.id_usuario === u.id);
}

export async function listReservas() {
  await ready();
  if (MODE === "supabase") {
    const { data, error } = await sb.from("reserva")
      .select("*, catamaran(nombre), permiso(id,numero,estado)")
      .order("fecha", { ascending: false });
    if (error) throw error;
    return data.map((r) => {
      // PostgREST devuelve la relación 1‑a‑1 (permiso) como objeto; 1‑a‑N como arreglo.
      const per = Array.isArray(r.permiso) ? r.permiso[0] : r.permiso;
      return {
        ...r, catamaran_nombre: r.catamaran?.nombre || "",
        permiso_id: per?.id || null, numero_permiso: per?.numero || null,
      };
    });
  }
  const u = demoSessionUser();
  return scopeReservasDemo(u)
    .slice().sort((a, b) => (a.fecha < b.fecha ? 1 : -1))
    .map((r) => {
      const cat = byId(DB.catamaranes, r.id_catamaran);
      const per = DB.permisos.find((p) => p.id_reserva === r.id);
      return { ...r, catamaran_nombre: cat?.nombre || "", permiso_id: per?.id || null, numero_permiso: per?.numero || null };
    });
}

function scopePermisosDemo(u) {
  if (u.rol === "admin_municipal" || u.rol === "admin_sistema") return DB.permisos;
  if (u.rol === "dueno") {
    const mis = new Set(DB.catamaranes.filter((c) => c.id_propietario === u.id).map((c) => c.id));
    const res = new Set(DB.reservas.filter((r) => mis.has(r.id_catamaran)).map((r) => r.id));
    return DB.permisos.filter((p) => res.has(p.id_reserva));
  }
  return DB.permisos.filter((p) => p.id_usuario === u.id);
}

export async function listPermisos() {
  await ready();
  if (MODE === "supabase") {
    const { data, error } = await sb.from("permiso")
      .select("*, especie(nombre), reserva(fecha,turno,catamaran(nombre))")
      .order("fecha_emision", { ascending: false });
    if (error) throw error;
    return data.map(mapPermisoSupabase);
  }
  const u = demoSessionUser();
  return scopePermisosDemo(u)
    .slice().sort((a, b) => (a.fecha_emision < b.fecha_emision ? 1 : -1))
    .map((p) => enrichPermisoDemo(applyPermisoEstado(p)));
}

export async function getPermiso(id) {
  await ready();
  if (MODE === "supabase") {
    const { data, error } = await sb.from("permiso")
      .select("*, especie(nombre,nombre_cientifico), reserva(fecha,turno,cantidad_lugares,monto_total,catamaran(nombre),pago(comprobante,metodo,estado)), usuario(nombre,apellido,dni)")
      .eq("id", id).single();
    if (error) throw error;
    return mapPermisoSupabase(data, true);
  }
  const p = byId(DB.permisos, id);
  if (!p) return null;
  return enrichPermisoDemo(applyPermisoEstado(p), true);
}

function enrichPermisoDemo(p, full = false) {
  const r = byId(DB.reservas, p.id_reserva);
  const cat = r ? byId(DB.catamaranes, r.id_catamaran) : null;
  const esp = p.id_especie ? byId(DB.especies, p.id_especie) : null;
  const titular = byId(DB.usuarios, p.id_usuario);
  const base = {
    ...p, especie_nombre: esp?.nombre || "—", catamaran_nombre: cat?.nombre || "—",
    fecha: r?.fecha || null, turno: r?.turno || null,
    titular_nombre: titular ? `${titular.nombre} ${titular.apellido}`.trim() : "—",
    titular_dni: titular?.dni || "—",
  };
  if (full) {
    const pago = r ? DB.pagos.find((x) => x.id_reserva === r.id) : null;
    base.especie_cientifico = esp?.nombre_cientifico || "";
    base.cantidad_lugares = r?.cantidad_lugares || 0;
    base.monto_total = r?.monto_total || 0;
    base.pago_comprobante = pago?.comprobante || "";
    base.pago_metodo = pago?.metodo || "";
  }
  return base;
}

function mapPermisoSupabase(p, full = false) {
  const r = p.reserva || {};
  const out = {
    ...p, especie_nombre: p.especie?.nombre || "—",
    catamaran_nombre: r.catamaran?.nombre || "—",
    fecha: r.fecha || null, turno: r.turno || null,
    titular_nombre: p.usuario ? `${p.usuario.nombre} ${p.usuario.apellido || ""}`.trim() : "—",
    titular_dni: p.usuario?.dni || "—",
  };
  if (full) {
    const pago = Array.isArray(r.pago) ? r.pago[0] : r.pago;
    out.especie_cientifico = p.especie?.nombre_cientifico || "";
    out.cantidad_lugares = r.cantidad_lugares || 0;
    out.monto_total = r.monto_total || 0;
    out.pago_comprobante = pago?.comprobante || "";
    out.pago_metodo = pago?.metodo || "";
  }
  return out;
}

/* ============================================================================
 *  NOTIFICACIONES
 * ========================================================================== */
export async function listNotificaciones() {
  await ready();
  if (MODE === "supabase") {
    const { data, error } = await sb.from("notificacion").select("*").order("created_at", { ascending: false }).limit(30);
    if (error) throw error; return data;
  }
  const u = demoSessionUser();
  return DB.notificaciones.filter((n) => n.id_usuario === u.id).slice().sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
}

export async function marcarLeidas() {
  await ready();
  if (MODE === "supabase") {
    const { data: s } = await sb.auth.getSession();
    const { error } = await sb.from("notificacion").update({ leida: true }).eq("id_usuario", s.session.user.id).eq("leida", false);
    if (error) throw error; emitAuth(); return true;
  }
  const u = demoSessionUser();
  DB.notificaciones.filter((n) => n.id_usuario === u.id).forEach((n) => (n.leida = true));
  persist(); emitAuth();
  return true;
}

/* Preferencia del usuario (HU-011 · criterio 3): recibir recordatorios de salida.
 * Se guarda en el dispositivo; por defecto activada. */
export function prefRecordatorios() {
  try { return localStorage.getItem(PREF_RECORDATORIOS) !== "0"; } catch { return true; }
}
export function setPrefRecordatorios(on) {
  try { localStorage.setItem(PREF_RECORDATORIOS, on ? "1" : "0"); } catch {}
}

/* Recordatorios de salida (HU-011 · criterio 2): genera una notificación para
 * cada reserva confirmada de hoy o mañana que aún no tenga recordatorio.
 * En Supabase lo hace la función generar_recordatorios (migración 002; además
 * pg_cron la ejecuta a diario para todos los usuarios). */
export async function generarRecordatorios() {
  await ready();
  if (!prefRecordatorios()) return 0;
  if (MODE === "supabase") {
    const { data, error } = await sb.rpc("generar_recordatorios", { p_solo_usuario: true });
    if (error) { if (!esFuncionInexistente(error)) console.warn("generar_recordatorios:", error.message); return 0; }
    if (Number(data) > 0) emitAuth("NOTIF");
    return Number(data) || 0;
  }
  const u = demoSessionUser();
  if (!u) return 0;
  const hoy = todayISO(), manana = dateISO(isoFromOffset(1));
  let n = 0;
  DB.reservas.filter((r) => r.id_usuario === u.id && r.estado === "confirmada" && (r.fecha === hoy || r.fecha === manana)).forEach((r) => {
    if (DB.notificaciones.some((x) => x.tipo === "recordatorio" && x.id_reserva === r.id)) return;
    const cat = byId(DB.catamaranes, r.id_catamaran);
    DB.notificaciones.unshift({
      id: uid(), id_usuario: u.id, id_reserva: r.id, tipo: "recordatorio", titulo: "Recordatorio de salida",
      mensaje: `Tu salida en ${cat?.nombre || "el catamarán"} es ${r.fecha === hoy ? "hoy" : "mañana"} (${r.fecha.split("-").reverse().join("/")}), turno ${r.turno === "tarde" ? "tarde" : "mañana"}. Recordá presentar tu permiso digital al embarcar.`,
      leida: false, created_at: new Date().toISOString(),
    });
    n++;
  });
  if (n) persist();
  return n;
}

/* ============================================================================
 *  ESPECIES (fauna)
 * ========================================================================== */
export async function listEspecies() {
  await ready();
  if (MODE === "supabase") {
    const { data, error } = await sb.from("especie").select("*").order("nombre");
    if (error) throw error; return data;
  }
  return [...DB.especies].sort((a, b) => a.nombre.localeCompare(b.nombre));
}

/* ============================================================================
 *  PANEL MUNICIPAL / REPORTES
 * ========================================================================== */
export async function dashboardResumen() {
  await ready();
  if (MODE === "supabase") {
    const { data, error } = await sb.from("v_dashboard_resumen").select("*").single();
    if (error) throw error; return data;
  }
  const hoy = todayISO();
  const conf = (r) => r.estado !== "cancelada";
  const permisosVig = DB.permisos.map(applyPermisoEstado);
  return {
    reservas_hoy: DB.reservas.filter((r) => r.fecha === hoy && conf(r)).length,
    reservas_total: DB.reservas.filter(conf).length,
    permisos_vigentes: permisosVig.filter((p) => p.estado === "vigente").length,
    permisos_total: DB.permisos.length,
    ingresos_total: DB.pagos.filter((p) => p.estado === "aprobado").reduce((s, p) => s + p.monto, 0),
    usuarios_pescadores: DB.usuarios.filter((u) => u.rol === "pescador").length,
    alertas_activas: DB.alertas.filter((a) => a.estado === "activa").length,
  };
}

export async function reservasPorDia({ from, to } = {}) {
  await ready();
  if (MODE === "supabase") {
    let q = sb.from("v_reservas_por_dia").select("*");
    if (from) q = q.gte("fecha", from);
    if (to) q = q.lte("fecha", to);
    const { data, error } = await q;
    if (error) throw error; return data;
  }
  const map = new Map();
  DB.reservas.filter((r) => r.estado === "confirmada" || r.estado === "completada")
    .filter((r) => (!from || r.fecha >= from) && (!to || r.fecha <= to))
    .forEach((r) => {
      const e = map.get(r.fecha) || { fecha: r.fecha, cantidad_reservas: 0, ingresos: 0 };
      e.cantidad_reservas++; e.ingresos += r.monto_total; map.set(r.fecha, e);
    });
  return [...map.values()].sort((a, b) => (a.fecha < b.fecha ? -1 : 1));
}

export async function ocupacionCatamaranes() {
  await ready();
  if (MODE === "supabase") {
    const { data, error } = await sb.from("v_ocupacion_catamaran").select("*");
    if (error) throw error; return data;
  }
  return DB.catamaranes.map((c) => {
    const ids = new Set(DB.lugares.filter((l) => l.id_catamaran === c.id).map((l) => l.id));
    const ocup = DB.reserva_lugar.filter((rl) => rl.estado === "confirmada" && ids.has(rl.id_lugar)).length;
    return { id: c.id, nombre: c.nombre, capacidad: c.capacidad, lugares_ocupados: ocup };
  }).sort((a, b) => a.nombre.localeCompare(b.nombre));
}

export async function permisosPorEspecie() {
  await ready();
  if (MODE === "supabase") {
    const { data, error } = await sb.from("v_permisos_por_especie").select("*");
    if (error) throw error; return data;
  }
  return DB.especies.map((e) => ({
    id: e.id, especie: e.nombre, umbral_permisos: e.umbral_permisos,
    permisos_emitidos: DB.permisos.filter((p) => p.id_especie === e.id && p.estado !== "anulado").length,
  })).sort((a, b) => b.permisos_emitidos - a.permisos_emitidos);
}

export async function alertasFauna() {
  await ready();
  if (MODE === "supabase") {
    const { data, error } = await sb.from("alerta_fauna")
      .select("*, especie(nombre)").eq("estado", "activa").order("created_at", { ascending: false });
    if (error) throw error;
    return data.map((a) => ({ ...a, especie: a.especie?.nombre || "—" }));
  }
  return DB.alertas.filter((a) => a.estado === "activa").map((a) => ({
    ...a, especie: (byId(DB.especies, a.id_especie) || {}).nombre || "—",
  }));
}

export async function ultimosPermisos(limit = 6) {
  await ready();
  if (MODE === "supabase") {
    const { data, error } = await sb.from("permiso")
      .select("id,numero,estado,fecha_emision,especie(nombre),usuario(nombre,apellido),reserva(fecha)")
      .order("fecha_emision", { ascending: false }).limit(limit);
    if (error) throw error;
    return data.map((p) => ({
      id: p.id, numero: p.numero, estado: p.estado,
      titular: p.usuario ? `${p.usuario.nombre} ${p.usuario.apellido || ""}`.trim() : "—",
      especie: p.especie?.nombre || "—", fecha: p.reserva?.fecha || null,
    }));
  }
  return DB.permisos.map(applyPermisoEstado).slice()
    .sort((a, b) => (a.fecha_emision < b.fecha_emision ? 1 : -1)).slice(0, limit)
    .map((p) => {
      const r = byId(DB.reservas, p.id_reserva);
      const t = byId(DB.usuarios, p.id_usuario);
      return { id: p.id, numero: p.numero, estado: p.estado, titular: t ? `${t.nombre} ${t.apellido}`.trim() : "—", especie: (byId(DB.especies, p.id_especie) || {}).nombre || "—", fecha: r?.fecha || null };
    });
}

/* ============================================================================
 *  REPORTES AL MUNICIPIO (HU-009)
 *  Cada envío queda registrado en la tabla "reporte" con fecha, destinatario,
 *  origen (manual / automático) y una instantánea de los indicadores. En
 *  Supabase lo realiza la función generar_reporte_municipal (migración 002),
 *  que además notifica a los administradores municipales; pg_cron la ejecuta
 *  automáticamente al cierre de cada mes. Sin la migración, la instantánea se
 *  arma en el cliente y se inserta directamente (sólo administradores, por RLS).
 * ========================================================================== */
const DESTINATARIO = () => CFG.MUNICIPIO || "Municipio de Coronel Moldes";
const periodoActual = () => todayISO().slice(0, 7);
const tituloReporte = (tipo) => ({
  ocupacion: "Reporte de ocupación de catamaranes", permisos: "Reporte de permisos emitidos",
  fauna: "Reporte de presión pesquera por especie", ingresos: "Reporte de ingresos",
}[tipo] || "Reporte general de actividad pesquera") + " · " + periodoActual();

async function snapshotReporte() {
  const [resumen, permisos_por_especie, ocupacion_catamaranes, reservas_por_dia] = await Promise.all([
    dashboardResumen(), permisosPorEspecie(), ocupacionCatamaranes(), reservasPorDia({ from: periodoActual() + "-01" }),
  ]);
  return { resumen, permisos_por_especie, ocupacion_catamaranes, reservas_por_dia, generado_en: new Date().toISOString() };
}

export async function enviarReporteMunicipio(tipo = "general", origen = "manual") {
  await ready();
  const destinatario = DESTINATARIO();
  if (MODE === "supabase") {
    const { data, error } = await sb.rpc("generar_reporte_municipal", { p_tipo: tipo, p_origen: origen });
    if (!error) return data;
    if (!esFuncionInexistente(error)) throw new Error(error.message);
    const datos = await snapshotReporte();
    const { data: s } = await sb.auth.getSession();
    const { data: row, error: e2 } = await sb.from("reporte").insert({
      tipo, titulo: tituloReporte(tipo), fecha: todayISO(),
      parametros: { periodo: periodoActual(), origen, destinatario },
      datos, generado_por: s.session?.user?.id || null,
    }).select().single();
    if (e2) throw new Error(e2.message);
    return row;
  }
  const u = demoSessionUser();
  const datos = await snapshotReporte();
  const rep = {
    id: uid(), tipo, titulo: tituloReporte(tipo), fecha: todayISO(),
    parametros: { periodo: periodoActual(), origen, destinatario }, destinatario, origen, estado_envio: "enviado",
    datos, generado_por: u?.id || null, created_at: new Date().toISOString(),
  };
  DB.reportes = DB.reportes || [];
  DB.reportes.unshift(rep);
  DB.usuarios.filter((x) => x.rol === "admin_municipal").forEach((adm) => DB.notificaciones.unshift({
    id: uid(), id_usuario: adm.id, tipo: "sistema", titulo: "Reporte recibido",
    mensaje: `El sistema envió "${rep.titulo}" al ${destinatario}.`, leida: false, created_at: rep.created_at,
  }));
  persist();
  return rep;
}

export async function listReportes(limit = 12) {
  await ready();
  let rows;
  if (MODE === "supabase") {
    const { data, error } = await sb.from("reporte").select("*").order("created_at", { ascending: false }).limit(limit);
    if (error) throw error;
    rows = data;
  } else {
    rows = (DB.reportes || []).slice(0, limit);
  }
  return rows.map((r) => ({
    ...r,
    destinatario: r.destinatario || r.parametros?.destinatario || DESTINATARIO(),
    origen: r.origen || r.parametros?.origen || "manual",
    periodo: r.parametros?.periodo || String(r.fecha || "").slice(0, 7),
    estado_envio: r.estado_envio || "enviado",
  }));
}

/* Cierre de período: si el mes en curso todavía no tiene reporte automático,
 * lo genera. Cubre el caso en que pg_cron no esté habilitado. */
export async function asegurarReporteMensual() {
  await ready();
  const existentes = await listReportes(50);
  const periodo = periodoActual();
  if (existentes.some((r) => r.origen === "automatico" && r.periodo === periodo)) return null;
  return enviarReporteMunicipio("general", "automatico");
}

/* ============================================================================
 *  ADMINISTRACIÓN: usuarios y catamaranes
 * ========================================================================== */
export async function listUsuarios() {
  await ready();
  if (MODE === "supabase") {
    const { data, error } = await sb.from("usuario").select("*").order("created_at", { ascending: false });
    if (error) throw error; return data;
  }
  return [...DB.usuarios].sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
}

export async function setRol(userId, rol) {
  await ready();
  if (MODE === "supabase") {
    const { error } = await sb.from("usuario").update({ rol }).eq("id", userId);
    if (error) throw new Error(error.message); return true;
  }
  const u = byId(DB.usuarios, userId); if (u) u.rol = rol; persist();
  return true;
}

export async function crearCatamaran({ nombre, descripcion, capacidad, precio, habilitacion, estado = "activa" }) {
  await ready();
  if (MODE === "supabase") {
    const { data: s } = await sb.auth.getSession();
    const { data, error } = await sb.from("catamaran")
      .insert({ nombre, descripcion, capacidad, precio, habilitacion, estado, id_propietario: s.session?.user?.id })
      .select().single();
    if (error) throw new Error(error.message);
    // genera asientos
    const filas = Array.from({ length: capacidad }, (_, i) => ({ id_catamaran: data.id, numero: i + 1, ubicacion: ["proa", "babor", "estribor", "popa"][i % 4] }));
    await sb.from("lugar").insert(filas);
    return data;
  }
  const u = demoSessionUser();
  const id = uid();
  const cat = { id, id_propietario: u.id, nombre, descripcion: descripcion || "", capacidad: +capacidad, precio: +precio, habilitacion: habilitacion || "", estado, created_at: new Date().toISOString() };
  DB.catamaranes.push(cat);
  for (let n = 1; n <= capacidad; n++)
    DB.lugares.push({ id: uid(), id_catamaran: id, numero: n, ubicacion: ["proa", "babor", "estribor", "popa"][(n - 1) % 4], activo: true });
  persist();
  return cat;
}

export async function updateCatamaran(id, patch) {
  await ready();
  if (MODE === "supabase") {
    const { error } = await sb.from("catamaran").update(patch).eq("id", id);
    if (error) throw new Error(error.message); return true;
  }
  const c = byId(DB.catamaranes, id); if (c) Object.assign(c, patch); persist();
  return true;
}

/* Reinicia los datos demo (botón en Perfil). */
export async function resetDemo() {
  if (MODE !== "demo") return;
  localStorage.removeItem(DEMO_KEY);
  DB = null; seedDemo(); emitAuth();
}
