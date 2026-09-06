# -*- coding: utf-8 -*-
"""OpenAI 兼容 LLM 适配器。

代聊天等所有需要 LLM 的调用统一从这里走。
由 user_config.json 的 llm 配置段决定供应商：
- provider='openai'：走任意 OpenAI 兼容接口（base_url / api_key / model 在 llm 段配置）
- provider='ollama'：回退本地 ollama（core.py 旧逻辑）
"""
import json
import os
import re

from config import Config

try:
    from openai import OpenAI
except ImportError:
    OpenAI = None

_client = None


def _api_key() -> str:
    """API Key 优先取配置文件 llm.api_key，其次取 llm.api_key_env 指定的环境变量。"""
    llm = Config.llm
    key = str(llm.get('api_key') or '')
    if not key:
        env_name = str(llm.get('api_key_env') or '')
        if env_name:
            key = os.getenv(env_name, '')
    return key


def is_available() -> bool:
    """openai 供应商是否可用（库已装 + base_url 已配 + key 已配）。"""
    return OpenAI is not None and bool(Config.llm.get('base_url')) and bool(_api_key())


def _get_client():
    global _client
    if _client is None:
        _client = OpenAI(
            base_url=Config.llm['base_url'],
            api_key=_api_key(),
            timeout=float(Config.llm.get('timeout', 120)),
            max_retries=1,
        )
    return _client


def chat_completion(messages, temperature: float = 0.6, json_hint: str = None) -> str:
    """单轮/多轮对话补全。messages: [{'role': ..., 'content': ...}]"""
    model = str(Config.llm.get('model') or 'auto')
    msgs = list(messages)
    if json_hint:
        msgs.append({
            'role': 'system',
            'content': '你只能输出一个 JSON 对象，不要输出 markdown 代码块或任何其他文字。JSON 格式: ' + json_hint,
        })
    resp = _get_client().chat.completions.create(
        model=model,
        messages=msgs,
        temperature=temperature,
        stream=False,
    )
    return (resp.choices[0].message.content or '').strip()


def chat_json(messages, temperature: float = 0.2, json_hint: str = None) -> dict:
    """要求 LLM 输出 JSON 并稳健解析（容忍代码块包裹、前后缀废话）。"""
    content = chat_completion(messages, temperature=temperature, json_hint=json_hint)
    return parse_json_object(content)


def parse_json_object(content: str) -> dict:
    text = (content or '').strip()
    fence = re.search(r'```(?:json)?\s*(.*?)```', text, re.S)
    if fence:
        text = fence.group(1).strip()
    brace = re.search(r'\{.*\}', text, re.S)
    if brace:
        text = brace.group(0)
    return json.loads(text)
