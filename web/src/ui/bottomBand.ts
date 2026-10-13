/**
 * The bottom band (ward fonts-001): the legend sits beside the metrics only when they fit, measured
 * from the panels themselves (any font, any text width), not from the window width. Both stay
 * horizontally anchored (metrics left, legend right) in either placement, so the gap between them
 * reads the same whether the legend is stacked or not.
 */
const STACK_BELOW_GAP_PX = 12;

/**
 * The placement from the measured horizontal gap (legend left − metrics right) alone. Stacking moves the
 * legend only vertically, so it does not change the gap: there is no feedback to damp, and a hysteresis
 * band would leave the legend stacked over the city wherever a transient (a fallback font, a wider value)
 * once stacked it and the settled gap lies inside the band (motion-005 Gold r2: ~19 px on Linux CI).
 */
export function nextStacked(gapPx: number): boolean {
  return gapPx < STACK_BELOW_GAP_PX;
}
