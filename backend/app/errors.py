"""Errors as a laboratory user reads them.

Request validation errors keep FastAPI's shape ({"detail": [{"loc", "msg", "type"}]}, which the frontend
maps to fields), but each msg is plain language that names the value and what was expected, and the
echoed input and Pydantic internals are left out. An unexpected failure is logged in full, with its
traceback, and the user gets a short message with a reference to find that log entry.
"""
import logging
import uuid

from fastapi import FastAPI, Request
from fastapi.encoders import jsonable_encoder
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

logger = logging.getLogger("lacv")

# How long a value may be when quoted back to the user.
_MAX_QUOTED = 60

_DATE_HINT = "a date such as 2026-05-13 or 2026-05-13 14:30"


def friendly_message(error: dict) -> str:
    """One Pydantic error as a sentence fragment: what is wrong with the value and what was expected."""
    kind = error.get("type", "")
    context = error.get("ctx") or {}
    given = _quoted(error.get("input"))
    if kind == "missing":
        return "is required"
    if kind in ("int_parsing", "int_type", "int_from_float"):
        return f"must be a whole number{given}"
    if kind in ("decimal_parsing", "decimal_type", "float_parsing", "float_type", "finite_number"):
        return f"must be a number{given}"
    if kind in ("datetime_parsing", "datetime_from_date_parsing", "datetime_type", "date_parsing", "date_from_datetime_parsing", "date_type"):
        return f"must be {_DATE_HINT}{given}"
    if kind in ("bool_parsing", "bool_type"):
        return f"must be yes or no{given}"
    if kind == "string_type":
        # Blank text is tidied to None before a required field sees it.
        return "is required" if error.get("input") is None else f"must be text{given}"
    if kind == "string_too_short":
        return "cannot be blank" if context.get("min_length") == 1 else f"must be at least {context.get('min_length')} characters"
    if kind == "string_too_long":
        return f"must be at most {context.get('max_length')} characters"
    if kind == "string_pattern_mismatch":
        return f"is not in the expected format{given}"
    if kind == "greater_than_equal":
        return f"must be {context.get('ge')} or more{given}"
    if kind == "greater_than":
        return f"must be more than {context.get('gt')}{given}"
    if kind == "less_than_equal":
        return f"must be {context.get('le')} or less{given}"
    if kind == "less_than":
        return f"must be less than {context.get('lt')}{given}"
    if kind == "too_short":
        return f"needs at least {context.get('min_length')} entries"
    if kind == "too_long":
        return f"may have at most {context.get('max_length')} entries"
    if kind == "value_error":
        # Our own validators already write whole sentences.
        return str(context.get("error") or error.get("msg", "")).removeprefix("Value error, ")
    if kind in ("json_invalid",):
        return "The request could not be read"
    return error.get("msg", "is not valid")


def friendly_errors(errors) -> list[dict]:
    return [{"loc": list(error.get("loc", [])), "msg": friendly_message(error), "type": error.get("type", "value_error")} for error in errors]


def _quoted(value) -> str:
    if value is None or isinstance(value, (dict, list)):
        return ""
    text = str(value)
    if len(text) > _MAX_QUOTED:
        text = text[:_MAX_QUOTED] + "…"
    return f', not "{text}"'


def install_error_handlers(app: FastAPI) -> None:
    @app.exception_handler(RequestValidationError)
    async def readable_validation_error(request: Request, exc: RequestValidationError):
        logger.info("Validation failed for %s %s: %s", request.method, request.url.path, exc.errors())
        return JSONResponse(status_code=422, content=jsonable_encoder({"detail": friendly_errors(exc.errors())}))

    @app.exception_handler(Exception)
    async def unexpected_error(request: Request, exc: Exception):
        reference = uuid.uuid4().hex[:8]
        logger.exception("Unexpected error %s on %s %s", reference, request.method, request.url.path)
        return JSONResponse(status_code=500, content={
            "detail": f"Something went wrong on the server and nothing was saved. Try again; if it keeps happening, tell the LACV administrator (reference {reference}).",
            "reference": reference,
        })
