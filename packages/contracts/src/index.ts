export const SYSTEM_QUEUE_NAME = "picloud-system";

export const WORKER_HEARTBEAT_KEY = "picloud:worker:heartbeat";

export type UserRole = "owner" | "admin" | "member";

export interface AuthUser {
  id: string;
  email: string;
  displayName: string;
  role: UserRole;
  createdAt: string;
  lastLoginAt: string | null;
}

export interface AuthUserResponse {
  user: AuthUser;
}

export interface SetupStatusResponse {
  setupComplete: boolean;
}

export type DependencyState = "up" | "down";

export type ServiceState = "healthy" | "degraded";

export interface HealthDependency {
  state: DependencyState;
  latencyMs?: number | undefined;
  message?: string | undefined;
}

export interface PiCloudHealth {
  status: ServiceState;
  service: string;
  version: string;
  timestamp: string;
  uptimeSeconds: number;

  dependencies: {
    database: HealthDependency;
    queue: HealthDependency;
    storage: HealthDependency;
    worker: HealthDependency;
  };
}

export type DriveNodeKind = "folder" | "file";

export type FileProcessingStatus =
  "pending" | "ready" | "quarantined" | "failed";

export type FilePreviewStatus =
  "pending" | "processing" | "ready" | "unsupported" | "failed";

export type ExtractedFileMetadata = Record<
  string,
  string | number | boolean | null
>;

export interface DriveFileMetadata {
  sizeBytes: string;

  mimeType: string;

  status: FileProcessingStatus;

  previewStatus: FilePreviewStatus;

  hasPreview: boolean;

  previewError: string | null;

  metadata: ExtractedFileMetadata | null;
}

export interface DriveNode {
  id: string;
  parentId: string | null;
  kind: DriveNodeKind;
  name: string;
  isRoot: boolean;
  createdAt: string;
  updatedAt: string;
  file: DriveFileMetadata | null;
}

export interface DriveBreadcrumb {
  id: string;
  name: string;
  isRoot: boolean;
}

export interface DriveFolderView {
  folder: DriveNode;
  breadcrumbs: DriveBreadcrumb[];
  children: DriveNode[];
}

export interface DriveFolderOption {
  id: string;
  parentId: string | null;
  name: string;
  path: string;
  isRoot: boolean;
}

export interface DriveFolderOptionsResponse {
  folders: DriveFolderOption[];
}

export interface DriveNodeResponse {
  node: DriveNode;
}

export const FINALIZE_UPLOAD_JOB_NAME = "finalize-upload";

export interface FinalizeUploadJobData {
  uploadId: string;
}

export const PROCESS_FILE_JOB_NAME = "process-file";

export const MAINTENANCE_JOB_NAME = "maintenance";

export const MAINTENANCE_SCHEDULER_ID = "picloud-maintenance";

export interface ProcessFileJobData {
  nodeId: string;
}

export type UploadStatus =
  "created" | "uploading" | "processing" | "completed" | "failed" | "cancelled";

export interface UploadSessionView {
  id: string;
  nodeId: string;
  parentId: string;
  name: string;

  expectedSizeBytes: string;
  receivedSizeBytes: string;

  status: UploadStatus;

  errorMessage: string | null;

  createdAt: string;
  expiresAt: string;
  completedAt: string | null;

  chunkSizeBytes: number;
}

export interface UploadSessionResponse {
  upload: UploadSessionView;
}
