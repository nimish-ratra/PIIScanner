export interface CreateFeatureDto {
  name: string;
  key: string;
  description?: string;
}

export interface UpdateFeatureDto {
  name?: string;
  key?: string;
  description?: string;
  status?: string;
}
