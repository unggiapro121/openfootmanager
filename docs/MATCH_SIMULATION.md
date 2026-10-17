# Match Simulation

This document describes how OpenFoot Manager simulates football matches. There is one engine. The **live** engine (`live_match/`) plays a match a minute at a time and accepts commands between minutes — substitutions, formation changes, tactical instructions, half-time talks — and depletes condition per minute. `simulate` / `simulate_with_rng` (`headless.rs`) drive the same engine from kick-off to the final whistle in one call, with no benches, no commands and no extra time.

**Every fixture in an actively simulated competition is played by the live engine**, whether or not anybody is watching. The difference between the player's own match and the other nine on the same date is who is in the dugout, not which engine plays it: an unwatched match simply has an AI manager on both touchlines. Competitions outside the player's active scope are a third, much cheaper tier — a scoreline model, not a match engine (`turn/dormant.rs`).

The one-call entry is used by the tools: `sim-bench` (including its `--phase-sweep` dial table) and the `sim_lab` developer command. Numbers measured through it come from the same engine as a real fixture, but not the same match: no bench and no manager. A separate instant engine (`engine/`, a copy of the phase logic with team-level condition only) existed until phase 2 and was removed so every rule is written once.

## Historical Context

The original OFM simulation (documented in `docs/legacy/simulation.rst`) used a detailed event model with 15 pitch zones, transition matrices, and event chains (pass → intercept → foul → free kick). That system tracked possession through a fine-grained state machine.

The current implementation simplifies this to a **5-zone, action-based** model. Rather than modelling individual ball movements across 15 regions with transition matrices, the engine resolves 1–3 **actions per minute** in the current zone, with zone progression driven by action outcomes. This keeps the simulation fast (a full headless match in about 0.3 ms) while still producing realistic statistics and event feeds.

---

## Architecture

The simulation lives in the `engine` crate (`src-tauri/crates/engine/`), which is deliberately **decoupled from the domain crate**. It defines its own mirror types (`Position`, `PlayStyle`, `PlayerData`, `TeamData`) so that the engine can be tested and evolved independently.

```
engine/
├── types.rs      — PlayerData, TeamData, MatchConfig, Zone, Side, PlayStyle
├── event.rs      — MatchEvent struct + EventType enum (22 event variants)
├── headless.rs   — simulate / simulate_with_rng: a whole match in one call, on the live engine
├── report.rs     — MatchReport, TeamStats, PlayerMatchStats, GoalDetail
├── live_match.rs — LiveMatchState for step-by-step simulation
├── ai.rs         — AI manager decision engine
└── lib.rs        — Re-exports
```

The `ofm_core` crate bridges domain ↔ engine:
- `turn.rs` — converts domain types to engine types, runs simulations, applies results back
- `live_match_manager.rs` — wraps `LiveMatchState` with session management, RNG, AI profiles

---

## The Zone Model

The pitch is divided into 5 logical zones, viewed from a neutral perspective:

```
┌──────────┬──────────────┬───────────┬──────────────┬──────────┐
│ HomeBox  │ HomeDefense  │ Midfield  │ AwayDefense  │ AwayBox  │
└──────────┴──────────────┴───────────┴──────────────┴──────────┘
  ← Away attacks this way          Home attacks this way →
```

- **HomeBox / AwayBox** — the penalty areas. When the attacking team reaches the opposing box, a **shot** is resolved.
- **HomeDefense / AwayDefense** — the defensive thirds. Attacking here involves dribbles and tackles against defenders.
- **Midfield** — the contested middle. Possession battles, passes, interceptions happen here.

Zone progression is directional: the ball advances toward the attacking team's target box one zone at a time on successful actions, and retreats on failures.

---

## Minute-by-Minute Flow

Each simulated minute follows this sequence:

1. **Possession tick** — the possessing side's counter increments (used for possession % stats).
2. **1–3 actions** — a random number of actions are resolved in the current zone.
3. **Midfield contest** — after actions, a possession contest occurs. The possessing side's midfield rating is compared against the defending side's. If the defender wins, possession flips and the ball resets to midfield.

### Action Resolution by Zone

| Current Zone | Resolution Function | Key Players | Outcome on Success | Outcome on Failure |
|---|---|---|---|---|
| Own defense (buildup) | `resolve_buildup` | Defenders pass | Ball → Midfield | Interception, possession flips |
| Midfield | `resolve_midfield` | Midfielder vs Midfielder | Ball → Attacking third | Tackle/Interception, may trigger foul |
| Attacking third | `resolve_attacking_third` | Forward vs Defender | Ball → Attacking box | Tackle/Clearance, possible corner (25%, played out at once), may trigger foul |
| Attacking box | `resolve_shot` | Forward shoots vs GK | Goal or save | Shot off/blocked/saved, ball resets to midfield |

### Duel Resolution

The midfield duel, the one-on-one in the attacking third and the aerial duel after a cross are
decided by one shared module, `engine/src/duel.rs`:

```text
logit P(attacker wins) = Σ γᵢ · ln(attackerᵢ / defenderᵢ)   per compared component
                       + ln(M_attacker / M_defender)       condition, traits, style, role, home, tactics
                       + ln k                              the duel's anchor
```

With one component, γ = 1 and k = 1 this is exactly the old `a / (a + d)`. γ above 1 makes
attribute differences matter while two equal players still meet at 50/50; each anchor `k` holds the
league-wide share of duels the attacker wins where it was before the formulas changed.

| Duel | Components | γ |
|---|---|---|
| Midfield | attacker: passing, dribbling, vision, teamwork, agility, strength; defender: tackling, positioning, decisions, teamwork, pace, strength | 1 (higher compounds over ~90 duels a match into runaway favourites) |
| One-on-one | technique: dribbling + composure vs tackling + defending + positioning; physique: pace + agility + strength on both sides (the forward's weighted to pace, the defender's to strength) | 2 and 2 |
| Aerial (after a cross) | `0.55·aerial + 0.20·positioning + 0.25·strength`, times a height factor (±8% across ±20 cm of 182 cm; an unknown height of 0 is neutral) and ×1.08 for `AerialDominance` | 2 |

The aerial anchor is the one that moved: since phase 2 (P2.2) it is 0.64, so defenders win about 58%
of the duels after a cross, as they do in real football (they had won 48%). `ofm-sim-bench
--guardrails` gates the share at 54–62%.

### Headers

When the attacker wins the aerial duel, **he** heads at goal and the crosser is credited with the
assist; the header taker is never the crosser. A header is its own attempt
(`live_match/header.rs`), not a shot with the feet:

```text
rating    = 0.60·heading + 0.20·composure + 0.20·decisions            (× condition)
on target = clamp(0.40 + (rating − 50)/200, 0.15, 0.85), × 1.08 for PowerHeader
keeper    = 0.50·reflexes + 0.35·handling + 0.15·positioning          (× condition, keeper traits)
goal      = clamp(0.28·defensive line + (rating − keeper)/160, 0.08, 0.65)
```

A miss is off target (a won header is never blocked); a save is parried for a corner 40% of the
time, as any save. A header is never fouled into a penalty.

### Corners

A corner (25% of the one-on-ones the defence wins, 40% of saves) is played out in the same action
(`live_match/set_pieces.rs`, phase 2 P2.3). The club's `corner_taker` takes it while he is on the
pitch, otherwise the outfielder with the best `0.70·crossing + 0.30·curve`. His delivery `Q` (that
blend, × condition, ×1.04 for `DeadBallSpecialist`) decides how often the ball reaches the aerial
contest, `clamp(0.70 + (Q − 65)/200, 0.40, 0.85)`; a ball that does not is cleared (70%) or kept short.
The man meeting it is drawn from the forwards (weight 1.0), the two centre-backs who head best (0.9)
and the midfielders (0.5), never the taker; the aerial duel's odds are multiplied by
`clamp(1 + (Q − 65)/250, 0.92, 1.08)`, and a won duel is a header with the taker as the assist.
Every event of a corner carries `set_piece = Corner`. A corner is worth about 3% of a goal, as in
real football (it had been worth 5.7%).

### Roles that act on their own

Three roles change no duel's rating; each acts at its own moment (phase 2 P2.6, `live_match/roles.rs`):

- **Sweeper keeper.** On the break (a side that broke fast, or beat a counter-press, still has the ball
  in its attacking third or has carried it into the box), once the forward has won his one-on-one, a
  `SweeperKeeper` comes for the ball: he wins it with `σ(2·ln(((pace + positioning + decisions)/3) /
  forward's pace) + ln 1.05)`, else the forward shoots at the goal he has left and scores 14%. A one-on-one
  won on the break is worth about 0.08 of a goal without him (real-world probe), so he pays his way from
  about a 40% chance.
- **Inverted full-back.** At the end-of-minute possession contest, the side on the ball has its
  midfield multiplied by `1 + 0.08·Δ` for one `InvertedFB` in a full-back or wing-back slot, `1 + 0.08·max Δ +
  0.03·min Δ` for two, with `Δ = clamp(((passing + vision)/2 − the midfielders' mean)/20, −0.25, 1)`.
- **Centre-back pair.** Counting the `Stopper`s and `CoverCB`s in centre-back slots: one of each multiplies
  the defender in every attacking-third one-on-one by 1.08; two Stoppers and no Cover CB by 0.85 on the
  break; two Cover CBs and no Stopper by 0.85 otherwise. AI clubs split a same-kind pair when they pick
  their side (`ofm_core` `split_ai_centre_back_pair`); the tactics screen warns the user.

The old `InvertedFB` midfield and `SweeperKeeper` defence multipliers, which no duel ever applied, are gone.

### Shots from distance

Each action in the attacking third may be a shot from distance instead of the one-on-one (phase 2
P2.5, `live_match/long_shot.rs`). The man who might shoot is a midfielder (55%) or the man on the
ball, and he tries it with

```text
logit = BASE + (a[slot] − a[ST]) + 1.35·(long_shots − μ[slot])/10 + 0.90 ShootsFromDistance + 0.25 vs Compact
P     = min(σ(logit), 0.45)
```

`a` and `μ` are the position table `ShootsFromDistance` is assigned by (`ofm_core/assigned_traits.rs`,
pinned to the engine's copy `live_match::long_shot_norm` by a test), read by his formation slot;
`BASE = −2.30` is calibrated on the real-world probe, where 31% of shots come from outside the box,
as in real football. The shot, rated `0.60·long_shots + 0.25·curve + 0.15·composure`, is blocked
`clamp(0.31 × the defence's shape, 0.18, 0.45)` (40% of blocks go to the defence, the rest run loose
to the attack), on target `clamp(0.32 + (R − 50)/220, 0.12, 0.70)` ×1.08 for `LongShooter` and for
`Curler` (×1.12 at most), and in `clamp(0.14 + (R − keeper)/250, 0.02, 0.35)`; a save goes behind for
a corner 30% of the time. About 3.4% are scored. Events carry `shot_kind = LongRange` and the zone of
the attacking third; a goal's source is `LongShot`.

Since P2.5 the bridge hands the engine `shooting` as it is (finishing inside the box), no longer
blended with `long_shots`.

### Direct free kicks

A foul in the attacking third becomes a shot straight at goal 12.5% of the time (phase 2 P2.4, raised
from 10% at P2.5, which left fewer such fouls; in
`live_match/set_pieces.rs`); otherwise the fouled side keeps the ball there as before. The club's
`free_kick_taker` takes it while on the pitch, otherwise the outfielder with the best
`0.65·free_kick + 0.35·curve`. With `FK` that blend × condition (×1.08 for `DeadBallSpecialist`), the
wall stops 25% (half cleared, half behind for a corner), then the shot is on target
`clamp(0.35 + (FK − 50)/180, 0.15, 0.75)` and beats the keeper
`clamp(0.18 + (FK − keeper)/200, 0.04, 0.40)`, the keeper rated `(reflexes + positioning)/2`. That makes
about 0.9 direct free kicks a match, about 6% of them scored, as in the Premier League. Every event
carries `set_piece = FreeKick` and `shot_kind = DirectFreeKick`; a goal's source is `DirectFreeKick`.

### Shot Resolution

When the ball reaches the attacking box other than from a won header, a shot is taken:

1. **Accuracy check** — base accuracy (configurable, default 45%) adjusted by the shooter's `shooting + composure + decisions` rating. Clamped to 15%–85%.
   - **Miss**: 40% chance the shot is blocked, 60% chance off target.
2. **Conversion check** — base conversion (default 30%) adjusted by `(shooter_rating - goalkeeper_rating) / 150`. Clamped to 10%–70%.
   - **Score**: Goal event emitted with scorer + assister.
   - **Save**: Shot saved event.

### Foul & Discipline

Fouls can occur after tackles in midfield and the attacking third:

1. **Foul probability** — base 12%, modified by the fouler's `aggression` attribute and the `HotHead` / `CoolHead` traits.
2. **If foul occurs in the box** → 8% chance of a **penalty** being awarded.
3. **Card probability** — 30% chance of a yellow, modified by aggression. 4% chance a card is upgraded to red.
4. **Second yellow** → automatic red card and sending off.
5. **Injury** — 3% chance per foul that the fouled player is injured, scaled by his match fitness
   (`injury_fitness_multiplier`: ×3 under 30, ×2 under 50, ×1.5 under 70, ×0.7 at 90 and over), at
   most once a match. In the live match he takes no further part from that minute — every place that
   skips a sent-off player skips him too (`out_of_play`) — but unlike a sent-off player he can be
   substituted. The AI replaces him at once with the bench player best suited to his position; the
   manager's own match pauses (`step_many` stops) so he can choose, or play on a man short. After the
   match the injury is applied for real — see [GAME_SYSTEMS.md](GAME_SYSTEMS.md#match-injuries).

Sent-off players are excluded from all future player selection for their team.

---

## Player Attributes

Players carry 26 attributes, grouped into categories:

**Physical**: pace, stamina, strength, agility
**Technical**: passing (short), long_passing, crossing, curve, free_kick, shooting (inside the box), long_shots, tackling, dribbling, first_touch, heading, defending
**Mental**: positioning, vision, decisions, composure, aggression, teamwork, leadership
**Goalkeeper**: handling, reflexes, aerial (jumping and contesting a high ball)

The seven split attributes came out of four older blends. The phases not yet moved onto them are
tuned on those blends, so the bridge (`ofm_core/turn/squad.rs`) hands the engine `passing` and
`dribbling` rebuilt by the pre-split formulas (`PlayerAttributes::legacy_blends`); `shooting` moved
at P2.5.
`aerial` and `heading` moved in phase 2's P2.2: the aerial duel reads `aerial` (jumping and
strength) and the header reads `heading`. A synthetic player who leaves any of the seven at 0 has
it filled at kick-off from the field it split from (`PlayerData::declare_split_attributes`).

Besides attributes, `PlayerData` carries `height_cm` (0 when not known). It feeds only the height
factor of the aerial duel. The generator draws it with the player's weight and ties `aerial`,
`strength`, `agility` and `pace` to the body (see `ofm_core/src/generator/physique.rs`).

### Overall Rating

A player's overall rating (OVR) is the mean of the 11 core outfield attributes (pace, stamina, strength, passing, shooting, tackling, dribbling, defending, positioning, vision, decisions).

### Effective Rating

The effective rating accounts for **condition** (stamina/fitness, 0–100):

```
effective_overall = overall × (condition / 100)
```

A tired player (condition 50) performs at half their potential.

---

## Composite Team Ratings

The engine computes team-level ratings from player attributes by position:

| Rating | Source Players | Attributes Used | Weighting |
|---|---|---|---|
| **Defense** | Defenders (70%) + GK (30%) | defending, tackling, positioning, strength | Position average |
| **Midfield** | Midfielders | passing, vision, decisions, stamina | Position average |
| **Attack** | Forwards (75%) + Midfielders (25%) | shooting, dribbling, pace, positioning | Blended average |
| **Goalkeeper** | Goalkeepers | positioning, decisions, pace, strength | Position average |

---

## Play Styles

Each team has a play style that applies multiplicative modifiers to different phases of play:

| Play Style | Midfield | Attack | Defense | Press |
|---|---|---|---|---|
| **Balanced** | 1.00 | 1.00 | 1.00 | 1.00 |
| **Attacking** | 1.00 | **1.12** | 0.93 | 1.00 |
| **Defensive** | 1.00 | 0.93 | **1.12** | 1.00 |
| **Possession** | **1.15** | 0.97 | 1.00 | 1.00 |
| **Counter** | 0.92 | **1.18** | 1.00 | 1.00 |
| **High Press** | 1.00 | 1.00 | 0.95 | **1.20** |

These modifiers are applied to the relevant team rating during action resolution, for whichever side the phase belongs to: Midfield to both sides contesting the middle, Attack to the side going forward, Defense to the side defending its third, Press to the side pressing. For example, a Counter team gets an 18% boost to attack rating but an 8% penalty to midfield control, whether it has the ball or not.

### The head coach

Each side carries its head coach's mastery of every play style (`TeamData::coach`, a
`CoachMastery`, 1–100; `ofm_core::turn::squad` fills it from the club's manager). The
mastery `m` of the style in use scales the table: with `k = 0.5 + m/100`, a value above
1.0 moves `k` times as far from 1.0 and a value below 1.0 moves `2 − k` times as far. A
neutral coach (50) plays the table as printed; a coach of 90 turns Counter's 1.18 / 0.92
into 1.252 / 0.952, a coach of 20 into 1.126 / 0.896. A mid-match style change reads the
coach's mastery of the new style at once.

---

## Phase Blueprint (TacticsConfig)

On top of the play style, each team carries a `TacticsConfig` (mapped from the
domain `TacticsPhaseSettings`) of nine dials. Every dial defaults to a neutral
option that multiplies by ×1.0 — and the transition dials roll nothing — so a
team on its defaults simulates **byte-identically** to the pre-dial engine.

Each dial has exactly one hook and one direction (no opposing effects stacked on
a single dial). The first five are applied in their per-action zone; the rest add
the possession/transition dimension the zones don't cover, hooked into the
per-minute possession contest.

| Dial | Hook | Effect |
|---|---|---|
| build_up | build-up pass success | Short retains, Long is riskier |
| width | cross probability (attacking third) | Wide crosses more |
| def_line | shot conversion conceded | High concedes better chances in behind |
| marking | foul probability | Man-to-man fouls more |
| pressing | possession contest (def) + build-up press + **in-match stamina** | Aggressive wins the ball back more, tires faster |
| tempo | midfield progression (att) + possession contest retention (att) | Direct shoots more / Patient holds the ball |
| defensive_shape | attacking-third defence (def) | Compact concedes fewer chances |
| counter_press | possession flip: losing side may re-win the ball | Long regains possession more |
| break_speed | possession flip: winner may counter into the final third | Fast turns turnovers into chances |

The weekly AI tactical review in `ofm_core::ai_tactics` treats at least 3.2
goals conceded per game as leaky and at most 1.4 scored as blunt. Those cutoffs
were calibrated when the generated-world probe measured about **2.29 goals per
club per game** after #605 changed the selected eleven. A scoring change needs
a fresh run of `tactical_adaptation_probe` before those cutoffs can be trusted.

The live engine consumes every dial, including the stamina cost of pressing,
which needs per-minute condition and so is charged in every match the game
plays. Magnitudes live in `engine::shared` and are tabulated by
`cargo run -p sim-bench -- --phase-sweep`, each dial's effect on possession %,
shots and goals against a neutral opponent. Read that table with its path in
mind: the sweep plays headless matches, so it prices a dial in a match with no
bench and no manager. `tests/tactical_identity_probe.rs` is the
measurement taken on the path the game actually plays.

---

## Home Advantage

The home team receives a configurable multiplier (default **1.08**, i.e. 8% boost) applied to all their ratings during action resolution. This models the effect of playing at home — crowd support, familiarity with the pitch, etc.

---

## Player Traits

Traits are computed from a player's attributes and position (see `domain::player::compute_traits()`). The engine uses trait names as strings and applies multiplicative bonuses in 7 contexts:

| Context | Relevant Traits | Bonus |
|---|---|---|
| **Shooting** | Sharpshooter (+8%), CoolHead (+4%), CompleteForward (+5%) | |
| **Dribbling** | Dribbler (+8%), Speedster (+4%), Agile (+4%) | |
| **Passing** | Playmaker (+8%), Visionary (+5%), DeadBallSpecialist (+3%) | |
| **Tackling** | BallWinner (+8%), Rock (+5%), Tank (+4%) | |
| **Goalkeeping** | SafeHands (+8%), CatReflexes (+6%), AerialDominance (+4%) | |
| **Foul** | HotHead (+25% foul chance), CoolHead (−30% foul chance) | |
| **Midfield** | Engine (+6%), TeamPlayer (+4%), Tireless (+3%) | |

Trait bonuses are multiplicative — a Sharpshooter with CoolHead gets `1.08 × 1.04 = 1.123` (12.3% boost) on shooting actions.

---

## Match Configuration

All probabilities and multipliers are tuneable via `MatchConfig`:

| Parameter | Default | Description |
|---|---|---|
| `home_advantage` | 1.08 | Multiplier for home team ratings |
| `shot_accuracy_base` | 0.45 | Base chance a shot is on target |
| `goal_conversion_base` | 0.30 | Base chance an on-target shot scores |
| `fatigue_per_minute` | 0.15 | Condition loss per minute (live mode) |
| `foul_probability` | 0.12 | Base chance a tackle results in a foul |
| `yellow_card_probability` | 0.30 | Chance a foul produces a yellow |
| `red_card_probability` | 0.04 | Chance a card is direct red |
| `penalty_probability` | 0.08 | Chance a box foul is a penalty |
| `stoppage_time_max` | 4 | Max stoppage time minutes per half |
| `injury_probability` | 0.03 | Chance of injury per foul, before the fitness factor |
| `engine_model` | `Zones5` | The match model. `Grid15` is the 5×3 grid of phase 2 GĐ3, built beside `Zones5` package by package; every GĐ3 rule runs only under it, so `Zones5` plays exactly as before. The game always plays `Zones5`; sim-bench (`--engine-model`), SimLab and the real-world probes (`OFM_ENGINE_MODEL`) can pick `Grid15`. `Zones5` goes once `Grid15` passes the GĐ3 gate (P3.8) |

`PlayerData` also carries `footedness` (`Foot::{Left, Right, Both}`, from the domain player's footedness) since P3.0. Nothing reads it yet; GĐ3's wing play (P3.4) will.

---

## Match Report

After simulation, a `MatchReport` is generated from the raw event list:

- **TeamStats** — goals, shots (on/off/blocked), passes (completed/intercepted), tackles, interceptions, fouls, corners, free kicks, penalties, cards, possession ticks
- **PlayerMatchStats** — minutes played, goals, assists, shots, passes, tackles, interceptions, fouls, cards, match rating (0–10)
- **GoalDetails** — minute, scorer, assister, and the goal's source (`GoalSource`: open play, header, corner, free kick, penalty)
- **Possession %** — computed from possession ticks: `home_ticks / (home_ticks + away_ticks)`

### Event protocol 2

Reports and snapshots carry `protocol_version` (2 for every match played since phase 2's P2.1, 1 when
read from before). Protocol 2 events add four optional fields, filled in by `LiveMatchState::emit`,
the one place every action's events pass through:

| Field | On | Meaning |
|---|---|---|
| `shot_kind` | every attempt (shots, goals, penalties) | `Open`, `Header` or `Penalty` |
| `set_piece` | a `Corner` or `FreeKick` event, and everything the action a corner leads to produces | `Corner` or `FreeKick` |
| `goal_source` | `Goal`, `PenaltyGoal` | decided once, when the goal is scored (`GoalSource::of`): a penalty is a penalty, then a corner beats a header, then the rest is open play. The report, the match history (`CompactMatchEvent.goal_source`) and the UI only read it |
| `lane` | events led by a player in the XI | `Left`, `Centre` or `Right`, from his formation slot as his side attacks. Display only; the engine does not read it |
| `tactical_context` | events of an action on the break, and a sweeper keeper's | `Counter`, `SweeperKeeperInterception` or `KeeperOffHisLine` (P2.6) |

Before protocol 2 a goal's source was inferred from the events before it, which counted a goal
scored several actions after a free kick as a free-kick goal.

### Event protocol 3 (the GĐ3 grid)

A match played under `EngineModel::Grid15` writes protocol 3 (phase 2, P3.1). The only change so far
is `lane`: it is the lane of the **ball**, as the event's side sees it, on every event the engine
emits. The ball's lane is stored from the home side's attacking direction and read through
`lane_for(side)`, so a tackle by the defending side carries the mirror of the lane the attacker
had it in, and a change of possession does not move it.

Where the ball goes is the **lane matrix** (`live_match/lanes.rs`, P3.3). Each time a side moves
the ball up a zone (a pass completed out of defence or through midfield), and when the defence
wins it in its own third and the ball jumps to the other end, the next lane is drawn from the
current one: from the centre it stays with `c` or goes out to either flank; from a flank it stays
with `s`, comes inside with `a`, or switches to the far flank with `w`. Width sets the four numbers
(`Normal`: c 0.15, s 0.78, a 0.10, w 0.12, set so that about 22% of the final third's one-on-ones
go down the centre, as in real football). The switch scales with the passer's `long_passing`
(×0.5 at 25 or below, ×1.5 at 75 or above, the difference staying on the flank), and a flank the
side has nobody on is chosen three times less often. A corner goes to the flank it was on (or,
from the centre, left on even minutes and right on odd ones); a cross, and any entry into the box,
puts the ball in the centre, because the box is one cell; kick-offs, goal kicks, penalties and
goals bring it back to the centre. Nothing reads the lane yet: it changes only who is picked once
the presence table arrives (P3.2).

Minutes are counted from when a player came on: a substitute who is himself taken off is credited
with the time between the two substitutions, not with every minute up to his exit.

### Match Ratings

`engine/src/rating.rs` rates every player on either side's books — starters and the bench, so a
player taken off is rated for the time he played. `LiveMatchState::into_report` calls it, so a
headless match from `simulate_with_rng` is rated the same way.

```
rating = 6.0 − 0.5 (an ordinary game's work)
       + what he did:  goal +1.2 · penalty goal +0.7 · assist +0.7 · penalty miss −0.6
                       shot saved +0.1 · shot off target −0.05 · shot blocked −0.03
                       pass completed +0.01 (at most +0.5) · pass intercepted −0.03
                       dribble +0.06 · dribble tackled −0.04 · cross +0.02
                       tackle +0.07 · interception +0.08 · clearance +0.04
                       foul −0.05 · yellow −0.3 · red / second yellow −1.5
       + the result:   win +0.3 · loss −0.3
       + keepers:      clean sheet (≥ 60 min) +0.6, else −0.25 per goal conceded × share of match;
                       +0.15 per save (credited to the side's longest-serving keeper; the
                       live engine names the saving keeper as `ShotSaved`'s secondary player,
                       for the match radar, but the rating does not read it yet)
       + defenders:    clean sheet (≥ 60 min) +0.4, else −0.15 per goal conceded × share of match

under 30 minutes: pulled toward 6.0 in proportion to the minutes played
under 10 minutes: not rated (0.0)
clamped to 3.0–10.0, rounded to 0.1
```

The scale centres on 6.0, an ordinary game: `ratings_centre_on_six_across_many_matches` pins the
mean of forty evenly matched games to 5.85–6.15. Ninety anonymous minutes land at 5.5. The 0.5
baseline is the average contribution the engine produces per player; if the engine starts producing
more or fewer actions, that test fails and the baseline moves with it.

A rating of 0.0 means "not rated" everywhere it is read: season averages
(`PlayerSeasonStats::avg_rating` is averaged over `rated_appearances`), post-match morale, awards,
and the player profile, which shows a dash.

---

## Live Match System

The live match system (`live_match.rs`) wraps the core zone-based resolution into a **step-by-step** simulation with:

### Match Phases

```
PreKickOff → FirstHalf → HalfTime → SecondHalf → FullTime
                                                      ↓ (if drawn + extra time allowed)
                                              ExtraTimeFirstHalf → ExtraTimeHalfTime
                                                      → ExtraTimeSecondHalf → ExtraTimeEnd
                                                                                    ↓ (if still drawn)
                                                                            PenaltyShootout → Finished
```

### Commands

Users (and AI) can inject commands between minutes:

- **Substitute** — swap a player on the pitch with a bench player (max 5 subs per match)
- **ChangeFormation** — change the team's formation (e.g. "4-3-3" → "3-5-2"), which reassigns player positions — each player takes the group of the slot he stands in (`formation_slots`), so 3-4-2-1's wing-backs (second row: LWB, CM, CM, RWB; phase 2 P2.7) are defenders and keep a wing-back role
- **ChangePlayStyle** — switch between the 6 play styles
- **SetFreeKickTaker / SetCornerTaker / SetPenaltyTaker / SetCaptain** — assign set piece roles

### Stamina Depletion

In live mode, player condition depletes each minute based on `fatigue_per_minute`. A `condition_adjusted_skill()` function scales all attribute checks by the player's current condition, so fatigued players perform worse. This makes substitutions tactically meaningful.

### Penalty Shootout

If a match is drawn after extra time (when allowed), a penalty shootout is resolved:
- 5 rounds of alternating penalties
- If still tied, sudden death rounds continue until one team leads after equal attempts

### Match Snapshot

At any point, a `MatchSnapshot` can be taken — a serializable view of the entire match state including scores, teams with current conditions, events, phase, substitution records, and bench players. This is what the frontend renders.

---

## AI Manager

The AI manager (`ai.rs`) controls non-player sides during live matches. It is consulted once a
minute and can issue substitution and tactical commands. It reads the match through
`AiObservation` — a borrowed, side-relative view built by `LiveMatchState::observe()`, not a
`MatchSnapshot`.

### AI Profile

Each AI manager has:
- **Reputation** (0–1000) — higher = more sophisticated decisions
- **Experience** (0–100) — decides which checkpoints he works to, how early he replaces a spent
  player, and how often he gets a close call wrong
- **Personality** — `Pragmatist` waits for the scheduled moments; `Visionary` reaches for a
  different shape before a different label and looks up when a goal goes against him; `Reactive`
  takes stock every time the score changes

### When the manager looks up

Reactions are **not** rolled for each minute. A manager takes stock at fixed moments and
immediately when the match changes under him:

| Moment | Who |
|---|---|
| Half-time, and the interval in extra time | every manager |
| 80' | every manager |
| 70' | experience ≥ 40 |
| 60' | experience ≥ 70 |
| 113' | every manager — the last look before penalties |
| A sending-off, either side | every manager, that minute |
| A goal, either way | `Reactive` always; `Visionary` when it went against him |
| Nobody left in goal | every manager, every minute, ahead of everything else |

Exhaustion is judged **every** minute rather than at a checkpoint: a spent player is not a
judgement call, and the condition economy is calibrated on that branch firing the minute a
starter crosses the line.

### What he decides

**Substitutions** (one per evaluation, in this order):
1. No available goalkeeper on the pitch — a bench keeper comes on for the most spent outfielder,
   forwards first. He keeps `Position::Goalkeeper` rather than inheriting the vacated slot.
2. Any starter below the fatigue threshold (55 − experience×10 from 75', 45 − experience×8 from
   60', otherwise 35) — replaced in kind.
3. Chasing — two goals down at any checkpoint, one goal down from 60'. A forward comes on for the
   most spent defender or midfielder, never breaking up a back four below three.
4. Protecting a lead from 80' — a defender comes on for the most spent forward, always leaving one
   up front.

Who comes off is whoever has least left to give. Two players within 10 condition points look
identical from the touchline, and a manager takes the wrong one off with probability
(1 − experience/100)/2 — the in-match twin of the lineup picker's misjudgement. It never decides
*whether* he acts.

**Tactical changes** (one per evaluation):
- A `Visionary` who is losing after 60' changes shape first: 4-4-2 → 4-3-3 → 4-2-3-1. The chain
  ends, so this fires at most twice.
- Otherwise a target play style: Attacking two goals down, or one goal down from 60' unless already
  HighPress; Defensive with a lead from 80', or pinned in one's own half for 7 of the last 10
  minutes with nothing to chase.
- If the style is already right, one dial underneath it (`ChangeTacticalDial`). Chasing: a higher
  line, then a faster break, then a harder press. Protecting: a lower line, then a compact shape,
  then a passive press — subject to the ration on under-priced dials, at most two per side. The
  rule lives once, in `engine::ai::under_priced_dials` and `MAX_UNDER_PRICED_DIALS`; `ai_tactics`
  applies the same one between matches by asking the engine.

**Nothing here ever issues a command to undo an earlier one.** A position that has stopped calling
for a change produces no target rather than the opposite one, so a side that dropped deep under
pressure stays deep when the pressure lifts. That is the hysteresis.

All five substitutions are available to every branch; `max_subs` is the only limit.

---

## Integration: Domain ↔ Engine

The `ofm_core/turn/` bridge is the only place the conversion is allowed to live —
`engine` never imports `domain`, so every domain type is translated here.

1. **`turn/squad.rs`** — the single domain→engine squad builder, shared by both match
   paths. `build_team_with_bench()` picks eleven slot-aligned starters from the club's fit
   players and returns the bench separately, so only actual participants are handed to the
   engine. Who picks them depends on whose club it is: the user's own club goes through
   `select_starting_xi()`, which honours the saved XI and rebuilds one only when fewer than
   eight saved starters are still available; every other club goes through
   `ai_select_starting_xi()`, a reputation-driven policy that rotates for freshness. A club
   with too few fit players to fill the formation makes the shortfall up from its injured
   list rather than fielding a short side — the engine has no forfeit, and an empty side
   would crash it. The builder also maps positions, play styles, roles, the nine tactical
   dials, and all 26 attributes + traits.
2. **`simulate_matchday()`** — for each fixture on a match day, opens a `LiveMatchSession`
   through `create_live_match()` and runs it to completion. The bench comes with it, so an
   unwatched match has substitutions and tactical changes like any other; `user_side` is
   cleared, because with nobody watching, both dugouts are the AI's — including the player's
   own club when the day was advanced past its fixture. A knockout tie plays extra time and,
   if still level, the engine's penalty shootout.
3. **`apply_match_report()`** — writes results back to the domain: fixture status, match result, standings updates, player season stats (goals, assists, cards, rating, clean sheets).
4. **`apply_player_stats()`** — updates individual `PlayerSeasonStats` from the engine's `PlayerMatchStats`.

For live matches, `live_match_manager.rs` provides:
- **`create_live_match()`** — builds a `LiveMatchSession` from the current game state, using the same `turn/squad.rs` builder and keeping the bench for substitutions
- **`LiveMatchSession`** — wraps `LiveMatchState` with an RNG, AI profiles for both sides, and metadata. Provides `step()`, `step_many()`, `run_to_completion()`, `snapshot()`, and `apply_command()` methods.

---

## Measuring the Engine (sim-bench)

Every change that can move results is measured with `sim-bench` (`src-tauri/crates/sim-bench/`):

- `--rating-gap-sweep` plays each gap (0–20, `--gap-step`) with `--pairs` independently drawn
  squad pairs (default 60), the stronger side at home in half of each pair's games. One pair
  decides nothing: two separately drawn sides of the same rating differ by about 14 win points.
  Gap 0 pits a squad against its own mirror, so the even matchup really is even. `--managed`
  adds seven-man benches and `ai_decide` on both sides, the way every unwatched fixture plays.
- `--guardrails` is the phase-2 gate: a fixed managed sweep (gaps 0–20 step 2, 60 pairs, 2,000
  matches a gap) judged against the agreed bands, `--stage lan-can` for the loose band and
  `--stage gd5` for the calibration target. It exits 1 on a FAIL. Build it with `--release`;
  in a debug build the timing row is reported but not judged. Rows that compare sampled rates
  allow for sampling noise: the win curve may dip only within 2σ, and the gap-0 mirror split may
  differ by more than 3 points only within 3σ (about 5.8 points over 2,000 matches; 2σ still failed
  a fair engine one run in twenty, and every change to results reshuffles the random stream).

```bash
cargo run --release -p sim-bench -- --guardrails --stage lan-can --out guardrails.json
```

The bands and the reasons for them are in the phase-2 plan
(`fm-document/game-engine/phase 2/implementation-plan-phase2.md` §6, outside this repository).

---

## Test Coverage

The simulation has **69 dedicated tests**:

**Headless simulation** (`tests/simulation_tests.rs`, through `simulate_with_rng` on the live engine):
- Types: overall rating, condition effect, position counts, rating scaling
- Zones: attacking box, attacking third, defensive third, zone advancement
- Events: builder pattern, goal detection, chronological ordering
- Simulation: deterministic seeds, varied results, goals match scores, scorer IDs
- Balance: strong team dominance, equal teams evenness, home advantage
- Play styles: possession team has more possession; a defensive side concedes fewer than a balanced one; a Counter specialist coach gets more goals out of Counter than a novice
- Stats: player stats populated, shots consistent, pass accuracy in range
- Edge cases: zero stoppage time, high foul probability, JSON serialization
- Realism: average goals per game in 0.5–8.0 range

**Live match** (`tests/live_match_tests.rs` — 33 tests):
- Lifecycle, phase transitions, halftime/fulltime events
- Extra time triggering, penalty shootout resolution
- Substitution mechanics (replace, max enforced, invalid player, recorded in events)
- Tactical commands (formation, play style, set pieces)
- Stamina depletion over match duration
- AI decisions (no early action, no crash, eventual substitutions)
- Score/goals matching, strong team advantage, realistic goals
- Possession percentages, chronological events, bench management, report generation
