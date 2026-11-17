import os

from app.core.compat import configure_event_loop

# Garante que nenhum teste toque no banco de desenvolvimento.
os.environ.setdefault("APP_ENV", "test")

configure_event_loop()
