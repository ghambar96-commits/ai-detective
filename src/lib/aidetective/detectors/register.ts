/** AIDetective — builtin detector registration. */
import { burstinessDetector } from "./text/burstiness";
import { vocabularyDetector } from "./text/vocabulary";
import { phrasesDetector } from "./text/phrases";
import { punctuationDetector } from "./text/punctuation";
import { structureDetector } from "./text/structure";
import { repetitionDetector } from "./text/repetition";
import { informalityDetector } from "./text/informality";
import { entropyDetector } from "./text/entropy";
import { connectivesDetector } from "./text/connectives";
import { imageMetadataDetector } from "./image/metadata";
import { dimensionsDetector } from "./image/dimensions";
import { compressionDetector } from "./image/compression";
import { pixelStatsDetector } from "./image/pixel-stats";
import { audioMetadataDetector } from "./audio/metadata";
import { waveformDetector } from "./audio/waveform";
import { textFeaturesExtractor, imageFeaturesExtractor, audioFeaturesExtractor } from "../features/extractors";
import { getRegistry } from "../core/registry";
import type { Detector, FeatureExtractor } from "../core/types";

export const builtinDetectors: Detector[] = [
  burstinessDetector,
  vocabularyDetector,
  phrasesDetector,
  punctuationDetector,
  structureDetector,
  repetitionDetector,
  informalityDetector,
  entropyDetector,
  connectivesDetector,
  imageMetadataDetector,
  dimensionsDetector,
  compressionDetector,
  pixelStatsDetector,
  audioMetadataDetector,
  waveformDetector,
];

export const builtinFeatureExtractors: FeatureExtractor[] = [
  textFeaturesExtractor,
  imageFeaturesExtractor,
  audioFeaturesExtractor,
];

export function registerBuiltins() {
  const registry = getRegistry();
  for (const detector of builtinDetectors) registry.registerDetector(detector, "builtin");
}
