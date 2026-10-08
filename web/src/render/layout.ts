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

export const FIT_INSETS: Insets = { top: 140, right: 24, bottom: 96, left: 24 };
