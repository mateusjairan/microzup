import asyncio

import uvicorn

from app.core.compat import configure_event_loop
from app.main import app


def main() -> None:
    # psycopg async exige SelectorEventLoop no Windows. O uvicorn >= 0.36 cria
    # ProactorEventLoop direto via `loop_factory` e IGNORA a policy definida
    # por configure_event_loop() — com Proactor, toda conexão ao banco falha.
    # Por isso servimos o uvicorn.Server dentro de `asyncio.run`, que honra a
    # WindowsSelectorEventLoopPolicy. (Com `--reload` o próprio uvicorn usa
    # subprocess e escolhe Selector sozinho; este arquivo é o boot de produção
    # — inclusive do exe PyInstaller.)
    configure_event_loop()
    from app.config import get_settings

    settings = get_settings()
    config = uvicorn.Config(
        app,
        host=settings.host,
        port=settings.port,
        log_level=settings.log_level.lower(),
    )
    server = uvicorn.Server(config)
    asyncio.run(server.serve())


if __name__ == "__main__":
    main()
