import { useEffect, useState } from "react";
import { type CoachAccount, resumeCoachSession } from "../../../services/coachService";
import { resolveBackendError } from "../../../utils/backendI18n";
import CoachLoginLoading from "../CoachLoginLoading";
import ServerForgotForm from "./ServerForgotForm";
import ServerLoginForm from "./ServerLoginForm";
import ServerRegisterForm from "./ServerRegisterForm";
import ServerResetForm from "./ServerResetForm";
import ServerVerifyForm from "./ServerVerifyForm";
import type { Feedback, ServerLoginView, ServerViewProps } from "./serverAuth.helpers";

interface CoachServerLoginProps {
  onLoggedIn: (account: CoachAccount) => void;
}

/**
 * The login gate with the accounts on the account server: the session kept from
 * the last run first, then email and password, registration with the code sent
 * by email, and a forgotten password reset the same way.
 */
export default function CoachServerLogin({ onLoggedIn }: CoachServerLoginProps) {
  const [view, setView] = useState<ServerLoginView | null>(null);
  const [email, setEmail] = useState("");
  const [feedback, setFeedback] = useState<Feedback>(null);

  useEffect(() => {
    let isCurrent = true;
    resumeCoachSession()
      .then((account) => {
        if (!isCurrent) return;
        if (account) onLoggedIn(account);
        else setView("login");
      })
      .catch((error) => {
        if (!isCurrent) return;
        setFeedback({ tone: "error", message: resolveBackendError(error) });
        setView("login");
      });
    return () => {
      isCurrent = false;
    };
  }, [onLoggedIn]);

  if (view === null) return <CoachLoginLoading />;

  const shared: ServerViewProps = {
    email,
    onEmailChange: setEmail,
    feedback,
    onFeedback: setFeedback,
    onNavigate: (next, nextFeedback = null) => {
      setFeedback(nextFeedback);
      setView(next);
    },
  };

  switch (view) {
    case "login":
      return <ServerLoginForm {...shared} onLoggedIn={onLoggedIn} />;
    case "register":
      return <ServerRegisterForm {...shared} />;
    case "verify":
      return <ServerVerifyForm {...shared} />;
    case "forgot":
      return <ServerForgotForm {...shared} />;
    case "reset":
      return <ServerResetForm {...shared} />;
  }
}
