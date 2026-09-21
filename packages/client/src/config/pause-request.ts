/**
 * How long a pause request may stay in flight before the client gives up waiting for it (spec TR54).
 *
 * Practice and the playground pause on the SERVER: P sends a toggle, and the menu mounts only once
 * `state.paused` patches back true. While that round trip is open a second P is ignored, or the
 * server would pause and unpause inside one patch interval and the client — never seeing `paused`
 * go true — would wait forever for a patch that is not coming, blocking every relock. This is the
 * backstop for the case the patch really never arrives (a refused or dropped request): past it the
 * request is treated as gone and P works again. Milliseconds, comfortably above a LAN or an online
 * round trip plus one patch interval.
 */
export const PAUSE_REQUEST_TIMEOUT_MS = 1000;
