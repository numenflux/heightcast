import test from "node:test";
import assert from "node:assert/strict";
import { predictMidparental, TARGET_RANGE_CM, MID_PARENT_SEX_DELTA_CM } from "../js/midparental.js";

const close = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) <= eps, `${a} !~= ${b}`);

test("constants", () => {
  assert.equal(MID_PARENT_SEX_DELTA_CM, 13);
  assert.equal(TARGET_RANGE_CM, 8.5);
});

test("boys target = (mother + father + 13)/2 with ±8.5 band", () => {
  const r = predictMidparental({ sex: "male", motherCm: 165, fatherCm: 178 });
  close(r.targetCm, 178);            // (165 + 178 + 13)/2
  close(r.midParentCm, 171.5);
  close(r.lowCm, 169.5);
  close(r.highCm, 186.5);
  close(r.rangeCm, 8.5);
});

test("girls target = (mother + father − 13)/2 with ±8.5 band", () => {
  const r = predictMidparental({ sex: "female", motherCm: 165, fatherCm: 178 });
  close(r.targetCm, 165);            // (165 + 178 − 13)/2
  close(r.lowCm, 156.5);
  close(r.highCm, 173.5);
});

test("boys−girls difference for same parents equals 13 cm", () => {
  const b = predictMidparental({ sex: "male", motherCm: 160, fatherCm: 175 });
  const g = predictMidparental({ sex: "female", motherCm: 160, fatherCm: 175 });
  close(b.targetCm - g.targetCm, 13);
});

test("rejects unknown sex", () => {
  assert.throws(() => predictMidparental({ sex: "n/a", motherCm: 160, fatherCm: 175 }));
});
