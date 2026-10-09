/* ============================================================================
 *  PescaCorral · js/charts.js
 *  Gráficos en SVG puro (sin librerías): barras verticales y dona/torta.
 *  Pensados para el Panel Municipal y la pantalla de Reportes.
 * ========================================================================== */
import { esc } from "./ui.js";

export const CHART_COLORS = [
  // Paleta salteña: granate, ocre, agua del dique, verde de los valles, terracota.
  "#8E1F2F", "#C9821E", "#1F6E8C", "#2E7D4F", "#B85C2E", "#6B4C7A", "#2C8AA8", "#7A6862",
];

/* ------------------------------ Barras ----------------------------------- */
/**
 * Gráfico de barras verticales.
 * @param {{label:string,value:number}[]} data
 * @param {{height?:number, color?:string, money?:boolean, unit?:string}} opts
 */
export function barChart(data = [], opts = {}) {
  const { height = 220, color = "#8E1F2F", unit = "" } = opts;
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
    return `<line x1="${padX}" y1="${y.toFixed(1)}" x2="${W - padX}" y2="${y.toFixed(1)}" stroke="#F1E9E0" stroke-width="1"/>`;
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

  const resumen = data.map((d) => `${d.label}: ${d.value}`).join("; ");
  return `<svg class="chart" viewBox="0 0 ${W} ${height}" preserveAspectRatio="xMidYMid meet" role="img" aria-label="${esc(resumen)}">
    ${gridLines}${bars}
  </svg>`;
}

/* --------------------- Barras de a pares (dos series) --------------------- */
/**
 * Dos series por período, una al lado de la otra (por ejemplo, ingresos y
 * gastos de cada mes), con su leyenda. Los importes van en el título de cada
 * barra y en la descripción del gráfico; conviene acompañarlo con una tabla.
 * @param {{label:string,a:number,b:number}[]} data
 * @param {{height?:number, nombreA?:string, nombreB?:string, colorA?:string, colorB?:string, fmt?:(v:number)=>string}} opts
 */
export function barChartPar(data = [], opts = {}) {
  const { height = 220, nombreA = "A", nombreB = "B", colorA = "#2E7D4F", colorB = "#8E1F2F", fmt = String } = opts;
  if (!data.length) return emptyChart(height);
  const W = Math.max(data.length * 56, 280);
  const padX = 10, padTop = 12, padBottom = 30;
  const innerH = height - padTop - padBottom;
  const max = Math.max(...data.flatMap((d) => [d.a, d.b]), 1);
  const bw = (W - padX * 2) / data.length;
  const barW = Math.min(bw * 0.36, 30);
  const barra = (v, x, color, nombre, label) => {
    const h = (v / max) * innerH, y = padTop + innerH - h;
    return `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barW.toFixed(1)}" height="${Math.max(h, 1).toFixed(1)}" rx="5" fill="${color}" opacity="${v ? 1 : 0.25}">
        <title>${esc(label)} · ${esc(nombre)}: ${esc(fmt(v))}</title></rect>`;
  };
  const grupos = data.map((d, i) => {
    const cx = padX + bw * i + bw / 2;
    return `<g>${barra(d.a, cx - barW - 2, colorA, nombreA, d.label)}${barra(d.b, cx + 2, colorB, nombreB, d.label)}
      <text class="bar-label" x="${cx.toFixed(1)}" y="${(height - 12).toFixed(1)}" text-anchor="middle">${esc(d.label)}</text></g>`;
  }).join("");
  const resumen = data.map((d) => `${d.label}: ${nombreA} ${fmt(d.a)}, ${nombreB} ${fmt(d.b)}`).join("; ");
  return `<svg class="chart" viewBox="0 0 ${W} ${height}" preserveAspectRatio="xMidYMid meet" role="img" aria-label="${esc(resumen)}">
    <line x1="${padX}" y1="${padTop + innerH}" x2="${W - padX}" y2="${padTop + innerH}" stroke="#F1E9E0" stroke-width="1"/>${grupos}
  </svg>
  <div class="legend legend--fila"><div><i style="background:${colorA}"></i><span>${esc(nombreA)}</span></div><div><i style="background:${colorB}"></i><span>${esc(nombreB)}</span></div></div>`;
}

/* ----------------------------- Dona / torta ------------------------------ */
/**
 * Gráfico de dona con leyenda lateral.
 * @param {{label:string,value:number,color?:string}[]} data
 * @param {{size?:number, thickness?:number, centerTop?:string, centerSub?:string, fmt?:(v:number)=>string}} opts
 */
export function donutChart(data = [], opts = {}) {
  const { size = 180, thickness = 30, centerTop = "", centerSub = "", fmt = String } = opts;
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
        stroke-linecap="butt"><title>${esc(d.label)}: ${esc(fmt(d.value))} (${Math.round(frac * 100)}%)</title></circle>`;
    offset += len;
    return seg;
  }).join("");

  const center = centerTop
    ? `<text x="${cx}" y="${cy - 2}" text-anchor="middle" font-size="22" font-weight="800" fill="#2A1B1C">${esc(centerTop)}</text>
       <text x="${cx}" y="${cy + 16}" text-anchor="middle" font-size="11" font-weight="600" fill="#7A6862">${esc(centerSub)}</text>`
    : "";

  const legend = items.map((d, i) => {
    const color = d.color || CHART_COLORS[i % CHART_COLORS.length];
    const pct = Math.round((d.value / total) * 100);
    return `<div><i style="background:${color}"></i><span>${esc(d.label)}</span>
      <b style="margin-left:auto;color:var(--text)">${esc(fmt(d.value))} · ${pct}%</b></div>`;
  }).join("");

  return `<div class="flex gap-12 items-center" style="flex-wrap:wrap;justify-content:center">
    <svg viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" role="img" aria-label="${esc(data.map((d) => `${d.label}: ${fmt(d.value)}`).join("; "))}">
      <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="#F1E9E0" stroke-width="${thickness}"/>
      ${arcs}${center}
    </svg>
    <div class="legend" style="min-width:150px;flex:1">${legend}</div>
  </div>`;
}

/* ------------------------------ Auxiliares ------------------------------- */
function emptyChart(height) {
  return `<svg class="chart" viewBox="0 0 280 ${height}" role="img" aria-label="Sin datos">
    <text x="140" y="${height / 2}" text-anchor="middle" fill="#A8978F" font-size="13" font-weight="600">Sin datos en el período</text>
  </svg>`;
}
function emptyDonut(size) {
  const r = (size - 30) / 2;
  return `<svg viewBox="0 0 ${size} ${size}" width="${size}" height="${size}">
    <circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="#F1E9E0" stroke-width="30"/>
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
