// Tenably dashboard — listings + tenants tabs

// ── State ─────────────────────────────────────────────────────────────────
let allListings  = [];
let activeFilter = 'all';
const SCORED_TENANTS = buildScoredTenants(1400); // scored against £1,400/mo benchmark

// ── Demo listings ─────────────────────────────────────────────────────────
const DEMO_LISTINGS = [
  {
    listingId: "demo1",
    title: "Bright double room in modern Bethnal Green flatshare",
    rent: "£1,050 pcm", location: "Bethnal Green, London E2",
    roomType: "Double", billsIncluded: true,
    availableFrom: "Available from 1 May", furnished: "Furnished",
    description: "A bright, spacious double room in a well-kept 3-bed flat. Recently refurbished kitchen, fast broadband, and a private garden shared between flatmates.",
    photos: [], sourceUrl: null, importedAt: new Date().toISOString(),
  },
  {
    listingId: "demo2",
    title: "Ensuite room in Shoreditch — all bills included",
    rent: "£1,300 pcm", location: "Shoreditch, London E1",
    roomType: "Ensuite", billsIncluded: true,
    availableFrom: "Available now", furnished: "Furnished",
    description: "Modern ensuite in a stylish 4-bed house share. 5 minutes from Shoreditch High Street Overground. Young professionals only.",
    photos: [], sourceUrl: null, importedAt: new Date().toISOString(),
  },
];

// ── Mock applicants (per-listing, scored at listing's rent) ───────────────
function getMockApplicants(monthlyRentStr) {
  const rent = parseInt((monthlyRentStr || "1200").replace(/\D/g, ""), 10) || 1200;
  // Pick a consistent subset of the 50 tenants as applicants for this listing
  const subset = SCORED_TENANTS.slice(0, 8);
  return subset.slice(0, 3).map(t => scoreApplicant(t, rent) && t);
}

// ── Chip HTML ─────────────────────────────────────────────────────────────
function chipHtml(data) {
  return [
    data.rent          ? `<span class="chip chip-rent">${data.rent}</span>`          : "",
    data.roomType      ? `<span class="chip">${data.roomType} room</span>`            : "",
    data.billsIncluded ? `<span class="chip">Bills included</span>`                   : "",
    data.furnished     ? `<span class="chip">${data.furnished}</span>`                : "",
    data.availableFrom ? `<span class="chip">${data.availableFrom}</span>`            : "",
  ].filter(Boolean).join("");
}

// ── Applicant card (per-listing sidebar) ─────────────────────────────────
function applicantCardHtml(tenant, rank, monthlyRentStr) {
  const rent    = parseInt((monthlyRentStr || "1200").replace(/\D/g, ""), 10) || 1200;
  const result  = scoreApplicant(tenant, rent);
  const { score, tier, breakdown, canInvite } = result;

  const scoreClass = `score-${tier}`;
  const topBadge   = rank === 0
    ? `<div class="top-match-badge">&#9733; Top match</div>` : "";

  return `
    <div class="applicant-card" style="animation-delay:${0.15 + rank * 0.08}s">
      ${topBadge}
      <div class="applicant-header">
        <div class="applicant-avatar" style="background:var(--accent-tint);color:var(--accent)">${tenant.initials}</div>
        <div class="applicant-info">
          <div class="applicant-name">${tenant.name}</div>
          <div class="applicant-role">${tenant.jobTitle}</div>
        </div>
        <div class="applicant-score">
          <div class="score-number ${scoreClass}">${score}</div>
          <div class="score-label">Trust score</div>
        </div>
      </div>
      <hr class="applicant-divider" />
      <div class="indicators">
        ${breakdown.map(b => `
          <div class="indicator indicator-${b.status}">
            <span class="ind-dot"></span>
            <span class="ind-text">${b.text}</span>
          </div>`).join("")}
      </div>
      ${canInvite
        ? `<button class="invite-btn invite-btn-active" onclick="this.textContent='Invited \u2713';this.className='invite-btn invite-btn-disabled';this.disabled=true">Invite to viewing</button>`
        : `<button class="invite-btn invite-btn-disabled" disabled>Cannot invite — criteria not met</button>`}
    </div>`;
}

// ── Listing block ─────────────────────────────────────────────────────────
function listingBlockHtml(listing, idx) {
  const photoHtml = listing.photos && listing.photos.length > 0
    ? `<div class="listing-photo">
         <img src="${listing.photos[0]}" alt="" onerror="this.parentElement.innerHTML='<div class=\\"photo-placeholder\\"><div class=\\"photo-placeholder-icon\\">&#127968;</div><span>No photos</span></div>'" />
         ${listing.photos.length > 1 ? `<div class="photo-count">+${listing.photos.length - 1} photos</div>` : ""}
       </div>`
    : `<div class="listing-photo"><div class="photo-placeholder"><div class="photo-placeholder-icon">&#127968;</div><span>No photos imported</span></div></div>`;

  // Use first 3 top-scored tenants as applicants for this listing
  const applicantTenants = SCORED_TENANTS.slice(0, 3);
  const applicantsHtml   = applicantTenants.map((t, i) => applicantCardHtml(t, i, listing.rent)).join("");

  return `
    <div class="listing-block" style="animation-delay:${0.1 + idx * 0.1}s">
      <div class="listing-card">
        ${photoHtml}
        <div class="listing-body">
          <p class="listing-meta">Listing ${idx + 1}${listing.sourceUrl ? ` &nbsp;·&nbsp; <a href="${listing.sourceUrl}" target="_blank">View on SpareRoom &#8599;</a>` : ""}</p>
          <h2 class="listing-title">${listing.title}</h2>
          ${listing.location ? `<p class="listing-location">&#128205; ${listing.location}</p>` : ""}
          <div class="listing-chips">${chipHtml(listing)}</div>
          ${listing.description ? `<p class="listing-desc-label">Description</p><p class="listing-desc">${listing.description}</p>` : ""}
        </div>
      </div>
      <aside class="applicants">
        <div class="applicants-header">
          <span class="applicants-title">Applicants</span>
          <span class="applicants-count">3 enquiries</span>
        </div>
        <p class="applicants-subtitle">Pre-verified &middot; ranked by readiness</p>
        ${applicantsHtml}
      </aside>
    </div>`;
}

// ── Render: listings tab ──────────────────────────────────────────────────
function renderListings(listings) {
  const container = document.getElementById("page-content");
  const isDemo    = listings === DEMO_LISTINGS;

  const noticeText = isDemo
    ? "Demo mode — go to SpareRoom and click the Tenably button to import real listings"
    : `${listings.length} listing${listings.length !== 1 ? "s" : ""} in your portfolio`;
  const clearBtn = isDemo ? "" : `<button class="clear-btn" onclick="clearAll()">Clear all</button>`;

  container.innerHTML = `
    <div class="import-notice">
      <span class="import-pulse"></span>
      <span>${noticeText}</span>
      ${clearBtn}
    </div>
    ${listings.map((l, i) => listingBlockHtml(l, i)).join('<hr class="listing-divider" />')}
  `;
}

// ── Render: tenants tab ───────────────────────────────────────────────────
function renderTenants(tenants) {
  const container = document.getElementById("page-content");

  const counts = {
    all:         tenants.length,
    ready:       tenants.filter(t => t.canInvite).length,
    incomplete:  tenants.filter(t => !t.canInvite && t.score >= 40).length,
    unqualified: tenants.filter(t => t.score < 40).length,
  };

  const filterLabels = [
    { key: "all",         label: "All",               count: counts.all         },
    { key: "ready",       label: "Ready to invite",   count: counts.ready       },
    { key: "incomplete",  label: "Incomplete",        count: counts.incomplete  },
    { key: "unqualified", label: "Does not qualify",  count: counts.unqualified },
  ];

  const pillsHtml = filterLabels.map(f => `
    <button class="filter-pill${activeFilter === f.key ? " active" : ""}"
            onclick="setFilter('${f.key}')">
      ${f.label} <span class="pill-count">${f.count}</span>
    </button>`).join("");

  const rowsHtml = tenants.map((t, i) => {
    const visible = (
      activeFilter === "all" ||
      (activeFilter === "ready"       && t.canInvite) ||
      (activeFilter === "incomplete"  && !t.canInvite && t.score >= 40) ||
      (activeFilter === "unqualified" && t.score < 40)
    );

    const scoreClass  = `score-${t.tier}`;
    const avatarClass = `avatar-${t.tier}`;
    const incomeStr   = t.annualIncome > 0 ? `£${Math.round(t.annualIncome / 1000)}k` : "—";
    const empShort    = {
      permanent: "Permanent", fixedTerm: "Fixed-term", contractor: "Contractor",
      selfEmployed2plus: "Self-emp.", selfEmployed: "Self-emp.",
      partTime: "Part-time", student: "Student", unemployed: "Unemployed",
    }[t.employmentType] || t.employmentType;

    const docPips = [
      { key: "id",             label: "ID"  },
      { key: "payslips",       label: "Pay" },
      { key: "bankStatements", label: "Bnk" },
    ].map(d => `<span class="doc-pip ${t.docs[d.key] ? "ok" : "no"}" title="${d.key}">${d.label}</span>`).join("");

    const refsStr = `${t.references}/2`;
    const rtrStr  = t.rightToRent ? "&#10003;" : "&#8212;";
    const rtrColor = t.rightToRent ? "color:var(--green)" : "color:var(--text-3)";

    const actionBtn = t.canInvite
      ? `<button class="row-invite-btn row-invite-active" onclick="this.textContent='Invited \u2713';this.className='row-invite-btn row-invite-disabled';this.disabled=true">Invite</button>`
      : `<button class="row-invite-btn row-invite-disabled" disabled>—</button>`;

    return `
      <div class="tenant-row${visible ? "" : " hidden"}" data-id="${t.id}" data-tier="${t.tier}">
        <div class="td td-rank">${i + 1}</div>
        <div class="td"><div class="td-avatar ${avatarClass}">${t.initials}</div></div>
        <div class="td">
          <div class="td-name">${t.name}</div>
          <div class="td-job">${t.jobTitle}</div>
        </div>
        <div class="td td-emp">${empShort}</div>
        <div class="td td-income">${incomeStr}</div>
        <div class="td td-docs">${docPips}</div>
        <div class="td td-refs">${refsStr}</div>
        <div class="td td-rtr" style="${rtrColor}">${rtrStr}</div>
        <div class="td td-score ${scoreClass}">${t.score}</div>
        <div class="td td-action">${actionBtn}</div>
      </div>`;
  }).join("");

  container.innerHTML = `
    <div class="tenants-header">
      <div>
        <div class="tenants-title">All tenants</div>
        <div class="tenants-subtitle">Scored against £1,400/mo benchmark &middot; ranked by readiness</div>
      </div>
    </div>
    <div class="filter-pills">${pillsHtml}</div>
    <div class="tenants-table">
      <div class="tenants-table-head">
        <div class="th">#</div>
        <div class="th"></div>
        <div class="th">Applicant</div>
        <div class="th">Employment</div>
        <div class="th">Income</div>
        <div class="th">Docs</div>
        <div class="th">Refs</div>
        <div class="th">RTR</div>
        <div class="th">Score</div>
        <div class="th"></div>
      </div>
      ${rowsHtml}
    </div>
  `;
}

// ── Filter handler (called from filter pills) ─────────────────────────────
function setFilter(filter) {
  activeFilter = filter;
  renderTenants(SCORED_TENANTS);
}

// ── Tab switch (called from tenably.html script) ──────────────────────────
function switchTab(tab) {
  if (tab === "listings") renderListings(allListings);
  else                    renderTenants(SCORED_TENANTS);
}

// ── Helpers ───────────────────────────────────────────────────────────────
function clearAll() {
  if (!confirm("Remove all imported listings?")) return;
  if (typeof chrome !== "undefined" && chrome.storage) {
    chrome.storage.local.remove("tenably_listings", () => location.reload());
  }
}

// ── Boot ──────────────────────────────────────────────────────────────────
if (typeof chrome !== "undefined" && chrome.storage) {
  chrome.storage.local.get(["tenably_listings"], (result) => {
    allListings = (result.tenably_listings && result.tenably_listings.length > 0)
      ? result.tenably_listings
      : DEMO_LISTINGS;
    renderListings(allListings);
  });
} else {
  allListings = DEMO_LISTINGS;
  renderListings(allListings);
}
