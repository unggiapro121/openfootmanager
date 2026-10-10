import { useTranslation } from "react-i18next";

import type { LeagueData, WorldRegionData } from "../store/gameStore";
import { countryName } from "../lib/countries";
import { competitionDisplayName } from "../lib/competitionName";
import { buildRegionLabel } from "../lib/teamRegions";
import { Card, CardBody, Select } from "../components/ui";

interface TeamSelectionScopePanelProps {
  regions: WorldRegionData[];
  selectedHomeRegionId: string | null;
  onSelectHomeRegion: (regionId: string | null) => void;
  selectedCountryCode: string | null;
  onSelectCountry: (countryCode: string | null) => void;
  regionCountries: string[];
  leagueOptions: LeagueData[];
  selectedLeagueId: string | null;
  onSelectLeague: (leagueId: string | null) => void;
}

export default function TeamSelectionScopePanel({
  regions,
  selectedHomeRegionId,
  onSelectHomeRegion,
  selectedCountryCode,
  onSelectCountry,
  regionCountries,
  leagueOptions,
  selectedLeagueId,
  onSelectLeague,
}: TeamSelectionScopePanelProps) {
  const { t, i18n } = useTranslation();
  const labelClass =
    "mb-2 text-xs font-heading font-bold uppercase tracking-[0.18em] text-gray-500 dark:text-gray-400";

  return (
    <Card>
      <CardBody className="grid gap-4 md:grid-cols-3">
        <div>
          <p className={labelClass}>{t("teamSelect.homeRegion")}</p>
          <Select
            value={selectedHomeRegionId ?? ""}
            onChange={(e) => {
              onSelectHomeRegion(e.target.value || null);
            }}
            fullWidth
            aria-label={t("teamSelect.homeRegion")}
          >
            {regions.map((region) => (
              <option key={region.id} value={region.id}>
                {buildRegionLabel(t, region.id, region.name)}
              </option>
            ))}
          </Select>
        </div>

        <div>
          <p className={labelClass}>{t("teamSelect.homeCountry")}</p>
          <Select
            value={selectedCountryCode ?? ""}
            onChange={(event) => onSelectCountry(event.target.value || null)}
            fullWidth
            aria-label={t("teamSelect.homeCountry")}
          >
            <option value="">{t("teamSelect.allCountries")}</option>
            {regionCountries.map((countryCode) => (
              <option key={countryCode} value={countryCode}>
                {countryName(countryCode, i18n.language)}
              </option>
            ))}
          </Select>
        </div>

        <div>
          <p className={labelClass}>{t("teamSelect.league")}</p>
          <Select
            value={selectedLeagueId ?? ""}
            onChange={(event) => onSelectLeague(event.target.value || null)}
            fullWidth
            aria-label={t("teamSelect.league")}
          >
            <option value="">{t("teamSelect.allLeagues")}</option>
            {leagueOptions.map((league) => (
              <option key={league.id} value={league.id}>
                {competitionDisplayName(league, t)}
              </option>
            ))}
          </Select>
        </div>
      </CardBody>
    </Card>
  );
}
