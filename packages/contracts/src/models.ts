import type { ProjectConfiguration } from './project-configuration.js';
export interface Entity { id:string; [key:string]:any }
export interface Project extends Entity { name:string;root:string;configurationRevisionId:string;createdAt:string }
export interface ConfigurationRevision extends Entity { projectId:string;manifest:ProjectConfiguration;hash:string;createdAt:string }
export interface Repository extends Entity { projectId:string;key:string;path:string;commonDir:string;mainPath:string }
export interface Workspace extends Entity { projectId:string;name:string;configurationRevisionId:string;createdAt:string;state:string;removedAt?:string }
export interface Checkout extends Entity { workspaceId:string;repositoryId:string;repositoryKey:string;path:string;ownership:'created'|'adopted'|'discovered';createdBranch:string|null;currentBranch:string|null;sourceRef:string|null;sourceCommit:string|null;originEvidence:'recorded'|'unknown'|'user-declared';createdAt:string|null;registeredAt:string }
export interface ServiceInstance extends Entity { workspaceId:string;state:string }
export interface RuntimeResource extends Entity { workspaceId:string;state:string }
export interface SetupReceipt extends Entity { workspaceId:string;state:string }
export interface Operation extends Entity { idempotencyKey:string;action:string;status:'queued'|'running'|'succeeded'|'partial'|'failed';createdAt:string;updatedAt:string;result?:any;error?:{code:string;message:string;details?:unknown};outcomes:any[] }
export interface DiscoveryReport extends Entity { root:string;repositories:any[];warnings:string[];truncated:boolean }
export interface DestroyPreview extends Entity { expiresAt:string;workspaceId:string;targets:any[];warnings:string[];retainedBranches:string[] }
export interface IntegrationPreview extends Entity { action:'connect'|'disconnect';changes:{path:string;before:string|null;after:string|null}[];conflicts:string[];expiresAt:string }
export type { ProjectConfiguration,SetupRecipe,ServiceProfile } from './project-configuration.js';
