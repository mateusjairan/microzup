from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)


def create_engine(
    database_url: str,
    *,
    statement_timeout_ms: int | None = None,
    idle_in_transaction_session_timeout_ms: int | None = None,
) -> AsyncEngine:
    # Timeouts por conexão (plano §8): statement evita queries presas,
    # idle-in-transaction devolve conexões de casos de uso que travaram.
    options: list[str] = []
    if statement_timeout_ms is not None:
        options.append(f"-c statement_timeout={statement_timeout_ms}")
    if idle_in_transaction_session_timeout_ms is not None:
        options.append(
            f"-c idle_in_transaction_session_timeout={idle_in_transaction_session_timeout_ms}"
        )
    connect_args: dict[str, object] = {}
    if options:
        connect_args["options"] = " ".join(options)

    return create_async_engine(
        database_url,
        pool_pre_ping=True,
        pool_size=10,
        max_overflow=20,
        pool_recycle=1800,
        connect_args=connect_args,
    )


def create_session_factory(engine: AsyncEngine) -> async_sessionmaker[AsyncSession]:
    return async_sessionmaker(engine, expire_on_commit=False)
