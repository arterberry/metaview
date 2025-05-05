// js/ui/player_ui.js

console.log('Player UI script loading...');

// === State Variables ===
let isDraggingVertical = false;
let isDraggingHorizontal = false;
let startY = 0, startHeight = 0;
let startX = 0, startWidth = 0;


document.addEventListener('DOMContentLoaded', () => {
    // console.log('DOM loaded - initializing UI components');

    // === Element References ===
    const refs = {
        metadataContainer: document.getElementById('metadataContainer'),
        metadataResizeHandle: document.getElementById('metadataResizeHandle'),
        resizeHandleVertical: document.getElementById('resizeHandleVertical'),
        metadataPanel: document.getElementById('metadataPanel'),
        responsePanelUpdate: document.getElementById('responsePanelUpdate'),
        sidePanelButton: document.getElementById('side-panel-button'),
        hlsInfoPanel: document.getElementById('hlsInfoPanel'),
        closeButton: document.getElementById('closeButton'),
        videoContainer: document.querySelector('.video-container')
    };

    // === Initialization ===
    Object.entries(refs).forEach(([name, el]) => logElementState(name, el));
    applyInitialStyles(refs);
    setupVerticalResize(refs);
    setupHorizontalResize(refs);
    setupSidePanelToggle(refs);
    setupTabSystem();

    // Initialize SCTE Dispatcher if available
    if (window.SCTEDispatcher) {
        // console.log('Initializing SCTE Dispatcher');
        window.SCTEDispatcher.init();
    }

    // === Final Validation ===
    setTimeout(() => enforcePointerEvents(refs), 500);
    // console.log('Player UI initialization complete');
});

/** Logs initial element state */
function logElementState(name, el) {
    if (!el) return console.warn(`Element '${name}' not found`);
    const style = window.getComputedStyle(el);
    // console.log(`${name}:`, {
    //     width: el.offsetWidth,
    //     height: el.offsetHeight,
    //     display: style.display,
    //     position: style.position
    // });
}

/** Sets default flexbox styles for core elements */
function applyInitialStyles({ metadataContainer, metadataResizeHandle, resizeHandleVertical, hlsInfoPanel }) {
    if (metadataContainer) metadataContainer.style.cssText += 'height:300px; display:flex; position:relative;';
    if (metadataResizeHandle) metadataResizeHandle.style.cssText += 'cursor:ns-resize; pointer-events:auto; z-index:100;';
    if (resizeHandleVertical) resizeHandleVertical.style.cssText += 'cursor:ew-resize; width:8px; background:#2c2c2c; z-index:100; pointer-events:auto;';

    if (hlsInfoPanel) {
        hlsInfoPanel.style.cssText += 'position:fixed; top:0; right:0; z-index:1000;';
        const style = document.createElement('style');
        style.textContent = `
            .info-panel.hidden { transform: translateX(100%) !important; display: none !important; }
            .info-panel { transition: transform 0.3s ease !important; }
        `;
        document.head.appendChild(style);
    }
}

/** Enables vertical resize between metadata and video */
function setupVerticalResize({ metadataResizeHandle, metadataContainer, videoContainer }) {
    if (!metadataResizeHandle || !metadataContainer || !videoContainer) return;

    metadataResizeHandle.addEventListener('mousedown', e => {
        isDraggingVertical = true;
        startY = e.clientY;
        startHeight = parseInt(window.getComputedStyle(metadataContainer).height, 10) || 300;
        document.body.style.cursor = 'ns-resize';
        e.preventDefault();
    });

    document.addEventListener('mousemove', e => {
        if (!isDraggingVertical) return;
        const deltaY = startY - e.clientY;
        const newHeight = Math.max(100, startHeight + deltaY);
        const videoHeight = window.innerHeight - newHeight - 40;
        metadataContainer.style.height = `${newHeight}px`;
        videoContainer.style.height = `${videoHeight}px`;
        e.preventDefault();
    });

    document.addEventListener('mouseup', () => {
        if (isDraggingVertical) {
            isDraggingVertical = false;
            // metadataResizeHandle.style.backgroundColor = '';
            document.body.style.cursor = '';
        }
    });
}

/** Enables horizontal resizing between metadata and response panel */
function setupHorizontalResize({ resizeHandleVertical, metadataPanel, responsePanelUpdate, metadataContainer }) {
    if (!resizeHandleVertical || !metadataPanel || !responsePanelUpdate || !metadataContainer) return;

    resizeHandleVertical.addEventListener('mousedown', e => {
        isDraggingHorizontal = true;
        startX = e.clientX;
        startWidth = parseInt(window.getComputedStyle(metadataPanel).width, 10) || Math.floor(metadataContainer.offsetWidth / 2);
        // resizeHandleVertical.style.backgroundColor = '#4a86e8';
        document.body.style.cursor = 'ew-resize';
        e.preventDefault();
    });

    document.addEventListener('mousemove', e => {
        if (!isDraggingHorizontal) return;
        const deltaX = e.clientX - startX;
        const containerWidth = metadataContainer.offsetWidth;
        const newWidth = Math.max(100, Math.min(containerWidth - 100, startWidth + deltaX));
        const rightPanelWidth = containerWidth - newWidth - 10;

        metadataPanel.style.cssText += `width: ${newWidth}px; flex: 0 0 auto;`;
        responsePanelUpdate.style.cssText += `width: ${rightPanelWidth}px; flex: 1 1 auto;`;
        e.preventDefault();
    });

    document.addEventListener('mouseup', () => {
        if (isDraggingHorizontal) {
            isDraggingHorizontal = false;
            document.body.style.cursor = '';
        }
    });
}

/** Side panel show/hide */
function setupSidePanelToggle({ sidePanelButton, hlsInfoPanel, closeButton }) {
    if (!sidePanelButton || !hlsInfoPanel || !closeButton) return;

    sidePanelButton.addEventListener('click', e => {
        hlsInfoPanel.classList.toggle('hidden');
        e.stopPropagation();
    });

    closeButton.addEventListener('click', () => {
        hlsInfoPanel.classList.add('hidden');
    });
}

/** Ensures pointer-events enabled for resize handles */
function enforcePointerEvents({ metadataResizeHandle, resizeHandleVertical }) {
    if (window.getComputedStyle(metadataResizeHandle).pointerEvents === 'none') {
        metadataResizeHandle.style.pointerEvents = 'auto';
        // console.log('Enabled pointer-events on vertical resize');
    }
    if (window.getComputedStyle(resizeHandleVertical).pointerEvents === 'none') {
        resizeHandleVertical.style.pointerEvents = 'auto';
        // console.log('Enabled pointer-events on horizontal resize');
    }
}

/** Tab click handlers (using delegation so dynamically‐added tabs also work) */
function setupTabSystem() {
    const tabNav = document.querySelector('.tab-nav');
    if (!tabNav) return;

    tabNav.addEventListener('click', e => {
        const btn = e.target.closest('.tab-button');
        if (!btn) return;                         // not a tab-button
        const tabId = btn.dataset.tab;            // e.g. "inspect", "qoe", "ai", "config"

        // 1) Deactivate all buttons and panes
        document.querySelectorAll('.tab-button').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));

        // 2) Activate the clicked button...
        btn.classList.add('active');
        // 3) ...and its corresponding pane
        const pane = document.getElementById(`${tabId}-tab`);
        if (pane) pane.classList.add('active');
    });
}

