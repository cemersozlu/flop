const { workerData, parentPort } = require('worker_threads');
const Metaflac = require('metaflac-js');
const NodeID3 = require('node-id3');
const fs = require('fs');
const path = require('path');

const { filePath, clampedRating } = workerData;

function findFlacOffset(buffer) {
    let offset = 0;
    if (buffer.slice(0, 3).toString() === 'ID3') {
        const s = buffer.slice(6, 10);
        offset = 10 + ((s[0] << 21) | (s[1] << 14) | (s[2] << 7) | s[3]);
    }
    while (offset < buffer.length - 4 && buffer.slice(offset, offset + 4).toString() !== 'fLaC') {
        offset++;
    }
    return buffer.slice(offset, offset + 4).toString() === 'fLaC' ? offset : -1;
}

const ext = path.extname(filePath).toLowerCase();

try {
    if (ext === '.flac') {
        // --- FLAC RATING ---
        try {
            const flac = new Metaflac(filePath);
            flac.removeTag('RATING');
            if (clampedRating > 0) flac.setTag('RATING=' + (clampedRating * 20));
            flac.save();
            parentPort.postMessage({ success: true, path: 'fast-flac' });
        } catch (e) {
            // Fallback: buffer mode with ID3 stripping
            const buffer = fs.readFileSync(filePath);
            const flacOffset = findFlacOffset(buffer);
            if (flacOffset === -1) throw new Error('Could not find fLaC marker in file');

            const id3Prefix = buffer.slice(0, flacOffset);
            const flacOnly = buffer.slice(flacOffset);

            const flac = new Metaflac(flacOnly);
            flac.removeTag('RATING');
            if (clampedRating > 0) flac.setTag('RATING=' + (clampedRating * 20));
            const updatedFlac = flac.save();

            const finalBuffer = Buffer.concat([id3Prefix, updatedFlac]);
            const tempPath = filePath + '.tmp' + Date.now();
            fs.writeFileSync(tempPath, finalBuffer);
            fs.renameSync(tempPath, filePath);

            parentPort.postMessage({ success: true, path: 'buffer-flac' });
        }
    } else if (ext === '.mp3') {
        // --- MP3 RATING (ID3v2 POPM) ---
        // Map 1-5 to 0-255: 1:51, 2:102, 3:153, 4:204, 5:255
        const ratingVal = clampedRating > 0 ? clampedRating * 51 : 0;
        
        const tags = {
            popularimeter: {
                email: 'user@flop.app',
                rating: ratingVal,
                counter: 0
            }
        };

        const success = NodeID3.update(tags, filePath);
        if (success === true) {
            parentPort.postMessage({ success: true, path: 'mp3' });
        } else {
            throw new Error('NodeID3 failed to update tags');
        }
    } else {
        throw new Error('Unsupported file extension: ' + ext);
    }
} catch (e) {
    parentPort.postMessage({ success: false, error: e.message });
}