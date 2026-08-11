// What a panel is allowed to show when a request fails.

const FALLBACK = 'Something went wrong. Please try again.';

// ApiError carries a userMessage; anything else reaching here is a programming fault, and its
// text is for the console, not the panel.
export function userMessage(error) {
  return error?.userMessage ?? FALLBACK;
}
