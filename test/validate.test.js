import test from "node:test";
import assert from "node:assert/strict";
import { validateInputs, BOUNDS } from "../js/validate.js";

const good = {
  sex: "male", ageYears: 10, units: "metric",
  height: 138, weight: 34, motherHeight: 163, fatherHeight: 178,
};

test("accepts a valid metric input", () => {
  const r = validateInputs(good);
  assert.equal(r.ok, true);
  assert.deepEqual(r.errors, {});
  assert.equal(r.value.units, "metric");
});

test("accepts a valid imperial input", () => {
  const r = validateInputs({
    sex: "female", ageYears: 12, units: "imperial",
    height: 60, weight: 92, motherHeight: 63, fatherHeight: 69,
  });
  assert.equal(r.ok, true);
});

test("age below 4 rejected kindly", () => {
  const r = validateInputs({ ...good, ageYears: 3 });
  assert.equal(r.ok, false);
  assert.match(r.errors.ageYears, /4 and up/);
});

test("age above 17 rejected", () => {
  const r = validateInputs({ ...good, ageYears: 18 });
  assert.equal(r.ok, false);
  assert.ok(r.errors.ageYears);
});

test("age 16 valid but warns about being near-final", () => {
  const r = validateInputs({ ...good, ageYears: 16 });
  assert.equal(r.ok, true);
  assert.ok(r.warnings.some((w) => /close to your adult height/i.test(w)));
});

test("absurd child height rejected (metric)", () => {
  const r = validateInputs({ ...good, height: 300 });
  assert.equal(r.ok, false);
  assert.ok(r.errors.height);
});

test("absurd child height rejected (imperial inches)", () => {
  const r = validateInputs({ ...good, units: "imperial", height: 200, weight: 90, motherHeight: 64, fatherHeight: 70 });
  assert.equal(r.ok, false);
  assert.ok(r.errors.height);
});

test("negative and non-numeric values rejected", () => {
  assert.equal(validateInputs({ ...good, weight: -5 }).ok, false);
  assert.equal(validateInputs({ ...good, ageYears: NaN }).ok, false);
  assert.equal(validateInputs({ ...good, height: "tall" }).ok, false);
});

test("missing/invalid sex rejected", () => {
  const r = validateInputs({ ...good, sex: undefined });
  assert.equal(r.ok, false);
  assert.ok(r.errors.sex);
});

test("parent height out of range rejected", () => {
  assert.ok(validateInputs({ ...good, fatherHeight: 300 }).errors.fatherHeight);
  assert.ok(validateInputs({ ...good, motherHeight: 90 }).errors.motherHeight);
});

test("BOUNDS documents the validated age window", () => {
  assert.equal(BOUNDS.age.min, 4);
  assert.equal(BOUNDS.age.max, 17);
});
