from __future__ import annotations

from safari_rpa.contracts.errors import RpaError


def map_error_to_exit_code(error: RpaError) -> int:
    return 1


def map_error_to_response(error: RpaError) -> dict[str, object]:
    return {
        "ok": False,
        "error": {
            "code": error.code,
            "message": error.message,
            "kind": error.kind,
            "details": error.details or {},
        },
    }
