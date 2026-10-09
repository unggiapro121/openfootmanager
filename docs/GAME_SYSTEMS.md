# Game Systems

This document describes the major gameplay systems in OpenFoot Manager beyond match simulation (which is covered in [MATCH_SIMULATION.md](MATCH_SIMULATION.md)).

---

## Table of Contents

- [Turn Processing](#turn-processing)
- [Training System](#training-system)
- [Staff System](#staff-system)
- [Player Traits](#player-traits)
- [League & Schedule](#league--schedule)
- [Inbox Messages](#inbox-messages)
- [News System](#news-system)
- [World Generation](#world-generation)
- [Finances](#finances)
- [Transfers](#transfers)
- [The Squad Floor](#the-squad-floor)
- [Youth Intake](#youth-intake)
- [Youth Scouting](#youth-scouting)

---

## Turn Processing

The game advances one day at a time via `process_day()` in `ofm_core/turn.rs`. Each day follows this sequence:

```
process_day(game)
├── Is there a match today?
│   ├── YES → simulate_matchday()
│   │         ├── For each fixture: build engine teams, simulate, apply results
│   │         ├── Update standings (points, goal difference)
│   │         ├── Update player season stats (goals, assists, cards, rating)
│   │         └── Generate match result news articles
│   └── NO  → process_training(game, weekday)
│             └── check_squad_fitness_warnings(game)
├── generate_pre_match_messages(game)
└── clock.advance_days(1)
```

### Match Day Processing

On match days, `simulate_matchday()`:

1. Finds all scheduled fixtures for today in the active competitions
2. For each fixture, plays it as an unwatched live-engine session, with an AI manager on both
   touchlines: `live_match_manager::play_unwatched_fixture` kicks off through the squad floor's
   gate, builds both sides with `turn::squad::build_team_with_bench` (an eleven and a bench, fit
   players first), and each manager makes substitutions and tactical changes as the match goes.
   Knockout ties play extra time and, if still level, a penalty shootout. A side nobody can field
   at all is settled by scoreline instead, and logged. The player's own fixture, when delegated,
   goes through the same function.
3. Takes the finished match's `MatchReport`
4. Updates fixture status to `Completed` with the `MatchResult`
5. Updates `StandingEntry` for both teams (points: 3/1/0 for win/draw/loss)
6. Calls `apply_player_stats()` to update individual `PlayerSeasonStats`
7. Generates match report `NewsArticle` and match result `InboxMessage`

### Live Match Integration

When the user chooses to play a match live:

1. `advance_time_with_mode("live")` detects the fixture and returns `action: "live_match"` instead of simulating
2. The frontend navigates to `/match`, the user plays through the match interactively
3. On completion, `finish_live_match()` is called:
   - Applies the match report to standings and player stats
   - Simulates all other matches for that day (via `simulate_other_matches()` with `skip_fixture`)
   - Calls `finish_live_match_day()` to generate news, messages, and advance the clock

---

## Training System

Training is processed daily on non-match days. The system is controlled by three settings per team:

### Training Focus

| Focus | Attributes Trained | Notes |
|-------|-------------------|-------|
| **Physical** | pace, stamina, strength, agility | Full gain on all 4 |
| **Technical** | passing, shooting, dribbling | Full gain on all 3 |
| **Tactical** | positioning, vision, decisions, composure | Full gain on all 4 |
| **Defending** | tackling, defending + strength, positioning (half gain) | Mixed defensive |
| **Attacking** | shooting, dribbling + pace (half gain) | Mixed offensive |
| **Recovery** | — (no attribute gains) | Maximum condition recovery |

### Training Intensity

| Intensity | Gain Multiplier | Condition Cost |
|-----------|----------------|----------------|
| **Low** | 0.5× | 3 stamina |
| **Medium** | 1.0× | 6 stamina |
| **High** | 1.5× | 10 stamina |

### Training Schedule

| Schedule | Training Days | Rest Days | Days/Week |
|----------|-------------|-----------|-----------|
| **Intense** | Mon–Sat | Sun | 6 |
| **Balanced** | Mon, Tue, Thu, Fri | Wed, Sat, Sun | 4 |
| **Light** | Tue, Thu | Mon, Wed, Fri, Sat, Sun | 2 |

Rest days provide generous condition recovery (10 base, boosted by physio) with no training cost and no attribute gains.

### Attribute Gain Formula

Each training session, for each relevant attribute:

```
gain = 0.04 × development_speed × intensity_mult × age_factor × coaching_mult × specialization_mult × playing_time_factor × form_factor
```

`0.04` (`BASE_TRAINING_GAIN`) is the realistic pace: a regular starter of 18 at a Balanced,
Medium-intensity club gains about +3.5 overall a season and reaches his ceiling in his mid-twenties.

`development_speed` is a per-career setting (`Game::development_speed`): ×1 to ×5 in half steps,
stored as a percentage (100–500) in the save's `game_meta` row (`v049_development_speed.sql`). It is
chosen on the last step of career creation (`startupOptions.developmentSpeedPercent` on
`start_new_game`) and fixed with the world — no command changes it afterwards; Settings › Game Engine
only shows it. It applies to every club in the world. ×1 is the default, including for saves made
before the setting existed; the old fixed rate of 0.15 was roughly ×3.5–×4. It scales training only — the monthly loan development bonus and the
end-of-season technical growth in `aging.rs` are not multiplied.

The gain is **probabilistic**: a gain of 0.3 means a 30% chance of +1 to that attribute. Attributes are capped at 99.
A player whose `ovr` has reached his `potential` gains nothing.

### Form Factor

`playing_time` says whether a player is getting games; `match_form` says what he is doing with
them. Each player carries `match_form`, a moving average of his match ratings in tenths of a point
(60 = 6.0, an ordinary game — ratings centre on 6.0, see `docs/MATCH_SIMULATION.md`), kept by
`ofm_core/src/match_form.rs`:

```
after each match in which the engine rated him (unrated cameos leave it alone):
    match_form = match_form × 0.8 + rating × 10 × 0.2

form_factor = clamp(1 + 0.15 × (match_form − 60) / 10, 0.9, 1.3)
```

| Recent form | Factor |
|-------------|--------|
| 8.0 and above | 1.3× |
| 7.0 | 1.15× |
| 6.0 (ordinary) | 1.0× |
| 5.5 | 0.925× |
| 5.3 and below | 0.9× |

A poor run slows development by at most 10%; excellent form speeds it up by at most 30%. It applies
at every age. New players and older saves start at 60 (`v050_player_match_form.sql`). The player
profile shows it as "Recent Form".

### Playing Time Factor

Training builds a player; matches finish the job. Each player carries `playing_time` (0–100), his
recent share of his club's minutes, kept by `ofm_core/src/playing_time.rs`:

```
after each of his club's matches (every player on the club's books, used or not):
    playing_time = playing_time × 0.85 + min(minutes / 90, 1) × 100 × 0.15

playing_time_factor = 0.4 + 0.6 × min(playing_time, 80) / 80
```

| Player | `playing_time` (steady state) | Factor |
|--------|-------------------------------|--------|
| Starts and finishes every match | ~100 | 1.0× |
| Starts, substituted on the hour | ~67 | ~0.9× |
| Rotated: plays every other match | ~50 | ~0.78× |
| Comes on for the last 20 minutes | ~22 | ~0.57× |
| Never plays (bench, academy, injured) | → 0 | 0.4× |

- It is a moving average, so the last seven or so club matches carry about two thirds of it, and it
  holds its value through the close season.
- Only matches that run through the engine count — the active competitions, where `apply_match_report`
  is called. A club in a dormant competition records nothing, so its players keep their value.
  National-team matches do not count.
- Extra time counts as a full match, not more.
- A new player, and a player from a save written before this existed, starts at the neutral 50
  (factor 0.775). The SQLite column default (`v048_player_playing_time.sql`) matches.

### Age Factor

| Age | Factor | Description |
|-----|--------|-------------|
| ≤ 21 | 1.5× | Young players develop fastest |
| 22–25 | 1.2× | Prime development |
| 26–29 | 1.0× | Standard |
| 30–33 | 0.6× | Declining growth |
| 34+ | 0.3× | Minimal growth |

### Condition & Recovery

- **Training days**: condition depleted by cost, then partially recovered (base 3, boosted by physio)
- **Rest days**: no cost, the most recovery of any day (base 10, boosted by physio)
- **Recovery focus**: no cost, highest recovery (base 9, boosted by physio)
- **Injured players**: receive 50% of base recovery, skip training

Recovery is further modified by each player's stamina attribute:
```
recovery = base × (0.5 + stamina/100 × 0.5)
```

### The near-match taper

No squad does a full session two days before a game, so this is not left to the
manager. A club within `MATCH_TAPER_DAYS` (2) of its next fixture — in *any*
competition — runs today's session one step lighter than its standing intensity,
and a tapered session that lands on Low counts as recovery work rather than a load.

A club facing two or more fixtures inside the coming week goes further: every
session is recovery work, whatever its standing intensity. One step down from High
is Medium, which still costs more than it restores, and a club that trained
through a two-match week reached the second match with its squad below 80.

The club's stored focus, intensity and schedule are **not** rewritten: the plan on
the Training tab stays the manager's, and the taper is applied on top of it, per
day. It applies to every club, the player's included.

### The fatigue guard

Below `FATIGUE_GUARD_CONDITION` (40) an individual player is rested regardless of
the team's plan. Team intensity is one setting for a whole squad but the condition
cost is per player, so without this an individually exhausted player in an
otherwise-healthy squad keeps net-losing condition and never climbs out.

This applies to every club too. It was AI-only until it turned out to be the
difference between a squad that stabilises and one that reaches condition 2 within
two months of the season starting.

### Fitness Warnings

After training each day, `check_squad_fitness_warnings()` evaluates the user's squad:

- **Critical** (3+ players below 25% condition): Urgent priority message from Physio/Assistant Manager with schedule-specific advice
- **Warning** (average < 50% or 4+ players below 40%): High priority message

Messages are deduplicated per day via `fitness_warn_{date}` IDs. The sender is the team's Physio if one is hired, otherwise the Assistant Manager.

---

## Staff System

Each team can employ staff in 4 roles:

| Role | Training Effect | Notes |
|------|----------------|-------|
| **Assistant Manager** | Coaching quality | Counts as coaching staff for training calculations |
| **Coach** | Coaching quality + specialization bonus | Primary training contributor |
| **Scout** | — | Player reports and youth searches — see [Youth Scouting](#youth-scouting) |
| **Physio** | Recovery multiplier | Boosts condition recovery for all training |

### Staff Attributes

| Attribute | Range | Effect |
|-----------|-------|--------|
| `coaching` | 0–100 | Training quality multiplier: 0→0.85×, 100→1.35× |
| `judging_ability` | 0–100 | Accuracy of OVR and attribute reads; how many youngsters a youth search sees |
| `judging_potential` | 0–100 | Accuracy of potential reads; how long a youth search takes |
| `physiotherapy` | 0–100 | Recovery bonus: 0→1.0×, 100→1.4× |

### Coaching Bonuses

Computed per team before each training session:

- **No coaching staff**: 0.8× penalty (worse than having any coach)
- **Coaching multiplier**: `0.85 + (avg_coaching / 100) × 0.5` → range 0.85–1.35×
- **Specialization bonus**: 1.25× if any coach's specialization matches the training focus
- **Physio recovery**: `1.0 + (avg_physiotherapy / 100) × 0.4` → range 1.0–1.4×

### Coaching Specializations

| Specialization | Boosts Focus |
|----------------|-------------|
| Fitness | Physical |
| Technique | Technical |
| Tactics | Tactical |
| Defending | Defending |
| Attacking | Attacking |
| GoalKeeping | (Future: GK-specific) |
| Youth | (Future: youth development) |

### Hiring & Releasing

Staff are paid weekly like players (`ofm_core::staff_contracts`):

- **Asking wage**: set by ability in the role alone, not by the club — `role ceiling × (rating/100)³`, rounded to the nearest 100, never below the minimum wage. Ceilings (rating 100): Assistant Manager 60,000, Coach 25,000, Physio 8,000, Scout 6,000 a week. The market lists everyone at their asking wage.
- **Hire**: free transfer — no fee — on a 1–3 year contract (default 2) at the asking wage. Refused if it would take the weekly wage bill over the wage budget.
- **Renew**: a fresh 1–3 year contract from today at the current asking wage, under the same budget rule. The manager is warned 60 days before a staff contract ends.
- **Release**: pays off the rest of the contract (weeks left × weekly wage, booked as a contract termination); the staff member returns to the market.
- **Expiry**: the user's staff leave when their contract ends; AI clubs renew theirs for two years at what they can pay.

At a career's opening, club staff are priced at their asking wage scaled by the club's pay level (the same means-test players get), with contracts spread over 12–47 months. The pay level counts staff, so players and staff together fit what the club's income can carry.

The world generates 12 unattached free-agent staff at game start, plus 4 staff per team (AssistantManager, Coach, Scout, Physio).

### Head Coach (the manager)

The head coach is the club's `Manager` — the player's own character, or an AI club's manager — and is not a staff role. Training stays with the coaching staff above; the head coach acts on the match.

- **Play style mastery** (`Manager::play_style_mastery`): 1–100 for each of the six play styles. The player starts at 50 in every style, which plays each style exactly as the engine's table prices it.
- **AI managers** (`ofm_core::manager_mastery`): rolled once around `Manager::rating` from a stream seeded by their id — their preferred style 10–20 above the rating, every other −10 to +9. A club's manager at career start and an assistant stepping in prefer the club's own style; a mid-career appointment, the unemployed pool and retired players turned managers bring one of their own.
- **In the match**: the mastery of the style in use scales that style's edge up and its cost down (see [MATCH_SIMULATION.md](MATCH_SIMULATION.md#the-head-coach)).
- **A new manager's style**: when an AI club appoints a newly generated manager mid-career, it switches to that manager's best style and takes the style's blueprint (`ai_tactics::blueprint_for`). A caretaker keeps the club's style and dials.

---

## Player Traits

Traits are automatically computed from a player's attributes and position by `compute_traits()` in `domain/player.rs`. They are recalculated whenever a `Player` is created via `Player::new()`.

### 20 Defined Traits

**Physical:**
| Trait | Requirement |
|-------|------------|
| Speedster | pace ≥ 85 |
| Tank | strength ≥ 85 AND stamina ≥ 75 |
| Agile | agility ≥ 85 |
| Tireless | stamina ≥ 90 |

**Technical:**
| Trait | Requirement |
|-------|------------|
| Playmaker | passing ≥ 80 AND vision ≥ 80 |
| Sharpshooter | shooting ≥ 85 |
| Dribbler | dribbling ≥ 85 |
| BallWinner | tackling ≥ 80 AND aggression ≥ 70 |
| Rock | defending ≥ 85 AND positioning ≥ 75 |

**Mental:**
| Trait | Requirement |
|-------|------------|
| Leader | leadership ≥ 85 AND teamwork ≥ 75 |
| CoolHead | composure ≥ 85 AND decisions ≥ 80 |
| Visionary | vision ≥ 85 |
| HotHead | aggression ≥ 85 AND composure < 50 |
| TeamPlayer | teamwork ≥ 85 |

**Goalkeeper:**
| Trait | Requirement |
|-------|------------|
| SafeHands | handling ≥ 85 (GK only) |
| CatReflexes | reflexes ≥ 85 (GK only) |
| AerialDominance | aerial ≥ 85 |

**Special/Combo:**
| Trait | Requirement |
|-------|------------|
| CompleteForward | Forward: shooting ≥ 75, dribbling ≥ 75, pace ≥ 70, strength ≥ 70 |
| Engine | Midfielder: stamina ≥ 85, pace ≥ 70, teamwork ≥ 75 |
| SetPieceSpecialist | passing ≥ 80, shooting ≥ 75, vision ≥ 75 |

### Trait Effects in Simulation

Traits provide multiplicative bonuses during match simulation. See [MATCH_SIMULATION.md — Player Traits](MATCH_SIMULATION.md#player-traits) for the full bonus table.

### Trait Display

On the frontend, traits are rendered as colored badges (`TraitBadge.tsx`) with:
- Lucide icons specific to each trait
- Color classes by category (physical = blue, technical = green, mental = purple, etc.)
- Tooltips with descriptions
- Squad tab shows max 2 badges + overflow count

---

## League & Schedule

### Schedule Generation

The league uses a **double round-robin** format generated by the circle method (`schedule.rs`):

1. Fix team index 0, rotate the rest for `n-1` rounds (first leg)
2. Repeat with reversed home/away for `n-1` rounds (second leg)
3. Total matchdays: `2 × (n-1)` where `n` is the number of teams

Each matchday is spaced 7 days apart from `start_date`.

For 16 teams: 30 matchdays, 240 total fixtures (8 per matchday).

### Standings

`StandingEntry` tracks per team:
- Played, Won, Drawn, Lost
- Goals For, Goals Against, Goal Difference
- Points (3 for win, 1 for draw, 0 for loss)

Standings are sorted by: Points → Goal Difference → Goals For.

### Fixture Lifecycle

```
Scheduled → InProgress (during live match) → Completed
```

Each completed fixture stores a `MatchResult` with home/away goals and goal scorer details.

---

## Inbox Messages

The inbox system provides contextual communication from in-game characters. Message *text* is built by `ofm_core/messages.rs` and its siblings; the generators that decide when to send live across the game modules (`turn/`, `player_events/`, `random_events/`, `finances.rs`, `end_of_season/`, `world_cup.rs`, and more). Every one of them sends through `ofm_core/inbox.rs`.

### Message Categories

| Category | Sender | Trigger |
|----------|--------|---------|
| Welcome | Board of Directors | Game start (team selection) |
| LeagueInfo | League Office | League setup |
| MatchPreview | Scout / Asst. Manager | Three days before a fixture |
| MatchResult | Asst. Manager | After each fixture |
| Training | Physio / Asst. Manager | Fitness warnings (daily) |
| BoardDirective | Chairman | Board objectives, warnings, dismissal, and hiring welcome messages |
| JobOffer | Board of Directors | Vacancy-driven approaches and application replies for unemployed managers |
| Finance | (Future) | Budget updates |
| Transfer | (Future) | Transfer offers |
| Injury | (Future) | Injury reports |
| Contract | (Future) | Contract negotiations |
| ScoutReport | Scout | Player reports, youth search reports, weekly watchlist reports |
| Media | (Future) | Press stories |
| System | System | Technical messages |

### Message Structure

Each `InboxMessage` has:
- **Subject, body, sender, sender_role, date**
- **Category** and **Priority** (Low, Normal, High, Urgent)
- **Actions**: Interactive buttons (Acknowledge, NavigateTo, ChooseOption, Dismiss)
- **Context**: References to teams, players, fixtures, match results
- **Optional i18n metadata**: backend subject/body/sender keys plus interpolation params for localized rendering

### Message Variations

Messages use randomized templates — for example, the welcome message has 3 variations randomly selected at game start. Match preview messages have different phrasings for home vs away matches, and incorporate rival/confident/underdog tones based on team reputation.

### The sent-ledger

Every message goes into the inbox through `ofm_core/inbox.rs` — `emit`, `emit_once`, or `emit_all`.
Nothing pushes to `game.messages` directly.

The reason is that **the inbox is not a record of what has been sent.** It is the player's mailbox:
they read it, delete from it, bulk-delete from it, and clear it. Generators used to guard themselves
by scanning it for their own message id, which answers "is this still in the inbox" rather than "did
we already send this" — so deleting a message invited the generator to send it again. That is issue
#520: a nation would win the World Cup and the player would be told about it, delete the message,
and be told again the next day.

`Game::emitted_events` is the ledger instead. It is a set of keys, it is persisted with the save, it
is never pruned, and nothing outside `inbox.rs` writes to it. A key is also the message id, so the
two can never disagree.

**Choosing a key chooses how often the event may recur.** A key naming only an entity —
`morale_talk_{player_id}` — means once per save, ever. If the event is a condition that can come
back, the key needs the scope it recurs on:

| Event | Key | Recurs |
|---|---|---|
| World Cup champion | `world_cup_champion_{year}` | once per tournament |
| Promotion / relegation | `promotion_{season}` | once per season |
| Player morale talk | `morale_talk_{player}_{season}` | once per player per season |
| Contract concern | `contract_concern_{player}_{contract_end}_{stage}` | once per contract stage |
| Fitness warning | `fitness_warn_{date}` | once per day |

A message may not be dated later than the game clock. Anything the player has yet to reach is not in
their inbox: `slices::inbox::message_is_visible` hides such a message and keeps it out of the unread
badge, mirroring the same rule for news, and a test in `turn_tests.rs` fails if a generator stamps
one.

A side effect that belongs to a message — the morale hit a contract warning carries — must be gated
on the `bool` these functions return, never on the message's presence in the inbox.

---

## News System

The news system generates public-facing articles about league events, displayed in the News tab. Articles are generated by `ofm_core/news.rs`.

### News Categories

| Category | Trigger | Content |
|----------|---------|---------|
| **MatchReport** | After each fixture | Score, scorers, commentary variations |
| **LeagueRoundup** | After each matchday | Summary of all results |
| **StandingsUpdate** | After each matchday | Current league positions |
| **TransferRumour** | Weekly digest (Monday) | Gossip/speculation about notable AI players |
| **TransferRoundup** | Weekly digest (Monday) + major completed transfers | Confirmed major move announcements and roundup coverage |
| **InjuryNews** | When a notable player (market value ≥ €500K or starting XI) suffers a training injury | Injury duration and impact report |
| **ManagerialChange** | Manager firing or vacancy fill | Public dismissal and appointment coverage |
| **SeasonPreview** | End of season / preseason rollover | Preseason analysis and contenders |
| **Editorial** | Weekly storylines, season awards, weekly digest | Opinion pieces, standings narratives |

### Article Structure

Each `NewsArticle` has:
- **Headline, body, source, date, category**
- **Team/player IDs**: Referenced entities for linking
- **Match score**: Optional score context for match reports
- **Read status**: Tracks whether the user has read it
- **Optional i18n metadata**: headline/body/source keys plus interpolation params for localized rendering

### Article Generation

Match reports use randomized commentary templates (3 variations per article). They include:
- Result description (win/loss/draw phrasing)
- Scorer details with minutes
- Contextual commentary about league implications

League roundup articles summarize all matchday results with scores, standings update articles report the current top positions, managerial-change articles cover firings and appointments, and season preview articles frame the new campaign before kickoff.

**Transfer rumours** are generated every Monday (alongside the weekly digest). Up to 2 notable AI-team players — those with a market value ≥ €800K, an expiring contract (≤ 12 months), or low morale — are picked and receive a speculative gossip article attributed to tabloid-leaning sources (Transfer Intelligence, Sports Gazette, or The Football Herald). These rumours do not correspond to actual pending transfer offers; they are flavour-driven speculation.

**Injury news** articles are generated whenever a notable player suffers a training-ground injury. Notability is defined as a market value ≥ €500K or membership of the user club's starting XI. The article reports the injury duration and is attributed to a factual source (League Wire, The Football Herald, or Match Day Press).

---

## World Generation

World generation creates the initial game state: teams, players, staff, and league. See [DEFINITIONS.md](DEFINITIONS.md) for the file format.

### Generation Flow

```
generate_world(data_dir)
├── Load names definition (JSON or hardcoded fallback)
├── Load teams definition (JSON or hardcoded fallback)
├── For each team template:
│   ├── Create Team with randomized reputation and finances
│   ├── Generate 22 players (2 GK, 7 DEF, 7 MID, 6 FWD)
│   │   └── For each player:
│   │       ├── Pick nationality (60% team country, 40% random)
│   │       ├── Pick name from nationality pool
│   │       ├── Generate attributes by position
│   │       ├── Compute traits
│   │       └── Set contract, wage, market value
│   └── Generate 4 staff (AssistantManager, Coach, Scout, Physio)
├── Generate 12 unattached free-agent staff
├── Generate league schedule (double round-robin)
└── Return Game with all entities
```

### Player Generation

- **Nationalities**: 60% weighted toward team country, 40% from any pool
- **Names**: Picked from nationality-specific pools (first + last names)
- **Attributes**: Randomized by position with different ranges:
  - GK: high handling/reflexes/aerial, lower outfield stats
  - DEF: high defending/tackling/strength, lower shooting
  - MID: balanced, higher passing/vision/stamina
  - FWD: high shooting/pace/dribbling, lower defending
- **Age**: 17–35, with attribute ranges scaled by age (younger = lower ceiling, older = higher but declining)
- **Condition**: Starts at 75–100

### Definition Files

Two definition files drive generation, and either can be overridden by dropping
your own copy in `<app-data>/data/`:
- `default_names.json` — name pools keyed by country code
- `default_nations.json` — the nations generation builds a world from: city
  pools, naming style, division count and strength per nation

If neither an override nor the bundled copy is found — or a file has a parse
error — the generator falls back to the same files compiled into the binary, so
generation always has a working set. See [DEFINITIONS.md](DEFINITIONS.md).

---

## Finances

Each team tracks financial state:

| Field | Description |
|-------|-------------|
| `finance` | Current balance (can be negative) |
| `wage_budget` | Weekly wage allowance |
| `transfer_budget` | Available for transfers |
| `season_income` | Cumulative income this season |
| `season_expenses` | Cumulative expenses this season |

### Income Sources
- Match day revenue (future)
- Prize money (future)
- Sponsorship (future)

### Expenses
- Staff wages (weekly)
- Player wages (weekly)
- Youth search fees (`CashKind::ScoutingExpenses`)
- Transfer fees (future)

### Academy wages

An academy player (`squad_role == Youth`) not out on loan is paid **half** his contract wage, at every
club (`finances::paid_weekly_wage`). The contract keeps the first-team wage: negotiation, renewal,
transfer bids, AI decisions and the split of a loan all use it. What the club actually pays — the
Monday payroll, the weekly wage bill, the board's wage policy for a player in the academy, severance
and the expiring-contract warning — uses the paid wage. Promotion to the first team pays the full
contract from the next payday. The UI shows both, as "€6K (first team: €12K)".

A club's pay level (`economy::set_pay_levels`) still counts academy players at their full market
wage. Counting them at half raised every club's pay level and left AI clubs as deep in debt as
before; counting them in full kept the saving. Ten seeded compact worlds over six seasons, AI clubs
below zero cash at the end: 28 of 150 before the change, 27 with the pay level at half, 17 with it
at full. Academy contracts are 8–13.5% of the wage bill at their full value. With AI clubs
signing from the youth pool through the season, the same measure gave 19 of 150 (median AI cash
88M, against 89M before the pool).

The `FinancesTab` displays an overview with cards for balance, wage budget, transfer budget, and a payroll table.

---

## Transfers

The transfer system provides a market for buying, selling, and loaning players.

### Player Transfer Status

Each player has:
- `transfer_listed: bool` — Whether the player is available for transfer
- `loan_listed: bool` — Whether the player is available for loan
- `transfer_offers: Vec<TransferOffer>` — Pending offers

### Transfer Views (Frontend)

The `TransfersTab` provides 4 views:
- **My List** — Players you've listed for transfer/loan
- **Market** — Available players from other teams
- **Loans** — Loan-listed players
- **Offers** — Incoming and outgoing transfer offers

---

## The Squad Floor

A club never runs out of players. `ofm_core::squad_floor` holds the one rule: every club keeps at
least **15 senior players** registered (`MIN_SENIOR_PLAYERS`), and within them at least **2
goalkeepers, 4 defenders, 4 midfielders and 2 forwards** (`MIN_PLAYERS_PER_GROUP`). Injured players
count; players out on loan count for their borrower; academy players do not — they are what a
short club promotes.

**The game never creates a player, or money, for a club** — the one way a player comes into the
world is the season-end [youth intake](#youth-intake), into academies. A club short of the floor is
filled only from players who exist: its own academy first, then the free-agent market, on wages the club pays
even if its balance goes negative. When neither has anyone, the gap is reported (logged for an AI
club, an inbox message for the player's club) and the day still finishes.

Every way a club can lose a player answers to the floor:

| Source | What happens |
|---|---|
| Sale, loan, contract termination | Refused if it would take the club below the floor, in the player's group or in all (`be.error.squadFloor.wouldLeaveShort`, `…wouldLeaveSeniorsShort`). Checked before an offer is marked agreed, and again when a scheduled deal falls due — a deal struck with players to spare lapses if the club has since lost them. The AI market does not shortlist a player whose club cannot sell him. An academy player can always leave. |
| Contract expiry | AI clubs renew their own players first (`ai_contracts`, on each club's weekly review day, through the same offer and acceptance rules as the player's renewals). |
| Ordinary AI squad planning | On the same review day an AI club graduates academy players past the academy age (`roster::YOUTH_ACADEMY_MAX_AGE`), then keeps one senior above the minimum in each group and 18 seniors in all (`PLANNING_TARGET_SENIORS`) — promoting from its academy first, then signing free agents the board lets it pay. This is what keeps the emergency below from ever firing. |
| Expiry, retirement, loan returns — anything that cannot be refused | Once a day, after those steps, an AI club still below the floor is topped up — the emergency, recorded in the runtime-only `Game::squad_floor_top_ups`. The player's club is **not** filled for: it gets an inbox warning per shortage, once per season, shortage and count. |
| Kick-off | Every club fixture passes `live_match_manager::prepare_kick_off` (the player's own matches through `kick_off_live_match`). An AI club still short is topped up and logged. The player's club is topped up only if it cannot field a side at all (fewer than eleven seniors, or no senior goalkeeper), and is told who came in and what nobody could fill. |
| Loading a save, building a world | The same repair: AI clubs topped up, the player's club warned — unless it plays today, when kick-off handles it. |

The board's wage policy yields in exactly one case (`contract_wage_policy::wage_policy_verdict`):
when the club would be below the floor without the player. That rule is shared by the manager's
renewals and free-agent signings, the assistant's delegated renewals, AI renewals and planning, and
the top-up; the manager is told when it applied.

## Youth Intake

The player's club takes new youngsters into its academy at each season's end
(`ofm_core::youth_intake`); AI clubs take theirs from the season's youth pool through the season
instead (see [Youth Scouting](#youth-scouting)). Between them they keep the world supplied: without
new youngsters a world only loses players — retirements outrun graduations, the academies the
generator seeds are empty within a few seasons, and the free-agent pool drains after them.

The rule is one pure function of a club's academy, `youth_intake::plan_for`: a club takes what it
lacks of an academy of **1 goalkeeper, 2 defenders, 2 midfielders and 1 forward**
(`ACADEMY_TARGET_PER_GROUP`), never fewer than **one** youngster a season (`MIN_INTAKE`) nor more
than **three** (`MAX_INTAKE`). A keeper comes first when the academy has none; after that the
thinnest groups. The plan says how many and where they play, with no randomness, so an academy
cost can be attached to it later. No money moves today.

The same plan sizes each AI club's demand on the pool. `apply_youth_intake` takes the player's
club's intake (`take_youth_intake`). The
youngsters are drawn at 15–17 (a birth late in the year makes some 14 by the 1 July count) from
the save's own seed (`Game::rng_for("youth-intake/<club>", date)`), so a replayed season end takes
in the same youngsters and two careers from one package do not. Each joins on a contract that
starts that day, recorded in his history as a signing from no club, with a free shirt number. It
runs last in the season end's squad turnover, after aging, retirements and every AI club's rebuild,
so the rebuild cannot promote a youngster on the day he joins.

**The board decides what a recruit is paid**, by the one wage rule every contract a club offers goes
through, for the player's club and AI clubs alike (`contract_wage_policy::joining_wage_policy_verdict`,
which counts a recruit's whole wage as new to the bill). He is offered what he asks, then the youth
minimum of 500 a week; if the board will not pay even that, he is not taken, and neither is the rest
of that club's plan. Nothing is created to fill the gap and no money moves. The player's club is told
who joined, and when the board turned any away (`be.msg.youthIntake`).

Measured on a three-nation pyramid of 80 clubs over five seasons and three seeds
(`tests/youth_intake_wages_probe.rs`, ignored, run in release): the board turned away none of 2,240
planned recruits. From the second season on, every club sits over its wage budget on the policy's
25,000-a-week grace, which is allowed per decision, so a recruit at the minimum cannot be refused.
`tests/squad_floor_seasons.rs` fails if a solvent AI club ever goes two seasons running without
signing a youngster.

Measured on a seeded compact world with a league: the world opens below the intake's equilibrium,
grows for about a dozen seasons, and then holds at about a fifth above its opening size, with around
six academy players and seven free agents per club. `tests/squad_floor_seasons.rs` asserts that
band over twelve seasons on three seeds.

---

## Youth Scouting

A scout does not create talent: young talent is shared by the whole world, and the scout decides
whom the club finds before anyone else does, and how much it knows about them
(`ofm_core::youth_pool`, `ofm_core::scouting`, `ofm_core::youth_watchlist`).

### The season's youth pool

- **Drawn** once when a season opens (at the season end's squad turnover; a career with none draws
  one on its first Monday). Every nation with a club has a pool: in each position group, 1.5 times
  what its AI clubs' academies lack by the intake's rule (`plan_for`), and at least one. The player's
  club adds nothing — its intake is generated separately. Youngsters are 15–21, from the shared youth
  generator, with ids from nation, day and draw so a seeded season replays.
- **Hidden**: the pool lives in `Game::youth_pool`, outside `game.players`, so no free-agent list,
  aging, retirement or squad top-up can reach it. The only way to learn of a youngster is a report.
- **AI clubs sign from it every Monday** — their only source of youngsters. A club with demand left
  signs one with chance `demand left / Mondays left in the season`, so it signs steadily and is sure
  to try on the last Monday. It chooses with its best scout by judging ability: views
  `4 + JA/25 + (facility − 1)` youngsters of its nation in the group it needs, estimates them within
  that scout's band and signs the best on a balanced score, under its board's wage policy at the
  academy rate. A refused wage skips the week.
- **Closes** at the season end: whoever is unsigned leaves the game, and the next pool is drawn.
- Saved as `youth_pool_json` on `game_meta` (v056). On a standard world (440 clubs, 16 nations) the
  pool holds about 1,500 youngsters, 2.2 MB of JSON against 17.7 MB for the world's players.

### The search

- **Who can go**: a scout of the player's club with no other assignment, who has finished resting —
  **7 days** after his last youth search, per scout (`Game::scout_youth_rest_until`).
- **Fee**, paid when the search starts and never refunded: 15,000 domestic, 50,000 international,
  ×1.5 for a high-potential search. `quote_youth_search` shows the fee, the days and the rest left.
- **Days**: 4 / 5 / 6 / 7 by judging potential (≥ 80 / ≥ 60 / ≥ 40 / lower), +1 international,
  +1 high potential.
- **Youngsters seen**: on the day the search completes, at random from what is **left in the pool**
  — the club's nation for a domestic search, every other nation for an international one, filtered
  by position — 4 for a balanced search, 6 otherwise, + `judging_ability / 25`, + the scouting
  facility level − 1. Fewer if the pool has fewer.
- **Judgement**: the scout estimates each one's OVR (by judging ability) and potential (by judging
  potential) within his band — ±2 / ±5 / ±8 / ±12 for ratings ≥ 80 / ≥ 60 / ≥ 40 / lower, the band a
  player report uses — ranks them on the estimates and recommends three.

### The report

The scout reads each prospect as a **range** for OVR and potential, never the true value: the
estimate ± the band, clamped to 1–99, so the truth is always inside. The report shows him as the
player card a player scout report uses (`scouting::prospect_report`, `MessageContext::
youth_prospect_reports`): the midpoint of each range as one figure, the rating and potential labels,
and a confidence from the OVR band (±0 exact, ±2 high, ±5 moderate, wider low); his attributes stay
"??" until a scout follows him. The options are Sign, Watch and Discard. Signing
reveals everything and takes him out of the pool; a refused wage leaves him in it. Discarding only
takes him off the report. A prospect an AI club has signed since, or who left the market, cannot be
signed or watched: the manager is told where he went. A pool with nobody suitable left gives a report
that says so (`bodyEmpty`), with the fee spent.

### The watchlist

- **Watch** puts a prospect still in the pool, with the report's ranges, on the watchlist, with no
  scout. He stays until he signs somewhere, the manager lets him go, or the season ends.
- The manager gives each prospect a scout on the Scouting screen, at most **three** per scout.
  Following does not take the scout's assignment slot. A new scout drops the band straight to his
  own if it is narrower; ranges never widen.
- **Every Monday**, after the AI clubs have signed: a watched prospect an AI club signed stays on the
  list marked with his new club (`WatchedProspect::signed_by`), his scout stops following him, he can
  no longer be signed or given a scout, and the manager is told where he went; then each prospect with a scout narrows a
  band (12 → 8 → 5 → 2 → 0), the new range being the intersection of the old one and a fresh read,
  and every attribute already read narrows a band too; then the scout reads K more attributes —
  4 / 3 / 2 / 2 for judging ability ≥ 80 / ≥ 60 / ≥ 40 / lower — in the order the prospect's
  position weighs them in its overall (`player_rating::attribute_weights`; only keepers have handling
  and reflexes), each at the overall's current band. A weekly report carries his player card as read
  that week, and the watchlist keeps the latest (`WatchedProspect::report`).
- Once overall, potential and every attribute are exact, the scout files one "assessment complete"
  report (`be.msg.youthWatchComplete`) instead of the weekly one and stops following him, freeing his
  slot; the prospect stays on the list without a scout.
- A prospect's card shows his height, weight and feet exactly, and every attribute in the profile's
  groups: the figure for those read, "??" for the rest. Opening him on the watchlist shows the same as
  a profile-like detail form.
- When the pool closes, every prospect still free leaves the market and the manager is told; those a
  club signed stay until the manager lets them go.
- A scout who is released or whose contract ends leaves his prospects on the list without a scout,
  and the manager is told.
- **Watching an ordinary player.** A player scout report carries the read a watch starts from
  (`MessageContext::player_estimate`: each reported figure ± the scout's band) and a Watch choice.
  The player joins the list as `WatchKind::Player` and is followed by the same rules, counting
  towards a scout's three. His status is his current club or Free; Make an offer opens the transfer
  bid (or free-agent contract) on the scouting screen. Each Monday his copy is refreshed and any range
  he has grown out of is read again at its band. He has no season expiry; he leaves when unwatched,
  quietly when he joins the user's club, and with a message when he retires. While he is watched, his
  profile's hidden attributes show the scouts' figures.

Measured with `tests/youth_scouting_probe.rs` (ignored, run in release) on 30 seeded compact worlds,
four domestic high-potential searches per world and cell. Rank is the share of the nation's cohort
with more true potential than the youngster recommended — 0% is the cohort's best:

| When | Scout | Facility | Mean rank | In the top 10% |
|---|---|---|---|---|
| Week 1 | 20 | 1 | 29.7% | 24.7% |
| Week 1 | 50 | 1 | 22.5% | 29.4% |
| Week 1 | 80 | 1 | 16.4% | 36.7% |
| Week 1 | 80 | 3 | 12.0% | 48.3% |
| Week 20 | 20 | 1 | 48.1% | 7.2% |
| Week 20 | 80 | 3 | 29.3% | 16.9% |
| Week 40 | 20 | 1 | 56.1% | 5.6% |
| Week 40 | 80 | 3 | 40.5% | 8.9% |

A better scout and a better facility find better youngsters, and the early search beats the late one:
by mid-season the AI clubs have taken much of the best. Every AI club filled its demand (998 of 998).
AI clubs whose best scout judges 80+ signed youngsters of mean potential 89.8, against 89.4 for
60–79 — the generator gives AI clubs no scout below 60, so their spread is narrow.
