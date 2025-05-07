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

    const lines = content.split('\n');
    const newSegments = [];
    let currentSegment = null;
    let mediaSequence = parseInt(content.match(/#EXT-X-MEDIA-SEQUENCE:(\d+)/)?.[1], 10) || 0;
    let discontinuitySequence = parseInt(content.match(/#EXT-X-DISCONTINUITY-SEQUENCE:(\d+)/)?.[1], 10) || 0;
    let currentKey = null; // Track current encryption key context
    let currentMap = null; // Track current EXT-X-MAP context
    let programDateTime = null; // Track Program Date Time
    let nextSegmentHasDiscontinuity = false;
    let pendingScteTagData = null;

    for (const lineRaw of lines) {
        const line = lineRaw.trim();
        if (!line) continue;

        // Add this logging for SCTE-related lines
        if (line.includes('SCTE') || line.includes('CUE')) {
            console.log('[hls_parser] Potential SCTE line detected:', line);
            if (window.SCTE35Parser) { // Still need SCTE35Parser for extractFromHLSTags's initial regex
                const extractionResult = window.SCTE35Parser.extractFromHLSTags(line, true); // Pass a new flag 'extractOnly'
                if (extractionResult && extractionResult.encoded) {
                    console.log('[hls_parser] Extracted SCTE-35 tag (parsing deferred):', extractionResult.encoded);
                    pendingScteTagData = { // Store raw details
                        line: line,
                        encoded: extractionResult.encoded,
                        encodingType: extractionResult.encodingType,
                        // NO 'parsed' field here yet
                    };
                }
            }
        }

        // Original SCTEDispatcher logic (can keep or remove depending on its actual use)
        // If SCTEDispatcher does its *own* parsing, this could be redundant/conflicting.
        // Based on the request, `scte_manager.js` should handle the display.
        // The new scte35parse.js extracts the data for scte_manager.js.
        // Let's assume SCTEDispatcher is an old/separate mechanism and focus on the new one.
        // Removing or commenting out this line to avoid confusion:
        /*
        if (window.SCTEDispatcher) {
            window.SCTEDispatcher.processTag(line);
        } // Process SCTE tags if dispatcher is available
        */
        // Process SCTE tags if dispatcher is available 

        if (line.startsWith('#EXTINF:')) {
            const durationMatch = line.match(/#EXTINF:([\d.]+)/);
            const titleMatch = line.split(',')[1];
            currentSegment = {
                duration: durationMatch ? parseFloat(durationMatch[1]) : 0,
                title: titleMatch ? titleMatch.trim() : '',
                sequence: mediaSequence, // Associate with current sequence number
                playlistId: playlistId,
                tags: [], // Store associated tags
                programDateTime: programDateTime // Associate PDT if available
                // ---> SCTE TAG DATA WILL BE ATTACHED HERE LATER <---
                // scteTagData: pendingScteTagData // No, attach when URL is found
                // ---> END ATTACHMENT NOTE <---
            };
            if (currentKey) currentSegment.encryption = currentKey;
            if (currentMap) currentSegment.map = currentMap; // Associate map info
            currentSegment.tags.push(line); // Store the raw tag line

        } else if (line.startsWith('#EXT-X-BYTERANGE:')) {
            if (currentSegment) {
                const byteRangeMatch = line.match(/#EXT-X-BYTERANGE:(\d+)(?:@(\d+))?/);
                if (byteRangeMatch) {
                    currentSegment.byteRange = {
                        length: parseInt(byteRangeMatch[1], 10),
                        offset: byteRangeMatch[2] ? parseInt(byteRangeMatch[2], 10) : null // Offset is optional
                    };
                    currentSegment.tags.push(line);
                }
            }
        } else if (line.startsWith('#EXT-X-KEY:')) {
            currentKey = {
                method: line.match(/METHOD=([^,]+)/)?.[1],
                uri: line.match(/URI="([^"]+)"/)?.[1] ? resolveUrl(line.match(/URI="([^"]+)"/)[1], baseUrl) : null,
                iv: line.match(/IV=([^,]+)/)?.[1],
                keyformat: line.match(/KEYFORMAT="([^"]+)"/)?.[1],
                keyformatversions: line.match(/KEYFORMATVERSIONS="([^"]+)"/)?.[1]
            };
            // Apply key to subsequent segments (until next #EXT-X-KEY or METHOD=NONE)
            if (currentSegment) currentSegment.encryption = currentKey; // Apply to current if it exists
            // currentSegment?.tags.push(line);
            // Add key tag to segment tags array if a segment is pending
            if (currentSegment) currentSegment.tags.push(lineRaw);
            // If no segment is pending, this key applies to future segments, store it globally or on playlist state if needed
            // For now, just applying to current/next segment context seems sufficient based on typical HLS parsing logic.

        } else if (line.startsWith('#EXT-X-MAP:')) {
            currentMap = {
                uri: resolveUrl(line.match(/URI="([^"]+)"/)?.[1], baseUrl),
                byterange: line.match(/BYTERANGE="([^"]+)"/)?.[1] // Optional
            };
            // Apply map to subsequent segments
            if (currentSegment) currentSegment.map = currentMap;
            // currentSegment?.tags.push(line);
            if (currentSegment) currentSegment.tags.push(lineRaw); // Add map tag to segment tags


        } else if (line.startsWith('#EXT-X-PROGRAM-DATE-TIME:')) {
            programDateTime = new Date(line.substring('#EXT-X-PROGRAM-DATE-TIME:'.length));
            if (currentSegment) currentSegment.programDateTime = programDateTime; // Apply to current segment if EXTINF came first
            // currentSegment?.tags.push(line);
            if (currentSegment) currentSegment.tags.push(lineRaw); // Add PDT tag to segment tags

        } else if (line === '#EXT-X-DISCONTINUITY') {
            console.log('[hls_parser] Found exact #EXT-X-DISCONTINUITY tag.');
            discontinuitySequence++; // Increment discontinuity counter
            if (currentSegment) {
                currentSegment.discontinuity = true;
                currentSegment.tags.push(line);
                // ---> DISPATCH EVENT WHEN DISCONTINUITY TAG IS ASSOCIATED WITH A SEGMENT <---
                // We might dispatch this slightly later when the segment URL is known,
                // but attaching the flag here is correct. We'll dispatch when segment is pushed.
            } else {
                // If discontinuity appears before EXTINF, store it to apply to the *next* segment
                nextSegmentHasDiscontinuity = true;
            }
            // Reset PDT context after discontinuity? (Check HLS spec - usually yes)
            // programDateTime = null;

        } else if (line.startsWith('#EXT-X-MEDIA-SEQUENCE:')) {
            // Already parsed mediaSequence above, just acknowledge
            continue;
        } else if (line.startsWith('#EXT-X-TARGETDURATION:')) {
            // Store target duration for context if needed
            state.targetDuration = parseInt(line.split(':')[1], 10);
        } else if (line.startsWith('#EXT-X-VERSION:')) {
            state.hlsVersion = parseInt(line.split(':')[1], 10);
        } else if (line.startsWith('#EXT-X-ENDLIST')) {
            state.isLive = false; // Explicit end found
            clearInterval(state.playlistRefreshInterval);
            state.playlistRefreshInterval = null;
            console.log('[hls_parser] Reached ENDLIST.');
            dispatchStatusUpdate("VOD stream finished loading.");

        } else if (currentSegment && !line.startsWith('#')) {
            // This line is the segment URI
            currentSegment.url = resolveUrl(line, baseUrl);
            currentSegment.id = `${playlistId}_seq${currentSegment.sequence}`; // Use sequence for ID
            currentSegment.filename = line.split('/').pop().split('?')[0]; // Extract filename

            // ---> ATTACH PENDING SCTE TAG DATA TO THE SEGMENT <---
            if (pendingScteTagData) {
                currentSegment.scteTagData = pendingScteTagData;
                pendingScteTagData = null; // Reset for the next segment
                console.log(`[hls_parser] Attached SCTE tag data to segment ${currentSegment.id}`);
            }
            // ---> END ATTACHMENT <---

            // ---> APPLY DISCONTINUITY FLAG IF IT PRECEDED EXTINF <---
            if (nextSegmentHasDiscontinuity) {
                currentSegment.discontinuity = true;
                // Optionally add the tag line itself if needed: currentSegment.tags.push('#EXT-X-DISCONTINUITY');
                nextSegmentHasDiscontinuity = false; // Reset flag
            }
            // ---> END APPLY FLAG <---


            // Add the fully formed segment
            newSegments.push(currentSegment);
            dispatchSegmentAdded(currentSegment); // Send to UI (manifest_ui listens to this)

            // ---> DISPATCH DISCONTINUITY EVENT IF SEGMENT HAS FLAG <---
            if (currentSegment.discontinuity) {
                console.log(`[hls_parser] Dispatching discontinuity for segment: ${currentSegment.id}`);
                document.dispatchEvent(new CustomEvent('hlsDiscontinuityDetected', {
                    detail: {
                        segment: currentSegment // Pass the whole segment object
                    }
                }));
            }
            // ---> END DISPATCH <---

            mediaSequence++;
            currentSegment = null;
            // nextSegmentHasDiscontinuity = false; // Already reset above
        } else if (!line.startsWith('#') && line.trim()) {
            // This is a segment URI line WITHOUT a preceding #EXTINF. This is non-standard,
            // but might occur in malformed manifests or specific edge cases.
            // In standard HLS, every segment URI must be preceded by EXTINF.
            // If we encounter this, we technically can't create a segment object with duration, etc.
            // We'll skip it for now, relying on EXTINF always preceding the URI.
            console.warn(`[hls_parser] Encountered standalone segment URI without #EXTINF: ${line}`);
            // Ensure pending SCTE data is cleared as it won't be attached to a valid segment
            pendingScteTagData = null;
            nextSegmentHasDiscontinuity = false;
        }
    }

    // Handle any pending SCTE tag data at the very end of the playlist.
    // This data wouldn't be associated with a segment URI line if the playlist ends right after the tag.
    // We can potentially dispatch this as a playlist-level SCTE signal if needed, or discard it.
    // For now, discard as the request implies segment-associated SCTE data.
    if (pendingScteTagData) {
        console.warn('[hls_parser] Playlist ended with pending SCTE tag data:', pendingScteTagData.line);
        pendingScteTagData = null; // Discard unassociated data
    }

    // Update the segments list for this specific playlist in the state
    if (state.mediaPlaylists[playlistId]) {
        // We might need more sophisticated merging logic for live streams
        // to avoid duplicates if refresh is faster than segment duration.
        // For now, just replace or append based on sequence numbers.
        // Basic approach: find the latest known sequence from the new list
        // and append segments with higher sequence numbers.
        const existingSegments = state.mediaPlaylists[playlistId].segments;
        const lastExistingSeq = existingSegments.length > 0 ? existingSegments[existingSegments.length - 1].sequence : -1;

        const trulyNewSegments = newSegments.filter(s => s.sequence > lastExistingSeq);
        state.mediaPlaylists[playlistId].segments.push(...trulyNewSegments);

        // Log how many *new* segments were actually added after filtering
        if (trulyNewSegments.length > 0) {
            console.log(`[hls_parser] Added ${trulyNewSegments.length} new segments to playlist ${playlistId}`);
        }

    } else {
        // Should not happen if playlist was added correctly before parsing
        console.warn(`[hls_parser] Playlist ID ${playlistId} not found in state when adding segments.`);
        state.mediaPlaylists[playlistId] = { url: baseUrl, content, segments: newSegments };
    }


    // Calculate total segments parsed for status update
    const totalSegments = state.allSegments.filter(s => s.type !== 'master' && s.type !== 'media' && s.type !== 'unknown').length;
    dispatchStatusUpdate(`Parsed ${totalSegments} segments total.`);
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