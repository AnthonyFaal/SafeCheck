from __future__ import annotations

from typing import Dict, List

from pydantic import BaseModel, ConfigDict, Field, field_validator


class InferenceRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    text: str = Field(
        ...,
        min_length=1,
        max_length=100_000,
        description="Raw text payload to analyze.",
    )

    @field_validator("text")
    @classmethod
    def normalize_text(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("text cannot be blank")
        return value


class BatchInferenceRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    texts: List[str] = Field(
        ...,
        min_length=1,
        max_length=128,
        description="Text payloads to analyze as a batch.",
    )

    @field_validator("texts")
    @classmethod
    def normalize_texts(cls, values: List[str]) -> List[str]:
        cleaned = [value.strip() for value in values]
        if any(not value for value in cleaned):
            raise ValueError("texts cannot contain blank values")
        return cleaned


class ExpertScores(BaseModel):
    semantic: float
    behavior: float
    character: float


class InferenceResponse(BaseModel):
    model_config = ConfigDict(extra="ignore")

    # Backward-compatible fields.
    decision: str = Field(..., description="HAM, REVIEW, or SCAM")
    probability: float = Field(..., ge=0.0, le=1.0)
    expert_scores: ExpertScores

    # Production diagnostics.
    text: str
    deobfuscated_text: str
    primary_probability: float = Field(..., ge=0.0, le=1.0)
    behavior_probability: float = Field(..., ge=0.0, le=1.0)
    character_probability: float = Field(..., ge=0.0, le=1.0)
    meta_probability: float = Field(..., ge=0.0, le=1.0)
    calibrated_probability: float = Field(..., ge=0.0, le=1.0)
    primary_probability_deobfuscated_shadow: float | None = Field(default=None, ge=0.0, le=1.0)
    behavior_probability_deobfuscated_shadow: float | None = Field(default=None, ge=0.0, le=1.0)
    ensemble_decision: str
    risk_signals: List[str] = Field(default_factory=list)
    defensive_warning: bool = False
    local_risk: bool = False
    obfuscation_applied: bool = False
    safety_override: bool = False
    override_reasons: List[str] = Field(default_factory=list)
    artifact_version: str
    latency_ms: float = Field(..., ge=0.0)


class BatchInferenceResponse(BaseModel):
    results: List[InferenceResponse]
    count: int = Field(..., ge=0)


class HealthResponse(BaseModel):
    status: str
    models_loaded: bool
    artifact_version: str
    device: str
    fp16: bool
    max_length: int
    low_threshold: float
    high_threshold: float
