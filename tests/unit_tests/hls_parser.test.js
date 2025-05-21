// tests/unit_tests/hls_parser.test.js

/**
 * @jest-environment jsdom
 */

// --- Global Mocks ---
const mockFetch = jest.fn();
global.fetch = mockFetch;

const mockJwtDecode = jest.fn();
window.jwtDecodeGlobal = mockJwtDecode; // Attach to window for the script to find

const originalConsole = { ...console };

// Function to reset modules and re-require the script
function initializeHlsParser() {
    jest.resetModules(); // Resets module cache, script will re-run, state will be fresh

    // Re-apply global mocks if resetModules clears them or if they need to be fresh
    global.fetch = mockFetch;
    window.jwtDecodeGlobal = mockJwtDecode;

    // Suppress console output for cleaner test logs
    console.log = jest.fn();
    console.warn = jest.fn();
    console.error = jest.fn();

    require('../../src/js/core/hls_parser.js'); // Re-execute the script
}

describe('HLS Parser - metaviewAPI', () => {
    beforeEach(() => {
        initializeHlsParser(); // Ensure fresh state and mocks for each test
        mockFetch.mockClear();
        mockJwtDecode.mockClear();
    });

    afterAll(() => {
        // Restore original console
        console.log = originalConsole.log;
        console.warn = originalConsole.warn;
        console.error = originalConsole.error;
    });

    it('should expose all expected API functions', () => {
        const api = window.metaviewAPI.hlsparser;
        expect(api).toBeDefined();
        expect(typeof api.init).toBe('function');
        expect(typeof api.getMasterPlaylistUrl).toBe('function');
        expect(typeof api.getMasterManifestContent).toBe('function');
        expect(typeof api.getMediaPlaylistDetails).toBe('function');
        expect(typeof api.getAllVariantStreams).toBe('function');
        expect(typeof api.getHlsVersion).toBe('function');
        expect(typeof api.getTargetDuration).toBe('function');
        expect(typeof api.isLiveStream).toBe('function');
        expect(typeof api.getAllSegments).toBe('function');
        expect(typeof api.getSegmentByUrl).toBe('function');
        expect(typeof api.getSegmentById).toBe('function');
        expect(typeof api.getInitializationSegment).toBe('function');
        expect(typeof api.getActiveMediaPlaylistId).toBe('function');
        expect(typeof api.getLastHttpStatus).toBe('function');
        expect(typeof api.setDrmAuthToken).toBe('function');
        expect(typeof api.getDrmAuthToken).toBe('function');
    });

    describe('DRM Token Handling', () => {
        it('setDrmAuthToken and getDrmAuthToken should work', () => {
            const api = window.metaviewAPI.hlsparser;
            expect(api.getDrmAuthToken()).toBeNull();

            const validToken = 'valid.jwt.token';
            mockJwtDecode.mockReturnValue({ exp: Math.floor(Date.now() / 1000) + 3600 }); // Valid for 1 hour
            
            api.setDrmAuthToken(validToken);
            expect(api.getDrmAuthToken()).toBe(validToken);
            expect(mockJwtDecode).toHaveBeenCalledWith(validToken);

            api.setDrmAuthToken(null);
            expect(api.getDrmAuthToken()).toBeNull();
        });

        it('setDrmAuthToken should return status from logDrmTokenDetails', () => {
            const api = window.metaviewAPI.hlsparser;
            const validToken = 'valid.jwt.token';
            mockJwtDecode.mockReturnValue({ exp: Math.floor(Date.now() / 1000) + 3600 });
            expect(api.setDrmAuthToken(validToken)).toBe("OK");

            const expiredToken = 'expired.jwt.token';
            mockJwtDecode.mockReturnValue({ exp: Math.floor(Date.now() / 1000) - 3600 });
            expect(api.setDrmAuthToken(expiredToken)).toBe("WARNING: Token expired");

            mockJwtDecode.mockImplementation(() => { throw new Error('decode failed'); });
            expect(api.setDrmAuthToken('bad.jwt.token')).toBe("ERROR: Failed to decode token");
        });
    });

    describe('Initialization and Basic Fetching', () => {
        it('init should set masterUrl and attempt to fetch', async () => {
            const api = window.metaviewAPI.hlsparser;
            const testUrl = 'http://example.com/master.m3u8';

            mockFetch.mockResolvedValueOnce({
                ok: true,
                url: testUrl, 
                text: async () => '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1280000\nmedia.m3u8',
            });
            mockFetch.mockResolvedValueOnce({ // For media playlist
                ok: true,
                url: 'http://example.com/media.m3u8',
                text: async () => '#EXTM3U\n#EXTINF:10.0,\nsegment1.ts\n#EXT-X-ENDLIST',
            });
            
            const statusUpdateListener = jest.fn();
            document.addEventListener('hlsStatusUpdate', statusUpdateListener);

            await api.init(testUrl); 

            expect(api.getMasterPlaylistUrl()).toBe(testUrl);
            expect(mockFetch).toHaveBeenCalledWith(testUrl, expect.any(Object));
            expect(statusUpdateListener.mock.calls.some(call => 
                call[0].detail && call[0].detail.message && call[0].detail.message.includes(`Loading manifest: ${testUrl.substring(0,18)}`)
            )).toBe(true);
            document.removeEventListener('hlsStatusUpdate', statusUpdateListener);
        });
    });

    describe('Basic State Getters', () => {
        it('should return initial values from getters', () => {
            const api = window.metaviewAPI.hlsparser;
            expect(api.getMasterPlaylistUrl()).toBeNull();
            expect(api.getMasterManifestContent()).toBeNull();
            expect(api.getMediaPlaylistDetails()).toEqual({});
            expect(api.getAllVariantStreams()).toEqual([]);
            expect(api.getHlsVersion()).toBeNull();
            expect(api.getTargetDuration()).toBeNull();
            expect(api.isLiveStream()).toBe(false);
            expect(api.getAllSegments()).toEqual([]);
            expect(api.getActiveMediaPlaylistId()).toBeNull();
            expect(api.getLastHttpStatus()).toBeNull();
        });
    });

    describe('Event Dispatching', () => {
        it('should dispatch hlsStatusUpdate on init', (done) => {
            const api = window.metaviewAPI.hlsparser;
            const listener = (event) => {
                try {
                    expect(event.detail.message).toContain('Loading manifest:');
                    document.removeEventListener('hlsStatusUpdate', listener);
                    done(); 
                } catch (error) {
                    document.removeEventListener('hlsStatusUpdate', listener);
                    done(error); 
                }
            };
            document.addEventListener('hlsStatusUpdate', listener);
            
            mockFetch.mockResolvedValueOnce({ 
                ok: true, url: 'http://example.com/master.m3u8', text: async () => '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1\nmedia.m3u8',
            });
             mockFetch.mockResolvedValueOnce({ 
                ok: true, url: 'http://example.com/media.m3u8', text: async () => '#EXTM3U\n#EXT-X-ENDLIST',
            });
            api.init('http://example.com/master.m3u8');
        });
    });
});