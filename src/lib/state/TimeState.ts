/**
 * TimeState.ts
 *
 * Maps the user's local clock to world time periods.
 * Provides formatted time strings and period labels for the UI.
 *
 * Time periods:
 *   Dawn     (5–7)   → soft warm light rising
 *   Morning  (7–11)  → calm, clear, brightening
 *   Midday   (11–14) → full brightness, neutral
 *   Afternoon(14–17) → warm, golden undertone
 *   Evening  (17–20) → golden hour, cinematic warmth
 *   Dusk     (20–21) → deep warm, sky dimming
 *   Night    (21–5)  → cinematic, glowing castle
 */

export type TimePeriod =
  | 'dawn'
  | 'morning'
  | 'midday'
  | 'afternoon'
  | 'evening'
  | 'dusk'
  | 'night';

export interface TimeInfo {
  /** Current time period name */
  period: TimePeriod;
  /** Human-readable period label (e.g. "Evening") */
  periodLabel: string;
  /** Formatted local time (e.g. "7:42 PM") */
  formattedTime: string;
  /** Combined display string (e.g. "Evening – 7:42 PM") */
  display: string;
  /** Raw hour (0-23) */
  hour: number;
  /** Day phase (0 = midnight, 0.5 = noon) */
  dayPhase: number;
}

const PERIOD_LABELS: Record<TimePeriod, string> = {
  dawn: 'Dawn',
  morning: 'Morning',
  midday: 'Midday',
  afternoon: 'Afternoon',
  evening: 'Evening',
  dusk: 'Dusk',
  night: 'Night',
};

/**
 * Map an hour (0-23) to a time period.
 */
export function getTimePeriod(hour: number): TimePeriod {
  if (hour >= 5 && hour < 7) return 'dawn';
  if (hour >= 7 && hour < 11) return 'morning';
  if (hour >= 11 && hour < 14) return 'midday';
  if (hour >= 14 && hour < 17) return 'afternoon';
  if (hour >= 17 && hour < 20) return 'evening';
  if (hour >= 20 && hour < 21) return 'dusk';
  return 'night';
}

/**
 * Format a Date to a 12-hour time string (e.g. "7:42 PM").
 */
function formatTime12h(date: Date): string {
  let h = date.getHours();
  const m = date.getMinutes();
  const ampm = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  const mm = m < 10 ? '0' + m : String(m);
  return `${h}:${mm} ${ampm}`;
}

/**
 * Compute full TimeInfo from the current local clock.
 * Safe to call every frame (low cost).
 */
export function computeTimeInfo(): TimeInfo {
  const now = new Date();
  const hour = now.getHours();
  const minutes = now.getMinutes();
  const period = getTimePeriod(hour);
  const periodLabel = PERIOD_LABELS[period];
  const formattedTime = formatTime12h(now);
  const dayPhase = (hour + minutes / 60) / 24;

  return {
    period,
    periodLabel,
    formattedTime,
    display: `${periodLabel} – ${formattedTime}`,
    hour,
    dayPhase,
  };
}
