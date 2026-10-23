import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "../../components/ui";
import { resolveBackendError } from "../../utils/backendI18n";
import type { OnlineResource } from "../useOnlineResource";

/** A page's own view: a loading line, the failure with a retry, or the page itself. */
export default function ResourceState<T>({
  resource,
  reload,
  children,
}: {
  resource: OnlineResource<T>;
  reload: () => void;
  children: (data: T) => ReactNode;
}) {
  const { t } = useTranslation();
  if (resource.status === "loading") {
    return <p className="text-sm text-gray-500 dark:text-gray-400">{t("online.loading")}</p>;
  }
  if (resource.status === "failed") {
    return (
      <div className="flex flex-col items-start gap-3">
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {resolveBackendError(resource.error)}
        </p>
        <Button variant="outline" size="sm" onClick={reload}>
          {t("online.retry")}
        </Button>
      </div>
    );
  }
  return <>{children(resource.data)}</>;
}
