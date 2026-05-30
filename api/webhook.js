import TelegramBot from 'node-telegram-bot-api';
import { resolveMoviePage, resolveMultiResults, resolveMovieByTmdbId, scrapeLatestUpdates } from '../search.js';
import { scrapeMovieStreams } from '../extractor.js';

const token = process.env.TELEGRAM_BOT_TOKEN;
const bot = new TelegramBot(token, { polling: false });

// ── Callback data helpers (base64 encoded to avoid delimiter collisions) ──
function encodeResolvePayload(url, title) {
    return 'resolve||' + Buffer.from(JSON.stringify({ url, title })).toString('base64');
}
function decodeResolvePayload(data) {
    try { return JSON.parse(Buffer.from(data.replace(/^resolve\|\|/, ''), 'base64').toString('utf8')); }
    catch { return null; }
}
function encodeRecentPayload(url, title) {
    return 'recent_select||' + Buffer.from(JSON.stringify({ url, title })).toString('base64');
}
function decodeRecentPayload(data) {
    try { return JSON.parse(Buffer.from(data.replace(/^recent_select\|\|/, ''), 'base64').toString('utf8')); }
    catch { return null; }
}

bot.onText(/\/start/, (msg) => {
    const chatId = msg.chat.id;
    const firstName = msg.from.first_name || 'there';
    bot.sendMessage(chatId, `
👋 *Welcome to the Moviesda Media Hub Bot, ${firstName}!* 🎬

I can search **Moviesda30.com** and extract direct, high-speed CDN download links for Tamil movies & web series.

🔍 *Commands:*
• \`/recent\` or \`/updates\` — Latest uploads in real-time
• \`/help\` — Help manual
• \`/about\` — Bot info

🚀 Type any movie name to start!
`.trim(), { parse_mode: 'Markdown' });
});

bot.onText(/\/help/, (msg) => {
    bot.sendMessage(msg.chat.id, `
📖 *Moviesda Downloader Bot Manual*

🎬 *How to Search:*
1. Type a movie name (e.g. \`Kantara\`, \`Kattalan\`).
2. Select the correct match from the list.
3. Click *⚡ Resolve Direct Download Links*.
4. Tap a download button for high-speed CDN access!

🕒 Use \`/recent\` for the latest uploads.
⚠️ Add the year if not found: \`Sivaji 2007\`
`.trim(), { parse_mode: 'Markdown' });
});

bot.onText(/\/about/, (msg) => {
    bot.sendMessage(msg.chat.id, `
🤖 *About Moviesda Media Hub Bot*

• *Version:* 2.1.0 (Fixed Search Engine)
• *Engine:* Node.js / Cheerio — 4-tier URL resolver
• *Status:* ⚡ Active (Serverless Vercel)
`.trim(), { parse_mode: 'Markdown' });
});

bot.onText(/\/(recent|updates)/, async (msg) => {
    const chatId = msg.chat.id;
    const statusMsg = await bot.sendMessage(chatId, `🔍 *Scraping latest updates from Moviesda...*`, { parse_mode: 'Markdown' });
    try {
        const updates = await scrapeLatestUpdates();
        bot.deleteMessage(chatId, statusMsg.message_id).catch(() => {});
        if (!updates.length) return bot.sendMessage(chatId, `❌ *Failed to retrieve updates.*`, { parse_mode: 'Markdown' });
        
        let text = `🕒 *Latest Uploads on Moviesda*\n\n`;
        const buttons = [];
        updates.forEach((u, i) => {
            const icon = u.type === "Web Series" ? "📺" : "🎬";
            text += `${i + 1}. ${icon} *${u.title}* (${u.year})\n_${u.rawText.substring(0, 72)}..._\n\n`;
            if (i < 5) buttons.push([{ text: `📥 #${i + 1} — ${u.title.substring(0, 22)}`, callback_data: encodeRecentPayload(u.url, u.title) }]);
        });
        text += `_Select a quick-download shortcut or type a movie name!_`;
        bot.sendMessage(chatId, text, { parse_mode: 'Markdown', reply_markup: { inline_keyboard: buttons } });
    } catch (e) {
        bot.deleteMessage(chatId, statusMsg.message_id).catch(() => {});
        bot.sendMessage(chatId, `❌ *Error fetching updates.*`, { parse_mode: 'Markdown' });
    }
});

bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const text = msg.text;
    if (!text || text.startsWith('/')) return;

    const searchingMsg = await bot.sendMessage(chatId, `🔍 *Searching for "${text}"...*`, { parse_mode: 'Markdown' });
    try {
        const matches = await resolveMultiResults(text);
        
        if (!matches.length) {
            const { url, metadata } = await resolveMoviePage(text);
            if (!url) return bot.editMessageText(`❌ *"${text}" not found on Moviesda.*\n\nTry \`${text} YEAR\` or use \`/recent\`.`, { chat_id: chatId, message_id: searchingMsg.message_id, parse_mode: 'Markdown' });
            return sendMovieDetailCard(chatId, url, metadata, searchingMsg.message_id);
        }
        if (matches.length === 1) {
            const { url, metadata } = await resolveMovieByTmdbId(matches[0].id);
            if (!url) return bot.editMessageText(`❌ *"${metadata.title}" not found on Moviesda.*`, { chat_id: chatId, message_id: searchingMsg.message_id, parse_mode: 'Markdown' });
            return sendMovieDetailCard(chatId, url, metadata, searchingMsg.message_id);
        }
        
        bot.deleteMessage(chatId, searchingMsg.message_id).catch(() => {});
        const buttons = matches.map(m => [{ text: `🎬 ${m.title} (${m.year}) [⭐ ${m.rating}]`, callback_data: `select_movie||${m.id}` }]);
        bot.sendMessage(chatId, `🔍 *Multiple matches for "${text}":*\n\nSelect the exact movie:`, { parse_mode: 'Markdown', reply_markup: { inline_keyboard: buttons } });
    } catch (e) {
        bot.editMessageText(`❌ *Search error. Please try again.*`, { chat_id: chatId, message_id: searchingMsg.message_id, parse_mode: 'Markdown' }).catch(() => {});
    }
});

async function sendMovieDetailCard(chatId, url, metadata, deleteMessageId) {
    if (deleteMessageId) await bot.deleteMessage(chatId, deleteMessageId).catch(() => {});
    const caption = `🎬 *${metadata.title} (${metadata.year})*\n⭐ *Rating:* ${metadata.rating || 'N/A'}\n\n📝 *Synopsis:*\n${metadata.overview.length > 280 ? metadata.overview.substring(0, 277) + '...' : metadata.overview}\n\n⚡ *Ready to download?* Click the button below!`;
    const keyboard = { inline_keyboard: [[{ text: "⚡ Resolve Direct Download Links", callback_data: encodeResolvePayload(url, metadata.title) }]] };
    if (metadata.poster) {
        bot.sendPhoto(chatId, metadata.poster, { caption, parse_mode: 'Markdown', reply_markup: keyboard }).catch(() => bot.sendMessage(chatId, caption, { parse_mode: 'Markdown', reply_markup: keyboard }));
    } else {
        bot.sendMessage(chatId, caption, { parse_mode: 'Markdown', reply_markup: keyboard });
    }
}

bot.on('callback_query', async (callbackQuery) => {
    const message = callbackQuery.message;
    const chatId = message.chat.id;
    const data = callbackQuery.data;
    bot.answerCallbackQuery(callbackQuery.id, { text: "Processing... ⏳" });

    if (data.startsWith('select_movie||')) {
        const tmdbId = data.split('||')[1];
        const loadingMsg = await bot.sendMessage(chatId, `🔄 *Searching Moviesda for your selection...*`, { parse_mode: 'Markdown' });
        try {
            const { url, metadata } = await resolveMovieByTmdbId(tmdbId);
            if (!url) return bot.editMessageText(`❌ *"${metadata.title}" not found on Moviesda.*`, { chat_id: chatId, message_id: loadingMsg.message_id, parse_mode: 'Markdown' });
            sendMovieDetailCard(chatId, url, metadata, loadingMsg.message_id);
        } catch (err) {
            bot.editMessageText(`❌ *Failed to resolve. Please try again.*`, { chat_id: chatId, message_id: loadingMsg.message_id, parse_mode: 'Markdown' }).catch(() => {});
        }
        return;
    }

    if (data.startsWith('recent_select||')) {
        const payload = decodeRecentPayload(data);
        if (!payload) return;
        const { url, title } = payload;
        const loadingMsg = await bot.sendMessage(chatId, `🔄 *Loading details for "${title}"...*`, { parse_mode: 'Markdown' });
        try {
            const tmdbData = await fetch(`https://api.themoviedb.org/3/search/movie?api_key=1865f43a0549ca50d341dd9ab8b29f49&query=${encodeURIComponent(title)}`).then(r => r.json()).catch(() => ({ results: [] }));
            let metadata = { title, year: "Unknown", overview: "No synopsis available.", poster: null, rating: "N/A" };
            if (tmdbData.results?.length) {
                const f = tmdbData.results[0];
                metadata = { title: f.title || f.original_title, year: f.release_date?.split('-')[0] || "Unknown", overview: f.overview || "No synopsis available.", poster: f.poster_path ? `https://image.tmdb.org/t/p/w500${f.poster_path}` : null, rating: f.vote_average ? `${f.vote_average.toFixed(1)}/10` : "N/A" };
            }
            sendMovieDetailCard(chatId, url, metadata, loadingMsg.message_id);
        } catch (err) {
            bot.editMessageText(`📥 *${title}*\n\nClick to resolve download links:`, { chat_id: chatId, message_id: loadingMsg.message_id, parse_mode: 'Markdown', reply_markup: { inline_keyboard: [[{ text: "⚡ Resolve Direct Download Links", callback_data: encodeResolvePayload(url, title) }]] } }).catch(() => {});
        }
        return;
    }

    if (data.startsWith('resolve||')) {
        const payload = decodeResolvePayload(data);
        if (!payload) return;
        const { url, title } = payload;
        const statusMsg = await bot.sendMessage(chatId, `⏳ *Scraping CDN links for "${title}"...*\n_Resolving servers and checking file sizes..._`, { parse_mode: 'Markdown' });
        try {
            const streams = await scrapeMovieStreams(url, title);
            bot.deleteMessage(chatId, statusMsg.message_id).catch(() => {});
            if (!streams.length) return bot.sendMessage(chatId, `❌ *No download servers found for "${title}".*`, { parse_mode: 'Markdown' });

            const qualityMap = {};
            streams.forEach(s => { if (!qualityMap[s.quality]) qualityMap[s.quality] = []; qualityMap[s.quality].push(s); });
            let replyText = `✅ *CDN Download Links for "${title}"*\n\n`;
            const buttons = [];
            Object.keys(qualityMap).forEach(q => {
                replyText += `💿 *${q}:*\n`;
                qualityMap[q].forEach((s, i) => {
                    const sz = s.size && s.size !== "Unknown Size" ? ` (💾 ${s.size})` : "";
                    replyText += `🔗 [Server ${i + 1}${sz}](${s.url})\n`;
                    buttons.push([{ text: `📥 ${q} — Server ${i + 1}${sz}`, url: s.url }]);
                });
                replyText += `\n`;
            });
            replyText += `_Tap a button to start downloading!_`;
            bot.sendMessage(chatId, replyText, { parse_mode: 'Markdown', disable_web_page_preview: true, reply_markup: { inline_keyboard: buttons.slice(0, 10) } });
        } catch (e) {
            bot.deleteMessage(chatId, statusMsg.message_id).catch(() => {});
            bot.sendMessage(chatId, `❌ *Failed to resolve servers.*`, { parse_mode: 'Markdown' });
        }
    }
});

export default async function handler(req, res) {
    if (req.method === 'POST') {
        try { await bot.processUpdate(req.body); res.status(200).send('OK'); }
        catch (err) { console.error('[Webhook] Error:', err); res.status(500).send('Error'); }
    } else {
        res.status(200).send('🚀 Moviesda Serverless Webhook Bot is active!');
    }
}
