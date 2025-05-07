// js/ui/scte_manager.js
// Description: Originally developed for detecting SCTE-35 signal detection, it now can identify and manage identification of ad creatives.

console.log('[scte_manager] Initializing...');

(function () {
    // --- State Variables ---
    const state = {
        scteDetections: [],        // Array to store detected SCTE-35 signals/creatives
        maxDetections: 50,         // Maximum number of detections to keep in history
        active: false,             // Tracks if SCTE detection is active
        cumulativeAdTime: 0,       // Total ad time in seconds
        knownProviders: {          // Known ad providers to identify in URLs
            'yospace': 'Yospace',
            'freewheel': 'FreeWheel',
            'google': 'Google Ad Manager',
            'spotx': 'SpotX',
            'tremorhub': 'Tremor Video',
            'adease': 'Adease'
        },
        lastScteDetection: null // ---> ADD: Store the last detection for global access
    };

    // --- DOM Elements ---
    let scteContainer = null;
    let scteStatusElement = null;
    let scteListElement = null;
    let adTimeElement = null;

    document.addEventListener('DOMContentLoaded', init);

    function init() {
        console.log('[scte_manager] DOM loaded, setting up SCTE detection');

        // Find or create container elements
        scteContainer = document.getElementById('scteContainer');
        scteStatusElement = document.getElementById('scteStatus'); // Note: This element doesn't exist in player.html?
        scteListElement = document.getElementById('scteList');
        adTimeElement = document.getElementById('adTimeTracker'); // Note: This element doesn't exist in player.html?

        // The current createScteUI function only creates scte-section, scteContainer, and scteList.
        // Let's ensure we have elements for status and ad time, maybe add them to createScteUI or assume they exist elsewhere.
        // Based on player.html, only scteContainer and scteList are created by this module's createScteUI.
        // The status and ad time elements must be assumed to exist in other UI components.
        // Let's keep the references but acknowledge they might be null if not created externally.

        if (!scteContainer || !scteListElement) {
            createScteUI();
            // After creating, re-fetch references
            scteContainer = document.getElementById('scteContainer');
            scteListElement = document.getElementById('scteList');
        }
        // Try to find status/ad time elements just in case they are added elsewhere
        scteStatusElement = document.getElementById('scteStatus');
        adTimeElement = document.getElementById('adTimeTracker');

        // Set up event listeners
        setupEventListeners();

        // Initialize state display
        updateScteStatusDisplay(); // This will do nothing if scteStatusElement is null
        updateAdTimeDisplay();     // This will do nothing if adTimeElement is null

        console.log('[scte_manager] Initialization complete');
    }

    function createScteUI() {
        // Find the parent element where we'll insert our UI
        const parentElement = document.querySelector('#inspect-tab');
        if (!parentElement) {
            console.error('[scte_manager] Parent element for SCTE UI not found');
            return;
        }

        // Check if the section already exists to avoid duplicates on re-init (though resetState should handle init correctly)
        if (parentElement.querySelector('.scte-section')) {
            console.log('[scte_manager] SCTE UI section already exists.');
            return;
        }

        // Create SCTE section container
        const sectionElement = document.createElement('div');
        sectionElement.className = 'scte-section';
        sectionElement.innerHTML = `
            <div class="scte-label">SCTE Monitor:</div> <!-- Updated label -->
            <div id="scteContainer" class="scte-container">
                <div id="scteList" class="scte-list"></div>
            </div>
             <!-- Optional: Add status and ad time elements if they are *only* managed here -->
             <!-- Based on player.html, they are not explicitly in this section -->
             <!-- Keeping the references null if not found in the DOM -->
        `;


        // Insert after the cache TTL section
        const cacheTtlSection = document.querySelector('.cache-ttl-section');
        if (cacheTtlSection && cacheTtlSection.nextElementSibling) {
            parentElement.insertBefore(sectionElement, cacheTtlSection.nextElementSibling);
        } else {
            parentElement.appendChild(sectionElement);
        }

        // Update our references
        scteContainer = document.getElementById('scteContainer');
        scteStatusElement = document.getElementById('scteStatus');
        scteListElement = document.getElementById('scteList');
        adTimeElement = document.getElementById('adTimeTracker');

        console.log('[scte_manager] SCTE UI section created.');
        // References scteContainer, scteListElement are updated in init after createScteUI call
    }

    function setupEventListeners() {
        // Listen for segment additions to check for SCTE signals
        document.addEventListener('hlsSegmentAdded', handleSegmentAdded);
        document.addEventListener('hlsFragLoadedUI', handleSegmentAdded);

        // Listen for new stream loading to reset state
        document.addEventListener('newStreamLoading', resetState);
    }

    function resetState() {
        console.log('[scte_manager] Resetting SCTE detection state');
        state.scteDetections = [];
        state.active = false;
        state.cumulativeAdTime = 0;
        state.lastScteDetection = null; // ---> Reset last detection
        updateScteStatusDisplay();
        updateAdTimeDisplay();
        updateScteList();
    }

    function handleSegmentAdded(event) {
        const segment = event.detail.segment || event.detail; // Get the segment/fragment detail object
        if (!segment || !segment.url) {
            console.warn('[scte_manager] handleSegmentAdded received event without segment or url:', event.detail);
            return;
        }

        // ---> Process *every* segment to check for SCTE data (either tag or URL) <---
        processSegmentForScte(segment);
        // ---> END Process <---
    }

    // ---> RENAME AND REFINE: Analyze segment for SCTE data (tag or URL) <---
    function processSegmentForScte(segment) {
        // Activate SCTE detection if not already active, whenever *any* segment is processed
        if (!state.active) {
            state.active = true;
            updateScteStatusDisplay();
        }

        const detection = {
            timestamp: new Date(),
            // Store a lightweight copy of segment info, or relevant parts
            // Storing the full segment object might be okay, but let's be mindful of memory for many detections.
            // For now, store essential segment details:
            segmentInfo: {
                url: segment.url,
                sequence: segment.sequence,
                duration: segment.duration,
                playlistId: segment.playlistId,
                // Include scteTagData from the segment if present
                scteTagData: segment.scteTagData ? { ...segment.scteTagData } : null // Copy to avoid modifying original
            },
            url: segment.url, // Store full URL at top level too

            // Placeholder for extracted info (from URL or Tag)
            info: {},

            // Type will be determined after analysis
            type: 'unknown',
            provider: detectProvider(segment.url) // Provider is currently only URL-based
        };

        let durationFromScte = null; // Duration from SCTE tag
        let durationFromUrl = null;   // Duration from URL params
        let idFromScte = null;        // ID from SCTE tag
        let idFromUrl = null;         // ID from URL params
        let typeFromScteTag = null;   // Determined type from SCTE tag (e.g., 'ad_start')

        // --- Check for SCTE-35 Tag Data first (now raw encoded data) ---
        if (segment.scteTagData && segment.scteTagData.encoded) { // Check for .encoded data from hls_parser
            let parsedScte = null; // Variable to hold the result of parsing

            // Perform parsing now, based on encodingType
            try {
                if (segment.scteTagData.encodingType === 'base64') {
                    parsedScte = window.SCTE35Parser.parseFromB64(segment.scteTagData.encoded);
                } else if (segment.scteTagData.encodingType === 'hex') {
                    // Convert hex string to Uint8Array first
                    const hexString = segment.scteTagData.encoded;
                    const bytes = new Uint8Array(hexString.length / 2);
                    for (let i = 0; i < hexString.length; i += 2) {
                        bytes[i / 2] = parseInt(hexString.substr(i, 2), 16);
                    }
                    parsedScte = window.SCTE35Parser.parseFromBytes(bytes);
                    // parseFromBytes doesn't add .encoded, so add it back if parsed successfully
                    if (parsedScte && !parsedScte.error) {
                        parsedScte.encoded = segment.scteTagData.encoded; // Keep original encoded string
                    }
                } else {
                    console.warn('[scte_manager] Unknown SCTE encoding type:', segment.scteTagData.encodingType);
                    parsedScte = { error: 'Unknown encoding type: ' + segment.scteTagData.encodingType, encoded: segment.scteTagData.encoded };
                }
            } catch (e) {
                console.error('[scte_manager] Error during deferred SCTE parsing:', e);
                parsedScte = { error: 'Exception during deferred parsing: ' + e.message, encoded: segment.scteTagData.encoded };
            }

            // Now, check if parsing was successful and proceed with extraction
            if (parsedScte && !parsedScte.error) {
                detection.info.scteTagDetails = {
                    encoded: parsedScte.encoded, // Use encoded string from parsedScte (parseFromB64 adds it) or original
                    parsed: parsedScte,          // This is the full parsed object from SCTE35Parser
                    summary: window.SCTE35Parser?.getHumanReadableDescription(parsedScte) || 'Summary Error',
                    encodingType: segment.scteTagData.encodingType, // From original scteTagData
                    line: segment.scteTagData.line                  // From original scteTagData
                };

                // Extract common fields from the newly parsed SCTE-35 data
                if (parsedScte.spliceCommandType === 0x05 && parsedScte.spliceCommandInfo) { // Splice Insert
                    const cmdInfo = parsedScte.spliceCommandInfo; // Renamed to avoid conflict with outer 'info'
                    idFromScte = cmdInfo.spliceEventId?.toString();
                    if (cmdInfo.durationFlag && cmdInfo.breakDuration?.duration !== null && cmdInfo.breakDuration?.duration !== undefined) {
                        durationFromScte = cmdInfo.breakDuration.duration / 90000;
                    }
                    typeFromScteTag = cmdInfo.outOfNetworkIndicator ? 'ad_start' : 'ad_end';

                } else if (parsedScte.spliceCommandType === 0x07 && parsedScte.descriptors && parsedScte.descriptors.length > 0) { // Time Signal
                    const segDescEntry = parsedScte.descriptors.find(d => d.tag === 0x02);
                    const segDesc = segDescEntry?.info;
                    if (segDesc && !segDesc.error) {
                        idFromScte = segDesc.eventId?.toString();
                        if (segDesc.segmentationDurationFlag && segDesc.segmentationDuration !== null && segDesc.segmentationDuration !== undefined && typeof segDesc.segmentationDuration !== 'object') { // Ensure it's the number, not error object
                            durationFromScte = segDesc.segmentationDuration / 90000;
                        }
                        if (segDesc.isAdStart) typeFromScteTag = 'ad_start';
                        else if (segDesc.isAdEnd) typeFromScteTag = 'ad_end';
                        else typeFromScteTag = 'scte_signal';
                        detection.info.segmentationTypeId = segDesc.typeId;
                        detection.info.segmentationTypeIdName = segDesc.typeIdName;
                        if (segDesc.upid) detection.info.upid = segDesc.upid;
                        if (segDesc.segmentNum !== undefined) detection.info.segmentNum = segDesc.segmentNum;
                        if (segDesc.segmentsExpected !== undefined) detection.info.segmentsExpected = segDesc.segmentsExpected;
                    }
                } else {
                    // Other command types or no relevant info for duration/id/type
                    typeFromScteTag = 'scte_signal';
                    // Potentially extract spliceEventId if it's a common field in other commands
                    if (parsedScte.spliceCommandInfo && parsedScte.spliceCommandInfo.spliceEventId) {
                        idFromScte = parsedScte.spliceCommandInfo.spliceEventId?.toString();
                    }
                }
            } else {
                // Handle cases where deferred parsing failed
                console.warn('[scte_manager] Deferred SCTE parsing failed for segment:', segment.url, parsedScte?.error);
                detection.info.scteTagDetails = {
                    encoded: segment.scteTagData.encoded,
                    parsed: null, // No successfully parsed object
                    summary: `SCTE Parsing Error: ${parsedScte?.error || 'Unknown error'}`,
                    encodingType: segment.scteTagData.encodingType,
                    line: segment.scteTagData.line,
                    error: parsedScte?.error || 'Deferred parsing failed'
                };
                // No SCTE specific duration, id, or type can be reliably extracted
            }
        }
        // --- Check for URL-based SCTE/Creative detection (Legacy) ---
        // Only do URL analysis if it contains /creatives/ OR if no SCTE tag data was found
        // This prevents redundant extraction if tag data is the primary source.
        if (!detection.info.scteTagDetails || segment.url.includes('/creatives/')) {
            const urlInfo = extractScteInfo(segment.url); // Use existing URL analysis
            detection.info.urlDetails = urlInfo; // Store URL details separately

            // Extract duration and ID from URL if available
            if (urlInfo.duration) durationFromUrl = urlInfo.duration;
            if (urlInfo.id) idFromUrl = urlInfo.id;

            // Determine type from URL pattern (only if no SCTE tag type determined)
            if (!typeFromScteTag) {
                detection.type = determineScteType(urlInfo, segment.url); // Use existing type determination
            }
        }
        // --- Combine and Finalize Detection Info ---
        // Prioritize SCTE tag data for duration and ID if available
        detection.duration = durationFromScte !== null ? durationFromScte : (durationFromUrl !== null ? durationFromUrl : null);
        detection.id = idFromScte !== null ? idFromScte : (idFromUrl !== null ? idFromUrl : null);

        // Final type determination (prioritize SCTE tag type if found)
        if (typeFromScteTag) {
            detection.type = typeFromScteTag;
        } else {
            // Fallback to URL-based type if no tag type
            detection.type = determineScteType(detection.info.urlDetails, segment.url);
        }
        // Update cumulative ad time if duration is available AND it looks like an ad start
        // Be careful not to double-count if both URL and tag signal the same thing.
        // Let's only add duration if it's explicitly an ad start type from the tag,
        // OR if it's a URL match AND it has a duration.
        const isAdStart = (detection.type === 'ad_start' || detection.info?.segmentationTypeIdName?.includes('Start')) && detection.duration > 0;
        // Also consider URL patterns that imply start if no tag
        const isUrlAdStart = detection.type !== 'scte_signal' && detection.info?.urlDetails && detection.url.includes('ad_start') && detection.duration > 0;


        if ((detection.info?.scteTagDetails && isAdStart) || (!detection.info?.scteTagDetails && isUrlAdStart)) {
            // Avoid adding duration if it's already counted or zero/invalid
            // Simple check: only add if the cumulative time hasn't *just* increased for the previous segment (basic deduplication attempt)
            const lastDetection = state.scteDetections[0];
            const lastAddedTime = lastDetection?.cumulativeAdTimeAfter || 0;
            if (state.cumulativeAdTime === lastAddedTime) { // Check if time hasn't advanced since last detection was added
                // Need a more robust way to avoid double counting if a single ad has multiple segments
                // Or if both a tag AND a URL pattern exist for the same segment.
                // For now, let's just add the duration if it's an ad_start or similar type and has a duration.
                // This *might* overcount for multi-segment ads. A better approach would track active ad breaks.
                // Sticking to the simple duration sum for now as per original code logic.
                if (detection.duration > 0) {
                    state.cumulativeAdTime += detection.duration;
                    updateAdTimeDisplay();
                }
            } else {
                // Time has advanced, maybe a new ad?
                if (detection.duration > 0) {
                    state.cumulativeAdTime += detection.duration;
                    updateAdTimeDisplay();
                }
            }
        }
        // Store the cumulative ad time *after* this detection for reference
        detection.cumulativeAdTimeAfter = state.cumulativeAdTime;


        // Add to our detections array (at the beginning for newest first)
        state.scteDetections.unshift(detection);

        // Limit size of history
        if (state.scteDetections.length > state.maxDetections) {
            state.scteDetections.pop();
        }

        // ---> Store the last detection object globally <---
        state.lastScteDetection = detection;
        // ---> END Store <---

        // Update UI
        updateScteStatusDisplay();
        updateScteList();

        // Dispatch event for other components
        document.dispatchEvent(new CustomEvent('scteSignalDetected', {
            detail: { detection }
        }));
    }

    function extractScteInfo(url) {
        const info = {
            creative: 'Unknown',
            duration: null,
            id: null,
            params: {} // Store all URL parameters
        };

        try {
            // Try to extract creative ID/name from URL
            const creativesMatch = url.match(/\/creatives\/([^\/]+)/);
            if (creativesMatch && creativesMatch[1]) {
                info.creative = creativesMatch[1];
            }

            // Try to extract duration if present
            const durationMatch = url.match(/duration=(\d+(\.\d+)?)/);
            if (durationMatch && durationMatch[1]) {
                info.duration = parseFloat(durationMatch[1]);
            }

            // Try to extract any numeric ID if present
            const idMatch = url.match(/id=(\d+)/);
            if (idMatch && idMatch[1]) {
                info.id = idMatch[1];
            }

            // Parse all URL parameters
            try {
                const urlObj = new URL(url);
                for (const [key, value] of urlObj.searchParams.entries()) {
                    info.params[key] = value;

                    // Check for additional duration in parameters with different names
                    if (!info.duration && (key.includes('dur') || key.includes('length')) && !isNaN(parseFloat(value))) {
                        info.duration = parseFloat(value);
                    }

                    // Look for ad ID in various parameter names
                    if (!info.id && (key.includes('ad') && key.includes('id')) && value) {
                        info.id = value;
                    }
                }
            } catch (e) {
                console.warn('[scte_manager] Error parsing URL parameters:', e);
            }

            // Extract path components
            info.pathComponents = url.split('/').filter(Boolean);

            // Try to extract SCTE-specific identifiers
            if (url.includes('scte35')) {
                const scte35Match = url.match(/scte35[=\/]([^&\/]+)/i);
                if (scte35Match && scte35Match[1]) {
                    info.scte35Data = scte35Match[1];
                }
            }

            // Look for any timestamp or time-related parameters
            const timeMatch = url.match(/[?&](time|timestamp|pts|start|end)=([^&]+)/i);
            if (timeMatch && timeMatch[2]) {
                info.timeMarker = timeMatch[2];
            }
        } catch (e) {
            console.error('[scte_manager] Error parsing SCTE URL:', e);
        }

        return info;
    }

    function detectProvider(url) {
        // Default value
        let provider = {
            name: "Unknown",
            confidence: "low"
        };

        try {
            const urlObj = new URL(url);
            const hostname = urlObj.hostname.toLowerCase();
            const path = urlObj.pathname.toLowerCase();
            const fullUrl = url.toLowerCase();

            // Check for each known provider in the hostname or path
            for (const [key, name] of Object.entries(state.knownProviders)) {
                if (hostname.includes(key) || path.includes(key)) {
                    provider.name = name;
                    provider.confidence = "high";
                    return provider;
                }
            }

            // Secondary checks for other common patterns
            if (fullUrl.includes('yospace')) {
                provider.name = 'Yospace';
                provider.confidence = "high";
            } else if (fullUrl.includes('freewheel')) {
                provider.name = 'FreeWheel';
                provider.confidence = "high";
            } else if (hostname.includes('foxsports') || hostname.includes('fox.com') || hostname.includes('tubi.video')) {
                provider.name = 'Fox (Detected Hostname)';
                provider.confidence = "medium";
            } else if (path.includes('/ads/') || path.includes('/ad/')) {
                provider.name = 'Generic Ad Server';
                provider.confidence = "medium";
            }
        } catch (e) {
            console.warn('[scte_manager] Error detecting provider:', e);
        }

        return provider;
    }

    function determineScteType(scteInfo, url) {
        // Try to determine if this is an ad start, end, or other type of SCTE signal
        if (url.includes('ad_start') || url.includes('cue_in') || url.includes('splice_in')) {
            return 'ad_start';
        } else if (url.includes('ad_end') || url.includes('cue_out') || url.includes('splice_out')) {
            return 'ad_end';
        } else {
            // Default to generic ad marker
            return 'ad_marker';
        }
    }

    function updateScteStatusDisplay() {
        if (!scteStatusElement) return;

        if (state.active) {
            if (state.scteDetections.length > 0) {
                scteStatusElement.textContent = `SCTE-35 signals detected: ${state.scteDetections.length}`;
                scteStatusElement.className = 'scte-status scte-active';
            } else {
                scteStatusElement.textContent = 'Monitoring SCTE-35 signals';
                scteStatusElement.className = 'scte-status';
            }
        } else {
            scteStatusElement.textContent = 'Monitoring SCTE-35 signals';
            scteStatusElement.className = 'scte-status';
        }
    }

    function updateAdTimeDisplay() {
        if (!adTimeElement) return;

        // Format the time nicely
        const formattedTime = formatTime(state.cumulativeAdTime);
        adTimeElement.textContent = `Total Ad Time: ${formattedTime}`;

        // Highlight if there's significant ad time
        if (state.cumulativeAdTime > 0) {
            adTimeElement.classList.add('active');
        } else {
            adTimeElement.classList.remove('active');
        }
    }

    function formatTime(seconds) {
        if (seconds === 0) return '0s';

        if (seconds < 60) {
            return `${seconds.toFixed(1)}s`;
        } else {
            const minutes = Math.floor(seconds / 60);
            const remainingSeconds = (seconds % 60).toFixed(1);
            return `${minutes}m ${remainingSeconds}s`;
        }
    }

    function updateScteList() {
        if (!scteListElement) return;

        // Clear current list
        scteListElement.innerHTML = '';

        // If no detections yet, show a message
        if (state.scteDetections.length === 0) {
            scteListElement.innerHTML = '<div class="scte-empty">No creatives detected yet</div>';
            return;
        }

        // Create list items for each detection
        state.scteDetections.forEach((detection, index) => {
            const detectionElement = document.createElement('div');
            detectionElement.className = `scte-detection scte-${detection.type} ${detection.info?.scteTagDetails ? 'scte-source-tag' : 'scte-source-url'} expanded`;

            // Format time from timestamp
            const time = detection.timestamp.toLocaleTimeString([], {
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit'
            });

            // Extract ID or number from creative or id field to display
            // const idNumber = detection.info.id || detection.info.creative || '0';

            // Get a short path for display directly under the number
            // const shortPath = getShortPathForDisplay(detection.url); // We are replacing this with the full URL below

            // Originally: <div class="scte-number">${idNumber}</div>

            // Determine primary identifier and display type label
            const primaryId = detection.id || detection.info?.urlDetails?.creative || 'N/A'; // Prioritize extracted ID
            const displayTypeLabel = formatScteType(detection.type, detection.info); // Use updated format function

            // Create detection content
            let detectionHtml = `
                <div class="scte-detection-header">
                    <span class="scte-detection-type">${displayTypeLabel}</span>
                    <span class="scte-detection-time">${time}</span>
                </div>
                <div class="scte-detection-number">                    
                    <!-- START CHANGE: Display full URL here in small print -->
                    <span class="scte-primary-id">${primaryId}</span>
                    <div class="scte-full-path" style="font-size: 0.8em; word-break: break-all; margin-top: 2px;">${detection.url}</div>
                    <!-- END CHANGE -->
                </div>
                <div class="scte-detection-details">
                    <div class="scte-detail-item">
                        <span class="scte-detail-label">Provider:</span>
                        <span class="scte-detail-value">${detection.provider.name}</span>
                    </div>
                    <div class="scte-detail-item">
                        <span class="scte-detail-label">Path:</span>
                        <span class="scte-detail-value">${detection.url}</span> 
                    </div>
            `; // Note: Path detail already shows full URL, change above adds it under the number as requested.

            // --- Display SCTE Tag Details if available ---
            if (detection.info?.scteTagDetails) {
                const scteTag = detection.info.scteTagDetails;
                detectionHtml += `
                    <div class="scte-detail-item scte-tag-details">
                        <span class="scte-detail-label">SCTE-35 Tag Info:</span>
                        <div class="scte-detail-value">
                           <div class="scte-tag-summary">${scteTag.summary || 'Could not parse tag.'}</div>
                           <div class="scte-tag-encoded">Encoded (${scteTag.encodingType}): <code>${scteTag.encoded || 'N/A'}</code></div>
                           <div class="scte-tag-line">Source line: <code>${scteTag.line || 'N/A'}</code></div>
                           <!-- Optionally show full parsed structure -->
                           <div class="scte-tag-parsed-raw" style="display: none;">Raw Parsed: <pre>${JSON.stringify(scteTag.parsed, null, 2)}</pre></div>
                        </div>
                    </div>
                 `;
            }

            // Add Provider (currently only from URL)
            if (detection.provider && detection.provider.name !== "Unknown") {
                detectionHtml += `
                    <div class="scte-detail-item">
                        <span class="scte-detail-label">Provider:</span>
                        <span class="scte-detail-value">${detection.provider.name} (${detection.provider.confidence})</span>
                    </div>
                `;
            }

            // Add ID if available (prioritized from tag, then URL)
            if (detection.id) {
                detectionHtml += `
                    <div class="scte-detail-item">
                        <span class="scte-detail-label">ID:</span>
                        <span class="scte-detail-value">${detection.id}</span>
                    </div>
                `;
            }
            // Add Segmentation Type ID and Name if from Tag
            if (detection.info?.segmentationTypeIdName) {
                detectionHtml += `
                     <div class="scte-detail-item">
                         <span class="scte-detail-label">Seg Type:</span>
                         <span class="scte-detail-value">${detection.info.segmentationTypeIdName} (0x${detection.info.segmentationTypeId.toString(16)})</span>
                     </div>
                  `;
            }


            // Add duration if available (prioritized from tag, then URL)
            if (detection.duration !== null && detection.duration !== undefined) {
                // Format duration to 3 decimal places if not integer
                const formattedDuration = detection.duration % 1 === 0 ? detection.duration.toFixed(0) : detection.duration.toFixed(3);
                detectionHtml += `
                    <div class="scte-detail-item">
                        <span class="scte-detail-label">Duration:</span>
                        <span class="scte-detail-value">${formattedDuration}s</span>
                    </div>
                `;
            }

            // Add Cumulative Ad Time After This Signal
            if (detection.cumulativeAdTimeAfter !== null && detection.cumulativeAdTimeAfter !== undefined) {
                detectionHtml += `
                     <div class="scte-detail-item">
                         <span class="scte-detail-label">Cum. Ad Time:</span>
                         <span class="scte-detail-value">${formatTime(detection.cumulativeAdTimeAfter)}</span>
                     </div>
                  `;
            }


            // --- Display URL-Specific Details if applicable ---
            // Only show if it's a URL-based detection OR if there are specific URL details not captured by the tag info
            if (detection.info?.urlDetails && (!detection.info?.scteTagDetails || Object.keys(detection.info.urlDetails.params).length > 0 || detection.info.urlDetails.creative !== 'Unknown')) {
                const urlDetails = detection.info.urlDetails;

                // Add creative info if available from URL and not covered by ID
                if (urlDetails.creative && urlDetails.creative !== 'Unknown' && urlDetails.creative !== detection.id) {
                    detectionHtml += `
                          <div class="scte-detail-item">
                              <span class="scte-detail-label">Creative:</span>
                              <span class="scte-detail-value">${urlDetails.creative}</span>
                          </div>
                      `;
                }
                // Add time marker if available from URL
                if (urlDetails.timeMarker) {
                    detectionHtml += `
                          <div class="scte-detail-item">
                              <span class="scte-detail-label">Time Marker:</span>
                              <span class="scte-detail-value">${urlDetails.timeMarker}</span>
                          </div>
                      `;
                }
                // Add raw SCTE35 data found in URL (if any)
                if (urlDetails.rawScte35DataInUrl) {
                    detectionHtml += `
                          <div class="scte-detail-item">
                              <span class="scte-detail-label">SCTE-35 in URL:</span>
                              <span class="scte-detail-value">${urlDetails.rawScte35DataInUrl}</span>
                          </div>
                      `;
                }


                // Add URL parameters
                if (urlDetails.params && Object.keys(urlDetails.params).length > 0) {
                    detectionHtml += `
                          <div class="scte-detail-item">
                              <span class="scte-detail-label">URL Parameters:</span>
                              <div class="scte-detail-params">
                      `;
                    for (const [key, value] of Object.entries(urlDetails.params)) {
                        detectionHtml += `
                              <div class="scte-param">
                                  <span class="scte-param-key">${key}:</span>
                                  <span class="scte-param-value">${value}</span>
                              </div>
                          `;
                    }
                    detectionHtml += `
                              </div>
                          </div>
                      `;
                }
            }

            // Add URL of the segment (already displayed under primary ID, but perhaps repeat here for clarity?)
            // The original code included a "Path" detail item with the full URL. Let's keep that for consistency.
            detectionHtml += `
                  <div class="scte-detail-item">
                      <span class="scte-detail-label">Segment URL:</span>
                      <span class="scte-detail-value scte-url-value">${detection.url}</span>
                  </div>
              `;


            // Close the details container
            detectionHtml += `</div>`;

            detectionElement.innerHTML = detectionHtml;

            // Add click handler to toggle details visibility and raw parsed data visibility
            // detectionElement.addEventListener('click', () => {
            //     detectionElement.classList.toggle('expanded');
            // });

            // Add a click listener specifically for the summary line to toggle raw parsed data
            const summaryElement = detectionElement.querySelector('.scte-tag-summary');
            const rawParsedElement = detectionElement.querySelector('.scte-tag-parsed-raw');
            if (summaryElement && rawParsedElement) {
                summaryElement.style.cursor = 'pointer'; // Indicate it's clickable
                summaryElement.title = 'Click to toggle raw parsed data';
                summaryElement.addEventListener('click', (event) => {
                    event.stopPropagation(); // Prevent the main detection element click
                    rawParsedElement.style.display = rawParsedElement.style.display === 'none' ? 'block' : 'none';
                });
            }


            scteListElement.appendChild(detectionElement);
        });
    }

    // This function is no longer used for the main display under the number, but kept for potential other uses or future refactoring.
    function getShortPathForDisplay(url) {
        try {
            // Try to extract just the most relevant part of the path
            // First attempt to use URL object
            const urlObj = new URL(url);
            const pathParts = urlObj.pathname.split('/').filter(Boolean);

            // Focus on the part with 'creatives' if it exists
            const creativesIndex = pathParts.findIndex(part => part.toLowerCase() === 'creatives');
            if (creativesIndex >= 0 && creativesIndex + 1 < pathParts.length) {
                return `/.../${pathParts[creativesIndex]}/${pathParts[creativesIndex + 1]}`;
            }

            // Otherwise return last two parts of path if they exist
            if (pathParts.length >= 2) {
                return `/.../${pathParts[pathParts.length - 2]}/${pathParts[pathParts.length - 1]}`;
            } else if (pathParts.length === 1) {
                return `/${pathParts[0]}`;
            }

            // If we get here, fall back to just returning the hostname
            return urlObj.hostname;

        } catch (e) {
            // If URL parsing fails, try simple string extraction
            const parts = url.split('/').filter(Boolean);
            if (parts.length > 2) {
                // Try to get the last two non-empty parts
                return `/.../${parts[parts.length - 2]}/${parts[parts.length - 1].split('?')[0]}`;
            }
            return url.split('?')[0]; // Just the path without query params
        }
    }

    // Update formatScteType to be more descriptive, potentially using info object
    function formatScteType(type, info) {
        if (info?.scteTagDetails) {
            // If from tag, use Segmentation Type Name if available, or command type
            if (info.segmentationTypeIdName && type !== 'scte_signal') { // Use specific name for ad starts/ends
                return `${info.segmentationTypeIdName} (Tag)`;
            } else {
                // Fallback to generic command type or classification
                const commandTypeName = info.scteTagDetails.parsed?.spliceCommandTypeName;
                if (commandTypeName) return `Tag: ${commandTypeName}`;
                return 'SCTE Signal (Tag)'; // Generic tag signal
            }
        } else if (info?.urlDetails) {
            // If from URL, use URL-based type
            switch (type) {
                case 'ad_start': return 'Ad Start (URL)';
                case 'ad_end': return 'Ad End (URL)';
                case 'ad_marker': return 'Creatives (URL)';
                default: return 'URL Signal'; // Should not happen if type determination is correct
            }
        } else {
            return 'Unknown Signal'; // Should not happen if info is present
        }
    }

    // Make functions and state available globally via window.SCTEManager
    // ---> UPDATE window.SCTEManager to expose new data <---
    window.SCTEManager = {
        getState: () => ({ ...state }), // Provides access to state including scteDetections (with full info)
        resetState,
        analyzeUrl: (url) => { // Keep for debugging/manual analysis
            console.log('[scte_manager] Manual URL analysis:', extractScteInfo(url));
            return extractScteInfo(url);
        },
        addProvider: (key, name) => { // Keep utility function
            state.knownProviders[key.toLowerCase()] = name;
            console.log('[scte_manager] Added provider:', key, name);
        },
        // Add direct access to the last processed detection and its data
        getLastDetection: () => state.lastScteDetection,
        getLastDecodedScte: () => state.lastScteDetection?.info?.scteTagDetails?.parsed || null,
        getLastEncodedScte: () => state.lastScteDetection?.info?.scteTagDetails?.encoded || null,
        getLastScteDuration: () => state.lastScteDetection?.duration || null,
        getLastScteId: () => state.lastScteDetection?.id || null,
        getLastScteType: () => state.lastScteDetection?.type || null,
        // Add cumulative ad time access
        getCumulativeAdTime: () => state.cumulativeAdTime
        // You could add more getters for specific fields from the last detection as needed
        // For example, getLastSegmentationTypeId: () => state.lastScteDetection?.info?.segmentationTypeId || null
    };
    // ---> END UPDATE <---

})(); // IIFE ends