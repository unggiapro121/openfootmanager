import { useEffect } from "react";
import { online } from "../client";
import { tracked, useOnlineStore } from "../store/onlineStore";

/**
 * Keeps `playerPictures` to the club's players who have a picture of their own: reads the ones it
 * has not got, drops those that went. A picture changed in place is set by the dialog that
 * changed it. Renders nothing.
 */
export function PlayerPictureSync() {
  const players = useOnlineStore((state) => state.club?.players);

  useEffect(() => {
    if (!players) return;
    const wanted = new Set(players.filter((p) => p.hasAvatarImage).map((p) => p.id));
    const known = useOnlineStore.getState().playerPictures;
    const kept = Object.fromEntries(Object.entries(known).filter(([id]) => wanted.has(id)));
    if (Object.keys(kept).length !== Object.keys(known).length) {
      useOnlineStore.getState().setPlayerPictures(kept);
    }
    for (const id of wanted) {
      if (kept[id]) continue;
      tracked(() => online.players.avatarImage(id))
        .then((view) => {
          const now = useOnlineStore.getState().playerPictures;
          useOnlineStore.getState().setPlayerPictures({ ...now, [id]: view.dataUrl });
        })
        .catch(() => {
          // No picture to show: his portrait is drawn as it is without one.
        });
    }
  }, [players]);

  return null;
}
