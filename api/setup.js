/**
 * Automated Telegram Webhook Setup for Vercel Serverless Hosting.
 * Simply visit https://<your-vercel-domain>/api/setup in a browser to register the webhook!
 */
export default async function handler(req, res) {
    const token = process.env.TELEGRAM_BOT_TOKEN;

    if (!token || token.includes('YOUR_TELEGRAM_BOT_TOKEN_HERE')) {
        return res.status(400).json({
            success: false,
            message: "TELEGRAM_BOT_TOKEN environment variable is not configured on Vercel!"
        });
    }

    // Determine the current host dynamically from incoming request headers
    const protocol = req.headers['x-forwarded-proto'] || 'https';
    const host = req.headers.host;
    const webhookUrl = `${protocol}://${host}/api/webhook`;

    console.log(`[Vercel Setup] Attempting to set Telegram webhook to: ${webhookUrl}`);

    try {
        const tgApiUrl = `https://api.telegram.org/bot${token}/setWebhook?url=${encodeURIComponent(webhookUrl)}`;
        const response = await fetch(tgApiUrl);
        const data = await response.json();

        if (data.ok) {
            return res.status(200).json({
                success: true,
                message: `🎉 Webhook successfully registered with Telegram! Your bot is now active 24/7!`,
                webhook_url: webhookUrl,
                telegram_response: data
            });
        } else {
            return res.status(400).json({
                success: false,
                message: `❌ Failed to set Webhook with Telegram.`,
                webhook_url: webhookUrl,
                telegram_response: data
            });
        }
    } catch (err) {
        console.error(`[Vercel Setup] Webhook registration failed: ${err.message}`);
        return res.status(500).json({
            success: false,
            message: `❌ Webhook registration failed due to server error.`,
            error: err.message
        });
    }
}
