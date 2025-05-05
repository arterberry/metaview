// js/ui/cache_manager.js
// Description: Cache Manager for displaying cache hit/miss statistics and TTL information.

console.log('[cache_manager] Initializing...');

(function() {
    // --- State ---
    const cacheData = {
        hits: 0,
        misses: 0,
        total: 0,
        history: [], // Array of 1s (hit) and 0s (miss)
        maxHistory: 50 // Max points to show on graph
    };
    let latestTTLInfo = { hasDirectives: false }; // <--- STATE FOR TTL
    // Make cache data accessible globally if needed later
    window.cacheData = cacheData;

    // --- DOM Elements ---
    let canvas = null;
    let ctx = null;
    let hitRatioEl = null;
    let segmentCountEl = null;
    let hitLabelEl = null;
    let missLabelEl = null;
    let graphContainerEl = null;
    let cacheTtlDisplayEl = null; // <--- DOM ELEMENT FOR TTL

    // --- Initialization ---
    document.addEventListener('DOMContentLoaded', init);

    function init() {
        canvas = document.getElementById('cacheHitMissGraph');
        hitRatioEl = document.getElementById('hitRatio');
        segmentCountEl = document.getElementById('segmentCount');
        graphContainerEl = document.getElementById('cacheGraphContainer');
        cacheTtlDisplayEl = document.getElementById('cacheTtlDisplay'); // <--- GET TTL ELEMENT

        // Ensure all necessary elements are found
        if (!canvas || !hitRatioEl || !segmentCountEl || !graphContainerEl || !cacheTtlDisplayEl) {
            // console.error('[cache_manager] Required DOM elements not found (canvas, hitRatio, segmentCount, cacheGraphContainer, or cacheTtlDisplay).');
            return;
        }
        if (!canvas.getContext) {
             // console.error('[cache_manager] Canvas not supported.');
             return;
        }
        ctx = canvas.getContext('2d');

        createGraphLabels(); // Create labels dynamically

        // Reset state *after* elements are assigned but *before* drawing starts
        resetState();

        // Set initial display (baseline/labels/stats are called within resetState now)

        // Listen for events
        document.addEventListener('cacheStatusDetected', handleCacheStatusDetected);
        document.addEventListener('ttlInfoDetected', handleTtlInfoDetected); // <--- Listener for TTL
        document.addEventListener('newStreamLoading', resetState); // <-- Listener for reset

        // console.log('[cache_manager] Initialized and listening for cache, TTL, and reset events.');
    }

     // --- State Reset ---
     function resetState() {
        // console.log('[cache_manager] Resetting cache and TTL state.');
        // Reset cache data
        cacheData.hits = 0;
        cacheData.misses = 0;
        cacheData.total = 0;
        cacheData.history = [];
        // Reset TTL data
        latestTTLInfo = { hasDirectives: false };

        // Update UI elements to default state
        // IMPORTANT: Ensure the functions called here are defined *before* resetState is called in init
        updateStatsDisplay();
        updateCacheTTLDisplay(); // Resets TTL display
        drawInitialGraphState(); // Clears graph and redraws baseline/labels
    }


    // --- Label Creation and Positioning ---
    function createGraphLabels() {
         if (window.getComputedStyle(graphContainerEl).position === 'static') {
             graphContainerEl.style.position = 'relative';
         }
        graphContainerEl.querySelectorAll('.graph-label').forEach(el => el.remove());

         hitLabelEl = document.createElement('div');
         hitLabelEl.textContent = 'HIT';
         hitLabelEl.className = 'graph-label hit-label';
         graphContainerEl.appendChild(hitLabelEl);

         missLabelEl = document.createElement('div');
         missLabelEl.textContent = 'MISS';
         missLabelEl.className = 'graph-label miss-label';
         graphContainerEl.appendChild(missLabelEl);

         positionLabels(); // Position initially
    }

    function positionLabels() {
        if (!canvas || !hitLabelEl || !missLabelEl) return;
        const missLineY = canvas.height * 0.70; // Use consistent Y ratio

        hitLabelEl.style.top = '10px';
        hitLabelEl.style.left = '10px';

        missLabelEl.style.top = `${missLineY + 12}px`; // Adjusted padding below miss line
        missLabelEl.style.left = '10px';
    }


    // --- Event Handlers ---
    function handleCacheStatusDetected(event) {
        if (event.detail && typeof event.detail.isHit === 'boolean') {
            const isHit = event.detail.isHit;
            updateCacheData(isHit);
        }
    }

    function handleTtlInfoDetected(event) { // <--- TTL EVENT HANDLER
        if (event.detail && event.detail.ttlInfo) {
            latestTTLInfo = event.detail.ttlInfo;
            updateCacheTTLDisplay(); // Update UI when new TTL info arrives
        }
    }

    // --- Data Update ---
    function updateCacheData(isHit) {
        if (isHit) {
            cacheData.hits++;
        } else {
            cacheData.misses++;
        }
        cacheData.total++;

        cacheData.history.push(isHit ? 1 : 0);
        if (cacheData.history.length > cacheData.maxHistory) {
            cacheData.history.shift();
        }

        updateStatsDisplay();
        drawCacheGraph();
    }

    // --- UI Update Functions ---
    function updateStatsDisplay() {
        const hitRatio = cacheData.total > 0
            ? ((cacheData.hits / cacheData.total) * 100).toFixed(1) : 0;

        hitRatioEl.textContent = `Hit Ratio: ${hitRatio}%`;
        segmentCountEl.textContent = `Segments: ${cacheData.total}`;
    }

    // ---> ADDED updateCacheTTLDisplay DEFINITION HERE <---
    function updateCacheTTLDisplay() {
        if (cacheTtlDisplayEl) {
            // Depends on formatTTLDisplay being defined below
            cacheTtlDisplayEl.innerHTML = formatTTLDisplay(latestTTLInfo);
        } else {
            // console.warn("[cache_manager] Attempted to update TTL display, but element not found.");
        }
    }
    // ---> END FUNCTION ADDED <---


    function drawInitialGraphState() {
        if (!ctx || !canvas) return;
        const width = canvas.width;
        const height = canvas.height;
        ctx.clearRect(0, 0, width, height);

        ctx.beginPath();
        ctx.strokeStyle = '#ffffff'; // White baseline
        ctx.lineWidth = 0.25;
        ctx.moveTo(0, height / 2);
        ctx.lineTo(width, height / 2);
        ctx.stroke();

        positionLabels(); // Ensure labels are positioned correctly
    }

    function drawCacheGraph() {
        if (!ctx || !canvas) return;

        const history = cacheData.history;
        const len = history.length;
        const width = canvas.width;
        const height = canvas.height;
        const hitY = height * 0.25; // Adjusted HIT Y
        const missY = height * 0.70; // Adjusted MISS Y
        const xPadding = 10;
        const graphWidth = width - (xPadding * 2);
        const stepX = len > 1 ? graphWidth / (len - 1) : graphWidth; // Avoid division by zero if len=1

        drawInitialGraphState(); // Redraw background/baseline/labels

        if (len === 0) return;

        // --- Draw Connecting Lines ---
        ctx.beginPath();
        ctx.lineWidth = 0.5; // Corrected thin line width
        ctx.strokeStyle = '#ffffff'; // White connecting line
        for (let i = 0; i < len; i++) {
            const x = xPadding + (i * stepX);
            const y = history[i] === 1 ? hitY : missY;
            if (i === 0) {
                ctx.moveTo(x, y);
            } else {
                ctx.lineTo(x, y);
            }
        }
        ctx.stroke();

        // --- Draw Points (Circles/Dots) ---
        const pointRadius = 2.5;
        for (let i = 0; i < len; i++) {
            const x = xPadding + (i * stepX);
            const isHit = history[i] === 1;
            const y = isHit ? hitY : missY;

            ctx.beginPath();
            ctx.fillStyle = isHit ? '#90EE90' : '#FF8C8C'; // Light Green/Red
            ctx.arc(x, y, pointRadius, 0, Math.PI * 2);
            ctx.fill();
        }
    }


    // ---> ADDED formatTTLDisplay DEFINITION HERE <---
    function formatTTLDisplay(ttlInfo) {
        if (!ttlInfo || !ttlInfo.hasDirectives) {
            return "No TTL information available"; // Default message
        }

        let displayHtml = '';
        const formatTime = (seconds) => {
             if (seconds < 0) return "N/A";
             if (seconds < 60) return `${seconds} seconds`;
             if (seconds < 3600) return `${Math.floor(seconds / 60)} min, ${seconds % 60} sec`;
             const hours = Math.floor(seconds / 3600);
             const minutes = Math.floor((seconds % 3600) / 60);
             if (seconds < 86400) return `${hours} hr, ${minutes} min`;
             const days = Math.floor(seconds / 86400);
             return `${days} days, ${hours % 24} hr`;
        };

         // Show s-maxage if available
         if (ttlInfo.sMaxAge !== null) {
              displayHtml += `<div class="ttl-info">
                 <span>Shared Max Age (s-maxage):</span>
                 <span class="ttl-value">${formatTime(ttlInfo.sMaxAge)}</span>
             </div>`;
         }
         // Show max-age
         if (ttlInfo.maxAge !== null) {
             displayHtml += `<div class="ttl-info">
                 <span>Browser Max Age:</span>
                 <span class="ttl-value">${formatTime(ttlInfo.maxAge)}</span>
             </div>`;
         }
         // Show age
         if (ttlInfo.age !== null) {
             displayHtml += `<div class="ttl-info">
                 <span>Current Age:</span>
                 <span class="ttl-value">${ttlInfo.age} seconds</span>
             </div>`;
         }

         // Show remaining time
         const effectiveMaxAge = ttlInfo.sMaxAge !== null ? ttlInfo.sMaxAge : ttlInfo.maxAge;
         if (effectiveMaxAge !== null && ttlInfo.age !== null) {
             const remaining = Math.max(0, effectiveMaxAge - ttlInfo.age);
             displayHtml += `<div class="ttl-info">
                 <span>Remaining TTL:</span>
                 <span class="ttl-value">${formatTime(remaining)}</span>
             </div>`;
         }

         // Show expires
         if (ttlInfo.expires) {
             try {
                 const expiresDate = new Date(ttlInfo.expires);
                 const now = new Date();
                 const diffSeconds = Math.round((expiresDate - now) / 1000);

                 displayHtml += `<div class="ttl-info">
                     <span>Expires Header:</span>
                     <span class="ttl-value">${expiresDate.toLocaleString()} (${diffSeconds >= 0 ? 'in ' + formatTime(diffSeconds) : 'expired'})</span>
                 </div>`;
             } catch (e) {
                 displayHtml += `<div class="ttl-info"><span>Expires Header:</span><span class="ttl-value">${ttlInfo.expires} (Invalid Date)</span></div>`;
             }
         }

         // Show raw directives
         if (ttlInfo.directives && ttlInfo.directives.length > 0) {
             displayHtml += `<div class="ttl-info">
                 <span>Directives:</span>
                 <span class="ttl-directives-container">`;
             ttlInfo.directives.forEach(directive => {
                 displayHtml += `<span class="ttl-directive">${directive}</span>`;
             });
             displayHtml += `</span></div>`;
         }

         return displayHtml || "TTL information present but could not be formatted.";
    }
    // ---> END TTL FORMATTING FUNCTION <---


    // Optional: Redraw on resize
    window.addEventListener('resize', () => {
         if (canvas && ctx) {
            drawCacheGraph();
            positionLabels();
         }
    });


})(); // IIFE closes