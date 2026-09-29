import { IsBoolean, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

export class UpdateCloudConnectorConfigDto {
  @IsString()
  tenantId: string;

  @IsString()
  clientId: string;

  @IsOptional()
  @IsString()
  clientSecret?: string;

  @IsOptional()
  @IsString()
  certificateThumbprint?: string;

  @IsOptional()
  @IsBoolean()
  adminConsentGranted?: boolean;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(60)
  pollIntervalMinutes?: number;

  @IsOptional()
  @IsBoolean()
  dryRunMode?: boolean;

  @IsOptional()
  @IsString()
  quarantineLibraryName?: string;
}
