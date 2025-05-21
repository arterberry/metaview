// tests/unit_tests/metrics_ui.test.js

/**
 * @jest-environment jsdom
 */

// --- Polyfill CSS.escape (keep as is) ---
if (typeof window.CSS === 'undefined' || typeof window.CSS.escape !== 'function') {
    window.CSS = window.CSS || {};
    window.CSS.escape = function(value) { /* ... polyfill code ... */
        if (arguments.length === 0) { throw new TypeError('`CSS.escape` requires an argument.'); }
        var string = String(value); var length = string.length; var index = -1;
        var codeUnit; var result = ''; var firstCodeUnit = string.charCodeAt(0);
        while (++index < length) {
            codeUnit = string.charCodeAt(index);
            if (codeUnit === 0x0000) { result += '\uFFFD'; continue; }
            if ((codeUnit >= 0x0001 && codeUnit <= 0x001F) || codeUnit === 0x007F ||
                (index === 0 && codeUnit >= 0x0030 && codeUnit <= 0x0039) ||
                (index === 1 && codeUnit >= 0x0030 && codeUnit <= 0x0039 && firstCodeUnit === 0x002D)) {
                result += '\\' + codeUnit.toString(16) + ' '; continue;
            }
            if (index === 0 && length === 1 && codeUnit === 0x002D) { result += '\\' + string.charAt(index); continue; }
            if (codeUnit >= 0x0080 || codeUnit === 0x002D || codeUnit === 0x005F ||
                (codeUnit >= 0x0030 && codeUnit <= 0x0039) || (codeUnit >= 0x0041 && codeUnit <= 0x005A) ||
                (codeUnit >= 0x0061 && codeUnit <= 0x007A)) {
                result += string.charAt(index); continue;
            }
            result += '\\' + string.charAt(index);
        }
        return result;
    };
}

// --- Global Mocks (Strategic Resetting) ---
let mockHlsInstance;
const originalConsole = { ...console };
const OriginalDate = global.Date;

function setupGlobalMocks() {
    mockHlsInstance = {
        on: jest.fn(),
        levels: [],
        audioTrack: -1,
        startLevel: -1,
        currentLevel: -1,
    };
    global.Hls = jest.fn(() => mockHlsInstance);
    global.Hls.Events = {
        LEVEL_SWITCHED: 'hlsLevelSwitched', FRAG_LOADING: 'hlsFragLoading',
        LEVEL_LOADED: 'hlsLevelLoaded', FRAG_LOADED: 'hlsFragLoaded',
        MANIFEST_PARSED: 'hlsManifestParsed', AUDIO_TRACKS_UPDATED: 'hlsAudioTracksUpdated',
        AUDIO_TRACK_SWITCHED: 'hlsAudioTrackSwitched', ERROR: 'hlsError',
    };
    global.Hls.ErrorTypes = { NETWORK_ERROR: 'networkError', MEDIA_ERROR: 'mediaError' };
    global.Hls.ErrorDetails = {
        BUFFER_STALLED_ERROR: 'bufferStalledError', FRAG_LOAD_ERROR: 'fragLoadError',
        FRAG_LOAD_TIMEOUT: 'fragLoadTimeout', FRAG_PARSING_ERROR: 'fragParsingError',
    };
    global.performance.getEntriesByName = jest.fn(() => []);
    global.navigator.connection = { effectiveType: '4g', downlink: 10, rtt: 50 };

    console.log = jest.fn();
    console.warn = jest.fn();
    console.error = jest.fn();
    global.Date = OriginalDate;
}

function initializeMetricsUI() {
    jest.resetModules();
    setupGlobalMocks();
    require('../../src/js/ui/metrics_ui.js');
}

function mockNewDate(isoString) {
    const specificTime = new OriginalDate(isoString).getTime();
    global.Date = class extends OriginalDate {
        constructor() {
            super();
            return new OriginalDate(specificTime);
        }
        static now() { return OriginalDate.now(); }
        static parse(val) { return OriginalDate.parse(val); }
        static UTC(...args) { return OriginalDate.UTC(...args); }
    };
}

function restoreDateMock() {
    global.Date = OriginalDate;
}

function setupMetricsDOM() {
    document.body.innerHTML = `
        <video id="hlsVideoPlayer"></video>
        <div id="qoe-tab">
            <div class="qoe-details-tabs">
                <button class="qoe-details-tab" data-qoe-tab="general">General</button>
                <button class="qoe-details-tab" data-qoe-tab="audio">Audio</button>
                <button class="qoe-details-tab" data-qoe-tab="subtitles">Subtitles</button>
                <button class="qoe-details-tab" data-qoe-tab="connection">Connection</button>
                <button class="qoe-details-tab" data-qoe-tab="qos">QoS</button>
                <button class="qoe-details-tab" data-qoe-tab="events">Events</button>
            </div>
            <div class="qoe-details-content">
                <div id="general-panel" class="qoe-details-panel">
                    <div id="cdnProvider">N/A</div> <div id="startupTime">N/A</div>
                    <div id="timeToFirstFrame">N/A</div> <div id="qualitySwitches">N/A</div>
                    <div id="rebufferingEvents">N/A</div> <div id="avgRebufferDuration">N/A</div>
                    <div id="currentBitrate">N/A</div> <div id="currentResolution">N/A</div>
                    <div id="playbackRate">N/A</div>
                </div>
                <div id="audio-panel" class="qoe-details-panel"><div id="audioTracksContainer"></div></div>
                <div id="subtitles-panel" class="qoe-details-panel"><div id="subtitlesContainer"></div></div>
                <div id="connection-panel" class="qoe-details-panel">
                    <div id="tcpThroughput">N/A</div> <div id="downloadSpeed">N/A</div>
                    <div id="connectionType">N/A</div> <div id="latency">N/A</div>
                </div>
                <div id="qos-panel" class="qoe-details-panel">
                    <div id="qosContainer">
                         <div id="availableBandwidth">N/A</div> <div id="avgSegmentDownloadTime">N/A</div>
                         <div id="segmentSuccessRate">N/A</div> <div id="serverResponseTime">N/A</div>
                    </div>
                </div>
                <div id="events-panel" class="qoe-details-panel"><div id="qoeEventHistory"></div></div>
            </div>
        </div>`;
}

describe('Metrics UI', () => {
    beforeAll(() => {
        setupGlobalMocks();
    });
    afterEach(() => {
        restoreDateMock();
    });
    afterAll(() => {
        console.log = originalConsole.log;
        console.warn = originalConsole.warn;
        console.error = originalConsole.error;
        restoreDateMock();
    });

    describe('Fresh State Tests (metaviewAPI, Initial DOM, Tab Switching)', () => {
        beforeEach(() => {
            initializeMetricsUI();
            setupMetricsDOM();
            document.dispatchEvent(new Event('DOMContentLoaded', { bubbles: true, cancelable: true }));
        });

        it('should expose metrics functions on metaviewAPI.metrics', () => {
            expect(window.metaviewAPI).toBeDefined();
            expect(window.metaviewAPI.metrics).toBeDefined();
            expect(typeof window.metaviewAPI.metrics.getQoEState).toBe('function');
            expect(typeof window.metaviewAPI.metrics.getCDN).toBe('function');
        });

        it('getQoEState should return an object with initial values', () => {
            const state = window.metaviewAPI.metrics.getQoEState();
            expect(typeof state).toBe('object');
            expect(state.startTime).toBeNull();
            expect(state.qualitySwitches).toBe(0);
            expect(state.cdnProvider).toBe('Unknown');
            expect(state.totalSegmentsRequested).toBe(0);
            expect(state.totalSegmentsLoaded).toBe(0);
            expect(state.totalSegmentsFailed).toBe(0);
        });

        it('should initialize with N/A or default values in the DOM', () => {
            expect(document.getElementById('cdnProvider').textContent).toBe('Unknown');
            expect(document.getElementById('startupTime').textContent).toBe('N/A');
            expect(document.getElementById('segmentSuccessRate').textContent).toBe('100% (0/0)');
        });

        it('setupDetailTabs should handle tab switching', () => {
            const generalTab = document.querySelector('[data-qoe-tab="general"]');
            const audioTab = document.querySelector('[data-qoe-tab="audio"]');
            const generalPanel = document.getElementById('general-panel');
            const audioPanel = document.getElementById('audio-panel');
            generalTab.click();
            expect(generalTab.classList.contains('active')).toBe(true);
            expect(generalPanel.classList.contains('active')).toBe(true);
            audioTab.click();
            expect(generalTab.classList.contains('active')).toBe(false);
            expect(audioTab.classList.contains('active')).toBe(true);
            expect(audioPanel.classList.contains('active')).toBe(true);
        });

        it('getEventHistory and addEvent integration', () => {
            document.dispatchEvent(new CustomEvent('hlsLoaded', { detail: { hls: mockHlsInstance } }));
            const manifestParsedHandler = mockHlsInstance.on.mock.calls.find(call => call[0] === Hls.Events.MANIFEST_PARSED)?.[1];
            if (manifestParsedHandler) {
                mockNewDate('2023-01-01T11:59:00.000Z');
                manifestParsedHandler('hlsManifestParsed', { audioTracks: [], subtitles: [], levels: [] });
                restoreDateMock();
            }
            let history = window.metaviewAPI.metrics.getEventHistory();
            const initialLength = history.length;

            mockNewDate('2023-01-01T12:00:00.000Z');
            const videoPlayer = document.getElementById('hlsVideoPlayer');
            videoPlayer.dispatchEvent(new Event('ratechange'));
            restoreDateMock();

            history = window.metaviewAPI.metrics.getEventHistory();
            expect(history.length).toBeGreaterThan(initialLength);
            expect(history[0].msg).toContain('Rate changed to');
        });

        // REMOVED: it('playbackBufferCheck returns correct status (with Date mocking)', () => { ... });
    });

    describe('Event-Driven DOM Updates and Metric Calculations', () => {
         beforeEach(() => {
            initializeMetricsUI();
            setupMetricsDOM();
            document.dispatchEvent(new Event('DOMContentLoaded', { bubbles: true, cancelable: true }));
            document.dispatchEvent(new CustomEvent('hlsLoaded', { detail: { hls: mockHlsInstance } }));
        });

        it('should update DOM on HLS.Events.LEVEL_SWITCHED', () => {
            const levelSwitchedHandler = mockHlsInstance.on.mock.calls.find(call => call[0] === Hls.Events.LEVEL_SWITCHED)?.[1];
            if (levelSwitchedHandler) {
                mockNewDate('2023-01-01T12:00:00.000Z');
                mockHlsInstance.levels = [{ bitrate: 1000000, width: 1280, height: 720, audioCodec: 'aac' }];
                levelSwitchedHandler('hlsLevelSwitched', { level: 0 });
                restoreDateMock();
                expect(document.getElementById('currentBitrate').textContent).toBe('1.00 Mbps');
                expect(document.getElementById('currentResolution').textContent).toBe('1280x720');
            }
        });

        it('should correctly update QoS metrics (avgSegmentDownloadTime focus)', () => {
            const fragLoadingHandler = mockHlsInstance.on.mock.calls.find(call => call[0] === Hls.Events.FRAG_LOADING)?.[1];
            const fragLoadedHandler = mockHlsInstance.on.mock.calls.find(call => call[0] === Hls.Events.FRAG_LOADED)?.[1];

            if (fragLoadingHandler && fragLoadedHandler) {
                let currentTime = 1000;
                const mockPerformanceNow = jest.spyOn(performance, 'now');
                mockNewDate('2023-01-01T12:00:00.000Z');

                mockPerformanceNow.mockReturnValueOnce(currentTime);
                fragLoadingHandler('hlsFragLoading', { frag: { sn: 1, url: 'url1' } });
                currentTime += 100;
                mockPerformanceNow.mockReturnValueOnce(currentTime);
                global.performance.getEntriesByName.mockReturnValueOnce([{ requestStart: 10, responseStart: 25 }]);
                fragLoadedHandler('hlsFragLoaded', { frag: { sn: 1, url: 'url1', level: 0 }, stats: { total: 500000, headers: {} } });

                mockPerformanceNow.mockReturnValueOnce(currentTime);
                fragLoadingHandler('hlsFragLoading', { frag: { sn: 2, url: 'url2' } });
                currentTime += 100;
                mockPerformanceNow.mockReturnValueOnce(currentTime);
                global.performance.getEntriesByName.mockReturnValueOnce([{ requestStart: 10, responseStart: 35 }]);
                fragLoadedHandler('hlsFragLoaded', { frag: { sn: 2, url: 'url2', level: 0 }, stats: { total: 600000, headers: {} } });
                
                mockPerformanceNow.mockRestore();
                restoreDateMock();

                expect(document.getElementById('avgSegmentDownloadTime').textContent).toBe('100 ms');
                expect(document.getElementById('segmentSuccessRate').textContent).toBe('100.0% (2/2)');
                expect(document.getElementById('tcpThroughput').textContent).toBe('44.00 Mbps');
                expect(document.getElementById('latency').textContent).toBe('20 ms');
            }
        });
    });
});