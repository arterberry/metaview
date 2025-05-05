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
        // console.log(`[hls_parser] Segment already known: ${segment.url}`);
    }
}

function dispatchPlaylistParsed(type, details) { // type = 'master' or 'media'
    document.dispatchEvent(new CustomEvent('hlsPlaylistParsed', { detail: { type, ...details } }));
}


// ---- Parser Initialization ----
function initHlsParser(url) {
    if (!url) {
        dispatchStatusUpdate("Error: No HLS URL provided.");
        console.error("[hls_parser] Initialization failed: No URL.");
        return;
    }
    state.masterUrl = url;
    dispatchStatusUpdate(`Loading manifest: ${getShortUrl(url)}`);

    // Add the initial Master/Media playlist entry to the UI immediately
    // We guess the type first, and refine after fetching
    const initialEntry = {
        id: 'initial_playlist',
        url: url,
        title: 'Loading Playlist...',
        type: 'unknown' // Will be updated later
    };
    dispatchSegmentAdded(initialEntry); // Send to UI


    fetchManifest(url)
        .then(content => {
            const isMaster = isMasterPlaylist(content);
            const playlistType = isMaster ? 'master' : 'media';

            // Update the initial UI entry with the correct type
            document.dispatchEvent(new CustomEvent('hlsUpdateSegmentType', {
                detail: { url: url, type: playlistType, title: isMaster ? 'Master Playlist' : 'Media Playlist' }
            }));


            if (isMaster) {
                console.log('[hls_parser] Detected master playlist');
                parseMasterPlaylist(content, url);
            } else {
                console.log('[hls_parser] Detected media playlist');
                handleDirectMediaPlaylist(content, url);
            }
            state.initialLoadComplete = true;
        })
        .catch(err => {
            console.error('[hls_parser] Manifest load failed:', err);
            dispatchStatusUpdate(`Error loading manifest: ${err.message}`);
            // Update the initial UI entry to show the error
            document.dispatchEvent(new CustomEvent('hlsUpdateSegmentType', {
                detail: { url: url, type: 'error', title: 'Load Failed' }
            }));
        });
}

// ---- Playlist Fetch ----
async function fetchManifest(url) {
    console.log('[hls_parser] Fetching manifest:', url);
    let response = null;
    try {
        const response = await fetch(url, {
            method: 'GET',
            headers: {
                'Cache-Control': 'no-cache',
                'Pragma': 'no-cache',
                'Accept': 'application/vnd.apple.mpegurl, application/x-mpegurl, */*', // Be explicit
            },
            credentials: 'omit',
            mode: 'cors',
            cache: 'no-store' // Stronger cache prevention
        });

        state.lastHttpStatus = response.status; // Store the status code immediately

        console.log(`[hls_parser] Response for ${getShortUrl(url)}: ${response.status} ${response.statusText}`);
        if (!response.ok) {
            throw new Error(`HTTP error ${response.status}: ${response.statusText}`);
        }
        const text = await response.text();
        if (!text || !text.includes('#EXTM3U')) {
            throw new Error('Invalid M3U8 content received');
        }
        return text;

    } catch (error) {

        if (!response) {
            state.lastHttpStatus = null; // Indicate fetch failure, not an HTTP status
            console.error(`[hls_parser] Network or fetch error for ${url}:`, error);
        } else {
            console.error(`[hls_parser] Fetch error for ${url}:`, error);
        }
        throw error; // Re-throw to be caught by caller
    }
}

function isMasterPlaylist(content) {
    // More robust check
    return content.includes('#EXT-X-STREAM-INF') || content.includes('#EXT-X-I-FRAME-STREAM-INF');
}

// ---- Master Playlist Parsing ----
function parseMasterPlaylist(content, baseUrl) {
    state.masterManifest = content;
    dispatchStatusUpdate('Parsing master playlist...');

    const variants = extractVariantStreams(content);
    console.log(`[hls_parser] Found ${variants.length} variant streams`);

    // Dispatch master playlist info (could be used for variant switching later)
    dispatchPlaylistParsed('master', { url: baseUrl, content, variants });

    // --- Auto-select and load the first (often highest bitrate) variant ---
    // TODO: Add logic to select based on preference or bandwidth estimation later
    if (variants.length === 0) {
        dispatchStatusUpdate('Master playlist found, but no variant streams detected.');
        return;
    }

    // Let's try picking the first one listed (often reasonable default)
    // Or could sort by bandwidth: variants.sort((a, b) => (b.bandwidth || 0) - (a.bandwidth || 0));
    const selectedVariant = variants[0];
    const mediaUrl = resolveUrl(selectedVariant.uri, baseUrl);
    const id = `variant_${selectedVariant.bandwidth || 0}_${selectedVariant.resolution || 'unknown'}`; // Unique ID

    dispatchStatusUpdate(`Loading media playlist: ${getShortUrl(mediaUrl)}`);

    // Add media playlist entry to UI
    dispatchSegmentAdded({
        id: `media_${id}`, // Unique ID for this media playlist entry
        url: mediaUrl,
        title: `Media Playlist (${selectedVariant.resolution || 'Variant'})`,
        type: 'media',
        bandwidth: selectedVariant.bandwidth,
        resolution: selectedVariant.resolution,
        codecs: selectedVariant.codecs
    });


    fetchManifest(mediaUrl)
        .then(mediaContent => {
            state.mediaPlaylists[id] = {
                url: mediaUrl,
                content: mediaContent,
                bandwidth: selectedVariant.bandwidth,
                resolution: selectedVariant.resolution,
                codecs: selectedVariant.codecs,
                segments: [] // Segments will be added by parseMediaPlaylist
            };
            state.activeMediaPlaylistId = id;
            parseMediaPlaylist(mediaContent, mediaUrl, id);

            // Check if live AFTER parsing segments
            if (!mediaContent.includes('#EXT-X-ENDLIST')) {
                state.isLive = true;
                dispatchStatusUpdate(`Live stream detected. Refreshing playlist every ${state.updateInterval / 1000}s`);
                startPlaylistRefresh(mediaUrl, id);
            } else {
                state.isLive = false;
                dispatchStatusUpdate('VOD stream loaded.');
            }
            dispatchPlaylistParsed('media', { id, url: mediaUrl, content: mediaContent });
        })
        .catch(err => {
            console.error(`[hls_parser] Media playlist load failed for ${mediaUrl}:`, err);
            dispatchStatusUpdate(`Error loading media playlist: ${err.message}`);
            // Update UI entry for this media playlist to show error
            document.dispatchEvent(new CustomEvent('hlsUpdateSegmentType', {
                detail: { url: mediaUrl, type: 'error', title: `Media Load Failed (${selectedVariant.resolution || 'Variant'})` }
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

    for (const lineRaw of lines) {
        const line = lineRaw.trim();
        if (!line) continue;

        // Add this logging for SCTE-related lines
        if (line.includes('SCTE') || line.includes('CUE')) {
            console.log('[hls_parser] Potential SCTE line detected:', line);
        }

        if (window.SCTEDispatcher) {
            window.SCTEDispatcher.processTag(line);
        } // Process SCTE tags if dispatcher is available 

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
            currentSegment?.tags.push(line);
        } else if (line.startsWith('#EXT-X-MAP:')) {
            currentMap = {
                uri: resolveUrl(line.match(/URI="([^"]+)"/)?.[1], baseUrl),
                byterange: line.match(/BYTERANGE="([^"]+)"/)?.[1] // Optional
            };
            // Apply map to subsequent segments
            if (currentSegment) currentSegment.map = currentMap;
            currentSegment?.tags.push(line);

        } else if (line.startsWith('#EXT-X-PROGRAM-DATE-TIME:')) {
            programDateTime = new Date(line.substring('#EXT-X-PROGRAM-DATE-TIME:'.length));
            if (currentSegment) currentSegment.programDateTime = programDateTime; // Apply to current segment if EXTINF came first
            currentSegment?.tags.push(line);

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
        }
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
function startPlaylistRefresh(url, playlistId) {
    // Clear any existing interval first
    if (state.playlistRefreshInterval) {
        clearInterval(state.playlistRefreshInterval);
        state.playlistRefreshInterval = null;
        console.log('[hls_parser] Cleared existing refresh interval.');
    }

    // Determine refresh interval (use target duration if available, else default)
    // HLS spec suggests half the target duration, but let's be slightly less aggressive
    const refreshDelay = state.targetDuration ? Math.max(1000, state.targetDuration * 1000 * 0.7) : state.updateInterval;
    console.log(`[hls_parser] Starting playlist refresh for ${getShortUrl(url)} every ${refreshDelay}ms (Playlist ID: ${playlistId})`);


    state.playlistRefreshInterval = setInterval(async () => {
        if (!state.isLive) { // Stop refreshing if ENDLIST was encountered
            clearInterval(state.playlistRefreshInterval);
            state.playlistRefreshInterval = null;
            console.log('[hls_parser] Stopping refresh interval as stream is no longer live.');
            return;
        }
        try {
            const latestContent = await fetchManifest(url);
            const currentPlaylist = state.mediaPlaylists[playlistId];

            if (currentPlaylist && currentPlaylist.content !== latestContent) {
                console.log(`[hls_parser] Playlist ${playlistId} updated. Reparsing.`);
                currentPlaylist.content = latestContent; // Update content in state
                parseMediaPlaylist(latestContent, url, playlistId); // Reparse
                dispatchPlaylistParsed('media', { id: playlistId, url, content: latestContent }); // Notify UI of update
            } else if (!currentPlaylist) {
                console.warn(`[hls_parser] Playlist ${playlistId} not found during refresh cycle.`);
                clearInterval(state.playlistRefreshInterval); // Stop if state is inconsistent
            } else {
                // console.log(`[hls_parser] Playlist ${playlistId} unchanged.`);
            }
        } catch (err) {
            console.error(`[hls_parser] Error refreshing playlist ${playlistId}:`, err);
            dispatchStatusUpdate(`Error refreshing playlist: ${err.message}`);
            // Optional: Implement retry logic or stop refreshing after too many errors
            // clearInterval(state.playlistRefreshInterval);
            // state.playlistRefreshInterval = null;
        }
    }, refreshDelay); // Use calculated delay
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
window.metaviewAPI.hlsparser.ResponseStatus = function() {
    return state.lastHttpStatus;
}; 

// Make the init function globally accessible (or use modules later)
window.HlsParser = {
    init: initHlsParser,
    getState: () => state // Provide read-only access to state if needed elsewhere
};

console.log('[hls_parser] Ready.');