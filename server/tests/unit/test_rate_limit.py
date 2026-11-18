from app.application.rate_limit import apply_rate_limit, rate_limited
from app.domain.exceptions import RateLimitedError, TooManyAttemptsError
from app.infrastructure.rate_limit import InMemoryRateLimiter, LoginAttemptTracker


class FakeClock:
    def __init__(self) -> None:
        self.now = 1000.0

    def __call__(self) -> float:
        return self.now

    def advance(self, seconds: float) -> None:
        self.now += seconds


async def _execute_noop(cmd) -> str:
    return "ok"


class _Cmd:
    def __init__(self, user: str) -> None:
        self.user = user


async def test_in_memory_limiter_sliding_window() -> None:
    clock = FakeClock()
    limiter = InMemoryRateLimiter(clock)

    assert limiter.allow("k", 3, 60.0) is True
    assert limiter.allow("k", 3, 60.0) is True
    assert limiter.allow("k", 3, 60.0) is True
    assert limiter.allow("k", 3, 60.0) is False  # limite atingido

    clock.advance(61.0)  # janela deslizou
    assert limiter.allow("k", 3, 60.0) is True


async def test_rate_limited_decorator_blocks_after_limit() -> None:
    limiter = InMemoryRateLimiter(FakeClock())
    wrapped = rate_limited(
        limiter, scope="msg", limit=2, window_seconds=60.0, key=lambda cmd: cmd.user
    )(_execute_noop)

    assert await wrapped(_Cmd("ana")) == "ok"
    assert await wrapped(_Cmd("ana")) == "ok"
    try:
        await wrapped(_Cmd("ana"))
        raise AssertionError("devia ter bloqueado")
    except RateLimitedError:
        pass
    # Chaves distintas não interferem entre si.
    assert await wrapped(_Cmd("bruno")) == "ok"


async def test_apply_rate_limit_wraps_use_case_execute() -> None:
    class UseCase:
        async def execute(self, cmd: _Cmd) -> str:
            return f"done:{cmd.user}"

    limiter = InMemoryRateLimiter(FakeClock())
    use_case = UseCase()
    apply_rate_limit(
        use_case,
        limiter,
        scope="upload",
        limit=1,
        window_seconds=60.0,
        key=lambda cmd: cmd.user,
    )

    assert await use_case.execute(_Cmd("ana")) == "done:ana"
    try:
        await use_case.execute(_Cmd("ana"))
        raise AssertionError("devia ter bloqueado")
    except RateLimitedError:
        pass


def test_login_tracker_blocks_after_max_attempts_and_releases_by_time() -> None:
    clock = FakeClock()
    tracker = LoginAttemptTracker(max_attempts=5, base_lockout_seconds=300.0, clock=clock)
    key = "10.0.0.1|ana.souza"

    for _ in range(5):
        tracker.register_failure(key)

    assert tracker.blocked_for(key) > 0
    # Liberação por tempo: espera a janela passar.
    clock.advance(301.0)
    assert tracker.blocked_for(key) == 0.0

    # Sucesso zera o histórico da chave.
    tracker.register_failure(key)
    tracker.register_success(key)
    tracker.register_failure(key)
    assert tracker.blocked_for(key) == 0.0


def test_login_tracker_lockout_is_progressive() -> None:
    clock = FakeClock()
    tracker = LoginAttemptTracker(max_attempts=5, base_lockout_seconds=300.0, clock=clock)
    key = "10.0.0.1|bruno.lima"

    for _ in range(5):
        tracker.register_failure(key)
    first_lockout = tracker.blocked_for(key)
    clock.advance(301.0)

    for _ in range(5):
        tracker.register_failure(key)
    second_lockout = tracker.blocked_for(key)

    # Progressivo: o segundo bloqueio dura o dobro do primeiro.
    assert second_lockout > first_lockout


def test_login_tracker_other_keys_unaffected() -> None:
    clock = FakeClock()
    tracker = LoginAttemptTracker(max_attempts=5, base_lockout_seconds=300.0, clock=clock)

    for _ in range(5):
        tracker.register_failure("10.0.0.1|ana.souza")

    assert tracker.blocked_for("10.0.0.2|ana.souza") == 0.0
    assert tracker.blocked_for("10.0.0.1|bruno.lima") == 0.0


async def test_too_many_attempts_error_is_domain_error() -> None:
    assert TooManyAttemptsError.code == "too_many_attempts"
    assert RateLimitedError.code == "rate_limited"
