const DEFAULT_URL = "http://localhost:5173/intelligence";

document.addEventListener("DOMContentLoaded", async () => {
  const urlInput = document.getElementById("target-url");
  const saveStatus = document.getElementById("save-status");
  const clipBtn = document.getElementById("clip-btn");
  const clipStatus = document.getElementById("clip-status");

  // Load saved URL
  const { targetUrl = DEFAULT_URL } = await chrome.storage.sync.get("targetUrl");
  urlInput.value = targetUrl;

  // Auto-save on type
  let timeout;
  urlInput.addEventListener("input", () => {
    clearTimeout(timeout);
    saveStatus.style.display = "none";
    timeout = setTimeout(async () => {
      let val = urlInput.value.trim();
      if (!val) val = DEFAULT_URL;
      await chrome.storage.sync.set({ targetUrl: val });
      saveStatus.style.display = "block";
      setTimeout(() => saveStatus.style.display = "none", 1500);
    }, 500);
  });

  // Clip Button Logic
  clipBtn.addEventListener("click", async () => {
    clipBtn.disabled = true;
    clipBtn.innerHTML = "Clipping...";

    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    
    // We send a message to background.js so the service worker orchestrates 
    // the tab creation and script injection.
    chrome.runtime.sendMessage({ type: "CLIP_JOB", tabId: tab.id }, (response) => {
      if (chrome.runtime.lastError || !response?.success) {
        clipBtn.innerHTML = "Failed!";
        clipBtn.style.background = "#ef4444";
        setTimeout(() => window.close(), 1500);
        return;
      }

      clipStatus.style.display = "block";
      clipBtn.innerHTML = "Success!";
      setTimeout(() => window.close(), 1000);
    });
  });
});
