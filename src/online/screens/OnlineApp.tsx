import { Navigate, Route, Routes } from "react-router-dom";
import OnlineOverview from "./OnlineOverview";
import OnlineProfile from "./OnlineProfile";
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
        <Route path="profile" element={<OnlineProfile />} />
        <Route path="*" element={<Navigate to="/online" replace />} />
      </Route>
    </Routes>
  );
}
