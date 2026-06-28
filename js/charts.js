/* ============================================================================
 *  PescaCorral · js/charts.js
 *  Gráficos en SVG puro (sin librerías): barras verticales y dona/torta.
 *  Pensados para el Panel Municipal y la pantalla de Reportes.
 * ========================================================================== */
import { esc } from "./ui.js";

export const CHART_COLORS = [
  "#1b5fc4", "#14a89a", "#16a34a", "#f59e0b", "#8b5cf6", "#ef4444", "#0ea5e9", "#64748b",
];

/* ------------------------------ Barras ----------------------------------- */
/**
 * Gráfico de barras verticales.
 * @param {{label:string,value:number}[]} data
 * @param {{height?:number, color?:string, money?:boolean, unit?:string}} opts
 */
export function barChart(data = [], opts = {}) {
  const { height = 220, color = "#1b5fc4", unit = "" } = opts;
  if (!data.length) return emptyChart(height);

  const W = Math.max(data.length * 56, 280);
  const padX = 14, padTop = 24, padBottom = 34;
  const innerH = height - padTop - padBottom;
  const max = Math.max(...data.map((d) => d.value), 1);
  const bw = (W - padX * 2) / data.length;
  const barW = Math.min(bw * 0.56, 46);

  const gridY = 4;
  const gridLines = Array.from({ length: gridY + 1 }, (_, i) => {
    const y = padTop + (innerH / gridY) * i;
    return `<line x1="${padX}" y1="${y.toFixed(1)}" x2="${W - padX}" y2="${y.toFixed(1)}" stroke="#eef2f9" stroke-width="1"/>`;
  }).join("");

  const bars = data.map((d, i) => {
    const h = max ? (d.value / max) * innerH : 0;
    const x = padX + bw * i + (bw - barW) / 2;
    const y = padTop + innerH - h;
    const cx = x + barW / 2;
    const val = unit ? `${d.value}${unit}` : `${d.value}`;
    return `
      <g>
        <rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barW.toFixed(1)}" height="${Math.max(h, 1).toFixed(1)}"
              rx="6" fill="${color}" opacity="${d.value ? 1 : 0.25}">
          <title>${esc(d.label)}: ${esc(val)}</title>
        </rect>
        <text class="bar-value" x="${cx.toFixed(1)}" y="${(y - 6).toFixed(1)}" text-anchor="middle">${esc(val)}</text>
        <text class="bar-label" x="${cx.toFixed(1)}" y="${(height - 12).toFixed(1)}" text-anchor="middle">${esc(d.label)}</text>
      </g>`;
  }).join("");

  return `<svg class="chart" viewBox="0 0 ${W} ${height}" preserveAspectRatio="xMidYMid meet" role="img">
    ${gridLines}${bars}
  </svg>`;
}

/* ----------------------------- Dona / torta ------------------------------ */
/**
 * Gráfico de dona con leyenda lateral.
 * @param {{label:string,value:number,color?:string}[]} data
 * @param {{size?:number, thickness?:number, centerLabel?:string}} opts
 */
export function donutChart(data = [], opts = {}) {
  const { size = 180, thickness = 30, centerTop = "", centerSub = "" } = opts;
  const items = data.filter((d) => d.value > 0);
  const total = items.reduce((s, d) => s + d.value, 0);

  if (!total) {
    return `<div class="flex items-center gap-12" style="flex-wrap:wrap">
      ${emptyDonut(size)}<div class="muted">Sin datos para mostrar.</div></div>`;
  }

  const r = (size - thickness) / 2;
  const cx = size / 2, cy = size / 2;
  const circ = 2 * Math.PI * r;
  let offset = 0;

  const arcs = items.map((d, i) => {
    const frac = d.value / total;
    const len = frac * circ;
    const color = d.color || CHART_COLORS[i % CHART_COLORS.length];
    const seg = `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${color}"
        stroke-width="${thickness}" stroke-dasharray="${len.toFixed(2)} ${(circ - len).toFixed(2)}"
        stroke-dashoffset="${(-offset).toFixed(2)}" transform="rotate(-90 ${cx} ${cy})"
        stroke-linecap="butt"><title>${esc(d.label)}: ${d.value} (${Math.round(frac * 100)}%)</title></circle>`;
    offset += len;
    return seg;
  }).join("");

  const center = centerTop
    ? `<text x="${cx}" y="${cy - 2}" text-anchor="middle" font-size="22" font-weight="800" fill="#0f172a">${esc(centerTop)}</text>
       <text x="${cx}" y="${cy + 16}" text-anchor="middle" font-size="11" font-weight="600" fill="#64748b">${esc(centerSub)}</text>`
    : "";

  const legend = items.map((d, i) => {
    const color = d.color || CHART_COLORS[i % CHART_COLORS.length];
    const pct = Math.round((d.value / total) * 100);
    return `<div><i style="background:${color}"></i><span>${esc(d.label)}</span>
      <b style="margin-left:auto;color:var(--text)">${d.value} · ${pct}%</b></div>`;
  }).join("");

  return `<div class="flex gap-12 items-center" style="flex-wrap:wrap;justify-content:center">
    <svg viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" role="img">
      <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="#eef2f9" stroke-width="${thickness}"/>
      ${arcs}${center}
    </svg>
    <div class="legend" style="min-width:150px;flex:1">${legend}</div>
  </div>`;
}

/* ------------------------------ Auxiliares ------------------------------- */
function emptyChart(height) {
  return `<svg class="chart" viewBox="0 0 280 ${height}" role="img">
    <text x="140" y="${height / 2}" text-anchor="middle" fill="#94a3b8" font-size="13" font-weight="600">Sin datos en el período</text>
  </svg>`;
}
function emptyDonut(size) {
  const r = (size - 30) / 2;
  return `<svg viewBox="0 0 ${size} ${size}" width="${size}" height="${size}">
    <circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="#eef2f9" stroke-width="30"/>
  </svg>`;
}

/**
 * Barra de progreso (especie vs umbral). Devuelve markup .progress.
 * Cambia de color según el porcentaje de presión pesquera.
 */
export function progressBar(value, max) {
  const pct = max ? Math.min((value / max) * 100, 100) : 0;
  const cls = pct >= 90 ? "danger" : pct >= 70 ? "warn" : "";
  return `<div class="progress"><span class="${cls}" style="width:${pct.toFixed(0)}%"></span></div>`;
}
