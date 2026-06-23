# DocMind Web Clipper Extension

A native browser extension for Chrome and Brave that instantly clips job descriptions from LinkedIn, Indeed, and other sites, injecting them directly into your local or deployed DocMind Intelligence engine.

## Installation Instructions

Because this extension is not published to the Chrome Web Store, you need to load it as an "Unpacked Extension".

1. Open **Chrome** or **Brave**.
2. Navigate to `chrome://extensions/` (or `brave://extensions/`).
3. Turn on **Developer mode** (usually a toggle in the top-right corner).
4. Click the **Load unpacked** button.
5. Select this exact folder (`docmind-hybrid/extension`).
6. The extension is now installed! You can pin it to your toolbar for quick access.

## How to Use

1. Go to any job posting on **LinkedIn** or **Indeed**.
2. Click the DocMind icon in your browser toolbar.
3. If you want to send the job to your deployed Vercel app, change the Target URL in the popup. Otherwise, leave it as `http://localhost:5173/intelligence`.
4. Click **Clip Job & Tailor**.
5. The extension will scrape the job title, company, and full description, open DocMind in a new tab, and magically pre-fill the Intelligence editor for you!
