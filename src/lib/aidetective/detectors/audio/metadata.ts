/**
 * Detector: audio.metadata — METADATA LAYER ONLY.
 * Container + tag analysis for WAV/MP3/FLAC/M4A: TTS/encoder software hints,
 * duration, sample rate, bitrate. Separate from waveform analysis.
 */
import type { Detector, DetectorContext, Signal, EvidenceItem } from "../../core/types";
import type { AudioTagFeatures } from "../../features/audio-features";

export const audioMetadataDetector: Detector = {
  id: "audio.metadata",
  name: "Audio metadata & encoder tags",
  version: "1.0.0",
  description:
    "Reads container and tag metadata (ID3v2, VORBIS comments, M4A ilst, WAV LIST/INFO): encoder software, duration, sample rate, bitrate. Looks for known TTS/speech-synthesis tools.",
  modalities: ["audio"],
  defaultWeight: 0.9,
  limitations: [
    "Tags are optional and strippable; absence is weak evidence.",
    "Streaming/ripped audio often carries generic encoder tags.",
  ],

  async analyze(ctx: DetectorContext) {
    const tags = ctx.features.audioTags as AudioTagFeatures | undefined;
    if (!tags) return { status: "skipped" as const, signals: [], summary: "No audio metadata parsed" };

    const evidence: EvidenceItem[] = [
      {
        kind: "metadata",
        label: "Container",
        content: `container ${tags.container} · duration ${tags.durationSec !== null ? `${tags.durationSec}s` : "unknown"} · sample rate ${tags.sampleRate ?? "?"} Hz · channels ${tags.channels ?? "?"} · bitrate ${tags.bitrateKbps ?? "?"} kbps`,
        meta: {
          container: tags.container,
          durationSec: tags.durationSec,
          sampleRate: tags.sampleRate,
          channels: tags.channels,
          bitrateKbps: tags.bitrateKbps,
        },
      },
      {
        kind: "metadata",
        label: "Encoder / software",
        content: tags.encoder ? `encoder tag: "${tags.encoder}"` : "no encoder tag found",
        meta: { encoder: tags.encoder },
      },
    ];

    const signals: Signal[] = [];

    if (tags.softwareHints.length > 0) {
      evidence.push({
        kind: "metadata",
        label: "TTS/generation tool hint",
        content: `Metadata references: ${tags.softwareHints.map((h) => `"${h}"`).join(", ")} — known speech-synthesis/generation tools.`,
        meta: { hints: tags.softwareHints.join(",") },
      });
      signals.push({
        id: `${this.id}.tts_tag`,
        detectorId: this.id,
        name: "Speech-synthesis tool referenced in metadata",
        description: this.description,
        value: tags.softwareHints[0],
        aiScore: 0.93,
        weight: this.defaultWeight,
        evidence,
      });
    } else if (tags.encoder) {
      evidence.push({
        kind: "metadata",
        label: "Encoder note",
        content: `Encoder "${tags.encoder}" is not a known TTS tool. DAW/encoder tags are normal for human recordings.`,
      });
      signals.push({
        id: `${this.id}.encoder_tag`,
        detectorId: this.id,
        name: "Ordinary encoder tag present",
        description: this.description,
        value: tags.encoder,
        aiScore: 0.42,
        weight: this.defaultWeight * 0.6,
        evidence,
      });
    } else {
      signals.push({
        id: `${this.id}.no_encoder`,
        detectorId: this.id,
        name: "No encoder metadata present",
        description: this.description,
        value: null,
        aiScore: 0.55,
        weight: this.defaultWeight * 0.5,
        evidence,
        notes: "Metadata absence is common for both synthetic and recorded audio.",
      });
    }

    return {
      status: "ok" as const,
      signals,
      summary: tags.softwareHints.length
        ? `TTS hints: ${tags.softwareHints.join(", ")}`
        : `Container ${tags.container}, duration ${tags.durationSec ?? "?"}s`,
    };
  },
};
