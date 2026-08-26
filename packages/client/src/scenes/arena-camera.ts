/**
 * Whether the camera has to move at all.
 *
 * `ARENA_01` is authored to be exactly the size of the view, so the whole match is on screen and
 * following a car would only jitter a picture that is already complete. Arenas larger than the view
 * still need the follow camera, so this is a question the scene asks rather than a flag it is told:
 * add a bigger arena and the follow behaviour comes back on its own.
 */
export interface Size {
  readonly width: number;
  readonly height: number;
}

/**
 * How much world a camera covers. Zoom scales what is drawn, so zooming out covers proportionally
 * more world in the same pixels — the reason `fitsViewport` takes zoom rather than assuming 1.
 */
export function viewportWorldSize(view: Size, zoom: number): Size {
  return { width: view.width / zoom, height: view.height / zoom };
}

/** Whether the arena is entirely inside the camera, so the camera never needs to scroll. */
export function fitsViewport(arena: Size, view: Size, zoom: number): boolean {
  const world = viewportWorldSize(view, zoom);
  return arena.width <= world.width && arena.height <= world.height;
}
