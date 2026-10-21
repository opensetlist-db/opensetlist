// Server-side entry point of the shared admin image upload contract
// used by the admin series-logo, event-logo and album-cover routes.
// Browser code imports `./client` directly — this
// barrel pulls in sharp, Prisma and the R2 signer.

export * from "./errors";
export * from "./limits";
export { parseAttemptId, buildObjectKey, type TargetSegment } from "./keys";
export { validateImage, sniffImageFormat, type ValidatedImage } from "./validate";
export {
  getImageStorage,
  readR2Config,
  R2ImageStorage,
  type ImageStorage,
  type R2Config,
} from "./storage";
export {
  eventLogoTarget,
  seriesLogoTarget,
  albumCoverTarget,
  writeLogoAssignment,
  readLogoAssignment,
  writeAlbumImageUrl,
  readAlbumImageUrl,
  conflictFor,
  parseExpectedLogo,
  parseExpectedAlbumCover,
  type TargetAdapter,
  type LogoAssignment,
  type LogoNext,
  type AlbumCoverAssignment,
} from "./targets";
export {
  uploadAndAssign,
  parseProvenance,
  type UploadRequest,
  type UploadResult,
  type UploadedAsset,
  type Provenance,
} from "./service";
export {
  handleImageUpload,
  uploadErrorResponse,
  verifySameOrigin,
  parseTargetId,
  type UploadTargetSpec,
} from "./http";
export { writeAssignment, type AssignmentDb } from "./assignmentWrite";
