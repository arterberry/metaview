// js/core/player_loader.js

document.addEventListener('DOMContentLoaded', () => {
    const video = document.getElementById('hlsVideoPlayer');
    if (!video) {
        console.error('[player_loader] Video element not found');
        return;
    }

    const hlsUrl = getRawSrcUrl();
    if (!hlsUrl) {
        console.warn('[player_loader] No HLS URL found in query params');
        return;
    }

    console.log('[player_loader] HLS URL:', hlsUrl);

    // NEW: Module-scoped arrays to store collected data for API getters
    let allCollectedHeaders = []; // Stores { url, headers, timestamp }
    let allCacheStatuses = [];  // Stores { url, isHit, timestamp }
    let allTtlInfos = [];       // Stores { url, ttlInfo, timestamp }
    let allPlayerErrors = [];   // Stores { type, details, message, fatal, timestamp, urlContext }
    let allEarlyScteDetections = []; // Stores { scteTagData, timestamp }
    let currentHlsConfig = null; // To store the HLS config used

    // Function to reset these arrays when a new stream starts
    function resetCollectedData() {
        allCollectedHeaders = [];
        allCacheStatuses = [];
        allTtlInfos = [];
        allPlayerErrors = [];
        allEarlyScteDetections = [];
        currentHlsConfig = null;
        // console.log('[player_loader] Collected data arrays have been reset.');
    }

    // Listen to the newStreamLoading event (dispatched by this script) to reset data
    document.addEventListener('newStreamLoading', resetCollectedData);    

    if (Hls.isSupported()) {

        // Helper function to parse header string (can be inside or outside the class)
        function parseHeaders(headerStr) {
            const headers = {};
            if (!headerStr) return headers;
            const headerPairs = headerStr.split('\u000d\u000a'); // Split by CRLF
            for (const headerPair of headerPairs) {
                if (headerPair) {
                    const index = headerPair.indexOf('\u003a\u0020'); // Colon and space
                    if (index > 0) {
                        const key = headerPair.substring(0, index).toLowerCase(); // Lowercase key
                        const value = headerPair.substring(index + 2);
                        headers[key] = value;
                    }
                }
            }
            return headers;
        }

        // Helper function to detect cache status
        function detectCacheStatus(headers) {
            // Order matters - check more definitive headers first
            // Cloudflare
            if (headers['cf-cache-status']) {
                const status = headers['cf-cache-status'].toUpperCase();
                if (status === 'HIT' || status === 'REVALIDATED' || status === 'UPDATING' || status === 'STALE') return true; // Treat revalidated/updating/stale as hits for ratio
                if (status === 'MISS' || status === 'EXPIRED' || status === 'BYPASS' || status === 'DYNAMIC') return false;
            }
            // Akamai / Generic X-Cache
            if (headers['x-cache']) {
                const status = headers['x-cache'].toUpperCase();
                if (status.includes('HIT')) return true;
                if (status.includes('MISS')) return false;
            }
            // Akamai specific hits
            if (headers['x-cache-hits']) {
                // Format can be "0, 0" or just "1" etc.
                const hits = headers['x-cache-hits'].split(',').map(v => parseInt(v.trim(), 10)).filter(n => !isNaN(n));
                if (hits.some(h => h > 0)) return true;
                if (hits.every(h => h === 0)) return false; // Only confirm miss if explicitly zero hits
            }
            // Generic Age header (less reliable on its own, but can confirm HIT)
            if (headers['age']) {
                const age = parseInt(headers['age'], 10);
                if (!isNaN(age) && age > 0) return true; // If age > 0, it must have been cached
            }
            // Fastly
            if (headers['x-served-by'] && headers['x-cache']) {
                // Fastly often uses x-cache HIT/MISS along with x-served-by
                const status = headers['x-cache'].toUpperCase();
                if (status.includes('HIT')) return true;
                if (status.includes('MISS')) return false;
            }
            // Varnish
            if (headers['x-varnish']) {
                // Varnish uses X-Varnish hit/miss count in a complex way, often check Age too
                if (headers['age'] && parseInt(headers['age'], 10) > 0) return true;
                // Could attempt to parse X-Varnish header if needed, but Age is simpler
            }

            // If no definitive header found
            // console.log('[detectCacheStatus] No definitive cache header found.'); // Debug
            return null; // Indicate unknown status
        }

        function extractTTLInfo(headers) {
            const ttlInfo = {
                cacheControl: null,
                expires: null,
                age: null,
                maxAge: null,
                sMaxAge: null, // Added s-maxage
                directives: [], // Store all directives
                hasDirectives: false
            };

            // Check Cache-Control first
            if (headers['cache-control']) {
                ttlInfo.cacheControl = headers['cache-control'];
                ttlInfo.hasDirectives = true;
                const directives = headers['cache-control'].toLowerCase().split(',').map(d => d.trim());
                ttlInfo.directives = directives; // Store raw directives

                directives.forEach(directive => {
                    if (directive.startsWith('max-age=')) {
                        const val = parseInt(directive.split('=')[1], 10);
                        if (!isNaN(val)) ttlInfo.maxAge = val;
                    } else if (directive.startsWith('s-maxage=')) {
                        const val = parseInt(directive.split('=')[1], 10);
                        if (!isNaN(val)) ttlInfo.sMaxAge = val;
                    }
                });
            }

            // Check Expires header
            if (headers['expires']) {
                ttlInfo.expires = headers['expires'];
                ttlInfo.hasDirectives = true;
            }

            // Check Age header
            if (headers['age']) {
                const ageVal = parseInt(headers['age'], 10);
                if (!isNaN(ageVal)) ttlInfo.age = ageVal;
                ttlInfo.hasDirectives = true;
            }

            return ttlInfo;
        }
        // --- END OF HEADER CAPTURE ADDITIONS ---

        // ---> ADD HEADER CAPTURE LOADER CLASS HERE <---
        class HeaderCaptureLoader extends Hls.DefaultConfig.loader {
            constructor(config) {
                super(config);
                const load = this.load.bind(this);
                this.load = function (context, config, callbacks) {
                    const originalOnSuccess = callbacks.onSuccess;

                    callbacks.onSuccess = function (response, stats, context, xhr) {
                        let cacheStatus = null;
                        let ttlInfo = null;
                        let processedHeaders = {}; // Use one variable for the parsed headers

                        // Only process headers for relevant types (e.g., segments)
                        if (context.type !== 'level' &&
                            context.type !== 'manifest' &&
                            context.type !== 'audioTrack' &&
                            context.type !== 'subtitleTrack' &&
                            xhr && xhr.getAllResponseHeaders) {
                            try {
                                const headerString = xhr.getAllResponseHeaders();
                                processedHeaders = parseHeaders(headerString); // Parse headers ONCE

                                // console.log(`[HeaderCaptureLoader] Headers received for ${getShortUrl(context.url)}:`, processedHeaders);

                                // STORE collected headers for API
                                allCollectedHeaders.push({
                                    url: xhr.responseURL || context.url,
                                    headers: { ...processedHeaders }, // Store a copy
                                    timestamp: Date.now()
                                });

                                // Dispatch cdnInfoDetected with the parsed headers
                                document.dispatchEvent(new CustomEvent('cdnInfoDetected', {
                                    detail: {
                                        url: xhr.responseURL || context.url,
                                        headers: { ...processedHeaders } // Send a copy
                                    }
                                }));

                                // Detect cache status using the parsed headers
                                cacheStatus = detectCacheStatus(processedHeaders);

                                // Extract TTL info using the parsed headers
                                ttlInfo = extractTTLInfo(processedHeaders);

                                if (ttlInfo && ttlInfo.hasDirectives) {
                                    // console.log("[HeaderCaptureLoader] TTL Info Extracted:", ttlInfo);
                                } else if (ttlInfo) {
                                    // console.log(`[HeaderCaptureLoader] No relevant TTL directives found in headers for ${getShortUrl(context.url)}.`);
                                }

                            } catch (e) {
                                console.error('[HeaderCaptureLoader] Error processing headers:', e);
                                // Ensure processedHeaders remains an empty object or is handled if error occurs mid-processing
                                processedHeaders = {};
                            }
                        } else {
                            // console.log(`[HeaderCaptureLoader] Skipping header processing for type: ${context.type} or XHR unavailable.`);
                        }

                        // Dispatch cache status event if found
                        if (cacheStatus !== null) {
                            allCacheStatuses.push({ // Store for API
                                url: xhr ? (xhr.responseURL || context.url) : context.url,
                                isHit: cacheStatus,
                                headers: { ...processedHeaders }, // Include context
                                timestamp: Date.now()
                            });
                            document.dispatchEvent(new CustomEvent('cacheStatusDetected', {
                                detail: { isHit: cacheStatus }
                            }));
                        }

                        // Dispatch TTL info event if relevant headers found
                        if (ttlInfo && ttlInfo.hasDirectives) {
                            allTtlInfos.push({ // Store for API
                                url: xhr ? (xhr.responseURL || context.url) : context.url,
                                ttlInfo: { ...ttlInfo },
                                headers: { ...processedHeaders }, // Include context
                                timestamp: Date.now()
                            });
                            document.dispatchEvent(new CustomEvent('ttlInfoDetected', {
                                detail: { ttlInfo: { ...ttlInfo } } // Send a copy
                            }));
                        }

                        originalOnSuccess(response, stats, context, xhr);
                    };
                    load(context, config, callbacks);
                };
            }
        }
        // ---> END OF CLASS DEFINITION <---        

        console.log('[player_loader] HLS.js is supported. Initializing...');

        const hlsConfig = {
            // --- Configuration from old code ---
            debug: false, // Keep debug off by default, can be enabled if needed
            // loader: createCustomLoader(Hls), // Omit custom loader for now            
            maxBufferLength: 30,
            maxMaxBufferLength: 60,
            maxBufferSize: 60 * 1000 * 1000, // 60MB
            maxBufferHole: 0.5,
            highBufferWatchdogPeriod: 3,
            nudgeOffset: 0.1,
            nudgeMaxRetry: 5,
            abrEwmaDefaultEstimate: 500000, // 500kbps
            abrEwmaFastLive: 3,
            abrEwmaSlowLive: 9,
            startLevel: -1, // Auto start level
            manifestLoadingTimeOut: 8000, // reduce buffer timeout 25K min
            manifestLoadingMaxRetry: 4,
            manifestLoadingRetryDelay: 100,
            manifestLoadingMaxRetryTimeout: 8000,
            liveSyncDurationCount: 1, // Use only 3 segments for live synchronization
            liveMaxLatencyDurationCount: 10, // Maximum latency
            liveDurationInfinity: true, // Keep loading new fragments
            // --- End of old config ---

            loader: HeaderCaptureLoader, // Use the new header capture loader

            // xhrSetup from existing code (modify if needed)
            xhrSetup: function (xhr, url) {
                // console.log('[player_loader] XHR request to:', url); // Can be noisy
                xhr.setRequestHeader('Accept', '*/*');
                xhr.setRequestHeader('Cache-Control', 'no-cache');
                xhr.setRequestHeader('Pragma', 'no-cache');
            },
        };

        currentHlsConfig = { ...hlsConfig }; // Store the current config for API access
        // Remove loader from the stored config if it's an issue for JSON stringification or display
        if (currentHlsConfig.loader) delete currentHlsConfig.loader;

        // console.log('[player_loader] HLS Config (with custom loader):', hlsConfig);
        const hls = new Hls(hlsConfig);

        window.hlsPlayerInstance = hls; // Make instance globally accessible

        // ---> ADD EVENT DISPATCH HERE <---
        // console.log('[player_loader] Dispatching newStreamLoading event.');
        document.dispatchEvent(new CustomEvent('newStreamLoading'));
        // ---> END EVENT DISPATCH <---

        hls.loadSource(hlsUrl);
        hls.attachMedia(video);

        //**  NEW SCTE35 TAG HANDLER
        // Listen for LEVEL_LOADED event to process SCTE35 tags
        // This is where we will process the SCTE35 tags
        // and dispatch them to the SCTE processor
        // This is a simplified version of the SCTE35 tag processing
        // and dispatching to the SCTE processor
        // This is where we will process the SCTE35 tags
        // and dispatch them to the SCTE processor
        // This is a simplified version of the SCTE35 tag processing
        // and dispatching to the SCTE processor

        hls.on(Hls.Events.LEVEL_LOADED, function (event, data) {
            if (data.details && data.details.fragments) {
                // Process tags for each fragment
                data.details.fragments.forEach(fragment => {
                    if (fragment.tagList) {
                        // Look for 'EXT-X-DATERANGE' tags with SCTE35-CMD
                        fragment.tagList.forEach(tag => {
                            if (tag[0] === 'EXT-X-DATERANGE' && tag[1] && tag[1].includes('SCTE35-CMD')) {
                                // Extract the raw line that would normally be processed later
                                const rawLine = `#EXT-X-DATERANGE:${tag[1]}`;

                                // Create a synthetic scteTagData object
                                const scteTagData = {
                                    line: rawLine,
                                    encoded: extractScte35CmdValue(tag[1]),
                                    encodingType: 'base64'  // Or 'hex' depending on your stream format
                                };

                                // STORE early SCTE detection for API
                                allEarlyScteDetections.push({
                                    scteTagData: { ...scteTagData }, // Store a copy
                                    timestamp: Date.now(),
                                    levelUrl: data.details.url // Context of the level
                                });

                                // Dispatch directly to your SCTE processor
                                dispatchScteTagData(scteTagData);
                            }
                        });
                    }
                });
            }
        });

        function extractScte35CmdValue(tagContent) {
            // Extract the base64/hex value after SCTE35-CMD=
            const match = tagContent.match(/SCTE35-CMD=([^,]+)/);
            if (match && match[1]) {
                // Remove any quotes and the leading 0x if present
                return match[1].replace(/^0x/, '').replace(/"/g, '');
            }
            return null;
        }

        function dispatchScteTagData(scteTagData) {
            // Create a synthetic segment object with the SCTE data
            const syntheticSegment = {
                url: "m3u8://earlydetection",  // Placeholder URL
                scteTagDataList: [scteTagData]
            };

            // Dispatch to your existing SCTE processor
            document.dispatchEvent(new CustomEvent('scteTagDetected', {
                detail: { segment: syntheticSegment }
            }));
        }

        // --- END OF SCTE35 TAG HANDLER ---

        hls.on(Hls.Events.MANIFEST_LOADING, function (event, data) {
            // console.log("[player_loader] HLS Event: Manifest loading:", data.url);
            // if (window.addPlayerLogEntry) window.addPlayerLogEntry(`Manifest loading: ${getShortUrl(data.url)}`);
        });

        hls.on(Hls.Events.FRAG_LOADING, function (event, data) {
            // console.log(`[player_loader] HLS Event: Fragment loading: ${data.frag.sn} (${data.frag.url})`);
            // if (window.addPlayerLogEntry) window.addPlayerLogEntry(`Frag loading: ${data.frag.sn} (${getShortUrl(data.frag.url)})`);
        });

        hls.on(Hls.Events.FRAG_LOADED, function (event, data) {
            const frag = data.frag;
            const url = frag.url;
            const sn = frag.sn; // Sequence number
            const duration = frag.duration;
            const level = frag.level;

            // console.log(`[player_loader] HLS Event: Fragment loaded: ${sn} (${getShortUrl(url)})`);

            // Create detail object for the UI event
            const fragmentDetail = {
                // Create a unique-ish ID for UI purposes
                id: `fragment_${sn}_${level}`,
                url: url,
                title: getSegmentDisplayName(url), // Use helper for filename
                type: 'fragment', // Specific type for live fragments
                sequence: sn,
                duration: duration,
                level: level,
                // Add any other relevant details from 'frag' if needed
            };

            // Dispatch event for manifest_ui.js to handle
            document.dispatchEvent(new CustomEvent('hlsFragLoadedUI', { detail: fragmentDetail }));
        });

        hls.on(Hls.Events.ERROR, function (event, data) {
            console.error("[player_loader] HLS Error Raw Data:", data); // Log the raw data for inspection

            let errorMessage = `HLS Error: ${data.details || 'Unknown Details'}`;
            let errorObj = data.error || data.err; // Get primary error object if present
            let urlContext = (data.context && data.context.url) ? data.context.url : (data.frag ? data.frag.url : null);

            // STORE player error for API
            allPlayerErrors.push({
                type: data.type,
                details: data.details,
                message: errorMessage, // The formatted message
                fatal: data.fatal,
                urlContext: urlContext,
                timestamp: Date.now(),
                rawData: { ...data } // Store a copy of the raw error data, careful with circular refs
            });

            // --- Add Specific Details Based on 'data.details' ---
            switch (data.details) {
                case Hls.ErrorDetails.FRAG_LOAD_ERROR:
                case Hls.ErrorDetails.FRAG_LOAD_TIMEOUT:
                case Hls.ErrorDetails.KEY_LOAD_ERROR:
                case Hls.ErrorDetails.KEY_LOAD_TIMEOUT:
                    // Add URL and Status Code if available from network response
                    if (data.response) errorMessage += ` - Status: ${data.response.code} ${data.response.text}`;
                    if (data.frag) errorMessage += ` - Frag URL: ${getShortUrl(data.frag.url)}`;
                    else if (data.context && data.context.url) errorMessage += ` - URL: ${getShortUrl(data.context.url)}`;
                    break;

                case Hls.ErrorDetails.FRAG_LOOP_LOADING_ERROR:
                    errorMessage = `HLS Error: Stuck loading fragment (fragLoopLoadingError)`;
                    if (data.frag) errorMessage += ` - Frag URL: ${getShortUrl(data.frag.url)}`;
                    break;

                case Hls.ErrorDetails.INTERNAL_EXCEPTION:
                    errorMessage = `HLS Error: Internal Exception`;
                    if (data.event) errorMessage += ` during event: ${data.event}`;
                    // 'err' often holds the actual exception here
                    errorObj = data.err || data.error;
                    break;

                case Hls.ErrorDetails.BUFFER_STALLED_ERROR:
                    errorMessage = 'Playback stalled (buffer empty)'; // Specific message
                    console.warn('[player_loader] Buffer stalled error detected.');
                    if (bufferingIndicator) bufferingIndicator.style.display = 'block'; // Show indicator directly
                    // We'll handle logging below, avoid double logging
                    break;

                case Hls.ErrorDetails.MANIFEST_LOAD_ERROR:
                case Hls.ErrorDetails.MANIFEST_LOAD_TIMEOUT:
                case Hls.ErrorDetails.LEVEL_LOAD_ERROR:
                case Hls.ErrorDetails.LEVEL_LOAD_TIMEOUT:
                    if (data.response) errorMessage += ` - Status: ${data.response.code} ${data.response.text}`;
                    if (data.context && data.context.url) errorMessage += ` - URL: ${getShortUrl(data.context.url)}`;
                    break;

                // Add more cases here if needed based on Hls.ErrorDetails enum
                default:
                    // Keep generic details, maybe add URL if context exists
                    if (data.context && data.context.url) errorMessage += ` - URL: ${getShortUrl(data.context.url)}`;
                    break;
            }

            // --- Append Primary Error Object Details (if any) ---
            if (errorObj) {
                if (errorObj.message) {
                    errorMessage += ` - Error: ${errorObj.message}`;
                } else {
                    // Fallback string conversion for non-standard errors
                    try {
                        let errorDetailsStr = String(errorObj);
                        if (errorDetailsStr !== '[object Object]') {
                            errorMessage += ` - Details: ${errorDetailsStr}`;
                        } else {
                            errorMessage += ` - (Error object present)`;
                        }
                    } catch (e) {
                        errorMessage += ` - (Could not stringify error object)`;
                    }
                }
            }

            // --- Log to UI (only if not just a buffer stall, which has its own message) ---
            // Log all errors to UI for now, can refine later if too noisy
            // if (data.details !== Hls.ErrorDetails.BUFFER_STALLED_ERROR) {
            console.error(`[player_loader] Formatted Error: ${errorMessage}`); // Log formatted error to console too
            // REMOVED: We decided to remove UI logging for errors earlier
            // if (window.addPlayerLogEntry) window.addPlayerLogEntry(errorMessage, true);
            // }

            // --- Fatal Error Handling ---
            if (data.fatal) {
                const fatalMessage = `FATAL HLS Error (${data.type || 'Unknown Type'}): ${data.details || 'No Details'}`;
                console.error(`[player_loader] ${fatalMessage}`);
                // REMOVED: We decided to remove UI logging for errors earlier
                // if (window.addPlayerLogEntry) window.addPlayerLogEntry(fatalMessage, true);

                // Recovery logic
                switch (data.type) {
                    case Hls.ErrorTypes.NETWORK_ERROR:
                        // console.log("[player_loader] Attempting recovery: hls.startLoad()");
                        hls.startLoad();
                        break;
                    case Hls.ErrorTypes.MEDIA_ERROR:
                        // console.log("[player_loader] Attempting recovery: hls.recoverMediaError()");
                        // Be cautious: recoverMediaError can sometimes trigger internal exceptions
                        try {
                            hls.recoverMediaError();
                        } catch (recoveryError) {
                            console.error("[player_loader] Error during recoverMediaError():", recoveryError);
                            // console.log("[player_loader] Destroying HLS instance due to recovery failure.");
                            hls.destroy(); // Destroy if recovery fails badly
                        }
                        break;
                    default:
                        // console.log("[player_loader] Non-recoverable fatal error or unhandled type. Destroying HLS instance.");
                        hls.destroy(); // Destroy for other fatal errors
                        break;
                }
            }
        });

        // --- Buffering Indicator Logic ---
        const bufferingIndicator = document.createElement('div');
        bufferingIndicator.id = 'bufferingIndicator';
        bufferingIndicator.textContent = 'Buffering...';
        Object.assign(bufferingIndicator.style, {
            display: 'none',
            position: 'absolute',
            top: '50%', left: '50%',
            transform: 'translate(-50%, -50%)',
            backgroundColor: 'rgba(0, 0, 0, 0.7)',
            color: 'white',
            padding: '10px 20px',
            borderRadius: '5px',
            zIndex: '1000',
            pointerEvents: 'none' // Ensure it doesn't block video controls
        });
        const videoContainer = document.querySelector('.video-container');
        if (videoContainer) {
            videoContainer.appendChild(bufferingIndicator);
        } else {
            console.warn('[player_loader] Video container not found for buffering indicator.');
        }

        // Also listen for BUFFER_APPENDING which means we might recover
        hls.on(Hls.Events.BUFFER_APPENDING, function () {
            if (video.paused && video.readyState >= 3) {
                // If paused but enough data, hide indicator
                bufferingIndicator.style.display = 'none';
            }
        });
        hls.on(Hls.Events.BUFFER_EOS, function () {
            // End of stream, hide indicator
            bufferingIndicator.style.display = 'none';
        });

        // Show/Hide based on video element events
        video.addEventListener('waiting', function () {
            // 'waiting' fires when playback stops due to lack of data
            // console.log('[player_loader] Video event: waiting (buffering)');
            bufferingIndicator.style.display = 'block';
        });
        video.addEventListener('playing', function () {
            // 'playing' fires when playback resumes after buffering or seeking
            // console.log('[player_loader] Video event: playing');
            bufferingIndicator.style.display = 'none';
        });
        video.addEventListener('seeking', function () {
            // Show buffering briefly during seek
            bufferingIndicator.style.display = 'block';
        });
        video.addEventListener('seeked', function () {
            // Hide buffering after seek completes if video can play
            if (!video.paused) {
                bufferingIndicator.style.display = 'none';
            }
        });
        video.addEventListener('pause', function () {
            // Hide indicator if user pauses
            bufferingIndicator.style.display = 'none';
        });
        // --- End of Buffering Logic ---

        hls.loadSource(hlsUrl);
        hls.attachMedia(video);

        // MANIFEST_PARSED listener (already existed, slightly modified log)
        hls.on(Hls.Events.MANIFEST_PARSED, () => {
            // console.log('[player_loader] HLS Event: Manifest parsed. Attempting playback.');
            // if (window.addPlayerLogEntry) window.addPlayerLogEntry('Manifest parsed, starting playback.');
            video.play().catch(err => {
                console.warn('[player_loader] Autoplay failed:', err.message);
                // if (window.addPlayerLogEntry) window.addPlayerLogEntry(`Autoplay failed: ${err.message}`, true);
                // Show controls so user can play manually
                video.controls = true;
            });
        });

        // Broadcast event AFTER attaching listeners
        // console.log('[player_loader] Dispatching hlsLoaded event.');
        document.dispatchEvent(new CustomEvent('hlsLoaded', { detail: { hls } }));

    } else if (video.canPlayType('application/vnd.apple.mpegurl')) {

        window.hlsPlayerInstance = null; // no HLS.js instance

        // Safari / native fallback
        video.src = hlsUrl;
        video.addEventListener('loadedmetadata', () => {
            // console.log('[player_loader] Native HLS loaded, starting playback');
            // if (window.addPlayerLogEntry) window.addPlayerLogEntry('Native HLS playback started.');
            video.play().catch(err => {
                console.warn('[player_loader] Native autoplay error:', err);
                // if (window.addPlayerLogEntry) window.addPlayerLogEntry(`Native autoplay failed: ${err.message}`, true);
            });
        });
        // Add basic error logging for native playback
        video.addEventListener('error', (e) => {
            console.error('[player_loader] Native video error:', e);
            const error = video.error;
            // if (window.addPlayerLogEntry && error) window.addPlayerLogEntry(`Native Player Error: Code ${error.code}, ${error.message}`, true);
            const errorMessage = error ? `Native Player Error: Code ${error.code}, ${error.message}` : 'Native Player Error: Unknown';

            allPlayerErrors.push({
                type: 'NativeMediaError',
                details: error ? error.message : 'Unknown',
                message: errorMessage,
                fatal: true, // Assume native errors can be fatal for playback
                urlContext: video.src,
                timestamp: Date.now(),
                rawData: error ? { code: error.code, message: error.message } : {}
            });
        });
    } else {
        window.hlsPlayerInstance = null; // no HLS.js instance
        console.error('[player_loader] HLS not supported in this browser');
        // if (window.addPlayerLogEntry) window.addPlayerLogEntry('HLS playback not supported in this browser.', true);
    }
});

// Helper function for short URLs (if not already available)
function getShortUrl(url, maxLength = 60) {
    if (!url) return '';
    if (url.length <= maxLength) return url;
    try {
        const parsed = new URL(url);
        const pathParts = parsed.pathname.split('/').filter(Boolean);
        const file = pathParts.pop() || '';
        const domain = parsed.hostname;
        let shortPath = pathParts.length > 0 ? `/.../${pathParts[pathParts.length - 1]}/` : '/';
        return `${domain}${shortPath}${file.substring(0, 15)}${file.length > 15 ? '...' : ''}${parsed.search}`;
    } catch {
        return url.substring(0, maxLength / 2) + '...' + url.substring(url.length - maxLength / 2);
    }
}

/** Extracts the full raw src from the query without decoding */
function getRawSrcUrl() {
    const raw = new URLSearchParams(window.location.search).get('src');
    // console.log('[player_loader] Raw "src" from query:', raw);
    return raw || null;
}

// =====================================
// === metaviewAPI PlayerLoader API ===
// =====================================
if (!window.metaviewAPI) window.metaviewAPI = {};
window.metaviewAPI.playerloader = {
    /**
     * Returns the active HLS.js player instance, or null if not initialized or using native playback.
     * @returns {object | null} The HLS.js instance or null.
     */
    getHlsInstance: function() {
        return window.hlsPlayerInstance || null; 
    }
};

console.log('[player_loader] API ready.');
/*
TEST CALL SHEET

window.metaviewAPI.playerloader.getHlsInstance();


*/
