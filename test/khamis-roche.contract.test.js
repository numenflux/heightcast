// khamis-roche.contract.test.js — safety-contract tests for js/khamis-roche.js.
//
// The existing khamis-roche.test.js proves the ARITHMETIC is right: two
// hand-computed worked examples, four spot-checked coefficients, and the
// documented ageToIndex boundaries. That is necessary but not sufficient.
//
// This file covers the CONTRACT — the properties that must hold for every
// input the published page can produce, not just the two that were checked by
// hand. The blast radius is the rendered prediction: range.js feeds
// predictKhamisRoche's output straight into the headline via fmtPoint/fmtRange,
// and neither formatter guards against NaN. A single hole anywhere in the
// 224-number coefficient table renders "NaN–NaN cm" as a visitor's predicted
// adult height, and range.js's buildConfidence calls kr.error90In.toFixed(1)
// with no guard at all — an undefined field there throws and takes out the
// whole result panel.
//
// So the properties under test, in blast-radius order, are:
//   1. no NaN can ever leave this module for a valid input          (breaks page)
//   2. no index can ever fall outside the 28 coefficient rows       (breaks page)
//   3. the capped branch is shape-identical to the normal branch    (breaks page)
//   4. the 90% band is never narrower than the 50% band             (honesty law)
//   5. the right coefficient row is used for the right age          (wrong answer)
//
// Idiom matches the repo: node:test + node:assert/strict, direct ES import,
// zero dependencies.

import test from "node:test";
import assert from "node:assert/strict";
import {
  predictKhamisRoche,
  ageToIndex,
  KR_COEFFS,
  KR_MIN_AGE,
  KR_MAX_AGE,
} from "../js/khamis-roche.js";

const SEXES = ["male", "female"];
const ROWS = ["B0", "height", "weight", "midparent"];

// A roughly realistic child for a given age, so the sweep exercises the model
// with input it will actually see rather than a constant that could mask a
// transposed row. Imperial, as the published regression requires.
function realisticChild(ageYears) {
  return {
    heightIn: 40 + (ageYears - 4) * 1.8, // ~40in at 4y -> ~64in at 17y
    weightLb: 36 + (ageYears - 4) * 8,   // ~36lb at 4y -> ~140lb at 17y
    motherIn: 64,
    fatherIn: 70,
  };
}

// Every half-year row the table claims to cover.
function everyValidAge() {
  const ages = [];
  for (let a = KR_MIN_AGE; a <= KR_MAX_AGE + 1e-9; a += 0.5) ages.push(Math.round(a * 2) / 2);
  return ages;
}

// The numeric fields range.js reads off the result without any guard.
const CONSUMED_NUMERIC_FIELDS = [
  "pointIn", "low50In", "high50In", "low90In", "high90In", "error50In", "error90In",
];

// ---------------------------------------------------------------------------
// 1. No NaN can leave this module — the coefficient table has no holes.
// ---------------------------------------------------------------------------

// The existing suite checks only `.length === 28` and four values at male
// index 12. A transcription slip anywhere else — a dropped digit that parses
// as undefined, a stray string, a hole from an editing accident — passes both
// of those checks and then renders "NaN cm" for exactly one age cohort.
// 224 numbers were transcribed by hand from a 1994 paper plus a 1995 errata;
// this asserts all 224.
test("every coefficient in the table is a finite number (no transcription holes)", () => {
  for (const sex of SEXES) {
    for (const row of ROWS) {
      const arr = KR_COEFFS[sex][row];
      assert.ok(Array.isArray(arr), `${sex}.${row} must be an array`);
      arr.forEach((v, i) => {
        assert.equal(typeof v, "number", `${sex}.${row}[${i}] is ${typeof v}, not a number`);
        assert.ok(Number.isFinite(v), `${sex}.${row}[${i}] is ${v}, not finite`);
      });
    }
    for (const bound of ["error50", "error90"]) {
      const v = KR_COEFFS[sex][bound];
      assert.ok(Number.isFinite(v) && v > 0, `${sex}.${bound} must be a positive finite number`);
    }
  }
});

// The header documents the table as "one coefficient row per half-year of age
// from 4.0 to 17.5 (28 rows, index 0..27)". KR_MIN_AGE/KR_MAX_AGE and the row
// count are three statements of one fact and must not drift apart: widening
// KR_MAX_AGE without adding rows makes ageToIndex hand out index 28, which
// reads undefined out of every array and NaNs the prediction.
test("the age window and the row count stay in sync", () => {
  const impliedRows = (KR_MAX_AGE - KR_MIN_AGE) * 2 + 1;
  assert.equal(impliedRows, 28, "KR_MIN_AGE/KR_MAX_AGE imply a row count other than 28");
  for (const sex of SEXES) {
    for (const row of ROWS) {
      assert.equal(
        KR_COEFFS[sex][row].length,
        impliedRows,
        `${sex}.${row} has ${KR_COEFFS[sex][row].length} rows but the age window implies ${impliedRows}`,
      );
    }
  }
});

// The end-to-end anti-NaN net: drive the public API across every age the model
// claims to support, for both sexes, and assert that nothing a consumer reads
// is NaN and that the answer is a physically possible human height. The
// plausibility band is deliberately generous (an adult between 3'8" and 7'6")
// so it cannot flake, but it is tight enough that a sign error or a shifted
// row cannot hide inside it.
test("no valid input anywhere in the supported range produces NaN or an absurd height", () => {
  for (const sex of SEXES) {
    for (const ageYears of everyValidAge()) {
      const r = predictKhamisRoche({ sex, ageYears, ...realisticChild(ageYears) });

      assert.equal(r.available, true, `${sex} @ ${ageYears}: available must be true`);
      assert.equal(r.capped, false, `${sex} @ ${ageYears}: in-range ages must not be capped`);

      for (const field of CONSUMED_NUMERIC_FIELDS) {
        assert.ok(
          Number.isFinite(r[field]),
          `${sex} @ ${ageYears}: ${field} is ${r[field]} — a non-finite value here renders "NaN cm" on the page`,
        );
      }

      assert.ok(
        Number.isInteger(r.index) && r.index >= 0 && r.index <= 27,
        `${sex} @ ${ageYears}: index ${r.index} is not a usable row`,
      );
      assert.ok(
        r.pointIn > 44 && r.pointIn < 90,
        `${sex} @ ${ageYears}: predicted ${r.pointIn.toFixed(2)} in is not a plausible adult height`,
      );
    }
  }
});

// ---------------------------------------------------------------------------
// 2. No index can ever fall outside the 28 rows.
// ---------------------------------------------------------------------------

// ageToIndex's return value is used directly as an array subscript on four
// parallel arrays. The range guard is the only thing standing between a
// visitor and `undefined` coefficients. Sweep well past both ends in small
// steps and assert the result is either null (refused) or a row that is
// actually populated in every array — never a bare number that happens to be
// out of bounds.
test("ageToIndex never yields a subscript outside the coefficient rows", () => {
  for (let age = -5; age <= 25; age += 0.05) {
    const i = ageToIndex(age);
    if (i === null) continue;

    assert.ok(
      Number.isInteger(i) && i >= 0 && i <= 27,
      `ageToIndex(${age.toFixed(2)}) returned ${i}, outside 0..27`,
    );
    // Stronger than a bounds check: the row must genuinely exist. This is what
    // catches a guard that lets index 28 through on a 28-row table.
    for (const sex of SEXES) {
      for (const row of ROWS) {
        assert.ok(
          Number.isFinite(KR_COEFFS[sex][row][i]),
          `ageToIndex(${age.toFixed(2)}) -> ${i} reads undefined from ${sex}.${row}`,
        );
      }
    }
  }
});

// The header states the index scheme as a formula:
//   index = (round(age to nearest 0.5) - 4) * 2
// Re-implement it independently and check agreement across a dense sweep, so
// the documented spec and the code cannot drift.
test("ageToIndex matches its documented formula, including the null cases", () => {
  for (let age = -5; age <= 25; age += 0.05) {
    const rounded = Math.round(age * 2) / 2;
    const expected =
      rounded < KR_MIN_AGE || rounded > KR_MAX_AGE ? null : Math.round((rounded - KR_MIN_AGE) * 2);
    assert.equal(
      ageToIndex(age),
      expected,
      `ageToIndex(${age.toFixed(2)}): rounded ${rounded} should map to ${expected}`,
    );
  }
});

// Round-trip every row: the age at the centre of row i must map back to i.
// An off-by-one in the index arithmetic shifts every prediction by half a year
// of growth while still returning perfectly finite, plausible-looking numbers.
test("every one of the 28 rows round-trips through ageToIndex", () => {
  for (let i = 0; i <= 27; i++) {
    const age = KR_MIN_AGE + i / 2;
    assert.equal(ageToIndex(age), i, `age ${age} should be row ${i}`);
  }
  assert.equal(ageToIndex(KR_MIN_AGE), 0);
  assert.equal(ageToIndex(KR_MAX_AGE), 27);
});

// ---------------------------------------------------------------------------
// 3. Row selection — the right coefficients for the right age.
// ---------------------------------------------------------------------------

// predictKhamisRoche echoes the coefficients it used. Pin them against the
// table for all 28 rows, both sexes. A shifted subscript produces a finite,
// plausible answer that no arithmetic spot-check would notice; this is what
// makes that mutation visible.
test("the coefficients used are exactly the table row for that age, for all 28 rows", () => {
  for (const sex of SEXES) {
    for (let i = 0; i <= 27; i++) {
      const ageYears = KR_MIN_AGE + i / 2;
      const r = predictKhamisRoche({ sex, ageYears, ...realisticChild(ageYears) });
      const t = KR_COEFFS[sex];

      assert.equal(r.index, i, `${sex} @ ${ageYears}: wrong row index`);
      assert.equal(r.coeffs.b0, t.B0[i], `${sex} row ${i}: B0 mismatch`);
      assert.equal(r.coeffs.height, t.height[i], `${sex} row ${i}: height mismatch`);
      assert.equal(r.coeffs.weight, t.weight[i], `${sex} row ${i}: weight mismatch`);
      assert.equal(r.coeffs.midparent, t.midparent[i], `${sex} row ${i}: midparent mismatch`);
    }
  }
});

// All four regression terms must actually be wired into the sum. Swapping one
// input for another (bw * heightIn instead of bw * weightLb) is a copy-paste
// slip that still yields a finite, plausible number. Perturb each input on its
// own and assert the point estimate moves by exactly coefficient x delta.
// Checked on every row so a slip cannot hide in the ages nobody hand-computed.
test("height, weight and mid-parent each move the estimate by exactly their coefficient", () => {
  const EPS = 1e-9;
  for (const sex of SEXES) {
    for (let i = 0; i <= 27; i++) {
      const ageYears = KR_MIN_AGE + i / 2;
      const base = realisticChild(ageYears);
      const p0 = predictKhamisRoche({ sex, ageYears, ...base }).pointIn;
      const t = KR_COEFFS[sex];

      const pH = predictKhamisRoche({ sex, ageYears, ...base, heightIn: base.heightIn + 1 }).pointIn;
      assert.ok(Math.abs(pH - p0 - t.height[i]) < EPS,
        `${sex} row ${i}: +1in height moved the estimate by ${pH - p0}, expected ${t.height[i]}`);

      const pW = predictKhamisRoche({ sex, ageYears, ...base, weightLb: base.weightLb + 1 }).pointIn;
      assert.ok(Math.abs(pW - p0 - t.weight[i]) < EPS,
        `${sex} row ${i}: +1lb weight moved the estimate by ${pW - p0}, expected ${t.weight[i]}`);

      // Mid-parent is the mean of the two parents, so +2in on one parent is
      // +1in of mid-parent. This also pins the averaging itself.
      const pM = predictKhamisRoche({ sex, ageYears, ...base, fatherIn: base.fatherIn + 2 }).pointIn;
      assert.ok(Math.abs(pM - p0 - t.midparent[i]) < EPS,
        `${sex} row ${i}: +1in mid-parent moved the estimate by ${pM - p0}, expected ${t.midparent[i]}`);
    }
  }
});

// Mid-parent is documented as (mother + father) / 2 and is echoed for display.
test("mid-parent height is the mean of the two parents and is echoed correctly", () => {
  const r = predictKhamisRoche({
    sex: "male", ageYears: 10, heightIn: 54.5, weightLb: 76, motherIn: 62, fatherIn: 72,
  });
  assert.equal(r.coeffs.midparentIn, 67);
  // Swapping the parents must not change anything — the mean is symmetric.
  const swapped = predictKhamisRoche({
    sex: "male", ageYears: 10, heightIn: 54.5, weightLb: 76, motherIn: 72, fatherIn: 62,
  });
  assert.equal(swapped.pointIn, r.pointIn);
});

// ---------------------------------------------------------------------------
// 4. Honesty law — the 90% band must never be narrower than the 50% band.
// ---------------------------------------------------------------------------

// range.js publishes the 90% band as the headline range and tells the visitor
// it lands there "about 9 times out of 10". If the two error bounds were ever
// swapped, the page would show a TIGHTER range under that sentence — claiming
// more confidence than the model has. That is the studio's honesty rule
// expressed as an invariant, so it is asserted on every row rather than once.
test("bands nest correctly and the 90% band is strictly wider than the 50%", () => {
  for (const sex of SEXES) {
    for (const ageYears of everyValidAge()) {
      const r = predictKhamisRoche({ sex, ageYears, ...realisticChild(ageYears) });
      const where = `${sex} @ ${ageYears}`;

      assert.ok(r.low90In < r.low50In, `${where}: 90% lower bound is not below the 50% lower bound`);
      assert.ok(r.low50In < r.pointIn, `${where}: 50% lower bound is not below the point`);
      assert.ok(r.pointIn < r.high50In, `${where}: point is not below the 50% upper bound`);
      assert.ok(r.high50In < r.high90In, `${where}: 50% upper bound is not below the 90% upper bound`);

      const width50 = r.high50In - r.low50In;
      const width90 = r.high90In - r.low90In;
      assert.ok(
        width90 > width50,
        `${where}: the 90% band (${width90.toFixed(3)}in) is not wider than the 50% band (${width50.toFixed(3)}in) — the page would overstate its confidence`,
      );
    }
  }
});

// The bands are documented as the point plus/minus the published error bounds.
// Assert the exact derivation, both sides, so a dropped minus sign or a band
// built off something other than the point estimate is caught.
test("bands are the point estimate plus/minus the published error bounds, exactly", () => {
  for (const sex of SEXES) {
    for (const ageYears of everyValidAge()) {
      const r = predictKhamisRoche({ sex, ageYears, ...realisticChild(ageYears) });
      const t = KR_COEFFS[sex];
      const where = `${sex} @ ${ageYears}`;

      assert.equal(r.error50In, t.error50, `${where}: error50In does not match the table`);
      assert.equal(r.error90In, t.error90, `${where}: error90In does not match the table`);
      assert.equal(r.low50In, r.pointIn - t.error50, `${where}: low50In is not point - error50`);
      assert.equal(r.high50In, r.pointIn + t.error50, `${where}: high50In is not point + error50`);
      assert.equal(r.low90In, r.pointIn - t.error90, `${where}: low90In is not point - error90`);
      assert.equal(r.high90In, r.pointIn + t.error90, `${where}: high90In is not point + error90`);
    }
  }
});

// ---------------------------------------------------------------------------
// 5. The capped branch must be shape-identical to the normal branch.
// ---------------------------------------------------------------------------

// range.js does not branch on `capped`. It reads low50In/high50In/low90In/
// high90In/error50In/error90In off whatever comes back and calls
// kr.error90In.toFixed(1) directly. If the capped return ever drops a field,
// that is a TypeError on "undefined.toFixed" and the entire result panel dies.
// The existing suite checks three fields on this branch; this checks the whole
// shape against the normal branch so the two cannot diverge.
test("the capped result exposes exactly the same fields as a normal result", () => {
  const normal = predictKhamisRoche({
    sex: "male", ageYears: 10, heightIn: 54.5, weightLb: 76, motherIn: 64, fatherIn: 70,
  });
  const capped = predictKhamisRoche({
    sex: "male", ageYears: 18, heightIn: 70, weightLb: 150, motherIn: 64, fatherIn: 72,
  });

  assert.equal(capped.capped, true, "age 18 should be capped");
  assert.deepEqual(
    Object.keys(capped).sort(),
    Object.keys(normal).sort(),
    "capped and normal results must expose the same keys — range.js reads them unconditionally",
  );

  for (const field of CONSUMED_NUMERIC_FIELDS) {
    assert.ok(
      Number.isFinite(capped[field]),
      `capped result: ${field} is ${capped[field]} — range.js calls .toFixed() on these`,
    );
  }
  // The documented behaviour: growth is complete, so the current height is the
  // answer and the bands collapse onto it rather than vanishing.
  assert.equal(capped.pointIn, 70);
  assert.equal(capped.low50In, 70);
  assert.equal(capped.high50In, 70);
  assert.equal(capped.low90In, 70);
  assert.equal(capped.high90In, 70);
  assert.equal(capped.error50In, 0);
  assert.equal(capped.error90In, 0);
  assert.equal(capped.index, null);
});

// The two ends of the table are handled asymmetrically on purpose: above it,
// growth is essentially done and the current height is returned (capped);
// below it, there is no honest answer, so it throws. Pin both, and pin the
// exact boundary where capping starts — 17.75 rounds to 18 and caps, while
// 17.74 rounds to 17.5 and is still a real row.
test("above the table caps, below the table throws, and the boundary is where it is documented", () => {
  const child = { heightIn: 68, weightLb: 140, motherIn: 64, fatherIn: 72 };

  // Last real row.
  const at175 = predictKhamisRoche({ sex: "male", ageYears: 17.5, ...child });
  assert.equal(at175.capped, false, "17.5 is the last real row, not a capped age");
  assert.equal(at175.index, 27);

  const at1774 = predictKhamisRoche({ sex: "male", ageYears: 17.74, ...child });
  assert.equal(at1774.capped, false, "17.74 rounds to 17.5 and is still a real row");
  assert.equal(at1774.index, 27);

  // First capped age.
  for (const ageYears of [17.75, 18, 25, 60]) {
    const r = predictKhamisRoche({ sex: "male", ageYears, ...child });
    assert.equal(r.capped, true, `age ${ageYears} should be capped, not computed`);
    assert.equal(r.pointIn, child.heightIn, `age ${ageYears}: capped point should be current height`);
  }

  // Below the table: refuse loudly rather than guess.
  assert.equal(ageToIndex(3.9), 0, "3.9 rounds up to 4.0 and is valid");
  for (const ageYears of [3.7, 3, 0, -1]) {
    assert.throws(
      () => predictKhamisRoche({ sex: "male", ageYears, heightIn: 40, weightLb: 35, motherIn: 64, fatherIn: 70 }),
      /Khamis-Roche supports ages/,
      `age ${ageYears} is below the table and must throw, not return a guess`,
    );
  }
});

// ---------------------------------------------------------------------------
// 6. Hostile input on `sex`.
// ---------------------------------------------------------------------------

// An unknown sex must produce the DOCUMENTED, actionable error, not a raw
// TypeError from dereferencing undefined. Asserting only "it throws" would
// pass with the guard deleted — dereferencing undefined throws too — so this
// asserts the error type and message instead.
test("an unknown sex throws the documented error, not a bare dereference TypeError", () => {
  for (const sex of ["x", "", "MALE", "Female", null, undefined, 0, {}]) {
    let caught;
    try {
      predictKhamisRoche({ sex, ageYears: 10, heightIn: 54, weightLb: 70, motherIn: 64, fatherIn: 70 });
    } catch (e) {
      caught = e;
    }
    assert.ok(caught, `sex=${String(sex)} should have thrown`);
    assert.ok(
      !(caught instanceof TypeError),
      `sex=${String(sex)} threw a raw TypeError ("${caught.message}") — the sex guard did not run`,
    );
    assert.match(
      caught.message,
      /sex must be 'male' or 'female'/,
      `sex=${String(sex)} threw an unhelpful message: ${caught.message}`,
    );
  }
});

// KR_COEFFS is a plain object literal, so keys inherited from Object.prototype
// ("constructor", "toString", ...) are truthy and slip past the `!table`
// check. They currently die one line later on an undefined dereference, which
// is safe-ish but not the documented error. What must never happen is a
// numeric-looking prediction coming back for a nonsense sex, so that is what
// is asserted here.
//
// NOTE: this test deliberately does NOT assert the message, because the guard
// does not currently catch these keys. See the reported findings.
test("prototype-chain keys are never accepted as a sex", () => {
  for (const sex of ["constructor", "toString", "hasOwnProperty", "valueOf", "__proto__"]) {
    let result, threw = false;
    try {
      result = predictKhamisRoche({ sex, ageYears: 10, heightIn: 54, weightLb: 70, motherIn: 64, fatherIn: 70 });
    } catch {
      threw = true;
    }
    assert.ok(
      threw,
      `sex="${sex}" returned a result (pointIn=${result && result.pointIn}) instead of being rejected`,
    );
  }
});

// ---------------------------------------------------------------------------
// 7. Purity — the module holds no state a second call can inherit.
// ---------------------------------------------------------------------------

// The page can run this many times as the visitor edits the form. The echoed
// `coeffs` object must be a fresh copy: handing back a live reference to the
// shared table would let a consumer corrupt every later prediction.
test("results are reproducible and the echoed coefficients are a copy, not the live table", () => {
  const input = { sex: "male", ageYears: 10, heightIn: 54.5, weightLb: 76, motherIn: 64, fatherIn: 70 };

  const a = predictKhamisRoche(input);
  assert.notEqual(a.coeffs, KR_COEFFS.male, "coeffs must not be the shared table object");

  // Mutate the echoed copy the way a careless consumer might.
  a.coeffs.b0 = 999;
  a.coeffs.height = 999;

  const b = predictKhamisRoche(input);
  assert.equal(b.coeffs.b0, KR_COEFFS.male.B0[12], "a mutated result corrupted the shared table");
  assert.equal(b.pointIn, predictKhamisRoche(input).pointIn);
  assert.ok(Math.abs(b.pointIn - 69.636459) < 1e-4, "the second call disagrees with the first");

  // The two sexes must not share coefficient arrays.
  for (const row of ROWS) {
    assert.notEqual(KR_COEFFS.male[row], KR_COEFFS.female[row], `${row} arrays are shared between sexes`);
  }
});
