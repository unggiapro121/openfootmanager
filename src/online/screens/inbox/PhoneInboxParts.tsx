import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ArrowRight,
  Check,
  CheckCheck,
  ChevronDown,
  ChevronLeft,
  ChevronUp,
  ListChecks,
  SlidersHorizontal,
  Trash2,
  X,
} from "lucide-react";
import {
  getCategoryColor,
  getCategoryIcon,
  isNavigateAction,
  renderMessageBodyLine,
} from "../../../components/inbox/inboxHelpers";
import type { MessageData } from "../../../store/types";
import { useOnlineNow } from "../../clock";
import { PhoneHeaderPart } from "../mobile/PhoneHeaderSlots";
import { FOCUS, PhoneSheet } from "../mobile/PhoneSheet";
import { categoryCounts, daysAgo, filterInbox, type InboxFilter, NO_FILTER } from "./inboxView";

const KEY = "online.inbox.phone";
const ICON_TILE =
  "flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-[10px] bg-gray-100 dark:bg-navy-700";

/** The clock time of a message, on this device. */
export function useClockTime(language: string) {
  return (iso: string) =>
    new Intl.DateTimeFormat(language, { hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
}

/** One message as a row: its category's icon, subject and time, sender and first line, unread dot. */
export function MessageRow({
  message,
  time,
  selecting,
  chosen,
  onTap,
}: {
  message: MessageData;
  time: string;
  selecting: boolean;
  chosen: boolean;
  onTap: () => void;
}) {
  const { t } = useTranslation();
  const unread = !message.read;
  const label = t(unread ? `${KEY}.unreadRow` : `${KEY}.row`, { subject: message.subject, time });
  const tone = chosen
    ? "border-primary-500 bg-primary-50 dark:bg-primary-900/30"
    : unread
      ? "border-gray-200 bg-white dark:border-navy-700 dark:bg-navy-800"
      : "border-transparent bg-gray-50 dark:bg-navy-900/60";
  return (
    <button
      type="button"
      onClick={onTap}
      aria-label={label}
      aria-pressed={selecting ? chosen : undefined}
      className={`mb-1 flex min-h-[68px] w-full items-start gap-2.5 rounded-xl border py-2.5 pl-2.5 pr-3 text-left ${tone} ${FOCUS}`}
    >
      {selecting && (
        <span
          aria-hidden="true"
          className={`mt-2 flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-md border-2 ${chosen ? "border-primary-500 bg-primary-500 text-white" : "border-gray-400 dark:border-navy-600"}`}
        >
          {chosen && <Check className="h-3 w-3" strokeWidth={3.5} />}
        </span>
      )}
      <span aria-hidden="true" className={`${ICON_TILE} ${getCategoryColor(message.category)}`}>
        {getCategoryIcon(message.category)}
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-[3px]">
        <span className="flex items-baseline gap-2">
          <span
            className={`min-w-0 flex-1 truncate text-sm ${unread ? "font-bold text-gray-900 dark:text-white" : "font-medium text-gray-700 dark:text-gray-300"}`}
          >
            {message.subject}
          </span>
          <span
            className={`shrink-0 text-[11px] tabular-nums ${unread ? "text-primary-700 dark:text-primary-400" : "text-gray-500 dark:text-gray-400"}`}
          >
            {time}
          </span>
        </span>
        <span className="flex items-center gap-2">
          <span className="min-w-0 flex-1 truncate text-xs text-gray-500 dark:text-gray-400">
            {message.sender} · {message.body.split("\n")[0]}
          </span>
          {unread && (
            <span aria-hidden="true" className="h-2 w-2 shrink-0 rounded-full bg-primary-500" />
          )}
        </span>
      </span>
    </button>
  );
}

/** A day's heading: today, yesterday, or its date. */
export function DayHeading({ date }: { date: Date }) {
  const { t, i18n } = useTranslation();
  const ago = daysAgo(date, new Date(useOnlineNow()));
  const label =
    ago === 0
      ? t(`${KEY}.today`)
      : ago === 1
        ? t(`${KEY}.yesterday`)
        : new Intl.DateTimeFormat(i18n.language, {
            weekday: "long",
            day: "2-digit",
            month: "2-digit",
          }).format(date);
  return (
    <h3 className="px-1 pb-1.5 pt-3.5 font-heading text-[13px] font-bold uppercase tracking-widest text-gray-500 dark:text-gray-400">
      {label}
    </h3>
  );
}

const CHIP_ON =
  "border-primary-500 bg-primary-50 text-gray-900 dark:bg-primary-900/40 dark:text-white";
const CHIP_OFF =
  "border-gray-200 bg-white text-gray-700 dark:border-navy-700 dark:bg-navy-800 dark:text-gray-200";

/**
 * The filter button (with how many filters are on) and the quick chips: unread only, all, then a
 * category at a time.
 */
export function QuickFilters({
  all,
  filter,
  onFilter,
  onOpenSheet,
  activeCount,
}: {
  all: readonly MessageData[];
  filter: InboxFilter;
  onFilter: (filter: InboxFilter) => void;
  onOpenSheet: () => void;
  activeCount: number;
}) {
  const { t } = useTranslation();
  const unread = all.filter((message) => !message.read).length;
  const chips = categoryCounts(all, filter.unreadOnly).filter(
    ({ category, count }) => count > 0 || filter.categories.includes(category),
  );
  const chip = (on: boolean) =>
    `inline-flex h-9 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-3 text-[13px] font-semibold ${on ? CHIP_ON : CHIP_OFF} ${FOCUS}`;
  const number = (on: boolean) =>
    `tabular-nums ${on ? "text-primary-700 dark:text-primary-400" : "text-gray-400 dark:text-gray-500"}`;
  return (
    <div className="flex items-center gap-1.5 pb-2.5 pl-3 pt-0.5">
      <button
        type="button"
        onClick={onOpenSheet}
        aria-label={t(`${KEY}.filters`)}
        aria-haspopup="dialog"
        className={`relative flex h-9 w-10 shrink-0 items-center justify-center rounded-[10px] border ${activeCount > 0 ? CHIP_ON : CHIP_OFF} ${FOCUS}`}
      >
        <SlidersHorizontal className="h-4.5 w-4.5" aria-hidden="true" />
        {activeCount > 0 && (
          <span
            aria-hidden="true"
            className="absolute -right-1.5 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary-500 px-1 text-[10px] font-bold text-navy-900"
          >
            {activeCount}
          </span>
        )}
      </button>
      <span aria-hidden="true" className="h-[22px] w-px shrink-0 bg-gray-200 dark:bg-navy-700" />
      <div
        role="toolbar"
        aria-label={t(`${KEY}.quickFilters`)}
        className="flex min-w-0 flex-1 gap-1.5 overflow-x-auto pr-3 [scrollbar-width:none]"
      >
        <button
          type="button"
          aria-pressed={filter.unreadOnly}
          onClick={() => onFilter({ ...filter, unreadOnly: !filter.unreadOnly })}
          className={chip(filter.unreadOnly)}
        >
          <span aria-hidden="true" className="h-2 w-2 rounded-full bg-primary-500" />
          {t(`${KEY}.unreadChip`)} <span className={number(filter.unreadOnly)}>{unread}</span>
        </button>
        <button
          type="button"
          aria-pressed={filter.categories.length === 0}
          onClick={() => onFilter({ ...filter, categories: [] })}
          className={chip(filter.categories.length === 0)}
        >
          {t("common.all")}{" "}
          <span className={number(filter.categories.length === 0)}>
            {filterInbox(all, { ...NO_FILTER, unreadOnly: filter.unreadOnly }).length}
          </span>
        </button>
        {chips.map(({ category, count }) => {
          const on = filter.categories.includes(category);
          return (
            <button
              key={category}
              type="button"
              aria-pressed={on}
              onClick={() =>
                onFilter({
                  ...filter,
                  categories: on && filter.categories.length === 1 ? [] : [category],
                })
              }
              className={chip(on)}
            >
              <span aria-hidden="true" className={getCategoryColor(category)}>
                {getCategoryIcon(category)}
              </span>
              {t(`inbox.categories.${category}`)} <span className={number(on)}>{count}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** Choosing several messages: how many, all of those shown, read them, or delete them. */
export function SelectionBar({
  count,
  allChosen,
  onToggleAll,
  onRead,
  onDelete,
  onExit,
}: {
  count: number;
  allChosen: boolean;
  onToggleAll: () => void;
  onRead: () => void;
  onDelete: () => void;
  onExit: () => void;
}) {
  const { t } = useTranslation();
  const icon = `flex h-11 w-11 items-center justify-center rounded-full disabled:opacity-40 ${FOCUS}`;
  return (
    <div className="flex min-h-[52px] items-center gap-1 pl-1 pr-2">
      <button
        type="button"
        onClick={onExit}
        aria-label={t(`${KEY}.exitSelect`)}
        className={`${icon} text-gray-900 dark:text-white`}
      >
        <X className="h-5.5 w-5.5" aria-hidden="true" />
      </button>
      <span className="flex-1 font-heading text-xl font-bold uppercase tracking-wide text-gray-900 dark:text-white">
        {t(`${KEY}.selected`, { count })}
      </span>
      <button
        type="button"
        onClick={onToggleAll}
        className={`h-9 rounded-lg px-2.5 text-[13px] font-semibold text-primary-700 dark:text-primary-400 ${FOCUS}`}
      >
        {t(allChosen ? `${KEY}.unselectAll` : `${KEY}.selectAll`)}
      </button>
      <button
        type="button"
        onClick={onRead}
        disabled={count === 0}
        aria-label={t(`${KEY}.markSelectedRead`)}
        className={`${icon} text-gray-900 dark:text-white`}
      >
        <CheckCheck className="h-5 w-5" aria-hidden="true" />
      </button>
      <button
        type="button"
        onClick={onDelete}
        disabled={count === 0}
        aria-label={t(`${KEY}.deleteSelected`)}
        className={`${icon} text-red-600 dark:text-red-400`}
      >
        <Trash2 className="h-5 w-5" aria-hidden="true" />
      </button>
    </div>
  );
}

/**
 * One message whole: its category, subject, who sent it and when, the text, the ways to the page
 * it is about, and a way to delete it; up and down step through the list it was opened from (a bar
 * under the app bar, so it stays in view).
 */
export function MessageDetail({
  message,
  position,
  total,
  onBack,
  onNewer,
  onOlder,
  onGo,
  onDelete,
}: {
  message: MessageData;
  position: number;
  total: number;
  onBack: () => void;
  onNewer?: () => void;
  onOlder?: () => void;
  onGo: (route: string) => void;
  onDelete: () => void;
}) {
  const { t, i18n } = useTranslation();
  const when = new Intl.DateTimeFormat(i18n.language, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(message.date));
  const initials = message.sender
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
  const step = `flex h-11 w-11 items-center justify-center rounded-full text-gray-900 disabled:opacity-35 dark:text-white ${FOCUS}`;
  return (
    <div className="-mx-3 -mt-3">
      <PhoneHeaderPart place="below">
        <div className="flex items-center gap-1 border-t border-gray-200 pl-1 pr-2 dark:border-navy-700">
          <button
            type="button"
            onClick={onBack}
            className={`flex h-11 items-center gap-0.5 rounded-full pl-1 pr-2.5 text-sm font-semibold text-gray-700 dark:text-gray-200 ${FOCUS}`}
          >
            <ChevronLeft className="h-5.5 w-5.5" aria-hidden="true" />
            {t("inbox.title")}
          </button>
          <span className="flex-1 text-center text-xs tabular-nums text-gray-500 dark:text-gray-400">
            {t(`${KEY}.position`, { n: position, total })}
          </span>
          <button
            type="button"
            onClick={onNewer}
            disabled={!onNewer}
            aria-label={t(`${KEY}.newer`)}
            className={step}
          >
            <ChevronUp className="h-5 w-5" aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={onOlder}
            disabled={!onOlder}
            aria-label={t(`${KEY}.older`)}
            className={step}
          >
            <ChevronDown className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>
      </PhoneHeaderPart>
      <article className="flex flex-col gap-3.5 px-4 pb-6 pt-4">
        <span
          className={`inline-flex h-[26px] items-center gap-1.5 self-start rounded-full bg-gray-100 px-2.5 font-heading text-xs font-bold uppercase tracking-wider dark:bg-navy-700 ${getCategoryColor(message.category)}`}
        >
          <span aria-hidden="true">{getCategoryIcon(message.category)}</span>
          {t(`inbox.categories.${message.category}`)}
        </span>
        <h2 className="font-heading text-[26px] font-bold leading-tight tracking-wide text-gray-900 dark:text-white">
          {message.subject}
        </h2>
        <div className="flex items-center gap-2.5 border-b border-gray-200 pb-3.5 dark:border-navy-700">
          <span
            aria-hidden="true"
            className="flex h-9 w-9 items-center justify-center rounded-full bg-gray-200 text-[13px] font-bold text-gray-700 dark:bg-navy-700 dark:text-white"
          >
            {initials}
          </span>
          <span className="flex min-w-0 flex-col gap-px">
            <span className="text-sm font-semibold text-gray-900 dark:text-white">
              {message.sender}
            </span>
            <span className="text-xs text-gray-500 dark:text-gray-400">{when}</span>
          </span>
        </div>
        <div className="text-[15px]">{message.body.split("\n").map(renderMessageBodyLine)}</div>
        {message.actions.map((action) =>
          isNavigateAction(action.action_type) ? (
            <button
              key={action.id}
              type="button"
              onClick={() =>
                isNavigateAction(action.action_type) && onGo(action.action_type.NavigateTo.route)
              }
              className={`mt-1.5 flex h-12 items-center justify-center gap-2 rounded-[10px] bg-primary-700 font-heading text-base font-bold uppercase tracking-wider text-white hover:bg-primary-600 ${FOCUS}`}
            >
              {action.label}
              <ArrowRight className="h-4.5 w-4.5" aria-hidden="true" />
            </button>
          ) : null,
        )}
        <button
          type="button"
          onClick={onDelete}
          className={`flex h-11 items-center justify-center gap-1.5 rounded-[10px] border border-red-300 text-[13px] font-semibold text-red-600 dark:border-red-900 dark:text-red-400 ${FOCUS}`}
        >
          <Trash2 className="h-4 w-4" aria-hidden="true" />
          {t(`${KEY}.delete`)}
        </button>
      </article>
    </div>
  );
}

/** Two choices side by side, one picked. */
function Segmented<T>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: Array<{ value: T; label: string }>;
  onChange: (value: T) => void;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className="grid grid-cols-2 gap-1 rounded-[10px] border border-gray-200 bg-gray-50 p-[3px] dark:border-navy-700 dark:bg-navy-900"
    >
      {options.map((option) => (
        <button
          key={String(option.value)}
          type="button"
          role="radio"
          aria-checked={option.value === value}
          onClick={() => onChange(option.value)}
          className={`h-[38px] rounded-lg text-[13px] font-semibold ${option.value === value ? "bg-white text-gray-900 dark:bg-navy-700 dark:text-white" : "text-gray-500 dark:text-gray-400"} ${FOCUS}`}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

const SECTION = "text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400";

/** The full filter, chosen on a draft and applied with the button that says how many it keeps. */
export function FilterSheet({
  all,
  filter,
  onApply,
  onClose,
}: {
  all: readonly MessageData[];
  filter: InboxFilter;
  onApply: (filter: InboxFilter) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState(filter);
  return (
    <PhoneSheet title={t(`${KEY}.filterTitle`)} onClose={onClose}>
      <button
        type="button"
        onClick={() => setDraft(NO_FILTER)}
        className={`self-end text-[13px] font-semibold text-primary-700 dark:text-primary-400 ${FOCUS}`}
      >
        {t(`${KEY}.reset`)}
      </button>
      <span className={SECTION}>{t("common.status")}</span>
      <Segmented
        label={t("common.status")}
        value={draft.unreadOnly}
        options={[
          { value: false, label: t("common.all") },
          { value: true, label: t(`${KEY}.unreadOnly`) },
        ]}
        onChange={(unreadOnly) => setDraft({ ...draft, unreadOnly })}
      />
      <span className={SECTION}>{t(`${KEY}.kinds`)}</span>
      <div className="grid grid-cols-2 gap-1.5">
        {categoryCounts(all, draft.unreadOnly).map(({ category, count }) => {
          const on = draft.categories.includes(category);
          return (
            <button
              key={category}
              type="button"
              role="checkbox"
              aria-checked={on}
              onClick={() =>
                setDraft({
                  ...draft,
                  categories: on
                    ? draft.categories.filter((one) => one !== category)
                    : [...draft.categories, category],
                })
              }
              className={`flex h-11 items-center gap-2 rounded-[10px] border px-2.5 text-left text-[13px] font-semibold ${on ? CHIP_ON : CHIP_OFF} ${FOCUS}`}
            >
              <span aria-hidden="true" className={getCategoryColor(category)}>
                {getCategoryIcon(category)}
              </span>
              <span className="min-w-0 flex-1 truncate">{t(`inbox.categories.${category}`)}</span>
              <span className="tabular-nums text-gray-500 dark:text-gray-400">{count}</span>
            </button>
          );
        })}
      </div>
      <span className={SECTION}>{t("inbox.sortLabel")}</span>
      <Segmented
        label={t("inbox.sortLabel")}
        value={draft.oldestFirst}
        options={[
          { value: false, label: t("inbox.sortNewest") },
          { value: true, label: t("inbox.sortOldest") },
        ]}
        onChange={(oldestFirst) => setDraft({ ...draft, oldestFirst })}
      />
      <button
        type="button"
        onClick={() => onApply(draft)}
        className={`h-12 rounded-[10px] bg-primary-700 font-heading text-[17px] font-bold uppercase tracking-wider text-white ${FOCUS}`}
      >
        {t(`${KEY}.showCount`, { count: filterInbox(all, draft).length })}
      </button>
    </PhoneSheet>
  );
}

/** The inbox's own actions: choose several, read all, delete the read ones. */
export function ActionsSheet({
  unread,
  read,
  onSelect,
  onReadAll,
  onDeleteRead,
  onClose,
}: {
  unread: number;
  read: number;
  onSelect: () => void;
  onReadAll: () => void;
  onDeleteRead: () => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const items = [
    {
      id: "selectMany",
      sub: t(`${KEY}.selectManySub`),
      icon: <ListChecks className="h-4.5 w-4.5" />,
      off: false,
      danger: false,
      act: onSelect,
    },
    {
      id: "readAll",
      sub: t(`${KEY}.readAllSub`, { count: unread }),
      icon: <CheckCheck className="h-4.5 w-4.5" />,
      off: unread === 0,
      danger: false,
      act: onReadAll,
    },
    {
      id: "deleteRead",
      sub: t(`${KEY}.deleteReadSub`, { count: read }),
      icon: <Trash2 className="h-4.5 w-4.5" />,
      off: read === 0,
      danger: true,
      act: onDeleteRead,
    },
  ];
  return (
    <PhoneSheet title={t(`${KEY}.actions`)} onClose={onClose}>
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          onClick={item.act}
          disabled={item.off}
          className={`flex min-h-14 items-center gap-3 rounded-xl px-1 text-left disabled:opacity-45 ${item.danger ? "text-red-600 dark:text-red-400" : "text-gray-900 dark:text-white"} ${FOCUS}`}
        >
          <span
            aria-hidden="true"
            className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] ${item.danger ? "bg-red-100 dark:bg-red-900/40" : "bg-gray-100 dark:bg-navy-700"}`}
          >
            {item.icon}
          </span>
          <span className="flex flex-1 flex-col gap-0.5">
            <span className="text-[15px] font-semibold">{t(`${KEY}.${item.id}`)}</span>
            <span className="text-xs text-gray-500 dark:text-gray-400">{item.sub}</span>
          </span>
        </button>
      ))}
    </PhoneSheet>
  );
}
