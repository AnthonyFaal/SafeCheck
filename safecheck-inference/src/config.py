from __future__ import annotations

import os
from pathlib import Path

from dotenv import load_dotenv
from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


PROJECT_ROOT = Path(__file__).resolve().parents[1]
load_dotenv(PROJECT_ROOT / ".env")


class Settings(BaseSettings):
    """Runtime configuration for the SafeCheck inference service."""

    model_config = SettingsConfigDict(
        env_file=str(PROJECT_ROOT / ".env"),
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    # The directory containing the COMPLETE trained artifact.
    MODEL_DIR: Path = Field(default=PROJECT_ROOT / "models" / "safecheck_10k_ensemble_v1")

    # Artifact/runtime limits.
    MAX_LENGTH: int = Field(default=256, ge=8, le=4096)
    TRANSFORMER_BATCH_SIZE: int = Field(default=16, ge=1, le=128)
    MAX_INPUT_CHARS: int = Field(default=5000, ge=1, le=100_000)
    MAX_BATCH_ITEMS: int = Field(default=32, ge=1, le=128)

    # Device. DEVICE=auto chooses CUDA when available, otherwise CPU.
    DEVICE: str = "auto"
    USE_FP16: bool = True

    # Production security.
    INFERENCE_API_KEY: str | None = None
    REQUIRE_API_KEY: bool = True

    # Optional diagnostics. Shadow scores never enter the calibrated stacker.
    ENABLE_DEOBFUSCATED_SHADOW_SCORES: bool = True

    # Safety-layer behavior.
    ENABLE_SAFETY_RULES: bool = True

    def resolved_device(self) -> str:
        value = self.DEVICE.strip().lower()
        if value in {"", "auto"}:
            try:
                import torch
                return "cuda" if torch.cuda.is_available() else "cpu"
            except Exception:
                return "cpu"
        return value

    def validate_security(self) -> None:
        if self.REQUIRE_API_KEY and not self.INFERENCE_API_KEY:
            raise RuntimeError(
                "INFERENCE_API_KEY must be configured when REQUIRE_API_KEY=true"
            )
        if self.MAX_INPUT_CHARS < self.MAX_LENGTH:
            # Not an error, but this generally indicates an accidental config mismatch.
            # Keep runtime usable; the transformer will still truncate to MAX_LENGTH tokens.
            pass


settings = Settings()
