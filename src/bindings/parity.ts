// The hand-written TypeScript mirrors of Rust types, pinned to the declarations generated from
// Rust (`src/bindings/core/`, phase 3 E3-6a). `tsc` fails here when a Rust type changes and its
// mirror does not, so the radar and the tactics screens cannot drift from what the backend sends.
//
// Two strengths of check:
// - `Equals`: the mirror is the Rust type exactly (enums, small records).
// - `Reads`: everything Rust sends is accepted by the mirror. Used where the mirror is
//   deliberately looser: a string for an enum the UI only displays, fields optional so tests can
//   build fixtures by hand, or only the dials the UI reads. A field renamed or removed in Rust,
//   or a type changed, still fails.

import type {
  DangerBand,
  EngineTacticsData,
  EnginePlayerData,
  EngineTeamData,
  EventDetail,
  FoulSeverity,
  GoalContext,
  GoalSource,
  Lane,
  MatchEvent,
  MatchSnapshot,
  MinuteResult,
  PenaltyShootoutSnapshot,
  SaveQuality,
  SetPiece,
  SetPieceTakers,
  ShotKind,
  SubstitutionRecord,
  TacticalContext,
} from "../components/match/types";
import type { Position as EditorPosition } from "../components/menu/PackageEditor/types";
import type {
  BreakSpeed,
  BuildUpStyle,
  CounterPressDuration,
  CrossStyle,
  DefensiveLine,
  DefensiveShape,
  MarkingStyle,
  OffsideTrap,
  PitchWidth,
  PlayerData,
  PlayerRole,
  PressingIntensity,
  TacticsPhaseSettings,
  TeamMatchRolesData,
  Tempo,
} from "../store/types";
import type * as Domain from "./core/domain/index";
import type * as Engine from "./core/engine/index";

/** True when `A` and `B` are the same type. */
type Equals<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
/** True when every value of `Sent` (what Rust sends) is a value of `Read` (what the UI reads). */
type Reads<Read, Sent> = [Sent] extends [Read] ? true : false;
type Assert<T extends true> = T;

export type DomainMirrors = [
  Assert<Equals<PlayerRole, Domain.PlayerRole>>,
  Assert<Equals<TacticsPhaseSettings, Domain.TacticsPhaseSettings>>,
  Assert<Equals<TeamMatchRolesData, Domain.MatchRoles>>,
  Assert<Equals<BuildUpStyle, Domain.BuildUpStyle>>,
  Assert<Equals<PitchWidth, Domain.PitchWidth>>,
  Assert<Equals<Tempo, Domain.Tempo>>,
  Assert<Equals<DefensiveLine, Domain.DefensiveLine>>,
  Assert<Equals<PressingIntensity, Domain.PressingIntensity>>,
  Assert<Equals<DefensiveShape, Domain.DefensiveShape>>,
  Assert<Equals<MarkingStyle, Domain.MarkingStyle>>,
  Assert<Equals<CounterPressDuration, Domain.CounterPressDuration>>,
  Assert<Equals<BreakSpeed, Domain.BreakSpeed>>,
  Assert<Equals<CrossStyle, Domain.CrossStyle>>,
  Assert<Equals<OffsideTrap, Domain.OffsideTrap>>,
  Assert<Equals<EditorPosition, Domain.Position>>,
  Assert<Equals<PlayerData["attributes"], Domain.PlayerAttributes>>,
];

export type EngineMirrors = [
  Assert<Equals<DangerBand, Engine.DangerBand>>,
  Assert<Equals<SaveQuality, Engine.SaveQuality>>,
  Assert<Equals<FoulSeverity, Engine.FoulSeverity>>,
  Assert<Equals<GoalContext, Engine.GoalContext>>,
  Assert<Equals<EventDetail, Engine.EventDetail>>,
  Assert<Equals<ShotKind, Engine.ShotKind>>,
  Assert<Equals<SetPiece, Engine.SetPiece>>,
  Assert<Equals<GoalSource, Engine.GoalSource>>,
  Assert<Equals<Lane, Engine.Lane>>,
  Assert<Equals<TacticalContext, Engine.TacticalContext>>,
  Assert<Equals<SetPieceTakers, Engine.SetPieceTakers>>,
  Assert<Equals<SubstitutionRecord, Engine.SubstitutionRecord>>,
  Assert<Equals<PenaltyShootoutSnapshot, Engine.PenaltyShootoutSnapshot>>,
  Assert<Reads<MatchEvent, Engine.MatchEvent>>,
  Assert<Reads<MinuteResult, Engine.MinuteResult>>,
  Assert<Reads<MatchSnapshot, Engine.MatchSnapshot>>,
  Assert<Reads<EnginePlayerData, Engine.PlayerData>>,
  Assert<Reads<EngineTeamData, Engine.TeamData>>,
  Assert<Reads<EngineTacticsData, Engine.TacticsConfig>>,
];
