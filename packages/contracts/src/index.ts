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

export type DriveNodeKind =
  | "folder"
  | "file";

export type FileProcessingStatus =
  | "pending"
  | "ready"
  | "quarantined"
  | "failed";

export interface DriveFileMetadata {
  sizeBytes: string;
  mimeType: string;
  status: FileProcessingStatus;
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
