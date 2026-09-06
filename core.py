try:
    from ollama import chat, Message
except ImportError:
    chat = None
    Message = None
from prompts import INTRODUCE, TAGS, CHARACTER, CHAT, INTERSET, NEEDRESUME, NEEDWORKS
from config import Config
from tools import getLLMReply
from schema import InterestValue, NeedResume, NeedWorks
import llm
import json
import re


# 默认参数
options = {
    "temperature": 0.6,
    "num_ctx": 10240
}


LEGACY_OLLAMA_REQUIRED_MESSAGE = '当前接口依赖 LLM：openai 兼容接口未配置或不可用，且未安装 ollama；主链评分/固定招呼/直接发简历不受影响'


def __use_openai() -> bool:
    """是否走 OpenAI 兼容接口（base_url / api_key / model 在 user_config.json 的 llm 段配置）。"""
    return Config.llm.get('provider') == 'openai' and llm.is_available()


def __to_dicts(msgs) -> list:
    """把 pydantic Msg / ollama Message / dict 统一转成 OpenAI 消息 dict 列表。"""
    out = []
    for m in msgs:
        if isinstance(m, dict):
            role, content = m.get('role', 'user'), m.get('content', '')
        else:
            role, content = getattr(m, 'role', 'user'), getattr(m, 'content', '')
        if hasattr(role, 'value'):
            role = role.value
        out.append({'role': str(role), 'content': str(content)})
    return out


def isOllamaAvailable() -> bool:
    return chat is not None and Message is not None


def __ensure_ollama_available():
    if not isOllamaAvailable():
        raise RuntimeError(LEGACY_OLLAMA_REQUIRED_MESSAGE)


def __streamChat(sys_prompt: str, prompt: str, options: dict = options, model: str = Config.think_model) -> str:
    """自定义的流式回复"""
    if __use_openai():
        content = llm.chat_completion([
            {'role': 'system', 'content': sys_prompt},
            {'role': 'user', 'content': prompt},
        ], temperature=options.get('temperature', 0.6))
        print(content, flush=True)
        return getLLMReply(content)
    __ensure_ollama_available()
    content = ''
    for i in chat(model, [
        Message(role='system', content=sys_prompt),
        Message(role='user', content=prompt)
    ], stream=True, options=options):
        word = i.message.content
        content += word
        print(word, end="", flush=True)
    print()
    return getLLMReply(content)


def getIntroduce(resume: str):
    """生成自我介绍"""
    return __streamChat(INTRODUCE, resume)


def getTags(resume: str):
    """获取匹配标签"""
    return __streamChat(TAGS, resume).split(' ')


def getCharacter(resume: str):
    """获取性格特点"""
    return __streamChat(CHARACTER, resume)


def __extract_job_fields(job: str) -> tuple[str, str]:
    """从脚本上传的文本中提取岗位名称和职位描述。"""
    sections = [section.strip() for section in re.split(r'\n\s*\n', job) if section.strip()]
    title = ''
    detail = job.strip()
    if sections:
        title_lines = sections[0].splitlines()
        if len(title_lines) > 1:
            title = '\n'.join(title_lines[1:]).strip()
    if len(sections) >= 3:
        detail_lines = sections[2].splitlines()
        if len(detail_lines) > 1:
            detail = '\n'.join(detail_lines[1:]).strip()
    return title, detail


def __normalize_text(text: str) -> str:
    return text.lower()


def __find_matches(text: str, keyword_scores: dict[str, int]) -> list[tuple[str, int]]:
    normalized = __normalize_text(text)
    matches = []
    for keyword, score in keyword_scores.items():
        if keyword.lower() in normalized:
            matches.append((keyword, score))
    return matches


def __collect_positive_matches(title: str, detail: str) -> list[str]:
    """计数模式：跨标题+职位描述收集命中的正向匹配词（岗位标题词 + 技能匹配词），按关键词去重。"""
    full_text = f"{title}\n{detail}"
    tables = [
        Config.title_strong_keywords,
        Config.title_medium_keywords,
        Config.detail_infra_keywords,
        Config.detail_support_keywords,
    ]
    seen = set()
    matched: list[str] = []
    for table in tables:
        for keyword, _score in __find_matches(full_text, table):
            key = keyword.lower()
            if key not in seen:
                seen.add(key)
                matched.append(keyword)
    return matched


def evaluateJobMatch(job: str):
    """返回岗位匹配明细，便于日志排查。"""
    title, detail = __extract_job_fields(job)
    title_block_matches = __find_matches(title, Config.title_block_keywords)
    if title_block_matches:
        return {
            'title': title,
            'detail': detail,
            'matched_field': 'title_negative',
            'keyword': title_block_matches[0][0],
            'score': 0,
            'blocked': True,
            'matched_count': 0,
            'matched_keywords': [],
            'match_count_threshold': int(getattr(Config, 'match_count_threshold', 4)),
            'title_score': 0,
            'detail_score': 0,
            'penalty_score': 0,
            'title_penalty_score': 0,
            'combo_score': 0,
            'final_score': 0,
            'title_match_level': 'negative',
            'title_matches': [keyword for keyword, _ in title_block_matches],
            'title_penalty_matches': [],
            'detail_infra_matches': [],
            'detail_support_matches': [],
            'detail_negative_matches': [],
            'reason': '岗位名称命中强负向关键词',
        }

    # 标题必需关键词硬门槛：标题必须包含指定关键词之一（如 数据开发/数据分析/agent/模型开发），否则不投
    title_required = getattr(Config, 'title_required_keywords', None) or []
    if title_required:
        title_norm = __normalize_text(title)
        if not any(str(kw).lower() in title_norm for kw in title_required):
            return {
                'title': title,
                'detail': detail,
                'matched_field': 'title_required_miss',
                'keyword': None,
                'score': 0,
                'blocked': True,
                'matched_count': 0,
                'matched_keywords': [],
                'match_count_threshold': int(getattr(Config, 'match_count_threshold', 4)),
                'title_score': 0,
                'detail_score': 0,
                'penalty_score': 0,
                'title_penalty_score': 0,
                'combo_score': 0,
                'final_score': 0,
                'title_match_level': 'title_required_miss',
                'title_matches': [],
                'title_penalty_matches': [],
                'detail_infra_matches': [],
                'detail_support_matches': [],
                'detail_negative_matches': [],
                'reason': '岗位标题未包含必需关键词（' + '、'.join(title_required) + '），不投',
            }

    # 计数模式（默认）：不算权重，只要命中的匹配词数量 ≥ 阈值就投递
    if getattr(Config, 'score_mode', 'count') == 'count':
        matched_keywords = __collect_positive_matches(title, detail)
        matched_count = len(matched_keywords)
        threshold = int(getattr(Config, 'match_count_threshold', 4))
        deliver = matched_count >= threshold
        final_score = 100 if deliver else 0
        if deliver:
            reason = f'命中 {matched_count} 个匹配词（≥{threshold}）：' + '、'.join(matched_keywords[:15])
        else:
            reason = f'仅命中 {matched_count} 个匹配词（<{threshold}），不投'
        return {
            'title': title,
            'detail': detail,
            'matched_field': 'count' if deliver else 'none',
            'keyword': matched_keywords[0] if matched_keywords else None,
            'score': final_score,
            'blocked': False,
            'matched_count': matched_count,
            'matched_keywords': matched_keywords,
            'match_count_threshold': threshold,
            'title_score': 0,
            'detail_score': 0,
            'penalty_score': 0,
            'title_penalty_score': 0,
            'combo_score': 0,
            'final_score': final_score,
            'title_match_level': 'count' if deliver else 'none',
            'title_matches': [],
            'title_penalty_matches': [],
            'detail_infra_matches': [],
            'detail_support_matches': [],
            'detail_negative_matches': [],
            'reason': reason,
        }

    title_strong_matches = __find_matches(title, Config.title_strong_keywords)
    title_medium_matches = __find_matches(title, Config.title_medium_keywords)
    title_match_level = 'none'
    title_keyword = None
    title_score = 0
    title_matches: list[str] = []

    if title_strong_matches:
        title_keyword, title_score = max(title_strong_matches, key=lambda item: item[1])
        title_match_level = 'strong'
        title_matches = [keyword for keyword, _ in title_strong_matches]
    elif title_medium_matches:
        title_keyword, title_score = max(title_medium_matches, key=lambda item: item[1])
        title_match_level = 'medium'
        title_matches = [keyword for keyword, _ in title_medium_matches]

    title_penalty_matches = __find_matches(title, Config.title_penalty_keywords)
    detail_infra_matches = __find_matches(detail, Config.detail_infra_keywords)
    detail_support_matches = __find_matches(detail, Config.detail_support_keywords)
    detail_negative_matches = __find_matches(detail, Config.detail_negative_keywords)

    detail_infra_score = min(sum(score for _, score in detail_infra_matches), 24)
    detail_support_score = min(sum(score for _, score in detail_support_matches), 12)
    detail_score = detail_infra_score + detail_support_score
    title_penalty_score = min(sum(score for _, score in title_penalty_matches), 45)
    penalty_score = min(sum(score for _, score in detail_negative_matches), 36)

    combo_score = 0
    infra_keywords = {keyword for keyword, _ in detail_infra_matches}
    detail_match_count = len(detail_infra_matches) + len(detail_support_matches)
    title_normalized = __normalize_text(title)

    if title_match_level == 'strong' and len(detail_infra_matches) >= 2:
        combo_score += 10
    if title_match_level == 'medium' and detail_match_count >= 3:
        combo_score += 10
    if ('devops' in title_normalized or 'sre' in title_normalized) and infra_keywords.intersection({'k8s', 'kubernetes', 'docker', 'prometheus'}):
        combo_score += 10

    raw_score = title_score + detail_score + combo_score - title_penalty_score - penalty_score
    if title_match_level == 'none':
        raw_score = min(raw_score, 55)
    final_score = max(0, min(100, raw_score))

    if title_match_level in ['strong', 'medium']:
        matched_field = 'title'
        keyword = title_keyword
        if title_penalty_matches:
            reason = '岗位名称命中正向关键词，但带有弱负向词扣分'
        else:
            reason = '岗位名称命中正向关键词'
    elif detail_infra_matches or detail_support_matches:
        matched_field = 'detail'
        keyword = (detail_infra_matches + detail_support_matches)[0][0]
        reason = '仅职位描述命中，已按标题缺失封顶'
    else:
        matched_field = 'none'
        keyword = None
        reason = '未命中有效关键词'

    return {
        'title': title,
        'detail': detail,
        'matched_field': matched_field,
        'keyword': keyword,
        'score': final_score,
        'blocked': False,
        'title_score': title_score,
        'detail_score': detail_score,
        'penalty_score': penalty_score,
        'title_penalty_score': title_penalty_score,
        'combo_score': combo_score,
        'final_score': final_score,
        'title_match_level': title_match_level,
        'title_matches': title_matches,
        'title_penalty_matches': [keyword for keyword, _ in title_penalty_matches],
        'detail_infra_matches': [keyword for keyword, _ in detail_infra_matches],
        'detail_support_matches': [keyword for keyword, _ in detail_support_matches],
        'detail_negative_matches': [keyword for keyword, _ in detail_negative_matches],
        'reason': reason,
    }


def evaluateSingleRouteDelivery(job: str):
    match_result = evaluateJobMatch(job)
    return {
        **match_result,
        'introduce': Config.introduce,
        'resumeIndex': Config.frontend.get('resumeIndex', 0),
    }


def calcJobScore(job: str, resume: str):
    """计算职位匹配度"""
    return evaluateJobMatch(job)['score']


def __calcInterestValue(msgs: list):
    """计算兴趣值"""
    if __use_openai():
        dicts = [{'role': 'system', 'content': INTERSET}] + __to_dicts(msgs)
        data = llm.chat_json(dicts, temperature=0.2, json_hint='{"value": true 或 false}')
        return bool(data.get('value'))
    __ensure_ollama_available()
    msgs.insert(0, Message(role='system', content=INTERSET))
    return json.loads(chat(Config.chat_model, msgs, format=InterestValue.model_json_schema(), options={
        "temperature": 0.2,
        "num_ctx": 10240,
    }).message.content)['value']


def replyMsg(msgs: list, resume: str, character: str):
    if __use_openai():
        # 计算兴趣值
        interest = __calcInterestValue(list(msgs))
        if not interest:
            return ''
        # 获取回复
        dicts = [{'role': 'system', 'content': CHAT.format(resume=resume, character=character)}] + __to_dicts(msgs)
        content = llm.chat_completion(dicts, temperature=0.4)
        print(content, flush=True)
        return getLLMReply(content)
    __ensure_ollama_available()
    # 计算兴趣值
    interest = __calcInterestValue(list(msgs))
    if not interest:
        return ''
    # 获取回复
    content = ''
    msgs.insert(0, Message(role='system', content=CHAT.format(
        resume=resume,
        character=character
    )))
    for i in chat(Config.chat_model, messages=msgs, stream=True, options={
        "temperature": 0.4,
        "num_ctx": 10240,
    }):
        word = i.message.content
        content += word
        print(word, end="", flush=True)
    print()
    return getLLMReply(content)


def isNeedResume(msgs: list):
    """判断是否需要简历"""
    if __use_openai():
        dicts = [{'role': 'system', 'content': NEEDRESUME}] + __to_dicts(msgs)
        data = llm.chat_json(dicts, temperature=0.2, json_hint='{"need": true 或 false}')
        return bool(data.get('need'))
    __ensure_ollama_available()
    msgs.insert(0, Message(role='system', content=NEEDRESUME))
    return json.loads(chat(Config.chat_model, msgs, format=NeedResume.model_json_schema(), options={
        "temperature": 0.2,
        "num_ctx": 10240,
    }).message.content)['need']


def isNeedWorks(msgs: list):
    """判断是否需要作品集"""
    if __use_openai():
        dicts = [{'role': 'system', 'content': NEEDWORKS}] + __to_dicts(msgs)
        data = llm.chat_json(dicts, temperature=0.2, json_hint='{"need": true 或 false}')
        return bool(data.get('need'))
    __ensure_ollama_available()
    msgs.insert(0, Message(role='system', content=NEEDWORKS))
    return json.loads(chat(Config.chat_model, msgs, format=NeedWorks.model_json_schema(), options={
        "temperature": 0.2,
        "num_ctx": 10240,
    }).message.content)['need']
