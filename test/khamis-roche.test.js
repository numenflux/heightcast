import test from "node:test";
import assert from "node:assert/strict";
import { predictKhamisRoche, ageToIndex, KR_COEFFS } from "../js/khamis-roche.js";

const close = (a, b, eps = 1e-4) => assert.ok(Math.abs(a - b) <= eps, `${a} !~= ${b}`);

test("coefficient tables have 28 half-year rows each", () => {
  for (const sex of ["male", "female"]) {
    for (const key of ["B0", "height", "weight", "midparent"]) {
      assert.equal(KR_COEFFS[sex][key].length, 28, `${sex}.${key}`);
    }
  }
});

test("verified reference coefficients (age-10 male)", () => {
  // Matches Pediatrics 1995 errata values as published by UW MSK / Calculator Academy.
  assert.equal(KR_COEFFS.male.B0[12], -11.0380);
  assert.equal(KR_COEFFS.male.height[12], 0.97135);
  assert.equal(KR_COEFFS.male.weight[12], -0.039981);
  assert.equal(KR_COEFFS.male.midparent[12], 0.45932);
});

test("ageToIndex maps half-years correctly", () => {
  assert.equal(ageToIndex(4.0), 0);
  assert.equal(ageToIndex(10), 12);
  assert.equal(ageToIndex(12), 16);
  assert.equal(ageToIndex(17.5), 27);
  assert.equal(ageToIndex(3.9), 0);    // rounds up to 4.0
  assert.equal(ageToIndex(3.7), null); // rounds to 3.5 -> out of range
  assert.equal(ageToIndex(17.7), 27);  // rounds to 17.5
  assert.equal(ageToIndex(17.8), null);// rounds to 18 -> out of range
});

test("worked example — 10-year-old boy (hand-computed from published coeffs)", () => {
  // height 54.5 in, weight 76 lb, mother 64 in, father 70 in -> midparent 67 in
  // point = -11.0380 + 0.97135*54.5 + (-0.039981)*76 + 0.45932*67 = 69.636459 in
  const r = predictKhamisRoche({
    sex: "male", ageYears: 10, heightIn: 54.5, weightLb: 76, motherIn: 64, fatherIn: 70,
  });
  close(r.pointIn, 69.636459);
  assert.equal(r.index, 12);
  assert.equal(r.capped, false);
  close(r.low90In, 69.636459 - 2.101);
  close(r.high90In, 69.636459 + 2.101);
  close(r.low50In, 69.636459 - 0.851);
  close(r.coeffs.midparentIn, 67);
});

test("worked example — 12-year-old girl (hand-computed from published coeffs)", () => {
  // index 16: B0 4.84365, h 0.64452, w -0.04894, m 0.39490
  // point = 4.84365 + 0.64452*60 + (-0.04894)*92 + 0.39490*66 = 65.07577 in
  const r = predictKhamisRoche({
    sex: "female", ageYears: 12, heightIn: 60, weightLb: 92, motherIn: 63, fatherIn: 69,
  });
  close(r.pointIn, 65.07577);
  assert.equal(r.index, 16);
  close(r.high90In, 65.07577 + 1.675);
});

test("age past 17.5 is treated as near-final (capped)", () => {
  const r = predictKhamisRoche({
    sex: "male", ageYears: 18, heightIn: 70, weightLb: 150, motherIn: 64, fatherIn: 72,
  });
  assert.equal(r.capped, true);
  assert.equal(r.pointIn, 70);
  assert.equal(r.error90In, 0);
});

test("rejects unknown sex and out-of-range age", () => {
  assert.throws(() => predictKhamisRoche({ sex: "x", ageYears: 10, heightIn: 54, weightLb: 70, motherIn: 64, fatherIn: 70 }));
  assert.throws(() => predictKhamisRoche({ sex: "male", ageYears: 3, heightIn: 40, weightLb: 35, motherIn: 64, fatherIn: 70 }));
});
