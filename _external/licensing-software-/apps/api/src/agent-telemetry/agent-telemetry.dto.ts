import {
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  Min,
  ValidateNested,
  ValidationArguments,
  ValidationOptions,
  registerDecorator,
} from 'class-validator';
import { Type } from 'class-transformer';
import {
  ALLOWED_COMMAND_RESULTS,
  ALLOWED_COMMAND_TYPES,
} from './agent-telemetry.constants.js';

// ─── Custom Key & Count Validators ──────────────────────────────────────────

export function IsValidTierCounts(validationOptions?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      name: 'isValidTierCounts',
      target: object.constructor,
      propertyName: propertyName,
      options: validationOptions,
      validator: {
        validate(value: unknown) {
          if (value === null || value === undefined) return true;
          if (typeof value !== 'object' || Array.isArray(value)) return false;
          const entries = Object.entries(value as Record<string, unknown>);
          if (entries.length > 5) return false;
          for (const [, val] of entries) {
            if (typeof val !== 'number' || !Number.isInteger(val) || val < 0) return false;
          }
          return true;
        },
        defaultMessage(args: ValidationArguments) {
          return `${args.property} must be an object with at most 5 keys and non-negative integer counts`;
        },
      },
    });
  };
}

export function IsValidEntityTypeTotals(validationOptions?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      name: 'isValidEntityTypeTotals',
      target: object.constructor,
      propertyName: propertyName,
      options: validationOptions,
      validator: {
        validate(value: unknown) {
          if (value === null || value === undefined) return true;
          if (typeof value !== 'object' || Array.isArray(value)) return false;
          const entries = Object.entries(value as Record<string, unknown>);
          if (entries.length > 64) return false;
          const keyRegex = /^[A-Z0-9_]{2,40}$/;
          for (const [key, val] of entries) {
            if (!keyRegex.test(key)) return false;
            if (typeof val !== 'number' || !Number.isInteger(val) || val < 0) return false;
          }
          return true;
        },
        defaultMessage(args: ValidationArguments) {
          return `${args.property} must be an object with <= 64 keys matching ^[A-Z0-9_]{2,40}$ and non-negative integer counts`;
        },
      },
    });
  };
}

// ─── Ping DTO ───────────────────────────────────────────────────────────────

export class TelemetryPingDto {
  @IsDateString()
  clientTime!: string;

  @IsBoolean()
  serviceRunning!: boolean;

  @IsBoolean()
  watcherActive!: boolean;

  @IsOptional()
  @IsDateString()
  serviceStartedAt?: string | null;

  @IsOptional()
  @Matches(/^[a-f0-9]{12}$/i, { message: 'policyHash must be a 12-character hex string or null' })
  policyHash?: string | null;

  @IsString()
  @MaxLength(32)
  agentVersion!: string;

  @IsString()
  @MaxLength(32)
  applicationVersion!: string;

  @IsInt()
  @Min(0)
  outboxDepth!: number;
}

export interface TelemetryCommandResponseDto {
  id: string;
  type: string;
  issuedAt: string;
  expiresAt: string;
}

export interface TelemetryPingResponseDto {
  serverTime: string;
  installationStatus: string;
  telemetry: {
    enabled: boolean;
    intervalSeconds: number;
    syncFullPaths: boolean;
  };
  commands: TelemetryCommandResponseDto[];
}

// ─── Scan Summary DTO ───────────────────────────────────────────────────────

export class ScanFindingItemDto {
  @IsString()
  @MaxLength(512)
  pathRef!: string;

  @IsString()
  @MaxLength(64)
  tier!: string;

  @IsObject()
  entityTypeCounts!: Record<string, number>;

  @IsOptional()
  @IsIn(['APPLIED', 'PENDING', null])
  watermarkStatus?: string | null;
}

export class ScanSummaryDto {
  @IsUUID()
  clientScanId!: string;

  @IsIn(['directory_scan', 'full_system_scan'])
  scanSource!: 'directory_scan' | 'full_system_scan';

  @IsOptional()
  @IsString()
  @MaxLength(128)
  targetSummary?: string | null;

  @IsDateString()
  startedAt!: string;

  @IsOptional()
  @IsDateString()
  completedAt?: string | null;

  @IsIn(['completed', 'cancelled', 'failed'])
  status!: 'completed' | 'cancelled' | 'failed';

  @IsInt()
  @Min(0)
  durationSeconds!: number;

  @IsInt()
  @Min(0)
  filesScanned!: number;

  @IsInt()
  @Min(0)
  filesWithPii!: number;

  @IsInt()
  @Min(0)
  totalFindings!: number;

  @IsOptional()
  @IsIn(['Public', 'General', 'Confidential', 'Highly Confidential', 'Restricted', null])
  highestTier?: string | null;

  @IsOptional()
  @IsValidTierCounts()
  tierCounts?: Record<string, number>;

  @IsOptional()
  @IsValidEntityTypeTotals()
  entityTypeTotals?: Record<string, number>;

  @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => ScanFindingItemDto)
  files?: ScanFindingItemDto[];

  @IsBoolean()
  filesTruncated!: boolean;
}

// ─── Enforcement Summary DTO ────────────────────────────────────────────────

export class EnforcementWindowItemDto {
  @IsDateString()
  windowStart!: string;

  @IsDateString()
  windowEnd!: string;

  @IsIn(['Word', 'Excel', 'Filesystem Watcher'])
  source!: 'Word' | 'Excel' | 'Filesystem Watcher';

  @IsObject()
  actionCounts!: Record<string, number>;

  @IsObject()
  tierCounts!: Record<string, number>;

  @IsInt()
  @Min(0)
  overrideCount!: number;
}

export class EnforcementSummaryDto {
  @ValidateNested({ each: true })
  @Type(() => EnforcementWindowItemDto)
  windows!: EnforcementWindowItemDto[];
}

// ─── Command Ack DTO ────────────────────────────────────────────────────────

export class CommandAckDto {
  @IsUUID()
  commandId!: string;

  @IsIn(ALLOWED_COMMAND_RESULTS)
  result!: string;

  @IsOptional()
  @IsString()
  @MaxLength(2048)
  detail?: string | null;
}

// ─── Admin Command Issue DTO ────────────────────────────────────────────────

export class IssueCommandDto {
  @IsIn(ALLOWED_COMMAND_TYPES)
  commandType!: string;
}

// ─── Company Telemetry Settings DTO ─────────────────────────────────────────

export class UpdateTelemetrySettingsDto {
  @IsOptional()
  @IsBoolean()
  telemetryEnabled?: boolean;

  @IsOptional()
  @IsBoolean()
  syncFullPaths?: boolean;
}
