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
const PREF_RECORDATORIOS = "pescacorral.pref.recordatorios";
const ACCESO_KEY = "pescacorral.acceso";   // último acceso del personal (municipio | admin)
const OFFLINE_KEY = "pescacorral.offline";  // sesión y datos para usar la app sin conexión
const CUENTA_GOOGLE_KEY = "pescacorral.cuentaGoogle";   // última cuenta de Google usada en el dispositivo

/* Acceso del personal con usuario y contraseña. El usuario corto se traduce a
 * un correo de un dominio reservado (no recibe mensajes). */
const DOMINIO_PERSONAL = CFG.DOMINIO_PERSONAL || "pescacorral.example.com";
const ROL_POR_ACCESO = { municipio: "admin_municipal", admin: "admin_sistema" };
const ROLES_PERSONAL = Object.values(ROL_POR_ACCESO);
const CLAVES_DEMO = {
  municipio: { email: "municipio@demo.com", clave: "Municipio.2026" },
  admin:     { email: "admin@demo.com",     clave: "Admin.2026" },
};

/* Fotos de ejemplo de la demostración (catamaranes en el Dique Cabra Corral,
 * recortadas): José Luis Fernández, Wikimedia Commons, licencia CC BY 3.0. */
const FOTOS_DEMO = { donJuan: ["img/demo/catamaran-blanco.jpg", "img/demo/muelle-conea.jpg"], elPato: ["img/demo/catamaran-amarillo.jpg"] };
export const CREDITO_FOTOS_DEMO = "Fotos de ejemplo: José Luis Fernández, Wikimedia Commons (CC BY 3.0)";
export const esFotoDemo = (ruta) => String(ruta || "").startsWith("img/demo/");

/* Ubicación de un asiento en el plano del catamarán, vista desde arriba con la
 * proa adelante (igual que public.ubicacion_lugar): numeración en sentido
 * horario desde la proa, primero por estribor (derecha) y luego por babor. */
export function posicionLugar(numero, total) {
  const filas = Math.ceil(total / 2);
  const estribor = numero <= filas;
  const fila = estribor ? numero - 1 : 2 * filas - numero;
  const zona = fila * 3 < filas ? "proa" : fila * 3 < filas * 2 ? "centro" : "popa";
  return { lado: estribor ? "estribor" : "babor", fila, zona, filas };
}
export function ubicacionLugar(numero, total) {
  const p = posicionLugar(numero, total);
  return `${p.lado} · ${p.zona}`;
}
const numeroReserva = (seq) => "RES-" + String(seq).padStart(6, "0");

let sb = null;                 // cliente supabase (lazy)
const authListeners = new Set();

/* ============================================================================
 *  SIN CONEXIÓN (pescadores y dueños)
 *  En el dique la señal es irregular. Al abrir la app con conexión quedan
 *  guardados en el dispositivo el perfil, todas las reservas y permisos de la
 *  cuenta (con su comprobante y su código QR, aunque no se hayan abierto), las
 *  notificaciones y lo último que se vio de los catamaranes: sin internet la
 *  sesión sigue abierta y esas pantallas muestran los datos guardados, con un
 *  aviso. Reservar y pagar
 *  necesitan conexión. Sólo se guardan lecturas de la API de la cuenta del
 *  público que usa el dispositivo y se borran al cerrar sesión; el personal no
 *  usa este modo (sus paneles muestran datos de todas las personas).
 * ========================================================================== */
const MAX_RESPUESTAS = 80;
// Con señal débil y una copia guardada: espera máxima de la red; después de un
// corte por demora, las lecturas siguientes esperan menos durante un minuto.
const ESPERA_MAX_MS = 6000, ESPERA_LENTA_MS = 2500;
let redLentaHasta = 0;
let sinConexionDesde = null;
let rolSesion = null;          // rol de la sesión actual (lo fija getSession)
/** Fecha (ms) de los datos guardados que se están mostrando sin conexión, o null. */
export const sinConexion = () => sinConexionDesde;

function leerOffline() { try { return JSON.parse(localStorage.getItem(OFFLINE_KEY) || "null"); } catch { return null; } }
function escribirOffline(o) { try { localStorage.setItem(OFFLINE_KEY, JSON.stringify(o)); } catch { /* sin espacio: no se guarda */ } }
function borrarOffline() { try { localStorage.removeItem(OFFLINE_KEY); } catch { /* sin almacenamiento */ } sinConexionDesde = null; }
const esErrorDeRed = (err) => navigator.onLine === false || err?.name === "AuthRetryableFetchError" || err?.status === 0;

/* Usuario del token de una petición (null si es la clave pública). */
function usuarioDelToken(headers) {
  try {
    const auth = new Headers(headers || {}).get("Authorization") || "";
    const b64 = auth.replace(/^Bearer\s+/i, "").split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    const claims = JSON.parse(atob(b64));
    return claims.role === "authenticated" ? claims.sub : null;
  } catch { return null; }
}

/* fetch del cliente de Supabase: guarda las lecturas (GET a la API) de la cuenta
 * del público y, si no hay conexión, responde con la última copia guardada. */
async function fetchConCache(input, init = {}) {
  const url = typeof input === "string" ? input : input.url;
  const metodo = (init.method || (typeof input === "string" ? "GET" : input.method) || "GET").toUpperCase();
  const api = url.includes("/rest/v1/");
  const lectura = api && metodo === "GET";
  const off = lectura ? leerOffline() : null;
  try {
    let r;
    if (off?.datos?.[url] && !init.signal) {
      // Con una copia guardada no se deja la pantalla esperando: si la red no
      // responde a tiempo, se corta y se muestra la copia (catch).
      const ctrl = new AbortController();
      const espera = Date.now() < redLentaHasta ? ESPERA_LENTA_MS : ESPERA_MAX_MS;
      const timer = setTimeout(() => { redLentaHasta = Date.now() + 60000; ctrl.abort(); }, espera);
      try { r = await fetch(input, { ...init, signal: ctrl.signal }); } finally { clearTimeout(timer); }
    } else {
      r = await fetch(input, init);
    }
    if (lectura && r.ok && off?.uid && usuarioDelToken(init.headers) === off.uid) {
      const body = await r.clone().text();
      const actual = leerOffline();          // se relee: otras lecturas en paralelo también guardan
      if (actual?.uid === off.uid) {
        actual.datos = actual.datos || {};
        actual.datos[url] = { t: Date.now(), body, rango: r.headers.get("Content-Range") };
        const urls = Object.keys(actual.datos);
        if (urls.length > MAX_RESPUESTAS)
          urls.sort((a, b) => actual.datos[a].t - actual.datos[b].t).slice(0, urls.length - MAX_RESPUESTAS).forEach((u) => delete actual.datos[u]);
        escribirOffline(actual);
      }
    }
    return r;
  } catch (err) {
    const copia = off?.datos?.[url];
    const uid = usuarioDelToken(init.headers);
    if (copia && (!uid || uid === off.uid)) {
      sinConexionDesde = sinConexionDesde ? Math.min(sinConexionDesde, copia.t) : copia.t;
      const headers = { "Content-Type": "application/json" };
      if (copia.rango) headers["Content-Range"] = copia.rango;
      return new Response(copia.body, { status: 200, headers });
    }
    // Sin conexión y sin copia: se responde enseguida (sin los reintentos del
    // cliente, que demoran varios segundos) con un mensaje claro.
    if (api && navigator.onLine === false) {
      return new Response(JSON.stringify({ code: "SIN_CONEXION", message: "Sin conexión a internet: esta acción la necesita. Conectate y volvé a intentar." }),
        { status: 504, headers: { "Content-Type": "application/json" } });
    }
    throw err;
  }
}

/* Última cuenta de Google usada en el dispositivo: el ingreso la propone para
 * entrar con un toque, sin pasar por el selector de cuentas. */
function recordarCuentaGoogle(user, profile) {
  try {
    localStorage.setItem(CUENTA_GOOGLE_KEY, JSON.stringify({
      email: user.email, nombre: [profile?.nombre, profile?.apellido].filter(Boolean).join(" "), avatar: user.avatar || null,
    }));
  } catch { /* sin almacenamiento */ }
}
export function cuentaGoogleRecordada() {
  if (MODE !== "supabase") return null;
  try { return JSON.parse(localStorage.getItem(CUENTA_GOOGLE_KEY) || "null"); } catch { return null; }
}

/* ============================================================================
 *  INICIALIZACIÓN
 * ========================================================================== */
let _ready = null;
/* El cliente de Supabase es una copia local con versión fija (vendor/), así
 * ningún servidor externo entrega código que maneje las sesiones. */
function cargarScript(src) {
  return new Promise((ok, mal) => {
    const s = document.createElement("script");
    s.src = src;
    s.onload = ok;
    s.onerror = () => mal(new Error("No se pudo cargar la aplicación. Revisá tu conexión e intentá de nuevo."));
    document.head.appendChild(s);
  });
}
/* Sin conexión se usa un cliente sin sesión que sólo lee las copias guardadas:
 * el cliente con sesión intentaría renovar un token vencido con reintentos de
 * hasta medio minuto y la app quedaría esperando. La sesión real queda intacta
 * en el dispositivo y, al volver internet, la app se recarga y la retoma. */
let clienteSinConexion = false;
/** true si la app está usando el cliente sin sesión (sin conexión). */
export const usandoClienteSinConexion = () => clienteSinConexion;
function crearClienteSinConexion() {
  clienteSinConexion = true;
  return window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY, {
    global: { fetch: fetchConCache },
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false, storageKey: "pescacorral-sin-conexion" },
  });
}
/* Clave con la que supabase-js guarda la sesión (sb-<proyecto>-auth-token). */
const claveSesion = () => `sb-${new URL(CFG.SUPABASE_URL).hostname.split(".")[0]}-auth-token`;

function ready() {
  if (_ready) return _ready;
  _ready = (async () => {
    if (MODE === "supabase") {
      if (!window.supabase) await cargarScript("vendor/supabase.min.js");
      if (navigator.onLine === false) { sb = crearClienteSinConexion(); return; }
      const { createClient } = window.supabase;
      sb = createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY, {
        global: { fetch: fetchConCache },
        // Flujo PKCE: al volver de Google la sesión llega como ?code= en la URL
        // (no como #token), lo que no interfiere con el enrutador por hash.
        auth: { flowType: "pkce", persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
      });
      // Se difiere el aviso para no llamar al cliente desde dentro de su propio evento.
      sb.auth.onAuthStateChange((event) => {
        if (clienteSinConexion) return;
        setTimeout(() => authListeners.forEach((fn) => fn(event)), 0);
      });
      // Si se corta la conexión con la app abierta, se pasa al cliente sin sesión.
      window.addEventListener("offline", () => { if (!clienteSinConexion) sb = crearClienteSinConexion(); });
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
  if (DB && DB.__v === 9) return;

  const rnd = mulberry32(20260628);
  const pick = (arr) => arr[Math.floor(rnd() * arr.length)];

  /* --- Especies (fauna) con el precio de cada una en el permiso --- */
  const especies = [
    { id: uid(), nombre: "Pejerrey", nombre_cientifico: "Odontesthes bonariensis", precio_permiso: 2000, activa: true, umbral_permisos: 400, descripcion: "Especie emblemática del dique, principal objetivo de la pesca deportiva." },
    { id: uid(), nombre: "Dorado", nombre_cientifico: "Salminus brasiliensis", precio_permiso: 2000, activa: true, umbral_permisos: 150, descripcion: "Pesca con devolución obligatoria en temporada de veda." },
    { id: uid(), nombre: "Bagre", nombre_cientifico: "Rhamdia quelen", precio_permiso: 1500, activa: true, umbral_permisos: 300, descripcion: "Especie de fondo, abundante en zonas de menor corriente." },
    { id: uid(), nombre: "Carpa", nombre_cientifico: "Cyprinus carpio", precio_permiso: 1000, activa: true, umbral_permisos: 500, descripcion: "Especie introducida, sin restricciones de captura." },
    { id: uid(), nombre: "Dentudo", nombre_cientifico: "Oligosarcus jenynsii", precio_permiso: 1000, activa: true, umbral_permisos: 300, descripcion: "Especie de pesca deportiva frecuente en el embalse." },
  ];
  const pejerrey = especies[0];

  /* --- Usuarios demo --- */
  const uPescador = { id: uid(), nombre: "Carlos", apellido: "Romero", email: "pescador@demo.com", telefono: "+54 387 4123456", dni: "24.356.789", rol: "pescador", activo: true, perfil_completo: true, created_at: isoFromOffset(-120).toISOString() };
  const uDueno    = { id: uid(), nombre: "Juan", apellido: "Pérez", email: "dueno@demo.com", telefono: "+54 387 4998877", dni: "20.111.222", rol: "dueno", activo: true, perfil_completo: true, created_at: isoFromOffset(-200).toISOString() };
  const uMuni     = { id: uid(), nombre: "Laura", apellido: "Gómez", email: "municipio@demo.com", telefono: "+54 387 4100100", dni: "27.654.321", rol: "admin_municipal", activo: true, perfil_completo: true, created_at: isoFromOffset(-300).toISOString() };
  const uAdmin    = { id: uid(), nombre: "Sofía", apellido: "Díaz", email: "admin@demo.com", telefono: "+54 387 4555000", dni: "30.222.111", rol: "admin_sistema", activo: true, perfil_completo: true, created_at: isoFromOffset(-300).toISOString() };
  const usuarios = [uPescador, uDueno, uMuni, uAdmin];

  /* --- Catamaranes (datos de los prototipos del TFG) --- */
  const catData = [
    { nombre: "Don Juan II", capacidad: 20, precio: 8000, estado: "activa",        prop: uDueno.id, hab: "HAB-2024-018", desc: "Catamarán techado con baño y cocina. Salidas diarias al espejo de agua.", fotos: FOTOS_DEMO.donJuan },
    { nombre: "El Pato",     capacidad: 16, precio: 7500, estado: "activa",        prop: uDueno.id, hab: "HAB-2024-007", desc: "Embarcación familiar, ideal para grupos pequeños y principiantes.", fotos: FOTOS_DEMO.elPato },
    { nombre: "La Victoria", capacidad: 18, precio: 8500, estado: "activa",        prop: null,      hab: "HAB-2023-031", desc: "Cubierta amplia y sombra. Equipamiento de pesca incluido." },
    { nombre: "Don Pescador",capacidad: 12, precio: 9500, estado: "activa",        prop: null,      hab: "HAB-2024-022", desc: "Salidas premium con guía de pesca especializado." },
    { nombre: "Lago Azul",   capacidad: 14, precio: 8000, estado: "mantenimiento", prop: null,      hab: "HAB-2022-014", desc: "Temporalmente fuera de servicio por mantenimiento de motor." },
  ];
  const catamaranes = [], lugares = [];
  for (const c of catData) {
    const id = uid();
    catamaranes.push({ id, id_propietario: c.prop, nombre: c.nombre, descripcion: c.desc, capacidad: c.capacidad, precio: c.precio, habilitacion: c.hab, estado: c.estado, fotos: c.fotos || [], created_at: isoFromOffset(-150).toISOString() });
    for (let n = 1; n <= c.capacidad; n++)
      lugares.push({ id: uid(), id_catamaran: id, numero: n, ubicacion: ubicacionLugar(n, c.capacidad), activo: true });
  }
  const activos = catamaranes.filter((c) => c.estado === "activa");

  /* --- Reservas / asientos / pagos / permisos sintéticos --- */
  const reservas = [], reserva_lugar = [], pagos = [], permisos = [], notificaciones = [];
  let seq = 215, seqReserva = 1001;
  const metodos = ["tarjeta", "mercadopago", "efectivo"];
  const lugaresDe = (catId) => lugares.filter((l) => l.id_catamaran === catId);
  const ocupadoSet = new Set(); // `${lugarId}|${fecha}|${turno}`

  // Acompañantes de ejemplo (lista de embarque): nombre, DNI y su permiso.
  const NOMBRES = ["Lucía Fernández", "Martín Sosa", "Ana Quiroga", "Diego Ruiz", "Paula Cruz", "Jorge Leal", "Sofía Ibarra", "Raúl Vera"];
  const dniAl = () => formatoDni(String(20000000 + Math.floor(rnd() * 25000000)));
  function crearReservaDemo({ cat, fecha, turno, nLugares, especie, estadoReserva, titular }) {
    const libres = lugaresDe(cat.id).filter((l) => !ocupadoSet.has(`${l.id}|${fecha}|${turno}`));
    if (!libres.length) return;
    const elegidos = [];
    for (let k = 0; k < nLugares && libres.length; k++) {
      const idx = Math.floor(rnd() * libres.length);
      elegidos.push(libres.splice(idx, 1)[0]);
    }
    elegidos.sort((a, b) => a.numero - b.numero);
    const rId = uid();
    const cancel = estadoReserva === "cancelada";
    // Se reservó y se pagó antes de la salida (nunca en el futuro).
    const emision = new Date(Math.min(new Date(fecha + "T10:05:00").getTime(), Date.now() - (1 + rnd() * 72) * 3600e3));
    const vence = new Date(fecha + "T23:59:00");
    let montoPermisos = 0;
    elegidos.forEach((l, i) => {
      const nombre = i ? NOMBRES[Math.floor(rnd() * NOMBRES.length)] : null;
      const dni = i ? dniAl() : null;
      // El titular compra el permiso; los acompañantes, casi siempre (algunos ya tienen el suyo).
      const propio = i && rnd() < 0.3 ? "LIC-" + Math.floor(1000 + rnd() * 9000) : null;
      let pId = null;
      if (!propio) {
        const esp = i === 0 ? [especie] : [especie, ...(rnd() < 0.35 ? [pick(especies.filter((e) => e !== especie))] : [])];
        const monto = esp.reduce((t, e) => t + e.precio_permiso, 0);
        const numero = "PCC-" + String(seq++).padStart(6, "0");
        const dniTitular = i ? dni : formatoDni(titular.dni);
        pId = uid();
        montoPermisos += monto;
        permisos.push({
          id: pId, id_reserva: rId, id_usuario: titular.id,
          titular_nombre: i ? nombre : `${titular.nombre} ${titular.apellido}`, titular_dni: dniTitular,
          numero, codigo_qr: `${numero}|${soloDigitosDni(dniTitular)}|${fecha}`, monto,
          especies: esp.map((e) => ({ id_especie: e.id, precio: e.precio_permiso })),
          fecha_emision: emision.toISOString(), fecha_vencimiento: vence.toISOString(),
          estado: cancel ? "anulado" : (vence.getTime() < Date.now() ? "vencido" : "vigente"),
        });
      }
      reserva_lugar.push({ id: uid(), id_reserva: rId, id_lugar: l.id, fecha, turno, estado: cancel ? "cancelada" : "confirmada",
        pasajero_nombre: nombre, pasajero_dni: dni, id_permiso: pId, permiso_propio: propio });
      if (!cancel) ocupadoSet.add(`${l.id}|${fecha}|${turno}`);
    });
    const monto = cat.precio * elegidos.length + montoPermisos;
    reservas.push({ id: rId, numero: numeroReserva(seqReserva++), id_usuario: titular.id, id_catamaran: cat.id, fecha, turno, estado: estadoReserva, cantidad_lugares: elegidos.length, monto_total: monto, monto_permiso: montoPermisos, created_at: emision.toISOString() });
    pagos.push({ id: uid(), id_reserva: rId, monto, metodo: pick(metodos), estado: cancel ? "rechazado" : "aprobado", comprobante: "CMP-" + rId.replace(/-/g, "").slice(0, 10).toUpperCase(), autorizacion: "AUT-" + Math.floor(rnd() * 1e6).toString(36).toUpperCase(), fecha_pago: emision.toISOString() });
    return { rId };
  }

  // Histórico: ~38 reservas entre hace 30 días y hoy.
  const especiePesos = [pejerrey, pejerrey, pejerrey, especies[2], especies[1], especies[3], especies[4]];
  for (let i = 0; i < 38; i++) {
    const off = -Math.floor(rnd() * 30);
    const fecha = dateISO(isoFromOffset(off));
    const cat = pick(activos);
    const past = off < 0;
    const estadoReserva = i % 19 === 0 ? "cancelada" : (past ? (rnd() < 0.7 ? "completada" : "confirmada") : "confirmada");
    crearReservaDemo({ cat, fecha, turno: rnd() < 0.6 ? "manana" : "tarde", nLugares: 1 + Math.floor(rnd() * 4), especie: pick(especiePesos), estadoReserva, titular: uPescador });
  }

  // Reservas próximas (hoy + 3 días) en los catamaranes visibles, para que la
  // grilla de asientos muestre lugares ocupados al demostrar la reserva.
  const donJuan = catamaranes.find((c) => c.nombre === "Don Juan II");
  const elPato  = catamaranes.find((c) => c.nombre === "El Pato");
  [[donJuan, 0, 6], [donJuan, 1, 4], [elPato, 0, 3], [elPato, 2, 5], [donJuan, 2, 8]].forEach(([cat, off, n]) =>
    crearReservaDemo({ cat, fecha: dateISO(isoFromOffset(off)), turno: "manana", nLugares: n, especie: pejerrey, estadoReserva: "confirmada", titular: uPescador })
  );


  // El dueño también sale a pescar como pasajero en otras embarcaciones.
  const laVictoria = catamaranes.find((c) => c.nombre === "La Victoria");
  const donPescador = catamaranes.find((c) => c.nombre === "Don Pescador");
  crearReservaDemo({ cat: donPescador, fecha: dateISO(isoFromOffset(-12)), turno: "manana", nLugares: 1, especie: pejerrey, estadoReserva: "completada", titular: uDueno });
  crearReservaDemo({ cat: laVictoria, fecha: dateISO(isoFromOffset(5)), turno: "tarde", nLugares: 2, especie: pejerrey, estadoReserva: "confirmada", titular: uDueno });

  /* --- Gastos del dueño (finanzas): combustible, mantenimiento, personal… --- */
  const gastos = [
    [-2, donJuan, "combustible", "Nafta para la semana", 68000], [-4, elPato, "combustible", "Nafta", 41000],
    [-6, null, "personal", "Sueldo del marinero (quincena)", 150000], [-9, donJuan, "mantenimiento", "Cambio de aceite y filtros", 54000],
    [-15, null, "amarre", "Amarre en el muelle", 35000], [-20, elPato, "mantenimiento", "Reparación de la bomba de achique", 47000],
    [-36, donJuan, "combustible", "Nafta", 72000], [-38, null, "personal", "Sueldo del marinero", 300000],
    [-41, null, "seguro", "Seguro de responsabilidad civil", 95000], [-45, elPato, "combustible", "Nafta", 38000],
    [-52, null, "impuestos", "Renovación de la habilitación", 60000], [-66, donJuan, "mantenimiento", "Pintura del casco", 180000],
    [-70, null, "personal", "Sueldo del marinero", 300000], [-75, elPato, "combustible", "Nafta", 36000],
  ].map(([off, cat, categoria, descripcion, monto]) => ({
    id: uid(), id_propietario: uDueno.id, id_catamaran: cat?.id || null, fecha: dateISO(isoFromOffset(off)),
    categoria, descripcion, monto, created_at: isoFromOffset(off).toISOString(),
  }));

  /* --- Notificaciones del pescador --- */
  const ultReservas = reservas.filter((r) => r.id_usuario === uPescador.id && r.estado !== "cancelada").slice(-3).reverse();
  ultReservas.forEach((r, i) => {
    // La confirmación llega al reservar (nunca en el futuro).
    const enviada = new Date(Math.min(Date.now() - (i + 1) * 3600000, new Date(r.fecha + "T10:06:00").getTime()));
    notificaciones.push({ id: uid(), id_usuario: uPescador.id, tipo: "reserva", titulo: "Reserva confirmada", mensaje: `Tu reserva del ${r.fecha.split("-").reverse().join("/")} fue confirmada.`, leida: i > 0, created_at: enviada.toISOString() });
  });
  notificaciones.push({ id: uid(), id_usuario: uPescador.id, tipo: "recordatorio", titulo: "Recordatorio de salida", mensaje: "Recordá presentar tu permiso digital al embarcar.", leida: false, created_at: isoFromOffset(-1, 9).toISOString() });

  /* --- Alertas de fauna (HU-015) con números realistas para la demo --- */
  const periodo = (() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`; })();
  const alertas = [
    { id: uid(), id_especie: pejerrey.id, periodo, permisos_emitidos: 372, umbral: 400, estado: "activa", created_at: isoFromOffset(-2).toISOString() },
    { id: uid(), id_especie: especies[1].id, periodo, permisos_emitidos: 138, umbral: 150, estado: "activa", created_at: isoFromOffset(-3).toISOString() },
    { id: uid(), id_especie: especies[2].id, periodo, permisos_emitidos: 210, umbral: 300, estado: "activa", created_at: isoFromOffset(-5).toISOString() },
  ];

  DB = { __v: 9, usuarios, especies, catamaranes, lugares, reservas, reserva_lugar, pagos, permisos, notificaciones, alertas, gastos, reportes: [], seq, seqReserva, session: null };
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
function applyPermisoEstado(p) {
  if (p.estado === "anulado") return p;
  if (p.estado !== "vencido" && new Date(p.fecha_vencimiento).getTime() < Date.now())
    return { ...p, estado: "vencido" };
  return p;
}

/* ============================================================================
 *  AUTENTICACIÓN · ingreso con cuenta de Google (OAuth 2.0 / OpenID Connect)
 *  La aplicación no recibe ni almacena contraseñas: Google verifica la
 *  identidad y Supabase Auth emite la sesión (JWT). En el primer ingreso el
 *  perfil se crea automáticamente (trigger handle_new_user) y el usuario
 *  completa los datos obligatorios en la pantalla #/registro.
 * ========================================================================== */
export function onAuthChange(fn) {
  authListeners.add(fn);
  return () => authListeners.delete(fn);
}

export async function getSession() {
  await ready();
  if (MODE === "supabase") {
    sinConexionDesde = null;
    const { data, error } = await sb.auth.getSession();
    if (!data.session) {
      // Sin internet la sesión no se pudo renovar, pero sigue guardada y se
      // renueva sola al volver la conexión: mientras tanto se usa la última copia.
      const off = leerOffline();
      if (off?.sesion && (clienteSinConexion || esErrorDeRed(error))) {
        sinConexionDesde = off.sesion.t;
        rolSesion = off.sesion.profile?.rol || null;
        return { user: off.sesion.user, profile: off.sesion.profile, sinConexion: true };
      }
      if (!clienteSinConexion && !esErrorDeRed(error)) borrarOffline();
      return null;
    }
    const u = data.session.user;
    const meta = u.user_metadata || {};
    const user = { id: u.id, email: u.email, avatar: meta.avatar_url || meta.picture || null, metodo: metodoDeIngreso(data.session) };
    const off = leerOffline();
    let profile = await fetchProfileSupabase(u.id);
    if (!profile && off?.uid === u.id && off.sesion) {      // sin conexión: perfil guardado
      profile = off.sesion.profile;
      sinConexionDesde = sinConexionDesde || off.sesion.t;
    }
    rolSesion = profile?.rol || null;
    if (profile && !esRolPersonal(profile.rol)) {
      if (!sinConexionDesde) {
        const actual = leerOffline();        // se relee: la lectura del perfil también se guardó
        escribirOffline({ uid: u.id, datos: actual?.uid === u.id ? actual.datos : {}, sesion: { user, profile, t: Date.now() } });
      }
      if (user.metodo === "google") recordarCuentaGoogle(user, profile);
    } else if (profile) {
      borrarOffline();
    }
    return { user, profile, ...(sinConexionDesde ? { sinConexion: true } : {}) };
  }
  const u = demoSessionUser();
  return u ? { user: { id: u.id, email: u.email, avatar: null, metodo: DB.session.metodo || "google" }, profile: u } : null;
}

/* Cómo inició esta sesión: "clave" (usuario y contraseña) o "google". Se lee del
 * token (amr), porque app_metadata.provider guarda el primer proveedor de la
 * cuenta y no el usado en este ingreso. */
function metodoDeIngreso(session) {
  try {
    const b64 = session.access_token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    const m = (JSON.parse(atob(b64)).amr || [])[0]?.method;
    if (m === "password") return "clave";
    if (m === "oauth") return "google";
  } catch { /* token ilegible: se usa el proveedor de la cuenta */ }
  return session.user.app_metadata?.provider === "email" ? "clave" : "google";
}

async function fetchProfileSupabase(id) {
  const { data, error } = await sb.from("usuario").select("*").eq("id", id).single();
  if (error) return null;
  return data;
}

/* Perfil leído con un token determinado (el de un ingreso recién hecho). */
async function perfilConToken(token, id) {
  try {
    const r = await fetch(`${CFG.SUPABASE_URL}/rest/v1/usuario?select=*&id=eq.${encodeURIComponent(id)}`, {
      headers: { apikey: CFG.SUPABASE_ANON_KEY, Authorization: `Bearer ${token}` },
    });
    if (!r.ok) return null;
    return (await r.json())[0] || null;
  } catch {
    return null;
  }
}

/** Perfil incompleto = primer ingreso sin DNI ni tipo de cuenta confirmados. */
export function perfilCompleto(profile) {
  return Boolean(profile?.perfil_completo);
}

/* Dirección a la que Google (a través de Supabase) devuelve al usuario. */
const redirectURL = () => location.origin + location.pathname.replace(/index\.html$/, "");

/* Consulta si el proveedor Google está habilitado, para no mandar al usuario
 * a una página de error del servidor si todavía no se configuró. */
let _googleHabilitado = null;
async function googleHabilitado() {
  if (_googleHabilitado !== null) return _googleHabilitado;
  try {
    const r = await fetch(`${CFG.SUPABASE_URL}/auth/v1/settings`, { headers: { apikey: CFG.SUPABASE_ANON_KEY } });
    const s = await r.json();
    _googleHabilitado = Boolean(s?.external?.google);
  } catch {
    _googleHabilitado = true;   // sin respuesta: se intenta igual y el servidor informa
  }
  return _googleHabilitado;
}

/** Inicia el ingreso con Google: redirige a la pantalla de Google y, al
 *  autorizar, vuelve a la aplicación con la sesión iniciada. */
export async function signInWithGoogle({ otraCuenta = false } = {}) {
  await ready();
  if (MODE !== "supabase") throw new Error("En modo demostración elegí una de las cuentas de ejemplo.");
  if (navigator.onLine === false) throw new Error("Sin conexión a internet. Conectate para ingresar con Google.");
  olvidarAcceso();
  const recordada = otraCuenta ? null : cuentaGoogleRecordada();
  if (!(await googleHabilitado()))
    throw new Error("El ingreso con Google todavía no está habilitado en el servidor. Intentá más tarde.");
  const { error } = await sb.auth.signInWithOAuth({
    provider: "google",
    // Con la cuenta recordada, Google entra directo con ella; si no, muestra el selector.
    options: { redirectTo: redirectURL(), queryParams: recordada ? { login_hint: recordada.email } : { prompt: "select_account" } },
  });
  if (error) throw new Error(traducirAuth(error.message));
}

/* ---- Modo demostración: simula el selector de cuentas de Google ---- */
export async function listarCuentasDemo() {
  await ready();
  if (MODE !== "demo") return [];
  return DB.usuarios
    .filter((u) => u.activo !== false && !ROLES_PERSONAL.includes(u.rol))
    .map((u) => ({ email: u.email, nombre: u.nombre || "", apellido: u.apellido || "" }));
}

export async function signInDemo({ email, nombre = "" } = {}) {
  await ready();
  if (MODE !== "demo") throw new Error("Operación disponible sólo en modo demostración.");
  email = (email || "").trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error("Ingresá un correo válido.");
  let u = DB.usuarios.find((x) => x.email.toLowerCase() === email);
  if (!u) {
    // Igual que el trigger handle_new_user: el perfil se crea con los datos que
    // entrega Google y queda pendiente de completar.
    const partes = String(nombre).trim().split(/\s+/).filter(Boolean);
    u = {
      id: uid(), nombre: partes[0] || email.split("@")[0], apellido: partes.slice(1).join(" "),
      email, telefono: "", dni: "", rol: "pescador", activo: true, perfil_completo: false,
      created_at: new Date().toISOString(),
    };
    DB.usuarios.push(u);
  }
  if (ROLES_PERSONAL.includes(u.rol)) throw new Error("Esta cuenta ingresa por el acceso del personal, con usuario y contraseña.");
  if (u.activo === false) throw new Error("La cuenta está desactivada. Comunicate con el municipio.");
  olvidarAcceso();
  DB.session = { userId: u.id, metodo: "google" }; persist(); emitAuth("SIGNED_IN");
  return true;
}

/* ---- Acceso del personal (municipio y administración) con usuario y contraseña ----
 * Mientras dura el ingreso, el enrutador no redibuja (ver app.js), así una cuenta
 * sin el rol de la sección no llega a ver ninguna pantalla interna. */
export let ingresoPersonalEnCurso = false;

export async function signInPersonal({ usuario, clave, tipo } = {}) {
  await ready();
  const rolEsperado = ROL_POR_ACCESO[tipo];
  if (!rolEsperado) throw new Error("Acceso no válido.");
  usuario = String(usuario || "").trim().toLowerCase();
  if (!usuario || !clave) throw new Error("Ingresá tu usuario y tu contraseña.");
  ingresoPersonalEnCurso = true;
  try {
    if (MODE === "supabase") {
      const email = usuario.includes("@") ? usuario : `${usuario}@${DOMINIO_PERSONAL}`;
      // Si hay otra sesión abierta (por ejemplo, la de Google de un pescador), se
      // cierra antes en este dispositivo: así una renovación de ese token, en esta
      // pestaña o en otra, no pisa la sesión nueva.
      const { data: previa } = await sb.auth.getSession();
      if (previa.session) { borrarOffline(); await sb.auth.signOut({ scope: "local" }); }
      const { data, error } = await sb.auth.signInWithPassword({ email, password: clave });
      if (error) throw new Error(traducirAuth(error.message));
      // El rol se verifica con el token recién emitido, no con la sesión guardada.
      const profile = await perfilConToken(data.session.access_token, data.user.id);
      if (!profile || profile.rol !== rolEsperado || profile.activo === false) {
        await sb.auth.signOut();
        throw new Error(profile && profile.activo === false
          ? "Tu cuenta está desactivada. Comunicate con la administración."
          : "Esta cuenta no tiene acceso a esta sección.");
      }
    } else {
      const cred = (DB.clavesPersonal || {})[usuario] || CLAVES_DEMO[usuario];
      const u = cred && DB.usuarios.find((x) => x.email === cred.email);
      if (!u || cred.clave !== clave) throw new Error("Usuario o contraseña incorrectos.");
      if (u.rol !== rolEsperado) throw new Error("Esta cuenta no tiene acceso a esta sección.");
      if (u.activo === false) throw new Error("Tu cuenta está desactivada. Comunicate con la administración.");
      DB.session = { userId: u.id, metodo: "clave" }; persist();
    }
    recordarAcceso(tipo);
  } finally {
    ingresoPersonalEnCurso = false;
  }
  return true;
}

/* Recuerda por qué puerta ingresó el personal, para volver a ella al salir. */
function recordarAcceso(tipo) { try { localStorage.setItem(ACCESO_KEY, tipo); } catch { /* sin almacenamiento */ } }
function olvidarAcceso() { try { localStorage.removeItem(ACCESO_KEY); } catch { /* sin almacenamiento */ } }
function ultimoAcceso() {
  try { const t = localStorage.getItem(ACCESO_KEY); return ROL_POR_ACCESO[t] ? t : null; } catch { return null; }
}
/** Pantalla de ingreso que corresponde: la del personal si fue la última usada. */
export function rutaIngreso() {
  const t = ultimoAcceso();
  return t ? `/acceso/${t}` : "/login";
}
export function usarIngresoPublico() { olvidarAcceso(); }
/** Rol que corresponde a cada acceso del personal (municipio | admin). */
export const rolDeAcceso = (tipo) => ROL_POR_ACCESO[tipo] || null;

/** Primer ingreso (HU-001): guarda los datos obligatorios y confirma el alta. */
export async function completarPerfil({ nombre, apellido, telefono, dni, rol }) {
  await ready();
  const patch = { nombre, apellido, telefono: telefono || "", dni, perfil_completo: true };
  if (rol === "pescador" || rol === "dueno") patch.rol = rol;
  if (MODE === "supabase") {
    const { data: s } = await sb.auth.getSession();
    const id = s.session?.user?.id;
    if (!id) throw new Error("La sesión expiró. Volvé a ingresar con Google.");
    const { error } = await sb.from("usuario").update(patch).eq("id", id);
    if (error) throw new Error(traducirDB(error.message));
    emitAuth("USER_UPDATED");
    return true;
  }
  const u = demoSessionUser();
  if (!u) throw new Error("La sesión expiró. Volvé a ingresar.");
  Object.assign(u, patch); persist(); emitAuth("USER_UPDATED");
  return true;
}

export async function signOut() {
  await ready();
  if (MODE === "supabase") {
    // Con señal débil no se demora la salida: la función de envío da de baja las suscripciones vencidas.
    if (!clienteSinConexion) await Promise.race([desactivarPush().catch(() => {}), new Promise((r) => setTimeout(r, 4000))]);
    borrarOffline();
    if (clienteSinConexion) {                // sin conexión: se borra la sesión de este dispositivo
      try { localStorage.removeItem(claveSesion()); } catch { /* sin almacenamiento */ }
      emitAuth("SIGNED_OUT");
      return;
    }
    const { error } = await sb.auth.signOut();
    if (error) await sb.auth.signOut({ scope: "local" });
    return;
  }
  DB.session = null; persist(); emitAuth("SIGNED_OUT");
}

export async function updateProfile(patch) {
  await ready();
  if (MODE === "supabase") {
    const { data: s } = await sb.auth.getSession();
    const id = s.session?.user?.id;
    const { error } = await sb.from("usuario").update(patch).eq("id", id);
    if (error) throw new Error(traducirDB(error.message));
    emitAuth("USER_UPDATED");
    return true;
  }
  const u = demoSessionUser();
  Object.assign(u, patch); persist(); emitAuth("USER_UPDATED");
  return true;
}

function traducirAuth(msg = "") {
  const m = msg.toLowerCase();
  if (m.includes("provider is not enabled") || m.includes("unsupported provider"))
    return "El ingreso con Google todavía no está habilitado en el servidor.";
  if (m.includes("access_denied") || m.includes("cancel")) return "Cancelaste el ingreso con Google.";
  if (m.includes("invalid login credentials") || m.includes("invalid credentials")) return "Usuario o contraseña incorrectos.";
  if (m.includes("email not confirmed")) return "La cuenta todavía no fue habilitada por la administración.";
  if (m.includes("email logins are disabled") || m.includes("email provider")) return "El acceso del personal todavía no está habilitado en el servidor.";
  if (m.includes("rate limit") || m.includes("too many")) return "Demasiados intentos. Esperá unos minutos y volvé a probar.";
  return msg || "No se pudo completar el ingreso.";
}

function traducirDB(msg = "") {
  if (/tipo de cuenta|no está permitido/i.test(msg)) return msg;
  if (/duplicate key|unique/i.test(msg)) return "Ya existe un registro con esos datos.";
  if (/row-level security|permission denied/i.test(msg)) return "No tenés permisos para realizar esa operación.";
  return msg || "No se pudo guardar la información.";
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

/* Lugares habilitados de un catamarán (los quitados quedan fuera de servicio). */
export async function getLugares(catId) {
  await ready();
  if (MODE === "supabase") {
    const { data, error } = await sb.from("lugar").select("*").eq("id_catamaran", catId).eq("activo", true).order("numero");
    if (error) throw error; return data;
  }
  return DB.lugares.filter((l) => l.id_catamaran === catId && l.activo !== false).sort((a, b) => a.numero - b.numero);
}

/* Lugares ocupados (confirmados) en una fecha y, si se indica, en un turno,
 * para todos los catamaranes. En Supabase se lee la vista v_lugares_ocupados,
 * que muestra la ocupación sin revelar quién reservó. */
async function ocupadosPorFecha(fecha, turno = null) {
  let rows;
  if (MODE === "supabase") {
    const { data, error } = await sb.from("v_lugares_ocupados").select("*").eq("fecha", fecha);
    if (error) throw error;
    rows = data;
  } else {
    const lugarCat = new Map(DB.lugares.map((l) => [l.id, l.id_catamaran]));
    rows = DB.reserva_lugar.filter((rl) => rl.fecha === fecha && rl.estado === "confirmada")
      .map((rl) => ({ id_lugar: rl.id_lugar, id_catamaran: lugarCat.get(rl.id_lugar), turno: rl.turno }));
  }
  return turno ? rows.filter((r) => r.turno === turno) : rows;
}

/** Ocupación de un catamarán en una fecha, separada por turno: { manana: [ids], tarde: [ids] }. */
export async function ocupacionPorTurno(catId, fecha) {
  await ready();
  const rows = (await ocupadosPorFecha(fecha)).filter((r) => r.id_catamaran === catId);
  return {
    manana: rows.filter((r) => r.turno === "manana").map((r) => r.id_lugar),
    tarde:  rows.filter((r) => r.turno === "tarde").map((r) => r.id_lugar),
  };
}

/** Lugares que el usuario ya reservó en ese catamarán y fecha: [{ id_lugar, turno }]. */
export async function misLugares(catId, fecha) {
  await ready();
  if (MODE === "supabase") {
    const { data: s } = await sb.auth.getSession();
    const id = s.session?.user?.id;
    if (!id) return [];
    const { data, error } = await sb.from("reserva_lugar")
      .select("id_lugar, turno, reserva!inner(id_usuario, id_catamaran)")
      .eq("fecha", fecha).eq("estado", "confirmada")
      .eq("reserva.id_usuario", id).eq("reserva.id_catamaran", catId);
    if (error) { console.warn(error); return []; }
    return data.map((r) => ({ id_lugar: r.id_lugar, turno: r.turno || "manana" }));
  }
  const u = demoSessionUser();
  if (!u) return [];
  const mias = new Set(DB.reservas.filter((r) => r.id_usuario === u.id && r.id_catamaran === catId).map((r) => r.id));
  return DB.reserva_lugar.filter((rl) => mias.has(rl.id_reserva) && rl.fecha === fecha && rl.estado === "confirmada")
    .map((rl) => ({ id_lugar: rl.id_lugar, turno: rl.turno || "manana" }));
}

/** Catamaranes con lugares libres/ocupados para una fecha y turno (HU-004).
 *  Sin turno, la ocupación es la del día completo: "plazas" suma ambos turnos. */
export async function disponibilidad(fecha, turno = null) {
  await ready();
  const [cats, ocupados] = await Promise.all([listCatamaranes(), ocupadosPorFecha(fecha, turno)]);
  const porCat = new Map();
  ocupados.forEach((r) => porCat.set(r.id_catamaran, (porCat.get(r.id_catamaran) || 0) + 1));
  return cats.map((c) => {
    const ocup = porCat.get(c.id) || 0;
    const plazas = Number(c.capacidad) * (turno ? 1 : 2);
    return { ...c, ocupados: ocup, plazas, libres: Math.max(0, plazas - ocup) };
  });
}

/* ============================================================================
 *  PAGO (HU-007) · pasarela simulada
 *  El prototipo no se integra con una pasarela real: simula la autorización.
 *  Reglas de prueba: con tarjeta se piden número (13-19 dígitos), titular,
 *  vencimiento MM/AA vigente y CVV, y un número terminado en 0000 se rechaza
 *  (escenario "pago fallido" de la matriz de casos de prueba). Con Mercado Pago
 *  se pide el correo de la cuenta. En efectivo se abona en la boletería del
 *  muelle y queda registrado al confirmar.
 * ========================================================================== */
export async function procesarPago({ metodo = "tarjeta", monto = 0, tarjeta = {}, cuenta = "" } = {}) {
  await new Promise((r) => setTimeout(r, 700));   // latencia de la pasarela
  if (!(Number(monto) > 0)) return { aprobado: false, motivo: "El importe a pagar no es válido." };
  if (metodo === "tarjeta") {
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
  if (metodo === "mercadopago" && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(cuenta).trim()))
    return { aprobado: false, motivo: "Ingresá el correo de tu cuenta de Mercado Pago." };
  return { aprobado: true, autorizacion: "AUT-" + Math.random().toString(36).slice(2, 8).toUpperCase() };
}

/* Pasajeros de una reserva (HU-005 y HU-006): uno por lugar, en el orden de los
 * lugares; el primero es el titular (nombre y DNI de su perfil). Cada uno con
 * su permiso: { propio: "N°" } si ya lo tiene (se registra tal cual, sin
 * validarlo) o { especies: [id, ...] } para emitirle uno digital, que cuesta la
 * suma de las especies. Las mismas reglas que crear_reserva_completa. */
const soloDigitosDni = (v) => String(v || "").replace(/\D/g, "");
export const formatoDni = (v) => soloDigitosDni(v).replace(/^(\d{1,2})(\d{3})(\d{3})$/, "$1.$2.$3");
export const precioPermiso = (ids, especies) =>
  (ids || []).reduce((t, id) => t + Number(especies.find((e) => e.id === id)?.precio_permiso || 0), 0);

export function validarPasajeros(pasajeros, { dniTitular = "", especies = [] } = {}) {
  const habilitadas = new Set(especies.filter((e) => e.activa !== false).map((e) => e.id));
  const vistos = new Set();
  return pasajeros.map((x, i) => {
    const quien = i ? `el permiso del acompañante ${i}` : "tu permiso";
    const nombre = i ? String(x?.nombre || "").trim() : null;
    const dni = soloDigitosDni(i ? x?.dni : dniTitular);
    if (i && (nombre.length < 3 || nombre.length > 80)) throw new Error(`Ingresá el nombre y apellido del acompañante ${i}.`);
    if (i && (dni.length < 7 || dni.length > 8)) throw new Error(`El DNI del acompañante ${i} debe tener 7 u 8 dígitos.`);
    if (dni && vistos.has(dni)) throw new Error("Hay un DNI repetido entre los pasajeros.");
    vistos.add(dni);
    const propio = String(x?.propio || "").trim();
    if (propio) {
      if (propio.length < 3 || propio.length > 40) throw new Error(`El número de ${quien} debe tener entre 3 y 40 caracteres.`);
      return { nombre, dni: i ? formatoDni(dni) : null, propio, especies: [] };
    }
    const ids = [...new Set(x?.especies || [])];
    if (!ids.length) throw new Error(`Elegí al menos una especie para ${quien}, o ingresá el número del que ya tiene.`);
    if (ids.some((id) => !habilitadas.has(id))) throw new Error(`Una de las especies elegidas para ${quien} no está habilitada.`);
    return { nombre, dni: i ? formatoDni(dni) : null, propio: null, especies: ids };
  });
}

/* Reserva completa (HU-005, HU-006 y HU-007). `lugares`: el primero es el del
 * titular; `pasajeros`, uno por lugar en el mismo orden ({ nombre, dni } de los
 * acompañantes y { propio } o { especies } de cada permiso). */
const LUGAR_YA_RESERVADO = "Uno de los lugares que elegiste ya fue reservado por otra persona y ya no está disponible. Elegí otro lugar.";

export async function crearReserva({ catamaranId, fecha, turno, lugares, metodo = "tarjeta", pasajeros = [], autorizacion = null }) {
  await ready();
  if (MODE === "supabase") {
    const { data, error } = await sb.rpc("crear_reserva_completa", {
      p_id_catamaran: catamaranId, p_fecha: fecha, p_turno: turno, p_lugares: lugares,
      p_metodo_pago: metodo, p_autorizacion: autorizacion,
      p_pasajeros: pasajeros.map((x, i) => ({
        ...(i ? { nombre: x.nombre, dni: x.dni } : {}),
        ...(String(x.propio || "").trim() ? { permiso_propio: String(x.propio).trim() } : { especies: x.especies || [] }),
      })),
    });
    // Dos reservas simultáneas del mismo lugar: el índice único rechaza la segunda (Tabla 27).
    if (error) throw new Error(error.code === "23505" || /uq_lugar_fecha_turno_activa/.test(error.message || "") ? LUGAR_YA_RESERVADO : error.message);
    return data;
  }
  // Demo: replica la lógica del RPC crear_reserva_completa.
  const u = demoSessionUser();
  const cat = byId(DB.catamaranes, catamaranId);
  turno = turno === "tarde" ? "tarde" : "manana";
  if (!cat) throw new Error("El catamarán no existe.");
  if (cat.estado !== "activa") throw new Error("El catamarán no está disponible para reservas.");
  if (fecha < todayISO()) throw new Error("No se puede reservar una fecha pasada.");
  if (!lugares?.length) throw new Error("Elegí al menos un lugar.");
  if (!["tarjeta", "transferencia", "mercadopago", "efectivo"].includes(metodo)) throw new Error("Medio de pago inválido.");
  for (const lid of lugares) {
    if ((byId(DB.lugares, lid) || {}).id_catamaran !== cat.id) throw new Error("Los lugares elegidos no pertenecen a ese catamarán.");
    if (byId(DB.lugares, lid).activo === false) throw new Error("Uno de los lugares ya no está disponible en ese catamarán. Actualizá el plano.");
  }
  if (!Array.isArray(pasajeros) || pasajeros.length !== lugares.length)
    throw new Error("Completá los datos y el permiso de cada pasajero (uno por lugar).");
  const pas = validarPasajeros(pasajeros, { dniTitular: u.dni, especies: DB.especies });
  for (const lid of lugares) {
    const ocupado = DB.reserva_lugar.some((rl) => rl.id_lugar === lid && rl.fecha === fecha && (rl.turno || "manana") === turno && rl.estado === "confirmada");
    if (ocupado) throw new Error(LUGAR_YA_RESERVADO);
  }
  const montoPermisos = pas.reduce((t, x) => t + (x.propio ? 0 : precioPermiso(x.especies, DB.especies)), 0);
  const monto = cat.precio * lugares.length + montoPermisos;
  const rId = uid();
  const nroReserva = numeroReserva(DB.seqReserva++);
  DB.reservas.push({ id: rId, numero: nroReserva, id_usuario: u.id, id_catamaran: cat.id, fecha, turno, estado: "confirmada", cantidad_lugares: lugares.length, monto_total: monto, monto_permiso: montoPermisos, created_at: new Date().toISOString() });
  const emision = new Date();
  const vence = new Date(fecha + "T23:59:00");
  const numeros = [];
  lugares.forEach((lid, i) => {
    const x = pas[i];
    let pId = null;
    if (!x.propio) {
      const numero = "PCC-" + String(DB.seq++).padStart(6, "0");
      const dni = i ? x.dni : formatoDni(u.dni);
      pId = uid();
      DB.permisos.push({
        id: pId, id_reserva: rId, id_usuario: u.id,
        titular_nombre: i ? x.nombre : `${u.nombre} ${u.apellido || ""}`.trim(), titular_dni: dni,
        numero, codigo_qr: `${numero}|${soloDigitosDni(dni)}|${fecha}`, monto: precioPermiso(x.especies, DB.especies),
        especies: x.especies.map((id) => ({ id_especie: id, precio: Number(byId(DB.especies, id).precio_permiso || 0) })),
        fecha_emision: emision.toISOString(), fecha_vencimiento: vence.toISOString(), estado: "vigente",
      });
      x.especies.forEach((id) => actualizarAlertaFaunaDemo(id, emision));
      numeros.push(numero);
    }
    DB.reserva_lugar.push({ id: uid(), id_reserva: rId, id_lugar: lid, fecha, turno, estado: "confirmada",
      pasajero_nombre: i ? x.nombre : null, pasajero_dni: i ? x.dni : null, id_permiso: pId, permiso_propio: x.propio });
  });
  const comprobante = "CMP-" + rId.replace(/-/g, "").slice(0, 10).toUpperCase();
  DB.pagos.push({ id: uid(), id_reserva: rId, monto, metodo, estado: "aprobado", comprobante, autorizacion, fecha_pago: emision.toISOString() });
  DB.notificaciones.unshift({ id: uid(), id_usuario: u.id, tipo: "reserva", titulo: "Reserva confirmada", mensaje: `Tu reserva ${nroReserva} para el ${fecha.split("-").reverse().join("/")} fue confirmada.${numeros.length ? ` Permisos emitidos: ${numeros.join(", ")}.` : ""}`, leida: false, created_at: emision.toISOString() });
  persist();
  return { reserva_id: rId, numero_reserva: nroReserva, monto_total: monto, monto_permiso: montoPermisos, comprobante, permisos: numeros };
}

/* Demo: replica el disparador actualizar_alerta_fauna (HU-015). Por cada especie
 * de un permiso emitido: si los permisos del mes de la especie alcanzan el 80 %
 * del umbral, se registra la alerta y se avisa a la administración municipal; si
 * ya existe, se actualiza el conteo. */
function actualizarAlertaFaunaDemo(especieId, emision) {
  const esp = byId(DB.especies, especieId);
  if (!esp || !(esp.umbral_permisos > 0)) return;
  const periodo = dateISO(emision).slice(0, 7);
  const cant = DB.permisos.filter((p) => p.estado !== "anulado" && (p.especies || []).some((e) => e.id_especie === esp.id)
    && dateISO(new Date(p.fecha_emision)).slice(0, 7) === periodo).length;
  const alerta = DB.alertas.find((a) => a.id_especie === esp.id && a.periodo === periodo && a.estado === "activa");
  if (alerta) { alerta.permisos_emitidos = Math.max(alerta.permisos_emitidos, cant); alerta.umbral = esp.umbral_permisos; return; }
  if (cant * 100 < esp.umbral_permisos * 80) return;
  DB.alertas.unshift({ id: uid(), id_especie: esp.id, periodo, permisos_emitidos: cant, umbral: esp.umbral_permisos, estado: "activa", created_at: emision.toISOString() });
  DB.usuarios.filter((x) => x.rol === "admin_municipal" && x.activo !== false).forEach((adm) => DB.notificaciones.unshift({
    id: uid(), id_usuario: adm.id, tipo: "sistema", titulo: "Alerta de fauna",
    mensaje: `Los permisos de ${esp.nombre} del período ${periodo} llegaron a ${cant} sobre un umbral de ${esp.umbral_permisos}.`,
    leida: false, created_at: emision.toISOString(),
  }));
}

export async function anularReserva(reservaId) {
  await ready();
  if (MODE === "supabase") {
    const { error } = await sb.rpc("anular_reserva", { p_id_reserva: reservaId });
    if (error) throw new Error(error.message);
    return true;
  }
  // Las mismas reglas que public.anular_reserva.
  const r = byId(DB.reservas, reservaId);
  if (!r) throw new Error("La reserva no existe.");
  const u = demoSessionUser();
  const admin = esRolPersonal(u?.rol);
  if (!u || (r.id_usuario !== u.id && !admin)) throw new Error("No autorizado para anular esta reserva.");
  if (r.estado !== "confirmada") throw new Error("Sólo se puede anular una reserva confirmada.");
  if (!admin && r.fecha < todayISO()) throw new Error("No se puede anular una salida que ya pasó.");
  r.estado = "cancelada";
  DB.reserva_lugar.filter((rl) => rl.id_reserva === reservaId).forEach((rl) => (rl.estado = "cancelada"));
  // Los permisos emitidos con la reserva se anulan, salvo el que otra reserva activa declaró como propio.
  const declarado = (numero) => DB.reserva_lugar.some((rl) => rl.id_reserva !== reservaId && String(rl.permiso_propio || "").toUpperCase() === numero.toUpperCase()
    && ["confirmada", "completada"].includes(byId(DB.reservas, rl.id_reserva)?.estado));
  DB.permisos.filter((p) => p.id_reserva === reservaId && !declarado(p.numero)).forEach((p) => (p.estado = "anulado"));
  persist();
  return true;
}

/* ============================================================================
 *  RESERVAS Y PERMISOS DEL USUARIO
 * ========================================================================== */
/* Igual que la política reserva_select: las propias y, para el dueño, también
 * las de sus catamaranes. */
function scopeReservasDemo(u) {
  if (u.rol === "admin_municipal" || u.rol === "admin_sistema") return DB.reservas;
  const mis = new Set(u.rol === "dueno" ? DB.catamaranes.filter((c) => c.id_propietario === u.id).map((c) => c.id) : []);
  return DB.reservas.filter((r) => r.id_usuario === u.id || mis.has(r.id_catamaran));
}

/* Pescadores y dueños abren cada reserva y cada permiso a partir de la lista
 * completa (con los datos del comprobante y del permiso): como la pantalla
 * principal lee esas listas, al abrir la app con conexión todas quedan
 * guardadas en el dispositivo y cualquiera puede consultarse sin conexión,
 * aunque no se haya abierto antes. El personal no usa ese modo y consulta cada
 * una por separado. */
const CAMPOS_PERMISO_RESERVA = "id,numero,estado,codigo_qr,fecha_emision,fecha_vencimiento,titular_nombre,titular_dni,monto,permiso_especie(precio,especie(nombre))";
const SEL_RESERVA = `*, catamaran(nombre,habilitacion,capacidad), usuario(nombre,apellido,dni,email), reserva_lugar(pasajero_nombre, pasajero_dni, id_permiso, permiso_propio, lugar(numero)), pago(*), permiso!permiso_id_reserva_fkey(${CAMPOS_PERMISO_RESERVA})`;
const SEL_PERMISO = "*, permiso_especie(precio,especie(nombre,nombre_cientifico)), reserva!permiso_id_reserva_fkey(id,numero,fecha,turno,cantidad_lugares,monto_total,catamaran(nombre),pago(comprobante,metodo,estado))";
const reservasCompletas = () => sb.from("reserva").select(SEL_RESERVA).order("fecha", { ascending: false });
const permisosCompletos = () => sb.from("permiso").select(SEL_PERMISO).order("fecha_emision", { ascending: false });
const detalleDesdeLista = () => Boolean(rolSesion) && !esRolPersonal(rolSesion);

/* Fila `id` de una lista completa; si no está (por ejemplo, una reserva recién
 * pagada cuando la lista vino de la copia guardada), se consulta sola. */
async function buscarDetalle(lista, tabla, sel, id) {
  if (detalleDesdeLista()) {
    const { data } = await lista();
    const fila = (data || []).find((x) => x.id === id);
    if (fila) return fila;
  }
  const { data, error } = await sb.from(tabla).select(sel).eq("id", id).maybeSingle();
  if (error) throw error;
  return data;
}

/* Permiso del titular de una reserva (el de su lugar: el primero sin acompañante):
 * { permiso_id, numero_permiso } (el número declarado si ya tenía uno). */
function permisoDelTitular(filas, permisos) {
  const t = filas.slice().sort((a, b) => a.lugar - b.lugar).find((x) => !x.pasajero_nombre);
  const per = t?.id_permiso ? permisos.find((p) => p.id === t.id_permiso) : null;
  return { permiso_id: per?.id || null, numero_permiso: per?.numero || t?.permiso_propio || null };
}

export async function listReservas() {
  await ready();
  if (MODE === "supabase") {
    const { data, error } = await reservasCompletas();
    if (error) throw error;
    return data.map((r) => {
      const filas = (r.reserva_lugar || []).map((x) => ({ ...x, lugar: x.lugar?.numero }));
      const permisos = Array.isArray(r.permiso) ? r.permiso : r.permiso ? [r.permiso] : [];
      return { ...r, catamaran_nombre: r.catamaran?.nombre || "", ...permisoDelTitular(filas, permisos), lugares: filas.map((x) => x.lugar).filter(Boolean).sort((a, b) => a - b) };
    });
  }
  const u = demoSessionUser();
  return scopeReservasDemo(u)
    .slice().sort((a, b) => (a.fecha < b.fecha ? 1 : -1))
    .map((r) => {
      const cat = byId(DB.catamaranes, r.id_catamaran);
      const filas = DB.reserva_lugar.filter((x) => x.id_reserva === r.id).map((x) => ({ ...x, lugar: byId(DB.lugares, x.id_lugar)?.numero }));
      const permisos = DB.permisos.filter((p) => p.id_reserva === r.id);
      return { ...r, catamaran_nombre: cat?.nombre || "", ...permisoDelTitular(filas, permisos), lugares: filas.map((x) => x.lugar).filter(Boolean).sort((a, b) => a - b) };
    });
}

/* Igual que la política permiso_select: cada cuenta del público ve sólo sus
 * permisos (el dueño no ve los de sus pasajeros). */
function scopePermisosDemo(u) {
  if (u.rol === "admin_municipal" || u.rol === "admin_sistema") return DB.permisos;
  return DB.permisos.filter((p) => p.id_usuario === u.id);
}

export async function listPermisos() {
  await ready();
  if (MODE === "supabase") {
    const { data, error } = await permisosCompletos();
    if (error) throw error;
    return data.map(mapPermisoSupabase);
  }
  const u = demoSessionUser();
  return scopePermisosDemo(u)
    .slice().sort((a, b) => (a.fecha_emision < b.fecha_emision ? 1 : -1))
    .map(enrichPermisoDemo);
}

export async function getPermiso(id) {
  await ready();
  if (MODE === "supabase") {
    const data = await buscarDetalle(permisosCompletos, "permiso", SEL_PERMISO, id);
    return data ? mapPermisoSupabase(data) : null;
  }
  const p = byId(DB.permisos, id);
  if (!p || !scopePermisosDemo(demoSessionUser()).includes(p)) return null;
  return enrichPermisoDemo(p);
}

/* Permiso con los datos de su salida: especies (con su precio), quién lo usa,
 * catamarán, fecha y turno, y el pago de la reserva. */
function armarPermiso(p, { reserva = null, especies = [] } = {}) {
  const r = reserva || {};
  const pago = Array.isArray(r.pago) ? r.pago[0] : r.pago;
  p = applyPermisoEstado(p);   // un permiso vencido se muestra así aunque la base aún no lo haya marcado
  return {
    ...p, especies,
    especie_nombre: especies.map((e) => e.nombre).join(", ") || "—",
    catamaran_nombre: r.catamaran?.nombre || "—",
    fecha: r.fecha || null, turno: r.turno || null, reserva_numero: r.numero || null, reserva_id: r.id || null,
    titular_nombre: p.titular_nombre || "—", titular_dni: p.titular_dni || "—", monto: Number(p.monto || 0),
    pago_comprobante: pago?.comprobante || "", pago_metodo: pago?.metodo || "",
  };
}
const especiesDePermisoSupabase = (p) => (p.permiso_especie || [])
  .map((x) => ({ nombre: x.especie?.nombre || "—", cientifico: x.especie?.nombre_cientifico || "", precio: Number(x.precio || 0) }))
  .sort((a, b) => a.nombre.localeCompare(b.nombre));
const especiesDePermisoDemo = (p) => (p.especies || [])
  .map((x) => { const e = byId(DB.especies, x.id_especie); return { nombre: e?.nombre || "—", cientifico: e?.nombre_cientifico || "", precio: Number(x.precio || 0) }; })
  .sort((a, b) => a.nombre.localeCompare(b.nombre));
const mapPermisoSupabase = (p) => armarPermiso(p, { reserva: p.reserva, especies: especiesDePermisoSupabase(p) });
function enrichPermisoDemo(p) {
  const r = byId(DB.reservas, p.id_reserva);
  const reserva = r ? { ...r, catamaran: byId(DB.catamaranes, r.id_catamaran), pago: DB.pagos.find((x) => x.id_reserva === r.id) } : null;
  return armarPermiso(p, { reserva, especies: especiesDePermisoDemo(p) });
}

/* ============================================================================
 *  COMPROBANTE DE LA OPERACIÓN (reserva + pago + permisos)
 *  Devuelve { numero, fecha, turno, estado, catamaran, capacidad, lugares[],
 *  pasajeros[], titular, monto_total, monto_permiso, monto_lugares,
 *  precio_lugar, pago } o null si no existe o no es visible para el usuario.
 *  pasajeros: uno por lugar (el titular primero), con su permiso digital o el
 *  número del que ya tenía.
 * ========================================================================== */
const numeroReservaDe = (r) => r.numero || "RES-" + String(r.id).replace(/-/g, "").slice(0, 8).toUpperCase();

function armarComprobante(r, { cat, titular, filas, permisos = [], pago }) {
  const montoPermiso = Number(r.monto_permiso || 0);
  const montoLugares = Number(r.monto_total || 0) - montoPermiso;
  const porId = new Map(permisos.map((x) => [x.id, x]));
  const orden = filas.slice().sort((a, b) => a.lugar - b.lugar);
  let conTitular = false;
  const pasajeros = orden.map((f) => {
    const esTitular = !f.pasajero_nombre && !conTitular;
    if (esTitular) conTitular = true;
    const per = f.id_permiso ? porId.get(f.id_permiso) : null;
    return {
      lugar: f.lugar, titular: esTitular,
      nombre: f.pasajero_nombre || (esTitular && titular ? `${titular.nombre || ""} ${titular.apellido || ""}`.trim() : null),
      dni: f.pasajero_dni || (esTitular ? titular?.dni || null : null),
      permiso: per ? { id: per.id, numero: per.numero, estado: per.estado, monto: per.monto, especies: per.especies, especie_nombre: per.especie_nombre } : null,
      permiso_propio: f.permiso_propio || null,
    };
  }).sort((a, b) => Number(b.titular) - Number(a.titular) || a.lugar - b.lugar);
  return {
    id: r.id, id_usuario: r.id_usuario, numero: numeroReservaDe(r), fecha: r.fecha, turno: r.turno, estado: r.estado, created_at: r.created_at,
    catamaran: cat?.nombre || "—", habilitacion: cat?.habilitacion || "", capacidad: Number(cat?.capacidad || 0),
    lugares: orden.map((f) => f.lugar),
    pasajeros,
    titular: titular ? { nombre: `${titular.nombre || ""} ${titular.apellido || ""}`.trim(), dni: titular.dni || "—", email: titular.email || "" } : null,
    monto_total: Number(r.monto_total || 0), monto_permiso: montoPermiso, monto_lugares: montoLugares,
    precio_lugar: r.cantidad_lugares ? montoLugares / r.cantidad_lugares : 0, cantidad_lugares: r.cantidad_lugares,
    permisos_emitidos: pasajeros.filter((x) => x.permiso).length,
    pago: pago ? { comprobante: pago.comprobante, metodo: pago.metodo, estado: pago.estado, monto: Number(pago.monto || 0), fecha_pago: pago.fecha_pago, autorizacion: pago.autorizacion || "" } : null,
  };
}

export async function getComprobante(reservaId) {
  await ready();
  if (MODE === "supabase") {
    const r = await buscarDetalle(reservasCompletas, "reserva", SEL_RESERVA, reservaId);
    if (!r) return null;
    const permisos = (Array.isArray(r.permiso) ? r.permiso : r.permiso ? [r.permiso] : [])
      .map((x) => armarPermiso(x, { reserva: r, especies: especiesDePermisoSupabase(x) }));
    return armarComprobante(r, {
      cat: r.catamaran, titular: r.usuario, pago: Array.isArray(r.pago) ? r.pago[0] : r.pago, permisos,
      filas: (r.reserva_lugar || []).map((x) => ({ ...x, lugar: x.lugar?.numero })).filter((x) => x.lugar),
    });
  }
  const u = demoSessionUser();
  const r = byId(DB.reservas, reservaId);
  if (!r || !u || !scopeReservasDemo(u).includes(r)) return null;
  // Como en la base (RLS): el dueño ve la reserva de un pasajero en su
  // catamarán, pero no sus datos personales, su pago ni sus permisos.
  const ajena = r.id_usuario !== u.id && !esRolPersonal(u.rol);
  return armarComprobante(r, {
    cat: byId(DB.catamaranes, r.id_catamaran), titular: ajena ? null : byId(DB.usuarios, r.id_usuario),
    pago: ajena ? null : DB.pagos.find((x) => x.id_reserva === r.id),
    permisos: ajena ? [] : DB.permisos.filter((p) => p.id_reserva === r.id).map(enrichPermisoDemo),
    filas: DB.reserva_lugar.filter((x) => x.id_reserva === r.id)
      .map((x) => ajena ? { lugar: byId(DB.lugares, x.id_lugar)?.numero } : { ...x, lugar: byId(DB.lugares, x.id_lugar)?.numero }),
  });
}

/* ============================================================================
 *  NOTIFICACIONES
 * ========================================================================== */
export async function listNotificaciones() {
  await ready();
  if (MODE === "supabase") {
    const { data, error } = await sb.from("notificacion").select("*, reserva(fecha, turno, catamaran(nombre))").order("created_at", { ascending: false }).limit(30);
    if (error) throw error; return data;
  }
  const u = demoSessionUser();
  return DB.notificaciones.filter((n) => n.id_usuario === u.id).slice().sort((a, b) => (a.created_at < b.created_at ? 1 : -1))
    .map((n) => {
      const r = n.id_reserva && byId(DB.reservas, n.id_reserva);
      return r ? { ...n, reserva: { fecha: r.fecha, turno: r.turno, catamaran: { nombre: byId(DB.catamaranes, r.id_catamaran)?.nombre || "" } } } : n;
    });
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
 * En Supabase lo hace la función generar_recordatorios, que además pone al día
 * los estados (permisos vencidos, salidas realizadas); pg_cron la ejecuta a
 * diario para todos los usuarios. */
export async function generarRecordatorios() {
  await ready();
  if (!prefRecordatorios()) return 0;
  if (MODE === "supabase") {
    const { data, error } = await sb.rpc("generar_recordatorios", { p_solo_usuario: true });
    if (error) { console.warn("generar_recordatorios:", error.message); return 0; }
    if (Number(data) > 0) emitAuth("NOTIF");
    return Number(data) || 0;
  }
  const u = demoSessionUser();
  if (!u) return 0;
  const hoy = todayISO(), manana = dateISO(isoFromOffset(1));
  // Igual que public.actualizar_estados: permisos vencidos y salidas ya realizadas.
  DB.permisos.forEach((x) => { if (x.estado === "vigente" && new Date(x.fecha_vencimiento).getTime() < Date.now()) x.estado = "vencido"; });
  DB.reservas.forEach((x) => { if (x.estado === "confirmada" && x.fecha < hoy) x.estado = "completada"; });
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
  persist();
  return n;
}

/* ============================================================================
 *  ESPECIES (fauna)
 * ========================================================================== */
/* Especies (HU-006 y HU-015) con el precio de cada una en el permiso. */
export async function listEspecies() {
  await ready();
  if (MODE === "supabase") {
    const { data, error } = await sb.from("especie").select("*").order("nombre");
    if (error) throw error;
    return data.map((e) => ({ ...e, precio_permiso: Number(e.precio_permiso || 0) }));
  }
  return [...DB.especies].sort((a, b) => a.nombre.localeCompare(b.nombre));
}

/* Alta o cambio de una especie (municipio y administración): nombre, nombre
 * científico, precio del permiso, umbral de alertas, descripción y si está
 * habilitada. Las especies no se borran (tienen permisos): se desactivan. */
export async function guardarEspecie({ id = null, nombre, nombre_cientifico = "", precio_permiso, umbral_permisos = 500, descripcion = "", activa = true }) {
  await ready();
  const fila = {
    nombre: String(nombre || "").trim(), nombre_cientifico: String(nombre_cientifico || "").trim() || null,
    precio_permiso: Number(precio_permiso), umbral_permisos: Number(umbral_permisos),
    descripcion: String(descripcion || "").trim() || null, activa: Boolean(activa),
  };
  if (fila.nombre.length < 2 || fila.nombre.length > 60) throw new Error("El nombre debe tener entre 2 y 60 caracteres.");
  if (!Number.isFinite(fila.precio_permiso) || fila.precio_permiso < 0) throw new Error("Ingresá un precio válido (0 o más).");
  if (!Number.isInteger(fila.umbral_permisos) || fila.umbral_permisos < 0) throw new Error("El umbral debe ser un número entero (0 o más).");
  if (MODE === "supabase") {
    const q = id ? sb.from("especie").update(fila).eq("id", id) : sb.from("especie").insert(fila);
    const { data, error } = await q.select("id");
    if (error) throw new Error(error.code === "23505" ? "Ya existe una especie con ese nombre." : traducirDB(error.message));
    if (!data?.length) throw new Error("No autorizado para modificar las especies.");
    return data[0].id;
  }
  const u = demoSessionUser();
  if (!esRolPersonal(u?.rol)) throw new Error("No autorizado para modificar las especies.");
  if (DB.especies.some((e) => e.id !== id && e.nombre.toLowerCase() === fila.nombre.toLowerCase())) throw new Error("Ya existe una especie con ese nombre.");
  if (id) Object.assign(byId(DB.especies, id), fila);
  else DB.especies.push({ id: id = uid(), ...fila, created_at: new Date().toISOString() });
  persist();
  return id;
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

async function ocupacionCatamaranes() {
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
    permisos_emitidos: DB.permisos.filter((p) => p.estado !== "anulado" && (p.especies || []).some((x) => x.id_especie === e.id)).length,
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
      .select("id,numero,estado,fecha_emision,titular_nombre,permiso_especie(especie(nombre)),reserva!permiso_id_reserva_fkey(fecha)")
      .order("fecha_emision", { ascending: false }).limit(limit);
    if (error) throw error;
    return data.map((p) => ({
      id: p.id, numero: p.numero, estado: p.estado, titular: p.titular_nombre || "—",
      especie: (p.permiso_especie || []).map((x) => x.especie?.nombre).filter(Boolean).sort().join(", ") || "—", fecha: p.reserva?.fecha || null,
    }));
  }
  return DB.permisos.map(applyPermisoEstado).slice()
    .sort((a, b) => (a.fecha_emision < b.fecha_emision ? 1 : -1)).slice(0, limit)
    .map((p) => ({
      id: p.id, numero: p.numero, estado: p.estado, titular: p.titular_nombre || "—",
      especie: especiesDePermisoDemo(p).map((e) => e.nombre).join(", ") || "—", fecha: byId(DB.reservas, p.id_reserva)?.fecha || null,
    }));
}

/* ============================================================================
 *  REPORTES AL MUNICIPIO (HU-009)
 *  Cada envío queda registrado en la tabla "reporte" con fecha, destinatario,
 *  origen (manual / automático) y una instantánea de los indicadores. En
 *  Supabase lo realiza la función generar_reporte_municipal, que además
 *  notifica a los administradores municipales; pg_cron la ejecuta al cierre
 *  de cada mes.
 * ========================================================================== */
const DESTINATARIO = () => CFG.MUNICIPIO || "Municipio de Coronel Moldes";
const periodoActual = () => todayISO().slice(0, 7);
/* Mes anterior (YYYY-MM): el reporte automático resume el mes que cerró. */
const periodoAnterior = () => { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - 1); return dateISO(d).slice(0, 7); };
const finDeMes = (periodo) => { const [y, m] = periodo.split("-").map(Number); return dateISO(new Date(y, m, 0)); };
const tituloReporte = (tipo, periodo) => ({
  ocupacion: "Reporte de ocupación de catamaranes", permisos: "Reporte de permisos emitidos",
  fauna: "Reporte de presión pesquera por especie", ingresos: "Reporte de ingresos",
}[tipo] || "Reporte general de actividad pesquera") + " · " + periodo;

async function snapshotReporte(periodo) {
  const [resumen, permisos_por_especie, ocupacion_catamaranes, reservas_por_dia] = await Promise.all([
    dashboardResumen(), permisosPorEspecie(), ocupacionCatamaranes(), reservasPorDia({ from: periodo + "-01", to: finDeMes(periodo) }),
  ]);
  return { resumen, permisos_por_especie, ocupacion_catamaranes, reservas_por_dia, generado_en: new Date().toISOString() };
}

export async function enviarReporteMunicipio(tipo = "general", origen = "manual") {
  await ready();
  const destinatario = DESTINATARIO();
  const periodo = origen === "automatico" ? periodoAnterior() : periodoActual();
  if (MODE === "supabase") {
    const { data, error } = await sb.rpc("generar_reporte_municipal", { p_tipo: tipo, p_origen: origen });
    if (error) throw new Error(error.message);
    return data;
  }
  const u = demoSessionUser();
  const datos = await snapshotReporte(periodo);
  const rep = {
    id: uid(), tipo, titulo: tituloReporte(tipo, periodo), fecha: todayISO(),
    parametros: { periodo, origen, destinatario }, destinatario, origen, estado_envio: "enviado",
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

/* Cierre de período: si el mes que cerró todavía no tiene reporte automático,
 * lo genera. Cubre el caso en que pg_cron no esté habilitado. */
export async function asegurarReporteMensual() {
  await ready();
  const existentes = await listReportes(50);
  const periodo = periodoAnterior();
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

/* La administración cambia el tipo de cuenta (pescador o dueño) y el estado de
 * las cuentas del público; el estado de las cuentas del personal, sólo el
 * administrador del sistema. Los roles administrativos se fijan al dar de alta
 * la cuenta del personal (lo controla public.proteger_perfil). */
export const esRolPersonal = (rol) => rol === "admin_municipal" || rol === "admin_sistema";

export async function setRol(userId, rol) {
  await ready();
  // HU-012 · criterio 2: un tipo de cuenta inexistente se rechaza con un aviso.
  if (esRolPersonal(rol)) throw new Error("Los roles administrativos se asignan al dar de alta una cuenta del personal.");
  if (rol !== "pescador" && rol !== "dueno") throw new Error("Ese tipo de cuenta no existe: elegí Pescador/Turista o Dueño de catamarán.");
  if (MODE === "supabase") {
    const { data, error } = await sb.from("usuario").update({ rol }).eq("id", userId).select("id");
    if (error) throw new Error(error.message);
    if (!data?.length) throw new Error("No se pudo cambiar el tipo de cuenta. Volvé a ingresar e intentá de nuevo.");
    return true;
  }
  const u = byId(DB.usuarios, userId);
  if (u && esRolPersonal(u.rol)) throw new Error("El rol de una cuenta del personal no se modifica.");
  if (u) u.rol = rol; persist();
  return true;
}

/* Activa o desactiva una cuenta (plan de contingencia: cuentas comprometidas).
 * Una cuenta desactivada pierde sus permisos y sus sesiones se cierran en la
 * base; además, el enrutador cierra la sesión abierta en el dispositivo. */
export async function setActivo(userId, activo) {
  await ready();
  if (MODE === "supabase") {
    const { data, error } = await sb.from("usuario").update({ activo: Boolean(activo) }).eq("id", userId).select("id");
    if (error) throw new Error(error.message);
    if (!data?.length) throw new Error("No se pudo cambiar el estado de la cuenta. Volvé a ingresar e intentá de nuevo.");
    return true;
  }
  const u = byId(DB.usuarios, userId);
  if (u && esRolPersonal(u.rol) && demoSessionUser()?.rol !== "admin_sistema")
    throw new Error("Solo el administrador del sistema puede activar o desactivar cuentas del personal.");
  if (u) u.activo = Boolean(activo); persist();
  return true;
}

/* ============================================================================
 *  PERSONAL: alta de cuentas del municipio y de la administración
 *  Sólo el administrador del sistema (crear_cuenta_personal y
 *  cambiar_clave_personal en la base). El usuario corto se traduce al correo
 *  del dominio reservado, igual que en el ingreso.
 * ========================================================================== */
/** Requisitos de la contraseña del personal (los mismos que exige la base). */
export function claveSegura(clave = "") {
  return clave.length >= 12 && /[a-z]/.test(clave) && /[A-Z]/.test(clave) && /\d/.test(clave) && /[^A-Za-z0-9]/.test(clave);
}
const CLAVE_DEBIL = "La contraseña debe tener al menos 12 caracteres, con minúsculas, mayúsculas, números y símbolos.";
/** Usuario corto de una cuenta del personal (la parte del correo antes de la @). */
export const usuarioPersonal = (email = "") => String(email).split("@")[0];

export async function crearCuentaPersonal({ usuario, nombre, apellido = "", rol, clave }) {
  await ready();
  usuario = String(usuario || "").trim().toLowerCase();
  if (!/^[a-z0-9._-]{3,30}$/.test(usuario)) throw new Error("El usuario debe tener entre 3 y 30 caracteres: letras minúsculas, números, punto o guiones.");
  if (!esRolPersonal(rol)) throw new Error("Elegí el rol de la cuenta.");
  if (!String(nombre || "").trim()) throw new Error("Ingresá el nombre.");
  if (!claveSegura(clave)) throw new Error(CLAVE_DEBIL);
  if (MODE === "supabase") {
    const { data, error } = await sb.rpc("crear_cuenta_personal", { p_usuario: usuario, p_nombre: nombre, p_apellido: apellido, p_rol: rol, p_clave: clave });
    if (error) throw new Error(error.message);
    return data;
  }
  if (demoSessionUser()?.rol !== "admin_sistema") throw new Error("Solo el administrador del sistema puede dar de alta cuentas del personal.");
  const email = `${usuario}@demo.com`;
  DB.clavesPersonal = DB.clavesPersonal || {};
  if (CLAVES_DEMO[usuario] || DB.clavesPersonal[usuario] || DB.usuarios.some((u) => u.email === email))
    throw new Error(`Ya existe una cuenta con el usuario ${usuario}`);
  const u = { id: uid(), nombre: String(nombre).trim(), apellido: String(apellido).trim(), email, telefono: "", dni: "", rol, activo: true, perfil_completo: true, created_at: new Date().toISOString() };
  DB.usuarios.push(u);
  DB.clavesPersonal[usuario] = { email, clave };
  persist();
  return { id: u.id, usuario, email, rol };
}

export async function cambiarClavePersonal(userId, clave) {
  await ready();
  if (!claveSegura(clave)) throw new Error(CLAVE_DEBIL);
  if (MODE === "supabase") {
    const { error } = await sb.rpc("cambiar_clave_personal", { p_id: userId, p_clave: clave });
    if (error) throw new Error(error.message);
    return true;
  }
  if (demoSessionUser()?.rol !== "admin_sistema") throw new Error("Solo el administrador del sistema puede cambiar contraseñas del personal.");
  const u = byId(DB.usuarios, userId);
  if (!u || !esRolPersonal(u.rol)) throw new Error("La cuenta no es del personal");
  DB.clavesPersonal = DB.clavesPersonal || {};
  DB.clavesPersonal[usuarioPersonal(u.email)] = { email: u.email, clave };
  persist();
  return true;
}

/* ============================================================================
 *  AVISOS de la administración (llegan a la campanita de los usuarios)
 *  destino: todos | pescador | dueno | usuario (una persona, idUsuario).
 * ========================================================================== */
export const DESTINOS_AVISO = { todos: "Todos los usuarios", pescador: "Pescadores y turistas", dueno: "Dueños de catamarán", usuario: "Un usuario" };

export async function publicarAviso({ titulo, mensaje, destino = "todos", idUsuario = null }) {
  await ready();
  titulo = String(titulo || "").trim(); mensaje = String(mensaje || "").trim();
  if (titulo.length < 3 || titulo.length > 80) throw new Error("El título debe tener entre 3 y 80 caracteres.");
  if (mensaje.length < 3 || mensaje.length > 500) throw new Error("El mensaje debe tener entre 3 y 500 caracteres.");
  if (!DESTINOS_AVISO[destino]) throw new Error("Elegí los destinatarios.");
  if (destino === "usuario" && !idUsuario) throw new Error("Elegí el usuario.");
  if (MODE === "supabase") {
    const { data, error } = await sb.rpc("publicar_aviso", { p_titulo: titulo, p_mensaje: mensaje, p_destino: destino, p_id_usuario: destino === "usuario" ? idUsuario : null });
    if (error) throw new Error(error.message);
    return data;
  }
  const autor = demoSessionUser();
  if (!esRolPersonal(autor?.rol)) throw new Error("Solo la administración puede publicar avisos");
  const ahora = new Date().toISOString();
  const dest = DB.usuarios.filter((u) => u.activo !== false && (u.rol === "pescador" || u.rol === "dueno")
    && (destino === "todos" || (destino === "usuario" ? u.id === idUsuario : u.rol === destino)));
  if (destino === "usuario" && !dest.length) throw new Error("Elegí una cuenta activa del público");
  dest.forEach((u) => DB.notificaciones.unshift({ id: uid(), id_usuario: u.id, tipo: "aviso", titulo, mensaje, leida: false, created_at: ahora }));
  const aviso = { id: uid(), titulo, mensaje, destino, id_destinatario: destino === "usuario" ? idUsuario : null, destinatarios: dest.length, publicado_por: autor.id, created_at: ahora };
  DB.avisos = [aviso, ...(DB.avisos || [])];
  persist();
  return { id: aviso.id, destinatarios: dest.length };
}

export async function listAvisos(limit = 30) {
  await ready();
  if (MODE === "supabase") {
    const { data, error } = await sb.from("aviso")
      .select("*, autor:usuario!aviso_publicado_por_fkey(nombre, apellido), destinatario:usuario!aviso_id_destinatario_fkey(nombre, apellido, email)")
      .order("created_at", { ascending: false }).limit(limit);
    if (error) throw error;
    return data;
  }
  return (DB.avisos || []).slice(0, limit).map((a) => ({
    ...a,
    autor: byId(DB.usuarios, a.publicado_por) || null,
    destinatario: a.id_destinatario ? byId(DB.usuarios, a.id_destinatario) || null : null,
  }));
}

/* ============================================================================
 *  DUEÑO DE CATAMARÁN (HU-003): catamaranes, lugares, salidas y finanzas
 *  El alta crea el catamarán con todos sus lugares (crear_catamaran) y la
 *  cantidad de lugares se cambia con cambiar_capacidad, que no deja quitar
 *  lugares con reservas desde hoy. Los gastos son privados de cada dueño.
 * ========================================================================== */
const ESTADOS_CATAMARAN = ["activa", "inactiva", "mantenimiento"];

export async function crearCatamaran({ nombre, descripcion = "", capacidad, precio, habilitacion, estado = "activa" }) {
  await ready();
  if (MODE === "supabase") {
    const { data, error } = await sb.rpc("crear_catamaran", {
      p_nombre: nombre, p_descripcion: descripcion, p_capacidad: capacidad, p_precio: precio,
      p_habilitacion: habilitacion, p_estado: estado,
    });
    if (error) throw new Error(error.message);
    return data;
  }
  // Demo: las mismas reglas que public.crear_catamaran.
  const u = demoSessionUser();
  if (!u || !(u.rol === "dueno" || esRolPersonal(u.rol))) throw new Error("Solo un dueño de catamarán o la administración pueden dar de alta catamaranes.");
  nombre = String(nombre || "").trim();
  if (!nombre || nombre.length > 60) throw new Error("Ingresá el nombre del catamarán (hasta 60 caracteres).");
  if (String(descripcion || "").length > 300) throw new Error("La descripción puede tener hasta 300 caracteres.");
  if (!(Number.isInteger(+capacidad) && +capacidad >= 1 && +capacidad <= 60)) throw new Error("La cantidad de lugares debe ser un número entero entre 1 y 60.");
  if (!(+precio >= 0)) throw new Error("Ingresá un precio por lugar válido.");
  if (!String(habilitacion || "").trim()) throw new Error("Ingresá el número de habilitación municipal.");
  if (!ESTADOS_CATAMARAN.includes(estado)) throw new Error("Estado inválido.");
  const id = uid();
  DB.catamaranes.push({
    id, id_propietario: u.rol === "dueno" ? u.id : null, nombre, descripcion: String(descripcion || "").trim(),
    capacidad: +capacidad, precio: +precio, habilitacion: String(habilitacion).trim(), estado, fotos: [], created_at: new Date().toISOString(),
  });
  for (let n = 1; n <= capacidad; n++)
    DB.lugares.push({ id: uid(), id_catamaran: id, numero: n, ubicacion: ubicacionLugar(n, +capacidad), activo: true });
  persist();
  return id;
}

/* Demo: el dueño modifica sólo sus catamaranes; la administración, todos. */
function catamaranEditableDemo(id) {
  const u = demoSessionUser();
  const c = byId(DB.catamaranes, id);
  if (!c) throw new Error("El catamarán no existe.");
  if (!esRolPersonal(u?.rol) && !(u?.rol === "dueno" && c.id_propietario === u.id)) throw new Error("No autorizado para modificar este catamarán.");
  return c;
}

/** Nombre, descripción, precio, habilitación y estado. La capacidad, con cambiarCapacidad. */
export async function updateCatamaran(id, patch) {
  await ready();
  const { nombre, descripcion, precio, habilitacion, estado } = patch;
  const datos = { nombre, descripcion, precio, habilitacion, estado };
  if (MODE === "supabase") {
    const { error } = await sb.from("catamaran").update(datos).eq("id", id);
    if (error) throw new Error(traducirDB(error.message)); return true;
  }
  Object.assign(catamaranEditableDemo(id), datos); persist();
  return true;
}

/** Cambia la cantidad de lugares (igual que public.cambiar_capacidad). */
export async function cambiarCapacidad(id, capacidad) {
  await ready();
  if (MODE === "supabase") {
    const { error } = await sb.rpc("cambiar_capacidad", { p_id_catamaran: id, p_capacidad: capacidad });
    if (error) throw new Error(error.message);
    return true;
  }
  const c = catamaranEditableDemo(id);
  if (!(Number.isInteger(+capacidad) && +capacidad >= 1 && +capacidad <= 60)) throw new Error("La cantidad de lugares debe ser un número entero entre 1 y 60.");
  capacidad = +capacidad;
  if (capacidad === c.capacidad) return true;
  const hoy = todayISO();
  const delCat = DB.lugares.filter((l) => l.id_catamaran === id);
  const conReservas = delCat.filter((l) => l.numero > capacidad
    && DB.reserva_lugar.some((rl) => rl.id_lugar === l.id && rl.estado === "confirmada" && rl.fecha >= hoy)).map((l) => l.numero).sort((a, b) => a - b);
  if (conReservas.length) throw new Error(`Hay reservas desde hoy en lugares que se quitarían (${conReservas.join(", ")}). Elegí una cantidad mayor o esperá a que pasen esas salidas.`);
  const usados = new Set(DB.reserva_lugar.map((rl) => rl.id_lugar));
  DB.lugares = DB.lugares.filter((l) => !(l.id_catamaran === id && l.numero > capacidad && !usados.has(l.id)));
  DB.lugares.filter((l) => l.id_catamaran === id).forEach((l) => (l.activo = l.numero <= capacidad));
  for (let n = 1; n <= capacidad; n++)
    if (!DB.lugares.some((l) => l.id_catamaran === id && l.numero === n)) DB.lugares.push({ id: uid(), id_catamaran: id, numero: n, activo: true });
  DB.lugares.filter((l) => l.id_catamaran === id && l.activo).forEach((l) => (l.ubicacion = ubicacionLugar(l.numero, capacidad)));
  c.capacidad = capacidad;
  persist();
  return true;
}

/** La administración asigna (o quita, con null) el dueño de un catamarán; un dueño puede tener varios. */
export async function asignarPropietario(catamaranId, usuarioId) {
  await ready();
  if (MODE === "supabase") {
    const { error } = await sb.rpc("asignar_propietario", { p_id_catamaran: catamaranId, p_id_propietario: usuarioId || null });
    if (error) throw new Error(error.message);
    return true;
  }
  // Demo: las mismas reglas que public.asignar_propietario.
  if (!esRolPersonal(demoSessionUser()?.rol)) throw new Error("Solo la administración asigna el dueño de un catamarán.");
  const c = byId(DB.catamaranes, catamaranId);
  if (!c) throw new Error("El catamarán no existe.");
  const nuevo = usuarioId ? byId(DB.usuarios, usuarioId) : null;
  if (usuarioId && !(nuevo && nuevo.rol === "dueno" && nuevo.activo !== false)) throw new Error("Elegí una cuenta activa de dueño de catamarán.");
  if ((c.id_propietario || null) === (usuarioId || null)) return true;
  (DB.gastos || []).filter((g) => g.id_catamaran === c.id && g.id_propietario !== usuarioId).forEach((g) => (g.id_catamaran = null));
  c.id_propietario = usuarioId || null;
  persist();
  return true;
}

/* ---- Avisos a los pasajeros de una salida y lista de embarque ---- */
/* Demo: el dueño actúa sobre sus catamaranes; la administración, sobre todos. */
function catamaranDeLaSesionDemo(catamaranId) {
  const u = demoSessionUser();
  const c = byId(DB.catamaranes, catamaranId);
  if (!c) throw new Error("El catamarán no existe.");
  return esRolPersonal(u?.rol) || (u?.rol === "dueno" && c.id_propietario === u.id) ? c : null;
}

/** Aviso a todos los que reservaron una salida (sin ver quiénes son). Devuelve la cantidad de destinatarios. */
export async function avisarPasajeros({ catamaranId, fecha, turno, titulo, mensaje }) {
  await ready();
  titulo = String(titulo || "").trim(); mensaje = String(mensaje || "").trim();
  if (titulo.length < 3 || titulo.length > 80) throw new Error("El título debe tener entre 3 y 80 caracteres.");
  if (mensaje.length < 3 || mensaje.length > 500) throw new Error("El mensaje debe tener entre 3 y 500 caracteres.");
  if (MODE === "supabase") {
    const { data, error } = await sb.rpc("avisar_pasajeros", { p_id_catamaran: catamaranId, p_fecha: fecha, p_turno: turno, p_titulo: titulo, p_mensaje: mensaje });
    if (error) throw new Error(error.message);
    return Number(data) || 0;
  }
  // Demo: las mismas reglas que public.avisar_pasajeros.
  if (!catamaranDeLaSesionDemo(catamaranId)) throw new Error("No autorizado para avisar a los pasajeros de este catamarán.");
  if (!fecha || fecha < todayISO()) throw new Error("Solo se puede avisar sobre salidas de hoy en adelante.");
  const deLaSalida = DB.reservas.filter((r) => r.id_catamaran === catamaranId && r.fecha === fecha && r.turno === turno);
  const ids = new Set(deLaSalida.map((r) => r.id));
  const previos = new Set(DB.notificaciones.filter((n) => n.tipo === "salida" && ids.has(n.id_reserva)).map((n) => n.created_at)).size;
  if (previos >= 10) throw new Error("Ya se enviaron 10 avisos para esta salida.");
  const ahora = new Date().toISOString();
  const avisados = new Set();
  deLaSalida.filter((r) => r.estado === "confirmada" && byId(DB.usuarios, r.id_usuario)?.activo !== false).forEach((r) => {
    if (avisados.has(r.id_usuario)) return;
    avisados.add(r.id_usuario);
    DB.notificaciones.unshift({ id: uid(), id_usuario: r.id_usuario, id_reserva: r.id, tipo: "salida", titulo, mensaje, leida: false, created_at: ahora });
  });
  if (!avisados.size) throw new Error("No hay pasajeros con reserva confirmada en esa salida.");
  persist();
  return avisados.size;
}

/** Lista de embarque de una salida, un pasajero por lugar:
 *  [{ numero, lugar, pasajero, dni, titular, permiso, permiso_digital }]
 *  (pasajero nulo: lugar de una reserva anterior sin acompañante cargado;
 *  permiso: el digital o el número declarado). */
export async function listaEmbarque(catamaranId, fecha, turno) {
  await ready();
  if (MODE === "supabase") {
    // Por GET (función de sólo lectura): así queda guardada para consultarla sin conexión.
    const { data, error } = await sb.rpc("lista_embarque", { p_id_catamaran: catamaranId, p_fecha: fecha, p_turno: turno }, { get: true });
    if (error) throw new Error(error.message);
    return data || [];
  }
  if (!catamaranDeLaSesionDemo(catamaranId)) throw new Error("No autorizado para ver la lista de embarque de este catamarán.");
  const filas = [];
  DB.reservas
    .filter((r) => r.id_catamaran === catamaranId && r.fecha === fecha && r.turno === turno && (r.estado === "confirmada" || r.estado === "completada"))
    .forEach((r) => {
      const t = byId(DB.usuarios, r.id_usuario) || {};
      const asientos = DB.reserva_lugar.filter((x) => x.id_reserva === r.id)
        .map((x) => ({ ...x, numero: byId(DB.lugares, x.id_lugar)?.numero })).sort((a, b) => a.numero - b.numero);
      let titularListo = false;
      asientos.forEach((x) => {
        const esTitular = !x.pasajero_nombre && !titularListo;
        if (esTitular) titularListo = true;
        const digital = x.id_permiso ? byId(DB.permisos, x.id_permiso)?.numero : null;
        filas.push({
          numero: r.numero, lugar: x.numero, titular: esTitular,
          pasajero: x.pasajero_nombre || (esTitular ? [t.apellido, t.nombre].filter(Boolean).join(", ") : null),
          dni: x.pasajero_dni || (esTitular ? t.dni || null : null),
          permiso: digital || x.permiso_propio || null, permiso_digital: Boolean(digital),
        });
      });
    });
  return filas.sort((a, b) => a.lugar - b.lugar);
}

/* ---- Fotos de los catamaranes (Supabase Storage, depósito "catamaranes") ---- */
const DEPOSITO_FOTOS = "catamaranes";
export const MAX_FOTOS = 6;
/** Dirección pública de una foto (en demo, la foto misma como data: URL). */
export function urlFoto(ruta) {
  if (!ruta) return "";
  if (MODE !== "supabase" || ruta.startsWith("data:")) return ruta;
  return `${CFG.SUPABASE_URL}/storage/v1/object/public/${DEPOSITO_FOTOS}/${ruta.split("/").map(encodeURIComponent).join("/")}`;
}

/** Sube una foto (ya reducida, JPEG) de un catamarán y devuelve su ruta. */
export async function subirFotoCatamaran(catamaranId, blob) {
  await ready();
  if (MODE === "supabase") {
    const ruta = `${catamaranId}/${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}.jpg`;
    const { error } = await sb.storage.from(DEPOSITO_FOTOS).upload(ruta, blob, { contentType: "image/jpeg", upsert: false });
    if (error) throw new Error(/row-level security|unauthorized|403/i.test(error.message) ? "No tenés permisos para subir fotos de este catamarán." : error.message);
    return ruta;
  }
  catamaranEditableDemo(catamaranId);
  return await new Promise((ok, mal) => {
    const fr = new FileReader();
    fr.onload = () => ok(fr.result);
    fr.onerror = () => mal(new Error("No se pudo leer la foto."));
    fr.readAsDataURL(blob);
  });
}

/** Borra del depósito las fotos que se quitaron del catamarán. */
export async function borrarFotosCatamaran(rutas) {
  await ready();
  const borrar = (rutas || []).filter((r) => r && !r.startsWith("data:"));
  if (MODE !== "supabase" || !borrar.length) return true;
  const { error } = await sb.storage.from(DEPOSITO_FOTOS).remove(borrar);
  if (error) console.warn("No se pudieron borrar fotos:", error.message);
  return true;
}

/** Guarda las fotos del catamarán, en orden (la primera es la portada). */
export async function setFotosCatamaran(catamaranId, rutas) {
  await ready();
  if ((rutas || []).length > MAX_FOTOS) throw new Error(`Un catamarán puede tener hasta ${MAX_FOTOS} fotos.`);
  if (MODE === "supabase") {
    const { error } = await sb.from("catamaran").update({ fotos: rutas }).eq("id", catamaranId);
    if (error) throw new Error(traducirDB(error.message));
    return true;
  }
  const c = catamaranEditableDemo(catamaranId);
  const antes = c.fotos || [];
  c.fotos = rutas.slice();
  try { saveDB(DB); } catch { c.fotos = antes; throw new Error("No hay espacio para guardar más fotos en la demostración."); }
  return true;
}

/* ============================================================================
 *  AVISOS AL TELÉFONO (Web Push, HU-011)
 *  El usuario habilita el teléfono; la base guarda la suscripción
 *  (registrar_push) y la función enviar-push de Supabase manda cada aviso, aviso
 *  de una salida o recordatorio aunque la aplicación esté cerrada.
 * ========================================================================== */
const claveServidor = (b64) => {
  const t = atob((b64 + "===".slice((b64.length + 3) % 4)).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(t, (c) => c.charCodeAt(0));
};
const pushSoportado = () => "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
const suscripcionActual = async () => {
  const reg = await navigator.serviceWorker?.getRegistration?.();
  return reg ? reg.pushManager.getSubscription() : null;
};

/** Estado en este dispositivo: activo | inactivo | bloqueado | instalar (iPhone sin instalar) | no-disponible. */
export async function estadoPush() {
  if (MODE !== "supabase" || !CFG.VAPID_PUBLIC_KEY) return "no-disponible";
  if (!pushSoportado()) {
    const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
    const instalada = matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
    return ios && !instalada ? "instalar" : "no-disponible";
  }
  if (Notification.permission === "denied") return "bloqueado";
  try { return (await suscripcionActual()) ? "activo" : "inactivo"; } catch { return "inactivo"; }
}

export async function activarPush() {
  await ready();
  if (MODE !== "supabase" || !CFG.VAPID_PUBLIC_KEY || !pushSoportado()) throw new Error("Este navegador no admite avisos en el teléfono.");
  if (await Notification.requestPermission() !== "granted")
    throw new Error("Para recibir avisos, permití las notificaciones de PescaCorral en el navegador.");
  const reg = await navigator.serviceWorker.ready;
  const opciones = { userVisibleOnly: true, applicationServerKey: claveServidor(CFG.VAPID_PUBLIC_KEY) };
  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    try { sub = await reg.pushManager.subscribe(opciones); }
    catch { await (await reg.pushManager.getSubscription())?.unsubscribe(); sub = await reg.pushManager.subscribe(opciones); }
  }
  const j = sub.toJSON();
  const { error } = await sb.rpc("registrar_push", { p_endpoint: j.endpoint, p_p256dh: j.keys.p256dh, p_auth: j.keys.auth });
  if (error) throw new Error(error.message);
  return true;
}

export async function desactivarPush() {
  await ready();
  let sub = null;
  try { sub = await suscripcionActual(); } catch { /* sin service worker */ }
  if (!sub) return true;
  if (MODE === "supabase") {
    try { await sb.rpc("borrar_push", { p_endpoint: sub.endpoint }); } catch { /* sin conexión: el envío la dará de baja */ }
  }
  try { await sub.unsubscribe(); } catch { /* ya no existía */ }
  return true;
}

/* ---- Gastos (privados de cada dueño) ---- */
export const CATEGORIAS_GASTO = {
  combustible: "Combustible", mantenimiento: "Mantenimiento y reparaciones", personal: "Sueldos del personal",
  seguro: "Seguros", amarre: "Amarre y muelle", impuestos: "Impuestos y habilitaciones", otros: "Otros",
};

export async function listGastos() {
  await ready();
  if (MODE === "supabase") {
    const { data, error } = await sb.from("gasto").select("*").order("fecha", { ascending: false });
    if (error) throw error;
    return data.map((g) => ({ ...g, monto: Number(g.monto) }));
  }
  const u = demoSessionUser();
  if (u?.rol !== "dueno") return [];
  return (DB.gastos || []).filter((g) => g.id_propietario === u.id).slice().sort((a, b) => (a.fecha < b.fecha ? 1 : -1));
}

/** Registra (sin id) o corrige (con id) un gasto. idCatamaran nulo: gasto general de la flota. */
export async function guardarGasto({ id = null, idCatamaran = null, fecha, categoria, descripcion = "", monto }) {
  await ready();
  descripcion = String(descripcion || "").trim();
  monto = Number(monto);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha || "")) throw new Error("Ingresá la fecha del gasto.");
  if (!CATEGORIAS_GASTO[categoria]) throw new Error("Elegí la categoría del gasto.");
  if (descripcion.length > 120) throw new Error("La descripción puede tener hasta 120 caracteres.");
  if (!(monto > 0) || monto > 9999999999) throw new Error("Ingresá un monto mayor a cero.");
  const datos = { id_catamaran: idCatamaran || null, fecha, categoria, descripcion: descripcion || null, monto };
  if (MODE === "supabase") {
    const { error } = id ? await sb.from("gasto").update(datos).eq("id", id) : await sb.from("gasto").insert(datos);
    if (error) throw new Error(traducirDB(error.message));
    return true;
  }
  // Demo: las mismas reglas que la política gasto_dueno.
  const u = demoSessionUser();
  if (u?.rol !== "dueno") throw new Error("No tenés permisos para realizar esa operación.");
  if (datos.id_catamaran && byId(DB.catamaranes, datos.id_catamaran)?.id_propietario !== u.id) throw new Error("No tenés permisos para realizar esa operación.");
  DB.gastos = DB.gastos || [];
  if (id) {
    const g = DB.gastos.find((x) => x.id === id && x.id_propietario === u.id);
    if (!g) throw new Error("El gasto no existe.");
    Object.assign(g, datos);
  } else {
    DB.gastos.push({ id: uid(), id_propietario: u.id, ...datos, created_at: new Date().toISOString() });
  }
  persist();
  return true;
}

export async function eliminarGasto(id) {
  await ready();
  if (MODE === "supabase") {
    const { error } = await sb.from("gasto").delete().eq("id", id);
    if (error) throw new Error(traducirDB(error.message));
    return true;
  }
  const u = demoSessionUser();
  DB.gastos = (DB.gastos || []).filter((g) => !(g.id === id && g.id_propietario === u?.id));
  persist();
  return true;
}

/* ---- Salidas y finanzas de la flota (cálculo sobre las reservas y los gastos) ---- */
const reservaVendida = (r) => r.estado === "confirmada" || r.estado === "completada";
/** Lo que cobra el dueño por una reserva: los lugares (el permiso es del Municipio). */
export const ingresoReserva = (r) => Number(r.monto_total || 0) - Number(r.monto_permiso || 0);

/** Salidas de la flota: reservas vendidas agrupadas por catamarán, fecha y turno. */
export function salidasDeFlota(reservas, catamaranes) {
  const cats = new Map(catamaranes.map((c) => [c.id, c]));
  const grupos = new Map();
  reservas.filter((r) => cats.has(r.id_catamaran) && reservaVendida(r)).forEach((r) => {
    const k = `${r.fecha}|${r.turno}|${r.id_catamaran}`;
    const cat = cats.get(r.id_catamaran);
    const g = grupos.get(k) || { clave: k, fecha: r.fecha, turno: r.turno, catamaran: cat, capacidad: Number(cat.capacidad), lugares: 0, ingresos: 0, reservas: [] };
    g.lugares += Number(r.cantidad_lugares || 0);
    g.ingresos += ingresoReserva(r);
    g.reservas.push(r);
    grupos.set(k, g);
  });
  return [...grupos.values()].sort((a, b) => (a.fecha + a.turno < b.fecha + b.turno ? -1 : 1));
}

const mesAnterior = (periodo, n) => { const [y, m] = periodo.split("-").map(Number); const d = new Date(y, m - 1 - n, 1); return dateISO(d).slice(0, 7); };

/** Ganancias y pérdidas de un mes (periodo AAAA-MM), de toda la flota o de un catamarán. */
export function finanzasDueno({ reservas, gastos, catamaranes, periodo, catId = "" }) {
  const flota = catId ? catamaranes.filter((c) => c.id === catId) : catamaranes;
  const ids = new Set(flota.map((c) => c.id));
  const delMes = (f) => String(f || "").slice(0, 7) === periodo;
  const vendidas = reservas.filter((r) => ids.has(r.id_catamaran) && reservaVendida(r));
  const gastosFlota = gastos.filter((g) => (catId ? g.id_catamaran === catId : true));
  const resMes = vendidas.filter((r) => delMes(r.fecha));
  const gasMes = gastosFlota.filter((g) => delMes(g.fecha));
  const ingresos = resMes.reduce((s, r) => s + ingresoReserva(r), 0);
  const totalGastos = gasMes.reduce((s, g) => s + Number(g.monto), 0);
  const salidas = salidasDeFlota(resMes, flota);
  const lugares = salidas.reduce((s, x) => s + x.lugares, 0);
  const plazas = salidas.reduce((s, x) => s + x.capacidad, 0);
  const porCategoria = {};
  gasMes.forEach((g) => (porCategoria[g.categoria] = (porCategoria[g.categoria] || 0) + Number(g.monto)));
  const porCatamaran = flota.map((c) => {
    const ing = resMes.filter((r) => r.id_catamaran === c.id).reduce((s, r) => s + ingresoReserva(r), 0);
    const gas = gasMes.filter((g) => g.id_catamaran === c.id).reduce((s, g) => s + Number(g.monto), 0);
    return { id: c.id, nombre: c.nombre, ingresos: ing, gastos: gas, resultado: ing - gas };
  });
  const generales = catId ? 0 : gasMes.filter((g) => !g.id_catamaran).reduce((s, g) => s + Number(g.monto), 0);
  const serie = Array.from({ length: 6 }, (_, i) => mesAnterior(periodo, 5 - i)).map((m) => ({
    periodo: m,
    ingresos: vendidas.filter((r) => String(r.fecha).slice(0, 7) === m).reduce((s, r) => s + ingresoReserva(r), 0),
    gastos: gastosFlota.filter((g) => String(g.fecha).slice(0, 7) === m).reduce((s, g) => s + Number(g.monto), 0),
  }));
  return {
    periodo, ingresos, gastos: totalGastos, resultado: ingresos - totalGastos,
    reservas: resMes, gastosDelMes: gasMes, salidas: salidas.length, lugares,
    ocupacion: plazas ? Math.round((lugares / plazas) * 100) : 0,
    porCategoria, porCatamaran, generales, serie,
  };
}

/* Reinicia los datos demo (botón en Perfil). */
export async function resetDemo() {
  if (MODE !== "demo") return;
  localStorage.removeItem(DEMO_KEY);
  DB = null; seedDemo(); emitAuth();
}
