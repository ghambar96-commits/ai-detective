/**
 * AIDetective — audio feature extraction.
 * Layer 1 (all formats): container/tag metadata parsing (WAV, MP3/ID3v2, FLAC, M4A).
 * Layer 2 (WAV PCM only): waveform statistics.
 * Kept separate: transcript analysis (when ASR becomes available) is a
 * downstream text analysis, never part of these features.
 */

// ─── WAV ──────────────────────────────────────────────────────────────────────

export interface WavInfo {
  audioFormat: number; // 1 = PCM, 3 = IEEE float
  channels: number;
  sampleRate: number;
  bitsPerSample: number;
  dataBytes: number;
  durationSec: number | null;
}

export function parseWavHeader(buf: Buffer): WavInfo | null {
  try {
    if (buf.length < 44 || buf.subarray(0, 4).toString("latin1") !== "RIFF" || buf.subarray(8, 12).toString("latin1") !== "WAVE") {
      return null;
    }
    let offset = 12;
    let info: Partial<WavInfo> = {};
    let dataBytes = 0;
    while (offset + 8 <= buf.length) {
      const chunkId = buf.subarray(offset, offset + 4).toString("latin1");
      const chunkSize = buf.readUInt32LE(offset + 4);
      if (chunkId === "fmt " && chunkSize >= 16) {
        info.audioFormat = buf.readUInt16LE(offset + 8);
        info.channels = buf.readUInt16LE(offset + 10);
        info.sampleRate = buf.readUInt32LE(offset + 12);
        info.bitsPerSample = buf.readUInt16LE(offset + 22);
      } else if (chunkId === "data") {
        dataBytes = chunkSize;
        break;
      }
      offset += 8 + chunkSize + (chunkSize % 2);
    }
    if (info.sampleRate === undefined || info.channels === undefined || info.bitsPerSample === undefined) return null;
    const bytesPerSample = info.bitsPerSample / 8;
    const durationSec = dataBytes > 0 && bytesPerSample > 0 ? dataBytes / (info.sampleRate * info.channels * bytesPerSample) : null;
    return {
      audioFormat: info.audioFormat ?? 0,
      channels: info.channels,
      sampleRate: info.sampleRate,
      bitsPerSample: info.bitsPerSample,
      dataBytes,
      durationSec: durationSec !== null ? Math.round(durationSec * 100) / 100 : null,
    };
  } catch {
    return null;
  }
}

export interface WaveformStats {
  decoded: boolean;
  reason?: string;
  samples: number;
  rmsMean: number;
  rmsStd: number;
  rmsCv: number;
  peak: number;
  crestFactor: number;
  dcOffset: number;
  clippingRatio: number;
  silenceRatio: number;
  silenceRunCount: number;
  zcrMean: number;
  zcrStd: number;
}

/** Decode PCM16/PCM8/Float32 WAV data and compute deterministic statistics. */
export function extractWaveformStats(buf: Buffer, wav: WavInfo): WaveformStats {
  const fail = (reason: string): WaveformStats => ({
    decoded: false,
    reason,
    samples: 0, rmsMean: 0, rmsStd: 0, rmsCv: 0, peak: 0, crestFactor: 0,
    dcOffset: 0, clippingRatio: 0, silenceRatio: 0, silenceRunCount: 0, zcrMean: 0, zcrStd: 0,
  });

  try {
    if (wav.audioFormat !== 1 && wav.audioFormat !== 3) return fail(`unsupported WAV encoding (format ${wav.audioFormat}) — metadata analysis only`);
    if (![8, 16, 32].includes(wav.bitsPerSample)) return fail(`${wav.bitsPerSample}-bit WAV not supported — metadata analysis only`);

    let offset = 12;
    let dataStart = -1;
    while (offset + 8 <= buf.length) {
      const chunkId = buf.subarray(offset, offset + 4).toString("latin1");
      const chunkSize = buf.readUInt32LE(offset + 4);
      if (chunkId === "data") {
        dataStart = offset + 8;
        break;
      }
      offset += 8 + chunkSize + (chunkSize % 2);
    }
    if (dataStart === -1) return fail("data chunk not found");

    const bytesPerSample = wav.bitsPerSample / 8;
    const frameCount = Math.floor(wav.dataBytes / (bytesPerSample * wav.channels));
    if (frameCount <= 0) return fail("no frames");

    // Cap analysis at ~30 minutes of mono audio to bound memory/time.
    const maxFrames = 30 * 60 * wav.sampleRate;
    const frames = Math.min(frameCount, maxFrames);
    const step = wav.channels;

    const readSample = (frameIdx: number): number => {
      const pos = dataStart + frameIdx * bytesPerSample * step; // first channel
      if (wav.audioFormat === 1) {
        if (wav.bitsPerSample === 8) return (buf[pos] - 128) / 128;
        if (wav.bitsPerSample === 16) return buf.readInt16LE(pos) / 32768;
        return buf.readInt32LE(pos) / 2147483648;
      }
      return buf.readFloatLE(pos);
    };

    const windowSize = Math.max(1, Math.floor(wav.sampleRate * 0.05)); // 50ms windows
    const windowRms: number[] = [];
    let peak = 0;
    let dcSum = 0;
    let clipped = 0;
    let silentSamples = 0;
    let silenceRuns = 0;
    let inSilence = false;
    let zcrWindows: number[] = [];

    let windowSq = 0, windowCount = 0, windowZc = 0, prevSign = 0;

    for (let i = 0; i < frames; i++) {
      const s = readSample(i);
      const abs = Math.abs(s);
      if (abs > peak) peak = abs;
      dcSum += s;
      if (abs >= 0.995) clipped++;
      const isSilent = abs < 0.005;
      if (isSilent) {
        silentSamples++;
        if (!inSilence) {
          inSilence = true;
          silenceRuns++;
        }
      } else inSilence = false;

      windowSq += s * s;
      windowCount++;
      const sign = s >= 0 ? 1 : -1;
      if (prevSign !== 0 && sign !== prevSign) windowZc++;
      prevSign = sign;

      if (windowCount >= windowSize) {
        windowRms.push(Math.sqrt(windowSq / windowCount));
        zcrWindows.push(windowZc / windowCount);
        windowSq = 0; windowCount = 0; windowZc = 0;
      }
    }
    if (windowCount > 0) {
      windowRms.push(Math.sqrt(windowSq / windowCount));
      zcrWindows.push(windowZc / windowCount);
    }

    const rmsMean = windowRms.reduce((a, b) => a + b, 0) / Math.max(windowRms.length, 1);
    const rmsStd = Math.sqrt(windowRms.reduce((a, r) => a + (r - rmsMean) ** 2, 0) / Math.max(windowRms.length, 1));
    const zcrMean = zcrWindows.reduce((a, b) => a + b, 0) / Math.max(zcrWindows.length, 1);
    const zcrStd = Math.sqrt(zcrWindows.reduce((a, r) => a + (r - zcrMean) ** 2, 0) / Math.max(zcrWindows.length, 1));

    return {
      decoded: true,
      samples: frames,
      rmsMean: r4(rmsMean),
      rmsStd: r4(rmsStd),
      rmsCv: rmsMean > 0 ? r4(rmsStd / rmsMean) : 0,
      peak: r4(peak),
      crestFactor: rmsMean > 0 ? r4(peak / rmsMean) : 0,
      dcOffset: r4(dcSum / frames),
      clippingRatio: r4(clipped / frames),
      silenceRatio: r4(silentSamples / frames),
      silenceRunCount: silenceRuns,
      zcrMean: r4(zcrMean),
      zcrStd: r4(zcrStd),
    };
  } catch (error) {
    return fail(error instanceof Error ? error.message : "decode failed");
  }
}

// ─── MP3 / ID3v2 ──────────────────────────────────────────────────────────────

export interface AudioTagFeatures {
  container: string;
  durationSec: number | null;
  sampleRate: number | null;
  channels: number | null;
  bitrateKbps: number | null;
  encoder: string | null;
  title: string | null;
  artist: string | null;
  softwareHints: string[];
  extraTags: Array<{ key: string; value: string }>;
  bitrateConsistent: boolean | null;
}

const TTS_ENCODER_PATTERNS = [
  "elevenlabs", "azure", "amazon polly", "google tts", "google text-to-speech",
  "microsoft speech", "tortoise", "bark", "coqui", "vits", "tacotron", "rvc",
  "voice.ai", "play.ht", "resemble", "descript", "openai tts", "whisper",
];

export function parseId3Tags(buf: Buffer): AudioTagFeatures {
  const features: AudioTagFeatures = {
    container: "mp3", durationSec: null, sampleRate: null, channels: null,
    bitrateKbps: null, encoder: null, title: null, artist: null, softwareHints: [],
    extraTags: [], bitrateConsistent: null,
  };
  try {
    if (buf.subarray(0, 3).toString("latin1") === "ID3") {
      const version = buf[3];
      const size = (buf[6] << 21) | (buf[7] << 14) | (buf[8] << 7) | buf[9];
      let offset = 10;
      const end = Math.min(10 + size, buf.length);
      const idLen = version >= 3 ? 4 : 3;
      while (offset + idLen + (version >= 3 ? 6 : 3) <= end) {
        const frameId = buf.subarray(offset, offset + idLen).toString("latin1");
        const frameSize = version >= 4
          ? (buf[offset + 4] << 21) | (buf[offset + 5] << 14) | (buf[offset + 6] << 7) | buf[offset + 7]
          : buf.readUInt32BE(offset + 4);
        if (frameSize <= 0 || offset + idLen + 6 + frameSize > end) break;
        const data = buf.subarray(offset + idLen + 6, offset + idLen + 6 + frameSize);
        const text = decodeId3Text(data);
        if (text) {
          if (frameId === "TIT2") features.title = text;
          else if (frameId === "TPE1") features.artist = text;
          else if (frameId === "TSSE" || frameId === "TENC") features.encoder = text;
          else if (frameId.startsWith("T")) features.extraTags.push({ key: frameId, value: text.slice(0, 120) });
        }
        offset += idLen + 6 + frameSize;
      }
    }
    // Estimate duration from first frame header + file size (CBR assumption)
    const frame = findFirstMpegFrame(buf);
    if (frame) {
      features.bitrateKbps = frame.bitrateKbps;
      features.sampleRate = frame.sampleRate;
      features.channels = frame.channels;
      features.durationSec = frame.bitrateKbps > 0 ? Math.round(((buf.length - 1024) * 8) / (frame.bitrateKbps * 1000)) : null;
      features.bitrateConsistent = null; // VBR detection TODO(phase-3): full frame scan
    }
  } catch {
    /* best-effort */
  }
  collectSoftwareHints(features);
  return features;
}

function decodeId3Text(data: Buffer): string | null {
  if (data.length < 1) return null;
  const enc = data[0];
  const body = data.subarray(1);
  try {
    if (enc === 0) return body.toString("latin1").replace(/\0+$/, "").trim() || null;
    if (enc === 3) return body.toString("utf8").replace(/\0+$/, "").trim() || null;
    if (enc === 1 || enc === 2) {
      const text = body.toString("utf16le").replace(/\0+$/, "").trim();
      return text || null;
    }
  } catch {
    return null;
  }
  return null;
}

const MPEG_BITRATES = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 0];
const MPEG_RATES = [44100, 48000, 32000];

function findFirstMpegFrame(buf: Buffer): { bitrateKbps: number; sampleRate: number; channels: number } | null {
  for (let i = 0; i < Math.min(buf.length - 4, 3 * 1024 * 1024); i++) {
    if (buf[i] === 0xff && (buf[i + 1] & 0xe0) === 0xe0) {
      const version = (buf[i + 1] >> 3) & 0x03; // 3 = MPEG1
      const layer = (buf[i + 1] >> 1) & 0x03; // 1 = Layer III
      const bitrateIdx = (buf[i + 2] >> 4) & 0x0f;
      const rateIdx = (buf[i + 2] >> 2) & 0x03;
      const channelMode = (buf[i + 3] >> 6) & 0x03;
      if (version === 3 && layer === 1 && bitrateIdx > 0 && bitrateIdx < 15 && rateIdx < 3) {
        return {
          bitrateKbps: MPEG_BITRATES[bitrateIdx],
          sampleRate: MPEG_RATES[rateIdx],
          channels: channelMode === 3 ? 1 : 2,
        };
      }
    }
  }
  return null;
}

// ─── FLAC ─────────────────────────────────────────────────────────────────────

export function parseFlacMetadata(buf: Buffer): AudioTagFeatures {
  const features: AudioTagFeatures = {
    container: "flac", durationSec: null, sampleRate: null, channels: null,
    bitrateKbps: null, encoder: null, title: null, artist: null, softwareHints: [],
    extraTags: [], bitrateConsistent: null,
  };
  try {
    let offset = 4; // after "fLaC"
    let last = false;
    while (offset + 4 <= buf.length && !last) {
      const header = buf[offset];
      last = (header & 0x80) !== 0;
      const blockType = header & 0x7f;
      const size = (buf[offset + 1] << 16) | (buf[offset + 2] << 8) | buf[offset + 3];
      const data = buf.subarray(offset + 4, offset + 4 + size);
      if (blockType === 0 && data.length >= 18) {
        // STREAMINFO
        const sampleRate = (data[10] << 12) | (data[11] << 4) | (data[12] >> 4);
        const channels = ((data[12] >> 1) & 0x07) + 1;
        const bits = (((data[12] & 0x01) << 4) | (data[13] >> 4)) + 1;
        const totalSamples =
          (data[13] & 0x0f) * 2 ** 32 + data[14] * 2 ** 24 + data[15] * 2 ** 16 + data[16] * 2 ** 8 + data[17];
        features.sampleRate = sampleRate;
        features.channels = channels;
        if (sampleRate > 0 && totalSamples > 0) features.durationSec = Math.round((totalSamples / sampleRate) * 100) / 100;
        if (features.durationSec && features.durationSec > 0) features.bitrateKbps = Math.round((buf.length * 8) / features.durationSec / 1000);
        void bits;
      } else if (blockType === 4) {
        // VORBIS_COMMENT
        let p = 0;
        const vendorLen = data.readUInt32LE(p); p += 4;
        const vendor = data.subarray(p, p + vendorLen).toString("utf8");
        features.encoder = vendor.slice(0, 200);
        p += vendorLen;
        const count = data.readUInt32LE(p); p += 4;
        for (let i = 0; i < Math.min(count, 40); i++) {
          const len = data.readUInt32LE(p); p += 4;
          const comment = data.subarray(p, p + len).toString("utf8");
          p += len;
          const eq = comment.indexOf("=");
          if (eq > 0) {
            const key = comment.slice(0, eq).toUpperCase();
            const value = comment.slice(eq + 1).slice(0, 200);
            if (key === "TITLE") features.title = value;
            else if (key === "ARTIST") features.artist = value;
            else if (key === "ENCODER") features.encoder = value;
            else features.extraTags.push({ key, value });
          }
        }
      }
      offset += 4 + size;
    }
  } catch {
    /* best-effort */
  }
  collectSoftwareHints(features);
  return features;
}

// ─── M4A ──────────────────────────────────────────────────────────────────────

export function parseM4aMetadata(buf: Buffer): AudioTagFeatures {
  const features: AudioTagFeatures = {
    container: "m4a", durationSec: null, sampleRate: null, channels: null,
    bitrateKbps: null, encoder: null, title: null, artist: null, softwareHints: [],
    extraTags: [], bitrateConsistent: null,
  };
  try {
    // ftyp major brand
    if (buf.length >= 12) features.extraTags.push({ key: "FTYP_BRAND", value: buf.subarray(8, 12).toString("latin1") });
    walkM4aBoxes(buf, 0, buf.length, 0, (type, content) => {
      if (type === "mvhd" && content.length >= 20) {
        const version = content[0];
        if (version === 0) {
          const timescale = content.readUInt32BE(12);
          const duration = content.readUInt32BE(16);
          if (timescale > 0) features.durationSec = Math.round((duration / timescale) * 100) / 100;
        } else if (version === 1 && content.length >= 28) {
          const timescale = content.readUInt32BE(20);
          const duration = Number(content.readBigUInt64BE(24));
          if (timescale > 0 && duration > 0) features.durationSec = Math.round((duration / timescale) * 100) / 100;
        }
      } else if (type === "\u00a9too" || type === "\u00a9too ") {
        const data = parseIlstData(content);
        if (data) features.encoder = data;
      } else if (type === "\u00a9nam") {
        features.title = parseIlstData(content);
      } else if (type === "\u00a9ART") {
        features.artist = parseIlstData(content);
      }
    });
    if (features.durationSec && features.durationSec > 0) {
      features.bitrateKbps = Math.round((buf.length * 8) / features.durationSec / 1000);
    }
  } catch {
    /* best-effort */
  }
  collectSoftwareHints(features);
  return features;
}

function walkM4aBoxes(buf: Buffer, start: number, end: number, depth: number, visit: (type: string, content: Buffer) => void) {
  if (depth > 6) return;
  let offset = start;
  while (offset + 8 <= end) {
    let size = buf.readUInt32BE(offset);
    const type = buf.subarray(offset + 4, offset + 8).toString("latin1");
    if (size === 1 && offset + 16 <= end) {
      size = Number(buf.readBigUInt64BE(offset + 8));
    }
    if (size < 8 || offset + size > end) return;
    const containerTypes = ["moov", "udta", "meta", "ilst", "trak", "mdia"];
    if (containerTypes.includes(type)) {
      const contentStart = type === "meta" ? offset + 8 + 4 : offset + 8; // meta has version/flags
      walkM4aBoxes(buf, contentStart, offset + size, depth + 1, visit);
    } else {
      visit(type, buf.subarray(offset + 8, offset + size));
    }
    offset += size;
  }
}

function parseIlstData(content: Buffer): string | null {
  try {
    // ilst item: size 'data' size type(version/flags) locale payload
    if (content.length >= 16 && content.subarray(4, 8).toString("latin1") === "data") {
      const payload = content.subarray(16);
      return payload.toString("utf8").replace(/\0+$/, "").trim().slice(0, 200) || null;
    }
  } catch {
    /* ignore */
  }
  return null;
}

// ─── WAV tag hints (LIST/INFO chunk) ─────────────────────────────────────────

export function parseWavTags(buf: Buffer): AudioTagFeatures {
  const features: AudioTagFeatures = {
    container: "wav", durationSec: null, sampleRate: null, channels: null,
    bitrateKbps: null, encoder: null, title: null, artist: null, softwareHints: [],
    extraTags: [], bitrateConsistent: null,
  };
  try {
    const wav = parseWavHeader(buf);
    if (wav) {
      features.sampleRate = wav.sampleRate;
      features.channels = wav.channels;
      features.durationSec = wav.durationSec;
      if (wav.durationSec && wav.durationSec > 0) features.bitrateKbps = Math.round((buf.length * 8) / wav.durationSec / 1000);
    }
    let offset = 12;
    while (offset + 8 <= buf.length) {
      const chunkId = buf.subarray(offset, offset + 4).toString("latin1");
      const chunkSize = buf.readUInt32LE(offset + 4);
      if (chunkId === "LIST" && buf.subarray(offset + 8, offset + 12).toString("latin1") === "INFO") {
        let p = offset + 12;
        const end = offset + 8 + chunkSize;
        while (p + 8 <= end) {
          const subId = buf.subarray(p, p + 4).toString("latin1");
          const subSize = buf.readUInt32LE(p + 4);
          const value = buf.subarray(p + 8, p + 8 + subSize).toString("utf8").replace(/\0+$/, "").trim();
          if (subId === "ISFT") features.encoder = value.slice(0, 200);
          else if (subId === "INAM") features.title = value.slice(0, 200);
          else if (subId === "IART") features.artist = value.slice(0, 200);
          else if (value) features.extraTags.push({ key: subId, value: value.slice(0, 200) });
          p += 8 + subSize + (subSize % 2);
        }
        break;
      }
      if (chunkSize === 0) break;
      offset += 8 + chunkSize + (chunkSize % 2);
    }
  } catch {
    /* best-effort */
  }
  collectSoftwareHints(features);
  return features;
}

function collectSoftwareHints(features: AudioTagFeatures) {
  const haystack = [features.encoder ?? "", features.title ?? "", features.artist ?? "", ...features.extraTags.map((t) => t.value)]
    .join(" | ")
    .toLowerCase();
  for (const pattern of TTS_ENCODER_PATTERNS) {
    if (haystack.includes(pattern)) features.softwareHints.push(pattern);
  }
}

function r4(n: number): number {
  return Math.round(n * 10000) / 10000;
}
