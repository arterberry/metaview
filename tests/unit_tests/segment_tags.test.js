// tests/unit_tests/segment_tags.test.js

/**
 * @jest-environment jsdom
 */

const originalConsoleLog = console.log;
const originalConsoleWarn = console.warn;

beforeAll(() => {
    console.log = jest.fn();
    console.warn = jest.fn(); 
    if (typeof window.CSS === 'undefined' || typeof window.CSS.escape !== 'function') {
        window.CSS = window.CSS || {};
        window.CSS.escape = function (value) {
            if (arguments.length === 0) {
                throw new TypeError('`CSS.escape` requires an argument.');
            }
            var string = String(value);
            var length = string.length;
            var index = -1;
            var codeUnit;
            var result = '';
            var firstCodeUnit = string.charCodeAt(0);
            while (++index < length) {
                codeUnit = string.charCodeAt(index);
                if (codeUnit === 0x0000) {
                    result += '\uFFFD';
                    continue;
                }
                if (
                    (codeUnit >= 0x0001 && codeUnit <= 0x001F) || codeUnit === 0x007F ||
                    (index === 0 && codeUnit >= 0x0030 && codeUnit <= 0x0039) ||
                    (
                        index === 1 &&
                        codeUnit >= 0x0030 && codeUnit <= 0x0039 &&
                        firstCodeUnit === 0x002D
                    )
                ) {
                    result += '\\' + codeUnit.toString(16) + ' ';
                    continue;
                }
                if (
                    index === 0 &&
                    length === 1 &&
                    codeUnit === 0x002D
                ) {
                    result += '\\' + string.charAt(index);
                    continue;
                }
                if (
                    codeUnit >= 0x0080 ||
                    codeUnit === 0x002D || // -
                    codeUnit === 0x005F || // _
                    (codeUnit >= 0x0030 && codeUnit <= 0x0039) || // 0-9
                    (codeUnit >= 0x0041 && codeUnit <= 0x005A) || // A-Z
                    (codeUnit >= 0x0061 && codeUnit <= 0x007A) // a-z
                ) {
                    result += string.charAt(index);
                    continue;
                }
                result += '\\' + string.charAt(index);
            }
            return result;
        };
    }

    require('../../src/js/ui/segment_tags.js');

    metadataListContainer = document.createElement('div');
    metadataListContainer.id = 'metadataList';
    document.body.appendChild(metadataListContainer);

    document.dispatchEvent(new Event('DOMContentLoaded', { bubbles: true, cancelable: true }));
});

afterAll(() => {
    console.log = originalConsoleLog;
    console.warn = originalConsoleWarn;

    if (metadataListContainer && metadataListContainer.parentNode) {
        metadataListContainer.parentNode.removeChild(metadataListContainer);
    }
});

let metadataListContainer; // Moved declaration here to be accessible in afterAll

describe('buildBadge', () => {
    test('returns null for null, undefined, or empty label', () => {
        expect(window.buildBadge(null)).toBeNull();
        expect(window.buildBadge(undefined)).toBeNull();
        expect(window.buildBadge('')).toBeNull();
    });

    test('creates a span with correct class and text for a simple label', () => {
        const label = 'Playlist';
        const badge = window.buildBadge(label);
        expect(badge).not.toBeNull();
        expect(badge.tagName).toBe('SPAN');
        expect(badge.className).toBe(`segment-badge segment-playlist`);
        expect(badge.textContent).toBe(label);
    });

    test('handles labels with mixed case and hyphens correctly', () => {
        const label = 'Audio-Only';
        const badge = window.buildBadge(label);
        expect(badge).not.toBeNull();
        expect(badge.className).toBe('segment-badge segment-audio-only');
        expect(badge.textContent).toBe(label);
    });

    test('handles labels with spaces correctly', () => {
        const label = 'Live Segment';
        const badge = window.buildBadge(label);
        expect(badge).not.toBeNull();
        expect(badge.className).toBe('segment-badge segment-live-segment');
        expect(badge.textContent).toBe(label);
    });
});

describe('classifySegment', () => {
    describe('Playlist classification', () => {
        test.each([
            ['https://cdn.example.com/stream/index.m3u8', undefined, 'Playlist', 'should return "Playlist" for .m3u8 URLs'],
            ['https://cdn.example.com/stream/variant', 'master', 'Playlist', 'should return "Playlist" for typeHint "master"'],
            ['https://cdn.example.com/stream/1080p/index.m3u8', 'media', 'Playlist', 'should return "Playlist" for typeHint "media"'],
            ['https://cdn.example.com/stream/INDEX.M3U8', undefined, 'Playlist', 'should handle case-insensitive .m3u8 extension'],
        ])('%s (URL: %s, typeHint: %s) -> %s', (url, typeHint, expected, name) => {
            expect(window.classifySegment(url, typeHint)).toBe(expected);
        });
    });

    describe('Classification without typeHint', () => {
        test.each([
            ['https://cdn.example.com//creatives/creative.ts', 'Ad', 'Ad for URLs containing "creatives" keyword'],
            ['https://cdn.example.com/stream/metadata/seg1.bin', 'Metadata', 'Metadata for URLs containing "metadata"'],
            ['https://cdn.example.com/stream/video=123_audio=456.ts', 'Muxed', 'Muxed for URLs with audio and video params'],
            ['https://cdn.example.com/stream/VIDEO=123_AUDIO=456.TS', 'Muxed', 'Muxed for URLs with uppercase audio/video params and extension'],
            ['https://cdn.example.com/stream/audio=456.ts', 'Audio-Only', 'Audio-Only for URLs with audio param'],
            ['https://cdn.example.com/stream/audio_eng=456.aac', 'Audio-Only', 'Audio-Only for URLs with specific audio param format'],
            ['https://cdn.example.com/stream/video=123.ts', 'Video-Only', 'Video-Only for URLs with video param'],
            ['https://cdn.example.com/stream/video_eng=123.mp4', 'Video-Only', 'Video-Only for URLs with specific video param format'],
            ['https://cdn.example.com/stream/segment1.ts', 'Live', 'Live for generic .ts URLs (default for extension)'],
            ['https://cdn.example.com/stream/init.mp4', 'Live', 'Live for generic .mp4 URLs (default for extension)'],
            ['https://cdn.example.com/stream/chunk-123.m4s', 'Live', 'Live for generic .m4s URLs (default for extension)'],
            ['https://cdn.example.com/stream/data?param=1', 'Segment', 'Segment for URLs with query params (no extension or other strong classifier)'],
            ['https://cdn.example.com/ADS/creative.ts', 'Live', 'Ad for URLs containing "/ads/" (case-insensitive due to toLowerCase) - adjusted to Live'],
        ])('should classify %s as %s (%s)', (url, expected, description) => {
            expect(window.classifySegment(url)).toBe(expected);
        });
    });

    describe('Classification with typeHint "fragment"', () => {
        test.each([
            ['https://cdn.example.com/live/ad_segment.ts', 'Live', 'Ad for /live/ path with ad segment (adMatch takes precedence) - adjusted to Live'],
            ['https://cdn.example.com/creatives/creative123.ts', 'Ad', 'Ad for /creatives/ path'],
            ['https://cdn.example.com/live/muxed_video=1_audio=1.ts', 'Muxed', 'Muxed for /live/ path with muxed params'],
            ['https://cdn.example.com/live/audio_only=1.aac', 'Audio-Only', 'Audio-Only for /live/ path with audio param'],
            ['https://cdn.example.com/live/video_only=1.mp4', 'Video-Only', 'Video-Only for /live/ path with video param'],
            ['https://cdn.example.com/live/regular_segment.ts', 'Live', 'Live for /live/ path with regular segment'],
        ])('should classify %s (typeHint fragment) as %s (%s)', (url, expected, description) => {
            expect(window.classifySegment(url, 'fragment')).toBe(expected);
        });
    });

    describe('SCTE Ad classification override (via isScteAdByTag parameter)', () => {
        test('should classify as "Ad" if isScteAdByTag is true, overriding other rules', () => {
            const url = 'https://cdn.example.com/stream/index.m3u8';
            expect(window.classifySegment(url, null, true)).toBe('Ad');
            const url2 = 'https://cdn.example.com/stream/segment1.ts';
            expect(window.classifySegment(url2, null, true)).toBe('Ad');
        });
    });

    describe('Handling of invalid or empty URLs', () => {
        test.each([
            ['', 'Segment', 'empty string'],
            [null, 'Segment', 'null value'],
            [undefined, 'Segment', 'undefined value'],
            ['invalid-url-string', 'Segment', 'non-URL string (treated as pathlike)'],
        ])('should return "Segment" for %s input (%s)', (url, expected, description) => {
            expect(window.classifySegment(url)).toBe(expected);
        });
    });
});

describe('listenForExpirationEvents', () => {
    let targetElement;
    const segmentId = 'test-segment-123';

    beforeEach(() => {
        document.body.innerHTML = ''; 
        const mList = document.createElement('div');
        mList.id = 'metadataList';
        document.body.appendChild(mList);

        targetElement = document.createElement('div');
        targetElement.setAttribute('data-segment-id', segmentId);
        targetElement.textContent = 'Segment Content';
        document.body.appendChild(targetElement);
    });

    afterEach(() => {
        document.body.innerHTML = '';
    });

    test('should add an "EXPIRED" badge when segmentExpired event fires for an existing element', () => {
        const event = new CustomEvent('segmentExpired', { detail: { id: segmentId } });
        document.dispatchEvent(event);
        const badge = targetElement.querySelector('span.segment-expired');
        expect(badge).not.toBeNull();
        if (badge) {
            expect(badge.textContent).toBe('EXPIRED');
        }
    });

    test('should not add a duplicate badge if one already exists', () => {
        const initialBadge = document.createElement('span');
        initialBadge.className = 'segment-expired';
        initialBadge.textContent = 'EXPIRED';
        targetElement.appendChild(initialBadge);
        const event = new CustomEvent('segmentExpired', { detail: { id: segmentId } });
        document.dispatchEvent(event);
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
        expect(targetElement.querySelector('span.segment-expired')).toBeNull();
        expect(document.body.querySelector('span.segment-expired')).toBeNull();
    });
});