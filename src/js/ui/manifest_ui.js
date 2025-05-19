// js/ui/manifest_ui.js

console.log('[manifest_ui] Loading...');

// Cache DOM elements
const uiElements = {};

// Keep track of segment elements added to the UI
const segmentElements = new Map(); // Map segment.id to its DOM element

document.addEventListener('DOMContentLoaded', () => {
    console.log('[manifest_ui] DOM ready. Initializing UI components.');
    cacheDOMElements();
    setupUIHandlers();
    setupEventListeners();

    // Find the HLS URL from the query string (used by player_loader.js as well)
    const hlsUrl = getRawSrcUrl();
    if (hlsUrl && window.HlsParser) {
        // console.log(`[manifest_ui] Triggering HLS parser for: ${hlsUrl}`);
        window.HlsParser.init(hlsUrl); // Start the parsing process
    } else if (!hlsUrl) {
        console.warn('[manifest_ui] No HLS URL found in query params for parser.');
        // updateStatus("No HLS stream URL found in the page address.");
    } else {
        console.error('[manifest_ui] HlsParser not found. Ensure hls_parser.js is loaded first.');
        // updateStatus("Error: HLS Parser module failed to load.");
    }
});

function cacheDOMElements() {
    uiElements.metadataList = document.getElementById('metadataList');
    uiElements.headerContent = document.getElementById('headerContent');
    uiElements.bodyContent = document.getElementById('bodyContent');
    uiElements.statusBar = document.getElementById('statusBar');
    uiElements.responsePanelUpdate = document.getElementById('responsePanelUpdate'); // For showing/hiding panels
    uiElements.metadataPanel = document.getElementById('metadataPanel'); // For showing/hiding panels

    // Ensure default messages are set
    if (uiElements.headerContent) uiElements.headerContent.textContent = 'Select a segment or playlist to view details';
    if (uiElements.bodyContent) uiElements.bodyContent.textContent = ''; // Clear body initially
}

function setupEventListeners() {
    // console.log('[manifest_ui] Setting up event listeners for HLS parser and fragment events.');
    // document.addEventListener('hlsStatusUpdate', (e) => updateStatus(e.detail.message));
    document.addEventListener('hlsSegmentAdded', (e) => addSegmentToUI(e.detail.segment)); // For parsed items
    document.addEventListener('hlsFragLoadedUI', (e) => addSegmentToUI(e.detail)); // For live fragments <<< ADD THIS LISTENER
    document.addEventListener('hlsPlaylistParsed', handlePlaylistParsed);
    document.addEventListener('hlsUpdateSegmentType', handleUpdateSegmentType);
    document.addEventListener('segmentExpired', handleSegmentExpired);
    // window.addSegmentToUI = addSegmentToUI;
}


function setupUIHandlers() {
    // Tab switching for Response Header/Body
    document.querySelectorAll('.metadata_tab-buttonUpdate').forEach(button => {
        button.addEventListener('click', (e) => {
            const tabId = e.target.getAttribute('data-tab');
            if (!tabId) return;

            // Update button active state
            document.querySelectorAll('.metadata_tab-buttonUpdate').forEach(btn => btn.classList.remove('active'));
            e.target.classList.add('active');

            // Update pane active state
            document.querySelectorAll('.metadata_tab-paneUpdate, .metadata_tab-paneBodyUpdate').forEach(pane => {
                pane.classList.remove('active');
            });

            const targetPane = document.getElementById(`${tabId}-tabUpdate`);
            if (targetPane) {
                targetPane.classList.add('active');
            } else {
                console.warn(`[manifest_ui] Tab pane not found for ID: ${tabId}-tabUpdate`);
            }
        });
    });

    // Ensure initial active tab state matches HTML
    const initialActiveButton = document.querySelector('.metadata_tab-buttonUpdate.active');
    const initialTabId = initialActiveButton ? initialActiveButton.getAttribute('data-tab') : 'headers'; // Default to headers
    const initialPane = document.getElementById(`${initialTabId}-tabUpdate`);
    document.querySelectorAll('.metadata_tab-paneUpdate, .metadata_tab-paneBodyUpdate').forEach(pane => pane.classList.remove('active'));
    if (initialPane) initialPane.classList.add('active');


    // Add click listener to the container using event delegation for segment selection
    if (uiElements.metadataList) {
        uiElements.metadataList.addEventListener('click', (e) => {
            const targetElement = e.target.closest('div[data-segment-id]'); // Find the 
            if (targetElement) {
                const segmentId = targetElement.getAttribute('data-segment-id');
                const segmentUrl = targetElement.getAttribute('data-segment-url');
                const segmentType = targetElement.getAttribute('data-segment-type');

                // console.log(`[manifest_ui] Clicked on element: ID=${segmentId}, Type=${segmentType}, URL=${segmentUrl}`); // Enhanced log

                if (!segmentUrl) {
                    console.warn('[manifest_ui] Clicked item is missing data-segment-url attribute.');
                    return; // Cannot proceed without URL
                }

                if (segmentType === 'master' || segmentType === 'media') {
                    // Playlist clicked: Pass minimal info needed for fetchPlaylistContent
                    // console.log('[manifest_ui] Playlist item clicked. Selecting...');
                    selectSegment({ id: segmentId, url: segmentUrl, type: segmentType }, targetElement);

                } else if (segmentType === 'segment' || segmentType === 'fragment' || !segmentType /* Assume segment if type missing */) {
                    // Segment clicked: Try getting full object from parser state
                    // console.log('[manifest_ui] Segment item clicked. Trying to get state...');
                    const parserState = window.HlsParser?.getState();
                    const segmentObject = parserState?.segmentMap.get(segmentUrl); // segmentMap stores segments by URL

                    if (segmentObject) {
                        // console.log('[manifest_ui] Found full segment object in state.');
                        selectSegment(segmentObject, targetElement);
                    } else {
                        // Fallback if segment object not found (e.g., added by hls-listener or state issue)
                        // console.log(`[manifest_ui] Segment object not found in parser state (expected for live fragments/other sources) for URL: ${segmentUrl}. Using minimal info from DOM.`);
                        selectSegment({ id: segmentId, url: segmentUrl, type: segmentType || 'segment' }, targetElement);
                    }
                } else {
                    // Handle other types like 'unknown', 'error'
                    // console.log(`[manifest_ui] Clicked on element of type: ${segmentType}. Selecting with minimal info.`);
                    // Get title from element text for display
                    const titleNode = targetElement.querySelector('.segment-label-text') || targetElement;
                    const title = titleNode ? titleNode.textContent.trim() : 'Unknown Item';
                    selectSegment({ id: segmentId, url: segmentUrl, type: segmentType, title: title }, targetElement);
                }
            }

        });
    } else {
        console.error("[manifest_ui] metadataList element not found for event delegation.");
    }
}

function handlePlaylistParsed(event) {
    const { type, url, content, variants, id } = event.detail;
    // console.log(`[manifest_ui] Received Playlist Parsed event: Type=${type}, URL=${url}`);

    if (type === 'master') {
        // Update title maybe?
        const title = getTitleFromManifest(content, url); // Reuse title logic if needed
        document.title = title;
        //  updateStatus(`Master Playlist loaded. ${variants?.length || 0} variants found.`);
    } else if (type === 'media') {
        // Maybe update the status or log something specific about the media playlist
        const parserState = window.HlsParser?.getState();
        const playlistInfo = parserState?.mediaPlaylists[id];
        // updateStatus(`Media Playlist (${playlistInfo?.resolution || id}) parsed. Segments are being added.`);
    }

    // If a user previously selected the 'Loading Playlist...' item, update its content display
    const playlistElement = segmentElements.get('initial_playlist') || document.querySelector(`div[data-segment-url="${url}"]`);
    if (playlistElement && playlistElement.classList.contains('selected')) {
        displayPlaylistDetails(url, content, type);
    }
}

function handleUpdateSegmentType(event) {
    const { url, type, title } = event.detail;
    const element = document.querySelector(`div[data-segment-url="${url}"]`);
    if (element) {
        // console.log(`[manifest_ui] Updating type for ${url} to ${type}`);
        element.setAttribute('data-segment-type', type);

        // Update the display text/label if a title is provided
        const labelSpan = element.querySelector('.segment-label-text'); // Add a class to the text part for easier targeting
        if (labelSpan && title) {
            labelSpan.textContent = ` ${title}`;
        } else if (!labelSpan && title) {
            // If no specific label span, update the main text node (less robust)
            const textNode = Array.from(element.childNodes).find(node => node.nodeType === Node.TEXT_NODE && node.textContent.trim() !== '');
            if (textNode) textNode.textContent = ` ${title}`;
        }

        // Remove old type badge and add new one
        element.querySelector('.segment-badge')?.remove();
        const badge = buildBadge(type); // Assumes buildBadge is available (from segment-tags.js or here)
        if (badge) {
            // Insert after the timestamp span if it exists
            const timeSpan = element.querySelector('span:first-child');
            if (timeSpan) {
                timeSpan.parentNode.insertBefore(badge, timeSpan.nextSibling);
            } else {
                element.insertBefore(badge, element.firstChild);
            }
        }
    } else {
        console.warn(`[manifest_ui] Cannot update type: Element not found for URL ${url}`);
    }
}

// Replace the existing addSegmentToUI function in manifest_ui.js with this:

function addSegmentToUI(segmentData) {
    if (!uiElements.metadataList) {
        console.error("[manifest_ui] Cannot add segment to UI: metadataList element not found.");
        return;
    }
    if (!segmentData || !segmentData.id || !segmentData.url) {
        console.warn('[manifest_ui] Attempted to add invalid segment data:', segmentData);
        return;
    }

    // Prevent duplicates in the UI list itself based on ID
    if (segmentElements.has(segmentData.id)) {
        // console.log(`[manifest_ui] Segment UI element already exists for ID: ${segmentData.id}`);
        return;
    }

    const el = document.createElement('div');
    el.setAttribute('data-segment-id', segmentData.id);
    el.setAttribute('data-segment-url', segmentData.url);
    el.setAttribute('data-segment-type', segmentData.type || 'segment'); // Ensure type is set

    const timeSpan = document.createElement('span');
    timeSpan.className = 'segment-timestamp'; // Class for styling

    // --- Standardized Wall-Clock Timestamp (hh:mm:ss) ---
    const wallClockTime = new Date().toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false // Use 24-hour format
    });
    timeSpan.textContent = `[${wallClockTime}]`;
    el.appendChild(timeSpan);
    // --- End Timestamp Logic ---

    // --- Badge Logic (using segment-tags.js functions if available) ---

    const classification = typeof classifySegment === 'function'
        ? classifySegment(segmentData.url, segmentData.type)
        : (segmentData.type || 'Segment');
    const badge = typeof buildBadge === 'function' ? buildBadge(classification) : null;
    if (badge) {
        // Insert badge after the timestamp
        el.appendChild(badge); // Simpler append, CSS handles margin
    }
    // --- End Badge Logic ---

    // --- Label Text ---
    let labelText = '';
    switch (segmentData.type) {
        case 'master':
        case 'media':
        case 'unknown':
        case 'error':
            // Use provided title or generate from URL for playlists/special types
            labelText = segmentData.title || getSegmentDisplayName(segmentData.url);
            break;
        case 'fragment':
            // For live fragments, use filename, maybe add level/SN if needed
            labelText = getSegmentDisplayName(segmentData.url);
            // Optionally add more info: labelText += ` (Lvl: ${segmentData.level}, SN: ${segmentData.sequence})`;
            break;
        default: // 'segment' (parsed)
            // Use title if meaningful, otherwise filename
            labelText = segmentData.title && segmentData.title !== 'no desc' ? segmentData.title : getSegmentDisplayName(segmentData.url);
            break;
    }
    const labelSpan = document.createElement('span');
    labelSpan.className = 'segment-label-text';
    labelSpan.textContent = ` ${labelText}`; // Add space separation
    el.appendChild(labelSpan);
    // --- End Label Text ---

    // --- Set Element Class based on Type ---
    el.classList.add('segment-item'); // Base class
    switch (segmentData.type) {
        case 'master': el.classList.add('segment-master'); break;
        case 'media': el.classList.add('segment-media'); break;
        case 'unknown': el.classList.add('segment-loading'); break;
        case 'error': el.classList.add('segment-error'); break;
        case 'fragment': el.classList.add('segment-fragment', 'segment-live-fragment'); break; // Add specific class for live
        default: el.classList.add('segment-fragment'); break; // Parsed segments
    }
    // --- End Element Class ---


    // Store the element reference
    segmentElements.set(segmentData.id, el);


    // --- Insertion Logic ---
    if (segmentData.type === 'master' || segmentData.type === 'media' || segmentData.type === 'unknown' || segmentData.type === 'error') {
        // Insert playlists/special types at the beginning or after existing ones
        const lastSpecial = Array.from(uiElements.metadataList.querySelectorAll('.segment-master, .segment-media, .segment-loading, .segment-error')).pop();
        if (lastSpecial) {
            lastSpecial.insertAdjacentElement('afterend', el); // Insert after the last special item
        } else {
            uiElements.metadataList.prepend(el); // Insert at the very beginning if no specials exist
        }
    } else if (segmentData.type === 'segment') {
        // Insert parsed segments AFTER all playlists/specials but BEFORE live fragments
        const firstFragment = uiElements.metadataList.querySelector('.segment-live-fragment');
        if (firstFragment) {
            uiElements.metadataList.insertBefore(el, firstFragment); // Insert before the first live fragment
        } else {
            // If no live fragments yet, just append after playlists/specials
            const lastSpecial = Array.from(uiElements.metadataList.querySelectorAll('.segment-master, .segment-media, .segment-loading, .segment-error')).pop();
            if (lastSpecial) {
                lastSpecial.insertAdjacentElement('afterend', el);
            } else {
                // If no specials either, append (shouldn't happen often if playlists load first)
                uiElements.metadataList.appendChild(el);
            }
        }
    } else if (segmentData.type === 'fragment') {
        // Append live fragments to the very end of the list
        uiElements.metadataList.appendChild(el);

        // Auto-scroll logic for live fragments
        const isScrolledNearBottom = uiElements.metadataList.scrollHeight - uiElements.metadataList.clientHeight <= uiElements.metadataList.scrollTop + 60; // 60px tolerance
        if (isScrolledNearBottom) {
            // Use requestAnimationFrame for smoother scrolling after DOM update
            requestAnimationFrame(() => {
                uiElements.metadataList.scrollTop = uiElements.metadataList.scrollHeight;
            });
        }
    } else {
        // Fallback: Append any other unknown types
        // console.log(`[manifest_ui] Unknown segment type "${segmentData.type}" for insertion, appending.`);
        uiElements.metadataList.appendChild(el);
    }
    // --- End Insertion Logic ---
}


function selectSegment(segment, segmentElement) {
    // console.log(`[manifest_ui] Selecting segment: ${segment.id} (URL: ${segment.url})`);

    // Remove 'selected' class from all other items
    document.querySelectorAll('#metadataList .segment-item.selected').forEach(el => el.classList.remove('selected'));

    // Add 'selected' class to the clicked element
    if (segmentElement) {
        segmentElement.classList.add('selected');
    } else {
        // Fallback if element wasn't passed
        const el = segmentElements.get(segment.id);
        if (el) el.classList.add('selected');
    }


    // Fetch and display details based on type
    if (segment.type === 'master' || segment.type === 'media') {
        // For playlists, show the manifest content
        fetchPlaylistContent(segment.url, segment.type);
    } else if (segment.type === 'unknown' || segment.type === 'error') {
        // Handle loading/error states
        updateHeaderContent(`Status: ${segment.title || segment.type}`);
        updateBodyContent(`URL: ${segment.url}\n\n(${segment.type === 'error' ? 'Cannot fetch details.' : 'Details will load when available.'})`);
    } else {
        // For regular segments, fetch headers and content
        fetchSegmentDetails(segment);
    }

    // Ensure the Response/Body panels are visible
    if (uiElements.responsePanelUpdate && uiElements.metadataPanel) {
        // You might adjust layout here if needed, e.g., ensure panels have minimum width
        // uiElements.metadataPanel.style.flex = '1 1 50%'; // Example adjustment
        // uiElements.responsePanelUpdate.style.flex = '1 1 50%';
    }
}

function fetchPlaylistContent(url, type) {
    updateHeaderContent(`Fetching ${type} playlist content...`);
    updateBodyContent(''); // Clear body while fetching

    // Try getting content from parser state first to avoid re-fetch
    const parserState = window.HlsParser?.getState();
    let content = null;
    let foundInState = false; // Flag to track if we found it in state

    if (parserState) {
        // console.log(`[manifest_ui] Checking parser state for ${type} playlist: ${url}`);
        if (type === 'master' && parserState.masterUrl === url) {
            content = parserState.masterManifest;
            if (content) {
                // console.log('[manifest_ui] Found master content in state.');
                foundInState = true;
            }
        } else if (type === 'media') {
            // Find the correct media playlist entry in the state object by URL
            const playlistInfo = Object.values(parserState.mediaPlaylists || {}).find(p => p.url === url);
            if (playlistInfo && playlistInfo.content) {
                content = playlistInfo.content;
                // console.log(`[manifest_ui] Found media content in state for URL: ${url}`);
                foundInState = true;
            } else {
                // console.log(`[manifest_ui] Media playlist content not found in state for URL: ${url}. Known media playlist URLs:`, Object.values(parserState.mediaPlaylists || {}).map(p => p.url));
            }
        }
    } else {
        console.warn('[manifest_ui] Parser state not available to check for cached content.');
    }


    if (foundInState && content) {
        // console.log(`[manifest_ui] Using cached ${type} playlist content.`);
        // Need to simulate headers slightly if using cached content
        const pseudoHeaders = [
            `Status: 200 OK (Cached)`,
            `URL: ${url}`,
            `Content-Type: application/vnd.apple.mpegurl`, // Assume standard type
            `X-Content-Source: Parser Cache`
        ];
        updateHeaderContent(`Response Headers (from cache):\n${'-'.repeat(20)}\n${pseudoHeaders.join('\n')}`);
        displayPlaylistDetails(url, content, type);
    } else {
        // Fallback to fetching from network if not found in state
        // console.log(`[manifest_ui] Fetching ${type} playlist content from network: ${url}`);
        fetch(url, { cache: 'no-store' }) // Ensure fresh fetch if not cached
            .then(res => {
                // Display actual headers from network response
                const headers = [];
                headers.push(`Status: ${res.status} ${res.statusText}`);
                headers.push(`URL: ${res.url}`); // Show final URL after potential redirects
                res.headers.forEach((v, k) => headers.push(`${k}: ${v}`));
                updateHeaderContent(`Response Headers (from network):\n${'-'.repeat(20)}\n${headers.join('\n')}`);

                if (!res.ok) throw new Error(`HTTP error ${res.status} ${res.statusText}`);
                return res.text();
            })
            .then(text => {
                displayPlaylistDetails(url, text, type);
            })
            .catch(err => {
                console.error(`[manifest_ui] ${type} playlist fetch error:`, err);
                updateHeaderContent(`Error fetching ${type} playlist: ${err.message}`);
                updateBodyContent(`Failed to load content for: ${url}`);
                handleSegmentExpired({ detail: { url: url } }); // Mark as potentially expired/failed in UI
            });
    }
}

function displayPlaylistDetails(url, content, type) {
    // Update headers (show minimal info, headers were maybe shown during fetch)
    updateHeaderContent(`Playlist Details (${type})\nURL: ${url}\nType: ${isMasterPlaylist(content) ? 'Master' : 'Media'}\nLines: ${content.split('\n').length}`);
    // Update body with the manifest text
    updateBodyContent(content);

    // Ensure the 'body' tab is active for viewing manifest content
    document.querySelector('.metadata_tab-buttonUpdate[data-tab="body"]')?.click();
}


function fetchSegmentDetails(segment) {
    updateHeaderContent(`Fetching details for ${getSegmentDisplayName(segment.url)}...`);
    updateBodyContent('Loading content...');

    fetch(segment.url)
        .then(res => {
            // Display Headers
            const headers = [];
            headers.push(`Status: ${res.status} ${res.statusText}`);
            headers.push(`URL: ${res.url}`); // Show final URL after potential redirects
            res.headers.forEach((v, k) => headers.push(`${k}: ${v}`));
            //  updateHeaderContent(`Response Headers:\n${'-'.repeat(20)}\n${headers.join('\n')}`);
            updateHeaderContent(`${headers.join('\n')}`);

            if (!res.ok) {
                throw new Error(`HTTP error ${res.status} ${res.statusText}`);
            }

            // Switch back to header tab by default after fetch
            document.querySelector('.metadata_tab-buttonUpdate[data-tab="headers"]')?.click();

            return res.arrayBuffer(); // Get content as ArrayBuffer for hex dump
        })
        .then(buffer => {
            displaySegmentContent(buffer, segment);
        })
        .catch(err => {
            console.error('[manifest_ui] Segment fetch error:', err);
            updateHeaderContent(`Error fetching segment: ${err.message}\nURL: ${segment.url}`);
            updateBodyContent('Failed to load segment content.');
            // Dispatch or handle expiration visually
            handleSegmentExpired({ detail: { id: segment.id, url: segment.url } });
        });
}

function displaySegmentContent(buffer, segment) {
    // Body content will be the hex dump
    updateBodyContent(formatHexDump(buffer)); // formatHexDump needs to be defined/available

    // Optionally, add more info to the header panel *after* the HTTP headers
    const headerEl = uiElements.headerContent;
    if (headerEl) {
        const segmentInfo = [
            ``, // Spacer
            `Segment Info:`,
            `${'-'.repeat(20)}`,
            `ID: ${segment.id}`,
            `Sequence: ${segment.sequence ?? 'N/A'}`,
            `Duration: ${segment.duration?.toFixed(3) ?? 'N/A'}s`,
            `Size: ${buffer.byteLength} bytes`,
            `Est. Bitrate: ${segment.duration > 0 ? Math.round(buffer.byteLength * 8 / segment.duration / 1000) : 'N/A'} kbps`,
            `Type: ${getMimeTypeFromUrl(segment.url)}`, // getMimeTypeFromUrl needs to be defined/available
            segment.programDateTime ? `PDT: ${segment.programDateTime.toISOString()}` : 'PDT: N/A',
            segment.discontinuity ? `Discontinuity: Yes` : '',
            segment.encryption ? `Encryption: ${segment.encryption.method}` : '',
            segment.byteRange ? `Byte Range: ${segment.byteRange.length}@${segment.byteRange.offset ?? 0}` : '',
        ].filter(Boolean).join('\n'); // Filter out empty lines

        headerEl.textContent += segmentInfo; // Append segment info to existing headers
    }

    // Ensure header tab is active initially when displaying segment details
    document.querySelector('.metadata_tab-buttonUpdate[data-tab="headers"]')?.click();
}


function updateHeaderContent(content) {
    if (uiElements.headerContent) {
        uiElements.headerContent.textContent = content;
    }
}

function updateBodyContent(content) {
    if (uiElements.bodyContent) {
        uiElements.bodyContent.textContent = content;
    }
}

// function updateStatus(msg) {
//     if (uiElements.statusBar) {
//         uiElements.statusBar.textContent = msg;
//         // Optional: Add timestamp?
//         // uiElements.statusBar.textContent = `[${new Date().toLocaleTimeString()}] ${msg}`;
//     }
// }

function handleSegmentExpired(event) {
    const { id, url } = event.detail;
    // console.log(`[manifest_ui] Handling expiration/failure for ID: ${id}, URL: ${url}`);
    const element = id ? segmentElements.get(id) : document.querySelector(`div[data-segment-url="${url}"]`);

    if (element && !element.classList.contains('segment-expired')) {
        element.classList.add('segment-expired');
        element.style.opacity = '0.6'; // Dim expired segments
        element.style.cursor = 'not-allowed';

        // Optionally add a visual badge if segment-tags.js isn't handling it
        if (!element.querySelector('.segment-expired-badge')) { // Check if badge exists
            const badge = document.createElement('span');
            badge.className = 'segment-expired-badge'; // Use a specific class
            badge.textContent = ' FAILED'; // Or 'EXPIRED'
            badge.style.color = 'red';
            badge.style.fontWeight = 'bold';
            element.appendChild(badge);
        }

        // If this segment was selected, update the panels to show it failed
        if (element.classList.contains('selected')) {
            updateHeaderContent(`Segment Failed / Expired\nURL: ${url}`);
            updateBodyContent('Could not retrieve segment content. It may have expired or the request failed.');
        }
    }
}


// ---- Utility functions specific to UI ----

// Helper to get display name (can be shared or duplicated)
function getSegmentDisplayName(url) {
    if (!url) return 'Unknown Segment';
    try {
        // Prioritize filename from pathname
        const pathSegments = new URL(url).pathname.split('/');
        const potentialFilename = pathSegments[pathSegments.length - 1];
        if (potentialFilename) return potentialFilename;

        // Fallback for URLs without clear path filenames (e.g., blob URLs?)
        if (url.startsWith('blob:')) return 'Blob Segment'; // Handle blob URLs specifically
        return url.substring(url.lastIndexOf('/') + 1) || 'Segment'; // Basic fallback

    } catch {
        // Handle cases where URL parsing fails or it's not a standard URL
        if (url.startsWith('blob:')) return 'Blob Segment';
        const simpleName = url.substring(url.lastIndexOf('/') + 1);
        return simpleName.length > 0 ? simpleName.split('?')[0] : 'Segment Data'; // Remove query params for display
    }
}


// Helper for time formatting (can be shared or duplicated)
function formatSegmentTime(seq, duration) {
    if (seq === undefined || duration === undefined) return '?:??.?'; // Handle missing data
    const totalSeconds = seq * duration;
    const ms = Math.floor((totalSeconds % 1) * 1000);
    const s = Math.floor(totalSeconds % 60);
    const m = Math.floor((totalSeconds / 60) % 60);
    const h = Math.floor(totalSeconds / 3600);

    return [
        h > 0 ? String(h).padStart(2, '0') : null,
        String(m).padStart(2, '0'),
        String(s).padStart(2, '0')
    ]
        .filter(Boolean) // Remove null hours if 0
        .join(':') + `.${String(ms).padStart(3, '0')}`;
}

// Helper for hex dump (can be shared or duplicated)
function formatHexDump(buffer, bytesPerLine = 16) {
    if (!(buffer instanceof ArrayBuffer)) return "Invalid data: Not an ArrayBuffer";
    const bytes = new Uint8Array(buffer);
    const lines = [];
    const hexChars = '0123456789abcdef'; // Use lowercase hex

    for (let i = 0; i < bytes.length; i += bytesPerLine) {
        const address = i.toString(16).padStart(8, '0');
        let hexString = '';
        let asciiString = '';

        for (let j = 0; j < bytesPerLine; j++) {
            if (i + j < bytes.length) {
                const byte = bytes[i + j];
                // Lookup hex characters directly
                hexString += hexChars[byte >> 4] + hexChars[byte & 0x0F] + ' ';
                // Use dot for non-printable ASCII (0-31 and 127+)
                asciiString += (byte >= 32 && byte < 127) ? String.fromCharCode(byte) : '.';
            } else {
                // Pad line if buffer length is not multiple of bytesPerLine
                hexString += '   '; // 3 spaces for padding (2 hex + 1 space)
                asciiString += ' '; // Pad ASCII representation
            }
            // Add extra space after 8 bytes for readability
            if (j === (bytesPerLine / 2) - 1) {
                hexString += ' ';
            }
        }

        lines.push(`${address}  ${hexString} |${asciiString}|`);
    }

    return lines.join('\n') || "Buffer is empty.";
}

// Helper function (needed if not in shared utils)
function getMimeTypeFromUrl(url = '') {
    const extMatch = url.match(/\.([a-z0-9]+)(?:[?#]|$)/i); // Extract extension safely
    const ext = extMatch ? extMatch[1].toLowerCase() : '';
    return {
        ts: 'video/MP2T',
        aac: 'audio/aac',
        mp4: 'video/mp4', // Covers fmp4 too
        m4s: 'video/iso.segment', // More specific for DASH/CMAF CENC
        m4a: 'audio/mp4',
        m4v: 'video/mp4',
        mp3: 'audio/mpeg',
        webm: 'video/webm',
        vtt: 'text/vtt',
        srt: 'text/srt',
        m3u8: 'application/vnd.apple.mpegurl',
        mpd: 'application/dash+xml',
    }[ext] || 'application/octet-stream'; // Default
}

// Helper function (needed if not in shared utils)
function getTitleFromManifest(content, baseUrl) {
    try {
        const titleMatch = content.match(/#EXT-X-SESSION-DATA:.*?NAME="title".*?,.*?VALUE="([^"]+)"/i);
        if (titleMatch && titleMatch[1]) {
            return `HLS Player - ${titleMatch[1]}`;
        }
        // Fallback to filename
        const url = new URL(baseUrl);
        const filename = url.pathname.split('/').pop();
        return filename ? `HLS Player - ${filename}` : 'HLS Player';
    } catch {
        return 'HLS Player'; // Generic fallback
    }
}

// Make utility functions available if needed by segment-tags.js directly
window.buildBadge = typeof buildBadge === 'function' ? buildBadge : () => null; // Pass through if exists
window.classifySegment = typeof classifySegment === 'function' ? classifySegment : () => 'Segment'; // Pass through if exists


// Extracts the full raw src from the query without decoding
function getRawSrcUrl() {
    // Search for 'src=' followed by any characters until '&' or end of string
    const match = window.location.search.match(/[?&]src=([^&]+)/);
    if (match && match[1]) {
        try {
            // Try decoding. If it fails or doesn't change, use the raw value.
            const decoded = decodeURIComponent(match[1]);
            // console.log('[manifest_ui] Raw "src" param:', match[1]);
            // console.log('[manifest_ui] Decoded "src" param:', decoded);
            // Heuristic: If decoding significantly changed it AND it looks like a URL, use decoded.
            if (decoded !== match[1] && (decoded.startsWith('http') || decoded.startsWith('blob'))) {
                // It seems like it was genuinely encoded, use the decoded version
                return decoded;
            }
            return match[1];

        } catch (e) {
            console.warn('[manifest_ui] Error decoding src param, using raw value:', e);
            return match[1]; // Use raw value if decoding fails
        }

    }
    // console.log('[manifest_ui] "src" parameter not found in query string.');
    return null;
}

console.log('[manifest_ui] Ready.');


const style = document.createElement('style');
style.textContent = `
 .segment-item.segment-expired { opacity: 0.6; cursor: not-allowed; }
 .segment-item.segment-loading { font-style: italic; color: #aaa; }
 .segment-item.segment-error { color: red; font-weight: bold; }
 .segment-expired-badge { color: #e74c3c; font-weight: bold; margin-left: 5px; font-size: 0.9em; }
 .segment-timestamp { color: #888; margin-right: 5px; display: inline-block; width: 80px; text-align: right; font-size: 0.9em; }
 .segment-badge { margin-right: 5px; } /* Ensure space around badges */
 .segment-label-text { /* Style for the main text part */ }
 #metadataList .segment-item { padding: 3px 5px; border-bottom: 1px solid #333; cursor: pointer; display: flex; align-items: center; white-space: nowrap; }
 /* HOVER AND SELECTED RULES REMOVED - They will be taken from player.css */
`;

document.head.appendChild(style);

console.log('[manifest_ui] Player log function exposed.');
