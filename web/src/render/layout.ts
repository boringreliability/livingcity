/**
 * Screen-space layout of the overlays the fitted city must stay clear of (CSS px):
 * the control panel sits in the top band, the metrics strip in the bottom band.
 */
export interface Insets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

// Vertically symmetric, so the fitted city's centre stays at the canvas centre (a zoom at the
// canvas centre lands on the Main Bridge, as the inspection tests and users expect).
export const FIT_INSETS: Insets = { top: 120, right: 24, bottom: 120, left: 24 };

/** Per half while comparing: the comparison panel sits above the timeline bar (ward timeline-004). */
export const COMPARE_FIT_INSETS: Insets = { top: 120, right: 16, bottom: 230, left: 16 };
