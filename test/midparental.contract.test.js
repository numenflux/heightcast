/**
 * Contract tests for js/midparental.js — the Tanner target-height method.
 *
 * This module is one of the three published methods on the Heightcast page. Its
 * number is printed twice: in the "What each published method says on its own"
 * ledger (app.js line ~125) and again on the downloadable card (line ~292). It
 * also feeds `spreadCm`, which decides whether a visitor reads "a good sign your
 * estimate is stable" or a warning to lean on the wider range. So a wrong number
 * here is not cosmetic — it is a wrong claim, stated confidently, in print.
 *
 * What the existing test/midparental.test.js already pins: the two constants,
 * two hand-worked examples (one boy, one girl, same parents), the 13 cm gap
 * between them, and `assert.throws` on a single bad sex value ("n/a").
 *
 * What it does NOT pin, and why each gap has teeth:
 *
 *  1. The sex gate is total. The branch is `sex === "male" ? plus : minus`, so
 *     the FEMALE formula is the default for every value that is not exactly the
 *     string "male". If the guard is ever loosened — the obvious future commit
 *     is "be forgiving about casing" — then a boy arriving as "Male" is handed a
 *     target 13 cm too short, silently, with no error anywhere. `assert.throws`
 *     on one string cannot see that; the Daykit lesson applies verbatim, because
 *     the dangerous failure is not a crash, it is a plausible wrong answer.
 *
 *  2. The ±8.5 cm band is only pinned on two hand-picked parent pairs, both
 *     comfortably mid-range. A clamp or a floor added to "tidy up" the display
 *     would leave both examples untouched and break the band at the edges of the
 *     domain validate.js actually accepts.
 *
 *  3. Nothing checks the *type* of the returned fields. range.js does
 *     `fmtPoint(mp.targetCm)` -> `cm.toFixed(1)`. A commit that pre-rounds
 *     targetCm to a string keeps every existing arithmetic assertion green
 *     (`Math.abs("178.0" - 178) <= eps` is true) while making buildResult throw,
 *     which in app.js means the submit handler dies and NOTHING renders.
 *
 *  4. Nothing pins that this file stays dependency-free. It is fetched as its
 *     own ES module by the browser; a new import or a reference to a global that
 *     some environment has stripped takes the whole module graph — and therefore
 *     the whole result panel — down with it.
 *
 * Same house style as the rest of the repo: node:test, node:assert/strict, zero
 * dependencies. midparental.js is pure, so there is no DOM to stub — the
 * "environment" that has to be faked is the set of hostile values a caller can
 * produce, plus the real downstream formatters from range.js.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  predictMidparental,
  MID_PARENT_SEX_DELTA_CM,
  TARGET_RANGE_CM,
} from "../js/midparental.js";
import { BOUNDS } from "../js/validate.js";
import { fmtPoint, fmtRange } from "../js/range.js";

const close = (a, b, eps = 1e-9, label = "") =>
  assert.ok(Math.abs(a - b) <= eps, `${label ? label + ": " : ""}${a} !~= ${b}`);

const HERE = dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// 1. The sex gate. The highest-consequence guard in the file, because breaking
//    it produces a wrong number rather than an error.
// ---------------------------------------------------------------------------

// Every one of these must be refused. They are grouped deliberately: the second
// group is the set of values a human or a refactor would most plausibly expect
// the function to *accept*, which is exactly why they are the dangerous ones.
const REFUSED = [
  // absent / empty
  ["undefined", undefined],
  ["null", null],
  ["empty string", ""],
  // male-looking values that are not the literal string "male"
  ["'Male'", "Male"],
  ["'MALE'", "MALE"],
  ["'male ' (trailing space)", "male "],
  ["' male' (leading space)", " male"],
  ["'boy'", "boy"],
  ["'m'", "m"],
  ["new String('male')", new String("male")],
  ["{ toString: () => 'male' }", { toString: () => "male" }],
  // female-looking values that are not the literal string "female"
  ["'Female'", "Female"],
  ["'girl'", "girl"],
  ["'f'", "f"],
  // wrong types entirely
  ["0", 0],
  ["1", 1],
  ["true", true],
  ["false", false],
  ["[]", []],
  ["{}", {}],
  ["NaN", NaN],
];

// Parents chosen so the two formulas are far apart and easy to name in a failure
// message: mid-parent 167.5, so a boy is 174 and a girl is 161.
const PARENTS = { motherCm: 160, fatherCm: 175 };
const TRUE_MALE_TARGET = 174;
const TRUE_FEMALE_TARGET = 161;

/**
 * Calls the function and reports what happened, without asserting yet.
 * Separating "what happened" from "what should have happened" is what lets the
 * assertions below say *which* wrong answer was produced, instead of only that
 * an expected throw did not arrive.
 */
function call(sex) {
  try {
    return { threw: false, value: predictMidparental({ sex, ...PARENTS }) };
  } catch (err) {
    return { threw: true, err };
  }
}

test("sex gate: only the exact strings 'male' and 'female' are accepted", () => {
  for (const [label, sex] of REFUSED) {
    const r = call(sex);

    // The weak version of this test is `assert.throws(...)` and nothing else.
    // It passes for the right reason AND for a wrong one: any future guard that
    // throws late, after computing a result, would satisfy it. So the failure
    // message here names the number that escaped, which is the thing that would
    // actually reach a visitor.
    assert.ok(
      r.threw,
      `sex=${label} was accepted and returned targetCm=${r.value && r.value.targetCm} ` +
        `(the female formula is the fall-through branch, so a male-looking value ` +
        `silently loses ${MID_PARENT_SEX_DELTA_CM} cm)`,
    );
  }

  // And the guard must not have become so eager that it rejects the two real
  // values — a mutation that threw unconditionally would pass everything above.
  assert.equal(call("male").threw, false, "the guard now rejects 'male' itself");
  assert.equal(call("female").threw, false, "the guard now rejects 'female' itself");
});

// This is the assertion the existing suite cannot make. If a future commit
// normalises the input ("male".toLowerCase()) in the guard but leaves the
// ternary comparing the raw value, "n/a" still throws — so the existing
// "rejects unknown sex" test stays green — while "Male" is quietly accepted and
// given the girls' formula. The consequence is a boy told he will finish 13 cm
// shorter than the method actually says.
test("a male-looking sex value can never be answered with the female formula", () => {
  const maleLookalikes = ["Male", "MALE", "male ", " male", "boy", "M", "man"];

  for (const sex of maleLookalikes) {
    const r = call(sex);
    if (r.threw) continue; // refused outright — the correct outcome

    assert.equal(
      r.value.targetCm,
      TRUE_MALE_TARGET,
      `sex="${sex}" was accepted but answered with the FEMALE target ` +
        `(${r.value.targetCm} cm instead of ${TRUE_MALE_TARGET} cm — ` +
        `${TRUE_MALE_TARGET - r.value.targetCm} cm too short)`,
    );
  }
});

// The mirror of the above: the boys' branch must not swallow female input
// either. A guard rewritten as `sex === "female" ? minus : plus` would flip the
// default, and the existing hand-worked examples would still both pass because
// they both name their sex exactly.
test("a female-looking sex value can never be answered with the male formula", () => {
  for (const sex of ["Female", "FEMALE", "girl", "F", "woman"]) {
    const r = call(sex);
    if (r.threw) continue;

    assert.equal(
      r.value.targetCm,
      TRUE_FEMALE_TARGET,
      `sex="${sex}" was accepted but answered with the MALE target ` +
        `(${r.value.targetCm} cm instead of ${TRUE_FEMALE_TARGET} cm)`,
    );
  }
});

// A rejected call must leave nothing behind for a caller to misread. range.js
// calls this inside buildResult with no try/catch, so the throw propagates and
// app.js's submit handler dies — which is the safe outcome (no result panel)
// only if no half-built object was produced first.
test("a refused call produces an Error naming the offending value, and no result", () => {
  const r = call("n/a");
  assert.equal(r.threw, true);
  assert.ok(r.err instanceof Error, `threw a ${typeof r.err}, not an Error`);
  assert.match(r.err.message, /sex/i, `error message does not mention sex: "${r.err.message}"`);
  assert.match(r.err.message, /n\/a/, `error message does not quote the bad value: "${r.err.message}"`);
  assert.equal(r.value, undefined);
});

// ---------------------------------------------------------------------------
// 2. The formula and the band, across the whole domain the app can hand it.
// ---------------------------------------------------------------------------

// validate.js is the only gate in front of this module in production, so its
// parent bounds ARE the input domain. Deriving the sweep from BOUNDS rather than
// from hardcoded numbers means the sweep follows the app if the bounds move.
function parentHeights() {
  const out = [];
  for (let cm = BOUNDS.parent.min; cm <= BOUNDS.parent.max; cm += 5) out.push(cm);
  // The exact edges and one deliberately fractional pair, since a clamp or a
  // rounding step is most likely to show itself at the extremes or off-grid.
  out.push(BOUNDS.parent.min, BOUNDS.parent.max, 152.4, 187.96);
  return out;
}

// The existing tests pin the band on two mid-range parent pairs (low 169.5 and
// 156.5). A "don't display an implausible height" clamp — e.g.
// `lowCm: Math.max(140, targetCm - TARGET_RANGE_CM)` — leaves both of those
// untouched and silently stops centring the band for short parents. The band is
// the whole product claim, so it has to hold everywhere, not at two points.
test("the band is exactly ±TARGET_RANGE_CM around the target for every accepted parent pair", () => {
  let checked = 0;

  for (const motherCm of parentHeights()) {
    for (const fatherCm of parentHeights()) {
      for (const sex of ["male", "female"]) {
        const r = predictMidparental({ sex, motherCm, fatherCm });
        const where = `${sex} m${motherCm}/f${fatherCm}`;

        // Centred, not merely ordered: asserting `low < target < high` alone
        // would pass for a band of ±0.1 cm or an off-centre one.
        close(r.targetCm - r.lowCm, TARGET_RANGE_CM, 1e-9, `${where} lower half`);
        close(r.highCm - r.targetCm, TARGET_RANGE_CM, 1e-9, `${where} upper half`);
        close(r.highCm - r.lowCm, TARGET_RANGE_CM * 2, 1e-9, `${where} total width`);

        // Strict ordering as well, because app.js and the poster both compute
        // `(hi - lo)` as a positive span and divide by it.
        assert.ok(r.lowCm < r.targetCm, `${where}: lowCm ${r.lowCm} is not below the target`);
        assert.ok(r.targetCm < r.highCm, `${where}: highCm ${r.highCm} is not above the target`);

        // The reported band width must be the one actually used. If these ever
        // disagree, the page prints a range it did not compute.
        assert.equal(r.rangeCm, TARGET_RANGE_CM, `${where}: rangeCm disagrees with the band`);

        checked++;
      }
    }
  }

  assert.ok(checked >= 1000, `sweep only covered ${checked} cases`);
});

// The formula itself, everywhere rather than at two points, and expressed
// against the exported constant so the relationship — not one arithmetic
// result — is what is pinned. This is what catches an asymmetric offset (boys
// +13/2 but girls -13/3), which the single girls' example would only catch by
// luck of the chosen numbers.
test("target = mid-parent ± half the sex delta, symmetric about the mid-parent average", () => {
  for (const motherCm of parentHeights()) {
    for (const fatherCm of parentHeights()) {
      const boy = predictMidparental({ sex: "male", motherCm, fatherCm });
      const girl = predictMidparental({ sex: "female", motherCm, fatherCm });
      const where = `m${motherCm}/f${fatherCm}`;

      const mid = (motherCm + fatherCm) / 2;
      close(boy.midParentCm, mid, 1e-9, `${where} boy midParentCm`);
      close(girl.midParentCm, mid, 1e-9, `${where} girl midParentCm`);

      // Straddling: the two targets sit the same distance either side of the
      // mid-parent average. A shared offset applied to both would keep the
      // 13 cm gap the existing suite checks while moving both numbers.
      close(boy.targetCm - mid, MID_PARENT_SEX_DELTA_CM / 2, 1e-9, `${where} boy offset`);
      close(mid - girl.targetCm, MID_PARENT_SEX_DELTA_CM / 2, 1e-9, `${where} girl offset`);
      close(boy.targetCm - girl.targetCm, MID_PARENT_SEX_DELTA_CM, 1e-9, `${where} gap`);

      // Order matters nowhere in the maths, but a swapped-argument refactor is
      // easy and invisible: mother and father must be interchangeable.
      const swapped = predictMidparental({ sex: "male", motherCm: fatherCm, fatherCm: motherCm });
      close(swapped.targetCm, boy.targetCm, 1e-9, `${where} parents are not interchangeable`);
    }
  }
});

// ---------------------------------------------------------------------------
// 3. The handoff to range.js — where a type change becomes a blank page.
// ---------------------------------------------------------------------------

// range.js reads targetCm, lowCm and highCm and pushes them straight through
// fmtPoint (`cm.toFixed(1)`) and fmtRange (`Math.round`). Every existing
// assertion in midparental.test.js uses `Math.abs(a - b)`, which coerces, so a
// commit that returned pre-formatted strings would keep them all green while
// making buildResult throw — and app.js calls buildResult with no try/catch, so
// the visitor gets no result panel at all.
test("every numeric field is a real finite number, not a coercible string", () => {
  for (const sex of ["male", "female"]) {
    const r = predictMidparental({ sex, motherCm: 165, fatherCm: 178 });

    for (const key of ["midParentCm", "targetCm", "lowCm", "highCm", "rangeCm"]) {
      assert.equal(
        typeof r[key],
        "number",
        `${sex}: ${key} is a ${typeof r[key]} (${JSON.stringify(r[key])}) — range.js calls .toFixed on it`,
      );
      assert.ok(Number.isFinite(r[key]), `${sex}: ${key} is ${r[key]}`);
    }

    // app.js renders the row unconditionally; `available` is the module's own
    // claim that it produced an answer, so it must be the literal boolean.
    assert.equal(r.available, true, `${sex}: available is ${JSON.stringify(r.available)}`);
  }
});

// The end-to-end proof of the same property: run the output through the real
// downstream formatters and look at the text that would be written into the
// page. `doesNotMatch(/NaN/)` alone would pass if the formatter threw and the
// test never got a string, so each string is also matched against the positive
// shape app.js depends on.
test("the mid-parental row formats into printable text for every accepted parent pair", () => {
  let checked = 0;

  for (const motherCm of parentHeights()) {
    for (const fatherCm of parentHeights()) {
      for (const sex of ["male", "female"]) {
        const r = predictMidparental({ sex, motherCm, fatherCm });
        const where = `${sex} m${motherCm}/f${fatherCm}`;

        const point = fmtPoint(r.targetCm);
        const range = fmtRange(r.lowCm, r.highCm);

        assert.match(point.cm, /^\d+\.\d cm$/, `${where}: point.cm = "${point.cm}"`);
        assert.match(point.ftin, /^\d+'\d+½?"$/, `${where}: point.ftin = "${point.ftin}"`);
        assert.match(range.cm, /^\d+–\d+ cm$/, `${where}: range.cm = "${range.cm}"`);
        assert.match(range.ftin, /^\d+'\d+"–\d+'\d+"$/, `${where}: range.ftin = "${range.ftin}"`);

        for (const s of [point.cm, point.ftin, range.cm, range.ftin]) {
          assert.doesNotMatch(s, /NaN|Infinity|undefined|null|-/, `${where}: rendered "${s}"`);
        }

        checked++;
      }
    }
  }

  assert.ok(checked >= 1000, `sweep only covered ${checked} cases`);
});

// ---------------------------------------------------------------------------
// 4. Structural: this module must stay something that cannot fail to load.
// ---------------------------------------------------------------------------

// index.html loads app.js as an ES module, so the browser fetches this file on
// its own and evaluates it before anything renders. It currently imports
// nothing and touches no host global, which is why no missing dependency and no
// stripped-down environment can break the third published method. That property
// is only true until someone adds a line — and nothing else in the suite would
// notice, because a new dependency works fine on the test runner's Node.
test("midparental.js takes no dependency and reads no host global", () => {
  const source = readFileSync(join(HERE, "../js/midparental.js"), "utf8");

  // Comments are stripped first: the header cites references in prose, and a
  // test that a future comment could turn red is a test people learn to ignore.
  const code = source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^[ \t]*\/\/.*$/gm, "")
    .replace(/([^:])\/\/.*$/gm, "$1");

  assert.doesNotMatch(code, /\bimport\b|\brequire\s*\(/, "midparental.js acquired a dependency");

  const hostGlobals = /\b(window|document|globalThis|self|navigator|location|fetch|XMLHttpRequest|localStorage|sessionStorage|process|console)\b/;
  const hit = code.match(hostGlobals);
  assert.equal(hit, null, `midparental.js now reads the host global "${hit && hit[0]}"`);
});

// The two constants are the published spec of the method — they are what the
// page's "Tanner target height" claim means. midparental.test.js pins their
// values; this pins their type and sign, so a stringified or negated constant
// cannot pass by coercion the way `assert.equal("13", 13)` would not, but
// `Math.abs("13" - 13) <= eps` would.
test("the published constants are positive finite numbers", () => {
  for (const [name, v] of [
    ["MID_PARENT_SEX_DELTA_CM", MID_PARENT_SEX_DELTA_CM],
    ["TARGET_RANGE_CM", TARGET_RANGE_CM],
  ]) {
    assert.equal(typeof v, "number", `${name} is a ${typeof v}`);
    assert.ok(Number.isFinite(v), `${name} is ${v}`);
    assert.ok(v > 0, `${name} is ${v} — a non-positive value would invert the band`);
  }
});
