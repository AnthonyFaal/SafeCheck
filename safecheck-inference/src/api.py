from __future__ import annotations

import hmac
import logging
from contextlib import asynccontextmanager
from typing import Any

from fastapi import FastAPI, Header, HTTPException, status

from .config import settings
from .inference import InferenceEngine
from .schemas import (
    BatchInferenceRequest,
    BatchInferenceResponse,
    HealthResponse,
    InferenceRequest,
    InferenceResponse,
)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
LOGGER = logging.getLogger("safecheck.api")

engine: InferenceEngine | None = None


@asynccontextmanager
async def lifespan(_: FastAPI):
    global engine

    settings.validate_security()
    LOGGER.info("Initializing SafeCheck production inference engine...")

    engine = InferenceEngine(
        model_dir=settings.MODEL_DIR,
        device=settings.resolved_device(),
        max_length=settings.MAX_LENGTH,
        batch_size=settings.TRANSFORMER_BATCH_SIZE,
        use_fp16=settings.USE_FP16,
        thread_safe=True,
    )

    LOGGER.info("SafeCheck models loaded successfully: %s", engine.health())
    yield

    LOGGER.info("Releasing SafeCheck models...")
    engine = None


app = FastAPI(
    title="SafeCheck Scam Detection API",
    version="4.0.0",
    description=(
        "Production inference service for the SafeCheck multi-expert ensemble. "
        "The saved calibrated ensemble contract is authoritative; deterministic "
        "de-obfuscation and safety rules operate as a separate decision layer."
    ),
    lifespan=lifespan,
)


def _require_engine() -> InferenceEngine:
    if engine is None:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Inference engine is not initialized",
        )
    return engine


def _authorize(x_inference_key: str | None) -> None:
    if not settings.REQUIRE_API_KEY:
        return
    expected = settings.INFERENCE_API_KEY
    if not expected:
        # Should already fail during startup, but keep the endpoint defensive.
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Inference API key is not configured",
        )
    if not x_inference_key or not hmac.compare_digest(x_inference_key, expected):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid inference credentials",
        )


@app.get("/health", response_model=HealthResponse)
@app.get("/healthz", response_model=HealthResponse)
def health_check() -> dict[str, Any]:
    return _require_engine().health()


@app.post("/v1/predict", response_model=InferenceResponse)
def predict(
    request: InferenceRequest,
    x_inference_key: str | None = Header(default=None),
) -> dict[str, Any]:
    _authorize(x_inference_key)
    try:
        return _require_engine().predict(request.text)
    except HTTPException:
        raise
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except Exception as exc:
        LOGGER.exception("Inference failure")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Internal classification failure",
        ) from exc


@app.post("/v1/predict/batch", response_model=BatchInferenceResponse)
def predict_batch(
    request: BatchInferenceRequest,
    x_inference_key: str | None = Header(default=None),
) -> dict[str, Any]:
    _authorize(x_inference_key)
    try:
        results = _require_engine().predict_batch(request.texts)
        return {"results": results, "count": len(results)}
    except HTTPException:
        raise
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except Exception as exc:
        LOGGER.exception("Batch inference failure")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Internal batch classification failure",
        ) from exc
