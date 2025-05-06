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
    if (!rawUrl || typeof rawUrl !== 'string') {
        console.warn('[classifySegment] Received invalid input. Returning "Segment".');
        return 'Segment';
    }

    let pathname = '';
    try {
        pathname = new URL(rawUrl).pathname.toLowerCase();
    } catch (e) {
        console.warn(`[classifySegment] URL parse failed (“${rawUrl}”). Falling back to bare path.`);
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
        if (adMatch)             return 'Ad';
        if (isAudio && isVideo)  return 'Muxed';
        if (isAudio)             return 'Audio-Only';
        if (isVideo)             return 'Video-Only';
        return 'Live';
    }

    // Fallback
    if (pathname.includes('metadata'))   return 'Metadata';
    if (adMatch)                         return 'Ad';
    if (isAudio && isVideo)              return 'Muxed';
    if (isAudio)                         return 'Audio-Only';
    if (isVideo)                         return 'Video-Only';

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