// js/core/scte_parser.js
// Description: SCTE-35 Parser for detecting SCTE tags in video segments using Comcast SCTE35 library.

console.log('[scte_parser] Initialized SCTE parser core module.');

(function(window) {
    'use strict';

    let SCTE35ParserComcastInstance = null;

    function initComcastParser() {
        if (window.SCTE35 && window.SCTE35.default && window.SCTE35.default.SCTE35) {
            if (!SCTE35ParserComcastInstance) {
                SCTE35ParserComcastInstance = new window.SCTE35.default.SCTE35();
                console.log('[scte_parser] SCTE35ParserComcast instance created successfully by scte_parser.');
            }
        } else {
            console.warn('[scte_parser] SCTE35ParserComcast NOT initialized: SCTE35 library not found on window.SCTE35.');
        }
    }
    initComcastParser(); // Initialize on load

    // Helper to convert Base64 to Hex
    function b64ToHex(b64String) {
        try {
            const raw = window.atob(b64String);
            let result = '';
            for (let i = 0; i < raw.length; i++) {
                const hex = raw.charCodeAt(i).toString(16);
                result += (hex.length === 2 ? hex : '0' + hex);
            }
            return result.toUpperCase();
        } catch (e) {
            console.error('[scte_parser] Error converting base64 to hex:', e);
            return null;
        }
    }

    // Helper to convert Uint8Array to Hex String
    function uint8ArrayToHex(uint8Array) {
        if (!uint8Array) return null;
        return Array.from(uint8Array).map(b => b.toString(16).padStart(2, '0')).join('').toUpperCase();
    }

    function getSegmentationTypeName(typeId) {
        // From SCTE 35 2022 Table 19: segmentation_type_id Descriptions
        // (A more comprehensive list might be needed for all cases)
        const names = {
            0x00: "Not Indicated", 0x01: "Content Identification",
            0x10: "Program Start", 0x11: "Program End", 0x12: "Program Early Termination",
            0x13: "Program Breakaway", 0x14: "Program Resumption", 0x15: "Program Runover Planned",
            0x16: "Program Runover Unplanned", 0x17: "Program Overlap Start",
            0x18: "Program Blackout Override", 0x19: "Program Start - In Progress",
            0x20: "Chapter Start", 0x21: "Chapter End", 0x22: "Break Start", 0x23: "Break End",
            0x30: "Provider Advertisement Start", 0x31: "Provider Advertisement End",
            0x32: "Distributor Advertisement Start", 0x33: "Distributor Advertisement End",
            0x34: "Provider Placement Opportunity Start", 0x35: "Provider Placement Opportunity End",
            0x36: "Distributor Placement Opportunity Start", 0x37: "Distributor Placement Opportunity End",
            0x38: "Provider Overlay Placement Opportunity Start", 0x39: "Provider Overlay Placement Opportunity End",
            0x3A: "Distributor Overlay Placement Opportunity Start", 0x3B: "Distributor Overlay Placement Opportunity End",
            0x40: "Unscheduled Event Start", 0x41: "Unscheduled Event End", // Note: SCTE-35 2022 uses these for Unscheduled Event
            0x50: "Network Start", 0x51: "Network End", // Note: SCTE-35 2022 uses these for Network Event
        };
        return names[typeId] || `Unknown Type (0x${typeId.toString(16)})`;
    }

    function getScteTypeFromSegmentation(typeId, cancelIndicator) {
        let typeNameActual = getSegmentationTypeName(typeId);
        let scteManagerType = 'scte_signal'; // Simplified type for scte_manager (ad_start, ad_end, etc.)
        let isAdStart = false;
        let isAdEnd = false;

        switch (typeId) {
            case 0x10: scteManagerType = 'program_start'; break;
            case 0x11: scteManagerType = 'program_end'; break;
            case 0x13: scteManagerType = 'program_breakaway'; isAdStart = true; break;
            case 0x14: scteManagerType = 'program_return'; isAdEnd = true; break;
            case 0x22: scteManagerType = 'break_start'; isAdStart = true; break;
            case 0x23: scteManagerType = 'break_end'; isAdEnd = true; break;
            case 0x30: case 0x32: case 0x34: case 0x36: case 0x38: case 0x3A:
                scteManagerType = 'ad_start'; isAdStart = true; break;
            case 0x31: case 0x33: case 0x35: case 0x37: case 0x39: case 0x3B:
                scteManagerType = 'ad_end'; isAdEnd = true; break;
            case 0x40: /* Unscheduled Event Start / Network Start */ scteManagerType = 'event_start'; isAdStart = true; break; // Generalizing, could be ad
            case 0x41: /* Unscheduled Event End / Network End */ scteManagerType = 'event_end'; isAdEnd = true; break;   // Generalizing, could be ad
            default: scteManagerType = 'scte_signal';
        }

        if (cancelIndicator) {
            typeNameActual += ' (Cancelled)';
            if (isAdStart) isAdStart = false;
            if (isAdEnd) isAdEnd = false;
            scteManagerType = scteManagerType.replace(/_start|_end$/, '_cancelled');
            if (!scteManagerType.endsWith('_cancelled')) scteManagerType = 'scte_signal_cancelled';
        }
        
        return { type: scteManagerType, isAdStart, isAdEnd, typeNameActual };
    }

    function generateScteSummary(parsedScte, extractedDetails) {
        if (!parsedScte || parsedScte.error) {
            return parsedScte?.error || "Error in SCTE data.";
        }

        let summary = "";
        switch (parsedScte.spliceCommandType) {
            case 0x00: summary += "Splice Null. "; break;
            case 0x04: summary += "Splice Schedule. "; break;
            case 0x05: summary += "Splice Insert. "; break;
            case 0x06: summary += "Time Signal. "; break;
            case 0x07: summary += "Bandwidth Reservation. "; break;
            case 0xff: summary += "Private Command. "; break;
            default: summary += `Unknown Command (0x${parsedScte.spliceCommandType.toString(16)}). `;
        }

        if (extractedDetails.id) {
            summary += `EventID: ${extractedDetails.id}. `;
        }
        // Use the more descriptive typeNameActual from segmentation for summary
        if (extractedDetails.segmentationTypeIdName) { // This is typeNameActual
            summary += `Type: ${extractedDetails.segmentationTypeIdName}. `;
        } else if (extractedDetails.type && extractedDetails.type !== 'scte_signal') {
            // Fallback to the manager's type if no specific segmentation type name
            summary += `Signal: ${extractedDetails.type}. `;
        }

        if (extractedDetails.duration !== null && extractedDetails.duration !== undefined) {
            summary += `Duration: ${extractedDetails.duration.toFixed(3)}s. `;
        }
        if (extractedDetails.upid) {
            summary += `UPID: ${extractedDetails.upid}. `;
        }
        if (extractedDetails.segmentNum !== null && extractedDetails.segmentsExpected !== null) {
            summary += `Seg: ${extractedDetails.segmentNum}/${extractedDetails.segmentsExpected}. `;
        }
        if (extractedDetails.segmentationEventCancelIndicator) { // Already in typeNameActual
           // summary += "CANCELLED. "; // Redundant if typeNameActual includes it
        }
        return summary.trim() || "Parsed SCTE-35 data.";
    }

    /**
     * Parses SCTE-35 data using the Comcast SCTE35 parser.
     * @param {string} encodedData - The SCTE-35 data, either in hex or base64.
     * @param {string} encodingType - 'hex' or 'base64'.
     * @returns {object|null} Parsed SCTE-35 data from Comcast lib, or an error object.
     *                        The returned object will have `originalEncoded` and `originalEncodingType` added.
     */
    function parseScteData(encodedData, encodingType) {
        if (!SCTE35ParserComcastInstance) {
            console.error('[scte_parser] Comcast SCTE-35 parser not initialized.');
            return { error: 'Comcast SCTE-35 parser not initialized.', originalEncoded: encodedData, originalEncodingType: encodingType };
        }
        if (!encodedData) {
            return { error: 'No encoded data provided.', originalEncoded: encodedData, originalEncodingType: encodingType };
        }

        let hexData = encodedData;
        if (encodingType === 'base64') {
            hexData = b64ToHex(encodedData);
            if (!hexData) {
                return { error: 'Failed to convert base64 to hex.', originalEncoded: encodedData, originalEncodingType: encodingType };
            }
        } else if (encodingType !== 'hex') {
            return { error: `Unsupported encoding type: ${encodingType}. Expected 'hex' or 'base64'.`, originalEncoded: encodedData, originalEncodingType: encodingType };
        }

        try {
            const parsed = SCTE35ParserComcastInstance.parseFromHex(hexData);
            if (parsed && typeof parsed === 'object') { // Comcast parser returns object on success
                // Add original data for reference if successful parse
                if (!parsed.error) { // Ensure it's not an error object from the parser itself
                    parsed.originalEncoded = encodedData;
                    parsed.originalEncodingType = encodingType;
                }
                return parsed; // This could be a success or an error object from the parser
            }
            // Should not be reached if parser throws or returns object
            return { error: 'Unknown error during Comcast parsing.', originalEncoded: encodedData, originalEncodingType: encodingType };
        } catch (e) {
            console.error('[scte_parser] Exception during SCTE parsing with Comcast parser:', e);
            return { error: `Exception: ${e.message}`, originalEncoded: encodedData, originalEncodingType: encodingType };
        }
    }

    /**
     * Converts a Uint8Array or a Hex String to an ASCII string.
     * Non-printable ASCII characters will be replaced with a placeholder (e.g., '.').
     * @param {Uint8Array|string} upidData - The UPID data (either Uint8Array or a hex string).
     * @returns {string|null} The ASCII representation or null if input is invalid.
     */
    function upidToAscii(upidData) {
        if (!upidData) return null;

        let byteArray;
        if (typeof upidData === 'string') {
            // Assume it's a hex string, convert to Uint8Array
            if (!/^[0-9A-Fa-f]+$/i.test(upidData) || upidData.length % 2 !== 0) {
                console.warn('[scte_parser] upidToAscii: Invalid hex string provided:', upidData);
                // Attempt to parse as is if it's not hex, treating chars as bytes (less common for UPID)
                // For now, strict hex for string input
                return `(Invalid Hex: ${upidData})`;
            }
            byteArray = new Uint8Array(upidData.length / 2);
            for (let i = 0; i < upidData.length; i += 2) {
                byteArray[i / 2] = parseInt(upidData.substr(i, 2), 16);
            }
        } else if (upidData instanceof Uint8Array) {
            byteArray = upidData;
        } else {
            console.warn('[scte_parser] upidToAscii: Invalid data type for UPID. Expected Uint8Array or hex string.');
            return null;
        }

        let asciiString = '';
        for (let i = 0; i < byteArray.length; i++) {
            const charCode = byteArray[i];
            // ASCII printable characters range from 32 (space) to 126 (~)
            if (charCode >= 32 && charCode <= 126) {
                asciiString += String.fromCharCode(charCode);
            } else {
                asciiString += '.'; // Placeholder for non-printable or extended ASCII
            }
        }
        return asciiString;
    }

    /**
     * Extracts key information from the parsed SCTE-35 data (Comcast format).
     * @param {object} comcastParsedScte - The raw parsed SCTE-35 data from parseScteData.
     * @returns {object} An object containing extracted SCTE info and scteTagDetails.
     */
    function extractScteDetails(comcastParsedScte) {
        const scteTagDetails = {
            encoded: comcastParsedScte?.originalEncoded,
            encodingType: comcastParsedScte?.originalEncodingType,
            parsed: comcastParsedScte, // Store the raw Comcast output here
            summary: 'Extracting details...', // Placeholder
            error: null
        };

        if (!comcastParsedScte || comcastParsedScte.error) {
            scteTagDetails.error = comcastParsedScte?.error || 'No parsed SCTE data to extract details from.';
            scteTagDetails.summary = scteTagDetails.error;
            return { error: scteTagDetails.error, scteTagDetails };
        }

        const details = {
            id: null,
            duration: null, // in seconds
            type: 'scte_signal', // Default type for scte_manager logic
            isAdStart: false,
            isAdEnd: false,
            segmentationTypeId: null,
            segmentationTypeIdName: null, // This will be the full SCTE-35 type name
            upid: null, // Hex string
            segmentNum: null,
            segmentsExpected: null,
            segmentationEventCancelIndicator: false,
            scteTagDetails: scteTagDetails // Will be updated with summary
        };

        // Splice Insert command (0x05)
        if (comcastParsedScte.spliceCommandType === 0x05 && comcastParsedScte.spliceCommand) {
            const cmd = comcastParsedScte.spliceCommand;
            if (cmd.spliceEventId !== undefined) {
                details.id = cmd.spliceEventId.toString();
            }
            if (cmd.breakDuration && cmd.breakDuration.duration != null && cmd.breakDuration.autoReturn) {
                details.duration = cmd.breakDuration.duration / 90000;
            }
            if (cmd.outOfNetworkIndicator != null) {
                details.type = cmd.outOfNetworkIndicator ? 'ad_start' : 'ad_end'; // Basic type
                details.isAdStart = !!cmd.outOfNetworkIndicator;
                details.isAdEnd = !cmd.outOfNetworkIndicator;
            }
        }

        // Descriptors (especially Segmentation Descriptor 0x02) can override or provide more detail
        if (comcastParsedScte.descriptors && comcastParsedScte.descriptors.length > 0) {
            const segDesc = comcastParsedScte.descriptors.find(d => d.spliceDescriptorTag === 0x02);
            if (segDesc) {
                if (segDesc.segmentationEventId !== undefined) {
                    details.id = segDesc.segmentationEventId.toString(); // Override ID
                }
                details.segmentationEventCancelIndicator = !!segDesc.segmentationEventCancelIndicator;

                if (segDesc.segmentationDurationFlag && segDesc.segmentationDuration != null) {
                    details.duration = segDesc.segmentationDuration / 90000; // Override duration
                }

                details.segmentationTypeId = segDesc.segmentationTypeId;
                const typeInfo = getScteTypeFromSegmentation(segDesc.segmentationTypeId, details.segmentationEventCancelIndicator);
                details.type = typeInfo.type; // Override scte_manager type
                details.segmentationTypeIdName = typeInfo.typeNameActual; // Set descriptive name
                details.isAdStart = typeInfo.isAdStart; // Override
                details.isAdEnd = typeInfo.isAdEnd;   // Override

                if (segDesc.segmentationUpidType && segDesc.segmentationUpidLength > 0 && segDesc.segmentationUpid) {
                    details.upid = uint8ArrayToHex(segDesc.segmentationUpid);
                }
                details.segmentNum = segDesc.segmentNum;
                details.segmentsExpected = segDesc.segmentsExpected;
            }
        }
        
        details.scteTagDetails.summary = generateScteSummary(comcastParsedScte, details);
        return details; // Contains all extracted fields and the scteTagDetails bundle
    }

    window.SCTECoreParser = {
        parseScteData: parseScteData,
        extractScteDetails: extractScteDetails,
        getSegmentationTypeName: getSegmentationTypeName, 
        upidToAscii: upidToAscii // Expose for UI if needed
    };

})(window);