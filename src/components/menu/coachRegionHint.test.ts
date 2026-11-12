import { describe, expect, it } from "vitest";
import cs from "../../i18n/locales/cs.json";
import de from "../../i18n/locales/de.json";
import en from "../../i18n/locales/en.json";
import es from "../../i18n/locales/es.json";
import fr from "../../i18n/locales/fr.json";
import id from "../../i18n/locales/id.json";
import it_ from "../../i18n/locales/it.json";
import ptBR from "../../i18n/locales/pt-BR.json";
import pt from "../../i18n/locales/pt.json";
import ru from "../../i18n/locales/ru.json";
import tr from "../../i18n/locales/tr.json";
import vi from "../../i18n/locales/vi.json";
import zhCN from "../../i18n/locales/zh-CN.json";

/** Each locale's name for the coach's XP, as the shop and the items already say it. */
const COACH_XP: [string, { coach: { regionHint: string } }, string][] = [
  ["en", en, "coach XP"],
  ["vi", vi, "XP HLV"],
  ["de", de, "Trainer-XP"],
  ["fr", fr, "XP d'entraîneur"],
  ["es", es, "XP de entrenador"],
  ["it", it_, "XP da allenatore"],
  ["pt", pt, "XP de treinador"],
  ["pt-BR", ptBR, "XP de técnico"],
  ["ru", ru, "опыт тренера"],
  ["tr", tr, "teknik direktör XP"],
  ["cs", cs, "trenérské XP"],
  ["id", id, "XP pelatih"],
  ["zh-CN", zhCN, "教练经验"],
];

describe("the registration form's region hint (P5-26)", () => {
  // Given the hint under the region field, which says when the daily allowance starts afresh,
  // when it is read in any locale,
  // then it says the allowance is of coach XP, not of an XP a player could mistake for his own.
  it.each(COACH_XP)("names the coach's XP in %s", (_, locale, term) => {
    expect(locale.coach.regionHint).toContain(term);
  });
});
