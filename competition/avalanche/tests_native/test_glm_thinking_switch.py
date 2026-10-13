"""Provider wire regression tests; no network and no change to the Agent Loop."""
from copy import deepcopy

import pytest

from nerya.core.errors import LLMError
from nerya.llm.messages import MessagesRequest, OpenAIMessagesBackend
from nerya.llm.adapters.openai import OpenAIAdapter, _verified_glm_thinking_switch


class Transport:
    def __init__(self):
        self.bodies = []

    def post_json_with_headers(self, url, *, headers, body, timeout):
        self.bodies.append(deepcopy(body))
        return 200, {"choices": [{"message": {"content": "就绪"}, "finish_reason": "stop"}],
                     "usage": {"prompt_tokens": 1, "completion_tokens": 1}}, {}


@pytest.mark.parametrize("effort,expected", [("off", "disabled"), ("none", "disabled"),
                                               ("low", "enabled"), ("high", "enabled")])
def test_official_glm_messages_preserves_explicit_thinking_intent(effort, expected):
    transport = Transport()
    backend = OpenAIMessagesBackend(api_key="fixture", model="glm-5.1", provider_name="zhipu",
                                   base_url="https://open.bigmodel.cn/api/coding/paas/v4", transport=transport)
    response = backend(MessagesRequest(system="fixture", messages=[{"role": "user", "content": "就绪"}],
                                       reasoning_effort=effort))
    assert response.text() == "就绪"
    assert transport.bodies[0]["thinking"] == {"type": expected}
    assert "reasoning_effort" not in transport.bodies[0]


def test_inherit_does_not_force_a_thinking_switch():
    transport = Transport()
    backend = OpenAIMessagesBackend(api_key="fixture", model="glm-5.1", provider_name="zhipu",
                                   base_url="https://api.z.ai/api/paas/v4", transport=transport)
    backend(MessagesRequest(system="fixture", messages=[{"role": "user", "content": "就绪"}]))
    assert "thinking" not in transport.bodies[0]


@pytest.mark.parametrize("url,model", [("https://compat.invalid/v1", "glm-5.1"),
                                      ("http://open.bigmodel.cn/v1", "glm-5.1"),
                                      ("https://open.bigmodel.cn.invalid/v1", "glm-5.1"),
                                      ("https://api.z.ai/api/paas/v4", "glm-future-unverified")])
def test_unverified_models_and_endpoints_do_not_inherit_the_exception(url, model):
    assert not _verified_glm_thinking_switch(base_url=url, model=model)
    transport = Transport()
    with pytest.raises(LLMError, match="reasoning_off_unsupported"):
        OpenAIMessagesBackend(api_key="fixture", model=model, provider_name="custom-test",
                              base_url=url, transport=transport)(MessagesRequest(
            system="fixture", messages=[{"role": "user", "content": "就绪"}], reasoning_effort="off"))
    assert not transport.bodies


def test_legacy_json_adapter_uses_the_same_documented_switch():
    transport = Transport()
    OpenAIAdapter(transport=transport, base_url="https://open.bigmodel.cn/api/coding/paas/v4")(
        tier="high", task="fixture", model="glm-5.1", prompt="就绪", schema=None,
        api_key="fixture", provider_name="zhipu", reasoning_effort="off")
    assert transport.bodies[0]["thinking"] == {"type": "disabled"}
