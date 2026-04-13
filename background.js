// Tenably background service worker
// Handles: opening background tabs, scraping them, closing them, storing results

const SCRAPE_TIMEOUT = 8000; // ms to wait for a listing tab to load

// ── Open a listing URL in background, wait for content script to scrape it ──
function scrapeListingTab(url) {
  return new Promise((resolve) => {
    let tabId = null;
    const timer = setTimeout(() => {
      if (tabId) chrome.tabs.remove(tabId).catch(() => {});
      resolve(null);
    }, SCRAPE_TIMEOUT);

    chrome.tabs.create({ url, active: false }, (tab) => {
      tabId = tab.id;

      // Listen for the content script to send back scraped data
      function onMessage(msg, sender) {
        if (msg.type === "TENABLY_SCRAPED" && sender.tab?.id === tabId) {
          clearTimeout(timer);
          chrome.runtime.onMessage.removeListener(onMessage);
          chrome.tabs.remove(tabId).catch(() => {});
          resolve(msg.data);
        }
      }
      chrome.runtime.onMessage.addListener(onMessage);

      // Once tab finishes loading, tell content script to scrape
      function onUpdated(updatedTabId, changeInfo) {
        if (updatedTabId === tabId && changeInfo.status === "complete") {
          chrome.tabs.onUpdated.removeListener(onUpdated);
          // Small delay to let lazy-load images settle
          setTimeout(() => {
            chrome.tabs.sendMessage(tabId, { type: "TENABLY_SCRAPE_THIS" }).catch(() => {});
          }, 1500);
        }
      }
      chrome.tabs.onUpdated.addListener(onUpdated);
    });
  });
}

// ── Save listings to chrome.storage (acts as our database) ──────────────────
async function saveListings(newListings) {
  return new Promise((resolve) => {
    chrome.storage.local.get(["tenably_listings"], (result) => {
      const existing = result.tenably_listings || [];

      // Deduplicate by listingId or sourceUrl
      const existingIds = new Set(existing.map((l) => l.listingId || l.sourceUrl));
      const fresh = newListings.filter(
        (l) => !existingIds.has(l.listingId || l.sourceUrl)
      );

      const merged = [...existing, ...fresh];
      chrome.storage.local.set({ tenably_listings: merged }, () => {
        resolve({ added: fresh.length, total: merged.length });
      });
    });
  });
}

// ── Handle messages from content scripts ────────────────────────────────────
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {

  // Content script asking us to scrape a batch of URLs
  if (msg.type === "TENABLY_SCRAPE_BATCH") {
    const urls = msg.urls;
    const senderTabId = sender.tab?.id; // originating tab to send progress back to
    (async () => {
      const results = [];
      for (let i = 0; i < urls.length; i++) {
        const data = await scrapeListingTab(urls[i]);
        if (data) results.push(data);

        // Send real progress back to the content script after each tab completes
        if (senderTabId) {
          chrome.tabs.sendMessage(senderTabId, {
            type: "TENABLY_PROGRESS",
            done: i + 1,
            total: urls.length,
          }).catch(() => {});
        }

        // Small delay between tabs to avoid hammering
        await new Promise((r) => setTimeout(r, 400));
      }

      const { added, total } = await saveListings(results);

      // Open Tenably dashboard
      const tenablyUrl = chrome.runtime.getURL("tenably.html");
      chrome.tabs.create({ url: tenablyUrl });

      sendResponse({ added, total });
    })();
    return true; // keep channel open for async
  }

  // Content script asking us to save a single already-scraped listing
  if (msg.type === "TENABLY_SAVE_ONE") {
    (async () => {
      const { added, total } = await saveListings([msg.data]);
      const tenablyUrl = chrome.runtime.getURL("tenably.html");
      chrome.tabs.create({ url: tenablyUrl });
      sendResponse({ added, total });
    })();
    return true;
  }
});
