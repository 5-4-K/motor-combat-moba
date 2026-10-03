/**
 * The one non-default `StateView` tag (NR42, Phase G). A field declared `@view(VIEW_OWNER)` reaches a
 * client only when that client's view added the object with this tag — its own car, and in G3 a
 * teammate's. Plain `@view()` fields use the library's default tag and reach every view that holds
 * the object at all. Never renumber: it is a bit in the encoder's per-view tag mask.
 */
export const VIEW_OWNER = 1;
