// app.test.js — contract tests for the browser controller.
//
// js/app.js opens by conceding it is "NOT unit-tested (DOM/canvas only)". That
// concession is exactly why it needs these: it is the only thing standing
// between a parent's typed numbers and the prediction on screen. The maths
// modules underneath are all covered and all correct — which means a wiring
// bug here does not look like a bug. It feeds correct maths the wrong inputs
// and prints a confident, wrong number about somebody's child.
//
// The file also makes three promises in prose that nothing enforced until now:
//   · "There is deliberately no network code in this file, and none anywhere
//      else in the site: no fetch, no form POST, no analytics" (closing comment)
//   · the card serial "is the moment it was drawn — nothing about the visitor"
//   · the page's own copy: "The five numbers below are used once, here, and
//      never leave this tab."
// A promise a future commit can quietly break is not a guarantee, so each one
// is asserted below.
//
// Method: app.js is an ES module with top-level side effects (it wires four
// listeners the moment it is imported), so it is booted against a hand-rolled
// `document` stub installed on globalThis, then driven by firing the listeners
// it registered. A query string on the import specifier gives every scenario a
// fresh module instance — app.js keeps mutable module state (`state`,
// `lastUnits`, `lastResult`, `cardSerial`), and sharing it across tests would
// let one scenario's leftovers pass another scenario's assertions.
//
// Zero new dependencies, matching the repo (node:test, node:assert/strict).

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { buildResult } from "../js/range.js";
import { cmToIn } from "../js/convert.js";

const APP_URL = new URL("../js/app.js", import.meta.url);
const APP_SOURCE = readFileSync(fileURLToPath(APP_URL), "utf8");

const close = (a, b, eps, msg) =>
  assert.ok(Math.abs(a - b) <= eps, msg || `${a} !~= ${b} (tolerance ${eps})`);

// ---------------------------------------------------------------------------
// DOM stub
// ---------------------------------------------------------------------------

// textContent / innerHTML / hidden are write probes, not plain fields.
//
// Reading the final value is not enough to prove the controller refused to
// render. A render that started, wrote a number and then threw leaves most
// nodes looking untouched and the result section still hidden — identical, from
// the outside, to a controller that correctly declined. `writes` records that
// the write happened at all, which is the property actually being claimed.
function probe(el, prop, initial) {
  let v = initial;
  Object.defineProperty(el, prop, {
    get: () => v,
    set: (next) => { el.writes.push([prop, next]); v = next; },
    enumerable: true,
    configurable: true,
  });
}

function makeEl(id, tag = "div") {
  const listeners = new Map();
  const el = {
    id,
    tagName: tag.toUpperCase(),
    dataset: {},
    style: {},
    value: "",
    parentNode: null,
    children: [],
    attrs: new Map(),
    writes: [],
    scrolledIntoView: false,
    addEventListener(type, fn) {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(fn);
    },
    setAttribute(k, v) { el.attrs.set(k, String(v)); },
    getAttribute(k) { return el.attrs.has(k) ? el.attrs.get(k) : null; },
    querySelectorAll(sel) {
      return sel === "button" ? el.children.filter((c) => c.tagName === "BUTTON") : [];
    },
    // Real `closest` semantics: match self, then walk up. A click landing on
    // the group's padding rather than a button must resolve to null.
    closest(sel) {
      let n = el;
      while (n) {
        if (n.tagName === sel.toUpperCase()) return n;
        n = n.parentNode;
      }
      return null;
    },
    scrollIntoView() { el.scrolledIntoView = true; },
    fire(type, ev) { for (const fn of listeners.get(type) || []) fn(ev); },
  };
  probe(el, "textContent", "");
  probe(el, "innerHTML", "");
  probe(el, "hidden", true);
  return el;
}

// A recording 2D context. `ops` is the "was the card drawn at all" probe —
// zero ops is how a test proves drawPoster never ran, which no assertion about
// the page's own nodes can show.
function makeCtx() {
  const ctx = {
    ops: 0,
    texts: [],
    fillStyle: "", strokeStyle: "", lineWidth: 0, font: "", textAlign: "left",
    lineCap: "", lineJoin: "", globalAlpha: 1, letterSpacing: "0px",
    // A stand-in metric: deterministic, and wide enough that the wrapped
    // paragraphs actually take the wrapping branch.
    measureText: (t) => ({ width: String(t).length * 9 }),
    fillText(t, x, y) { ctx.ops += 1; ctx.texts.push({ text: String(t), x, y }); },
  };
  for (const m of [
    "setTransform", "clearRect", "fillRect", "strokeRect", "beginPath", "closePath",
    "moveTo", "lineTo", "stroke", "fill", "save", "restore", "translate", "rotate",
    "arcTo", "clip", "rect", "scale",
  ]) ctx[m] = () => { ctx.ops += 1; };
  return ctx;
}

function makeCanvas() {
  const el = makeEl("posterCanvas", "canvas");
  el.width = 1080;
  el.height = 1350;
  el.ctx = makeCtx();
  el.dataUrls = [];
  el.getContext = (type) => (type === "2d" ? el.ctx : null);
  el.toDataURL = (type) => {
    el.dataUrls.push(type);
    return "data:image/png;base64,SGVpZ2h0Y2FzdA==";
  };
  return el;
}

/**
 * Builds the subset of index.html that app.js actually reaches for.
 *
 * `sexData:false` reproduces markup drift — the sex buttons lose their
 * data-sex attribute, e.g. someone edits the markup and drops it — which is
 * the only route by which validate.js can report a `sex` error at runtime.
 */
function makeDom({ fonts = null, sexData = true } = {}) {
  const byId = new Map();
  const add = (el) => { byId.set(el.id, el); return el; };

  const seg = (id, key, values, withData = true) => {
    const s = add(makeEl(id));
    s.children = values.map((v, i) => {
      const b = makeEl(`${id}-${v}`, "button");
      if (withData) b.dataset[key] = v;
      b.parentNode = s;
      b.setAttribute("aria-pressed", String(i === 0));
      return b;
    });
    return s;
  };
  seg("sexSeg", "sex", ["male", "female"], sexData);
  seg("unitSeg", "unit", ["imperial", "metric"]);

  for (const id of ["age", "height", "weight", "mother", "father"]) add(makeEl(id, "input"));
  for (const id of ["err-ageYears", "err-height", "err-weight", "err-motherHeight", "err-fatherHeight"]) add(makeEl(id));
  for (const id of ["resRange", "resPoint", "resContext", "scaleBand", "scalePt",
    "scaleLo", "scaleHi", "methods", "confidence", "warnings", "posterSerial", "result"]) add(makeEl(id));
  add(makeEl("form", "form"));
  add(makeEl("downloadBtn", "button"));
  const canvas = add(makeCanvas());

  // The unit suffixes beside the fields: three length labels (height, mother,
  // father) and one weight label, exactly as index.html has them.
  const lenLabels = ["u-len-1", "u-len-2", "u-len-3"].map((i) => { const n = makeEl(i, "span"); n.textContent = "in"; return n; });
  const wtLabels = [(() => { const n = makeEl("u-wt-1", "span"); n.textContent = "lb"; return n; })()];

  const anchors = [];
  const document = {
    getElementById: (id) => byId.get(id) ?? null,
    querySelectorAll(sel) {
      if (sel === '[data-u="len"]') return lenLabels;
      if (sel === '[data-u="wt"]') return wtLabels;
      return [];
    },
    createElement(tag) {
      if (tag !== "a") return makeEl("", tag);
      const a = { tagName: "A", download: "", href: "", clicks: 0, click() { a.clicks += 1; } };
      anchors.push(a);
      return a;
    },
  };
  if (fonts) document.fonts = fonts;

  return {
    document, canvas, ctx: canvas.ctx, anchors, lenLabels, wtLabels,
    el: (id) => byId.get(id),

    fill(values) {
      for (const [id, v] of Object.entries(values)) byId.get(id).value = v;
    },

    /** Fires a click on a segmented control. `index === null` clicks the group
     *  itself — the padding between the buttons. */
    clickSeg(segId, index) {
      const s = byId.get(segId);
      const target = index === null ? s : s.children[index];
      let error = null;
      try { s.fire("click", { target }); } catch (e) { error = e; }
      return { error };
    },

    /** Submits the form. The returned `prevented` is the whole no-navigation
     *  contract; `error` is what lets a test assert nothing escaped. */
    submit() {
      const ev = { prevented: false, preventDefault() { ev.prevented = true; } };
      let error = null;
      try { byId.get("form").fire("submit", ev); } catch (e) { error = e; }
      return { prevented: ev.prevented, error };
    },

    download() {
      let error = null;
      try { byId.get("downloadBtn").fire("click", {}); } catch (e) { error = e; }
      return { error };
    },

    pressed(segId) {
      return byId.get(segId).children.map((b) => b.getAttribute("aria-pressed"));
    },
  };
}

// Every scenario gets its own module instance; app.js reads `document` off
// globalThis at call time, so the stub stays installed for the life of the
// test. node:test runs a file's tests sequentially, so scenarios cannot
// interleave.
let caseNo = 0;
async function boot(options) {
  const dom = makeDom(options);
  globalThis.document = dom.document;
  await import(`${APP_URL.href}?case=${++caseNo}`);
  return dom;
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

// ---------------------------------------------------------------------------
// The canonical case: the 10-year-old boy from range.test.js, in imperial.
// The expectation comes from the model itself, so these tests assert that the
// controller renders what buildResult produced — not a number typed twice.
// ---------------------------------------------------------------------------
const IMPERIAL_FIELDS = { age: "10", height: "54.5", weight: "76", mother: "64", father: "70" };
const IMPERIAL_INPUT = {
  sex: "male", units: "imperial", ageYears: 10,
  height: 54.5, weight: 76, motherHeight: 64, fatherHeight: 70,
};
const EXPECTED = buildResult(IMPERIAL_INPUT);

// A second fixture, and the reason for it: for the 10-year-old above all three
// methods happen to round to the same 5'9½", so any assertion of the form
// "this row shows the Khamis-Roche value" is satisfied by every row and proves
// nothing. (Mutating the primary row to read from midparental was caught by
// nothing until this fixture existed.) This 12-year-old's three methods
// disagree, so a row can be caught showing another row's number.
const SPREAD_FIELDS = { age: "12", height: "62", weight: "110", mother: "61", father: "66" };
const SPREAD_INPUT = {
  sex: "male", units: "imperial", ageYears: 12,
  height: 62, weight: 110, motherHeight: 61, fatherHeight: 66,
};
const SPREAD = buildResult(SPREAD_INPUT);
const SPREAD_POINTS = ["khamisRoche", "midparental", "percentile"].map((k) => SPREAD.methods[k].point.ftin);

/** Parses 5'9½" back to total inches, so a metric render can be compared with
 *  an imperial one on a single scale. */
function ftInToInches(s) {
  const m = /^(\d+)'(\d+)(½?)"$/.exec(s.trim());
  assert.ok(m, `not a ft/in string: ${s}`);
  return Number(m[1]) * 12 + Number(m[2]) + (m[3] ? 0.5 : 0);
}

/** The full refusal assertion: nothing was shown, and nothing was even begun.
 *
 *  Checking `result.hidden` alone is not enough. A controller that wrongly
 *  decided to render, wrote a number and threw partway ends in the same hidden
 *  state — a bug wearing the costume of a guarantee. The discriminators are the
 *  write log (no output node was touched), the canvas op count (the card was
 *  never drawn) and `error` (nothing escaped into the page's script context). */
function renderedNothing(dom, result) {
  assert.equal(result.error, null, "an exception escaped the submit handler");
  assert.equal(dom.el("result").hidden, true);
  assert.ok(
    !dom.el("result").writes.some(([p, v]) => p === "hidden" && v === false),
    "the result section was revealed for input that failed validation",
  );
  for (const id of ["resRange", "resPoint", "resContext", "methods", "confidence", "warnings", "posterSerial"]) {
    assert.deepEqual(dom.el(id).writes, [], `${id} was written to during a failed submit`);
  }
  assert.equal(dom.ctx.ops, 0, "the poster card was drawn for input that failed validation");
  assert.equal(dom.el("result").scrolledIntoView, false);
}

// ===========================================================================
// 1. The privacy promise: nothing leaves the tab
// ===========================================================================

test("submitting never navigates — the result survives the button press", async () => {
  // Without preventDefault the browser performs its default submit: the page
  // reloads, `state` and `lastResult` reset, and the result section returns to
  // hidden. To the visitor the button simply does nothing, forever.
  const dom = await boot();
  dom.fill(IMPERIAL_FIELDS);
  const r = dom.submit();
  assert.equal(r.prevented, true, "the submit handler did not call preventDefault");
  assert.equal(r.error, null);
  assert.equal(dom.el("result").hidden, false);
});

test("a full session makes no network call and writes no storage", async () => {
  // The file's closing comment: "There is deliberately no network code in this
  // file... Every value the visitor types is read, used and dropped in this
  // document." These trip-wires are installed on globalThis, which is exactly
  // where app.js would resolve them from.
  const calls = [];
  const wire = (name) => (...args) => { calls.push([name, ...args.map(String)]); };

  const savedFetch = globalThis.fetch;
  const savedXHR = globalThis.XMLHttpRequest;
  const savedWS = globalThis.WebSocket;
  const savedES = globalThis.EventSource;
  const savedImage = globalThis.Image;
  const savedNav = Object.getOwnPropertyDescriptor(globalThis, "navigator");

  globalThis.fetch = wire("fetch");
  globalThis.XMLHttpRequest = function () { calls.push(["XMLHttpRequest"]); };
  globalThis.WebSocket = function () { calls.push(["WebSocket"]); };
  globalThis.EventSource = function () { calls.push(["EventSource"]); };
  globalThis.Image = function () { calls.push(["Image"]); };
  Object.defineProperty(globalThis, "navigator", {
    value: { sendBeacon: wire("sendBeacon") },
    configurable: true, writable: true,
  });

  try {
    const dom = await boot();
    dom.fill(IMPERIAL_FIELDS);
    dom.clickSeg("sexSeg", 1);      // female
    dom.clickSeg("unitSeg", 1);     // metric
    dom.submit();                   // a real prediction
    dom.download();                 // and the card export
    dom.fill({ ...IMPERIAL_FIELDS, age: "2" });
    dom.submit();                   // and a rejected one
    await settle();

    assert.deepEqual(calls, [], `the page contacted the network: ${JSON.stringify(calls)}`);
    // Storage would be a second way for the five numbers to outlive the tab.
    assert.ok(!("cookie" in dom.document), "app.js wrote document.cookie");
  } finally {
    globalThis.fetch = savedFetch;
    globalThis.XMLHttpRequest = savedXHR;
    globalThis.WebSocket = savedWS;
    globalThis.EventSource = savedES;
    globalThis.Image = savedImage;
    if (savedNav) Object.defineProperty(globalThis, "navigator", savedNav);
    else delete globalThis.navigator;
  }
});

test("the source contains no network or persistence primitive at all", () => {
  // The runtime check above only covers paths a test walked. This one covers
  // the branches it did not, which is where an analytics snippet would sit.
  //
  // Comments are stripped first: app.js's own closing note is prose about what
  // it does *not* do ("no fetch... no analytics"), and matching that would make
  // this test fail for the best possible reason, which is useless.
  const code = APP_SOURCE.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  assert.ok(code.includes("addEventListener"), "comment stripping ate the code");
  assert.ok(!code.includes("deliberately no network"), "comment stripping did not run");

  const banned = [
    [/\bfetch\s*\(/, "fetch()"],
    [/XMLHttpRequest/, "XMLHttpRequest"],
    [/sendBeacon/, "navigator.sendBeacon"],
    [/\bWebSocket\b/, "WebSocket"],
    [/\bEventSource\b/, "EventSource"],
    [/localStorage|sessionStorage|indexedDB/, "web storage"],
    [/document\.cookie/, "document.cookie"],
    [/\bgtag\b|dataLayer|analytics/i, "an analytics global"],
    [/<script/i, "an injected script tag"],
  ];
  for (const [re, label] of banned) {
    assert.ok(!re.test(code), `js/app.js now references ${label}`);
  }
});

// ===========================================================================
// 2. Bad input must never become a prediction
// ===========================================================================

test("input that fails validation renders nothing at all", async () => {
  const dom = await boot();
  dom.fill({ ...IMPERIAL_FIELDS, age: "2" });   // below the validated window
  const r = dom.submit();
  renderedNothing(dom, r);
  assert.match(dom.el("err-ageYears").textContent, /ages 4 and up/);
});

test("hostile, non-numeric field text is rejected rather than rendered", async () => {
  const dom = await boot();
  dom.fill({ age: "ten", height: '"><img src=x>', weight: "", mother: "abc", father: "70" });
  const r = dom.submit();
  renderedNothing(dom, r);
  assert.ok(dom.el("err-ageYears").textContent);
  assert.ok(dom.el("err-height").textContent);
  assert.ok(dom.el("err-weight").textContent);
});

test("stale errors are cleared before the next attempt", async () => {
  // Otherwise a message about an age the visitor has since fixed stays pinned
  // beside a correct answer.
  const dom = await boot();
  dom.fill({ ...IMPERIAL_FIELDS, age: "2" });
  dom.submit();
  assert.ok(dom.el("err-ageYears").textContent, "precondition: the error was shown");

  dom.fill(IMPERIAL_FIELDS);
  const r = dom.submit();
  assert.equal(r.error, null);
  assert.equal(dom.el("err-ageYears").textContent, "", "a stale error survived a successful submit");
  assert.equal(dom.el("result").hidden, false);
});

test("markup that has lost data-sex still speaks instead of dying silently", async () => {
  // validate.js can report a `sex` error, and ERR_MAP has no slot for it. Both
  // guards in showErrors carry that case: `if (id)` stops the lookup crashing
  // the handler, and the fallback line puts the message somewhere visible. With
  // either missing the button is dead — no numbers, no error, no clue.
  const dom = await boot({ sexData: false });
  dom.fill(IMPERIAL_FIELDS);
  dom.clickSeg("sexSeg", 1);
  const r = dom.submit();
  renderedNothing(dom, r);
  assert.match(dom.el("err-ageYears").textContent, /male or female/i);
});

// ===========================================================================
// 3. Unit plumbing — where a wiring bug becomes a wrong number
// ===========================================================================

test("switching to metric converts the values and relabels the fields", async () => {
  const dom = await boot();
  dom.fill(IMPERIAL_FIELDS);
  dom.clickSeg("unitSeg", 1);

  close(Number(dom.el("height").value), 138.4, 0.06, "54.5 in should read as ~138.4 cm");
  close(Number(dom.el("weight").value), 34.5, 0.06, "76 lb should read as ~34.5 kg");
  close(Number(dom.el("mother").value), 162.6, 0.06);
  close(Number(dom.el("father").value), 177.8, 0.06);

  // The labels have to move with the numbers. If they do not, the visitor is
  // reading "in" next to a centimetre value and will "correct" it.
  assert.deepEqual(dom.lenLabels.map((n) => n.textContent), ["cm", "cm", "cm"]);
  assert.deepEqual(dom.wtLabels.map((n) => n.textContent), ["kg"]);

  dom.clickSeg("unitSeg", 0);
  close(Number(dom.el("height").value), 54.5, 0.06, "the round trip should return the original");
  assert.deepEqual(dom.lenLabels.map((n) => n.textContent), ["in", "in", "in"]);
  assert.deepEqual(dom.wtLabels.map((n) => n.textContent), ["lb"]);
});

test("tapping the unit already selected does not convert a second time", async () => {
  // The listener runs on every click, including a click on the active button.
  // Without the `to === lastUnits` guard a second tap on "cm · kg" turns 138.4
  // into 351.5 and the visitor never sees why their estimate went absurd.
  const dom = await boot();
  dom.fill(IMPERIAL_FIELDS);
  dom.clickSeg("unitSeg", 1);
  const once = { ...["height", "weight", "mother", "father"].reduce((o, id) => (o[id] = Number(dom.el(id).value), o), {}) };

  dom.clickSeg("unitSeg", 1);
  dom.clickSeg("unitSeg", 1);
  for (const id of ["height", "weight", "mother", "father"]) {
    assert.equal(Number(dom.el(id).value), once[id], `${id} was converted more than once`);
  }
});

test("empty fields stay empty rather than filling with NaN", async () => {
  const dom = await boot();
  dom.fill({ age: "10", height: "", weight: "", mother: "64", father: "" });
  dom.clickSeg("unitSeg", 1);
  assert.equal(dom.el("height").value, "", "an untouched length field was overwritten");
  assert.equal(dom.el("weight").value, "", "an untouched weight field was overwritten");
  assert.equal(dom.el("father").value, "");
  close(Number(dom.el("mother").value), 162.6, 0.06, "the filled field should still convert");
});

test("the same child entered in either unit system gets the same estimate", async () => {
  // The end-to-end statement of the whole unit contract: toggle state, field
  // conversion and the units passed to buildResult all have to agree, or the
  // maths is fed the wrong numbers and answers confidently anyway.
  const imperialDom = await boot();
  imperialDom.fill(IMPERIAL_FIELDS);
  imperialDom.submit();
  const asImperial = ftInToInches(imperialDom.el("resPoint").textContent);

  const metricDom = await boot();
  metricDom.fill(IMPERIAL_FIELDS);
  metricDom.clickSeg("unitSeg", 1);      // fields convert to cm/kg
  const r = metricDom.submit();
  assert.equal(r.error, null);
  assert.equal(metricDom.el("result").hidden, false, "the metric submit was rejected");
  const asMetric = cmToIn(parseFloat(metricDom.el("resPoint").textContent));

  close(asImperial, asMetric, 0.4, "the two unit paths disagree about the same child");
});

test("the displayed strings follow the selected unit system", async () => {
  const imperialDom = await boot();
  imperialDom.fill(IMPERIAL_FIELDS);
  imperialDom.submit();
  assert.equal(imperialDom.el("resRange").textContent, EXPECTED.headline.range.ftin);
  assert.equal(imperialDom.el("resPoint").textContent, EXPECTED.headline.point.ftin);

  const metricDom = await boot();
  metricDom.fill(IMPERIAL_FIELDS);
  metricDom.clickSeg("unitSeg", 1);
  metricDom.submit();
  assert.match(metricDom.el("resRange").textContent, /cm$/);
  assert.match(metricDom.el("resPoint").textContent, /cm$/);
});

// ===========================================================================
// 4. The segmented toggles
// ===========================================================================

test("clicking the gap between buttons changes nothing and does not throw", async () => {
  const dom = await boot();
  const r = dom.clickSeg("sexSeg", null);
  assert.equal(r.error, null, "a click on the group's padding threw");
  assert.deepEqual(dom.pressed("sexSeg"), ["true", "false"], "the selection was cleared by a stray click");

  // And the state behind it is intact, not merely the pixels.
  dom.fill(IMPERIAL_FIELDS);
  dom.submit();
  assert.match(dom.el("resContext").textContent, /a boy of 10/);
});

test("exactly one button in a group reads as pressed", async () => {
  const dom = await boot();
  dom.clickSeg("sexSeg", 1);
  assert.deepEqual(dom.pressed("sexSeg"), ["false", "true"]);
  dom.clickSeg("sexSeg", 0);
  assert.deepEqual(dom.pressed("sexSeg"), ["true", "false"]);
  dom.clickSeg("unitSeg", 1);
  assert.deepEqual(dom.pressed("unitSeg"), ["false", "true"]);
});

test("the sex chosen on the toggle is the sex that gets predicted", async () => {
  const female = buildResult({ ...IMPERIAL_INPUT, sex: "female" });
  assert.notEqual(female.headline.point.ftin, EXPECTED.headline.point.ftin,
    "precondition: the two curves must differ for this test to mean anything");

  const dom = await boot();
  dom.fill(IMPERIAL_FIELDS);
  dom.clickSeg("sexSeg", 1);
  dom.submit();

  assert.equal(dom.el("resPoint").textContent, female.headline.point.ftin,
    "the female toggle did not reach the prediction");
  assert.match(dom.el("resContext").textContent, /a girl of 10/);
});

// ===========================================================================
// 5. What the page draws
// ===========================================================================

test("the scale bar's geometry agrees with the model's numbers", async () => {
  // The bar is the only part of the result a visitor reads as a picture rather
  // than a number, so it has to sit on the same linear scale as the band. If
  // the marker drifts, the page shows a most-likely value outside its own 90%
  // range and nobody notices, because both are just CSS percentages.
  const dom = await boot();
  dom.fill(IMPERIAL_FIELDS);
  dom.submit();

  const left = parseFloat(dom.el("scaleBand").style.left);
  const width = parseFloat(dom.el("scaleBand").style.width);
  const point = parseFloat(dom.el("scalePt").style.left);
  for (const v of [left, width, point]) assert.ok(Number.isFinite(v), "a scale offset is not a number");

  assert.ok(point >= left && point <= left + width,
    `the most-likely marker (${point}%) sits outside the band it belongs to (${left}%..${left + width}%)`);

  const { lowCm, highCm, pointCm } = EXPECTED.headline;
  close((point - left) / width, (pointCm - lowCm) / (highCm - lowCm), 1e-9,
    "the marker's position within the band does not match pointCm");
});

test("the scale's end labels are the two ends of the displayed range", async () => {
  // Both come from splitting the range on its en dash. A hyphen there instead
  // prints the whole string on the left and the word "undefined" on the right.
  const dom = await boot();
  dom.fill(IMPERIAL_FIELDS);
  dom.submit();

  const lo = dom.el("scaleLo").textContent;
  const hi = dom.el("scaleHi").textContent;
  for (const v of [lo, hi]) {
    assert.ok(v, "a scale end label is empty");
    assert.notEqual(v, "undefined");
  }
  assert.equal(`${lo}–${hi}`, dom.el("resRange").textContent);
});

test("each ledger row shows its own method's number, Khamis-Roche first", async () => {
  // The confidence note tells the reader Khamis-Roche is the most accurate of
  // the three, and the headline range is Khamis-Roche's. If the rows and the
  // values come apart, the page attributes a number to a method that did not
  // produce it — and the reader has no way to tell.
  assert.equal(new Set(SPREAD_POINTS).size, 3,
    "precondition: this fixture's three methods must disagree, or row/value mix-ups are invisible");

  const dom = await boot();
  dom.fill(SPREAD_FIELDS);
  dom.submit();

  const parts = dom.el("methods").innerHTML.split('<div class="method');
  assert.equal(parts.length, 4, "expected exactly three method rows");
  assert.ok(parts[1].startsWith(' primary"'), "the first row is not the primary one");
  assert.ok(!parts[2].startsWith(' primary"') && !parts[3].startsWith(' primary"'),
    "more than one row is marked primary");

  // Name and value are asserted together — that pairing is the whole point.
  const m = SPREAD.methods;
  assert.ok(/m-name">Khamis/.test(parts[1]), "the primary row is not the Khamis-Roche row");
  assert.ok(parts[1].includes(m.khamisRoche.point.ftin), "the Khamis-Roche row shows another method's number");
  assert.ok(/m-name">Mid/.test(parts[2]));
  assert.ok(parts[2].includes(m.midparental.point.ftin), "the mid-parental row shows another method's number");
  assert.ok(/m-name">Percentile/.test(parts[3]));
  assert.ok(parts[3].includes(m.percentile.point.ftin), "the percentile row shows another method's number");
  assert.ok(parts[3].includes(`${Math.round(m.percentile.percentile)}th percentile`));
});

test("warnings and the confidence note are rendered without trimming the caveats", async () => {
  // A 16-year-old gets a warning that the range will be tight because they may
  // already be near their adult height. Dropping it would make the estimate
  // read as more informative than it is.
  const teen = { ...IMPERIAL_FIELDS, age: "16", height: "68", weight: "140" };
  const expectedTeen = buildResult({
    sex: "male", units: "imperial", ageYears: 16,
    height: 68, weight: 140, motherHeight: 64, fatherHeight: 70,
  });
  assert.ok(expectedTeen.warnings.length, "precondition: this case should warn");

  const dom = await boot();
  dom.fill(teen);
  dom.submit();
  for (const w of expectedTeen.warnings) {
    assert.ok(dom.el("warnings").innerHTML.includes(w), "a validation warning was not shown");
  }

  // The opening sentence is dropped on purpose — the disclaimer block above it
  // in index.html already says it word for word — and nothing else is.
  const confidence = dom.el("confidence").innerHTML;
  assert.ok(confidence.includes("Reading this estimate"));
  assert.ok(!confidence.includes("This is an estimate, not a measurement"),
    "the confidence note repeats the disclaimer verbatim");
  assert.ok(confidence.includes("9 times out of 10"), "the accuracy sentence was dropped");
  assert.ok(/genes set most of the target/i.test(confidence), "the closing caveat was dropped");
});

// ===========================================================================
// 6. The downloadable card
// ===========================================================================

test("the card shows the same numbers as the page", async () => {
  // The card is the half of this product that travels. A card that disagrees
  // with the screen means one of the two is lying to somebody who is no longer
  // looking at the other.
  const dom = await boot();
  dom.fill(SPREAD_FIELDS);
  dom.submit();

  const drawn = dom.ctx.texts.map((t) => t.text);
  assert.ok(drawn.includes(SPREAD.headline.range.ftin),
    `the card never drew the headline range ${SPREAD.headline.range.ftin}`);
  assert.ok(drawn.includes(SPREAD.headline.point.ftin),
    "the card never drew the most-likely value");
  assert.equal(dom.el("resRange").textContent, SPREAD.headline.range.ftin);
  assert.equal(dom.el("resPoint").textContent, SPREAD.headline.point.ftin);

  // The scale's end labels on the card are the ends of the same range.
  const ends = SPREAD.headline.range.ftin.split("–");
  assert.ok(drawn.includes(ends[0]) && drawn.includes(ends[1]),
    "the card's ruler is not labelled with the range it draws");
});

test("the card's ledger pairs each method's name with its own number", async () => {
  // Asserting only that a number appears somewhere on the card is not enough:
  // the headline already prints the Khamis-Roche value, so a ledger row that
  // silently drew the wrong method's number would still "appear". The rows are
  // therefore matched positionally — the value drawn on the same line as a
  // label is that label's value.
  assert.equal(new Set(SPREAD_POINTS).size, 3, "precondition: the three methods must disagree");

  const dom = await boot();
  dom.fill(SPREAD_FIELDS);
  dom.submit();

  // Row layout: the label is drawn left-aligned at the text margin and the
  // value right-aligned on the same line, so the value is the only text placed
  // to the right of the label within that line's height.
  const valueBesideLabel = (labelPrefix) => {
    const label = dom.ctx.texts.find((t) => t.text.startsWith(labelPrefix));
    assert.ok(label, `the card has no ${labelPrefix} row`);
    const sameLine = dom.ctx.texts.filter((t) => t.x > label.x && Math.abs(t.y - label.y) < 20);
    assert.equal(sameLine.length, 1, `expected one value beside the ${labelPrefix} label`);
    return sameLine[0].text;
  };

  assert.equal(valueBesideLabel("Khamis"), SPREAD.methods.khamisRoche.point.ftin);
  assert.equal(valueBesideLabel("Mid"), SPREAD.methods.midparental.point.ftin);
  assert.equal(valueBesideLabel("Percentile"), SPREAD.methods.percentile.point.ftin);
});

test("the card carries the estimate stamp and the not-medical-advice footer", async () => {
  const dom = await boot();
  dom.fill(IMPERIAL_FIELDS);
  dom.submit();

  // wrapLeft draws a paragraph one line per call, splitting on spaces, so
  // rejoining the calls with a space reconstructs the original sentences.
  const card = dom.ctx.texts.map((t) => t.text).join(" ");
  assert.ok(card.includes("ESTIMATE"), "the card lost its ESTIMATE stamp");
  assert.ok(card.includes("NOT A MEASUREMENT"), "the card lost the 'not a measurement' line");
  assert.ok(/not a measurement, and not medical advice/i.test(card),
    "the card's honest footer is missing");
});

test("the card's serial says when, and nothing about who", async () => {
  // The comment above it is the specification: "It is the moment it was drawn
  // — nothing about the visitor." A strict shape is the assertion, because a
  // shape cannot quietly grow a height or an age inside it.
  const dom = await boot();
  dom.fill(IMPERIAL_FIELDS);
  dom.submit();

  const serial = dom.el("posterSerial").textContent;
  assert.match(serial, /^Card no\. \d{6}-\d{4} · drawn on this device$/,
    `the card serial is no longer a bare timestamp: ${serial}`);
  const digits = serial.replace(/\D/g, "");
  assert.equal(digits.length, 10, "the serial carries digits beyond its timestamp");
});

test("downloading writes a local PNG under a name that describes nobody", async () => {
  const dom = await boot();
  dom.fill(IMPERIAL_FIELDS);
  dom.submit();
  const r = dom.download();

  assert.equal(r.error, null);
  assert.equal(dom.anchors.length, 1);
  assert.equal(dom.anchors[0].download, "heightcast-estimate.png",
    "the download filename is no longer anonymous");
  assert.ok(dom.anchors[0].href.startsWith("data:image/png"),
    "the card is no longer exported straight from the canvas");
  assert.equal(dom.anchors[0].clicks, 1);
  assert.deepEqual(dom.canvas.dataUrls, ["image/png"]);
});

// ===========================================================================
// 7. Missing browser dependencies
// ===========================================================================

test("a browser without document.fonts still gets its result", async () => {
  // FontFaceSet is absent in older Safari and when a privacy setting disables
  // web fonts. The font watcher runs inside renderResult, before the result
  // section is revealed, so an unguarded read there hides the whole answer.
  const dom = await boot();                 // this stub has no document.fonts
  assert.equal("fonts" in dom.document, false, "precondition: no FontFaceSet");
  dom.fill(IMPERIAL_FIELDS);
  const r = dom.submit();
  assert.equal(r.error, null, "a missing document.fonts broke the render");
  assert.equal(dom.el("result").hidden, false);
  assert.equal(dom.el("resRange").textContent, EXPECTED.headline.range.ftin);
});

test("a display face that lands late redraws the card once", async () => {
  const dom = await boot({ fonts: { ready: Promise.resolve() } });
  dom.fill(IMPERIAL_FIELDS);
  dom.submit();
  const afterFirstDraw = dom.ctx.ops;
  const textsFirst = dom.ctx.texts.length;

  await settle();
  assert.ok(dom.ctx.ops > afterFirstDraw, "the card was never redrawn once the font landed");
  // and the redraw draws the same result, not a blank or a stale one
  const redrawn = dom.ctx.texts.slice(textsFirst).map((t) => t.text);
  assert.ok(redrawn.includes(EXPECTED.headline.range.ftin), "the redraw lost the headline range");
});
