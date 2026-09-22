export interface CreateEditionDto {
  name: string;
  description?: string;
}

export interface UpdateEditionDto {
  name?: string;
  description?: string;
  status?: string;
}
