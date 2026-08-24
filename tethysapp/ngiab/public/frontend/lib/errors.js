const FALLBACK = 'Something went wrong. Please try again.';

export function userMessage(error) {
  return error?.userMessage ?? FALLBACK;
}
