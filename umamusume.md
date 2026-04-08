# Umamusume Pretty Derby: complete training simulation mechanics

**The training mode in Umamusume Pretty Derby uses a layered multiplicative formula where stat gains equal base values plus flat bonuses, multiplied sequentially by growth rate, mood, training effectiveness, partner count, and friendship bonus — all floored to an integer.** Understanding the exact order of these multipliers and which effects stack additively versus multiplicatively is the single most important distinction for building an accurate simulator. This report synthesizes datamined values, community-verified formulas (primarily from researcher あむ and the VIP Wiki verification team), and open-source simulator codebases (hzyhhzy/UmaAi in C++, AC01010's Python simulator) to provide precise values for every system.

---

## Initial state: how starting stats are computed

Starting stats are built from three additive layers: character base stats, blue factor inheritance, and support card initial stat bonuses. Growth rates do **not** affect initial stats — they only multiply training gains.

**Base stats are per-character, not uniform per star rank.** Each character has a unique distribution across Speed, Stamina, Power, Guts, and Wisdom. Star rank (才能開花) adds a fixed **+50 total stats per rank** distributed across all five stats, though the per-stat allocation varies by character. Going from 3★ to 5★ adds roughly **+20 per stat** on average. The full per-character base stat tables are available in GameTora's character database.

**Blue factor inheritance** applies fixed, deterministic bonuses from all 6 family members (2 parents + 4 grandparents) at career start:

| Blue factor star | Stat points granted |
|---|---|
| 1★ | **+5** |
| 2★ | **+12** |
| 3★ | **+21** |

These stack additively across all family members. Maximum theoretical start bonus from blue factors alone is **+126** to a single stat (all six at 3★ in the same stat). A "9★ veteran" parent lineage (3★ parent + two 3★ grandparents in the same stat) contributes +63 per lineage.

**Support card "Initial Stat Up" effects** add flat values directly to starting stats. These are not affected by growth rates. Values vary per card and scale with card level — the game database stores values at breakpoints (Lv1, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50) with linear interpolation between them. Typical SSR max-level values range from **+10 to +35** per stat. All six deck cards contribute their initial stat bonuses regardless of facility placement.

The other starting conditions are universal across all scenarios and characters:

- **Starting SP**: Always **120** (confirmed by Altema and GameWith: "どのウマ娘でも育成開始時に確定で120スキルPt")
- **Starting energy**: Always **100** (maximum)
- **Starting mood**: Always **Normal** (普通, the middle tier with ±0% modifier)
- **Starting friendship**: Default **0** per support card. Cards with the "Initial Bond Gauge Up" (初期絆ゲージアップ) effect override this — typical values range from +15 to +40 at max level. Friendship training activates at **≥80 bond**

Regarding a purported "flat +20 parent bonus to all stats" — no major community resource (GameTora, GameWith, VIP Wiki) documents this as a standalone mechanic. The +20 figure likely refers to the URA Finals end-game victory reward (+10 per stat base, +20 with powered-up Happy Meek on JP server), not a universal parent bonus.

```
Starting_Stat[s] = CharacterBase[s][star_rank]
                 + Σ(blue_factor_value[star] for each of 6 family members with matching stat)
                 + Σ(initial_stat_up[s] from all 6 deck cards)
```

---

## The core training formula: six multiplicative layers

The verified training formula, confirmed by the VIP Wiki research team and implemented in multiple open-source simulators, calculates stat gain as:

```
Stat_Gain = floor(
  (Base + Σ StatBonuses)      ← ① additive base
  × GrowthRate                ← ② character multiplier
  × MoodEffect                ← ③ mood multiplier
  × TrainingEffect            ← ④ training effectiveness
  × PartnerBonus              ← ⑤ headcount bonus
  × FriendshipBonus           ← ⑥ rainbow training
)
```

**Per-stat cap: +100 per training** (reduced to +50 when the stat exceeds 1200).

**① Base + Stat Bonuses.** The base training value depends on facility type, level, and scenario. Flat stat bonuses (e.g., "Speed Bonus +1") from all support cards **present at that training** are summed and added to the base before any multipliers. These bonuses apply cross-facility — a Speed Bonus applies whenever Speed is gained, regardless of which facility you're at.

**② Growth Rate.** Each character has per-stat growth percentages (e.g., 0%, 10%, 20%). A 20% growth rate yields a multiplier of **1.20**. This applies only to training gains, never to initial stats or race rewards.

**③ Mood Effect** = `1 + (mood_base × (1 + Σ mood_effect_up))` where mood_base values are:

| Mood | Japanese | Base value |
|---|---|---|
| Very Good | 絶好調 | **+0.20** |
| Good | 好調 | **+0.10** |
| Normal | 普通 | **0.00** |
| Bad | 不調 | **−0.10** |
| Very Bad | 絶不調 | **−0.20** |

All present support cards' Mood Effect Up percentages are **summed** (additive). With no mood supports, Very Good gives a flat 1.20× multiplier. With 60% total Mood Effect Up at Very Good: `1 + (0.20 × 1.60) = 1.32`. Important: negative moods are also amplified by mood effect supports, making Bad mood worse.

**④ Training Effect** = `1 + Σ(training_effect_up)` from all present support cards. Values are **additive** across cards. Includes unique/innate bonuses.

**⑤ Partner Bonus** = `1 + 0.05 × N` where N is the number of support cards present. The chairman and reporter do not count. With 3 cards: 1.15×.

**⑥ Friendship Bonus** is the one **multiplicative** layer. Each card in friendship training (bond ≥80, at their specialty facility) contributes: `(1 + friendship_bonus) × (1 + unique_friendship_bonus)`. Multiple cards multiply together: `Π(1 + FB_i) × (1 + UFB_i)`. This is why double/triple rainbow training is so powerful — two cards at 35% + 10% unique each yield `1.35 × 1.10 × 1.35 × 1.10 = 2.20×`.

### Base training values (URA Finale, Global server, Level 1)

| Facility | Primary stat | Secondary stat(s) | SP | Energy |
|---|---|---|---|---|
| Speed | +10 Speed | +5 Power | +2 | −21 |
| Stamina | +9 Stamina | +4 Guts | +2 | −19 |
| Power | +8 Power | +5 Stamina | +2 | −20 |
| Guts | +8 Guts | +4 Speed, +4 Power | +2 | −22 |
| Wisdom | +9 Wisdom | +2 Speed | +4 | **+5** |

### Facility level scaling

Facilities level up every **4 training sessions** at that facility (summer camp sessions do not count). Each level adds **+1 to the primary stat** and proportional floor-rounded increases to secondary stats. Energy costs also increase by approximately **+1 per level** for physical facilities. The VIP Wiki notes the relationship: sum of base stat values (excluding SP) equals |energy cost| − 6 at every level. Wisdom energy recovery scales slightly upward with level.

### SP calculation

SP uses the **same multiplicative formula** as stats, with one key difference: the "SkillPt Bonus" from support cards is a **flat addition applied after** all multipliers, not before. Per GameWith: "スキルPtボーナス分、上昇値が加算される."

```
SP_Gain = floor(SP_base × GrowthRate × MoodEffect × TrainingEffect 
          × PartnerBonus × FriendshipBonus) 
        + Σ(SkillPt_Bonus from present cards)
```

### Training failure rates

Failure probability follows a quadratic function of energy **after** the training cost is applied:

For Speed/Stamina/Power/Guts:
`P_fail = 0.000258411 × E² − 0.0277237 × E + 0.622712`

For Wisdom:
`P_fail = 0.000263953 × E² − 0.0361337 × E + 0.983803`

Where E = post-training energy. Failure rate is effectively **0% above ~50 energy** and climbs steeply below 30. Consequences: normal failure inflicts −1 mood and −5 to the trained stat with an 8% chance of "Poor Practice" (練習下手). Severe failure inflicts −3 mood, −10 to the trained stat, −10 to two random stats, and a 50% "Poor Practice" chance. "Failure Rate Down" support effects multiply against the base failure probability.

---

## All 25 support card effect types

The game database (`support_card_effect_table` in `master.mdb`) contains **25 distinct effect types**. Values at each level are stored at breakpoints (every 5 levels) with linear interpolation between them. Effects unlock at specific level thresholds — some require Lv35+ or Lv45+.

### Training-time effects (require card to be present)

| ID | Effect | Japanese | Stacking | Notes |
|---|---|---|---|---|
| 1 | Friendship Bonus | 友情ボーナス | **Multiplicative** | Each card is separate multiplier; 15–40% at MLB |
| 2 | Mood Effect Up | やる気効果アップ | Additive | Amplifies mood base; 15–100% |
| 3 | Speed Bonus | スピードボーナス | Additive (flat) | +1 to +3; added before multipliers |
| 4 | Stamina Bonus | スタミナボーナス | Additive (flat) | +1 to +2 |
| 5 | Power Bonus | パワーボーナス | Additive (flat) | +1 to +2 |
| 6 | Guts Bonus | 根性ボーナス | Additive (flat) | +1 to +2 |
| 7 | Wisdom Bonus | 賢さボーナス | Additive (flat) | +1 to +2 |
| 8 | Training Effect Up | トレーニング効果アップ | Additive (%) | 5–20%; applies to all stats |
| 19 | Specialty Priority | 得意率アップ | Per-card | 20–120; affects facility appearance rate |
| 20 | Failure Rate Down | 失敗率ダウン | Multiplicative | 10–30%; reduces base failure chance |
| 21 | Energy Cost Down | 体力消費ダウン | Multiplicative | 10–30%; rounded up |
| 22 | SkillPt Bonus | スキルPtボーナス | Additive (flat) | +1 to +2; added post-multipliers |
| 23 | Wisdom Friend Recovery | 賢さ友情回復量 | Additive | +1 to +4; base wisdom friendship recovery is 5 |

### Career-start effects (applied once, from all 6 deck cards)

| ID | Effect | Japanese | Typical MLB range |
|---|---|---|---|
| 9 | Initial Speed | 初期スピード | +10 to +35 |
| 10 | Initial Stamina | 初期スタミナ | +10 to +35 |
| 11 | Initial Power | 初期パワー | +10 to +35 |
| 12 | Initial Guts | 初期根性 | +10 to +35 |
| 13 | Initial Wisdom | 初期賢さ | +10 to +35 |
| 14 | Initial Bond Gauge | 初期絆ゲージ | +15 to +40 |

### Passive/race effects (apply from all 6 deck cards regardless of placement)

| ID | Effect | Japanese | Notes |
|---|---|---|---|
| 15 | Race Bonus | レースボーナス | 5–15%; multiplies all race stat/SP rewards |
| 16 | Fan Bonus | ファン数ボーナス | 5–25%; multiplies fan gains |
| 17 | Hint Level Up | ヒントLvアップ | +1 to +4; per-card, independent |
| 18 | Hint Frequency | ヒント発生率アップ | 10–50%; per-card |
| 24 | Event Effect Up | イベント効果アップ | 20–50%; per-card events only |
| 25 | Event Recovery Up | イベント回復量アップ | 30–60%; per-card events only |

**Critical stacking rules for the simulator:** Friendship Bonus is the only training multiplier that stacks **multiplicatively** between cards — and unique friendship bonuses on the same card also multiply separately (not added to the regular friendship bonus). Everything else is additive within its category. Race Bonus and Fan Bonus always use the **full deck total**, not just present cards.

---

## Three scenarios compared: structure and unique mechanics

All three Global scenarios share an identical **78-turn structure**: 24 turns per year across Junior, Classic, and Senior years (2 turns per month), plus a 6-turn finale (3 training + 3 race turns). The first ~12 turns are pre-debut. Inheritance events fire at **career start, early April Classic year (~turn 31), and early April Senior year (~turn 55)**. Summer camp (early July through late August, 4 turns each year) forces all facilities to Level 5.

### URA Finals: the baseline scenario

The simplest scenario with the **highest base training values** on Global. Facility levels increase every 4 uses. Character-specific goal races are mandatory (6–12 per career). The finale is a 3-race elimination tournament where distance matches the trainee's most-raced category. Victory awards **+10 per stat and +80 SP** (affected by Race Bonus). Approximately **50–60 turns** are available for training. Scenario factor on inheritance: **Speed + Stamina**.

### Unity Cup: team-powered training

Same 78-turn skeleton and character goals as URA, but **lower base training values** (e.g., Speed facility gives +8 instead of +10 at Lv1). The deficit is compensated by the Spirit Explosion mechanic: team members display flame icons during training, and filling their Spirit Gauge triggers an explosion granting the trainee bonus stats (e.g., +15 primary stat, +7 secondary per explosion — capped at +50 per stat). Training facility levels are tied to **team stat rank** rather than usage count (Rank S = Lv5). Four team races occur at Late June/December of Classic and Senior years, plus an Aoharu Cup Finals. Reaching 10+ explosions unlocks the gold scenario skill. Training turns available: **~50–60**. Scenario factor: **Power + Wisdom**.

### Trackblazer: race-centric with an item economy

Radically different gameplay where ~50% of turns are spent racing. **No character-specific goals** — replaced by Grade Point objectives (G1 win = 100 points). A Pro Shop refreshes every 6 turns, selling Megaphones (+20/40/60% training bonus for 2–4 turns), Ankle Weights (+50% specific training for 1 turn), stat scrolls (+15 flat stat), facility level-up tickets (150 coins), and consumables. Uses the same lower base training values as Unity Cup. The finale is the Twinkle Star Climax (victory point system, not elimination). Only **~32–42 training turns** are available, but epithet bonuses from race routes can add +210 to +340 total stats. Critically, **no secret character events** exist in this scenario. Scenario factor: **Stamina + Guts**.

| Feature | URA Finals | Unity Cup | Trackblazer |
|---|---|---|---|
| Base training (Speed Lv1) | +10 | +8 | +8 |
| Training turns available | ~50–60 | ~50–60 | ~32–42 |
| Facility leveling | 4 uses/level | Team rank | 4 uses + shop |
| End-game | Elimination races | Elimination + cup | Victory points |
| Unique mechanic | Happy Meek (JP) | Spirit Explosion | Pro Shop + Epithets |
| Scenario factor | Spd + Sta | Pow + Wis | Sta + Guts |

---

## Inheritance: factors, activation, and generation

The factor system has five color types. **Blue (stat) factors** are the most impactful for starting stats. **Red (aptitude) factors** are essential for reaching S-rank aptitudes. Each completed career generates exactly one blue factor, one red factor, one green factor (if 3★+ rarity), and variable white factors from skills and races.

### Blue factor mechanics across three inheritance events

At career start, blue factors from all 6 family members **always activate** with fixed values (+5/+12/+21 per star). At the two mid-career events (April of Classic and Senior year), blue factors **always activate again** but with randomized values. The star level influences the probability distribution: higher stars skew toward higher rolls. Observed ranges span roughly +1 to +28, with 3★ factors averaging significantly higher.

### Red factor aptitude calculations

At career start, red factors use a **deterministic point system**: 1★ = 1 point, 2★ = 2 points, 3★ = 3 points. Points from all matching aptitude factors across the 6 family members are summed and converted to grade upgrades:

| Total points | Grades raised |
|---|---|
| 1–3 | 1 grade |
| 4–6 | 2 grades |
| 7–9 | 3 grades |
| 10+ | 4 grades (maximum) |

**Maximum starting aptitude from inheritance is A** — you cannot reach S at career start regardless of points. During mid-career inheritance events, red factors activate **randomly** (RNG-based, with higher stars and ◎ compatibility increasing activation probability). Each activated red factor raises the aptitude by exactly **1 grade regardless of star count**, and this is the only path to S rank.

### Factor generation at career end

Blue factor stat type is chosen randomly (20% each). Star probabilities depend on the final value of the chosen stat:

| Final stat value | 1★ | 2★ | 3★ |
|---|---|---|---|
| < 600 | 90% | 10% | 0% |
| 600–1099 | 50% | 45% | 5% |
| ≥ 1100 (SS+) | 20% | 70% | 10% |

Red factors are generated from a random A+ aptitude with star probabilities of 20%/70%/10%. Skill factors have a 20% generation chance per learned skill (25% for ◎, 40% for gold). Scenario factors are generated based on scenario completion. All white factor star rates follow 50%/45%/5% at standard ranks or 20%/70%/10% at SS+.

---

## Conclusion: key implementation priorities for simulator accuracy

The training formula's multiplicative friendship bonus is the single largest source of stat variance per turn — modeling it as additive instead of multiplicative will produce drastically wrong results for rainbow training. Energy management drives failure rates through a steep quadratic curve, making the exact post-training energy value critical. For scenario selection, URA's higher base training values versus Trackblazer's item economy and epithet bonuses represent fundamentally different optimization problems. The inheritance system's mix of deterministic (career start) and stochastic (mid-career) activation means simulators need both a fixed-value path and a probability distribution model. Open-source implementations in hzyhhzy/UmaAi (C++) and AC01010's Python simulator provide working reference code for all these systems, and GameTora's database mirrors the exact per-card, per-level effect values from the game's `master.mdb`.