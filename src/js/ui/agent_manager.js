// js/ui/agent_manager.js

// Agent Manager module for analyzing HLS stream data and reporting results
(function () {
    // ==============================
    // Configuration
    // ==============================
    const config = {
        // LLM API configuration
        llm: {
            providers: {
                anthropic: 'anthropic',
                openai: 'openai',
                gemini: 'gemini',
                mistral: 'mistral'
            },
            defaultProvider: 'anthropic',
            endpoints: {
                anthropic: 'https://api.anthropic.com/v1/messages',
                openai: 'https://api.openai.com/v1/chat/completions',
                gemini: 'https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent',
                mistral: 'https://api.mistral.ai/v1/chat/completions'
            },
            models: {
                anthropic: 'claude-3-haiku-20240307',
                openai: 'gpt-3.5-turbo',
                gemini: 'gemini-2.0-flash',
                mistral: 'mistral-small'
            },
            storageKeys: {
                apiKey: 'llmApiKey',
                provider: 'selectedLLMProvider'
            }
        },

        // Timer configuration with updated constraints
        timer: {
            defaultMinutes: 0,
            defaultSeconds: 15,
            minTime: 15,            // Minimum 15 seconds
            maxTime: 3600,          // Maximum 1 hour (3600 seconds)
            intervalCheckTime: 600, // 10 minutes in seconds
            intervalFrequency: 900, // 15 minutes in seconds for longer durations
            maxIntervals: 4         // Maximum number of interval checks
        }
    };

    // ==============================
    // State
    // ==============================
    const state = {
        isAnalyzing: false,
        timer: {
            minutes: config.timer.defaultMinutes,
            seconds: config.timer.defaultSeconds,
            intervalId: null,
            totalSeconds: function () {
                return this.minutes * 60 + this.seconds;
            }
        },
        selectedTasks: [],
        analysisStartTime: null,
        resultsData: null,
        // New state for interval checks
        intervalData: {
            nextCheckTime: 0,
            checkPoints: [],
            snapshots: []
        }
    };

    // ==============================
    // DOM Elements
    // ==============================
    let elements = {
        startButton: null,
        taskCheckboxes: [],
        timerDisplay: null,
        timerUpButton: null,
        timerDownButton: null,
        resultsContainer: null
    };

    // ==============================
    // Initialization
    // ==============================
    function init() {
        cacheElements();
        setupEventListeners();
        updateTimerDisplay();
    }

    function cacheElements() {
        elements.startButton = document.getElementById('agentStartButton');
        elements.taskCheckboxes = Array.from(document.querySelectorAll('.agent-metric-task-item input[type="checkbox"]'));
        elements.timerDisplay = document.querySelector('.agent-metric-timer-display');
        elements.timerUpButton = document.querySelector('.agent-metric-timer-button.agent-metric-timer-up');
        elements.timerDownButton = document.querySelector('.agent-metric-timer-button.agent-metric-timer-down');
        elements.resultsContainer = document.getElementById('agentResultsContainer');
    }

    function setupEventListeners() {
        if (elements.startButton) {
            elements.startButton.addEventListener('click', handleStartAnalysis);
        }

        if (elements.timerUpButton) {
            elements.timerUpButton.addEventListener('click', incrementTimer);
        }

        if (elements.timerDownButton) {
            elements.timerDownButton.addEventListener('click', decrementTimer);
        }

        // Handle task checkboxes
        elements.taskCheckboxes.forEach(checkbox => {
            checkbox.addEventListener('change', updateSelectedTasks);
        });
    }

    // ==============================
    // Timer Management
    // ==============================
    function incrementTimer() {
        if (state.isAnalyzing) return;

        // Increment in smaller steps when value is low
        if (state.timer.totalSeconds() < 60) {
            state.timer.seconds += 5; // Add 5 seconds at a time for small values
            if (state.timer.seconds >= 60) {
                state.timer.minutes += Math.floor(state.timer.seconds / 60);
                state.timer.seconds %= 60;
            }
        } else if (state.timer.totalSeconds() < 600) { // Less than 10 minutes
            state.timer.minutes += 1; // Add 1 minute at a time
        } else {
            state.timer.minutes += 5; // Add 5 minutes at a time for larger values
        }

        // Enforce maximum (3600 seconds = 1 hour)
        const totalSeconds = state.timer.totalSeconds();
        if (totalSeconds > config.timer.maxTime) {
            state.timer.minutes = Math.floor(config.timer.maxTime / 60);
            state.timer.seconds = config.timer.maxTime % 60;
        }

        updateTimerDisplay();
    }

    function decrementTimer() {
        if (state.isAnalyzing) return;

        // For small values, decrement in 5-second steps
        if (state.timer.totalSeconds() <= 60) {
            if (state.timer.seconds >= 5) {
                state.timer.seconds -= 5;
            } else if (state.timer.minutes > 0) {
                state.timer.minutes -= 1;
                state.timer.seconds = 55; // 60 - 5
            }
        } else if (state.timer.totalSeconds() <= 600) { // 10 minutes or less
            if (state.timer.seconds > 0) {
                state.timer.seconds = 0;
            } else {
                state.timer.minutes -= 1;
            }
        } else {
            // For larger values, decrement in 5-minute steps
            if (state.timer.seconds > 0) {
                state.timer.seconds = 0;
            } else if (state.timer.minutes >= 5) {
                state.timer.minutes -= 5;
            } else {
                state.timer.minutes = 0;
            }
        }

        // Enforce minimum (15 seconds)
        const totalSeconds = state.timer.totalSeconds();
        if (totalSeconds < config.timer.minTime) {
            state.timer.minutes = Math.floor(config.timer.minTime / 60);
            state.timer.seconds = config.timer.minTime % 60;
        }

        updateTimerDisplay();
    }

    function updateTimerDisplay() {
        if (elements.timerDisplay) {
            elements.timerDisplay.textContent = `${state.timer.minutes}:${state.timer.seconds.toString().padStart(2, '0')}`;
        }
    }

    function setupIntervalChecks() {
        // Reset interval data
        state.intervalData.checkPoints = [];
        state.intervalData.snapshots = [];
        state.intervalData.nextCheckTime = 0;

        const totalDuration = state.timer.totalSeconds();

        // If duration is less than the interval check time, no intervals needed
        if (totalDuration <= config.timer.intervalCheckTime) {
            return false;
        }

        // Take initial snapshot immediately
        const initialSnapshot = collectDataForAnalysis();
        state.intervalData.snapshots.push(initialSnapshot);
        state.intervalData.checkPoints.push(0); // 0 seconds from start

        // For durations over 10 minutes (600 seconds)
        if (totalDuration > config.timer.intervalCheckTime) {
            const numIntervals = Math.min(
                Math.floor(totalDuration / config.timer.intervalFrequency),
                config.timer.maxIntervals - 1 // -1 because we've already added the initial check
            );

            // Calculate check points (evenly distributed)
            for (let i = 1; i <= numIntervals; i++) {
                const checkPoint = Math.min(
                    Math.round(i * (totalDuration / (numIntervals + 1))), // +1 to include final check
                    totalDuration - 5 // Ensure at least 5 seconds before end
                );
                state.intervalData.checkPoints.push(checkPoint);
            }

            // Set next check time
            state.intervalData.nextCheckTime = state.intervalData.checkPoints[0];
            return true;
        }

        return false;
    }

    function startTimerCountdown() {
        if (state.timer.intervalId) {
            clearInterval(state.timer.intervalId);
        }

        let totalSeconds = state.timer.totalSeconds();
        const hasIntervals = setupIntervalChecks();
        let intervalIndex = 0;

        state.timer.intervalId = setInterval(() => {
            totalSeconds--;

            // Check if it's time for an interval data collection
            if (hasIntervals &&
                intervalIndex < state.intervalData.checkPoints.length &&
                totalSeconds === totalDuration - state.intervalData.checkPoints[intervalIndex]) {

                // Take a snapshot at this interval
                const intervalSnapshot = collectDataForAnalysis();
                state.intervalData.snapshots.push(intervalSnapshot);

                // Log the interval check for debugging
                console.log(`[agent_manager] Interval check ${intervalIndex + 1} at ${state.intervalData.checkPoints[intervalIndex]} seconds from start`);

                // Move to next interval
                intervalIndex++;
            }

            if (totalSeconds <= 0) {
                clearInterval(state.timer.intervalId);
                state.timer.intervalId = null;
                finishAnalysis();
                return;
            }

            state.timer.minutes = Math.floor(totalSeconds / 60);
            state.timer.seconds = totalSeconds % 60;
            updateTimerDisplay();
        }, 1000);
    }

    // ==============================
    // Task Selection Management
    // ==============================
    function updateSelectedTasks() {
        state.selectedTasks = elements.taskCheckboxes
            .filter(checkbox => checkbox.checked)
            .map(checkbox => checkbox.value);
    }

    // ==============================
    // Analysis Flow
    // ==============================
    function handleStartAnalysis() {
        if (state.isAnalyzing) return;

        updateSelectedTasks();

        if (state.selectedTasks.length === 0) {
            displayResults("Please select at least one analysis task.");
            return;
        }

        beginAnalysis();
    }

    function beginAnalysis() {
        state.isAnalyzing = true;
        state.analysisStartTime = Date.now();
        elements.startButton.disabled = true;
        elements.startButton.textContent = "Analysis in progress...";

        displayResults("Collecting data and analyzing...");

        startTimerCountdown();
    }

    function finishAnalysis() {
        const finalSnapshot = collectDataForAnalysis();

        // If using interval data, add the final snapshot
        if (state.intervalData.snapshots.length > 0) {
            state.intervalData.snapshots.push(finalSnapshot);
            state.intervalData.checkPoints.push(state.timer.totalSeconds());
        }

        const collectedData = state.intervalData.snapshots.length > 1
            ? processIntervalData(state.intervalData.snapshots)
            : finalSnapshot;

        if (Object.keys(collectedData).length === 0) {
            stopAnalysis();
            displayResults("Error: Could not collect sufficient data for analysis. Please ensure the player has loaded a stream.");
            return;
        }

        // Perform local analysis with interval data if available
        const analysisResults = performLocalAnalysis(collectedData);
        displayAnalysisResults(analysisResults);

        // Uncomment to use LLM analysis when ready
        getLlmApiInfo()
            .then(({ provider, apiKey }) => {
                if (!apiKey) {
                    throw new Error("No API key found. Please add an API key in the Configuration page.");
                }
                return performLlmAnalysis(provider, apiKey, collectedData);
            })
            .then(results => {
                displayAnalysisResults(results);
            })
            .catch(error => {
                displayResults(`Error: ${error.message}`);
            })
            .finally(() => {
                stopAnalysis();
            });

        stopAnalysis();
    }

    function processIntervalData(snapshots) {
        // Create a combined data object that includes the interval snapshots
        const processedData = {
            ...snapshots[snapshots.length - 1], // Use latest snapshot as base
            intervals: {
                count: snapshots.length,
                checkPoints: state.intervalData.checkPoints,
                snapshots: snapshots
            },
            trends: {}
        };

        // Calculate trends for key metrics between snapshots
        if (snapshots.length >= 2) {
            // For each task type, calculate relevant trends
            if (state.selectedTasks.includes('analyzePlaybackErrors')) {
                processedData.trends.playbackErrors = analyzePlaybackErrorTrends(snapshots);
            }

            if (state.selectedTasks.includes('assessAbrPerformance')) {
                processedData.trends.abrPerformance = analyzeAbrPerformanceTrends(snapshots);
            }

            if (state.selectedTasks.includes('evaluateCacheEffectiveness')) {
                processedData.trends.cacheEffectiveness = analyzeCacheTrends(snapshots);
            }
        }

        return processedData;
    }

    function analyzePlaybackErrorTrends(snapshots) {
        const trends = {
            rebufferingEvents: [],
            rebufferingDurations: [],
            startTime: snapshots[0].analysisTime,
            endTime: snapshots[snapshots.length - 1].analysisTime,
            stability: "stable"
        };

        // Extract rebuffering events and durations from each snapshot
        snapshots.forEach((snapshot, index) => {
            if (snapshot.metrics) {
                trends.rebufferingEvents.push(snapshot.metrics.rebufferingEvents || 0);

                // Calculate average rebuffer duration for this snapshot
                const rebufferDurations = snapshot.metrics.rebufferingDurations || [];
                const avgDuration = rebufferDurations.length > 0
                    ? rebufferDurations.reduce((sum, dur) => sum + dur, 0) / rebufferDurations.length
                    : 0;
                trends.rebufferingDurations.push(avgDuration);
            }
        });

        // Analyze trends in rebuffering
        if (trends.rebufferingEvents.length >= 2) {
            const firstCount = trends.rebufferingEvents[0];
            const lastCount = trends.rebufferingEvents[trends.rebufferingEvents.length - 1];
            const rebufferRate = lastCount - firstCount;

            if (rebufferRate > 5) {
                trends.stability = "deteriorating";
            } else if (rebufferRate > 2) {
                trends.stability = "concerning";
            } else if (rebufferRate > 0) {
                trends.stability = "acceptable";
            } else {
                trends.stability = "stable";
            }
        }

        return trends;
    }

    function analyzeAbrPerformanceTrends(snapshots) {
        const trends = {
            qualitySwitches: [],
            bitrates: [],
            startTime: snapshots[0].analysisTime,
            endTime: snapshots[snapshots.length - 1].analysisTime,
            stability: "stable"
        };

        // Extract quality switches and bitrates from each snapshot
        snapshots.forEach((snapshot) => {
            if (snapshot.metrics) {
                trends.qualitySwitches.push(snapshot.metrics.qualitySwitches || 0);
                trends.bitrates.push(snapshot.metrics.currentBitrate || 0);
            }
        });

        // Analyze trends in quality switches
        if (trends.qualitySwitches.length >= 2) {
            const firstCount = trends.qualitySwitches[0];
            const lastCount = trends.qualitySwitches[trends.qualitySwitches.length - 1];
            const switchRate = lastCount - firstCount;

            if (switchRate > 10) {
                trends.stability = "unstable";
            } else if (switchRate > 5) {
                trends.stability = "fluctuating";
            } else if (switchRate > 2) {
                trends.stability = "adjusting";
            } else {
                trends.stability = "stable";
            }
        }

        // Analyze bitrate consistency if we have multiple samples
        if (trends.bitrates.length >= 3) {
            const nonZeroBitrates = trends.bitrates.filter(br => br > 0);
            if (nonZeroBitrates.length >= 2) {
                const maxBitrate = Math.max(...nonZeroBitrates);
                const minBitrate = Math.min(...nonZeroBitrates);

                // Calculate bitrate variation as a percentage of the max
                const variation = maxBitrate > 0 ? (maxBitrate - minBitrate) / maxBitrate : 0;

                if (variation > 0.5) {
                    trends.bitrateConsistency = "highly variable";
                } else if (variation > 0.2) {
                    trends.bitrateConsistency = "variable";
                } else {
                    trends.bitrateConsistency = "consistent";
                }
            }
        }

        return trends;
    }

    function analyzeCacheTrends(snapshots) {
        const trends = {
            hitRatios: [],
            hitCounts: [],
            missCounts: [],
            startTime: snapshots[0].analysisTime,
            endTime: snapshots[snapshots.length - 1].analysisTime,
            trend: "stable"
        };

        // Extract cache data from each snapshot
        snapshots.forEach((snapshot) => {
            if (snapshot.cache) {
                const hitRatio = snapshot.cache.total > 0 ? snapshot.cache.hits / snapshot.cache.total : 0;
                trends.hitRatios.push(hitRatio);
                trends.hitCounts.push(snapshot.cache.hits || 0);
                trends.missCounts.push(snapshot.cache.misses || 0);
            }
        });

        // Analyze trends in cache hit ratio
        if (trends.hitRatios.length >= 2) {
            const firstRatio = trends.hitRatios[0];
            const lastRatio = trends.hitRatios[trends.hitRatios.length - 1];
            const ratioDifference = lastRatio - firstRatio;

            if (ratioDifference > 0.2) {
                trends.trend = "improving";
            } else if (ratioDifference > 0.05) {
                trends.trend = "slightly improving";
            } else if (ratioDifference < -0.2) {
                trends.trend = "deteriorating";
            } else if (ratioDifference < -0.05) {
                trends.trend = "slightly deteriorating";
            } else {
                trends.trend = "stable";
            }
        }

        return trends;
    }

    function stopAnalysis() {
        if (state.timer.intervalId) {
            clearInterval(state.timer.intervalId);
            state.timer.intervalId = null;
        }

        state.isAnalyzing = false;
        state.timer.minutes = config.timer.defaultMinutes;
        state.timer.seconds = config.timer.defaultSeconds;
        updateTimerDisplay();

        elements.startButton.disabled = false;
        elements.startButton.textContent = "Start Analysis";
    }

    // ==============================
    // Data Collection
    // ==============================
    function collectDataForAnalysis() {
        const data = {
            tasks: state.selectedTasks,
            timestamp: new Date().toISOString(),
            analysisTime: (Date.now() - state.analysisStartTime) / 1000,
            stream: {}
        };

        // Get QoE and metrics data
        if (window.metaviewAPI && window.metaviewAPI.metrics) {
            data.metrics = window.metaviewAPI.metrics.getQoEState();
        }

        // Get HLS parser data
        if (window.metaviewAPI && window.metaviewAPI.hlsparser) {
            data.stream.masterUrl = window.metaviewAPI.hlsparser.getMasterPlaylistUrl();
            data.stream.hlsVersion = window.metaviewAPI.hlsparser.getHlsVersion();
            data.stream.isLive = window.metaviewAPI.hlsparser.isLiveStream();

            // Instead of using potentially problematic getAllVariantStreams()
            // Get variant data from resolution manager via DOM
            const resolutionItems = document.querySelectorAll('.resolution-item:not(.disabled)');
            data.stream.variants = Array.from(resolutionItems).map(item => {
                const text = item.textContent || '';
                const resMatch = text.match(/Resolution: (\d+x\d+)/);
                const bwMatch = text.match(/Bandwidth: (\d+) kbps/);
                return {
                    resolution: resMatch ? resMatch[1] : 'unknown',
                    bandwidth: bwMatch ? parseInt(bwMatch[1], 10) * 1000 : 0, // convert kbps to bps
                    levelIndex: item.hasAttribute('data-level-index') ?
                        parseInt(item.getAttribute('data-level-index'), 10) : -1
                };
            });

            // Get media playlist details
            const mediaId = window.metaviewAPI.hlsparser.getActiveMediaPlaylistId();
            if (mediaId) {
                data.stream.activeMedia = window.metaviewAPI.hlsparser.getMediaPlaylistDetails(mediaId);
            }
        }

        // Get HLS player instance data
        if (window.metaviewAPI && window.metaviewAPI.playerloader) {
            const hls = window.metaviewAPI.playerloader.getHlsInstance();
            if (hls) {
                data.player = {
                    levels: hls.levels ? hls.levels.length : 0,
                    currentLevel: hls.currentLevel,
                    autoLevel: hls.autoLevelEnabled
                };
            }
        }

        // Get cache data if requested
        if (state.selectedTasks.includes('evaluateCacheEffectiveness') && window.cacheData) {
            data.cache = {
                hits: window.cacheData.hits,
                misses: window.cacheData.misses,
                total: window.cacheData.total,
                hitRatio: window.cacheData.total > 0 ?
                    (window.cacheData.hits / window.cacheData.total) : 0
            };
        }

        // Get SCTE data if available
        if (window.SCTEManager) {
            data.scte = {
                detected: window.SCTEManager.getScteCount() > 0,
                adStartInfo: window.SCTEManager.getScteAdStart(),
                adEndInfo: window.SCTEManager.getScteAdEnd(),
                cumulativeAdTime: window.SCTEManager.getCumulativeAdTime()
            };
        }

        return data;
    }

    // ==============================
    // Local Analysis (without LLM)
    // ==============================
    function performLocalAnalysis(data) {
        const results = {
            summary: "Analysis Complete",
            tasks: {}
        };

        // Analyze playback errors
        if (data.tasks.includes('analyzePlaybackErrors')) {
            results.tasks.playbackErrors = analyzePlaybackErrors(data);
        }

        // Analyze ABR performance
        if (data.tasks.includes('assessAbrPerformance')) {
            results.tasks.abrPerformance = analyzeAbrPerformance(data);
        }

        // Analyze cache effectiveness
        if (data.tasks.includes('evaluateCacheEffectiveness')) {
            results.tasks.cacheEffectiveness = analyzeCacheEffectiveness(data);
        }

        // Add interval analysis into the summary if available
        if (data.intervals && data.intervals.count > 1) {
            results.summary = `Analysis Complete over ${data.intervals.count} check points across ${Math.round(data.analysisTime)} seconds.`;

            // Update task results with trend information
            if (data.trends) {
                Object.keys(data.trends).forEach(taskType => {
                    if (results.tasks[taskType]) {
                        results.tasks[taskType].trends = data.trends[taskType];

                        // Update details and status based on trends
                        if (taskType === 'playbackErrors' && data.trends.playbackErrors) {
                            const stability = data.trends.playbackErrors.stability;
                            if (stability === 'deteriorating') {
                                results.tasks[taskType].status = 'Unstable';
                                results.tasks[taskType].details += ` Analysis shows a deteriorating trend over time.`;
                            }
                        }

                        if (taskType === 'abrPerformance' && data.trends.abrPerformance) {
                            const stability = data.trends.abrPerformance.stability;
                            if (stability === 'unstable' || stability === 'fluctuating') {
                                results.tasks[taskType].status = 'Unstable';
                                results.tasks[taskType].details += ` ABR switching pattern shows ${stability} behavior over time.`;
                            }
                        }

                        if (taskType === 'cacheEffectiveness' && data.trends.cacheEffectiveness) {
                            const trend = data.trends.cacheEffectiveness.trend;
                            if (trend === 'improving') {
                                results.tasks[taskType].details += ` Cache performance is improving over time.`;
                            } else if (trend === 'deteriorating') {
                                results.tasks[taskType].details += ` Cache performance is deteriorating over time.`;
                            }
                        }
                    }
                });
            }
        }

        return results;
    }

    function analyzePlaybackErrors(data) {
        const result = {
            status: "Stable",
            details: "No significant playback errors detected."
        };

        if (data.metrics) {
            const rebufferEvents = data.metrics.rebufferingEvents || 0;
            const avgRebufferDuration =
                data.metrics.rebufferingDurations &&
                    data.metrics.rebufferingDurations.length > 0 ?
                    data.metrics.rebufferingDurations.reduce((a, b) => a + b, 0) /
                    data.metrics.rebufferingDurations.length :
                    0;

            if (rebufferEvents > 0) {
                result.status = rebufferEvents > 3 ? "Unstable" : "Warning";
                result.details = `Detected ${rebufferEvents} buffering events with average duration of ${avgRebufferDuration.toFixed(2)}s.`;
            }
        }

        // If we have interval data and trends
        if (data.trends && data.trends.playbackErrors) {
            const trends = data.trends.playbackErrors;

            if (trends.stability === "deteriorating") {
                result.status = "Unstable";
                result.details = `Playback stability deteriorating over time. Started with ${trends.rebufferingEvents[0]} buffering events, ended with ${trends.rebufferingEvents[trends.rebufferingEvents.length - 1]}.`;
            }
        }

        return result;
    }

    function analyzeAbrPerformance(data) {
        const result = {
            status: "Good",
            details: "Adaptive bitrate switching is functioning normally."
        };

        if (data.metrics) {
            const qualitySwitches = data.metrics.qualitySwitches || 0;
            const currentBitrate = data.metrics.currentBitrate;
            const variants = data.stream?.variants || [];

            // Get highest and lowest available bitrates
            let maxBitrate = 0;
            let minBitrate = Number.MAX_SAFE_INTEGER;

            variants.forEach(variant => {
                if (variant.bandwidth > maxBitrate) maxBitrate = variant.bandwidth;
                if (variant.bandwidth < minBitrate) minBitrate = variant.bandwidth;
            });

            // Check if current bitrate is too low relative to available bandwidth
            if (currentBitrate && maxBitrate > 0) {
                const bitrateRatio = currentBitrate / maxBitrate;

                // Include current bitrate in the analysis
                if (bitrateRatio < 0.3 && data.metrics.downloadSpeed && (data.metrics.downloadSpeed * 8) > (maxBitrate * 1.5)) {
                    result.status = "Underperforming";
                    result.details = `Player is using a low bitrate (${(currentBitrate / 1000000).toFixed(2)} Mbps) despite sufficient bandwidth for higher quality.`;
                } else {
                    // Add current bitrate to normal status message
                    result.details = `Adaptive bitrate switching is functioning normally. Current bitrate: ${(currentBitrate / 1000000).toFixed(2)} Mbps.`;
                }
            }

            // Analyze switch frequency (existing code)
            if (qualitySwitches > 5 && data.analysisTime < 60) {
                result.status = "Unstable";
                result.details = `High frequency of quality switches detected (${qualitySwitches} in ${data.analysisTime.toFixed(0)} seconds).`;
            } else if (qualitySwitches === 0 && variants.length > 1) {
                result.status = "Warning";
                result.details = "ABR appears inactive. No quality switches detected despite multiple available variants.";
            }
        }

        // If we have interval data and trends
        if (data.trends && data.trends.abrPerformance) {
            const trends = data.trends.abrPerformance;

            if (trends.stability === "unstable") {
                result.status = "Unstable";
                result.details = `ABR switching pattern is unstable over time. Started with ${trends.qualitySwitches[0]} switches, ended with ${trends.qualitySwitches[trends.qualitySwitches.length - 1]}.`;
            }

            if (trends.bitrateConsistency === "highly variable") {
                if (result.status === "Good") result.status = "Fair";
                result.details += ` Bitrate varies significantly over time.`;
            }
        }

        return result;
    }

    function analyzeCacheEffectiveness(data) {
        const result = {
            status: "Unknown",
            details: "Insufficient cache data collected."
        };

        if (data.cache) {
            const hitRatio = data.cache.hitRatio;

            if (data.cache.total < 5) {
                result.status = "Insufficient Data";
                result.details = `Only ${data.cache.total} segments loaded. More data needed for accurate analysis.`;
            } else if (hitRatio >= 0.8) {
                result.status = "Excellent";
                result.details = `Cache hit ratio is ${(hitRatio * 100).toFixed(1)}%. CDN caching is very effective.`;
            } else if (hitRatio >= 0.5) {
                result.status = "Good";
                result.details = `Cache hit ratio is ${(hitRatio * 100).toFixed(1)}%. CDN caching is reasonably effective.`;
            } else if (hitRatio >= 0.2) {
                result.status = "Fair";
                result.details = `Cache hit ratio is ${(hitRatio * 100).toFixed(1)}%. CDN caching could be improved.`;
            } else {
                result.status = "Poor";
                result.details = `Cache hit ratio is only ${(hitRatio * 100).toFixed(1)}%. CDN caching appears ineffective.`;
            }
        }

        // If we have interval data and trends
        if (data.trends && data.trends.cacheEffectiveness) {
            const trends = data.trends.cacheEffectiveness;

            // Enhance details with trend information
            if (trends.trend === "improving") {
                result.details += ` Cache performance is improving over time (${(trends.hitRatios[0] * 100).toFixed(1)}% → ${(trends.hitRatios[trends.hitRatios.length - 1] * 100).toFixed(1)}%).`;
                // Upgrade status if significant improvement
                if (result.status === "Fair" && trends.hitRatios[trends.hitRatios.length - 1] >= 0.45) {
                    result.status = "Good";
                }
            } else if (trends.trend === "deteriorating") {
                result.details += ` Cache performance is deteriorating over time (${(trends.hitRatios[0] * 100).toFixed(1)}% → ${(trends.hitRatios[trends.hitRatios.length - 1] * 100).toFixed(1)}%).`;
                // Downgrade status if significant deterioration
                if (result.status === "Good" && trends.hitRatios[trends.hitRatios.length - 1] <= 0.55) {
                    result.status = "Fair";
                }
            }
        }

        return result;
    }

    // ==============================
    // LLM-based Analysis
    // ==============================
    function getLlmApiInfo() {
        return new Promise((resolve, reject) => {
            chrome.storage.local.get(
                [config.llm.storageKeys.apiKey, config.llm.storageKeys.provider],
                result => {
                    const apiKey = result[config.llm.storageKeys.apiKey];
                    const provider = result[config.llm.storageKeys.provider] || config.llm.defaultProvider;
                    resolve({ provider, apiKey });
                }
            );
        });
    }

    function performLlmAnalysis(provider, apiKey, data) {
        const prompt = buildLlmPrompt(data);

        // Based on selected provider, call appropriate API
        if (provider === config.llm.providers.anthropic) {
            return callAnthropicApi(apiKey, prompt);
        } else if (provider === config.llm.providers.openai) {
            return callOpenAiApi(apiKey, prompt);
        } else if (provider === config.llm.providers.gemini) {
            return callGeminiApi(apiKey, prompt);
        } else if (provider === config.llm.providers.mistral) {
            return callMistralApi(apiKey, prompt);
        } else {
            return Promise.reject(new Error(`Unsupported LLM provider: ${provider}`));
        }
    }

    function buildLlmPrompt(data) {
        // Create a copy of the data to trim
        const trimmedData = JSON.parse(JSON.stringify(data));

        // Limit the size of large arrays
        if (trimmedData.metrics && trimmedData.metrics.eventHistory) {
            // Keep only the most recent 50 events
            trimmedData.metrics.eventHistory =
                trimmedData.metrics.eventHistory.slice(0, 50);
        }

        // Limit segment information to avoid token explosion
        if (trimmedData.stream && trimmedData.stream.activeMedia &&
            trimmedData.stream.activeMedia.segments) {
            // Keep only 20 most recent segments
            trimmedData.stream.activeMedia.segments =
                trimmedData.stream.activeMedia.segments.slice(0, 20);
        }

        // Trim any other large arrays to reasonable sizes
        if (trimmedData.metrics) {
            if (trimmedData.metrics.rebufferingDurations &&
                trimmedData.metrics.rebufferingDurations.length > 10) {
                trimmedData.metrics.rebufferingDurations =
                    trimmedData.metrics.rebufferingDurations.slice(0, 10);
            }

            if (trimmedData.metrics.throughput &&
                trimmedData.metrics.throughput.length > 20) {
                trimmedData.metrics.throughput =
                    trimmedData.metrics.throughput.slice(0, 20);
            }

            if (trimmedData.metrics.downloadSpeed &&
                trimmedData.metrics.downloadSpeed.length > 20) {
                trimmedData.metrics.downloadSpeed =
                    trimmedData.metrics.downloadSpeed.slice(0, 20);
            }

            if (trimmedData.metrics.latency &&
                trimmedData.metrics.latency.length > 20) {
                trimmedData.metrics.latency =
                    trimmedData.metrics.latency.slice(0, 20);
            }
        }

        // Enhance prompt with interval data if available
        let intervalContext = '';
        if (trimmedData.intervals && trimmedData.intervals.count > 1) {
            intervalContext = `
This analysis includes data collected at ${trimmedData.intervals.count} checkpoints over ${trimmedData.analysisTime.toFixed(1)} seconds, allowing for time-based trend analysis. The data shows how metrics evolved during the session.`;

            // Include key trend information if available
            if (trimmedData.trends) {
                intervalContext += `

Key trends observed:`;

                if (trimmedData.trends.playbackErrors) {
                    intervalContext += `
- Playback stability: ${trimmedData.trends.playbackErrors.stability}`;
                }

                if (trimmedData.trends.abrPerformance) {
                    intervalContext += `
- ABR switching pattern: ${trimmedData.trends.abrPerformance.stability}`;
                    if (trimmedData.trends.abrPerformance.bitrateConsistency) {
                        intervalContext += `
- Bitrate consistency: ${trimmedData.trends.abrPerformance.bitrateConsistency}`;
                    }
                }

                if (trimmedData.trends.cacheEffectiveness) {
                    intervalContext += `
- Cache hit ratio trend: ${trimmedData.trends.cacheEffectiveness.trend}`;
                }
            }
        }

        // Create context section with reduced data
        let prompt = `As an expert HLS streaming engineer, analyze the following stream telemetry data collected over ${data.analysisTime.toFixed(1)} seconds:${intervalContext}

\`\`\`json
${JSON.stringify(trimmedData, null, 2)}
\`\`\`

Your task is to provide a professional technical assessment that would help diagnose streaming performance, identify optimization opportunities, and ensure delivery quality. Focus on the following requested analyses:`;

        // Add task-specific instructions with expert-level depth
        if (data.tasks.includes('analyzePlaybackErrors')) {
            prompt += `

## Playback Error Analysis
- Conduct in-depth examination of buffering events, their frequency, duration, and pattern
- Correlate rebuffering with bandwidth fluctuations and segment load times
- Evaluate startup time and time-to-first-frame against industry benchmarks
- Assess if errors are related to network conditions, CDN issues, or client-side limitations
- Determine if the error pattern indicates systemic issues or transient network problems`;
        }

        if (data.tasks.includes('assessAbrPerformance')) {
            prompt += `

## ABR Performance Analysis
- Evaluate the ABR algorithm's responsiveness to changing network conditions
- Analyze the ladder selection strategy and appropriateness of quality transitions
- Assess if quality switches are occurring too frequently (suggesting instability) or too infrequently (suggesting conservative ABR)
- Calculate the time spent at each quality level and evaluate if it maximizes user experience
- Determine if the player is making optimal use of available bandwidth`;
        }

        if (data.tasks.includes('evaluateCacheEffectiveness')) {
            prompt += `

## Cache Effectiveness Analysis
- Analyze CDN cache hit/miss patterns and their impact on delivery performance
- Evaluate cache TTL settings against content type and update frequency
- Identify cache invalidation issues or sub-optimal cache configurations
- Assess cache efficiency in relation to segment durations and playlist refresh rates
- Calculate potential bandwidth savings from improved caching`;
        }

        // Output format instructions with expert recommendations
        prompt += `

## Response Format
Respond with a JSON object structured exactly as follows:

\`\`\`json
{
  "summary": "Concise expert assessment of overall stream health and key findings",
  "tasks": {
    ${data.tasks.includes('analyzePlaybackErrors') ? `"playbackErrors": {
      "status": "Stable|Warning|Unstable|Critical",
      "details": "Technical diagnosis of playback errors with specific metrics",
      "recommendation": "Expert recommendation to address any identified issues"
    },` : ''}
    ${data.tasks.includes('assessAbrPerformance') ? `"abrPerformance": {
      "status": "Excellent|Good|Fair|Poor|Inactive",
      "details": "Technical evaluation of ABR behavior with specific metrics",
      "recommendation": "Expert recommendation to optimize ABR performance"
    },` : ''}
    ${data.tasks.includes('evaluateCacheEffectiveness') ? `"cacheEffectiveness": {
      "status": "Excellent|Good|Fair|Poor|Unavailable",
      "details": "Technical assessment of caching efficiency with specific metrics",
      "recommendation": "Expert recommendation to improve cache utilization"
    }` : ''}
  }
}
\`\`\`

Your analysis must be firmly grounded in the provided data. Status values must be one of the specified options. Keep the 'details' field technically precise but concise (1-3 sentences). The 'recommendation' field should provide actionable engineering advice.`;

        return prompt;
    }

    function callAnthropicApi(apiKey, prompt) {
        const endpoint = config.llm.endpoints.anthropic;

        console.log(`[agent_manager] Calling Anthropic API with model: ${config.llm.models.anthropic}`);
        console.log(`[agent_manager] API key format check: ${apiKey ? 'Key present (starts with: ' + apiKey.substring(0, 4) + '...)' : 'No API key!'}`);

        const requestBody = {
            model: config.llm.models.anthropic,
            messages: [
                { role: 'user', content: [{ type: 'text', text: prompt }] }
            ],
            max_tokens: 1500
        };

        return fetch(endpoint, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': apiKey,
                'anthropic-version': '2023-06-01',
                'anthropic-dangerous-direct-browser-access': 'true'  // Added this required header
            },
            body: JSON.stringify(requestBody)
        })
            .then(response => {
                console.log(`[agent_manager] Anthropic API response status: ${response.status}`);

                if (!response.ok) {
                    return response.text().then(text => {
                        try {
                            const errorJson = JSON.parse(text);
                            console.error('[agent_manager] Anthropic API error details:', errorJson);
                            throw new Error(`Anthropic API error: ${response.status} - ${errorJson.error?.message || errorJson.type || text}`);
                        } catch (parseError) {
                            console.error('[agent_manager] Anthropic API error (raw):', text);
                            throw new Error(`Anthropic API error: ${response.status} - ${text}`);
                        }
                    });
                }
                return response.json();
            })
            .then(data => {
                console.log('[agent_manager] Anthropic API response received successfully');
                const content = data?.content?.[0]?.text;
                if (!content) {
                    console.error('[agent_manager] Empty content in successful response:', data);
                    throw new Error("Empty response from Anthropic API");
                }

                try {
                    // Extract JSON from the response
                    const jsonMatch = content.match(/```json\s*([\s\S]*?)\s*```/) ||
                        content.match(/\{[\s\S]*\}/);

                    if (jsonMatch) {
                        return JSON.parse(jsonMatch[1] || jsonMatch[0]);
                    } else {
                        return { summary: content };
                    }
                } catch (error) {
                    console.error('[agent_manager] JSON parsing error:', error);
                    return { summary: content };
                }
            })
            .catch(error => {
                console.error('[agent_manager] Anthropic API call failed:', error);
                throw error;
            });
    }

    function callOpenAiApi(apiKey, prompt) {
        // NOTE: Placeholder for OpenAI API call implementation
        return Promise.reject(new Error("OpenAI API integration not implemented"));
    }

    async function callGeminiApi(apiKey, prompt) {
        const endpoint = `${config.llm.endpoints.gemini}?key=${apiKey}`;
        const requestBody = {
            contents: [{
                parts: [{ text: prompt }]
            }],
            generationConfig: {
                temperature: 0.2,
                topK: 40,
                topP: 0.95,
                maxOutputTokens: 2048,
                safetySettings: [
                    { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" },
                    { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_NONE" },
                    { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_NONE" },
                    { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_NONE" }
                ]
            }
        };

        try {
            const response = await fetch(endpoint, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(requestBody)
            });

            if (!response.ok) {
                let errorText = await response.text();
                let errorMessage = `Gemini API error: ${response.status}`;
                try {
                    // Attempt to parse Google's structured error
                    const errorJson = JSON.parse(errorText);
                    if (errorJson.error && errorJson.error.message) {
                        errorMessage += ` - ${errorJson.error.message}`;
                    } else {
                        errorMessage += ` - ${errorText}`;
                    }
                } catch (e) {
                    // If parsing errorJson fails, just use the raw text
                    errorMessage += ` - ${errorText}`;
                }
                console.error('[agent_manager] Gemini API HTTP Error:', errorMessage, 'Raw Response:', errorText);
                throw new Error(errorMessage);
            }

            const data = await response.json();

            // Check for content filter reasons first (if safetySettings are strict)
            if (data.candidates && data.candidates[0] && data.candidates[0].finishReason === "SAFETY") {
                console.warn('[agent_manager] Gemini API response blocked due to safety settings. Candidate:', data.candidates[0]);
                throw new Error("Gemini API Error: Response blocked due to safety concerns. The prompt or response might have violated content policies.");
            }
            if (data.candidates && data.candidates[0] && data.candidates[0].finishReason === "MAX_TOKENS") {
                console.warn('[agent_manager] Gemini API response truncated due to max_tokens. Candidate:', data.candidates[0]);
                // Proceed with potentially truncated content, or throw an error if full response is critical
            }


            const content = data?.candidates?.[0]?.content?.parts?.[0]?.text;

            if (!content) {
                console.error('[agent_manager] Gemini API Error: No content found in a successful response. Full data:', data);
                throw new Error("Gemini API Error: Empty or malformed content in response.");
            }

            // Attempt to parse JSON from the content
            const jsonMatch = content.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
            let parsedJson = null;

            if (jsonMatch && jsonMatch[1]) {
                try {
                    parsedJson = JSON.parse(jsonMatch[1]);
                } catch (error) {
                    console.warn("[agent_manager] Failed to parse extracted JSON from Gemini markdown, trying to parse whole content. Error:", error, "Content:", content);
                    // Fall through to try parsing the whole content if markdown extraction fails
                }
            }

            if (!parsedJson) { // If markdown extraction failed or no markdown block found
                try {
                    // Try parsing the whole content as JSON directly
                    parsedJson = JSON.parse(content);
                } catch (error) {
                    console.warn("[agent_manager] Failed to parse entire Gemini response content as JSON. Error:", error, "Returning as summary. Content:", content);
                    return { summary: content, rawContent: content }; // Include rawContent for debugging
                }
            }
            return parsedJson;

        } catch (error) {
            // Catch network errors or errors re-thrown from response handling
            console.error('[agent_manager] Error in callGeminiApi:', error);
            throw error; // Re-throw for the caller (e.g., finishAnalysis) to handle
        }
    }

    function callMistralApi(apiKey, prompt) {
        // NOTE: Placeholder for Mistral API call implementation
        return Promise.reject(new Error("Mistral API integration not implemented"));
    }

    // ==============================
    // Results Display
    // ==============================
    function displayResults(message) {
        if (elements.resultsContainer) {
            elements.resultsContainer.innerHTML = `<p>${message}</p>`;
        }
    }

    function displayAnalysisResults(results) {
        state.resultsData = results;
        if (!elements.resultsContainer) return;

        const statusColors = {
            'stable': '#4CAF50',
            'warning': '#FFC107',
            'unstable': '#FF9800',
            'critical': '#F44336',
            'error': '#F44336',
            'excellent': '#4CAF50',
            'good': '#8BC34A',
            'fair': '#FFC107',
            'poor': '#FF9800',
            'inactive': '#9E9E9E',
            'unavailable': '#9E9E9E',
            'insufficient data': '#9E9E9E'
        };

        const taskDisplayNames = {
            'playbackErrors': 'Playback Errors',
            'abrPerformance': 'ABR Performance',
            'cacheEffectiveness': 'Cache Effectiveness'
        };

        function cleanAndFormatText(text) {
            if (!text) return '';
            return text.replace(/\n/g, '<br>')
                .split('<br>')
                .map(line => line.trim().replace(/\s{2,}/g, ' '))
                .join('<br>')
                .trim();
        }

        let html = `<div style="font-family: 'Segoe UI', Arial, sans-serif; color: #e0e0e0; padding: 2px;">`;

        html += `
            <h3 style="margin: 0 0 3px 0; color: #ffffff; font-size: 14px; padding: 0;">Analysis Summary</h3>
            <div style="margin: 0 0 8px 0; line-height: 1.35; font-size: 12px; word-break: break-word;">${cleanAndFormatText(results.summary)}</div>
        `;

        if (results.tasks) {
            Object.entries(results.tasks).forEach(([taskId, taskResult]) => {
                const taskName = taskDisplayNames[taskId] || taskId.replace(/([A-Z])/g, ' $1').replace(/^./, str => str.toUpperCase());
                const statusLower = (taskResult.status || "unavailable").toLowerCase();
                const statusColor = statusColors[statusLower] || '#9E9E9E';
                const badgeTextColor = (statusLower === 'warning' || statusLower === 'fair') ? '#000000' : '#FFFFFF';

                html += `
                    <div style="margin: 0 0 6px 0; border-left: 4px solid ${statusColor}; padding: 0 0 0 8px;">
                        <div style="display: flex; justify-content: space-between; align-items: center; margin: 0 0 1px 0;">
                            <h4 style="margin: 0; color: #ffffff; font-size: 13px; flex-grow: 1;">${taskName}</h4>
                            <span style="background-color: ${statusColor}; border-radius: 3px; color: ${badgeTextColor}; font-size: 8px; padding: 1px 5px; font-weight: bold; text-transform: uppercase; letter-spacing: 0.5px; white-space: nowrap;">${taskResult.status || 'N/A'}</span>
                        </div>
                        <div style="margin: 0 0 1px 0; line-height: 1.3; font-size: 12px; word-break: break-word;">${cleanAndFormatText(taskResult.details)}</div>
                `;

                // Add trend information if available
                if (taskResult.trends) {
                    html += `
                        <div style="margin-top: 2px; background-color: rgba(0,0,0,0.2); padding: 3px 5px; border-radius: 3px;">
                            <h5 style="margin: 0 0 1px 0; color: #d0d0d0; font-size: 10px; font-weight: bold;">Trend:</h5>
                            <div style="margin: 0; line-height: 1.3; font-size: 10px; color: #b0b0b0; word-break: break-word;">`;

                    if (taskId === 'playbackErrors' && taskResult.trends.stability) {
                        html += `Playback stability trend: ${taskResult.trends.stability}`;
                    } else if (taskId === 'abrPerformance') {
                        if (taskResult.trends.stability) {
                            html += `ABR switching pattern: ${taskResult.trends.stability}`;
                        }
                        if (taskResult.trends.bitrateConsistency) {
                            html += `<br>Bitrate consistency: ${taskResult.trends.bitrateConsistency}`;
                        }
                    } else if (taskId === 'cacheEffectiveness' && taskResult.trends.trend) {
                        html += `Cache hit ratio trend: ${taskResult.trends.trend}`;
                    }

                    html += `</div>
                        </div>`;
                }

                if (taskResult.recommendation) {
                    html += `
                        <div style="margin-top: 0px;">
                            <h5 style="margin: 0 0 1px 0; color: #d0d0d0; font-size: 12px; font-weight: bold;">Recommendation:</h5>
                            <div style="margin: 0; line-height: 1.3; font-size: 12px; color: #b0b0b0; word-break: break-word;">${cleanAndFormatText(taskResult.recommendation)}</div>
                        </div>
                    `;
                }
                html += `</div>`;
            });
        }
        html += `</div>`;
        elements.resultsContainer.innerHTML = html;
    }


    // Helper function to format recommendations with bullet points if needed
    function formatRecommendationWithTrim(recommendation) {
        if (!recommendation) return '';

        // First trim the whole text
        const trimmedRec = recommendation.split('\n')
            .map(line => line.trim())
            .join(' ')
            .replace(/\s{2,}/g, ' ');

        // Check if there are numbered points (e.g., "1. First point")
        if (trimmedRec.match(/\d+\.\s+[A-Z]/)) {
            return trimmedRec.replace(/(\d+\.\s+)([^\d]+?)(?=\s*\d+\.|$)/g,
                '<div style="margin-bottom: 6px; text-align: left;"><span style="color: #8BC34A; font-weight: bold;">$1</span>$2</div>'
            );
        }

        return trimmedRec;
    }

    function getTaskDisplayName(taskId) {
        const taskNames = {
            'analyzePlaybackErrors': 'Playback Stability Analysis',
            'assessAbrPerformance': 'ABR Performance Analysis',
            'evaluateCacheEffectiveness': 'Cache Effectiveness Analysis'
        };

        return taskNames[taskId] || taskId;
    }

    // ==============================
    // Export Functions
    // ==============================
    function handleExportResults() {
        if (!state.resultsData) return;

        exportResultsAsJson(state.resultsData);

        // NOTE: Placeholder for future export methods
        // exportResultsToEmail();
        // exportResultsToSlack();
        // exportResultsToJira();
    }

    function exportResultsAsJson(data) {
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `stream-analysis-${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }

    // ==============================
    // Export to Integration Stubs
    // ==============================
    function exportResultsToEmail() {
        // NOTE: Placeholder for email integration
        // Implementation would go here
    }

    function exportResultsToSlack() {
        // NOTE: Placeholder for Slack integration
        // Implementation would go here
    }

    function exportResultsToJira() {
        // NOTE: Placeholder for JIRA integration
        // Implementation would go here
    }

    // ==============================
    // Initialization
    // ==============================
    document.addEventListener('DOMContentLoaded', init);
})();