export { Catalog, isoWeekTag, type ChangeEntry, type ChangesetKind, type ChangesetRow, type ChangesetStatus, type Check, type EntityView, type HistoryEntry, type NewRevision, type ProjectFocus, type ProjectView, type Proposal, type ReportReason, type RevisionRow } from './catalog.js';
export { CatalogError, type CatalogErrorCode } from './errors.js';
export { ExportGate } from './gate.js';
export { fileFromDrive, getDerivations, getFile, getPageFix, recordDerivation, recordPageFix, registerFile, setRights, storageTierFor, type DerivationRow, type FileRow, type NewDerivation, type NewFile, type NewPageFix, type PageFixRow, type PageFixVerdict } from './files.js';
export { diffData, resolveConflicts, threeWayMerge, UnresolvedConflictError, type Conflict, type FieldChange, type Json, type MergeResult, type Resolution } from './merge.js';
export { LIVE_TYPES, STEWARD_TYPES, TRUST_THRESHOLD, UPLOAD_HOLD_HOURS, UPLOAD_LIMITS, canApprove, canSuggest, earnedTrust, mayGoLive, uploadAllowance, type Account, type SetInfo } from './permissions.js';
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
export { EMAIL_LINKS_PER_HOUR, EMAIL_LINK_MINUTES, addEmail, cleanEmail, emailsOf, peekEmailLink, personByEmail, signInMessage, startEmailLink, takeEmailLink, type EmailLinkRefusal, type EmailLinkView } from './email.js';
export { NOTIFICATION_MODES, digestMessage, notificationSetting, sendNotifications, setNotifications, unsubscribe, type EmailMessage, type Mailer, type NotificationMode, type NotificationSetting } from './notify.js';
export { adviceFor, advicePrompt, adviseSuggestions, type Advice, type Advisor } from './advice.js';
export { TAKEDOWN_RELATIONS, TAKEDOWN_RESPONSE_DAYS, requestTakedown, resolveTakedownTarget, takeDownFile, takedowns, type TakedownRelation, type TakedownView } from './takedown.js';
export { bestLine, matchingWords, momentOf, queryWords, searchMoments, snippetOf, type Moment, type ParagraphMoment, type ScanLineMoment } from './moments.js';
export {
  EMBEDDED_TYPES,
  EMBEDDING_DIMENSIONS,
  EMBEDDING_MODEL,
  embedItems,
  embedderFromEnv,
  embeddingCoverage,
  embeddingInput,
  hasPgvector,
  itemsToEmbed,
  nearest,
  searchSimilar,
  unitVector,
  workersAiEmbedder,
  type Embedder,
  type SimilarItem,
} from './semantic.js';
export { CITATIONS_BOT, findCitations, proposeCitations, relationsOf, resolveCitation, type Citation, type CitationTarget, type RelationView } from './citations.js';
export { catalogHealth, type CatalogHealth } from './health.js';
