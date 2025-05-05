// js/ui/resolution_manager.js
console.log('[resolution_manager] Initializing...');

(function() {
    let hlsInstance = null;
    let variantsData = [];
    let hlsLevels = [];
    let resolutionListElement = null;
    let autoModeElement = null;

    let isParserDataReady = false;
    let isHlsInstanceProcessed = false; // Flag to track if we've processed the HLS instance (via event or fallback)
    let isHlsLevelsPopulated = false;

    document.addEventListener('DOMContentLoaded', init);

    function init() {
        resolutionListElement = document.getElementById('resolutionList');
        if (!resolutionListElement) {
            // console.error('[resolution_manager] Resolution list container #resolutionList not found.');
            return;
        }
        resolutionListElement.innerHTML = '<div class="resolution-item">Waiting for stream data...</div>';

        document.addEventListener('hlsPlaylistParsed', handleHlsPlaylistParsed);
        document.addEventListener('hlsLoaded', handleHlsLoaded); // Keep listener
        resolutionListElement.addEventListener('click', handleResolutionClick);

        // Initial check for global instance in case event was already missed
        checkGlobalHlsInstance();
    }

    // Function to check for and process the global HLS instance if available
    function checkGlobalHlsInstance() {
        if (!isHlsInstanceProcessed && window.hlsPlayerInstance) {
             // console.log('[resolution_manager] Found global HLS instance reference.');
             handleHlsLoaded({ detail: { hls: window.hlsPlayerInstance } });
        } else if (!isHlsInstanceProcessed && document.readyState === 'complete') {
             // If page is fully loaded and no instance found, maybe native playback?
             if (window.hlsPlayerInstance === null) { // Explicitly null means HLS not supported/used
                 // console.log('[resolution_manager] HLS.js instance is null (likely native playback or not supported). Controls disabled.');
                 isHlsInstanceProcessed = true; // Mark as processed
                 isHlsLevelsPopulated = true; // Mark as checked (no levels to populate)
                 tryEnableControls(); // Allow UI update for display-only mode
             }
        }
    }


    function handleHlsPlaylistParsed(event) {
        if (event.detail.type === 'master' && event.detail.variants && event.detail.variants.length > 0) {
            // console.log('[resolution_manager] Received master playlist variants from parser:', event.detail.variants);
            variantsData = event.detail.variants;
            isParserDataReady = true;
            displayInitialResolutions();
            tryEnableControls(); // Check conditions
        } else if (event.detail.type === 'media' && !isParserDataReady) {
             resolutionListElement.innerHTML = '<div class="resolution-item disabled" style="cursor:default;">No resolution variants (single stream).</div>';
             resolutionListElement.dataset.built = 'true';
             isParserDataReady = true; // Mark parser step as done
             tryEnableControls(); // Check if HLS state needs finalization
        }
    }

    function displayInitialResolutions() {
        // ... (Keep the previous `displayInitialResolutions` function exactly as it was in the hybrid approach) ...
        if (!resolutionListElement || !isParserDataReady) return;

        // console.log('[resolution_manager] Displaying initial resolutions based on parser data.');
        resolutionListElement.innerHTML = ''; // Clear previous content

        variantsData.forEach((variant, index) => {
            const resolution = variant.resolution || 'Audio/Other'; // Handle audio-only etc.
            const bandwidthKbps = variant.bandwidth ? Math.round(variant.bandwidth / 1000) : 'N/A';

            const item = document.createElement('div');
            item.className = 'resolution-item resolution-item-loading'; // Add loading class
            // Store bandwidth from parser to help matching later
            item.setAttribute('data-parser-bandwidth', variant.bandwidth || '0');
            item.setAttribute('data-parser-resolution', resolution); // Store resolution too

            const resText = document.createTextNode(`${index + 1}. Resolution: ${resolution}, `);
            item.appendChild(resText);

            const bwSpan = document.createElement('span');
            bwSpan.className = 'resolution-bw';
            bwSpan.textContent = `Bandwidth: ${bandwidthKbps} kbps`;
            item.appendChild(bwSpan);

            resolutionListElement.appendChild(item);
        });
        // Add a temporary message about controls loading
        const loadingMsg = document.createElement('div');
        loadingMsg.id = 'resolution-loading-controls';
        loadingMsg.className = 'resolution-item';
        loadingMsg.textContent = 'Loading controls...';
        loadingMsg.style.fontStyle = 'italic';
        loadingMsg.style.color = '#aaa';
        resolutionListElement.appendChild(loadingMsg);

        resolutionListElement.dataset.built = 'true'; // Mark initial build done
    }


    function handleHlsLoaded(event) {
        // Check if we've already processed the instance via the global fallback
        if (isHlsInstanceProcessed) {
             // console.log('[resolution_manager] handleHlsLoaded called, but instance already processed. Skipping.');
             return;
        }
        if (event.detail.hls) {
            // console.log('[resolution_manager] HLS instance received via hlsLoaded event.');
            hlsInstance = event.detail.hls; // Assign to local variable
            isHlsInstanceProcessed = true; // Mark as processed via event

            hlsInstance.on(Hls.Events.LEVEL_SWITCHED, handleLevelSwitched);
            hlsInstance.on(Hls.Events.MANIFEST_PARSED, (event, data) => {
                // console.log('[resolution_manager] HLS MANIFEST_PARSED event received.');
                if (hlsInstance.levels && hlsInstance.levels.length > 0) {
                    hlsLevels = hlsInstance.levels;
                    isHlsLevelsPopulated = true;
                    // console.log('[resolution_manager] HLS levels populated:', hlsLevels);
                } else {
                    // console.warn('[resolution_manager] MANIFEST_PARSED fired, but hls.levels seems empty.');
                    isHlsLevelsPopulated = true; // Mark as checked
                }
                tryEnableControls(); // Try to enable controls now
            });

            // Check if levels might already be populated when hlsLoaded fires
             if (hlsInstance.levels && hlsInstance.levels.length > 0) {
                 // console.log('[resolution_manager] HLS levels detected immediately on hlsLoaded.');
                 hlsLevels = hlsInstance.levels;
                 isHlsLevelsPopulated = true;
                 tryEnableControls();
             } else {
                 // If levels aren't ready yet, wait for MANIFEST_PARSED
                 // console.log('[resolution_manager] HLS levels not immediately available, waiting for MANIFEST_PARSED.');
             }
        } else {
             // Event fired but no HLS instance? Should not happen with current player_loader
             // console.warn('[resolution_manager] hlsLoaded event fired, but no HLS instance in detail.');
             isHlsInstanceProcessed = true; // Mark as processed to avoid infinite checks
             isHlsLevelsPopulated = true;
             tryEnableControls();
        }
    }


    function tryEnableControls() {
        // Check for global instance as a fallback if event was missed
        if (!isHlsInstanceProcessed) {
            checkGlobalHlsInstance(); // Attempt to get instance if not processed yet
        }

        // console.log(`[resolution_manager] tryEnableControls Check: Built=${resolutionListElement.dataset.built}, InstanceProcessed=${isHlsInstanceProcessed}, LevelsPopulated=${isHlsLevelsPopulated}`);

        // Proceed if initial display is done AND HLS instance processing is complete AND levels have been checked
        if (resolutionListElement.dataset.built === 'true' && isHlsInstanceProcessed && isHlsLevelsPopulated) {
            enableResolutionControls();
        } else {
             // console.log('[resolution_manager] Conditions not met to enable controls.');
        }
    }

    function enableResolutionControls() {
        if (resolutionListElement.dataset.controlsEnabled === 'true') return; // Already enabled
        // console.log('[resolution_manager] Enabling resolution controls.');

        const loadingMsg = document.getElementById('resolution-loading-controls');
        if (loadingMsg) loadingMsg.remove();

        // Check if HLS.js is actually being used
        if (!hlsInstance) {
             // console.log('[resolution_manager] HLS.js not active. Controls remain disabled.');
             resolutionListElement.querySelectorAll('.resolution-item-loading').forEach(item => {
                  item.classList.remove('resolution-item-loading');
                  item.classList.add('resolution-item', 'disabled');
                  item.style.cursor = 'default';
                  item.style.opacity = '0.7';
             });
             resolutionListElement.dataset.controlsEnabled = 'true'; // Mark as 'done'
             return; // Exit if no HLS instance
        }

        // Add "Auto (ABR)" option
        autoModeElement = document.createElement('div');
        autoModeElement.className = 'resolution-item-auto';
        // autoModeElement.textContent = 'Auto (ABR)';
        autoModeElement.setAttribute('data-level-index', '-1');
        if (resolutionListElement.firstChild) {
             resolutionListElement.insertBefore(autoModeElement, resolutionListElement.firstChild);
        } else {
             resolutionListElement.appendChild(autoModeElement);
        }

        const listItems = resolutionListElement.querySelectorAll('.resolution-item-loading');
        listItems.forEach(item => {
            const parserBandwidth = parseInt(item.getAttribute('data-parser-bandwidth') || '0', 10);
            let matchedLevelIndex = -1;
            let minDiff = Infinity;

            hlsLevels.forEach((level, index) => {
                const diff = Math.abs(level.bitrate - parserBandwidth);
                if (diff < minDiff) {
                    minDiff = diff;
                    matchedLevelIndex = index;
                }
            });

            if (matchedLevelIndex !== -1) {
                item.setAttribute('data-level-index', matchedLevelIndex);
                item.classList.remove('resolution-item-loading');
                item.classList.add('resolution-item');
            } else {
                // console.warn(`[resolution_manager] Could not match HLS level for parser BW ${parserBandwidth}. Disabling item.`);
                item.classList.remove('resolution-item-loading');
                item.classList.add('resolution-item', 'disabled');
                item.style.cursor = 'default';
                item.style.opacity = '0.7';
            }
        });

        resolutionListElement.dataset.controlsEnabled = 'true';
        updateSelectedVisuals(hlsInstance.currentLevel);
        // console.log('[resolution_manager] Resolution controls enabled.');
    }


    function handleResolutionClick(event) {
        const targetItem = event.target.closest('[data-level-index]');
        // Check if controls are enabled and we have an HLS instance
        if (!targetItem || !hlsInstance || resolutionListElement.dataset.controlsEnabled !== 'true' || targetItem.classList.contains('disabled')) {
            // console.log('[resolution_manager] Click ignored: Controls not enabled, HLS missing, or item disabled.');
            return;
        }

        const levelIndex = parseInt(targetItem.getAttribute('data-level-index'), 10);
        // console.log(`[resolution_manager] User selected level index: ${levelIndex}`);
        hlsInstance.currentLevel = levelIndex;
        updateSelectedVisuals(levelIndex);
    }

    // ... (Keep `handleLevelSwitched` and `updateSelectedVisuals` exactly as before) ...
    function handleLevelSwitched(event, data) {
         const actualLevel = data.level;
         // console.log(`[resolution_manager] HLS confirmed level switch to index: ${actualLevel}`);
         updateSelectedVisuals(actualLevel);
    }

    function updateSelectedVisuals(selectedIndex) {
        if (!resolutionListElement) return;
        // console.log(`[resolution_manager] Updating selected visual to index: ${selectedIndex}`);

        resolutionListElement.querySelectorAll('[data-level-index]').forEach(el => {
            el.classList.remove('selected');
        });

        const activeElement = resolutionListElement.querySelector(`[data-level-index="${selectedIndex}"]`);
        if (activeElement) {
            activeElement.classList.add('selected');
        } else {
             if (selectedIndex === -1 && autoModeElement) {
                  autoModeElement.classList.add('selected');
                  // console.log('[resolution_manager] Selected "Auto (ABR)" visually.');
             } else {
                  // console.warn(`[resolution_manager] Could not find element for level index ${selectedIndex} to visually select.`);
             }
        }
    }


})(); // IIFE closes