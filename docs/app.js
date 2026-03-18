const $ = (id) => document.getElementById(id);

const roleSearch = $("roleSearch");
const resultsEl = $("results");
const selectedEl = $("selected");
const metaEl = $("meta");
const adSlotEl = $("adSlot");

function setupAdSense() {
  if (!adSlotEl) return;

  const cfg = window.SITE_CONFIG || {};
  const client = String(cfg.ADSENSE_CLIENT || "").trim();
  const slot = String(cfg.ADSENSE_SLOT || "").trim();

  if (!client || !slot) {
    adSlotEl.innerHTML = '<div class="muted">Ad slot (disabled).</div>';
    return;
  }

  const script = document.createElement("script");
  script.async = true;
  script.src = `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${encodeURIComponent(
    client
  )}`;
  script.crossOrigin = "anonymous";
  document.head.appendChild(script);

  adSlotEl.innerHTML = `
    <ins class="adsbygoogle"
      style="display:block"
      data-ad-client="${escapeHtml(client)}"
      data-ad-slot="${escapeHtml(slot)}"
      data-ad-format="auto"
      data-full-width-responsive="true"></ins>
  `;

  (window.adsbygoogle = window.adsbygoogle || []).push({});
}

function fmtGBP(value) {
  if (value == null || Number.isNaN(value)) return "—";
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "GBP",
    maximumFractionDigits: 0
  }).format(value);
}

function norm(s) {
  return String(s || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function escapeHtml(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

async function loadJSON(path) {
  const res = await fetch(path, { cache: "no-store" });
  if (!res.ok) throw new Error(`Failed to load ${path}: ${res.status}`);
  return await res.json();
}

function renderResults(items, onPick) {
  if (!items.length) {
    resultsEl.innerHTML =
      '<div class="muted">Start typing a job or occupation group above to see typical pay.</div>';
    return;
  }

  resultsEl.innerHTML = items
    .map((r) => {
      const title = escapeHtml(r.title);
      return `
        <div class="result">
          <div>
            <div class="resultTitle">${title}</div>
          </div>
          <button data-soc="${escapeHtml(r.soc2)}">Select</button>
        </div>
      `;
    })
    .join("");

  resultsEl.querySelectorAll("button[data-soc]").forEach((btn) => {
    btn.addEventListener("click", () => onPick(btn.dataset.soc));
  });
}

function renderSelected(role, earnings, meta) {
  if (!role || !earnings) {
    selectedEl.classList.add("muted");
    selectedEl.textContent = "Nothing selected yet.";
    return;
  }

  selectedEl.classList.remove("muted");
  selectedEl.innerHTML = `
    <div class="kv"><div class="k">Occupation group</div><div class="v">${escapeHtml(
      role.title
    )}</div></div>
    <div class="kv"><div class="k">Year</div><div class="v">${escapeHtml(
      String(earnings.year ?? meta?.year ?? "")
    )}</div></div>
    <div class="kv"><div class="k">Median gross weekly pay (all employees)</div><div class="v">${fmtGBP(
      earnings.median_weekly_all
    )}</div></div>
    <div class="kv"><div class="k">Mean gross weekly pay (all employees)</div><div class="v">${fmtGBP(
      earnings.mean_weekly_all
    )}</div></div>
    <div class="kv"><div class="k">Median gross annual pay (all employees)</div><div class="v">${fmtGBP(
      earnings.median_annual_all
    )}</div></div>
    <div class="kv"><div class="k">Mean gross annual pay (all employees)</div><div class="v">${fmtGBP(
      earnings.mean_annual_all
    )}</div></div>
  `;
}

function renderMeta(meta) {
  if (!meta) return;
  metaEl.innerHTML = `Source: ONS ASHE · Edition: <strong>${escapeHtml(
    meta.edition ?? ""
  )}</strong> · Year: <strong>${escapeHtml(String(meta.year ?? ""))}</strong>`;
}

async function main() {
  setupAdSense();

  const [roles, earningsBySoc, meta] = await Promise.all([
    loadJSON("./data/roles.json"),
    loadJSON("./data/earnings.json"),
    loadJSON("./data/meta.json")
  ]);

  const rolesWithIndex = roles.map((r) => ({
    ...r,
    _n: norm(r.title)
  }));

  const bySoc = new Map(Object.entries(earningsBySoc));
  renderMeta(meta);

  function pick(soc2) {
    const role = roles.find((r) => String(r.soc2) === String(soc2));
    const earnings = bySoc.get(String(soc2));
    renderSelected(role, earnings, meta);
  }

  function search(q) {
    const nq = norm(q);
    if (!nq) return [];

    const terms = nq.split(/\s+/g).filter(Boolean);
    const scored = [];

    for (const r of rolesWithIndex) {
      let score = 0;
      for (const t of terms) {
        const idx = r._n.indexOf(t);
        if (idx === -1) {
          score = -1;
          break;
        }
        score += idx === 0 ? 8 : 3;
      }
      if (score > 0) scored.push([score, r]);
    }

    scored.sort((a, b) => b[0] - a[0] || a[1].title.localeCompare(b[1].title));
    return scored.slice(0, 12).map(([, r]) => ({
      soc2: r.soc2,
      title: r.title
    }));
  }

  roleSearch.addEventListener("input", () => {
    const items = search(roleSearch.value);
    renderResults(items, pick);
  });

  resultsEl.innerHTML =
    '<div class="muted">Start typing a job or occupation group above to see typical pay.</div>';
}

main().catch((err) => {
  resultsEl.innerHTML = `<div class="muted">Data is missing. Run <code>npm run build:data</code> then refresh.</div>`;
  metaEl.textContent = String(err?.message || err);
});

