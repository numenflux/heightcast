// validate.js — kind, strict input validation (pure).
//
// Accepts the raw form input (in the user's chosen unit system) and returns
// { ok, errors, warnings, value }. Absurd values are rejected with friendly,
// teen-readable messages rather than silently producing nonsense.

import { inToCm, lbToKg } from "./convert.js";

// Plausibility bounds, expressed in canonical units (cm / kg).
export const BOUNDS = {
  age:    { min: 4,   max: 17,  unit: "years" },   // primary-method range
  child:  { min: 50,  max: 220, unit: "cm" },      // ~20 in .. 7'2"
  weight: { min: 8,   max: 200, unit: "kg" },      // ~18 lb .. 440 lb
  parent: { min: 120, max: 230, unit: "cm" },      // ~3'11" .. 7'6"
};

function isNum(v) { return typeof v === "number" && Number.isFinite(v); }

// Convert a length/weight in the chosen unit system to canonical cm/kg.
function toCm(v, units) { return units === "imperial" ? inToCm(v) : v; }
function toKg(v, units) { return units === "imperial" ? lbToKg(v) : v; }

export function validateInputs(input = {}) {
  const errors = {};
  const warnings = [];
  const units = input.units === "imperial" ? "imperial" : "metric";

  // sex
  if (input.sex !== "male" && input.sex !== "female") {
    errors.sex = "Pick male or female — the growth curves differ.";
  }

  // age
  if (!isNum(input.ageYears)) {
    errors.ageYears = "Enter your age in years.";
  } else if (input.ageYears < BOUNDS.age.min) {
    errors.ageYears = "This predictor is validated for ages 4 and up.";
  } else if (input.ageYears > BOUNDS.age.max) {
    errors.ageYears = "By 18 you're within a hair of your adult height. Enter an age from 4 to 17.";
  } else if (input.ageYears >= 16) {
    warnings.push("At 16–17 you may already be close to your adult height, so the range will be tight.");
  }

  // helper for the four measurements
  const checkLen = (field, raw, bound, label) => {
    if (!isNum(raw)) { errors[field] = `Enter ${label}.`; return; }
    if (raw <= 0)    { errors[field] = `${label[0].toUpperCase()}${label.slice(1)} must be a positive number.`; return; }
    const cm = toCm(raw, units);
    if (cm < bound.min || cm > bound.max) {
      errors[field] = `That ${label} looks off — double-check the number and that the unit toggle is right.`;
    }
  };

  checkLen("height", input.height, BOUNDS.child, "your current height");
  checkLen("motherHeight", input.motherHeight, BOUNDS.parent, "your mother's height");
  checkLen("fatherHeight", input.fatherHeight, BOUNDS.parent, "your father's height");

  // weight
  if (!isNum(input.weight)) {
    errors.weight = "Enter your current weight.";
  } else if (input.weight <= 0) {
    errors.weight = "Weight must be a positive number.";
  } else {
    const kg = toKg(input.weight, units);
    if (kg < BOUNDS.weight.min || kg > BOUNDS.weight.max) {
      errors.weight = "That weight looks off — double-check the number and the unit toggle.";
    }
  }

  const ok = Object.keys(errors).length === 0;
  return {
    ok,
    errors,
    warnings,
    value: ok ? { ...input, units } : null,
  };
}
