# MetaView

MetaView is a Chrome extension for inspecting HLS video streams in real time. It provides:

* **Manifest & Segment Inspector**: View master/media playlists and segment details (headers & hex dumps).
* **Available Resolutions**: See and select ABR variants (plus “Auto (ABR)”).
* **Cache Metrics & TTL**: Track cache hit/miss ratio and TTL directives.
* **Playback Metrics (QoS)**: Startup time, first-frame latency, rebuffering events, bitrate, resolution, audio tracks, etc.


---

## Prerequisites

* **Google Chrome** (for extension)


---

## Building the Extension

1. Clone the repo:

   ```bash
   git clone https://github.com/your-org/metaview.git
   cd metaview
   ```

2. Run the build script:

   ```bash
   ./build.sh
   ```

   This will:

   * Clean and recreate `dist/`
   * Copy assets (`.js`, `.html`, `.css`, images, fonts, etc.) from `src/` into `dist/`




## Installing in Chrome

1. Open **chrome://extensions** in your browser.
2. Enable **Developer mode** (toggle in top-right).
3. Click **Load unpacked** and select the `dist/` directory.
4. Pin the **MetaView** icon if desired.

Once loaded, open any HLS stream page. Click the eye 🔍 icon to open the MetaView panel.



## UI Overview

Inside the side panel you’ll find three main tabs:

1. **Inspect**

   * **Available Resolutions**: Variant list and `Auto (ABR)`.
   * **Cache Hit Ratio**: Live hit/miss graph and stats.
   * **Cache TTL**: Parsed `Cache-Control`, `Expires`, and `Age` directives.
   * **Manifest & Segments**: Dynamic list under **Select**. Click to view HTTP headers & hex dump.
2. **Metrics (QoS)**

   * Playback metrics: CDN, startup, first-frame, rebuffering, bitrate, resolution, playback rate.
   * Details tabs: Audio, Subtitles, Connection, QoS.
   * Event history log.



## Internal JavaScript API

MetaView exposes a global `window.metaviewAPI` namespace. Open DevTools (Inspect on the player) and use the following methods:

```js
// QoE state snapshot
window.metaviewAPI.metrics.getQoEState()
// Last HLS parser status codes or messages
window.metaviewAPI.hlsparser.getResponseStatus()
// Current playback bitrate (bps)
window.metaviewAPI.metrics.getCurrentBitrate()
// Current playback resolution ("WIDTHxHEIGHT")
window.metaviewAPI.metrics.getCurrentResolution()
// Active audio track ID or language code
window.metaviewAPI.metrics.getCurrentAudioTrack()
```

> **Tip:** These can be invoked in your own scripts or automated tests.

---

## Cypress Test Example

Please review the requirements and comprehensive details located here: [Cypress E2E Test for MetaView Player API](https://github.com/fox-digitalvideo/metaviewplayer/tree/main/tests/cypress) 

## License

This project is licensed under the MIT License. See [LICENSE](LICENSE) for details.

