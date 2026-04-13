// Tenably Importer - Content Script v3
// Selectors verified against live SpareRoom DOM

(function () {

  // ── Page type detection ───────────────────────────────────────────────────
  const url = window.location.href;
  const isSingleListing = url.includes("flatshare_detail") || url.includes("flatshare_id=");
  const isSearchPage = !isSingleListing && url.includes("spareroom.co.uk/flatshare");

  // ── Helpers ───────────────────────────────────────────────────────────────
  function getText(selector, fallback = null) {
    const el = document.querySelector(selector);
    return el ? el.innerText.trim() : fallback;
  }

  function getAll(selector) {
    return Array.from(document.querySelectorAll(selector));
  }

  // ── Respond to background.js messages ────────────────────────────────────
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === "TENABLY_SCRAPE_THIS") {
      const data = scrapeListing();
      chrome.runtime.sendMessage({ type: "TENABLY_SCRAPED", data });
    }

    // Real progress updates from background.js — sync bar to actual tab scraping
    if (msg.type === "TENABLY_PROGRESS") {
      const fill = document.getElementById("tenably-progress-fill");
      const text = document.getElementById("tenably-progress-text");
      if (fill) fill.style.width = `${(msg.done / msg.total) * 100}%`;
      if (text) text.textContent = `Scraped ${msg.done} of ${msg.total} listings...`;
    }
  });

  // ── Single listing scraper ────────────────────────────────────────────────
  function scrapeListing() {
    // Title — h1 is reliable
    const title = getText("h1") || document.title || "Untitled";

    // Rent — [class*="price"] returns "£1,150 pcm\nDouble", take first line
    const priceEl = document.querySelector('[class*="price"]');
    let rent = null;
    if (priceEl) {
      rent = priceEl.innerText.split("\n")[0].trim();
      if (!rent.includes("£")) rent = null;
    }
    // Fallback: scan for £ pattern in body text
    if (!rent) {
      const m = document.body.innerText.match(/£[\d,]+\s*(pcm|pw|per\s+month|per\s+week)/i);
      rent = m ? m[0] : null;
    }

    // Description — verified class on SpareRoom
    const description = getText("p.detaildesc") || null;

    // Location — extract from key-features area info, or fall back to h1 parsing
    let location = getText(".key-features__area-info") || null;
    if (!location) {
      // Try to get area from page — SpareRoom puts it in the h1 area or a subtitle
      const sub = document.querySelector('h2, [class*="subtitle"], [class*="subheading"]');
      if (sub && sub.innerText.length < 60) location = sub.innerText.trim();
    }
    if (!location) {
      // Last resort: extract from URL search_results param or page title
      const titleEl = document.querySelector("title");
      if (titleEl) {
        const m = titleEl.innerText.match(/in\s+([^|–\-]+)/i);
        if (m) location = m[1].trim();
      }
    }

    // Room type
    const bodyText = document.body.innerText.toLowerCase();
    let roomType = null;
    for (const kw of ["double", "single", "ensuite", "en-suite", "studio"]) {
      if (bodyText.includes(kw)) { roomType = kw.charAt(0).toUpperCase() + kw.slice(1); break; }
    }

    // Bills included
    const billsIncluded = /bills included/i.test(bodyText) ? true
      : /bills not included|bills excluded/i.test(bodyText) ? false : null;

    // Available date
    const availMatch = document.body.innerText.match(/available\s+(from\s+)?(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}|now|immediately|asap)/i);
    const availableFrom = availMatch ? availMatch[0] : null;

    // Furnished
    let furnished = null;
    if (/\bpart[\s-]furnished\b/i.test(bodyText)) furnished = "Part furnished";
    else if (/\bunfurnished\b/i.test(bodyText)) furnished = "Unfurnished";
    else if (/\bfurnished\b/i.test(bodyText)) furnished = "Furnished";

    // Photos — only large listing photos from photos2.spareroom.co.uk
    const photos = getAll("img")
      .map(img => img.src || img.getAttribute("data-src") || img.getAttribute("data-lazy-src") || "")
      .filter(src =>
        src.includes("photos2.spareroom.co.uk") &&
        src.includes("/listings/large/") &&
        src.match(/\.(jpg|jpeg|png|webp)/i)
      )
      .slice(0, 6);

    // Listing ID from URL
    const idMatch = url.match(/flatshare_id=(\d+)/);
    const listingId = idMatch ? idMatch[1] : null;

    return {
      listingId, title, rent, location,
      description: description ? description.slice(0, 1500) : null,
      roomType, billsIncluded, availableFrom, furnished, photos,
      sourceUrl: url, importedAt: new Date().toISOString()
    };
  }

  // ── Get listing URLs from search results page ─────────────────────────────
  function getListingUrlsFromPage() {
    const seen = new Set();
    const urls = [];
    for (const a of getAll('a[href*="flatshare_detail"][href*="flatshare_id"]')) {
      try {
        const u = new URL(a.href);
        const id = u.searchParams.get("flatshare_id");
        if (id && !seen.has(id)) {
          seen.add(id);
          // Clean URL — just the ID, no tracking params
          urls.push(`https://www.spareroom.co.uk/flatshare/flatshare_detail.pl?flatshare_id=${id}`);
        }
      } catch (e) {}
    }
    return urls.slice(0, 10);
  }

  // ── Build preview panels ──────────────────────────────────────────────────
  function buildSinglePanel(data) {
    const billsText = data.billsIncluded === true ? "✓ Bills included"
      : data.billsIncluded === false ? "✗ Bills not included" : "Bills: unknown";
    return `
      <div id="tenably-panel-inner">
        <div id="tenably-header"><div id="tenably-logo">Tenably</div><button id="tenably-close">✕</button></div>
        <p id="tenably-subtitle">Ready to import this listing</p>
        <div id="tenably-fields">
          <div class="t-field"><span class="t-label">Title</span><span class="t-value">${data.title || "—"}</span></div>
          <div class="t-field"><span class="t-label">Rent</span><span class="t-value">${data.rent || "—"}</span></div>
          <div class="t-field"><span class="t-label">Location</span><span class="t-value">${data.location || "—"}</span></div>
          <div class="t-field"><span class="t-label">Room type</span><span class="t-value">${data.roomType || "—"}</span></div>
          <div class="t-field"><span class="t-label">Bills</span><span class="t-value">${billsText}</span></div>
          <div class="t-field"><span class="t-label">Available</span><span class="t-value">${data.availableFrom || "—"}</span></div>
          <div class="t-field"><span class="t-label">Furnished</span><span class="t-value">${data.furnished || "—"}</span></div>
          <div class="t-field"><span class="t-label">Photos found</span><span class="t-value">${data.photos.length}</span></div>
        </div>
        <button id="tenably-confirm">Add to Tenably →</button>
        <p id="tenably-note">Appended to your Tenably portfolio.</p>
      </div>`;
  }

  function buildBatchPanel(urls) {
    return `
      <div id="tenably-panel-inner">
        <div id="tenably-header"><div id="tenably-logo">Tenably</div><button id="tenably-close">✕</button></div>
        <p id="tenably-subtitle">${urls.length} listing${urls.length !== 1 ? "s" : ""} found on this page</p>
        <div id="tenably-fields">
          ${urls.map((u, i) => {
            const id = u.match(/flatshare_id=(\d+)/)?.[1] || (i + 1);
            return `<div class="t-field">
              <span class="t-label">#${id}</span>
              <span class="t-value" style="font-size:11px;color:#6b8c7e">Listing ${i + 1}</span>
            </div>`;
          }).join("")}
        </div>
        <button id="tenably-confirm">Import all ${urls.length} listings →</button>
        <div id="tenably-progress" style="display:none">
          <div id="tenably-progress-bar"><div id="tenably-progress-fill"></div></div>
          <p id="tenably-progress-text">Opening listings in background...</p>
        </div>
        <p id="tenably-note">Each listing opens in the background, is scraped, then closed.</p>
      </div>`;
  }

  // ── Inject button ─────────────────────────────────────────────────────────
  function injectButton() {
    if (document.getElementById("tenably-btn")) return;
    if (!isSingleListing && !isSearchPage) return;

    const btn = document.createElement("button");
    btn.id = "tenably-btn";

    if (isSearchPage) {
      const urls = getListingUrlsFromPage();
      btn.innerHTML = `<span id="tenably-btn-logo">T</span> Import ${urls.length} listing${urls.length !== 1 ? "s" : ""} to Tenably`;

      btn.addEventListener("click", () => {
        const existing = document.getElementById("tenably-panel");
        if (existing) existing.remove();

        const freshUrls = getListingUrlsFromPage();
        const panel = document.createElement("div");
        panel.id = "tenably-panel";
        panel.innerHTML = buildBatchPanel(freshUrls);
        document.body.appendChild(panel);
        requestAnimationFrame(() => panel.classList.add("tenably-panel-visible"));

        document.getElementById("tenably-close").addEventListener("click", () => {
          panel.classList.remove("tenably-panel-visible");
          setTimeout(() => panel.remove(), 300);
        });

        document.getElementById("tenably-confirm").addEventListener("click", () => {
          document.getElementById("tenably-confirm").style.display = "none";
          const progressDiv  = document.getElementById("tenably-progress");
          const progressText = document.getElementById("tenably-progress-text");
          progressDiv.style.display = "block";
          progressText.textContent = `Starting — 0 of ${freshUrls.length} listings...`;

          chrome.runtime.sendMessage(
            { type: "TENABLY_SCRAPE_BATCH", urls: freshUrls },
            (response) => {
              document.getElementById("tenably-progress-fill").style.width = "100%";
              progressText.textContent = `Done — ${response?.added || 0} new listings added to Tenably`;
            }
          );
        });
      });

    } else {
      // Single listing
      btn.innerHTML = `<span id="tenably-btn-logo">T</span> Import to Tenably`;

      btn.addEventListener("click", () => {
        const existing = document.getElementById("tenably-panel");
        if (existing) existing.remove();

        const data = scrapeListing();
        const panel = document.createElement("div");
        panel.id = "tenably-panel";
        panel.innerHTML = buildSinglePanel(data);
        document.body.appendChild(panel);
        requestAnimationFrame(() => panel.classList.add("tenably-panel-visible"));

        document.getElementById("tenably-close").addEventListener("click", () => {
          panel.classList.remove("tenably-panel-visible");
          setTimeout(() => panel.remove(), 300);
        });

        document.getElementById("tenably-confirm").addEventListener("click", () => {
          chrome.runtime.sendMessage(
            { type: "TENABLY_SAVE_ONE", data },
            (response) => {
              document.getElementById("tenably-confirm").textContent =
                `Added ✓ (${response?.total || "?"} in portfolio)`;
              document.getElementById("tenably-confirm").disabled = true;
            }
          );
        });
      });
    }

    document.body.appendChild(btn);
  }

  injectButton();

})();
