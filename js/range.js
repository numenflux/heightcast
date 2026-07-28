// range.js — orchestration + honest-range construction (pure).
//
// Runs all three methods, builds a single headline honest range, and produces
// display strings for both unit systems plus a plain-English confidence note.
// No DOM here — app.js consumes this and renders it.

import { inToCm, cmToIn, formatFtIn } from "./convert.js";
import { predictKhamisRoche } from "./khamis-roche.js";
import { predictMidparental } from "./midparental.js";
import { projectAdultHeight } from "./cdc-lms.js";
import { validateInputs } from "./validate.js";

// Normalize raw input into both unit systems (canonical + imperial).
function normalize(input) {
  const imperial = input.units === "imperial";
  const heightIn = imperial ? input.height : cmToIn(input.height);
  const motherIn = imperial ? input.motherHeight : cmToIn(input.motherHeight);
  const fatherIn = imperial ? input.fatherHeight : cmToIn(input.fatherHeight);
  const weightLb = imperial ? input.weight : input.weight / 0.45359237;
  return {
    sex: input.sex,
    ageYears: input.ageYears,
    heightCm: imperial ? inToCm(input.height) : input.height,
    motherCm: imperial ? inToCm(input.motherHeight) : input.motherHeight,
    fatherCm: imperial ? inToCm(input.fatherHeight) : input.fatherHeight,
    heightIn, motherIn, fatherIn, weightLb,
  };
}

// Format a cm→cm range for both unit systems.
export function fmtRange(lowCm, highCm) {
  return {
    cm: `${Math.round(lowCm)}–${Math.round(highCm)} cm`,
    ftin: `${formatFtIn(cmToIn(lowCm), { half: false })}–${formatFtIn(cmToIn(highCm), { half: false })}`,
  };
}
export function fmtPoint(cm) {
  return { cm: `${cm.toFixed(1)} cm`, ftin: formatFtIn(cmToIn(cm), { half: true }) };
}

// Main entry point. Returns { ok:false, errors, warnings } on bad input,
// otherwise a full result object.
export function buildResult(rawInput) {
  const v = validateInputs(rawInput);
  if (!v.ok) return { ok: false, errors: v.errors, warnings: v.warnings };

  const n = normalize(v.value);

  // --- method a: Khamis-Roche (native inches) ---
  const kr = predictKhamisRoche({
    sex: n.sex, ageYears: n.ageYears,
    heightIn: n.heightIn, weightLb: n.weightLb,
    motherIn: n.motherIn, fatherIn: n.fatherIn,
  });
  const krCm = {
    pointCm: inToCm(kr.pointIn),
    low90Cm: inToCm(kr.low90In), high90Cm: inToCm(kr.high90In),
    low50Cm: inToCm(kr.low50In), high50Cm: inToCm(kr.high50In),
    error90Cm: inToCm(kr.error90In), error50Cm: inToCm(kr.error50In),
  };

  // --- method b: mid-parental / Tanner (native cm) ---
  const mp = predictMidparental({ sex: n.sex, motherCm: n.motherCm, fatherCm: n.fatherCm });

  // --- method c: CDC percentile projection (native cm) ---
  const pc = projectAdultHeight({ sex: n.sex, ageYears: n.ageYears, heightCm: n.heightCm });

  // --- headline honest range: Khamis-Roche 90% band (best individual predictor) ---
  const headline = {
    pointCm: krCm.pointCm,
    lowCm: krCm.low90Cm,
    highCm: krCm.high90Cm,
    point: fmtPoint(krCm.pointCm),
    range: fmtRange(krCm.low90Cm, krCm.high90Cm),
  };

  // agreement check across the three point estimates
  const points = [krCm.pointCm, mp.targetCm, pc.adultCm];
  const spreadCm = Math.max(...points) - Math.min(...points);
  const agree = spreadCm <= 5;

  const confidence = buildConfidence({ sex: n.sex, kr, krCm, agree, spreadCm });

  return {
    ok: true,
    warnings: v.warnings,
    input: n,
    methods: {
      khamisRoche: {
        available: kr.available, capped: kr.capped, index: kr.index, coeffs: kr.coeffs,
        pointCm: krCm.pointCm, lowCm: krCm.low90Cm, highCm: krCm.high90Cm,
        point: fmtPoint(krCm.pointCm), range: fmtRange(krCm.low90Cm, krCm.high90Cm),
        error90Cm: krCm.error90Cm,
      },
      midparental: {
        available: mp.available,
        pointCm: mp.targetCm, lowCm: mp.lowCm, highCm: mp.highCm,
        point: fmtPoint(mp.targetCm), range: fmtRange(mp.lowCm, mp.highCm),
      },
      percentile: {
        available: pc.available, percentile: pc.percentile,
        pointCm: pc.adultCm, lowCm: pc.lowCm, highCm: pc.highCm,
        point: fmtPoint(pc.adultCm), range: fmtRange(pc.lowCm, pc.highCm),
      },
    },
    headline,
    agree,
    spreadCm,
    confidence,
  };
}

function buildConfidence({ sex, kr, krCm, agree, spreadCm }) {
  const errIn = kr.error90In.toFixed(1);
  const errCm = krCm.error90Cm.toFixed(1);
  const parts = [];
  parts.push(
    "This is an estimate, not a measurement — and definitely not medical advice."
  );
  parts.push(
    `The Khamis‑Roche method is the most accurate of the three because it uses your own current height and weight, not just your parents'. For ${sex === "male" ? "boys" : "girls"} it lands within about ±${errCm} cm (±${errIn} in) of the true adult height about 9 times out of 10 — that's what the range shows.`
  );
  parts.push(
    agree
      ? `All three methods here land within ${spreadCm.toFixed(1)} cm of each other, which is a good sign your estimate is stable.`
      : `The three methods spread out by ${spreadCm.toFixed(1)} cm here — that usually means growth timing (early or late puberty) could swing the result, so lean on the wider range.`
  );
  parts.push(
    "Your genes set most of the target; the range is the room that's genuinely left to vary."
  );
  return parts.join(" ");
}
