/**
 * Contract tests for js/range.js — the assembler behind the headline number.
 *
 * range.js is the last module between a visitor's form input and the number a
 * parent actually reads off the page. app.js calls `buildResult(input)` with no
 * try/catch, branches once on `res.ok`, and then indexes straight into
 * `res.headline`, `res.methods.*`, `res.confidence` and `res.warnings`. So every
 * guarantee below is load-bearing for the rendered page, not for this module's
 * own tidiness.
 *
 * The existing test/range.test.js pins the happy path: one worked example, the
 * ordering invariant on that one example, and `typeof spreadCm === "number"`.
 * That last kind of assertion is exactly the trap this file exists to avoid — a
 * spread computed over two of the three methods is still a number, so the check
 * passes against broken code. Every assertion here was chosen by asking "what
 * ELSE would make this pass?", and every guard was verified by deleting it and
 * watching these tests go red.
 *
 * range.js is pure, so unlike the Daykit storefront picker there is no DOM to
 * stub — the "environment" that has to be faked is simply the set of hostile
 * inputs a form can produce.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { buildResult, fmtRange, fmtPoint } from "../js/range.js";
import { BOUNDS } from "../js/validate.js";
import { KR_COEFFS } from "../js/khamis-roche.js";
import { inToCm } from "../js/convert.js";

// app.js does `pick(res.headline.range).split("–")` to label the scale bar.
// That is an EN DASH (U+2013), not a hyphen. Spelling it as an escape here means
// the test cannot silently agree with a source file that changed the character.
const EN_DASH = "–";

const close = (a, b, eps = 1e-9, label = "") =>
  assert.ok(Math.abs(a - b) <= eps, `${label ? label + ": " : ""}${a} !~= ${b}`);

// A realistic, internally-consistent child. Individual tests override fields.
const BASE = {
  sex: "male", ageYears: 10, units: "metric",
  height: 138, weight: 34, motherHeight: 163, fatherHeight: 178,
};

// Fixtures chosen so that ACROSS the set, each of the three methods is the
// extreme value at least once. That is what makes the spread test below able to
// detect any one method being dropped from the agreement calculation — a set
// where the percentile method is never the min or max would happily pass with
// that method deleted.
const FIXTURES = {
  "agreeing 10yo boy":       { ...BASE },
  "13yo girl, methods close":{ sex: "female", ageYears: 13, units: "metric", height: 157, weight: 47, motherHeight: 165, fatherHeight: 178 },
  "16yo boy near-final":     { ...BASE, ageYears: 16, height: 175, weight: 65 },
  "short parents, tall boy": { ...BASE, height: 150, weight: 40, motherHeight: 150, fatherHeight: 160 },
  "tall parents, short boy": { ...BASE, height: 120, weight: 24, motherHeight: 180, fatherHeight: 195 },
  "6yo girl, tall parents":  { sex: "female", ageYears: 6, units: "metric", height: 110, weight: 19, motherHeight: 178, fatherHeight: 192 },
};

// Every (age, sex, body) combination the validator accepts. The age bounds are
// READ FROM validate.js rather than hardcoded, so if someone widens the accepted
// age window past what the Khamis-Roche coefficient table can index, this sweep
// automatically starts covering the new ages and catches it.
function* acceptedDomain() {
  for (let age = BOUNDS.age.min; age <= BOUNDS.age.max + 1e-9; age += 0.25) {
    for (const sex of ["male", "female"]) {
      for (const [height, weight] of [[100, 16], [138, 34], [175, 70]]) {
        yield { ...BASE, sex, ageYears: Math.round(age * 100) / 100, height, weight };
      }
    }
  }
}

// Pull every user-visible string out of a result, so a test can assert that no
// arithmetic accident ever reaches the page as text.
function displayStrings(res) {
  const out = [res.headline.point.cm, res.headline.point.ftin, res.headline.range.cm, res.headline.range.ftin, res.confidence];
  for (const m of Object.values(res.methods)) {
    out.push(m.point.cm, m.point.ftin, m.range.cm, m.range.ftin);
  }
  return out;
}

// ---------------------------------------------------------------------------
// 1. The validator gate. Highest blast radius in the file.
// ---------------------------------------------------------------------------

// app.js has no try/catch around buildResult. Every downstream method THROWS on
// bad input (predictKhamisRoche and predictMidparental on a bad sex, lookupLMS
// on a bad sex, predictKhamisRoche on an unindexable age), so the early
// `if (!v.ok) return` is the only thing keeping a typo from killing the submit
// handler — which would leave the form looking simply dead, with no error shown.
test("hostile input returns ok:false instead of throwing", () => {
  const hostile = {
    "empty object": {},
    "no argument at all": undefined,
    "a string": "hello",
    "an array": [],
    "unknown sex": { ...BASE, sex: "unspecified" },
    "sex as a prototype key": { ...BASE, sex: "constructor" },
    "NaN age": { ...BASE, ageYears: NaN },
    "age below the model": { ...BASE, ageYears: 2 },
    "age above the model": { ...BASE, ageYears: 40 },
    "negative height": { ...BASE, height: -138 },
    "absurd height": { ...BASE, height: 9999 },
    "numbers as strings": { ...BASE, height: "138", weight: "34" },
    "everything missing": { units: "metric" },
  };

  for (const [label, input] of Object.entries(hostile)) {
    let res;
    assert.doesNotThrow(() => { res = buildResult(input); }, `buildResult threw on ${label}`);
    assert.equal(res.ok, false, `${label} should be rejected`);

    // Not just "ok is false": the rejection must carry an actionable error map,
    // because app.js writes res.errors straight into the field-level error slots.
    assert.ok(Object.keys(res.errors).length > 0, `${label} produced no errors`);
    for (const [field, msg] of Object.entries(res.errors)) {
      assert.equal(typeof msg, "string", `${label}.${field} error is not a string`);
      assert.ok(msg.length > 0, `${label}.${field} error is empty`);
    }

    // And the rejection must be a SHORT-CIRCUIT, not a "compute it anyway and
    // flag it" — if these existed, a future refactor of app.js could render a
    // headline built from input the validator already refused.
    assert.equal(res.headline, undefined, `${label} leaked a headline`);
    assert.equal(res.methods, undefined, `${label} leaked method results`);
    assert.equal(res.confidence, undefined, `${label} leaked a confidence note`);
  }
});

// ---------------------------------------------------------------------------
// 2. The band the page draws.
// ---------------------------------------------------------------------------

// app.js turns the headline band into the scale bar with
//   pad = (hi - lo) * 0.5; pctOf(v) = ((v - min) / (max - min)) * 100
// so a zero-width band divides by zero, yields "NaN%" for the CSS `left` and
// `width`, and the bar silently collapses. A reversed band draws a negative
// width. Strict ordering across the WHOLE accepted domain is therefore a
// rendering guarantee, not a maths nicety.
test("every age the validator accepts yields a strictly ordered, finite headline band", () => {
  let checked = 0;
  for (const input of acceptedDomain()) {
    const res = buildResult(input);
    const where = `${input.sex} age ${input.ageYears} h${input.height} w${input.weight}`;
    assert.equal(res.ok, true, `validator rejected ${where} — sweep assumes the whole domain is accepted`);

    const { lowCm, pointCm, highCm } = res.headline;
    for (const [name, v] of [["lowCm", lowCm], ["pointCm", pointCm], ["highCm", highCm], ["spreadCm", res.spreadCm]]) {
      assert.ok(Number.isFinite(v), `${where}: ${name} is ${v}`);
    }
    // Strict, not <=: equality is the zero-width case that breaks the scale bar.
    assert.ok(lowCm < pointCm, `${where}: low ${lowCm} not below point ${pointCm}`);
    assert.ok(pointCm < highCm, `${where}: point ${pointCm} not below high ${highCm}`);
    checked++;
  }
  // Guards the sweep itself: a generator that silently yields nothing would make
  // every assertion above vacuous.
  assert.ok(checked >= 300, `sweep only covered ${checked} cases`);
});

// The page says "Nine times in ten, a boy of 10 with these measurements finishes
// between …" directly above this band, and the confidence note repeats the ±X cm
// figure. If the headline were ever built from the 50% band, both sentences
// would become false while the page still looked perfectly normal. This is the
// honesty guard, and it is invisible to any test that only checks ordering.
test("the headline band is the 90% band that the page's copy promises", () => {
  for (const [name, input] of Object.entries(FIXTURES)) {
    const res = buildResult(input);
    const err90Cm = inToCm(KR_COEFFS[input.sex].error90);

    // The band is symmetric about the point estimate and exactly ±error90.
    close(res.headline.pointCm - res.headline.lowCm, err90Cm, 1e-9, name);
    close(res.headline.highCm - res.headline.pointCm, err90Cm, 1e-9, name);
    // Pinned to the published coefficient table, not to range.js's own output,
    // so this fails if the headline silently switches to the narrower 50% band.
    close(res.methods.khamisRoche.error90Cm, err90Cm, 1e-9, name);

    // The prose must quote the same figure the band actually spans.
    const quoted = res.confidence.match(/±([\d.]+)\s*cm/);
    assert.ok(quoted, `${name}: confidence note quotes no ± cm figure`);
    assert.equal(quoted[1], err90Cm.toFixed(1), `${name}: prose says ±${quoted[1]} cm but the band is ±${err90Cm.toFixed(1)} cm`);
  }
});

// ---------------------------------------------------------------------------
// 3. Agreement — the "honest range" claim itself.
// ---------------------------------------------------------------------------

// The existing suite asserts `typeof res.spreadCm === "number"`. Deleting the
// percentile method from the agreement calculation leaves it a number, so that
// assertion cannot fail. This one recomputes the spread independently from the
// three published point estimates the module itself reports.
test("spreadCm is the true max-minus-min across all THREE methods", () => {
  for (const [name, input] of Object.entries(FIXTURES)) {
    const res = buildResult(input);
    const points = [
      res.methods.khamisRoche.pointCm,
      res.methods.midparental.pointCm,
      res.methods.percentile.pointCm,
    ];
    for (const p of points) assert.ok(Number.isFinite(p), `${name}: a method point estimate is ${p}`);

    const expected = Math.max(...points) - Math.min(...points);
    close(res.spreadCm, expected, 1e-12, name);

    // Belt and braces: prove the reported spread genuinely spans every method,
    // i.e. no method sits outside the interval the spread claims to cover.
    const lo = Math.min(...points);
    for (const p of points) {
      assert.ok(p - lo <= res.spreadCm + 1e-9, `${name}: method at ${p} lies outside the reported spread`);
    }
  }
});

// `agree` decides which of two sentences the visitor reads: a reassuring one, or
// a warning to lean on the wider range. If the flag and the prose ever drift
// apart, the page reassures someone whose methods disagree by 38 cm. Asserting
// the flag alone would not catch that; asserting the prose alone would not catch
// the flag; so this pins both together AND pins the number inside the sentence.
test("agree matches the 5 cm threshold and the confidence prose matches agree", () => {
  const seen = { agreeing: 0, disagreeing: 0 };

  for (const [name, input] of Object.entries(FIXTURES)) {
    const res = buildResult(input);
    assert.equal(res.agree, res.spreadCm <= 5, `${name}: agree=${res.agree} for a spread of ${res.spreadCm}`);

    const figure = res.spreadCm.toFixed(1);
    if (res.agree) {
      seen.agreeing++;
      assert.match(res.confidence, new RegExp(`land within ${figure.replace(".", "\\.")} cm of each other`), `${name}: agreeing prose missing or quotes the wrong figure`);
      assert.doesNotMatch(res.confidence, /spread out by/, `${name}: agreeing result also carries the disagreement warning`);
    } else {
      seen.disagreeing++;
      assert.match(res.confidence, new RegExp(`spread out by ${figure.replace(".", "\\.")} cm`), `${name}: disagreement warning missing or quotes the wrong figure`);
      assert.doesNotMatch(res.confidence, /good sign/, `${name}: disagreeing result still reassures the reader`);
    }
  }

  // Without this, a mutation that forced every result down one branch could pass
  // by making the other branch simply never execute.
  assert.ok(seen.agreeing > 0, "no agreeing fixture exercised the reassuring branch");
  assert.ok(seen.disagreeing > 0, "no disagreeing fixture exercised the warning branch");
});

// ---------------------------------------------------------------------------
// 4. Unit handling — normalize() is where a wrong constant silently shifts the
//    headline number by inches.
// ---------------------------------------------------------------------------

// The same child, described in metric and in imperial, must produce the same
// prediction. This is the only test that can catch a broken conversion inside
// normalize(): the imperial path and the metric path share every downstream
// formula, so a bad constant moves one and not the other.
test("metric and imperial descriptions of the same child produce identical results", () => {
  const imperial = { sex: "male", ageYears: 10, units: "imperial", height: 54.5, weight: 76, motherHeight: 64, fatherHeight: 70 };
  const metric = {
    sex: "male", ageYears: 10, units: "metric",
    height: 54.5 * 2.54, weight: 76 * 0.45359237,
    motherHeight: 64 * 2.54, fatherHeight: 70 * 2.54,
  };

  const a = buildResult(imperial);
  const b = buildResult(metric);
  assert.equal(a.ok, true);
  assert.equal(b.ok, true);

  for (const key of ["pointCm", "lowCm", "highCm"]) {
    close(a.headline[key], b.headline[key], 1e-9, `headline.${key}`);
  }
  close(a.spreadCm, b.spreadCm, 1e-9, "spreadCm");
  for (const method of ["khamisRoche", "midparental", "percentile"]) {
    close(a.methods[method].pointCm, b.methods[method].pointCm, 1e-9, method);
  }
  // The rendered cm strings must be literally identical, since that is what a
  // visitor toggling units mid-session would compare.
  assert.equal(a.headline.range.cm, b.headline.range.cm);
  assert.equal(a.headline.point.cm, b.headline.point.cm);
});

// ---------------------------------------------------------------------------
// 5. What actually reaches the DOM.
// ---------------------------------------------------------------------------

// app.js writes these strings into the page with textContent/innerHTML and never
// inspects them. "NaN cm" or "undefined" would be rendered verbatim to a parent.
// fmtPoint calls cm.toFixed(1) and fmtRange calls Math.round(), so a non-finite
// value upstream turns into text rather than an exception — it fails silently,
// which is the dangerous kind.
test("no display string ever contains NaN, Infinity or undefined", () => {
  let checked = 0;
  for (const input of acceptedDomain()) {
    const res = buildResult(input);
    for (const s of displayStrings(res)) {
      assert.equal(typeof s, "string", `${input.sex} age ${input.ageYears}: display value is ${typeof s}`);
      assert.doesNotMatch(s, /NaN|Infinity|undefined|null/, `${input.sex} age ${input.ageYears} h${input.height}: rendered "${s}"`);
    }
    checked++;
  }
  assert.ok(checked >= 300, `sweep only covered ${checked} cases`);
});

// app.js labels the ends of the scale bar with
//   pick(res.headline.range).split("–")[0]  and  [1]
// If that separator is ever written as an ASCII hyphen, or the format grows a
// second dash, `[1]` becomes undefined and the page prints "undefined" under the
// scale. Nothing in range.js's own behaviour would look wrong.
test("range strings use the single en dash that app.js splits on", () => {
  for (const [name, input] of Object.entries(FIXTURES)) {
    const res = buildResult(input);
    const ranges = [
      ["headline.cm", res.headline.range.cm], ["headline.ftin", res.headline.range.ftin],
      ...Object.entries(res.methods).flatMap(([m, o]) => [[`${m}.cm`, o.range.cm], [`${m}.ftin`, o.range.ftin]]),
    ];
    for (const [label, str] of ranges) {
      const parts = str.split(EN_DASH);
      assert.equal(parts.length, 2, `${name} ${label}: "${str}" does not split into exactly two parts on U+2013`);
      assert.ok(parts[0].trim().length > 0, `${name} ${label}: empty low label`);
      assert.ok(parts[1].trim().length > 0, `${name} ${label}: empty high label`);
    }
  }

  // Pin the exported formatter directly too, since it is part of the module's
  // public surface and app.js's split contract lives or dies on this character.
  const r = fmtRange(170, 180);
  assert.equal(r.cm, `170${EN_DASH}180 cm`);
  assert.ok(r.ftin.includes(EN_DASH), `fmtRange ftin "${r.ftin}" lost the en dash`);
  assert.ok(!r.cm.includes("-"), "fmtRange emitted an ASCII hyphen");
});

// Every method row in the page is rendered as `pick(r.o.point)` and
// `pick(r.o.range)`. A method that returned numbers but no display object would
// render "undefined" in the row rather than failing loudly.
test("all three method rows carry point and range strings in both unit systems", () => {
  const res = buildResult(BASE);
  for (const method of ["khamisRoche", "midparental", "percentile"]) {
    const m = res.methods[method];
    assert.equal(m.available, true, `${method} reported unavailable`);
    for (const [shape, o] of [["point", m.point], ["range", m.range]]) {
      assert.equal(typeof o, "object", `${method}.${shape} missing`);
      for (const unit of ["cm", "ftin"]) {
        assert.equal(typeof o[unit], "string", `${method}.${shape}.${unit} is not a string`);
        assert.ok(o[unit].length > 0, `${method}.${shape}.${unit} is empty`);
      }
    }
    assert.ok(Number.isFinite(m.pointCm), `${method}.pointCm is ${m.pointCm}`);
  }
  // app.js prints `~${Math.round(m.percentile.percentile)}th percentile now`.
  assert.ok(Number.isFinite(res.methods.percentile.percentile), "percentile is not finite");
});

// ---------------------------------------------------------------------------
// 6. Caller-visible side effects and pass-through.
// ---------------------------------------------------------------------------

// app.js keeps the raw `input` object in `lastResult` and re-reads `input.units`
// in drawPoster() when the display font finishes loading. If buildResult
// normalised in place, that second draw could pick a different unit system than
// the first — a poster that changes under the visitor a beat after it appears.
//
// The guard is the copy in validate.js (`value: { ...input, units }`); normalize()
// only ever sees that copy. Fixtures whose `units` already equals the normalised
// value CANNOT detect the copy being removed — assigning "metric" over "metric"
// is invisible. So the cases that matter are the ones where normalisation
// actually changes something: a missing `units`, and a mis-cased one. Both
// coerce to "metric", so an in-place normalisation would show up as a new or
// rewritten key on the caller's object.
test("buildResult does not mutate the caller's input object", () => {
  const noUnits = { sex: "male", ageYears: 10, height: 138, weight: 34, motherHeight: 163, fatherHeight: 178 };
  const oddCase = { ...BASE, units: "IMPERIAL" };

  const cases = [
    ["metric", { ...BASE }],
    ["imperial", { ...BASE, units: "imperial", height: 54.5, weight: 76, motherHeight: 64, fatherHeight: 70 }],
    ["units omitted", noUnits],
    ["units mis-cased", oddCase],
  ];

  for (const [label, input] of cases) {
    const before = structuredClone(input);
    const res = buildResult(input);
    assert.equal(res.ok, true, `${label}: fixture should be accepted`);
    assert.deepEqual(input, before, `${label}: buildResult modified the object it was given`);
  }

  // The sharpest form of the same check: a raw input with no `units` key must
  // still have no `units` key afterwards. deepEqual above already covers this,
  // but stating it explicitly documents what the copy is protecting.
  assert.equal("units" in noUnits, false, "buildResult wrote a normalised units key onto the caller's object");
  assert.equal(oddCase.units, "IMPERIAL", "buildResult overwrote the caller's units value");
});

// The age-16 warning ("you may already be close to your adult height") is an
// honesty caveat, and app.js renders `res.warnings` with no fallback of its own
// beyond `|| []` — so dropping the pass-through makes the caveat vanish silently
// while every number on the page stays correct.
test("validator warnings reach the caller on both the ok and the not-ok path", () => {
  const accepted = buildResult({ ...BASE, ageYears: 16, height: 175, weight: 65 });
  assert.equal(accepted.ok, true);
  assert.ok(Array.isArray(accepted.warnings), "warnings missing from the ok result");
  assert.equal(accepted.warnings.length, 1, "the age-16 near-final caveat was not passed through");
  assert.match(accepted.warnings[0], /adult height/i);

  // Same age, but with a field the validator refuses: the caveat must survive the
  // rejection too, since app.js can render warnings alongside field errors.
  const rejected = buildResult({ ...BASE, ageYears: 16, height: 9999 });
  assert.equal(rejected.ok, false);
  assert.ok(Array.isArray(rejected.warnings), "warnings missing from the rejected result");
  assert.equal(rejected.warnings.length, 1, "the age-16 caveat was dropped on the rejection path");

  // A younger child must NOT collect the near-final caveat — otherwise the test
  // above would pass against code that hardcoded a warning for everyone.
  const young = buildResult({ ...BASE, ageYears: 10 });
  assert.deepEqual(young.warnings, [], "a 10-year-old should carry no near-final warning");
});

// ---------------------------------------------------------------------------
// 7. The exported formatters, used directly by the tests above and available to
//    any future caller.
// ---------------------------------------------------------------------------

test("fmtPoint and fmtRange round as documented", () => {
  // fmtPoint keeps one decimal in cm and half-inch precision in ft/in — it is
  // the single "most likely" figure, so the extra precision is honest there.
  assert.equal(fmtPoint(176.8).cm, "176.8 cm");
  assert.equal(fmtPoint(171.45).ftin, `5'7½"`, "fmtPoint should keep half-inch precision");

  // fmtRange rounds to WHOLE units on both ends. The two endpoints below are
  // exactly 67.5 in and 71.5 in, i.e. sitting precisely on a half-inch — the only
  // values that can tell `half: false` apart from `half: true`. Picking round-ish
  // cm numbers here would make the assertion below vacuous.
  const r = fmtRange(171.45, 181.61);
  assert.equal(r.cm, `171${EN_DASH}182 cm`);
  assert.equal(r.ftin, `5'8"${EN_DASH}6'0"`, "fmtRange must round the band to whole inches");
  assert.doesNotMatch(r.ftin, /½/, "fmtRange must not emit half inches");
});
