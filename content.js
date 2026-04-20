// Tenably Importer — Content Script v4
// Floating button + rich preview panel with per-listing selection

(function () {

  const url = window.location.href;
  const isSingleListing = url.includes("flatshare_detail") || url.includes("flatshare_id=");
  const isSearchPage    = !isSingleListing && url.includes("spareroom.co.uk/flatshare");

  // ── Global error trap ─────────────────────────────────────────────────────
  // Chrome can throw "Extension context invalidated" at ANY executing JS line
  // (not just Chrome API calls) when the extension is reloaded while this
  // content script is alive.  Catching it here in the capture phase prevents
  // "Uncaught Error" from showing in the console and lets us show a nudge.
  window.addEventListener('error', function (e) {
    if (e.message && e.message.includes('Extension context invalidated')) {
      e.preventDefault();
      e.stopImmediatePropagation();
      showReloadNudge();
    }
  }, true /* capture phase, runs first */);

  // ── Context guard ─────────────────────────────────────────────────────────
  // Wraps any event-handler callback so that:
  //   • A dead extension context is caught before Chrome throws
  //   • Any unexpected throw is swallowed gracefully
  function guard(fn) {
    return function (...args) {
      try {
        if (!chrome.runtime?.id) { showReloadNudge(); return; }
        fn.apply(this, args);
      } catch (e) {
        if (e.message?.includes('invalidated') || !chrome.runtime?.id) {
          showReloadNudge();
        } else {
          throw e; // re-throw genuine bugs
        }
      }
    };
  }

  // ── Helpers ───────────────────────────────────────────────────────────────
  function esc(s) {
    return String(s ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }
  function getText(sel, ctx) {
    const el = (ctx || document).querySelector(sel);
    return el ? el.innerText.trim() : null;
  }
  function getAll(sel, ctx) {
    return Array.from((ctx || document).querySelectorAll(sel));
  }

  // ── Safe runtime messenger ────────────────────────────────────────────────
  // "Extension context invalidated" is thrown when the extension is reloaded
  // while this content script is still alive on the page.  Catch it and show
  // a friendly nudge instead of crashing.
  function safeSend(msg, callback) {
    try {
      if (!chrome.runtime?.id) {
        showReloadNudge();
        return;
      }
      chrome.runtime.sendMessage(msg, (response) => {
        // Also check lastError so Chrome doesn't log an uncaught error
        if (chrome.runtime.lastError) {
          console.warn('Tenably:', chrome.runtime.lastError.message);
          showReloadNudge();
          return;
        }
        if (callback) callback(response);
      });
    } catch (e) {
      console.warn('Tenably runtime error:', e.message);
      showReloadNudge();
    }
  }

  function showReloadNudge() {
    // Show inside the panel footer if open, otherwise fall back to button label
    const footer = document.getElementById('t-footer');
    if (footer) {
      footer.innerHTML = `
        <div style="text-align:center;padding:10px 4px">
          <p style="color:#F09090;font-size:12px;margin:0 0 8px">
            Extension was reloaded — please <strong>refresh this tab</strong> and try again.
          </p>
          <button onclick="location.reload()"
            style="background:#4A5C3A;color:#F5F2EC;border:none;border-radius:7px;
                   padding:8px 20px;font-size:13px;font-weight:600;cursor:pointer">
            Refresh page
          </button>
        </div>`;
      return;
    }
    const btn = document.getElementById('tenably-btn');
    if (btn) btn.title = 'Extension reloaded — refresh this page first';
  }

  // ── Background message listener ───────────────────────────────────────────
  try {
    chrome.runtime.onMessage.addListener((msg) => {
      if (msg.type === 'TENABLY_SCRAPE_THIS') {
        safeSend({ type: 'TENABLY_SCRAPED', data: scrapeListing() });
      }
      if (msg.type === 'TENABLY_PROGRESS') {
        const fill = document.getElementById('tenably-progress-fill');
        const text = document.getElementById('tenably-progress-text');
        if (fill) fill.style.width = `${(msg.done / msg.total) * 100}%`;
        if (text) text.textContent = `Scraped ${msg.done} of ${msg.total}…`;
      }
    });
  } catch (_) { /* context already gone on initial load — no-op */ }

  // ── Full scraper (runs on individual listing page) ────────────────────────
  function scrapeListing() {
    const bodyText = document.body.innerText;
    const title    = getText('h1') || document.title || 'Untitled';

    const priceEl = document.querySelector('[class*="price"]');
    let rent = null;
    if (priceEl) {
      rent = priceEl.innerText.split('\n')[0].trim();
      if (!rent.includes('£')) rent = null;
    }
    if (!rent) {
      const m = bodyText.match(/£[\d,]+\s*(pcm|pw|per\s+month|per\s+week)/i);
      rent = m ? m[0] : null;
    }

    const description = getText('p.detaildesc') || null;

    let location = getText('.key-features__area-info') || null;
    if (!location) {
      const sub = document.querySelector('h2,[class*="subtitle"],[class*="subheading"]');
      if (sub && sub.innerText.length < 60) location = sub.innerText.trim();
    }
    if (!location) {
      const titleEl = document.querySelector('title');
      if (titleEl) {
        const m = titleEl.innerText.match(/in\s+([^|–\-]+)/i);
        if (m) location = m[1].trim();
      }
    }

    const bt = bodyText.toLowerCase();
    let roomType = null;
    for (const kw of ['ensuite','en-suite','large double','double','single','studio']) {
      if (bt.includes(kw)) { roomType = kw[0].toUpperCase() + kw.slice(1); break; }
    }

    const billsIncluded = /bills included/i.test(bt) ? true
      : /bills not included|bills excluded/i.test(bt) ? false : null;

    const availMatch = bodyText.match(/available\s+(from\s+)?(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}|now|immediately|asap)/i);
    const availableFrom = availMatch ? availMatch[0] : null;

    let furnished = null;
    if (/\bpart[\s-]furnished\b/i.test(bt)) furnished = 'Part furnished';
    else if (/\bunfurnished\b/i.test(bt))   furnished = 'Unfurnished';
    else if (/\bfurnished\b/i.test(bt))     furnished = 'Furnished';

    // ── Photos: mine every img attribute + inline script JSON ────────────────
    const _rawPhotoUrls = new Set();

    // Check every <img> for all lazy-load attribute variants + srcset
    getAll('img').forEach(img => {
      for (const attr of ['src','data-src','data-lazy-src','data-original','data-lazy','data-full-src','data-image']) {
        const v = img.getAttribute(attr);
        if (v && v.startsWith('http')) _rawPhotoUrls.add(v);
      }
      for (const attr of ['srcset','data-srcset']) {
        const ss = img.getAttribute(attr);
        if (!ss) continue;
        ss.split(',').forEach(part => {
          const u = part.trim().split(/\s+/)[0];
          if (u && u.startsWith('http')) _rawPhotoUrls.add(u);
        });
      }
    });

    // Mine inline <script> tags — SpareRoom sometimes embeds gallery JSON
    getAll('script:not([src])').forEach(el => {
      const hits = el.textContent.matchAll(
        /https?:\/\/[^\s"'\\]*spareroom\.co\.uk[^\s"'\\]*\.(?:jpg|jpeg|png|webp)/gi
      );
      for (const m of hits) _rawPhotoUrls.add(m[0]);
    });

    const photos = Array.from(_rawPhotoUrls)
      .filter(src =>
        src.includes('spareroom.co.uk') &&
        /\.(jpg|jpeg|png|webp)/i.test(src) &&
        !/logo|icon|avatar|sprite|map|flag/i.test(src)
      )
      // Prefer largest size variant
      .sort((a, b) => {
        const rank = s => s.includes('large') ? 3 : s.includes('medium') ? 2
                        : (s.includes('small') || s.includes('thumb')) ? 0 : 1;
        return rank(b) - rank(a);
      })
      // De-dupe: strip size suffix from filename, keep first (largest) per base name
      .filter((src, idx, arr) => {
        const base = src.split('/').pop().split('?')[0]
          .replace(/_(?:large|medium|small|thumb\d*)\./i, '.');
        return arr.findIndex(s =>
          s.split('/').pop().split('?')[0]
            .replace(/_(?:large|medium|small|thumb\d*)\./i, '.') === base
        ) === idx;
      })
      .slice(0, 20);

    const idMatch = url.match(/flatshare_id=(\d+)/);
    const listingId = idMatch ? idMatch[1] : null;

    return {
      listingId, title, rent, location,
      description: description ? description.slice(0, 1500) : null,
      roomType, billsIncluded, availableFrom, furnished, photos,
      sourceUrl: url, importedAt: new Date().toISOString(),
    };
  }

  // ── Quick scraper from search-result cards ────────────────────────────────
  // Extracts preview data from visible listing cards on the search page —
  // no background tabs needed, instant preview.
  function scrapeSearchResultCards() {
    const seen    = new Set();
    const results = [];

    for (const a of getAll('a[href*="flatshare_detail"][href*="flatshare_id"]')) {
      try {
        const u  = new URL(a.href);
        const id = u.searchParams.get('flatshare_id');
        if (!id || seen.has(id)) continue;
        seen.add(id);

        // Walk up DOM to find the card container
        let card = a.parentElement;
        for (let i = 0; i < 10; i++) {
          if (!card || !card.parentElement) break;
          const tag = card.tagName.toLowerCase();
          const cls = (card.className || '').toString();
          if (['article', 'li', 'section'].includes(tag)) break;
          if (/listing|result|property|item/i.test(cls) && card.getBoundingClientRect().height > 80) break;
          card = card.parentElement;
        }
        if (!card) continue;

        const cardText = card.innerText || '';

        // Title
        const titleEl = card.querySelector('h2, h3, h4, [class*="title"]');
        const title   = ((titleEl || a).innerText || '').trim().split('\n')[0].slice(0, 120) || 'Untitled';

        // Rent
        let rent = null;
        const priceEl = card.querySelector('[class*="price"], [class*="cost"], strong');
        if (priceEl) {
          const pt = priceEl.innerText.trim().split('\n')[0];
          if (/£/.test(pt)) rent = pt.replace(/\s+/g, ' ').trim();
        }
        if (!rent) {
          const m = cardText.match(/£[\d,]+\s*(pcm|pw)/i);
          if (m) rent = m[0];
        }

        // Location
        const locEl  = card.querySelector('[class*="location"],[class*="area"],[class*="address"],[class*="place"]');
        const location = locEl ? locEl.innerText.trim().split('\n')[0] : null;

        // Room type
        const ct = cardText.toLowerCase();
        let roomType = null;
        for (const kw of ['ensuite','en-suite','large double','double','single','studio']) {
          if (ct.includes(kw)) { roomType = kw[0].toUpperCase() + kw.slice(1); break; }
        }

        // Bills
        const billsIncluded = /bills included/i.test(cardText) ? true
          : /bills not included/i.test(cardText) ? false : null;

        // Available
        const availMatch   = cardText.match(/available\s+(?:from\s+)?([^\n]{4,40})/i);
        const availableFrom = availMatch ? availMatch[0].trim().slice(0, 50) : null;

        // Furnished
        let furnished = null;
        if (/part[\s-]furnished/i.test(ct)) furnished = 'Part furnished';
        else if (/unfurnished/i.test(ct))   furnished = 'Unfurnished';
        else if (/furnished/i.test(ct))     furnished = 'Furnished';

        // Photos from card — check all lazy-load attributes on every img
        const _cardPhotos = [];
        for (const img of getAll('img', card)) {
          for (const attr of ['src','data-src','data-lazy-src','data-original','data-lazy']) {
            const src = img.getAttribute(attr) || '';
            if (
              src.startsWith('http') &&
              src.includes('spareroom') &&
              /\.(jpg|jpeg|png|webp)/i.test(src) &&
              !/logo|icon|avatar|sprite/i.test(src)
            ) {
              _cardPhotos.push(src);
              break; // one URL per img element
            }
          }
        }

        results.push({
          listingId:    id,
          title,
          rent,
          location,
          roomType,
          billsIncluded,
          availableFrom,
          furnished,
          photos:       _cardPhotos,
          sourceUrl:    `https://www.spareroom.co.uk/flatshare/flatshare_detail.pl?flatshare_id=${id}`,
          importedAt:   new Date().toISOString(),
        });

        if (results.length >= 10) break;
      } catch (_) {}
    }

    return results;
  }

  // ── HTML helpers ──────────────────────────────────────────────────────────
  function chip(text, type) {
    if (!text) return '';
    return `<span class="t-chip t-chip-${esc(type)}">${esc(text)}</span>`;
  }

  // ── Build a single preview card (for batch list) ──────────────────────────
  function listingCardHtml(listing, idx) {
    const key   = listing.listingId || String(idx);
    const photo = listing.photos && listing.photos[0];

    const thumbHtml = photo
      ? `<div class="t-thumb"><img src="${esc(photo)}" alt="" onerror="this.parentElement.innerHTML='<div class=t-thumb-ph>🏠</div>'" /></div>`
      : `<div class="t-thumb t-thumb-ph">🏠</div>`;

    const chips = [
      listing.roomType       ? chip(listing.roomType, 'dim')   : '',
      listing.billsIncluded === true  ? chip('Bills ✓', 'green') : '',
      listing.billsIncluded === false ? chip('No bills', 'red')  : '',
      listing.furnished      ? chip(listing.furnished, 'dim')  : '',
    ].join('');

    const expandedHtml = `
      <div class="t-expanded" style="display:none">
        <div class="t-desc t-desc-placeholder">Full description &amp; extra photos fetched on import.</div>
        <div class="t-detail-row">
          <span>Listing ID</span><span>#${esc(listing.listingId || '—')}</span>
        </div>
        ${listing.availableFrom ? `<div class="t-detail-row"><span>Available</span><span>${esc(listing.availableFrom)}</span></div>` : ''}
        ${listing.sourceUrl     ? `<div class="t-detail-row"><span>Source</span><a class="t-src-link" href="${esc(listing.sourceUrl)}" target="_blank">SpareRoom ↗</a></div>` : ''}
      </div>`;

    return `
      <div class="t-card" data-key="${esc(key)}">
        <div class="t-card-top">
          <label class="t-cb-wrap">
            <input type="checkbox" class="t-cb" data-key="${esc(key)}" checked />
            <span class="t-cb-box"></span>
          </label>
          ${thumbHtml}
          <div class="t-card-info">
            <div class="t-card-title">${esc(listing.title.slice(0, 80))}</div>
            ${listing.rent     ? `<div class="t-rent">${esc(listing.rent)}</div>` : ''}
            ${listing.location ? `<div class="t-location">📍 ${esc(listing.location)}</div>` : ''}
            <div class="t-chips">${chips}</div>
          </div>
        </div>
        <div class="t-card-foot">
          <button class="t-expand-btn" data-key="${esc(key)}">▾ Details</button>
          ${listing.sourceUrl ? `<a class="t-src-link" href="${esc(listing.sourceUrl)}" target="_blank">View ↗</a>` : ''}
        </div>
        ${expandedHtml}
      </div>`;
  }

  // ── Batch panel HTML (search results page) ────────────────────────────────
  function buildBatchPanel(listings) {
    if (listings.length === 0) {
      return `
        <div id="tenably-panel-inner">
          <div id="t-header">
            <div id="t-logo-wrap"><span id="t-logo">Tenably</span></div>
            <button id="t-close">✕</button>
          </div>
          <div class="t-empty">No listings detected on this page.</div>
        </div>`;
    }

    return `
      <div id="tenably-panel-inner">
        <div id="t-header">
          <div id="t-logo-wrap">
            <span id="t-logo">Tenably</span>
            <span id="t-subtitle">${listings.length} listing${listings.length !== 1 ? 's' : ''} on this page</span>
          </div>
          <button id="t-close">✕</button>
        </div>

        <div id="t-select-bar">
          <label class="t-cb-wrap">
            <input type="checkbox" id="t-select-all" checked />
            <span class="t-cb-box"></span>
          </label>
          <span id="t-sel-label">All ${listings.length} selected</span>
        </div>

        <div id="t-list">
          ${listings.map((l, i) => listingCardHtml(l, i)).join('')}
        </div>

        <div id="t-footer">
          <button id="t-confirm">
            Import <span id="t-sel-count">${listings.length}</span> selected →
          </button>
          <div id="tenably-progress" style="display:none">
            <div id="tenably-progress-bar"><div id="tenably-progress-fill"></div></div>
            <p id="tenably-progress-text">Opening listings in background…</p>
          </div>
          <p id="t-note">Full descriptions &amp; photos fetched on import</p>
        </div>
      </div>`;
  }

  // ── Single listing panel HTML ─────────────────────────────────────────────
  function buildSinglePanel(data) {
    const photo = data.photos && data.photos[0];

    // Photo hero + strip
    let photoBlock = '';
    if (photo) {
      const strip = data.photos.length > 1
        ? `<div class="t-photo-strip">
            ${data.photos.slice(1, 4).map(src => `<img src="${esc(src)}" alt="" onerror="this.style.display='none'" />`).join('')}
            ${data.photos.length > 4 ? `<div class="t-photo-more">+${data.photos.length - 4}</div>` : ''}
           </div>`
        : '';
      photoBlock = `<div class="t-hero"><img src="${esc(photo)}" alt="" />${strip}</div>`;
    }

    // Key fields table
    const billsText = data.billsIncluded === true  ? '✓ Bills included'
                    : data.billsIncluded === false ? '✗ Not included' : '—';

    const fields = [
      ['Room type',    data.roomType],
      ['Bills',        billsText !== '—' ? billsText : null],
      ['Available',    data.availableFrom],
      ['Furnished',    data.furnished],
      ['Photos found', data.photos.length > 0 ? `${data.photos.length} photo${data.photos.length !== 1 ? 's' : ''}` : 'None'],
      ['Listing ID',   data.listingId ? `#${data.listingId}` : null],
    ].filter(r => r[1]);

    const fieldsHtml = fields.map(([label, val]) => `
      <div class="t-field">
        <span class="t-label">${esc(label)}</span>
        <span class="t-value">${esc(val)}</span>
      </div>`).join('');

    const short = data.description ? data.description.slice(0, 220) : null;
    const hasMore = data.description && data.description.length > 220;

    const descHtml = data.description ? `
      <div class="t-section-label">Description</div>
      <div class="t-desc-full" id="t-desc-text">${esc(short)}${hasMore ? '…' : ''}</div>
      ${hasMore ? `<button class="t-expand-btn" id="t-read-more">Read more ▾</button>` : ''}
    ` : '';

    return `
      <div id="tenably-panel-inner">
        <div id="t-header">
          <div id="t-logo-wrap">
            <span id="t-logo">Tenably</span>
            <span id="t-subtitle">Preview before import</span>
          </div>
          <button id="t-close">✕</button>
        </div>

        <div id="t-list">
          ${photoBlock}
          <div class="t-single-body">
            <div class="t-card-title" style="font-size:14px;margin-bottom:5px">${esc(data.title)}</div>
            ${data.rent     ? `<div class="t-rent" style="font-size:18px;margin-bottom:8px">${esc(data.rent)}</div>` : ''}
            ${data.location ? `<div class="t-location" style="margin-bottom:14px">📍 ${esc(data.location)}</div>` : ''}
            <div id="t-fields">${fieldsHtml}</div>
            ${descHtml}
          </div>
        </div>

        <div id="t-footer">
          <button id="t-confirm">Add to Tenably →</button>
          <p id="t-note">Appended to your portfolio on Tenably.</p>
        </div>
      </div>`;
  }

  // ── Wire up all panel interactivity ───────────────────────────────────────
  function wirePanel(panel, listings, isBatch, data) {

    // Close — no Chrome APIs, but guard anyway
    panel.querySelector('#t-close').addEventListener('click', guard(() => {
      panel.classList.remove('tenably-panel-visible');
      setTimeout(() => panel.remove(), 280);
    }));

    if (isBatch) {
      // ── Select-all ──────────────────────────────────────────────────────
      const selectAll = panel.querySelector('#t-select-all');
      const selLabel  = panel.querySelector('#t-sel-label');
      const selCount  = panel.querySelector('#t-sel-count');
      const allCbs    = () => panel.querySelectorAll('.t-cb');

      function refreshCount() {
        const n = panel.querySelectorAll('.t-cb:checked').length;
        selCount.textContent        = n;
        selLabel.textContent        = `${n} of ${listings.length} selected`;
        selectAll.checked           = (n === listings.length);
        selectAll.indeterminate     = (n > 0 && n < listings.length);
      }

      selectAll.addEventListener('change', guard(() => {
        allCbs().forEach(cb => {
          cb.checked = selectAll.checked;
          cb.closest('.t-card').classList.toggle('t-card-dim', !selectAll.checked);
        });
        refreshCount();
      }));

      allCbs().forEach(cb => {
        cb.addEventListener('change', guard(() => {
          cb.closest('.t-card').classList.toggle('t-card-dim', !cb.checked);
          refreshCount();
        }));
      });

      // ── Expand / collapse cards ─────────────────────────────────────────
      panel.querySelectorAll('.t-expand-btn').forEach(btn => {
        btn.addEventListener('click', guard(() => {
          const card     = btn.closest('.t-card');
          const expanded = card.querySelector('.t-expanded');
          const open     = expanded.style.display !== 'none';
          expanded.style.display = open ? 'none' : 'block';
          btn.textContent        = open ? '▾ Details' : '▴ Hide';
        }));
      });

      // ── Confirm / import selected ───────────────────────────────────────
      const confirmBtn = panel.querySelector('#t-confirm');
      confirmBtn.addEventListener('click', guard(() => {
        const checkedKeys = new Set(
          Array.from(panel.querySelectorAll('.t-cb:checked')).map(cb => cb.dataset.key)
        );
        const selected = listings.filter((l, i) => checkedKeys.has(l.listingId || String(i)));
        const urls     = selected.map(l => l.sourceUrl);
        if (!urls.length) return;

        confirmBtn.style.display = 'none';
        const progressDiv = panel.querySelector('#tenably-progress');
        const progressTxt = panel.querySelector('#tenably-progress-text');
        progressDiv.style.display = 'block';
        progressTxt.textContent   = `Starting — 0 of ${urls.length} listings…`;

        safeSend({ type: 'TENABLY_SCRAPE_BATCH', urls }, (response) => {
          panel.querySelector('#tenably-progress-fill').style.width = '100%';
          progressTxt.textContent = `Done — ${response?.added || 0} new listings added`;
        });
      }));

    } else {
      // ── Single: read-more toggle ────────────────────────────────────────
      const readMoreBtn = panel.querySelector('#t-read-more');
      const descEl      = panel.querySelector('#t-desc-text');
      if (readMoreBtn && descEl && data.description) {
        const short = data.description.slice(0, 220) + '…';
        let expanded = false;
        readMoreBtn.addEventListener('click', guard(() => {
          expanded = !expanded;
          descEl.textContent      = expanded ? data.description : short;
          readMoreBtn.textContent = expanded ? 'Show less ▴' : 'Read more ▾';
        }));
      }

      // ── Single: confirm ─────────────────────────────────────────────────
      const confirmBtn = panel.querySelector('#t-confirm');
      confirmBtn.addEventListener('click', guard(() => {
        safeSend({ type: 'TENABLY_SAVE_ONE', data }, (response) => {
          confirmBtn.textContent = `Added ✓ (${response?.total || '?'} in portfolio)`;
          confirmBtn.disabled    = true;
        });
      }));
    }
  }

  // ── Inject floating button into SpareRoom ─────────────────────────────────
  function injectButton() {
    if (document.getElementById('tenably-btn')) return;
    if (!isSingleListing && !isSearchPage) return;

    const btn = document.createElement('button');
    btn.id = 'tenably-btn';

    if (isSearchPage) {
      // Count unique listing IDs visible on page
      const idSet = new Set();
      getAll('a[href*="flatshare_detail"][href*="flatshare_id"]').forEach(a => {
        try { idSet.add(new URL(a.href).searchParams.get('flatshare_id')); } catch (_) {}
      });
      const n = Math.min(idSet.size, 10);
      btn.innerHTML = `<span id="tenably-btn-logo">T</span> Preview ${n} listing${n !== 1 ? 's' : ''}`;

      btn.addEventListener('click', guard(() => {
        const existing = document.getElementById('tenably-panel');
        if (existing) { existing.remove(); return; }   // toggle off

        const listings = scrapeSearchResultCards();
        const panel    = document.createElement('div');
        panel.id       = 'tenably-panel';
        panel.innerHTML = buildBatchPanel(listings);
        document.body.appendChild(panel);
        requestAnimationFrame(() => panel.classList.add('tenably-panel-visible'));
        wirePanel(panel, listings, true, null);
      }));

    } else {
      btn.innerHTML = `<span id="tenably-btn-logo">T</span> Import to Tenably`;

      btn.addEventListener('click', guard(() => {
        const existing = document.getElementById('tenably-panel');
        if (existing) { existing.remove(); return; }   // toggle off

        const data  = scrapeListing();
        const panel = document.createElement('div');
        panel.id    = 'tenably-panel';
        panel.innerHTML = buildSinglePanel(data);
        document.body.appendChild(panel);
        requestAnimationFrame(() => panel.classList.add('tenably-panel-visible'));
        wirePanel(panel, null, false, data);
      }));
    }

    document.body.appendChild(btn);
  }

  // ── Run ───────────────────────────────────────────────────────────────────
  injectButton();

})();
