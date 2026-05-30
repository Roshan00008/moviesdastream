/**
 * HTTP request utilities for Moviesda scraper.
 */

export const HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9"
};

/**
 * Fetch raw HTML/text from a URL
 * @param {string} url 
 * @param {object} options 
 */
export async function fetchText(url, options = {}) {
    const response = await fetch(url, {
        headers: {
            ...HEADERS,
            ...options.headers
        },
        ...options
    });

    if (!response.ok) {
        throw new Error(`HTTP Error ${response.status}: Failed to load ${url}`);
    }

    return await response.text();
}

/**
 * Fetch JSON from an API
 * @param {string} url 
 * @param {object} options 
 */
export async function fetchJson(url, options = {}) {
    const response = await fetch(url, {
        headers: {
            "Accept": "application/json",
            ...options.headers
        },
        ...options
    });

    if (!response.ok) {
        throw new Error(`API Error ${response.status}: Failed to fetch ${url}`);
    }

    return await response.json();
}

/**
 * Fetch HTTP headers using a HEAD request, falling back to a 1-byte GET Range request if needed
 * @param {string} url 
 * @param {object} options 
 */
export async function fetchHead(url, options = {}) {
    try {
        const response = await fetch(url, {
            method: "HEAD",
            headers: {
                ...HEADERS,
                ...options.headers
            },
            signal: AbortSignal.timeout(4000),
            ...options
        });
        if (response.ok) {
            return response.headers;
        }
    } catch (e) {
        // Fall through to GET with Range
    }

    // Fallback: GET with 1-byte Range to bypass HEAD blocks or method limitations
    const response = await fetch(url, {
        method: "GET",
        headers: {
            ...HEADERS,
            "Range": "bytes=0-0",
            ...options.headers
        },
        signal: AbortSignal.timeout(4000),
        ...options
    });
    return response.headers;
}

