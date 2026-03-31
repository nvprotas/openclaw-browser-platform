import type { ActionObservationSummary } from '../daemon/types.js';
import type { PageStateSummary } from '../playwright/browser-session.js';
import { buildActionDiff, summarizeObservation } from './tracing.js';

export function buildPostActionObservations(before: PageStateSummary, after: PageStateSummary): ActionObservationSummary[] {
  const observations = summarizeObservation(after);
  const diff = buildActionDiff(before, after);

  if (diff.urlChanged) {
    observations.push({ level: 'info', code: 'URL_CHANGED', message: `URL changed to ${after.url}` });
  }

  if (diff.titleChanged) {
    observations.push({ level: 'info', code: 'TITLE_CHANGED', message: `Title changed to ${after.title}` });
  }

  if (!diff.urlChanged && !diff.titleChanged && !diff.pageSignatureChanged && diff.addedButtons.length === 0 && diff.addedTexts.length === 0) {
    observations.push({ level: 'warning', code: 'NO_OBVIOUS_CHANGE', message: 'No obvious page change was detected after the action.' });
  }

  return observations;
}
