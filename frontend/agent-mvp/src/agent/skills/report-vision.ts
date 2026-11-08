import type { Locale } from '../types';

/**
 * Turn a photo of a public problem into an editable citizen-report draft (有話要說).
 *
 * The multimodal model only looks at the photo and returns a subject and a description of
 * what is visibly wrong; the output is validated here before anything is shown, and is always
 * presented for the person to check and edit (like the rule-based `report-draft.ts`). The model
 * is told to describe only what is visible and to invent nothing — no location, time, names or
 * plate numbers — so the draft never claims more than the photo shows.
 *
 * Prompts are English on purpose (internal), with the output language set explicitly.
 */
export type ReportVision = { subject: string; description: string };

/** Only small, re-encoded photos reach the model; keep the data URL and reply bounded. */
export const VISION_IMAGE = {
  pattern: /^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/,
  maxDataUrlLength: 2_000_000,
} as const;

const SUBJECT_MAX = 40;
const DESCRIPTION_MAX = 300;

const LANGUAGE: Record<Locale, string> = {
  'zh-Hant-TW': 'Traditional Chinese (Taiwan)',
  en: 'English',
};

export function visionSystemPrompt(locale: Locale): string {
  return [
    'You help a Taipei resident file a citizen report (臺北市民當家熱線 1999 / 有話要說) about a public problem.',
    'Look ONLY at the attached photo. Identify a reportable public issue if one is clearly visible,',
    'for example a pothole, broken or unlit streetlight, fallen tree or branch, damaged sidewalk or',
    'road sign, illegal parking, dumped garbage, blocked drain, graffiti or a broken public facility.',
    'Describe only what is actually visible. Do NOT guess or invent a location, address, date, time,',
    'names, or vehicle plate numbers, and do NOT read or transcribe faces or private details.',
    'If the photo shows no clear public problem, or you are unsure, return empty strings for both fields.',
    `Write both fields in ${LANGUAGE[locale]}.`,
    'Be brief and direct: describe the main visible issue in one short sentence, without introductions or repetition.',
    'Return ONLY JSON of the form {"subject": string, "description": string}.',
    `"subject" is a short case title (<= ${SUBJECT_MAX} characters). "description" states plainly what is`,
    `visible and what seems wrong (<= ${DESCRIPTION_MAX} characters), with no location unless a readable`,
    'sign in the photo names one.',
  ].join(' ');
}

export function visionInstruction(locale: Locale): string {
  return locale === 'zh-Hant-TW'
    ? '看這張照片，整理成陳情草稿。只描述照片裡看得到的問題，不要猜測地點或時間。回傳 JSON {"subject","description"}。'
    : 'Look at this photo and draft a citizen report. Describe only the visible problem; do not guess location or time. Return JSON {"subject","description"}.';
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Collapse whitespace so a model newline/indentation burst cannot pad past the caps. */
function tidy(value: string, max: number): string {
  return value.replace(/\s+/g, ' ').trim().slice(0, max);
}

/**
 * Parse and validate the model's reply. Returns null when the model found nothing reportable or
 * the reply is not usable, so the UI can tell the person to describe it themselves.
 */
export function parseReportVision(raw: string): ReportVision | null {
  if (typeof raw !== 'string' || raw.length > 20_000) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!record(parsed)) return null;
  if (typeof parsed.subject !== 'string' || typeof parsed.description !== 'string') return null;
  const subject = tidy(parsed.subject, SUBJECT_MAX);
  const description = tidy(parsed.description, DESCRIPTION_MAX);
  // Nothing recognized: do not show an empty or title-only draft as if it were a finding.
  if (!subject || !description) return null;
  return { subject, description };
}
