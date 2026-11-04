from src.inference import InferenceEngine
from src.schemas import InferenceRequest


def test_deobfuscation_preserves_words():
    value = InferenceEngine.deobfuscate_text(
        "P.a.y a.c.t.i.v.a.t.i.o.n f.e.e to release"
    )
    assert value == "Pay activation fee to release"


def test_zero_width_cleanup():
    value = InferenceEngine.deobfuscate_text("do\u200b not share OTP")
    assert value == "do not share OTP"


def test_request_validation_strips_text():
    assert InferenceRequest(text="  hello  ").text == "hello"
