// cdc-lms.js — current-percentile projection (method c).
//
// Uses CDC 2000 stature-for-age LMS tables (js/cdc-data.js). The idea, a
// standard clinical heuristic: children tend to track their height percentile
// ("channel"). So we (1) find the child's current height percentile from the
// LMS values at their age, then (2) read off the stature at that same
// percentile at age 20 (240 months), the chart's near-adult endpoint.
//
// This is the LEAST reliable of the three methods before/through puberty
// because it ignores pubertal timing — surfaced honestly in the UI.

import { CDC_STATURE_LMS } from "./cdc-data.js";

export const ADULT_AGE_MONTHS = 240; // age 20 — CDC chart endpoint (near-final)

// Linearly interpolate the LMS parameters at an arbitrary age in months.
export function lookupLMS(sex, ageMonths) {
  const rows = CDC_STATURE_LMS[sex];
  if (!rows) throw new Error(`sex must be 'male' or 'female', got ${sex}`);
  const minA = rows[0][0];
  const maxA = rows[rows.length - 1][0];
  const a = Math.max(minA, Math.min(maxA, ageMonths)); // clamp to table range

  for (let i = 0; i < rows.length - 1; i++) {
    const [a0, L0, M0, S0] = rows[i];
    const [a1, L1, M1, S1] = rows[i + 1];
    if (a >= a0 && a <= a1) {
      if (a1 === a0) return { L: L0, M: M0, S: S0 };
      const t = (a - a0) / (a1 - a0);
      return { L: L0 + (L1 - L0) * t, M: M0 + (M1 - M0) * t, S: S0 + (S1 - S0) * t };
    }
  }
  const last = rows[rows.length - 1];
  return { L: last[1], M: last[2], S: last[3] };
}

// z-score of a stature (cm) at a given age via the LMS transform.
export function heightZScore(sex, ageMonths, heightCm) {
  const { L, M, S } = lookupLMS(sex, ageMonths);
  if (Math.abs(L) < 1e-7) return Math.log(heightCm / M) / S;
  return (Math.pow(heightCm / M, L) - 1) / (L * S);
}

// Inverse: stature (cm) for a z-score at a given age.
export function heightForZScore(sex, ageMonths, z) {
  const { L, M, S } = lookupLMS(sex, ageMonths);
  if (Math.abs(L) < 1e-7) return M * Math.exp(S * z);
  return M * Math.pow(1 + L * S * z, 1 / L);
}

// Normal CDF via Abramowitz & Stegun 7.1.26 erf approximation (|err| < 1.5e-7).
export function normalCdf(z) {
  return 0.5 * (1 + erf(z / Math.SQRT2));
}
function erf(x) {
  const sign = x < 0 ? -1 : 1;
  x = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * x);
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t
    - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return sign * y;
}

export function percentileFromZ(z) { return normalCdf(z) * 100; }

// Project current percentile channel forward to adult stature.
// Band: ±0.5 z ("if you drift about half a percentile channel") — an honest,
// modest uncertainty envelope, NOT a claim of precision.
export function projectAdultHeight({ sex, ageYears, heightCm }) {
  const ageMonths = ageYears * 12;
  const z = heightZScore(sex, ageMonths, heightCm);
  const adultCm = heightForZScore(sex, ADULT_AGE_MONTHS, z);
  const lowCm = heightForZScore(sex, ADULT_AGE_MONTHS, z - 0.5);
  const highCm = heightForZScore(sex, ADULT_AGE_MONTHS, z + 0.5);
  return {
    available: true,
    z,
    percentile: percentileFromZ(z),
    adultCm, lowCm, highCm,
  };
}
