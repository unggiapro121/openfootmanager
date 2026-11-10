import type { ClubProfileView } from "../../../api";
import { crestDraftOf } from "../../ClubCrestMark";

/**
 * The two colours a club's facilities art is painted in (c-27 §4.2, C27-5): its crest's, or its
 * kit's without a crest, as `#rrggbb`. Taken from the crest editor's own draft, so the stadium
 * and the crest never disagree.
 */
export function clubArtColors(profile: ClubProfileView): { c1: string; c2: string } {
  const { primary, secondary } = crestDraftOf(profile);
  return { c1: primary, c2: secondary };
}
