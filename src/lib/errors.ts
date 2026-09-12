/**
 * Application errors.
 *
 * NotFoundError is deliberately the response for BOTH "this row does not
 * exist" and "this row belongs to another tenant". A 403 on a cross-tenant
 * read confirms the record exists, which is an information leak.
 */

export class AppError extends Error {
  readonly status: number
  readonly code: string
  constructor(message: string, code: string, status: number) {
    super(message)
    this.name = new.target.name
    this.code = code
    this.status = status
  }
}

export class NotFoundError extends AppError {
  constructor(message = 'Not found') {
    super(message, 'not_found', 404)
  }
}

/** Authenticated, but lacks the capability. Never used for cross-tenant access. */
export class ForbiddenError extends AppError {
  readonly capability: string | undefined
  constructor(capability?: string, message = 'You do not have permission to do that') {
    super(message, 'forbidden', 403)
    this.capability = capability
  }
}

export class UnauthenticatedError extends AppError {
  constructor(message = 'You must sign in to continue') {
    super(message, 'unauthenticated', 401)
  }
}

export class ValidationError extends AppError {
  readonly fieldErrors: Record<string, string[]>
  constructor(fieldErrors: Record<string, string[]>, message = 'Please check the form') {
    super(message, 'validation_failed', 422)
    this.fieldErrors = fieldErrors
  }
}

export class ConfigurationError extends AppError {
  constructor(message: string) {
    super(message, 'configuration_error', 500)
  }
}
