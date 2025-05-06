// js/ui/statusbar_manager.js

(function () {
	const statusBar = document.getElementById('statusBar');
	if (!statusBar) return;

	function render() {
		// --- existing data sources ---
		const codeRaw = window.metaviewAPI.hlsparser.ResponseStatus();
		const code = (typeof codeRaw === 'number') ? codeRaw : '—';
		const cdn = window.metaviewAPI.metrics.getCDN() || 'Unknown';
		const bufferMsg = window.metaviewAPI.metrics.playbackBufferCheck();

		// --- determine classes for HTTP status code ---
		const isError = typeof code === 'number' && code >= 400 && code < 600;
		const codeClass = isError
			? 'statusbar__code--error'
			: 'statusbar__code--success';

		const hasBufferError = bufferMsg.includes('bufferStalledError');
		const bufferClass = hasBufferError
			? 'statusbar__buffer--error'
			: 'statusbar__buffer--normal';

		statusBar.innerHTML = `
			  <span class="statusbar__section">
				Status Response:&nbsp;
				<span class="statusbar__code ${codeClass}">${code}</span>
			  </span>
			  <span class="statusbar__divider"></span>
			  <span class="statusbar__section">
				CDN:&nbsp;
				<span class="statusbar__cdn">${cdn}</span>
			  </span>
			  <span class="statusbar__divider"></span>
			  <span class="statusbar__section">
				Tracking Playback:&nbsp;
				<span class="statusbar__buffer ${bufferClass}">${bufferMsg}</span>
			  </span>
			`;
	}

	render();
	document.addEventListener('cdnInfoDetected', render);
	document.addEventListener('httpStatusDetected', render);	
	document.addEventListener('bufferNudgeOnStall', render);

})();
