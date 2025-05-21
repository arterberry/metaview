// tests/unit_tests/cache_manager.test.js

/**
 * @jest-environment jsdom
 */

const originalConsole = { ...console };
let currentCanvasContext = null; // Variable to hold the SUT's context

function initializeCacheManager(withDOM = true) {
    if (withDOM) {
        document.body.innerHTML = `
            <div id="cacheGraphContainer">
                <canvas id="cacheHitMissGraph"></canvas>
            </div>
            <div id="hitRatio"></div>
            <div id="segmentCount"></div>
            <div id="cacheTtlDisplay"></div>
        `;
    } else {
        document.body.innerHTML = '';
    }

    jest.resetModules();

    console.log = jest.fn();
    console.warn = jest.fn();
    console.error = jest.fn();

    // Important: Hook into getContext before the script runs and grabs it.
    // This allows us to capture the context that the SUT will actually use.
    const originalGetContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function(...args) {
        const context = originalGetContext.apply(this, args);
        if (args[0] === '2d' && this.id === 'cacheHitMissGraph') {
            currentCanvasContext = context; // Capture the SUT's context
        }
        return context;
    };

    require('../../src/js/ui/cache_manager.js');

    // Restore original getContext after script is loaded so it doesn't affect other tests/libraries
    HTMLCanvasElement.prototype.getContext = originalGetContext;
}

describe('Cache Manager', () => {
    beforeEach(() => {
        currentCanvasContext = null; // Reset for each test
        // initializeCacheManager is called within specific describe blocks or tests
    });

    afterAll(() => {
        console.log = originalConsole.log;
        console.warn = originalConsole.warn;
        console.error = originalConsole.error;
    });

    it('should initialize without errors and expose cacheData when DOM elements exist', () => {
        initializeCacheManager(true);
        document.dispatchEvent(new Event('DOMContentLoaded'));
        expect(window.cacheData).toBeDefined();
        expect(window.cacheData.hits).toBe(0);
        expect(console.error).not.toHaveBeenCalledWith(expect.stringContaining('Required DOM elements not found'));
    });

    it('should log an error and not throw if required DOM elements are missing', () => {
        initializeCacheManager(false);
        document.dispatchEvent(new Event('DOMContentLoaded'));
        expect(console.error).toHaveBeenCalledWith(expect.stringContaining('Required DOM elements not found'));
        expect(window.cacheData).toBeDefined();
    });

    describe('Event Handling and State Updates', () => {
        beforeEach(() => {
            initializeCacheManager(true);
            document.dispatchEvent(new Event('DOMContentLoaded'));
        });

        it('should reset state on newStreamLoading event', () => {
            document.dispatchEvent(new CustomEvent('cacheStatusDetected', { detail: { isHit: true } }));
            document.dispatchEvent(new CustomEvent('ttlInfoDetected', { detail: { ttlInfo: { hasDirectives: true, maxAge: 300 } } }));
            document.dispatchEvent(new CustomEvent('newStreamLoading'));
            expect(window.cacheData.total).toBe(0);
            expect(document.getElementById('cacheTtlDisplay').innerHTML).toBe('No TTL information available');
        });

        it('should update cache data and display on cacheStatusDetected (hit)', () => {
            document.dispatchEvent(new CustomEvent('cacheStatusDetected', { detail: { isHit: true } }));
            expect(window.cacheData.hits).toBe(1);
            expect(document.getElementById('hitRatio').textContent).toBe('Hit Ratio: 100.0%');
        });

        it('should update cache data and display on cacheStatusDetected (miss)', () => {
            document.dispatchEvent(new CustomEvent('cacheStatusDetected', { detail: { isHit: false } }));
            expect(window.cacheData.misses).toBe(1);
            expect(document.getElementById('hitRatio').textContent).toBe('Hit Ratio: 0.0%');
        });

        it('should update TTL display on ttlInfoDetected', () => {
            const ttlInfo = { hasDirectives: true, maxAge: 3600, sMaxAge: 7200, age: 600, directives: ['max-age=3600'] };
            document.dispatchEvent(new CustomEvent('ttlInfoDetected', { detail: { ttlInfo } }));
            const ttlDisplay = document.getElementById('cacheTtlDisplay');
            expect(ttlDisplay.innerHTML).toContain('Shared Max Age (s-maxage):</span>');
            expect(ttlDisplay.innerHTML).toContain('1 hr, 0 min');
        });

        it('should update TTL display with "No TTL information" if no directives', () => {
            document.dispatchEvent(new CustomEvent('ttlInfoDetected', { detail: { ttlInfo: { hasDirectives: false } } }));
            expect(document.getElementById('cacheTtlDisplay').innerHTML).toBe('No TTL information available');
        });
    });

    describe('Graphing (presence of elements, not pixel output)', () => {
        // No beforeEach here, initialize within the test that needs the spy

        it('should create graph labels (HIT/MISS)', () => {
            initializeCacheManager(true); // Initialize here for this specific test
            document.dispatchEvent(new Event('DOMContentLoaded'));
            const graphContainer = document.getElementById('cacheGraphContainer');
            expect(graphContainer.querySelector('.graph-label.hit-label')).not.toBeNull();
            expect(graphContainer.querySelector('.graph-label.miss-label')).not.toBeNull();
        });
    });
});