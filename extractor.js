import * as cheerio from 'cheerio';
import { fetchText, fetchHead, HEADERS } from './http.js';

const BASE_URL = "https://moviesda30.com";

/**
 * Safely fetches the file size of a direct URL by querying its headers in a timed-out request
 * @param {string} url 
 * @returns {Promise<string>} Readable size representation (e.g. "1.24 GB", "620 MB") or "Unknown Size"
 */
export async function getFileSize(url) {
    try {
        const headers = await fetchHead(url, {
            headers: {
                "Referer": "https://movies.downloadpage.xyz/"
            }
        });
        
        let lengthStr = headers.get('content-length');
        
        // If GET range fallback was used, check content-range header
        if (!lengthStr && headers.get('content-range')) {
            const range = headers.get('content-range'); // e.g. bytes 0-0/123456789
            const parts = range.split('/');
            if (parts.length > 1) {
                lengthStr = parts[1];
            }
        }
        
        if (!lengthStr) return "Unknown Size";
        
        const bytes = parseInt(lengthStr, 10);
        if (isNaN(bytes) || bytes <= 0) return "Unknown Size";
        
        const gb = bytes / (1024 * 1024 * 1024);
        if (gb >= 1) {
            return `${gb.toFixed(2)} GB`;
        }
        
        const mb = bytes / (1024 * 1024);
        return `${mb.toFixed(1)} MB`;
    } catch (e) {
        return "Unknown Size";
    }
}


/**
 * Resolves full path if relative
 */
function resolveUrl(url) {
    if (!url) return "";
    if (url.startsWith("http")) return url;
    return `${BASE_URL}${url.startsWith("/") ? "" : "/"}${url}`;
}

/**
 * Stage 6: Retrieve the direct playable .mp4 URL from movies.downloadpage.xyz page
 */
async function getDirectMp4Url(downloadPageUrl) {
    try {
        const html = await fetchText(resolveUrl(downloadPageUrl));
        const $ = cheerio.load(html);
        
        const directUrls = [];
        
        $('a').each((_, el) => {
            const href = $(el).attr('href');
            const label = $(el).text().trim();
            
            if (href && (href.includes('.mp4') || href.includes('cdnserver'))) {
                directUrls.push({
                    url: href,
                    title: label || "Download Server Direct"
                });
            }
        });
        
        return directUrls;
    } catch (e) {
        console.error(`[Scraper] Stage 6 error for ${downloadPageUrl}: ${e.message}`);
        return [];
    }
}

/**
 * Stage 5: Get redirect from download.moviespage.xyz page
 */
async function getFinalRedirectPage(filePageUrl) {
    try {
        const html = await fetchText(resolveUrl(filePageUrl));
        const $ = cheerio.load(html);
        
        const redirectUrls = [];
        
        $('a').each((_, el) => {
            const href = $(el).attr('href');
            if (href && href.includes('downloadpage.xyz/download/page/')) {
                redirectUrls.push(href);
            }
        });
        
        return redirectUrls;
    } catch (e) {
        console.error(`[Scraper] Stage 5 error for ${filePageUrl}: ${e.message}`);
        return [];
    }
}

/**
 * Stage 4: Fetch download resolution page, extract intermediate server redirect URLs
 */
async function getIntermediateServerUrls(resolutionPageUrl) {
    try {
        const html = await fetchText(resolveUrl(resolutionPageUrl));
        const $ = cheerio.load(html);
        
        const serverUrls = [];
        
        $('a').each((_, el) => {
            const href = $(el).attr('href');
            if (href && href.includes('moviespage.xyz/download/file/')) {
                serverUrls.push(href);
            }
        });
        
        return serverUrls;
    } catch (e) {
        console.error(`[Scraper] Stage 4 error for ${resolutionPageUrl}: ${e.message}`);
        return [];
    }
}

/**
 * Stage 3: Fetch movie resolution selection page and get the download page redirect link
 */
async function getDownloadSelectionUrls(subfolderUrl) {
    try {
        const html = await fetchText(resolveUrl(subfolderUrl));
        const $ = cheerio.load(html);
        
        // If redirected to homepage, skip
        const pageTitle = $('title').text().toLowerCase();
        if (pageTitle.includes('moviesda download moviesda movies 720p')) return [];
        
        const selectionUrls = new Set();
        
        // Check all anchor tags AND folder-div anchors for /download/ paths
        $('a, div.f a, div.folder a').each((_, el) => {
            const href = $(el).attr('href');
            if (href && href.startsWith('/download/')) {
                selectionUrls.add(href);
            }
        });
        
        return [...selectionUrls];
    } catch (e) {
        console.error(`[Scraper] Stage 3 error for ${subfolderUrl}: ${e.message}`);
        return [];
    }
}

/**
 * Stage 2: Fetch movie main directory folder (Original/Dubbed) to find quality resolution subfolders
 */
async function getResolutionSubfolders(folderUrl) {
    try {
        const html = await fetchText(resolveUrl(folderUrl));
        const $ = cheerio.load(html);
        
        // If the page returned the homepage (Cloudflare or 404), skip it
        const pageTitle = $('title').text().toLowerCase();
        if (pageTitle.includes('moviesda download moviesda movies 720p')) return [];
        
        const subfolders = [];
        
        $('div.f, div.folder').each((_, el) => {
            const a = $(el).find('a').first();
            const href = a.attr('href');
            const text = a.text().trim();
            
            if (!href) return;
            // Skip nav/category links
            if (href.includes('-movies/') || href.includes('collection') || href.includes('isaidub') || href === '/') return;
            // Must be a single-segment path or contain quality keywords
            const hasQualityKeyword = /\d+p|hd|predvd|dvd|blu.ray|480/i.test(text);
            const isSingleSegment = href.split('/').filter(Boolean).length === 1;
            if (!hasQualityKeyword && !isSingleSegment) return;

            let quality = "HD";
            if (text.includes('1080p')) quality = "1080p";
            else if (text.includes('720p')) quality = "720p";
            else if (text.includes('480p') || text.includes('480x')) quality = "480p";
            else if (text.includes('360p') || text.includes('640x')) quality = "360p";
            else if (text.includes('320p') || text.includes('480x320')) quality = "360p";
            else if (/predvd|dvd|blu/i.test(text)) quality = "HD";
            
            subfolders.push({ url: href, quality, label: text });
        });
        
        return subfolders;
    } catch (e) {
        console.error(`[Scraper] Stage 2 error for ${folderUrl}: ${e.message}`);
        return [];
    }
}

/**
 * Stage 1: Traverse the main Movie page (e.g. /kara-2026-tamil-movie/) and get intermediate movie folders
 */
async function getMovieFolders(moviePageUrl) {
    try {
        const html = await fetchText(resolveUrl(moviePageUrl));
        const $ = cheerio.load(html);
        
        const folderUrls = [];
        
        $('div.f, div.folder').each((_, el) => {
            const a = $(el).find('a').first();
            const href = a.attr('href');
            const text = a.text().trim();
            
            if (!href) return;
            // Filter out non-movie links
            if (href.includes('-movies/') || href.includes('collections/') || href.includes('isaidub') || href.includes('request')) return;
            
            folderUrls.push({
                url: href,
                label: text
            });
        });
        
        return folderUrls;
    } catch (e) {
        console.error(`[Scraper] Stage 1 error for ${moviePageUrl}: ${e.message}`);
        return [];
    }
}

/**
 * Main Scraper Pipeline
 * Resolves final stream links given the main Moviesda movie page URL
 */
export async function scrapeMovieStreams(moviePageUrl, movieTitle) {
    const streams = [];
    console.log(`[Scraper] Initiating extraction pipeline for: ${moviePageUrl}`);

    // Stage 1: Get movie subfolders (e.g. /kara-original-movie/)
    const folders = await getMovieFolders(moviePageUrl);
    console.log(`[Scraper] Found ${folders.length} movie folders.`);

    for (const folder of folders) {
        // Stage 2: Get resolution pages (e.g. /kara-720p-hd-movie/)
        const resolutions = await getResolutionSubfolders(folder.url);
        console.log(`[Scraper] Found ${resolutions.length} resolutions under folder "${folder.label}".`);

        for (const res of resolutions) {
            // Stage 3: Get resolution file selection pages (e.g. /download/kara-2026-original-720p-hd/)
            const downloadSelections = await getDownloadSelectionUrls(res.url);
            console.log(`[Scraper] Found ${downloadSelections.length} download files for quality: ${res.quality}`);

            for (const selection of downloadSelections) {
                // Stage 4: Get server redirect file URLs (e.g. https://download.moviespage.xyz/download/file/99057)
                const intermediateServers = await getIntermediateServerUrls(selection);
                
                for (const serverUrl of intermediateServers) {
                    // Stage 5: Get final redirect pages (e.g. https://movies.downloadpage.xyz/download/page/99057)
                    const finalPages = await getFinalRedirectPage(serverUrl);
                    
                    for (const finalPage of finalPages) {
                        // Stage 6: Resolve direct playable MP4 urls (e.g. https://s12.cdnserver02.xyz/...mp4)
                        const directUrls = await getDirectMp4Url(finalPage);
                        
                        for (const direct of directUrls) {
                            streams.push({
                                name: "Moviesda",
                                title: `${movieTitle} (${res.quality}) - Server ${streams.length + 1}`,
                                url: direct.url,
                                quality: res.quality,
                                headers: {
                                    "User-Agent": HEADERS["User-Agent"],
                                    "Referer": "https://movies.downloadpage.xyz/"
                                }
                            });
                        }
                    }
                }
            }
        }
    }

    // Resolve file sizes concurrently to keep response times high
    console.log(`[Scraper] Resolving file sizes for ${streams.length} stream links in parallel...`);
    try {
        const sizePromises = streams.map(stream => getFileSize(stream.url));
        const sizeResults = await Promise.allSettled(sizePromises);
        
        streams.forEach((stream, idx) => {
            const result = sizeResults[idx];
            stream.size = (result.status === 'fulfilled') ? result.value : "Unknown Size";
        });
    } catch (sizeErr) {
        console.error(`[Scraper] Failed to resolve file sizes in parallel: ${sizeErr.message}`);
    }

    return streams;
}

// ─────────────────────────────────────────────────────────────────────────────
// TAMILBLASTERS SCRAPER
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Scrapes a Tamilblasters post page for:
 * 1. Embedded player iframes (hgcloud, luluvid, etc.) → externalUrl streams
 * 2. Download buttons (data-file attr + base URL from script) → externalUrl streams
 */
export async function scrapeTamilblastersStreams(postUrl, movieTitle) {
    const streams = [];
    try {
        console.log(`[Scraper TB] Scraping Tamilblasters page: ${postUrl}`);
        const html = await fetchText(postUrl);
        const $ = cheerio.load(html);

        // 1. Extract download base URL from the inline <script> tag
        let downloadBaseUrl = null;
        $('script').each((_, el) => {
            const content = $(el).html() || '';
            // The script has: const downloadLink = "https://<hash>.icu/<hash>.php?file=" + button.dataset.file;
            const match = content.match(/const downloadLink\s*=\s*["']([^"']+\?file=)["']/);
            if (match) downloadBaseUrl = match[1];
        });

        // 2. Extract download buttons
        $('button.downloadBtn, button[data-file]').each((i, el) => {
            const dataFile = $(el).attr('data-file') || '';
            const label = $(el).text().trim() || `Download ${i + 1}`;

            if (dataFile) {
                const url = downloadBaseUrl
                    ? `${downloadBaseUrl}${encodeURIComponent(dataFile)}`
                    : `https://www.1tamilblasters.luxe/?file=${encodeURIComponent(dataFile)}`;

                // Parse quality, audio languages, and rip type from label text
                let quality = 'HD';
                if (/4k|2160p/i.test(label)) quality = '4K';
                else if (/1080p/i.test(label)) quality = '1080p';
                else if (/720p/i.test(label)) quality = '720p';
                else if (/480p/i.test(label)) quality = '480p';
                else if (/360p/i.test(label)) quality = '360p';

                // Extract languages (e.g. Tam, Tel, Hin, Eng)
                const audioLangs = [];
                if (/tam/i.test(label)) audioLangs.push('Tamil');
                if (/tel/i.test(label)) audioLangs.push('Telugu');
                if (/hin/i.test(label)) audioLangs.push('Hindi');
                if (/eng/i.test(label)) audioLangs.push('English');
                if (/kan/i.test(label)) audioLangs.push('Kannada');
                if (/mal/i.test(label)) audioLangs.push('Malayalam');
                const audioStr = audioLangs.length ? audioLangs.join(' + ') : 'Multi Audio';

                // Extract Rip Type
                let ripType = 'WEB-DL';
                if (/bluray/i.test(label)) ripType = 'BluRay';
                else if (/brrip|br_rip/i.test(label)) ripType = 'BRRip';
                else if (/webrip|web-rip/i.test(label)) ripType = 'WEBRip';
                else if (/hdrip/i.test(label)) ripType = 'HDRip';
                else if (/dvd/i.test(label)) ripType = 'DVD';
                else if (/predvd|pre-dvd|cam/i.test(label)) ripType = 'PreDVD/CAM';

                const sizeMatch = label.match(/[\d.]+\s*(?:GB|MB)/i);
                const size = sizeMatch ? sizeMatch[0] : '';

                streams.push({
                    url,
                    name: `Tamilblasters\n⬇️ ${quality}${size ? ' · ' + size : ''}`,
                    title: `⬇️ Download · ${movieTitle}\n🔊 ${audioStr} | 📀 ${ripType}\n📦 ${label}\n🔗 Tamilblasters`,
                    quality,
                    size,
                    audio: audioStr,
                    rip: ripType,
                    type: 'download',
                    externalUrl: url
                });
            }
        });

        // 3. Extract embedded player iframes
        $('iframe').each((i, el) => {
            const src = $(el).attr('src') || '';
            if (!src.startsWith('http')) return;

            // Try to infer player name from the domain
            let playerName = 'Player';
            try {
                const host = new URL(src).hostname.replace('www.', '').split('.')[0];
                playerName = host.charAt(0).toUpperCase() + host.slice(1);
            } catch (e) {}

            // Get the label paragraph above the iframe (e.g. "Player: 01")
            const label = $(el).prev('p').text().trim() || `Player ${i + 1}`;

            streams.push({
                url: src,
                name: `Tamilblasters\n🎬 ${playerName}`,
                title: `🎬 Watch Online · ${movieTitle}\n📺 ${label} (${playerName})\n🔗 Tamilblasters`,
                quality: 'HD',
                size: 'Unknown Size',
                type: 'embed',
                externalUrl: src
            });
        });

        console.log(`[Scraper TB] Found ${streams.length} streams (downloads + embeds)`);
    } catch (e) {
        console.error(`[Scraper TB] Error: ${e.message}`);
    }
    return streams;
}

// ─────────────────────────────────────────────────────────────────────────────
// TAMILYOGI SCRAPER (with OKRU direct CDN resolution)
// ─────────────────────────────────────────────────────────────────────────────

const OKRU_QUALITY_MAP = {
    'full': '1080p',
    'hd': '720p',
    'sd': '480p',
    'low': '360p',
    'lowest': '360p',
    'mobile': '360p'
};

/**
 * Resolves direct MP4 CDN URLs from an OK.ru videoembed URL.
 * Parses the data-options JSON which contains the videos array.
 */
async function resolveOkRuStreams(embedUrl, movieTitle) {
    const streams = [];
    try {
        console.log(`[Scraper TY] Resolving OKRU embed: ${embedUrl}`);
        const html = await fetchText(embedUrl);
        const $ = cheerio.load(html);

        let videos = null;
        $('[data-options]').each((_, el) => {
            if (videos) return;
            const dataOptions = $(el).attr('data-options') || '';
            if (!dataOptions.includes('metadata')) return;
            try {
                const options = JSON.parse(dataOptions);
                if (options.flashvars?.metadata) {
                    const metadata = JSON.parse(options.flashvars.metadata);
                    if (metadata.videos?.length) videos = metadata.videos;
                }
            } catch (e) {}
        });

        if (!videos) {
            console.warn(`[Scraper TY] OKRU: no videos found in data-options`);
            return streams;
        }

        // Sort by quality: full > hd > sd > low
        const qualityPriority = ['full', 'hd', 'sd', 'low', 'lowest', 'mobile'];
        videos.sort((a, b) => qualityPriority.indexOf(a.name) - qualityPriority.indexOf(b.name));

        for (const video of videos) {
            if (video.disallowed) continue;
            const quality = OKRU_QUALITY_MAP[video.name] || video.name;
            const emoji = ['1080p', '720p'].includes(quality) ? '⭐' : '⚡';

            streams.push({
                url: video.url,
                name: `Tamilyogi\n${emoji} ${quality}`,
                title: `🎥 ${movieTitle}\n📺 Tamilyogi · OKRU · ${quality}`,
                quality,
                size: 'Unknown Size',
                type: 'direct'
            });
        }

        console.log(`[Scraper TY] OKRU resolved ${streams.length} direct CDN streams`);
    } catch (e) {
        console.error(`[Scraper TY] OKRU resolve error: ${e.message}`);
    }
    return streams;
}

/**
 * Scrapes a Tamilyogi post page for video player URLs.
 * Extracts OKRU embeds → resolves to direct MP4 streams.
 * Falls back to externalUrl for other embed types.
 */
export async function scrapeTamilyogiStreams(postUrl, movieTitle) {
    const streams = [];
    try {
        console.log(`[Scraper TY] Scraping Tamilyogi page: ${postUrl}`);
        const html = await fetchText(postUrl);
        const $ = cheerio.load(html);

        // Collect all embed player URLs (from onclick="loadPlayer('URL', this)" buttons)
        const playerUrls = new Set();

        $('[onclick]').each((_, el) => {
            const onclick = $(el).attr('onclick') || '';
            const match = onclick.match(/loadPlayer\(['"]([^'"]+)['"]/);
            if (match) playerUrls.add(match[1]);
        });

        // Also collect iframes
        $('iframe').each((_, el) => {
            const src = $(el).attr('src') || '';
            if (src.startsWith('http')) playerUrls.add(src);
        });

        console.log(`[Scraper TY] Found ${playerUrls.size} player URL(s)`);

        for (const playerUrl of playerUrls) {
            if (/ok\.ru\/videoembed\//i.test(playerUrl)) {
                // Resolve OKRU to direct CDN streams
                const okruStreams = await resolveOkRuStreams(playerUrl, movieTitle);
                streams.push(...okruStreams);
            } else {
                // Other embeds (luluvid, hgcloud, etc.) → external URL
                let playerName = 'Player';
                try {
                    const host = new URL(playerUrl).hostname.replace('www.', '').split('.')[0];
                    playerName = host.charAt(0).toUpperCase() + host.slice(1);
                } catch (e) {}

                streams.push({
                    url: playerUrl,
                    name: `Tamilyogi\n🎬 ${playerName}`,
                    title: `🎬 Watch Online · ${movieTitle}\n📺 Tamilyogi · ${playerName}`,
                    quality: 'HD',
                    size: 'Unknown Size',
                    type: 'embed',
                    externalUrl: playerUrl
                });
            }
        }

        console.log(`[Scraper TY] Total ${streams.length} stream(s) resolved`);
    } catch (e) {
        console.error(`[Scraper TY] Error: ${e.message}`);
    }
    return streams;
}
