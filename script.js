const frameConfig = {
  framePath: "./frames",
  totalFrames: 600,
  pad: 6,
};

const hero   = document.getElementById("sequenceHero");
const canvas = document.getElementById("heroCanvas");
const ctx    = canvas.getContext("2d", { alpha: false });
ctx.imageSmoothingEnabled = false;

const isMobile = window.matchMedia("(max-width: 720px)").matches;
// stride 3 = 200 display frames desktop, stride 6 = 100 mobile
const stride       = isMobile ? 6 : 3;
const totalDisplay = Math.ceil(frameConfig.totalFrames / stride);

const cache  = new Array(totalDisplay).fill(null);
const loaded = new Uint8Array(totalDisplay);

// Frames needed before unlocking scroll
const READY_THRESHOLD = isMobile ? 40 : 100;

let sequenceReady    = false;
let sequenceSkipped  = false;
let sequenceFinished = false;
let targetDisplayIndex = 0;
let lastDrawnIndex     = -1;
let renderRaf = 0;
let raf       = 0;
let cssWidth  = 0;
let cssHeight = 0;

function frameUrl(displayIndex) {
  const realIndex = Math.min(displayIndex * stride, frameConfig.totalFrames - 1);
  return `${frameConfig.framePath}/frame_${String(realIndex).padStart(frameConfig.pad, "0")}.jpg`;
}

function clamp(v, min, max) { return Math.min(Math.max(v, min), max); }

// ── Loading overlay ───────────────────────────────────────────────
const loaderEl = document.createElement("div");
loaderEl.id = "vesumLoader";
loaderEl.innerHTML = `
  <div class="vl-inner">
    <div class="vl-wordmark">VESUM</div>
    <div class="vl-bar-track"><div class="vl-bar-fill" id="vlFill"></div></div>
    <p class="vl-pct" id="vlPct">0%</p>
  </div>`;
document.body.appendChild(loaderEl);
document.body.style.overflow = "hidden"; // block scroll until ready

const vlFill = document.getElementById("vlFill");
const vlPct  = document.getElementById("vlPct");
let loaderGone = false;

function updateLoader(n) {
  const pct = Math.min(Math.round((n / READY_THRESHOLD) * 100), 100);
  if (vlFill) vlFill.style.width = pct + "%";
  if (vlPct)  vlPct.textContent  = pct + "%";
}

function hideLoader() {
  if (loaderGone) return;
  loaderGone = true;
  loaderEl.classList.add("vl-out");
  setTimeout(() => { try { loaderEl.remove(); } catch(_){} }, 700);
  document.body.style.overflow = "";
  document.querySelectorAll(".reveal").forEach(el => el.classList.add("is-visible"));
  requestScrollUpdate();
}

// ── Draw ──────────────────────────────────────────────────────────
function drawFrame(idx) {
  const bmp = cache[idx];
  if (!bmp) return;
  const iw = bmp.width || bmp.naturalWidth;
  const ih = bmp.height || bmp.naturalHeight;
  const cw = canvas.width, ch = canvas.height;
  const scale = Math.max(cw / iw, ch / ih);
  const dw = iw * scale, dh = ih * scale;
  ctx.drawImage(bmp, (cw - dw) / 2, (ch - dh) / 2, dw, dh);
  lastDrawnIndex = idx;
}

// ── Render loop ───────────────────────────────────────────────────
function renderLoop() {
  if (sequenceReady && !sequenceSkipped) {
    let idx = targetDisplayIndex;
    if (!loaded[idx]) {
      let best = lastDrawnIndex >= 0 ? lastDrawnIndex : 0;
      let bestDist = Math.abs(best - idx);
      for (let i = Math.max(0, idx - 15); i <= Math.min(totalDisplay - 1, idx + 15); i++) {
        if (loaded[i] && Math.abs(i - idx) < bestDist) { best = i; bestDist = Math.abs(i - idx); }
      }
      idx = best;
    }
    if (idx !== lastDrawnIndex) drawFrame(idx);
  }
  renderRaf = requestAnimationFrame(renderLoop);
}

// ── Scroll ────────────────────────────────────────────────────────
function snapToPlatform() {
  if (sequenceFinished) return;
  sequenceFinished = true;
  document.getElementById("platform")?.scrollIntoView({ behavior: "smooth", block: "start" });
}

function updateFromScroll() {
  raf = 0;
  if (sequenceSkipped) return;
  const rect = hero.getBoundingClientRect();
  const scrollable = hero.offsetHeight - window.innerHeight;
  const progress = scrollable > 0 ? clamp(-rect.top / scrollable, 0, 1) : 0;

  if (sequenceReady) targetDisplayIndex = Math.round(progress * (totalDisplay - 1));

  const nextOpacity = clamp((progress - 0.88) / 0.12, 0, 1);
  const heroFade    = clamp(1 - Math.max(0, progress - 0.68) * 3.1, 0, 1);
  const root = document.documentElement;
  root.style.setProperty("--progress",         progress.toFixed(4));
  root.style.setProperty("--meter-height",     `${(progress * 100).toFixed(2)}%`);
  root.style.setProperty("--canvas-scale",     (1 + progress * 0.035).toFixed(4));
  root.style.setProperty("--vignette-opacity", (1 - progress * 0.18).toFixed(4));
  root.style.setProperty("--hero-opacity",     heroFade.toFixed(4));
  root.style.setProperty("--hero-shift",       `${(progress * -28).toFixed(2)}px`);
  root.style.setProperty("--next-opacity",     nextOpacity.toFixed(4));
  root.style.setProperty("--next-shift",       `${((1 - nextOpacity) * 28).toFixed(2)}px`);

  if (sequenceReady && progress >= 0.97 && !sequenceFinished) snapToPlatform();
}

function requestScrollUpdate() {
  if (!raf) raf = requestAnimationFrame(updateFromScroll);
}

// ── Canvas resize ─────────────────────────────────────────────────
function resizeCanvas() {
  const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
  cssWidth  = window.innerWidth;
  cssHeight = window.innerHeight;
  canvas.width  = Math.floor(cssWidth  * dpr);
  canvas.height = Math.floor(cssHeight * dpr);
  canvas.style.width  = `${cssWidth}px`;
  canvas.style.height = `${cssHeight}px`;
  if (lastDrawnIndex >= 0) drawFrame(lastDrawnIndex);
}

// ── Preload ───────────────────────────────────────────────────────
function preloadAllFrames() {
  const CONCURRENT = isMobile ? 4 : 8;
  let nextToLoad  = 0;
  let loadedCount = 0;

  function loadOne(i) {
    if (i >= totalDisplay) return;
    const img = new Image();
    img.decoding = "async";
    img.onload = () => {
      (typeof createImageBitmap !== "undefined"
        ? createImageBitmap(img)
        : Promise.resolve(img)
      ).then(bmp => {
        cache[i] = bmp;
        loaded[i] = 1;
        loadedCount++;
        updateLoader(loadedCount);
        if (!sequenceReady && loadedCount >= READY_THRESHOLD) {
          sequenceReady = true;
          drawFrame(0);
          hideLoader();
        }
        loadOne(nextToLoad++);
      });
    };
    img.onerror = () => {
      if (i === 0) { skipSequenceHero(); return; }
      loadOne(nextToLoad++);
    };
    img.src = frameUrl(i);
  }

  for (let i = 0; i < CONCURRENT; i++) loadOne(nextToLoad++);
}

// ── No-frames fallback ────────────────────────────────────────────
function skipSequenceHero() {
  if (sequenceSkipped) return;
  sequenceSkipped = true;
  cancelAnimationFrame(renderRaf);
  try { loaderEl.remove(); } catch(_) {}
  document.body.style.overflow = "";
  const root = document.documentElement;
  root.style.setProperty("--progress",         "1");
  root.style.setProperty("--meter-height",     "100%");
  root.style.setProperty("--canvas-scale",     "1");
  root.style.setProperty("--vignette-opacity", "0");
  root.style.setProperty("--hero-opacity",     "0");
  root.style.setProperty("--hero-shift",       "0px");
  root.style.setProperty("--next-opacity",     "1");
  root.style.setProperty("--next-shift",       "0px");
  if (hero) { hero.style.height = "0"; hero.style.overflow = "hidden"; hero.style.pointerEvents = "none"; }
  document.querySelectorAll(".reveal").forEach(el => el.classList.add("is-visible"));
  window.removeEventListener("scroll", requestScrollUpdate);
}

// ── Boot ──────────────────────────────────────────────────────────
resizeCanvas();
window.addEventListener("scroll", requestScrollUpdate, { passive: true });
window.addEventListener("resize", () => { resizeCanvas(); requestScrollUpdate(); });
renderLoop();
preloadAllFrames();

const navbar = document.getElementById("navbar");
const navIndicator = document.querySelector(".nav-indicator");
const navLinks = [...document.querySelectorAll(".nav-pill-item")];
const navPillCursor = document.getElementById("navPillCursor");
const navPillList = document.getElementById("navPillList");
let previousScrollY = window.scrollY;

function updateNavbar() {
  const currentY = window.scrollY;
  navbar.classList.toggle("is-scrolled", currentY > 24);
  navbar.classList.toggle("is-hidden", currentY > previousScrollY && currentY > 220);
  previousScrollY = currentY;
}

window.addEventListener("scroll", updateNavbar, { passive: true });

// ── Sliding pill cursor ──────────────────────────────────────────
function movePillTo(el) {
  if (!navPillCursor || !navPillList || !el) return;
  const listRect = navPillList.getBoundingClientRect();
  const elRect = el.getBoundingClientRect();
  navPillCursor.style.left = `${elRect.left - listRect.left}px`;
  navPillCursor.style.width = `${elRect.width}px`;
}

// Hover — show hover pill
navLinks.forEach((link) => {
  link.parentElement.addEventListener("mouseenter", () => {
    navPillCursor.classList.add("is-visible");
    navPillCursor.classList.remove("is-locked");
    movePillTo(link);
  });
});

// Mouse leave list — snap back to active
navPillList?.addEventListener("mouseleave", () => {
  navPillCursor.classList.remove("is-visible");
  navPillCursor.classList.add("is-locked");
  const active = document.querySelector(".nav-pill-item.is-active");
  if (active) movePillTo(active);
});

function moveNavIndicator(activePage) {
  const activeLink = document.querySelector(`.nav-pill-item[data-page="${activePage}"]`);
  if (!activeLink) return;
  // Update active class
  navLinks.forEach((l) => l.classList.toggle("is-active", l.dataset.page === activePage));
  // Lock pill on active
  navPillCursor.classList.add("is-locked");
  navPillCursor.classList.remove("is-visible");
  movePillTo(activeLink);
}

window.addEventListener("resize", () => moveNavIndicator(currentPage));

// ── SPA Router ───────────────────────────────────────────────────
let currentPage = null;
let mapInited = false;
let chartsInited = false;

function moveNavIndicator(activePage) {
  const activeLink = document.querySelector(`.nav-links a[data-page="${activePage}"]`) || navLinks[0];
  if (!activeLink || !navIndicator) return;
  const parentRect = activeLink.parentElement.getBoundingClientRect();
  const linkRect = activeLink.getBoundingClientRect();
  navIndicator.style.width = `${linkRect.width}px`;
  navIndicator.style.transform = `translate3d(${linkRect.left - parentRect.left}px, -50%, 0)`;
}

function showPage(pageId, isFirstLoad) {
  // Hide current
  if (currentPage && currentPage !== pageId) {
    const oldPage = document.getElementById(`page-${currentPage}`);
    if (oldPage) {
      oldPage.classList.remove("is-visible");
      setTimeout(() => oldPage.classList.remove("is-active"), 380);
    }
  }

  currentPage = pageId;
  if (!isFirstLoad) window.scrollTo({ top: 0, behavior: "instant" });

  // Show new page
  const newPage = document.getElementById(`page-${pageId}`);
  if (newPage) {
    newPage.classList.add("is-active");
    // On first load skip the transition delay so it appears instantly
    if (isFirstLoad) {
      newPage.classList.add("is-visible");
    } else {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => newPage.classList.add("is-visible"));
      });
    }
  }

  // Update nav
  navLinks.forEach((link) => {
    link.classList.toggle("is-active", link.dataset.page === pageId);
  });
  moveNavIndicator(pageId);

  // Update title
  const titles = { home: "VESUM | Smart Parking Access", map: "VESUM | Live Map", booking: "VESUM | Book a Slot", research: "VESUM | Research", dashboards: "VESUM | Dashboards" };
  document.title = titles[pageId] || "VESUM";

  // Lazy init page-specific features
  if (pageId === "map" && !mapInited) {
    mapInited = true;
    setTimeout(() => { initLeafletMap(); observeReveals(newPage); triggerShutterText(newPage); }, 60);
  } else if (pageId === "map") {
    setTimeout(() => { vesumLeafletMap?.invalidateSize(); observeReveals(newPage); triggerShutterText(newPage); }, 100);
  } else if (pageId === "research" && !chartsInited) {
    chartsInited = true;
    setTimeout(() => { initSurveyCharts(); observeReveals(newPage); triggerShutterText(newPage); }, 60);
  } else if (pageId === "booking") {
    setTimeout(() => { fetchLocationsAndRender(); observeReveals(newPage); triggerShutterText(newPage); }, 60);
  } else if (newPage) {
    setTimeout(() => { observeReveals(newPage); triggerShutterText(newPage); }, isFirstLoad ? 100 : 60);
  }

  // Re-animate counters on dashboards
  if (pageId === "dashboards") {
    setTimeout(() => {
      // Set date
      const dateEl = document.getElementById("dbDate");
      if (dateEl) dateEl.textContent = new Date().toLocaleDateString("en-IN", { weekday:"long", day:"numeric", month:"long", year:"numeric" });

      // Animate all counters on the page
      newPage.querySelectorAll("[data-counter]").forEach((el) => {
        el.textContent = "0";
        animateCounter(el);
      });

      // Stagger booking rows
      newPage.querySelectorAll(".db-table-row").forEach((row, i) => {
        row.style.transitionDelay = `${i * 80}ms`;
        setTimeout(() => row.classList.add("is-visible"), 300 + i * 80);
      });

      // Animate dash-bottom panels
      newPage.querySelectorAll(".dash-panel, .dash-vehicles").forEach((el, i) => {
        el.style.transitionDelay = `${i * 100}ms`;
        setTimeout(() => el.classList.add("is-visible"), 200 + i * 100);
      });

      // Sidebar nav click
      newPage.querySelectorAll(".db-nav-item").forEach((item) => {
        item.addEventListener("click", (e) => {
          e.preventDefault();
          newPage.querySelectorAll(".db-nav-item").forEach((n) => n.classList.remove("is-active"));
          item.classList.add("is-active");
        });
      });
    }, 200);
  }
}

function navigateTo(pageId) {
  if (pageId === currentPage) return;
  showPage(pageId, false);
}

function observeReveals(container) {
  container.querySelectorAll(".reveal, .stagger").forEach((el) => {
    el.classList.remove("is-visible");
    revealObserver.observe(el);
  });
}

// Intercept all data-page links
document.addEventListener("click", (e) => {
  const link = e.target.closest("[data-page]");
  if (!link) return;
  e.preventDefault();
  const page = link.dataset.page;
  if (page) navigateTo(page);
});

// Map reserve button → go to booking
document.addEventListener("click", (e) => {
  if (e.target.id === "mapReserveBtn") navigateTo("booking");
});

window.addEventListener("resize", () => moveNavIndicator(currentPage));

// Boot — show home immediately on first load (called after revealObserver is defined below)
function bootApp() {
  showPage("home", true);
  // Safety net: if next-section is still invisible after 2.5s, force skip
  setTimeout(() => {
    const nextOpacity = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--next-opacity")) || 0;
    if (nextOpacity < 0.5) skipSequenceHero();
  }, 2500);
}

function setupPixelText() {
  document.querySelectorAll(".pixel-title").forEach((title) => {
    const text = title.textContent || "";
    title.setAttribute("aria-label", text);
    title.textContent = "";
    [...text].forEach((char, index) => {
      const span = document.createElement("span");
      span.className = char === " " ? "pixel-char space" : "pixel-char";
      span.style.setProperty("--char-index", index);
      span.textContent = char === " " ? "\u00a0" : char;
      span.setAttribute("aria-hidden", "true");
      title.appendChild(span);
    });
  });
}

setupPixelText();

// ── Shutter Text ─────────────────────────────────────────────────
function buildShutterText(el) {
  // Use data-shutter for plain text, keep inner HTML for display
  const text = el.dataset.shutter || el.textContent || "";
  el.setAttribute("aria-label", text);
  el.innerHTML = "";

  // Split into words so flex-wrap only breaks between words, not mid-word
  const words = text.split(" ");
  let charIndex = 0;

  words.forEach((word, wordIdx) => {
    // Wrap each word in a nowrap container so characters stay together
    const wordWrap = document.createElement("span");
    wordWrap.style.whiteSpace = "nowrap";
    wordWrap.style.display = "inline-flex";

    [...word].forEach((char) => {
      const wrap = document.createElement("span");
      wrap.className = "shutter-char";
      wrap.style.animationDelay = `${charIndex * 0.04 + 0.1}s`;

      // Main char
      const main = document.createElement("span");
      main.textContent = char;
      main.setAttribute("aria-hidden", "true");
      wrap.appendChild(main);

      // 3 sweep slices
      ["shutter-slice shutter-slice-top", "shutter-slice shutter-slice-mid", "shutter-slice shutter-slice-bot"].forEach((cls, si) => {
        const slice = document.createElement("span");
        slice.className = cls;
        slice.textContent = char;
        slice.setAttribute("aria-hidden", "true");
        slice.style.animationDelay = `${charIndex * 0.04 + si * 0.1}s`;
        wrap.appendChild(slice);
      });

      wordWrap.appendChild(wrap);
      charIndex++;
    });

    el.appendChild(wordWrap);

    // Add space between words (except after the last word)
    if (wordIdx < words.length - 1) {
      const sp = document.createElement("span");
      sp.className = "shutter-char space";
      sp.textContent = "\u00a0";
      el.appendChild(sp);
      charIndex++; // count the space for animation timing
    }
  });
}

function triggerShutterText(container) {
  container.querySelectorAll(".shutter-text").forEach((el) => {
    buildShutterText(el);
  });
}

const revealObserver = new IntersectionObserver(
  (entries) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      const target = entry.target;
      if (target.classList.contains("stagger")) {
        [...target.children].forEach((child, index) => {
          child.style.transitionDelay = `${index * 90}ms`;
          child.classList.add("is-visible");
        });
      } else {
        target.classList.add("is-visible");
      }
      revealObserver.unobserve(target);
    });
  },
  { threshold: 0.18, rootMargin: "0px 0px -8% 0px" },
);

// Boot home page now that revealObserver exists
bootApp();

const counterObserver = new IntersectionObserver(
  (entries) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      animateCounter(entry.target);
      counterObserver.unobserve(entry.target);
    });
  },
  { threshold: 0.55 },
);

document.querySelectorAll("[data-counter]").forEach((counter) => {
  counterObserver.observe(counter);
});

function animateCounter(element) {
  const target = Number(element.dataset.counter);
  const duration = 1300;
  const start = performance.now();

  function tick(now) {
    const progress = clamp((now - start) / duration, 0, 1);
    const eased = 1 - Math.pow(1 - progress, 3);
    element.textContent = Math.round(target * eased).toLocaleString();
    if (progress < 1) requestAnimationFrame(tick);
  }

  requestAnimationFrame(tick);
}

const parallaxElements = [...document.querySelectorAll("[data-parallax]")];
let parallaxRaf = 0;
let lastScrollY = -1;

function updateParallax() {
  const currentScrollY = window.scrollY;
  if (currentScrollY !== lastScrollY) {
    lastScrollY = currentScrollY;
    parallaxElements.forEach((element) => {
      const speed = Number(element.dataset.parallax || 0);
      const rect = element.getBoundingClientRect();
      const centerOffset = rect.top + rect.height / 2 - window.innerHeight / 2;
      const val = (centerOffset * speed * -1).toFixed(2);
      element.style.setProperty("--parallax-y", `${val}px`);
      if (!element.classList.contains("hero-copy")) {
        element.style.transform = `translateY(${val}px)`;
      }
    });
  }
  parallaxRaf = requestAnimationFrame(updateParallax);
}
updateParallax();

const mapPopup = document.getElementById("mapPopup");
const mapStatus = document.getElementById("mapStatus");
const locateNowButton = document.getElementById("locateNow");
const followLocationButton = document.getElementById("followLocation");
const parkingSocieties = [
  {
    name: "Shanti Vihar CHS",
    position: [19.1197, 72.8468],
    slots: 18,
    ratePerHourInr: 120,
    detail: "guard verified",
  },
  {
    name: "Gokul Residency",
    position: [19.1122, 72.8606],
    slots: 11,
    ratePerHourInr: 95,
    detail: "visitor lane active",
  },
  {
    name: "Sai Darshan Heights",
    position: [19.1266, 72.8354],
    slots: 26,
    ratePerHourInr: 140,
    detail: "EV bay available",
  },
];
const generatedSocietyNames = [
  "Shanti Vihar CHS",
  "Gokul Residency",
  "Sai Darshan Heights",
  "Lakeview CHS",
  "Green Meadows Society",
  "Palm Grove Apartments",
  "Lotus Enclave",
  "Sunrise CHS",
];

let vesumLeafletMap = null;
let userMarker = null;
let accuracyCircle = null;
let userLatLng = null;
let watchId = null;
let followLocation = true;
let selectedParkingMarker = null;
let generatedAroundUser = false;

function initLeafletMap() {
  const mapElement = document.getElementById("vesumMap");
  if (!mapElement || typeof L === "undefined") {
    if (mapStatus) mapStatus.textContent = "Map library unavailable";
    return;
  }

  vesumLeafletMap = L.map(mapElement, {
    zoomControl: true,
    scrollWheelZoom: false,
    preferCanvas: true,
  }).setView([19.1197, 72.8468], 14);

  L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  }).addTo(vesumLeafletMap);

  const bounds = L.latLngBounds();
  parkingSocieties.forEach((society) => {
    addSocietyMarker(society);
    bounds.extend(society.position);
  });

  selectSociety(parkingSocieties[0], parkingSocieties[0].marker);
  vesumLeafletMap.fitBounds(bounds.pad(0.24), { animate: true, duration: 0.8 });
  startGpsTracking();
}

function selectSociety(society, marker) {
  if (!mapPopup || !society) return;
  if (selectedParkingMarker) {
    selectedParkingMarker.getElement()?.querySelector(".parking-marker")?.classList.remove("is-selected");
  }
  selectedParkingMarker = marker;
  selectedParkingMarker?.getElement()?.querySelector(".parking-marker")?.classList.add("is-selected");

  const distanceText = userLatLng
    ? `${formatDistance(vesumLeafletMap.distance(userLatLng, society.position))} away`
    : "distance updates after GPS";

  mapPopup.classList.add("is-changing");
  window.setTimeout(() => {
    mapPopup.querySelector("h3").textContent = society.name;
    mapPopup.querySelector("p").textContent = `${society.slots} slots open · ${distanceText} · INR ${society.ratePerHourInr}/hour · ${society.detail}`;
    mapPopup.classList.remove("is-changing");
  }, 160);
}

function addSocietyMarker(society) {
  if (!vesumLeafletMap) return null;
  const marker = L.marker(society.position, {
    icon: L.divIcon({
      className: "",
      html: '<span class="parking-marker"></span>',
      iconSize: [24, 24],
      iconAnchor: [12, 12],
    }),
    title: society.name,
    riseOnHover: true,
  }).addTo(vesumLeafletMap);

  marker.on("click mouseover", () => selectSociety(society, marker));
  society.marker = marker;
  return marker;
}

function generateNearbySocieties(center) {
  if (!vesumLeafletMap) return;
  parkingSocieties.forEach((society) => {
    if (society.marker) vesumLeafletMap.removeLayer(society.marker);
  });
  parkingSocieties.length = 0;
  selectedParkingMarker = null;

  const count = mobileQuery.matches ? 5 : 8;
  const bounds = L.latLngBounds([center]);
  for (let index = 0; index < count; index += 1) {
    const distanceMeters = 260 + index * 155 + Math.random() * 360;
    const angle = (Math.PI * 2 * index) / count + Math.random() * 0.55;
    const position = offsetLatLng(center, distanceMeters, angle);
    const society = {
      name: generatedSocietyNames[index % generatedSocietyNames.length],
      position,
      slots: 6 + Math.floor(Math.random() * 24),
      ratePerHourInr: 60 + Math.floor(Math.random() * 170),
      detail: ["guard verified", "visitor lane active", "covered parking", "EV bay available"][index % 4],
    };

    parkingSocieties.push(society);
    addSocietyMarker(society);
    bounds.extend(position);
  }

  selectSociety(parkingSocieties[0], parkingSocieties[0].marker);
  vesumLeafletMap.flyToBounds(bounds.pad(0.26), { animate: true, duration: 1 });
}

function offsetLatLng(center, distanceMeters, angleRadians) {
  const earthRadius = 6378137;
  const lat1 = (center.lat * Math.PI) / 180;
  const lng1 = (center.lng * Math.PI) / 180;
  const angularDistance = distanceMeters / earthRadius;

  const lat2 = Math.asin(
    Math.sin(lat1) * Math.cos(angularDistance) +
      Math.cos(lat1) * Math.sin(angularDistance) * Math.cos(angleRadians),
  );
  const lng2 =
    lng1 +
    Math.atan2(
      Math.sin(angleRadians) * Math.sin(angularDistance) * Math.cos(lat1),
      Math.cos(angularDistance) - Math.sin(lat1) * Math.sin(lat2),
    );

  return [lat2 * (180 / Math.PI), lng2 * (180 / Math.PI)];
}

function startGpsTracking() {
  if (!navigator.geolocation) {
    if (mapStatus) mapStatus.textContent = "GPS not supported";
    return;
  }

  if (mapStatus) mapStatus.textContent = "Waiting for GPS permission";
  watchId = navigator.geolocation.watchPosition(updateUserLocation, handleGpsError, {
    enableHighAccuracy: true,
    maximumAge: 5000,
    timeout: 15000,
  });
}

function updateUserLocation(position) {
  if (!vesumLeafletMap) return;
  const { latitude, longitude, accuracy } = position.coords;
  userLatLng = L.latLng(latitude, longitude);

  if (!userMarker) {
    userMarker = L.marker(userLatLng, {
      icon: L.divIcon({
        className: "",
        html: '<span class="user-marker"></span>',
        iconSize: [20, 20],
        iconAnchor: [10, 10],
      }),
      title: "Your GPS location",
      zIndexOffset: 1000,
    }).addTo(vesumLeafletMap);
  } else {
    userMarker.setLatLng(userLatLng);
  }

  if (!accuracyCircle) {
    accuracyCircle = L.circle(userLatLng, {
      radius: accuracy,
      color: "#46d9ff",
      weight: 1,
      opacity: 0.72,
      fillColor: "#46d9ff",
      fillOpacity: 0.12,
    }).addTo(vesumLeafletMap);
  } else {
    accuracyCircle.setLatLng(userLatLng);
    accuracyCircle.setRadius(accuracy);
  }

  if (followLocation) {
    vesumLeafletMap.flyTo(userLatLng, Math.max(16, vesumLeafletMap.getZoom()), {
      animate: true,
      duration: 0.9,
    });
  }

  if (!generatedAroundUser) {
    generatedAroundUser = true;
    generateNearbySocieties(userLatLng);
  }

  if (mapStatus) mapStatus.textContent = `GPS accuracy ±${Math.round(accuracy)}m`;
  if (selectedParkingMarker) {
    const selected = parkingSocieties.find((society) => society.marker === selectedParkingMarker);
    if (selected) selectSociety(selected, selectedParkingMarker);
  }
}

function handleGpsError(error) {
  const messages = {
    1: "Location permission denied",
    2: "GPS position unavailable",
    3: "GPS request timed out",
  };
  if (mapStatus) mapStatus.textContent = messages[error.code] || "GPS unavailable";
}

function formatDistance(distanceMeters) {
  if (distanceMeters < 1000) return `${Math.round(distanceMeters)}m`;
  return `${(distanceMeters / 1000).toFixed(1)}km`;
}

locateNowButton?.addEventListener("click", () => {
  if (!navigator.geolocation) return;
  if (mapStatus) mapStatus.textContent = "Locating";
  navigator.geolocation.getCurrentPosition(updateUserLocation, handleGpsError, {
    enableHighAccuracy: true,
    maximumAge: 0,
    timeout: 15000,
  });
});

followLocationButton?.addEventListener("click", () => {
  followLocation = !followLocation;
  followLocationButton.classList.toggle("active", followLocation);
  if (followLocation && userLatLng && vesumLeafletMap) {
    vesumLeafletMap.flyTo(userLatLng, Math.max(16, vesumLeafletMap.getZoom()), {
      animate: true,
      duration: 0.7,
    });
  }
});

// initLeafletMap() is now called lazily by the SPA router when map page is first opened

// ── Wizard Onboarding ────────────────────────────────────────────
const wizardStepItems = [...document.querySelectorAll(".wizard-step-item")];
const wizardConnectors = [...document.querySelectorAll(".wizard-connector")];
const wizardPanels = {
  location: document.getElementById("onboardStepLocation"),
  phone: document.getElementById("onboardStepPhone"),
  otp: document.getElementById("onboardStepOtp"),
  payment: document.getElementById("onboardStepPayment"),
  confirmed: document.getElementById("onboardStepConfirmed"),
};
const onboardingLocationList = document.getElementById("onboardLocationList");
const onboardingDetectLocationButton = document.getElementById("onboardDetectLocation");
const onboardingPhoneInput = document.getElementById("onboardPhoneInput");
const onboardingSendOtpButton = document.getElementById("onboardSendOtp");
const onboardingPhoneHint = document.getElementById("onboardPhoneHint");
const onboardingOtpInput = document.getElementById("onboardOtpInput");
const onboardingVerifyOtpButton = document.getElementById("onboardVerifyOtp");
const onboardingOtpHint = document.getElementById("onboardOtpHint");
const otpBoxes = [...document.querySelectorAll(".otp-box")];

const onboardingState = {
  selectedLocation: null,
  phone: "",
  locations: [],
  lat: null,
  lng: null,
  otpSent: false,
  otpVerified: false,
  otpChallengeId: "",
  paymentDone: false,
  paymentAmount: 1,
  currentStep: 0,
};

const stepOrder = ["location", "phone", "otp", "payment", "confirmed"];

function goToWizardStep(index) {
  const currentKey = stepOrder[onboardingState.currentStep];
  const nextKey = stepOrder[index];
  const currentPanel = wizardPanels[currentKey];
  const nextPanel = wizardPanels[nextKey];

  if (currentPanel && currentPanel !== nextPanel) {
    currentPanel.classList.add("is-exit");
    currentPanel.classList.remove("is-active");
    setTimeout(() => currentPanel.classList.remove("is-exit"), 400);
  }

  onboardingState.currentStep = index;

  if (nextPanel) {
    nextPanel.classList.add("is-active");
  }

  // Update progress dots
  wizardStepItems.forEach((item, i) => {
    item.classList.toggle("is-active", i === index);
    item.classList.toggle("is-done", i < index);
  });

  // Fill connectors
  wizardConnectors.forEach((connector, i) => {
    connector.classList.toggle("is-filled", i < index);
  });
}

function renderLocationOptions() {
  onboardingLocationList.innerHTML = "";
  onboardingState.locations.forEach((location) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "location-item";
    if (onboardingState.selectedLocation?.id === location.id) button.classList.add("is-selected");
    button.innerHTML = `
      <span>
        <strong>${location.name}</strong><br />
        <span class="meta">${location.slots} slots · ${location.distanceLabel} · INR ${location.ratePerHourInr}/hour</span>
      </span>
      <span class="meta">Select →</span>
    `;
    button.addEventListener("click", () => {
      onboardingState.selectedLocation = location;
      renderLocationOptions();
      setTimeout(() => goToWizardStep(1), 180);
      if (onboardingPhoneHint) onboardingPhoneHint.textContent = `📍 ${location.name}`;
      if (mapStatus) mapStatus.textContent = `Selected ${location.name} for booking`;
    });
    onboardingLocationList.appendChild(button);
  });
}

async function fetchLocationsAndRender() {
  onboardingDetectLocationButton.disabled = true;
  onboardingDetectLocationButton.textContent = "Detecting…";

  try {
    const position = await new Promise((resolve, reject) => {
      if (!navigator.geolocation) reject(new Error("Geolocation unavailable"));
      navigator.geolocation.getCurrentPosition(resolve, reject, {
        enableHighAccuracy: true,
        timeout: 12000,
      });
    });
    onboardingState.lat = position.coords.latitude;
    onboardingState.lng = position.coords.longitude;
  } catch (_error) {
    onboardingState.lat = 19.1197;
    onboardingState.lng = 72.8468;
  }

  try {
    const response = await fetch(
      `/api/locations?lat=${encodeURIComponent(onboardingState.lat)}&lng=${encodeURIComponent(onboardingState.lng)}`,
    );
    const payload = await response.json();
    onboardingState.locations = payload.locations || [];
    renderLocationOptions();
  } catch (_error) {
    onboardingDetectLocationButton.textContent = "Retry";
  } finally {
    onboardingDetectLocationButton.disabled = false;
    onboardingDetectLocationButton.textContent = "Refresh Locations";
  }
}

onboardingDetectLocationButton?.addEventListener("click", fetchLocationsAndRender);

onboardingSendOtpButton?.addEventListener("click", async () => {
  if (onboardingPhoneHint) onboardingPhoneHint.textContent = onboardingState.selectedLocation
    ? `📍 ${onboardingState.selectedLocation.name}`
    : "";

  const phone = String(onboardingPhoneInput.value || "").trim();
  onboardingState.phone = phone;

  if (!onboardingState.selectedLocation) {
    if (onboardingPhoneHint) onboardingPhoneHint.textContent = "⚠ Select a location first.";
    goToWizardStep(0);
    return;
  }
  if (!/^\+[1-9]\d{8,14}$/.test(phone)) {
    if (onboardingPhoneHint) onboardingPhoneHint.textContent = "⚠ Enter number like +919876543210";
    return;
  }

  onboardingSendOtpButton.disabled = true;
  onboardingSendOtpButton.textContent = "Sending…";
  try {
    const response = await fetch("/api/otp/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phone, locationName: onboardingState.selectedLocation.name }),
    });
    const payload = await response.json();
    if (!response.ok || !payload.ok) {
      if (onboardingPhoneHint) onboardingPhoneHint.textContent = `⚠ ${payload.error || "Could not send OTP"}`;
      return;
    }
    onboardingState.otpSent = true;
    onboardingState.otpChallengeId = payload.challengeId;
    goToWizardStep(2);
    if (onboardingOtpHint) onboardingOtpHint.textContent =
      payload.delivery === "sms"
        ? "✓ OTP sent to your mobile."
        : `Dev OTP: ${payload.devOtp}`;
    otpBoxes[0]?.focus();
  } catch (_error) {
    if (onboardingPhoneHint) onboardingPhoneHint.textContent = "⚠ Network error. Try again.";
  } finally {
    onboardingSendOtpButton.disabled = false;
    onboardingSendOtpButton.textContent = "Send OTP";
  }
});

// OTP box auto-advance
otpBoxes.forEach((box, index) => {
  box.addEventListener("input", () => {
    const val = box.value.replace(/\D/g, "");
    box.value = val.slice(-1);
    box.classList.toggle("is-filled", box.value.length > 0);
    if (box.value && index < otpBoxes.length - 1) otpBoxes[index + 1].focus();
    // Sync hidden input
    if (onboardingOtpInput) onboardingOtpInput.value = otpBoxes.map((b) => b.value).join("");
  });
  box.addEventListener("keydown", (e) => {
    if (e.key === "Backspace" && !box.value && index > 0) otpBoxes[index - 1].focus();
  });
  box.addEventListener("paste", (e) => {
    e.preventDefault();
    const pasted = (e.clipboardData || window.clipboardData).getData("text").replace(/\D/g, "").slice(0, 6);
    [...pasted].forEach((char, i) => {
      if (otpBoxes[i]) {
        otpBoxes[i].value = char;
        otpBoxes[i].classList.add("is-filled");
      }
    });
    if (onboardingOtpInput) onboardingOtpInput.value = otpBoxes.map((b) => b.value).join("");
    otpBoxes[Math.min(pasted.length, otpBoxes.length - 1)]?.focus();
  });
});

onboardingVerifyOtpButton?.addEventListener("click", async () => {
  if (onboardingOtpHint) onboardingOtpHint.textContent = "";
  const otp = String(onboardingOtpInput?.value || "").trim();

  if (!onboardingState.otpSent || !onboardingState.otpChallengeId) {
    if (onboardingOtpHint) onboardingOtpHint.textContent = "⚠ Send OTP first.";
    goToWizardStep(1);
    return;
  }
  if (!/^\d{6}$/.test(otp)) {
    if (onboardingOtpHint) onboardingOtpHint.textContent = "⚠ Enter all 6 digits.";
    otpBoxes.forEach((b) => b.classList.toggle("is-filled", b.value.length > 0));
    return;
  }

  onboardingVerifyOtpButton.disabled = true;
  onboardingVerifyOtpButton.textContent = "Verifying…";
  try {
    const response = await fetch("/api/otp/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phone: onboardingState.phone, otp, challengeId: onboardingState.otpChallengeId }),
    });
    const payload = await response.json();
    if (!response.ok || !payload.ok) {
      if (onboardingOtpHint) onboardingOtpHint.textContent = `⚠ ${payload.error || "OTP verification failed"}`;
      return;
    }
    onboardingState.otpVerified = true;

    // Generate a dynamic amount based on location rate + small random booking fee
    const ratePerHour = onboardingState.selectedLocation?.ratePerHourInr || 120;
    // Amount = 1 hour rate + random surcharge between 10–50, rounded to nearest 5
    const surcharge = Math.round((Math.floor(Math.random() * 9) + 2) * 5);
    const amount = ratePerHour + surcharge;
    onboardingState.paymentAmount = amount;
    onboardingState.paymentDone = false;

    // Reset hint and done button visibility
    const payHint = document.getElementById("paymentHint");
    if (payHint) payHint.textContent = "";

    // Go to payment step first, then animate elements in sequence
    goToWizardStep(3); // → payment step

    // 1. Amount row slides in immediately, counter animates fast
    const amountRow = document.getElementById("paymentAmountRow");
    const amountEl  = document.getElementById("paymentAmountDisplay");
    const payMinEl  = document.getElementById("payMinAmount");
    if (payMinEl) payMinEl.textContent = `INR ${amount}`;

    if (amountRow && amountEl) {
      amountEl.textContent = "INR 0";
      amountRow.classList.remove("is-visible");

      setTimeout(() => {
        amountRow.classList.add("is-visible");
        // Fast counter: 0 → amount in ~600ms
        const duration = 600;
        const startTime = performance.now();
        function countUp(now) {
          const elapsed = now - startTime;
          const progress = Math.min(elapsed / duration, 1);
          // ease-out cubic
          const eased = 1 - Math.pow(1 - progress, 3);
          const current = Math.round(eased * amount);
          amountEl.textContent = `INR ${current}`;
          if (progress < 1) requestAnimationFrame(countUp);
        }
        requestAnimationFrame(countUp);
      }, 80);
    }

    // 2. QR slides in after amount settles
    const qrWrap = document.getElementById("paymentQrWrap");
    if (qrWrap) {
      qrWrap.classList.remove("is-visible");
      setTimeout(() => qrWrap.classList.add("is-visible"), 420);
    }

    // 3. Done button fades in last
    const doneBtn = document.getElementById("paymentDoneBtn");
    if (doneBtn) {
      doneBtn.classList.remove("is-visible");
      setTimeout(() => doneBtn.classList.add("is-visible"), 700);
    }
  } catch (_error) {
    if (onboardingOtpHint) onboardingOtpHint.textContent = "⚠ Network error. Try again.";
  } finally {
    onboardingVerifyOtpButton.disabled = false;
    onboardingVerifyOtpButton.textContent = "Verify OTP";
  }
});

// ── Payment Step ─────────────────────────────────────────────────
document.getElementById("paymentDoneBtn")?.addEventListener("click", () => {
  const payHint = document.getElementById("paymentHint");
  const doneBtn = document.getElementById("paymentDoneBtn");

  if (!onboardingState.otpVerified) {
    if (payHint) payHint.textContent = "⚠ Complete OTP verification first.";
    return;
  }

  // Show processing state briefly for realism
  doneBtn.disabled = true;
  doneBtn.textContent = "Verifying…";
  if (payHint) payHint.textContent = "";

  setTimeout(async () => {
    onboardingState.paymentDone = true;

    // Save booking to Supabase via backend
    try {
      await fetch("/api/booking/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          phone:       onboardingState.phone,
          societyId:   onboardingState.selectedLocation?.id,
          societyName: onboardingState.selectedLocation?.name,
          amountPaid:  onboardingState.paymentAmount,
          challengeId: onboardingState.otpChallengeId,
        }),
      });
    } catch (_) { /* non-blocking — booking still shows confirmed */ }

    // Fill confirmed details
    const confirmedSociety = document.getElementById("confirmedSociety");
    const confirmedPhone   = document.getElementById("confirmedPhone");
    const confirmedAmount  = document.getElementById("confirmedAmount");
    if (confirmedSociety) confirmedSociety.textContent = onboardingState.selectedLocation?.name || "—";
    if (confirmedPhone)   confirmedPhone.textContent   = onboardingState.phone;
    if (confirmedAmount)  confirmedAmount.textContent  = `INR ${onboardingState.paymentAmount}`;

    // Update location map card
    const locName = onboardingState.selectedLocation?.name || "Selected Society";
    const locMapName     = document.getElementById("locMapName");
    const locMapInfoName = document.getElementById("locMapInfoName");
    const locMapCoords   = document.getElementById("locMapCoords");
    if (locMapName)     locMapName.textContent     = locName;
    if (locMapInfoName) locMapInfoName.textContent = locName;
    if (locMapCoords)   locMapCoords.textContent   = "Mumbai, Maharashtra · Live";

    doneBtn.disabled = false;
    doneBtn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg> I've Paid`;

    goToWizardStep(4); // → confirmed

    // Trigger loc-map-card entrance animation
    const card = document.getElementById("locMapCard");
    if (card) {
      card.classList.remove("is-card-visible");
      requestAnimationFrame(() => requestAnimationFrame(() => {
        card.classList.add("is-card-visible");
      }));
    }
  }, 900);
});

document.getElementById("wizardRestart")?.addEventListener("click", () => {
  onboardingState.selectedLocation = null;
  onboardingState.phone = "";
  onboardingState.otpSent = false;
  onboardingState.otpVerified = false;
  onboardingState.otpChallengeId = "";
  onboardingState.paymentDone = false;
  onboardingState.paymentAmount = 1;
  if (onboardingPhoneInput) onboardingPhoneInput.value = "";
  otpBoxes.forEach((b) => { b.value = ""; b.classList.remove("is-filled"); });
  if (onboardingOtpInput) onboardingOtpInput.value = "";
  if (onboardingPhoneHint) onboardingPhoneHint.textContent = "";
  if (onboardingOtpHint) onboardingOtpHint.textContent = "";
  // Reset payment animations
  document.getElementById("paymentAmountRow")?.classList.remove("is-visible");
  document.getElementById("paymentQrWrap")?.classList.remove("is-visible");
  document.getElementById("paymentDoneBtn")?.classList.remove("is-visible");
  const amountEl = document.getElementById("paymentAmountDisplay");
  if (amountEl) amountEl.textContent = "INR 0";
  // Reset map card animation
  document.getElementById("locMapCard")?.classList.remove("is-card-visible");
  goToWizardStep(0);
  fetchLocationsAndRender();
});

// fetchLocationsAndRender() is called when booking page opens via navigateTo

document.querySelectorAll(".magnetic").forEach((element) => {
  element.addEventListener("pointermove", (event) => {
    const rect = element.getBoundingClientRect();
    const x = (event.clientX - rect.left - rect.width / 2) * 0.12;
    const y = (event.clientY - rect.top - rect.height / 2) * 0.12;
    element.style.transform = `translate(${x}px, ${y}px)`;
  });
  element.addEventListener("pointerleave", () => {
    element.style.transform = "";
  });
});

document.querySelectorAll(".button").forEach((button) => {
  button.addEventListener("click", (event) => {
    const rect = button.getBoundingClientRect();
    const ripple = document.createElement("span");
    ripple.className = "ripple";
    ripple.style.left = `${event.clientX - rect.left}px`;
    ripple.style.top = `${event.clientY - rect.top}px`;
    button.appendChild(ripple);
    ripple.addEventListener("animationend", () => ripple.remove(), { once: true });
  });
});

document.querySelectorAll(".feature-card, .dashboard-card, .stat-card").forEach((card) => {
  card.addEventListener("pointermove", (event) => {
    if (mobileQuery.matches) return;
    const rect = card.getBoundingClientRect();
    const x = (event.clientX - rect.left) / rect.width - 0.5;
    const y = (event.clientY - rect.top) / rect.height - 0.5;
    card.style.setProperty("--tilt-x", `${(-y * 4).toFixed(2)}deg`);
    card.style.setProperty("--tilt-y", `${(x * 5).toFixed(2)}deg`);
  });
  card.addEventListener("pointerleave", () => {
    card.style.setProperty("--tilt-x", "0deg");
    card.style.setProperty("--tilt-y", "0deg");
  });
});

updateNavbar();

// ── Survey Pie Charts ────────────────────────────────────────────
function initSurveyCharts() {
  if (typeof Chart === "undefined") return;

  const chartDefaults = {
    type: "doughnut",
    options: {
      cutout: "62%",
      animation: { duration: 1100, easing: "easeInOutQuart" },
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: (ctx) => ` ${ctx.label}: ${ctx.parsed}%`,
          },
          backgroundColor: "rgba(5,10,18,0.88)",
          titleColor: "#f7fbff",
          bodyColor: "rgba(226,236,247,0.82)",
          borderColor: "rgba(70,217,255,0.22)",
          borderWidth: 1,
          padding: 10,
          cornerRadius: 8,
        },
      },
    },
  };

  const colors = {
    yes: "#4ade80",
    no: "#f87171",
    yesFade: "rgba(74,222,128,0.18)",
    noFade: "rgba(248,113,113,0.18)",
  };

  const charts = [
    { id: "chartCompare", yes: 70, no: 30 },
    { id: "chartSpot",    yes: 18, no: 82 },
    { id: "chartOnline",  yes: 10, no: 90 },
  ];

  charts.forEach(({ id, yes, no }) => {
    const canvas = document.getElementById(id);
    if (!canvas) return;
    new Chart(canvas, {
      ...chartDefaults,
      data: {
        labels: ["Yes", "No"],
        datasets: [{
          data: [yes, no],
          backgroundColor: [colors.yes, colors.no],
          hoverBackgroundColor: [colors.yes, colors.no],
          borderColor: ["rgba(4,9,16,0.6)", "rgba(4,9,16,0.6)"],
          borderWidth: 3,
          hoverOffset: 6,
        }],
      },
    });
  });
}

// Survey charts are lazy-loaded by the SPA router when research page is first opened

// ── Unified pointer handler: glow + tilt + magnetic ─────────────
// Single rAF-throttled pointermove — replaces all per-card listeners
(function initPointerEffects() {
  if (mobileQuery.matches) return; // skip all on mobile

  const glowCards = [...document.querySelectorAll(".glow-card")];
  const tiltCards = [...document.querySelectorAll(".feature-card, .dashboard-card, .stat-card")];
  const magneticEls = [...document.querySelectorAll(".magnetic")];

  // Assign per-card hue variation
  const glowColorMap = [
    { base: 195, spread: 180 }, // cyan
    { base: 220, spread: 200 }, // blue
    { base: 280, spread: 300 }, // purple
  ];
  glowCards.forEach((card, i) => {
    const { base, spread } = glowColorMap[i % glowColorMap.length];
    card.style.setProperty("--base", base);
    card.style.setProperty("--spread", spread);
    card.style.willChange = "transform";
  });

  let rafPending = false;
  let mouseX = 0;
  let mouseY = 0;

  document.addEventListener("pointermove", (e) => {
    mouseX = e.clientX;
    mouseY = e.clientY;
    if (!rafPending) {
      rafPending = true;
      requestAnimationFrame(flushPointer);
    }
  }, { passive: true });

  function flushPointer() {
    rafPending = false;
    const x = mouseX.toFixed(1);
    const y = mouseY.toFixed(1);
    const xp = (mouseX / window.innerWidth).toFixed(4);
    const yp = (mouseY / window.innerHeight).toFixed(4);

    // Glow spotlight
    for (let i = 0; i < glowCards.length; i++) {
      const card = glowCards[i];
      card.style.setProperty("--x", x);
      card.style.setProperty("--y", y);
      card.style.setProperty("--xp", xp);
      card.style.setProperty("--yp", yp);
    }

    // Tilt on cards
    for (let i = 0; i < tiltCards.length; i++) {
      const card = tiltCards[i];
      const rect = card.getBoundingClientRect();
      if (mouseX < rect.left - 80 || mouseX > rect.right + 80 ||
          mouseY < rect.top - 80 || mouseY > rect.bottom + 80) continue;
      const nx = (mouseX - rect.left) / rect.width - 0.5;
      const ny = (mouseY - rect.top) / rect.height - 0.5;
      card.style.setProperty("--tilt-x", `${(-ny * 4).toFixed(2)}deg`);
      card.style.setProperty("--tilt-y", `${(nx * 5).toFixed(2)}deg`);
    }

    // Magnetic buttons
    for (let i = 0; i < magneticEls.length; i++) {
      const el = magneticEls[i];
      const rect = el.getBoundingClientRect();
      const dx = mouseX - (rect.left + rect.width / 2);
      const dy = mouseY - (rect.top + rect.height / 2);
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < 120) {
        el.style.transform = `translate(${(dx * 0.12).toFixed(2)}px, ${(dy * 0.12).toFixed(2)}px)`;
      }
    }
  }

  // Reset tilt on leave
  tiltCards.forEach((card) => {
    card.addEventListener("pointerleave", () => {
      card.style.setProperty("--tilt-x", "0deg");
      card.style.setProperty("--tilt-y", "0deg");
    }, { passive: true });
  });

  // Reset magnetic on leave
  magneticEls.forEach((el) => {
    el.addEventListener("pointerleave", () => {
      el.style.transform = "";
    }, { passive: true });
  });
})();

// ── Button ripple ────────────────────────────────────────────────
document.querySelectorAll(".button").forEach((button) => {
  button.addEventListener("click", (event) => {
    const rect = button.getBoundingClientRect();
    const ripple = document.createElement("span");
    ripple.className = "ripple";
    ripple.style.left = `${event.clientX - rect.left}px`;
    ripple.style.top = `${event.clientY - rect.top}px`;
    button.appendChild(ripple);
    ripple.addEventListener("animationend", () => ripple.remove(), { once: true });
  });
});

updateNavbar();

// ── Location Map Card — tilt only, click opens modal ─────────────
(function initLocMapCard() {
  const card = document.getElementById("locMapCard");

  function openMapModal() {
    if (card) { card.style.transform = ""; }
    document.getElementById("locMapModal")?.remove();

    const locName   = document.getElementById("locMapInfoName")?.textContent
                   || document.getElementById("locMapName")?.textContent
                   || "Selected Society";
    const locCoords = document.getElementById("locMapCoords")?.textContent
                   || "Mumbai, Maharashtra";

    const modal = document.createElement("div");
    modal.id = "locMapModal";
    modal.innerHTML = `
      <div class="lmm-backdrop"></div>
      <div class="lmm-card" role="dialog" aria-modal="true" aria-label="Parking location map">
        <button class="lmm-close" aria-label="Close">&times;</button>
        <div class="lmm-map">
          <div class="lmm-bg"></div>
          <svg class="lmm-roads" viewBox="0 0 400 300" preserveAspectRatio="none">
            <line x1="0" y1="105" x2="400" y2="105" class="lmm-road-main" stroke-width="5"/>
            <line x1="0" y1="195" x2="400" y2="195" class="lmm-road-main" stroke-width="5"/>
            <line x1="120" y1="0" x2="120" y2="300" class="lmm-road-main" stroke-width="4"/>
            <line x1="280" y1="0" x2="280" y2="300" class="lmm-road-main" stroke-width="4"/>
            <line x1="0" y1="60"  x2="400" y2="60"  class="lmm-road-sec"/>
            <line x1="0" y1="150" x2="400" y2="150" class="lmm-road-sec"/>
            <line x1="0" y1="240" x2="400" y2="240" class="lmm-road-sec"/>
            <line x1="60"  y1="0" x2="60"  y2="300" class="lmm-road-sec"/>
            <line x1="180" y1="0" x2="180" y2="300" class="lmm-road-sec"/>
            <line x1="220" y1="0" x2="220" y2="300" class="lmm-road-sec"/>
            <line x1="340" y1="0" x2="340" y2="300" class="lmm-road-sec"/>
          </svg>
          <div class="lmm-building" style="top:38%;left:8%;width:14%;height:22%"></div>
          <div class="lmm-building" style="top:12%;left:33%;width:13%;height:16%"></div>
          <div class="lmm-building" style="top:68%;left:72%;width:19%;height:19%"></div>
          <div class="lmm-building" style="top:18%;right:8%;width:11%;height:26%"></div>
          <div class="lmm-building" style="top:52%;left:4%;width:9%;height:13%"></div>
          <div class="lmm-building" style="top:6%;left:73%;width:15%;height:11%"></div>
          <div class="lmm-pin">
            <svg width="36" height="36" viewBox="0 0 24 24" fill="none">
              <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z" fill="#34d399"/>
              <circle cx="12" cy="9" r="2.5" fill="#020407"/>
            </svg>
          </div>
          <div class="lmm-fade"></div>
        </div>
        <div class="lmm-info">
          <div class="lmm-live"><span class="lmm-dot"></span><span>Live</span></div>
          <p class="lmm-name">${locName}</p>
          <p class="lmm-coords">${locCoords}</p>
        </div>
      </div>`;
    document.body.appendChild(modal);

    requestAnimationFrame(() => {
      modal.classList.add("lmm-open");
      modal.querySelectorAll(".lmm-road-main, .lmm-road-sec").forEach((l, i) => {
        l.style.strokeDasharray  = "500";
        l.style.strokeDashoffset = "500";
        setTimeout(() => {
          l.style.transition = `stroke-dashoffset ${0.7 + i * 0.05}s cubic-bezier(0.22,1,0.36,1)`;
          l.style.strokeDashoffset = "0";
        }, 150 + i * 40);
      });
      modal.querySelectorAll(".lmm-building").forEach((b, i) => {
        setTimeout(() => b.classList.add("lmm-in"), 300 + i * 70);
      });
      setTimeout(() => modal.querySelector(".lmm-pin")?.classList.add("lmm-in"), 280);
      setTimeout(() => modal.querySelector(".lmm-info")?.classList.add("lmm-in"), 400);
    });

    function close() {
      modal.classList.remove("lmm-open");
      modal.classList.add("lmm-out");
      setTimeout(() => modal.remove(), 400);
    }
    modal.querySelector(".lmm-close").addEventListener("click", close);
    modal.querySelector(".lmm-backdrop").addEventListener("click", close);
    document.addEventListener("keydown", function esc(e) {
      if (e.key === "Escape") { close(); document.removeEventListener("keydown", esc); }
    });
  }

  // Always expose globally — works even if card is null at load time
  window._openLocMapModal = openMapModal;

  if (!card) return;

  // Spring tilt
  let rotX = 0, rotY = 0, velX = 0, velY = 0, tX = 0, tY = 0, raf = 0;
  function spring() {
    velX = velX * 0.68 + (tX - rotX) * 0.22;
    velY = velY * 0.68 + (tY - rotY) * 0.22;
    rotX += velX; rotY += velY;
    card.style.transform = `rotateX(${rotX.toFixed(2)}deg) rotateY(${rotY.toFixed(2)}deg)`;
    if (Math.abs(velX) > 0.01 || Math.abs(velY) > 0.01 || Math.abs(tX-rotX) > 0.01 || Math.abs(tY-rotY) > 0.01)
      raf = requestAnimationFrame(spring);
    else { card.style.transform = ""; raf = 0; }
  }
  card.addEventListener("pointermove", e => {
    const r = card.getBoundingClientRect();
    tY =  ((e.clientX - r.left - r.width/2)  / (r.width/2))  * 8;
    tX = -((e.clientY - r.top  - r.height/2) / (r.height/2)) * 8;
    if (!raf) raf = requestAnimationFrame(spring);
  }, { passive: true });
  card.addEventListener("pointerleave", () => {
    tX = tY = 0;
    if (!raf) raf = requestAnimationFrame(spring);
  }, { passive: true });
  card.addEventListener("click", openMapModal);
  card.addEventListener("keydown", e => {
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openMapModal(); }
  });
})();

// ── Vehicles Sub-Page ────────────────────────────────────────────
(function initVehiclesPage() {
  const vpage   = document.getElementById("dbVehiclesPage");
  const backBtn = document.getElementById("dbVehiclesBack");

  if (!vpage) return;

  function openVehicles() {
    const cards = [...document.querySelectorAll(".db-vcard")];
    vpage.classList.add("is-open");
    vpage.removeAttribute("aria-hidden");
    document.body.style.overflow = "hidden";
    cards.forEach((card, i) => {
      card.classList.remove("is-visible");
      card.style.transitionDelay = `${i * 120}ms`;
      setTimeout(() => card.classList.add("is-visible"), 80 + i * 120);
    });
    startVehicleTimer();
  }

  function closeVehicles() {
    const cards = [...document.querySelectorAll(".db-vcard")];
    vpage.classList.remove("is-open");
    vpage.setAttribute("aria-hidden", "true");
    document.body.style.overflow = "";
    cards.forEach((card) => {
      card.classList.remove("is-visible");
      card.style.transitionDelay = "0ms";
    });
  }

  // Use document-level delegation so it works regardless of when dashboards page shows
  document.addEventListener("click", (e) => {
    const preview = e.target.closest("#dbVehiclesPreview");
    if (preview) { openVehicles(); return; }
    const back = e.target.closest("#dbVehiclesBack");
    if (back) { closeVehicles(); return; }
    const pageBtn = e.target.closest("#dbVehiclesPage [data-page]");
    if (pageBtn) {
      e.preventDefault();
      closeVehicles();
      setTimeout(() => navigateTo(pageBtn.dataset.page), 200);
    }
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && vpage.classList.contains("is-open")) closeVehicles();
  });

  let timerInterval = null;
  function startVehicleTimer() {
    clearInterval(timerInterval);
    const timerEl = document.querySelector(".db-vcard-timer[data-start]");
    if (!timerEl) return;
    const [h, m] = timerEl.dataset.start.split(":").map(Number);
    const startMs = new Date();
    startMs.setHours(h, m, 0, 0);
    function tick() {
      const diff = Math.max(0, Date.now() - startMs.getTime());
      const hrs  = Math.floor(diff / 3600000);
      const mins = Math.floor((diff % 3600000) / 60000);
      timerEl.textContent = hrs > 0 ? `${hrs}h ${mins}m` : `${mins}m`;
      const costEl = timerEl.closest(".db-vcard-body")?.querySelector("b:last-of-type");
      if (costEl) costEl.textContent = `INR ${Math.round((diff / 3600000) * 120)}`;
    }
    tick();
    timerInterval = setInterval(tick, 30000);
  }
})()();
