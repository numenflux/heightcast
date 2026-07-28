import test from "node:test";
import assert from "node:assert/strict";
import {
  inToCm, cmToIn, lbToKg, kgToLb, ftInToIn, roundTo, formatFtIn, formatCm,
  CM_PER_IN, KG_PER_LB,
} from "../js/convert.js";

const close = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) <= eps, `${a} !~= ${b}`);

test("exact factors", () => {
  assert.equal(CM_PER_IN, 2.54);
  assert.equal(KG_PER_LB, 0.45359237);
});

test("length conversions", () => {
  close(inToCm(1), 2.54);
  close(cmToIn(2.54), 1);
  close(inToCm(70), 177.8);           // 5'10" = 177.8 cm
  close(ftInToIn(5, 10), 70);
});

test("mass conversions", () => {
  close(lbToKg(1), 0.45359237);
  close(kgToLb(0.45359237), 1);
  close(lbToKg(100), 45.359237);
});

test("round trips are lossless", () => {
  for (const v of [1, 63.5, 150, 177.8, 200.25]) close(cmToIn(inToCm(v)), v, 1e-9);
  for (const v of [1, 45, 76.3, 150]) close(kgToLb(lbToKg(v)), v, 1e-9);
});

test("roundTo", () => {
  close(roundTo(71.6, 0.5), 71.5);
  close(roundTo(71.8, 0.5), 72);
  close(roundTo(71.8, 1), 72);
});

test("formatFtIn half-inch and whole-inch", () => {
  assert.equal(formatFtIn(70), `5'10"`);
  assert.equal(formatFtIn(71.5), `5'11½"`);
  assert.equal(formatFtIn(59.5), `4'11½"`);
  assert.equal(formatFtIn(72), `6'0"`);
  assert.equal(formatFtIn(70, { half: false }), `5'10"`);
});

test("formatFtIn guards rounding up to 12 inches", () => {
  // 71.8 -> nearest whole inch 72 -> should roll to 6'0", not 5'12"
  assert.equal(formatFtIn(71.8, { half: false }), `6'0"`);
  // 83.9 -> 84 -> 7'0"
  assert.equal(formatFtIn(83.9, { half: false }), `7'0"`);
});

test("formatCm", () => {
  assert.equal(formatCm(177.8, { decimals: 0 }), "178 cm");
  assert.equal(formatCm(177.84, { decimals: 1 }), "177.8 cm");
});
