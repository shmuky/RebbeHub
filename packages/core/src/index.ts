export { Catalog, PRIVATE_REASONS, isoWeekTag, type ArchiveGapRow, type ChangeEntry, type ChangesetKind, type ChangesetRow, type ChangesetStatus, type Check, type EntityView, type HistoryEntry, type NewRevision, type ProjectFocus, type ProjectView, type Proposal, type ReportReason, type RevisionRow } from './catalog.js';
export { summarizeChanges, type ChangeGroup } from './changeSummary.js';
export { CatalogError, type CatalogErrorCode } from './errors.js';
export { ExportGate } from './gate.js';
export { derivedRights, fileFromDrive, getDerivations, getDerivationsOf, isCoverProfile, getFile, getFiles, getPageFix, getPageFixes, recordDerivation, recordPageFix, registerFile, setRights, storageTierFor, type DerivationRow, type FileRow, type NewDerivation, type NewFile, type NewPageFix, type PageFixRow, type PageFixVerdict } from './files.js';
export { driveFileOf, driveFilesOf, knownDriveFile, type DriveFileLink } from './driveFiles.js';
export { diffData, mergeText, resolveConflicts, threeWayMerge, UnresolvedConflictError, type Conflict, type FieldChange, type Json, type MergeResult, type Resolution } from './merge.js';
export { LIVE_TYPES, STEWARD_TYPES, TRUST_THRESHOLD, UPLOAD_HOLD_HOURS, UPLOAD_LIMITS, canApprove, canSuggest, earnedTrust, mayGoLive, uploadAllowance, type Account, type SetInfo } from './permissions.js';
export { searchTextOf, searchTierSql, toTsQuery } from './searchText.js';
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
  hanachaSyncs,
  heardWords,
  recordingTranscript,
  remapper,
  transcriptHistory,
  transcriptPending,
  type HeardWord,
  type TranscriptChange,
  type TranscriptCommit,
  type TranscriptPending,
  type Timed,
  type TranscriptParagraph,
  type TranscriptView,
  type WordTiming,
} from './sync.js';
export { convertLegacyBodies, suggestWords, type WordsChange, type WordsInput } from './pageWords.js';
export { fromWikitext as readLegacyBody, legacyProfile, withStructuredBody } from './legacyWords.js';
export { comparePrintings, diffWords, pdfPagesOf, printingText, printingsOf, type DiffRun, type Printing } from './compare.js';
export { matchWords, wordKey, words, type Word } from './words.js';
export { CLAIM_HOURS, claimNext, focusCounts, projectTodo, releaseClaim, type ProjectItem } from './projectWork.js';
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
export { MAX_PLACES, forgetPlace, listPlaces, savePlace, type PlaceKind, type ReadingPlace } from './places.js';
export { MAX_TRANSLATION_PARAGRAPHS, TRANSLATION_LICENCES, addTranslation, fixTranslation, paragraphsOf, type NewTranslation } from './translations.js';
export {
  filePages,
  getFingerprint,
  itemsUsingFile,
  pageImageCount,
  pageImageCounts,
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
export { MAX_TOKENS_PER_PERSON, TOKEN_PREFIX, TOKEN_SCOPES, createApiToken, listApiTokens, looksLikeToken, revokeAllApiTokens, revokeApiToken, tokenGrant, type ApiTokenView, type TokenGrant, type TokenScope } from './tokens.js';
export { ACCESS_PREFIX, ACCESS_SECONDS, OAuthError, REFRESH_PREFIX, authenticateClient, authorizationRequest, canonicalResource, decideAuthorization, exchangeCode, getClient, isMetadataClientId, listConnections, oauthGrant, parseScopes, redirectMatches, redirectUriProblem, refreshTokens, registerClient, revokeConnection, revokeOAuthToken, startAuthorization, type AuthorizationView, type MetadataFetch, type OAuthClient, type TokenAnswer } from './oauth.js';
export { actingVia, currentVia, type Via } from './via.js';
export {
  COVER_ENCODER,
  COVER_SAMPLE_PAGES,
  COVER_THUMB_WIDTH,
  COVER_WIDTH,
  chooseTitlePage,
  COVERS_FETCH_PASS,
  coverFetchFailed,
  coverSources,
  coversOf,
  coversWanted,
  hebrewBooksPdfUrl,
  lookOfPage,
  pdfPageCount,
  pdfPageCounts,
  recordCover,
  titlePageScore,
  type CoverPicture,
  type CoverSource,
  type CoverToFetch,
  type CoverView,
  type CoverWanted,
  type GreyPage,
  type NewCover,
  type PageLook,
} from './covers.js';
export { linkedCounts, linkedOfEach, linkedPage, textsProgress, type LinkGroup } from './linked.js';
export { additionOf, additionsByKind, additionsOf, isOfficial, seferOf } from './additions.js';
export {
  HANACHA_TEXT_RIGHTS,
  MAX_HANACHA_PARAGRAPHS,
  addHanachaText,
  findDateIn,
  proposeNewMaterial,
  suggestDocument,
  suggestHanachaPdf,
  suggestRecording,
  type DocumentKind,
  type HanachaTextRights,
  type NewDocument,
  type NewEvent,
  type NewHanachaPdf,
  type NewHanachaText,
  type NewMaterialKind,
  type NewMaterialProposal,
  type NewRecording,
  type Place,
  type PlaceCandidate,
} from './contribute.js';
export { fileAbout, type FileAbout } from './fileInfo.js';
export {
  RESERVED_USERNAMES,
  USERNAME_CHANGE_HOURS,
  USERNAME_MAX,
  USERNAME_MIN,
  checkUsername,
  idsOfUsernames,
  personByUsername,
  searchPeople,
  setUsername,
  slugForUsername,
  suggestUsername,
  transliterate,
  usernameMessage,
  usernameShape,
  usernamesOf,
  type PersonByName,
  type PersonHit,
  type UsernameRefusal,
} from './usernames.js';
export { SYSTEM_ACCOUNT, followersOf, mayRead, noteWriting, notify, subscribe, threadByNumber, threadEvent, type NotificationReason, type Subject, type SubjectKind, type ThreadEventKind, type ThreadKind, type ThreadRef } from './threads.js';
export {
  commentOnSuggestion,
  editComment,
  editSuggestion,
  isSubscribed,
  listSuggestions,
  peopleOf,
  removeReviewRequest,
  requestReview,
  resolveComment,
  reviewSuggestion,
  suggestionLinks,
  suggestionTimeline,
  type PersonTag,
  type ReviewVerdict,
  type SuggestionListItem,
  type TimelineItem,
} from './conversation.js';
export {
  ISSUE_TYPES,
  commentOnIssue,
  createLabel,
  editIssue,
  getIssue,
  issueRights,
  listIssues,
  listLabels,
  openIssue,
  searchThreads,
  setIssueAssignees,
  setIssueLabels,
  setIssuePrivate,
  setIssueState,
  type Issue,
  type IssueFilters,
  type IssueLabel,
  type IssueRights,
} from './issues.js';
export { inbox, markRead, unreadCount, type InboxFilter, type InboxLine } from './inbox.js';
export { inboxHref, inboxText } from './notify.js';
export { profile, type Profile, type ProfileActivity } from './profiles.js';
export { SITEMAP_PAGE_SIZE, SITEMAP_TYPES, sitemapChunks, sitemapPage, type SitemapChunk, type SitemapEntry } from './sitemap.js';
export {
  MAX_ORGANIZE_ITEMS,
  MOVE_FIELDS,
  applyOrganize,
  catalogTree,
  keysBetween,
  nameOfData,
  previewOrganize,
  rekey,
  type OrganizeItem,
  type OrganizeOperation,
  type OrganizePlan,
  type OrganizePosition,
  type OrganizePreview,
  type OrganizeRef,
  type TreeNode,
} from './organize.js';
export { MACHINE_KINDS, MACHINE_REQUESTS_PER_DAY, checkMachineWork, finishMachineWork, machineRequest, machineRequests, machineSummary, notRecentlyFailedSql, releaseMachineRequests, requestMachineWork, settleMachineWork, SWEEP_RETRY_DAYS, takeMachineRequests, type MachineKind, type MachineRequest, type MachineRequestStatus } from './machineWork.js';
export { CLIP_MAX_SECONDS, HELD_OUT_AUDIO, TRAINING_GOAL, piecesOf, splitOf, summariseTraining, trainingClips, trainingGoal, type ClipQuality, type GoalFarbrengen, type TrainingClip, type TrainingGoal, type TrainingSkip, type TrainingSummary } from './trainingClips.js';
export { machineToCheck, type MachineToCheck, type PageToCheck, type ScanToCheck, type TranscriptToCheck } from './toCheck.js';
export { openTranscriptFixes, TRANSCRIPT_FIXES_MAX, type TranscriptFix, type TranscriptFixChange } from './transcriptFixes.js';
export { DAILY_WORKS, dailyLearning, dailyPathOf, dailyShiurim, shiurimWords, spansOf, tanyaStart, type DailyLearning, type DailyShiur, type DailyTanyaPart, type ShiurPart, type ShiurSection, type ShiurSpan } from './daily.js';
export { dailyRambam, type DailyRambam, type RambamShiur } from './rambam.js';
export { combineSuggestions } from './combine.js';
export { fillShaars, shaarFile, suggestShaar, type ShaarFile, type ShaarInput } from './shaar.js';
export { driveId, mafteach, placesOf, type Mafteach, type MafteachPlace, type MafteachTopic, type MafteachVolume } from './mafteach.js';
