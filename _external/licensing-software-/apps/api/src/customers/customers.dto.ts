export interface CreateCustomerDto {
  name: string;
  /** Email for the customer's first login — becomes a real User with EnterpriseAdmin scope. */
  adminEmail: string;
  adminName: string;
}

export interface UpdateCustomerStatusDto {
  status: string;
}

export interface CreateCompanyDto {
  name: string;
}
