export const CLIENT_ECONOMY_MUTATION_DISABLED = 'CLIENT_ECONOMY_MUTATION_DISABLED';

export class EconomyAuthorityError extends Error {
  constructor(operation, message) {
    super(
      message ||
        `${operation} is unavailable because balances and ledger entries are controlled by the Blyp economy service.`
    );
    this.name = 'EconomyAuthorityError';
    this.code = CLIENT_ECONOMY_MUTATION_DISABLED;
    this.operation = operation;
  }
}

export function rejectClientEconomyMutation(operation, message) {
  return Promise.reject(new EconomyAuthorityError(operation, message));
}

export function isClientEconomyMutationDisabled(error) {
  return error?.code === CLIENT_ECONOMY_MUTATION_DISABLED;
}
