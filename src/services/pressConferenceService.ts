import { invoke } from "./transport";

import type { GameStateData } from "../store/gameStore";

/** One answered question, as the backend scores it. */
export interface PressConferenceAnswer {
  question_id: string;
  response_id: string;
  response_tone: string;
  response_text: string;
  response_text_key: string;
  response_text_params?: Record<string, string>;
  question_text: string;
  player_id?: string;
}

/** The game after the press conference, and the squad's morale swing from it. */
export interface PressConferenceOutcome {
  game: GameStateData;
  morale_delta: number;
}

/** The manager's answers go to the press; the squad's morale reacts to them. */
export async function submitPressConference(
  answers: PressConferenceAnswer[],
): Promise<PressConferenceOutcome> {
  return invoke<PressConferenceOutcome>("submit_press_conference", { answers });
}
