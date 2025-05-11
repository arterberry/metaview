// js/ui/scte_manager.js
// Description: Manages SCTE-35 signal detection, processing, and UI display of the LATEST event.

console.log('[scte_manager] Initializing...');

(function () {
    // SCTECoreParser from scte_parser.js will be used for all parsing needs.

    // --- State Variables ---
    const state = {
        // scteDetections: [], // REMOVED - No longer keeping a list for UI
        // maxDetections: 50,  // REMOVED
        active: false,
        cumulativeAdTime: 0,
        lastScteDetection: null,       // Holds THE single most recent SCTE detection object
        lastScteDetectionsBatch: []  // Still useful for API: all detections from the last segment event
    };

    // --- DOM Elements ---
    let scteContainer = null;
    // let scteStatusElement = null; // Can be simplified or removed
    let scteDisplayElement = null;   // Element to display the single latest SCTE event
    let adTimeElement = null;

    document.addEventListener('DOMContentLoaded', init);

    function init() {
        console.log('[scte_manager] DOM loaded, setting up SCTE detection');
        scteContainer = document.getElementById('scteContainer'); // Main container for SCTE UI
        scteDisplayElement = document.getElementById('scteDisplay'); // The div where the single SCTE event will be shown
        adTimeElement = document.getElementById('adTimeTracker');
        // scteStatusElement = document.getElementById('scteStatus');

        if (!scteContainer || !scteDisplayElement) {
            createScteUI(); 
            scteContainer = document.getElementById('scteContainer');
            scteDisplayElement = document.getElementById('scteDisplay');
        }
        // if (!scteStatusElement) scteStatusElement = document.getElementById('scteStatus');

        setupEventListeners();
        // updateScteStatusDisplay(); 
        updateAdTimeDisplay();
        updateLatestScteDisplay(); // Initial (empty) display
        console.log('[scte_manager] Initialization complete');
    }

    function createScteUI() {
        const parentElement = document.querySelector('#inspect-tab');
        if (!parentElement) {
            console.error('[scte_manager] Parent element for SCTE UI not found (#inspect-tab).');
            return;
        }
        // Check for a more generic scte-section to avoid duplicate titles if UI is complex
        let sectionElement = parentElement.querySelector('.scte-section');
        if (!sectionElement) {
            sectionElement = document.createElement('div');
            sectionElement.className = 'scte-section';
            sectionElement.innerHTML = `<div class="scte-header-label">SCTE Monitor:</div>`; // Your title
            
            const cacheTtlSection = parentElement.querySelector('.cache-ttl-section');
            if (cacheTtlSection && cacheTtlSection.nextElementSibling) {
                parentElement.insertBefore(sectionElement, cacheTtlSection.nextElementSibling);
            } else {
                parentElement.appendChild(sectionElement);
            }
        }

        // Ensure the display area exists within the scte-section
        if (!sectionElement.querySelector('#scteDisplay')) {
            const displayContainer = document.createElement('div');
            displayContainer.id = 'scteContainer'; // Keep if styles depend on it
            displayContainer.className = 'scte-container';
            displayContainer.innerHTML = `<div id="scteDisplay" class="scte-list"></div>`; // Use 'scte-list' class if CSS expects it for the display area
            sectionElement.appendChild(displayContainer);
        }
        console.log('[scte_manager] SCTE UI structure ensured/created.');
    }

    function setupEventListeners() {
        document.addEventListener('hlsSegmentAdded', handleSegmentAdded);
        document.addEventListener('hlsFragLoadedUI', handleSegmentAdded);
        document.addEventListener('newStreamLoading', resetState);
    }

    function resetState() {
        console.log('[scte_manager] Resetting SCTE detection state');
        state.active = false;
        state.cumulativeAdTime = 0;
        state.lastScteDetection = null;
        state.lastScteDetectionsBatch = [];
        // updateScteStatusDisplay();
        updateAdTimeDisplay();
        updateLatestScteDisplay(); // Clear the display
    }

    function handleSegmentAdded(event) {
        const segment = event.detail.segment || event.detail;
        if (!segment || !segment.url) {
            return;
        }
        processSegmentForScte(segment);
    }

    function processSegmentForScte(segment) {
        if (!state.active) {
            state.active = true;
            // updateScteStatusDisplay();
        }

        let batchForThisSegment = []; // To populate state.lastScteDetectionsBatch

        if (segment.scteTagDataList && segment.scteTagDataList.length > 0) {
            window.LatestScteHexTags = window.LatestScteHexTags || [];

            segment.scteTagDataList.forEach((scteTagInfo, tagIndex) => {
                // This object will become state.lastScteDetection if it's the latest
                const currentDetection = {
                    timestamp: new Date(),
                    url: segment.url, 
                    info: {}
                };

                let scteProcessingResult = null; // Holds data from scte_parser.js

                // --- SCTE Parsing Logic (same as before) ---
                if (scteTagInfo && scteTagInfo.encoded) {
                    window.LatestScteHexTags.push({ /* ... */ });
                    if (window.SCTECoreParser && window.SCTECoreParser.extractScteDetails) {
                        const comcastParsedScte = window.SCTECoreParser.parseScteData(scteTagInfo.encoded, scteTagInfo.encodingType);
                        scteProcessingResult = window.SCTECoreParser.extractScteDetails(comcastParsedScte, scteTagInfo.line);
                    } else {
                        scteProcessingResult = { /* ... error object ... */
                            error: 'SCTECoreParser unavailable.', id: 'N/A (Sys Error)', /* other fields as N/A */
                            scteTagDetails: { summary: 'Parser unavailable.'} // simplified for brevity
                        };
                    }
                } else {
                    scteProcessingResult = { /* ... error object for missing data ... */
                        error: 'Missing encoded data.', id: 'N/A (No Data)', /* other fields as N/A */
                        scteTagDetails: { summary: 'No encoded data.'} // simplified for brevity
                    };
                }
                // --- End SCTE Parsing Logic ---

                // Populate currentDetection.info with the processed data
                currentDetection.info = scteProcessingResult || { error: "Processing failed unexpectedly", id: "N/A (Proc Error)", scteTagDetails: {summary:"Processing Error"}};
                if (currentDetection.info.scteTagDetails && scteTagInfo.line && !currentDetection.info.scteTagDetails.line) {
                    currentDetection.info.scteTagDetails.line = scteTagInfo.line;
                }

                // Log this specific detection
                console.log(
                    `[SCTE_MANAGER_DEBUG] RawLine: ${scteTagInfo.line || 'N/A'}`,
                    `EventID: ${currentDetection.info.id || 'N/A'}`,
                    `TypeID: 0x${(currentDetection.info.segmentationTypeId !== null && currentDetection.info.segmentationTypeId !== undefined ? Number(currentDetection.info.segmentationTypeId).toString(16).padStart(2, '0') : '??')}`,
                    `TypeName: ${currentDetection.info.segmentationTypeIdName || 'N/A'}`,
                    `isAdStart (Strict): ${currentDetection.info.isAdStart === true}`,
                    `isAdEnd (Strict): ${currentDetection.info.isAdEnd === true}`,
                    `Duration: ${currentDetection.info.duration === null || currentDetection.info.duration === undefined ? 'N/A' : currentDetection.info.duration.toFixed(3) + 's'}`,
                    `DurationSrc: ${currentDetection.info.durationSource || 'N/A'}`,
                    `UPID (Fmt): ${currentDetection.info.upidFormatted || 'N/A'}`,
                    `Summary: ${currentDetection.info.scteTagDetails?.summary || 'N/A'}`
                );

                // Update state.lastScteDetection to this newest one
                state.lastScteDetection = currentDetection;
                batchForThisSegment.push(currentDetection); // Add to the batch for this segment

                // Dispatch custom event if it's an ad start
                if (currentDetection.info.isAdStart) {
                    console.log(`[scte_manager] Dispatching 'scteAdSegmentDetected' (EventID: ${currentDetection.info.id})`);
                    document.dispatchEvent(new CustomEvent('scteAdSegmentDetected', {
                        detail: {
                            segmentUrl: currentDetection.url,
                            scteInfo: { 
                                typeId: currentDetection.info.segmentationTypeId,
                                typeName: currentDetection.info.segmentationTypeIdName,
                                scteEventId: currentDetection.info.id,
                                duration: currentDetection.info.duration
                            }
                        }
                    }));
                }

                // Ad Time Accumulation
                const isStrictAdStartForTime = currentDetection.info.isAdStart &&
                    typeof currentDetection.info.duration === 'number' &&
                    currentDetection.info.duration > 0;
                if (isStrictAdStartForTime) {
                    state.cumulativeAdTime += currentDetection.info.duration;
                }
                // No need for cumulativeAdTimeAfter on the detection object itself if only showing latest

                // IMMEDIATELY UPDATE UI to show this very latest SCTE event
                updateLatestScteDisplay(); 
                updateAdTimeDisplay(); // Update ad time as it might have changed

            }); // End forEach scteTagInfo

            // After processing all tags in the segment, update the batch state
            if (batchForThisSegment.length > 0) {
                state.lastScteDetectionsBatch = batchForThisSegment;
            }

        } // End if (segment.scteTagDataList)
    } // End processSegmentForScte


    // updateScteStatusDisplay can be simplified or removed if not used with the new single-item display
    function updateScteStatusDisplay() {
        // if (!scteStatusElement) return;
        // scteStatusElement.textContent = state.active ? 'Monitoring SCTE...' : 'SCTE Monitor Inactive';
    }

    function updateAdTimeDisplay() {
        if (!adTimeElement) return;
        const formattedTime = formatTime(state.cumulativeAdTime);
        adTimeElement.textContent = `Total Ad Time: ${formattedTime}`;
        if (state.cumulativeAdTime > 0) adTimeElement.classList.add('active');
        else adTimeElement.classList.remove('active');
    }

    function formatTime(seconds) {
        if (seconds === null || seconds === undefined || isNaN(seconds)) seconds = 0;
        if (seconds === 0) return '0s';
        if (seconds < 0) seconds = 0;
        if (seconds < 60) return `${seconds.toFixed(1)}s`;
        const minutes = Math.floor(seconds / 60);
        const remainingSeconds = (seconds % 60).toFixed(1);
        return `${minutes}m ${remainingSeconds}s`;
    }

    // RENAMED and REFACTORED: Was updateScteList, now updates to show only the latest.
    function updateLatestScteDisplay() {
        if (!scteDisplayElement) {
            // console.error("[scte_manager] updateLatestScteDisplay: scteDisplayElement is null!");
            return;
        }
        
        scteDisplayElement.innerHTML = ''; // Clear previous content

        const detection = state.lastScteDetection; // Get the single latest detection

        if (!detection || !detection.info) {
            scteDisplayElement.innerHTML = '<div class="scte-empty">No SCTE signal processed yet.</div>';
            return;
        }

        const detInfo = detection.info; // This is the scteProcessingResult content

        // Create a single div for this detection, using the same class for block styling
        const detectionHtmlContainer = document.createElement('div');
        detectionHtmlContainer.className = 'scte-detection'; // Use the class your CSS targets for blocks

        let typeIdNumber = 'N/A';
        if (detInfo.segmentationTypeId !== null && detInfo.segmentationTypeId !== undefined) {
            const parsedNum = parseInt(detInfo.segmentationTypeId, 10);
            if (!isNaN(parsedNum)) {
                typeIdNumber = parsedNum;
            } else { 
                const parsedHex = parseInt(detInfo.segmentationTypeId, 16);
                typeIdNumber = isNaN(parsedHex) ? String(detInfo.segmentationTypeId) : parsedHex;
            }
        }

        const segmentPath = detection.url || 'N/A';
        const upidFormatted = detInfo.upidFormatted || 'N/A';
        const eventId = detInfo.id || 'N/A';
        const typeIdHex = (detInfo.segmentationTypeId !== null && detInfo.segmentationTypeId !== undefined)
            ? `0x${Number(detInfo.segmentationTypeId).toString(16).padStart(2, '0')}`
            : 'N/A';
        const typeName = detInfo.segmentationTypeIdName || 'N/A';
        const isAdStartText = detInfo.isAdStart === true ? 'true' : 'false';
        const isAdEndText = detInfo.isAdEnd === true ? 'true' : 'false';

        let dispatchInfo = 'Monitoring';
        if (detInfo.isAdStart === true) {
            dispatchInfo = `segment URL: ${segmentPath}`;
        }

        detectionHtmlContainer.innerHTML = `
            <div class="scte-item-block"> 
                <div class="scte-info-row">
                    <span class="scte-label">SCTE Tag:</span>
                    <span class="scte-value-label">${typeIdNumber}</span>
                </div>
                <div class="scte-info-row">
                    <span class="scte-label">Segment Path:</span>
                    <span class="scte-value-label scte-url-value">${segmentPath}</span>
                </div>
                <div class="scte-info-row">
                    <span class="scte-label">UPID:</span>
                    <span class="scte-value-label">${upidFormatted}</span>
                </div>
                <div class="scte-info-row scte-metadata-container">
                    <span class="scte-label">Meta Data:</span>
                    <div class="scte-metadata-details">
                        <div class="scte-metadata-item">
                            <span class="scte-metadata-key">EventID:</span> 
                            <span class="scte-value-label">${eventId}</span>
                        </div>
                        <div class="scte-metadata-item">
                            <span class="scte-metadata-key">TypeID:</span> 
                            <span class="scte-value-label">${typeIdHex}</span>
                        </div>
                        <div class="scte-metadata-item">
                            <span class="scte-metadata-key">TypeName:</span> 
                            <span class="scte-value-label">${typeName}</span>
                        </div>
                        <div class="scte-metadata-item">
                            <span class="scte-metadata-key">isAdStart:</span> 
                            <span class="scte-value-label">${isAdStartText}</span>
                        </div>
                        <div class="scte-metadata-item">
                            <span class="scte-metadata-key">isAdEnd:</span> 
                            <span class="scte-value-label">${isAdEndText}</span>
                        </div>
                    </div>
                </div>
                <div class="scte-info-row">
                    <span class="scte-label">Dispatch:</span>
                    <span class="scte-value-label">${dispatchInfo}</span>
                </div>
            </div>
        `;
        scteDisplayElement.appendChild(detectionHtmlContainer);
        // console.log(`[scte_manager] UI-UPDATE-LATEST: Displayed EventID: ${eventId}`);
    }

    window.SCTEManager = {
        getState: () => ({ ...state, /* scteDetections is no longer relevant for UI list */ }),
        resetState,
        getLastDetection: () => state.lastScteDetection, // This is THE one displayed
        getLastScteDetectionsBatch: () => state.lastScteDetectionsBatch, // Detections from last segment event
        // ... other API functions remain the same, operating on lastScteDetection.info ...
        getLastDecodedScte: () => state.lastScteDetection?.info?.scteTagDetails?.parsed || null,
        getLastEncodedScte: () => state.lastScteDetection?.info?.scteTagDetails?.encoded || null,
        getLastScteDuration: () => state.lastScteDetection?.info?.duration || null,
        getLastScteId: () => state.lastScteDetection?.info?.id || null,
        getLastScteType: () => state.lastScteDetection?.info?.type || null,
        getCumulativeAdTime: () => state.cumulativeAdTime,
        getScteCount: () => state.lastScteDetectionsBatch.reduce((total, detection) => total + (detection.info?.scteTagDetails?.parsed?.descriptors?.length || 0), 0),
        getLastScteDescriptorsInfo: () => {
            const parsedScte = state.lastScteDetection?.info?.scteTagDetails?.parsed;
            if (!parsedScte || !parsedScte.descriptors) return [];
            return parsedScte.descriptors.map((d, idx) => ({ 
                idx, spliceDescriptorTag: d.spliceDescriptorTag, 
                segmentationEventId: d.segmentationEventId, segmentationTypeId: d.segmentationTypeId,
            }));
        },
        getScteAdStart: () => {
            const last = state.lastScteDetection; // Operates on the single latest SCTE event
            if (!last || !last.info || !last.info.isAdStart) return { found: false };
            return {
                found: true, typeId: last.info.segmentationTypeId, typeIdName: last.info.segmentationTypeIdName,
                eventId: last.info.id, durationSeconds: last.info.duration
            };
        },
        getScteAdEnd: () => {
            const last = state.lastScteDetection; // Operates on the single latest SCTE event
            if (!last || !last.info || !last.info.isAdEnd) return { found: false };
            return {
                found: true, typeId: last.info.segmentationTypeId, typeIdName: last.info.segmentationTypeIdName,
                eventId: last.info.id, durationSeconds: last.info.duration 
            };
        },
        getLastDetectionAllScteTags: () => { // This now refers to the last BATCH of tags from one segment
            const batch = state.lastScteDetectionsBatch;
            if (!batch || batch.length === 0) return null;
            return batch.map((detection, idx) => {
                // ... (same mapping as before, using detection.info) ...
                if (!detection.info || !detection.info.scteTagDetails) return { tagIndex: idx, error: "Not a tag-based detection" };
                return {
                    tagIndex: idx, upidHex: detection.info.upidHex || 'N/A',
                    upidFormatted: detection.info.upidFormatted || 'N/A', 
                    typeId: detection.info.segmentationTypeId,
                    typeIdName: detection.info.segmentationTypeIdName || detection.info.type,
                    eventId: detection.info.id || 'N/A',
                    descriptorCount: detection.info.scteTagDetails.parsed?.descriptors?.length || 0,
                    rawLine: detection.info.scteTagDetails.line || 'N/A',
                    summary: detection.info.scteTagDetails.summary || 'N/A'
                };
            });
        },
        getScteHex: () => state.lastScteDetection?.info?.scteTagDetails?.encoded || null,
        parseLatestScte: () => {
            const lastTagDetails = state.lastScteDetection?.info?.scteTagDetails;
            if (!lastTagDetails || !lastTagDetails.encoded) { return null; }
            if (!window.SCTECoreParser || !window.SCTECoreParser.parseScteData) { return { error: 'SCTECoreParser not available.' }; }
            try {
                return window.SCTECoreParser.parseScteData(lastTagDetails.encoded, lastTagDetails.encodingType);
            } catch (e) { return { error: `Exception: ${e.message}` }; }
        }
    };

})();