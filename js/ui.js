/* ============================================================================
 *  PescaCorral · js/ui.js
 *  Utilidades de interfaz: selección de DOM, íconos SVG, toasts, modales,
 *  y formato de datos. Sin dependencias externas.
 * ========================================================================== */

/* --------------------------------- DOM ----------------------------------- */
export const $  = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

const APP = () => document.getElementById("app");

/** Reemplaza el contenido de #app con el HTML dado y devuelve el nodo. */
export function mount(html) {
  const app = APP();
  app.innerHTML = html;
  app.scrollTop = 0;
  return app;
}

/** Escapa texto para insertarlo de forma segura en HTML. */
export function esc(value) {
  if (value === null || value === undefined) return "";
  return String(value)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

/* ------------------------------- Íconos SVG ------------------------------ */
/* Set de líneas (estilo Lucide), 24×24, trazo = currentColor. */
const ICONS = {
  home:        '<path d="M3 11.5 12 4l9 7.5"/><path d="M5 10v10h14V10"/>',
  calendar:    '<rect x="3" y="4.5" width="18" height="16" rx="2"/><path d="M3 9h18M8 2.5v4M16 2.5v4"/>',
  ticket:      '<path d="M3 9a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2 2 2 0 0 0 0 4 2 2 0 0 1-2 2H5a2 2 0 0 1-2-2 2 2 0 0 0 0-4Z"/><path d="M13 7v10"/>',
  boat:        '<path d="M3 14h18l-2.2 5.2a2 2 0 0 1-1.84 1.3H7.04a2 2 0 0 1-1.84-1.3L3 14Z"/><path d="M5 14V8h8l4 6M9 8V4h2"/>',
  user:        '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
  users:       '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 21a6.5 6.5 0 0 1 13 0M16 5.2a3.5 3.5 0 0 1 0 6.6M17.5 14.4A6.5 6.5 0 0 1 21.5 21"/>',
  bell:        '<path d="M6 9a6 6 0 0 1 12 0c0 5 2 6 2 6H4s2-1 2-6Z"/><path d="M10 20a2 2 0 0 0 4 0"/>',
  menu:        '<path d="M4 6h16M4 12h16M4 18h16"/>',
  "chevron-left": '<path d="M15 5l-7 7 7 7"/>',
  plus:        '<path d="M12 5v14M5 12h14"/>',
  "plus-circle":'<circle cx="12" cy="12" r="9"/><path d="M12 8v8M8 12h8"/>',
  check:       '<path d="M5 12.5l4.5 4.5L19 7"/>',
  "check-circle":'<circle cx="12" cy="12" r="9"/><path d="M8.5 12.5l2.5 2.5 4.5-4.8"/>',
  x:           '<path d="M6 6l12 12M18 6 6 18"/>',
  logout:      '<path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3"/><path d="M10 12h10M16 8l4 4-4 4"/>',
  "map-pin":   '<path d="M12 21s7-6 7-11a7 7 0 0 0-14 0c0 5 7 11 7 11Z"/><circle cx="12" cy="10" r="2.5"/>',
  "credit-card":'<rect x="2.5" y="5" width="19" height="14" rx="2"/><path d="M2.5 9.5h19M6 15h4"/>',
  wallet:      '<path d="M3 7a2 2 0 0 1 2-2h12v4M3 7v10a2 2 0 0 0 2 2h14a1 1 0 0 0 1-1v-3M3 7h16a1 1 0 0 1 1 1v3"/><circle cx="17" cy="13" r="1.3"/>',
  download:    '<path d="M12 3v12M7 11l5 5 5-5M5 21h14"/>',
  share:       '<circle cx="6" cy="12" r="2.5"/><circle cx="18" cy="6" r="2.5"/><circle cx="18" cy="18" r="2.5"/><path d="M8.2 10.8l7.6-3.6M8.2 13.2l7.6 3.6"/>',
  grid:        '<rect x="3.5" y="3.5" width="7" height="7" rx="1.5"/><rect x="13.5" y="3.5" width="7" height="7" rx="1.5"/><rect x="3.5" y="13.5" width="7" height="7" rx="1.5"/><rect x="13.5" y="13.5" width="7" height="7" rx="1.5"/>',
  "bar-chart": '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
  "trending-up":'<path d="M3 17l6-6 4 4 8-8M15 7h6v6"/>',
  settings:    '<circle cx="12" cy="12" r="3"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5 5l2 2M17 17l2 2M19 5l-2 2M7 17l-2 2"/>',
  "alert-triangle":'<path d="M12 4 2.5 20h19L12 4Z"/><path d="M12 10v4M12 17.5h.01"/>',
  "file-text": '<path d="M6 2.5h8l5 5V21a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V3.5a1 1 0 0 1 1-1Z"/><path d="M14 2.5V8h5M8.5 13h7M8.5 17h7"/>',
  clock:       '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  qr:          '<rect x="3.5" y="3.5" width="6" height="6" rx="1"/><rect x="14.5" y="3.5" width="6" height="6" rx="1"/><rect x="3.5" y="14.5" width="6" height="6" rx="1"/><path d="M14.5 14.5h2.5v2.5M20.5 14.5v6M14.5 20.5h6M17 17.5v3"/>',
  edit:        '<path d="M5 19h14M14 4.5l5 5L9 19.5 4 21l1.5-5L15.5 6"/>',
  shield:      '<path d="M12 3l8 3v6c0 5-4 8-8 9-4-1-8-4-8-9V6l8-3Z"/><path d="M9 12l2 2 4-4"/>',
  mail:        '<rect x="2.5" y="5" width="19" height="14" rx="2"/><path d="m3 7 9 6 9-6"/>',
  lock:        '<rect x="4.5" y="10" width="15" height="10" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>',
  refresh:     '<path d="M4 11a8 8 0 0 1 14-4.5L21 9M20 13a8 8 0 0 1-14 4.5L3 15"/><path d="M21 4v5h-5M3 20v-5h5"/>',
  info:        '<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5M12 8h.01"/>',
  receipt:     '<path d="M5 3h14v18l-2.5-1.5L14 21l-2-1.5L10 21l-2.5-1.5L5 21V3Z"/><path d="M9 8h6M9 12h6"/>',
  message:     '<path d="M20.5 12a8.5 8.5 0 0 1-12.6 7.4L3 21l1.6-4.6A8.5 8.5 0 1 1 20.5 12Z"/><path d="M8.5 10.5c.3 2 2.6 4.3 4.8 4.8l1.2-1.3 2 .9"/>',
  send:        '<path d="M21 3 10.5 13.5M21 3l-6.5 18-4-7.5L3 9.5 21 3Z"/>',
  copy:        '<rect x="8" y="8" width="13" height="13" rx="2"/><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3"/>',
  cash:        '<rect x="2.5" y="6" width="19" height="12" rx="2"/><circle cx="12" cy="12" r="2.6"/><path d="M6 10v4M18 10v4"/>',
  steering:    '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="2.3"/><path d="M12 3.5v6.2M12 14.3v6.2M3.5 12h6.2M14.3 12h6.2"/>',
  dots:        '<circle cx="5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="19" cy="12" r="1.6"/>',
};

/** Devuelve el markup de un ícono. `name` debe existir en ICONS. */
export function icon(name, { size = 24, cls = "", stroke = 2 } = {}) {
  const body = ICONS[name];
  if (body === undefined) return "";
  return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none"
      stroke="currentColor" stroke-width="${stroke}" stroke-linecap="round"
      stroke-linejoin="round" class="${cls}" aria-hidden="true">${body}</svg>`;
}

/** Logo de la marca (usa el <symbol> definido en index.html). */
export function logoMark(size = 34, cls = "") {
  return `<svg viewBox="0 0 64 64" width="${size}" height="${size}" class="${cls}" aria-hidden="true"><use href="#logo-mark"></use></svg>`;
}

/* -------------------------------- Toasts --------------------------------- */
export function toast(message, type = "info", timeout = 3200) {
  const root = document.getElementById("toast-root");
  if (!root) return;
  const ic = type === "ok" ? "check-circle" : type === "err" ? "alert-triangle" : "info";
  const node = document.createElement("div");
  node.className = `toast ${type}`;
  node.innerHTML = `${icon(ic, { size: 20 })}<span>${esc(message)}</span>`;
  root.appendChild(node);
  const remove = () => {
    node.style.transition = "opacity .2s, transform .2s";
    node.style.opacity = "0";
    node.style.transform = "translateY(8px)";
    setTimeout(() => node.remove(), 200);
  };
  const t = setTimeout(remove, timeout);
  node.addEventListener("click", () => { clearTimeout(t); remove(); });
}

/* -------------------------------- Modales -------------------------------- */
/**
 * Abre un modal. `actions` es un array de { label, variant, onClick, close }.
 * Devuelve un objeto { close } para cerrarlo manualmente.
 */
export function modal({ title = "", body = "", actions = [], dismissable = true } = {}) {
  closeModal();
  const backdrop = document.createElement("div");
  backdrop.className = "modal-backdrop";
  backdrop.id = "app-modal";

  const actionsHtml = actions.map((a, i) =>
    `<button class="btn ${a.variant || "btn--soft"}" data-act="${i}">${esc(a.label)}</button>`
  ).join("");

  backdrop.innerHTML = `
    <div class="modal" role="dialog" aria-modal="true">
      <div class="modal__head">
        <h3>${esc(title)}</h3>
        ${dismissable ? `<button class="topbar__btn" data-close style="color:var(--muted)">${icon("x", { size: 20 })}</button>` : ""}
      </div>
      <div class="modal__body">${body}</div>
      ${actions.length ? `<div class="modal__foot">${actionsHtml}</div>` : ""}
    </div>`;

  document.body.appendChild(backdrop);
  document.body.style.overflow = "hidden";

  const close = () => closeModal();

  if (dismissable) {
    backdrop.addEventListener("click", (e) => { if (e.target === backdrop) close(); });
    $("[data-close]", backdrop)?.addEventListener("click", close);
  }
  actions.forEach((a, i) => {
    $(`[data-act="${i}"]`, backdrop)?.addEventListener("click", () => {
      const keepOpen = a.onClick && a.onClick() === false;
      if (a.close !== false && !keepOpen) close();
    });
  });

  return { close, root: backdrop };
}

export function closeModal() {
  const m = document.getElementById("app-modal");
  if (m) m.remove();
  document.body.style.overflow = "";
}

/* Confirmación rápida basada en promesa. */
export function confirmDialog({ title, message, okLabel = "Confirmar", okVariant = "btn--primary", cancelLabel = "Cancelar" }) {
  return new Promise((resolve) => {
    modal({
      title,
      body: `<p style="color:var(--text-2)">${esc(message)}</p>`,
      actions: [
        { label: cancelLabel, variant: "btn--soft", onClick: () => resolve(false) },
        { label: okLabel, variant: okVariant, onClick: () => resolve(true) },
      ],
    });
  });
}

/* ------------------------------- Formato --------------------------------- */
const MONEY = new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 });
export const fmtMoney = (n) => MONEY.format(Number(n || 0));

const MESES = ["ene","feb","mar","abr","may","jun","jul","ago","sep","oct","nov","dic"];
const MESES_LARGO = ["enero","febrero","marzo","abril","mayo","junio","julio","agosto","septiembre","octubre","noviembre","diciembre"];
const DIAS = ["domingo","lunes","martes","miércoles","jueves","viernes","sábado"];

function toDate(d) {
  if (d instanceof Date) return d;
  if (typeof d === "string") {
    // 'YYYY-MM-DD' -> fecha local (evita corrimiento por zona horaria)
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d);
    if (m) return new Date(+m[1], +m[2] - 1, +m[3]);
    return new Date(d);
  }
  return new Date(d);
}

export function fmtDate(d) {
  const x = toDate(d);
  return `${String(x.getDate()).padStart(2, "0")}/${String(x.getMonth() + 1).padStart(2, "0")}/${x.getFullYear()}`;
}
export function fmtDateShort(d) {
  const x = toDate(d);
  return `${x.getDate()} ${MESES[x.getMonth()]}`;
}
export function fmtDateLong(d) {
  const x = toDate(d);
  return `${DIAS[x.getDay()]} ${x.getDate()} de ${MESES_LARGO[x.getMonth()]} de ${x.getFullYear()}`;
}
export function fmtDateTime(d) {
  const x = toDate(d);
  return `${fmtDate(x)} · ${String(x.getHours()).padStart(2, "0")}:${String(x.getMinutes()).padStart(2, "0")}`;
}
/** Tiempo relativo compacto ("hace 2 h", "ayer"). */
export function fmtRelative(d) {
  const x = toDate(d);
  const diff = (Date.now() - x.getTime()) / 1000;
  if (diff < 60) return "recién";
  if (diff < 3600) return `hace ${Math.floor(diff / 60)} min`;
  if (diff < 86400) return `hace ${Math.floor(diff / 3600)} h`;
  if (diff < 172800) return "ayer";
  if (diff < 604800) return `hace ${Math.floor(diff / 86400)} días`;
  return fmtDate(x);
}
export const todayISO = () => {
  const x = new Date();
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`;
};
export function addDaysISO(iso, days) {
  const x = toDate(iso); x.setDate(x.getDate() + days);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`;
}

export const turnoLabel = (t) => (t === "tarde" ? "Tarde" : "Mañana");
export const tipoPermisoLabel = (t) => ({ diario: "Diario", semanal: "Semanal", anual: "Anual" }[t] || t);
export const metodoPagoLabel = (m) => ({ tarjeta: "Tarjeta", transferencia: "Transferencia", mercadopago: "Mercado Pago", efectivo: "Efectivo" }[m] || m);
export const rolLabel = (r) => ({ pescador: "Pescador / Turista", dueno: "Dueño de catamarán", admin_municipal: "Administración municipal", admin_sistema: "Administrador del sistema" }[r] || r);

/** Devuelve { cls, label } para el badge de estado de reserva/permiso. */
export function estadoReservaBadge(estado) {
  return ({
    confirmada: { cls: "badge--ok", label: "Confirmada" },
    pendiente:  { cls: "badge--warn", label: "Pendiente" },
    cancelada:  { cls: "badge--danger", label: "Cancelada" },
    completada: { cls: "badge--info", label: "Completada" },
  })[estado] || { cls: "badge--muted", label: estado };
}
export function estadoPermisoBadge(estado) {
  return ({
    vigente: { cls: "badge--ok", label: "Vigente" },
    vencido: { cls: "badge--muted", label: "Vencido" },
    anulado: { cls: "badge--danger", label: "Anulado" },
  })[estado] || { cls: "badge--muted", label: estado };
}

export function initials(nombre = "", apellido = "") {
  const a = (nombre || "").trim()[0] || "";
  const b = (apellido || "").trim()[0] || "";
  return (a + b).toUpperCase() || "U";
}

/* ------------------------ Imagen para compartir -------------------------- */
/* Arma la tarjeta (permiso o comprobante) como SVG y la convierte en PNG, para
 * enviarla por WhatsApp u otra aplicación. Sin dependencias: el navegador
 * dibuja el SVG en un canvas. */
const FUENTE_IMG = "Segoe UI, Roboto, Helvetica, Arial, sans-serif";
const LOGO_IMG = `<defs>
  <linearGradient id="ti-cielo" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#A12A3A"/><stop offset="1" stop-color="#5E1422"/></linearGradient>
  <linearGradient id="ti-agua" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2C8AA8"/><stop offset="1" stop-color="#175A73"/></linearGradient>
  <clipPath id="ti-clip"><rect x="2" y="2" width="60" height="60" rx="15"/></clipPath></defs>
  <rect x="2" y="2" width="60" height="60" rx="15" fill="url(#ti-cielo)"/>
  <g clip-path="url(#ti-clip)"><circle cx="46" cy="18" r="6.5" fill="#F4C46A"/>
  <path d="M2 40 L14 25 L22 32 L32 20 L44 33 L52 27 L62 34 L62 46 L2 46 Z" fill="#CF8A2E"/>
  <path d="M2 44 L11 37 L21 42 L31 36 L41 42 L51 37 L62 42 L62 47 L2 47 Z" fill="#A9552B"/>
  <rect x="2" y="45" width="60" height="17" fill="url(#ti-agua)"/><rect x="2" y="39.5" width="60" height="3.6" fill="#FFF6EA"/>
  <rect x="10.5" y="42" width="2.8" height="10" fill="#FFF6EA"/><rect x="22.5" y="42" width="2.8" height="10" fill="#FFF6EA"/>
  <rect x="34.5" y="42" width="2.8" height="10" fill="#FFF6EA"/><rect x="46.5" y="42" width="2.8" height="10" fill="#FFF6EA"/></g>`;

function qrModulos(texto) {
  const qr = window.qrcode(0, "M");
  qr.addData(texto || "PCC");
  qr.make();
  const n = qr.getModuleCount();
  let d = "";
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) d += `M${c} ${r}h1v1h-1z`;
  return { n, d };
}
const recortar = (t, max) => { t = String(t ?? ""); return t.length > max ? t.slice(0, max - 1) + "…" : t; };

/**
 * Genera la imagen de una tarjeta. Devuelve { vista, png }: vista es la imagen
 * en SVG (para mostrarla al instante) y png() la convierte en un Blob PNG.
 *  banda: { texto, color }  · qr: texto a codificar (opcional)
 *  titulo: número destacado · destacado: { label, valor } (opcional, p. ej. el total)
 *  filas: [[etiqueta, valor], ...] · pie: texto final
 */
export function tarjetaImagen({ banda, qr = null, titulo = "", destacado = null, filas = [], pie = "", lugar = "", municipio = "" }) {
  const W = 720, x0 = 48, x1 = 672;
  let y = 164 + 56;
  let cuerpo = "";
  if (qr) {
    try {
      const { n, d } = qrModulos(qr);
      cuerpo += `<rect x="${(W - 300) / 2}" y="${y + 26}" width="300" height="300" rx="20" fill="#fff" stroke="#EADFD3" stroke-width="2"/>
        <svg x="${(W - 260) / 2}" y="${y + 46}" width="260" height="260" viewBox="0 0 ${n} ${n}" shape-rendering="crispEdges"><path d="${d}" fill="#1D1517"/></svg>`;
      y += 26 + 300;
    } catch { /* sin QR */ }
  }
  y += 62;
  cuerpo += `<text x="${W / 2}" y="${y}" text-anchor="middle" font-size="38" font-weight="800" fill="#2A1B1C" letter-spacing="1">${esc(titulo)}</text>`;
  if (destacado) {
    y += 46;
    cuerpo += `<text x="${W / 2}" y="${y}" text-anchor="middle" font-size="20" font-weight="600" fill="#7A6862">${esc(destacado.label)}</text>`;
    y += 50;
    cuerpo += `<text x="${W / 2}" y="${y}" text-anchor="middle" font-size="46" font-weight="800" fill="#741A2A">${esc(destacado.valor)}</text>`;
  }
  y += 26;
  filas.forEach(([k, v], i) => {
    y += 52;
    cuerpo += `<text x="${x0}" y="${y}" font-size="21" font-weight="600" fill="#7A6862">${esc(k)}</text>
      <text x="${x1}" y="${y}" text-anchor="end" font-size="22" font-weight="800" fill="#2A1B1C">${esc(recortar(v, 34))}</text>`;
    if (i < filas.length - 1) cuerpo += `<rect x="${x0}" y="${y + 18}" width="${x1 - x0}" height="1.5" fill="#EFE5DA"/>`;
  });
  y += 60;
  if (pie) { cuerpo += `<text x="${W / 2}" y="${y}" text-anchor="middle" font-size="18" font-weight="600" fill="#7A6862">${esc(pie)}</text>`; y += 30; }
  y += 24;
  const H = y;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="${FUENTE_IMG}">
    <rect width="${W}" height="${H}" rx="36" fill="#FBF8F4"/>
    <path d="M0 36a36 36 0 0 1 36-36h648a36 36 0 0 1 36 36v114H0Z" fill="#3B0D14"/>
    <svg x="40" y="34" width="82" height="82" viewBox="0 0 64 64">${LOGO_IMG}</svg>
    <text x="140" y="80" font-size="36" font-weight="800" fill="#fff">PescaCorral</text>
    <text x="140" y="114" font-size="19" font-weight="600" fill="#F1D9CF">${esc(recortar(`${lugar} · ${municipio}`, 52))}</text>
    <rect y="150" width="${W}" height="9" fill="#1D1517"/><rect y="159" width="${W}" height="5" fill="#D2912F"/>
    <rect y="164" width="${W}" height="56" fill="${banda.color}"/>
    <text x="${W / 2}" y="201" text-anchor="middle" font-size="23" font-weight="800" fill="#fff" letter-spacing="2">${esc(banda.texto)}</text>
    ${cuerpo}
  </svg>`;
  const vista = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
  const png = () => new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const k = 2, c = document.createElement("canvas");
      c.width = W * k; c.height = H * k;
      c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
      c.toBlob((b) => (b ? resolve(b) : reject(new Error("No se pudo generar la imagen."))), "image/png");
    };
    img.onerror = () => reject(new Error("No se pudo generar la imagen."));
    img.src = vista;
  });
  return { vista, png };
}

/* ------------------------------ Compartir -------------------------------- */
/**
 * Hoja para compartir, como en las redes sociales: WhatsApp, Telegram, correo,
 * copiar el texto, guardar la imagen y "Más opciones" (la hoja del sistema,
 * que envía la imagen a cualquier aplicación instalada).
 *  titulo, texto: lo que se comparte · imagen: { vista, png } de tarjetaImagen · archivo: nombre del PNG
 */
export function compartir({ titulo, texto, imagen = null, archivo = "pescacorral.png" }) {
  const url = location.origin + location.pathname.replace(/index\.html$/, "");
  const conSistema = typeof navigator.share === "function";
  let blob = null;
  const opciones = [
    ["wa", "message", "WhatsApp", "share-op--wa"],
    ["tg", "send", "Telegram", "share-op--tg"],
    ["mail", "mail", "Correo", "share-op--mail"],
    ["copy", "copy", "Copiar texto", ""],
    ...(imagen ? [["img", "download", "Guardar imagen", ""]] : []),
    ...(conSistema ? [["more", "dots", "Más opciones", ""]] : []),
  ];
  const m = modal({
    title: titulo,
    body: `
      ${imagen ? `<div class="share-preview"><img src="${imagen.vista}" alt="Vista previa de la imagen a compartir"/></div>` : ""}
      <div class="share-grid">
        ${opciones.map(([k, ic, label, cls]) => `<button class="share-op ${cls}" type="button" data-share-op="${k}">
          <span class="share-op__ic">${icon(ic, { size: 22 })}</span><span>${esc(label)}</span></button>`).join("")}
      </div>
      <p class="field__hint center mt-12">WhatsApp, Telegram y correo envían el texto; con "Más opciones" o "Guardar imagen" se comparte la imagen con el código QR.</p>`,
  });
  // El PNG se prepara enseguida, para tenerlo listo al tocar "Más opciones".
  const listo = imagen ? imagen.png().then((b) => (blob = b)).catch(() => null) : Promise.resolve(null);

  const abrir = (href) => window.open(href, "_blank", "noopener");
  $$("[data-share-op]", m.root).forEach((b) => b.addEventListener("click", async () => {
    const op = b.dataset.shareOp;
    if (op === "wa") abrir("https://wa.me/?text=" + encodeURIComponent(texto));
    else if (op === "tg") abrir(`https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(texto)}`);
    else if (op === "mail") location.href = `mailto:?subject=${encodeURIComponent(titulo)}&body=${encodeURIComponent(texto)}`;
    else if (op === "copy") {
      try { await navigator.clipboard.writeText(texto); toast("Texto copiado", "ok"); }
      catch { toast("No se pudo copiar el texto", "err"); }
    } else if (op === "img") {
      const b2 = blob || await listo;
      if (!b2) { toast("No se pudo generar la imagen", "err"); return; }
      const a = document.createElement("a");
      a.href = URL.createObjectURL(b2); a.download = archivo;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    } else if (op === "more") {
      const b2 = blob || await listo;
      const data = { title: titulo, text: texto };
      if (b2) {
        const file = new File([b2], archivo, { type: "image/png" });
        if (navigator.canShare?.({ files: [file] })) data.files = [file];
      }
      try { await navigator.share(data); closeModal(); }
      catch (e) { if (e?.name !== "AbortError") toast("No se pudo abrir el menú para compartir", "err"); }
    }
  }));
}

/* ---------------------------- Varios ------------------------------------- */
/** Descarga un archivo de texto (CSV, etc.) generado en el cliente. */
export function downloadText(filename, text, mime = "text/csv;charset=utf-8") {
  const blob = new Blob(["\uFEFF" + text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Convierte filas (array de objetos) a CSV. */
export function toCSV(rows, headers) {
  const cols = headers || Object.keys(rows[0] || {});
  const escapeCell = (v) => {
    const s = v === null || v === undefined ? "" : String(v);
    return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const head = cols.map((c) => escapeCell(c.label || c.key || c)).join(";");
  const body = rows.map((r) =>
    cols.map((c) => escapeCell(typeof c === "object" ? r[c.key] : r[c])).join(";")
  ).join("\n");
  return head + "\n" + body;
}
