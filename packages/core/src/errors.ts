export type CatalogErrorCode = 'not-found' | 'forbidden' | 'invalid' | 'state' | 'conflict';

/** An error a person can act on; the API turns `code` into an HTTP status. */
export class CatalogError extends Error {
  constructor(
    readonly code: CatalogErrorCode,
    message: string,
    readonly detail?: unknown,
  ) {
    super(message);
    this.name = 'CatalogError';
  }
}

export const notFound = (what: string) => new CatalogError('not-found', `${what} not found`);
export const forbidden = (why: string) => new CatalogError('forbidden', why);
export const invalid = (why: string, detail?: unknown) => new CatalogError('invalid', why, detail);
export const badState = (why: string) => new CatalogError('state', why);
