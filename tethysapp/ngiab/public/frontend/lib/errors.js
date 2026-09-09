import { GENERIC_MESSAGE as FALLBACK } from '../api/client.js';

export function userMessage(error) {
  return error?.userMessage ?? FALLBACK;
}
