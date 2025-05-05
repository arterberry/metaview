// js/ui/scte_manager.js
// Description: Originally developed for detecting SCTE-35 signal detection, it now can identify and manage identification of ad creatives.

console.log('[scte_manager] Initializing...');

(function() {
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
        }
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
        scteStatusElement = document.getElementById('scteStatus');
        scteListElement = document.getElementById('scteList');
        adTimeElement = document.getElementById('adTimeTracker');

        if (!scteContainer || !scteStatusElement || !scteListElement) {
            createScteUI();
        }

        // Set up event listeners
        setupEventListeners();

        // Initialize state display
        updateScteStatusDisplay();
        updateAdTimeDisplay();

        console.log('[scte_manager] Initialization complete');
    }

    function createScteUI() {
        // Find the parent element where we'll insert our UI
        const parentElement = document.querySelector('#inspect-tab');
        if (!parentElement) {
            console.error('[scte_manager] Parent element for SCTE UI not found');
            return;
        }

        // Create SCTE section container
        const sectionElement = document.createElement('div');
        sectionElement.className = 'scte-section';
        sectionElement.innerHTML = `
            <div class="scte-label">Creatives Monitor:</div>
            <div id="scteContainer" class="scte-container">
                <div id="scteList" class="scte-list"></div>
            </div>
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
        updateScteStatusDisplay();
        updateAdTimeDisplay();
        updateScteList();
    }

    function handleSegmentAdded(event) {
        const segment = event.detail.segment || event.detail;
        if (!segment || !segment.url) return;

        // Check if segment URL contains "/creatives/" as per Fox streams pattern
        if (segment.url.includes('/creatives/')) {
            console.log('[scte_manager] Potential SCTE-35 creative detected:', segment.url);
            analyzeScteSegment(segment);
        }
    }

    function analyzeScteSegment(segment) {
        // Activate SCTE detection if not already active
        if (!state.active) {
            state.active = true;
            updateScteStatusDisplay();
        }

        // Extract meaningful information from the segment URL
        const scteInfo = extractScteInfo(segment.url);

        // Create detection entry with timestamp
        const detection = {
            timestamp: new Date(),
            segment: segment,
            info: scteInfo,
            type: determineScteType(scteInfo, segment.url),
            url: segment.url, // Store full URL
            provider: detectProvider(segment.url)
        };

        // Update cumulative ad time if duration is available
        if (scteInfo.duration) {
            state.cumulativeAdTime += scteInfo.duration;
            updateAdTimeDisplay();
        }

        // Add to our detections array (at the beginning for newest first)
        state.scteDetections.unshift(detection);

        // Limit size of history
        if (state.scteDetections.length > state.maxDetections) {
            state.scteDetections.pop();
        }

        // Update UI
        updateScteList();

        // Dispatch event for other components that might need to know about SCTE signals
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
            } else if (hostname.includes('foxsports') || hostname.includes('fox.com')) {
                provider.name = 'Fox Sports';
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
            detectionElement.className = `scte-detection scte-${detection.type}`;

            // Format time from timestamp
            const time = detection.timestamp.toLocaleTimeString([], {
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit'
            });

            // Extract ID or number from creative or id field to display
            const idNumber = detection.info.id || detection.info.creative || '0';

            // Get a short path for display directly under the number
            // const shortPath = getShortPathForDisplay(detection.url); // We are replacing this with the full URL below

            // Originally: <div class="scte-number">${idNumber}</div>

            // Create detection content
            let detectionHtml = `
                <div class="scte-detection-header">
                    <span class="scte-detection-type">${formatScteType(detection.type)}</span>
                    <span class="scte-detection-time">${time}</span>
                </div>
                <div class="scte-detection-number">                    
                    <!-- START CHANGE: Display full URL here in small print -->
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

            // Add ID if available
            if (detection.info.id) {
                detectionHtml += `
                    <div class="scte-detail-item">
                        <span class="scte-detail-label">ID:</span>
                        <span class="scte-detail-value">${detection.info.id}</span>
                    </div>
                `;
            }

            // Add creative info if available
            if (detection.info.creative && detection.info.creative !== 'Unknown') {
                detectionHtml += `
                    <div class="scte-detail-item">
                        <span class="scte-detail-label">Creative:</span>
                        <span class="scte-detail-value">${detection.info.creative}</span>
                    </div>
                `;
            }

            // Add duration if available
            if (detection.info.duration) {
                detectionHtml += `
                    <div class="scte-detail-item">
                        <span class="scte-detail-label">Duration:</span>
                        <span class="scte-detail-value">${detection.info.duration}s</span>
                    </div>
                `;
            }

            // Add time marker if available
            if (detection.info.timeMarker) {
                detectionHtml += `
                    <div class="scte-detail-item">
                        <span class="scte-detail-label">Time Marker:</span>
                        <span class="scte-detail-value">${detection.info.timeMarker}</span>
                    </div>
                `;
            }

            // Add SCTE35 data if available
            if (detection.info.scte35Data) {
                detectionHtml += `
                    <div class="scte-detail-item">
                        <span class="scte-detail-label">SCTE-35 Data:</span>
                        <span class="scte-detail-value">${detection.info.scte35Data}</span>
                    </div>
                `;
            }

            // Add URL parameters
            if (detection.info.params && Object.keys(detection.info.params).length > 0) {
                detectionHtml += `
                    <div class="scte-detail-item">
                        <span class="scte-detail-label">Parameters:</span>
                        <div class="scte-detail-params">
                `;

                for (const [key, value] of Object.entries(detection.info.params)) {
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

            // Close the details container
            detectionHtml += `</div>`;

            detectionElement.innerHTML = detectionHtml;

            // Add click handler to toggle details visibility
            detectionElement.addEventListener('click', () => {
                detectionElement.classList.toggle('expanded');
            });

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

    function formatScteType(type) {
        switch (type) {
            case 'ad_start':
                return 'SCTE Start';
            case 'ad_end':
                return 'SCTE End';
            case 'ad_marker':
                return 'Creatives Details';
            default:
                return 'SCTE Signal';
        }
    }

    // Make some functions available globally for debugging/extension
    window.SCTEManager = {
        getState: () => ({...state}),
        resetState,
        analyzeUrl: (url) => {
            console.log('[scte_manager] Manual URL analysis:', extractScteInfo(url));
            return extractScteInfo(url);
        },
        addProvider: (key, name) => {
            state.knownProviders[key.toLowerCase()] = name;
            console.log('[scte_manager] Added provider:', key, name);
        }
    };

})(); // IIFE ends