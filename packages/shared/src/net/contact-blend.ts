/**
 * How much of a remote's drawn pose is its dead-reckoned pose rather than its interpolated one
 * (NR34): 0 at `rangeCars` car lengths or more from the local car, 1 at one car length or less,
 * linear between. Far remotes stay on the interpolated path; a remote you can touch is drawn where
 * the local prediction will meet it, so a ram you land on screen is a ram the sim sees.
 */
export function contactBlendWeight(distance: number, carLength: number, rangeCars: number): number {
  const outer = rangeCars * carLength;
  if (distance <= carLength) return 1;
  if (distance >= outer) return 0;
  return (outer - distance) / (outer - carLength);
}
