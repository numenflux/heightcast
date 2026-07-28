// app.js — browser controller for Heightcast. NOT unit-tested (DOM/canvas only);
// all math lives in the pure modules under js/ which the test suite covers.

import { buildResult } from "./range.js";
import { inToCm, cmToIn, lbToKg, kgToLb } from "./convert.js";

const $ = (id) => document.getElementById(id);

const state = { sex: "male", units: "imperial" };

// ---- segmented toggles ---------------------------------------------------
function wireSeg(segId, key, onChange) {
  const seg = $(segId);
  seg.addEventListener("click", (e) => {
    const btn = e.target.closest("button");
    if (!btn) return;
    for (const b of seg.querySelectorAll("button")) b.setAttribute("aria-pressed", String(b === btn));
    state[key] = btn.dataset[key === "sex" ? "sex" : "unit"];
    onChange && onChange();
  });
}
wireSeg("sexSeg", "sex");
wireSeg("unitSeg", "units", convertFieldsToUnit);

// Convert the numeric field values when the unit system changes.
let lastUnits = "imperial";
function convertFieldsToUnit() {
  const to = state.units;
  if (to === lastUnits) return;
  const lenFields = ["height", "mother", "father"];
  const round = (n) => Math.round(n * 10) / 10;
  for (const id of lenFields) {
    const el = $(id); const v = parseFloat(el.value);
    if (Number.isFinite(v)) el.value = to === "metric" ? round(inToCm(v)) : round(cmToIn(v));
  }
  const w = $("weight"); const wv = parseFloat(w.value);
  if (Number.isFinite(wv)) w.value = to === "metric" ? round(lbToKg(wv)) : round(kgToLb(wv));

  // update unit labels
  const len = to === "metric" ? "cm" : "in";
  const wt = to === "metric" ? "kg" : "lb";
  document.querySelectorAll('[data-u="len"]').forEach((n) => (n.textContent = len));
  document.querySelectorAll('[data-u="wt"]').forEach((n) => (n.textContent = wt));
  lastUnits = to;
}

// ---- submit --------------------------------------------------------------
$("form").addEventListener("submit", (e) => {
  e.preventDefault();
  clearErrors();
  const input = {
    sex: state.sex,
    units: state.units,
    ageYears: numOrNaN("age"),
    height: numOrNaN("height"),
    weight: numOrNaN("weight"),
    motherHeight: numOrNaN("mother"),
    fatherHeight: numOrNaN("father"),
  };
  const res = buildResult(input);
  if (!res.ok) { showErrors(res.errors); return; }
  renderResult(res, input);
});

function numOrNaN(id) { const v = parseFloat($(id).value); return Number.isFinite(v) ? v : NaN; }

const ERR_MAP = { ageYears: "err-ageYears", height: "err-height", weight: "err-weight", motherHeight: "err-motherHeight", fatherHeight: "err-fatherHeight" };
function clearErrors() { Object.values(ERR_MAP).forEach((id) => ($(id).textContent = "")); }
function showErrors(errors) {
  for (const [field, msg] of Object.entries(errors)) {
    const id = ERR_MAP[field];
    if (id) $(id).textContent = msg;
  }
  // sex has no dedicated slot; surface on age line if present
  if (errors.sex) $("err-ageYears").textContent = errors.sex;
}

// ---- render --------------------------------------------------------------
let lastResult = null;
function renderResult(res, input) {
  lastResult = { res, input };
  const imp = input.units === "imperial";
  const pick = (o) => (imp ? o.ftin : o.cm);

  $("resRange").textContent = pick(res.headline.range);
  $("resPoint").textContent = pick(res.headline.point);
  $("resContext").textContent = `${input.sex === "male" ? "Male" : "Female"} · age ${input.ageYears} · your estimated adult height`;

  // scale bar: place the point within the 90% band
  const lo = res.headline.lowCm, hi = res.headline.highCm, pt = res.headline.pointCm;
  const pad = (hi - lo) * 0.5;
  const min = lo - pad, max = hi + pad;
  const pctOf = (v) => ((v - min) / (max - min)) * 100;
  $("scaleBand").style.left = pctOf(lo) + "%";
  $("scaleBand").style.width = (pctOf(hi) - pctOf(lo)) + "%";
  $("scalePt").style.left = pctOf(pt) + "%";
  $("scaleLo").textContent = pick(res.headline.range).split("–")[0];
  $("scaleHi").textContent = pick(res.headline.range).split("–")[1];

  // method rows
  const m = res.methods;
  const rows = [
    { primary: true, name: "Khamis‑Roche", sub: "uses your height + weight — most accurate", o: m.khamisRoche },
    { name: "Mid‑parental (Tanner)", sub: "from your parents' heights", o: m.midparental },
    { name: "Percentile projection", sub: `you're ~${Math.round(m.percentile.percentile)}th percentile now`, o: m.percentile },
  ];
  $("methods").innerHTML = rows.map((r) => `
    <div class="method${r.primary ? " primary" : ""}">
      <div><div class="m-name">${r.name}</div><div class="m-sub">${r.sub}</div></div>
      <div class="m-val">${pick(r.o.point)}<small>${pick(r.o.range)}</small></div>
    </div>`).join("");

  $("confidence").textContent = res.confidence;
  $("warnings").innerHTML = (res.warnings || []).map((w) => `<div class="warn">⚠ ${w}</div>`).join("");

  drawPoster(res, input);

  $("result").hidden = false;
  $("result").scrollIntoView({ behavior: "smooth", block: "start" });
}

// ---- poster canvas -------------------------------------------------------
function drawPoster(res, input) {
  const c = $("posterCanvas");
  const ctx = c.getContext("2d");
  const W = c.width, H = c.height;
  const imp = input.units === "imperial";
  const pick = (o) => (imp ? o.ftin : o.cm);

  // background: warm paper, flat — the product's face on a feed should read
  // like a printed card, not a dashboard
  ctx.fillStyle = "#FAF6EE";
  ctx.fillRect(0, 0, W, H);

  // pencil-tick measuring rail down the left edge (the brand's signature)
  ctx.strokeStyle = "#C9BCA2";
  ctx.lineWidth = 3;
  for (let i = 0; i < 40; i++) {
    const y = 120 + i * ((H - 240) / 39);
    const long = i % 5 === 0;
    ctx.beginPath();
    ctx.moveTo(70, y);
    ctx.lineTo(70 + (long ? 46 : 24), y);
    ctx.stroke();
  }
  ctx.strokeStyle = "#C9BCA2";
  ctx.beginPath();
  ctx.moveTo(70, 110);
  ctx.lineTo(70, H - 110);
  ctx.stroke();

  const cx = W / 2;
  ctx.textAlign = "center";

  // wordmark
  ctx.fillStyle = "#C7502B";
  drawTriangle(ctx, cx - 100, 150, 26);
  ctx.font = "700 44px 'Bricolage Grotesque', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";
  ctx.fillStyle = "#1C2030";
  ctx.textAlign = "left";
  ctx.fillText("Heightcast", cx - 64, 164);
  ctx.textAlign = "center";

  // context line
  ctx.fillStyle = "#575B70";
  ctx.font = "500 34px -apple-system, sans-serif";
  ctx.fillText(`${input.sex === "male" ? "Male" : "Female"} · age ${input.ageYears}`, cx, 300);

  ctx.fillStyle = "#8A867B";
  ctx.font = "600 30px -apple-system, sans-serif";
  ctx.fillText("Predicted adult height", cx, 372);

  // big range — ink numerals, printed-poster confidence
  const range = pick(res.headline.range);
  ctx.fillStyle = "#1C2030";
  ctx.font = "800 132px 'Bricolage Grotesque', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";
  fitText(ctx, range, W - 160, 132, 60);
  ctx.fillText(range, cx, 520);

  // most likely
  ctx.fillStyle = "#575B70";
  ctx.font = "500 40px -apple-system, sans-serif";
  ctx.fillText(`most likely around ${pick(res.headline.point)}`, cx, 600);

  // range bar
  const barY = 700, barX = 150, barW = W - 300, barH = 22;
  const lo = res.headline.lowCm, hi = res.headline.highCm, pt = res.headline.pointCm;
  const pad = (hi - lo) * 0.5, min = lo - pad, max = hi + pad;
  const px = (v) => barX + ((v - min) / (max - min)) * barW;
  roundRect(ctx, barX, barY, barW, barH, 11);
  ctx.fillStyle = "#EFE8DA";
  ctx.fill();
  roundRect(ctx, px(lo), barY, px(hi) - px(lo), barH, 11);
  ctx.fillStyle = "#C7502B";
  ctx.fill();
  ctx.beginPath();
  ctx.arc(px(pt), barY + barH / 2, 20, 0, Math.PI * 2);
  ctx.fillStyle = "#FFFFFF";
  ctx.fill();
  ctx.lineWidth = 6;
  ctx.strokeStyle = "#C7502B";
  ctx.beginPath();
  ctx.arc(px(pt), barY + barH / 2, 20, 0, Math.PI * 2);
  ctx.stroke();

  // three-method mini corroboration
  ctx.fillStyle = "#8A867B";
  ctx.font = "500 30px -apple-system, sans-serif";
  const m = res.methods;
  const line = `Khamis‑Roche  ·  Mid‑parental  ·  Percentile`;
  ctx.fillText(line, cx, 830);
  ctx.fillStyle = "#C7502B";
  ctx.font = "700 34px -apple-system, sans-serif";
  ctx.fillText(
    `${pick(m.khamisRoche.point)}   ${pick(m.midparental.point)}   ${pick(m.percentile.point)}`,
    cx, 880
  );

  // honest footer band
  ctx.fillStyle = "#F3EDE1";
  roundRect(ctx, 90, H - 250, W - 180, 150, 24);
  ctx.fill();
  ctx.fillStyle = "#575B70";
  ctx.font = "500 30px -apple-system, sans-serif";
  wrapText(ctx, "An estimate from published science — not a measurement, not medical advice. Genes set ~80% of your height.", cx, H - 195, W - 240, 40);

  ctx.fillStyle = "#C7502B";
  ctx.font = "700 30px -apple-system, sans-serif";
  ctx.fillText("heightcast · honest height estimates", cx, H - 60);
}

// canvas helpers
function drawTriangle(ctx, x, y, s) {
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(x, y - s * 0.62);
  ctx.lineTo(x + s * 0.62, y + s * 0.42);
  ctx.lineTo(x - s * 0.62, y + s * 0.42);
  ctx.closePath();
  ctx.fillStyle = "#C7502B";
  ctx.fill();
  ctx.restore();
}
function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
function fitText(ctx, text, maxWidth, startPx, minPx) {
  let size = startPx;
  do {
    ctx.font = `800 ${size}px 'Bricolage Grotesque', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif`;
    if (ctx.measureText(text).width <= maxWidth) break;
    size -= 4;
  } while (size > minPx);
}
function wrapText(ctx, text, cx, y, maxWidth, lineHeight) {
  const words = text.split(" ");
  let line = "", yy = y;
  for (const w of words) {
    const test = line ? line + " " + w : w;
    if (ctx.measureText(test).width > maxWidth && line) {
      ctx.fillText(line, cx, yy);
      line = w; yy += lineHeight;
    } else line = test;
  }
  ctx.fillText(line, cx, yy);
}

// ---- download ------------------------------------------------------------
$("downloadBtn").addEventListener("click", () => {
  const a = document.createElement("a");
  a.download = "heightcast-estimate.png";
  a.href = $("posterCanvas").toDataURL("image/png");
  a.click();
});

// There is deliberately no network code in this file, and none anywhere else
// in the site: no fetch, no form POST, no analytics, no third-party script.
// Every value the visitor types is read, used and dropped in this document.
