#!/usr/bin/env node
// Reverse solver for 暗黑歌姬(攻) Lv130 5改 金卡.
// Enumerates (rate, lost, rand), solves manual candidates, and evaluates:
// 1) strict cap model
// 2) no cap model
// 3) mod-exempt cap model (allow cap overflow within mod points)

const base = [22, 50, 20, 26, 11];
const level = 130;
const cardRank = 8;
const modGrade = 5;
const levelPointLimit = level - 1; // 129
const modPointLimit = cardRank * modGrade; // 40
const totalManualLimit = levelPointLimit + modPointLimit; // 169
const growthFactor = (level - 1) / 24; // 5.375

const observed = [2757.24, 2181.55, 1353.02, 575.24, 444.67, 74.77, 153.93];
const observedScore = 4099;
const skillScore = 78;
const fullBonus = 100;
const scoreWeights = [0.985, 0.522, 3.21, 1.71, 2.9, 7, 5];
const statNames = ["HP", "MP", "ATK", "DEF", "AGI", "SPT", "REC"];

const matrix = [
  [8.0, 2.0, 3.0, 3.0, 1.0],
  [1.0, 2.0, 2.0, 2.0, 10.0],
  [0.2, 2.7, 0.3, 0.3, 0.2],
  [0.2, 0.3, 3.0, 0.3, 0.2],
  [0.1, 0.2, 0.2, 2.0, 0.1],
  [-0.3, -0.1, 0.2, -0.1, 0.8],
  [0.8, -0.1, -0.1, 0.2, -0.3],
];
const statBase = [20, 20, 20, 20, 20, 100, 100];

const DEFAULTS = {
  rateMin: 0.15,
  rateMax: 0.5,
  rateStep: 0.001,
  maxLostEach: 2,
  maxLostSum: 4,
  maxRandEach: 10,
  maxRandSum: 10,
  lostFixed: null, // e.g. [0,0,0,0,0]
  randSumExact: null, // e.g. 10
  manualFixed: null, // e.g. [0,169,0,0,0]
  topN: 10,
  mode: "all", // strict | none | mod-exempt | all
};

function parseArgs() {
  const opts = { ...DEFAULTS };
  for (let i = 2; i < process.argv.length; i++) {
    const arg = process.argv[i];
    const next = process.argv[i + 1];
    if (arg === "--rate-min" && next) opts.rateMin = Number(next), i++;
    else if (arg === "--rate-max" && next) opts.rateMax = Number(next), i++;
    else if (arg === "--rate-step" && next) opts.rateStep = Number(next), i++;
    else if (arg === "--max-lost-each" && next) opts.maxLostEach = Number(next), i++;
    else if (arg === "--max-lost-sum" && next) opts.maxLostSum = Number(next), i++;
    else if (arg === "--max-rand-each" && next) opts.maxRandEach = Number(next), i++;
    else if (arg === "--max-rand-sum" && next) opts.maxRandSum = Number(next), i++;
    else if (arg === "--lost-fixed" && next) {
      const arr = next.split(",").map((v) => Number(v.trim()));
      if (arr.length !== 5 || arr.some((v) => !Number.isFinite(v))) {
        throw new Error("--lost-fixed must be 5 comma-separated numbers, e.g. 0,0,0,0,0");
      }
      opts.lostFixed = arr;
      i++;
    }
    else if (arg === "--rand-sum-exact" && next) opts.randSumExact = Number(next), i++;
    else if (arg === "--manual-fixed" && next) {
      const arr = next.split(",").map((v) => Number(v.trim()));
      if (arr.length !== 5 || arr.some((v) => !Number.isFinite(v) || v < 0)) {
        throw new Error("--manual-fixed must be 5 non-negative numbers, e.g. 0,169,0,0,0");
      }
      opts.manualFixed = arr;
      i++;
    }
    else if (arg === "--top" && next) opts.topN = Number(next), i++;
    else if (arg === "--mode" && next) opts.mode = String(next), i++;
    else if (arg === "--help" || arg === "-h") return { help: true };
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return opts;
}

function usage() {
  console.log(`
Usage:
  node scripts/reverse-calc.mjs [options]

Options:
  --mode strict|none|mod-exempt|all
  --rate-min <num>        default ${DEFAULTS.rateMin}
  --rate-max <num>        default ${DEFAULTS.rateMax}
  --rate-step <num>       default ${DEFAULTS.rateStep}
  --max-lost-each <int>   default ${DEFAULTS.maxLostEach}
  --max-lost-sum <int>    default ${DEFAULTS.maxLostSum}
  --max-rand-each <int>   default ${DEFAULTS.maxRandEach}
  --max-rand-sum <int>    default ${DEFAULTS.maxRandSum}
  --lost-fixed a,b,c,d,e  force exact lost vector (5 ints)
  --rand-sum-exact <int>  force exact random sum
  --manual-fixed a,b,c,d,e force exact manual vector (5 nums)
  --top <int>             default ${DEFAULTS.topN}
`);
}

function solve5x5(rhs) {
  const aug = matrix.slice(0, 5).map((row, i) => [...row, rhs[i]]);
  for (let col = 0; col < 5; col++) {
    let pivot = col;
    for (let row = col + 1; row < 5; row++) {
      if (Math.abs(aug[row][col]) > Math.abs(aug[pivot][col])) pivot = row;
    }
    [aug[col], aug[pivot]] = [aug[pivot], aug[col]];
    const p = aug[col][col];
    if (Math.abs(p) < 1e-12) throw new Error("Singular matrix in solve5x5");
    for (let j = col; j <= 5; j++) aug[col][j] /= p;
    for (let row = 0; row < 5; row++) {
      if (row === col) continue;
      const factor = aug[row][col];
      for (let j = col; j <= 5; j++) aug[row][j] -= factor * aug[col][j];
    }
  }
  return aug.map((row) => row[5]);
}

function round2(x) {
  return Math.round((x + 1e-9) * 100) / 100;
}

function trunc2(x) {
  return Math.floor((x + 1e-9) * 100) / 100;
}

function scoreFrom(stats7) {
  let baseScore = 0;
  for (let i = 0; i < 7; i++) baseScore += (stats7[i] * scoreWeights[i]) / 3;
  return Math.floor(baseScore + skillScore + fullBonus);
}

function computeRawStats(bp) {
  const out = new Array(7);
  for (let s = 0; s < 7; s++) {
    let value = statBase[s];
    for (let i = 0; i < 5; i++) value += matrix[s][i] * bp[i];
    out[s] = value;
  }
  return out;
}

function perStatCap(bpBase, manual, idx) {
  let sumOthers = 0;
  for (let j = 0; j < 5; j++) {
    if (j === idx) continue;
    sumOthers += bpBase[j] + manual[j];
  }
  return Math.max(0, Math.floor(sumOthers - bpBase[idx]));
}

function buildLostCombos(maxEach, maxSum) {
  const list = [];
  for (let l0 = 0; l0 <= maxEach; l0++)
  for (let l1 = 0; l1 <= maxEach; l1++)
  for (let l2 = 0; l2 <= maxEach; l2++)
  for (let l3 = 0; l3 <= maxEach; l3++)
  for (let l4 = 0; l4 <= maxEach; l4++) {
    if (l0 + l1 + l2 + l3 + l4 > maxSum) continue;
    list.push([l0, l1, l2, l3, l4]);
  }
  return list;
}

function buildRandCombos(maxEach, maxSum) {
  const list = [];
  for (let r0 = 0; r0 <= Math.min(maxEach, maxSum); r0++)
  for (let r1 = 0; r1 <= Math.min(maxEach, maxSum - r0); r1++)
  for (let r2 = 0; r2 <= Math.min(maxEach, maxSum - r0 - r1); r2++)
  for (let r3 = 0; r3 <= Math.min(maxEach, maxSum - r0 - r1 - r2); r3++) {
    const rem = maxSum - r0 - r1 - r2 - r3;
    for (let r4 = 0; r4 <= Math.min(maxEach, rem); r4++) {
      list.push([r0, r1, r2, r3, r4]);
    }
  }
  return list;
}

function manualChoiceDims(mReal) {
  return mReal.map((v) => {
    const lo = Math.floor(v);
    const hi = Math.ceil(v);
    return lo === hi ? [lo] : [lo, hi];
  });
}

function fixedManualChoices(manual) {
  return manual.map((v) => [v]);
}

function matchesObserved2dp(values, mode) {
  for (let i = 0; i < 7; i++) {
    const v = mode === "round" ? round2(values[i]) : trunc2(values[i]);
    if (Math.abs(v - observed[i]) > 1e-9) return false;
  }
  return true;
}

function makeModeResult(topN) {
  return {
    feasible: 0,
    exact: 0,
    top: [],
    topN,
  };
}

function sortKey(a, b) {
  if (a.isExact !== b.isExact) return a.isExact ? -1 : 1;
  if (a.maxErr !== b.maxErr) return a.maxErr - b.maxErr;
  if (a.scoreDiff !== b.scoreDiff) return a.scoreDiff - b.scoreDiff;
  return a.rate - b.rate;
}

function pushTop(result, candidate) {
  result.top.push(candidate);
  result.top.sort(sortKey);
  if (result.top.length > result.topN) result.top.pop();
}

function runSearch(options) {
  const solvedBP = solve5x5(observed.slice(0, 5).map((v, i) => v - statBase[i]));

  const selectedModes = new Set(
    options.mode === "all"
      ? ["strict", "none", "mod-exempt"]
      : [options.mode]
  );
  for (const m of selectedModes) {
    if (!["strict", "none", "mod-exempt"].includes(m)) {
      throw new Error(`Invalid mode: ${m}`);
    }
  }

  const lostAll = buildLostCombos(options.maxLostEach, options.maxLostSum);
  const randAll = buildRandCombos(options.maxRandEach, options.maxRandSum);

  const lostCombos = options.lostFixed
    ? lostAll.filter((lost) => lost.every((v, i) => v === options.lostFixed[i]))
    : lostAll;

  const randCombos = Number.isFinite(options.randSumExact)
    ? randAll.filter((rand) => rand.reduce((a, b) => a + b, 0) === options.randSumExact)
    : randAll;

  const result = {
    solvedBP,
    inspected: 0,
    afterPrune: 0,
    lostCombos: lostCombos.length,
    randCombos: randCombos.length,
    modes: {
      strict: makeModeResult(options.topN),
      none: makeModeResult(options.topN),
      "mod-exempt": makeModeResult(options.topN),
    },
  };

  const rateStart = Math.round(options.rateMin * 1000);
  const rateEnd = Math.round(options.rateMax * 1000);
  const rateStep = Math.max(1, Math.round(options.rateStep * 1000));

  for (let rx = rateStart; rx <= rateEnd; rx += rateStep) {
    const rate = rx / 1000;
    for (const lost of lostCombos) {
      const realRanks = base.map((v, i) => v - lost[i]);
      for (const rand of randCombos) {
        result.inspected++;

        const bpBase = realRanks.map(
          (realRank, i) => realRank * (rate + growthFactor) + rand[i] * rate
        );
        const manualReal = solvedBP.map((v, i) => v - bpBase[i]);
        const manualRealSum = manualReal.reduce((a, b) => a + b, 0);

        if (manualReal.some((v) => v < -2 || v > 220)) continue;
        if (manualRealSum < -2 || manualRealSum > totalManualLimit + 2) continue;
        result.afterPrune++;

        const choices = options.manualFixed
          ? fixedManualChoices(options.manualFixed)
          : manualChoiceDims(manualReal);
        for (const m0 of choices[0])
        for (const m1 of choices[1])
        for (const m2 of choices[2])
        for (const m3 of choices[3])
        for (const m4 of choices[4]) {
          const manual = [m0, m1, m2, m3, m4];
          if (manual.some((v) => v < 0)) continue;
          const manualSum = m0 + m1 + m2 + m3 + m4;
          if (manualSum > totalManualLimit) continue;

          const caps = new Array(5);
          for (let i = 0; i < 5; i++) caps[i] = perStatCap(bpBase, manual, i);
          let capExcess = 0;
          for (let i = 0; i < 5; i++) {
            if (manual[i] > caps[i]) capExcess += manual[i] - caps[i];
          }

          const passStrict = capExcess === 0;
          const passNone = true;
          const passModExempt = capExcess <= modPointLimit;

          let include = false;
          if (selectedModes.has("strict") && passStrict) include = true;
          if (selectedModes.has("none") && passNone) include = true;
          if (selectedModes.has("mod-exempt") && passModExempt) include = true;
          if (!include) continue;

          const bp = bpBase.map((v, i) => v + manual[i]);
          const raw = computeRawStats(bp);

          let maxErr = 0;
          for (let i = 0; i < 7; i++) {
            const e = Math.abs(raw[i] - observed[i]);
            if (e > maxErr) maxErr = e;
          }

          const scoreRaw = scoreFrom(raw);
          const scoreRound = scoreFrom(raw.map(round2));
          const scoreTrunc = scoreFrom(raw.map(trunc2));
          const scoreDiff = Math.min(
            Math.abs(scoreRaw - observedScore),
            Math.abs(scoreRound - observedScore),
            Math.abs(scoreTrunc - observedScore)
          );
          const displayRoundMatch = matchesObserved2dp(raw, "round");
          const displayTruncMatch = matchesObserved2dp(raw, "trunc");
          const scoreMatch =
            scoreRaw === observedScore ||
            scoreRound === observedScore ||
            scoreTrunc === observedScore;
          const isExact = (displayRoundMatch || displayTruncMatch) && scoreMatch;

          const candidate = {
            isExact,
            rate,
            lost,
            rand,
            rSum: rand.reduce((a, b) => a + b, 0),
            manual,
            mSum: manualSum,
            caps,
            capExcess,
            maxErr,
            scoreRaw,
            scoreRound,
            scoreTrunc,
            displayMode: displayRoundMatch ? "round" : displayTruncMatch ? "trunc" : "near",
            raw: raw.map((v) => Number(v.toFixed(4))),
          };

          if (selectedModes.has("strict") && passStrict) {
            result.modes.strict.feasible++;
            if (isExact) result.modes.strict.exact++;
            pushTop(result.modes.strict, candidate);
          }
          if (selectedModes.has("none") && passNone) {
            result.modes.none.feasible++;
            if (isExact) result.modes.none.exact++;
            pushTop(result.modes.none, candidate);
          }
          if (selectedModes.has("mod-exempt") && passModExempt) {
            result.modes["mod-exempt"].feasible++;
            if (isExact) result.modes["mod-exempt"].exact++;
            pushTop(result.modes["mod-exempt"], candidate);
          }
        }
      }
    }
  }

  return result;
}

function printTop(modeName, result) {
  console.log(`\n=== Mode: ${modeName} ===`);
  console.log(`Feasible candidates: ${result.feasible}`);
  console.log(`Exact candidates (2dp stats + score=4099): ${result.exact}`);
  if (result.top.length === 0) {
    console.log("Top: none");
    return;
  }
  for (let i = 0; i < result.top.length; i++) {
    const t = result.top[i];
    const header = `#${i + 1} maxErr=${t.maxErr.toFixed(4)} scoreRaw=${t.scoreRaw} scoreRound=${t.scoreRound} scoreTrunc=${t.scoreTrunc} exact=${t.isExact}`;
    console.log(header);
    console.log(
      `  rate=${t.rate.toFixed(3)} lost=[${t.lost}] rand=[${t.rand}] rSum=${t.rSum} manual=[${t.manual}] mSum=${t.mSum} capExcess=${t.capExcess} mode=${t.displayMode}`
    );
    const statText = statNames
      .map((name, idx) => `${name}:${t.raw[idx]} (obs ${observed[idx]})`)
      .join(" | ");
    console.log(`  ${statText}`);
  }
}

function main() {
  let options;
  try {
    options = parseArgs();
  } catch (err) {
    console.error(String(err.message || err));
    usage();
    process.exit(1);
  }
  if (options.help) {
    usage();
    return;
  }

  const startedAt = Date.now();
  const result = runSearch(options);
  const elapsed = ((Date.now() - startedAt) / 1000).toFixed(2);

  const solvedBP = result.solvedBP;
  console.log("Solved BP from [HP,MP,ATK,DEF,AGI]:", solvedBP.map((v) => v.toFixed(4)));
  console.log("Solved BP sum:", solvedBP.reduce((a, b) => a + b, 0).toFixed(4));
  const spt = statBase[5] + solvedBP.reduce((acc, bp, i) => acc + matrix[5][i] * bp, 0);
  const rec = statBase[6] + solvedBP.reduce((acc, bp, i) => acc + matrix[6][i] * bp, 0);
  console.log(
    `Cross-check SPT/REC from solved BP: SPT=${spt.toFixed(4)} (obs ${observed[5]}) REC=${rec.toFixed(4)} (obs ${observed[6]})`
  );

  console.log(`\nSearch inspected combinations: ${result.inspected}`);
  console.log(`Lost combos used: ${result.lostCombos}`);
  console.log(`Rand combos used: ${result.randCombos}`);
  console.log(`After prune combinations: ${result.afterPrune}`);
  console.log(`Elapsed: ${elapsed}s`);

  if (options.mode === "all") {
    printTop("strict", result.modes.strict);
    printTop("none", result.modes.none);
    printTop("mod-exempt", result.modes["mod-exempt"]);
  } else {
    printTop(options.mode, result.modes[options.mode]);
  }
}

main();
