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
