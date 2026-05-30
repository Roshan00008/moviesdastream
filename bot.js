import 'dotenv/config';
import TelegramBot from 'node-telegram-bot-api';
import { 
    resolveMoviePage, 
    resolveMultiResults, 
    resolveMovieByTmdbId, 
    scrapeLatestUpdates 
} from './search.js';
import { scrapeMovieStreams } from './extractor.js';
import { savePayload, getPayload } from './callbackStore.js';

const token = process.env.TELEGRAM_BOT_TOKEN;

if (!token || token.includes('YOUR_TELEGRAM_BOT_TOKEN_HERE')) {
    console.error('\n❌ ERROR: TELEGRAM_BOT_TOKEN is not configured in your .env file!');
    process.exit(1);
}

// ── Callback data builders ──────────────────────────────────────────────────
// Telegram limit: 64 bytes per callback_data
// Format: "prefix||shortId" — shortId is base-36, always < 10 chars
function makeResolveBtn(url, title) {
    const id = savePayload({ url, title });
    return `R||${id}`;
}
function makeRecentBtn(url, title) {
    const id = savePayload({ url, title });
    return `RC||${id}`;
}
// select_movie uses the numeric TMDB ID directly — always short enough
function makeSelectBtn(tmdbId) {
    return `S||${tmdbId}`;
}

const bot = new TelegramBot(token, { polling: true });

console.log('\n======================================================');
console.log('🤖 Moviesda Premium Telegram Bot is running...');
console.log('✨ Standing by for commands and queries in Telegram!');
console.log('======================================================\n');

// ─────────────────── /start ───────────────────
bot.onText(/\/start/, (msg) => {
    const chatId = msg.chat.id;
    const firstName = msg.from.first_name || 'there';
    bot.sendMessage(chatId, `
👋 *Welcome to the Moviesda Media Hub Bot, ${firstName}!* 🎬

I can search **Moviesda30.com** and extract direct, high-speed CDN download links for Tamil movies, completely bypassing ads.

🔍 *Commands:*
• \`/recent\` or \`/updates\` — View the top 10 latest uploads
• \`/help\` — Help manual
• \`/about\` — Bot information

🚀 *Quick Start:* Type any movie name (e.g. \`Kantara\`, \`Kattalan\`, \`Beast\`) and press send!
`.trim(), { parse_mode: 'Markdown' });
});

// ─────────────────── /help ───────────────────
bot.onText(/\/help/, (msg) => {
    bot.sendMessage(msg.chat.id, `
📖 *Moviesda Downloader Bot Manual*

🎬 *How to Search:*
1. Send the movie name (e.g. \`Kantara\`, \`Minnale\`).
2. If multiple matches exist, tap the correct movie.
3. Click *⚡ Resolve Direct Download Links*.
4. Tap a download button to access high-speed CDN!

🕒 Use \`/recent\` to grab the top 10 latest uploads.
⚠️ If a movie isn't found, add the year: \`Sivaji 2007\`
`.trim(), { parse_mode: 'Markdown' });
});

// ─────────────────── /about ───────────────────
bot.onText(/\/about/, (msg) => {
    bot.sendMessage(msg.chat.id, `
🤖 *About Moviesda Media Hub Bot*

• *Version:* 2.2.0 (Callback Fix)
• *Engine:* Node.js / Cheerio — 4-tier URL resolver
• *Search:* Direct slug → Year index → A-Z index → Google site:search
• *Status:* ⚡ Active and standing by!
`.trim(), { parse_mode: 'Markdown' });
});

// ─────────────────── /recent & /updates ───────────────────
bot.onText(/\/(recent|updates)/, async (msg) => {
    const chatId = msg.chat.id;
    const statusMsg = await bot.sendMessage(chatId, `🔍 *Scraping latest movie updates from Moviesda...*`, { parse_mode: 'Markdown' });
    
    try {
        const updates = await scrapeLatestUpdates();
        bot.deleteMessage(chatId, statusMsg.message_id).catch(() => {});
        
        if (updates.length === 0) {
            return bot.sendMessage(chatId, `❌ *Failed to retrieve latest updates. Please try again.*`, { parse_mode: 'Markdown' });
        }
        
        let responseText = `🕒 *Latest Uploads on Moviesda*\n\n`;
        const buttons = [];
        
        updates.forEach((update, idx) => {
            const icon = update.type === "Web Series" ? "📺" : "🎬";
            responseText += `${idx + 1}. ${icon} *${update.title}* (${update.year})\n\n`;
            if (idx < 5) {
                buttons.push([{
                    text: `📥 #${idx + 1} — ${update.title.substring(0, 25)}`,
                    callback_data: makeRecentBtn(update.url, update.title)
                }]);
            }
        });
        
        responseText += `_Select a shortcut below, or type a movie name to search!_`;
        
        bot.sendMessage(chatId, responseText, {
            parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: buttons }
        });
    } catch (e) {
        console.error(`[Bot] /recent failed: ${e.message}`);
        bot.deleteMessage(chatId, statusMsg.message_id).catch(() => {});
        bot.sendMessage(chatId, `❌ *An error occurred fetching updates.*`, { parse_mode: 'Markdown' });
    }
});

// ─────────────────── Text search handler ───────────────────
bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const text = msg.text;
    if (!text || text.startsWith('/')) return;

    console.log(`[Bot] Query from @${msg.from.username || 'user'}: "${text}"`);
    const searchingMsg = await bot.sendMessage(chatId, `🔍 *Searching for "${text}"...*`, { parse_mode: 'Markdown' });

    try {
        const matches = await resolveMultiResults(text);
        
        if (matches.length === 0) {
            const { url, metadata } = await resolveMoviePage(text);
            if (!url) {
                return bot.editMessageText(
                    `❌ *"${text}" not found on Moviesda.*\n\nTry adding the year (e.g. \`${text} 2022\`) or use \`/recent\` for latest uploads.`,
                    { chat_id: chatId, message_id: searchingMsg.message_id, parse_mode: 'Markdown' }
                );
            }
            return sendMovieDetailCard(chatId, url, metadata, searchingMsg.message_id);
        }
        
        if (matches.length === 1) {
            const { url, metadata } = await resolveMovieByTmdbId(matches[0].id);
            if (!url) {
                return bot.editMessageText(
                    `❌ *"${metadata.title}" not found on Moviesda yet.*\n\nTry \`/recent\` to check latest uploads.`,
                    { chat_id: chatId, message_id: searchingMsg.message_id, parse_mode: 'Markdown' }
                );
            }
            return sendMovieDetailCard(chatId, url, metadata, searchingMsg.message_id);
        }
        
        // Multiple matches → show selection list
        bot.deleteMessage(chatId, searchingMsg.message_id).catch(() => {});
        const buttons = matches.map(movie => [{
            text: `🎬 ${movie.title} (${movie.year}) [⭐ ${movie.rating}]`,
            callback_data: makeSelectBtn(movie.id)
        }]);
        
        bot.sendMessage(chatId, `🔍 *Multiple matches for "${text}".*\n\nSelect the correct movie:`, {
            parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: buttons }
        });

    } catch (e) {
        console.error(`[Bot] Search error: ${e.message}`);
        bot.editMessageText(`❌ *Search failed. Please try again.*`, {
            chat_id: chatId, message_id: searchingMsg.message_id, parse_mode: 'Markdown'
        }).catch(() => {});
    }
});

// ─────────────────── Helpers ───────────────────
async function sendMovieDetailCard(chatId, url, metadata, deleteMessageId) {
    if (deleteMessageId) {
        await bot.deleteMessage(chatId, deleteMessageId).catch(() => {});
    }
    
    const synopsis = metadata.overview.length > 280
        ? metadata.overview.substring(0, 277) + '...'
        : metadata.overview;
    
    const caption = `🎬 *${metadata.title} (${metadata.year})*\n⭐ *Rating:* ${metadata.rating || 'N/A'}\n\n📝 *Synopsis:*\n${synopsis}\n\n⚡ *Ready to download?* Click the button below!`;

    const inlineKeyboard = {
        inline_keyboard: [[{
            text: "⚡ Resolve Direct Download Links",
            callback_data: makeResolveBtn(url, metadata.title)
        }]]
    };

    if (metadata.poster) {
        bot.sendPhoto(chatId, metadata.poster, {
            caption, parse_mode: 'Markdown', reply_markup: inlineKeyboard
        }).catch(() => {
            bot.sendMessage(chatId, caption, { parse_mode: 'Markdown', reply_markup: inlineKeyboard });
        });
    } else {
        bot.sendMessage(chatId, caption, { parse_mode: 'Markdown', reply_markup: inlineKeyboard });
    }
}

// ─────────────────── Callback query router ───────────────────
bot.on('callback_query', async (callbackQuery) => {
    const message = callbackQuery.message;
    const chatId = message.chat.id;
    const data = callbackQuery.data || '';

    bot.answerCallbackQuery(callbackQuery.id, { text: "Processing... ⏳" });

    // ── S||tmdbId  →  Movie selection from multi-result list ──
    if (data.startsWith('S||')) {
        const tmdbId = data.split('||')[1];
        const loadingMsg = await bot.sendMessage(chatId, `🔄 *Searching Moviesda for your selection...*`, { parse_mode: 'Markdown' });
        
        try {
            const { url, metadata } = await resolveMovieByTmdbId(tmdbId);
            if (!url) {
                return bot.editMessageText(
                    `❌ *"${metadata.title}" not found on Moviesda.*\n\nIt may not be uploaded yet!`,
                    { chat_id: chatId, message_id: loadingMsg.message_id, parse_mode: 'Markdown' }
                );
            }
            sendMovieDetailCard(chatId, url, metadata, loadingMsg.message_id);
        } catch (err) {
            console.error(`[Bot] S|| callback error: ${err.message}`);
            bot.editMessageText(`❌ *Failed to resolve selection. Please try again.*`, {
                chat_id: chatId, message_id: loadingMsg.message_id, parse_mode: 'Markdown'
            }).catch(() => {});
        }
        return;
    }

    // ── RC||id  →  Recent update quick-select ──
    if (data.startsWith('RC||')) {
        const id = data.split('||')[1];
        const payload = getPayload(id);
        if (!payload) return bot.sendMessage(chatId, `❌ *Session expired. Please use /recent again.*`, { parse_mode: 'Markdown' });
        
        const { url, title } = payload;
        const loadingMsg = await bot.sendMessage(chatId, `🔄 *Loading "${title}"...*`, { parse_mode: 'Markdown' });
        
        try {
            const tmdbRes = await fetch(`https://api.themoviedb.org/3/search/movie?api_key=1865f43a0549ca50d341dd9ab8b29f49&query=${encodeURIComponent(title)}`);
            const tmdbData = await tmdbRes.json().catch(() => ({ results: [] }));
            
            let metadata = { title, year: "Unknown", overview: "No synopsis available.", poster: null, rating: "N/A" };
            if (tmdbData.results?.length) {
                const f = tmdbData.results[0];
                metadata = {
                    title: f.title || f.original_title,
                    year: f.release_date?.split('-')[0] || "Unknown",
                    overview: f.overview || "No synopsis available.",
                    poster: f.poster_path ? `https://image.tmdb.org/t/p/w500${f.poster_path}` : null,
                    rating: f.vote_average ? `${f.vote_average.toFixed(1)}/10` : "N/A"
                };
            }
            sendMovieDetailCard(chatId, url, metadata, loadingMsg.message_id);
        } catch (err) {
            console.error(`[Bot] RC|| callback error: ${err.message}`);
            bot.editMessageText(`📥 *${title}*\n\nClick to resolve download links:`, {
                chat_id: chatId, message_id: loadingMsg.message_id, parse_mode: 'Markdown',
                reply_markup: { inline_keyboard: [[{ text: "⚡ Resolve Direct Download Links", callback_data: makeResolveBtn(url, title) }]] }
            }).catch(() => {});
        }
        return;
    }

    // ── R||id  →  Resolve CDN download links ──
    if (data.startsWith('R||')) {
        const id = data.split('||')[1];
        const payload = getPayload(id);
        if (!payload) return bot.sendMessage(chatId, `❌ *Session expired. Please search again.*`, { parse_mode: 'Markdown' });
        
        const { url, title } = payload;
        console.log(`[Bot] Resolving streams for: "${title}" (${url})`);
        
        const statusMsg = await bot.sendMessage(chatId, `⏳ *Scraping CDN links for "${title}"...*\n_Resolving servers and checking file sizes..._`, { parse_mode: 'Markdown' });

        try {
            let streams = await scrapeMovieStreams(url, title);
            bot.deleteMessage(chatId, statusMsg.message_id).catch(() => {});

            if (streams.length === 0) {
                return bot.sendMessage(chatId, `❌ *No download servers found for "${title}".*\n\nThe links may have expired or the movie page structure changed.`, { parse_mode: 'Markdown' });
            }

            // ── Parse size string to bytes for comparison ──
            function sizeToBytes(sizeStr) {
                if (!sizeStr || sizeStr === "Unknown Size") return 0;
                const m = sizeStr.match(/([\d.]+)\s*(GB|MB)/i);
                if (!m) return 0;
                const val = parseFloat(m[1]);
                return m[2].toUpperCase() === 'GB' ? val * 1024 * 1024 * 1024 : val * 1024 * 1024;
            }

            // ── Filter: drop files smaller than 50 MB (trailers, samples, junk) ──
            const MIN_BYTES = 50 * 1024 * 1024;
            const filtered = streams.filter(s => {
                const bytes = sizeToBytes(s.size);
                return bytes === 0 || bytes >= MIN_BYTES; // keep unknowns; drop confirmed junk
            });

            const validStreams = filtered.length > 0 ? filtered : streams; // fallback if everything got filtered

            // ── Group by quality ──
            const qualityMap = {};
            validStreams.forEach(s => {
                if (!qualityMap[s.quality]) qualityMap[s.quality] = [];
                qualityMap[s.quality].push(s);
            });

            // ── Sort qualities: highest resolution first ──
            const QUALITY_ORDER = ['1080p', '720p', '480p', '360p', 'HD'];
            const sortedQualities = Object.keys(qualityMap).sort((a, b) => {
                const ia = QUALITY_ORDER.indexOf(a);
                const ib = QUALITY_ORDER.indexOf(b);
                return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
            });

            // ── Within each quality, sort servers by file size descending ──
            sortedQualities.forEach(q => {
                qualityMap[q].sort((a, b) => sizeToBytes(b.size) - sizeToBytes(a.size));
            });

            let replyText = `✅ *CDN Download Links for "${title}"*\n\n`;
            const buttons = [];

            sortedQualities.forEach(quality => {
                replyText += `💿 *${quality}:*\n`;
                qualityMap[quality].forEach((stream, idx) => {
                    const sizeLabel = stream.size && stream.size !== "Unknown Size" ? ` (💾 ${stream.size})` : "";
                    replyText += `🔗 [Server ${idx + 1}${sizeLabel}](${stream.url})\n`;
                    buttons.push([{ text: `📥 ${quality} — Server ${idx + 1}${sizeLabel}`, url: stream.url }]);
                });
                replyText += `\n`;
            });

            replyText += `_Tap a button or link to start downloading!_`;

            bot.sendMessage(chatId, replyText, {
                parse_mode: 'Markdown',
                disable_web_page_preview: true,
                reply_markup: { inline_keyboard: buttons.slice(0, 10) }
            });

        } catch (e) {
            console.error(`[Bot] R|| stream resolution error: ${e.message}`);
            bot.deleteMessage(chatId, statusMsg.message_id).catch(() => {});
            bot.sendMessage(chatId, `❌ *Failed to resolve servers due to an internal error.*`, { parse_mode: 'Markdown' });
        }
        return;
    }
});
