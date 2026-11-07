import type { TaskState } from './types';

/**
 * Which answers are read aloud on their own when the person turned voice feedback on. They want to
 * hear how a request ended without pressing "read aloud", so that is every reply the assistant
 * gives: results, a failure, "nothing found", and the question it asks back when something is
 * missing (the choices are read with it). Not read: the start screen, which answers nothing; a
 * stop the person asked for; and states that are not the end of a request at all.
 */
const byNotice: Record<TaskState['notice'], boolean> = {
  // Something to use or a place to go.
  results: true,
  books: true,
  bills: true,
  navigate: true,
  profile: true,
  receipt: true,
  // The lookup did not happen.
  error: true,
  billUnavailable: true,
  billAuth: true,
  // The emergency card is on screen.
  emergency: true,
  // Questions back to the person, and answers with nothing to act on.
  billCategory: true,
  needLocation: true,
  empty: true,
  billsEmpty: true,
  unsupported: true,
  billUnsupported: true,
  greeting: true,
  // Nothing was answered, or not the end of a request.
  welcome: false,
  cancelled: false,
  navigationDeclined: false,
  review: false,
};

export type AutoReadConditions = {
  /** The voice feedback preference. */
  voiceFeedback: boolean;
  /** `a11yState.screenReader`: true is on, false is off, null or undefined is unknown. */
  screenReader: boolean | null | undefined;
  /** Whether this page can read aloud at all, i.e. the "read aloud" button is offered. */
  speechSupported: boolean;
};

/**
 * Whether a request that just ended should read its answer aloud. All of these must hold: voice
 * feedback is on, the device says no screen reader is running, reading aloud works here, and the
 * state the request ended in carries an answer. Only a known `false` counts as "off": an unknown
 * screen reader (`null`, `undefined`, or any browser) might be running, and talking over it would
 * make both unusable.
 */
export function shouldReadAnswerAloud(
  notice: TaskState['notice'],
  { voiceFeedback, screenReader, speechSupported }: AutoReadConditions,
): boolean {
  return voiceFeedback && screenReader === false && speechSupported && (byNotice[notice] ?? false);
}
