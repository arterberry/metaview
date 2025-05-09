// js/core/hls_parser.js

console.log('[hls_parser] Loading...');

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
    lastHttpStatus: null, //  Store the last HTTP status code
    targetDuration: null,
    hlsVersion: null
};

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
async function fetchManifest(urlToFetch) { // Renamed 'url' to 'urlToFetch' to avoid confusion with response.url
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

        state.lastHttpStatus = response.status;
        const finalUrlAfterRedirects = response.url; // This is the key URL

        console.log(`[hls_parser] Request to ${getShortUrl(urlToFetch)}, Final URL after redirects: ${getShortUrl(finalUrlAfterRedirects)}, Status: ${response.status} ${response.statusText}`);

        if (!response.ok) {
            throw new Error(`HTTP error ${response.status}: ${response.statusText} for ${finalUrlAfterRedirects}`);
        }
        const text = await response.text();
        if (!text || !text.includes('#EXTM3U')) {
            throw new Error(`Invalid M3U8 content received from ${finalUrlAfterRedirects}`);
        }
        return { content: text, finalUrl: finalUrlAfterRedirects }; // Return content AND the final URL
    } catch (error) {
        if (!response) {
            state.lastHttpStatus = null;
            console.error(`[hls_parser] Network or fetch error for ${getShortUrl(urlToFetch)}:`, error);
        } else {
            // Log error with the URL that was attempted or resulted from redirect
            console.error(`[hls_parser] Fetch error for ${getShortUrl(response.url || urlToFetch)}:`, error);
        }
        throw error;
    }
}

function isMasterPlaylist(content) {
    // More robust check
    return content.includes('#EXT-X-STREAM-INF') || content.includes('#EXT-X-I-FRAME-STREAM-INF');
}

// ---- Master Playlist Parsing ----
// js/core/hls_parser.js

// ---- Master Playlist Parsing ----
function parseMasterPlaylist(masterContent, fetchedMasterUrl) {
    state.masterManifest = masterContent;
    dispatchStatusUpdate('Parsing master playlist...');
    console.log(`[hls_parser] Parsing master manifest fetched from: ${getShortUrl(fetchedMasterUrl)}`);

    const variants = extractVariantStreams(masterContent);
    console.log(`[hls_parser] Found ${variants.length} variant streams.`);
    dispatchPlaylistParsed('master', { url: fetchedMasterUrl, content: masterContent, variants });

    if (variants.length === 0) { /* ... */ return; }

    const selectedVariant = variants[0];
    const mediaPlaylistUriFromMaster = selectedVariant.uri;

    // 1. Primary Resolution against the URL master content was fetched from.
    let finalMediaPlaylistUrl = resolveUrl(mediaPlaylistUriFromMaster, fetchedMasterUrl);
    console.log(`[hls_parser] Initial resolved media playlist URL (from fetchedMasterUrl): ${getShortUrl(finalMediaPlaylistUrl)}`);

    // Check if fetchedMasterUrl indicates a path-based token was already applied by CDN redirect
    const fetchedMasterUrlObj = new URL(fetchedMasterUrl);
    const tokenPathRegex = /(\/[0-9a-f]{10,}_[0-9a-f]{10,}\/\*\~\/)/i; // Regex for your /TOKEN_PATH_COMPONENT/
    const masterPathHasTokenComponent = tokenPathRegex.test(fetchedMasterUrlObj.pathname);

    if (masterPathHasTokenComponent) {
        console.log(`[hls_parser] Detected path-based token in fetchedMasterUrl's path (${fetchedMasterUrlObj.pathname}). Assuming path token is sufficient.`);
        // If finalMediaPlaylistUrl (after simple resolution) still has query params AND this CDN doesn't want them with path tokens, clear them.
        // This is specific to Fastly behavior you described where path-tokenized URLs have NO query params.
        const tempUrlObj = new URL(finalMediaPlaylistUrl);
        if (tempUrlObj.search) { // If there are any query params
            // Check if these query params are from the original master URI or if they were part of mediaPlaylistUriFromMaster
            if (!mediaPlaylistUriFromMaster.includes('?')) { // If media URI itself didn't have query params
                console.log(`[hls_parser] Clearing query parameters from media playlist URL as path token is present and media URI was clean: ${getShortUrl(finalMediaPlaylistUrl)}`);
                tempUrlObj.search = ''; // Clear query string
                finalMediaPlaylistUrl = tempUrlObj.toString();
            } else {
                console.log(`[hls_parser] Media URI from master ('${mediaPlaylistUriFromMaster}') had its own query params. Preserving them alongside path token.`);
            }
        }
    } else {
        // 2. Secondary Step: Query String Token Propagation (if no path-based token detected in fetchedMasterUrl's path)
        console.log(`[hls_parser] No clear path-based token in fetchedMasterUrl. Attempting query string token propagation.`);
        try {
            const originalEntryPointUrlObj = new URL(state.masterUrl);
            const currentMediaUrlObj = new URL(finalMediaPlaylistUrl);

            if (originalEntryPointUrlObj.search &&
                originalEntryPointUrlObj.hostname === currentMediaUrlObj.hostname) {
                // ... (the rest of the query string propagation logic from the previous refactor) ...
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
    // ... (rest of the function remains the same, using finalMediaPlaylistUrl) ...
    // e.g., fetchManifest(finalMediaPlaylistUrl).then(fetchResult => { ... use fetchResult.finalUrl ... })
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

    // Fetch the media playlist using the final constructed URL
    fetchManifest(finalMediaPlaylistUrl)
        .then(fetchResult => { // fetchResult is { content, finalUrl }
            const mediaContent = fetchResult.content;
            const actualFetchedMediaUrl = fetchResult.finalUrl;

            if (finalMediaPlaylistUrl !== actualFetchedMediaUrl && !actualFetchedMediaUrl.startsWith('blob:')) { // Ignore blob URL differences
                console.warn(`[hls_parser] Media playlist URL used for fetch (${getShortUrl(finalMediaPlaylistUrl)}) differed from final URL after redirects (${getShortUrl(actualFetchedMediaUrl)}). Using final URL for state.`);
            }
            // Prefer actualFetchedMediaUrl if it's not a blob URL, otherwise stick to finalMediaPlaylistUrl
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
    const id = 'default_media'; // Simple ID for direct media playlist

    // Update the original 'unknown' entry added by initHlsParser
    document.dispatchEvent(new CustomEvent('hlsUpdateSegmentType', {
        detail: { url: url, type: 'media', title: 'Media Playlist' }
    }));

    state.mediaPlaylists[id] = { url, content, segments: [] };
    state.activeMediaPlaylistId = id; // Only one playlist in this case

    parseMediaPlaylist(content, url, id);

    // Check if live AFTER parsing segments
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
                uri: null // URI will be on the next line
            };
        } else if (currentStreamInfo && trimmedLine && !trimmedLine.startsWith('#')) {
            // This line should be the URI for the previous #EXT-X-STREAM-INF
            currentStreamInfo.uri = trimmedLine;
            streams.push(currentStreamInfo);
            currentStreamInfo = null; // Reset for the next potential stream
        } else if (!trimmedLine.startsWith('#EXT-X-STREAM-INF:') && !trimmedLine.startsWith('#') && trimmedLine) {
            // If we encounter a URI without a preceding STREAM-INF, reset
            currentStreamInfo = null;
        }
    }
    return streams;
}

// ---- Media Playlist Parsing ----
function parseMediaPlaylist(content, baseUrl, playlistId) {
    dispatchStatusUpdate(`Parsing media playlist: ${getShortUrl(baseUrl)}`);

    // Validate content is a string before splitting
    if (typeof content !== 'string') {
        console.error(`[hls_parser] Invalid content type passed to parseMediaPlaylist for ${playlistId}. Expected string, got ${typeof content}.`);
        // Optionally dispatch an error or return early
        dispatchStatusUpdate(`Error: Failed to parse playlist ${playlistId} due to invalid content.`);
        return; // Stop processing if content isn't usable
    }

    const lines = content.split('\n');
    const newSegments = [];
    let currentSegment = null; // Holds the segment object being built (after EXTINF, before URI)
    let mediaSequence = parseInt(content.match(/#EXT-X-MEDIA-SEQUENCE:(\d+)/)?.[1], 10) || 0;
    let discontinuitySequence = parseInt(content.match(/#EXT-X-DISCONTINUITY-SEQUENCE:(\d+)/)?.[1], 10) || 0;
    let currentKey = null;
    let currentMap = null;
    let programDateTime = null;
    let nextSegmentHasDiscontinuity = false;
    // let pendingScteTagData = null; // Holds SCTE tag data found *before* an EXTINF
    let pendingScteTagDataList = []; // instead of pendingScteTagData = null


    for (const lineRaw of lines) {
        const line = lineRaw.trim();
        if (!line) continue;

        // --- SCTE Tag Processing ---
        if (line.includes('SCTE') || line.includes('CUE') || line.startsWith('#EXT-X-DATERANGE')) {
            let scteDataToStore = null;

            // NEW LOGIC: Only extract raw encoded data here.
            // scte_manager.js will handle the parsing using SCTECoreParser.
            // This aligns with the goal of hls_parser just extracting HLS elements.

            let extractedRawScte = null;
            let encodingType = null; // 'hex' or 'base64'

            // Simple extraction for common SCTE tags like #EXT-X-SCTE35, #EXT-OATCLS-SCTE35, #EXT-X-CUE
            // and #EXT-X-DATERANGE with SCTE35 attribute.
            // This is a simplified version of what a full SCTE35Parser.extractFromHLSTags might do.
            // A more robust regex or dedicated small utility could be used if complex tag formats are common.

            let match;
            if ((match = line.match(/#(?:EXT-X-SCTE35|EXT-OATCLS-SCTE35|EXT-X-CUE):(.*)/i))) {
                let sctePayload = match[1].trim();
                // Check if it's likely base64 or hex.
                // Base64 typically ends with '=' or has A-Z, a-z, 0-9, +, /
                // Hex is 0-9, A-F, a-f and has an even length.
                if (/^[A-Za-z0-9+/=]+$/.test(sctePayload) && (sctePayload.length % 4 === 0 || sctePayload.endsWith('='))) {
                    // It's likely Base64, but could also be hex if it only contains 0-9, A-F.
                    // A more robust check might be needed if ambiguity is high.
                    // For now, assume if it looks like b64, it is.
                    // Comcast parser can handle hex even if it looks like b64 chars, but prefers explicit type.
                    if (!/^[0-9A-Fa-f]+$/.test(sctePayload) || (sctePayload.length % 2 !== 0)) {
                         encodingType = 'base64';
                    } else {
                        // Ambiguous: could be hex or base64 made of hex chars. Default to hex if it fits.
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
            } else if ((match = line.match(/#EXT-X-DATERANGE:.*SCTE35-CMD=(0x[0-9A-Fa-f]+)/i))) { // Regex updated for SCTE35-CMD and 0x
                let sctePayloadWithPrefix = match[1].trim(); // This will be "0xFC3052..."
                let sctePayload = sctePayloadWithPrefix.startsWith('0x') ? sctePayloadWithPrefix.substring(2) : sctePayloadWithPrefix; // Remove "0x"

                // For SCTE35-CMD, the data is typically HEX.
                if (/^[0-9A-Fa-f]+$/i.test(sctePayload) && sctePayload.length % 2 === 0) {
                    encodingType = 'hex';
                    extractedRawScte = sctePayload;
                } else {
                     console.warn(`[hls_parser] SCTE35-CMD payload for DATERANGE was not valid hex after removing '0x': ${sctePayload} in line: ${lineRaw}`);
                }
            }
            // Add other SCTE tag patterns here if needed (e.g., #EXT-X-CUE-OUT with raw data)

            if (extractedRawScte && encodingType) {
                // console.log(`[hls_parser] Extracted raw SCTE data (type: ${encodingType}): ${extractedRawScte.substring(0,50)}...`);
                scteDataToStore = {
                    line: lineRaw, // Store raw line for reference
                    encoded: extractedRawScte,
                    encodingType: encodingType
                };
            } else if (line.includes('SCTE35-CMD') || line.includes('SCTE') || line.includes('CUE')) {// Log if keywords present but no extraction
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
                    // console.log(`[hls_parser] Attached SCTE tag directly to preceding segment ${currentSegment.id || currentSegment.sequence}`);
                    pendingScteTagDataList = []; // Clear pending if attached directly
                } else {
                    pendingScteTagDataList.push(scteDataToStore);
                    // console.log('[hls_parser] Stored SCTE tag data as pending for the next segment.');
                }
                continue; // Skip further checks for this line
            }
        } // --- End SCTE Tag Processing ---

        // --- Standard HLS Tag Processing ---
        if (line.startsWith('#EXTINF:')) {
            // If we are starting a new segment, but there was pending SCTE data from *before* this EXTINF,
            // it means that data wasn't attached to the previous segment (maybe because it was the first tag).
            // We should probably keep it pending for *this* new segment being created now.
            // The pendingScteTagData logic handles this implicitly (it's attached when the URI is found).

            const durationMatch = line.match(/#EXTINF:([\d.]+)/);
            const titleMatch = line.split(',')[1];
            currentSegment = { // Create the new segment object
                duration: durationMatch ? parseFloat(durationMatch[1]) : 0,
                title: titleMatch ? titleMatch.trim() : '',
                sequence: mediaSequence,
                playlistId: playlistId,
                tags: [],
                programDateTime: programDateTime, // Apply most recent PDT
                scteTagDataList: null // Initialize SCTE list for this segment
                // Apply current encryption/map context if they exist
            };
            if (currentKey) currentSegment.encryption = currentKey;
            if (currentMap) currentSegment.map = currentMap;
            currentSegment.tags.push(lineRaw); // Add EXTINF line itself to tags

            // Apply discontinuity flag if it was pending before this EXTINF
            if (nextSegmentHasDiscontinuity) {
                currentSegment.discontinuity = true;
                currentSegment.tags.push('#EXT-X-DISCONTINUITY'); // Add the conceptual tag
                nextSegmentHasDiscontinuity = false;
            }

        } else if (line.startsWith('#EXT-X-BYTERANGE:')) {
            if (currentSegment) { // Add to the segment currently being built
                const byteRangeMatch = line.match(/#EXT-X-BYTERANGE:(\d+)(?:@(\d+))?/);
                if (byteRangeMatch) {
                    currentSegment.byteRange = {
                        length: parseInt(byteRangeMatch[1], 10),
                        offset: byteRangeMatch[2] ? parseInt(byteRangeMatch[2], 10) : null
                    };
                    currentSegment.tags.push(lineRaw);
                }
            } // else: Ignore if not related to a current segment

        } else if (line.startsWith('#EXT-X-KEY:')) {
            currentKey = { /* ... parse key attributes ... */ };
            currentKey.method = line.match(/METHOD=([^,]+)/)?.[1];
            currentKey.uri = line.match(/URI="([^"]+)"/)?.[1] ? resolveUrl(line.match(/URI="([^"]+)"/)[1], baseUrl) : null;
            currentKey.iv = line.match(/IV=([^,]+)/)?.[1];
            currentKey.keyformat = line.match(/KEYFORMAT="([^"]+)"/)?.[1];
            currentKey.keyformatversions = line.match(/KEYFORMATVERSIONS="([^"]+)"/)?.[1];

            if (currentSegment) {
                currentSegment.encryption = currentKey; // Apply context to segment being built
                currentSegment.tags.push(lineRaw);     // Add tag line to segment's tags
            }
            // This key context persists for subsequent segments until changed

        } else if (line.startsWith('#EXT-X-MAP:')) {
            currentMap = { /* ... parse map attributes ... */ };
            currentMap.uri = resolveUrl(line.match(/URI="([^"]+)"/)?.[1], baseUrl);
            currentMap.byterange = line.match(/BYTERANGE="([^"]+)"/)?.[1];

            if (currentSegment) {
                currentSegment.map = currentMap;      // Apply context to segment being built
                currentSegment.tags.push(lineRaw);     // Add tag line to segment's tags
            }
            // This map context persists for subsequent segments until changed

        } else if (line.startsWith('#EXT-X-PROGRAM-DATE-TIME:')) {
            try {
                programDateTime = new Date(line.substring('#EXT-X-PROGRAM-DATE-TIME:'.length));
            } catch (e) {
                console.warn("Error parsing Program Date Time:", line, e);
                programDateTime = null;
            }

            if (currentSegment) {
                currentSegment.programDateTime = programDateTime; // Apply context to segment being built
                currentSegment.tags.push(lineRaw);             // Add tag line to segment's tags
            }
            // This PDT context persists for subsequent segments until changed

        } else if (line === '#EXT-X-DISCONTINUITY') {
            console.log('[hls_parser] Found exact #EXT-X-DISCONTINUITY tag.');
            discontinuitySequence++;
            if (currentSegment) { // If EXTINF already seen, apply to current segment
                currentSegment.discontinuity = true;
                currentSegment.tags.push(lineRaw);
            } else { // If discontinuity comes before EXTINF, flag it for the next segment
                nextSegmentHasDiscontinuity = true;
            }

        } else if (line.startsWith('#EXT-X-MEDIA-SEQUENCE:')) {
            // Update mediaSequence if needed (though usually only parsed once at start)
            mediaSequence = parseInt(line.split(':')[1], 10) || mediaSequence;
            // Don't add this tag to individual segments

        } else if (line.startsWith('#EXT-X-TARGETDURATION:')) {
            state.targetDuration = parseInt(line.split(':')[1], 10);
            // Don't add this tag to individual segments

        } else if (line.startsWith('#EXT-X-VERSION:')) {
            state.hlsVersion = parseInt(line.split(':')[1], 10);
            // Don't add this tag to individual segments

        } else if (line.startsWith('#EXT-X-ENDLIST')) {
            state.isLive = false;
            clearInterval(state.playlistRefreshInterval);
            state.playlistRefreshInterval = null;
            console.log('[hls_parser] Reached ENDLIST.');
            dispatchStatusUpdate("VOD stream finished loading.");
            // Don't add this tag to individual segments
            // Process any final pending segment before stopping
            if (currentSegment) {
                console.warn("[hls_parser] Playlist ended unexpectedly after EXTINF but before segment URI for sequence", currentSegment.sequence);
                // Decide whether to discard or dispatch the incomplete segment
                currentSegment = null; // Discard incomplete segment at endlist
            }


            // --- Segment URI Processing ---
        } else if (currentSegment && !line.startsWith('#')) {
            // This line is the segment URI, associated with the preceding EXTINF (currentSegment)
            currentSegment.url = resolveUrl(line, baseUrl);
            currentSegment.id = `${playlistId}_seq${currentSegment.sequence}`;
            currentSegment.filename = line.split('/').pop().split('?')[0];

            // Attach any SCTE tag data that was found *before* this segment's EXTINF
            // if (pendingScteTagData) {
            //     // Ensure list exists
            //     if (!currentSegment.scteTagDataList) {
            //         currentSegment.scteTagDataList = [];
            //     }
            //     currentSegment.scteTagDataList.push(pendingScteTagData);
            //     console.log(`[hls_parser] Attached PENDING SCTE tag data to segment ${currentSegment.id}`);
            //     pendingScteTagData = null; // Clear pending data once attached
            // }
            if (pendingScteTagDataList.length > 0) {
                if (!currentSegment.scteTagDataList) {
                    currentSegment.scteTagDataList = [];
                }
                currentSegment.scteTagDataList.push(...pendingScteTagDataList);
                console.log(`[hls_parser] Attached ${pendingScteTagDataList.length} pending SCTE tag(s) to segment ${currentSegment.id}`);
                pendingScteTagDataList = []; // Reset after attaching
            }
            

            // Add the fully formed segment to the list for this parse cycle
            newSegments.push(currentSegment);

            // Dispatch event for this segment (UI / scte_manager listens)
            dispatchSegmentAdded(currentSegment);

            // Dispatch discontinuity event if flagged
            if (currentSegment.discontinuity) {
                console.log(`[hls_parser] Dispatching discontinuity for segment: ${currentSegment.id}`);
                document.dispatchEvent(new CustomEvent('hlsDiscontinuityDetected', { detail: { segment: currentSegment } }));
            }

            // Prepare for the next segment
            mediaSequence++;
            currentSegment = null; // Reset currentSegment, ready for the next EXTINF

        } else if (!currentSegment && !line.startsWith('#') && line.trim()) {
            // Standalone segment URI without preceding EXTINF - non-standard.
            console.warn(`[hls_parser] Encountered standalone segment URI without #EXTINF: ${line}`);
            // Discard any pending SCTE data as we can't reliably associate it
            // pendingScteTagData = null;
            pendingScteTagDataList = [];
            nextSegmentHasDiscontinuity = false;
        }
        // Implicitly ignore other unrecognized '#' tags
    } // --- End loop through lines ---

    // Handle any SCTE tag data that was pending at the very end (e.g., after last segment URI or after ENDLIST)
    // if (pendingScteTagData) {
    //     console.warn('[hls_parser] Playlist parsing ended with unattached pending SCTE tag data:', pendingScteTagData.line);
    //     // Decide what to do: discard, or dispatch a playlist-level event? For now, discard.
    //     pendingScteTagData = null;
    // }
    if (pendingScteTagDataList.length > 0) {
        console.warn(`[hls_parser] Playlist parsing ended with ${pendingScteTagDataList.length} unattached pending SCTE tag(s):`);
        pendingScteTagDataList.forEach((tag, idx) => {
            console.warn(` - [${idx}] Line: ${tag.line}`);
        });
        // Decide what to do: discard, or dispatch a playlist-level event? For now, discard.
        pendingScteTagDataList = [];
    }

    // --- Update state.mediaPlaylists[playlistId].segments ---
    if (state.mediaPlaylists[playlistId]) {
        const existingSegments = state.mediaPlaylists[playlistId].segments;
        const lastExistingSeq = existingSegments.length > 0 ? existingSegments[existingSegments.length - 1].sequence : -1;

        // Filter segments from *this parse cycle* to only include those newer than what's stored
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
        // This should ideally not happen if the playlist was added before calling parseMediaPlaylist
        console.error(`[hls_parser] Playlist ID ${playlistId} not found in state when trying to add segments! Creating entry.`);
        state.mediaPlaylists[playlistId] = { url: baseUrl, content: content, segments: newSegments };
    }

    // Calculate total unique segments encountered across all playlists
    const totalSegments = state.allSegments.filter(s => s.type !== 'master' && s.type !== 'media' && s.type !== 'unknown').length;
    dispatchStatusUpdate(`Parsed ${totalSegments} unique segments total.`);
}


// ---- Playlist Refresh (Live) ----
function startPlaylistRefresh(initialRefreshUrl, playlistId) {
    // Clear any existing interval specifically for this playlistId if you were managing multiple.
    // Since state.playlistRefreshInterval is singular, this clears any ongoing refresh.
    if (state.playlistRefreshInterval) {
        clearInterval(state.playlistRefreshInterval);
        state.playlistRefreshInterval = null; // Important to nullify after clearing
        console.log('[hls_parser] Cleared existing refresh interval before starting new one.');
    }

    // Determine refresh interval.
    // HLS spec suggests half the target duration.
    // We use 70% of target duration, or a default, ensuring it's at least 1 second.
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

        // Check if the playlist still exists in our state (it might have been removed by a stream reset)
        const currentPlaylistInState = state.mediaPlaylists[playlistId];
        if (!currentPlaylistInState) {
            console.warn(`[hls_parser] Playlist ID: ${playlistId} no longer in state. Stopping its refresh cycle.`);
            clearInterval(state.playlistRefreshInterval);
            state.playlistRefreshInterval = null;
            return;
        }

        try {
            // Fetch the manifest. fetchManifest returns an object: { content: string, finalUrl: string }
            const fetchResult = await fetchManifest(initialRefreshUrl); // Fetch using the URL passed to startPlaylistRefresh

            const newPlaylistString = fetchResult.content;
            const actualFetchedUrl = fetchResult.finalUrl; // The URL the content was *actually* fetched from (after redirects)

            // Log if the URL changed due to redirects during this refresh fetch
            if (initialRefreshUrl !== actualFetchedUrl && !actualFetchedUrl.startsWith('blob:')) {
                console.log(`[hls_parser] Refresh URL for Playlist ID: ${playlistId} redirected: ${getShortUrl(initialRefreshUrl)} -> ${getShortUrl(actualFetchedUrl)}`);
            }

            // Compare the new content with the currently stored content for this playlist
            if (currentPlaylistInState.content !== newPlaylistString) {
                console.log(`[hls_parser] Playlist ID: ${playlistId} (fetched from ${getShortUrl(actualFetchedUrl)}) has updated content. Reparsing.`);

                // Update the stored content string
                currentPlaylistInState.content = newPlaylistString;

                // CRITICAL: Update the stored URL for this playlist if it changed during this refresh.
                // This ensures parseMediaPlaylist uses the correct baseUrl for resolving segment URIs if the playlist moved.
                if (currentPlaylistInState.url !== actualFetchedUrl && !actualFetchedUrl.startsWith('blob:')) {
                    console.log(`[hls_parser] Updating stored URL for Playlist ID: ${playlistId} from ${getShortUrl(currentPlaylistInState.url)} to ${getShortUrl(actualFetchedUrl)}.`);
                    currentPlaylistInState.url = actualFetchedUrl;
                }

                // Parse the new playlist content.
                // The baseUrl for parsing is the URL from which the content was actually fetched.
                parseMediaPlaylist(newPlaylistString, actualFetchedUrl, playlistId);

                // Dispatch an event indicating the media playlist was parsed/updated
                dispatchPlaylistParsed('media', {
                    id: playlistId,
                    url: actualFetchedUrl, // Report the URL it was fetched from
                    content: newPlaylistString
                });
            } else {
                console.log(`[hls_parser] Playlist ID: ${playlistId} (fetched from ${getShortUrl(actualFetchedUrl)}) content unchanged.`);
            }
        } catch (err) {
            console.error(`[hls_parser] Error refreshing Playlist ID: ${playlistId} (attempted URL: ${getShortUrl(initialRefreshUrl)}):`, err);
            dispatchStatusUpdate(`Error refreshing playlist ${playlistId}: ${err.message}`);
            // Optional: Implement more sophisticated error handling here, e.g.,
            // - Stop refreshing after N consecutive errors.
            // - Implement an exponential backoff for retries.
            // For now, it will simply log the error and try again on the next interval.
        }
    }, refreshDelay);
}

// ---- Utility Functions ----
function resolveUrl(relativeUrl, baseUrl) {
    if (!relativeUrl || !baseUrl) return relativeUrl; // Nothing to resolve

    // If relativeUrl is already absolute, return it directly
    if (/^(https?|blob|data):/i.test(relativeUrl)) {
        return relativeUrl;
    }

    try {
        // Use URL constructor for robust resolution
        return new URL(relativeUrl, baseUrl).href;
    } catch (e) {
        console.warn(`[hls_parser] URL resolution failed for "${relativeUrl}" with base "${baseUrl}". Falling back. Error: ${e}`);
        // Fallback for simpler cases (less reliable)
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
        // Fallback if not a valid URL
        return url.substring(0, maxLength / 2) + '...' + url.substring(url.length - maxLength / 2);
    }
}

// ---- Global API ----
window.metaviewAPI = window.metaviewAPI || {};
window.metaviewAPI.hlsparser = window.metaviewAPI.hlsparser || {};

// ResponseStatus function
window.metaviewAPI.hlsparser.ResponseStatus = function () {
    return state.lastHttpStatus;
};

// Make the init function globally accessible (or use modules later)
window.HlsParser = {
    init: initHlsParser,
    getState: () => state, // Provide read-only access to state if needed elsewhere
    // Expose parsing utilities? Not strictly needed for this refactor, but could be useful.
    // resolveUrl: resolveUrl,
    // getShortUrl: getShortUrl,
    // extractVariantStreams: extractVariantStreams // Exposing internals might be too much
};

console.log('[hls_parser] Ready.');