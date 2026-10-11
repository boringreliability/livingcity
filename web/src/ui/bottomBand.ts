/**
 * The bottom band (ward fonts-001): the legend sits beside the metrics only when they fit, measured
 * from the panels themselves (any font, any text width), not from the window width. Both stay
 * horizontally anchored (metrics left, legend right) in either placement, so the gap between them
 * reads the same whether the legend is stacked or not.
 */
const STACK_BELOW_GAP_PX = 12;
/** Unstack only with clearly more room than that: no flipping back and forth at the border. */
const UNSTACK_ABOVE_GAP_PX = 24;

/** The next placement from the current one and the measured horizontal gap (legend left − metrics right). */
export function nextStacked(stacked: boolean, gapPx: number): boolean {
  return stacked ? gapPx < UNSTACK_ABOVE_GAP_PX : gapPx < STACK_BELOW_GAP_PX;
}
