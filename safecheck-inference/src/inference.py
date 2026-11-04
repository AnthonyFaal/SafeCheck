from __future__ import annotations

import hashlib
import json
import logging
import re
import threading
import time
from pathlib import Path
from typing import Any, Sequence

import numpy as np

from .config import settings

LOGGER = logging.getLogger("safecheck.inference")

EXPECTED_META_FEATURES = [
    "sem_logit",
    "beh_logit",
    "char_logit",
    "sem_beh_gap",
    "sem_char_gap",
    "beh_char_gap",
    "max_gap",
    "min_probability",
    "max_probability",
]

HIGH_RISK_RULES: dict[str, tuple[str, ...]] = {
    "OTP_REQUEST": (
        r"\b(?:send|share|give|tell|forward|provide)\b.{0,80}\b(?:otp|one[- ]?time password|verification code|security code|authorization code|auth code|6[- ]?digit code|six digits?)\b",
        r"\b(?:otp|verification code|security code|authorization code)\b.{0,80}\b(?:send|share|give|tell|forward|provide)\b",
    ),
    "PIN_REQUEST": (
        r"\b(?:send|share|give|tell|provide)\b.{0,60}\b(?:pin|momo pin|mobile money pin|passcode)\b",
        r"\b(?:pin|momo pin|mobile money pin|passcode)\b.{0,60}\b(?:send|share|give|tell|provide)\b",
    ),
    "PASSWORD_REQUEST": (
        r"\b(?:send|share|give|tell|provide)\b.{0,80}\b(?:password|login details|login credentials)\b",
        r"\b(?:password|login credentials|login details)\b.{0,80}\b(?:send|share|give|tell|provide)\b",
    ),
    "MONEY_REDIRECTION": (
        r"\b(?:sent|send|transfer|transferred|paid|pay)\b.{0,120}\b(?:mistake|accidentally|wrong number|wrong account)\b",
        r"\b(?:send|transfer|return|pay)\b.{0,100}\b(?:another|different|new|this)\b.{0,60}\b(?:number|account)\b",
        r"\b(?:wrongly sent|sent by mistake)\b.{0,80}\b(?:send|transfer|return|pay|back)\b",
    ),
    "UPFRONT_FEE": (
        r"\b(?:pay|send|transfer)\b.{0,100}\b(?:fee|charge|deposit|activation|clearance|processing fee|release fee|registration fee)\b",
        r"\b(?:activation fee|processing fee|release fee|clearance fee|registration fee)\b",
    ),
    "REFUND_REDIRECTION": (
        r"\b(?:refund|reimbursement|cashback|settlement)\b.{0,120}\b(?:send|transfer|pay)\b",
    ),
    "THIRD_PARTY_VERIFICATION": (
        r"\b(?:verify|confirm|validate|complete)\b.{0,100}\b(?:for me|on my behalf|for you)\b.{0,100}\b(?:code|otp|pin|password)\b",
    ),
}

DEFENSIVE_WARNING_PATTERNS: tuple[str, ...] = (
    r"\b(?:never|do not|don'?t|will not|won'?t)\s+(?:share|give|tell|disclose|send)\b",
    r"\b(?:bank|official|support|staff|agent)\s+will\s+never\s+ask\b",
    r"\b(?:fraud|scam|security|safety)\s+(?:warning|alert|notice)\b",
    r"\bdo\s+not\s+(?:reply|click|pay)\b",
)

LOCAL_HIGH_RISK_PATTERNS: tuple[str, ...] = (
    r"\b(?:tuma|send|pay)\b.{0,60}\b(?:kwa\s+namba|to\s+this\s+number|momo|m-pesa|airtel)\b",
    r"\b(?:wrongly\s+sent|sent\s+by\s+mistake)\b.{0,80}\b(?:tuma|send|return|back)\b",
)


def _text(value: Any) -> str:
    return "" if value is None else str(value)


def _safe_probability(value: float) -> float:
    value = float(value)
    if not np.isfinite(value):
        raise ValueError("Non-finite probability encountered")
    return float(np.clip(value, 0.0, 1.0))


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as fh:
        for chunk in iter(lambda: fh.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


class InferenceEngine:
    """Production runtime for the SafeCheck 10K ensemble artifact.

    The calibrated stacker follows the notebook contract exactly:
      raw primary probability + raw behavior probability + raw character probability
      -> exact 9 meta-features -> saved meta-calibrator -> saved thresholds.

    De-obfuscation and deterministic safety rules are deliberately outside the
    calibrated stacker. They may change the final safety decision, but never the
    saved calibrated probability.
    """

    def __init__(
        self,
        model_dir: str | Path | None = None,
        *,
        device: str | None = None,
        max_length: int | None = None,
        batch_size: int | None = None,
        use_fp16: bool | None = None,
        thread_safe: bool = True,
    ) -> None:
        self.model_dir = Path(model_dir or settings.MODEL_DIR).expanduser().resolve()
        self.max_length = int(max_length or settings.MAX_LENGTH)
        self.batch_size = int(batch_size or settings.TRANSFORMER_BATCH_SIZE)
        self.thread_safe = thread_safe
        self._lock = threading.RLock()

        import torch
        self._torch = torch

        requested_device = (device or settings.resolved_device()).lower()
        if requested_device.startswith("cuda") and not torch.cuda.is_available():
            LOGGER.warning("CUDA requested but unavailable; falling back to CPU")
            requested_device = "cpu"
        self.device = torch.device(requested_device)

        self.use_fp16 = bool(
            settings.USE_FP16 if use_fp16 is None else use_fp16
        ) and self.device.type == "cuda"
        self.dtype = self._torch.float16 if self.use_fp16 else self._torch.float32

        self._validate_artifact()
        self.contract = self._read_json("model_contract.json")
        self.policy = self._read_json("decision_policy.json")
        self.feature_contract = self._read_json("ensemble_meta_feature_names.json")

        self.artifact_version = str(self.contract.get("artifact_version", "unknown"))
        self.low_threshold = float(self.policy["low_threshold"])
        self.high_threshold = float(self.policy["high_threshold"])
        self._validate_contract()

        self._load_models()
        self._compile_rules()

        LOGGER.info(
            "SafeCheck initialized: version=%s device=%s fp16=%s low=%.6f high=%.6f",
            self.artifact_version,
            self.device,
            self.use_fp16,
            self.low_threshold,
            self.high_threshold,
        )

    # ------------------------------------------------------------------
    # Artifact lifecycle
    # ------------------------------------------------------------------

    def _read_json(self, filename: str) -> dict[str, Any]:
        path = self.model_dir / filename
        try:
            return json.loads(path.read_text(encoding="utf-8"))
        except json.JSONDecodeError as exc:
            raise RuntimeError(f"Invalid JSON artifact: {path}") from exc

    def _validate_artifact(self) -> None:
        required = [
            self.model_dir / "primary_deberta" / "config.json",
            self.model_dir / "behavior_deberta" / "config.json",
            self.model_dir / "character_expert.joblib",
            self.model_dir / "ensemble_meta_calibrator.joblib",
            self.model_dir / "ensemble_meta_feature_names.json",
            self.model_dir / "decision_policy.json",
            self.model_dir / "model_contract.json",
        ]
        missing = [str(path) for path in required if not path.exists()]
        if missing:
            raise FileNotFoundError(
                "Incomplete SafeCheck production artifact:\n" + "\n".join(missing)
            )

        for name in ("primary_deberta", "behavior_deberta"):
            directory = self.model_dir / name
            if not list(directory.glob("*.safetensors")) and not list(directory.glob("pytorch_model*.bin")):
                raise FileNotFoundError(f"No model weights found in {directory}")
            if not (directory / "tokenizer.json").exists() and not (directory / "tokenizer_config.json").exists():
                raise FileNotFoundError(f"No tokenizer files found in {directory}")

    def _validate_contract(self) -> None:
        if not 0.0 <= self.low_threshold < self.high_threshold <= 1.0:
            raise ValueError("Invalid low/high thresholds in decision_policy.json")

        features = self.feature_contract.get("features")
        n_features = self.feature_contract.get("n_features")
        if n_features != 9 or features != EXPECTED_META_FEATURES:
            raise ValueError(
                "Saved meta-feature contract does not match runtime. "
                f"Expected {EXPECTED_META_FEATURES}, received {features}"
            )

        contract_experts = self.contract.get("experts", {})
        if contract_experts.get("primary") != "primary_deberta":
            raise ValueError("model_contract.json primary expert mismatch")
        if contract_experts.get("behavior") != "behavior_deberta":
            raise ValueError("model_contract.json behavior expert mismatch")
        if contract_experts.get("character") != "character_expert.joblib":
            raise ValueError("model_contract.json character expert mismatch")
        if self.contract.get("meta_model") != "ensemble_meta_calibrator.joblib":
            raise ValueError("model_contract.json meta model mismatch")

    def _load_transformer(self, directory: Path) -> tuple[Any, Any]:
        from transformers import AutoModelForSequenceClassification, AutoTokenizer

        tokenizer = AutoTokenizer.from_pretrained(
            str(directory),
            use_fast=True,
            local_files_only=True,
        )

        # Transformers versions differ on the preferred keyword. Try the modern
        # dtype first, then fall back to torch_dtype for older installations.
        model_kwargs: dict[str, Any] = {
            "local_files_only": True,
            "num_labels": 2,
        }
        try:
            model = AutoModelForSequenceClassification.from_pretrained(
                str(directory),
                dtype=self.dtype,
                **model_kwargs,
            )
        except TypeError:
            model = AutoModelForSequenceClassification.from_pretrained(
                str(directory),
                torch_dtype=self.dtype,
                **model_kwargs,
            )

        if getattr(model.config, "num_labels", 2) != 2:
            raise ValueError(f"Expected binary classifier: {directory}")

        model = model.to(self.device)
        model.eval()
        return tokenizer, model

    def _load_models(self) -> None:
        self.primary_tokenizer, self.primary_model = self._load_transformer(
            self.model_dir / "primary_deberta"
        )
        self.behavior_tokenizer, self.behavior_model = self._load_transformer(
            self.model_dir / "behavior_deberta"
        )
        import joblib
        self.character_model = joblib.load(self.model_dir / "character_expert.joblib")
        self.meta_model = joblib.load(self.model_dir / "ensemble_meta_calibrator.joblib")

        if not hasattr(self.character_model, "predict_proba"):
            raise TypeError("character_expert.joblib must implement predict_proba")
        if not hasattr(self.meta_model, "predict_proba"):
            raise TypeError("ensemble_meta_calibrator.joblib must implement predict_proba")

    def _compile_rules(self) -> None:
        flags = re.IGNORECASE | re.DOTALL
        self.compiled_high_risk = {
            name: tuple(re.compile(pattern, flags) for pattern in patterns)
            for name, patterns in HIGH_RISK_RULES.items()
        }
        self.compiled_defensive = tuple(
            re.compile(pattern, flags) for pattern in DEFENSIVE_WARNING_PATTERNS
        )
        self.compiled_local = tuple(
            re.compile(pattern, flags) for pattern in LOCAL_HIGH_RISK_PATTERNS
        )

    # ------------------------------------------------------------------
    # Text normalization / safety layer
    # ------------------------------------------------------------------

    @staticmethod
    def deobfuscate_text(text: str) -> str:
        """Normalize common character-level evasion without swallowing spaces."""
        value = _text(text).replace("\u200b", " ").replace("\ufeff", " ")

        # P.a.y / a-c-t-i-v-a-t-i-o-n / P*a*y -> Pay / activation / Pay.
        dotted_letters = re.compile(
            r"(?<![A-Za-z])([A-Za-z](?:(?:[.\-_:=#*])[A-Za-z])+)(?![A-Za-z])"
        )
        value = dotted_letters.sub(
            lambda match: re.sub(r"[.\-_:=#*]", "", match.group(1)),
            value,
        )

        # P a y -> Pay. Require >=3 letters to avoid merging normal short prose.
        spaced_letters = re.compile(r"(?<!\w)(?:[A-Za-z](?:\s+[A-Za-z]){2,})(?!\w)")
        value = spaced_letters.sub(
            lambda match: re.sub(r"\s+", "", match.group(0)),
            value,
        )
        return re.sub(r"\s+", " ", value).strip()

    def _rule_context(self, raw: str, clean: str) -> dict[str, Any]:
        signals: set[str] = set()
        for name, patterns in self.compiled_high_risk.items():
            if any(pattern.search(raw) or pattern.search(clean) for pattern in patterns):
                signals.add(name)

        defensive = any(
            pattern.search(raw) or pattern.search(clean)
            for pattern in self.compiled_defensive
        )
        local = any(
            pattern.search(raw) or pattern.search(clean)
            for pattern in self.compiled_local
        )
        return {
            "risk_signals": sorted(signals),
            "defensive_warning": defensive,
            "local_risk": local,
            "obfuscation_applied": raw != clean,
        }

    # ------------------------------------------------------------------
    # Ensemble mathematics — MUST match training notebook
    # ------------------------------------------------------------------

    @staticmethod
    def _safe_logit(values: np.ndarray, eps: float = 1e-6) -> np.ndarray:
        values = np.asarray(values, dtype=np.float64)
        if not np.isfinite(values).all():
            raise ValueError("Probability vector contains NaN/Inf")
        values = np.clip(values, eps, 1.0 - eps)
        return np.log(values / (1.0 - values))

    def _meta_features(
        self,
        p_sem: np.ndarray,
        p_beh: np.ndarray,
        p_char: np.ndarray,
    ) -> np.ndarray:
        p_sem = np.asarray(p_sem, dtype=np.float64)
        p_beh = np.asarray(p_beh, dtype=np.float64)
        p_char = np.asarray(p_char, dtype=np.float64)

        sem_beh_gap = np.abs(p_sem - p_beh)
        sem_char_gap = np.abs(p_sem - p_char)
        beh_char_gap = np.abs(p_beh - p_char)
        max_gap = np.maximum.reduce([sem_beh_gap, sem_char_gap, beh_char_gap])
        min_prob = np.minimum.reduce([p_sem, p_beh, p_char])
        max_prob = np.maximum.reduce([p_sem, p_beh, p_char])

        features = np.column_stack(
            [
                self._safe_logit(p_sem),
                self._safe_logit(p_beh),
                self._safe_logit(p_char),
                sem_beh_gap,
                sem_char_gap,
                beh_char_gap,
                max_gap,
                min_prob,
                max_prob,
            ]
        )
        if features.shape[1] != 9 or not np.isfinite(features).all():
            raise ValueError("Invalid ensemble meta-feature matrix")
        return features

    def _score_transformer(
    self,
    model: Any,
    tokenizer: Any,
    texts: Sequence[str],
    ) -> np.ndarray:
        outputs: list[np.ndarray] = []

        for start in range(0, len(texts), self.batch_size):
            batch = list(texts[start : start + self.batch_size])

            encoded = tokenizer(
                batch,
                truncation=True,
                max_length=self.max_length,
                padding=True,
                return_tensors="pt",
            )

            encoded = {
                key: value.to(self.device)
                for key, value in encoded.items()
            }

            with self._torch.inference_mode():
                logits = model(**encoded).logits.float()

            if logits.ndim != 2 or logits.shape[1] != 2:
                raise ValueError(
                    "Transformer returned invalid binary logits"
                )

            # Exact probability definition used by the training notebook.
            margin = self._torch.clamp(
                logits[:, 1] - logits[:, 0],
                -50.0,
                50.0,
            )

            probabilities = (
                self._torch.sigmoid(margin)
                .cpu()
                .numpy()
                .astype(np.float64)
            )

            outputs.append(probabilities)

        return (
            np.concatenate(outputs)
            if outputs
            else np.empty(0, dtype=np.float64)
        ) 

    def _character_prob(self, texts: Sequence[str]) -> np.ndarray:
        probabilities = np.asarray(
            self.character_model.predict_proba(list(texts)), dtype=np.float64
        )
        if probabilities.ndim != 2 or probabilities.shape[1] < 2:
            raise ValueError("Character expert returned invalid probabilities")
        return np.clip(probabilities[:, 1], 0.0, 1.0)

    # ------------------------------------------------------------------
    # Final deterministic decision policy
    # ------------------------------------------------------------------

    def _ensemble_decision(self, probability: float) -> str:
        if probability >= self.high_threshold:
            return "SCAM"
        if probability >= self.low_threshold:
            return "REVIEW"
        return "HAM"

    def _apply_safety_policy(
        self,
        probability: float,
        context: dict[str, Any],
    ) -> tuple[str, bool, list[str]]:
        decision = self._ensemble_decision(probability)
        reasons: list[str] = []
        overridden = False

        if not settings.ENABLE_SAFETY_RULES:
            return decision, False, reasons

        # Risk signals never make the model's outcome safer.
        if decision == "HAM" and context["risk_signals"]:
            decision = "REVIEW"
            overridden = True
            reasons.append("high_risk_signal")

        # A defensive warning is explicitly allowed to lower a REVIEW to HAM.
        if context["defensive_warning"] and decision == "REVIEW":
            decision = "HAM"
            overridden = True
            reasons.append("defensive_warning")

        # Localized transfer/redirection pattern should not be silently HAM.
        if context["local_risk"] and decision == "HAM":
            decision = "REVIEW"
            overridden = True
            reasons.append("local_high_risk_pattern")

        return decision, overridden, reasons

    # ------------------------------------------------------------------
    # Public inference API
    # ------------------------------------------------------------------

    def _predict_unlocked(self, texts: Sequence[Any]) -> list[dict[str, Any]]:
        raw_texts = [_text(value).strip() for value in texts]
        if not raw_texts or any(not value for value in raw_texts):
            raise ValueError("Inference input cannot be empty")
        if any(len(value) > settings.MAX_INPUT_CHARS for value in raw_texts):
            raise ValueError(
                f"Input exceeds MAX_INPUT_CHARS={settings.MAX_INPUT_CHARS}"
            )

        start = time.perf_counter()
        clean_texts = [self.deobfuscate_text(text) for text in raw_texts]
        has_clean_variant = any(raw != clean for raw, clean in zip(raw_texts, clean_texts))

        # IMPORTANT: ONLY RAW scores feed the saved calibrator.
        primary_probability = self._score_transformer(
            self.primary_model, self.primary_tokenizer, raw_texts
        )
        behavior_probability = self._score_transformer(
            self.behavior_model, self.behavior_tokenizer, raw_texts
        )
        character_probability = self._character_prob(raw_texts)

        X_meta = self._meta_features(
            primary_probability,
            behavior_probability,
            character_probability,
        )
        calibrated_probability = np.asarray(
            self.meta_model.predict_proba(X_meta), dtype=np.float64
        )[:, 1]
        calibrated_probability = np.clip(calibrated_probability, 0.0, 1.0)
        if not np.isfinite(calibrated_probability).all():
            raise ValueError("Meta-calibrator returned NaN/Inf")

        # Shadow scores are diagnostics only and are never placed in X_meta.
        if settings.ENABLE_DEOBFUSCATED_SHADOW_SCORES and has_clean_variant:
            primary_shadow = self._score_transformer(
                self.primary_model, self.primary_tokenizer, clean_texts
            )
            behavior_shadow = self._score_transformer(
                self.behavior_model, self.behavior_tokenizer, clean_texts
            )
        else:
            primary_shadow = primary_probability.copy()
            behavior_shadow = behavior_probability.copy()

        total_ms = (time.perf_counter() - start) * 1000.0
        latency_ms = total_ms / len(raw_texts)

        results: list[dict[str, Any]] = []
        for index, raw in enumerate(raw_texts):
            clean = clean_texts[index]
            context = self._rule_context(raw, clean)
            probability = _safe_probability(calibrated_probability[index])
            ensemble_decision = self._ensemble_decision(probability)
            decision, safety_override, reasons = self._apply_safety_policy(
                probability, context
            )

            results.append(
                {
                    "decision": decision,
                    "probability": probability,
                    "expert_scores": {
                        "semantic": _safe_probability(primary_probability[index]),
                        "behavior": _safe_probability(behavior_probability[index]),
                        "character": _safe_probability(character_probability[index]),
                    },
                    "text": raw,
                    "deobfuscated_text": clean,
                    "primary_probability": _safe_probability(primary_probability[index]),
                    "behavior_probability": _safe_probability(behavior_probability[index]),
                    "character_probability": _safe_probability(character_probability[index]),
                    "meta_probability": probability,
                    "calibrated_probability": probability,
                    "primary_probability_deobfuscated_shadow": _safe_probability(primary_shadow[index]) if has_clean_variant else None,
                    "behavior_probability_deobfuscated_shadow": _safe_probability(behavior_shadow[index]) if has_clean_variant else None,
                    "ensemble_decision": ensemble_decision,
                    "risk_signals": context["risk_signals"],
                    "defensive_warning": bool(context["defensive_warning"]),
                    "local_risk": bool(context["local_risk"]),
                    "obfuscation_applied": bool(context["obfuscation_applied"]),
                    "safety_override": safety_override,
                    "override_reasons": reasons,
                    "artifact_version": self.artifact_version,
                    "latency_ms": round(latency_ms, 3),
                }
            )
        return results

    def predict(self, text: str) -> dict[str, Any]:
        return self.predict_single(text)

    def predict_single(self, text: str) -> dict[str, Any]:
        results = self.predict_batch([text])
        return results[0]

    def predict_batch(self, texts: Sequence[Any]) -> list[dict[str, Any]]:
        if len(texts) > settings.MAX_BATCH_ITEMS:
            raise ValueError(
                f"Batch exceeds MAX_BATCH_ITEMS={settings.MAX_BATCH_ITEMS}"
            )
        if self.thread_safe:
            with self._lock:
                return self._predict_unlocked(texts)
        return self._predict_unlocked(texts)

    def health(self) -> dict[str, Any]:
        return {
            "status": "ok",
            "models_loaded": all(
                value is not None
                for value in (
                    getattr(self, "primary_model", None),
                    getattr(self, "behavior_model", None),
                    getattr(self, "character_model", None),
                    getattr(self, "meta_model", None),
                )
            ),
            "artifact_version": self.artifact_version,
            "device": str(self.device),
            "fp16": self.use_fp16,
            "max_length": self.max_length,
            "low_threshold": self.low_threshold,
            "high_threshold": self.high_threshold,
        }

    def verify_hashes(self) -> None:
        expected = self.contract.get("sha256", {})
        if not expected:
            raise ValueError("No sha256 manifest present in model_contract.json")
        for relative_path, expected_digest in expected.items():
            actual = _sha256(self.model_dir / relative_path)
            if actual.lower() != str(expected_digest).lower():
                raise ValueError(f"SHA-256 mismatch for {relative_path}")
