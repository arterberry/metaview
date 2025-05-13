// js/ui/adblock_ui.js
console.log('[adblock-ui] Initializing Ad Block UI override...');

(function () {
    let isAdBlockActive = false;
    const AD_BLOCK_BADGE_TEXT = "SEGMENT | AD BLOCK";
    const AD_BLOCK_BADGE_CLASS = "segment-adblock"; // Matches your CSS
    const SEGMENT_BADGE_SELECTOR = ".segment-badge"; // Generic selector for any segment badge

    document.addEventListener('DOMContentLoaded', () => {
        listenForAdSignals();
        observeSegmentListForAdBlock();
        console.log('[adblock-ui] DOM loaded. Listening for ad signals and segment additions.');
    });

    function listenForAdSignals() {
        // Listen for Ad Start signal from scte_manager
        document.addEventListener('scteAdSegmentDetected', (e) => {
            if (!isAdBlockActive) {
                console.log('[adblock-ui] Ad Block STARTED.');
                isAdBlockActive = true;
                // Optional: Could attempt to re-badge existing segments here,
                // but focusing on new segments as requested is simpler.
            }
        });

        // Listen for Ad End signal from scte_manager
        document.addEventListener('scteAdBlockEndDetected', (e) => {
            if (isAdBlockActive) {
                console.log('[adblock-ui] Ad Block ENDED.');
                isAdBlockActive = false;
                // No need to actively remove badges from past segments.
                // New segments will now get their normal badges.
            }
        });

        // Listen for stream resets
        document.addEventListener('newStreamLoading', () => {
            if (isAdBlockActive) {
                console.log('[adblock-ui] New stream loading. Resetting Ad Block state.');
                isAdBlockActive = false;
            }
        });
    }

    function observeSegmentListForAdBlock() {
        const observer = new MutationObserver((mutationsList) => {
            // Only proceed if the ad block is currently active
            if (!isAdBlockActive) {
                return;
            }

            for (const mutation of mutationsList) {
                if (mutation.type === 'childList') {
                    mutation.addedNodes.forEach(node => {
                        // Check if the added node is the segment element itself
                        if (node.nodeType === Node.ELEMENT_NODE && node.matches && node.matches('div[data-segment-url]')) {
                            applyAdBlockBadgeIfNeeded(node);
                        }
                        // Check if the added node contains segment elements (e.g., if a batch is added)
                        else if (node.nodeType === Node.ELEMENT_NODE && node.querySelectorAll) {
                           const segmentsInNode = node.querySelectorAll('div[data-segment-url]');
                           segmentsInNode.forEach(segmentEl => applyAdBlockBadgeIfNeeded(segmentEl));
                        }
                    });
                }
            }
        });

        const container = document.getElementById('metadataList');
        if (container) {
            observer.observe(container, { childList: true, subtree: true });
            console.log('[adblock-ui] Observing #metadataList for segment additions.');
        } else {
            console.warn('[adblock-ui] #metadataList container not found for MutationObserver.');
        }
    }

    // Helper function to apply the override badge
    function applyAdBlockBadgeIfNeeded(segmentElement) {
        // Double-check state in case it changed between mutation and processing
        if (!isAdBlockActive || !segmentElement) {
            return;
        }

        const segmentUrl = segmentElement.getAttribute('data-segment-url');
        console.log(`[adblock-ui] Applying AD BLOCK override to: ${segmentUrl}`);

        // 1. Remove any existing badge(s) - robustly handles badges from segment_tags.js
        const existingBadges = segmentElement.querySelectorAll(SEGMENT_BADGE_SELECTOR);
        existingBadges.forEach(badge => badge.remove());

        // 2. Create the new ad block badge
        const adBlockBadge = document.createElement('span');
        adBlockBadge.className = `segment-badge ${AD_BLOCK_BADGE_CLASS}`; // Use both classes
        adBlockBadge.textContent = AD_BLOCK_BADGE_TEXT;

        // 3. Insert the badge (using similar logic to segment_tags.js for consistency)
        insertBadge(segmentElement, adBlockBadge);
    }

    // Utility function to insert the badge (copied/adapted from segment_tags.js)
    function insertBadge(segmentElement, badge) {
        if (!segmentElement || !badge) return;
        const timestampEl = segmentElement.querySelector('.segment-timestamp');
        if (timestampEl && timestampEl.nextSibling) {
            // Insert after timestamp if possible
            segmentElement.insertBefore(badge, timestampEl.nextSibling);
        } else if (segmentElement.firstChild && segmentElement.firstChild.nextSibling) {
           // Otherwise insert near the beginning (e.g., after segment ID/icon if present)
           segmentElement.insertBefore(badge, segmentElement.firstChild.nextSibling);
        } else {
           // Fallback append
            segmentElement.appendChild(badge);
        }
    }

})(); // End IIFE