export * from './works.js';
export * from './entities.js';
export { canonicalJson, contentHash, sha256Hex, toHex } from './canonical.js';
export { idFromSeed, isEntityId, newId, readId, type EntityId } from './ids.js';
export { isEntityPath, joinPath, slugify, type EntityPath } from './paths.js';
export { isOrderKey, orderBetween, orderKeys } from './order.js';
export {
  RIGHTS_BY_CLASS,
  RIGHTS_BY_LICENCE,
  RIGHTS_BY_SOURCE,
  RIGHTS_STATES,
  decisionFromRightsState,
  defaultRightsState,
  keepsPreservationCopy,
  mayExport,
  mayServe,
  rightsStateFromDecision,
  stricterRights,
  type FileClass,
  type RightsInput,
  type RightsState,
} from './rights.js';
export { BUILTIN_SCHEMAS, BUILTIN_SCHEMA_VERSION, CATALOG_SOURCE_IDS, ENTITY_LABELS, LANGUAGES } from './schemas/builtin.js';
export { SchemaRegistry, type ValidationIssue, type ValidationResult } from './schemas/validate.js';
export { REFERENCE_FIELDS, referencesOf, type Reference } from './refs.js';
export {
  AUDIO_FINGERPRINT_ENCODER,
  AUDIO_FRAMES_PER_SECOND,
  AUDIO_RATE,
  PAGE_HASH_ENCODER,
  PAGE_HASH_NEAR,
  audioFingerprint,
  compareAudio,
  comparePages,
  hashBands,
  hashDistance,
  pageHash,
  resample,
  looksSameScan,
  sharesPages,
  sameRecording,
  samplePages,
  type AudioMatch,
  type GreyImage,
} from './fingerprints.js';
