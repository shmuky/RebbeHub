export { Catalog, isoWeekTag, type ChangeEntry, type ChangesetKind, type ChangesetRow, type ChangesetStatus, type Check, type EntityView, type HistoryEntry, type NewRevision, type ProjectFocus, type ProjectView, type Proposal, type ReportReason, type RevisionRow } from './catalog.js';
export { CatalogError, type CatalogErrorCode } from './errors.js';
export { ExportGate } from './gate.js';
export { fileFromDrive, getDerivations, getFile, getPageFix, recordDerivation, recordPageFix, registerFile, setRights, storageTierFor, type DerivationRow, type FileRow, type NewDerivation, type NewFile, type NewPageFix, type PageFixRow, type PageFixVerdict } from './files.js';
export { diffData, resolveConflicts, threeWayMerge, UnresolvedConflictError, type Conflict, type FieldChange, type Json, type MergeResult, type Resolution } from './merge.js';
export { LIVE_TYPES, STEWARD_TYPES, TRUST_THRESHOLD, canApprove, canSuggest, earnedTrust, mayGoLive, type Account, type SetInfo } from './permissions.js';
export { searchTextOf, toTsQuery } from './searchText.js';
export {
  CHALLENGE_MINUTES,
  SESSION_DAYS,
  addPasskey,
  base64url,
  cleanDisplayName,
  createPerson,
  endSession,
  findPasskey,
  getPerson,
  googleAccountsOf,
  googleSignedIn,
  linkGoogle,
  listPeople,
  hashToken,
  newPersonId,
  passkeyUsed,
  passkeysOf,
  renamePerson,
  setPersonRole,
  saveChallenge,
  sessionPerson,
  startSession,
  takeChallenge,
  type ChallengePurpose,
  type Person,
  type StoredPasskey,
} from './auth.js';
export { OCR_UPLOAD_LIMITS, chooseSeed, confirmPage, fixLine, pageLevel, reseedLines, scanProgress, scanText, uploadOcr, type ScanTextLayer, type ScanTextPage } from './text.js';
export { parseAlto, parseHocr, parseOcr, parsePlainText, sniffOcrFormat, type OcrFormat, type OcrPage } from './ocrFormats.js';
export {
  alignAroundLocks,
  alignParagraphs,
  alignWords,
  anchorSync,
  confirmSync,
  fixParagraph,
  hanachaOf,
  hanachaSync,
  heardWords,
  recordingTranscript,
  remapper,
  type HeardWord,
  type Timed,
  type TranscriptParagraph,
  type TranscriptView,
  type WordTiming,
} from './sync.js';
export { comparePrintings, diffWords, printingText, printingsOf, type DiffRun, type Printing } from './compare.js';
export { matchWords, wordKey, words, type Word } from './words.js';
export { CLAIM_HOURS, claimNext, focusCounts, projectTodo, releaseClaim, type ProjectItem } from './projectWork.js';
export { MAX_HOOKS_PER_ACCOUNT, createWebhook, deleteWebhook, deliverWebhooks, listWebhooks, type WebhookRow } from './webhooks.js';
