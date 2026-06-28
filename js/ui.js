/* ============================================================================
 *  PescaCorral · js/ui.js
 *  Utilidades de interfaz: selección de DOM, íconos SVG, toasts, modales,
 *  formato de datos y validación de contraseña. Sin dependencias externas.
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
  "calendar-check":'<rect x="3" y="4.5" width="18" height="16" rx="2"/><path d="M3 9h18M8 2.5v4M16 2.5v4M9 14.5l2 2 4-4"/>',
  ticket:      '<path d="M3 9a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2 2 2 0 0 0 0 4 2 2 0 0 1-2 2H5a2 2 0 0 1-2-2 2 2 0 0 0 0-4Z"/><path d="M13 7v10"/>',
  boat:        '<path d="M3 14h18l-2.2 5.2a2 2 0 0 1-1.84 1.3H7.04a2 2 0 0 1-1.84-1.3L3 14Z"/><path d="M5 14V8h8l4 6M9 8V4h2"/>',
  anchor:      '<circle cx="12" cy="5" r="2"/><path d="M12 7v13M5 13a7 7 0 0 0 14 0M3 13h2M19 13h2"/>',
  user:        '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
  users:       '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 21a6.5 6.5 0 0 1 13 0M16 5.2a3.5 3.5 0 0 1 0 6.6M17.5 14.4A6.5 6.5 0 0 1 21.5 21"/>',
  bell:        '<path d="M6 9a6 6 0 0 1 12 0c0 5 2 6 2 6H4s2-1 2-6Z"/><path d="M10 20a2 2 0 0 0 4 0"/>',
  menu:        '<path d="M4 6h16M4 12h16M4 18h16"/>',
  "chevron-left": '<path d="M15 5l-7 7 7 7"/>',
  "chevron-right":'<path d="M9 5l7 7-7 7"/>',
  plus:        '<path d="M12 5v14M5 12h14"/>',
  "plus-circle":'<circle cx="12" cy="12" r="9"/><path d="M12 8v8M8 12h8"/>',
  check:       '<path d="M5 12.5l4.5 4.5L19 7"/>',
  "check-circle":'<circle cx="12" cy="12" r="9"/><path d="M8.5 12.5l2.5 2.5 4.5-4.8"/>',
  x:           '<path d="M6 6l12 12M18 6 6 18"/>',
  eye:         '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/>',
  "eye-off":   '<path d="M3 3l18 18M10.6 6.2A9.7 9.7 0 0 1 12 6c6.5 0 10 6 10 6a16 16 0 0 1-3.2 3.6M6.2 7.4A15.9 15.9 0 0 0 2 12s3.5 6 10 6a9.6 9.6 0 0 0 3.3-.6M9.9 9.9a3 3 0 0 0 4.2 4.2"/>',
  logout:      '<path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3"/><path d="M10 12h10M16 8l4 4-4 4"/>',
  search:      '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.2-3.2"/>',
  fish:        '<path d="M5 12c4-6 11-6 15 0-4 6-11 6-15 0Z"/><path d="M5 12c-1.5 0-3 1-3 1s1.2 1 3 1M16 12h.01"/>',
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
  trash:       '<path d="M4 7h16M9 7V4.5h6V7M7 7l1 13h8l1-13"/>',
  edit:        '<path d="M5 19h14M14 4.5l5 5L9 19.5 4 21l1.5-5L15.5 6"/>',
  filter:      '<path d="M3 5h18l-7 8v6l-4-2v-4L3 5Z"/>',
  leaf:        '<path d="M4 20C3 11 9 4 20 4c0 11-7 16-15 16Z"/><path d="M9 15c2-4 5-6 9-7"/>',
  shield:      '<path d="M12 3l8 3v6c0 5-4 8-8 9-4-1-8-4-8-9V6l8-3Z"/><path d="M9 12l2 2 4-4"/>',
  mail:        '<rect x="2.5" y="5" width="19" height="14" rx="2"/><path d="m3 7 9 6 9-6"/>',
  phone:       '<path d="M5 3h3l2 5-2.5 1.5a13 13 0 0 0 5 5L18 14l3 2v3a2 2 0 0 1-2 2A16 16 0 0 1 3 5a2 2 0 0 1 2-2Z"/>',
  "id-card":   '<rect x="2.5" y="5" width="19" height="14" rx="2"/><circle cx="8" cy="11" r="2.2"/><path d="M4.8 16.2a3.5 3.5 0 0 1 6.4 0M14 9.5h4M14 13h4"/>',
  lock:        '<rect x="4.5" y="10" width="15" height="10" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>',
  ban:         '<circle cx="12" cy="12" r="8.5"/><path d="m6 6 12 12"/>',
  refresh:     '<path d="M4 11a8 8 0 0 1 14-4.5L21 9M20 13a8 8 0 0 1-14 4.5L3 15"/><path d="M21 4v5h-5M3 20v-5h5"/>',
  info:        '<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5M12 8h.01"/>',
  sun:         '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2.5M12 19v2.5M4.2 4.2l1.8 1.8M18 18l1.8 1.8M2.5 12H5M19 12h2.5M4.2 19.8 6 18M18 6l1.8-1.8"/>',
  moon:        '<path d="M20 14.5A8 8 0 0 1 9.5 4 7 7 0 1 0 20 14.5Z"/>',
  receipt:     '<path d="M5 3h14v18l-2.5-1.5L14 21l-2-1.5L10 21l-2.5-1.5L5 21V3Z"/><path d="M9 8h6M9 12h6"/>',
  logo:        '', // se usa el símbolo del index.html
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

/* ------------------------- Fortaleza de contraseña ----------------------- */
/** Reglas de seguridad pedidas por el TFG (HU-014 / política de acceso). */
export function passwordRules(pwd = "") {
  return [
    { id: "len", label: "Al menos 8 caracteres",       ok: pwd.length >= 8 },
    { id: "may", label: "Una letra mayúscula",          ok: /[A-Z]/.test(pwd) },
    { id: "min", label: "Una letra minúscula",          ok: /[a-z]/.test(pwd) },
    { id: "num", label: "Un número",                    ok: /[0-9]/.test(pwd) },
    { id: "esp", label: "Un carácter especial (!@#…)",  ok: /[^A-Za-z0-9]/.test(pwd) },
  ];
}
export function passwordStrength(pwd = "") {
  const rules = passwordRules(pwd);
  const score = rules.filter((r) => r.ok).length;     // 0..5
  const valid = score === 5;
  const labels = ["Muy débil", "Débil", "Regular", "Buena", "Fuerte", "Excelente"];
  return { score, valid, rules, label: labels[score] };
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
