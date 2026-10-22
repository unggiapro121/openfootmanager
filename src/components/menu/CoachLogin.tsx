import { useEffect, useState } from "react";
import {
  type CoachAccount,
  type CoachAccountMode,
  getCoachAccountMode,
} from "../../services/coachService";
import CoachLocalLogin from "./CoachLocalLogin";
import CoachLoginLoading from "./CoachLoginLoading";
import CoachServerLogin from "./coachServer/CoachServerLogin";

interface CoachLoginProps {
  onLoggedIn: (account: CoachAccount) => void;
}

/**
 * The gate in front of the main menu. With an account server configured the
 * player logs in with email and password; otherwise he picks an account on
 * this machine.
 */
export default function CoachLogin({ onLoggedIn }: CoachLoginProps) {
  const [mode, setMode] = useState<CoachAccountMode | null>(null);

  useEffect(() => {
    getCoachAccountMode()
      .then(setMode)
      .catch((error) => {
        console.error("Failed to read the account mode:", error);
        setMode("local");
      });
  }, []);

  if (mode === null) return <CoachLoginLoading />;
  if (mode === "server") return <CoachServerLogin onLoggedIn={onLoggedIn} />;
  return <CoachLocalLogin onLoggedIn={onLoggedIn} />;
}
