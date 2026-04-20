const fs = require('fs');
const path = require('path');

/**
 * FastFlac: A surgical FLAC parser that only reads headers and tags.
 * Designed for blazing fast initial library indexing.
 */
class FastFlac {
    static readMetadata(filePath) {
        let fd;
        try {
            fd = fs.openSync(filePath, 'r');
            const magic = Buffer.alloc(4);
            fs.readSync(fd, magic, 0, 4, 0);
            if (magic.toString() !== 'fLaC') return null;

            let metadata = {
                path: filePath,
                title: path.basename(filePath, '.flac'),
                artist: 'Unknown Artist',
                albumArtist: 'Unknown Artist',
                album: 'Unknown Album',
                year: null,
                trackNo: 0,
                discNo: 1,
                duration: 0,
                sampleRate: null,
                bitDepth: null,
                bitrate: null,
                rating: 0,
                coverArt: null
            };

            let currentOffset = 4;
            let isLast = false;
            while (!isLast) {
                const header = Buffer.alloc(4);
                if (fs.readSync(fd, header, 0, 4, currentOffset) !== 4) break;
                currentOffset += 4;

                const rawType = header[0];
                isLast = (rawType & 0x80) !== 0;
                const type = rawType & 0x7F;
                const length = header.readUIntBE(1, 3);

                if (type === 0 && length >= 34) { // STREAMINFO
                    const data = Buffer.alloc(length);
                    fs.readSync(fd, data, 0, length, currentOffset);

                    // Sample rate (20 bits) at bits 80-99
                    // data[10], data[11], data[12] (part)
                    const b10 = data[10];
                    const b11 = data[11];
                    const b12 = data[12];
                    metadata.sampleRate = (b10 << 12) | (b11 << 4) | (b12 >> 4);

                    // Bit depth (5 bits) at bits 100-104
                    metadata.bitDepth = (((b12 & 0x0F) << 1) | (data[13] >> 7)) + 1;

                    // Total samples (36 bits) at bits 105-140
                    // const samplesHigh = BigInt(data[13] & 0x7F);
                    // const samplesMid = BigInt(data.readUInt32BE(14));
                    // const samplesLow = BigInt(data[17]); // actually 36 bits is 4.5 bytes
                    // Standard FLAC: 13(7 bits), 14, 15, 16, 17(1 bit)
                    // Let's simplify:
                    const totalSamples = (BigInt(data[13] & 0x0F) << 32n) | BigInt(data.readUInt32BE(14));

                    if (metadata.sampleRate > 0) {
                        metadata.duration = Number(totalSamples) / metadata.sampleRate;
                    }
                } else if (type === 4) { // VORBIS_COMMENT
                    const data = Buffer.alloc(length);
                    fs.readSync(fd, data, 0, length, currentOffset);
                    this.parseVorbis(data, metadata);
                }

                currentOffset += length;
            }

            // Estimate bitrate from file size
            const stats = fs.fstatSync(fd);
            if (metadata.duration > 0) {
                metadata.bitrate = Math.round((stats.size * 8) / metadata.duration);
            }

            return metadata;
        } catch (e) {
            return null;
        } finally {
            if (fd !== undefined) fs.closeSync(fd);
        }
    }

    static parseVorbis(buffer, metadata) {
        try {
            let offset = 0;
            const vendorLen = buffer.readUInt32LE(offset);
            offset += 4 + vendorLen;

            if (offset + 4 > buffer.length) return;
            const count = buffer.readUInt32LE(offset);
            offset += 4;

            for (let i = 0; i < count; i++) {
                if (offset + 4 > buffer.length) break;
                const len = buffer.readUInt32LE(offset);
                offset += 4;
                if (offset + len > buffer.length) break;

                const comment = buffer.toString('utf8', offset, offset + len);
                offset += len;

                const splitIdx = comment.indexOf('=');
                if (splitIdx === -1) continue;
                const key = comment.substring(0, splitIdx).toUpperCase();
                const val = comment.substring(splitIdx + 1);

                switch (key) {
                    case 'TITLE': metadata.title = val; break;
                    case 'ARTIST': metadata.artist = val; break;
                    case 'ALBUMARTIST': metadata.albumArtist = val; break;
                    case 'ALBUM': metadata.album = val; break;
                    case 'DATE': metadata.year = val; break;
                    case 'TRACKNUMBER': metadata.trackNo = parseInt(val, 10) || 0; break;
                    case 'DISCNUMBER': metadata.discNo = parseInt(val, 10) || 1; break;
                    case 'RATING': {
                        const r = parseInt(val, 10);
                        if (!isNaN(r)) {
                            if (r <= 5) metadata.rating = r;
                            else if (r <= 100) metadata.rating = Math.round(r / 20);
                        }
                        break;
                    }
                }
            }
        } catch (e) { }
    }
}

module.exports = FastFlac;
