export interface CreateEntitlementDto {
  enterpriseId: string;
  productId: string;
  editionId?: string;
  quantity: number;
  startDate: string;
  endDate: string;
}

export interface UpdateEntitlementStatusDto {
  status: string;
}

export interface ExtendEntitlementDto {
  endDate: string;
}

export interface UpdateEntitlementQuantityDto {
  quantity: number;
}
