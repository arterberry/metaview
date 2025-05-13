// js/ui/statusbar_manager.js

(function () {
    const statusBar = document.getElementById('statusBar');
    if (!statusBar) return;

    // *** UPDATED: Helper to format the display string from the new statusInfo object ***
    function formatStatus(statusInfo) {
        // Handle initial state or if statusInfo is not the expected object
        // Check for timestamp existence and type (number, from Date.now())
        if (!statusInfo || typeof statusInfo.timestamp !== 'number') {
            return { text: '—', class: 'statusbar__code--unknown' };
        }

        const { code, message, error } = statusInfo; // Destructure the new properties
        let statusText = '';
        let codeClass = '';

        // Use a fallback for message if it's empty or null
        const displayMessage = message || (error ? 'Error' : 'Status');

        if (error) {
            codeClass = 'statusbar__code--error';
            if (code !== null) { // HTTP error (e.g., 404, 500)
                statusText = `${code}: ${displayMessage}`; // Format: 403: Forbidden
            } else { // Network error or other non-HTTP error
                statusText = displayMessage; // Format: Network Error
            }
        } else { // Success
            codeClass = 'statusbar__code--success';
            if (code !== null) { // HTTP success (e.g., 200)
                statusText = `${code}: ${displayMessage}`; // Format: 200: OK
            } else {
                // This case (success but no code) should ideally not happen with HTTP fetches
                // but provide a fallback.
                statusText = displayMessage; // Format: OK (if message was 'OK')
            }
        }

        // Optional: Truncate if the combined statusText is too long
        const MAX_LEN = 35; // Adjust max length if needed
        if (statusText.length > MAX_LEN) {
            statusText = statusText.substring(0, MAX_LEN - 3) + '...';
        }

        return { text: statusText, class: codeClass };
    }


    function render() {
        const statusInfo = window.metaviewAPI.hlsparser.ResponseStatus(); // Gets the new object or null
        const formattedStatus = formatStatus(statusInfo); // Uses the updated formatStatus function

        const cdn = window.metaviewAPI.metrics.getCDN() || 'Unknown';
        const bufferMsg = window.metaviewAPI.metrics.playbackBufferCheck();

        const hasBufferError = bufferMsg.includes('bufferStalledError');
        const bufferClass = hasBufferError
            ? 'statusbar__buffer--error'
            : 'statusbar__buffer--normal';

        // Title attribute for hover - this will use the new statusInfo structure
        let titleText = "Last HLS Fetch Status: ";
        if (statusInfo && typeof statusInfo.timestamp === 'number') {
             const displayCode = statusInfo.code !== null ? statusInfo.code : 'N/A';
             const displayMessage = statusInfo.message || 'N/A';
             // For URL in title, you might want to use a short version or full, depending on preference
             const displayUrl = statusInfo.url || 'N/A'; 
             titleText += `Code=[${displayCode}] Message=[${displayMessage}] URL=[${displayUrl}] Time=[${new Date(statusInfo.timestamp).toLocaleTimeString()}]`;
        } else {
             titleText += "N/A";
        }

        statusBar.innerHTML = `
              <span class="statusbar__section" title="${titleText}">
                Status Response:<span class="statusbar__code ${formattedStatus.class}">${formattedStatus.text}</span>
              </span>
              <span class="statusbar__divider"></span>
              <span class="statusbar__section">
                CDN:<span class="statusbar__cdn">${cdn}</span>
              </span>
              <span class="statusbar__divider"></span>
              <span class="statusbar__section">
                Tracking Playback:<span class="statusbar__buffer ${bufferClass}">${bufferMsg}</span>
              </span>
            `;
    }

    // Initial Render
    render();

    // Re-render on relevant events
    document.addEventListener('cdnInfoDetected', render);
    document.addEventListener('bufferNudgeOnStall', render);

    // Periodic update for the status bar
    // This will pick up changes to state.lastHttpStatus from hls_parser
    setInterval(render, 1000);

})();