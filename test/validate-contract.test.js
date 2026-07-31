/**
 * Contract tests for js/validate.js — the only gate between a browser text
 * field and a number a teenager is told about their own body.
 *
 * validate.js is the sole guard in front of three prediction modules that do
 * unguarded arithmetic and unguarded object indexing:
 *
 *   app.js:71   const res = buildResult(input);        // no try/catch
 *   range.js:44 const v = validateInputs(rawInput);
 *               if (!v.ok) return ...;                 // <- the whole defence
 *               normalize(v.value);                    // straight to the math
 *
 * There is no try/catch anywhere on that path. A throw out of buildResult kills
 * the submit handler: no result, no error message, a dead button. A NaN that
 * slips through is worse — it renders as a confident "NaN cm" prediction.
 *
 * validate.js's header states the specification these tests hold it to:
 *   "Absurd values are rejected with friendly, teen-readable messages rather
 *    than silently producing nonsense."
 *
 * WHY THESE ASSERTIONS ARE SHAPED THE WAY THEY ARE
 * A bare `assert.equal(r.ok, false)` is close to worthless here: it also passes
 * when a completely different field errored, when the fixture itself is broken,
 * and when the validator has been replaced by `return { ok: false }`. So every
 * rejection below asserts the *exact set* of error keys, and every acceptance
 * is paired with a neighbouring value that must still be rejected — a gutted
 * validator fails the pair even though it passes either half alone.
 *
 * node:test + node:assert/strict, zero dependencies, matching the rest of test/.
 */

import test from "node:test";
import assert from "node:assert/strict";

import { validateInputs, BOUNDS } from "../js/validate.js";
import { buildResult } from "../js/range.js";
import { KR_MIN_AGE, KR_MAX_AGE } from "../js/khamis-roche.js";

// A plausible 10-year-old boy, metric. Every field here is comfortably inside
// its window, so any error that appears in a test below was caused by the one
// field that test changed — which is what lets `rejects()` assert exact keys.
const GOOD_METRIC = {
  sex: "male", ageYears: 10, units: "metric",
  height: 138, weight: 34, motherHeight: 163, fatherHeight: 178,
};

// The same idea in imperial: a 16-year-old boy, 5'10", 170 lb, average parents.
const GOOD_IMPERIAL = {
  sex: "male", ageYears: 16, units: "imperial",
  height: 70, weight: 170, motherHeight: 64, fatherHeight: 70,
};

const MEASUREMENTS = ["height", "weight", "motherHeight", "fatherHeight"];

/** Sorted error keys — the set of fields the form will actually light up. */
const errorKeys = (r) => Object.keys(r.errors).sort();

/**
 * Assert an input is rejected AND that it is rejected for exactly the expected
 * reasons. The exact-set assertion is the load-bearing half: it fails both when
 * a guard disappears (field missing) and when a guard becomes over-eager
 * (extra field), and it cannot be satisfied by an unrelated broken fixture.
 */
function rejects(input, fields, message) {
  const r = validateInputs(input);
  assert.equal(r.ok, false, `${message}: expected rejection, got ok:true`);
  assert.deepEqual(errorKeys(r), [...fields].sort(), `${message}: wrong error fields`);
  // range.js only ever reads `value` after checking `ok`, but a non-null value
  // on a rejected input means the two halves of the return disagree about
  // whether the input is usable, and the next refactor gets to pick the wrong
  // one. They must not be able to drift apart.
  assert.equal(r.value, null, `${message}: rejected input still produced a value`);
  // Every message is read by a teenager on the page; an empty string paints a
  // blank error slot, which looks like the form silently ignored them.
  for (const f of fields) {
    assert.equal(typeof r.errors[f], "string", `${message}: ${f} message is not a string`);
    assert.ok(r.errors[f].length > 0, `${message}: ${f} message is empty`);
  }
  return r;
}

/**
 * Assert an input is accepted AND that what comes back is actually usable by
 * range.js — not merely `ok:true`. `normalize(v.value)` reads six fields off
 * `value` with no checks; a `value` missing one of them produces NaN all the
 * way to the rendered card without a single error being thrown.
 */
function accepts(input, message) {
  const r = validateInputs(input);
  assert.equal(r.ok, true, `${message}: expected acceptance, errors=${JSON.stringify(r.errors)}`);
  assert.deepEqual(r.errors, {}, `${message}: ok:true with errors present`);
  assert.notEqual(r.value, null, `${message}: ok:true with a null value`);
  assert.equal(r.value.sex, input.sex, `${message}: value.sex not carried through`);
  assert.equal(r.value.ageYears, input.ageYears, `${message}: value.ageYears not carried through`);
  for (const f of MEASUREMENTS) {
    assert.equal(r.value[f], input[f], `${message}: value.${f} not carried through`);
  }
  return r;
}

// ---------------------------------------------------------------------------
// 1. THE BOUNDARY WITH THE PREDICTION ENGINE — breaks-page
//    Everything validate accepts is executed, unguarded, by three modules that
//    throw. These are the tests that matter most.
// ---------------------------------------------------------------------------

test("the accepted age window sits inside the Khamis-Roche coefficient table", () => {
  // khamis-roche.js has one coefficient row per half-year from 4.0 to 17.5 and
  // THROWS for anything outside that (`Khamis-Roche supports ages ...`). Nobody
  // on the path from the submit button to that throw catches it. BOUNDS.age is
  // therefore not a matter of taste — it is a subset constraint, and widening
  // it to be friendlier to younger children is how the submit button dies.
  assert.ok(
    BOUNDS.age.min >= KR_MIN_AGE,
    `BOUNDS.age.min ${BOUNDS.age.min} is below KR_MIN_AGE ${KR_MIN_AGE}; predictKhamisRoche will throw`,
  );
  assert.ok(
    BOUNDS.age.max <= KR_MAX_AGE,
    `BOUNDS.age.max ${BOUNDS.age.max} is above KR_MAX_AGE ${KR_MAX_AGE}; predictKhamisRoche caps and returns a zero-width range`,
  );
});

test("every input validate accepts produces a real, ordered range — never a throw, never NaN", () => {
  // The end-to-end form of the test above, and the one that catches the failure
  // the constant-comparison cannot: an age that is inside 4..17.5 numerically
  // but ROUNDS out of it. predictKhamisRoche rounds to the nearest half-year
  // before indexing, so 17.75 rounds to 18.0, takes the `capped` branch, and
  // returns low90In === pointIn === high90In. That is not a throw and not a NaN
  // — it is an "honest range" of zero width, silently presented as a
  // prediction. Only the ordering assertion notices.
  //
  // The sweep walks the accepted age window in 0.05y steps (fine enough to land
  // on both sides of every half-year rounding boundary) against the corners of
  // every other bound, because the corners are where the arithmetic breaks.
  const H = [BOUNDS.child.min, 150, BOUNDS.child.max];
  const W = [BOUNDS.weight.min, 60, BOUNDS.weight.max];
  const P = [BOUNDS.parent.min, BOUNDS.parent.max];

  let checked = 0;
  for (const sex of ["male", "female"]) {
    for (let a = BOUNDS.age.min; a <= BOUNDS.age.max + 1e-9; a += 0.05) {
      const ageYears = Math.round(a * 100) / 100;
      for (const height of H) for (const weight of W) for (const motherHeight of P) for (const fatherHeight of P) {
        const input = { sex, ageYears, units: "metric", height, weight, motherHeight, fatherHeight };
        if (!validateInputs(input).ok) continue; // only what the gate lets through
        checked += 1;
        const where = `${sex} age ${ageYears} h${height} w${weight} m${motherHeight} f${fatherHeight}`;

        let res;
        try {
          res = buildResult(input);
        } catch (err) {
          // app.js has no try/catch here, so in the browser this is a dead
          // submit button with nothing rendered and nothing explained.
          assert.fail(`${where}: validate accepted an input that made buildResult throw — ${err.message}`);
        }

        assert.equal(res.ok, true, `${where}: buildResult disagreed with validate`);
        for (const key of ["pointCm", "lowCm", "highCm"]) {
          assert.ok(
            Number.isFinite(res.headline[key]),
            `${where}: headline.${key} is ${res.headline[key]} — this renders on the card`,
          );
        }
        assert.ok(Number.isFinite(res.spreadCm), `${where}: spreadCm is ${res.spreadCm}`);
        assert.ok(
          res.headline.lowCm < res.headline.pointCm && res.headline.pointCm < res.headline.highCm,
          `${where}: range does not bracket the estimate (${res.headline.lowCm} / ${res.headline.pointCm} / ${res.headline.highCm})`,
        );
      }
    }
  }
  // Guards the sweep itself: if a future bounds change made the loop body
  // unreachable, every assertion above would vacuously "pass".
  assert.ok(checked > 5000, `sweep only exercised ${checked} inputs — it stopped covering the window`);
});

test("sex is matched by exact string identity — downstream indexes objects unguarded", () => {
  // predictKhamisRoche does `KR_COEFFS[sex]` and lookupLMS does
  // `CDC_STATURE_LMS[sex]`, each with an `if (!table) throw` guard. That guard
  // is defeated by any inherited key: KR_COEFFS["constructor"] is truthy, so
  // the throw is skipped and the code walks straight into a TypeError one line
  // later. Both spellings end the same way — an uncaught exception out of the
  // submit handler — so validate's `!== "male" && !== "female"` is the only
  // thing on the path that is actually strict.
  const hostile = [
    "Male", "MALE", "Female", "female ", " male",   // casing / whitespace slips
    "other", "M", "boy", "",                        // plausible <select> values
    "constructor", "toString", "__proto__", "valueOf", // inherited keys
    undefined, null, 0, 1, true, ["male"], { sex: "male" },
  ];
  for (const sex of hostile) {
    rejects({ ...GOOD_METRIC, sex }, ["sex"], `sex ${JSON.stringify(sex) ?? String(sex)}`);
  }

  // The paired half: the two legal spellings must still get through, or the
  // test above would be satisfied by a validator that rejects everything.
  accepts({ ...GOOD_METRIC, sex: "male" }, "sex male");
  accepts({ ...GOOD_METRIC, sex: "female" }, "sex female");
});

test("a blank field arrives as NaN and every field rejects it independently", () => {
  // app.js:76 — `numOrNaN` returns NaN for any field that is empty or
  // unparseable, so NaN is not a hypothetical: it is the exact runtime value of
  // "the visitor left this box alone". NaN fails every `<` and `>` comparison
  // silently, so the bounds checks below it are no defence at all — only the
  // isNum guard on each field stands between a blank box and a rendered
  // prediction built from NaN.
  //
  // Each field is asserted separately (rather than all-NaN at once) so that a
  // guard removed from one field cannot hide behind another field's error.
  for (const field of ["ageYears", ...MEASUREMENTS]) {
    rejects({ ...GOOD_METRIC, [field]: NaN }, [field], `${field}: NaN`);
  }

  // Infinity is caught by the bounds rather than by isNum, but it must still
  // never reach the regression — assert the outcome, not the mechanism.
  for (const field of ["ageYears", ...MEASUREMENTS]) {
    rejects({ ...GOOD_METRIC, [field]: Infinity }, [field], `${field}: Infinity`);
    rejects({ ...GOOD_METRIC, [field]: -Infinity }, [field], `${field}: -Infinity`);
  }

  // Non-numbers. `numOrNaN` means these cannot occur through the form today,
  // but validate.js is a pure exported function and the numeric-string case is
  // exactly what a future caller that forgets Number() would hand it.
  for (const field of ["ageYears", ...MEASUREMENTS]) {
    for (const bad of ["", "138", "tall", null, undefined, true, [], {}]) {
      rejects({ ...GOOD_METRIC, [field]: bad }, [field], `${field}: ${JSON.stringify(bad) ?? String(bad)}`);
    }
  }
});

test("an accepted input hands range.js every field it is about to read", () => {
  // range.js normalize() reads sex, ageYears, height, motherHeight,
  // fatherHeight and weight off `value` with no checks of its own. A `value`
  // that drops one of them does not throw and does not warn — it multiplies
  // undefined into the regression and prints NaN on the card. `accepts()`
  // checks all six; this test pins the units field and the copy semantics.
  const r = accepts(GOOD_METRIC, "complete value");
  assert.equal(r.value.units, "metric");

  const imp = accepts(GOOD_IMPERIAL, "complete value (imperial)");
  assert.equal(imp.value.units, "imperial");

  // `units` is normalized to one of exactly two literals whatever arrives, so
  // the string validate checked the bounds in is the same string range.js
  // branches on. These two must never be able to disagree about which unit
  // system a number is in.
  for (const units of ["IMPERIAL", "Imperial", "imperial ", "us", undefined, null, 42]) {
    const out = validateInputs({ ...GOOD_METRIC, units });
    assert.equal(out.value?.units, "metric", `units ${String(units)} did not fall back to metric`);
  }
  assert.equal(validateInputs({ ...GOOD_METRIC, units: "imperial ", height: 54, weight: 76, motherHeight: 64, fatherHeight: 70 }).ok, false,
    "a near-miss units string was validated as imperial");
});

// ---------------------------------------------------------------------------
// 2. THE BOUNDS ARE APPLIED IN THE RIGHT UNIT, AGAINST THE RIGHT TABLE
//    Both of these are silent when wrong: the visitor either gets a nonsense
//    prediction or gets locked out of a product that should serve them.
// ---------------------------------------------------------------------------

test("imperial weight is converted to kg before the bounds are applied", () => {
  // BOUNDS.weight is 8..200 KILOGRAMS. Read against raw pounds that window
  // means 8..200 lb, which is both too tight at the top and far too loose at
  // the bottom — and the existing suite's imperial fixture (92 lb) sits inside
  // the window either way, so it proves nothing about the conversion.
  //
  // Top end: a 250 lb 16-year-old is an ordinary American teenager. 250 lb is
  // 113 kg, comfortably legal — but 250 read as kg is out of range, so a
  // missing conversion locks a real user out of the product with "that weight
  // looks off".
  accepts({ ...GOOD_IMPERIAL, weight: 250 }, "250 lb is a legal teenage weight");
  accepts({ ...GOOD_IMPERIAL, weight: 400 }, "400 lb (181 kg) is still inside the window");

  // Bottom end: 12 lb is a newborn — the signature of a visitor who typed a
  // number while the toggle said the wrong thing. 12 sits inside 8..200 when
  // the conversion is skipped, so without it the regression is handed
  // weightLb = 12 for a 16-year-old and returns a confident wrong number.
  rejects({ ...GOOD_IMPERIAL, weight: 12 }, ["weight"], "12 lb");
  rejects({ ...GOOD_IMPERIAL, weight: 17 }, ["weight"], "17 lb (7.7 kg, just under the floor)");
  rejects({ ...GOOD_IMPERIAL, weight: 500 }, ["weight"], "500 lb");
});

test("imperial lengths are converted to cm before the bounds are applied — at both ends", () => {
  // The existing suite covers the low end (a 63 in parent must not be read as
  // 63 cm). The high end is unproven and is the half a skipped conversion
  // actually lets through: the child window 50..220 cm is 19.7..86.6 in, so any
  // inch value from 87 to 220 passes an unconverted check.
  rejects({ ...GOOD_IMPERIAL, height: 120 }, ["height"], "120 in (10 feet) child height");
  rejects({ ...GOOD_IMPERIAL, height: 90 }, ["height"], "90 in (7'6\") child height");
  rejects({ ...GOOD_IMPERIAL, motherHeight: 150 }, ["motherHeight"], "150 in mother height");
  rejects({ ...GOOD_IMPERIAL, fatherHeight: 200 }, ["fatherHeight"], "200 in father height");

  // Low end, paired so a validator that rejects all imperial input fails too.
  rejects({ ...GOOD_IMPERIAL, motherHeight: 40 }, ["motherHeight"], "40 in mother height");
  accepts({ ...GOOD_IMPERIAL, motherHeight: 60, fatherHeight: 76 }, "5'0\" and 6'4\" parents");
  accepts({ ...GOOD_IMPERIAL, height: 40 }, "40 in (102 cm) child height");
});

test("each measurement is checked against its own table, not a neighbour's", () => {
  // child 50..220 cm and parent 120..230 cm differ at BOTH ends, so a
  // copy-paste slip that passes BOUNDS.parent to the height row (or the
  // reverse) changes behaviour only in the two narrow gaps 50..120 and
  // 220..230. Every existing fixture sits outside those gaps, which is exactly
  // why the slip would survive the suite as it stands.
  //
  // 225 cm is inside the parent window and outside the child window.
  rejects({ ...GOOD_METRIC, height: 225 }, ["height"], "225 cm child height");
  accepts({ ...GOOD_METRIC, motherHeight: 225 }, "225 cm mother");
  accepts({ ...GOOD_METRIC, fatherHeight: 228 }, "228 cm father");

  // 60 cm is inside the child window and below the parent floor.
  accepts({ ...GOOD_METRIC, height: 60 }, "60 cm child height");
  rejects({ ...GOOD_METRIC, motherHeight: 115 }, ["motherHeight"], "115 cm mother");
  rejects({ ...GOOD_METRIC, fatherHeight: 60 }, ["fatherHeight"], "60 cm father");

  // The bounds themselves are inclusive at both ends, in both tables.
  accepts({ ...GOOD_METRIC, height: BOUNDS.child.min }, "child min");
  accepts({ ...GOOD_METRIC, height: BOUNDS.child.max }, "child max");
  accepts({ ...GOOD_METRIC, motherHeight: BOUNDS.parent.min, fatherHeight: BOUNDS.parent.max }, "parent min/max");
  accepts({ ...GOOD_METRIC, weight: BOUNDS.weight.min }, "weight min");
  accepts({ ...GOOD_METRIC, weight: BOUNDS.weight.max }, "weight max");
});

// ---------------------------------------------------------------------------
// 3. THE DOCUMENTED WINDOW IS THE WINDOW THAT IS ENFORCED
// ---------------------------------------------------------------------------

test("the age window is inclusive at both ends, exactly as BOUNDS and the copy say", () => {
  // BOUNDS.age is 4..17 and the rejection copy promises "ages 4 and up" and
  // "an age from 4 to 17". The existing suite probes 3 and 18, so flipping
  // either comparison to its non-strict twin turns away precisely the
  // 4-year-olds and 17-year-olds the product advertises — and nothing notices.
  accepts({ ...GOOD_METRIC, ageYears: BOUNDS.age.min }, "age at the documented floor");
  accepts({ ...GOOD_METRIC, ageYears: BOUNDS.age.max }, "age at the documented ceiling");
  accepts({ ...GOOD_METRIC, ageYears: 4.5 }, "age just inside the floor");

  rejects({ ...GOOD_METRIC, ageYears: 3.99 }, ["ageYears"], "age 3.99");
  rejects({ ...GOOD_METRIC, ageYears: 17.01 }, ["ageYears"], "age 17.01");
  rejects({ ...GOOD_METRIC, ageYears: 0 }, ["ageYears"], "age 0");
  rejects({ ...GOOD_METRIC, ageYears: -5 }, ["ageYears"], "age -5");
});

// ---------------------------------------------------------------------------
// 4. WHAT THE VISITOR ACTUALLY SEES
// ---------------------------------------------------------------------------

test("every bad field is reported in one pass, not one per submit", () => {
  // app.js showErrors() iterates Object.entries(errors) and paints each field,
  // so the form is built to display all of them at once. A validator that
  // short-circuits on the first error turns a form with four bad numbers into
  // four separate submissions, each revealing one more problem.
  const r = rejects(
    { sex: "nope", ageYears: 2, units: "metric", height: 400, weight: 900, motherHeight: 20, fatherHeight: 999 },
    ["sex", "ageYears", "height", "weight", "motherHeight", "fatherHeight"],
    "everything wrong at once",
  );
  // Every key must be one app.js can paint. `sex` has no slot of its own and is
  // deliberately surfaced on the age line (app.js:86); the other five map
  // directly, and a key outside this set is a message the visitor never sees.
  const PAINTABLE = new Set(["sex", "ageYears", "height", "weight", "motherHeight", "fatherHeight"]);
  for (const key of Object.keys(r.errors)) {
    assert.ok(PAINTABLE.has(key), `errors.${key} has no slot in app.js ERR_MAP — the message is invisible`);
  }
});

test("zero and negative measurements get the positive-number message, not the generic one", () => {
  // The `raw <= 0` branch is message quality only: the bounds check below it
  // would reject these values anyway. That makes it invisible to any test that
  // only asserts ok:false — which is why this one asserts the wording. A
  // 12-year-old who typed a minus sign should be told what is wrong with the
  // number, not asked to re-check a unit toggle that is already correct.
  for (const field of MEASUREMENTS) {
    for (const bad of [0, -0.5, -180]) {
      const r = rejects({ ...GOOD_METRIC, [field]: bad }, [field], `${field}: ${bad}`);
      assert.match(
        r.errors[field],
        /must be a positive number/,
        `${field}=${bad} fell through to the generic out-of-range message`,
      );
    }
  }
  // And the contrast case: a merely out-of-range value must NOT claim the
  // number is non-positive, or the message is actively misleading.
  const far = validateInputs({ ...GOOD_METRIC, height: 400 });
  assert.doesNotMatch(far.errors.height, /positive number/);
  assert.match(far.errors.height, /looks off/);
});

test("the 16-17 near-final warning is a warning, is honest about the age, and never blocks", () => {
  // Telling a 15-year-old they are "close to your adult height" is a false
  // statement about their body, and this app's whole pitch is honesty about
  // what it can and cannot know. The threshold is a claim, not a nicety.
  const nearFinal = /close to your adult height/i;

  for (const ageYears of [BOUNDS.age.min, 8, 12, 14, 15, 15.9]) {
    const r = accepts({ ...GOOD_METRIC, ageYears }, `age ${ageYears}`);
    assert.deepEqual(r.warnings, [], `age ${ageYears} was told it is near-final`);
  }
  for (const ageYears of [16, 16.5, BOUNDS.age.max]) {
    const r = accepts({ ...GOOD_METRIC, ageYears }, `age ${ageYears}`);
    assert.ok(r.warnings.some((w) => nearFinal.test(w)), `age ${ageYears} lost the near-final warning`);
  }

  // A warning must never become a rejection: warnings ride along with ok:true
  // and an intact value, and range.js passes them through to the card.
  const r = validateInputs({ ...GOOD_METRIC, ageYears: 17 });
  assert.equal(r.ok, true);
  assert.deepEqual(r.errors, {});
  assert.deepEqual(buildResult({ ...GOOD_METRIC, ageYears: 17 }).warnings, r.warnings);

  // Rejected input still returns an array — app.js and range.js both read
  // `.warnings` on the failure path without a guard.
  assert.ok(Array.isArray(validateInputs({ ...GOOD_METRIC, ageYears: 30 }).warnings));
});

test("validateInputs() with no argument reports every field instead of throwing", () => {
  // The `input = {}` default parameter is a real guard: without it the first
  // property read throws a TypeError, which on the submit path is a dead
  // button rather than a form full of helpful messages.
  const r = validateInputs();
  assert.equal(r.ok, false);
  assert.equal(r.value, null);
  assert.deepEqual(
    errorKeys(r),
    ["ageYears", "fatherHeight", "height", "motherHeight", "sex", "weight"],
    "an empty submission should name every missing field at once",
  );
  assert.deepEqual(validateInputs({}).errors, r.errors, "no-argument and empty-object must agree");
});
