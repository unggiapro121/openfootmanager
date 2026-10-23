import { Navigate, Route, Routes } from "react-router-dom";
import OnlineFixture from "./OnlineFixture";
import OnlineLeague from "./OnlineLeague";
import OnlineMatch from "./match/OnlineMatch";
import OnlineOverview from "./OnlineOverview";
import OnlineProfile from "./OnlineProfile";
import OnlinePublicClub from "./OnlinePublicClub";
import OnlineSchedule from "./OnlineSchedule";
import OnlineFriendly from "./friendly/OnlineFriendly";
import OnlineShell from "./OnlineShell";
import OnlineSquad from "./OnlineSquad";
import OnlineTactics from "./OnlineTactics";
import OnlineTakeover from "./OnlineTakeover";
import OnlineTraining from "./OnlineTraining";

/** The online mode under `/online` (phase 3 C-2, C2-2): its own shell, apart from the dashboard. */
export default function OnlineApp() {
  return (
    <Routes>
      <Route element={<OnlineShell />}>
        <Route index element={<OnlineOverview />} />
        <Route path="takeover" element={<OnlineTakeover />} />
        <Route path="squad" element={<OnlineSquad />} />
        <Route path="tactics" element={<OnlineTactics />} />
        <Route path="training" element={<OnlineTraining />} />
        <Route path="league" element={<OnlineLeague />} />
        <Route path="schedule" element={<OnlineSchedule />} />
        <Route path="friendly" element={<OnlineFriendly />} />
        <Route path="clubs/:clubId" element={<OnlinePublicClub />} />
        <Route path="fixtures/:fixtureId" element={<OnlineFixture />} />
        <Route path="match/:matchId" element={<OnlineMatch />} />
        <Route path="profile" element={<OnlineProfile />} />
        <Route path="*" element={<Navigate to="/online" replace />} />
      </Route>
    </Routes>
  );
}
