import { type ReactNode, useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Minus, Plus, RotateCcw, X } from "lucide-react";
import { usePhoneLayout } from "../../../../hooks/usePhoneLayout";
import type { FacilitiesView, FacilityItemView } from "../../../api";
import { FOCUS } from "../../mobile/PhoneSheet";
import type { ArtKey } from "../art/artKeys";
import type { CardState } from "../cardState";
import { cardArt, facilityName } from "../facilityText";
import type { MapSlot } from "./layout";
import { MapBuilding, MapCrane, MapGround, MapLabel, STATUS_DOT_BG } from "./MapArt";
import {
  BUTTON_ZOOM,
  drawOrder,
  LIST_ORDER,
  labelY,
  type MapStatus,
  mapStatus,
  slotPoint,
  VIEW_BOX_ATTR,
} from "./mapView";
import { useCampusCamera } from "./useCampusCamera";
import { hintSeen, markHintSeen } from "./viewMode";

/** A building on the map: its item from the server, or the trophy room, which has none. */
interface Placed {
  slot: MapSlot;
  item: FacilityItemView | null;
  art: ArtKey;
}

const OVERLAY =
  "rounded-xl border border-gray-200 bg-white/90 text-gray-800 shadow-sm backdrop-blur dark:border-navy-600 dark:bg-navy-900/90 dark:text-gray-100";
const ZOOM_BUTTON = `flex h-11 w-11 items-center justify-center hover:bg-gray-100 dark:hover:bg-navy-700 ${FOCUS}`;
const LEGEND: MapStatus[] = ["building", "upgradable", "waiting", "top"];

/** The buildings the map shows: each the server sent with a known slot, and the trophy room. */
function placedOf(items: FacilityItemView[]): Placed[] {
  return LIST_ORDER.flatMap((slot): Placed[] => {
    if (slot === "trophy") return [{ slot, item: null, art: "trophy" }];
    const item = items.find((entry) => entry.facility === slot);
    const art = item ? cardArt(item) : null;
    return item && art ? [{ slot, item, art }] : [];
  });
}

/**
 * The campus map of the club's facilities (c-27 §6, C-27e): every building on the ground in the
 * club's colours with its label and state, dragged and zoomed, and a picked building's card in a
 * panel beside it (a sheet on a phone). Everything here is also in the List.
 */
export function CampusMap({
  view,
  stateOf,
  newFacility,
  firstPick,
  panelFor,
}: {
  view: FacilitiesView;
  stateOf: (item: FacilityItemView) => CardState;
  newFacility: string | null;
  /** A building opened with the map (the sold-out mail's way to the stands, c-27 §7.3). */
  firstPick: MapSlot | null;
  panelFor: (slot: MapSlot) => ReactNode;
}) {
  const { t } = useTranslation();
  const phone = usePhoneLayout();
  const [picked, setPicked] = useState<MapSlot | null>(firstPick);
  const [focused, setFocused] = useState<MapSlot | null>(null);
  const [hint, setHint] = useState(() => !hintSeen());
  const camera = useCampusCamera(() => {
    markHintSeen();
    setHint(false);
  });
  const placed = placedOf(view.items ?? []);
  const bySlot = new Map(placed.map((entry) => [entry.slot, entry]));
  const building = view.build?.facility;
  const zoom = camera.unit / camera.view.s;
  const frame = useRef<HTMLDivElement>(null);

  const nameOf = (slot: MapSlot, item: FacilityItemView | null) => {
    if (slot === "stands") return t("online.facilities.section.stadium");
    if (!item) return t("online.facilities.section.trophies");
    return facilityName(t, item.facility);
  };
  const levelOf = (item: FacilityItemView | null) => {
    if (!item) return "";
    return item.level === 0 && item.facility !== "stands"
      ? t("online.facilities.card.unbuilt")
      : t("online.facilities.card.level", { level: item.level });
  };
  const pick = (slot: MapSlot, fromPointer: boolean) => {
    if (fromPointer && camera.wasDrag()) return;
    setPicked(slot);
    if (hint) {
      markHintSeen();
      setHint(false);
    }
    camera.focusOn(slotPoint(slot), phone ? "sheet" : "side");
  };

  return (
    <div
      ref={frame}
      className="relative h-[70vh] min-h-[420px] overflow-hidden rounded-2xl border border-gray-200 bg-green-800 md:h-[min(72vh,680px)] dark:border-navy-600 dark:bg-green-900"
    >
      <svg
        ref={camera.ref}
        viewBox={VIEW_BOX_ATTR}
        preserveAspectRatio="xMidYMid meet"
        role="application"
        aria-label={t("online.facilities.map.label")}
        className="h-full w-full touch-none select-none"
        {...camera.handlers}
      >
        <g
          transform={`translate(${camera.view.tx.toFixed(1)},${camera.view.ty.toFixed(1)}) scale(${camera.view.s.toFixed(3)})`}
        >
          <MapGround />
          {drawOrder().flatMap((slot) => {
            const entry = bySlot.get(slot);
            if (!entry) return [];
            return [
              <MapBuilding
                key={slot}
                slot={slot}
                art={entry.art}
                dimmed={entry.item?.level === 0 && slot !== "stands"}
                picked={picked === slot}
                focused={focused === slot}
                onPick={() => pick(slot, true)}
              />,
            ];
          })}
          {building && bySlot.has(building as MapSlot) && <MapCrane slot={building as MapSlot} />}
          {placed.map(({ slot, item, art }) => {
            const [x] = slotPoint(slot);
            const name = nameOf(slot, item);
            const level = levelOf(item);
            const named = item ? facilityName(t, item.facility) : name;
            const isBuilding = building === item?.facility;
            return (
              <MapLabel
                key={slot}
                slot={slot}
                x={x}
                y={labelY(slot, art)}
                zoom={zoom}
                name={name}
                level={level}
                status={item ? mapStatus(stateOf(item)) : "none"}
                ariaLabel={
                  item
                    ? t(
                        isBuilding
                          ? "online.facilities.map.itemBuilding"
                          : "online.facilities.map.item",
                        { name: named, level },
                      )
                    : name
                }
                isNew={item !== null && newFacility === item.facility}
                newText={t("online.facilities.card.new")}
                picked={picked === slot}
                onPick={() => pick(slot, true)}
                onFocusChange={(on) => {
                  setFocused(on ? slot : null);
                  if (on) camera.reveal(slotPoint(slot));
                }}
              />
            );
          })}
        </g>
      </svg>
      <MapControls
        panelOn={picked !== null && !phone}
        hint={hint}
        phone={phone}
        onZoom={camera.zoomBy}
        onReset={camera.reset}
      />
      {picked && (
        <MapPanel
          title={nameOf(picked, bySlot.get(picked)?.item ?? null)}
          sheet={phone}
          onClose={() => {
            setPicked(null);
            camera.release();
            frame.current?.querySelector<SVGGElement>(`[data-label="${picked}"]`)?.focus();
          }}
        >
          {panelFor(picked)}
        </MapPanel>
      )}
    </div>
  );
}

/** The legend, the zoom buttons and the drag hint over the map. */
function MapControls({
  panelOn,
  hint,
  phone,
  onZoom,
  onReset,
}: {
  panelOn: boolean;
  hint: boolean;
  phone: boolean;
  onZoom: (factor: number) => void;
  onReset: () => void;
}) {
  const { t } = useTranslation();
  return (
    <>
      {!phone && (
        <ul
          className={`absolute bottom-3 left-3 z-[5] flex max-w-[60%] flex-wrap gap-x-3 gap-y-1 px-3 py-2 text-xs ${OVERLAY}`}
        >
          {LEGEND.map((status) => (
            <li key={status} className="flex items-center gap-1.5">
              <span
                className={`h-2 w-2 rounded-full ${STATUS_DOT_BG[status]}`}
                aria-hidden="true"
              />
              {t(`online.facilities.map.legend.${status}`)}
            </li>
          ))}
        </ul>
      )}
      <div
        role="group"
        aria-label={t("online.facilities.map.zoom")}
        className={`absolute bottom-3 z-[5] flex flex-col divide-y divide-gray-200 overflow-hidden dark:divide-navy-600 ${panelOn ? "right-[452px]" : "right-3"} ${OVERLAY}`}
      >
        <button
          type="button"
          aria-label={t("online.facilities.map.zoomIn")}
          onClick={() => onZoom(BUTTON_ZOOM)}
          className={ZOOM_BUTTON}
        >
          <Plus className="h-5 w-5" aria-hidden="true" />
        </button>
        <button
          type="button"
          aria-label={t("online.facilities.map.zoomOut")}
          onClick={() => onZoom(1 / BUTTON_ZOOM)}
          className={ZOOM_BUTTON}
        >
          <Minus className="h-5 w-5" aria-hidden="true" />
        </button>
        <button
          type="button"
          aria-label={t("online.facilities.map.reset")}
          onClick={onReset}
          className={ZOOM_BUTTON}
        >
          <RotateCcw className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
      {hint && (
        <span
          className={`pointer-events-none absolute left-1/2 top-3 z-[5] max-w-[calc(100%-1.5rem)] -translate-x-1/2 truncate rounded-full px-3 py-1.5 text-xs ${OVERLAY}`}
        >
          {phone ? t("online.facilities.map.hintPhone") : t("online.facilities.map.hint")}
        </span>
      )}
    </>
  );
}

/**
 * A picked building's details: a column at the map's right on a desktop, a sheet from the bottom
 * on a phone. Not modal: the map stays usable. It takes the focus when it opens, Esc or the close
 * button shuts it, and the focus goes back to the map.
 */
function MapPanel({
  title,
  sheet,
  onClose,
  children,
}: {
  title: string;
  sheet: boolean;
  onClose: () => void;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  const panel = useRef<HTMLDivElement>(null);
  const titleId = useId();

  // A new building picked moves the focus into its panel again.
  useEffect(() => {
    panel.current?.focus();
  }, [title]);

  const place = sheet
    ? "fixed inset-x-0 bottom-0 z-50 max-h-[74vh] rounded-t-2xl border-t pb-[calc(1rem+var(--safe-bottom,0px))] animate-sheet-up motion-reduce:animate-none"
    : "absolute bottom-3 right-3 top-3 z-10 w-[420px] max-w-[calc(100%-1.5rem)] rounded-2xl border";
  return (
    <div
      ref={panel}
      role="dialog"
      aria-modal="false"
      aria-labelledby={titleId}
      tabIndex={-1}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.stopPropagation();
          onClose();
        }
      }}
      className={`flex flex-col gap-3 overflow-y-auto border-gray-200 bg-gray-50 p-4 shadow-xl outline-none dark:border-navy-600 dark:bg-navy-900 ${place}`}
    >
      {sheet && (
        <div
          className="mx-auto h-1 w-10 shrink-0 rounded-full bg-gray-300 dark:bg-navy-600"
          aria-hidden="true"
        />
      )}
      <div className="flex shrink-0 items-center gap-2">
        <h2
          id={titleId}
          className="min-w-0 flex-1 font-heading text-xl font-bold uppercase tracking-wider text-gray-900 dark:text-gray-100"
        >
          {title}
        </h2>
        <button
          type="button"
          onClick={onClose}
          aria-label={t("online.facilities.map.close")}
          className={`flex h-11 w-11 items-center justify-center rounded-lg text-gray-600 hover:bg-gray-200 dark:text-gray-300 dark:hover:bg-navy-700 ${FOCUS}`}
        >
          <X className="h-5 w-5" aria-hidden="true" />
        </button>
      </div>
      <div className="flex shrink-0 flex-col gap-3">{children}</div>
    </div>
  );
}
