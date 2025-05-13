// js/ui/segment_tags.js

console.log('[segment-tags] Enhancing segment visuals');

// Store a set of URLs that have been identified as ads by SCTE
const scteAdSegmentUrls = new Set();

document.addEventListener('DOMContentLoaded', () => {
    observeSegmentList();
    listenForExpirationEvents();
    listenForScteAdEvents();
});

function listenForScteAdEvents() {
    document.addEventListener('scteAdSegmentDetected', (e) => {
        const segmentUrl = e.detail?.segmentUrl;
        if (segmentUrl) {
            console.log(`[segment-tags] SCTE AD EVENT: ${segmentUrl}`);
            scteAdSegmentUrls.add(segmentUrl);

            // Attempt to find and update the badge for this segment if it's already in the DOM
            const segmentElement = findSegmentElementByUrl(segmentUrl);
            if (segmentElement) {
                console.log(`[segment-tags] SCTE AD EVENT: Found existing segment ${segmentUrl}, re-badging as Ad.`);
                // Remove any existing badge(s) first to ensure clean update
                segmentElement.querySelectorAll('.segment-badge').forEach(b => b.remove());

                const adBadge = buildBadge('Ad'); // Force "Ad" type
                if (adBadge) {
                    insertBadge(segmentElement, adBadge);
                }
            } else {
                console.log(`[segment-tags] SCTE AD EVENT: Segment ${segmentUrl} not in UI yet. Observer will handle.`);
            }
        }
    });
}

// Helper function to find a segment element by its URL
function findSegmentElementByUrl(segmentUrl) {
    if (!segmentUrl) return null;
    const container = document.getElementById('metadataList');
    if (!container) return null;
    return container.querySelector(`div[data-segment-url="${CSS.escape(segmentUrl)}"]`);
}

// Helper function to insert the badge consistently
function insertBadge(segmentElement, badge) {
    if (!segmentElement || !badge) return;
    const timestampEl = segmentElement.querySelector('.segment-timestamp');
    if (timestampEl && timestampEl.nextSibling) {
        segmentElement.insertBefore(badge, timestampEl.nextSibling);
    } else if (segmentElement.firstChild && segmentElement.firstChild.nextSibling) {
        segmentElement.insertBefore(badge, segmentElement.firstChild.nextSibling);
    } else {
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
                        if (node.matches && node.matches('div[data-segment-id][data-segment-url]')) {
                            elementsToProcess.push(node);
                        }
                        node.querySelectorAll('div[data-segment-id][data-segment-url]').forEach(el => elementsToProcess.push(el));

                        const uniqueElements = [...new Set(elementsToProcess)];

                        uniqueElements.forEach(el => {
                            if (el.querySelector('.segment-badge.segment-ad')) {
                                return;
                            }
                            el.querySelectorAll('.segment-badge').forEach(b => b.remove());

                            const url = el.getAttribute('data-segment-url');
                            const typeHint = el.getAttribute('data-segment-type');
                            const isScteAd = scteAdSegmentUrls.has(url);

                            if (isScteAd) {
                                console.log(`[segment-tags] OBSERVER: Segment ${url} IS SCTE ad. Classifying.`);
                            }

                            const type = classifySegment(url, typeHint, isScteAd);
                            const badge = buildBadge(type);

                            if (badge) {
                                insertBadge(el, badge);
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
    } else {
        console.warn('[segment-tags] metadataList container not found for MutationObserver.');
    }
}

function classifySegment(rawUrl = '', typeHint = null, isScteAdByTag = false) {
    if (!rawUrl || typeof rawUrl !== 'string') {
        return 'Segment';
    }

    // Priority 1: SCTE-based Ad detection
    if (isScteAdByTag) {
        console.log(`[segment-tags] CLASSIFY: ${rawUrl} classified as 'Ad' due to SCTE tag.`);
        return 'Ad';
    }

    let pathname = '';
    try {
        pathname = new URL(rawUrl).pathname.toLowerCase();
    } catch (e) {
        pathname = rawUrl.split('?')[0].toLowerCase();
    }

    const isAudio = pathname.includes('audio=') || pathname.includes('audio_eng=') || pathname.includes('audio_only=');
    const isVideo = pathname.includes('video=') || pathname.includes('video_eng=') || pathname.includes('video_only=');
    
    // Detect SCTE/splice, explicit "/ad/" or Fox's "/creatives" segments as Ads
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
        return 'Live'; // Default for fragments is Live
    }

    // Check file extensions for Live content
    if (pathname.endsWith('.ts') || pathname.endsWith('.m4s') || pathname.endsWith('.mp4')) {
        if (adMatch) return 'Ad';
        if (isAudio && isVideo) return 'Muxed';
        if (isAudio) return 'Audio-Only';
        if (isVideo) return 'Video-Only';
        return 'Live'; // Default for these extensions is Live
    }

    // Further classification
    if (pathname.includes('metadata')) return 'Metadata';
    if (adMatch) return 'Ad';
    if (isAudio && isVideo) return 'Muxed';
    if (isAudio) return 'Audio-Only';
    if (isVideo) return 'Video-Only';

    return 'Segment';
}

// Make globally available if not already using modules
window.classifySegment = classifySegment;

function buildBadge(label) {
    if (!label) return null;
    const badge = document.createElement('span');
    // Sanitize class name: lowercase, replace non-alphanumeric with hyphen
    const sanitizedLabel = label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/-$/, '');
    badge.className = `segment-badge segment-${sanitizedLabel}`;
    badge.textContent = label;
    return badge;
}

function listenForExpirationEvents() {
    document.addEventListener('segmentExpired', (e) => {
        const segmentId = e.detail?.id;
        if (!segmentId) return;
        const el = document.querySelector(`div[data-segment-id="${CSS.escape(segmentId)}"]`);
        if (el && !el.querySelector('.segment-expired')) {
            const badge = document.createElement('span');
            badge.className = 'segment-expired';
            badge.textContent = 'EXPIRED';
            el.appendChild(badge);
        }
    });
}

// Make functions available globally
window.buildBadge = buildBadge;