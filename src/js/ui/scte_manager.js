// js/ui/scte_manager.js
// Description: Originally developed for detecting SCTE-35 signal detection, it now can identify and manage identification of ad creatives.

console.log('[scte_manager] Initializing...');

(function () {
    //TODO New
    // Ensure SCTE35 parser from Comcast is available globally
    if (window.SCTE35 && window.SCTE35.default && window.SCTE35.default.SCTE35) {
        window.SCTE35ParserComcast = new window.SCTE35.default.SCTE35();
        console.log('[scte_manager] SCTE35ParserComcast instance created successfully.');
    }

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
        console.log('[scte_manager] Received segment:', segment);
        if (!segment || !segment.url) {
            console.warn('[scte_manager] handleSegmentAdded received event without segment or url:', event.detail);
            return;
        }

        // ---> Process *every* segment to check for SCTE data (either tag or URL) <---
        processSegmentForScte(segment);
        // ---> END Process <---
    }

    function processSegmentForScte(segment) {
        if (!state.active) {
            state.active = true;
            updateScteStatusDisplay(); // Called once if state changes
        }

        let detectionsMadeInThisCall = []; // Array to collect all detections from this event

        // --- Scenario 1: Process SCTE tags from scteTagDataList if present ---
        if (segment.scteTagDataList && segment.scteTagDataList.length > 0) {
            console.log(`[scte_manager] Processing ${segment.scteTagDataList.length} SCTE tag(s) associated with segment: ${segment.url}`);

            //TODO NEW
            // adding a global array to store the latest SCTE tags in hex format
            window.LatestScteHexTags = window.LatestScteHexTags || [];

            segment.scteTagDataList.forEach((scteTagInfo, tagIndex) => {
                // For each tag, create a distinct detection object
                // It inherits some base info from the segment but has its own SCTE specifics.
                const tagSpecificDetection = {
                    timestamp: new Date(),
                    segmentInfo: { // Info about the HLS segment this tag was associated with
                        url: segment.url,
                        sequence: segment.sequence,
                        duration: segment.duration, // HLS segment duration
                        playlistId: segment.playlistId
                    },
                    url: segment.url, // URL of the HLS segment
                    info: {},         // Will hold scteTagDetails for this specific tag
                    type: 'unknown',
                    provider: detectProvider(segment.url) // URL-based provider, same for all tags on this segment
                };

                let durationFromThisScteTag = null;
                let idFromThisScteTag = null;
                let typeFromThisScteTag = null;

                // Perform deferred parsing for this specific scteTagInfo
                let parsedScte = null;
                if (scteTagInfo && scteTagInfo.encoded) {
                    
                    // TODO NEW
                    console.log(`[debug] Captured SCTE Hex for tag[${tagIndex}]: ${scteTagInfo.encoded}`);

                    // Push into the global array for manual testing
                    window.LatestScteHexTags.push({
                        timestamp: new Date(),
                        segmentUrl: segment.url,
                        hex: scteTagInfo.encoded,
                        line: scteTagInfo.line
                    });

                    try {
                        if (scteTagInfo.encodingType === 'base64') {
                            parsedScte = window.SCTE35Parser.parseFromB64(scteTagInfo.encoded);
                        } else if (scteTagInfo.encodingType === 'hex') {
                            const hexString = scteTagInfo.encoded;
                            const bytes = new Uint8Array(hexString.length / 2);
                            for (let i = 0; i < hexString.length; i += 2) {
                                bytes[i / 2] = parseInt(hexString.substr(i, 2), 16);
                            }
                            parsedScte = window.SCTE35Parser.parseFromBytes(bytes);
                            if (parsedScte && !parsedScte.error) {
                                parsedScte.encoded = scteTagInfo.encoded;
                            }
                        } else {
                            parsedScte = { error: `Unknown SCTE encoding type: ${scteTagInfo.encodingType}`, encoded: scteTagInfo.encoded };
                        }
                    } catch (e) {
                        parsedScte = { error: `Exception during SCTE parsing for tag: ${e.message}`, encoded: scteTagInfo.encoded };
                    }
                } else {
                    parsedScte = { error: 'Missing encoded SCTE data in scteTagInfo for tag' };
                }

                // Process the parsed SCTE data for this tag
                if (parsedScte && !parsedScte.error) {
                    tagSpecificDetection.info.scteTagDetails = {
                        encoded: parsedScte.encoded,
                        parsed: parsedScte,
                        summary: window.SCTE35Parser?.getHumanReadableDescription(parsedScte) || 'Summary Error',
                        encodingType: scteTagInfo.encodingType,
                        line: scteTagInfo.line
                    };

                    if (parsedScte.spliceCommandType === 0x05 && parsedScte.spliceCommandInfo) { // Splice Insert
                        const cmdInfo = parsedScte.spliceCommandInfo;
                        idFromThisScteTag = cmdInfo.spliceEventId?.toString();
                        if (cmdInfo.durationFlag && cmdInfo.breakDuration?.duration !== null && cmdInfo.breakDuration?.duration !== undefined) {
                            durationFromThisScteTag = cmdInfo.breakDuration.duration / 90000;
                        }
                        typeFromThisScteTag = cmdInfo.outOfNetworkIndicator ? 'ad_start' : 'ad_end';
                    } else if (parsedScte.spliceCommandType === 0x07 && parsedScte.descriptors && parsedScte.descriptors.length > 0) { // Time Signal
                        const segDescEntry = parsedScte.descriptors.find(d => d.tag === 0x02);
                        const segDesc = segDescEntry?.info;
                        if (segDesc && !segDesc.error) {
                            idFromThisScteTag = segDesc.eventId?.toString();
                            if (segDesc.segmentationDurationFlag && segDesc.segmentationDuration !== null &&
                                segDesc.segmentationDuration !== undefined && typeof segDesc.segmentationDuration !== 'object') {
                                durationFromThisScteTag = segDesc.segmentationDuration / 90000;
                            }
                            if (segDesc.isAdStart) typeFromThisScteTag = 'ad_start';
                            else if (segDesc.isAdEnd) typeFromThisScteTag = 'ad_end';
                            else typeFromThisScteTag = 'scte_signal';

                            tagSpecificDetection.info.segmentationTypeId = segDesc.typeId;
                            tagSpecificDetection.info.segmentationTypeIdName = segDesc.typeIdName;
                            if (segDesc.upid) tagSpecificDetection.info.upid = segDesc.upid; // array of bytes
                            if (segDesc.segmentNum !== undefined) tagSpecificDetection.info.segmentNum = segDesc.segmentNum;
                            if (segDesc.segmentsExpected !== undefined) tagSpecificDetection.info.segmentsExpected = segDesc.segmentsExpected;

                            // YOUR RETAINED DEBUGGING LOGS (applied to this specific tag's detection)
                            const upidString = segDesc.upid ? segDesc.upid.map(b => b.toString(16).padStart(2, '0')).join('').toUpperCase() : 'N/A';
                            console.log(`[scte_manager] Tag[${tagIndex}] UPID:`, upidString);
                            console.log(`[scte_manager] Tag[${tagIndex}] Segmentation Type ID (typeId):`, segDesc.typeId, "-", segDesc.typeIdName);
                            console.log(`[scte_manager] Tag[${tagIndex}] Path:`, `${tagSpecificDetection.segmentInfo.playlistId} > ${tagSpecificDetection.url}`);
                        }
                    } else {
                        typeFromThisScteTag = 'scte_signal';
                        if (parsedScte.spliceCommandInfo && parsedScte.spliceCommandInfo.spliceEventId) {
                            idFromThisScteTag = parsedScte.spliceCommandInfo.spliceEventId?.toString();
                        }
                    }
                    //  DEBUGGING LOG 
                    if (parsedScte.descriptors && parsedScte.descriptors.length > 0) {
                        const segDescEntry = parsedScte.descriptors.find(d => d.tag === 0x02); // Check again if it was general
                        if (segDescEntry) { // Only log if segmentation descriptor is found
                            const segDesc = segDescEntry.info;
                            if (segDesc && !segDesc.error && !(parsedScte.spliceCommandType === 0x07)) { // Avoid double logging for TimeSignal case
                                const upidString = segDesc.upid ? segDesc.upid.map(b => b.toString(16).padStart(2, '0')).join('').toUpperCase() : 'N/A';
                                console.log(`[scte_manager] Tag[${tagIndex}] General SegDesc UPID:`, upidString);
                                console.log(`[scte_manager] Tag[${tagIndex}] General SegDesc Type ID (typeId):`, segDesc.typeId, "-", segDesc.typeIdName);
                            }
                        }
                    }


                } else { // Parsing failed for this tag
                    console.warn(`[scte_manager] SCTE parsing failed for tag (idx ${tagIndex}) on segment: ${segment.url}`, scteTagInfo.line, parsedScte?.error);
                    tagSpecificDetection.info.scteTagDetails = {
                        encoded: scteTagInfo.encoded, parsed: null,
                        summary: `SCTE Parsing Error: ${parsedScte?.error || 'Unknown error'}`,
                        encodingType: scteTagInfo.encodingType, line: scteTagInfo.line,
                        error: parsedScte?.error || 'Parsing failed'
                    };
                }

                // Finalize details for this tag's detection object
                tagSpecificDetection.duration = durationFromThisScteTag;
                tagSpecificDetection.id = idFromThisScteTag;
                tagSpecificDetection.type = typeFromThisScteTag || 'scte_signal'; // Default if not set

                // Update cumulative ad time based on this tag's detection
                const isAdStartForThisTag = (tagSpecificDetection.type === 'ad_start' || tagSpecificDetection.info?.segmentationTypeIdName?.includes('Start')) && tagSpecificDetection.duration > 0;
                if (isAdStartForThisTag) {
                    if (tagSpecificDetection.duration > 0) { // Redundant check, but safe
                        console.log(`[scte_manager] Adding SCTE duration ${tagSpecificDetection.duration}s for ${tagSpecificDetection.type} (Tag ID: ${tagSpecificDetection.id || 'N/A'})`);
                        state.cumulativeAdTime += tagSpecificDetection.duration;
                        // updateAdTimeDisplay() will be called once after all detections for this segment event
                    }
                }
                tagSpecificDetection.cumulativeAdTimeAfter = state.cumulativeAdTime;
                detectionsMadeInThisCall.push(tagSpecificDetection);
            }); // End forEach scteTagInfo

        } // --- Scenario 2: No SCTE Tag Data List, fallback to URL-based detection (Legacy) ---
        // IMPORTANT: This 'else if' only runs if scteTagDataList was not present or empty.
        // It does NOT run if scteTagDataList was processed, to avoid dual-processing the same event as both tag and URL.
        // If you want URL processing to *always* run as an augmentation, this logic needs adjustment.
        // Current assumption: if tags are present, they are the source of truth.
        else if (segment.url.includes('/creatives/')) { // Or your other URL-based heuristics
            console.log(`[scte_manager] No SCTE tags found for segment ${segment.url}. Processing URL for creatives.`);

            // Use the original single 'detection' object structure for URL-based analysis
            const urlDetection = { // Create a new object to avoid mutating a shared one if tags were also processed (though this path implies they weren't)
                timestamp: new Date(),
                segmentInfo: {
                    url: segment.url, sequence: segment.sequence, duration: segment.duration, playlistId: segment.playlistId,
                    scteTagData: null /* Explicitly null as this is URL path */
                },
                url: segment.url, info: {}, type: 'unknown', provider: detectProvider(segment.url)
            };

            let durationFromUrl = null;
            let idFromUrl = null;
            // typeFromScteTag would be null here as we are in the URL processing path

            const urlInfo = extractScteInfo(segment.url);
            urlDetection.info.urlDetails = urlInfo;
            if (urlInfo.duration) durationFromUrl = urlInfo.duration;
            if (urlInfo.id) idFromUrl = urlInfo.id;

            urlDetection.duration = durationFromUrl;
            urlDetection.id = idFromUrl;
            urlDetection.type = determineScteType(urlInfo, segment.url); // This uses only URL info

            const isAdStartFromUrl = (urlDetection.type === 'ad_start') && urlDetection.duration > 0;
            if (isAdStartFromUrl) {
                // The original cumulativeAdTime logic based on lastDetection can be complex here
                // if mixing with tag-based detections. Simpler: add if it's a URL ad_start.
                // For more robust deduplication, a global ad break state would be needed.
                if (urlDetection.duration > 0) {
                    console.log(`[scte_manager] Adding URL duration ${urlDetection.duration}s for ${urlDetection.type} (URL ID: ${urlDetection.id || 'N/A'})`);
                    state.cumulativeAdTime += urlDetection.duration;
                }
            }
            urlDetection.cumulativeAdTimeAfter = state.cumulativeAdTime;
            detectionsMadeInThisCall.push(urlDetection);

        } else {
            // Segment has no SCTE tags in scteTagDataList AND does not match URL criteria
            console.log(`[scte_manager] No SCTE signals or creative URL pattern for segment: ${segment.url}`);
        }

        // --- Final processing for all detections made in this call ---
        if (detectionsMadeInThisCall.length > 0) {
            detectionsMadeInThisCall.forEach(det => {
                state.scteDetections.unshift(det); // Add each new detection to the front
        
                // Dispatch event for each distinct detection (for external listeners)
                document.dispatchEvent(new CustomEvent('scteSignalDetected', {
                    detail: { detection: det }
                }));
            });
        
            // Limit total history size (pop oldest if needed)
            while (state.scteDetections.length > state.maxDetections) {
                state.scteDetections.pop();
            }
        
            // Update "lastScteDetection" (for backwards compatibility)
            state.lastScteDetection = detectionsMadeInThisCall[0];
        
            // NEW: Store the *full batch* of SCTE detections (exposed via API)
            state.lastScteDetectionsBatch = detectionsMadeInThisCall;
            console.log(`[scte_manager] Updated lastScteDetectionsBatch with ${detectionsMadeInThisCall.length} detection(s).`);
        
            // Update UI components or any cumulative time trackers
            updateAdTimeDisplay(); // Update cumulative ad time display once
            updateScteList();      // Re-render the full SCTE signal list
        
        } else {
            // No SCTE tags were found in this segment; keep the previous batch intact.
            console.log('[scte_manager] No SCTE tags processed in this segment; lastScteDetectionsBatch remains unchanged.');
        }
        // updateScteStatusDisplay was called at the top if state.active changed.
        // The list update will reflect new counts.
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

    // ---> UPDATE window.SCTEManager to expose new data <---
    window.SCTEManager = {
        getState: () => ({ ...state }),
        resetState,
        analyzeUrl: (url) => {
            console.log('[scte_manager] Manual URL analysis:', extractScteInfo(url));
            return extractScteInfo(url);
        },
        addProvider: (key, name) => {
            state.knownProviders[key.toLowerCase()] = name;
            console.log('[scte_manager] Added provider:', key, name);
        },
        getLastDetection: () => state.lastScteDetection,
        getLastDecodedScte: () => state.lastScteDetection?.info?.scteTagDetails?.parsed || null,
        getLastEncodedScte: () => state.lastScteDetection?.info?.scteTagDetails?.encoded || null,
        getLastScteDuration: () => state.lastScteDetection?.duration || null,
        getLastScteId: () => state.lastScteDetection?.id || null,
        getLastScteType: () => state.lastScteDetection?.type || null,
        getCumulativeAdTime: () => state.cumulativeAdTime,

        // Get the count of SCTE descriptors
        getScteCount: () => {
            const batch = state.lastScteDetectionsBatch;
            if (!batch || batch.length === 0) {
                console.log('[SCTEManager] No last detection batch available.');
                return 0;
            }
        
            // Sum up all descriptors across the batch
            return batch.reduce((total, detection) => {
                const parsed = detection?.info?.scteTagDetails?.parsed;
                const descriptors = parsed?.descriptors || [];
                return total + descriptors.length;
            }, 0);
        },

        getLastScteDetection: () => {
            const last = state.lastScteDetection;
            const descs = last?.info?.scteTagDetails?.parsed?.descriptors || [];
            return descs.map((d, idx) => ({
                idx,
                tag: d.tag,
                tagName: d.tagName,
                length: d.length, // optional: descriptor length
            }));
        },
        
        getScteAdStart: () => {
            const last = state.lastScteDetection;
            if (!last?.info?.scteTagDetails?.parsed?.descriptors) {
                console.warn('[SCTEManager] No SCTE descriptors found in last detection.');
                return null;
            }
        
            const descriptors = last.info.scteTagDetails.parsed.descriptors;
        
            // Look for segmentation descriptor (0x02) with isAdStart flag
            const segDesc = descriptors.find(d => d.tag === 0x02)?.info;
        
            if (segDesc && segDesc.isAdStart) {
                return {
                    found: true,
                    typeId: segDesc.typeId,
                    typeIdName: segDesc.typeIdName,
                    eventId: segDesc.eventId,
                    durationSeconds: segDesc.segmentationDuration
                        ? segDesc.segmentationDuration / 90000
                        : null
                };
            }
        
            // Fallback: Check if **any descriptor** signals ad start (just in case)
            const altStart = descriptors.find(d => d.info?.isAdStart);
            if (altStart) {
                return {
                    found: true,
                    typeId: altStart.info.typeId ?? 'N/A',
                    typeIdName: altStart.info.typeIdName ?? 'N/A',
                    eventId: altStart.info.eventId ?? 'N/A',
                    durationSeconds: altStart.info.segmentationDuration
                        ? altStart.info.segmentationDuration / 90000
                        : null
                };
            }
        
            // Nothing found
            return { found: false };
        },

        getScteAdEnd: () => {
            const last = state.lastScteDetection;
            if (!last?.info?.scteTagDetails?.parsed?.descriptors) {
                console.warn('[SCTEManager] No SCTE descriptors found in last detection.');
                return null;
            }
        
            const descriptors = last.info.scteTagDetails.parsed.descriptors;
        
            // Look for segmentation descriptor (0x02) with isAdEnd flag
            const segDesc = descriptors.find(d => d.tag === 0x02)?.info;
        
            if (segDesc && segDesc.isAdEnd) {
                return {
                    found: true,
                    typeId: segDesc.typeId,
                    typeIdName: segDesc.typeIdName,
                    eventId: segDesc.eventId,
                    durationSeconds: segDesc.segmentationDuration
                        ? segDesc.segmentationDuration / 90000
                        : null
                };
            }
        
            // Fallback: Check if **any descriptor** signals ad end (just in case)
            const altEnd = descriptors.find(d => d.info?.isAdEnd);
            if (altEnd) {
                return {
                    found: true,
                    typeId: altEnd.info.typeId ?? 'N/A',
                    typeIdName: altEnd.info.typeIdName ?? 'N/A',
                    eventId: altEnd.info.eventId ?? 'N/A',
                    durationSeconds: altEnd.info.segmentationDuration
                        ? altEnd.info.segmentationDuration / 90000
                        : null
                };
            }
        
            // Nothing found
            return { found: false };
        },        
                
        
    
        // Get all SCTE tags from the last processed segment
        getLastDetectionAllScteTags: () => {
            const batch = state.lastScteDetectionsBatch;
            if (!batch || batch.length === 0) {
                console.warn('[SCTEManager] No last detection batch available.');
                return null;
            }
        
            return batch.map((detection, idx) => {
                const parsed = detection?.info?.scteTagDetails?.parsed;
                const descriptors = parsed?.descriptors || [];
        
                // Find segmentation descriptor (0x02) first
                let descriptor = descriptors.find(d => d.tag === 0x02)?.info;
        
                // If no 0x02 descriptor, fallback to the first descriptor (if any)
                if (!descriptor && descriptors.length > 0) {
                    console.log(`[SCTEManager] No 0x02 segmentation descriptor found in tag[${idx}]. Falling back to first descriptor (tag: 0x${descriptors[0].tag.toString(16)})`);
                    descriptor = descriptors[0].info;
                }
        
                // Build a descriptor summary for debugging
                const descriptorSummary = descriptors.map(d => ({
                    tag: `0x${d.tag.toString(16).padStart(2, '0')}`,
                    tagName: d.tagName,
                    length: d.length
                }));
        
                return {
                    tagIndex: idx,
                    upid: descriptor?.upid
                        ? descriptor.upid.map(b => b.toString(16).padStart(2, '0')).join('').toUpperCase()
                        : 'N/A',
                    typeId: descriptor?.typeId ?? 'N/A',
                    typeIdName: descriptor?.typeIdName ?? 'N/A',
                    eventId: descriptor?.eventId?.toString() ?? 'N/A',
                    descriptorCount: descriptors.length,
                    rawLine: detection?.info?.scteTagDetails?.line || 'N/A',
                    descriptorSummary // keep for debugging
                };
            });
        },

        getComcastScteHex: () => {
            const last = state.lastScteDetection;
            if (!last || !last.info?.scteTagDetails?.encoded) {
                console.warn('[SCTEManager] No SCTE hex available in last detection.');
                return null;
            }
            return last.info.scteTagDetails.encoded;
        },
    
        parseLatestWithComcast: () => {
            const hex = window.SCTEManager.getComcastScteHex();
            if (!hex) {
                console.warn('[SCTEManager] No SCTE hex found to parse.');
                return null;
            }
            if (!window.SCTE35ParserComcast) {
                console.error('[SCTEManager] SCTE35ParserComcast is not available.');
                return null;
            }
            try {
                const parsed = window.SCTE35ParserComcast.parseFromHex(hex);
                console.log('[SCTEManager] Parsed SCTE-35 using Comcast parser:', parsed);
                return parsed;
            } catch (e) {
                console.error('[SCTEManager] Error parsing with Comcast parser:', e);
                return { error: e.message };
            }
        }
        
        
    };
    // ---> END UPDATE <---

})(); // IIFE ends