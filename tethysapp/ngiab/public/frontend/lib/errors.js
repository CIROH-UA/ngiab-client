// What a panel is allowed to show when a request fails.

const FALLBACK = 'Something went wrong. Please try again.';

// Anything without a userMessage is a programming fault; its text is not for the panel.
export function userMessage(error) {
  return error?.userMessage ?? FALLBACK;
}
