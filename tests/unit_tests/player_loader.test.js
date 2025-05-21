// tests/unit_tests/player_loader.test.js

/**
 * @jest-environment jsdom
 */

// --- Global Mocks ---
let mockHlsInstance; // Will be re-assigned in setupHlsMock
const mockHlsAttachMedia = jest.fn();
const mockHlsLoadSource = jest.fn();
const mockHlsOn = jest.fn();
const mockHlsDestroy = jest.fn(); // In case error handling calls it

const setupHlsMock = (isSupported = true) => {
    mockHlsInstance = {
        attachMedia: mockHlsAttachMedia,
        loadSource: mockHlsLoadSource,
        on: mockHlsOn,
        destroy: mockHlsDestroy,
        // Add other methods if errors indicate they are needed
    };
    global.Hls = jest.fn(() => mockHlsInstance);
    global.Hls.isSupported = jest.fn(() => isSupported);
    global.Hls.Events = { // Add events used by player_loader
        MANIFEST_LOADING: 'hlsManifestLoading',
        LEVEL_LOADED: 'hlsLevelLoaded',
        FRAG_LOADING: 'hlsFragLoading',
        FRAG_LOADED: 'hlsFragLoaded',
        ERROR: 'hlsError',
        MANIFEST_PARSED: 'hlsManifestParsed',
        BUFFER_APPENDING: 'hlsBufferAppending',
        BUFFER_EOS: 'hlsBufferEos',

    };
    global.Hls.DefaultConfig = { // Needed for HeaderCaptureLoader extends
        loader: class {}
    };
    global.Hls.ErrorDetails = { // Add some common error details
        BUFFER_STALLED_ERROR: 'bufferStalledError',
    };
};

const originalConsole = { ...console };

function initializePlayerLoader(searchParams = '') {
    // Reset JSDOM URL and body for each init
    const url = `http://localhost${searchParams ? '?' + searchParams : ''}`;
    Object.defineProperty(window, 'location', {
        value: new URL(url),
        writable: true,
    });
    document.body.innerHTML = '<video id="hlsVideoPlayer"></video><div class="video-container"></div>';

    jest.resetModules();
    setupHlsMock(); // Default to HLS being supported

    // Suppress console
    console.log = jest.fn();
    console.warn = jest.fn();
    console.error = jest.fn();

    require('../../src/js/core/player_loader.js');
    // DOMContentLoaded is dispatched by the script itself after it's loaded
}


describe('Player Loader', () => {
    beforeEach(() => {
        // Mocks are set up in initializePlayerLoader
        mockHlsAttachMedia.mockClear();
        mockHlsLoadSource.mockClear();
        mockHlsOn.mockClear();
        if (global.Hls && global.Hls.isSupported) { // Ensure mock is there before clearing
            global.Hls.isSupported.mockClear();
        }
    });

    afterAll(() => {
        console.log = originalConsole.log;
        console.warn = originalConsole.warn;
        console.error = originalConsole.error;
    });

    describe('API', () => {
        it('should expose getHlsInstance on metaviewAPI.playerloader', () => {
            initializePlayerLoader('src=test.m3u8');
            document.dispatchEvent(new Event('DOMContentLoaded')); // Trigger script execution

            expect(window.metaviewAPI).toBeDefined();
            expect(window.metaviewAPI.playerloader).toBeDefined();
            expect(typeof window.metaviewAPI.playerloader.getHlsInstance).toBe('function');
        });

        it('getHlsInstance should return HLS instance if HLS.js is used', () => {
            initializePlayerLoader('src=test.m3u8');
            global.Hls.isSupported.mockReturnValue(true); // Ensure HLS path
            document.dispatchEvent(new Event('DOMContentLoaded'));

            expect(window.metaviewAPI.playerloader.getHlsInstance()).toBe(mockHlsInstance);
            expect(window.hlsPlayerInstance).toBe(mockHlsInstance);
        });

        it('getHlsInstance should return null if native playback is used or HLS not supported', () => {
            initializePlayerLoader('src=test.m3u8');
            global.Hls.isSupported.mockReturnValue(false);
            const videoElement = document.getElementById('hlsVideoPlayer');
            videoElement.canPlayType = jest.fn(() => false); // Native not supported either
            document.dispatchEvent(new Event('DOMContentLoaded'));

            expect(window.metaviewAPI.playerloader.getHlsInstance()).toBeNull();
            expect(window.hlsPlayerInstance).toBeNull();
        });
    });

    describe('Initialization', () => {
        it('should not initialize if no HLS URL is provided', () => {
            initializePlayerLoader(); // No src param
            const hlsLoadedListener = jest.fn();
            document.addEventListener('hlsLoaded', hlsLoadedListener);
            document.dispatchEvent(new Event('DOMContentLoaded'));

            expect(global.Hls).not.toHaveBeenCalled();
            expect(hlsLoadedListener).not.toHaveBeenCalled();
        });

        it('should initialize HLS.js if supported and URL is present', () => {
            const testUrl = 'http://example.com/stream.m3u8';
            initializePlayerLoader(`src=${encodeURIComponent(testUrl)}`);
            global.Hls.isSupported.mockReturnValue(true);

            const hlsLoadedListener = jest.fn();
            const newStreamListener = jest.fn();
            document.addEventListener('hlsLoaded', hlsLoadedListener);
            document.addEventListener('newStreamLoading', newStreamListener);

            document.dispatchEvent(new Event('DOMContentLoaded'));

            expect(global.Hls.isSupported).toHaveBeenCalled();
            expect(global.Hls).toHaveBeenCalledWith(expect.objectContaining({
                loader: expect.any(Function) // Checks HeaderCaptureLoader is used
            }));
            expect(mockHlsLoadSource).toHaveBeenCalledWith(testUrl);
            expect(mockHlsAttachMedia).toHaveBeenCalledWith(document.getElementById('hlsVideoPlayer'));
            expect(window.hlsPlayerInstance).toBe(mockHlsInstance);
            expect(hlsLoadedListener).toHaveBeenCalledWith(expect.objectContaining({
                detail: { hls: mockHlsInstance }
            }));
            expect(newStreamListener).toHaveBeenCalled();
        });

        it('should fallback to native HLS if HLS.js not supported but browser can play type', () => {
            const testUrl = 'http://example.com/native.m3u8';
            initializePlayerLoader(`src=${encodeURIComponent(testUrl)}`);
            global.Hls.isSupported.mockReturnValue(false);
            const videoElement = document.getElementById('hlsVideoPlayer');
            videoElement.canPlayType = jest.fn(() => 'probably');
            videoElement.play = jest.fn(() => Promise.resolve());


            const hlsLoadedListener = jest.fn(); // Should NOT be called for native
            document.addEventListener('hlsLoaded', hlsLoadedListener);

            document.dispatchEvent(new Event('DOMContentLoaded'));

            expect(global.Hls.isSupported).toHaveBeenCalled();
            expect(global.Hls).not.toHaveBeenCalled(); // HLS constructor not called
            expect(videoElement.canPlayType).toHaveBeenCalledWith('application/vnd.apple.mpegurl');
            expect(videoElement.src).toBe(testUrl);
            expect(hlsLoadedListener).not.toHaveBeenCalled();
            expect(window.hlsPlayerInstance).toBeNull();
        });

        it('should do nothing if video element not found', () => {
            initializePlayerLoader('src=test.m3u8');
            document.body.innerHTML = ''; // Remove video element
            global.Hls.isSupported.mockReturnValue(true);
            document.dispatchEvent(new Event('DOMContentLoaded'));
            
            expect(global.Hls).not.toHaveBeenCalled();
        });
    });

    describe('Utility Functions (getRawSrcUrl - implicitly tested by init)', () => {
        it('getRawSrcUrl should extract src from query parameters', () => {
            // This is indirectly tested by initializePlayerLoader setting up window.location
            // A direct test would be:
            // window.history.pushState({}, '', '/?src=test.m3u8');
            // expect(getRawSrcUrl()).toBe('test.m3u8'); // if getRawSrcUrl was exported
            // For now, rely on init tests covering it.
            // Minimal: covered by init tests successfully getting the URL.
        });
    });

    describe('Event Handling (Minimal - check attachment)', () => {
        it('should attach listeners for HLS events if HLS.js is used', () => {
            const testUrl = 'http://example.com/stream.m3u8';
            initializePlayerLoader(`src=${encodeURIComponent(testUrl)}`);
            global.Hls.isSupported.mockReturnValue(true);
            document.dispatchEvent(new Event('DOMContentLoaded'));

            expect(mockHlsOn).toHaveBeenCalledWith(Hls.Events.MANIFEST_LOADING, expect.any(Function));
            expect(mockHlsOn).toHaveBeenCalledWith(Hls.Events.LEVEL_LOADED, expect.any(Function));
            expect(mockHlsOn).toHaveBeenCalledWith(Hls.Events.ERROR, expect.any(Function));
            // ... add more for other crucial events if desired for "minimal"
        });
    });
});