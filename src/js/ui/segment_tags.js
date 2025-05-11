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
            console.log('[segment-tags] Received scteAdSegmentDetected for URL:', segmentUrl);
            scteAdSegmentUrls.add(segmentUrl);

            // Find the segment element in the UI and update its badge
            const segmentElement = document.querySelector(`#metadataList div[data-segment-url="${CSS.escape(segmentUrl)}"]`);
            if (segmentElement) {
                // Remove any existing badge to prevent duplicates or conflicts
                const existingBadge = segmentElement.querySelector('.segment-badge');
                if (existingBadge) {
                    existingBadge.remove();
                }
                // Add the "Ad" badge
                const adBadge = buildBadge('Ad'); // Force "Ad" type
                if (adBadge) {
                    // Insert after timestamp or at a consistent position
                    const timestampEl = segmentElement.querySelector('.segment-timestamp'); // Assuming timestamp has this class
                    if (timestampEl && timestampEl.nextSibling) {
                        segmentElement.insertBefore(adBadge, timestampEl.nextSibling);
                    } else if (segmentElement.firstChild && segmentElement.firstChild.nextSibling) {
                        segmentElement.insertBefore(adBadge, segmentElement.firstChild.nextSibling);
                    } else {
                        segmentElement.appendChild(adBadge); // Fallback
                    }
                    console.log('[segment-tags] Added "Ad" badge to segment:', segmentUrl);
                }
            } else {
                console.log('[segment-tags] Segment element not found in UI for SCTE ad URL:', segmentUrl);
            }
        }
    });
}

function observeSegmentList() {
    const observer = new MutationObserver((mutationsList) => {
        // Iterate over added nodes to only process new elements
        for (const mutation of mutationsList) {
            if (mutation.type === 'childList') {
                mutation.addedNodes.forEach(node => {
                    if (node.nodeType === Node.ELEMENT_NODE) {
                        // Check if the node itself is a segment div or if it contains them
                        const elementsToProcess = [];
                        if (node.matches && node.matches('#metadataList div[data-segment-id]')) {
                            elementsToProcess.push(node);
                        } else if (node.querySelectorAll) {
                            node.querySelectorAll('#metadataList div[data-segment-id]').forEach(el => elementsToProcess.push(el));
                        }

                        elementsToProcess.forEach(el => {
                            const url = el.getAttribute('data-segment-url');
                            // Check if this URL was previously marked as an SCTE ad
                            const isScteAd = scteAdSegmentUrls.has(url);


                            // *** DEBUG LOG 3: Observer Processing ***
                            if (isScteAd) {
                                console.log(`%c[SEGMENT_TAGS_OBSERVER] Segment ${url} IS an SCTE ad (found in scteAdSegmentUrls). Classifying.`, "color: purple; font-weight: bold;");
                            } else {
                                // Optional: log for non-SCTE ads if needed for other debugging
                                // console.log(`[SEGMENT_TAGS_OBSERVER] Segment ${url} is NOT (yet) an SCTE ad. Classifying based on URL/typeHint.`);
                            }

                            const type = classifySegment(url, null, isScteAd); // Pass SCTE ad status
                            const badge = buildBadge(type);

                            if (badge && !el.querySelector('.segment-badge')) {
                                // Insert after timestamp or at a consistent position
                                const timestampEl = el.querySelector('.segment-timestamp');
                                if (timestampEl && timestampEl.nextSibling) {
                                    el.insertBefore(badge, timestampEl.nextSibling);
                                } else if (el.firstChild && el.firstChild.nextSibling) {
                                    el.insertBefore(badge, el.firstChild.nextSibling);
                                } else {
                                    el.appendChild(badge); // Fallback
                                }
                            }
                        });
                    }
                });
            }
        }
    });

    const container = document.getElementById('metadataList');
    if (container) {
        observer.observe(container, { childList: true, subtree: true });
    }
}

function classifySegment(rawUrl = '', typeHint = null, isScteAdByTag = false) { // <-- Added isScteAdByTag
    if (!rawUrl || typeof rawUrl !== 'string') {
        // console.warn('[classifySegment] Received invalid input. Returning "Segment".');
        return 'Segment';
    }

    // --- NEW: Prioritize SCTE-based Ad detection ---
    if (isScteAdByTag) {
        return 'Ad';
    }
    // --- END NEW ---

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
window.classifySegment = classifySegment;

function buildBadge(label) {
    if (!label) return null;
    const badge = document.createElement('span');
    badge.className = `segment-badge segment-${label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`; // Sanitize class name
    badge.textContent = label;
    return badge;
}


function listenForExpirationEvents() {
    document.addEventListener('segmentExpired', (e) => {
        const segmentId = e.detail?.id;
        // Ensure segmentId is properly escaped for querySelector if it can contain special characters
        const el = document.querySelector(`div[data-segment-id="${CSS.escape(segmentId)}"]`);
        if (el && !el.querySelector('.segment-expired')) {
            const badge = document.createElement('span');
            badge.className = 'segment-expired';
            badge.textContent = 'EXPIRED';
            el.appendChild(badge);
        }
    });
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { buildBadge, classifySegment, listenForExpirationEvents }; // <-- Export the function
}