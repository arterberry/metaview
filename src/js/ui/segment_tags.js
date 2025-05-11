// js/ui/segment_tags.js

console.log('[segment-tags] Enhancing segment visuals');

// Store a set of URLs that have been identified as ads by SCTE
const scteAdSegmentUrls = new Set();

document.addEventListener('DOMContentLoaded', () => {
    observeSegmentList();
    listenForExpirationEvents();
    listenForScteAdEvents(); // <-- Add new listener
});

function listenForScteAdEvents() {
    document.addEventListener('scteAdSegmentDetected', (e) => {
        const segmentUrl = e.detail?.segmentUrl;
        if (segmentUrl) {
            console.log(`[segment-tags] SCTE AD EVENT: ${segmentUrl}`);
            scteAdSegmentUrls.add(segmentUrl);

            // Attempt to find and update the badge for this segment if it's already in the DOM.
            // The MutationObserver will handle elements added *after* this event.
            const segmentElement = findSegmentElementByUrl(segmentUrl); // Use a helper
            if (segmentElement) {
                console.log(`[segment-tags] SCTE AD EVENT: Found existing segment ${segmentUrl}, re-badging as Ad.`);
                // Remove any existing badge(s) first to ensure clean update
                segmentElement.querySelectorAll('.segment-badge').forEach(b => b.remove());

                const adBadge = buildBadge('Ad'); // Force "Ad" type
                if (adBadge) {
                    insertBadge(segmentElement, adBadge); // Use a helper for consistent insertion
                }
            } else {
                // If not found, MutationObserver will handle it when it's added.
                console.log(`[segment-tags] SCTE AD EVENT: Segment ${segmentUrl} not in UI yet. Observer will handle.`);
            }
        }
    });
}

// Helper function to find a segment element by its URL
function findSegmentElementByUrl(segmentUrl) {
    if (!segmentUrl) return null;
    // Ensure the metadataList container exists
    const container = document.getElementById('metadataList');
    if (!container) return null;
    // Query within the container
    return container.querySelector(`div[data-segment-url="${CSS.escape(segmentUrl)}"]`);
}

// Helper function to insert the badge consistently
function insertBadge(segmentElement, badge) {
    if (!segmentElement || !badge) return;
    // Attempt to insert after a timestamp element if it exists, for consistent placement
    const timestampEl = segmentElement.querySelector('.segment-timestamp');
    if (timestampEl && timestampEl.nextSibling) {
        segmentElement.insertBefore(badge, timestampEl.nextSibling);
    } else if (segmentElement.firstChild && segmentElement.firstChild.nextSibling) {
        // Fallback: insert after the first child's sibling (usually the segment URL text node)
        segmentElement.insertBefore(badge, segmentElement.firstChild.nextSibling);
    } else {
        // Ultimate fallback: append
        segmentElement.appendChild(badge);
    }
}

function observeSegmentList() {
    const observer = new MutationObserver((mutationsList) => {
        for (const mutation of mutationsList) {
            if (mutation.type === 'childList') {
                mutation.addedNodes.forEach(node => {
                    if (node.nodeType === Node.ELEMENT_NODE) {
                        const elementsToProcess = [];
                        // Check if the added node itself is a segment div
                        if (node.matches && node.matches('div[data-segment-id][data-segment-url]')) { // Be more specific
                            elementsToProcess.push(node);
                        }
                        // Also check if the added node contains segment divs (e.g., if a batch of rows is added)
                        // Query only within the added node for efficiency
                        node.querySelectorAll('div[data-segment-id][data-segment-url]').forEach(el => elementsToProcess.push(el));

                        // Deduplicate if elements were found by both paths (though unlikely with current query)
                        const uniqueElements = [...new Set(elementsToProcess)];

                        uniqueElements.forEach(el => {
                            // Make sure we haven't already processed this exact element by the event listener
                            if (el.querySelector('.segment-badge.segment-ad')) {
                                // console.log(`[segment-tags] OBSERVER: Segment ${el.getAttribute('data-segment-url')} already badged as Ad, skipping observer re-badge.`);
                                return;
                            }
                            // Remove any other pre-existing badge before classifying (e.g. "Live", "Segment")
                            el.querySelectorAll('.segment-badge').forEach(b => b.remove());

                            const url = el.getAttribute('data-segment-url');
                            const isScteAd = scteAdSegmentUrls.has(url);

                            if (isScteAd) {
                                console.log(`%c[segment-tags] OBSERVER: Segment ${url} IS SCTE ad. Classifying.`, "color: green; font-weight: bold;");
                            }

                            const type = classifySegment(url, null, isScteAd);
                            const badge = buildBadge(type);

                            if (badge) { // No need to check for existing badge again, we removed it
                                insertBadge(el, badge); // Use helper
                            }
                        });
                    }
                });
            }
        }
    });

    const container = document.getElementById('metadataList');
    if (container) {
        observer.observe(container, { childList: true, subtree: true }); // Observe the list for additions
    } else {
        console.warn('[segment-tags] metadataList container not found for MutationObserver.');
    }
}

function classifySegment(rawUrl = '', typeHint = null, isScteAdByTag = false) { // <-- Added isScteAdByTag
    if (!rawUrl || typeof rawUrl !== 'string') {
        // console.warn('[classifySegment] Received invalid input. Returning "Segment".');
        return 'Segment';
    }

    // --- PRIORITY 1: SCTE-based Ad detection ---
    if (isScteAdByTag) {
        console.log(`[segment-tags] CLASSIFY: ${rawUrl} classified as 'Ad' due to SCTE tag.`);
        return 'Ad';
    }
    // --- END PRIORITY 1 ---

    let pathname = '';
    try {
        pathname = new URL(rawUrl).pathname.toLowerCase();
    } catch (e) {
        // console.warn(`[classifySegment] URL parse failed (“${rawUrl}”). Falling back to bare path.`);
        pathname = rawUrl.split('?')[0].toLowerCase();
    }

    const isAudio = pathname.includes('audio=') || pathname.includes('audio_eng=') || pathname.includes('audio_only=');
    const isVideo = pathname.includes('video=') || pathname.includes('video_eng=') || pathname.includes('video_only=');

    // ←— UPDATED: detect SCTE/splice, explicit “/ad/” or Fox’s “/creatives” segments as Ads
    const adMatch =
        /\b(?:scte|splice)\b/.test(pathname)
        || pathname.includes('/ad/')
        || pathname.includes('/creatives');

    // Use typeHint where we can
    if (typeHint === 'master' || typeHint === 'media' || pathname.endsWith('.m3u8')) {
        return 'Playlist';
    }
    if (typeHint === 'fragment') {
        if (adMatch) return 'Ad';
        if (isAudio && isVideo) return 'Muxed';
        if (isAudio) return 'Audio-Only';
        if (isVideo) return 'Video-Only';
        return 'Live';
    }

    // Fallback
    if (pathname.includes('metadata')) return 'Metadata';
    if (adMatch) return 'Ad';
    if (isAudio && isVideo) return 'Muxed';
    if (isAudio) return 'Audio-Only';
    if (isVideo) return 'Video-Only';

    return 'Segment';
}
// window.classifySegment = classifySegment;

function buildBadge(label) {
    if (!label) return null;
    const badge = document.createElement('span');
    // Sanitize class name: lowercase, replace non-alphanumeric with hyphen
    const sanitizedLabel = label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/-$/, '');
    badge.className = `segment-badge segment-${sanitizedLabel}`;
    badge.textContent = label;
    return badge;
}

// listenForExpirationEvents function (assuming it's fine and working independently)
function listenForExpirationEvents() {
    document.addEventListener('segmentExpired', (e) => {
        const segmentId = e.detail?.id;
        if (!segmentId) return;
        const el = document.querySelector(`div[data-segment-id="${CSS.escape(segmentId)}"]`);
        if (el && !el.querySelector('.segment-expired')) {
            const badge = document.createElement('span');
            badge.className = 'segment-expired segment-badge'; // Add segment-badge for consistent styling/removal
            badge.textContent = 'EXPIRED';
            el.appendChild(badge); // Consider consistent insertion like other badges
        }
    });
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { buildBadge, classifySegment, listenForExpirationEvents }; // <-- Export the function
}