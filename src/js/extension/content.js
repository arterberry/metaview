// js/extension/content.js

// Function to detect if the current URL is an HLS stream (.m3u8)
function isHlsUrl(url) {
    return url.endsWith('.m3u8') || url.includes('.m3u8?') ||
        url.includes('/playlist.m3u8') || url.includes('isml/.m3u8');
}

// Handle file drop logic only if not in player.html
if (!window.location.pathname.includes('player.html')) {
    document.addEventListener('dragover', (event) => {
        for (let i = 0; i < event.dataTransfer.items.length; i++) {
            const item = event.dataTransfer.items[i];
            if (
                item.kind === 'file' &&
                (item.type === 'application/x-mpegurl' ||
                    item.getAsFile().name.endsWith('.m3u8'))
            ) {
                event.preventDefault();
                return;
            }
        }
    });

    document.addEventListener('drop', (event) => {
        event.preventDefault();
        const files = event.dataTransfer.files;
        for (let i = 0; i < files.length; i++) {
            const file = files[i];
            if (file.name.endsWith('.m3u8')) {
                const objectUrl = URL.createObjectURL(file);
                chrome.runtime.sendMessage({
                    action: "getPlayerUrl",
                    hlsUrl: objectUrl,
                    fileName: file.name
                });
                return;
            }
        }
    });
}

// In content.js - Update the message handler
chrome.runtime.onMessage.addListener((message) => {
    if (message.action === "openPlayer" && !window.location.pathname.includes('player.html')) {
        // console.log("[content.js] Launching player.html with HLS URL");

        // Ensure we're passing the complete URL with all parameters
        // Use encodeURIComponent to preserve all special characters in the URL
        const encodedUrl = encodeURIComponent(message.hlsUrl);
        
        // console.log('[content.js] Launching player.html with encoded src:');
        // console.log('Raw URL:', message.hlsUrl);
        // console.log('Encoded URL:', encodedUrl);
        
        // Build the full player URL
        const fullUrl = chrome.runtime.getURL("player.html") + `?src=${encodedUrl}`;
        
        // console.log('Navigating to:', fullUrl);
        // console.log('Full URL length:', fullUrl.length);

        window.location.href = fullUrl;
    }
});