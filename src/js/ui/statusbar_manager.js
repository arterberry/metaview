// js/ui/statusbar_manager.js

(function () {
    const statusBar = document.getElementById('statusBar');
    if (!statusBar) return;

    let configLinkListenerAttached = false; // Flag to prevent multiple listeners

    function formatStatus(statusInfo) {
        if (!statusInfo || typeof statusInfo.timestamp !== 'number') {
            return { text: '—', class: 'statusbar__code--unknown' };
        }
        const { code, message, error } = statusInfo;
        let statusText = '';
        let codeClass = '';
        const displayMessage = message || (error ? 'Error' : 'Status');

        if (error) {
            codeClass = 'statusbar__code--error';
            statusText = code !== null ? `${code}: ${displayMessage}` : displayMessage;
        } else {
            codeClass = 'statusbar__code--success';
            statusText = code !== null ? `${code}: ${displayMessage}` : displayMessage;
        }
        const MAX_LEN = 35;
        if (statusText.length > MAX_LEN) {
            statusText = statusText.substring(0, MAX_LEN - 3) + '...';
        }
        return { text: statusText, class: codeClass };
    }

    function openConfigurationWindow() {
        const width = 650;
        const height = 450;
        const left = (screen.width / 2) - (width / 2);
        const top = (screen.height / 2) - (height / 2);
        // Ensure the path to config.html is correct relative to player.html
        // If player.html and config.html are in the root of the extension, 'config.html' is correct.
        // If they are in an 'html' folder, it would be 'html/config.html'.
        // Assuming they are in the root as per typical extension structure:
        const configUrl = chrome.runtime.getURL('config.html');

        window.open(
            configUrl,
            'MetaViewConfiguration',
            `width=${width},height=${height},top=${top},left=${left},resizable=yes,scrollbars=yes,status=yes`
        );
    }

    function render() {
        const statusInfo = window.metaviewAPI.hlsparser.getLastHttpStatus();;
        const formattedStatus = formatStatus(statusInfo);
        const cdn = window.metaviewAPI.metrics.getCDN() || 'Unknown';
        const bufferMsg = window.metaviewAPI.metrics.playbackBufferCheck();
        const hasBufferError = bufferMsg.includes('bufferStalledError');
        const bufferClass = hasBufferError ? 'statusbar__buffer--error' : 'statusbar__buffer--normal';

        let titleText = "Last HLS Fetch Status: ";
        if (statusInfo && typeof statusInfo.timestamp === 'number') {
             const displayCode = statusInfo.code !== null ? statusInfo.code : 'N/A';
             const displayMessage = statusInfo.message || 'N/A';
             const displayUrl = statusInfo.url || 'N/A';
             titleText += `Code=[${displayCode}] Message=[${displayMessage}] URL=[${displayUrl}] Time=[${new Date(statusInfo.timestamp).toLocaleTimeString()}]`;
        } else {
             titleText += "N/A";
        }

        // Ensure the status bar has a flex layout to accommodate the new link on the right
        statusBar.style.display = 'flex';
        statusBar.style.justifyContent = 'space-between'; // Pushes config link to the right
        statusBar.style.alignItems = 'center'; // Vertically aligns items


        statusBar.innerHTML = `
            <div class="statusbar__left-group">
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
            </div>
            <div class="statusbar__right-group">
                <a href="#" id="configLink" class="statusbar__config-link">Configuration</a>
            </div>
            `;

        // Add event listener for the config link (only once)
        if (!configLinkListenerAttached) {
            // Use event delegation on statusBar if items are frequently re-rendered
            // For a one-time addition after innerHTML, this direct approach is okay
            // but might need adjustment if render() clears all listeners.
            // A safer approach for dynamic content is event delegation on a static parent.
            // However, since we re-set innerHTML every time, we need to re-attach or use delegation.
            // Let's re-attach for simplicity now, as the listener itself is simple.
            const configLink = document.getElementById('configLink');
            if (configLink) {
                configLink.addEventListener('click', (event) => {
                    event.preventDefault();
                    openConfigurationWindow();
                });
                // To prevent re-adding, we can set a flag, but since innerHTML wipes it,
                // this is effectively re-adding. For a single link, it's not a major issue.
                // If performance becomes a concern, switch to event delegation on statusBar.
            }
        }
    }

    // Initial Render
    render();

    // Re-render on relevant events
    document.addEventListener('cdnInfoDetected', render);
    document.addEventListener('bufferNudgeOnStall', render);

    // Periodic update for the status bar
    setInterval(render, 1000); // This re-renders, re-attaching the listener.

})();