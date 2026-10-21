// Server-side entry point of the shared admin image upload contract
// (redesign ticket 08). Consumers: admin series logo (09), event logo
// (10), album cover (11). Browser code imports `./client` directly — this
// barrel pulls in sharp, Prisma and the R2 signer.

export * from "./errors";
export * from "./limits";
export { parseAttemptId, buildObjectKey, type TargetSegment } from "./keys";
export { validateImage, sniffImageFormat, type ValidatedImage } from "./validate";
export {
  getImageStorage,
  readR2Config,
  R2ImageStorage,
  MemoryImageStorage,
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
