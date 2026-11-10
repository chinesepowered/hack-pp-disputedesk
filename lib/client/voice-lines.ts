/**
 * Marlow's spoken lines. They are pre-rendered to public/audio/marlow-<name>.mp3 by
 * `pnpm voice`, so the app plays files and never calls a speech API. The text here is also the
 * transcript shown on screen, so nothing is audio-only.
 */
export const MARLOW_LINES = {
  intake: "A new dispute just landed. I have booked time for it before the deadline.",
  ready: "The case is built. Have a look, then approve when you are ready.",
  filed: "Filed with PayPal. Now we wait, calmly.",
  offer: "Offer sent. If the buyer accepts, PayPal closes the case.",
  won: "We won that one. The money is back where it belongs.",
} as const;

export type MarlowLine = keyof typeof MARLOW_LINES;
