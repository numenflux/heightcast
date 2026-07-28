// khamis-roche.js — Khamis-Roche adult-stature prediction (method a).
//
// Regression coefficients from:
//   Khamis HJ, Roche AF. "Predicting adult stature without using skeletal age:
//   the Khamis-Roche method." Pediatrics 1994;94(4):504-507.
//   Corrected (weight) coefficients: Pediatrics 1995;95(3):457 (errata).
// Coefficient tables transcribed from the reference implementation by
//   Michael L. Richardson, MD (UW MSK Radiology): http://uwmsk.org/stature.html
// Cross-checked: the age-10 male row below (B0 -11.0380, height 0.97135,
//   weight -0.039981, midparent 0.45932) matches independent published
//   values (Calculator Academy) to all listed digits.
//
// The published regression is defined in IMPERIAL units:
//   stature & parent heights in INCHES, body weight in POUNDS.
// Callers must pass imperial values; convert first with convert.js if needed.
//
// Index scheme: one coefficient row per half-year of age from 4.0 to 17.5
// (28 rows, index 0..27).  index = (round(age to nearest 0.5) - 4) * 2.

export const KR_COEFFS = {
  male: {
    B0: [-10.2567,-10.7190,-11.0213,-11.1556,-11.1138,-11.0221,-10.9984,-11.0214,-11.0696,-11.1220,-11.1571,-11.1405,-11.0380,-10.8286,-10.4917,-10.0065,-9.3522,-8.6055,-7.8632,-7.1348,-6.4299,-5.7578,-5.1282,-4.5092,-3.9292,-3.4873,-3.2830,-3.4156],
    height: [1.23812,1.15964,1.10674,1.07480,1.05923,1.05542,1.05877,1.06467,1.06853,1.06572,1.05166,1.02174,0.97135,0.89589,0.81239,0.74134,0.68325,0.63869,0.60818,0.59228,0.59151,0.60643,0.63757,0.68548,0.75069,0.83375,0.93520,1.05558],
    weight: [-0.087235,-0.074454,-0.064778,-0.057760,-0.052947,-0.049892,-0.048144,-0.047256,-0.046778,-0.046261,-0.045254,-0.043311,-0.039981,-0.034814,-0.029050,-0.024167,-0.020076,-0.016681,-0.013895,-0.011624,-0.009776,-0.008261,-0.006988,-0.005863,-0.004795,-0.003695,-0.002470,-0.001027],
    midparent: [0.50286,0.52887,0.53919,0.53691,0.52513,0.50692,0.48538,0.46361,0.44469,0.43171,0.42776,0.43593,0.45932,0.50101,0.54781,0.58409,0.60927,0.62279,0.62407,0.61253,0.58762,0.54875,0.49536,0.42687,0.34271,0.24231,0.12510,-0.00950],
    error50: 0.851,   // inches — average 50% error bound (from reference impl.)
    error90: 2.101,   // inches — average 90% error bound ~= published SEE (~5.3 cm)
  },
  female: {
    B0: [-8.13250,-6.47656,-5.13582,-4.13791,-3.51039,-3.14322,-2.87645,-2.66291,-2.45559,-2.20728,-1.87098,-1.06330,0.33468,1.97366,3.50436,4.57747,4.84365,4.27869,3.21417,1.83456,0.32425,-1.13224,-2.35055,-3.10326,-3.17885,-2.41657,-0.65579,2.26429],
    height: [1.24768,1.22177,1.19932,1.17880,1.15866,1.13737,1.11342,1.08525,1.05135,1.01018,0.96020,0.89989,0.82771,0.74213,0.67173,0.64150,0.64452,0.67386,0.72260,0.78383,0.85062,0.91605,0.97319,1.01514,1.03496,1.02573,0.98054,0.89246],
    weight: [-0.19435,-0.18519,-0.17530,-0.16484,-0.15400,-0.14294,-0.13184,-0.12086,-0.11019,-0.09999,-0.09044,-0.08171,-0.07397,-0.06739,-0.06136,-0.05518,-0.04894,-0.04272,-0.03661,-0.03067,-0.02500,-0.01967,-0.01477,-0.01037,-0.00655,-0.00340,-0.00100,0.00057],
    midparent: [0.44774,0.41381,0.38467,0.36039,0.34105,0.32672,0.31748,0.31340,0.31457,0.32105,0.33291,0.35025,0.37312,0.40161,0.42042,0.41686,0.39490,0.35850,0.31163,0.25826,0.20235,0.14787,0.09880,0.05909,0.03272,0.02364,0.03584,0.07327],
    error50: 0.657,   // inches
    error90: 1.675,   // inches ~= published SEE (~4.25 cm)
  },
};

export const KR_MIN_AGE = 4.0;
export const KR_MAX_AGE = 17.5;

// Round age to nearest half-year, then map to a coefficient row index (0..27).
// Returns null if the rounded age falls outside 4.0..17.5.
export function ageToIndex(ageYears) {
  const rounded = Math.round(ageYears * 2) / 2;
  if (rounded < KR_MIN_AGE || rounded > KR_MAX_AGE) return null;
  return Math.round((rounded - KR_MIN_AGE) * 2);
}

// Predict adult stature (inches). All inputs imperial.
//   { sex, ageYears, heightIn, weightLb, motherIn, fatherIn }
// Returns an object with the point estimate and 50%/90% honest bands (inches).
// If age rounds above 17.5, growth is treated as essentially complete and the
// current height is returned (capped:true).
export function predictKhamisRoche({ sex, ageYears, heightIn, weightLb, motherIn, fatherIn }) {
  const table = KR_COEFFS[sex];
  if (!table) throw new Error(`sex must be 'male' or 'female', got ${sex}`);

  const midparentIn = (motherIn + fatherIn) / 2;
  const rounded = Math.round(ageYears * 2) / 2;

  if (rounded > KR_MAX_AGE) {
    // Past the model's range — near-adult; current height is the best estimate.
    return {
      available: true, capped: true, index: null,
      pointIn: heightIn,
      low50In: heightIn, high50In: heightIn,
      low90In: heightIn, high90In: heightIn,
      error50In: 0, error90In: 0,
      coeffs: null,
    };
  }

  const i = ageToIndex(ageYears);
  if (i === null) {
    throw new Error(`Khamis-Roche supports ages ${KR_MIN_AGE}-${KR_MAX_AGE}; got ${ageYears}`);
  }

  const b0 = table.B0[i], bh = table.height[i], bw = table.weight[i], bm = table.midparent[i];
  const pointIn = b0 + bh * heightIn + bw * weightLb + bm * midparentIn;

  return {
    available: true, capped: false, index: i,
    pointIn,
    low50In: pointIn - table.error50, high50In: pointIn + table.error50,
    low90In: pointIn - table.error90, high90In: pointIn + table.error90,
    error50In: table.error50, error90In: table.error90,
    coeffs: { b0, height: bh, weight: bw, midparent: bm, midparentIn },
  };
}
