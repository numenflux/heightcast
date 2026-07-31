// convert.contract.test.js — display-contract tests for js/convert.js.
//
// convert.js is the last thing that touches a number before a visitor reads it.
// Every height on the results card, and both halves of every range, is a string
// this file minted. A slip here does not throw and does not look broken — it
// quietly shows a kid a different answer, off by inches, with full confidence.
//
// The existing convert.test.js pins the arithmetic (exact factors, round trips)
// and a handful of formatFtIn point values. What it does NOT pin is the part
// that decides what the visitor actually reads:
//
//   * every `{ half: false }` case it asserts is a value that renders
//     IDENTICALLY under both modes (70, 71.8, 83.9), so the `half` option
//     itself is never exercised — deleting it passes that file;
//   * every `{ half: true }` case already sits exactly on the half-inch grid
//     (70, 71.5, 59.5, 72), so the snapping decision is never exercised;
//   * `formatCm`'s default is never used — both call sites pass `decimals`.
//
// So the tests below are written as domain-wide properties rather than more
// point values. A point value only catches a mutation that happens to land on
// it; a property over the whole plausible height range catches the class.
//
// Two honest gaps, recorded here rather than faked with a test:
//   - The `if (inches >= 12)` guard (convert.js:29) is UNREACHABLE. `inches` is
//     `r - Math.floor(r / 12) * 12` where `r` is always an exact multiple of the
//     step, so it is mathematically confined to [0, 12). Searched for a hit over
//     4M half-inch values, the whole real cm domain, and extreme magnitudes /
//     denormals: zero. Deleting the guard changes no output, so no test can
//     fail on it. What the guard was written to protect — "never render 5'12"" —
//     IS pinned, by the domain sweep in "inches component is never 12 or more".
//     That test holds whichever construct enforces it.
//   - The `+ 1e-9` epsilon in `whole` is dead for the same reason: `inches` is
//     always an exact multiple of 0.5, so `Math.floor(x)` and `Math.floor(x+1e-9)`
//     never differ. Also not test-pinnable.

import test from "node:test";
import assert from "node:assert/strict";
import { formatFtIn, formatCm, roundTo, ftInToIn } from "../js/convert.js";

// Parse a rendered height back into a number.
//
// This is the load-bearing helper. Asserting "the string does not contain 12"
// would also pass for `NaN'NaN"`, `6'-2"` and `5'120"` — so the shape is
// checked FIRST and a render that is not well-formed fails here, loudly,
// before any weaker assertion gets a chance to be vacuously true.
const RENDERED = /^(\d+)'(\d+)(½)?"$/;
function parseFtIn(rendered) {
  const m = RENDERED.exec(rendered);
  assert.ok(m, `not a well-formed feet-inches render: ${JSON.stringify(rendered)}`);
  const feet = Number(m[1]);
  const inches = Number(m[2]);
  const half = m[3] ? 0.5 : 0;
  return { feet, inches, half, totalIn: feet * 12 + inches + half };
}

// The plausible domain. validate.js accepts child heights of 50–220 cm and
// parent heights of 120–230 cm (≈ 19.7 in .. 90.6 in), and every predicted
// adult height falls inside that envelope, so 15–100 in covers everything a
// visitor can ever be shown, with margin on both ends.
function* domainInches() {
  for (let hundredths = 1500; hundredths <= 10000; hundredths++) {
    yield hundredths / 100; // exact .25/.5/.75 ties are included deliberately
  }
}

test("half:false rounds to whole inches and never renders a half", () => {
  // These are the values where the two modes DISAGREE — the ones the existing
  // suite has none of. If the `half` option is ignored (step hard-wired to
  // 0.5), 71.5 renders 5'11½" instead of 6'0" and this fails immediately.
  assert.equal(formatFtIn(71.5, { half: false }), `6'0"`);
  assert.equal(formatFtIn(70.5, { half: false }), `5'11"`);
  assert.equal(formatFtIn(60.5, { half: false }), `5'1"`);
  assert.equal(formatFtIn(59.5, { half: false }), `5'0"`);
  assert.equal(formatFtIn(71.4, { half: false }), `5'11"`);
  assert.equal(formatFtIn(71.6, { half: false }), `6'0"`);

  // And the general property: half:false NEVER emits the fraction glyph, for
  // any input in the domain. fmtRange() in range.js renders both ends of every
  // published range with half:false, so a leaked ½ there is a visible defect.
  for (const v of domainInches()) {
    const out = formatFtIn(v, { half: false });
    assert.ok(!out.includes("½"), `half:false leaked a fraction at ${v}: ${out}`);
    assert.equal(parseFtIn(out).half, 0);
  }
});

test("default mode snaps to the nearest HALF inch, not the nearest inch", () => {
  // Off-grid values, straddling the quarter-inch decision points. Every one of
  // these is a value the existing suite does not have: it only asserts inputs
  // already sitting on the 0.5 grid, where snapping is a no-op.
  assert.equal(formatFtIn(71.24), `5'11"`);   // below the quarter -> down to 71.0
  assert.equal(formatFtIn(71.26), `5'11½"`);  // above the quarter -> up to 71.5
  assert.equal(formatFtIn(71.74), `5'11½"`);  // below .75 -> stays at 71.5
  assert.equal(formatFtIn(71.76), `6'0"`);    // above .75 -> up to 72.0
  assert.equal(formatFtIn(70.25), `5'10½"`);  // exact tie, rounds up (Math.round)
  assert.equal(formatFtIn(70.75), `5'11"`);   // exact tie, rounds up

  // Property: in default mode the rendered value always lands ON the half-inch
  // grid. A "simplification" to whole inches would still satisfy the point
  // assertions above at some values; this catches it everywhere.
  for (const v of domainInches()) {
    const { totalIn } = parseFtIn(formatFtIn(v));
    assert.equal(totalIn * 2, Math.round(totalIn * 2), `off the half-inch grid at ${v}`);
  }
});

test("the inches component is never 12 or more, across the whole domain", () => {
  // This is the promise convert.js:29 was written for: a height must never
  // render as 5'12". The guard there cannot fire (see header), so this pins the
  // invariant against whatever code actually enforces it today.
  //
  // Note what is asserted: the PARSED inches component, in both modes. A regex
  // for "12" would be satisfied by a crashed or malformed render; parseFtIn
  // rejects those first.
  for (const v of domainInches()) {
    for (const half of [true, false]) {
      const out = formatFtIn(v, { half });
      const { inches } = parseFtIn(out);
      assert.ok(
        Number.isInteger(inches) && inches >= 0 && inches <= 11,
        `inches component out of range at ${v} (half:${half}): ${out}`,
      );
    }
  }
});

test("a rendered height reads back to within half a rounding step of the input", () => {
  // The core anti-drift property, and the one that matches this surface's blast
  // radius: "a conversion slip changes the answer by inches". Rounding to the
  // nearest `step` may move the value by at most step/2 — anything beyond that
  // is lost information, whatever the string looks like.
  //
  // This is deliberately a round trip and not a string comparison: it catches a
  // wrong feet divisor, a dropped fraction, and a mis-signed remainder, none of
  // which necessarily produce a malformed-looking string.
  for (const v of domainInches()) {
    for (const half of [true, false]) {
      const step = half ? 0.5 : 1;
      const { totalIn } = parseFtIn(formatFtIn(v, { half }));
      const drift = Math.abs(totalIn - v);
      assert.ok(
        drift <= step / 2 + 1e-9,
        `drifted ${drift.toFixed(3)} in at ${v} (half:${half}), max ${step / 2}`,
      );
    }
  }
});

test("rendering is monotonic — a taller input never reads as shorter", () => {
  // A user-facing invariant that no single point value can express: growing the
  // input must never shrink the displayed height. Catches an inverted fraction
  // test or a rounding direction that flips across a boundary — both of which
  // can leave every individual render looking perfectly plausible.
  for (const half of [true, false]) {
    let prev = -Infinity;
    for (const v of domainInches()) {
      const { totalIn } = parseFtIn(formatFtIn(v, { half }));
      assert.ok(totalIn >= prev, `render went backwards at ${v} (half:${half})`);
      prev = totalIn;
    }
  }
});

test("formatCm defaults to whole centimetres", () => {
  // Both existing assertions pass `decimals` explicitly, so the default is
  // unpinned: changing it silently changes every caller that omits the option.
  assert.equal(formatCm(177.8), "178 cm");
  assert.equal(formatCm(177.4), "177 cm");
  assert.equal(formatCm(160), "160 cm");
  // ...and the explicit form still tracks the requested precision.
  assert.equal(formatCm(177.84, { decimals: 2 }), "177.84 cm");
});

test("roundTo breaks ties upward on the half-inch grid the display uses", () => {
  // The existing roundTo cases (71.6, 71.8) are both clear of a tie, so the
  // rounding MODE is untested: floor-with-offset, trunc, or round all agree
  // there and disagree at .25/.75.
  assert.equal(roundTo(71.25, 0.5), 71.5);
  assert.equal(roundTo(71.75, 0.5), 72);
  assert.equal(roundTo(70.5, 1), 71);
  assert.equal(roundTo(71.24, 0.5), 71);
  // Every result must land exactly on the grid — no float residue that would
  // later push Math.floor() over an inch boundary.
  for (const v of domainInches()) {
    assert.equal(roundTo(v, 0.5) * 2, Math.round(roundTo(v, 0.5) * 2));
  }
});

test("ftInToIn keeps fractional inches", () => {
  // The only existing case is ftInToIn(5, 10) — two integers. A rounded or
  // truncated inches term survives that and silently drops half-inch entry.
  assert.equal(ftInToIn(5, 11.5), 71.5);
  assert.equal(ftInToIn(5, 0.5), 60.5);
  assert.equal(ftInToIn(0, 7.25), 7.25);
  assert.equal(ftInToIn(6, 0), 72);
});
