      
# Cypress E2E Tests for MetaView Player API

This directory contains **Cypress end-to-end** tests designed to validate the functionality of the **MetaView** player, specifically by interacting with its internal **QoE (Quality of Experience)** API via a helper Node.js script.

## Overview

The primary goal of these tests is to:
1. Programmatically launch Google Chrome with the MetaView extension and a specific user profile.
2. Navigate to a target channel under tests -- the tokenized HLS stream URL.
3. Allow the MetaView extension to load and process the stream.
4. Call an internal API within the MetaView extension (`window.metaviewAPI.metrics.getQoEState()`) to retrieve playback metrics.
5. Validate these retrieved metrics.

Due to Cypress's architecture (it prefers to control its own browser instances) and the need to launch Chrome with very specific command-line arguments (for the extension and profile), this test setup uses a hybrid approach:
- A **Node.js script** (`tests/test_wrapper/test-cdp-basic.js`) handles the custom Chrome browser launch, navigation, and direct API interaction using the Chrome DevTools Protocol (CDP). This script outputs the API results to a JSON file (`tests/qoe_results.json`).
- A **Cypress test** (`tests/cypress/e2e/external_player_spec.cy.js`) orchestrates the process by invoking the Node.js script (via a Cypress task) and then validating the contents of the generated JSON output file.


## ***IMPORTANT NOTE***:

This test is ***Chrome*** specific and any instance of ***Chrome must be turned off*** to test this effectively. ***This is very improtant***.



## Project Structure within `tests/`

    
```
metaview/
├── tests/
│ ├── cypress/
│ │ ├── e2e/ 
│ │ │ └── external_player_spec.cy.js 
│ ├── cypress.config.js 
│ ├── test_wrapper/ 
│ │ └── test-cdp-basic.js 
│ └── qoe_results.json # JSON created during test run
│
├── node_modules/ 
├── src/ # MetaView extension source code
├── package.json # Project manifest
└── ... (other project files)
```
      
**Key Files:**
-   **`tests/cypress.config.js`**: Configures Cypress, including defining custom tasks. The crucial task here is `runNodeScript`, which executes `test-cdp-basic.js`.
-   **`tests/test_wrapper/test-cdp-basic.js`**: The Node.js script responsible for:
    -   Launching Chrome with the correct profile, extension, and remote debugging port.
    -   Warming up the browser and extension.
    -   Navigating to the channel path under test, or the HLS URL. This is  provided as a command-line argument.
    -   Waiting for the page to load and stabilize.
    -   Executing `window.metaviewAPI.metrics.getQoEState()` in the page context.
    -   Writing the returned QoE data to `tests/qoe_results.json`.
    -   Cleaning up and closing Chrome.
-   **`tests/cypress/e2e/external_player_spec.cy.js`**: The Cypress test spec that:
    -   Defines a target HLS URL.
    -   Uses `cy.task('runNodeScript', targetUrl)` to trigger the Node.js script.
    -   Waits for the Node.js script to complete and provide the QoE data (read from `qoe_results.json` by the task).
    -   Performs assertions on the retrieved QoE data to ensure it meets expectations.
-   **`tests/qoe_results.json`**: This file is generated (or overwritten) by `test-cdp-basic.js` each time a test run successfully retrieves QoE data. It is then read by the Cypress task.

## Prerequisites

1.  **Node.js and npm:** Ensure Node.js (which includes npm) is installed on your system.
2.  **Google Chrome:** The tests are configured to use Google Chrome. The path to the Chrome executable is defined in `test-cdp-basic.js` and may need adjustment based on your OS and Chrome installation location.
    -   Current path in `test-cdp-basic.js`: `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome` (macOS)
3.  **MetaView Extension Build:** The MetaView Chrome extension must be built, and its `dist` folder path must be correctly specified in `test-cdp-basic.js`.
    -   Current extension path in `test-cdp-basic.js`: `/Users/arterberry/Development/metaview/dist`
4.  **Cypress Installation:** Cypress and `chrome-remote-interface` must be installed as project dependencies. If you cloned this project and these are in `package.json`, run:
    ```bash
    npm install
    ```
    If setting up from scratch or if `cypress` is missing:
    ```bash
    npm install cypress chrome-remote-interface --save-dev
    ```

## Setup Steps 

1.  **Install Dependencies:**
    Open a terminal in the project root (`metaview/`) and run:
    ```bash
    npm install
    ```
    This will install Cypress, `chrome-remote-interface`, and other project dependencies listed in `package.json`.

2.  **Configure Paths in `test-cdp-basic.js`:**
    Open `tests/test_wrapper/test-cdp-basic.js` and verify/update the following constants if necessary:
    -   `CHROME_PATH`: Ensure this points to your Google Chrome executable.
    -   `EXTENSION_LOAD_PATH`: Ensure this points to the `dist` directory of your built MetaView extension.

3.  **Configure Paths in `tests/cypress.config.js`:**
    The paths for `scriptPath` (pointing to `test-cdp-basic.js`) and `resultsFilePath` (pointing to `qoe_results.json`) within the `runNodeScript` task are constructed relative to `tests/cypress.config.js`. They should be correct for the current project structure, but verify if you move files around.

## Running the Tests

1.  **Ensure Port 9222 is Free:**
    The Node.js script uses port `9222` for Chrome's remote debugging. Before running a test, make sure this port is not in use by another Chrome instance or application.
    -   **macOS/Linux:** `sudo lsof -i :9222` (then `kill -9 <PID>` if needed)
    -   **Windows:** `netstat -ano | findstr ":9222"` (then use Task Manager or `taskkill /PID <PID> /F`)

2.  **Open the Cypress Test Runner:**
    Navigate to the project root directory (`metaview/`) in your terminal and run:
    ```bash
    npx cypress open
    ```

3.  **In the Cypress Test Runner:**
    a.  Choose **E2E Testing**.
    b.  Select a browser to run the tests in (e.g., Chrome, Electron). Note: The actual Chrome instance with the extension will be launched by the Node.js script, but Cypress still needs a browser to run its own UI and test orchestration.
    c.  Click on the `external_player_spec.cy.js` file listed under "Specs".

4.  **Test Execution:**
    -   The Cypress test will start.
    -   It will invoke the `runNodeScript` task.
    -   You will see console output in the terminal where you ran `npx cypress open` related to the Cypress task and the execution of `test-cdp-basic.js`.
    -   A new Chrome window will launch (controlled by `test-cdp-basic.js`), load the extension, warm up, navigate to the HLS URL, and gather QoE data.
    -   After the Node.js script completes, the Chrome window it launched will close.
    -   The `qoe_results.json` file will be created/updated in the `tests/` directory.
    -   The Cypress task will read this file, and the Cypress test will perform assertions on the data.
    -   The Cypress Test Runner UI will show the test passing or failing with detailed steps and assertions.

## Understanding the Output

-   **Cypress Test Runner UI:** Shows the steps of the `external_player_spec.cy.js` test, including logs from `cy.log()` and assertion results.
-   **Terminal (where `npx cypress open` was run):**
    -   Shows logs from `console.log()` statements within the `runNodeScript` task in `cypress.config.js`.
    -   Shows the `stdout` and `stderr` from the `test-cdp-basic.js` Node.js script. This is very useful for debugging the browser launch and API interaction part.
-   **`tests/qoe_results.json`:** Contains the raw JSON data retrieved from the `getQoEState()` API call from the last successful run involving a URL.

## Modifying the Target HLS URL

The `TARGET_HLS_URL` that the Node.js script navigates to is currently hardcoded inside the Cypress test file (`tests/cypress/e2e/external_player_spec.cy.js`):

```javascript
const targetUrl = "YOUR_HLS_URL_HERE";
cy.task('runNodeScript', targetUrl, { /* ... */ });
```


To test different URLs:

You can directly modify this targetUrl variable, with a dynamic URL path, or use a fixture.

In your spec file, load it using ```cy.fixture():```

```javascript      
beforeEach(() => {
  cy.fixture('hls_streams').as('streams');
});


it('tests the main stream', function() { // Use function() to access 'this' for aliases
  const targetUrl = this.streams.mainStream;
  cy.task('runNodeScript', targetUrl, { /* ... */ });
  // ... assertions ...
});
```

## Troubleshooting

```"No specs found"```: Ensure cypress.config.js has the correct specPattern relative to its own location, and that your spec files match this pattern (e.g., ending in .cy.js). Restart Cypress after config changes.

```cy.task('runNodeScript') failed```: ... Cannot find module ...test-cdp-basic.js: The scriptPath in the runNodeScript task within tests/cypress.config.js is incorrect. Adjust it to be the correct path from tests/cypress.config.js to tests/test_wrapper/test-cdp-basic.js.

```cy.task('runNodeScript') failed```: ... Failed to read results file ... qoe_results.json: The resultsFilePath in the runNodeScript task within tests/cypress.config.js is incorrect, or the Node.js script failed to write the file.

Verify where test-cdp-basic.js is writing qoe_results.json (by default, it's relative to its CWD when executed).

Ensure the path in the Cypress task matches this location. The current setup assumes tests/qoe_results.json.

```cy.task('runNodeScript') failed```: ... Node script failed ... (with other errors from Node script): Check the stdout and stderr from the Node.js script printed in the Cypress error message and in your main terminal. This will point to issues within test-cdp-basic.js (e.g., Chrome launch issues, CDP connection problems, API not found on page).

```Common issue: Port 9222 already in use.```
... See the ***sudo instructions*** above -- under **Running the Tests**.

Test timeouts (cy.task): If the Node.js script legitimately takes a long time, increase the timeout option for ```cy.task('runNodeScript', ..., { timeout: NNNNNN })``` in **external_player_spec.cy.js**.