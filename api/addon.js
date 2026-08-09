import express from 'express';
import pkg from 'stremio-addon-sdk';
const { addonBuilder, getRouter } = pkg;
import { resolveMultiResults, resolveMovieByTmdbId, findTamilblastersUrl, findTamilyogiUrl, findProyatoMovie } from '../search.js';
import { scrapeMovieStreams, scrapeTamilblastersStreams, scrapeTamilyogiStreams, scrapeProyatoStreams } from '../extractor.js';
import { fetchJson } from '../http.js';
import dotenv from 'dotenv';

dotenv.config();

const TMDB_API_KEY = "1865f43a0549ca50d341dd9ab8b29f49";

// Define addon manifest configuration
const manifest = {
    id: "community.moviesda",
    version: "1.3.0",
    name: "Tamil Movies Stream",
    description: "Stream Tamil and Tamil Dubbed movies from Moviesda, Tamilblasters, Tamilyogi, and MultiMovies (Proyato API). Sources aggregated in parallel.",
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

// Simple in-memory cache to make repeated requests super fast on Vercel
const STREAM_CACHE = new Map();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes cache TTL

/**
 * Stream Handler: Resolves movie IDs into direct playable stream links
 */
builder.defineStreamHandler(async (args) => {
    const { type, id } = args;
    console.log(`[Addon Vercel] Stream request - type: ${type}, id: ${id}`);

    if (type !== 'movie') {
        return { streams: [] };
    }

    const cacheKey = `${manifest.version}:${id}`;
    // Check in-memory cache first for instant load
    const cached = STREAM_CACHE.get(cacheKey);
    if (cached && (Date.now() - cached.timestamp < CACHE_TTL_MS)) {
        console.log(`[Addon Vercel] ⚡ Returning cached streams for ${cacheKey} (Instant Cache Hit!)`);
        return { streams: cached.streams };
    }

    let tmdbId = null;

    try {
        // Step 1: Resolve TMDB ID based on incoming ID type
        if (id.startsWith('moviesda_tmdb:')) {
            tmdbId = id.split(':')[1];
            console.log(`[Addon Vercel] Processing custom catalog TMDB ID: ${tmdbId}`);
        } else if (id.startsWith('tt')) {
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

        // Step 2: Fetch TMDB metadata (title + year) for all site searches
        console.log(`[Addon Vercel] Fetching TMDB metadata for ID: ${tmdbId}`);
        const tmdbUrl = `https://api.themoviedb.org/3/movie/${tmdbId}?api_key=${TMDB_API_KEY}`;
        const tmdbData = await fetchJson(tmdbUrl);
        const movieTitle = tmdbData?.title || tmdbData?.original_title || 'Unknown';
        const movieYear = tmdbData?.release_date ? tmdbData.release_date.substring(0, 4) : null;
        console.log(`[Addon Vercel] TMDB metadata: "${movieTitle}" (${movieYear})`);

        // Step 3: Run all 4 site URL resolvers in parallel with absolute resilience
        console.log(`[Addon Vercel] Resolving URLs from all 4 sites in parallel...`);
        const [resolved, tbUrl, tyUrl, proyatoObj] = await Promise.all([
            resolveMovieByTmdbId(tmdbId).catch(err => {
                console.error(`[Addon Vercel] Moviesda URL resolve error (isolated):`, err.message);
                return null;
            }),
            findTamilblastersUrl(movieTitle, movieYear).catch(err => {
                console.error(`[Addon Vercel] Tamilblasters URL resolve error (isolated):`, err.message);
                return null;
            }),
            findTamilyogiUrl(movieTitle, movieYear).catch(err => {
                console.error(`[Addon Vercel] Tamilyogi URL resolve error (isolated):`, err.message);
                return null;
            }),
            findProyatoMovie(movieTitle, movieYear).catch(err => {
                console.error(`[Addon Vercel] Proyato URL resolve error (isolated):`, err.message);
                return null;
            })
        ]);

        console.log(`[Addon Vercel] Moviesda URL: ${resolved?.url || 'not found'}`);
        console.log(`[Addon Vercel] Tamilblasters URL: ${tbUrl || 'not found'}`);
        console.log(`[Addon Vercel] Tamilyogi URL: ${tyUrl || 'not found'}`);
        console.log(`[Addon Vercel] Proyato Slug: ${proyatoObj?.slug || 'not found'}`);

        // Step 4: Scrape streams from all 4 sites in parallel with absolute resilience
        const [mdStreams, tbStreams, tyStreams, proyatoStreams] = await Promise.all([
            (resolved?.url ? scrapeMovieStreams(resolved.url, movieTitle) : Promise.resolve([])).catch(err => {
                console.error(`[Addon Vercel] Moviesda scraping failed:`, err.message);
                return [];
            }),
            (tbUrl ? scrapeTamilblastersStreams(tbUrl, movieTitle) : Promise.resolve([])).catch(err => {
                console.error(`[Addon Vercel] Tamilblasters scraping failed:`, err.message);
                return [];
            }),
            (tyUrl ? scrapeTamilyogiStreams(tyUrl, movieTitle) : Promise.resolve([])).catch(err => {
                console.error(`[Addon Vercel] Tamilyogi scraping failed:`, err.message);
                return [];
            }),
            (proyatoObj?.slug ? scrapeProyatoStreams(proyatoObj.slug, movieTitle) : Promise.resolve([])).catch(err => {
                console.error(`[Addon Vercel] Proyato scraping failed:`, err.message);
                return [];
            })
        ]);

        console.log(`[Addon Vercel] Scraped - Moviesda: ${mdStreams.length}, Tamilblasters: ${tbStreams.length}, Tamilyogi: ${tyStreams.length}, Proyato: ${proyatoStreams.length}`);

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

        function getQualityRank(quality) {
            const q = (quality || '').toLowerCase();
            if (q.includes('1080')) return 0;
            if (q.includes('720')) return 1;
            if (q.includes('480')) return 2;
            if (q.includes('360')) return 3;
            return 4;
        }

        // Step 5: Apply 50MB minimum filter to Moviesda streams (direct files)
        const filteredMd = mdStreams.filter(stream => {
            const sizeMB = parseSizeToMB(stream.size);
            if (stream.size !== 'Unknown Size' && sizeMB < 50) {
                console.log(`[Addon Vercel] Excluding small Moviesda stream: "${stream.title}" (${stream.size})`);
                return false;
            }
            return true;
        });

        // Step 6: Sort Moviesda streams (direct files) by quality + size
        filteredMd.sort((a, b) => {
            const rankDiff = getQualityRank(a.quality) - getQualityRank(b.quality);
            if (rankDiff !== 0) return rankDiff;
            return parseSizeToMB(b.size) - parseSizeToMB(a.size);
        });

        // Keep only the top 3 best overall streams from Moviesda to avoid flooding Stremio's UI list
        const limitedMd = filteredMd.slice(0, 3);

        // Step 7: Map Moviesda streams to Stremio format (Clearly labeled: [Moviesda] + tags)
        const mdStremio = limitedMd.map((stream, index) => {
            const isHighQuality = stream.quality === '1080p' || stream.quality === '720p';
            const emoji = isHighQuality ? '⭐' : '⚡';
            return {
                url: stream.url,
                name: `[Moviesda]\n${emoji} ${stream.quality}`,
                title: `🎥 [Moviesda] · ${movieTitle}\n🔊 Tamil Original | 📀 HDRip\n💾 Size: ${stream.size}\n🔗 Server #${index + 1}`,
                behaviorHints: {
                    notWebReady: false,
                    headers: stream.headers
                }
            };
        });

        // Step 8: Map Tamilblasters streams to Stremio format
        const tbStremio = tbStreams.map(stream => {
            const audioTag = stream.audio ? `\n🔊 ${stream.audio}` : '';
            const ripTag = stream.rip ? ` | 📀 ${stream.rip}` : '';
            const targetUrl = stream.url || stream.externalUrl;
            const isDirectVideo = targetUrl && (targetUrl.includes('.mp4') || targetUrl.includes('.m3u8'));
            return {
                ...(isDirectVideo ? { url: targetUrl } : { externalUrl: targetUrl }),
                name: `[Tamilblasters]\n${stream.name.replace('Tamilblasters\n', '')}`,
                title: `🎥 [Tamilblasters] · ${stream.title.replace('🔗 Tamilblasters', '').trim()}${audioTag}${ripTag}`,
                behaviorHints: {
                    notWebReady: false,
                    ...(stream.headers ? { headers: stream.headers } : {})
                }
            };
        });

        // Step 9: Map Tamilyogi streams to Stremio format
        const tyStremio = tyStreams.map(stream => {
            const targetUrl = stream.url || stream.externalUrl;
            const isDirectVideo = targetUrl && (targetUrl.includes('.mp4') || targetUrl.includes('.m3u8') || stream.type === 'direct');
            return {
                ...(isDirectVideo ? { url: targetUrl } : { externalUrl: targetUrl }),
                name: `[Tamilyogi]\n${stream.name.replace('Tamilyogi\n', '')}`,
                title: `🎥 [Tamilyogi] · ${stream.title.replace('🔗 Tamilyogi', '').trim()}\n🔊 Tamil / Multi Audio`,
                behaviorHints: {
                    notWebReady: false,
                    ...(stream.headers ? { headers: stream.headers } : {})
                }
            };
        });

        // Step 10: Map Proyato / MultiMovies streams to Stremio format
        const proyatoStremio = proyatoStreams.map(stream => {
            const targetUrl = stream.externalUrl || stream.url;
            const isDirectVideo = targetUrl && (targetUrl.includes('.mp4') || targetUrl.includes('.m3u8'));
            return {
                ...(isDirectVideo ? { url: targetUrl } : { externalUrl: targetUrl }),
                name: `[MultiMovies]\n🎬 HD Stream`,
                title: `🎥 [MultiMovies] · ${movieTitle}\n📺 MultiMovies Player (Ad-Free Embed)\n🔊 Multi-Audio / Subtitles`,
                behaviorHints: {
                    notWebReady: false
                }
            };
        });

        // Step 11: Aggregate — premium embeds and direct links first, followed by Moviesda, followed by Tamilblasters
        const allStremio = [...proyatoStremio, ...tyStremio, ...mdStremio, ...tbStremio];

        console.log(`[Addon Vercel] Returning ${allStremio.length} total streams (MM:${proyatoStremio.length} + TY:${tyStremio.length} + MD:${mdStremio.length} + TB:${tbStremio.length}) to Stremio`);
        
        // Save to cache before returning
        if (allStremio.length > 0) {
            STREAM_CACHE.set(cacheKey, {
                timestamp: Date.now(),
                streams: allStremio
            });
        }

        return { streams: allStremio };

    } catch (err) {
        console.error('[Addon Vercel] Stream handler error:', err);
        return { streams: [] };
    }
});

// Expose Express application mounting the Stremio Addon router
const app = express();
const addonInterface = builder.getInterface();
const router = getRouter(addonInterface);

// Path normalizer & cache control middleware
app.use((req, res, next) => {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    
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
