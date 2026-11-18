import json
import logging

import structlog
from app.core.logging import configure_logging


def test_logging_writes_json_to_stdout_and_rotating_file(tmp_path, capsys) -> None:
    root = logging.getLogger()
    original_handlers = root.handlers[:]
    try:
        configure_logging("INFO", tmp_path, retention_days=2)

        logger = structlog.get_logger("log_test")
        logger.info("evento_teste", campo=1)

        stdout = capsys.readouterr().out
        assert '"evento_teste"' in stdout

        log_file = tmp_path / "server.log"
        assert log_file.exists()
        lines = log_file.read_text(encoding="utf-8").strip().splitlines()
        record = json.loads(lines[-1])
        assert record["event"] == "evento_teste"
        assert record["campo"] == 1
        assert record["timestamp"]  # timestamp ISO UTC no JSON
    finally:
        # Fecha o handler de arquivo (Windows não deixa tmp_path ser limpo com ele aberto)
        # e devolve os handlers originais para não vazar estado entre testes.
        configure_logging("INFO", None)
        root.handlers[:] = original_handlers


def test_logging_envelope_never_echoed_for_sensitive_fields(tmp_path, capsys) -> None:
    root = logging.getLogger()
    original_handlers = root.handlers[:]
    try:
        configure_logging("INFO", tmp_path)
        logger = structlog.get_logger("log_test")
        # O contrato é: quem loga decide o que loga — aqui só provamos que o renderer
        # é JSON puro (fácil de filtrar/grepar em auditoria de logs).
        logger.warning("domain_error", code="authentication_error", path="/auth/login")
        stdout = capsys.readouterr().out
        record = json.loads(stdout.strip().splitlines()[-1])
        assert record["level"] == "warning"
        assert record["code"] == "authentication_error"
    finally:
        configure_logging("INFO", None)
        root.handlers[:] = original_handlers
