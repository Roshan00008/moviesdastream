import * as cheerio from 'cheerio';
import { fetchText, fetchJson } from './http.js';

const TMDB_API_KEY = "1865f43a0549ca50d341dd9ab8b29f49";
const BASE_URL = "https://moviesda30.com";

const SUPPORTED_CATEGORY_YEARS = ["2026", "2025", "2024", "2023", "2022", "2021", "2020", "2019", "2018", "2017", "2016", "2015", "2012"];

/**
 * Normalizes title strings for reliable comparison
 */
function cleanTitle(title) {
    if (!title) return "";
    return title.toLowerCase()
        .replace(/[^a-z0-9]/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}

/**
 * Checks if a href is a specific movie/series page (not a category or nav page)
 */
function isMoviePage(href) {
    if (!href) return false;
    if (href === '/' || href === '#') return false;
    // Must be a slug path (single segment, not a category index)
    if (href.includes('-movies/') || href.includes('-series/') || href.includes('collection') || href.includes('isaidub') || href.includes('request')) return false;
    // Must have more than one path segment of content
    const slug = href.split('/').filter(Boolean);
    if (slug.length !== 1) return false;
    return true;
}

/**
 * Method 1: Scan Year Category Index Pages (for recent years)
 */
async function findMovieByYearCategory(title, year) {
    if (!year || !SUPPORTED_CATEGORY_YEARS.includes(year.toString())) {
        return null;
    }
    
    const categoryUrl = `${BASE_URL}/tamil-${year}-movies/`;
    console.log(`[Search] Scanning category index: ${categoryUrl}`);
    
    const cleanedSearchTitle = cleanTitle(title);
    
    for (let pageNum = 1; pageNum <= 5; pageNum++) {
        try {
            const url = pageNum === 1 ? categoryUrl : `${categoryUrl}?page=${pageNum}`;
            const html = await fetchText(url);
            const $ = cheerio.load(html);
            
            let matchedHref = null;
            
            $('div.f a, div.folder a').each((_, el) => {
                if (matchedHref) return;
                
                const href = $(el).attr('href');
                const text = $(el).text().trim();
                
                if (!isMoviePage(href)) return;

                const cleanedEntryTitle = cleanTitle(text.split('(')[0]);
                
                if (cleanedEntryTitle === cleanedSearchTitle || 
                    cleanedEntryTitle.includes(cleanedSearchTitle) || 
                    cleanedSearchTitle.includes(cleanedEntryTitle)) {
                    matchedHref = href;
                }
            });
            
            if (matchedHref) {
                console.log(`[Search] Year category match: ${matchedHref}`);
                return matchedHref;
            }

            // If the page has fewer than 5 entries, we've hit the last page
            const count = $('div.f a, div.folder a').length;
            if (count < 5) break;
        } catch (e) {
            break;
        }
    }
    
    return null;
}

/**
 * Method 2: Scan A-Z Alphabetical Index Pages (reliable for older movies)
 * Scans up to 5 pages
 */
async function findMovieByAZIndex(title, year) {
    const cleanedSearchTitle = cleanTitle(title);
    let firstChar = cleanedSearchTitle.charAt(0);
    
    let letter = 'a';
    if (/[a-z]/.test(firstChar)) {
        letter = firstChar;
    } else {
        letter = '0-9'; 
    }
    
    const azUrl = `${BASE_URL}/tamil-movies/${letter}/`;
    console.log(`[Search] Scanning A-Z Index for letter (${letter.toUpperCase()}): ${azUrl}`);
    
    for (let pageNum = 1; pageNum <= 5; pageNum++) {
        try {
            const url = pageNum === 1 ? azUrl : `${azUrl}?page=${pageNum}`;
            const html = await fetchText(url);
            const $ = cheerio.load(html);
            
            let matchedHref = null;
            
            $('div.f a, div.folder a').each((_, el) => {
                if (matchedHref) return;
                
                const href = $(el).attr('href');
                const text = $(el).text().trim();
                
                if (!isMoviePage(href)) return;

                const yearMatch = text.match(/\((\d{4})\)/);
                const entryYear = yearMatch ? yearMatch[1] : null;
                
                if (entryYear && year && entryYear.toString() !== year.toString()) {
                    return; // Year mismatch
                }

                const cleanedEntryTitle = cleanTitle(text.split('(')[0]);
                
                if (cleanedEntryTitle === cleanedSearchTitle || 
                    cleanedEntryTitle.includes(cleanedSearchTitle) || 
                    cleanedSearchTitle.includes(cleanedEntryTitle)) {
                    matchedHref = href;
                }
            });
            
            if (matchedHref) {
                console.log(`[Search] A-Z match: ${matchedHref}`);
                return matchedHref;
            }

            const count = $('div.f a, div.folder a').length;
            if (count < 5) break;
        } catch (e) {
            break;
        }
    }
    
    return null;
}

/**
 * Method 3: Google HTML search with site: operator (most reliable fallback)
 * Searches "title year site:moviesda30.com" via Google's public HTML interface
 */
async function searchMovieGoogle(title, year) {
    const query = `"${title}" ${year || ''} site:moviesda30.com`.trim();
    // Use multiple search engines for resilience
    const engines = [
        `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`,
        `https://www.google.com/search?q=${encodeURIComponent(query)}&num=5`
    ];

    const cleanedSearchTitle = cleanTitle(title);

    for (const searchUrl of engines) {
        try {
            console.log(`[Search] Site-search: ${searchUrl}`);
            const html = await fetchText(searchUrl);
            const $ = cheerio.load(html);
            
            let matchedHref = null;

            // Parse all links looking for moviesda30.com movie slugs
            $('a').each((_, el) => {
                if (matchedHref) return;
                const rawHref = $(el).attr('href') || '';
                
                // DuckDuckGo wraps the URL in a redirect param
                let destUrl = rawHref;
                const uddgMatch = rawHref.match(/uddg=(.*?)(?:&|$)/);
                if (uddgMatch) {
                    destUrl = decodeURIComponent(uddgMatch[1]);
                }
                // Google wraps in /url?q=
                const gMatch = rawHref.match(/\/url\?q=(.*?)(?:&|$)/);
                if (gMatch) {
                    destUrl = decodeURIComponent(gMatch[1]);
                }

                if (!destUrl.includes('moviesda30.com')) return;
                
                // Extract slug
                try {
                    const urlObj = new URL(destUrl.startsWith('http') ? destUrl : `https://moviesda30.com${destUrl}`);
                    const slug = urlObj.pathname.split('/').filter(Boolean)[0];
                    if (!slug) return;

                    // Must look like a movie page slug (contains year)
                    if (!slug.includes('-') ) return;
                    
                    const yearMatch = slug.match(/-(\d{4})/);
                    const entryYear = yearMatch ? yearMatch[1] : null;
                    
                    if (entryYear && year && entryYear !== year.toString()) return;

                    const cleanedSlug = cleanTitle(slug.replace(/-\d{4}.*/g, '').replace(/-/g, ' '));
                    
                    if (cleanedSlug.includes(cleanedSearchTitle) || cleanedSearchTitle.includes(cleanedSlug)) {
                        matchedHref = `/${slug}/`;
                    }
                } catch (e) {}
            });
            
            if (matchedHref) {
                console.log(`[Search] Site-search match: ${matchedHref}`);
                return matchedHref;
            }
        } catch (e) {
            console.error(`[Search] Site-search failed (${searchUrl}): ${e.message}`);
        }
    }
    
    return null;
}

/**
 * Method 4: Direct URL slug construction (fastest - works when title is exact)
 * Constructs probable Moviesda slugs from title+year and tests them
 */
async function findMovieBySlugConstruction(title, year) {
    if (!title || !year) return null;
    
    // Build candidate slugs
    const clean = title.toLowerCase()
        .replace(/[^a-z0-9\s]/g, '')
        .replace(/\s+/g, '-')
        .replace(/-+/g, '-')
        .trim()
        .replace(/^-|-$/g, '');

    const candidates = [
        `/${clean}-${year}-tamil-movie/`,
        `/${clean}-${year}-tamil-dubbed-movie/`,
        `/${clean}-${year}-tamil-hd-movie/`,
    ];

    for (const slug of candidates) {
        try {
            const url = `${BASE_URL}${slug}`;
            const html = await fetchText(url);
            const $ = cheerio.load(html);
            const pageTitle = $('title').text().toLowerCase();
            
            // Confirm this is a real movie page by checking title
            if (pageTitle.includes(clean.replace(/-/g, ' ')) && !pageTitle.includes('moviesda download moviesda movies')) {
                console.log(`[Search] Direct slug match: ${slug}`);
                return slug;
            }
        } catch (e) {
            // Not found, try next
        }
    }
    
    return null;
}

/**
 * Master search: runs all methods in priority order
 */
async function findMovieUrl(title, year) {
    // Priority 1: Direct slug construction (instant)
    let url = await findMovieBySlugConstruction(title, year);
    if (url) return url;

    // Priority 2: Year category scan
    url = await findMovieByYearCategory(title, year);
    if (url) return url;

    // Priority 3: A-Z Index scan
    url = await findMovieByAZIndex(title, year);
    if (url) return url;

    // Priority 4: Google/DDG site: search
    url = await searchMovieGoogle(title, year);
    if (url) return url;

    return null;
}

/**
 * Primary Movie Resolution Routine for Telegram Bot
 */
export async function resolveMoviePage(queryText) {
    try {
        console.log(`[Search] Resolving query: "${queryText}"`);
        
        const searchUrl = `https://api.themoviedb.org/3/search/movie?api_key=${TMDB_API_KEY}&query=${encodeURIComponent(queryText)}`;
        const searchData = await fetchJson(searchUrl);
        
        let title = queryText;
        let releaseYear = null;
        let metadata = {
            title: queryText,
            year: "Unknown",
            overview: "No synopsis available.",
            poster: null,
            rating: "N/A"
        };

        if (searchData.results && searchData.results.length > 0) {
            const firstResult = searchData.results[0];
            title = firstResult.title || firstResult.original_title;
            releaseYear = firstResult.release_date ? firstResult.release_date.split('-')[0] : null;
            
            metadata = {
                title: title,
                year: releaseYear || "Unknown",
                overview: firstResult.overview || "No synopsis available.",
                poster: firstResult.poster_path ? `https://image.tmdb.org/t/p/w500${firstResult.poster_path}` : null,
                rating: firstResult.vote_average ? `${firstResult.vote_average.toFixed(1)}/10` : "N/A"
            };
            console.log(`[Search] Resolved TMDB: "${title}" (${releaseYear})`);
        } else {
            console.warn(`[Search] No TMDB results for "${queryText}". Proceeding with raw query.`);
        }

        const moviePageUrl = await findMovieUrl(title, releaseYear);

        return { url: moviePageUrl, metadata };
    } catch (e) {
        console.error(`[Search] Resolution failed: ${e.message}`);
        return {
            url: null,
            metadata: { title: queryText, year: "Unknown", overview: "Search failed.", poster: null, rating: "N/A" }
        };
    }
}

/**
 * Resolves the top 5 movie matches from TMDB to present options to the user
 */
export async function resolveMultiResults(queryText) {
    try {
        console.log(`[Search] Resolving multi-results for: "${queryText}"`);
        const searchUrl = `https://api.themoviedb.org/3/search/movie?api_key=${TMDB_API_KEY}&query=${encodeURIComponent(queryText)}`;
        const searchData = await fetchJson(searchUrl);
        
        if (!searchData.results || searchData.results.length === 0) return [];
        
        return searchData.results.slice(0, 5).map(result => ({
            id: result.id,
            title: result.title || result.original_title,
            year: result.release_date ? result.release_date.split('-')[0] : "Unknown",
            rating: result.vote_average ? `${result.vote_average.toFixed(1)}/10` : "N/A",
            overview: result.overview || ""
        }));
    } catch (e) {
        console.error(`[Search] Failed to fetch multi-results: ${e.message}`);
        return [];
    }
}

/**
 * Resolves detailed TMDB metadata and matches it on Moviesda by TMDB ID
 */
export async function resolveMovieByTmdbId(tmdbId) {
    try {
        console.log(`[Search] Resolving movie details for TMDB ID: ${tmdbId}`);
        const detailUrl = `https://api.themoviedb.org/3/movie/${tmdbId}?api_key=${TMDB_API_KEY}`;
        const movie = await fetchJson(detailUrl);
        
        const title = movie.title || movie.original_title;
        const releaseYear = movie.release_date ? movie.release_date.split('-')[0] : null;
        
        const metadata = {
            title: title,
            year: releaseYear || "Unknown",
            overview: movie.overview || "No synopsis available.",
            poster: movie.poster_path ? `https://image.tmdb.org/t/p/w500${movie.poster_path}` : null,
            rating: movie.vote_average ? `${movie.vote_average.toFixed(1)}/10` : "N/A"
        };
        
        console.log(`[Search] TMDB ID resolved: "${title}" (${releaseYear})`);
        
        const moviePageUrl = await findMovieUrl(title, releaseYear);
        
        return { url: moviePageUrl, metadata };
    } catch (e) {
        console.error(`[Search] Resolution by TMDB ID failed: ${e.message}`);
        return {
            url: null,
            metadata: { title: "Unknown Movie", year: "Unknown", overview: "Resolution failed.", poster: null, rating: "N/A" }
        };
    }
}

/**
 * Scrapes the latest movie/web series uploads from Moviesda homepage updates
 */
export async function scrapeLatestUpdates() {
    try {
        console.log(`[Search] Scraping latest updates page...`);
        const url = `${BASE_URL}/tamil-latest-updates/`;
        
        const html = await fetchText(url);
        const $ = cheerio.load(html);
        
        const updates = [];
        const els = $('div.f, div.folder, div.update');
        
        els.slice(0, 10).each((_, el) => {
            const rawText = $(el).text().trim();
            const href = $(el).find('a').attr('href');
            
            if (href) {
                let type = "Movie";
                if (rawText.toLowerCase().includes('web series')) type = "Web Series";
                
                const yearMatch = rawText.match(/\((\d{4})\)/);
                const year = yearMatch ? yearMatch[1] : new Date().getFullYear().toString();
                
                let cleanedTitle = rawText;
                for (const reg of [/\(\d{4}\).*/, /tamil movie.*/i, /tamil web series.*/i, /added download now.*/i]) {
                    const m = cleanedTitle.match(reg);
                    if (m) { cleanedTitle = cleanedTitle.split(m[0])[0].trim(); break; }
                }
                if (!cleanedTitle) cleanedTitle = rawText.substring(0, 47) + '...';
                
                updates.push({ rawText, title: cleanedTitle, year, type, url: href });
            }
        });
        
        return updates;
    } catch (e) {
        console.error(`[Search] Failed to scrape updates page: ${e.message}`);
        return [];
    }
}
