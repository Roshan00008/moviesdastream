/**
 * In-memory callback store to work around Telegram's 64-byte callback_data limit.
 * Stores large payloads server-side, referenced by a short auto-increment ID.
 * 
 * Max store size is capped at 500 entries to prevent memory leaks on long-running bots.
 */

const store = new Map();
let counter = 0;
const MAX_ENTRIES = 500;

/**
 * Save a payload and return a short string ID (e.g. "0", "1a", "2b").
 * @param {object} payload
 * @returns {string} shortId
 */
export function savePayload(payload) {
    // Evict oldest entry if at capacity
    if (store.size >= MAX_ENTRIES) {
        const oldestKey = store.keys().next().value;
        store.delete(oldestKey);
    }
    const id = (counter++).toString(36); // base-36: compact & safe
    store.set(id, payload);
    return id;
}

/**
 * Retrieve payload by ID.
 * @param {string} id
 * @returns {object|null}
 */
export function getPayload(id) {
    return store.get(id) || null;
}
