import test from "node:test";
import assert from "node:assert/strict";
import { buildResult, fmtRange, fmtPoint } from "../js/range.js";
import { inToCm, formatFtIn } from "../js/convert.js";

const close = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps, `${a} !~= ${b}`);

test("invalid input short-circuits with errors", () => {
  const r = buildResult({ sex: "male", ageYears: 2, units: "metric", height: 90, weight: 14, motherHeight: 160, fatherHeight: 175 });
  assert.equal(r.ok, false);
  assert.ok(r.errors.ageYears);
});

test("full result: three methods, headline range, confidence", () => {
  // Imperial worked example (same as khamis-roche.test): 10yo boy.
  const r = buildResult({
    sex: "male", ageYears: 10, units: "imperial",
    height: 54.5, weight: 76, motherHeight: 64, fatherHeight: 70,
  });
  assert.equal(r.ok, true);

  // Khamis-Roche point matches the hand-computed inches -> cm value.
  close(r.methods.khamisRoche.pointCm, inToCm(69.636459), 1e-6);
  // headline uses the K-R point and its 90% band.
  close(r.headline.pointCm, inToCm(69.636459), 1e-6);
  close(r.headline.lowCm, inToCm(69.636459 - 2.101), 1e-6);
  close(r.headline.highCm, inToCm(69.636459 + 2.101), 1e-6);

  // all three methods present
  assert.ok(r.methods.khamisRoche.available);
  assert.ok(r.methods.midparental.available);
  assert.ok(r.methods.percentile.available);

  // ordering invariant
  assert.ok(r.headline.lowCm < r.headline.pointCm);
  assert.ok(r.headline.pointCm < r.headline.highCm);

  // display strings exist for both unit systems
  assert.match(r.headline.point.ftin, /^\d+'\d+½?"$/);
  assert.match(r.headline.range.cm, /\d+–\d+ cm/);

  // confidence is plain-English and flags "estimate, not ... medical advice"
  assert.match(r.confidence, /estimate/i);
  assert.match(r.confidence, /medical advice/i);
});

test("fmtPoint and fmtRange produce both unit systems", () => {
  const p = fmtPoint(inToCm(69.636459)); // -> 5'9½" and cm
  assert.equal(p.ftin, formatFtIn(69.636459)); // 5'9½"
  assert.match(p.cm, /cm$/);

  const rng = fmtRange(inToCm(67.5), inToCm(72));
  assert.equal(rng.ftin, `5'8"–6'0"`);
  assert.match(rng.cm, /^\d+–\d+ cm$/);
});

test("agreement spread is reported", () => {
  const r = buildResult({
    sex: "female", ageYears: 12, units: "imperial",
    height: 60, weight: 92, motherHeight: 63, fatherHeight: 69,
  });
  assert.equal(typeof r.spreadCm, "number");
  assert.equal(typeof r.agree, "boolean");
});
