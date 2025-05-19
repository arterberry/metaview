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

        // Timer configuration (default 2 minutes)
        timer: {
            defaultMinutes: 0,     // Changed from 2 minutes to 0 minutes
            defaultSeconds: 15,    // Changed from 0 seconds to 15 seconds
            minTime: 5,            // minimum 5 seconds
            maxTime: 600           // maximum 10 minutes
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
        resultsData: null
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
        } else {
            // Add full minutes when the time is already substantial
            state.timer.minutes += 1;
        }

        // Enforce maximum
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
        } else {
            // For larger values, decrement in minutes
            if (state.timer.seconds > 0) {
                state.timer.seconds = 0;
            } else {
                state.timer.minutes -= 1;
            }
        }

        // Enforce minimum
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

    function startTimerCountdown() {
        if (state.timer.intervalId) {
            clearInterval(state.timer.intervalId);
        }

        let totalSeconds = state.timer.totalSeconds();
        state.timer.intervalId = setInterval(() => {
            totalSeconds--;
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
        const collectedData = collectDataForAnalysis();

        if (Object.keys(collectedData).length === 0) {
            stopAnalysis();
            displayResults("Error: Could not collect sufficient data for analysis. Please ensure the player has loaded a stream.");
            return;
        }

        // Future enhancement: For now perform local analysis without LLM
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

        // Create context section with reduced data
        let prompt = `As an expert HLS streaming engineer, analyze the following stream telemetry data collected over ${data.analysisTime.toFixed(1)} seconds:

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
                        <div style="margin: 0 0 1px 0; line-height: 1.3; font-size: 11px; word-break: break-word;">${cleanAndFormatText(taskResult.details)}</div>
                `;

                if (taskResult.recommendation) {
                    html += `
                        <div style="margin-top: 0px;">
                            <h5 style="margin: 0 0 1px 0; color: #d0d0d0; font-size: 11px; font-weight: bold;">Recommendation:</h5>
                            <div style="margin: 0; line-height: 1.3; font-size: 11px; color: #b0b0b0; word-break: break-word;">${cleanAndFormatText(taskResult.recommendation)}</div>
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