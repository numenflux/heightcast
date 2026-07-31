// app.js — browser controller for Heightcast. NOT unit-tested (DOM/canvas only);
// all math lives in the pure modules under js/ which the test suite covers.

import { buildResult } from "./range.js";
import { inToCm, cmToIn, lbToKg, kgToLb } from "./convert.js";

const $ = (id) => document.getElementById(id);

const state = { sex: "male", units: "imperial" };

// The printed palette, shared by the page and the downloadable card.
const INK = "#191D2B";
const INK2 = "#4C5165";
const INK3 = "#8A8271";
const PAPER = "#FAF6EE";
const GRAPHITE = "#C6B79D";
const PENCIL = "#8E846F";
const ACCENT = "#C2472A";
const DISPLAY = "'Bricolage Grotesque', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";
const SANS = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

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
let fontsWatched = false;
let cardSerial = "";

function whoLine(input) {
  const noun = input.sex === "male" ? "boy" : "girl";
  return `a ${noun} of ${input.ageYears}`;
}

function renderResult(res, input) {
  lastResult = { res, input };
  const imp = input.units === "imperial";
  const pick = (o) => (imp ? o.ftin : o.cm);

  $("resRange").textContent = pick(res.headline.range);
  $("resPoint").textContent = pick(res.headline.point);
  // The plain-English sentence sits above the numbers, so they mean something
  // the moment they're read — and it uses the visitor's own inputs.
  $("resContext").textContent = `Nine times in ten, ${whoLine(input)} with these measurements finishes between`;

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

  // The confidence note reads as a note, not a wall. Its opening sentence is
  // dropped here only because the disclaimer block above already says it word
  // for word — nothing else is trimmed.
  const notes = res.confidence
    .split(/(?<=\.)\s+(?=[A-Z])/)
    .filter((s) => s && !/^This is an estimate/.test(s));
  $("confidence").innerHTML =
    `<p class="rn-label">Reading this estimate</p>` +
    notes.map((n) => `<p>${n}</p>`).join("");
  // no emoji anywhere on this site — the warning triangle is drawn in CSS
  $("warnings").innerHTML = (res.warnings || []).map((w) => `<div class="warn"><span>${w}</span></div>`).join("");

  // A card serial, so the printed thing is a specific object rather than a
  // generic export. It is the moment it was drawn — nothing about the visitor.
  const d = new Date();
  const p2 = (n) => String(n).padStart(2, "0");
  cardSerial = `${String(d.getFullYear()).slice(2)}${p2(d.getMonth() + 1)}${p2(d.getDate())}-${p2(d.getHours())}${p2(d.getMinutes())}`;
  $("posterSerial").textContent = `Card no. ${cardSerial} · drawn on this device`;

  drawPoster(res, input);
  // the display face may still be loading on a first visit — redraw once it lands
  if (!fontsWatched && document.fonts && document.fonts.ready) {
    fontsWatched = true;
    document.fonts.ready.then(() => { if (lastResult) drawPoster(lastResult.res, lastResult.input); });
  }

  $("result").hidden = false;
  $("result").scrollIntoView({ behavior: "smooth", block: "start" });
}

// ---- poster canvas -------------------------------------------------------
// A printed specimen card, not a dashboard screenshot: paper ground, crop
// marks, the measuring rail down the left, and the range shown as a length of
// ruler that is hatched exactly where the answer is genuinely uncertain.
function drawPoster(res, input) {
  const c = $("posterCanvas");
  const ctx = c.getContext("2d");
  const W = c.width, H = c.height;
  const imp = input.units === "imperial";
  const pick = (o) => (imp ? o.ftin : o.cm);

  const L = 132;          // text margin
  const R = W - 96;       // right edge
  const RAIL = 68;

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, W, H);

  // paper
  ctx.fillStyle = PAPER;
  ctx.fillRect(0, 0, W, H);
  paperGrain(ctx, W, H);

  // printer's crop marks
  ctx.strokeStyle = INK;
  ctx.lineWidth = 2;
  cropMark(ctx, 44, 44, 1, 1);
  cropMark(ctx, W - 44, 44, -1, 1);
  cropMark(ctx, 44, H - 44, 1, -1);
  cropMark(ctx, W - 44, H - 44, -1, -1);

  // the measuring rail — the brand's spine, same as the page
  ctx.strokeStyle = GRAPHITE;
  ctx.lineWidth = 2.5;
  ctx.beginPath(); ctx.moveTo(RAIL, 128); ctx.lineTo(RAIL, 1178); ctx.stroke();
  for (let y = 128; y <= 1178; y += 20) {
    const long = Math.round((y - 128) / 20) % 5 === 0;
    ctx.beginPath(); ctx.moveTo(RAIL, y); ctx.lineTo(RAIL + (long ? 34 : 16), y); ctx.stroke();
  }

  // ---- wordmark: the drawn caret over a rule ----
  ctx.lineCap = "round"; ctx.lineJoin = "round";
  ctx.strokeStyle = INK; ctx.lineWidth = 6;
  ctx.beginPath(); ctx.moveTo(L, 162); ctx.lineTo(L + 16, 146); ctx.lineTo(L + 32, 162); ctx.stroke();
  ctx.strokeStyle = ACCENT; ctx.lineWidth = 6;
  ctx.beginPath(); ctx.moveTo(L - 3, 180); ctx.lineTo(L + 35, 180); ctx.stroke();
  ctx.lineCap = "butt";

  ctx.textAlign = "left";
  ctx.fillStyle = INK;
  ctx.font = `800 48px ${DISPLAY}`;
  ctx.fillText("Heightcast", L + 52, 180);

  // the same stamp the page presses into the result: this card says what it is
  drawStamp(ctx, 840, 172, -7);

  rule(ctx, L, 226, R, "rgba(25,29,43,0.16)", 1.5);

  // who this is for
  ctx.fillStyle = INK3;
  ctx.font = `600 30px ${SANS}`;
  ctx.fillText(`${input.sex === "male" ? "Male" : "Female"} · age ${input.ageYears}`, L, 274);

  // the sentence that makes the numbers mean something, above the numbers
  ctx.fillStyle = INK2;
  ctx.font = `500 34px ${SANS}`;
  const lead = `Nine times in ten, ${whoLine(input)} with these measurements finishes between`;
  const leadY = wrapLeft(ctx, lead, L, 350, R - L, 44);

  // the range, printed big
  const range = pick(res.headline.range);
  ctx.fillStyle = INK;
  const size = fitFont(ctx, range, R - L, 150, 78);
  ctx.font = `800 ${size}px ${DISPLAY}`;
  const rangeY = leadY + 44 + size * 0.82;
  ctx.fillText(range, L, rangeY);

  // most likely
  ctx.fillStyle = INK2;
  ctx.font = `500 36px ${SANS}`;
  ctx.fillText("most likely around ", L, rangeY + 62);
  const mlW = ctx.measureText("most likely around ").width;
  ctx.fillStyle = ACCENT;
  ctx.font = `700 36px ${SANS}`;
  ctx.fillText(pick(res.headline.point), L + mlW, rangeY + 62);

  // ---- the range as a length of ruler ----
  const baseY = 792, barX = L, barW = R - L;
  const lo = res.headline.lowCm, hi = res.headline.highCm, pt = res.headline.pointCm;
  const pad = (hi - lo) * 0.5, min = lo - pad, max = hi + pad;
  const px = (v) => barX + ((v - min) / (max - min)) * barW;

  ctx.strokeStyle = GRAPHITE; ctx.lineWidth = 2;
  for (let x = barX; x <= barX + barW + 0.5; x += 16) {
    const long = Math.round((x - barX) / 16) % 5 === 0;
    ctx.beginPath(); ctx.moveTo(x, baseY); ctx.lineTo(x, baseY - (long ? 30 : 14)); ctx.stroke();
  }
  rule(ctx, barX, baseY, barX + barW, INK, 3);

  const bandTop = baseY - 104, bandH = 66;
  hatch(ctx, px(lo), bandTop, px(hi) - px(lo), bandH);
  ctx.strokeStyle = ACCENT; ctx.lineWidth = 3;
  ctx.beginPath(); ctx.moveTo(px(lo), bandTop); ctx.lineTo(px(lo), bandTop + bandH); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(px(hi), bandTop); ctx.lineTo(px(hi), bandTop + bandH); ctx.stroke();

  // most-likely marker: a struck triangle, not a dot
  ctx.fillStyle = ACCENT;
  ctx.beginPath();
  ctx.moveTo(px(pt) - 15, bandTop - 32);
  ctx.lineTo(px(pt) + 15, bandTop - 32);
  ctx.lineTo(px(pt), bandTop - 6);
  ctx.closePath(); ctx.fill();

  ctx.fillStyle = INK3; ctx.font = `500 27px ${SANS}`;
  const ends = range.split("–");
  ctx.textAlign = "left";  ctx.fillText(ends[0] || "", barX, baseY + 40);
  ctx.textAlign = "right"; ctx.fillText(ends[1] || "", barX + barW, baseY + 40);
  ctx.textAlign = "left";
  ctx.fillText("the hatched length is the part nobody can pin down", barX, baseY + 86);

  // ---- the three methods, as a ledger ----
  ctx.fillStyle = INK3; ctx.font = `500 26px ${SANS}`;
  ctx.fillText("What each published method says on its own", L, 962);
  rule(ctx, L, 982, R, INK, 2.5);

  const m = res.methods;
  const rows = [
    ["Khamis‑Roche", "height + weight · primary", pick(m.khamisRoche.point)],
    ["Mid‑parental (Tanner)", "from your parents' heights", pick(m.midparental.point)],
    ["Percentile projection", `~${Math.round(m.percentile.percentile)}th percentile now`, pick(m.percentile.point)],
  ];
  rows.forEach((r, i) => {
    const y = 982 + 72 * (i + 1);
    ctx.fillStyle = INK; ctx.font = `700 30px ${SANS}`;
    ctx.textAlign = "left"; ctx.fillText(r[0], L, y - 30);
    ctx.fillStyle = INK3; ctx.font = `500 24px ${SANS}`;
    ctx.fillText(r[1], L, y - 4);
    ctx.fillStyle = i === 0 ? ACCENT : INK; ctx.font = `700 32px ${SANS}`;
    ctx.textAlign = "right"; ctx.fillText(r[2], R, y - 22);
    ctx.textAlign = "left";
    rule(ctx, L, y + 14, R, "rgba(25,29,43,0.16)", 1.5);
  });

  // ---- the honest footer ----
  ctx.fillStyle = INK2; ctx.font = `500 26px ${SANS}`;
  wrapLeft(ctx, "An estimate from published science — not a measurement, and not medical advice. Genes set about 80% of your height.", L, 1252, R - L, 36);

  ctx.fillStyle = ACCENT; ctx.font = `700 25px ${SANS}`;
  ctx.fillText("Heightcast · honest height estimates", L, 1344 - 24);

  // the card's own serial — the moment it was drawn, nothing about the reader
  if (cardSerial) {
    ctx.fillStyle = INK3; ctx.font = `500 22px ${SANS}`;
    ctx.textAlign = "right";
    ctx.fillText(`no. ${cardSerial}`, R, 1344 - 24);
    ctx.textAlign = "left";
  }
}

// A pressed rubber stamp. The honesty of this tool is the brand, so it gets
// stamped onto the artefact instead of being claimed in another sentence.
function drawStamp(ctx, cx, cy, deg) {
  const w = 268, h = 84, r = 6;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate((deg * Math.PI) / 180);
  ctx.globalAlpha = 0.58;
  ctx.strokeStyle = ACCENT;
  ctx.lineWidth = 4;
  roundRect(ctx, -w / 2, -h / 2, w, h, r); ctx.stroke();
  ctx.lineWidth = 1.6;
  roundRect(ctx, -w / 2 + 7, -h / 2 + 7, w - 14, h - 14, r - 2); ctx.stroke();

  ctx.fillStyle = ACCENT;
  ctx.textAlign = "center";
  ctx.letterSpacing = "5px";
  ctx.font = `800 30px ${DISPLAY}`;
  ctx.fillText("ESTIMATE", 0, -2);
  ctx.letterSpacing = "2.5px";
  ctx.font = `500 15px ${SANS}`;
  ctx.fillText("NOT A MEASUREMENT", 0, 24);
  ctx.letterSpacing = "0px";
  ctx.textAlign = "left";
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

// ---- canvas helpers ------------------------------------------------------
function rule(ctx, x1, y, x2, color, w) {
  ctx.strokeStyle = color; ctx.lineWidth = w;
  ctx.beginPath(); ctx.moveTo(x1, y); ctx.lineTo(x2, y); ctx.stroke();
}
function cropMark(ctx, x, y, dx, dy) {
  const a = 30;
  ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + a * dx, y); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y + a * dy); ctx.stroke();
}
function hatch(ctx, x, y, w, h) {
  ctx.save();
  ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip();
  ctx.strokeStyle = "rgba(194,71,42,0.5)"; ctx.lineWidth = 3;
  for (let i = x - h; i < x + w + h; i += 13) {
    ctx.beginPath(); ctx.moveTo(i, y + h); ctx.lineTo(i + h, y); ctx.stroke();
  }
  ctx.restore();
}
function paperGrain(ctx, W, H) {
  // a light speckle so the card reads as paper rather than a flat export
  ctx.save();
  ctx.fillStyle = "rgba(25,29,43,0.035)";
  let s = 20260728;
  const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  for (let i = 0; i < 2200; i++) ctx.fillRect(rnd() * W, rnd() * H, 1.6, 1.6);
  ctx.restore();
}
function fitFont(ctx, text, maxWidth, startPx, minPx) {
  let size = startPx;
  while (size > minPx) {
    ctx.font = `800 ${size}px ${DISPLAY}`;
    if (ctx.measureText(text).width <= maxWidth) break;
    size -= 4;
  }
  return size;
}
// left-aligned wrap; returns the baseline y of the last line drawn
function wrapLeft(ctx, text, x, y, maxWidth, lineHeight) {
  const words = text.split(" ");
  let line = "", yy = y;
  for (const w of words) {
    const test = line ? line + " " + w : w;
    if (ctx.measureText(test).width > maxWidth && line) {
      ctx.fillText(line, x, yy);
      line = w; yy += lineHeight;
    } else line = test;
  }
  ctx.fillText(line, x, yy);
  return yy;
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
