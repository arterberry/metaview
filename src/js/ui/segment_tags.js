// js/ui/segment_tags.js

console.log('[segment-tags] Enhancing segment visuals');

document.addEventListener('DOMContentLoaded', () => {
    observeSegmentList();
    listenForExpirationEvents();
});

function observeSegmentList() {
    const observer = new MutationObserver(() => {
        document.querySelectorAll('#metadataList div[data-segment-id]').forEach(el => {
            const url = el.getAttribute('data-segment-url');
            const type = classifySegment(url);
            const badge = buildBadge(type);

            if (badge && !el.querySelector('.segment-badge')) {
                el.insertBefore(badge, el.firstChild.nextSibling); // after timestamp
            }
        });
    });

    const container = document.getElementById('metadataList');
    if (container) {
        observer.observe(container, { childList: true, subtree: true });
    }
}

function classifySegment(rawUrl = '', typeHint = null) {
    // --- Existing classification logic ---
    if (!rawUrl || typeof rawUrl !== 'string') {
        console.warn('[classifySegment] Received invalid input (null, undefined, or not a string). Returning "Segment".');
        return 'Segment'; // Handle null/undefined/non-string input early
    }
    let pathname = '';
    let url = rawUrl.toLowerCase();
    try {
        pathname = new URL(rawUrl).pathname;
    } catch (e) {
        console.warn(`[classifySegment] Failed to parse URL "${rawUrl}". Falling back to basic path extraction. Error: ${e.message}`);
        pathname = rawUrl.split('?')[0]; // Fallback for invalid URLs or relative paths
    }
    const lowerPathname = pathname.toLowerCase(); // Use lowercased pathname for checks
    const isAudio = lowerPathname.includes('audio=') || lowerPathname.includes('audio_eng=') || lowerPathname.includes('audio_only='); // Added audio_only=
    const isVideo = lowerPathname.includes('video=') || lowerPathname.includes('video_eng=') || lowerPathname.includes('video_only='); // Added video_only=
    const adMatch = /(ad|scte|splice)/.test(lowerPathname); // Removed word boundaries \b for broader matching

    // --- Use typeHint if available ---
    if (typeHint === 'master' || typeHint === 'media' || lowerPathname.endsWith('.m3u8')) return 'Playlist'; // Use lowerPathname
    if (typeHint === 'fragment') {
        if (adMatch) return 'Ad';
        if (isAudio && isVideo) return 'Muxed';
        if (isAudio) return 'Audio-Only';
        if (isVideo) return 'Video-Only';
        return 'Live'; // Default for fragment if not otherwise classified
    }
    // --- Fallback to original logic if no/other typeHint ---
    if (lowerPathname.includes('metadata')) return 'Metadata'; // Use lowerPathname
    if (adMatch) return 'Ad';
    if (isAudio && isVideo) return 'Muxed';
    if (isAudio) return 'Audio-Only';
    if (isVideo) return 'Video-Only';

    // Default fallback
    return 'Segment';
}
window.classifySegment = classifySegment;

function buildBadge(label) {
    if (!label) return null;
    const badge = document.createElement('span');
    badge.className = `segment-badge segment-${label.toLowerCase()}`;
    badge.textContent = label;
    return badge;
}

function listenForExpirationEvents() {
    document.addEventListener('segmentExpired', (e) => {
        const segmentId = e.detail?.id;
        const el = document.querySelector(`[data-segment-id="${segmentId}"]`);
        if (el && !el.querySelector('.segment-expired')) {
            const badge = document.createElement('span');
            badge.className = 'segment-expired';
            badge.textContent = 'EXPIRED';
            el.appendChild(badge);
        }
    });
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = {  buildBadge, classifySegment, listenForExpirationEvents }; // <-- Export the function
}