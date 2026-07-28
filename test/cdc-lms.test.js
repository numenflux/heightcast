import test from "node:test";
import assert from "node:assert/strict";
import {
  lookupLMS, heightZScore, heightForZScore, normalCdf, percentileFromZ,
  projectAdultHeight, ADULT_AGE_MONTHS,
} from "../js/cdc-lms.js";

const close = (a, b, eps) => assert.ok(Math.abs(a - b) <= eps, `${a} !~= ${b}`);

test("adult endpoint LMS matches bundled CDC data (male, 240 mo)", () => {
  const { L, M, S } = lookupLMS("male", 240);
  close(L, 1.167279, 1e-6);
  close(M, 176.8492, 1e-4);
  close(S, 0.0403696, 1e-7);
  assert.equal(ADULT_AGE_MONTHS, 240);
});

test("z-score at the median is ~0 and inverts", () => {
  const { M } = lookupLMS("male", 240);
  close(heightZScore("male", 240, M), 0, 1e-9);
  close(heightForZScore("male", 240, 0), M, 1e-9);
});

test("normal CDF: known points and symmetry", () => {
  close(normalCdf(0), 0.5, 1e-6);
  close(percentileFromZ(0), 50, 1e-6);
  close(percentileFromZ(1.2816), 90, 0.3);   // 90th centile z
  close(normalCdf(1) + normalCdf(-1), 1, 1e-6);
});

test("projection: a child on the median channel lands on the adult median", () => {
  const { M } = lookupLMS("male", 120); // median height at age 10
  const r = projectAdultHeight({ sex: "male", ageYears: 10, heightCm: M });
  close(r.z, 0, 1e-9);
  close(r.adultCm, 176.8492, 0.01);
  close(r.percentile, 50, 0.5);
  assert.ok(r.lowCm < r.adultCm && r.adultCm < r.highCm, "band brackets the point");
});

test("projection is monotonic in current height", () => {
  const short = projectAdultHeight({ sex: "female", ageYears: 8, heightCm: 120 });
  const tall = projectAdultHeight({ sex: "female", ageYears: 8, heightCm: 135 });
  assert.ok(tall.adultCm > short.adultCm);
  assert.ok(tall.percentile > short.percentile);
});

test("rejects unknown sex", () => {
  assert.throws(() => lookupLMS("nope", 120));
});
