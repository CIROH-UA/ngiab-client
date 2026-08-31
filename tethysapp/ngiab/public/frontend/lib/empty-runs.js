/**
 * What to tell someone when the storage root holds no runs.
 *
 * Two panels answer that question at once -- the run picker's status line and the card over
 * the map -- and they used to carry separate copies of the sentence. Adding the upload route
 * to one of them left the other telling the viewer to copy a directory instead.
 *
 * Pure, so it takes the answer rather than reading config itself.
 */
export function noRunsMessage(canUpload) {
  // Written out rather than composed from a shared fragment: the first attempt shared the
  // clause and produced "once someone copy a run directory ... and it will appear here".
  return canUpload
    ? 'No model runs yet. Upload a run archive with the control under the run picker, or '
      + 'copy a run directory into the visualizer’s storage.'
    : 'No model runs yet. One appears here once a run directory is copied into the '
      + 'visualizer’s storage.';
}
