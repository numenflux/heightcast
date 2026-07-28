// convert.js — pure unit conversions and height formatting.
// No DOM, no dependencies. Imported by both the page and the test suite.

// Exact conversion factors.
export const CM_PER_IN = 2.54;          // exact by definition
export const KG_PER_LB = 0.45359237;    // exact by definition

// ---- length ----
export function inToCm(inches) { return inches * CM_PER_IN; }
export function cmToIn(cm)     { return cm / CM_PER_IN; }

// ---- mass ----
export function lbToKg(lb) { return lb * KG_PER_LB; }
export function kgToLb(kg) { return kg / KG_PER_LB; }

// feet+inches <-> total inches
export function ftInToIn(feet, inches) { return feet * 12 + inches; }

// Round a value to the nearest `step`.
export function roundTo(value, step) { return Math.round(value / step) * step; }

// Format a total-inches value as e.g. 5'11½"  (half-inch precision by default).
// half:false rounds to whole inches -> 5'10"
export function formatFtIn(totalInches, { half = true } = {}) {
  const step = half ? 0.5 : 1;
  let r = roundTo(totalInches, step);
  let feet = Math.floor(r / 12);
  let inches = r - feet * 12;
  if (inches >= 12) { feet += 1; inches -= 12; } // guard rounding to 12
  const whole = Math.floor(inches + 1e-9);
  const frac = inches - whole;
  const fracStr = frac >= 0.5 ? "½" : ""; // ½
  return `${feet}'${whole}${fracStr}"`;
}

// Format centimetres. decimals:0 -> "178 cm", decimals:1 -> "177.8 cm"
export function formatCm(cm, { decimals = 0 } = {}) {
  return `${cm.toFixed(decimals)} cm`;
}
