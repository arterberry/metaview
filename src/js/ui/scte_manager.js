// js/ui/scte_manager.js
// Description: Originally developed for detecting SCTE-35 signal detection, it now can identify and manage identification of ad creatives.

console.log('[scte_manager] Initializing...');

(function () {
    // Ensure SCTE35 parser from Comcast is available globally -- REMOVED
    // This is now handled by scte_parser.js, which initializes its own instance.
    // SCTECoreParser will be used for all parsing needs.

    // --- State Variables ---
    const state = {
        scteDetections: [],
        maxDetections: 50,
        active: false,
        cumulativeAdTime: 0,
        knownProviders: {
            'yospace': 'Yospace',
            'freewheel': 'FreeWheel',
            'google': 'Google Ad Manager',
            'spotx': 'SpotX',
            'tremorhub': 'Tremor Video',
            'adease': 'Adease'
        },
        lastScteDetection: null,
        lastScteDetectionsBatch: [] // Ensure this is initialized
    };

    // --- DOM Elements ---
    let scteContainer = null;
    let scteStatusElement = null;
    let scteListElement = null;
    let adTimeElement = null;

    document.addEventListener('DOMContentLoaded', init);

    function init() {
        console.log('[scte_manager] DOM loaded, setting up SCTE detection');
        scteContainer = document.getElementById('scteContainer');
        scteStatusElement = document.getElementById('scteStatus');
        scteListElement = document.getElementById('scteList');
        adTimeElement = document.getElementById('adTimeTracker');

        if (!scteContainer || !scteListElement) {
            createScteUI();
            scteContainer = document.getElementById('scteContainer');
            scteListElement = document.getElementById('scteList');
        }
        scteStatusElement = document.getElementById('scteStatus'); // Re-check after UI creation
        adTimeElement = document.getElementById('adTimeTracker');   // Re-check

        setupEventListeners();
        updateScteStatusDisplay();
        updateAdTimeDisplay();
        console.log('[scte_manager] Initialization complete');
    }

    function createScteUI() {
        const parentElement = document.querySelector('#inspect-tab');
        if (!parentElement) {
            console.error('[scte_manager] Parent element for SCTE UI not found');
            return;
        }
        if (parentElement.querySelector('.scte-section')) {
            console.log('[scte_manager] SCTE UI section already exists.');
            return;
        }
        const sectionElement = document.createElement('div');
        sectionElement.className = 'scte-section';
        sectionElement.innerHTML = `
            <div class="scte-label">SCTE Monitor:</div>
            <div id="scteContainer" class="scte-container">
                <div id="scteList" class="scte-list"></div>
            </div>
        `;
        const cacheTtlSection = document.querySelector('.cache-ttl-section');
        if (cacheTtlSection && cacheTtlSection.nextElementSibling) {
            parentElement.insertBefore(sectionElement, cacheTtlSection.nextElementSibling);
        } else {
            parentElement.appendChild(sectionElement);
        }
        console.log('[scte_manager] SCTE UI section created.');
    }

    function setupEventListeners() {
        document.addEventListener('hlsSegmentAdded', handleSegmentAdded);
        document.addEventListener('hlsFragLoadedUI', handleSegmentAdded);
        document.addEventListener('newStreamLoading', resetState);
    }

    function resetState() {
        console.log('[scte_manager] Resetting SCTE detection state');
        state.scteDetections = [];
        state.active = false;
        state.cumulativeAdTime = 0;
        state.lastScteDetection = null;
        state.lastScteDetectionsBatch = [];
        updateScteStatusDisplay();
        updateAdTimeDisplay();
        updateScteList();
    }

    function handleSegmentAdded(event) {
        const segment = event.detail.segment || event.detail;
        // console.log('[scte_manager] Received segment:', segment); // Too verbose for regular operation
        if (!segment || !segment.url) {
            // console.warn('[scte_manager] handleSegmentAdded received event without segment or url:', event.detail);
            return;
        }
        processSegmentForScte(segment);
    }

    function processSegmentForScte(segment) {
        if (!state.active) {
            state.active = true;
            updateScteStatusDisplay();
        }

        let detectionsMadeInThisCall = [];

        if (segment.scteTagDataList && segment.scteTagDataList.length > 0) {
            // console.log(`[scte_manager] Processing ${segment.scteTagDataList.length} SCTE tag(s) for segment: ${segment.url}`);

            window.LatestScteHexTags = window.LatestScteHexTags || [];

            segment.scteTagDataList.forEach((scteTagInfo, tagIndex) => {
                const tagSpecificDetection = {
                    timestamp: new Date(),
                    segmentInfo: {
                        url: segment.url, sequence: segment.sequence, duration: segment.duration,
                        playlistId: segment.playlistId
                    },
                    url: segment.url, // Redundant but kept for consistency with URL-based path
                    info: {},
                    type: 'unknown', // Will be updated by parser
                    provider: detectProvider(segment.url)
                };

                let durationFromThisScteTag = null;
                let idFromThisScteTag = null;
                let typeFromThisScteTag = null; // Manager's classification like 'ad_start'
                let scteProcessingResult = null;

                if (scteTagInfo && scteTagInfo.encoded) {
                    // console.log(`[debug] Captured SCTE data for tag[${tagIndex}]: ${scteTagInfo.encoded} (Type: ${scteTagInfo.encodingType})`);
                    window.LatestScteHexTags.push({
                        timestamp: new Date(), segmentUrl: segment.url,
                        hexOrB64: scteTagInfo.encoded, encoding: scteTagInfo.encodingType, line: scteTagInfo.line
                    });

                    if (window.SCTECoreParser) {
                        const comcastParsedScte = window.SCTECoreParser.parseScteData(scteTagInfo.encoded, scteTagInfo.encodingType);
                        scteProcessingResult = window.SCTECoreParser.extractScteDetails(comcastParsedScte);
                    } else {
                        scteProcessingResult = { 
                            error: 'SCTECoreParser not available.', 
                            scteTagDetails: { 
                                encoded: scteTagInfo.encoded, encodingType: scteTagInfo.encodingType, 
                                summary: 'SCTECoreParser not available.', parsed: null 
                            } 
                        };
                    }
                } else {
                    scteProcessingResult = { 
                        error: 'Missing encoded SCTE data in scteTagInfo.', 
                        scteTagDetails: { summary: 'Missing encoded SCTE data.', parsed: null } 
                    };
                }

                if (scteProcessingResult && !scteProcessingResult.error) {
                    tagSpecificDetection.info.scteTagDetails = scteProcessingResult.scteTagDetails;
                    // scteProcessingResult.scteTagDetails.parsed contains the raw Comcast parser output
                    // scteProcessingResult.scteTagDetails.summary contains the new summary

                    idFromThisScteTag = scteProcessingResult.id;
                    durationFromThisScteTag = scteProcessingResult.duration;
                    typeFromThisScteTag = scteProcessingResult.type; // Manager's type ('ad_start', 'program_end', etc.)

                    tagSpecificDetection.info.segmentationTypeId = scteProcessingResult.segmentationTypeId;
                    // Store the descriptive SCTE-35 type name (e.g., "Provider Advertisement Start (Cancelled)")
                    tagSpecificDetection.info.segmentationTypeIdName = scteProcessingResult.segmentationTypeIdName; 
                    tagSpecificDetection.info.upidHex = scteProcessingResult.upid;

                    // Convert UPID hex to ASCII using the new utility
                    if (scteProcessingResult.upid && window.SCTECoreParser && window.SCTECoreParser.upidToAscii) {
                        tagSpecificDetection.info.upidAscii = window.SCTECoreParser.upidToAscii(scteProcessingResult.upid);
                    } else {
                        tagSpecificDetection.info.upidAscii = null;
                    }

                    tagSpecificDetection.info.segmentNum = scteProcessingResult.segmentNum;
                    tagSpecificDetection.info.segmentsExpected = scteProcessingResult.segmentsExpected;

                    // console.log(`[scte_manager] Tag[${tagIndex}] UPID (Hex):`, scteProcessingResult.upid || 'N/A');
                    // console.log(`[scte_manager] Tag[${tagIndex}] Segmentation Type:`, scteProcessingResult.segmentationTypeIdName || 'N/A');
                } else {
                    console.warn(`[scte_manager] SCTE processing failed for tag (idx ${tagIndex}) on segment ${segment.url}:`, scteProcessingResult?.error);
                    tagSpecificDetection.info.scteTagDetails = scteProcessingResult.scteTagDetails || {
                        encoded: scteTagInfo.encoded, parsed: null,
                        summary: `SCTE Processing Error: ${scteProcessingResult?.error || 'Unknown error'}`,
                        encodingType: scteTagInfo.encodingType, line: scteTagInfo.line,
                        error: scteProcessingResult?.error || 'Processing failed'
                    };
                }

                tagSpecificDetection.duration = durationFromThisScteTag;
                tagSpecificDetection.id = idFromThisScteTag;
                tagSpecificDetection.type = typeFromThisScteTag || 'scte_signal';

                // Use isAdStart from the new parser results
                const isAdStartForThisTag = scteProcessingResult && scteProcessingResult.isAdStart && tagSpecificDetection.duration > 0;
                if (isAdStartForThisTag) {
                    if (tagSpecificDetection.duration > 0) {
                        console.log(`[scte_manager] Adding SCTE duration ${tagSpecificDetection.duration}s for ${tagSpecificDetection.type} (Tag ID: ${tagSpecificDetection.id || 'N/A'})`);
                        state.cumulativeAdTime += tagSpecificDetection.duration;
                    }
                }
                tagSpecificDetection.cumulativeAdTimeAfter = state.cumulativeAdTime;
                detectionsMadeInThisCall.push(tagSpecificDetection);
            });

        } else if (segment.url.includes('/creatives/')) { // Legacy URL-based detection
            // console.log(`[scte_manager] No SCTE tags. Processing URL for creatives: ${segment.url}`);
            const urlDetection = {
                timestamp: new Date(),
                segmentInfo: {
                    url: segment.url, sequence: segment.sequence, duration: segment.duration, playlistId: segment.playlistId,
                    scteTagData: null
                },
                url: segment.url, info: {}, type: 'unknown', provider: detectProvider(segment.url)
            };
            const urlInfo = extractScteInfo(segment.url);
            urlDetection.info.urlDetails = urlInfo;
            if (urlInfo.duration) urlDetection.duration = urlInfo.duration;
            if (urlInfo.id) urlDetection.id = urlInfo.id;
            urlDetection.type = determineScteType(urlInfo, segment.url);

            const isAdStartFromUrl = (urlDetection.type === 'ad_start') && urlDetection.duration > 0;
            if (isAdStartFromUrl) {
                if (urlDetection.duration > 0) {
                    console.log(`[scte_manager] Adding URL duration ${urlDetection.duration}s for ${urlDetection.type} (URL ID: ${urlDetection.id || 'N/A'})`);
                    state.cumulativeAdTime += urlDetection.duration;
                }
            }
            urlDetection.cumulativeAdTimeAfter = state.cumulativeAdTime;
            detectionsMadeInThisCall.push(urlDetection);
        } else {
            // console.log(`[scte_manager] No SCTE signals or creative URL pattern for segment: ${segment.url}`);
        }

        if (detectionsMadeInThisCall.length > 0) {
            detectionsMadeInThisCall.forEach(det => {
                state.scteDetections.unshift(det);
                document.dispatchEvent(new CustomEvent('scteSignalDetected', { detail: { detection: det } }));
            });
            while (state.scteDetections.length > state.maxDetections) {
                state.scteDetections.pop();
            }
            state.lastScteDetection = detectionsMadeInThisCall[0]; // Most recent of this batch
            state.lastScteDetectionsBatch = detectionsMadeInThisCall; // Entire batch from this segment
            // console.log(`[scte_manager] Updated lastScteDetectionsBatch with ${detectionsMadeInThisCall.length} detection(s).`);
            updateAdTimeDisplay();
            updateScteList();
        } else {
            // console.log('[scte_manager] No SCTE tags processed in this segment; lastScteDetectionsBatch remains unchanged.');
        }
    }

    function extractScteInfo(url) { // This is for URL based ad detection, not SCTE tag parsing
        const info = { creative: 'Unknown', duration: null, id: null, params: {} };
        try {
            const creativesMatch = url.match(/\/creatives\/([^\/]+)/);
            if (creativesMatch && creativesMatch[1]) info.creative = creativesMatch[1];
            const durationMatch = url.match(/duration=(\d+(\.\d+)?)/);
            if (durationMatch && durationMatch[1]) info.duration = parseFloat(durationMatch[1]);
            const idMatch = url.match(/id=(\d+)/);
            if (idMatch && idMatch[1]) info.id = idMatch[1];
            const urlObj = new URL(url);
            for (const [key, value] of urlObj.searchParams.entries()) {
                info.params[key] = value;
                if (!info.duration && (key.includes('dur') || key.includes('length')) && !isNaN(parseFloat(value))) info.duration = parseFloat(value);
                if (!info.id && (key.includes('ad') && key.includes('id')) && value) info.id = value;
            }
            info.pathComponents = url.split('/').filter(Boolean);
            if (url.includes('scte35')) {
                const scte35Match = url.match(/scte35[=\/]([^&\/]+)/i);
                if (scte35Match && scte35Match[1]) info.scte35Data = scte35Match[1];
            }
            const timeMatch = url.match(/[?&](time|timestamp|pts|start|end)=([^&]+)/i);
            if (timeMatch && timeMatch[2]) info.timeMarker = timeMatch[2];
        } catch (e) { /* console.warn('[scte_manager] Error parsing URL parameters:', e); */ }
        return info;
    }

    function detectProvider(url) {
        let provider = { name: "Unknown", confidence: "low" };
        try {
            const urlObj = new URL(url);
            const hostname = urlObj.hostname.toLowerCase();
            const path = urlObj.pathname.toLowerCase();
            const fullUrl = url.toLowerCase();
            for (const [key, name] of Object.entries(state.knownProviders)) {
                if (hostname.includes(key) || path.includes(key)) {
                    provider.name = name; provider.confidence = "high"; return provider;
                }
            }
            if (fullUrl.includes('yospace')) { provider.name = 'Yospace'; provider.confidence = "high"; }
            else if (fullUrl.includes('freewheel')) { provider.name = 'FreeWheel'; provider.confidence = "high"; }
            else if (hostname.includes('foxsports') || hostname.includes('fox.com') || hostname.includes('tubi.video')) { provider.name = 'Fox (Detected Hostname)'; provider.confidence = "medium"; }
            else if (path.includes('/ads/') || path.includes('/ad/')) { provider.name = 'Generic Ad Server'; provider.confidence = "medium"; }
        } catch (e) { /* console.warn('[scte_manager] Error detecting provider:', e); */ }
        return provider;
    }

    function determineScteType(scteInfo, url) { // For URL based, not SCTE tags
        if (url.includes('ad_start') || url.includes('cue_in') || url.includes('splice_in')) return 'ad_start';
        else if (url.includes('ad_end') || url.includes('cue_out') || url.includes('splice_out')) return 'ad_end';
        return 'ad_marker';
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
        const formattedTime = formatTime(state.cumulativeAdTime);
        adTimeElement.textContent = `Total Ad Time: ${formattedTime}`;
        if (state.cumulativeAdTime > 0) adTimeElement.classList.add('active');
        else adTimeElement.classList.remove('active');
    }

    function formatTime(seconds) {
        if (seconds === 0) return '0s';
        if (seconds < 60) return `${seconds.toFixed(1)}s`;
        const minutes = Math.floor(seconds / 60);
        const remainingSeconds = (seconds % 60).toFixed(1);
        return `${minutes}m ${remainingSeconds}s`;
    }

    function updateScteList() {
        if (!scteListElement) return;
        scteListElement.innerHTML = '';
        if (state.scteDetections.length === 0) {
            scteListElement.innerHTML = '<div class="scte-empty">No SCTE signals detected yet</div>';
            return;
        }

        state.scteDetections.forEach((detection) => {
            const detectionElement = document.createElement('div');
            const isTagSource = !!detection.info?.scteTagDetails;
            detectionElement.className = `scte-detection scte-${detection.type} ${isTagSource ? 'scte-source-tag' : 'scte-source-url'} expanded`;
            
            const time = detection.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
            const primaryId = detection.id || detection.info?.urlDetails?.creative || 'N/A';
            const displayTypeLabel = formatScteType(detection.type, detection.info); // Uses manager's 'type' and more specific info

            let detectionHtml = `
                <div class="scte-detection-header">
                    <span class="scte-detection-type">${displayTypeLabel}</span>
                    <span class="scte-detection-time">${time}</span>
                </div>
                <div class="scte-detection-number">                    
                    <span class="scte-primary-id">${primaryId}</span>
                    <div class="scte-full-path" style="font-size: 0.8em; word-break: break-all; margin-top: 2px;">${detection.url}</div>
                </div>
                <div class="scte-detection-details">
            `;

            if (isTagSource) {
                const scteTag = detection.info.scteTagDetails;
                detectionHtml += `
                    <div class="scte-detail-item scte-tag-details">
                        <span class="scte-detail-label">SCTE-35 Tag:</span>
                        <div class="scte-detail-value">
                           <div class="scte-tag-summary">${scteTag.summary || 'Could not parse tag.'}</div>
                           <div class="scte-tag-encoded">Encoded (${scteTag.encodingType}): <code>${scteTag.encoded || 'N/A'}</code></div>
                           <div class="scte-tag-line">Line: <code>${scteTag.line || 'N/A'}</code></div>
                           <div class="scte-tag-parsed-raw" style="display: none;">Raw Parsed: <pre>${JSON.stringify(scteTag.parsed, null, 2)}</pre></div>
                        </div>
                    </div>`;
                // Display SCTE-35 specific fields if available from tag
                if (detection.info.segmentationTypeIdName) { // This is the descriptive SCTE-35 name
                    detectionHtml += `
                         <div class="scte-detail-item">
                             <span class="scte-detail-label">Seg Type:</span>
                             <span class="scte-detail-value">${detection.info.segmentationTypeIdName} (0x${(detection.info.segmentationTypeId !== null && detection.info.segmentationTypeId !== undefined) ? detection.info.segmentationTypeId.toString(16) : 'N/A'})</span>
                         </div>`;
                }

                if (detection.info.upidHex) { // Check if upidHex exists
                    detectionHtml += `
                     <div class="scte-detail-item">
                         <span class="scte-detail-label">UPID (Hex):</span>
                         <span class="scte-detail-value">${detection.info.upidHex}</span>
                     </div>`;
                    if (detection.info.upidAscii) { // Display ASCII if available
                        detectionHtml += `
                         <div class="scte-detail-item">
                             <span class="scte-detail-label">UPID (ASCII):</span>
                             <span class="scte-detail-value">${detection.info.upidAscii}</span>
                         </div>`;
                    }
                }
            }
            
            if (detection.provider && detection.provider.name !== "Unknown") {
                detectionHtml += `
                    <div class="scte-detail-item">
                        <span class="scte-detail-label">Provider:</span>
                        <span class="scte-detail-value">${detection.provider.name} (${detection.provider.confidence})</span>
                    </div>`;
            }
            if (detection.id && !isTagSource) { // ID already covered by primaryId or seg type for tags
                detectionHtml += `
                    <div class="scte-detail-item">
                        <span class="scte-detail-label">Extracted ID:</span>
                        <span class="scte-detail-value">${detection.id}</span>
                    </div>`;
            }
            if (detection.duration !== null && detection.duration !== undefined) {
                const formattedDuration = detection.duration % 1 === 0 ? detection.duration.toFixed(0) : detection.duration.toFixed(3);
                detectionHtml += `
                    <div class="scte-detail-item">
                        <span class="scte-detail-label">Duration:</span>
                        <span class="scte-detail-value">${formattedDuration}s</span>
                    </div>`;
            }
            if (detection.cumulativeAdTimeAfter !== null && detection.cumulativeAdTimeAfter !== undefined) {
                detectionHtml += `
                     <div class="scte-detail-item">
                         <span class="scte-detail-label">Cum. Ad Time:</span>
                         <span class="scte-detail-value">${formatTime(detection.cumulativeAdTimeAfter)}</span>
                     </div>`;
            }

            // URL-specific details (only if not primarily a tag source, or if params exist)
            if (detection.info?.urlDetails && (!isTagSource || Object.keys(detection.info.urlDetails.params).length > 0)) {
                const urlDetails = detection.info.urlDetails;
                 if (urlDetails.creative && urlDetails.creative !== 'Unknown' && urlDetails.creative !== detection.id) {
                    detectionHtml += `<div class="scte-detail-item"><span class="scte-detail-label">Creative:</span><span class="scte-detail-value">${urlDetails.creative}</span></div>`;
                }
                if (urlDetails.params && Object.keys(urlDetails.params).length > 0) {
                    detectionHtml += `<div class="scte-detail-item"><span class="scte-detail-label">URL Params:</span><div class="scte-detail-params">`;
                    for (const [key, value] of Object.entries(urlDetails.params)) {
                        detectionHtml += `<div class="scte-param"><span class="scte-param-key">${key}:</span><span class="scte-param-value">${value}</span></div>`;
                    }
                    detectionHtml += `</div></div>`;
                }
            }
            detectionHtml += `
                  <div class="scte-detail-item">
                      <span class="scte-detail-label">Segment URL:</span>
                      <span class="scte-detail-value scte-url-value">${detection.url}</span>
                  </div>
            </div>`; // Close details

            detectionElement.innerHTML = detectionHtml;
            const summaryElement = detectionElement.querySelector('.scte-tag-summary');
            const rawParsedElement = detectionElement.querySelector('.scte-tag-parsed-raw');
            if (summaryElement && rawParsedElement) {
                summaryElement.style.cursor = 'pointer';
                summaryElement.title = 'Click to toggle raw SCTE-35 parsed data';
                summaryElement.addEventListener('click', (event) => {
                    event.stopPropagation();
                    rawParsedElement.style.display = rawParsedElement.style.display === 'none' ? 'block' : 'none';
                });
            }
            scteListElement.appendChild(detectionElement);
        });
    }
    
    function formatScteType(type, info) { // type is manager's classification (ad_start etc)
        if (info?.scteTagDetails) {
            // Use the detailed segmentation type name if available, else the manager's type
            const scteTypeName = info.segmentationTypeIdName || type;
            return `${scteTypeName.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())} (Tag)`;
        } else if (info?.urlDetails) {
            return `${type.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())} (URL)`;
        }
        return type.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
    }

    window.SCTEManager = {
        getState: () => ({ ...state }),
        resetState,
        analyzeUrl: (url) => extractScteInfo(url), // Keep for URL ad-hoc analysis
        addProvider: (key, name) => { state.knownProviders[key.toLowerCase()] = name; },
        getLastDetection: () => state.lastScteDetection, // Single most recent signal
        getLastScteDetectionsBatch: () => state.lastScteDetectionsBatch, // All signals from last segment event

        // Updated to reflect new parser's output stored in lastScteDetection.info.scteTagDetails.parsed
        getLastDecodedScte: () => state.lastScteDetection?.info?.scteTagDetails?.parsed || null,
        getLastEncodedScte: () => state.lastScteDetection?.info?.scteTagDetails?.encoded || null,

        // These might need adjustment based on what scteProcessingResult puts in lastScteDetection
        getLastScteDuration: () => state.lastScteDetection?.duration || null,
        getLastScteId: () => state.lastScteDetection?.id || null,
        getLastScteType: () => state.lastScteDetection?.type || null, // manager's type (ad_start etc)
        getCumulativeAdTime: () => state.cumulativeAdTime,

        getScteCount: () => { // Count of SCTE *descriptors* in the last batch
            const batch = state.lastScteDetectionsBatch;
            if (!batch || batch.length === 0) return 0;
            return batch.reduce((total, detection) => {
                const parsedComcast = detection?.info?.scteTagDetails?.parsed;
                return total + (parsedComcast?.descriptors?.length || 0);
            }, 0);
        },

        // This should return info about descriptors in the *single* lastScteDetection
        getLastScteDescriptorsInfo: () => { // Renamed from getLastScteDetection
            const parsedComcast = state.lastScteDetection?.info?.scteTagDetails?.parsed;
            if (!parsedComcast || !parsedComcast.descriptors) return [];
            return parsedComcast.descriptors.map((d, idx) => ({
                idx,
                spliceDescriptorTag: d.spliceDescriptorTag,
                // identifier: d.identifier, // "CUEI"
                // descriptorLength: d.descriptorLength,
                // You might want to add more specific fields depending on descriptor type
                // For example, for segmentation_descriptor (tag 0x02):
                segmentationEventId: d.segmentationEventId,
                segmentationTypeId: d.segmentationTypeId,
                // ... and so on, directly from the Comcast parser's descriptor object `d`
            }));
        },
        
        getScteAdStart: () => { // Uses the manager's extracted `isAdStart` and `duration`
            const last = state.lastScteDetection;
            if (!last || !last.info?.scteTagDetails) return { found: false }; // Only from tags
            
            if (last.type === 'ad_start' && last.duration > 0) { // Check manager's classified type
                 return {
                    found: true,
                    typeId: last.info.segmentationTypeId, // From extraction
                    typeIdName: last.info.segmentationTypeIdName, // Descriptive name
                    eventId: last.id, // Extracted ID
                    durationSeconds: last.duration // Extracted duration
                };
            }
            return { found: false };
        },

        getScteAdEnd: () => { // Uses the manager's extracted `isAdEnd`
            const last = state.lastScteDetection;
            if (!last || !last.info?.scteTagDetails) return { found: false }; // Only from tags

            if (last.type === 'ad_end') { // Check manager's classified type
                return {
                    found: true,
                    typeId: last.info.segmentationTypeId,
                    typeIdName: last.info.segmentationTypeIdName,
                    eventId: last.id,
                    durationSeconds: last.duration // May or may not be relevant for ad_end
                };
            }
            return { found: false };
        },      
                
        getLastDetectionAllScteTags: () => {
            const batch = state.lastScteDetectionsBatch;
            if (!batch || batch.length === 0) return null;
    
            return batch.map((detection, idx) => {
                if (!detection.info?.scteTagDetails) return { tagIndex: idx, error: "Not a tag-based detection" };
    
                // Accessing extracted info already on `detection.info` and `detection` itself
                return {
                    tagIndex: idx,
                    upidHex: detection.info.upidHex || 'N/A',         // Existing
                    upidAscii: detection.info.upidAscii || 'N/A',       // New
                    typeId: detection.info.segmentationTypeId,
                    typeIdName: detection.info.segmentationTypeIdName || detection.type,
                    eventId: detection.id || 'N/A',
                    descriptorCount: detection.info.scteTagDetails.parsed?.descriptors?.length || 0,
                    rawLine: detection.info.scteTagDetails.line || 'N/A',
                    summary: detection.info.scteTagDetails.summary || 'N/A'
                };
            });
        },

        getScteHex: () => { // Gets the original encoded hex string of the last single detection
            const lastTagDetails = state.lastScteDetection?.info?.scteTagDetails;
            if (lastTagDetails?.encodingType === 'hex') {
                return lastTagDetails.encoded;
            }
            // If it was base64, SCTECoreParser would have converted it.
            // To get the hex of a base64 original, we'd need to re-convert or store it.
            // For now, assume we want the original if it was hex.
            // parseLatestWithComcast will handle conversion if necessary.
            if (lastTagDetails?.encodingType === 'base64' && window.SCTECoreParser && window.SCTECoreParser._b64ToHex) {
                 // This _b64ToHex was an internal thought, not exposed.
                 // Let parseLatestWithComcast handle it. For now, return original encoded.
                 console.warn('[SCTEManager] getScteHex: last SCTE was base64, returning as is. parseLatestScte will handle conversion.');
                 return lastTagDetails.encoded; // It will be a base64 string
            }
            return lastTagDetails?.encoded || null;
        },
    
        parseLatestScte: () => {
            const lastTagDetails = state.lastScteDetection?.info?.scteTagDetails;
            if (!lastTagDetails || !lastTagDetails.encoded) {
                console.warn('[SCTEManager] No SCTE data available in last detection to parse with Comcast.');
                return null;
            }
            if (!window.SCTECoreParser) {
                 console.error('[SCTEManager] SCTECoreParser is not available.');
                 return { error: 'SCTECoreParser not available.'};
            }
            try {
                // SCTECoreParser.parseScteData returns the direct output of the Comcast parser
                // (plus originalEncoded/Type, which is fine)
                const parsedResult = window.SCTECoreParser.parseScteData(lastTagDetails.encoded, lastTagDetails.encodingType);
                
                if (parsedResult.error && !parsedResult.tableId) { // If it's purely an error object from our wrapper
                    console.error('[SCTEManager] Error parsing with SCTECoreParser for parseLatestScte:', parsedResult.error);
                } else {
                    console.log('[SCTEManager] Parsed SCTE-35 using SCTECoreParser (Comcast raw output):', parsedResult);
                }
                return parsedResult; // Return the raw Comcast parser output or our error object
            } catch (e) {
                console.error('[SCTEManager] Exception calling SCTECoreParser in parseLatestScte:', e);
                return { error: `Exception: ${e.message}` };
            }
        }
    };

})();