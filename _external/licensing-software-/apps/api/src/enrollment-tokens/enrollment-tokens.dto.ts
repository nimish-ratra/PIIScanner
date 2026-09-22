export interface CreateEnrollmentTokenDto {
  allocationId: string;
  label?: string;
  maxActivations?: number;
  expiresInDays?: number;
}

export interface BulkCreateEnrollmentTokenDto {
  allocationId: string;
  /** Number of individual single-use tokens to mint — one per seat/device, unlike the
   * shared multi-activation token the single-create endpoint can produce. */
  quantity: number;
  label?: string;
  expiresInDays?: number;
}
