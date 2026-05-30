import express from 'express';
import pkg from 'stremio-addon-sdk';
const { addonBuilder } = pkg;
import { resolveMultiResults, resolveMovieByTmdbId } from '../search.js';
import { scrapeMovieStreams } from '../extractor.js';
import { fetchJson } from '../http.js';
import dotenv from 'dotenv';

dotenv.config();

const TMDB_API_KEY = "1865f43a0549ca50d341dd9ab8b29f49";

// Define addon manifest configuration
const manifest = {
    id: "community.moviesda",
    version: "1.0.0",
    name: "Moviesda Tamil Movies",
    description: "Stream Tamil and Tamil Dubbed movies directly in Stremio. Deployed Serverless on Vercel.",
    resources: ["catalog", "stream"],
    types: ["movie"],
    catalogs: [
        {
            type: "movie",
            id: "moviesda-search",
            name: "Moviesda Search",
            extra: [{ name: "search", isRequired: true }]
        }
    ],
    background: "https://images.unsplash.com/photo-1594909122845-11baa439b7bf?q=80&w=1200",
    logo: "https://images.unsplash.com/photo-1594909122845-11baa439b7bf?q=80&w=256"
};

const builder = new addonBuilder(manifest);

/**
 * Catalog Handler: Handles search queries inside Stremio
 */
builder.defineCatalogHandler(async (args) => {
    const { type, id, extra } = args;
    console.log(`[Addon Vercel] Catalog request - type: ${type}, id: ${id}, extra:`, extra);

    if (type === 'movie' && id === 'moviesda-search' && extra && extra.search) {
        try {
            console.log(`[Addon Vercel] Performing catalog search for: "${extra.search}"`);
            const results = await resolveMultiResults(extra.search);
            
            const metas = results.map(result => ({
                id: `moviesda_tmdb:${result.id}`,
                type: 'movie',
                name: `${result.title} (${result.year})`,
                poster: result.poster || 'https://images.unsplash.com/photo-1594909122845-11baa439b7bf?q=80&w=300',
                description: result.overview || `Moviesda Tamil Movie from ${result.year}. Rating: ${result.rating}`,
                releaseInfo: result.year
            }));
            
            console.log(`[Addon Vercel] Returned ${metas.length} search results to Stremio`);
            return { metas };
        } catch (err) {
            console.error('[Addon Vercel] Catalog handler error:', err);
            return { metas: [] };
        }
    }

    return { metas: [] };
});

/**
 * Stream Handler: Resolves movie IDs into direct playable stream links
 */
builder.defineStreamHandler(async (args) => {
    const { type, id } = args;
    console.log(`[Addon Vercel] Stream request - type: ${type}, id: ${id}`);

    if (type !== 'movie') {
        return { streams: [] };
    }

    let tmdbId = null;
    
    try {
        // Step 1: Resolve TMDB ID based on incoming ID type
        if (id.startsWith('moviesda_tmdb:')) {
            tmdbId = id.split(':')[1];
            console.log(`[Addon Vercel] Processing custom catalog TMDB ID: ${tmdbId}`);
        } else if (id.startsWith('tt')) {
            // Global Stremio catalog request using IMDb ID (tt...)
            console.log(`[Addon Vercel] Processing global IMDb ID ${id}. Querying TMDB Find API...`);
            const findUrl = `https://api.themoviedb.org/3/find/${id}?api_key=${TMDB_API_KEY}&external_source=imdb_id`;
            const findData = await fetchJson(findUrl);
            
            if (findData && findData.movie_results && findData.movie_results.length > 0) {
                tmdbId = findData.movie_results[0].id;
                console.log(`[Addon Vercel] Successfully mapped IMDb ${id} ➔ TMDB ID ${tmdbId}`);
            } else {
                console.warn(`[Addon Vercel] No TMDB mapping found for IMDb ID ${id}`);
            }
        }

        if (!tmdbId) {
            console.warn(`[Addon Vercel] No valid TMDB ID resolved. Cannot find streams.`);
            return { streams: [] };
        }

        // Step 2: Resolve Moviesda Page URL & Metadata
        console.log(`[Addon Vercel] Resolving Moviesda page URL for TMDB ID: ${tmdbId}`);
        const resolved = await resolveMovieByTmdbId(tmdbId);
        
        if (!resolved || !resolved.url) {
            console.warn(`[Addon Vercel] Movie not found on Moviesda index for TMDB ID ${tmdbId}`);
            return { streams: [] };
        }

        const moviePageUrl = resolved.url;
        const movieTitle = resolved.metadata.title;
        console.log(`[Addon Vercel] Found page URL on Moviesda: ${moviePageUrl} (Title: ${movieTitle})`);

        // Step 3: Scrape Stream URLs from the page
        const allStreams = await scrapeMovieStreams(moviePageUrl, movieTitle);
        console.log(`[Addon Vercel] Scraped ${allStreams.length} raw streams from Moviesda`);

        // Helper to parse size string to MB for comparison
        function parseSizeToMB(sizeStr) {
            if (!sizeStr) return 0;
            const match = sizeStr.match(/([\d.]+)\s*(GB|MB)/i);
            if (!match) return 0;
            const value = parseFloat(match[1]);
            const unit = match[2].toUpperCase();
            if (unit === 'GB') return value * 1024;
            return value;
        }

        // Step 4: Apply filters (exclude files < 50MB)
        const filteredStreams = allStreams.filter(stream => {
            const sizeMB = parseSizeToMB(stream.size);
            // If size is resolved, exclude anything less than 50 MB
            if (stream.size !== "Unknown Size" && sizeMB < 50) {
                console.log(`[Addon Vercel] Excluding small stream: "${stream.title}" (${stream.size})`);
                return false;
            }
            return true;
        });

        // Step 5: Sort streams by quality rank and size descending
        const QUALITY_ORDER = ["1080p", "720p", "480p", "360p", "HD"];
        
        function getQualityRank(quality) {
            const q = (quality || "").toLowerCase();
            if (q.includes("1080")) return 0;
            if (q.includes("720")) return 1;
            if (q.includes("480")) return 2;
            if (q.includes("360")) return 3;
            return 4; // HD / default fallback
        }

        filteredStreams.sort((a, b) => {
            const rankA = getQualityRank(a.quality);
            const rankB = getQualityRank(b.quality);
            
            if (rankA !== rankB) {
                return rankA - rankB; // Lower rank (better quality) comes first
            }
            
            // If same quality, sort by file size descending
            const sizeA = parseSizeToMB(a.size);
            const sizeB = parseSizeToMB(b.size);
            return sizeB - sizeA;
        });

        // Step 6: Map to Stremio Stream objects
        const stremioStreams = filteredStreams.map((stream, index) => {
            const isHighQuality = stream.quality === "1080p" || stream.quality === "720p";
            const emoji = isHighQuality ? "⭐" : "⚡";
            return {
                url: stream.url,
                name: `Moviesda\n${emoji} ${stream.quality}`,
                title: `🎥 ${movieTitle}\n💾 Size: ${stream.size}\n🔗 Server #${index + 1} (${stream.quality})`,
                behaviorHints: {
                    notWebReady: false,
                    headers: stream.headers
                }
            };
        });

        console.log(`[Addon Vercel] Returning ${stremioStreams.length} sorted, playable streams to Stremio`);
        return { streams: stremioStreams };

    } catch (err) {
        console.error('[Addon Vercel] Stream handler error:', err);
        return { streams: [] };
    }
});

// Expose Express application mounting the Stremio Addon router
const app = express();
const addonInterface = builder.getInterface();
const router = addonInterface.getRouter();

// Path normalizer: strips "/api/addon" prefix so that Stremio SDK router can match the endpoints perfectly
app.use((req, res, next) => {
    console.log(`[Addon Vercel] Pre-normalized URL: ${req.url}`);
    if (req.url.startsWith('/api/addon')) {
        req.url = req.url.substring('/api/addon'.length);
        if (!req.url.startsWith('/')) {
            req.url = '/' + req.url;
        }
    }
    console.log(`[Addon Vercel] Normalized URL: ${req.url}`);
    next();
});

app.use('/', router);

export default app;
