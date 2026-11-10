import { type ReactNode, useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { useParams, useSearchParams } from "react-router-dom";
import { ChevronDown } from "lucide-react";
import { Card, CardBody, CardHeader } from "../../../components/ui";
import { usePhoneLayout } from "../../../hooks/usePhoneLayout";
import type { FixtureView, OpponentView } from "../../api";
import { online } from "../../client";
import { tracked } from "../../store/onlineStore";
import { useOnlineResource } from "../../useOnlineResource";
import ClubCrestMark from "../ClubCrestMark";
import ResourceState from "../ResourceState";
import {
  AbsencesBlock,
  FormBlock,
  HeadToHeadBlock,
  HeaderBlock,
  LastLineupBlock,
  NotableBlock,
} from "./OpponentBlocks";
import { KickoffBlock, LinesBlock } from "./OpponentLines";
import { useMyClub } from "./PlayerLink";

const BUILT = new Set(["scheduled", "live"]);

/**
 * What a coach may know of a club before he plays it (C-23a, S-46a): who it is, its form, the two
 * clubs' past meetings, its last line-up, how the two elevens compare, its players to watch and
 * who is out. `?fixture=` names the match it is opened for; the server only notes it.
 */
export default function OnlineOpponent() {
  const { clubId = "" } = useParams();
  const [search] = useSearchParams();
  const fixtureId = search.get("fixture") ?? undefined;
  const { resource, reload } = useOnlineResource(
    () => tracked(() => online.clubs.opponent(clubId, fixtureId)),
    [clubId, fixtureId],
  );
  return (
    <ResourceState resource={resource} reload={reload}>
      {(view) => <Profile view={view} fixtureId={fixtureId} />}
    </ResourceState>
  );
}

/**
 * The coach's next fixture when it is against this club, and its match once built and opened from
 * that fixture: what the header's kick-off line and block (h) read.
 */
function useNextMeeting(view: OpponentView, fixtureId: string | undefined) {
  const club = useMyClub();
  const next = club?.nextFixture;
  const meeting: FixtureView | null =
    next && (next.home.id === view.club.id || next.away.id === view.club.id) ? next : null;
  const built =
    meeting && fixtureId === meeting.id && meeting.matchId && BUILT.has(meeting.matchStatus ?? "")
      ? meeting.matchId
      : null;
  return { club, meeting, kickoffMatchId: built, myClubIsHome: meeting?.home.id === club?.club.id };
}

function Profile({ view, fixtureId }: { view: OpponentView; fixtureId: string | undefined }) {
  const { t } = useTranslation();
  const phone = usePhoneLayout();
  const { club, meeting, kickoffMatchId, myClubIsHome } = useNextMeeting(view, fixtureId);
  const blocks = {
    form: <FormBlock view={view} />,
    headToHead: <HeadToHeadBlock view={view} />,
    lastLineup: <LastLineupBlock lineup={view.lastLineup} pitch={phone} />,
    lines: <LinesBlock lineup={view.lastLineup?.side} theirName={view.club.name} club={club} />,
    notable: <NotableBlock notable={view.notable} />,
    absences: <AbsencesBlock absences={view.absences} />,
    kickoff: kickoffMatchId && (
      <KickoffBlock matchId={kickoffMatchId} myClubIsHome={myClubIsHome} pitch={phone} />
    ),
  };
  const header = (
    <Section title={<ClubTitle view={view} />}>
      <HeaderBlock view={view} next={meeting} />
    </Section>
  );
  const title = (key: string) => t(`online.opponent.${key}`);

  if (phone) {
    return (
      <div className="space-y-3">
        {header}
        <Fold title={title("form")} open>
          {blocks.form}
        </Fold>
        {blocks.kickoff && (
          <Fold title={title("kickoffLineup")} open>
            {blocks.kickoff}
          </Fold>
        )}
        <Fold title={title("absences")} open>
          {blocks.absences}
        </Fold>
        <Fold title={title("headToHead")}>{blocks.headToHead}</Fold>
        <Fold title={title("lastLineup")}>{blocks.lastLineup}</Fold>
        <Fold title={title("lines")}>{blocks.lines}</Fold>
        <Fold title={title("notable")}>{blocks.notable}</Fold>
      </div>
    );
  }
  return (
    <div className="grid items-start gap-6 xl:grid-cols-2">
      <div className="space-y-6">
        {header}
        <Section title={title("form")}>{blocks.form}</Section>
        <Section title={title("headToHead")}>{blocks.headToHead}</Section>
      </div>
      <div className="space-y-6">
        <Section title={title("lastLineup")}>{blocks.lastLineup}</Section>
        <Section title={title("lines")}>{blocks.lines}</Section>
        <Section title={title("notable")}>{blocks.notable}</Section>
        <Section title={title("absences")}>{blocks.absences}</Section>
        {blocks.kickoff && <Section title={title("kickoffLineup")}>{blocks.kickoff}</Section>}
      </div>
    </div>
  );
}

function ClubTitle({ view }: { view: OpponentView }) {
  return (
    <span className="flex items-center gap-3">
      <span aria-hidden="true" className="h-10 w-10 shrink-0">
        <ClubCrestMark profile={view.club} />
      </span>
      {view.club.name}
    </span>
  );
}

/** A desktop block: a card named by its header, so a screen reader can jump between blocks. */
function Section({ title, children }: { title: ReactNode; children: ReactNode }) {
  const id = useId();
  return (
    <section aria-labelledby={id}>
      <Card>
        <CardHeader>
          <span id={id}>{title}</span>
        </CardHeader>
        <CardBody>{children}</CardBody>
      </Card>
    </section>
  );
}

/** A phone block (C-23a §6.3): a card whose header folds and unfolds it. */
function Fold({
  title,
  open: openAtFirst = false,
  children,
}: {
  title: string;
  open?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(openAtFirst);
  const id = useId();
  return (
    <section
      aria-labelledby={`${id}-toggle`}
      className="rounded-xl border border-gray-200 bg-white dark:border-navy-600 dark:bg-navy-700"
    >
      <h3>
        <button
          id={`${id}-toggle`}
          type="button"
          aria-expanded={open}
          aria-controls={`${id}-body`}
          onClick={() => setOpen(!open)}
          className="flex w-full items-center justify-between rounded-xl px-4 py-3 text-left font-heading text-sm font-bold uppercase tracking-wide text-gray-800 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 dark:text-gray-100 dark:focus:ring-offset-navy-800"
        >
          {title}
          <ChevronDown
            aria-hidden="true"
            className={`h-4 w-4 shrink-0 transition-transform motion-reduce:transition-none ${open ? "rotate-180" : ""}`}
          />
        </button>
      </h3>
      {open && (
        <div id={`${id}-body`} className="border-t border-gray-100 px-4 py-3 dark:border-navy-600">
          {children}
        </div>
      )}
    </section>
  );
}
