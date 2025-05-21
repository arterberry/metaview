// tests/segment_tags.test.js

/**
 * @jest-environment jsdom
 */


const { buildBadge, classifySegment, listenForExpirationEvents } = require('../../src/js/ui/segment_tags');

describe('buildBadge', () => {
    test('returns null for null, undefined, or empty label', () => {
        expect(buildBadge(null)).toBeNull();
        expect(buildBadge(undefined)).toBeNull();
        expect(buildBadge('')).toBeNull();
    });

    test('creates a span with correct class and text for a simple label', () => {
        const label = 'Playlist';
        const badge = buildBadge(label);
        expect(badge).not.toBeNull();
        expect(badge.tagName).toBe('SPAN');
        expect(badge.className).toBe(`segment-badge segment-${label.toLowerCase()}`);
        expect(badge.textContent).toBe(label);
    });

    test('handles labels with mixed case and hyphens correctly', () => {
        const label = 'Audio-Only';
        const badge = buildBadge(label);
        expect(badge).not.toBeNull();
        expect(badge.className).toBe('segment-badge segment-audio-only');
        expect(badge.textContent).toBe(label);
    });

    test('handles labels with spaces correctly', () => {
        const label = 'Live Segment';
        const badge = buildBadge(label);
        expect(badge).not.toBeNull();
        expect(badge.className).toBe('segment-badge segment-live segment'); // Spaces are included in the class name after lowercasing
        expect(badge.textContent).toBe(label);
    });
});

describe('classifySegment', () => {

    test('classifySegment returns "Playlist" for .m3u8 URLs', () => {
        // no typeHint needed—the .m3u8 suffix is enough
        expect(classifySegment('https://cdn.example.com/stream/index.m3u8')).toBe('Playlist');
    });

    test('classifySegment returns "Playlist" for typeHint "master"', () => {
        expect(classifySegment('https://cdn.example.com/stream/variant', 'master')).toBe('Playlist');
    });

    test('classifySegment returns "Playlist" for typeHint "media"', () => {
        expect(classifySegment('https://cdn.example.com/stream/1080p/index.m3u8', 'media')).toBe('Playlist');
    });

    test('classifySegment returns "Ad" for URLs containing creatives keywords (no hint)', () => {
        expect(classifySegment('https://cdn.example.com//creatives/creative.ts')).toBe('Ad');
    });

    test('classifySegment returns "Metadata" for URLs containing "metadata" (no hint)', () => {
        expect(classifySegment('https://cdn.example.com/stream/metadata/seg1.bin')).toBe('Metadata');
    });

    test('classifySegment returns "Muxed" for URLs with audio and video params (no hint)', () => {
        expect(classifySegment('https://cdn.example.com/stream/video=123_audio=456.ts')).toBe('Muxed');
    });

    test('classifySegment returns "Audio-Only" for URLs with audio param (no hint)', () => {
        expect(classifySegment('https://cdn.example.com/stream/audio=456.ts')).toBe('Audio-Only');
        expect(classifySegment('https://cdn.example.com/stream/audio_eng=456.aac')).toBe('Audio-Only');
    });

    test('classifySegment returns "Video-Only" for URLs with video param (no hint)', () => {
        expect(classifySegment('https://cdn.example.com/stream/video=123.ts')).toBe('Video-Only');
        expect(classifySegment('https://cdn.example.com/stream/video_eng=123.mp4')).toBe('Video-Only');
    });

    test('classifySegment returns "Segment" for generic URLs (no hint)', () => {
        expect(classifySegment('https://cdn.example.com/stream/segment1.ts')).toBe('Segment');
        expect(classifySegment('https://cdn.example.com/stream/init.mp4')).toBe('Segment');
        expect(classifySegment('https://cdn.example.com/stream/chunk-123.m4s')).toBe('Segment');
        expect(classifySegment('https://cdn.example.com/stream/data?param=1')).toBe('Segment');
    });

    test('classifySegment returns correct types with typeHint "fragment"', () => {
        expect(classifySegment('https://cdn.example.com/live/ad_segment.ts', 'fragment')).toBe('Live');
        expect(classifySegment('https://cdn.example.com/creatives/creative123.ts', 'fragment')).toBe('Ad');
        expect(classifySegment('https://cdn.example.com/live/muxed_video=1_audio=1.ts', 'fragment')).toBe('Muxed');
        expect(classifySegment('https://cdn.example.com/live/audio_only=1.aac', 'fragment')).toBe('Audio-Only');
        expect(classifySegment('https://cdn.example.com/live/video_only=1.mp4', 'fragment')).toBe('Video-Only');
        expect(classifySegment('https://cdn.example.com/live/regular_segment.ts', 'fragment')).toBe('Live');
    });    

    test('classifySegment handles empty or invalid URLs gracefully', () => {
        expect(classifySegment('')).toBe('Segment');
        expect(classifySegment(null)).toBe('Segment');
        expect(classifySegment(undefined)).toBe('Segment');
        expect(classifySegment('invalid-url-string')).toBe('Segment');
    });

    test('classifySegment handles case-insensitivity', () => {
        expect(classifySegment('https://cdn.example.com/stream/INDEX.M3U8')).toBe('Playlist');
        expect(classifySegment('https://cdn.example.com/stream/VIDEO=123_AUDIO=456.TS')).toBe('Muxed');
        expect(classifySegment('https://cdn.example.com/ADS/creative.ts')).toBe('Segment');
    });
});

// --- Tests for listenForExpirationEvents ---

describe('listenForExpirationEvents', () => {
    let targetElement;
    const segmentId = 'test-segment-123';

    beforeEach(() => {
        // Set up the DOM before each test
        document.body.innerHTML = `<div id="metadataList"><div data-segment-id="${segmentId}">Segment Content</div></div>`;
        targetElement = document.querySelector(`[data-segment-id="${segmentId}"]`);
        // Attach the listener we want to test
        listenForExpirationEvents();
    });

    afterEach(() => {
        // Clean up the DOM after each test
        document.body.innerHTML = '';
        // Note: Jest's environment usually isolates listeners, but explicit removal could be added if needed.
    });

    test('should add an "EXPIRED" badge when segmentExpired event fires for an existing element', () => {
        // Dispatch the event
        const event = new CustomEvent('segmentExpired', { detail: { id: segmentId } });
        document.dispatchEvent(event);

        // Check if the badge was added
        const badge = targetElement.querySelector('span.segment-expired');
        expect(badge).not.toBeNull();
        expect(badge.textContent).toBe('EXPIRED');
    });

    test('should not add a duplicate badge if one already exists', () => {
        // Add a badge first
        const initialBadge = document.createElement('span');
        initialBadge.className = 'segment-expired';
        targetElement.appendChild(initialBadge);

        // Dispatch the event again
        const event = new CustomEvent('segmentExpired', { detail: { id: segmentId } });
        document.dispatchEvent(event);

        // Check that there's still only one badge
        const badges = targetElement.querySelectorAll('span.segment-expired');
        expect(badges.length).toBe(1);
    });

    test('should do nothing if the event detail is missing or has no id', () => {
        const eventNoDetail = new CustomEvent('segmentExpired', { detail: null });
        document.dispatchEvent(eventNoDetail);
        expect(targetElement.querySelector('span.segment-expired')).toBeNull();

        const eventNoId = new CustomEvent('segmentExpired', { detail: {} });
        document.dispatchEvent(eventNoId);
        expect(targetElement.querySelector('span.segment-expired')).toBeNull();
    });

    test('should do nothing if the element for the segmentId does not exist', () => {
        const eventWrongId = new CustomEvent('segmentExpired', { detail: { id: 'non-existent-id' } });
        document.dispatchEvent(eventWrongId);

        // Check that no badge was added anywhere unexpectedly (specifically not to our targetElement)
        expect(targetElement.querySelector('span.segment-expired')).toBeNull();
        // Also check the whole body just in case
        expect(document.body.querySelector('span.segment-expired')).toBeNull();
    });
});
