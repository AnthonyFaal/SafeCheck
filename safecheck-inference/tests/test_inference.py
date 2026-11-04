import numpy as np # pyright: ignore[reportMissingImports]

def test_safe_logit_bounds():
    from src.inference import InferenceEngine
    # Test logit bounds handling extreme 0.0 and 1.0 without inf/nan
    engine = object.__new__(InferenceEngine)
    
    l_zero = engine._safe_logit(0.0)
    l_one = engine._safe_logit(1.0)
    
    assert not np.isnan(l_zero)
    assert not np.isinf(l_zero)
    assert not np.isnan(l_one)
    assert not np.isinf(l_one)
    assert l_zero < 0
    assert l_one > 0

def test_schema_validation():
    from src.schemas import InferenceRequest, InferenceResponse
    
    req = InferenceRequest(text="Urgent: Claim your $1000 gift card now!")
    assert req.text == "Urgent: Claim your $1000 gift card now!"
    
    res = InferenceResponse(
        decision="SCAM",
        probability=0.92,
        expert_scores={"semantic": 0.88, "behavior": 0.95, "character": 0.91}
    )
    assert res.decision == "SCAM"
    assert res.probability == 0.92
