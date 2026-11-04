# Private model artifacts

The trained SafeCheck model bundle is distributed separately and is intentionally not stored in Git. Obtain a reviewed bundle through the project's authorized artifact channel and keep its version/provenance information with the bundle.

For the Docker Compose setup, put the bundle's required files directly in this directory so that the inference container sees them under `/app/models`. The runtime expects the following paths:

```text
models/
├── primary_deberta/
│   ├── config.json
│   └── model weights and tokenizer files
├── behavior_deberta/
│   ├── config.json
│   └── model weights and tokenizer files
├── character_expert.joblib
├── ensemble_meta_calibrator.joblib
├── ensemble_meta_feature_names.json
├── model_contract.json
└── decision_policy.json
```

Additional files may be required by the specific approved bundle. Follow that bundle's manifest and validate it with the inference service tests before deployment.

The repository `.gitignore` excludes all files in this directory except this README. Do not remove the ignore rule or force-add model weights, training data, evaluation examples, or generated artifacts to Git.
