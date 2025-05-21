//tests/test_wrapper/test-cdp-basic.js

/* 
This script launches a Chrome instance with a specific profile and extension, waits for a target page to load, and then executes a script in the page context to check for the presence of a specific API. It uses the Chrome DevTools Protocol (CDP) to interact with the browser. It is designed to be run in a Node.js environment and requires the 'chrome-remote-interface' package. The basic purpose is to allow external scripts to grab data from the *.m3u8 under test and export metrics to a JSON. This can be picked up by a curl script or a test automation framework. 

This sample script verifies the window.metaviewAPI.metrics.getQoEState() API call and places the results on the terminal and in qoe_results.json.

It also requires a tokenized channel path to test.

Make ccertain to apply npm install chrome-remote-interface to your node_modules directory.

Example:
node tests/test_wrapper/test-cdp-basic.js "https://qa-foxdtc-video.akamaized.net/live/fs1-ue2/index.m3u8?ad_env=1&bu=foxdtc&cdn=ak&channel=fs1-ue2&duration=1209600&hdnts=exp%3D1749057113~acl%3D%2F*~hmac%3D3a705d7efcc0517664c108562107521ceaf33d1eeaf019bb961d8afb5006791a"

*/

const CDP = require('chrome-remote-interface');
const { spawn } = require('child_process');
const path = require('path');
const os = require('os');
const fs = require('fs'); 

const CHROME_PATH = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PROFILE_DIRECTORY_NAME = 'ProfileForTesting';
const TEMP_USER_DATA_DIR = path.join(os.tmpdir(), `metaview_chrome_test_profile_${Date.now()}`);
const EXTENSION_LOAD_PATH = '/Users/arterberry/Development/metaview/dist';
const REMOTE_DEBUGGING_PORT = 9222;
let TARGET_HLS_URL = process.argv[2] || null;
const API_RESULTS_FILE = 'qoe_results.json'; 

const WARM_UP_SECONDS = 15;
const EXPECTED_PLAYER_PAGE_IDENTIFIER = 'player.html';

let chromeProcess;
let cdpClient;
let cdpNavigationClient;

// Prioritizing EXPECTED_PLAYER_PAGE_IDENTIFIER.
async function waitForFinalTarget(port, targetUrlToWaitFor, timeout = 10000, checkInterval = 1000) { // timeout reduced to 10s
    console.log(`waitForFinalTarget: Waiting up to ${timeout / 1000}s for page to settle on a URL related to "${targetUrlToWaitFor || EXPECTED_PLAYER_PAGE_IDENTIFIER}"...`);
    const startTime = Date.now();
    while (Date.now() - startTime < timeout) {
        try {
            const targets = await CDP.List({ port });
            let pageTarget = targets.find(t => t.type === 'page' && t.url && t.url.includes(EXPECTED_PLAYER_PAGE_IDENTIFIER));

            if (!pageTarget) {
                pageTarget = targets.find(
                    t => t.type === 'page' &&
                        t.url &&
                        (t.url.startsWith('http') || (targetUrlToWaitFor && t.url.includes(new URL(targetUrlToWaitFor).hostname))) &&
                        !t.url.startsWith('chrome-devtools://') &&
                        t.url !== 'about:blank'
                );
            }

            if (pageTarget) {
                console.log(`Found suitable final target: ${pageTarget.url} (ID: ${pageTarget.id}) after ${(Date.now() - startTime) / 1000}s.`);
                return pageTarget;
            }
        } catch (e) {
            // console.log(`waitForFinalTarget: Polling attempt failed: ${e.message.split('\n')[0]}`);
        }
        await new Promise(resolve => setTimeout(resolve, checkInterval));
    }
    throw new Error(`Timeout: Could not find a suitable final page target after ${timeout / 1000} seconds.`);
}

// Main execution function
async function executeTest() {
    if (TARGET_HLS_URL) {
        console.log(`Attempting to use target URL from command line: ${TARGET_HLS_URL}`);
    } else {
        console.log('No target URL provided. Chrome will be launched and left on its default page after warm-up.');
    }

    try {
        const chromeArgs = [
            `--remote-debugging-port=${REMOTE_DEBUGGING_PORT}`,
            `--user-data-dir=${TEMP_USER_DATA_DIR}`,
            `--profile-directory=${PROFILE_DIRECTORY_NAME}`,
            `--load-extension=${EXTENSION_LOAD_PATH}`,
            `--disable-extensions-except=${EXTENSION_LOAD_PATH}`,
            '--no-first-run',
            '--no-default-browser-check',
            '--disable-gpu'
        ];

        console.log(`Launching Chrome (PID will be assigned). It will open to a default page.`);
        chromeProcess = spawn(CHROME_PATH, chromeArgs, {
            detached: true,
            stdio: ['ignore', 'pipe', 'pipe']
        });

        chromeProcess.stdout.on('data', (data) => console.log(`Chrome STDOUT: ${data.toString().trim()}`));
        chromeProcess.stderr.on('data', (data) => console.error(`Chrome STDERR: ${data.toString().trim()}`));

        console.log(`Chrome launched with PID: ${chromeProcess.pid}. Waiting ${WARM_UP_SECONDS}s for warm-up...`);
        await new Promise(resolve => setTimeout(resolve, WARM_UP_SECONDS * 1000));
        console.log('Warm-up complete.');

        if (!TARGET_HLS_URL) {
            console.log('No URL to navigate to. Script will now "hang" to keep browser open.');
            console.log('Press Ctrl+C in this terminal to stop the script and close Chrome.');
            await new Promise(() => { });
            return;
        }

        const initialTargets = await CDP.List({ port: REMOTE_DEBUGGING_PORT });
        if (!initialTargets || initialTargets.length === 0) {
            throw new Error('No debuggable targets found after warm-up. Is Chrome running correctly?');
        }
        const initialPageTarget = initialTargets.find(t => t.type === 'page' && !t.url.startsWith('chrome-devtools://') && t.url !== 'about:blank');
        if (!initialPageTarget) {
            throw new Error('Could not find an initial page target to navigate.');
        }
        console.log(`Found initial page target: ${initialPageTarget.url} (ID: ${initialPageTarget.id})`);

        cdpNavigationClient = await CDP({ target: initialPageTarget.id, port: REMOTE_DEBUGGING_PORT });
        const { Page: NavPage } = cdpNavigationClient;
        await NavPage.enable();
        console.log(`Navigating initial page to: ${TARGET_HLS_URL}`);
        await NavPage.navigate({ url: TARGET_HLS_URL });
        await cdpNavigationClient.close();
        cdpNavigationClient = null;
        console.log('Navigation to TARGET_HLS_URL initiated.');

        const finalPageTargetInfo = await waitForFinalTarget(REMOTE_DEBUGGING_PORT, TARGET_HLS_URL, 10000); // Explicitly using 10s timeout

        cdpClient = await CDP({ target: finalPageTargetInfo.id, port: REMOTE_DEBUGGING_PORT });
        const { Runtime, Page } = cdpClient;
        await Page.enable();

        console.log('Successfully connected to final target. Attempting to wait for its load event (max 5s)...');
        const loadEventFiredPromise = Page.loadEventFired();
        const loadEventTimeoutPromise = new Promise(resolve => setTimeout(() => resolve({timedOut: true}), 5000)); // 5 second timeout

        const loadResult = await Promise.race([loadEventFiredPromise, loadEventTimeoutPromise]);

        if (loadResult && loadResult.timedOut) {
            console.log('Page.loadEventFired timed out after 5s, proceeding anyway.');
        } else {
            console.log('Final target page loadEventFired received.');
        }
        
        console.log('Performing additional wait (6 seconds)...'); // Updated log message
        await new Promise(resolve => setTimeout(resolve, 6000)); // Reduced to 6 seconds

        // === BEGIN METAVIEW API QOE STATE TEST ===
        console.log('Additional wait complete. Attempting to get QoE state with polling...'); // Updated log message
        const expression = `
            (async function() {
                const logs = [];
                const startTime = Date.now();
                logs.push('Polling for API. Start Timestamp: ' + startTime);
                // Reduced polling to 20 attempts (20 seconds)
                for (let i = 0; i < 20; i++) { 
                    const attemptTime = Date.now();
                    logs.push('Poll attempt ' + (i+1) + ' at ' + ((attemptTime - startTime)/1000).toFixed(1) + 's');
                    logs.push('  typeof window.Hls: ' + typeof window.Hls);
                    logs.push('  typeof window.metaviewAPI: ' + typeof window.metaviewAPI);
                    if (window.metaviewAPI) {
                        logs.push('  typeof window.metaviewAPI.metrics: ' + typeof window.metaviewAPI.metrics);
                        if (window.metaviewAPI.metrics && typeof window.metaviewAPI.metrics.getQoEState === 'function') {
                            logs.push('  getQoEState is a function. Calling it.');
                            try {
                                const state = await window.metaviewAPI.metrics.getQoEState();
                                logs.push('  getQoEState call successful at ' + ((Date.now() - startTime)/1000).toFixed(1) + 's');
                                return { value: state, logs: logs };
                            } catch (e) {
                                logs.push('  Error calling getQoEState: ' + e.message);
                                return { error: 'Error calling getQoEState: ' + e.message, logs: logs };
                            }
                        }
                    }
                    if (i < 19) { // Adjusted for 20 attempts
                        logs.push('  API not ready yet. Waiting 1 second...');
                        await new Promise(resolve => setTimeout(resolve, 1000));
                    }
                }
                logs.push('API not found after ' + ((Date.now() - startTime)/1000).toFixed(1) + 's of polling.');
                return { error: 'metaviewAPI.metrics.getQoEState not found after multiple attempts.', logs: logs };
            })();
        `;

        const result = await Runtime.evaluate({
            expression: expression,
            returnByValue: true,
            awaitPromise: true,
            timeout: 30000 // Reduced overall timeout for evaluate (e.g., 30s, must be > 20s polling)
        });

        if (result.result && result.result.value && result.result.value.logs) {
            console.log('--- Logs from inside page context ---');
            result.result.value.logs.forEach(log => console.log(log));
            console.log('------------------------------------');
        }

        if (result.exceptionDetails) {
            console.error('JavaScript execution error within page:', result.exceptionDetails.text);
            if (result.exceptionDetails.exception) {
                console.error('Exception value:', result.exceptionDetails.exception.description);
            }
        } else if (result.result.value && result.result.value.error) {
            console.error('API Call Error (from page logic):', result.result.value.error);
        } else if (result.result.value && result.result.value.value) {
            const qoeState = result.result.value.value;
            console.log('QoE State Result:', qoeState);
            try {
                fs.writeFileSync(API_RESULTS_FILE, JSON.stringify(qoeState, null, 2));
                console.log(`Successfully wrote QoE results to ${API_RESULTS_FILE}`);
            } catch (fileError) {
                console.error(`Error writing QoE results to file: ${fileError.message}`);
            }
        } else {
            console.log('Unexpected result structure from evaluate:', result);
        }
        // === END METAVIEW API QOE STATE TEST ===

        console.log('MetaView API call attempt complete.');
        // await new Promise(() => { });  // Add this to leave browser open and to CTRL-C out.

    } catch (err) {
        console.error('Error during test execution:', err.message);
        if (err.stack) {
            console.error(err.stack);
        }
    } finally {
        await cleanup();
    }
}

// Handles graceful shutdown of CDP clients and Chrome process.
async function cleanup() {
    if (cdpNavigationClient) {
        try {
            await cdpNavigationClient.close();
        } catch (e) {/* ignore */ }
    }
    if (cdpClient) {
        try {
            await cdpClient.close();
        } catch (e) {
            console.error('Error closing main CDP client:', e.message);
        }
    }
    if (chromeProcess && chromeProcess.pid && !chromeProcess.killed) {
        console.log(`Attempting to terminate Chrome process (PID: ${chromeProcess.pid}).`);
        chromeProcess.unref();
        const pidToKill = -chromeProcess.pid;
        try {
            process.kill(pidToKill, 'SIGKILL');
        } catch (e) {
            try {
                process.kill(chromeProcess.pid, 'SIGKILL');
            } catch (e2) {
                console.error(`Failed to kill Chrome process PID ${chromeProcess.pid}: ${e2.message}.`);
            }
        }
    }
    console.log('Cleanup finished.');
    chromeProcess = null;
    cdpClient = null;
    cdpNavigationClient = null;
}

// Handles Ctrl+C interruption for cleanup.
process.on('SIGINT', async () => {
    console.log('\nSIGINT received, initiating cleanup...');
    if (chromeProcess && chromeProcess.pid && !chromeProcess.killed) {
        chromeProcess.unref();
    }
    await cleanup();
    process.exit(0);
});

executeTest();