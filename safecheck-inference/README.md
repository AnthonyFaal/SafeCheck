# Scam & Spam Multi-Expert Classification Microservice

Production API serving an ensemble of transformer models (Primary & Behavior DeBERTa), character-level n-gram SGD classifiers, and a calibrated Logistic Regression stacker.

## Directory Structure
```
scam-detector-prod/
├── .github/workflows/ci-cd.yml
├── src/
│   ├── __init__.py
│   ├── api.py
│   ├── config.py
│   ├── inference.py
│   └── schemas.py
├── tests/
│   ├── __init__.py
│   └── test_inference.py
├── models/
│   ├── primary_deberta/
│   ├── behavior_deberta/
│   ├── character_expert/
│   └── ensemble_meta_calibrator.joblib
├── Dockerfile
├── requirements.txt
├── run.sh
└── README.md
```

## Local Setup
1. Copy model artifacts into the `models/` directory according to `models/README.md`.
2. Make script executable and run:
   ```bash
   chmod +x run.sh
   ./run.sh
   ```

## Docker Deployment
```bash
docker build -t scam-detector:v3 .
docker run -p 8000:8000 -e USE_CUDA=0 scam-detector:v3
```

## Service security

The service is internal-only. Set `INFERENCE_API_KEY` and send it in the `X-Inference-Key` header; the SafeCheck API does this automatically. `/health` returns 503 until every model artifact is loaded, allowing an orchestrator to avoid sending traffic to an unready instance.

## API Endpoint
`POST /v1/predict`

Request Body:
```json
{
  "text": "URGENT: Your account password has expired. Click here to reset immediately."
}
```

Response:
```json
{
  "decision": "SCAM",
  "probability": 0.9642,
  "expert_scores": {
    "semantic": 0.9410,
    "behavior": 0.9820,
    "character": 0.8950
  }
}
```
