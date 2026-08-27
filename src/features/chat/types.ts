/**
 * The one chat concept that is NOT the server's.
 *
 * Everything else — messages, conversations, attachments — now comes from
 * `@/api/types`, transcribed from the backend's DTOs. This file used to mirror
 * them while the screen ran on fixtures; keeping a second copy after the API
 * arrived would only invite the two to drift.
 */

/**
 * Delivery state, which exists on the phone and nowhere else.
 *
 * The server has no such notion: a message either reached it or did not. But a
 * courier writes messages in lifts and loading bays, so the UI has to show the
 * difference between "gone" and "still in my pocket" — otherwise they retype it
 * and dispatch reads it twice.
 */
export type DeliveryState = 'sending' | 'sent' | 'failed';
