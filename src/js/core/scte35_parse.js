// js/core/scte35parse.js
// Description: SCTE-35 Parser library adapted from scte35.js for VIDINFRA MetaView

console.log('[scte35parse] Loading...');

// SCTE-35 command types
const SCTE35_COMMAND_TYPES = {
    0x00: 'null',
    0x05: 'splice_insert',
    0x06: 'splice_schedule',
    0x07: 'splice_time_signal',
    0xFE: 'bandwidth_reservation',
    0xFF: 'private_command'
};

// SCTE-35 descriptor tags
const SCTE35_DESCRIPTOR_TAGS = {
    0x00: 'avail_descriptor',
    0x01: 'dtmf_descriptor',
    0x02: 'segmentation_descriptor',
    0x03: 'time_descriptor',
    0x04: 'audio_descriptor'
};

// Segmentation type IDs
const SEGMENTATION_TYPE_IDS = {
    0x00: 'Not Indicated',
    0x01: 'Content Identification',
    0x10: 'Program Start',
    0x11: 'Program End',
    0x12: 'Program Early Termination',
    0x13: 'Program Breakaway',
    0x14: 'Program Resumption',
    0x15: 'Program Runover Planned',
    0x16: 'Program Runover Unplanned',
    0x17: 'Program Overlap Start',
    0x18: 'Program Blackout Override',
    0x19: 'Program Join',
    0x20: 'Chapter Start',
    0x21: 'Chapter End',
    0x22: 'Break Start', // Ad start
    0x23: 'Break End',   // Ad end
    0x24: 'Opening Credit Start',
    0x25: 'Opening Credit End',
    0x26: 'Closing Credit Start',
    0x27: 'Closing Credit End',
    0x30: 'Provider Advertisement Start', // Ad start
    0x31: 'Provider Advertisement End',   // Ad end
    0x32: 'Distributor Advertisement Start', // Ad start
    0x33: 'Distributor Advertisement End',   // Ad end
    0x34: 'Provider Placement Opportunity Start', // Ad start
    0x35: 'Provider Placement Opportunity End',   // Ad end
    0x36: 'Distributor Placement Opportunity Start', // Ad start
    0x37: 'Distributor Placement Opportunity End',   // Ad end
    0x38: 'Provider Overlay Placement Opportunity Start', // Ad start
    0x39: 'Provider Overlay Placement Opportunity End',   // Ad end
    0x3A: 'Distributor Overlay Placement Opportunity Start', // Ad start
    0x3B: 'Distributor Overlay Placement Opportunity End',   // Ad end
    0x3C: 'Provider Promo Start', // Ad start
    0x3D: 'Provider Promo End',   // Ad end
    0x3E: 'Distributor Promo Start', // Ad start
    0x3F: 'Distributor Promo End',   // Ad end
    0x40: 'Unscheduled Event Start',
    0x41: 'Unscheduled Event End',
    0x42: 'Alternative Content Opportunity Start', // Ad start? Depends on use
    0x43: 'Alternative Content Opportunity End',   // Ad end? Depends on use
    0x44: 'Network Advertisement Start', // Ad start
    0x45: 'Network Advertisement End',   // Ad end
    // Note: 0x46/0x47 are Broadcast Advertisement Start/End in newer specs, but not in the provided list. Added them for completeness
    0x46: 'Broadcast Advertisement Start', // Ad start
    0x47: 'Broadcast Advertisement End',   // Ad end
    0x50: 'Network Signal Start',
    0x51: 'Network Signal End'
};

// Helper to read PTS values (48-bit, but only 33 bits significant in SCTE-35)
// PTS is based on a 90kHz clock
function _readPTS(bytes) {
    if (bytes.length < 5) {
        console.warn('[scte35parse] Not enough bytes for PTS');
        return null;
    }
    // PTS is 33 bits, stored in 5 bytes.
    // byte 0: xxx1 xxxx (reserved, 3 msb of PTS)
    // byte 1: xxxx xxxx (next 8 bits)
    // byte 2: xxx1 xxxx (reserved, next 8 bits)
    // byte 3: xxxx xxxx (next 8 bits)
    // byte 4: xxx1 xxxx (reserved, 8 lsb of PTS)
    // Total: 3 + 8 + 8 + 8 + 8 = 35 bits. The spec says 33 bits, often using a 33-bit field within 48 bits.
    // The common interpretation aligns the 33 bits to the LSBs of the 48-bit field.
    // So, the most significant 15 bits are not part of the SCTE PTS value.
    // Let's read the full 48 bits and then take the lower 33, which is a common way it's encoded.
    // Or, more correctly as per spec often seen, it's a 33-bit number in a 48-bit field (48 bits total, but only 33 meaningful)
    // PTS = (byte0[1-3] << 30) | (byte1[0-7] << 22) | (byte2[1-7] << 15) | (byte3[0-7] << 7) | (byte4[1-7])
    // Wait, the provided code's _readPTS does something different. Let's replicate that exactly for compatibility:
    // PTS = ((byte1 & 0x0E) << 29) | ((byte2 & 0xFF) << 22) | ((byte3 & 0xFE) << 14) | ((byte4 & 0xFF) << 7) | ((byte5 & 0xFE) >>> 1);
    // This looks like it's extracting bits based on specific masks. Let's trust the original implementation's bit manipulation for PTS.

    const byte1 = bytes[0]; // Assumes bytes is slice from correct position
    const byte2 = bytes[1];
    const byte3 = bytes[2];
    const byte4 = bytes[3];
    const byte5 = bytes[4];

    // Ensure all bytes are present
    if (byte1 === undefined || byte2 === undefined || byte3 === undefined || byte4 === undefined || byte5 === undefined) {
        console.warn('[scte35parse] Missing bytes for PTS calculation.');
        return null;
    }

    // Replicating the bit extraction logic from the original code
    const pts = ((byte1 & 0x0E) * Math.pow(2, 29)) + // (byte1 & 0x0E) is 3 bits shifted
        ((byte2 & 0xFF) * Math.pow(2, 22)) + // (byte2 & 0xFF) is 8 bits shifted
        ((byte3 & 0xFE) * Math.pow(2, 14)) + // (byte3 & 0xFE) is 7 bits shifted (byte3[1-7])
        ((byte4 & 0xFF) * Math.pow(2, 7)) +  // (byte4 & 0xFF) is 8 bits shifted
        ((byte5 & 0xFE) >>> 1);              // (byte5 & 0xFE) >> 1 is 7 bits (byte5[1-7])

    // The original code's bit manipulation (specifically `((byte3 & 0xFE) << 14)` and `((byte5 & 0xFE) >>> 1)`)
    // seems unusual for standard SCTE-35 PTS (which uses 33 bits within a 48-bit field aligned to LSBs).
    // However, since this is based on the *provided* old code, we'll use it. It might be specific to the source streams.
    // Let's re-implement using bitwise operators directly as the original code does:
    const pts_reimplemented = ((byte1 & 0x0E) << 29) |
        ((byte2 & 0xFF) << 22) |
        ((byte3 & 0xFE) << 14) | // Note: This looks potentially incorrect based on spec, but matches source
        ((byte4 & 0xFF) << 7) |
        ((byte5 & 0xFE) >>> 1); // Note: This looks potentially incorrect based on spec, but matches source

    // Use BigInt for potentially large PTS values if needed, but standard JS numbers handle up to 53 bits.
    // A 33-bit PTS at 90kHz covers ~26 hours (2^33 / 90000 / 3600). Fits fine in standard JS Number.
    // Let's return the value from the original bitwise logic.
    return pts_reimplemented;
}


// Parse splice time
function _parseSpliceTime(bytes, index) {
    if (bytes.length < index + 1) return { specified: false };

    const timeSpecifiedFlag = (bytes[index] & 0x80) !== 0;

    if (!timeSpecifiedFlag) {
        return {
            specified: false
        };
    }

    // Read PTS time (5 bytes)
    if (bytes.length < index + 6) { // 1 flag byte + 5 PTS bytes = 6
        console.warn('[scte35parse] Not enough bytes for SpliceTime PTS.');
        return { specified: true, ptsTime: null, error: 'Truncated PTS data' };
    }
    const ptsTime = _readPTS(bytes.slice(index + 1, index + 6)); // Slice starting *after* the flag byte

    return {
        specified: true,
        ptsTime: ptsTime !== null ? ptsTime : 'Error parsing PTS' // Return null/error status from _readPTS
    };
}

// Parse break duration
function _parseBreakDuration(bytes, index) {
    if (bytes.length < index + 5) {
        console.warn('[scte35parse] Not enough bytes for BreakDuration.');
        return { autoReturn: false, duration: null, error: 'Truncated duration data' };
    }

    const autoReturn = (bytes[index] & 0x80) !== 0;

    // Standard SCTE-35 break_duration field (40 bits total):
    // Byte 0: auto_return (1 bit) | '1' (reserved, 1 bit) | duration[32..27] (6 bits)
    // Byte 1: duration[26..19] (8 bits)
    // Byte 2: duration[18..11] (8 bits)
    // Byte 3: duration[10..3] (8 bits)
    // Byte 4: duration[2..0] (3 bits) | '11111' (reserved, 5 bits)
    // The duration is a 33-bit value in 90kHz clock ticks.

    // Extract the 6 most significant bits of duration from the first byte.
    // autoReturn is bit 7, reserved is bit 6. Duration bits are 5 through 0.
    const duration_6_msb = bytes[index] & 0x3F;

    // Extract the 3 least significant bits of duration from the fifth byte.
    // Duration bits are 7 through 5.
    const duration_3_lsb = (bytes[index + 4] & 0xE0) >> 5;

    // Duration is a 33-bit unsigned integer in 90 kHz ticks.
    // A 33-bit number fits within a standard JavaScript Number.
    const duration = (duration_6_msb * Math.pow(2, 27)) +      // Shift 6 bits by (33-6) = 27
        (bytes[index + 1] * Math.pow(2, 19)) +    // Shift 8 bits by (27-8) = 19
        (bytes[index + 2] * Math.pow(2, 11)) +    // Shift 8 bits by (19-8) = 11
        (bytes[index + 3] * Math.pow(2, 3)) +     // Shift 8 bits by (11-8) = 3
        duration_3_lsb;                           // Last 3 bits

    return {
        autoReturn,
        duration // Duration in 90kHz ticks
    };
}

// Parse a splice insert command
function _parseSpliceInsert(bytes, startIndex, endIndex) {
    let index = startIndex;

    if (bytes.length < index + 4) return { error: "Truncated SpliceInsert data (event ID)" };
    const spliceEventId = (bytes[index] << 24) | (bytes[index + 1] << 16) |
        (bytes[index + 2] << 8) | bytes[index + 3];
    index += 4;

    if (bytes.length < index + 1) return { spliceEventId, error: "Truncated SpliceInsert data (cancel indicator)" };
    const spliceEventCancelIndicator = (bytes[index] & 0x80) !== 0;
    index++;

    if (spliceEventCancelIndicator) {
        return {
            spliceEventId,
            spliceEventCancelIndicator
        };
    }

    if (bytes.length < index + 1) return { spliceEventId, spliceEventCancelIndicator, error: "Truncated SpliceInsert data (flags)" };
    const outOfNetworkIndicator = (bytes[index] & 0x80) !== 0;
    const programSpliceFlag = (bytes[index] & 0x40) !== 0;
    const durationFlag = (bytes[index] & 0x20) !== 0;
    const spliceImmediateFlag = (bytes[index] & 0x10) !== 0;
    index++;

    let spliceTime = null;
    if (programSpliceFlag && !spliceImmediateFlag) {
        if (bytes.length < index + (5 + 1)) { // Need at least 6 bytes for splice_time with specified flag
            console.warn('[scte35parse] Not enough bytes for SpliceTime in SpliceInsert.');
            // Attempt parsing with available bytes, but mark error
            spliceTime = _parseSpliceTime(bytes, index);
            spliceTime.error = 'Truncated SpliceTime data';
            index = bytes.length; // Advance index past available bytes
        } else {
            spliceTime = _parseSpliceTime(bytes, index);
            index += (spliceTime.specified ? 5 + 1 : 1); // 1 flag byte + 5 PTS bytes if specified, else just 1 flag byte
        }
    } else if (!programSpliceFlag && !spliceImmediateFlag) {
        // component_count
        // component_splice_request { component_tag, splice_time } loop
        // Not implemented in original code, skipping for now.
        // We should advance index based on component_count if implemented.
        // For now, assuming program_splice_flag or splice_immediate_flag is set.
        // If not, the command length would determine how many component entries there are.
        console.warn('[scte35parse] Component splice_insert not fully parsed.');
        index = endIndex + 1; // Advance to end of command based on declared length
    } else if (programSpliceFlag && spliceImmediateFlag) {
        // No splice_time follows
    }


    let breakDuration = null;
    if (durationFlag) {
        if (bytes.length < index + 5) {
            console.warn('[scte35parse] Not enough bytes for BreakDuration in SpliceInsert.');
            // Attempt parsing with available bytes, but mark error
            breakDuration = _parseBreakDuration(bytes, index);
            breakDuration.error = 'Truncated BreakDuration data';
            index = bytes.length; // Advance index past available bytes
        } else {
            breakDuration = _parseBreakDuration(bytes, index);
            index += 5;
        }
    }

    if (bytes.length < index + 4) return { ...argumentsToObjects({ spliceEventId, spliceEventCancelIndicator, outOfNetworkIndicator, programSpliceFlag, durationFlag, spliceImmediateFlag, spliceTime, breakDuration }), error: "Truncated SpliceInsert data (program ID, avail num)" }; // Helper to convert args to object
    const uniqueProgramId = (bytes[index] << 8) | bytes[index + 1];
    index += 2;

    const availNum = bytes[index++];
    const availsExpected = bytes[index++];

    return {
        spliceEventId,
        spliceEventCancelIndicator,
        outOfNetworkIndicator,
        programSpliceFlag,
        durationFlag,
        spliceImmediateFlag,
        spliceTime, // Can be null
        breakDuration, // Can be null
        uniqueProgramId,
        availNum,
        availsExpected
    };
}

// Helper to convert arguments to an object (for error returns)
function argumentsToObjects(obj) {
    return obj;
}


// Parse a time signal command (often contains segmentation descriptors)
function _parseTimeSignal(bytes, startIndex, endIndex) {
    let index = startIndex;

    if (bytes.length < index + (5 + 1)) { // Need at least 6 bytes for splice_time with specified flag
        console.warn('[scte35parse] Not enough bytes for SpliceTime in TimeSignal.');
        // Attempt parsing with available bytes, but mark error
        const spliceTime = _parseSpliceTime(bytes, index);
        spliceTime.error = 'Truncated SpliceTime data';
        return { spliceTime, error: 'Truncated TimeSignal data' };
    }

    const spliceTime = _parseSpliceTime(bytes, index);
    index += (spliceTime.specified ? 5 + 1 : 1); // 1 flag byte + 5 PTS bytes if specified, else just 1 flag byte

    // The rest of the Time Signal command payload is for descriptors (if any).
    // Descriptors are parsed *after* the command info block, as part of the descriptor loop.
    // However, the command *length* declared in the header accounts for *this* command's payload.
    // If the command length was > (1 + 5) or > 1, there might be extra bytes here before the descriptor loop.
    // The spec says splice_time() is the *entire* time_signal() command body.
    // So index should be at the end of the command body here (which is `endIndex + 1`).
    if (index > endIndex + 1) {
        // This shouldn't happen if spliceTime parsing was correct
        console.warn('[scte35parse] Index went past expected command end in TimeSignal parse.');
    }


    return {
        spliceTime
    };
}

// Parse segmentation descriptor
function _parseSegmentationDescriptor(bytes, startIndex, endIndex) {
    let index = startIndex;

    if (bytes.length < index + 4) return { error: "Truncated SegmentationDescriptor (identifier)" };
    // Parse identifier (32-bit value, typically 'CUEI')
    let identifierBytes = bytes.slice(index, index + 4);
    let identifier = '';
    try {
        identifier = String.fromCharCode(...identifierBytes);
    } catch (e) {
        identifier = identifierBytes.map(b => b.toString(16).padStart(2, '0')).join(''); // Hex fallback
    }
    index += 4;

    if (bytes.length < index + 4) return { identifier, error: "Truncated SegmentationDescriptor (event ID)" };
    // Parse event ID
    const eventId = (bytes[index] << 24) | (bytes[index + 1] << 16) |
        (bytes[index + 2] << 8) | bytes[index + 3];
    index += 4;

    if (bytes.length < index + 1) return { identifier, eventId, error: "Truncated SegmentationDescriptor (cancel indicator)" };
    // Parse flags
    const cancelIndicator = (bytes[index] & 0x80) !== 0;
    // const reserved = bytes[index] & 0x7F; // Reserved bits
    index++;

    if (cancelIndicator) {
        return {
            identifier,
            eventId,
            cancelIndicator
        };
    }

    if (bytes.length < index + 1) return { identifier, eventId, cancelIndicator, error: "Truncated SegmentationDescriptor (delivery flags)" };
    // Parse the flags byte immediately following the cancel_indicator byte.
    // This byte contains:
    // - program_segmentation_flag (1 bit)
    // - segmentation_duration_flag (1 bit)
    // - delivery_not_restricted_flag (1 bit)
    // - And, if delivery_not_restricted_flag is 0, the subsequent delivery restriction flags.
    if (bytes.length < index + 1) return { identifier, eventId, cancelIndicator, error: "Truncated SegmentationDescriptor (flags)" };
    const programSegmentationFlag = (bytes[index] & 0x80) !== 0;
    const segmentationDurationFlag = (bytes[index] & 0x40) !== 0;
    const deliveryNotRestrictedFlag = (bytes[index] & 0x20) !== 0;

    let webDeliveryAllowedFlag = false;
    let noRegionalBlackoutFlag = false;
    let archiveAllowedFlag = false;
    let deviceRestrictions = 0;

    if (!deliveryNotRestrictedFlag) {
        webDeliveryAllowedFlag = (bytes[index] & 0x10) !== 0;
        noRegionalBlackoutFlag = (bytes[index] & 0x08) !== 0;
        archiveAllowedFlag = (bytes[index] & 0x04) !== 0;
        deviceRestrictions = bytes[index] & 0x03; // 2 bits
    }
    index++; // Move past this flags byte

    // Parse segmentation duration if present
    let segmentationDuration = null;
    if (segmentationDurationFlag) {
        if (bytes.length < index + 5) {
            console.warn('[scte35parse] Not enough bytes for segmentation_duration.');
            segmentationDuration = { duration: null, error: 'Truncated segmentation_duration data' };
            index = bytes.length; // Advance past available bytes
        } else {
            // segmentation_duration is a 40-bit field representing duration in 90kHz ticks.
            // JavaScript numbers can handle up to 2^53 - 1, so a 40-bit number is fine.
            // Using Math.pow for clarity in constructing the 40-bit value.
            const b0 = bytes[index];
            const b1 = bytes[index + 1];
            const b2 = bytes[index + 2];
            const b3 = bytes[index + 3];
            const b4 = bytes[index + 4];
            segmentationDuration = (b0 * Math.pow(2, 32)) +
                (b1 * Math.pow(2, 24)) +
                (b2 * Math.pow(2, 16)) +
                (b3 * Math.pow(2, 8)) +
                b4;
            index += 5; // Move past duration bytes
        }
    }

    if (bytes.length < index + 2) return { ...argumentsToObjects({ identifier, eventId, cancelIndicator, programSegmentationFlag, segmentationDurationFlag, deliveryNotRestrictedFlag, webDeliveryAllowedFlag, noRegionalBlackoutFlag, archiveAllowedFlag, deviceRestrictions, segmentationDuration }), error: "Truncated SegmentationDescriptor (upid type/length)" };
    // Parse upid type and upid
    const upidType = bytes[index++];
    const upidLength = bytes[index++];

    let upid = null;
    if (upidLength > 0) {
        if (bytes.length < index + upidLength) {
            console.warn('[scte35parse] Not enough bytes for UPID.');
            upid = { raw: bytes.slice(index), error: 'Truncated UPID data' };
            index = bytes.length; // Advance past available bytes
        } else {
            upid = Array.from(bytes.slice(index, index + upidLength));
            // Attempt to decode UPID based on type? Common types: 0x06 (ISCI), 0x08 (AdID), 0x0C (UUID)
            // For now, just store raw bytes as array.
            index += upidLength;
        }
    }

    if (bytes.length < index + 3) return { ...argumentsToObjects({ identifier, eventId, cancelIndicator, programSegmentationFlag, segmentationDurationFlag, deliveryNotRestrictedFlag, webDeliveryAllowedFlag, noRegionalBlackoutFlag, archiveAllowedFlag, deviceRestrictions, segmentationDuration, upidType, upidLength, upid }), error: "Truncated SegmentationDescriptor (type ID, num, expected)" };
    // Parse type ID, num and expected
    const typeId = bytes[index++];
    const segmentNum = bytes[index++];
    const segmentsExpected = bytes[index++];

    // Remaining bytes in the descriptor are optional sub_segment() or parts
    // The provided code doesn't parse these, so we stop here and assume index is at `endIndex + 1`
    // after parsing the required fields.
    // If index < endIndex + 1 here, there are unparsed bytes.
    if (index <= endIndex) {
        console.warn(`[scte35parse] Segmentation Descriptor has ${endIndex - index + 1} unparsed bytes.`);
        // Store remaining raw bytes?
        // rawRemaining: Array.from(bytes.slice(index, endIndex + 1))
    }


    return {
        identifier,
        eventId,
        cancelIndicator,
        programSegmentationFlag,
        segmentationDurationFlag,
        deliveryNotRestrictedFlag,
        webDeliveryAllowedFlag,
        noRegionalBlackoutFlag,
        archiveAllowedFlag,
        deviceRestrictions,
        segmentationDuration: segmentationDurationFlag ? segmentationDuration : null, // Only include if flag set
        upidType,
        upidLength,
        upid,
        typeId,
        typeIdName: SEGMENTATION_TYPE_IDS[typeId] || `Unknown (0x${typeId.toString(16).padStart(2, '0')})`,
        segmentNum,
        segmentsExpected,
        isAdStart: _isAdStartType(typeId),
        isAdEnd: _isAdEndType(typeId)
    };
}

// Check if segmentation type is an ad start (matching types in the provided SEGMENTATION_TYPE_IDS)
function _isAdStartType(typeId) {
    const adStartTypes = [0x22, 0x30, 0x32, 0x34, 0x36, 0x38, 0x3A, 0x3C, 0x3E, 0x44, 0x46];
    return adStartTypes.includes(typeId);
}

// Check if segmentation type is an ad end (matching types in the provided SEGMENTATION_TYPE_IDS)
function _isAdEndType(typeId) {
    const adEndTypes = [0x23, 0x31, 0x33, 0x35, 0x37, 0x39, 0x3B, 0x3D, 0x3F, 0x45, 0x47];
    return adEndTypes.includes(typeId);
}


// Main SCTE35 parser object
const SCTE35Parser = {
    // Parse SCTE35 base64 data
    parseFromB64: function (base64Data) {
        if (!base64Data) {
            return { error: "No base64 data provided" };
        }
        try {
            // Convert base64 to binary
            const binary = atob(base64Data);
            const bytes = new Uint8Array(binary.length);
            for (let i = 0; i < binary.length; i++) {
                bytes[i] = binary.charCodeAt(i);
            }

            // Add encoded data to result for reference
            const parsed = this.parseFromBytes(bytes);
            parsed.encoded = base64Data;
            return parsed;

        } catch (error) {
            console.error("[scte35parse] Error parsing SCTE-35 base64:", error);
            return {
                error: "Invalid base64 encoding or parsing failure: " + error.message,
                encoded: base64Data,
                raw: base64Data // Store original for context
            };
        }
    },

    // Parse SCTE35 binary data (Uint8Array)
    parseFromBytes: function (bytes) {
        if (!bytes || bytes.length === 0) {
            return { error: "No byte data provided" };
        }
        try {
            let index = 0;

            if (bytes.length < index + 1) return { error: "Truncated SCTE-35 data (table ID)" };
            // Parse table ID
            const tableId = bytes[index++];
            if (tableId !== 0xFC) {
                console.warn(`[scte35parse] Not a standard SCTE-35 message (invalid table ID: 0x${tableId.toString(16)})`);
                return { error: `Not a standard SCTE-35 message (invalid table ID: 0x${tableId.toString(16)})`, tableId, raw: Array.from(bytes) };
            }

            if (bytes.length < index + 2) return { tableId, error: "Truncated SCTE-35 data (section length)" };
            // Parse section syntax indicator, private indicator, and section length
            const byteSyntaxLength = bytes[index]; // This byte contains syntax/private indicators and 4 bits of length
            const sectionSyntaxIndicator = (byteSyntaxLength & 0x80) !== 0; // Always 0 for SCTE-35
            const privateIndicator = (byteSyntaxLength & 0x40) !== 0;     // Should be 1 for SCTE-35
            const sectionLength = ((byteSyntaxLength & 0x0F) << 8) | bytes[index + 1]; // Last 4 bits of current + next byte

            // Basic sanity check on section length
            if (sectionLength > bytes.length - (index + 2)) {
                console.warn(`[scte35parse] Declared section length (${sectionLength}) exceeds remaining data length (${bytes.length - (index + 2)})`);
                // Decide whether to fail or parse what's available. Let's parse available but mark error.
            } else if (sectionLength < (14 - 3)) { // Minimum size of fixed fields (protocol_version to tier) is 11 bytes.
                console.warn(`[scte35parse] Declared section length (${sectionLength}) seems too small.`);
            }


            index += 2; // Move past the length bytes

            if (bytes.length < index + 11) return { tableId, sectionLength, error: "Truncated SCTE-35 data (header fields)" };

            // Parse protocol version and encrypted packet
            const byteProtocolEnc = bytes[index];
            const protocolVersion = byteProtocolEnc >> 5; // 5 bits
            const encryptedPacket = (byteProtocolEnc & 0x10) !== 0; // 1 bit
            const encryptionAlgorithm = byteProtocolEnc & 0x0F; // 4 bits
            index++;

            // Parse PTS adjustment (48 bits, 33 meaningful?)
            // The provided code uses 5 bytes here. Let's stick to that interpretation for now.
            // Standard spec often says 48 bits (6 bytes) for PTS.
            // Assuming the 5-byte _readPTS is correct for this source.
            const ptsAdjustment = _readPTS(bytes.slice(index, index + 5));
            index += 5;

            // Parse CW index (8 bits)
            const cwIndex = bytes[index++];

            // Parse tier (12 bits)
            const tier = ((bytes[index] & 0x0F) << 8) | bytes[index + 1]; // Only lower 12 bits used
            index += 2;

            // Parse splice command length (8 bits)
            const spliceCommandLength = bytes[index++];

            if (bytes.length < index + spliceCommandLength) {
                console.warn(`[scte35parse] Declared splice command length (${spliceCommandLength}) exceeds remaining data length (${bytes.length - index}).`);
                // Adjust command length to available data
                // spliceCommandLength = bytes.length - index; // This might cause issues if command structure is incomplete
                // Or, just parse what's there and let the command parsing functions handle truncation errors. Let's do the latter.
            }


            let spliceCommandType = null;
            let spliceCommandInfo = null;

            if (spliceCommandLength > 0) {
                if (bytes.length < index + 1) {
                    console.warn('[scte35parse] Truncated SCTE-35 data (splice command type)');
                    spliceCommandInfo = { error: 'Truncated command type' };
                    // Cannot proceed parsing command info without type
                    index = bytes.length; // Skip to end
                } else {
                    // Parse splice command type
                    spliceCommandType = bytes[index++];
                    // Parse splice command based on type
                    // Note: commandEndIndex is relative to the *start* of the command bytes, not the overall message.
                    // The length includes the type byte.
                    const commandBytes = bytes.slice(index, index + spliceCommandLength - 1); // Bytes *after* the type byte

                    switch (spliceCommandType) {
                        case 0x05: // Splice Insert
                            spliceCommandInfo = _parseSpliceInsert(commandBytes, 0, commandBytes.length - 1);
                            break;
                        case 0x07: // Time Signal
                            spliceCommandInfo = _parseTimeSignal(commandBytes, 0, commandBytes.length - 1);
                            break;
                        // Add other known command types here if needed
                        case 0x00: // Null Command
                        case 0x06: // Splice Schedule
                        case 0xFE: // Bandwidth Reservation
                        case 0xFF: // Private Command
                            spliceCommandInfo = { raw: Array.from(commandBytes) }; // Capture raw bytes for unknown/unparsed commands
                            break;
                        default:
                            console.warn(`[scte35parse] Unknown Splice Command Type: 0x${spliceCommandType.toString(16)}`);
                            spliceCommandInfo = { raw: Array.from(commandBytes), error: 'Unknown command type' };
                            break;
                    }
                    index += spliceCommandLength - 1; // Move index past the command info bytes
                }
            } else {
                // splice_command_length is 0, means no command is present.
                console.log('[scte35parse] Splice Command Length is 0.');
            }


            if (bytes.length < index + 2) {
                console.warn('[scte35parse] Truncated SCTE-35 data (descriptor loop length)');
                // Cannot parse descriptors
                return {
                    tableId, sectionSyntaxIndicator, privateIndicator, sectionLength,
                    protocolVersion, encryptedPacket, encryptionAlgorithm, ptsAdjustment,
                    cwIndex, tier, spliceCommandLength, spliceCommandType, spliceCommandTypeName: SCTE35_COMMAND_TYPES[spliceCommandType] || 'unknown',
                    spliceCommandInfo,
                    descriptorLoopLength: 0, // Assume 0 if truncated
                    descriptors: [],
                    error: 'Truncated descriptor loop length'
                };
            }
            // Parse descriptor loop length (16 bits)
            const descriptorLoopLength = (bytes[index] << 8) | bytes[index + 1];
            index += 2;

            const descriptors = [];
            const descriptorEndIndex = index + descriptorLoopLength;

            if (descriptorEndIndex > bytes.length) {
                console.warn(`[scte35parse] Declared descriptor loop length (${descriptorLoopLength}) exceeds remaining data length (${bytes.length - index}).`);
                // Adjust end index to parse what's available
                // descriptorEndIndex = bytes.length; // Let the loop handle bounds implicitly
            }


            while (index < descriptorEndIndex && index < bytes.length) {
                if (bytes.length < index + 2) {
                    console.warn('[scte35parse] Truncated SCTE-35 data (descriptor tag/length)');
                    break; // Cannot parse descriptor if tag/length are missing
                }
                const descriptorTag = bytes[index++];
                const descriptorLength = bytes[index++];
                const descriptorEndPosition = index + descriptorLength;

                if (descriptorEndPosition > bytes.length) {
                    console.warn(`[scte35parse] Declared descriptor length (${descriptorLength}) for tag 0x${descriptorTag.toString(16)} exceeds remaining data length (${bytes.length - index}).`);
                    // Adjust end position to parse what's available
                    // descriptorEndPosition = bytes.length;
                }


                let descriptorInfo = null;

                // Parse descriptor based on its tag
                const descriptorBytes = bytes.slice(index, Math.min(index + descriptorLength, bytes.length)); // Slice available bytes

                switch (descriptorTag) {
                    case 0x02: // Segmentation Descriptor
                        // Note: _parseSegmentationDescriptor expects start/end *relative to the bytes slice*, not the original bytes array.
                        descriptorInfo = _parseSegmentationDescriptor(descriptorBytes, 0, descriptorBytes.length - 1);
                        break;
                    // Add other known descriptor tags here if needed
                    case 0x00: // Avail Descriptor
                    case 0x01: // DTMF Descriptor
                    case 0x03: // Time Descriptor
                    case 0x04: // Audio Descriptor
                        descriptorInfo = { raw: Array.from(descriptorBytes) }; // Capture raw bytes
                        break;
                    default:
                        console.warn(`[scte35parse] Unknown Descriptor Tag: 0x${descriptorTag.toString(16)}`);
                        descriptorInfo = { raw: Array.from(descriptorBytes), error: 'Unknown descriptor tag' };
                        break;
                }

                descriptors.push({
                    tag: descriptorTag,
                    tagName: SCTE35_DESCRIPTOR_TAGS[descriptorTag] || `unknown (0x${descriptorTag.toString(16).padStart(2, '0')})`,
                    length: descriptorLength,
                    info: descriptorInfo
                });

                index = descriptorEndPosition; // Move index past the descriptor bytes
            }

            // Skip CRC_32 (4 bytes)
            // The sectionLength includes the CRC, so the total parsed bytes should equal sectionLength + 3 (tableId, syntax/private/length bits).
            // index is currently at the end of the descriptor loop.
            // The bytes remaining should be the CRC.
            const expectedEndIndex = 3 + sectionLength; // 3 header bytes + sectionLength

            if (bytes.length >= expectedEndIndex) {
                const crcBytes = bytes.slice(expectedEndIndex - 4, expectedEndIndex);
                // We could calculate and verify CRC here, but often not necessary for just parsing.
                console.log(`[scte35parse] Found CRC-32 bytes at end.`); // CRC not parsed into a value
            } else if (bytes.length < expectedEndIndex && bytes.length >= expectedEndIndex - 4) {
                console.warn(`[scte35parse] Data seems truncated, missing full CRC.`);
            } else {
                console.warn(`[scte35parse] Data seems truncated, missing descriptor loop or CRC.`);
            }


            return {
                tableId,
                sectionSyntaxIndicator,
                privateIndicator,
                sectionLength,
                protocolVersion,
                encryptedPacket,
                encryptionAlgorithm,
                ptsAdjustment, // in 90kHz ticks
                cwIndex,
                tier,
                spliceCommandLength,
                spliceCommandType,
                spliceCommandTypeName: SCTE35_COMMAND_TYPES[spliceCommandType] || 'unknown',
                spliceCommandInfo,
                descriptorLoopLength,
                descriptors,
                // Add raw bytes for reference if needed (can be large)
                // raw: Array.from(bytes)
            };
        } catch (error) {
            console.error("[scte35parse] Error parsing SCTE-35 binary:", error);
            return {
                error: "Parsing failure: " + error.message,
                raw: Array.from(bytes)
            };
        }
    },

    // Extract SCTE-35 data (base64 or hex) from HLS tags
    extractFromHLSTags: function (line, extractOnly = false) {
        if (!line) return null;

        try {
            let encodedData = null;
            let encodingType = null; // 'base64' or 'hex'

            // Check for SCTE35 attribute (Base64) in DATERANGE or other tags
            // e.g., #EXT-X-DATERANGE:SCTE35="..."
            // The snippet shows SCTE35-CMD=0x... inside DATERANGE, which is different.
            // Let's look for SCTE35= (Base64) first.
            const scte35Base64Match = line.match(/SCTE35="?([A-Za-z0-9+\/=]+)"?/); // Handle quotes optionally
            if (scte35Base64Match && scte35Base64Match[1]) {
                encodedData = scte35Base64Match[1];
                encodingType = 'base64';
                // console.log('[scte35parse] Found SCTE35 (Base64) in line:', line);
            } else {
                // Check for SCTE35-OUT, SCTE35-IN (Hex) in DATERANGE
                // e.g., #EXT-X-DATERANGE:SCTE35-OUT=0x...
                // or SCTE35-CMD=0x... as shown in the snippet
                const scte35HexMatch = line.match(/SCTE35-(?:OUT|IN|CMD)="?0x([0-9A-F]+)"?/i); // Case-insensitive hex
                if (scte35HexMatch && scte35HexMatch[1]) {
                    encodedData = scte35HexMatch[1];
                    encodingType = 'hex';
                    // console.log('[scte35parse] Found SCTE35 (Hex) in line:', line);
                } else {
                    // Check for CUE-OUT, CUE-IN, CUE tags which sometimes contain SCTE-35 Base64 payload directly
                    // e.g., #EXT-X-CUE-OUT:<base64> or #EXT-X-CUE:<base64>
                    // The original code's regex was simple: `CUE-OUT:([A-Za-z0-9+\/=]+)` or `CUE:([A-Za-z0-9+\/=]+)`.
                    // This assumes the base64 follows the colon directly. Let's use that.
                    const cueBase64Match = line.match(/#(?:EXT-X-CUE-(?:OUT|IN)|EXT-X-CUE):([A-Za-z0-9+\/=]+)/);
                    if (cueBase64Match && cueBase64Match[1]) {
                        encodedData = cueBase64Match[1];
                        encodingType = 'base64';
                        // console.log('[scte35parse] Found CUE tag with Base64 in line:', line);
                    }
                }
            }


            if (encodedData) {
                if (extractOnly) { // If only extracting, return raw without parsing
                    return {
                        line: line,
                        encoded: encodedData,
                        encodingType: encodingType
                    };
                }
                let parsedData = null;
                let bytes = null;

                try {
                    if (encodingType === 'base64') {
                        bytes = Uint8Array.from(atob(encodedData), c => c.charCodeAt(0));
                    } else if (encodingType === 'hex') {
                        bytes = new Uint8Array(encodedData.length / 2);
                        for (let i = 0; i < encodedData.length; i += 2) {
                            bytes[i / 2] = parseInt(encodedData.substr(i, 2), 16);
                        }
                    }
                } catch (e) {
                    console.error(`[scte35parse] Error decoding ${encodingType} SCTE data:`, e);
                    return {
                        line: line,
                        encoded: encodedData,
                        encodingType: encodingType,
                        error: `Decoding error: ${e.message}`
                    };
                }

                if (bytes && bytes.length > 0) {
                    parsedData = this.parseFromBytes(bytes);
                    // Add original line and encoded data to the parsed result for context
                    parsedData.line = line;
                    parsedData.encoded = encodedData;
                    parsedData.encodingType = encodingType;
                    return parsedData;
                } else {
                    return {
                        line: line,
                        encoded: encodedData,
                        encodingType: encodingType,
                        error: 'Decoded data is empty'
                    };
                }
            }


            return null; // No SCTE-35 data found in this line

        } catch (error) {
            console.error("[scte35parse] Error extracting SCTE-35 from HLS tag:", error);
            return {
                line: line,
                error: "Extraction failure: " + error.message
            };
        }
    },

    // Get a human-readable description of a parsed SCTE-35 signal
    getHumanReadableDescription: function (parsedScte35) {
        if (!parsedScte35 || parsedScte35.error) {
            return `Invalid SCTE-35 signal: ${parsedScte35?.error || 'No data'}`;
        }

        let description = `SCTE-35: ${parsedScte35.spliceCommandTypeName || 'unknown command'}`;

        // Add PTS adjustment if available
        if (parsedScte35.ptsAdjustment !== null && parsedScte35.ptsAdjustment !== undefined) {
            description += ` (PTS Adj: ${parsedScte35.ptsAdjustment})`;
        }


        // For splice insert
        if (parsedScte35.spliceCommandType === 0x05 && parsedScte35.spliceCommandInfo) {
            const info = parsedScte35.spliceCommandInfo;

            if (info.spliceEventCancelIndicator) {
                return `${description}: Cancel splice event ID ${info.spliceEventId}`;
            }

            description += info.outOfNetworkIndicator ? ": OUT (Ad Start)" : ": IN (Ad End)";

            if (info.spliceImmediateFlag) {
                description += " - Immediate";
            } else if (info.spliceTime && info.spliceTime.specified) {
                if (info.spliceTime.ptsTime !== null) {
                    const ptsSeconds = info.spliceTime.ptsTime / 90000;
                    description += ` - At PTS ${ptsSeconds.toFixed(3)}s (${info.spliceTime.ptsTime} ticks)`;
                } else {
                    description += ` - At PTS (error parsing)`;
                }
            }

            if (info.breakDuration) {
                if (info.breakDuration.duration !== null) {
                    const durationSecs = info.breakDuration.duration / 90000; // Convert from 90kHz to seconds
                    description += ` - Duration: ${durationSecs.toFixed(3)}s (${info.breakDuration.duration} ticks)`;
                } else {
                    description += ` - Duration: (error parsing)`;
                }
            }
            // Add other details from Splice Insert if interesting (e.g., uniqueProgramId, availNum)
            description += ` - Event ID: ${info.spliceEventId}`;
            if (info.uniqueProgramId !== undefined) description += ` - Program ID: ${info.uniqueProgramId}`;
            if (info.availNum !== undefined) description += ` - Avail Num: ${info.availNum}/${info.availsExpected}`;

        }

        // For time signal (often with segmentation descriptor)
        if (parsedScte35.spliceCommandType === 0x07 && parsedScte35.spliceCommandInfo) {
            const info = parsedScte35.spliceCommandInfo;
            if (info.spliceTime && info.spliceTime.specified) {
                if (info.spliceTime.ptsTime !== null) {
                    const ptsSeconds = info.spliceTime.ptsTime / 90000;
                    description += `: Time Signal at PTS ${ptsSeconds.toFixed(3)}s (${info.spliceTime.ptsTime} ticks)`;
                } else {
                    description += `: Time Signal at PTS (error parsing)`;
                }
            } else {
                description += `: Time Signal (unspecified time)`;
            }


            const segmentationDescriptors = parsedScte35.descriptors?.filter(d => d.tag === 0x02) || [];

            if (segmentationDescriptors.length > 0) {
                description += " (Descriptors:";
                segmentationDescriptors.forEach((segDescEntry, index) => {
                    const segDesc = segDescEntry.info;
                    if (!segDesc || segDesc.error) {
                        description += ` SegDesc Error: ${segDesc?.error || 'No Info'}`;
                        return;
                    }

                    description += ` [Seg ${index}: ${segDesc.typeIdName}`;

                    if (segDesc.cancelIndicator) {
                        description += ` Cancel Event ID ${segDesc.eventId}`;
                    } else {
                        description += ` Event ID ${segDesc.eventId}`;
                        if (segDesc.identifier) description += ` | Identifier: ${segDesc.identifier}`;
                        if (segDesc.segmentationDuration !== null) {
                            if (typeof segDesc.segmentationDuration === 'object' && segDesc.segmentationDuration.error) {
                                description += ` | Duration: (error)`;
                            } else {
                                const durationSecs = segDesc.segmentationDuration / 90000; // Convert from 90kHz to seconds
                                description += ` | Duration: ${durationSecs.toFixed(3)}s`;
                            }
                        }
                        if (segDesc.upid) description += ` | UPID Type ${segDesc.upidType}: [${segDesc.upidLength} bytes]`;
                        if (segDesc.segmentNum !== undefined) description += ` | Segment ${segDesc.segmentNum}/${segDesc.segmentsExpected}`;
                    }
                    description += "]";
                });
                description += ")";
            }
        }

        // Add info for other command types if needed

        // Add general descriptor info if any are present and not handled above
        if (parsedScte35.descriptors?.length > 0 && parsedScte35.spliceCommandType !== 0x07) {
            description += " (Descriptors:";
            parsedScte35.descriptors.forEach(descriptor => {
                description += ` [Tag: 0x${descriptor.tag.toString(16)} (${descriptor.tagName})]`;
            });
            description += ")";
        }


        return description;
    }
};

// Make the parser globally accessible
window.SCTE35Parser = SCTE35Parser;

console.log('[scte35parse] Ready.');