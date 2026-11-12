import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { BellRing } from "lucide-react";
import { Button } from "../../../components/ui";
import { logError } from "../../../lib/logger";
import { isMobileBuild } from "../../../lib/platform";
import {
  onPushEvent,
  pushPermissionState,
  takeOpenedPush,
} from "../../../services/onlinePushService";
import { online } from "../../client";
import { enablePush, openedOutboxId, registerPushDevice, usePushAsk } from "../../push/pushDevice";
import { pushRoute } from "../../push/pushRoute";
import { PhoneSheet } from "../mobile/PhoneSheet";

const KEY = "online.push.ask";

function logged(what: string) {
  return (failure: unknown) => logError(`[push] ${what} failed: ${String(failure)}`);
}

/**
 * Push in the online mode on the phone (phase 5 M3c2, m3-tech-spec §5.4–5.7): the installation
 * registered as the mode opens, as the app comes back and on a new token; the push the app was
 * opened from followed once the session is back; and the one-time explanation before the
 * system's question. Nothing on the desktop.
 */
export function PushWatcher() {
  return isMobileBuild() ? <OnPhone /> : null;
}

function OnPhone() {
  const navigate = useNavigate();
  const asking = usePushAsk((state) => state.open);

  useEffect(() => {
    let alive = true;
    const stops: Array<() => void> = [];
    const keep = (stop: () => void) => {
      if (alive) stops.push(stop);
      else stop();
    };
    const register = () => void registerPushDevice().catch(logged("registering"));
    const follow = async () => {
      const data = await takeOpenedPush();
      if (data === null || !alive) return;
      const outboxId = openedOutboxId(data);
      if (outboxId !== undefined) void online.push.opened(outboxId).catch(logged("counting"));
      navigate(pushRoute(data));
    };
    const back = () => {
      if (document.visibilityState === "visible") register();
    };

    register();
    void follow().catch(logged("opening"));
    void onPushEvent("opened", () => void follow().catch(logged("opening"))).then(keep);
    void onPushEvent("token", register).then(keep);
    document.addEventListener("visibilitychange", back);
    return () => {
      alive = false;
      for (const stop of stops) stop();
      document.removeEventListener("visibilitychange", back);
    };
  }, [navigate]);

  return asking ? <AskSheet /> : null;
}

/**
 * The app's own explanation before the system's question (§5.4). A phone that can no longer ask
 * (allowed already, or refused for good) skips it and passes its answer on.
 */
function AskSheet() {
  const { t } = useTranslation();
  const settle = usePushAsk((state) => state.settle);
  // Shown only once the phone said the system can still ask.
  const [shown, setShown] = useState(false);

  useEffect(() => {
    let alive = true;
    pushPermissionState()
      .then((state) => {
        if (!alive) return;
        if (state === "prompt") {
          setShown(true);
          return;
        }
        settle();
        return enablePush().then(() => undefined);
      })
      .catch((failure: unknown) => {
        settle();
        logged("asking")(failure);
      });
    return () => {
      alive = false;
    };
  }, [settle]);

  if (!shown) return null;

  const turnOn = () => {
    settle();
    void enablePush().catch(logged("asking"));
  };

  return (
    <PhoneSheet title={t(`${KEY}.title`)} onClose={settle}>
      {(close) => (
        <>
          <div className="flex gap-3">
            <BellRing
              className="mt-0.5 h-5 w-5 shrink-0 text-primary-600 dark:text-primary-400"
              aria-hidden="true"
            />
            <p className="text-sm text-gray-700 dark:text-gray-200">{t(`${KEY}.body`)}</p>
          </div>
          <div className="flex flex-col gap-2">
            <Button type="button" onClick={turnOn}>
              {t(`${KEY}.allow`)}
            </Button>
            <Button type="button" variant="outline" onClick={close}>
              {t(`${KEY}.later`)}
            </Button>
          </div>
        </>
      )}
    </PhoneSheet>
  );
}
