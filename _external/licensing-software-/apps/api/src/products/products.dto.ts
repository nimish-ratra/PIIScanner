export interface CreateProductDto {
  name: string;
  description?: string;
}

export interface UpdateProductDto {
  name?: string;
  description?: string;
  status?: string;
}
