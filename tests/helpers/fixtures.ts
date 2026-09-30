/**
 * AIDetective — test fixtures.
 * Real, spec-conformant binary buffers built in code (no mocking of engine
 * logic — these are genuine files that real parsers/decoders must accept).
 */

// ─── Checksums ────────────────────────────────────────────────────────────────

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export function adler32(buf: Buffer): number {
  let a = 1;
  let b = 0;
  for (let i = 0; i < buf.length; i++) {
    a = (a + buf[i]) % 65521;
    b = (b + a) % 65521;
  }
  return ((b << 16) | a) >>> 0;
}

// ─── zlib stream with STORED (uncompressed) deflate blocks ───────────────────

export function zlibStored(raw: Buffer): Buffer {
  const chunks: Buffer[] = [Buffer.from([0x78, 0x01])];
  let offset = 0;
  while (offset < raw.length) {
    const slice = raw.subarray(offset, offset + 65535);
    const final = offset + slice.length >= raw.length ? 1 : 0;
    const header = Buffer.alloc(5);
    header[0] = final;
    header.writeUInt16LE(slice.length, 1);
    header.writeUInt16LE(~slice.length & 0xffff, 3);
    chunks.push(header, slice);
    offset += slice.length;
  }
  const adler = Buffer.alloc(4);
  adler.writeUInt32BE(adler32(raw), 0);
  chunks.push(adler);
  return Buffer.concat(chunks);
}

// ─── PNG ──────────────────────────────────────────────────────────────────────

export interface PngOptions {
  width: number;
  height: number;
  /** deterministic pixel generator: returns [r,g,b] for (x, y) */
  pixel?: (x: number, y: number) => [number, number, number];
  /** tEXt chunks to embed, e.g. [["Software", "Midjourney"]] */
  textChunks?: Array<[string, string]>;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeAndData = Buffer.concat([Buffer.from(type, "latin1"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typeAndData), 0);
  return Buffer.concat([len, typeAndData, crc]);
}

/** Builds a real, decodable RGB8 PNG (sharp must accept it). */
export function buildPng(opts: PngOptions): Buffer {
  const { width, height } = opts;
  const pixel = opts.pixel ?? ((x, y) => [(x * 37) % 256, (y * 53) % 256, (x * y) % 256]);
  const raw = Buffer.alloc(height * (1 + width * 3));
  for (let y = 0; y < height; y++) {
    const rowStart = y * (1 + width * 3);
    raw[rowStart] = 0; // filter: none
    for (let x = 0; x < width; x++) {
      const [r, g, b] = pixel(x, y);
      raw[rowStart + 1 + x * 3] = r;
      raw[rowStart + 2 + x * 3] = g;
      raw[rowStart + 3 + x * 3] = b;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // color type RGB
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const parts: Buffer[] = [sig, pngChunk("IHDR", ihdr)];
  for (const [key, value] of opts.textChunks ?? []) {
    parts.push(pngChunk("tEXt", Buffer.concat([Buffer.from(key, "latin1"), Buffer.from([0]), Buffer.from(value, "latin1")])));
  }
  parts.push(pngChunk("IDAT", zlibStored(raw)), pngChunk("IEND", Buffer.alloc(0)));
  return Buffer.concat(parts);
}

// ─── WAV (PCM16 mono) ─────────────────────────────────────────────────────────

export interface WavOptions {
  sampleRate?: number;
  durationSec?: number;
  /** sample generator −1..1 (default: 440 Hz sine at 0.8 amplitude) */
  generator?: (t: number) => number;
}

export function buildWav(opts: WavOptions = {}): Buffer {
  const sampleRate = opts.sampleRate ?? 8000;
  const durationSec = opts.durationSec ?? 0.5;
  const gen = opts.generator ?? ((t: number) => 0.8 * Math.sin(2 * Math.PI * 440 * t));
  const frameCount = Math.floor(sampleRate * durationSec);
  const data = Buffer.alloc(frameCount * 2);
  for (let i = 0; i < frameCount; i++) {
    const s = Math.max(-1, Math.min(1, gen(i / sampleRate)));
    data.writeInt16LE(Math.round(s * 32767), i * 2);
  }
  const header = Buffer.alloc(44);
  header.write("RIFF", 0, "latin1");
  header.writeUInt32LE(36 + data.length, 4);
  header.write("WAVE", 8, "latin1");
  header.write("fmt ", 12, "latin1");
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(1, 22); // mono
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28); // byte rate
  header.writeUInt16LE(2, 32); // block align
  header.writeUInt16LE(16, 34); // bits
  header.write("data", 36, "latin1");
  header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}

/** WAV with a LIST/INFO chunk containing an ISFT (software) tag. */
export function buildWavWithSoftwareTag(software: string): Buffer {
  const base = buildWav({ durationSec: 0.2 });
  const isftPayload = Buffer.concat([Buffer.from(software, "latin1"), Buffer.from([0])]);
  const isftEntry = Buffer.concat([
    Buffer.from("ISFT", "latin1"),
    (() => { const b = Buffer.alloc(4); b.writeUInt32LE(isftPayload.length, 0); return b; })(),
    isftPayload,
    isftPayload.length % 2 ? Buffer.from([0]) : Buffer.alloc(0),
  ]);
  const listPayload = Buffer.concat([Buffer.from("INFO", "latin1"), isftEntry]);
  const listChunk = Buffer.concat([
    Buffer.from("LIST", "latin1"),
    (() => { const b = Buffer.alloc(4); b.writeUInt32LE(listPayload.length, 0); return b; })(),
    listPayload,
    listPayload.length % 2 ? Buffer.from([0]) : Buffer.alloc(0),
  ]);
  // Insert LIST chunk after fmt chunk: rebuild RIFF
  const riffSize = base.readUInt32LE(4);
  const body = base.subarray(12, 8 + riffSize);
  const newSize = 4 + body.length + listChunk.length;
  const out = Buffer.concat([
    Buffer.from("RIFF", "latin1"),
    (() => { const b = Buffer.alloc(4); b.writeUInt32LE(newSize, 0); return b; })(),
    Buffer.from("WAVE", "latin1"),
    body,
    listChunk,
  ]);
  return out;
}

// ─── MP3 (ID3v2.3 header + one MPEG frame header) ────────────────────────────

function synchsafe(size: number): Buffer {
  const b = Buffer.alloc(4);
  b[0] = (size >> 21) & 0x7f;
  b[1] = (size >> 14) & 0x7f;
  b[2] = (size >> 7) & 0x7f;
  b[3] = size & 0x7f;
  return b;
}

function id3Frame(id: string, text: string): Buffer {
  const payload = Buffer.concat([Buffer.from([0]), Buffer.from(text, "latin1")]);
  const header = Buffer.alloc(10);
  header.write(id, 0, "latin1");
  header.writeUInt32BE(payload.length, 4);
  return Buffer.concat([header, payload]);
}

/** MP3 with ID3v2.3 tags; encoder string can trigger TTS hints (e.g. "Bark"). */
export function buildMp3(tags: { title?: string; encoder?: string }): Buffer {
  const frames: Buffer[] = [];
  if (tags.title) frames.push(id3Frame("TIT2", tags.title));
  if (tags.encoder) frames.push(id3Frame("TSSE", tags.encoder));
  const framesBuf = Buffer.concat(frames);
  const tag = Buffer.concat([Buffer.from("ID3", "latin1"), Buffer.from([3, 0, 0]), synchsafe(framesBuf.length), framesBuf]);
  // MPEG-1 Layer III 128kbps 44.1kHz frame header (joint stereo)
  const mpegFrame = Buffer.from([0xff, 0xfb, 0x90, 0x00, ...new Array(412).fill(0)]);
  return Buffer.concat([tag, mpegFrame]);
}

// ─── FLAC (fLaC + STREAMINFO) ─────────────────────────────────────────────────

export function buildFlac(sampleRate = 44100, totalSamples = 22050): Buffer {
  const si = Buffer.alloc(34);
  si.writeUInt16BE(4096, 0); // min block
  si.writeUInt16BE(4096, 2); // max block
  si.writeUIntBE(0, 4, 3); // min frame
  si.writeUIntBE(0, 7, 3); // max frame
  // 20 bits sample rate, 3 bits channels-1, 5 bits bits-1, 36 bits total samples
  si[10] = (sampleRate >> 12) & 0xff;
  si[11] = (sampleRate >> 4) & 0xff;
  si[12] = ((sampleRate & 0x0f) << 4) | (0 << 1) | ((16 - 1) >> 4);
  si[13] = (((16 - 1) & 0x0f) << 4) | ((totalSamples / 2 ** 32) & 0x0f);
  si.writeUInt32BE(totalSamples % 2 ** 32, 14);
  const header = Buffer.from([0x00, 0, 0, 34]); // STREAMINFO, last=false
  return Buffer.concat([Buffer.from("fLaC", "latin1"), header, si]);
}

// ─── M4A (ftyp box) ───────────────────────────────────────────────────────────

export function buildM4a(): Buffer {
  const ftypPayload = Buffer.concat([Buffer.from("M4A ", "latin1"), Buffer.from([0, 0, 0, 0]), Buffer.from("M4A mp42isom", "latin1")]);
  const box = Buffer.alloc(8);
  box.writeUInt32BE(ftypPayload.length + 8, 0);
  box.write("ftyp", 4, "latin1");
  return Buffer.concat([box, ftypPayload]);
}

// ─── ZIP (stored entries) — for real DOCX ────────────────────────────────────

interface ZipEntry {
  name: string;
  data: Buffer;
}

export function buildStoredZip(entries: ZipEntry[]): Buffer {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const nameBuf = Buffer.from(entry.name, "utf8");
    const crc = Buffer.alloc(4);
    crc.writeUInt32LE(crc32(entry.data), 0);
    const sizes = Buffer.alloc(4);
    sizes.writeUInt32LE(entry.data.length, 0);
    const local = Buffer.concat([
      Buffer.from([0x50, 0x4b, 0x03, 0x04]),
      Buffer.from([20, 0]), // version
      Buffer.from([0, 0]), // flags
      Buffer.from([0, 0]), // method: stored
      Buffer.from([0, 0, 0, 0]), // time + date
      crc,
      sizes,
      sizes,
      Buffer.from([nameBuf.length & 0xff, 0]),
      Buffer.from([0, 0]),
      nameBuf,
      entry.data,
    ]);
    localParts.push(local);

    const central = Buffer.concat([
      Buffer.from([0x50, 0x4b, 0x01, 0x02]),
      Buffer.from([20, 0, 20, 0]),
      Buffer.from([0, 0]), // flags
      Buffer.from([0, 0]), // method: stored
      Buffer.from([0, 0, 0, 0]), // time + date
      crc,
      sizes,
      sizes,
      Buffer.from([nameBuf.length & 0xff, 0]),
      Buffer.from([0, 0]), // extra len
      Buffer.from([0, 0]), // comment len
      Buffer.from([0, 0]), // disk start
      Buffer.from([0, 0]), // internal attrs
      Buffer.from([0, 0, 0, 0]), // external attrs
      (() => { const b = Buffer.alloc(4); b.writeUInt32LE(offset, 0); return b; })(),
      nameBuf,
    ]);
    centralParts.push(central);
    offset += local.length;
  }
  const centralBuf = Buffer.concat(centralParts);
  const eocd = Buffer.concat([
    Buffer.from([0x50, 0x4b, 0x05, 0x06]),
    Buffer.from([0, 0]),
    Buffer.from([0, 0]),
    (() => { const b = Buffer.alloc(2); b.writeUInt16LE(entries.length, 0); return b; })(),
    (() => { const b = Buffer.alloc(2); b.writeUInt16LE(entries.length, 0); return b; })(),
    (() => { const b = Buffer.alloc(4); b.writeUInt32LE(centralBuf.length, 0); return b; })(),
    (() => { const b = Buffer.alloc(4); b.writeUInt32LE(offset, 0); return b; })(),
    Buffer.from([0, 0]),
  ]);
  return Buffer.concat([...localParts, centralBuf, eocd]);
}

/** Minimal real .docx (OOXML) containing the given paragraphs. */
export function buildDocx(paragraphs: string[]): Buffer {
  const escaped = paragraphs.map((p) => p.replace(/&/g, "&amp;").replace(/</g, "&lt;"));
  const body = escaped.map((p) => `<w:p><w:r><w:t xml:space="preserve">${p}</w:t></w:r></w:p>`).join("");
  const document = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}</w:body></w:document>`;
  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`;
  const rels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`;
  const relsW = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>`;
  return buildStoredZip([
    { name: "[Content_Types].xml", data: Buffer.from(contentTypes, "utf8") },
    { name: "_rels/.rels", data: Buffer.from(rels, "utf8") },
    { name: "word/document.xml", data: Buffer.from(document, "utf8") },
    { name: "word/_rels/document.xml.rels", data: Buffer.from(relsW, "utf8") },
  ]);
}

// ─── PDF (correct xref offsets) ───────────────────────────────────────────────

export function buildPdf(text: string): Buffer {
  const stream = `BT /F1 12 Tf 72 720 Td (${text.replace(/([()\\])/g, "\\$1")}) Tj ET`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  const parts: Buffer[] = [Buffer.from("%PDF-1.4\n", "latin1")];
  const offsets: number[] = [];
  let pos = parts[0].length;
  objects.forEach((body, i) => {
    const obj = `${i + 1} 0 obj\n${body}\nendobj\n`;
    offsets.push(pos);
    parts.push(Buffer.from(obj, "latin1"));
    pos += obj.length;
  });
  const xrefStart = pos;
  let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) xref += `${off.toString().padStart(10, "0")} 00000 n \n`;
  const trailer = `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`;
  parts.push(Buffer.from(xref + trailer, "latin1"));
  return Buffer.concat(parts);
}

// ─── JPEG (header structure only: DQT + SOF0 + SOS — no entropy data) ────────

export const IJG_STD_LUMA = [
  16, 11, 10, 16, 24, 40, 51, 61, 12, 12, 14, 19, 26, 58, 60, 55,
  14, 13, 16, 24, 40, 57, 69, 56, 14, 17, 22, 29, 51, 87, 80, 62,
  18, 22, 37, 56, 68, 109, 103, 77, 24, 35, 55, 64, 81, 104, 113, 92,
  49, 64, 78, 87, 103, 121, 120, 101, 72, 92, 95, 98, 112, 100, 103, 99,
];

/** JPEG with spec-correct markers for structure parsing (NOT decodable by sharp). */
export function buildJpegHeaders(opts: { width: number; height: number; quality: number; subsampling?: Array<[number, number, number, number]> }): Buffer {
  const q = Math.max(1, Math.min(100, opts.quality));
  const scale = q < 50 ? 5000 / q : 200 - q * 2;
  const table = IJG_STD_LUMA.map((v) => Math.max(1, Math.min(255, Math.floor((v * scale + 50) / 100))));
  const dqt = Buffer.concat([
    Buffer.from([0xff, 0xdb, 0x00, 0x43, 0x00]),
    Buffer.from(table),
  ]);
  const sof = Buffer.alloc(19);
  sof[0] = 0xff;
  sof[1] = 0xc0;
  sof.writeUInt16BE(17, 2);
  sof[4] = 8; // precision
  sof.writeUInt16BE(opts.height, 5);
  sof.writeUInt16BE(opts.width, 7);
  sof[9] = 3; // components
  const sampling = opts.subsampling ?? [[2, 2], [1, 1], [1, 1]];
  for (let i = 0; i < 3; i++) {
    sof[10 + i * 2] = i + 1;
    sof[11 + i * 2] = (sampling[i][0] << 4) | sampling[i][1];
  }
  const sos = Buffer.from([0xff, 0xda, 0x00, 0x0c, 0x03, 0x01, 0x00, 0x02, 0x11, 0x03, 0x11, 0x00, 0x3f, 0x00]);
  return Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00]), dqt, sof, sos]);
}

// ─── Text fixtures (deterministic content) ───────────────────────────────────

/** Uniform, phrase-heavy formal text — should lean AI. */
export const AI_TEXT = [
  "In today's fast-paced world, artificial intelligence plays a crucial role in the ever-evolving landscape of technology. Moreover, it is important to note that these systems delve into vast repositories of information and unlock the potential of automation. Furthermore, the seamless integration of robust frameworks serves as a testament to human ingenuity, allowing organizations to navigate the complexities of the digital age. Additionally, machine learning models harness the power of data and embark on a journey of continuous improvement in the realm of intelligent computing. In conclusion, the tapestry of innovation stands as a beacon of progress, and it is worth noting that this pivotal role will only expand in the modern era.",
  "In today's fast-paced world, artificial intelligence plays a crucial role in the ever-evolving landscape of technology. Moreover, it is important to note that these systems delve into vast repositories of information and unlock the potential of automation. Furthermore, the seamless integration of robust frameworks serves as a testament to human ingenuity, allowing organizations to navigate the complexities of the digital age. Additionally, machine learning models harness the power of data and embark on a journey of continuous improvement in the realm of intelligent computing. In conclusion, the tapestry of innovation stands as a beacon of progress, and it is worth noting that this pivotal role will only expand in the modern era.",
  "In today's fast-paced world, artificial intelligence plays a crucial role in the ever-evolving landscape of technology. Moreover, it is important to note that these systems delve into vast repositories of information and unlock the potential of automation. Furthermore, the seamless integration of robust frameworks serves as a testament to human ingenuity, allowing organizations to navigate the complexities of the digital age. Additionally, machine learning models harness the power of data and embark on a journey of continuous improvement in the realm of intelligent computing. In conclusion, the tapestry of innovation stands as a beacon of progress, and it is worth noting that this pivotal role will only expand in the modern era.",
  "In today's fast-paced world, artificial intelligence plays a crucial role in the ever-evolving landscape of technology. Moreover, it is important to note that these systems delve into vast repositories of information and unlock the potential of automation. Furthermore, the seamless integration of robust frameworks serves as a testament to human ingenuity, allowing organizations to navigate the complexities of the digital age. Additionally, machine learning models harness the power of data and embark on a journey of continuous improvement in the realm of intelligent computing. In conclusion, the tapestry of innovation stands as a beacon of progress, and it is worth noting that this pivotal role will only expand in the modern era.",
  "In today's fast-paced world, artificial intelligence plays a crucial role in the ever-evolving landscape of technology. Moreover, it is important to note that these systems delve into vast repositories of information and unlock the potential of automation. Furthermore, the seamless integration of robust frameworks serves as a testament to human ingenuity, allowing organizations to navigate the complexities of the digital age. Additionally, machine learning models harness the power of data and embark on a journey of continuous improvement in the realm of intelligent computing. In conclusion, the tapestry of innovation stands as a beacon of progress, and it is worth noting that this pivotal role will only expand in the modern era.",
].join(" ");

export const HUMAN_TEXT = `ok so lol. I broke it again!! idk how. hmm. the thing just stopped working yesterday and I was like... nope. gonna wait. btw its still broken (the tiny screw!!) dont ask. So anyway today I woke up LATE, missed the bus, and then of course it started raining. ugh. my coffee went cold on the counter and I just... left it there. whatever. yep. My sister says she can fix it?? she fixed the lamp last month so maybe. haha. we'll see. honestly idk what I'm doing but it's fine. Everything is FINE. :)

later — ok update: she fixed it in like 10 minutes?! 10!! how. I watched her do it and I still dont get it. she's a wizard tbh. anyway were getting pizza tonight, gonna order the usual. sooo yeah. good day overall I guess!`;

/** Very short text — should trigger the short-text warning path. */
export const SHORT_TEXT = "Hello world, this is a test.";
