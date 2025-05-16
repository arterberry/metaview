// js/core/scte_parser.js
// Description: SCTE-35 Parser for detecting SCTE tags in video segments using Comcast SCTE35 library.

console.log('[scte_parser] Initialized SCTE parser core module.');

(function (window) {
    'use strict';

    let SCTE35ParserComcastInstance = null;
    let TextDecoderInstance = null;
    const M3U8_SCTE_LINE_DURATION_REGEX = /\b(?:PLANNED-)?DURATION=([0-9]+(?:\.[0-9]+)?)\b/;
    
    function initComcastParser() {
        // ... (same as before)
        if (window.SCTE35 && window.SCTE35.default && window.SCTE35.default.SCTE35) {
            if (!SCTE35ParserComcastInstance) {
                SCTE35ParserComcastInstance = new window.SCTE35.default.SCTE35();
                console.log('[scte_parser] SCTE35ParserComcast instance created by scte_parser.');
            }
        } else {
            console.warn('[scte_parser] SCTE35ParserComcast NOT initialized.');
        }
        if (typeof TextDecoder !== 'undefined') {
            TextDecoderInstance = new TextDecoder('utf-8', { fatal: false });
        } else {
            console.warn('[scte_parser] TextDecoder API not available.');
        }
    }
    initComcastParser();

    function b64ToHex(b64String) { /* ... (same as before) ... */ try { const r = window.atob(b64String); let t = ""; for (let n = 0; n < r.length; n++) { const e = r.charCodeAt(n).toString(16); t += 2 === e.length ? e : "0" + e } return t.toUpperCase() } catch (r) { return console.error("[scte_parser] Error b64ToHex:", r), null } }
    function uint8ArrayToHex(uint8Array) { /* ... (same as before) ... */ if (!uint8Array) return null; return Array.from(uint8Array).map(r => r.toString(16).padStart(2, "0")).join("").toUpperCase() }

    function getSegmentationTypeName(typeId) { 
        const o = { 
            0: "Not Indicated", 
            1: "Content Identification", 
            16: "Program Start", 
            17: "Program End", 
            18: "Program Early Termination", 
            19: "Program Breakaway", 
            20: "Program Resumption", 
            21: "Program Runover Planned", 
            22: "Program Runover Unplanned", 
            23: "Program Overlap Start", 
            24: "Program Blackout Override", 
            25: "Program Start - In Progress", 
            32: "Chapter Start", 
            33: "Chapter End", 
            34: "Break Start", 
            35: "Break End", 
            48: "Provider Advertisement Start", 
            49: "Provider Advertisement End", 
            50: "Distributor Advertisement Start", 
            51: "Distributor Advertisement End", 
            52: "Provider Placement Opportunity Start", 
            53: "Provider Placement Opportunity End", 
            54: "Distributor Placement Opportunity Start", 
            55: "Distributor Placement Opportunity End", 
            56: "Provider Overlay Placement Opportunity Start", 
            57: "Provider Overlay Placement Opportunity End", 
            58: "Distributor Overlay Placement Opportunity Start", 
            59: "Distributor Overlay Placement Opportunity End", 
            60: "Provider Promo Start [Fox Spec]", 
            61: "Provider Promo End [Fox Spec]", 
            62: "Distributor Promo Start [Fox Spec]", 
            63: "Distributor Promo End [Fox Spec]", 
            64: "Unscheduled Event Start", 
            65: "Unscheduled Event End", 
            80: "Network Start", 
            81: "Network End"
        }; return void 0 !== o[typeId] ? o[typeId] : `Unknown Type (0x${null === typeId || void 0 === typeId ? "N/A" : typeId.toString(16).padStart(2, "0")})` 
    }

    // ***** REVISED for BUG 5 (Type 0x21 Chapter End isAdStart) *****
    function getScteTypeFromSegmentation(typeId, cancelIndicator) {
        let typeNameActual = getSegmentationTypeName(typeId);
        let scteManagerType = 'scte_signal';
        let isAdStart = false;
        let isAdEnd = false;

        switch (typeId) {
            // Program related (No direct ad flags)
            case 0x10: scteManagerType = 'program_start'; break;
            // ... other program types ...
            case 0x13: scteManagerType = 'program_breakaway'; break;
            case 0x14: scteManagerType = 'program_return'; break;

            // Chapter related
            case 0x20: scteManagerType = 'chapter_start'; break;
            case 0x21: // Chapter End (BUG 5)
                scteManagerType = 'chapter_end';
                isAdStart = true;
                isAdEnd = false;
                break;
            case 0x22: scteManagerType = 'break_start'; break; // Break start itself is not an ad for strict flags
            case 0x23: scteManagerType = 'break_end'; break;

            // BUG 1: Strict Ad/Opportunity Types (0x30-0x35)
            case 0x30: scteManagerType = 'ad_start'; isAdStart = true; isAdEnd = false; break;
            case 0x31: scteManagerType = 'ad_end'; isAdStart = false; isAdEnd = true; break;
            case 0x32: scteManagerType = 'ad_start'; isAdStart = true; isAdEnd = false; break;
            case 0x33: scteManagerType = 'ad_end'; isAdStart = false; isAdEnd = true; break;
            case 0x34: scteManagerType = 'opportunity_start'; isAdStart = true; isAdEnd = false; break;
            case 0x35: scteManagerType = 'opportunity_end'; isAdStart = false; isAdEnd = true; break;

            // Other Opportunity/Promo Types (No strict Ad flags from these type IDs alone)
            case 0x36: scteManagerType = 'opportunity_start'; break;
            case 0x3C: scteManagerType = 'promo_start'; break;
            case 0x3D: scteManagerType = 'promo_end'; break;
            // ... other 0x3x types ...

            // BUG 2: Content Identification (0x01)
            case 0x01:
                scteManagerType = 'content_identification';
                isAdStart = false;
                isAdEnd = true;
                break;
            default: scteManagerType = 'scte_signal';
        }

        // Cancellation logic (remains the same)
        if (cancelIndicator) {
            typeNameActual += ' (Cancelled)';
            if (isAdStart) isAdStart = false;
            if (isAdEnd) isAdEnd = false;
            // ... update scteManagerType for cancellation ...
            if (scteManagerType.endsWith('_start')) { scteManagerType = scteManagerType.replace('_start', '_start_cancelled'); }
            else if (scteManagerType.endsWith('_end')) { scteManagerType = scteManagerType.replace('_end', '_end_cancelled'); }
            else if (scteManagerType !== 'scte_signal') { scteManagerType += '_cancelled'; }
            else { scteManagerType = 'scte_signal_cancelled'; }
        }
        return { type: scteManagerType, isAdStart, isAdEnd, typeNameActual };
    }

    function formatUpidForDisplay(upidBytes, upidType) { /* ... (same as before) ... */ if (!upidBytes || 0 === upidBytes.length) return "N/A"; let t = "N/A"; if (TextDecoderInstance) try { const r = upidBytes.filter(t => 0 !== t); t = TextDecoderInstance.decode(Uint8Array.from(r)), t = t.replace(/[^\x20-\x7E]/g, ".") } catch (r) { t = `[Raw Bytes (Decode Error): ${uint8ArrayToHex(upidBytes)}]` } else t = `[Raw Bytes (No TextDecoder): ${uint8ArrayToHex(upidBytes)}]`; switch (upidType) { case 1: return t; case 2: return `Deprecated (0x02): ${t}`; case 3: return `Ad-ID: ${t}`; case 5: case 6: return `ISAN/V-ISAN: ${t}`; case 7: return `TID: ${t}`; case 8: return `AiringID: ${t}`; case 9: return `ADI/CableLabs: ${t}`; case 10: return `EIDR: ${t}`; case 11: return `ATSC CID: ${t}`; case 12: return `UUID: ${t}`; case 13: return `MID (Raw Block): ${t}`; default: const r = void 0 !== upidType && null !== upidType ? `0x${upidType.toString(16).padStart(2, "0")}` : "Unknown"; return `Type ${r}: ${t}` } }
    function generateScteSummary(parsedScte, extractedDetails) { /* ... (same as before, uses updated extractedDetails) ... */ if (!parsedScte || parsedScte.error && !parsedScte.tableId || extractedDetails.error) return extractedDetails.error || (null == parsedScte ? void 0 : parsedScte.error) || "Error in SCTE data."; let t = ""; extractedDetails.segmentationTypeIdName && "N/A" !== extractedDetails.segmentationTypeIdName && !extractedDetails.segmentationTypeIdName.startsWith("Unknown Type") ? t += `${extractedDetails.segmentationTypeIdName}. ` : void 0 !== parsedScte.spliceCommandType; if (extractedDetails.id && (t += `EventID: ${extractedDetails.id}. `), null !== extractedDetails.duration && void 0 !== extractedDetails.duration && (t += `Duration: ${extractedDetails.duration.toFixed(3)}s (${extractedDetails.durationSource}). `), extractedDetails.upidFormatted && "N/A" !== extractedDetails.upidFormatted && !extractedDetails.upidFormatted.startsWith("N/A (") ? t += `UPID: ${extractedDetails.upidFormatted}. ` : extractedDetails.upidHex && (t += `UPID (Hex): ${extractedDetails.upidHex}. `), null !== extractedDetails.segmentNum && null !== extractedDetails.segmentsExpected && (0 !== extractedDetails.segmentNum || 0 !== extractedDetails.segmentsExpected) && (t += `Seg: ${extractedDetails.segmentNum}/${extractedDetails.segmentsExpected}. `), t.trim()) return t.trim(); return "Parsed SCTE-35 data." }
    function parseScteData(encodedData, encodingType) { /* ... (same as before) ... */ if (!SCTE35ParserComcastInstance) return { error: "Comcast SCTE-35 parser not initialized.", originalEncoded: encodedData, originalEncodingType: encodingType }; if (!encodedData) return { error: "No encoded data provided.", originalEncoded: encodedData, originalEncodingType: encodingType }; let t = encodedData; if ("base64" === encodingType) { if (!(t = b64ToHex(encodedData))) return { error: "Failed to convert base64 to hex.", originalEncoded: encodedData, originalEncodingType: encodingType } } else if ("hex" !== encodingType) return { error: `Unsupported encoding type: ${encodingType}.`, originalEncoded: encodedData, originalEncodingType: encodingType }; try { const r = SCTE35ParserComcastInstance.parseFromHex(t); return r && "object" == typeof r ? (r.originalEncoded = encodedData, r.originalEncodingType = encodingType, r) : { error: "Unknown error during Comcast parsing.", originalEncoded: encodedData, originalEncodingType: encodingType } } catch (r) { return { error: `Exception: ${r.message}`, originalEncoded: encodedData, originalEncodingType: encodingType } } }
    function upidToAscii(upidData) { /* ... (same as before, kept for legacy) ... */ return ""; }

    // ***** extractScteDetails incorporates BUG 3 & BUG 5 overrides, and maintains BUG 4 Duration Priority *****
    function extractScteDetails(comcastParsedScte, m3u8LineContent = null) {
        const scteTagDetails = { /* ... (same init as before) ... */ encoded: null == comcastParsedScte ? void 0 : comcastParsedScte.originalEncoded, encodingType: null == comcastParsedScte ? void 0 : comcastParsedScte.originalEncodingType, parsed: comcastParsedScte, summary: "Extracting details...", error: null };

        if (!comcastParsedScte || (comcastParsedScte.error && !comcastParsedScte.tableId)) {
            // ... (same error return as before)
            scteTagDetails.error = (null == comcastParsedScte ? void 0 : comcastParsedScte.error) || "No parsed SCTE data.";
            scteTagDetails.summary = scteTagDetails.error;
            return {
                error: scteTagDetails.error, scteTagDetails, id: null, duration: null, durationSource: "N/A (Parsing Error)",
                type: 'scte_signal_error', isAdStart: false, isAdEnd: false,
                segmentationTypeId: null, segmentationTypeIdName: 'N/A (Parsing Error)',
                upidHex: null, upidFormatted: 'N/A (Parsing Error)',
                segmentNum: null, segmentsExpected: null, segmentationEventCancelIndicator: false,
            };
        }
        if (comcastParsedScte.error && comcastParsedScte.tableId) {
            scteTagDetails.error = `Comcast Parser Note: ${comcastParsedScte.error}`;
        }

        const extracted = { /* ... (same init as before) ... */ id: null, duration: null, durationSource: "N/A", type: "scte_signal", isAdStart: !1, isAdEnd: !1, segmentationTypeId: null, segmentationTypeIdName: "N/A", upidHex: null, upidFormatted: "N/A", segmentNum: null, segmentsExpected: null, segmentationEventCancelIndicator: !1, scteTagDetails: scteTagDetails, error: scteTagDetails.error };

        let segDesc = null;
        if (comcastParsedScte.descriptors && comcastParsedScte.descriptors.length > 0) {
            segDesc = comcastParsedScte.descriptors.find(d => d.spliceDescriptorTag === 0x02);
        }

        let typeIdForFlagsProcessing = null; // This ID will be used for getScteTypeFromSegmentation

        if (segDesc && segDesc.segmentationTypeId !== undefined) {
            extracted.segmentationTypeId = segDesc.segmentationTypeId;
            typeIdForFlagsProcessing = segDesc.segmentationTypeId; // Primary source for type ID
            // ... (populate id, upidHex, upidFormatted, segmentNum, segmentsExpected, cancelIndicator from segDesc as before)
            extracted.segmentationEventCancelIndicator = !!segDesc.segmentationEventCancelIndicator, void 0 !== segDesc.segmentationEventId && (extracted.id = segDesc.segmentationEventId.toString()), void 0 !== segDesc.segmentationUpidType && segDesc.segmentationUpidLength > 0 && (segDesc.segmentationUpid instanceof Uint8Array || Array.isArray(segDesc.segmentationUpid)) ? (extracted.upidHex = uint8ArrayToHex(segDesc.segmentationUpid instanceof Uint8Array ? segDesc.segmentationUpid : Uint8Array.from(segDesc.segmentationUpid)), extracted.upidFormatted = formatUpidForDisplay(segDesc.segmentationUpid instanceof Uint8Array ? segDesc.segmentationUpid : Uint8Array.from(segDesc.segmentationUpid), segDesc.segmentationUpidType)) : extracted.upidFormatted = "N/A (No UPID data in SegDesc)", extracted.segmentNum = void 0 !== segDesc.segmentNum ? segDesc.segmentNum : null, extracted.segmentsExpected = void 0 !== segDesc.segmentsExpected ? segDesc.segmentsExpected : null;

        } else if (comcastParsedScte.spliceCommandType === 0x05 && comcastParsedScte.spliceCommand) { // Splice Insert
            const cmd = comcastParsedScte.spliceCommand;
            if (cmd.spliceEventId !== undefined) extracted.id = cmd.spliceEventId.toString();
            if (cmd.outOfNetworkIndicator != null) {
                typeIdForFlagsProcessing = cmd.outOfNetworkIndicator ? 0x30 : 0x31; // Use OONI mapped type for flag processing
                extracted.segmentationTypeId = typeIdForFlagsProcessing; // Store it
            }
            extracted.upidFormatted = 'N/A (No Segmentation Descriptor)';
        } else if (comcastParsedScte.spliceCommandType === 0x06 && comcastParsedScte.spliceCommand) { // Time Signal
            // ... (set id from ptsTime as before)
            if (void 0 !== (null == comcastParsedScte ? void 0 : null == (O = comcastParsedScte.spliceCommand) ? void 0 : O.ptsTime)) extracted.id = (null == (A = comcastParsedScte.spliceCommand) ? void 0 : A.ptsTime).toString();
            extracted.upidFormatted = 'N/A (No Segmentation Descriptor)';
        } else {
            extracted.upidFormatted = 'N/A (No Segmentation Descriptor)';
        }
        var O, A;

        // --- Get initial type classification and Ad flags using typeIdForFlagsProcessing ---
        const typeInfo = getScteTypeFromSegmentation(
            typeIdForFlagsProcessing, // This is now correctly sourced
            extracted.segmentationEventCancelIndicator
        );
        extracted.type = typeInfo.type;
        extracted.segmentationTypeIdName = typeInfo.typeNameActual;
        extracted.isAdStart = typeInfo.isAdStart;
        extracted.isAdEnd = typeInfo.isAdEnd;

        // Refine segmentationTypeIdName for non-segDesc cases
        if (!segDesc) {
            if (typeIdForFlagsProcessing !== null && comcastParsedScte.spliceCommandType === 0x05) { // OONI case
                extracted.segmentationTypeIdName = typeInfo.typeNameActual + " (from SpliceInsert OON)";
            } else if (comcastParsedScte.spliceCommandType === 0x06) { // Time Signal without SegDesc
                extracted.segmentationTypeIdName = "Time Signal (No Segmentation Descriptor)";
            } else if (comcastParsedScte.spliceCommandType !== undefined && typeIdForFlagsProcessing === null) { // Other command without SegDesc
                extracted.segmentationTypeIdName = `Cmd 0x${comcastParsedScte.spliceCommandType.toString(16)} (No SegDesc)`;
            } else if (typeIdForFlagsProcessing === null) { // Fallback if no discernible type
                extracted.segmentationTypeIdName = "N/A (No SegDesc & Unknown Cmd)";
            }
        }

        // --- BUG 3: UPID "Ad-ID:" override ---
        if (extracted.upidFormatted && extracted.upidFormatted.startsWith("Ad-ID:")) {
            extracted.isAdStart = true;
            extracted.isAdEnd = false;
        }

        // --- BUG 4: Duration Calculation with M3U8 Priority (logic remains the same as previous good version) ---
        // Step 1: Try M3U8 Tag first
        if (m3u8LineContent) {
            const m3u8DurationMatch = m3u8LineContent.match(M3U8_SCTE_LINE_DURATION_REGEX);
            if (m3u8DurationMatch && m3u8DurationMatch[1]) {
                try {
                    extracted.duration = parseFloat(m3u8DurationMatch[1]);
                    extracted.durationSource = "M3U8 Tag";
                } catch (e) { /* will fall through */ }
            }
        }
        // Step 2 & 3: Try SCTE Binary (SegDesc then SpliceInsert) if M3U8 didn't provide duration
        if (extracted.duration === null && segDesc && segDesc.segmentationDurationFlag && segDesc.segmentationDuration != null) {
            extracted.duration = segDesc.segmentationDuration / 90000;
            extracted.durationSource = "SCTE-35 Binary";
        } else if (extracted.duration === null && comcastParsedScte.spliceCommandType === 0x05 /* ... spliceInsert duration check ... */) {
            // ... (spliceInsert duration logic as before)
            if (null == extracted.duration && 5 === (null == comcastParsedScte ? void 0 : comcastParsedScte.spliceCommandType) && (null == comcastParsedScte ? void 0 : comcastParsedScte.spliceCommand) && (null == comcastParsedScte ? void 0 : null == (S = comcastParsedScte.spliceCommand).breakDuration ? void 0 : S.duration) && (null == comcastParsedScte ? void 0 : null == (L = comcastParsedScte.spliceCommand).breakDuration ? void 0 : L.autoReturn)) extracted.duration = (null == comcastParsedScte ? void 0 : null == (D = comcastParsedScte.spliceCommand).breakDuration ? void 0 : D.duration) / 9e4, extracted.durationSource = "SCTE-35 Binary (SpliceInsert)"; var S, L, D;
        }
        // Step 4: Set final N/A source
        if (extracted.duration === null) { /* ... (set N/A source as before) ... */ extracted.durationSource = m3u8LineContent ? "N/A (No M3U8 DURATION attr or SCTE Binary dur)" : "N/A (No SCTE Binary dur, No M3U8 Line)" }

        extracted.scteTagDetails.summary = generateScteSummary(comcastParsedScte, extracted);
        return extracted;
    }

    window.SCTECoreParser = { /* ... (same exports as before) ... */ parseScteData: parseScteData, extractScteDetails: extractScteDetails, getSegmentationTypeName: getSegmentationTypeName, getScteTypeFromSegmentation: getScteTypeFromSegmentation, upidToAscii: upidToAscii, _b64ToHex: b64ToHex };

})(window);