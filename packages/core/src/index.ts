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
export { fixLine, fixParagraph, recordingTranscript, scanText, type ScanTextPage, type TranscriptView } from './text.js';
export { MAX_HOOKS_PER_ACCOUNT, createWebhook, deleteWebhook, deliverWebhooks, listWebhooks, type WebhookRow } from './webhooks.js';
export {
  filePages,
  getFingerprint,
  itemsUsingFile,
  pageImageCount,
  recordAudioFingerprint,
  recordPdfPages,
  similarFiles,
  similarRecordings,
  similarScans,
  type FilePageRow,
  type FingerprintRow,
  type PageRecord,
  type SimilarFile,
} from './scans.js';
export {
  TESHURA_RIGHTS,
  TESHUROS_SET,
  familyRequest,
  familyRequests,
  proposeUpload,
  suggestContents,
  teshuraCredit,
  teshurosSetId,
  yearsInText,
  type ContentsInput,
  type FamilyRequestInput,
  type ProposalInput,
  type UploadProposal,
} from './print.js';
