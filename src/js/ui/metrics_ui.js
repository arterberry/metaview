// js/ui/metrics_ui.js


console.log('[metrics_ui] Initializing Metrics UI…');

(function () {

    console.log('[metrics_ui] IIFE running');

    const bufferStalledState = {
        start: null,
        end:   null,
        duration: null
    };

    // Metrics state
    const qoeData = {
        startTime: null,
        loadStart: null,
        firstFrame: null,
        qualitySwitches: 0,
        currentBitrate: null,
        currentResolution: null,
        rebufferingEvents: 0,
        rebufferingDurations: [],
        lastRebufferStart: null,
        audioTracks: [],
        currentAudioTrack: null,
        currentAudioCodec: '?',
        subtitleTracks: [],
        downloadSpeed: [],
        throughput: [],
        latency: [],
        cdnProvider: 'Unknown',
        playbackRate: 1,
        eventHistory: [],
        // QoS data
        segmentDownloadTimes: [],
        totalSegmentsRequested: 0,
        totalSegmentsLoaded: 0,
        totalSegmentsFailed: 0,
        playlistLatencies: []
    };

    // To store fragment timing data temporarily
    let fragmentLoadingData = {};

    // -----------------------
    // DOM Ready Listener
    // -----------------------
    document.addEventListener('DOMContentLoaded', () => {
        console.log('[metrics_ui] DOMContentLoaded');
        setupDetailTabs();
        updateQoEDisplay(); // Initial render with N/A values
    });

    // -----------------------
    // HLS Player Loaded Listener (Crucial Fix Here)
    // -----------------------
    document.addEventListener('hlsLoaded', e => {
        console.log('[metrics_ui] hlsLoaded event received');

        // 1. Get the HLS instance directly from the event detail
        const hls = e.detail.hls;

        // 2. Check if the HLS instance exists
        if (!hls) {
            console.error('[metrics_ui] hlsLoaded event fired, but no HLS instance found in e.detail.hls. Cannot attach listeners.');
            return; // Stop if no hls instance
        }

        // 3. If the HLS instance IS valid, call hookVideoAndHls and PASS the instance
        console.log('[metrics_ui] HLS instance found, calling hookVideoAndHls...');
        hookVideoAndHls(hls); // Pass the 'hls' instance as an argument

        // 4. Optional: Initial UI update (usually not needed as events trigger updates)
        // updateQoEDisplay();

    }); // End of hlsLoaded event listener


    // -----------------------
    // Tab switching Logic
    // -----------------------
    function setupDetailTabs() {
        // Select ONLY the tab container within the main qoe-tab pane
        const tabsContainer = document.querySelector('#qoe-tab .qoe-details-tabs'); 
        if (!tabsContainer) {
            console.warn('[metrics_ui] Could not find QoE details tabs container.');
            return;
        }
        // Find the content container relative to the tabs
        const contentContainer = tabsContainer.nextElementSibling; 
        if (!contentContainer || !contentContainer.classList.contains('qoe-details-content')) {
            console.warn('[metrics_ui] Could not find QoE details content container.');
            return;
        }

        tabsContainer.addEventListener('click', e => {
            const btn = e.target.closest('.qoe-details-tab');
            if (!btn || !btn.dataset.qoeTab) return; // Ensure it's a tab button with data attribute

            // Deactivate all tabs within THIS container
            tabsContainer.querySelectorAll('.qoe-details-tab').forEach(t => t.classList.remove('active'));

            // Deactivate all panels within the corresponding content container
            if (contentContainer) {
                contentContainer.querySelectorAll('.qoe-details-panel').forEach(p => p.classList.remove('active'));
            }

            // Activate the clicked tab
            btn.classList.add('active');

            // Activate the corresponding panel
            const panelId = btn.dataset.qoeTab + '-panel';
            const panel = contentContainer ? contentContainer.querySelector('#' + panelId) : null;
            if (panel) {
                panel.classList.add('active');
            } else {
                console.warn(`[metrics_ui] Panel with ID ${panelId} not found.`);
            }
        });
    }


    // -----------------------
    // Attach video + Hls.js listeners
    // Accepts the HLS instance as a parameter
    // -----------------------
    function hookVideoAndHls(hls) {
        console.log('[metrics_ui] hookVideoAndHls called with HLS instance:', hls);

        // Listener for CDN info from other modules (if applicable)
        document.addEventListener('cdnInfoDetected', e => {
            detectCDN(e.detail.url, e.detail.headers);
            updateQoEDisplay();
        });

        const video = document.getElementById('hlsVideoPlayer');

        // Helper function for playlist latency (defined within scope or globally)
        const handlePlaylistLoadStats = (eventName, stats) => {
            if (stats && stats.tfirst > 0 && stats.trequest > 0 && stats.tfirst >= stats.trequest) {
                const latencyMs = stats.tfirst - stats.trequest;
                qoeData.playlistLatencies.push(latencyMs);
                console.log(`[metrics_ui] Playlist Latency (${eventName}): ${latencyMs.toFixed(0)} ms`); // Debug log
                updateQoEDisplay(); // Update display after getting new latency data
            }
        };

        // --- Video Element Listeners ---
        if (video) {
            console.log('[metrics_ui] Attaching video element listeners');
            qoeData.startTime = performance.now();
            video.addEventListener('loadstart', () => {
                qoeData.loadStart = performance.now();
                addEvent('Video Load Started', 'startup');
                updateQoEDisplay();
            });
            video.addEventListener('loadeddata', () => {
                if (!qoeData.firstFrame) {
                    qoeData.firstFrame = performance.now();
                    addEvent(`First frame after ${((qoeData.firstFrame - qoeData.startTime) / 1000).toFixed(2)}s`, 'info');
                    updateQoEDisplay();
                }
                // Native audio track check (keep for debugging/info)
                if (video.audioTracks && video.audioTracks.length > 0 && qoeData.audioTracks.length === 0) {
                    addEvent(`Detected ${video.audioTracks.length} native audio track(s) (might be muxed)`);
                } else if (video.audioTracks && video.audioTracks.length === 0 && qoeData.audioTracks.length > 0 && qoeData.audioTracks[0]?.name?.includes('Inferred')) {
                     console.log('[metrics_ui] Native video element reports NO audio tracks, but inferred track exists.');
                }
            });
            video.addEventListener('waiting', () => {
                qoeData.lastRebufferStart = performance.now();
                addEvent('Buffering start', 'rebuffer');
                updateQoEDisplay();
            });
            video.addEventListener('playing', () => {
                if (qoeData.lastRebufferStart) {
                    const d = (performance.now() - qoeData.lastRebufferStart) / 1000;
                    qoeData.rebufferingEvents++;
                    qoeData.rebufferingDurations.push(d);
                    addEvent(`Buffering end after ${d.toFixed(2)}s`, 'rebuffer');
                    qoeData.lastRebufferStart = null;
                    updateQoEDisplay();
                }
                // If we previously saw a bufferStalledError, mark its end now
                if (bufferStalledState.start && !bufferStalledState.end) {
                    bufferStalledState.end = new Date();
                    bufferStalledState.duration = (bufferStalledState.end - bufferStalledState.start) / 1000;
                }                
            });
            video.addEventListener('ratechange', () => {
                qoeData.playbackRate = video.playbackRate;
                addEvent(`Rate changed to ${video.playbackRate}x`);
                updateQoEDisplay();
            });
        } else {
             console.error("[metrics_ui] Video element #hlsVideoPlayer not found!");
        }

        // --- HLS.js Event Listeners ---
        // Ensure HLS instance is valid before attaching listeners
        if (hls && typeof hls.on === 'function') {
            console.log('[metrics_ui] Attaching HLS.js event listeners');

            hls.on(Hls.Events.LEVEL_SWITCHED, (_, data) => {
                qoeData.qualitySwitches++;
                const lvl = hls.levels[data.level];
                if (!lvl) return;

                qoeData.currentBitrate = lvl.bitrate;
                qoeData.currentResolution = `${lvl.width}x${lvl.height}`;
                let eventMsg = `Quality → ${qoeData.currentResolution}`;

                // Handle audio codec info on level switch
                if (lvl.audioCodec) {
                    const newCodec = lvl.audioCodec;
                    eventMsg += ` (Audio: ${newCodec})`;
                    if (qoeData.audioTracks.length === 0) { // Infer if no tracks exist yet
                         qoeData.audioTracks.push({ id: 0, name: 'Inferred Muxed Audio', language: 'und', default: true, codec: newCodec });
                         qoeData.currentAudioTrack = 0;
                         qoeData.currentAudioCodec = newCodec;
                         addEvent(`Identified muxed audio (Codec: ${newCodec})`, 'audio');
                    } else if (qoeData.audioTracks.length === 1 && qoeData.audioTracks[0].id === 0 && qoeData.audioTracks[0].codec !== newCodec) { // Update inferred track codec
                         qoeData.audioTracks[0].codec = newCodec;
                         qoeData.currentAudioCodec = newCodec;
                         addEvent(`Audio codec updated to ${newCodec}`, 'audio');
                    } else if (qoeData.currentAudioTrack !== null) { // Update codec of the currently active *explicit* track if it was unknown
                        const activeTrack = qoeData.audioTracks.find(t => t.id === qoeData.currentAudioTrack);
                        if (activeTrack && (!activeTrack.codec || activeTrack.codec === '?')) {
                             activeTrack.codec = newCodec;
                             qoeData.currentAudioCodec = newCodec; // Update global state too
                             addEvent(`Active audio track codec updated to ${newCodec}`, 'audio');
                        } else if (activeTrack && activeTrack.codec !== newCodec) {
                             // Potentially log a mismatch if codec changes for an explicit track?
                             console.warn(`Codec mismatch on level switch for track ${activeTrack.id}: ${activeTrack.codec} vs ${newCodec}`);
                             qoeData.currentAudioCodec = newCodec; // Assume level info is correct for current playback state
                        } else {
                             qoeData.currentAudioCodec = newCodec; // Update global state if no specific track match needed update
                        }
                    } else {
                         qoeData.currentAudioCodec = newCodec; // Update global state
                    }
                } else { // Level has no audio codec info
                     eventMsg += ` (No audio codec info)`;
                     // Only reset to '?' if we currently have an inferred track or no track
                     if (qoeData.audioTracks.length === 0 || (qoeData.audioTracks.length === 1 && qoeData.audioTracks[0].id === 0)) {
                          if (qoeData.audioTracks.length === 1) qoeData.audioTracks[0].codec = '?';
                          qoeData.currentAudioCodec = '?';
                     }
                }
                addEvent(eventMsg, 'quality-change');
                updateQoEDisplay();
            });

            hls.on(Hls.Events.FRAG_LOADING, (_, data) => {
                if (!data || !data.frag) return;
                fragmentLoadingData[data.frag.sn] = {
                    start: performance.now(),
                    url: data.frag.url
                };
                qoeData.totalSegmentsRequested++;
                console.log(`[metrics_ui] FRAG_LOADING: SN=${data.frag.sn}, Req=${qoeData.totalSegmentsRequested}`); // Debug log
                updateQoEDisplay(); // Update success rate display immediately
            });

            hls.on(Hls.Events.LEVEL_LOADED, (_, data) => {
                if (data.stats) {
                    handlePlaylistLoadStats('Level Playlist', data.stats);
                }
            });

            hls.on(Hls.Events.FRAG_LOADED, (_, data) => {
                if (!data || !data.frag || !data.stats) return;
                const info = fragmentLoadingData[data.frag.sn];
                if (!info) return;

                const loadMs = performance.now() - info.start;
                const bytes = data.stats.total;

                qoeData.totalSegmentsLoaded++;
                 console.log(`[metrics_ui] FRAG_LOADED: SN=${data.frag.sn}, Loaded=${qoeData.totalSegmentsLoaded}, Time=${loadMs.toFixed(0)}ms`); // Debug log

                if (loadMs > 0) {
                    qoeData.segmentDownloadTimes.push(loadMs);
                    qoeData.throughput.push((bytes * 8) / (loadMs / 1000));
                    qoeData.downloadSpeed.push(bytes / (loadMs / 1000));
                }

                // Latency
                const entries = performance.getEntriesByName(info.url);
                if (entries.length) {
                    const e = entries[entries.length - 1];
                    if (e.responseStart > 0 && e.requestStart > 0 && e.responseStart >= e.requestStart) {
                        qoeData.latency.push(e.responseStart - e.requestStart);
                    }
                }

                // Fallback bitrate/resolution/codec capture
                const lvlInfo = hls.levels[data.frag.level];
                if (lvlInfo) {
                    qoeData.currentBitrate = lvlInfo.bitrate; // Update even if no level switch fired
                    qoeData.currentResolution = `${lvlInfo.width}x${lvlInfo.height}`;
                    // Simplified fallback codec update - only if current is unknown
                    if (lvlInfo.audioCodec && qoeData.currentAudioCodec === '?') {
                         qoeData.currentAudioCodec = lvlInfo.audioCodec;
                         // If inferred track exists, update its codec too
                         if (qoeData.audioTracks.length === 1 && qoeData.audioTracks[0].id === 0) {
                              qoeData.audioTracks[0].codec = lvlInfo.audioCodec;
                         }
                         addEvent(`Audio codec updated via fragment: ${lvlInfo.audioCodec}`, 'audio');
                    }
                }

                // CDN detection
                detectCDN(info.url, data.stats.headers);

                delete fragmentLoadingData[data.frag.sn];
                updateQoEDisplay(); // Crucial update after processing fragment
            });

            hls.on(Hls.Events.MANIFEST_PARSED, (_, data) => {
                console.log('[metrics_ui] MANIFEST_PARSED');
                let explicitAudioTracksFound = false;

                if (data.stats) {
                    handlePlaylistLoadStats('Manifest', data.stats);
                }

                // Process Audio Tracks
                if (data.audioTracks && data.audioTracks.length > 0) {
                    explicitAudioTracksFound = true;
                    qoeData.audioTracks = data.audioTracks.map(t => ({
                        id: t.id,
                        name: t.name || `Track ${t.id}`,
                        language: t.lang || 'und',
                        default: !!t.default,
                        codec: t.audioCodec || '?' // Capture codec
                    }));
                    addEvent(`Detected ${qoeData.audioTracks.length} explicit audio track(s)`, 'audio');

                    let initialTrack = qoeData.audioTracks.find(t => t.default) || qoeData.audioTracks[0];
                    if (initialTrack) {
                        qoeData.currentAudioTrack = initialTrack.id;
                        qoeData.currentAudioCodec = initialTrack.codec || '?';
                        addEvent(`Initial audio: ${initialTrack.name} (ID: ${initialTrack.id}, Codec: ${qoeData.currentAudioCodec})`, 'audio-switch');
                    } else {
                         qoeData.currentAudioTrack = null;
                         qoeData.currentAudioCodec = '?';
                    }
                } else {
                    qoeData.audioTracks = []; // Clear any previous tracks if manifest has none
                    qoeData.currentAudioTrack = null;
                    qoeData.currentAudioCodec = '?';
                    addEvent(`No explicit audio tracks found in manifest`, 'audio');
                }

                // Process Subtitle Tracks
                if (data.subtitles && data.subtitles.length > 0) {
                     qoeData.subtitleTracks = data.subtitles.map(t => ({
                          id: t.id, name: t.name || `Subtitle ${t.id}`, language: t.lang || 'und', default: !!t.default
                     }));
                     addEvent(`Detected ${qoeData.subtitleTracks.length} subtitle track(s)`);
                } else {
                     qoeData.subtitleTracks = [];
                }

                // Set Initial Quality & Infer Muxed Audio if needed
                if (hls.levels.length > 0) {
                    let initialLevelIndex = hls.startLevel !== -1 ? hls.startLevel : (hls.currentLevel !== -1 ? hls.currentLevel : 0);
                    initialLevelIndex = Math.max(0, Math.min(initialLevelIndex, hls.levels.length - 1)); // Clamp index

                    const lvl = hls.levels[initialLevelIndex];
                    if (lvl) {
                        qoeData.currentBitrate = lvl.bitrate;
                        qoeData.currentResolution = `${lvl.width}x${lvl.height}`;
                        let qualityEventMsg = `Initial Quality → ${qoeData.currentResolution}`;

                        if (lvl.audioCodec) {
                            qualityEventMsg += ` (Audio: ${lvl.audioCodec})`;
                            if (!explicitAudioTracksFound) { // Infer only if no explicit tracks
                                qoeData.currentAudioCodec = lvl.audioCodec;
                                qoeData.audioTracks = [{ id: 0, name: 'Inferred Muxed Audio', language: 'und', default: true, codec: lvl.audioCodec }];
                                qoeData.currentAudioTrack = 0;
                                addEvent(`Identified muxed audio (Codec: ${lvl.audioCodec})`, 'audio');
                            } else if (qoeData.currentAudioCodec === '?') { // Update current explicit track if codec was unknown
                                qoeData.currentAudioCodec = lvl.audioCodec;
                                const currentTrackObj = qoeData.audioTracks.find(t => t.id === qoeData.currentAudioTrack);
                                if (currentTrackObj) currentTrackObj.codec = lvl.audioCodec;
                                addEvent(`Updated initial audio track codec to ${lvl.audioCodec}`, 'audio');
                            }
                        } else {
                            qualityEventMsg += ` (No audio codec info)`;
                            if (!explicitAudioTracksFound) qoeData.currentAudioCodec = '?';
                        }
                        addEvent(qualityEventMsg, 'quality-change');
                    } else {
                         addEvent(`Initial quality level not found (Index: ${initialLevelIndex})`, 'error');
                    }
                } else {
                     addEvent(`No quality levels found in manifest`, 'error');
                }

                updateQoEDisplay(); // Update UI after parsing everything
            });

            hls.on(Hls.Events.AUDIO_TRACKS_UPDATED, (_, data) => {
                 console.log('[metrics_ui] AUDIO_TRACKS_UPDATED fired');
                 const previouslyInferred = qoeData.audioTracks.length === 1 && qoeData.audioTracks[0].id === 0;

                 if (data.audioTracks && data.audioTracks.length > 0) {
                      qoeData.audioTracks = data.audioTracks.map(t => ({ id: t.id, name: t.name || `Track ${t.id}`, language: t.lang || 'und', default: !!t.default, codec: t.audioCodec || '?' }));
                      const currentTrackIndex = hls.audioTrack; // HLS gives index in the *new* list
                      const activeTrack = qoeData.audioTracks[currentTrackIndex]; // Get from our mapped array

                      if (activeTrack) {
                           qoeData.currentAudioTrack = activeTrack.id; // Store the ID
                           qoeData.currentAudioCodec = activeTrack.codec || '?'; // Update codec
                           const message = previouslyInferred ? `Replaced inferred audio with ${qoeData.audioTracks.length} explicit track(s)` : `Updated audio tracks list (${qoeData.audioTracks.length} found)`;
                           addEvent(message, 'audio');
                           addEvent(`Audio → ${activeTrack.name || activeTrack.id} (ID: ${activeTrack.id}, Codec: ${qoeData.currentAudioCodec})`, 'audio-switch');
                      } else {
                           qoeData.currentAudioTrack = null; // Fallback
                           qoeData.currentAudioCodec = '?';
                           addEvent(`Audio tracks updated, but couldn't identify active track (Index: ${currentTrackIndex})`, 'error');
                      }
                 } else { // Event fired with empty list
                      if (!previouslyInferred) { // Clear only if we didn't have an inferred track
                           qoeData.audioTracks = [];
                           qoeData.currentAudioTrack = null;
                           qoeData.currentAudioCodec = '?';
                           addEvent(`Explicit audio tracks list cleared`, 'audio');
                      } else {
                           addEvent(`AUDIO_TRACKS_UPDATED: Fired with empty list, keeping inferred track`, 'audio');
                      }
                 }
                 updateQoEDisplay();
            });

            hls.on(Hls.Events.AUDIO_TRACK_SWITCHED, (_, data) => {
                const switchedTrackId = data.id;
                const switchedTrack = qoeData.audioTracks.find(track => track.id === switchedTrackId);

                if (switchedTrack) {
                    qoeData.currentAudioTrack = switchedTrackId;
                    qoeData.currentAudioCodec = switchedTrack.codec || '?';
                    addEvent(`Audio → ${switchedTrack.name || switchedTrackId} (ID: ${switchedTrackId}, Codec: ${qoeData.currentAudioCodec})`, 'audio-switch');
                } else { // Track not found in our list, update based on ID HLS gave
                    qoeData.currentAudioTrack = switchedTrackId;
                    qoeData.currentAudioCodec = '?'; // Codec is unknown
                    addEvent(`Audio → Switched to unknown track ID: ${switchedTrackId}`, 'audio-switch');
                }
                updateQoEDisplay();
            });

            // --- Consolidated Error Handling ---                        
            const genericErrorHandler = (_, data) => {

                // Detect Buffer‐Stalled start
                if (data.details === Hls.ErrorDetails.BUFFER_STALLED_ERROR) {
                    bufferStalledState.start = new Date();
                    bufferStalledState.end = null;
                }

                // Detect Buffer‐Stalled start (and fire our custom “nudge” event)
                if (data.details === Hls.ErrorDetails.BUFFER_STALLED_ERROR) {
                    bufferStalledState.start = new Date();
                    bufferStalledState.end = null;

                    // 1) Log it in the QoE event history
                    addEvent('Buffer Nudge on Stall', 'rebuffer');

                    // 2) Dispatch a DOM event so other modules (e.g. statusbar_manager) can listen
                    document.dispatchEvent(new CustomEvent('bufferNudgeOnStall', {
                        detail: { time: bufferStalledState.start }
                    }));
                }                

                let errorMessage = `HLS Error: ${data.type || 'Unknown Type'} - ${data.details || 'No Details'}`;
                if (data.fatal) errorMessage += " (Fatal)";
                if (data.reason) errorMessage += ` Reason: ${data.reason}`;
                if (data.context) {
                    if (data.context.url) errorMessage += ` URL: ${data.context.url}`;
                    if (typeof data.context.level === 'number') errorMessage += ` Level: ${data.context.level}`;
                }

                // ***** START CORRECTION *****
                // Check for segment failure count using string comparison for context type

                // Check for Network Errors related to fragments
                if (data.type === Hls.ErrorTypes.NETWORK_ERROR &&
                    data.context &&
                    typeof data.context.type === 'string' && // Ensure context.type is a string
                    data.context.type.toLowerCase() === 'fragment' && // Compare with string "fragment"
                    (data.details === Hls.ErrorDetails.FRAG_LOAD_ERROR ||
                        data.details === Hls.ErrorDetails.FRAG_LOAD_TIMEOUT)) {
                    qoeData.totalSegmentsFailed++;
                    console.log(`[metrics_ui] Segment network failure detected: ${data.details}, FailCount=${qoeData.totalSegmentsFailed}`);
                }
                // Check for Media Errors (like parsing) related to fragments
                else if (data.type === Hls.ErrorTypes.MEDIA_ERROR &&
                    data.context &&
                    typeof data.context.type === 'string' && // Ensure context.type is a string
                    data.context.type.toLowerCase() === 'fragment' && // Compare with string "fragment"
                    data.details === Hls.ErrorDetails.FRAG_PARSING_ERROR) {
                    qoeData.totalSegmentsFailed++;
                    console.log(`[metrics_ui] Segment parsing failure detected, FailCount=${qoeData.totalSegmentsFailed}`);
                }
                // ***** END CORRECTION *****

                console.error('HLS Error Event:', data); // Log full error object
                addEvent(errorMessage, 'error');

                // Log potential audio-specific errors
                if ((data.details && data.details.toLowerCase().includes('audio')) || (data.type && data.type.toLowerCase().includes('audio'))) {
                    addEvent(`Potential Audio Error Detected: ${data.details || data.type}`, 'error');
                }

                updateQoEDisplay(); // Update UI after error
            }; // End genericErrorHandler

            // Attach the single handler
            hls.on(Hls.Events.ERROR, genericErrorHandler);

            // Cleanup listener on unload (optional but good practice)
            // window.addEventListener('beforeunload', () => {
            //    if (hls) {
            //        hls.off(Hls.Events.ERROR, genericErrorHandler);
            //    }
            // });

        } else {
             console.error("[metrics_ui] HLS instance provided to hookVideoAndHls was invalid or missing 'on' method.");
        }
    } // End hookVideoAndHls


    // -----------------------
    // Render QoS Tab Metrics
    // -----------------------
    function renderQoS() {
        const container = document.getElementById('qosContainer');
        if (!container) {
            console.warn('[metrics_ui] QoS container not found'); // Only log once if needed
            return;
        }

        // Helper to calculate average safely
        const safeAvg = (arr) => {
            if (!arr || arr.length === 0) return null;
            // Filter out non-numeric values before summing
            const numericArr = arr.filter(item => typeof item === 'number' && isFinite(item));
            if (numericArr.length === 0) return null;
            const sum = numericArr.reduce((a, b) => a + b, 0);
            return sum / numericArr.length;
        };

        // 1. Available Bandwidth Estimation (Using average download speed in Bps -> Mbps)
        const avgBwBytesPerSec = safeAvg(qoeData.downloadSpeed);
        document.getElementById('availableBandwidth').textContent = avgBwBytesPerSec !== null
            ? (avgBwBytesPerSec * 8 / 1e6).toFixed(2) + ' Mbps'
            : 'N/A';

        // 2. Average Segment Download Time
        const avgSegTimeMs = safeAvg(qoeData.segmentDownloadTimes);
        document.getElementById('avgSegmentDownloadTime').textContent = avgSegTimeMs !== null
            ? (avgSegTimeMs < 1000 ? avgSegTimeMs.toFixed(0) + ' ms' : (avgSegTimeMs / 1000).toFixed(2) + ' s')
            : 'N/A';

        // 3. Segment Success Rate
        let successRateText = 'N/A';
        if (qoeData.totalSegmentsRequested > 0) {
            // Ensure loaded count doesn't exceed requested (can happen in rare race conditions)
            const loaded = Math.min(qoeData.totalSegmentsLoaded, qoeData.totalSegmentsRequested);
            const rate = (loaded / qoeData.totalSegmentsRequested) * 100;
            successRateText = rate.toFixed(1) + `% (${loaded}/${qoeData.totalSegmentsRequested})`;
        } else if (qoeData.totalSegmentsRequested === 0 && qoeData.totalSegmentsLoaded === 0 && qoeData.totalSegmentsFailed === 0) {
             successRateText = '100% (0/0)'; // Or 'N/A'
        }
        document.getElementById('segmentSuccessRate').textContent = successRateText;

        // 4. Server Response Time (Average Playlist Latency)
        const avgPlaylistLatency = safeAvg(qoeData.playlistLatencies);
        document.getElementById('serverResponseTime').textContent = avgPlaylistLatency !== null
            ? `${avgPlaylistLatency.toFixed(0)} ms`
            : 'N/A';

        // 5. Packet Loss Rate (Static)
        // document.getElementById('packetLossRate').textContent = 'N/A (Not Measurable)';
    }


    // -----------------------
    // Event history Rendering
    // -----------------------
    function addEvent(msg, type = 'info') { // Default type to 'info'
        const ev = { time: new Date(), msg, type };
        qoeData.eventHistory.unshift(ev); // Add to beginning
        if (qoeData.eventHistory.length > 100) { // Limit history size
            qoeData.eventHistory.pop();
        }
        renderHistory(); // Update display immediately
    }

    function renderHistory() {
        const container = document.getElementById('qoeEventHistory');
        if (!container) return;
        container.innerHTML = ''; // Clear previous history
        if (qoeData.eventHistory.length === 0) {
            container.innerHTML = '<div class="qoe-empty-history">No events recorded yet</div>';
            return;
        }
        qoeData.eventHistory.forEach(ev => {
            const div = document.createElement('div');
            // Add base class and event-type class
            div.className = `qoe-history-event event-${ev.type}`;
            // Format timestamp and message
            div.innerHTML = `<span class="qoe-history-timestamp">[${ev.time.toLocaleTimeString()}]</span> ${ev.msg}`;
            container.appendChild(div);
        });
    }

    // -----------------------
    // CDN detection Logic
    // -----------------------
    /**
     * Detects the Content Delivery Network (CDN) based on response headers and URL.
     * Prioritizes more specific header checks before broader ones or URL fallbacks.
     *
     * @param {string} url The URL of the resource.
     * @param {Object<string, string>} [headers={}] The HTTP response headers.
     * @returns {void} Updates qoeData.cdnProvider and logs changes.
    */
    function detectCDN(url, headers = {}) {
        // 1. Input Validation
        if (!url) return;

        // 2. Initialization
        const u = url.toLowerCase();
        let cdn = 'Unknown'; // Start with Unknown
        // Assuming qoeData and addEvent are available in the scope
        // let currentCDN = qoeData.cdnProvider; // Get current CDN before detection

        // 3. Header Normalization (Case-Insensitive)
        const lowerCaseHeaders = {};
        for (const key in headers) {
            // Ensure own properties and handle potential null/undefined headers object
            if (headers && Object.hasOwnProperty.call(headers, key) && headers[key] != null) {
                lowerCaseHeaders[key.toLowerCase()] = String(headers[key]); // Ensure value is string
            }
        }

        // 4. CDN Detection based on Headers (Prioritize Specificity)
        // Use a single if/else if chain to ensure only one CDN is detected via headers.
        // Order checks from most specific/reliable to less specific.

        // Cloudflare (very specific headers)
        if (lowerCaseHeaders['cf-ray'] || lowerCaseHeaders['cf-cache-status'] || lowerCaseHeaders['server']?.toLowerCase().includes('cloudflare')) {
            cdn = 'Cloudflare';
        }
        // Akamai (very specific headers first)
        else if (lowerCaseHeaders['x-cdn']?.toLowerCase().includes('akamai') || // Very specific
            lowerCaseHeaders['x-akamai-request-id'] ||                    // Very specific
            lowerCaseHeaders['akamai-request-bc'] ||                       // Specific (from your example)
            lowerCaseHeaders['akamai-mon-iucid-del'] ||                   // Specific (from your example)
            lowerCaseHeaders['server']?.toLowerCase().includes('akamai') ||
            lowerCaseHeaders['x-cache']?.includes('from AkamaiGHost')) {
            cdn = 'Akamai';
        }
        // CloudFront (very specific headers)
        else if (lowerCaseHeaders['x-amz-cf-id'] || lowerCaseHeaders['x-amz-cf-pop'] || lowerCaseHeaders['x-cache']?.includes('cloudfront')) {
            cdn = 'CloudFront';
        }
        // Fastly (specific header first)
        else if (lowerCaseHeaders['x-fastly-backend-reqs'] ||
            (lowerCaseHeaders['x-served-by'] && lowerCaseHeaders['x-served-by'].includes('cache-'))) { // Keep x-served-by but after Akamai check
            cdn = 'Fastly';
        }
        // Verizon / Edgecast (specific headers)
        else if (lowerCaseHeaders['x-ec-debug'] || lowerCaseHeaders['server']?.toLowerCase().startsWith('ecs')) {
            cdn = 'Verizon (Edgecast)';
        }
        // Imperva (specific headers)
        else if (lowerCaseHeaders['x-cdn']?.toLowerCase().includes('imperva') || lowerCaseHeaders['x-iinfo']) {
            cdn = 'Imperva';
        }
        // Google Cloud CDN (specific header)
        else if (lowerCaseHeaders['via']?.includes('google') || lowerCaseHeaders['server']?.toLowerCase().includes('gse')) {
            cdn = 'Google Cloud CDN';
        }
        // Limelight / Edgio (specific header)
        else if (lowerCaseHeaders['x-ll-cache-action']) {
            cdn = 'Limelight (Edgio)';
        }
        // Highwinds / StackPath (specific header)
        else if (lowerCaseHeaders['x-hw']?.length > 0) { // Check length as it might be empty
            cdn = 'Highwinds (StackPath)';
        }
        // KeyCDN (specific server header)
        else if (lowerCaseHeaders['server']?.toLowerCase().includes('keycdn')) {
            cdn = 'KeyCDN';
        }
        // AWS ELB / potentially CloudFront (less specific, check later)
        // Note: Might overlap with CloudFront if CF headers aren't present but ELB is used.
        else if (lowerCaseHeaders['server']?.toLowerCase().includes('awselb')) {
            cdn = 'AWS ELB/CloudFront'; // Could be ELB in front of anything, or CF itself
        }
        // Add other specific header checks here...


        // 5. URL Fallback Checks (Only if Headers Didn't Identify a CDN)
        if (cdn === 'Unknown') {
            if (u.includes('.akamaized.net') || u.includes('.akamaihd.net') || u.includes('akamaitechnologies.com') || u.includes('.edgekey.net') || u.includes('.edgesuite.net')) cdn = 'Akamai';
            else if (u.includes('.llnwd.net') || u.includes('limelight.com')) cdn = 'Limelight (Edgio)';
            else if (u.includes('.fastly') || u.includes('fastly.net')) cdn = 'Fastly'; // Added .net
            else if (u.includes('.cloudfront.net')) cdn = 'CloudFront';
            else if (u.includes('cloudflare.com') || u.includes('cloudflare.net')) cdn = 'Cloudflare'; // Added .net
            else if (u.includes('.level3.net') || u.includes('.lumen.com')) cdn = 'Lumen (Level 3)';
            else if (u.includes('.edgecastcdn.net') || u.includes('.cedexis.com')) cdn = 'Verizon (Edgecast)';
            else if (u.includes('.hwcdn.net')) cdn = 'Highwinds (StackPath)';
            else if (u.includes('.azioncdn.net') || u.includes('.azion.net')) cdn = 'Azion'; // Added .net
            else if (u.includes('.cdnetworks.net') || u.includes('cdnetworks.com')) cdn = 'CDNetworks';
            else if (u.includes('.incapdns.net')) cdn = 'Imperva';
            else if (u.includes('.keycdn.com')) cdn = 'KeyCDN';
            else if (u.includes('qwilt')) cdn = 'Qwilt'; // Domain might vary
            else if (u.includes('.jsdelivr.net')) cdn = 'jsDelivr';
            // Add other URL checks here...
        }

        // 6. Update State and Log Changes
        // Ensure qoeData and addEvent are accessible in this scope
        if (typeof qoeData !== 'undefined' && typeof addEvent === 'function') {
            let currentCDN = qoeData.cdnProvider; // Get current CDN *before* potentially updating it

            // Update only if CDN was identified (not 'Unknown') AND it's different from the current stored CDN
            if (cdn !== 'Unknown' && cdn !== currentCDN) {
                console.log(`CDN detected: ${cdn} (Previous: ${currentCDN}). Updating state.`); // Added detail for debugging
                qoeData.cdnProvider = cdn;
                addEvent(`CDN detected: ${cdn}`, 'cdn');
                // No need to call updateQoEDisplay here if FRAG_LOADED handles it
            } else if (cdn !== 'Unknown' && cdn === currentCDN) {
                // Optional: Log if detection matches current state, useful for debugging repeated calls
                console.log(`CDN reaffirmed: ${cdn}`);
            } else if (cdn === 'Unknown') {
                // Optional: Log if no CDN was detected
                console.log(`CDN detection resulted in 'Unknown' for URL: ${url}`);
            }
        } else {
            console.warn("qoeData or addEvent not available in detectCDN scope.");
        }

        // Optional: Return the detected CDN name
        // return cdn;
    }


    // -----------------------
    // Update all UI pieces
    // -----------------------
    function updateQoEDisplay() {
       console.log('[metrics_ui] updateQoEDisplay called'); // Frequent log, uncomment for deep debugging

        // Update main playback metrics
        const rows = [
            ['cdnProvider', qoeData.cdnProvider],
            ['startupTime', qoeData.loadStart && qoeData.firstFrame ? ((qoeData.firstFrame - qoeData.loadStart) / 1000).toFixed(2) + 's' : 'N/A'],
            ['timeToFirstFrame', qoeData.startTime && qoeData.firstFrame ? ((qoeData.firstFrame - qoeData.startTime) / 1000).toFixed(2) + 's' : 'N/A'],
            ['qualitySwitches', qoeData.qualitySwitches],
            ['rebufferingEvents', qoeData.rebufferingEvents],
            ['avgRebufferDuration', qoeData.rebufferingDurations.length ? (qoeData.rebufferingDurations.reduce((a, b) => a + b, 0) / qoeData.rebufferingDurations.length).toFixed(2) + 's' : 'N/A'],
            ['currentBitrate', qoeData.currentBitrate ? (qoeData.currentBitrate / 1e6).toFixed(2) + ' Mbps' : 'N/A'],
            ['currentResolution', qoeData.currentResolution || 'N/A'], // Display Resolution
            ['playbackRate', qoeData.playbackRate + 'x']
        ];
        rows.forEach(([id, val]) => {
            const el = document.getElementById(id);
            if (el) el.textContent = val !== null && val !== undefined ? val : 'N/A';
            // else console.warn(`[metrics_ui] Element not found for metric: ${id}`); // Debug log
        });

        // Update detail tab panels
        renderAudio();
        renderSubs();
        renderConnection();
        renderQoS(); // Render the new QoS tab data

    } // End updateQoEDisplay

    // -----------------------
    // Render Audio Tab
    // -----------------------
    function renderAudio() {
        const container = document.getElementById('audioTracksContainer');
        if (!container) return;
        container.innerHTML = ''; // Clear previous

        if (!qoeData.audioTracks || qoeData.audioTracks.length === 0) {
            container.textContent = 'No audio track information available';
            return;
        }

        qoeData.audioTracks.forEach(track => {
            const row = document.createElement('div');
            row.className = 'qoe-metric-row';

            const nameEl = document.createElement('span');
            nameEl.className = 'qoe-metric-name';
            const nameText = `${track.name} (${track.language || 'und'})${track.default ? ' [Default]' : ''}`;
            nameEl.textContent = nameText;
            nameEl.title = `Track ID: ${track.id}`;

            const valEl = document.createElement('span');
            valEl.className = 'qoe-metric-value';
            // Use specific track codec if available and valid, otherwise fallback to global current codec
            const displayCodec = track.codec && track.codec !== '?' ? track.codec : qoeData.currentAudioCodec;
            valEl.textContent = displayCodec || '?';

            // Highlight active track
            if (track.id === qoeData.currentAudioTrack) {
                nameEl.style.fontWeight = 'bold';
                valEl.style.fontWeight = 'bold';
                valEl.style.color = '#b2d1f0'; // Active color
                nameEl.style.color = 'white'; // Ensure name is readable
            } else {
                nameEl.style.fontWeight = 'normal'; // Reset font weight
                valEl.style.fontWeight = 'normal';
                nameEl.style.color = '#ccc'; // Non-active color
                valEl.style.color = '#ccc';
            }

            row.appendChild(nameEl);
            row.appendChild(valEl);
            container.appendChild(row);
        });
    }

    // -----------------------
    // Render Subtitles Tab
    // -----------------------
    function renderSubs() {
        const container = document.getElementById('subtitlesContainer');
        if (!container) return;
        container.innerHTML = ''; // Clear previous

        if (!qoeData.subtitleTracks || qoeData.subtitleTracks.length === 0) {
            container.textContent = 'No subtitle information available';
        } else {
            qoeData.subtitleTracks.forEach(t => {
                const row = document.createElement('div');
                row.className = 'qoe-metric-row';

                const nameEl = document.createElement('span');
                nameEl.className = 'qoe-metric-name';
                nameEl.textContent = `${t.name || 'Subtitle'} (${t.language || 'und'})${t.default ? ' [Default]' : ''}`;
                nameEl.title = `Track ID: ${t.id}`;

                // Optionally add value if needed (e.g., active state)
                // const valEl = document.createElement('span');
                // valEl.className = 'qoe-metric-value';
                // valEl.textContent = (hls && hls.subtitleTrack === t.id) ? 'Active' : ''; // Check active (requires access to hls instance)

                row.appendChild(nameEl);
                // row.appendChild(valEl);
                container.appendChild(row);
            });
        }
    }

    // -----------------------
    // Render Connection Tab
    // -----------------------
    function renderConnection() {
        const safeAvg = (arr) => { // Re-define helper or make it global/scoped
             if (!arr || arr.length === 0) return null;
             const numericArr = arr.filter(item => typeof item === 'number' && isFinite(item));
             if (numericArr.length === 0) return null;
             const sum = numericArr.reduce((a, b) => a + b, 0);
             return sum / numericArr.length;
        };

        // Throughput
        const avgTp = safeAvg(qoeData.throughput);
        document.getElementById('tcpThroughput').textContent = avgTp !== null ? (avgTp / 1e6).toFixed(2) + ' Mbps' : 'N/A';

        // Download Speed
        const avgDl = safeAvg(qoeData.downloadSpeed);
        let dlText = 'N/A';
        if (avgDl !== null) {
            dlText = avgDl >= 1e6 ? (avgDl / 1e6).toFixed(2) + ' MB/s' : (avgDl / 1e3).toFixed(2) + ' KB/s';
        }
        document.getElementById('downloadSpeed').textContent = dlText;

        // Connection Type (Browser API)
        let connText = 'Unknown'; // Default
        if (navigator.connection) {
            const c = navigator.connection;
            connText = c.effectiveType ? c.effectiveType : 'Unknown';
            if (typeof c.downlink === 'number') connText += ` (~${c.downlink.toFixed(1)} Mbps)`;
            if (typeof c.rtt === 'number') connText += `, RTT ${c.rtt} ms`;
        } else {
             connText = 'N/A (API unavailable)';
        }
        document.getElementById('connectionType').textContent = connText;

        // Latency (Fragment TTFB)
        const avgLat = safeAvg(qoeData.latency);
        document.getElementById('latency').textContent = avgLat !== null ? `${avgLat.toFixed(0)} ms` : 'N/A';
    }

    // ===============================
    // === metaviewAPI Testing API ===
    // ===============================
   
    if (!window.metaviewAPI) window.metaviewAPI = {};

    const metrics = { 

        /**
         * Returns a shallow copy of the entire qoeData object for inspection.
         */
        getQoEState: function () {
            return { ...qoeData };
        },

        /**
         * Returns the latest detected video bitrate (in bps) or null if unknown.
         */
        getCurrentBitrate: function () {
            return qoeData.currentBitrate;
        },

        /**
         * Returns the latest detected video resolution string (e.g., "1920x1080") or null if unknown.
         */
        getCurrentResolution: function () {
            return qoeData.currentResolution;
        },

        /**
         * Returns current audio track object with id, name, language, codec properties, or null if no active track.
         */
        getCurrentAudioTrack: function () {
            if (qoeData.currentAudioTrack != null) {
                return qoeData.audioTracks.find(t => t.id === qoeData.currentAudioTrack) || null;
            }
            return null;
        },

        /**
         * Returns an object with total segments requested, loaded, and failed counts.
         */
        getSegmentCounters: function () {
            return {
                requested: qoeData.totalSegmentsRequested,
                loaded: qoeData.totalSegmentsLoaded,
                failed: qoeData.totalSegmentsFailed
            };
        },

        /**
         * Returns the average segment download time in milliseconds, or null if no data.
         */
        getAverageSegmentDownloadTime: function () {
            const arr = qoeData.segmentDownloadTimes;
            if (!arr || arr.length === 0) return null;
            const valid = arr.filter(n => typeof n === 'number' && isFinite(n));
            if (valid.length === 0) return null;
            return valid.reduce((a, b) => a + b, 0) / valid.length;
        },

        /**
         * Returns the average throughput in bits per second, or null if no data.
         */
        getAverageThroughput: function () {
            const arr = qoeData.throughput;
            if (!arr || arr.length === 0) return null;
            const valid = arr.filter(n => typeof n === 'number' && isFinite(n));
            if (valid.length === 0) return null;
            return valid.reduce((a, b) => a + b, 0) / valid.length;
        },

        /**
         * Returns the currently detected CDN provider string.
         */
        getCDN: function () {
            return qoeData.cdnProvider;
        },

        /**
         * Returns the event history array (max 100 entries), each entry includes {time, msg, type}.
         */
        getEventHistory: function () {
            return qoeData.eventHistory.slice(); // shallow copy to prevent external mutation
        },
        
        /**
         * Returns the current bufferStalled state.
         * @returns {Object} - Object containing bufferStalled state.
         */
        playbackBufferCheck: function() {
            if (bufferStalledState.start && !bufferStalledState.end) {
                return ` bufferStalledError: Started: ${bufferStalledState.start.toISOString()}`;
            } else if (bufferStalledState.start && bufferStalledState.end) {
                return ` bufferStalledError: Ended: ${bufferStalledState.end.toISOString()}: after ${bufferStalledState.duration.toFixed(2)}s`;
            } else {
                return ` No Buffering Errors.`;
            }
        }
    };

    // Assign the temp variable and then Freeze
    window.metaviewAPI.metrics = metrics;

    console.log('[metrics_ui] metaviewAPI.metrics defined.'); 

})(); // End IIFE

console.log('[metrics_ui] Metrics UI script finished.');