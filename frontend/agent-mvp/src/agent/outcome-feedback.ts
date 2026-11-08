import type { FeedbackKind } from '../platform/feedback';
import type { TaskState } from './types';

/**
 * What a request that just ended feels like, so people can tell without looking: clear good news,
 * bad news and urgent help get a haptic. Everything else stays quiet, because neither a success
 * nor an error buzz would be true: the assistant asking something back (location, bill type),
 * "no results", "not supported", a stop the user asked for, and states that are not the end of
 * a request at all.
 */
const byNotice: Record<TaskState['notice'], FeedbackKind | null> = {
  // An answer the person can use, or a verified place to go.
  results: 'success',
  books: 'success',
  bills: 'success',
  navigate: 'success',
  profile: 'success',
  receipt: 'success',
  // The lookup did not happen; a retry is offered.
  error: 'error',
  billUnavailable: 'error',
  billAuth: 'error',
  // The emergency card is on screen.
  emergency: 'warning',
  // Questions back to the person (the choices follow), and answers with nothing to act on.
  billCategory: null,
  needLocation: null,
  empty: null,
  billsEmpty: null,
  unsupported: null,
  billUnsupported: null,
  // Not the end of a request.
  welcome: null,
  greeting: null,
  capabilities: null,
  navigationDeclined: null,
  review: null,
  cancelled: null,
};

/** The haptic for the answer state a request ended in, or null for none. */
export function outcomeFeedback(notice: TaskState['notice']): FeedbackKind | null {
  return byNotice[notice] ?? null;
}
