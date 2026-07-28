// midparental.js — Tanner mid-parental "target height" (method b).
//
// Tanner JM, et al. (1970). The classic clinical target-height estimate:
//   Boys : (father + mother + 13 cm) / 2
//   Girls: (father + mother − 13 cm) / 2
// The ±13 cm term is the average adult male−female height difference, so the
// formula is defined in CENTIMETRES. Callers pass parent heights in cm.
//
// Target-height RANGE: ±8.5 cm (≈ ±3.3 in) around the target spans roughly the
// 3rd–97th centile of likely adult height. (Widely cited clinical band; see
// e.g. clinical growth references / heightcalculator.net summary of Tanner.)

export const MID_PARENT_SEX_DELTA_CM = 13; // adult male−female mean difference
export const TARGET_RANGE_CM = 8.5;        // ±8.5 cm (~3rd–97th centile band)

export function predictMidparental({ sex, motherCm, fatherCm }) {
  if (sex !== "male" && sex !== "female") {
    throw new Error(`sex must be 'male' or 'female', got ${sex}`);
  }
  const midParentCm = (motherCm + fatherCm) / 2;
  const targetCm = sex === "male"
    ? midParentCm + MID_PARENT_SEX_DELTA_CM / 2   // = (m + f + 13)/2
    : midParentCm - MID_PARENT_SEX_DELTA_CM / 2;  // = (m + f − 13)/2

  return {
    available: true,
    midParentCm,
    targetCm,
    lowCm: targetCm - TARGET_RANGE_CM,
    highCm: targetCm + TARGET_RANGE_CM,
    rangeCm: TARGET_RANGE_CM,
  };
}
