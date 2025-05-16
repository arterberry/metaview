// js/core/hls_parser.js

console.log('[hls_parser] Loading...');

// JSON Web Token (JWT) decode library is expected to be available globally
const jwtDecodeFromWindow = (typeof window !== 'undefined' && typeof window.jwtDecodeGlobal === 'function')
    ? window.jwtDecodeGlobal
    : null;

if (!jwtDecodeFromWindow) {
    console.warn('[hls_parser] window.jwtDecodeGlobal function not found. DRM token claim logging will be limited. Ensure jwt-decode.bundle.min.js is loaded.');
}

const state = {
    masterUrl: null,
    masterManifest: null,
    mediaPlaylists: {}, // { id: { url, content, segments: [], bandwidth?, resolution? } }
    allSegments: [],    // Flat list of all unique segments encountered across playlists
    segmentMap: new Map(), // Map segment URL to segment object for quick lookup
    activeMediaPlaylistId: null,
    playlistRefreshInterval: null,
    updateInterval: 3000, // ms
    isLive: false,
    initialLoadComplete: false,
    lastHttpStatus: null, // Updated: Stores an object { code, message, url, timestamp, error } or null
    targetDuration: null,
    hlsVersion: null,
    drmAuthToken: null, // ADDED: Stores the user-provided bearer token
    drmTokenDetailsLogged: false, // ADDED: Flag to ensure token details are logged only once per token until it changes
    variantStreams: []
};

/**
 * Logs details of the provided DRM authentication token.
 * This includes decoded claims like expiration (exp), audience (aud), and issuer (iss).
 * It also warns if the token is expired.
 * @param {string} tokenString The JWT token string.
 */
function logDrmTokenDetails(tokenString) {
    if (!tokenString) {
        console.log('[hls_parser:DRM] No DRM token provided to log.');
        return "ERROR: No token provided";
    }

    console.log(`[hls_parser:DRM] User provided token. M3U8 URL: ${getShortUrl(state.masterUrl || 'N/A')}`);

    if (!jwtDecodeFromWindow) {
        console.warn('[hls_parser:DRM] Cannot decode token: window.jwtDecodeGlobal function is not available.');
        dispatchStatusUpdate("DRM token set (decode unavailable).");
        return "WARNING: Decode function missing";
    }

    try {
        const decodedToken = jwtDecodeFromWindow(tokenString);
        const expirationTimestamp = decodedToken.exp;
        const audience = decodedToken.aud;
        const issuer = decodedToken.iss;
        const currentTime = Math.floor(Date.now() / 1000);

        console.log(`[hls_parser:DRM] Decoded Token - exp: ${expirationTimestamp ? new Date(expirationTimestamp * 1000).toISOString() : 'N/A'}, aud: ${audience || 'N/A'}, iss: ${issuer || 'N/A'}.`);

        if (expirationTimestamp) {
            if (currentTime > expirationTimestamp) {
                console.warn(`[hls_parser:DRM] WARNING: User-provided token is EXPIRED.`);
                dispatchStatusUpdate("Warning: Provided DRM token is EXPIRED.");
                state.drmTokenDetailsLogged = true;
                return "WARNING: Token expired";
            } else {
                console.log("[hls_parser:DRM] Token valid.");
                dispatchStatusUpdate("DRM token validated.");
                state.drmTokenDetailsLogged = true;
                return "OK";
            }
        } else {
            console.log("[hls_parser:DRM] No expiration claim.");
            dispatchStatusUpdate("Token processed (no expiration).");
            state.drmTokenDetailsLogged = true;
            return "WARNING: No expiration claim";
        }
    } catch (error) {
        console.error('[hls_parser:DRM] Error decoding DRM token:', error.message);
        console.log(`[hls_parser:DRM] Token (first 10 chars): ${tokenString.substring(0, 10)}...`);
        dispatchStatusUpdate("Error: Could not decode DRM token.");
        state.drmTokenDetailsLogged = false;
        return "ERROR: Failed to decode token";
    }
}


/**
 * Sets the DRM authentication token.
 * This function is intended to be called by the UI or other parts of the application
 * when the user provides a token.
 * @param {string | null} token The bearer token string, or null to clear.
 */
    // Note: The actual use of this token (attaching to HLS.js license requests)
    // needs to be handled by the HLS.js player setup logic, which should call
    // getDrmAuthToken() to retrieve it.
function setDrmAuthToken(token) {
    const oldToken = state.drmAuthToken;
    state.drmAuthToken = token ? String(token).trim() : null;

    if (state.drmAuthToken !== oldToken) {
        state.drmTokenDetailsLogged = false;
    }

    if (state.drmAuthToken) {
        console.log('[hls_parser:DRM] DRM Authentication Token has been set/updated.');
        return logDrmTokenDetails(state.drmAuthToken); // <- return status
    } else {
        if (oldToken) {
            console.log('[hls_parser:DRM] DRM Authentication Token has been cleared.');
            dispatchStatusUpdate("DRM token cleared.");
        }
        return "OK";
    }
}


/**
 * Retrieves the currently set DRM authentication token.
 * @returns {string | null} The bearer token string, or null if not set.
 */
function getDrmAuthToken() {
    return state.drmAuthToken;
}


// ---- Event Dispatcher ----
function dispatchStatusUpdate(message) {
    document.dispatchEvent(new CustomEvent('hlsStatusUpdate', { detail: { message } }));
}

function dispatchSegmentAdded(segment) {
    // Only add unique segments based on URL to the central list
    if (!state.segmentMap.has(segment.url)) {
        state.allSegments.push(segment);
        state.segmentMap.set(segment.url, segment);
        document.dispatchEvent(new CustomEvent('hlsSegmentAdded', { detail: { segment } }));
    } else {
        // Optionally update existing segment if needed (e.g., new metadata)
        console.log(`[hls_parser] Segment already known: ${segment.url}`);
    }
}

function dispatchPlaylistParsed(type, details) { // type = 'master' or 'media'
    document.dispatchEvent(new CustomEvent('hlsPlaylistParsed', { detail: { type, ...details } }));
}


// ---- Parser Initialization ----
function initHlsParser(initialUrl) { // Renamed 'url' to 'initialUrl'
    if (!initialUrl) {
        dispatchStatusUpdate("Error: No HLS URL provided.");
        console.error("[hls_parser] Initialization failed: No URL.");
        return;
    }
    state.masterUrl = initialUrl;
    dispatchStatusUpdate(`Loading manifest: ${getShortUrl(initialUrl)}`);

    // ADDED: Log DRM token details if a token is already set and not yet logged for this token
    if (state.drmAuthToken && !state.drmTokenDetailsLogged) {
        console.log('[hls_parser:DRM] Initializing parser with a pre-set DRM token. Logging details...');
        logDrmTokenDetails(state.drmAuthToken);
    } else if (state.drmAuthToken && state.drmTokenDetailsLogged) {
        console.log('[hls_parser:DRM] Initializing parser; DRM token already set and details previously logged.');
    } else {
        console.log('[hls_parser:DRM] Initializing parser; no DRM token currently set.');
    }

    // Add the initial Master/Media playlist entry to the UI immediately
    // We guess the type first, and refine after fetching
    const initialEntry = {
        id: 'initial_playlist',
        url: initialUrl,
        title: 'Loading Playlist...',
        type: 'unknown' // Will be updated later
    };
    dispatchSegmentAdded(initialEntry); // Send to UI


    fetchManifest(initialUrl) // Fetch the initial URL
        .then(fetchResult => { // fetchResult is { content, finalUrl }
            const content = fetchResult.content;
            const finalFetchedUrl = fetchResult.finalUrl; // This URL might have the token in the path due to redirect

            const isMaster = isMasterPlaylist(content);
            const playlistType = isMaster ? 'master' : 'media';
            // ...
            document.dispatchEvent(new CustomEvent('hlsUpdateSegmentType', {
                // Use finalFetchedUrl for UI updates if it's more representative, or initialUrl if preferred for the "entry point" display
                detail: {
                    url: initialUrl, // Or finalFetchedUrl, depending on what manifest_ui uses to match
                    type: playlistType,
                    title: isMaster ? 'Master Playlist' : 'Media Playlist'
                }
            }));

            if (isMaster) {
                console.log('[hls_parser] Detected master playlist. Initial URL:', getShortUrl(initialUrl), 'Final Fetched URL:', getShortUrl(finalFetchedUrl));
                parseMasterPlaylist(content, finalFetchedUrl); // <<<< PASS THE FINAL FETCHED URL HERE
            } else {
                console.log('[hls_parser] Detected media playlist. Initial URL:', getShortUrl(initialUrl), 'Final Fetched URL:', getShortUrl(finalFetchedUrl));
                handleDirectMediaPlaylist(content, finalFetchedUrl); // <<<< PASS THE FINAL FETCHED URL HERE
            }
            state.initialLoadComplete = true;
        })
        .catch(err => {
            console.error('[hls_parser] Manifest load failed:', err);
            dispatchStatusUpdate(`Error loading manifest: ${err.message}`);
            // Update the initial UI entry to show the error
            document.dispatchEvent(new CustomEvent('hlsUpdateSegmentType', {
                detail: {
                    url: initialUrl, // Match by the original URL
                    type: 'error',   // Set type to 'error'
                    title: 'Load Failed'
                }
            }));
        });
}

// ---- Playlist Fetch ----
async function fetchManifest(urlToFetch) {
    console.log('[hls_parser] Fetching manifest:', getShortUrl(urlToFetch));
    let response = null;
    try {
        response = await fetch(urlToFetch, {
            method: 'GET',
            headers: {
                'Cache-Control': 'no-cache',
                'Pragma': 'no-cache',
                'Accept': 'application/vnd.apple.mpegurl, application/x-mpegurl, */*',
            },
            credentials: 'omit',
            mode: 'cors',
            cache: 'no-store'
        });

        // *** UPDATED: Store detailed HTTP status object ***
        state.lastHttpStatus = {
            code: response.status,
            message: response.statusText,
            url: response.url, // Final URL after redirects
            timestamp: Date.now(),
            error: !response.ok
        };

        const finalUrlAfterRedirects = response.url;
        console.log(`[hls_parser] Request to ${getShortUrl(urlToFetch)}, Final URL after redirects: ${getShortUrl(finalUrlAfterRedirects)}, Status: ${response.status} ${response.statusText}`);

        if (!response.ok) {
            // state.lastHttpStatus is already set with error details
            throw new Error(`HTTP error ${response.status}: ${response.statusText} for ${finalUrlAfterRedirects}`);
        }
        const text = await response.text();
        if (!text || !text.includes('#EXTM3U')) {
            // Note: If this error occurs, state.lastHttpStatus reflects the HTTP status (e.g., 200 OK),
            // which is correct for the "response status". This is a content validation error.
            throw new Error(`Invalid M3U8 content received from ${finalUrlAfterRedirects}`);
        }
        return { content: text, finalUrl: finalUrlAfterRedirects };
    } catch (error) {
        if (!response) { // Network error or fetch API internal error (e.g., CORS)
            // *** UPDATED: Store detailed error object for network/fetch errors ***
            state.lastHttpStatus = {
                code: null, // No HTTP status code applicable
                message: error.message || 'Network/CORS Error',
                url: urlToFetch, // The URL we attempted to fetch
                timestamp: Date.now(),
                error: true
            };
            console.error(`[hls_parser] Network or fetch error for ${getShortUrl(urlToFetch)}:`, error);
        } else {
            // If response exists, state.lastHttpStatus was already set with response.status and response.statusText.
            // This log is for errors like !response.ok or issues after getting a response (e.g., .text() fails).
            console.error(`[hls_parser] Fetch error for ${getShortUrl(response.url || urlToFetch)} (Status: ${state.lastHttpStatus?.code || response.status}):`, error);
        }
        throw error; // Re-throw to be handled by the caller
    }
}

function isMasterPlaylist(content) {
    // More robust check
    return content.includes('#EXT-X-STREAM-INF') || content.includes('#EXT-X-I-FRAME-STREAM-INF');
}

// ---- Master Playlist Parsing ----
function parseMasterPlaylist(masterContent, fetchedMasterUrl) {
    state.masterManifest = masterContent;
    dispatchStatusUpdate('Parsing master playlist...');
    console.log(`[hls_parser] Parsing master manifest fetched from: ${getShortUrl(fetchedMasterUrl)}`);

    const variants = extractVariantStreams(masterContent);
    console.log(`[hls_parser] Found ${variants.length} variant streams.`);
    dispatchPlaylistParsed('master', { url: fetchedMasterUrl, content: masterContent, variants });

    if (variants.length === 0) {
        dispatchStatusUpdate("Master playlist has no variant streams.");
        console.warn("[hls_parser] No variant streams found in master playlist.");
        return;
    }

    const selectedVariant = variants[0];
    const mediaPlaylistUriFromMaster = selectedVariant.uri;

    let finalMediaPlaylistUrl = resolveUrl(mediaPlaylistUriFromMaster, fetchedMasterUrl);
    console.log(`[hls_parser] Initial resolved media playlist URL (from fetchedMasterUrl): ${getShortUrl(finalMediaPlaylistUrl)}`);

    const fetchedMasterUrlObj = new URL(fetchedMasterUrl);
    const tokenPathRegex = /(\/[0-9a-f]{10,}_[0-9a-f]{10,}\/\*\~\/)/i;
    const masterPathHasTokenComponent = tokenPathRegex.test(fetchedMasterUrlObj.pathname);

    if (masterPathHasTokenComponent) {
        console.log(`[hls_parser] Detected path-based token in fetchedMasterUrl's path (${fetchedMasterUrlObj.pathname}). Assuming path token is sufficient.`);
        const tempUrlObj = new URL(finalMediaPlaylistUrl);
        if (tempUrlObj.search) {
            if (!mediaPlaylistUriFromMaster.includes('?')) {
                console.log(`[hls_parser] Clearing query parameters from media playlist URL as path token is present and media URI was clean: ${getShortUrl(finalMediaPlaylistUrl)}`);
                tempUrlObj.search = '';
                finalMediaPlaylistUrl = tempUrlObj.toString();
            } else {
                console.log(`[hls_parser] Media URI from master ('${mediaPlaylistUriFromMaster}') had its own query params. Preserving them alongside path token.`);
            }
        }
    } else {
        console.log(`[hls_parser] No clear path-based token in fetchedMasterUrl. Attempting query string token propagation.`);
        try {
            const originalEntryPointUrlObj = new URL(state.masterUrl);
            const currentMediaUrlObj = new URL(finalMediaPlaylistUrl);

            if (originalEntryPointUrlObj.search &&
                originalEntryPointUrlObj.hostname === currentMediaUrlObj.hostname) {
                const currentMediaParams = new URLSearchParams(currentMediaUrlObj.search);
                let needsQueryParamTokens = true;
                const commonTokenParams = ['hdnts', 'token', 'sig', 'signature', 'auth', 'exp', 'acl', 'hmac', 'Policy', 'Key-Pair-Id'];
                for (const tokenParam of commonTokenParams) {
                    if (currentMediaParams.has(tokenParam)) {
                        needsQueryParamTokens = false;
                        console.log(`[hls_parser] Media URL ${getShortUrl(finalMediaPlaylistUrl)} already has query token ('${tokenParam}'). Skipping master query param append.`);
                        break;
                    }
                }

                if (needsQueryParamTokens) {
                    if (mediaPlaylistUriFromMaster.includes('?') || currentMediaUrlObj.search) {
                        console.warn(`[hls_parser] Media URI/URL already had query params. They will be replaced by original master's query params: ${originalEntryPointUrlObj.search}`);
                    }
                    const tempUrl = new URL(finalMediaPlaylistUrl);
                    tempUrl.search = originalEntryPointUrlObj.search;
                    finalMediaPlaylistUrl = tempUrl.toString();
                    console.log(`[hls_parser] Applied query tokens from original entry point. New media URL: ${getShortUrl(finalMediaPlaylistUrl)}`);
                }
            }
        } catch (e) {
            console.warn('[hls_parser] Error during query string token propagation:', e);
        }
    }

    const mediaPlaylistId = `variant_${selectedVariant.bandwidth || 0}_${selectedVariant.resolution || 'unknown'}`;
    dispatchStatusUpdate(`Loading media playlist: ${getShortUrl(finalMediaPlaylistUrl)}`);

    dispatchSegmentAdded({
        id: `media_${mediaPlaylistId}`,
        url: finalMediaPlaylistUrl,
        title: `Media Playlist (${selectedVariant.resolution || 'Variant'})`,
        type: 'media',
        bandwidth: selectedVariant.bandwidth,
        resolution: selectedVariant.resolution,
        codecs: selectedVariant.codecs
    });

    fetchManifest(finalMediaPlaylistUrl)
        .then(fetchResult => {
            const mediaContent = fetchResult.content;
            const actualFetchedMediaUrl = fetchResult.finalUrl;

            if (finalMediaPlaylistUrl !== actualFetchedMediaUrl && !actualFetchedMediaUrl.startsWith('blob:')) {
                console.warn(`[hls_parser] Media playlist URL used for fetch (${getShortUrl(finalMediaPlaylistUrl)}) differed from final URL after redirects (${getShortUrl(actualFetchedMediaUrl)}). Using final URL for state.`);
            }
            const urlForStateAndParsing = actualFetchedMediaUrl.startsWith('blob:') ? finalMediaPlaylistUrl : actualFetchedMediaUrl;

            state.mediaPlaylists[mediaPlaylistId] = {
                url: urlForStateAndParsing,
                content: mediaContent,
                bandwidth: selectedVariant.bandwidth,
                resolution: selectedVariant.resolution,
                codecs: selectedVariant.codecs,
                segments: []
            };
            state.activeMediaPlaylistId = mediaPlaylistId;

            parseMediaPlaylist(mediaContent, urlForStateAndParsing, mediaPlaylistId);

            if (!mediaContent.includes('#EXT-X-ENDLIST')) {
                state.isLive = true;
                dispatchStatusUpdate(`Live stream detected. Refreshing playlist every ${state.updateInterval / 1000}s`);
                startPlaylistRefresh(urlForStateAndParsing, mediaPlaylistId);
            } else {
                state.isLive = false;
                dispatchStatusUpdate('VOD stream loaded.');
            }
            dispatchPlaylistParsed('media', { id: mediaPlaylistId, url: urlForStateAndParsing, content: mediaContent });
        })
        .catch(err => {
            console.error(`[hls_parser] Media playlist load failed for ${getShortUrl(finalMediaPlaylistUrl)}:`, err);
            dispatchStatusUpdate(`Error loading media playlist: ${err.message} for ${getShortUrl(finalMediaPlaylistUrl)}`);
            document.dispatchEvent(new CustomEvent('hlsUpdateSegmentType', {
                detail: { url: finalMediaPlaylistUrl, type: 'error', title: `Media Load Failed (${selectedVariant.resolution || 'Variant'})` }
            }));
        });
}

// ---- Media Playlist Direct Handling ----
function handleDirectMediaPlaylist(content, url) {
    const id = 'default_media';

    document.dispatchEvent(new CustomEvent('hlsUpdateSegmentType', {
        detail: { url: url, type: 'media', title: 'Media Playlist' }
    }));

    state.mediaPlaylists[id] = { url, content, segments: [] };
    state.activeMediaPlaylistId = id;

    parseMediaPlaylist(content, url, id);

    if (!content.includes('#EXT-X-ENDLIST')) {
        state.isLive = true;
        dispatchStatusUpdate(`Live stream detected. Refreshing playlist every ${state.updateInterval / 1000}s`);
        startPlaylistRefresh(url, id);
    } else {
        state.isLive = false;
        dispatchStatusUpdate('VOD stream loaded.');
    }
    dispatchPlaylistParsed('media', { id, url, content });
}


// ---- Variant Stream Extraction ----
function extractVariantStreams(content) {
    const lines = content.split('\n');
    const streams = [];
    let currentStreamInfo = null;

    for (const line of lines) {
        const trimmedLine = line.trim();
        if (trimmedLine.startsWith('#EXT-X-STREAM-INF:')) {
            currentStreamInfo = {
                bandwidth: parseInt(trimmedLine.match(/BANDWIDTH=(\d+)/)?.[1], 10),
                averageBandwidth: parseInt(trimmedLine.match(/AVERAGE-BANDWIDTH=(\d+)/)?.[1], 10),
                resolution: trimmedLine.match(/RESOLUTION=([^\s,]+)/)?.[1],
                codecs: trimmedLine.match(/CODECS="([^"]+)"/)?.[1],
                frameRate: parseFloat(trimmedLine.match(/FRAME-RATE=([\d.]+)/)?.[1]),
                audio: trimmedLine.match(/AUDIO="([^"]+)"/)?.[1],
                video: trimmedLine.match(/VIDEO="([^"]+)"/)?.[1],
                subtitles: trimmedLine.match(/SUBTITLES="([^"]+)"/)?.[1],
                closedCaptions: trimmedLine.match(/CLOSED-CAPTIONS="([^"]+)"/)?.[1],
                uri: null
            };
        } else if (currentStreamInfo && trimmedLine && !trimmedLine.startsWith('#')) {
            currentStreamInfo.uri = trimmedLine;
            streams.push(currentStreamInfo);
            currentStreamInfo = null;
        } else if (!trimmedLine.startsWith('#EXT-X-STREAM-INF:') && !trimmedLine.startsWith('#') && trimmedLine) {
            currentStreamInfo = null;
        }
    }
    return streams;
}

// ---- Media Playlist Parsing ----
function parseMediaPlaylist(content, baseUrl, playlistId) {
    dispatchStatusUpdate(`Parsing media playlist: ${getShortUrl(baseUrl)}`);

    if (typeof content !== 'string') {
        console.error(`[hls_parser] Invalid content type passed to parseMediaPlaylist for ${playlistId}. Expected string, got ${typeof content}.`);
        dispatchStatusUpdate(`Error: Failed to parse playlist ${playlistId} due to invalid content.`);
        return;
    }

    const lines = content.split('\n');
    const newSegments = [];
    let currentSegment = null;
    let mediaSequence = parseInt(content.match(/#EXT-X-MEDIA-SEQUENCE:(\d+)/)?.[1], 10) || 0;
    let discontinuitySequence = parseInt(content.match(/#EXT-X-DISCONTINUITY-SEQUENCE:(\d+)/)?.[1], 10) || 0;
    let currentKey = null;
    let currentMap = null;
    let programDateTime = null;
    let nextSegmentHasDiscontinuity = false;
    let pendingScteTagDataList = [];


    for (const lineRaw of lines) {
        const line = lineRaw.trim();
        if (!line) continue;

        if (line.includes('SCTE') || line.includes('CUE') || line.startsWith('#EXT-X-DATERANGE')) {
            let scteDataToStore = null;
            let extractedRawScte = null;
            let encodingType = null;
            let match;

            if ((match = line.match(/#(?:EXT-X-SCTE35|EXT-OATCLS-SCTE35|EXT-X-CUE):(.*)/i))) {
                let sctePayload = match[1].trim();
                if (/^[A-Za-z0-9+/=]+$/.test(sctePayload) && (sctePayload.length % 4 === 0 || sctePayload.endsWith('='))) {
                    if (!/^[0-9A-Fa-f]+$/.test(sctePayload) || (sctePayload.length % 2 !== 0)) {
                        encodingType = 'base64';
                    } else {
                        encodingType = 'hex';
                    }
                } else if (/^[0-9A-Fa-f]+$/i.test(sctePayload) && sctePayload.length % 2 === 0) {
                    encodingType = 'hex';
                } else {
                    console.warn(`[hls_parser] Could not determine encoding for SCTE payload: ${sctePayload} in line: ${lineRaw}`);
                }
                if (encodingType) {
                    extractedRawScte = sctePayload;
                }
            } else if ((match = line.match(/#EXT-X-DATERANGE:.*SCTE35-CMD=(0x[0-9A-Fa-f]+)/i))) {
                let sctePayloadWithPrefix = match[1].trim();
                let sctePayload = sctePayloadWithPrefix.startsWith('0x') ? sctePayloadWithPrefix.substring(2) : sctePayloadWithPrefix;
                if (/^[0-9A-Fa-f]+$/i.test(sctePayload) && sctePayload.length % 2 === 0) {
                    encodingType = 'hex';
                    extractedRawScte = sctePayload;
                } else {
                    console.warn(`[hls_parser] SCTE35-CMD payload for DATERANGE was not valid hex after removing '0x': ${sctePayload} in line: ${lineRaw}`);
                }
            }

            if (extractedRawScte && encodingType) {
                scteDataToStore = {
                    line: lineRaw,
                    encoded: extractedRawScte,
                    encodingType: encodingType
                };
            } else if (line.includes('SCTE35-CMD') || line.includes('SCTE') || line.includes('CUE')) {
                if (line.includes('SCTE35-CMD') || (!line.startsWith('#EXT-X-DATERANGE') && (line.includes('SCTE') || line.includes('CUE')))) {
                    console.log(`[hls_parser] Line contains SCTE/CUE keywords but no raw data extracted: ${lineRaw}.`);
                }
            }

            if (scteDataToStore) {
                if (currentSegment) {
                    if (!currentSegment.scteTagDataList) {
                        currentSegment.scteTagDataList = [];
                    }
                    currentSegment.scteTagDataList.push(scteDataToStore);
                    pendingScteTagDataList = [];
                } else {
                    pendingScteTagDataList.push(scteDataToStore);
                }
                continue;
            }
        }

        if (line.startsWith('#EXTINF:')) {
            const durationMatch = line.match(/#EXTINF:([\d.]+)/);
            const titleMatch = line.split(',')[1];
            currentSegment = {
                duration: durationMatch ? parseFloat(durationMatch[1]) : 0,
                title: titleMatch ? titleMatch.trim() : '',
                sequence: mediaSequence,
                playlistId: playlistId,
                tags: [],
                programDateTime: programDateTime,
                scteTagDataList: null
            };
            if (currentKey) currentSegment.encryption = currentKey;
            if (currentMap) currentSegment.map = currentMap;
            currentSegment.tags.push(lineRaw);

            if (nextSegmentHasDiscontinuity) {
                currentSegment.discontinuity = true;
                currentSegment.tags.push('#EXT-X-DISCONTINUITY');
                nextSegmentHasDiscontinuity = false;
            }

        } else if (line.startsWith('#EXT-X-BYTERANGE:')) {
            if (currentSegment) {
                const byteRangeMatch = line.match(/#EXT-X-BYTERANGE:(\d+)(?:@(\d+))?/);
                if (byteRangeMatch) {
                    currentSegment.byteRange = {
                        length: parseInt(byteRangeMatch[1], 10),
                        offset: byteRangeMatch[2] ? parseInt(byteRangeMatch[2], 10) : null
                    };
                    currentSegment.tags.push(lineRaw);
                }
            }

        } else if (line.startsWith('#EXT-X-KEY:')) {
            currentKey = {};
            currentKey.method = line.match(/METHOD=([^,]+)/)?.[1];
            currentKey.uri = line.match(/URI="([^"]+)"/)?.[1] ? resolveUrl(line.match(/URI="([^"]+)"/)[1], baseUrl) : null;
            currentKey.iv = line.match(/IV=([^,]+)/)?.[1];
            currentKey.keyformat = line.match(/KEYFORMAT="([^"]+)"/)?.[1];
            currentKey.keyformatversions = line.match(/KEYFORMATVERSIONS="([^"]+)"/)?.[1];
            if (currentSegment) {
                currentSegment.encryption = currentKey;
                currentSegment.tags.push(lineRaw);
            }

        } else if (line.startsWith('#EXT-X-MAP:')) {
            currentMap = {};
            currentMap.uri = resolveUrl(line.match(/URI="([^"]+)"/)?.[1], baseUrl);
            currentMap.byterange = line.match(/BYTERANGE="([^"]+)"/)?.[1];
            if (currentSegment) {
                currentSegment.map = currentMap;
                currentSegment.tags.push(lineRaw);
            }

        } else if (line.startsWith('#EXT-X-PROGRAM-DATE-TIME:')) {
            try {
                programDateTime = new Date(line.substring('#EXT-X-PROGRAM-DATE-TIME:'.length));
            } catch (e) {
                console.warn("Error parsing Program Date Time:", line, e);
                programDateTime = null;
            }
            if (currentSegment) {
                currentSegment.programDateTime = programDateTime;
                currentSegment.tags.push(lineRaw);
            }

        } else if (line === '#EXT-X-DISCONTINUITY') {
            console.log('[hls_parser] Found exact #EXT-X-DISCONTINUITY tag.');
            discontinuitySequence++;
            if (currentSegment) {
                currentSegment.discontinuity = true;
                currentSegment.tags.push(lineRaw);
            } else {
                nextSegmentHasDiscontinuity = true;
            }

        } else if (line.startsWith('#EXT-X-MEDIA-SEQUENCE:')) {
            mediaSequence = parseInt(line.split(':')[1], 10) || mediaSequence;
        } else if (line.startsWith('#EXT-X-TARGETDURATION:')) {
            state.targetDuration = parseInt(line.split(':')[1], 10);
        } else if (line.startsWith('#EXT-X-VERSION:')) {
            state.hlsVersion = parseInt(line.split(':')[1], 10);
        } else if (line.startsWith('#EXT-X-ENDLIST')) {
            state.isLive = false;
            clearInterval(state.playlistRefreshInterval);
            state.playlistRefreshInterval = null;
            console.log('[hls_parser] Reached ENDLIST.');
            dispatchStatusUpdate("VOD stream finished loading.");
            if (currentSegment) {
                console.warn("[hls_parser] Playlist ended unexpectedly after EXTINF but before segment URI for sequence", currentSegment.sequence);
                currentSegment = null;
            }
        } else if (currentSegment && !line.startsWith('#')) {
            currentSegment.url = resolveUrl(line, baseUrl);
            currentSegment.id = `${playlistId}_seq${currentSegment.sequence}`;
            currentSegment.filename = line.split('/').pop().split('?')[0];

            if (pendingScteTagDataList.length > 0) {
                if (!currentSegment.scteTagDataList) {
                    currentSegment.scteTagDataList = [];
                }
                currentSegment.scteTagDataList.push(...pendingScteTagDataList);
                console.log(`[hls_parser] Attached ${pendingScteTagDataList.length} pending SCTE tag(s) to segment ${currentSegment.id}`);
                pendingScteTagDataList = [];
            }

            newSegments.push(currentSegment);
            dispatchSegmentAdded(currentSegment);

            if (currentSegment.discontinuity) {
                console.log(`[hls_parser] Dispatching discontinuity for segment: ${currentSegment.id}`);
                document.dispatchEvent(new CustomEvent('hlsDiscontinuityDetected', { detail: { segment: currentSegment } }));
            }

            mediaSequence++;
            currentSegment = null;

        } else if (!currentSegment && !line.startsWith('#') && line.trim()) {
            console.warn(`[hls_parser] Encountered standalone segment URI without #EXTINF: ${line}`);
            pendingScteTagDataList = [];
            nextSegmentHasDiscontinuity = false;
        }
    }

    if (pendingScteTagDataList.length > 0) {
        console.warn(`[hls_parser] Playlist parsing ended with ${pendingScteTagDataList.length} unattached pending SCTE tag(s):`);
        pendingScteTagDataList.forEach((tag, idx) => {
            console.warn(` - [${idx}] Line: ${tag.line}`);
        });
        pendingScteTagDataList = [];
    }

    if (state.mediaPlaylists[playlistId]) {
        const existingSegments = state.mediaPlaylists[playlistId].segments;
        const lastExistingSeq = existingSegments.length > 0 ? existingSegments[existingSegments.length - 1].sequence : -1;
        const trulyNewSegments = newSegments.filter(s => s.sequence > lastExistingSeq);

        if (trulyNewSegments.length > 0) {
            state.mediaPlaylists[playlistId].segments.push(...trulyNewSegments);
            console.log(`[hls_parser] Added ${trulyNewSegments.length} new segments to playlist ${playlistId} (Total now: ${state.mediaPlaylists[playlistId].segments.length}).`);
        } else if (newSegments.length > 0) {
            console.log(`[hls_parser] Parsed ${newSegments.length} segments for playlist ${playlistId}, but none were newer than sequence ${lastExistingSeq}.`);
        } else {
            console.log(`[hls_parser] No segments parsed in this update for playlist ${playlistId}.`);
        }
    } else {
        console.error(`[hls_parser] Playlist ID ${playlistId} not found in state when trying to add segments! Creating entry.`);
        state.mediaPlaylists[playlistId] = { url: baseUrl, content: content, segments: newSegments };
    }

    const totalSegments = state.allSegments.filter(s => s.type !== 'master' && s.type !== 'media' && s.type !== 'unknown').length;
    dispatchStatusUpdate(`Parsed ${totalSegments} unique segments total.`);
}


// ---- Playlist Refresh (Live) ----
function startPlaylistRefresh(initialRefreshUrl, playlistId) {
    if (state.playlistRefreshInterval) {
        clearInterval(state.playlistRefreshInterval);
        state.playlistRefreshInterval = null;
        console.log('[hls_parser] Cleared existing refresh interval before starting new one.');
    }

    const refreshDelay = state.targetDuration
        ? Math.max(1000, state.targetDuration * 1000 * 0.7)
        : state.updateInterval;

    console.log(`[hls_parser] Starting playlist refresh for Playlist ID: ${playlistId} (URL: ${getShortUrl(initialRefreshUrl)}) every ${refreshDelay}ms.`);

    state.playlistRefreshInterval = setInterval(async () => {
        if (!state.isLive) {
            clearInterval(state.playlistRefreshInterval);
            state.playlistRefreshInterval = null;
            console.log(`[hls_parser] Stream for Playlist ID: ${playlistId} is no longer live. Stopping refresh.`);
            return;
        }

        const currentPlaylistInState = state.mediaPlaylists[playlistId];
        if (!currentPlaylistInState) {
            console.warn(`[hls_parser] Playlist ID: ${playlistId} no longer in state. Stopping its refresh cycle.`);
            clearInterval(state.playlistRefreshInterval);
            state.playlistRefreshInterval = null;
            return;
        }

        try {
            const fetchResult = await fetchManifest(initialRefreshUrl);
            const newPlaylistString = fetchResult.content;
            const actualFetchedUrl = fetchResult.finalUrl;

            if (initialRefreshUrl !== actualFetchedUrl && !actualFetchedUrl.startsWith('blob:')) {
                console.log(`[hls_parser] Refresh URL for Playlist ID: ${playlistId} redirected: ${getShortUrl(initialRefreshUrl)} -> ${getShortUrl(actualFetchedUrl)}`);
            }

            if (currentPlaylistInState.content !== newPlaylistString) {
                console.log(`[hls_parser] Playlist ID: ${playlistId} (fetched from ${getShortUrl(actualFetchedUrl)}) has updated content. Reparsing.`);
                currentPlaylistInState.content = newPlaylistString;

                if (currentPlaylistInState.url !== actualFetchedUrl && !actualFetchedUrl.startsWith('blob:')) {
                    console.log(`[hls_parser] Updating stored URL for Playlist ID: ${playlistId} from ${getShortUrl(currentPlaylistInState.url)} to ${getShortUrl(actualFetchedUrl)}.`);
                    currentPlaylistInState.url = actualFetchedUrl;
                }

                parseMediaPlaylist(newPlaylistString, actualFetchedUrl, playlistId);
                dispatchPlaylistParsed('media', {
                    id: playlistId,
                    url: actualFetchedUrl,
                    content: newPlaylistString
                });
            } else {
                console.log(`[hls_parser] Playlist ID: ${playlistId} (fetched from ${getShortUrl(actualFetchedUrl)}) content unchanged.`);
            }
        } catch (err) {
            console.error(`[hls_parser] Error refreshing Playlist ID: ${playlistId} (attempted URL: ${getShortUrl(initialRefreshUrl)}):`, err);
            dispatchStatusUpdate(`Error refreshing playlist ${playlistId}: ${err.message}`);
        }
    }, refreshDelay);
}

// ---- Utility Functions ----
function resolveUrl(relativeUrl, baseUrl) {
    if (!relativeUrl || !baseUrl) return relativeUrl;
    if (/^(https?|blob|data):/i.test(relativeUrl)) {
        return relativeUrl;
    }
    try {
        return new URL(relativeUrl, baseUrl).href;
    } catch (e) {
        console.warn(`[hls_parser] URL resolution failed for "${relativeUrl}" with base "${baseUrl}". Falling back. Error: ${e}`);
        const base = new URL(baseUrl);
        if (relativeUrl.startsWith('/')) {
            return `${base.origin}${relativeUrl}`;
        } else {
            const path = base.pathname.substring(0, base.pathname.lastIndexOf('/') + 1);
            return `${base.origin}${path}${relativeUrl}`;
        }
    }
}

function getShortUrl(url, maxLength = 50) {
    if (!url) return '';
    if (url.length <= maxLength) return url;
    try {
        const parsed = new URL(url);
        const pathParts = parsed.pathname.split('/').filter(Boolean);
        const file = pathParts.pop() || '';
        const domain = parsed.hostname;
        return `${domain}/.../${file.substring(0, 15)}${file.length > 15 ? '...' : ''}${parsed.search}`;
    } catch {
        return url.substring(0, maxLength / 2) + '...' + url.substring(url.length - maxLength / 2);
    }
}

// ==================================
// === metaviewAPI HLSParser API ===
// ==================================
if (!window.metaviewAPI) window.metaviewAPI = {};
window.metaviewAPI.hlsparser = {
    /**
     * Initializes the HLS parser with the provided M3U8 URL.
     * @param {string} initialUrl The URL of the master or media playlist.
     */
    init: initHlsParser,

    /**
     * Returns the URL of the master playlist.
     * @returns {string | null}
     */
    getMasterPlaylistUrl: function () {
        return state.masterUrl;
    },

    /**
     * Returns the raw content of the master playlist.
     * @returns {string | null}
     */
    getMasterManifestContent: function () {
        return state.masterManifest;
    },

    /**
     * Returns details for a specific media playlist or all media playlists.
     * @param {string} [playlistId] Optional ID of the media playlist.
     * @returns {object | object[] | null} Playlist details including URL, content, bandwidth, resolution, codecs, and segment objects. Returns null if not found.
     */
    getMediaPlaylistDetails: function (playlistId) {
        if (playlistId) {
            return state.mediaPlaylists[playlistId] ? { ...state.mediaPlaylists[playlistId], segments: [...(state.mediaPlaylists[playlistId].segments || [])] } : null;
        }
        // Return a deep copy of all playlists if no ID is provided
        const allPlaylistsCopy = {};
        for (const id in state.mediaPlaylists) {
            allPlaylistsCopy[id] = { ...state.mediaPlaylists[id], segments: [...(state.mediaPlaylists[id].segments || [])] };
        }
        return allPlaylistsCopy;
    },

    /**
     * Returns an array of all variant stream objects extracted from the master playlist.
     * Each object includes bandwidth, resolution, codecs, and URI.
     * @returns {object[]} A copy of the array of variant stream objects.
     */
    getAllVariantStreams: function () {
        return state.variantStreams ? [...state.variantStreams] : [];
    },

    /**
     * Returns the HLS version declared in the playlist.
     * @returns {number | null}
     */
    getHlsVersion: function () {
        return state.hlsVersion;
    },

    /**
     * Returns the target duration declared in the media playlist.
     * @returns {number | null}
     */
    getTargetDuration: function () {
        return state.targetDuration;
    },

    /**
     * Indicates if the stream is identified as live.
     * @returns {boolean}
     */
    isLiveStream: function () {
        return state.isLive;
    },

    /**
     * Returns a copy of all unique segments encountered across all playlists.
     * Each segment object contains details like URL, duration, sequence, playlistId, etc.
     * Includes raw SCTE tag data if present on the segment.
     * @returns {object[]} An array of segment objects.
     */
    getAllSegments: function () {
        return state.allSegments.map(segment => ({ ...segment })); // Shallow copy of each segment
    },

    /**
     * Returns a specific segment object by its URL.
     * @param {string} segmentUrl The URL of the segment.
     * @returns {object | undefined} The segment object or undefined if not found.
     */
    getSegmentByUrl: function (segmentUrl) {
        const segment = state.segmentMap.get(segmentUrl);
        return segment ? { ...segment } : undefined; // Return a copy
    },

    /**
     * Returns a specific segment object by its ID.
     * Note: Segment IDs are generated internally (e.g., `${playlistId}_seq${sequence}`).
     * @param {string} segmentId The ID of the segment.
     * @returns {object | undefined} The segment object or undefined if not found.
     */
    getSegmentById: function (segmentId) {
        const segment = state.allSegments.find(s => s.id === segmentId);
        return segment ? { ...segment } : undefined; // Return a copy
    },

    /**
     * Returns details of the initialization segment (EXT-X-MAP) for a given media playlist.
     * @param {string} playlistId The ID of the media playlist.
     * @returns {object | null} MAP details (URI, byterange) or null if not found or not applicable.
     */
    getInitializationSegment: function (playlistId) {
        const playlist = state.mediaPlaylists[playlistId];
        if (playlist && playlist.segments && playlist.segments.length > 0) {
            // Assuming MAP applies to all segments or is defined early.
            // A more robust approach might be to find the first segment with a map or store map at playlist level.
            const firstSegmentWithMap = playlist.segments.find(s => s.map);
            return firstSegmentWithMap ? { ...firstSegmentWithMap.map } : null;
        }
        // Or check if a global MAP was defined for the playlist (less common)
        // This current implementation relies on map being part of a segment object.
        return null;
    },

    /**
     * Returns the ID of the currently active media playlist being parsed or refreshed.
     * @returns {string | null}
     */
    getActiveMediaPlaylistId: function () {
        return state.activeMediaPlaylistId;
    },

    /**
     * Returns the last recorded HTTP status for playlist fetches.
     * @returns {object | null} Object containing code, message, url, timestamp, error.
     */
    getLastHttpStatus: function () {
        return state.lastHttpStatus ? { ...state.lastHttpStatus } : null;
    },

    /**
     * Sets the DRM authentication token to be used by the parser or player.
     * @param {string | null} token The bearer token string, or null to clear.
     */
    setDrmAuthToken: setDrmAuthToken,

    /**
     * Retrieves the currently set DRM authentication token.
     * @returns {string | null} The bearer token string, or null if not set.
     */
    getDrmAuthToken: getDrmAuthToken,

};

// Expose the HLS parser API to the global window object
window.HlsParser = {
    init: initHlsParser,
    getState: () => state,
};

console.log('[hls_parser] API ready.');

/*
TEST CALLSHEET:

window.metaviewAPI.hlsparser.init('YOUR_M3U8_URL_HERE');

const fakeJwt = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.' +
                'eyJ1c2VySWQiOiIxMjM0NTYiLCJyb2xlIjoiY29udHJpYnV0b3IiLCJleHAiOjE2NjAwMDAwMDB9.' +
                'SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c';
window.metaviewAPI.hlsparser.setDrmAuthToken(fakeJwt);                

const validJwt = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.' +
    'eyJ1c2VySWQiOiIxMjM0NTYiLCJyb2xlIjoiY29udHJpYnV0b3IiLCJleHAiOjIwMDAwMDAwMDB9.' +
    'dummysignature1234567890';

window.metaviewAPI.hlsparser.setDrmAuthToken(validJwt);
window.metaviewAPI.hlsparser.setDrmAuthToken(null);

window.metaviewAPI.hlsparser.getDrmAuthToken();
window.metaviewAPI.hlsparser.getMasterPlaylistUrl();
window.metaviewAPI.hlsparser.getMasterManifestContent();
window.metaviewAPI.hlsparser.getMediaPlaylistDetails(); 
window.metaviewAPI.hlsparser.getMediaPlaylistDetails('variant_...'); 
window.metaviewAPI.hlsparser.getAllVariantStreams(); << IGNORE
window.metaviewAPI.hlsparser.getHlsVersion();
window.metaviewAPI.hlsparser.getTargetDuration();
window.metaviewAPI.hlsparser.isLiveStream();
window.metaviewAPI.hlsparser.getAllSegments();
window.metaviewAPI.hlsparser.getSegmentByUrl('FULL_SEGMENT_URL_HERE');
window.metaviewAPI.hlsparser.getSegmentById('PLAYLISTID_seqSEQUENCE');
window.metaviewAPI.hlsparser.getInitializationSegment('variant_...');
window.metaviewAPI.hlsparser.getActiveMediaPlaylistId();
window.metaviewAPI.hlsparser.getLastHttpStatus();

window.HlsParser.init('YOUR_M3U8_URL_HERE');
window.HlsParser.getState();
*/