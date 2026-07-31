// Integrity contract for the bundled CDC 2000 stature-for-age LMS tables.
//
// js/cdc-data.js is 448 lines of transcribed government reference data and
// nothing else. It has no branches to test, which is exactly why it was
// untested — and exactly why it is dangerous. A single mistyped L, M or S
// silently shifts one age band's percentile. Nothing throws, nothing looks
// wrong, and the visitor is quietly told the wrong adult height. cdc-lms.test.js
// exercises the interpolation *code* that reads this table but pins only one
// row of it (male, 240 months), so 217 of 218 male rows and all 218 female rows
// were unasserted.
//
// So these tests assert the table's own properties, in three layers:
//
//   1. STRUCTURE — what lookupLMS() in cdc-lms.js silently assumes: ascending
//      ages, no gaps, a real row at the projection endpoint, positive S and M.
//      Break these and the interpolator returns a confidently wrong number.
//   2. SHAPE — invariants a genuine CDC table satisfies and a corrupted one
//      does not: median stature only rises, every percentile channel only
//      rises, and L/M/S vary smoothly with age (the CDC tables are smoothing-
//      spline output, so a transcription slip shows up as a local spike).
//   3. FINGERPRINT — a hash, so no value can change without a deliberate edit.
//
// Layers 2 and 3 overlap on purpose. The fingerprint catches every possible
// edit but cannot say what is wrong; the shape tests catch the consequential
// edits and name the defect. Sensitivity of the shape tests is documented at
// SMOOTHNESS_BOUNDS below — it is not "any typo", and pretending otherwise
// would be the same mistake as a test that passes with the guard deleted.

import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";

import { CDC_STATURE_LMS } from "../js/cdc-data.js";
import {
  ADULT_AGE_MONTHS, lookupLMS, heightForZScore, projectAdultHeight,
} from "../js/cdc-lms.js";
import { BOUNDS } from "../js/validate.js";

const SEXES = ["male", "female"];

// The one documented discontinuity in the source data: CDC's 2000 stature-for-
// age curve is spliced at the 36-month chart junction, so L genuinely kinks
// there (male L runs -0.3039 -> -0.3909 -> -0.2548 across 35.5/36.5/37.5).
// It is real data, not a typo, so the smoothness test budgets for it here
// rather than being loosened everywhere and catching nothing.
const CHART_JUNCTION_AGE = 36.5;

// ---------------------------------------------------------------------------
// 1. STRUCTURE — the assumptions lookupLMS() makes without checking
// ---------------------------------------------------------------------------

test("exports exactly the two sex keys the app can produce", () => {
  // validate.js rejects anything that is not "male" or "female", and
  // lookupLMS throws on a missing key. A renamed or extra key means either a
  // hard throw in front of a visitor or a table nothing ever reads.
  assert.deepEqual(Object.keys(CDC_STATURE_LMS).sort(), ["female", "male"]);
});

test("every row is a 4-tuple of finite numbers", () => {
  // Guards the failure mode a hand-edited data file actually has: a dropped
  // comma merging two rows, a quoted value, a hole from a bad splice. Any of
  // those reaches the LMS transform as undefined/NaN and renders "NaN cm".
  for (const sex of SEXES) {
    const rows = CDC_STATURE_LMS[sex];
    assert.ok(Array.isArray(rows) && rows.length > 200, `${sex}: expected a full table`);
    rows.forEach((row, i) => {
      assert.ok(Array.isArray(row), `${sex}[${i}] is not an array`);
      assert.equal(row.length, 4, `${sex}[${i}] must be [ageMonths, L, M, S]`);
      row.forEach((v, j) => {
        assert.equal(typeof v, "number", `${sex}[${i}][${j}] is ${typeof v}, not a number`);
        assert.ok(Number.isFinite(v), `${sex}[${i}][${j}] is ${v}`);
      });
    });
  }
});

test("ages ascend strictly and never gap by more than one month", () => {
  // lookupLMS scans forward for the first pair bracketing the age and returns
  // on the first hit. Out-of-order ages make it return the wrong bracket; a
  // widened gap makes it linearly interpolate across terrain the CDC spline
  // curves through. Both are silent — the number just comes out wrong.
  for (const sex of SEXES) {
    const rows = CDC_STATURE_LMS[sex];
    assert.equal(rows[0][0], 24, `${sex}: table must start at 24 months`);
    for (let i = 1; i < rows.length; i++) {
      const gap = rows[i][0] - rows[i - 1][0];
      assert.ok(gap > 0, `${sex}: age ${rows[i][0]} does not follow ${rows[i - 1][0]}`);
      assert.ok(gap <= 1, `${sex}: ${gap}-month gap before age ${rows[i][0]}`);
    }
  }
});

test("the table ends exactly at ADULT_AGE_MONTHS, so the endpoint is a real row", () => {
  // Every projection reads the adult stature off age 240. If the last row were
  // 239.5, lookupLMS would clamp and project onto a *different* endpoint —
  // still finite, still plausible, quietly wrong for every single visitor.
  for (const sex of SEXES) {
    const rows = CDC_STATURE_LMS[sex];
    const last = rows[rows.length - 1];
    assert.equal(last[0], ADULT_AGE_MONTHS, `${sex}: table must end at ${ADULT_AGE_MONTHS} months`);

    const at240 = lookupLMS(sex, ADULT_AGE_MONTHS);
    // Interpolated at t=1, so compare within float slack rather than bit-exact.
    assert.ok(Math.abs(at240.L - last[1]) < 1e-12, `${sex}: L at 240 != last row`);
    assert.ok(Math.abs(at240.M - last[2]) < 1e-12, `${sex}: M at 240 != last row`);
    assert.ok(Math.abs(at240.S - last[3]) < 1e-12, `${sex}: S at 240 != last row`);
  }
});

test("both sexes share one age grid", () => {
  // They are two columns of one CDC file. Divergent grids mean one sex is
  // being interpolated on a different lattice from the other, which shows up
  // as an unexplained male/female asymmetry rather than as an error.
  const male = CDC_STATURE_LMS.male;
  const female = CDC_STATURE_LMS.female;
  assert.equal(male.length, female.length, "row counts differ");
  for (let i = 0; i < male.length; i++) {
    assert.equal(male[i][0], female[i][0], `age grids diverge at row ${i}`);
  }
});

test("S and M are strictly positive, so the LMS transform never divides by zero", () => {
  // heightZScore divides by (L*S) — or by S alone on the |L|~0 branch — and
  // raises (heightCm / M) to a power. S = 0 yields +/-Infinity; M <= 0 yields
  // NaN from Math.pow of a negative base. Either reaches the page as text.
  for (const sex of SEXES) {
    for (const [age, , M, S] of CDC_STATURE_LMS[sex]) {
      assert.ok(S > 0, `${sex} @${age}: S must be > 0, got ${S}`);
      assert.ok(M > 0, `${sex} @${age}: M must be > 0, got ${M}`);
    }
  }
});

// ---------------------------------------------------------------------------
// 2. SHAPE — invariants a real CDC table has and a corrupted one does not
// ---------------------------------------------------------------------------

test("L, M and S stay inside the envelope CDC 2000 stature tables occupy", () => {
  // Deliberately loose physiological/statistical bounds. This is the decimal-
  // point guard: 86.4522 typed as 8.64522 or 864.522 is caught here whatever
  // else it does to the curve shape.
  for (const sex of SEXES) {
    for (const [age, L, M, S] of CDC_STATURE_LMS[sex]) {
      assert.ok(L > -1 && L < 3, `${sex} @${age}: L=${L} outside [-1, 3]`);
      assert.ok(M >= 80 && M <= 190, `${sex} @${age}: M=${M} cm outside [80, 190]`);
      assert.ok(S > 0.02 && S < 0.08, `${sex} @${age}: S=${S} outside [0.02, 0.08]`);
    }
  }
});

test("median stature never goes backwards and grows at a physiological rate", () => {
  // Children do not shrink, and they do not grow 30 cm in a year. Bounds are
  // set from the table's own observed range (0.07-10.72 cm/yr) with headroom,
  // so a mistyped M shows up as either a reversal or an implausible spurt.
  for (const sex of SEXES) {
    const rows = CDC_STATURE_LMS[sex];
    for (let i = 1; i < rows.length; i++) {
      const dM = rows[i][2] - rows[i - 1][2];
      assert.ok(dM > 0, `${sex}: median stature drops from ${rows[i - 1][0]} to ${rows[i][0]} mo`);
      const cmPerYear = (dM / (rows[i][0] - rows[i - 1][0])) * 12;
      assert.ok(cmPerYear < 14, `${sex} @${rows[i][0]}mo: ${cmPerYear.toFixed(1)} cm/yr is not growth`);
    }
  }
});

test("every percentile channel from P3 to P97 rises with age", () => {
  // The stronger version of the test above. The percentile curve at a given z
  // is a function of L, M *and* S together, so this catches typos in L or S
  // that leave the median untouched — the ones that "silently shift a
  // percentile for one age band" with no other visible symptom.
  const CHANNELS = { 3: -1.8808, 10: -1.2816, 25: -0.6745, 50: 0, 75: 0.6745, 90: 1.2816, 97: 1.8808 };
  for (const sex of SEXES) {
    const ages = CDC_STATURE_LMS[sex].map((r) => r[0]);
    for (const [p, z] of Object.entries(CHANNELS)) {
      for (let i = 1; i < ages.length; i++) {
        const prev = heightForZScore(sex, ages[i - 1], z);
        const cur = heightForZScore(sex, ages[i], z);
        assert.ok(
          cur > prev,
          `${sex} P${p}: ${prev.toFixed(4)} cm @${ages[i - 1]}mo -> ${cur.toFixed(4)} cm @${ages[i]}mo`,
        );
      }
    }
  }
});

test("L, M and S vary smoothly with age (transcription-typo guard)", () => {
  // The CDC LMS parameters are smoothing-spline output, so each series is
  // smooth in age and its second difference is small everywhere. A single
  // mistyped digit is a delta-spike: perturbing one value by e moves the
  // second difference at that age by 2e. That is what this measures.
  //
  // Bounds are the observed maximum with ~2.5x headroom, measured over the
  // real table (max |2nd diff|: L 0.020, M 0.031, S 7.5e-5; and at the
  // 36-month chart junction L 0.223, S 1.6e-4).
  //
  // SENSITIVITY, stated honestly: this catches |e| greater than roughly
  // 0.015 in L, 0.025 cm in M, 2e-5 in S — i.e. a slip at the 3rd-4th
  // significant digit and above. Smaller slips are the fingerprint test's job.
  const SMOOTHNESS_BOUNDS = {
    L: { normal: 0.05, junction: 0.30 },
    M: { normal: 0.08, junction: 0.08 },
    S: { normal: 1.2e-4, junction: 2.0e-4 },
  };
  const SERIES = [["L", 1], ["M", 2], ["S", 3]];

  for (const sex of SEXES) {
    const rows = CDC_STATURE_LMS[sex];
    // The first and last age steps are half-months, so restrict to the
    // uniformly-spaced interior where a plain second difference is meaningful.
    for (let i = 2; i <= rows.length - 3; i++) {
      const age = rows[i][0];
      for (const [name, col] of SERIES) {
        const d2 = Math.abs(rows[i - 1][col] - 2 * rows[i][col] + rows[i + 1][col]);
        const limit = age === CHART_JUNCTION_AGE
          ? SMOOTHNESS_BOUNDS[name].junction
          : SMOOTHNESS_BOUNDS[name].normal;
        assert.ok(
          d2 <= limit,
          `${sex} ${name} @${age}mo: 2nd difference ${d2.toExponential(3)} exceeds ${limit} ` +
          `(${rows[i - 1][col]}, ${rows[i][col]}, ${rows[i + 1][col]})`,
        );
      }
    }
  }
});

// ---------------------------------------------------------------------------
// 3. END-TO-END — the table's values, through the real consumer, over the
//    entire input range the product accepts
// ---------------------------------------------------------------------------

test("every input validate.js accepts produces a finite, ordered projection", () => {
  // heightForZScore computes M * (1 + L*S*z)^(1/L). When (1 + L*S*z) goes
  // negative, Math.pow of a negative base with a fractional exponent is NaN,
  // and range.js then feeds that NaN into Math.max() for the agreement spread
  // and prints it in the confidence copy. The margin is thin and lives
  // entirely in this table: measured over the whole accepted window the
  // smallest value of (1 + L*S*(z-0.5)) at age 240 is 0.031, and female L at
  // 240 only has to exceed ~1.143 (it is 1.108) to make a real, accepted input
  // render NaN. So this is a data assertion, not a code assertion.
  const ageMin = BOUNDS.age.min, ageMax = BOUNDS.age.max;
  const hMin = BOUNDS.child.min, hMax = BOUNDS.child.max;

  for (const sex of SEXES) {
    for (let months = ageMin * 12; months <= ageMax * 12; months += 1) {
      for (let heightCm = hMin; heightCm <= hMax; heightCm += 2) {
        const r = projectAdultHeight({ sex, ageYears: months / 12, heightCm });
        const where = `${sex} age ${(months / 12).toFixed(2)}y height ${heightCm}cm`;
        for (const key of ["z", "percentile", "adultCm", "lowCm", "highCm"]) {
          assert.ok(Number.isFinite(r[key]), `${where}: ${key} is ${r[key]}`);
        }
        assert.ok(r.adultCm > 0, `${where}: adultCm ${r.adultCm} is not a stature`);
        assert.ok(r.percentile >= 0 && r.percentile <= 100, `${where}: percentile ${r.percentile}`);
        assert.ok(r.lowCm < r.adultCm && r.adultCm < r.highCm, `${where}: band does not bracket point`);
      }
    }
  }
});

// ---------------------------------------------------------------------------
// 4. FINGERPRINT
// ---------------------------------------------------------------------------

test("table content fingerprint — no value changes without a deliberate edit", () => {
  // This file is transcribed reference data from
  // https://www.cdc.gov/growthcharts/data/zscore/statage.csv and should only
  // ever change when someone re-derives it from that source. The shape tests
  // above catch consequential typos and say what is wrong; this catches the
  // rest, including a slip in the last significant digit.
  //
  // TO UPDATE: re-derive the table from the CDC source, diff it row by row,
  // then paste the new digest below. Do not update this to make it pass.
  const canonical = SEXES
    .map((sex) => `${sex}:${CDC_STATURE_LMS[sex].map((row) => row.join(",")).join(";")}`)
    .join("|");
  const digest = createHash("sha256").update(canonical).digest("hex");

  assert.equal(CDC_STATURE_LMS.male.length, 218, "male row count changed");
  assert.equal(CDC_STATURE_LMS.female.length, 218, "female row count changed");
  assert.equal(
    digest,
    "969f4c244794e687bea1cf97bbb7b7c719de89b1b026e7ceba43e13033c850bd",
    "CDC LMS table content changed — re-verify against the CDC source before updating this digest",
  );
});
