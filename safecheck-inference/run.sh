#!/usr/bin/env bash
set -e

echo "=== Starting Scam Detector API locally ==="
if [ ! -d "venv" ]; then
    echo "Creating virtual environment..."
    python3 -m venv venv
fi

source venv/bin/activate
pip install --upgrade pip
pip install -r requirements.txt

export MODEL_DIR="./models"
export USE_CUDA=0

uvicorn src.api:app --host 0.0.0.0 --port 8000 --reload
