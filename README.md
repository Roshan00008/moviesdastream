# Moviesda Telegram Downloader Bot 🤖🎬

A premium, standalone Node.js Telegram Bot that searches **Moviesda30.com**, bypasses multiple redirect server pages, resolves high-speed direct CDN download links (`cdn.uptodl.ch`), and sends them to users as beautiful, interactive cards.

It supports **Dual Modes**: run it locally via long-polling, or deploy it as a Serverless Webhook on **Vercel** for 24/7 free hosting in the cloud!

---

## 🔥 Premium Features

-   **Interactive Match Selection:** If a search query matches multiple films (e.g. `"Beast"` or `"Vijay"`), the bot lists up to 5 matches with ratings. Tapping a choice retrieves that specific film's poster and synopsis.
-   **Dynamic File Sizes:** Fast, parallelized HTTP `HEAD` probes fetch direct media sizes (e.g. `1.42 GB`, `730.5 MB`) and attach them **directly onto the download buttons**!
-   **Live Homepage Updates (`/recent` / `/updates`):** Real-time cheerio scraper fetches the top 10 recent additions (both Movies and Web Series episodes) with fast download shortcuts.
-   **High-Speed CDN Direct Links:** Resolves resume-capable, high-speed direct `.mp4` URLs compatible with VLC, IDM, ADM, and MX Player.
-   **Interactive Helpers:** Fully styled `/help` manuals and `/about` status panels.

---

## ⚙️ Setup & Configuration

### 1. Register Your Bot on Telegram (1 Minute)
To get a bot token, you need to register a new bot with Telegram's official `@BotFather`:

1.  Open **Telegram** on your phone or computer.
2.  Search for the verified user **[@BotFather](https://t.me/BotFather)** (blue checkmark) and click **Start**.
3.  Type: `/newbot`
4.  Enter a **Name** for your bot (e.g. `Moviesda Hub`).
5.  Enter a **Username** ending in `bot` (e.g. `moviesda_tamil_bot`).
6.  Copy the secure **HTTP API Token** (e.g. `1234567890:ABCdefGhIJKlmNoPQRsTUVwxyZ`).

---

### 2. Local Polling Mode (Development & Debugging)

1.  **Install dependencies:**
    Open your terminal in `e:\moviesda-telegram-bot` and run:
    ```bash
    npm install
    ```
2.  **Configure environment:**
    Open the **`.env`** file in `e:\moviesda-telegram-bot` and replace `YOUR_TELEGRAM_BOT_TOKEN_HERE` with your token:
    ```env
    TELEGRAM_BOT_TOKEN=1234567890:ABCdefGhIJKlmNoPQRsTUVwxyZ
    ```
3.  **Run the bot:**
    ```bash
    npm start
    ```
    Your bot is now standing by! Type any movie name (e.g. `Minnale`, `Sivaji`) in Telegram to test.

---

### 3. Vercel Serverless Mode (24/7 Free Hosting)

Deploy your bot to the cloud in minutes so it runs forever without keeping your PC on!

#### Step A: Push to GitHub
1.  Initialize a Git repository in `e:\moviesda-telegram-bot\`, commit your code, and push it to a new private or public **GitHub** repository.
    *(Do not push the `.env` file or `node_modules/` folder)*.

#### Step B: Import to Vercel
1.  Log in to your **[Vercel Dashboard](https://vercel.com)**.
2.  Click **Add New > Project**, select your GitHub repository, and click **Import**.
3.  Under **Environment Variables**, add:
    *   `TELEGRAM_BOT_TOKEN`: *your copied Telegram token*
4.  Click **Deploy**!

#### Step C: 1-Click Webhook Activation
Once the deployment finishes, Vercel will give you a domain name (e.g., `https://my-moviesda-bot.vercel.app`).
1.  Open your web browser.
2.  Visit your webhook registration route:
    ```
    https://<your-vercel-domain>.vercel.app/api/setup
    ```
3.  **BOOM!** The page will return:
    ```json
    {
      "success": true,
      "message": "🎉 Webhook successfully registered with Telegram! Your bot is now active 24/7!"
    }
    ```
Your bot is now permanently running in the cloud! Open Telegram, type a movie name, and watch it resolve in milliseconds.
