/**
 * The feedback form: where the join screen's "Send feedback" button points, and what it says.
 *
 * Unlike the manual — which is generated into `public/` so it works with no route to the internet —
 * this is an absolute URL to a Google Form, so the button only reaches anything on a machine that
 * has internet. That is deliberate: the LAN zip still plays offline, and the button simply fails to
 * load a page for a player who has no connection, rather than the game depending on one.
 *
 * It opens in a new tab rather than navigating, for the same reason the manual does: a player
 * filling in the form mid-lobby should not lose their room.
 */
export const FEEDBACK_URL =
  "https://docs.google.com/forms/d/e/1FAIpQLScfQPCtci5QlAzSfnCPlyl__pvxX-bTi7b_ocGTT4Bw-cWYYg/viewform?usp=dialog";

/** Says what the button does — this door leads off the machine, so it names the action. */
export const FEEDBACK_LABEL = "Send feedback";
