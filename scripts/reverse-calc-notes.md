# 暗黑歌姬(攻) Reverse Calculation Notes

## Pet Info
- **Name:** 暗黑歌姬(攻)
- **Card:** 金卡
- **Level:** 130
- **Modifications:** 5改 (5 mods)
- **Base ranks:** [體22, 力50, 強20, 速26, 魔11] total=129
- **Skill slots:** 8
- **Race:** 人形系
- **Elements:** 30/30/30/30

## Observed Stats (PC client decimal)
| Stat | Value |
|------|-------|
| HP   | 2757.24 |
| MP   | 2181.55 |
| ATK  | 1353.02 |
| DEF  | 575.24 |
| AGI  | 444.67 |
| SPT  | 74.77 |
| REC  | 153.93 |

## Confirmed Score = 4099
| Item | Formula | Value |
|------|---------|-------|
| HP contribution | 2757.24 × 0.985 ÷ 3 | 905.29 |
| MP contribution | 2181.55 × 0.522 ÷ 3 | 379.59 |
| ATK contribution | 1353.02 × 3.21 ÷ 3 | 1447.73 |
| DEF contribution | 575.24 × 1.71 ÷ 3 | 327.89 |
| AGI contribution | 444.67 × 2.90 ÷ 3 | 429.85 |
| SPT contribution | 74.77 × 7 ÷ 3 | 174.46 |
| REC contribution | 153.93 × 5 ÷ 3 | 256.55 |
| **Base total** | sum | **3921.36** |
| Skill bonus | floor(60/100 × 130) | 78 |
| Full rank bonus | 金卡 | 100 |
| **Total score** | floor(3921.36 + 78 + 100) | **4099** ✓ |

## Known Formulas

### BP Calculation
```
bp[i] = realRank[i] * rate + rand[i] * rate + (realRank[i] / 24) * (level - 1) + manual[i]
```
- `realRank[i] = base[i] - lost[i]` (lost = 掉檔, 0~4 per stat)
- `rand[i]` = hidden random ranks, each 0~10, sum unknown (probably ≤ 10)
- `rate` = 倍率, default 0.2 (but might be different for StarCG)
- `manual[i]` = player-allocated points (配點)

### Manual Point Limits
- **Total limit:** `(level - 1) + cardRank * modGrade = 129 + 8×5 = 169`
- **Per-stat cap:** `perStatMaxBP[i] = max(0, floor(sum_{j≠i}(bpBase[j] + manual[j]) - bpBase[i]))`
- For 攻 build: most points in Str (index 1), cap ~163-166 depending on bpBase
- Need ~3 points in non-Str stats to raise cap enough → optimal: manual_str ≈ 166

### BP → Stats Matrix (confirmed from cg-hoshino source)
```
          Vit(體)  Str(力)  Def(強)  Agi(速)  Mag(魔)   Base
HP:       8.0      2.0      3.0      3.0      1.0       20
MP:       1.0      2.0      2.0      2.0      10.0      20
ATK:      0.2      2.7      0.3      0.3      0.2       20
DEF:      0.2      0.3      3.0      0.3      0.2       20
AGI:      0.1      0.2      0.2      2.0      0.1       20
SPT:     -0.3     -0.1      0.2     -0.1      0.8       100
REC:      0.8     -0.1     -0.1      0.2     -0.3       100
```

## What We Solved

### Step 1: Matrix Inversion (5x5 → BP from observed stats)
Using HP, MP, ATK, DEF, AGI (5 equations, 5 unknowns):

**Solved BP = [124.3512, 451.0991, 112.9103, 146.6370, 61.5906]**
- BP sum = 896.59

### Step 2: Cross-check SPT & REC
Using solved BP to compute SPT and REC:
- SPT calc = 74.78 (observed 74.77) → diff = **+0.01**
- REC calc = 153.93 (observed 153.93) → diff = **0.00**

The tiny SPT mismatch (0.01) is likely from 2-decimal rounding of observed stats.

## The Gap / Problem

### BP Decomposition: `bp[i] = realRank[i]*(rate + 5.375) + rand[i]*rate + manual[i]`

For the solved BP values and base ranks, we need:
```
manual[i] = solvedBP[i] - realRank[i]*(rate + 5.375) - rand[i]*rate
```

### With rate=0.2 (default), lost=0:
| Stat | solvedBP | bpGrowth (rank×5.575) | excess | Best (rand,manual) | intErr |
|------|----------|----------------------|--------|-------------------|--------|
| 體(22) | 124.35 | 122.65 | 1.70 | rand=3→man=1 (err=0.10) | 0.10 |
| 力(50) | 451.10 | 278.75 | 172.35 | rand=2→man=172 (err=0.05) | 0.05 |
| 強(20) | 112.91 | 111.50 | 1.41 | rand=2→man=1 (err=0.01) | 0.01 |
| 速(26) | 146.64 | 144.95 | 1.69 | rand=3→man=1 (err=0.09) | 0.09 |
| 魔(11) | 61.59 | 61.325 | 0.27 | rand=1→man=0 (err=0.07) | 0.07 |

- **rand = [3, 2, 2, 3, 1] sum = 11** (exceeds 10!)
- **or rand = [3, 1, 2, 3, 1] sum = 10**, manual = [1, 172, 1, 1, 0] sum = **175 > 169!**

### THE CORE ISSUE:
With rate=0.2, the total BP needed (896.59) exceeds the maximum possible:
- Max BP at rate=0.2 = sum(base[i]) × (0.2 + 5.375) + 10 × 0.2 + 169
- = 129 × 5.575 + 2 + 169 = 719.175 + 2 + 169 = **890.175**
- Needed: **896.59**
- **Gap: 6.41 BP**

So rate=0.2 CANNOT produce these stats. The rate must be higher.

### Required minimum rate (for lost=0, rand_sum=10):
```
sum(manual) = sum(solvedBP) - sum(realRank)*(rate+5.375) - sum(rand)*rate
            = 896.59 - 129*(rate+5.375) - 10*rate
            = 896.59 - 139*rate - 693.375
            = 203.215 - 139*rate

For sum(manual) ≤ 169:
203.215 - 139*rate ≤ 169
rate ≥ 34.215/139 = 0.2462
```

**Minimum rate ≈ 0.246** (for lost=0, rand_sum=10)

### With rate=0.25 (rough check):
- sum(manual) ≈ 203.215 - 34.75 = 168.47 → ≈168 or 169 (fits!)
- Str manual ≈ 169.85 - 0.75 = 169.1 (for rand_str=3) → 169
- But per-stat cap limits Str to ~166, need 3 points elsewhere
- Other stats need manual ≈ 0, but excess BP is small → errors accumulate

### What We Tried
1. **rate=0.2** → manual sum exceeds 169 by ~6. No solution.
2. **rate=0.25** → manual sum ≈168-169. Close but integer rounding errors propagate.
3. **rate=0.3** → Some stats have negative manual (bpBase exceeds solvedBP). Need lost>0.
4. **Rate sweep 0.15-0.50 step 0.001** with all lost/rand combos → now run with full brute force (details below).
5. **6x6 system** (solving for rate + 5 manual values using 6 stats) → SINGULAR because rate contributes linearly to BP just like manual does through the same matrix.
6. **2-decimal precision issue:** Observed stats rounded to 2dp introduce ~0.005 error per stat. Through the 5x5 matrix inverse (condition number ~10-50), this creates ~0.05-0.15 BP error per stat. This makes exact integer decomposition impossible.

## Latest Brute Force Result (2026-02-08)

Using the updated `scripts/reverse-calc.mjs`:
- Rate: `0.150 ~ 0.500` (step `0.001`)
- Lost: `0~2` each, total `<=4`
- Rand: each `0~10`, sum `<=10`
- Manual candidates: floor/ceil around solved real manual per stat
- Checked all 7 stats + score (`4099`)
- Modes:
  - `strict` (all manual points must satisfy per-stat cap)
  - `none` (ignore per-stat cap)
  - `mod-exempt` (allow cap overflow up to 40 mod points)

### Summary
- **Inspected combinations:** `101,189,088`
- **After prune:** `1,503,497`
- **strict mode feasible:** `0`
- **strict exact matches (2dp + score):** `0`
- **none mode feasible:** `5,168,302`
- **none exact matches (2dp + score):** `0`
- **mod-exempt mode feasible:** `5,168,302`
- **mod-exempt exact matches (2dp + score):** `0`

### Hard Constraint Re-run (User-confirmed: lost=0, rand_sum=10)
Command:
`node scripts/reverse-calc.mjs --mode all --lost-fixed 0,0,0,0,0 --rand-sum-exact 10 --top 5`

Result:
- **Inspected combinations:** `351,351` (351 rates × 1001 rand combos)
- **strict mode feasible:** `0`
- **strict exact matches (2dp + score):** `0`
- **none/mod-exempt feasible:** `37,843`
- **none/mod-exempt exact matches (2dp + score):** `0`
- Best near-fit under these hard constraints:
  - `rate=0.244`
  - `rand=[4,4,1,1,0]`
  - `manual=[0,169,0,0,0]`
  - `maxErr=0.9100`
  - `score=4098`

This means: with `lost=0` and `rand_sum=10`, the current model cannot produce the observed 7 stats + score simultaneously.

### Hard Constraint Re-run #2 (User-confirmed: manual all-in Str)
Command:
`node scripts/reverse-calc.mjs --mode all --lost-fixed 0,0,0,0,0 --rand-sum-exact 10 --manual-fixed 0,169,0,0,0 --top 5`

Result:
- **strict mode feasible:** `0`
- **strict exact matches (2dp + score):** `0`
- **none/mod-exempt exact matches (2dp + score):** `0`
- Best near-fit:
  - `rate=0.244`
  - `rand=[4,4,1,1,0]`
  - `manual=[0,169,0,0,0]`
  - `maxErr=0.9100`
  - `score=4098`
  - `capExcess=6` (Str cap still short by 6 under current strict-cap formula)

So even with `lost=0`, `rand_sum=10`, and `manual=[0,169,0,0,0]` fixed, the current formula set still cannot reproduce the observed profile.

### Best Near Candidate (none / mod-exempt)
```
rate   = 0.450
lost   = [1,0,1,1,1]
rand   = [0,2,5,0,3]   (sum=10)
manual = [2,159,0,1,2] (sum=164)
capExcess = 6

Raw stats:
HP=2757.1500 MP=2181.7250 ATK=1353.1550 DEF=575.2925 AGI=444.6575 SPT=74.7900 REC=153.8975
max abs error vs observed = 0.1750
scoreRaw/scoreRound/scoreTrunc = 4099/4099/4099
```

### Key New Insight
- Under the **current strict cap formula**, this dataset is **infeasible** (no candidate even before matching tolerance).
- Every top near-fit candidate requires **cap overflow ≈ 6** on Str.
- This strongly suggests one of these is off:
  1. per-stat cap rule implementation,
  2. BP→stats matrix coefficients,
  3. stat display precision/rounding behavior,
  4. hidden server-side bonuses.

## Verified Sample Data (哈士奇 - worked with rate=0.2)

This pet was successfully reverse-calculated in the previous session, confirming the formulas work.

### 哈士奇 Pet Info
- **Name:** 哈士奇
- **Card:** 金卡 (金)
- **Level:** 103
- **Base ranks:** [體20, 力25, 強24, 速25, 魔25] total=119 (not max 129 for 金)
- **Skill slots:** 10
- **Rate:** 0.2 (confirmed working)

### 暗黑歌姬(攻) Raw Data (for verification)
```json
{
  "name": "暗黑歌姬(攻)",
  "race": "人形系",
  "elements": {"earth": 30, "water": 30, "fire": 30, "wind": 30},
  "cardType": "金",
  "hp": 22,       // 體力 (Vit)
  "power": 50,    // 力量 (Str)
  "defense": 20,  // 強度 (Def)
  "speed": 26,    // 速度 (Agi)
  "magic": 11,    // 魔法 (Mag)
  "total": 129,
  "skillSlots": 8,
  "washPrice": 2400
}
```

### Observed Decimal Stats to Match
```
HP   = 2757.24
MP   = 2181.55
ATK  = 1353.02
DEF  = 575.24
AGI  = 444.67
SPT  = 74.77
REC  = 153.93
Score = 4099
```

### Score Breakdown (verified ✓)
```
Base score = (2757.24×0.985 + 2181.55×0.522 + 1353.02×3.21 + 575.24×1.71 + 444.67×2.90 + 74.77×7 + 153.93×5) / 3
           = (2715.88 + 1138.77 + 4343.19 + 983.66 + 1289.54 + 523.39 + 769.65) / 3
           = 11764.08 / 3
           = 3921.36

Skill bonus = floor(60/100 × 130) = floor(78) = 78
Full rank bonus = 100 (金卡, total=129=max)
Total = floor(3921.36 + 78 + 100) = floor(4099.36) = 4099 ✓
```

### Solved BP (from 5x5 matrix inversion)
```
BP[Vit] = 124.3512
BP[Str] = 451.0991
BP[Def] = 112.9103
BP[Agi] = 146.6370
BP[Mag] = 61.5906
Sum     = 896.5882
```

### BP Formula Reference
```
bp[i] = realRank[i] * rate + rand[i] * rate + (realRank[i] / 24) * (level - 1) + manual[i]

Where:
  realRank[i] = base[i] - lost[i]
  level = 130
  (level-1)/24 = 129/24 = 5.375

Simplified:
  bp[i] = realRank[i] * (rate + 5.375) + rand[i] * rate + manual[i]
```

## Remaining Approach

Use the updated script modes to isolate which assumption is wrong:
- `node scripts/reverse-calc.mjs --mode strict --top 10`
- `node scripts/reverse-calc.mjs --mode none --top 10`
- `node scripts/reverse-calc.mjs --mode mod-exempt --top 10`

### Key Questions for the Other Agent
1. **What is the actual rate (倍率) used in StarCG?** The default 0.2 from cg-hoshino doesn't work. Rate ≥ 0.246 is required.
2. **Does StarCG use the exact same BP→Stats matrix as cg-hoshino?** Even small coefficient differences would shift the solved BP values.
3. **Are the observed decimal stats truncated (floor) or rounded to 2dp?** This affects the error bounds.
4. **Could there be additional bonuses** (equipment, titles, etc.) included in the displayed stats?
5. **What is the actual rand sum limit?** Is it always 10, or can it be less?
6. **Does the growth formula `realRank/24 * (level-1)` exactly match StarCG's implementation?** Some games use slightly different growth formulas.
