import { Navigate, Route, Routes } from "react-router-dom";
import OnlineOverview from "./OnlineOverview";
import OnlineProfile from "./OnlineProfile";
import OnlineShell from "./OnlineShell";
import OnlineTakeover from "./OnlineTakeover";

/** The online mode under `/online` (phase 3 C-2, C2-2): its own shell, apart from the dashboard. */
export default function OnlineApp() {
  return (
    <Routes>
      <Route element={<OnlineShell />}>
        <Route index element={<OnlineOverview />} />
        <Route path="takeover" element={<OnlineTakeover />} />
        <Route path="profile" element={<OnlineProfile />} />
        <Route path="*" element={<Navigate to="/online" replace />} />
      </Route>
    </Routes>
  );
}
