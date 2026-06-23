chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "CLIP_JOB") {
    (async () => {
      try {
        // 1. Execute scraper on the active tab
        const injectionResults = await chrome.scripting.executeScript({
          target: { tabId: message.tabId },
          files: ["scripts/scraper.js"]
        });

        const jobData = injectionResults[0]?.result;
        if (!jobData || !jobData.jd) {
          sendResponse({ success: false, error: "No JD found" });
          return;
        }

        // 2. Get target DocMind URL
        const { targetUrl = "http://localhost:5173/intelligence" } = await chrome.storage.sync.get("targetUrl");

        // 3. Open DocMind in a new tab
        const newTab = await chrome.tabs.create({ url: targetUrl, active: true });

        // 4. Wait for the new tab to finish loading
        // We need to poll or listen to onUpdated, but a simpler way is to inject periodically 
        // or just wait for DOMContentLoaded. We will listen to onUpdated.
        chrome.tabs.onUpdated.addListener(function listener(tabId, info) {
          if (tabId === newTab.id && info.status === 'complete') {
            chrome.tabs.onUpdated.removeListener(listener);
            
            // 5. Inject data into DocMind's sessionStorage
            chrome.scripting.executeScript({
              target: { tabId: newTab.id },
              func: (data) => {
                window.sessionStorage.setItem("docmind_company", JSON.stringify(data.company));
                window.sessionStorage.setItem("docmind_role", JSON.stringify(data.role));
                window.sessionStorage.setItem("docmind_jdText", JSON.stringify(data.jd));
                
                // Force a reload so useSessionState picks it up 
                // OR we could dispatch a storage event, but reload is foolproof.
                window.location.reload();
              },
              args: [jobData]
            });
          }
        });

        sendResponse({ success: true });
      } catch (e) {
        console.error("Clip failed", e);
        sendResponse({ success: false, error: e.message });
      }
    })();
    return true; // Keep channel open for async response
  }
});
