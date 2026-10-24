import { useTranslation } from "react-i18next";
import { Badge, Card, CardBody, CardHeader } from "../../components/ui";
import type { LicenceView } from "../api";

/**
 * The coach's licence (S-9 S9-15): which one he holds, at which online level, and when the next
 * opens. Nothing while the season has no licences.
 */
export default function LicenceCard({ licence }: { licence: LicenceView | undefined }) {
  const { t } = useTranslation();
  if (!licence) return null;
  const name = (tier: number) => t(`tactics.licence.tier_${tier}`);
  return (
    <Card>
      <CardHeader
        action={
          licence.pending ? (
            <Badge variant="accent" size="sm">
              {t("online.licence.pending")}
            </Badge>
          ) : undefined
        }
      >
        {t("online.licence.title")}
      </CardHeader>
      <CardBody className="space-y-2 text-sm text-gray-700 dark:text-gray-300">
        <p className="font-heading text-lg font-bold text-gray-900 dark:text-gray-100">
          {t("online.licence.held", { licence: name(licence.tier), level: licence.level })}
        </p>
        <p>
          {licence.nextTierLevel === undefined
            ? t("online.licence.highest")
            : t("online.licence.next", {
                licence: name(licence.tier + 1),
                level: licence.nextTierLevel,
              })}
        </p>
      </CardBody>
    </Card>
  );
}
