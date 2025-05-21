# Command Line Test Wrapper for MetaView API (`test-cdp-basic.js`)

This Node script provides a command-line interface to launch Google Chrome with the MetaView extension, navigate to a specified HLS URL, and retrieve QoE (Quality of Experience) metrics by calling an internal API (`window.metaviewAPI.metrics.getQoEState()`) of the extension. The retrieved metrics are then saved to a JSON file.

This script is primarily intended to be:
1.  Run directly from the command line for quick, isolated tests of specific HLS streams with the MetaView extension.
2.  Called by other automation tools (like the Cypress test suite in this project) to perform the browser interaction and API data retrieval part of a larger test.

## Features

-   Launches Chrome with a dedicated temporary profile to ensure a clean testing environment.
-   Loads the specified MetaView extension.
-   Accepts a target HLS URL as a command-line argument.
-   Navigates to the target HLS URL after a warm-up period for Chrome and the extension.
-   Waits for the page to load and stabilize.
-   Polls for the availability of `window.metaviewAPI.metrics.getQoEState()`.
-   Executes the API call and retrieves QoE data.
-   Writes the QoE data to a JSON file (`qoe_results.json` by default, placed in the `tests/` directory relative to the project root).
-   Keeps the browser open after the API call for inspection (when run directly and the script "hangs").
-   Cleans up by attempting to close the Chrome process on script termination (e.g., Ctrl+C).

## Prerequisites

1.  **Node.js and npm (or yarn):** Must be installed.
2.  **Google Chrome:** The script requires Google Chrome. The path to the executable is hardcoded and may need adjustment.
3.  **MetaView Extension:** A built version (`dist` folder) of the MetaView extension is required. The path to this is also hardcoded.
4.  **`chrome-remote-interface` package:** This Node.js module is used for CDP communication.

## Configuration

Before running, you may need to adjust the following constants at the top of `test-cdp-basic.js`:

-   `CHROME_PATH`: Absolute path to your Google Chrome executable.
    -   Default (macOS): `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`
-   `EXTENSION_LOAD_PATH`: Absolute path to the directory containing the built MetaView extension (usually the `dist` folder).
    -   Example: `/Users/youruser/Development/metaview/dist`
-   `REMOTE_DEBUGGING_PORT`: The port Chrome will use for remote debugging. Ensure this port is free.
    -   Default: `9222`
-   `API_RESULTS_FILE`: The name of the output JSON file. The script is currently configured to save this in the `tests/` directory at the project root. If you change the output location, ensure any calling scripts (like Cypress tasks) are updated to look in the correct place.
    -   Default output path calculation leads to: `YOUR_PROJECT_ROOT/tests/qoe_results.json`
-   `WARM_UP_SECONDS`: Initial delay to allow Chrome and the extension to fully initialize before navigation.
    -   Default: `15` seconds
-   Wait times within `waitForFinalTarget` and after `Page.loadEventFired` can also be tuned if needed.

## How to Run Independently

1.  **Navigate to the project root directory** in your terminal (e.g., `metaview/`).
2.  **Ensure Port is Free:** Make sure the `REMOTE_DEBUGGING_PORT` (default 9222) is not in use.
3.  **Execute the script:**

    *   **To test a specific HLS URL:**
        ```bash
        node tests/test_wrapper/test-cdp-basic.js "YOUR_HLS_STREAM_URL_HERE"
        ```
        **Important:** Enclose the URL in double quotes if it contains special characters like `&`, `?`, etc.

    *   **To launch Chrome with the extension without navigating to a specific URL (browser will open to a new tab):**
        ```bash
        node tests/test_wrapper/test-cdp-basic.js
        ```
        In this mode, the script will launch Chrome, perform the warm-up, and then wait indefinitely (keeping the browser open) until you manually terminate the script (Ctrl+C). No API call will be made, and no `qoe_results.json` will be generated.

## Output

-   **Console Logs:** The script will print detailed logs to the console about its progress, including Chrome launch, warm-up, navigation, connection attempts, API call polling, and results or errors. Chrome's own `stdout` and `stderr` are also piped to the console.
-   **`qoe_results.json`:** If a `TARGET_HLS_URL` is provided and the `getQoEState()` API call is successful, the retrieved QoE data will be written to this JSON file. The default location is `YOUR_PROJECT_ROOT/tests/qoe_results.json`.

## Troubleshooting

-   **`Error: bind() failed: Address already in use`:** The `REMOTE_DEBUGGING_PORT` is already in use. Stop the other process or change the port in the script.
-   **`Error: Cannot find module 'chrome-remote-interface'`:** The required package is not installed. Run `npm install chrome-remote-interface` in the project root.
-   **Script hangs or API not found:**
    -   The HLS stream might not be playing correctly, or the MetaView extension might not have injected its API.
    -   Wait times might be too short for your specific stream or system. Consider increasing `WARM_UP_SECONDS` or the internal polling durations within the `Runtime.evaluate` call.
    -   Check Chrome's console (if you can access it in the launched window) for errors related to the extension or page.
-   **`Error: Could not find a suitable page target` (or similar CDP errors):**
    -   Chrome might not have launched correctly, or the remote debugging interface isn't accessible.
    -   The specified `CHROME_PATH` might be incorrect.

This script serves as a foundational tool for interacting with the MetaView extension programmatically.