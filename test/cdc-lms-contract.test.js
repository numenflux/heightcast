// cdc-lms.contract — the guarantees js/cdc-lms.js makes to the rendered page.
//
// cdc-lms.test.js already checks the happy path (median child in, median adult
// out). This file covers the failure modes: hostile / out-of-table input, the
// Box-Cox singularity the CDC tables genuinely contain, and the numeric
// promises stated in the source comments. Those comments ARE the spec:
//
//   * "sex must be 'male' or 'female'"          -> a named error, not a crash
//   * "clamp to table range"                    -> never extrapolate off the CDC data
//   * `if (Math.abs(L) < 1e-7)`                 -> the L->0 limit must stay exact
//   * "Band: +/-0.5 z"                          -> the honesty envelope, exactly 0.5
//   * "|err| < 1.5e-7" on the erf approximation -> a measurable accuracy claim
//
// Blast radius: app.js renders `Math.round(m.percentile.percentile)` and
// `pointCm.toFixed(1)` straight into the page. A NaN or a silently-wrong z here
// is a visitor reading "~NaNth percentile now" on the live site, so every test
// below asserts the STRONG property (the right value / a strict ordering), never
// the weak one ("it returned something", "it threw"). "It threw" is exactly what
// this file's predecessor asserted, and deleting the sex guard still throws.

import test from "node:test";
import assert from "node:assert/strict";
import {
  lookupLMS, heightZScore, heightForZScore, normalCdf, percentileFromZ,
  projectAdultHeight, ADULT_AGE_MONTHS,
} from "../js/cdc-lms.js";
import { CDC_STATURE_LMS } from "../js/cdc-data.js";
import { BOUNDS } from "../js/validate.js";

const close = (a, b, eps, msg) =>
  assert.ok(Math.abs(a - b) <= eps, `${msg ? msg + ": " : ""}${a} !~= ${b} (eps ${eps})`);

const SEXES = ["male", "female"];

// ---------------------------------------------------------------------------
// 1. bad `sex` — the documented error, not an incidental TypeError
// ---------------------------------------------------------------------------

test("lookupLMS rejects an unknown sex with its documented error", () => {
  // Weak version of this test ("assert.throws(() => lookupLMS('nope'))") passes
  // even with the `if (!rows) throw` guard deleted, because `rows[0][0]` throws
  // a TypeError on the very next line. Only the message proves the guard ran.
  for (const bad of ["nope", "MALE", "boy", "", null, undefined, 0, {}]) {
    assert.throws(
      () => lookupLMS(bad, 120),
      (err) => err instanceof Error && /sex must be 'male' or 'female'/.test(err.message),
      `sex=${JSON.stringify(bad)} must be refused by name, not by crashing`,
    );
  }
});

// ---------------------------------------------------------------------------
// 2. age clamping — never extrapolate off the CDC table
// ---------------------------------------------------------------------------

test("lookupLMS clamps below the table instead of extrapolating", () => {
  for (const sex of SEXES) {
    const first = CDC_STATURE_LMS[sex][0];         // [ageMonths, L, M, S]
    const atFloor = { L: first[1], M: first[2], S: first[3] };
    assert.equal(first[0], 24, "CDC stature tables start at 24 months");

    for (const tooYoung of [0, 1, 12, 23.9, -1000]) {
      const got = lookupLMS(sex, tooYoung);
      assert.deepEqual(got, atFloor, `age ${tooYoung} mo must resolve to the 24-month row`);
      // Explicit anti-"it returned something" assertion: with the low clamp
      // removed the loop matches nothing and the trailing fallback hands back
      // the AGE-20 row (M ~ 163-177 cm) for a toddler. A toddler median is
      // ~86 cm, so this bound alone separates clamped from un-clamped.
      assert.ok(got.M < 100, `clamped median must be a toddler's (~86 cm), got ${got.M}`);
    }
  }
});

test("lookupLMS never extrapolates above the table", () => {
  // Weaker than the low-clamp test on purpose, and flagged as such: the
  // trailing `return last` fallback returns the same row the upper clamp
  // produces, so removing `Math.min(maxA, ...)` is not observable here. This
  // pins the OBSERVABLE contract (adult LMS, no extrapolation) rather than
  // pretending to cover the clamp itself.
  for (const sex of SEXES) {
    const rows = CDC_STATURE_LMS[sex];
    const last = rows[rows.length - 1];
    assert.equal(last[0], ADULT_AGE_MONTHS, "table endpoint is the projection endpoint");
    const atCeiling = { L: last[1], M: last[2], S: last[3] };
    for (const tooOld of [ADULT_AGE_MONTHS, 300, 1e4]) {
      assert.deepEqual(lookupLMS(sex, tooOld), atCeiling, `age ${tooOld} mo`);
    }
  }
});

// ---------------------------------------------------------------------------
// 3. the L -> 0 singularity, which the bundled CDC data really contains
// ---------------------------------------------------------------------------

// Ages (months) where the interpolated Box-Cox power L passes through zero.
// These are not hypothetical: the female table crosses at ~57.8 months
// (4.81 yr) and ~102.3 months (8.53 yr), both inside this app's validated
// 4-17 year window; the male table crosses at ~32.2 and ~39.5 months.
function zeroLAges(sex) {
  const rows = CDC_STATURE_LMS[sex];
  const out = [];
  for (let i = 0; i < rows.length - 1; i++) {
    const [a0, L0] = rows[i];
    const [a1, L1] = rows[i + 1];
    if ((L0 < 0) !== (L1 < 0)) out.push(a0 + (a1 - a0) * (L0 / (L0 - L1)));
  }
  return out;
}

test("the CDC tables really do drive L through zero inside the served age range", () => {
  // Guards the premise of the next two tests. If a future data refresh removes
  // the crossing, those tests silently stop testing anything — this fails loudly.
  const female = zeroLAges("female");
  assert.ok(female.length >= 1, "female table must contain an L zero-crossing");
  assert.ok(
    female.some((a) => a / 12 >= BOUNDS.age.min && a / 12 <= BOUNDS.age.max),
    `an L zero-crossing must fall inside the validated ${BOUNDS.age.min}-${BOUNDS.age.max} yr window`,
  );
  for (const sex of SEXES) {
    for (const a of zeroLAges(sex)) {
      assert.ok(Math.abs(lookupLMS(sex, a).L) < 1e-15, `|L| at ${sex} ${a} mo must be ~0`);
    }
  }
});

test("heightZScore stays exact where L collapses to zero", () => {
  for (const sex of SEXES) {
    for (const a of zeroLAges(sex)) {
      const { M, S } = lookupLMS(sex, a);
      for (const ratio of [0.85, 0.97, 1, 1.03, 1.18]) {
        const h = M * ratio;
        const z = heightZScore(sex, a, h);
        // The lognormal limit of the LMS transform as L -> 0.
        const want = Math.log(h / M) / S;
        assert.ok(Number.isFinite(z), `z must be finite at ${sex} ${a} mo, h=${h}`);
        close(z, want, 1e-12, `${sex} @${a}mo h=${h}`);
        // Without the `Math.abs(L) < 1e-7` branch, `Math.pow(h/M, ~1e-17)`
        // rounds to exactly 1, so the general formula returns (1-1)/tiny = 0 —
        // i.e. EVERY child at this age reads as the 50th percentile. Asserting
        // only "z is finite" would pass on that; asserting the sign does not.
        if (ratio !== 1) assert.ok(z !== 0, `z must not collapse to 0 for h=${h} (M=${M})`);
        assert.equal(Math.sign(z), Math.sign(ratio - 1), "z must follow height above/below the median");
      }
    }
  }
});

test("heightForZScore stays invertible where L collapses to zero", () => {
  for (const sex of SEXES) {
    for (const a of zeroLAges(sex)) {
      const { M, S } = lookupLMS(sex, a);
      for (const z of [-2, -0.5, 0, 0.5, 2]) {
        const h = heightForZScore(sex, a, z);
        assert.ok(Number.isFinite(h), `height must be finite at ${sex} ${a} mo, z=${z}`);
        close(h, M * Math.exp(S * z), 1e-9, `${sex} @${a}mo z=${z}`);
        // Without the guard, `Math.pow(1 + 0, 1/~1e-17)` is pow(1, huge) = 1,
        // so every z returns exactly M and the +/-0.5 band collapses to a point.
        if (z !== 0) assert.notEqual(h, M, `z=${z} must not collapse onto the median`);
      }
      assert.ok(
        heightForZScore(sex, a, -1) < M && M < heightForZScore(sex, a, 1),
        "z ordering must survive the L->0 branch",
      );
    }
  }
});

// ---------------------------------------------------------------------------
// 4. the LMS transform and its inverse must actually be inverses
// ---------------------------------------------------------------------------

test("z-score and its inverse round-trip across the whole served domain", () => {
  // The existing suite only checks z = 0, where M * pow(1 + 0, anything) = M —
  // so swapping the inverse exponent 1/L for L survives every test in
  // cdc-lms.test.js. This does not.
  for (const sex of SEXES) {
    for (let ageMonths = 24; ageMonths <= ADULT_AGE_MONTHS; ageMonths += 6) {
      const { M } = lookupLMS(sex, ageMonths);
      for (const ratio of [0.7, 0.9, 1.05, 1.3]) {
        const h = M * ratio;
        const z = heightZScore(sex, ageMonths, h);
        const back = heightForZScore(sex, ageMonths, z);
        assert.ok(Number.isFinite(z) && Number.isFinite(back), `${sex} @${ageMonths}mo h=${h}`);
        close(back / h, 1, 1e-9, `round-trip ${sex} @${ageMonths}mo ratio=${ratio}`);
      }
      // z must be strictly increasing in height at every age.
      assert.ok(
        heightZScore(sex, ageMonths, M * 0.9) < heightZScore(sex, ageMonths, M) &&
        heightZScore(sex, ageMonths, M) < heightZScore(sex, ageMonths, M * 1.1),
        `z must be monotone in height at ${sex} ${ageMonths} mo`,
      );
    }
  }
});

// ---------------------------------------------------------------------------
// 5. the headline promise: the projection stays on the child's own channel
// ---------------------------------------------------------------------------

test("the projected adult height sits on the child's own percentile channel", () => {
  // "find the child's current height percentile, then read off the stature at
  // that same percentile at age 20" — so re-measuring the answer at 240 months
  // must return the SAME z. Asserting only "adultCm is a plausible number"
  // would pass on a projection read off the wrong age entirely.
  for (const sex of SEXES) {
    for (const ageYears of [4, 6.5, 9, 12, 14.5, 17]) {
      const { M } = lookupLMS(sex, ageYears * 12);
      for (const ratio of [0.85, 1, 1.15]) {
        const r = projectAdultHeight({ sex, ageYears, heightCm: M * ratio });
        assert.equal(r.available, true, "range.js gates the whole card on `available`");
        close(heightZScore(sex, ADULT_AGE_MONTHS, r.adultCm), r.z, 1e-9,
          `channel drift ${sex} @${ageYears}yr ratio=${ratio}`);
        close(r.percentile, percentileFromZ(r.z), 1e-12, "reported percentile must match z");
      }
      // A child exactly on the median channel must land on the adult median.
      const median = projectAdultHeight({ sex, ageYears, heightCm: M });
      close(median.z, 0, 1e-9, "median child z");
      close(median.adultCm, lookupLMS(sex, ADULT_AGE_MONTHS).M, 1e-9, "median child adult stature");
    }
  }
});

test("the published band is exactly +/-0.5 z and strictly brackets the point", () => {
  // The comment calls this "an honest, modest uncertainty envelope" — widening
  // or narrowing it silently is a truthfulness change, not a cosmetic one.
  for (const sex of SEXES) {
    for (const ageYears of [4, 8, 11, 15, 17]) {
      const { M } = lookupLMS(sex, ageYears * 12);
      for (const ratio of [0.88, 1, 1.12]) {
        const r = projectAdultHeight({ sex, ageYears, heightCm: M * ratio });
        close(heightZScore(sex, ADULT_AGE_MONTHS, r.lowCm), r.z - 0.5, 1e-9, "low edge is z-0.5");
        close(heightZScore(sex, ADULT_AGE_MONTHS, r.highCm), r.z + 0.5, 1e-9, "high edge is z+0.5");
        assert.ok(r.lowCm < r.adultCm && r.adultCm < r.highCm, "band must strictly bracket");
      }
    }
  }
});

// ---------------------------------------------------------------------------
// 6. the normal CDF — a stated accuracy claim and a signed-input guard
// ---------------------------------------------------------------------------

// Reference values of the standard normal CDF.
const PHI = [
  [0, 0.5],
  [0.5, 0.6914624612740131],
  [1, 0.8413447460685429],
  [1.2815515655446004, 0.9],
  [1.6448536269514722, 0.95],
  [1.959963984540054, 0.975],
  [2.5758293035489004, 0.995],
  [3, 0.9986501019683699],
  [4, 0.9999683287581669],
];

test("normalCdf meets the documented |err| < 1.5e-7 accuracy claim", () => {
  // The source cites A&S 7.1.26 with |err| < 1.5e-7 on erf; since
  // Phi = (1 + erf)/2 that is 7.5e-8 on Phi. Observed worst case is 6.9e-8,
  // so this bound is tight enough that a single perturbed coefficient fails it
  // while leaving the existing suite's 0.3-percentile tolerance green.
  const SPEC = 1.5e-7 / 2;
  for (const [z, p] of PHI) {
    close(normalCdf(z), p, SPEC, `Phi(${z})`);
    close(normalCdf(-z), 1 - p, SPEC, `Phi(${-z})`);
    close(percentileFromZ(z), p * 100, SPEC * 100, `percentile(${z})`);
  }
});

test("normalCdf handles negative z and never leaves [0, 100]", () => {
  // erf() is only valid for x >= 0; the sign/abs pair is the guard. Drop it and
  // t = 1/(1 + 0.3275911*x) blows up through a pole at x = -3.0526, throwing the
  // percentile far outside [0,100] — which app.js would render as a percentile.
  let prev = -Infinity;
  for (let z = -40; z <= 40; z += 0.005) {
    const p = percentileFromZ(z);
    assert.ok(Number.isFinite(p), `percentile must be finite at z=${z}`);
    assert.ok(p >= 0 && p <= 100, `percentile out of range at z=${z}: ${p}`);
    assert.ok(p >= prev - 1e-12, `percentile must not decrease at z=${z}`);
    prev = p;
    close(normalCdf(z) + normalCdf(-z), 1, 1e-9, `symmetry at z=${z}`);
  }
  // The pole the abs() protects against, checked directly.
  assert.ok(Number.isFinite(normalCdf(-3.0525630587 * Math.SQRT2)), "no pole for negative z");
  close(percentileFromZ(-1e3), 0, 1e-12, "far left saturates at 0, not below");
  close(percentileFromZ(1e3), 100, 1e-12, "far right saturates at 100, not above");
});

// ---------------------------------------------------------------------------
// 7. page-safety sweep over everything validate.js will actually admit
// ---------------------------------------------------------------------------

test("every validator-admissible input yields renderable numbers", () => {
  // app.js does `Math.round(percentile)` and `cm.toFixed(1)` with no NaN check,
  // so a single non-finite field here is visible garbage on the published page.
  // The sweep deliberately includes the exact L->0 ages, which is what makes it
  // fail when either singularity guard is removed.
  const ages = [BOUNDS.age.min, 5.5, 7.29, 8, 10, 12, 14, 16, BOUNDS.age.max];
  for (const sex of SEXES) for (const a of zeroLAges(sex)) {
    const yr = a / 12;
    if (yr >= BOUNDS.age.min && yr <= BOUNDS.age.max) ages.push(yr);
  }
  const heights = [BOUNDS.child.min, 60, 90, 120, 150, 180, BOUNDS.child.max];

  for (const sex of SEXES) {
    for (const ageYears of ages) {
      for (const heightCm of heights) {
        const r = projectAdultHeight({ sex, ageYears, heightCm });
        const where = `${sex} age=${ageYears} h=${heightCm}`;
        for (const k of ["z", "percentile", "adultCm", "lowCm", "highCm"]) {
          assert.ok(Number.isFinite(r[k]), `${k} must be finite (${where}) — got ${r[k]}`);
        }
        assert.ok(r.percentile >= 0 && r.percentile <= 100, `percentile in range (${where})`);
        assert.ok(r.lowCm < r.adultCm && r.adultCm < r.highCm, `band brackets (${where})`);
        assert.ok(r.adultCm > 0, `adult stature must be positive (${where})`);
      }
      // Taller child in, taller adult out — at every admissible age.
      const short = projectAdultHeight({ sex, ageYears, heightCm: 110 });
      const tall = projectAdultHeight({ sex, ageYears, heightCm: 140 });
      assert.ok(tall.adultCm > short.adultCm, `monotone in height at ${sex} ${ageYears}yr`);
      assert.ok(tall.percentile > short.percentile, `percentile monotone at ${sex} ${ageYears}yr`);
    }
  }
});
