class DomainError(Exception):
    """Erro de regra de negócio; a borda HTTP traduz para o status adequado."""

    code = "domain_error"


class ValidationError(DomainError):
    code = "validation_error"


class ConflictError(DomainError):
    code = "conflict"


class NotFoundError(DomainError):
    code = "not_found"


class AccessDeniedError(DomainError):
    code = "access_denied"


class SectorAlreadyExists(ConflictError):
    code = "sector_already_exists"


class AuthenticationError(DomainError):
    code = "authentication_error"


class InvalidTokenError(DomainError):
    code = "invalid_token"


class InactiveUserError(DomainError):
    code = "inactive_user"


class UserAlreadyExists(ConflictError):
    code = "user_already_exists"


class RateLimitedError(DomainError):
    code = "rate_limited"


class TooManyAttemptsError(DomainError):
    code = "too_many_attempts"
