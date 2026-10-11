import copy
import json
import os
import re


DEFAULT_USER_CONFIG = {
    'resume_name': 'resume.md',
    'profile_name': 'profile_projects.md',  # 项目与技术栈事实表，与简历一起作为代聊天 LLM 的上下文
    'think_model': 'qwen3:0.6b',
    'chat_model': 'qwen3:0.6b',
    'introduce': '您好，我是一名对 AI 应用开发、自动化流程和工程落地感兴趣的求职者，想进一步了解这个岗位。',
    'character': '简洁 直接 礼貌',
    'tags': ['运维开发', 'SRE', 'DevOps', '运维工程师', '平台工程师', 'AI应用', 'AI应用工程师', 'AI开发', 'AI产品经理'],
    # 简历按岗位方向自动分流：命中某方向关键词的岗位→发对应附件简历 + 聊天用对应文字简历。
    # 默认关闭，保证单简历用户行为不变；在 user_config.json 里把 enabled 设为 true 并配好 routes 即生效。
    'resume_routing': {
        'enabled': False,
        'routes': [
            {
                'name': 'data',
                'resume_index': 0,
                'resume_file': 'resume_data.md',
                'introduce': '',  # 该方向的打招呼话术；留空则回退全局 introduce
                'keywords': ['数据开发', '数据分析', '大数据', '数仓', '数据仓库', 'etl', '指标', '建模', '风控', 'bi', 'gaussdb', 'hive', 'sql优化'],
            },
            {
                'name': 'agent',
                'resume_index': 1,
                'resume_file': 'resume_agent.md',
                'introduce': '',
                'keywords': ['agent', '智能体', 'ai应用', 'ai开发', 'ai工程', '大模型', 'aigc', 'llm', 'langchain', 'langgraph', 'rag', '人工智能', 'mcp'],
            },
        ],
    },
    'backend': {
        'job_score_delay_base_ms': 4000,
        'job_score_delay_jitter_ms': 500,
    },
    'notify': {
        # 前端检测到 Boss直聘机器人验证弹窗时，调 /notify 由后端通过微信公众号推送到手机
        # PushPlus：http://www.pushplus.plus 关注公众号后官网获取 token（推荐，免费额度足够）
        # Server酱：https://sct.ftqq.com 登录后获取 SendKey
        'enabled': True,
        'provider': 'pushplus',  # 'pushplus' 或 'serverchan'
        'pushplus_token': '',
        'serverchan_send_key': '',
        'cooldown_seconds': 120,  # 同一 key 的推送冷却，防止验证持续弹窗时刷屏
    },
    'llm': {
        # 代聊天等 LLM 能力的供应商：'openai'（任意 OpenAI 兼容接口）或 'ollama'（本地）
        'provider': 'openai',
        'base_url': 'https://api.openai.com/v1',
        'model': 'gpt-4o-mini',  # 聊天视觉决策要求此模型支持图像输入（image_url），如 gpt-4o-mini
        'api_key_env': 'OPENAI_API_KEY',
        'api_key': '',
        'timeout': 120,
    },
    'auto_reply': {
        # 聊天页按规则自动回复的话术，全部可自定义；某项留空则回退脚本内置兜底文案
        'addr_accept_text': '可以的，这个工作地点我能接受。',
        'salary_text': '您好，薪资方面可以再沟通，期待进一步了解岗位职责。',
        'reject_text': '不好意思，不太合适哈，祝早日找到合适的人选。',
        'education_keywords': ['本科', '学信网', '学历', '学位', '毕业证'],  # 对方消息含任一关键词时自动发送学历证明图
        'education_image': '/assets/xuexin.jpg',  # 学历证明图路由（后端 /assets/xuexin.jpg 提供文件）
        # 聊天页 LLM 视觉决策（截图+文本→视觉 LLM→精简回复/发学历图/发简历）；依赖 llm.model 为支持视觉的模型
        'llm_chat': {
            'enabled': True,          # 总开关；关闭则前端不走 LLM 决策
            'use_screenshot': True,   # 是否用 html2canvas 截图并作为 image_url 一并发给视觉 LLM
            'jpeg_quality': 0.8,      # 截图 JPEG 压缩质量（0-1）
            'max_width': 720,         # 截图最大宽度（px），超出按比例缩放以控制体积
        },
    },
    'frontend': {
        'serverHost': 'http://127.0.0.1:8000',
        'resumeIndex': 0,
        'thread': 50,
        'timestampTimeout': 3000,
        'onlyGreet': False,
        'manualFilterWaitMs': 10000,
        'roundRestartDelayMs': 2000,
        'maxEmptyRounds': 3,
        'detailTimeout': 10000,
        'greetTimeout': 12000,
        'preloadScrollPixels': 180,
        'preloadScrollWaitMs': 450,
        'preloadStableRoundsLimit': 24,
        'preloadMaxRounds': 300,
        'preloadActivateCardEvery': 0,
        'preloadActivateCardWaitMs': 250,
        'chatRunIdleTimeoutMs': 180000,  # 聊天页看门狗：连续无状态心跳多少秒才判卡死（聊天页每处理一条消息会续期）
                'chatRecheckWindowMs': 1800000,  # 未读红点消失后，列表时间在此窗口内的会话仍会复查，避免人工看过就永远不回
        'requireHrActive': True,
        'allowedHrActive': ['刚刚活跃', '今日活跃', '3日内活跃', '本周活跃'],
        # 拟人化（防封号）：动作间隔抖动、逐字打字模拟、打招呼频控、静默时段；enabled=false 恢复旧行为
        'humanize': {
            'enabled': True,
            'jobGapMinMs': 4000, 'jobGapMaxMs': 9000,          # 每个岗位之间的随机间隔
            'longBreakEveryMin': 6, 'longBreakEveryMax': 10,   # 每 N 个岗位一次中休
            'longBreakMinMs': 30000, 'longBreakMaxMs': 70000,
            'coffeeBreakEveryMin': 16, 'coffeeBreakEveryMax': 24,  # 每 N 个岗位一次长休
            'coffeeBreakMinMs': 180000, 'coffeeBreakMaxMs': 420000,
            'greetPreReadMinMs': 1500, 'greetPreReadMaxMs': 4500,  # 打招呼前假读 JD 停顿
            'chatContactGapMinMs': 3000, 'chatContactGapMaxMs': 9000,  # 聊天列表会话间隔
            'chatReadMinMs': 900, 'chatReadMaxMs': 2600,        # 点开会话后假读停顿
            'typingCharMinMs': 55, 'typingCharMaxMs': 170,      # 逐字打字间隔
            'typingPauseChance': 0.10,                          # 打字中"思考停顿"概率
            'typingPauseMinMs': 400, 'typingPauseMaxMs': 1300,
            'hourGreetCap': 40,      # 每小时打招呼上限（滚动窗口），0=不限
            'dailyGreetCap': 120,    # 每日打招呼安全上限（低于 Boss ~150），0=不限
            'enforceActiveHours': True,  # 只在活跃时段投递，时段外只处理消息
            'activeHourStart': 8,        # 小时级活跃时段（activeWindows 非空时忽略）
            'activeHourEnd': 23,
            'activeWindows': [],         # 分钟级高峰投递窗口，如 [{'start': '10:00', 'end': '11:30'}, {'start': '14:30', 'end': '16:30'}]
        },
    },
    'scoring': {
        'score_mode': 'count',  # 'count'=命中匹配词数量达阈就投（不算权重）；'weight'=旧的加权评分
        'match_count_threshold': 4,  # count 模式：命中多少个匹配词（岗位标题词+技能词，去重）及以上才投递
        'title_required_keywords': ['数据开发', '数据分析', '数据应用', 'agent', '智能体', '模型开发', '数仓', '数据仓库', 'etl', 'ai应用', 'ai开发', 'ai工程师', '大模型', 'aigc', 'llm', 'langchain', '人工智能'],  # 标题硬门槛：标题必须包含其中之一才可能投递（忽略空格）
        'title_block_keywords': {
            '测试': 100,
            '销售': 100,
            '商务': 100,
            '运营': 100,
            '客服': 100,
            '管培生': 100,
            '培训生': 100,
            '储备干部': 100,
            '储干': 100,
            '项目经理': 100,
            '项目管理': 100,
            '数据开发': 100,
            '数据治理': 100,
            '算法': 100,
            '算法工程师': 100,
            '算法研究员': 100,
            '机器学习算法': 100,
            '深度学习算法': 100,
            '推荐算法': 100,
            '搜索算法': 100,
            'cv算法': 100,
            'nlp算法': 100,
            '多模态算法': 100,
            '模型训练': 100,
            '模型研发': 100,
            '大模型算法': 100,
            '训练': 100,
            '预训练': 100,
            '微调': 100,
            '嵌入式': 100,
            '硬件': 100,
            '渠道': 100,
            '光伏': 100,
            # 方向不对口的后端/投放类岗：计数模式下扣分词不生效，必须走标题硬拦截
            '后端': 100,
            '后台开发': 100,
            'java': 100,
            '全栈': 100,
            'go': 100,
            '广告投放': 100,
            '投放优化': 100,
            '媒介投放': 100,
            '优化师': 100,
        },
        'title_penalty_keywords': {
            'java': 35,
            '前端': 45,
            '后端': 20,
            '全栈': 18,
        },
        'title_strong_keywords': {
            'ai应用': 88,
            '人工智能应用': 88,
            'ai工程': 85,
            '人工智能工程师': 85,
            'ai开发': 86,
            'ai提效': 86,
            'ai产品': 84,
            '人工智能产品': 84,
            'ai产品经理': 84,
            'ai解决方案': 82,
            'ai实施顾问': 80,
            'ai agent': 88,
            '智能体': 88,
            'ai工作流': 86,
            '工作流工程师': 84,
            '大模型应用': 86,
            'llm应用': 86,
            'vibe coding': 88,
            'vibecoding': 88,
            '自动化工程师': 82,
            '工具开发': 80,
            '效率工程': 80,
            '运维开发工程师': 60,
            '运维开发': 58,
            'devops': 58,
            'sre': 58,
            '站点可靠性工程师': 58,
            '运维工程师': 55,
            '平台工程师': 55,
            '平台工程': 55,
            '自动化运维': 55,
            '可靠性工程师': 52,
        },
        'title_medium_keywords': {
            'ai': 80,
            'agent': 76,
            'workflow': 72,
            '工作流': 72,
            '自动化开发': 70,
            '解决方案': 70,
            '实施顾问': 68,
            '产品经理': 68,
            'saas': 68,
            'web': 64,
            '工具': 64,
            '效率': 64,
            'rag': 68,
            '知识库': 66,
            'mcp': 66,
            'prompt': 64,
            '提示词': 64,
            'token': 72,
            'tokens': 72,
            '上下文工程': 72,
            'prompt工程': 72,
            '提示词工程': 72,
            '运维': 42,
            'linux运维': 42,
            '系统运维': 40,
            '云运维': 40,
            '云平台': 36,
            '基础架构': 36,
            '发布工程师': 34,
            'linux': 30,
        },
        'detail_infra_keywords': {
            'k8s': 10,
            'kubernetes': 10,
            'docker': 8,
            'ansible': 8,
            'jenkins': 8,
            'prometheus': 8,
            'grafana': 8,
            'elk': 8,
            'nginx': 6,
            'helm': 6,
            'terraform': 8,
            '云原生': 8,
            'devops': 8,
            'sre': 8,
            'ai agent': 10,
            '智能体': 10,
            'mcp': 8,
            'rag': 8,
            '知识库': 6,
            '工作流': 6,
            'workflow': 6,
            'aigc': 8,
            'llm': 8,
            '大模型应用': 8,
            'vibe coding': 24,
            'vibecoding': 24,
        },
        'detail_support_keywords': {
            'linux': 5,
            'shell': 4,
            'python': 4,
            '日志': 3,
            '监控': 3,
            '部署': 3,
            '发布': 3,
            '故障处理': 4,
            '高可用': 4,
            '自动化': 3,
            '服务器': 2,
            '运维': 4,
            '平台工程': 4,
            'ai': 6,
            '提效': 6,
            '自动化办公': 5,
            '效率工具': 5,
            '提示词': 5,
            'prompt': 5,
            'agent': 6,
            'copilot': 5,
            'saas': 6,
            'web': 5,
            '产品': 4,
            '产品经理': 6,
            '解决方案': 6,
            '实施': 4,
            '顾问': 4,
            '工具开发': 6,
            '效率工程': 6,
            'token': 8,
            'tokens': 8,
            '上下文': 6,
            '上下文工程': 8,
            '提示词工程': 8,
            'prompt工程': 8,
            'embedding': 8,
            'rerank': 8,
            '知识召回': 8,
            'vibe': 6,
        },
        'detail_negative_keywords': {
            'spring': 12,
            'spring boot': 16,
            'react': 16,
            'vue': 16,
            'android': 12,
            'ios': 12,
            '小程序': 12,
            '客户': 10,
            '渠道': 12,
            '销售': 12,
            '新能源': 12,
            '光伏': 16,
            'to b': 8,
            'to c': 8,
        },
    },
}


def _deep_merge(base: dict, override: dict) -> dict:
    result = copy.deepcopy(base)
    for key, value in override.items():
        if isinstance(value, dict) and isinstance(result.get(key), dict):
            result[key] = _deep_merge(result[key], value)
        elif value is not None:
            result[key] = value
    return result


def _apply_legacy_compat(config: dict, user_config: dict) -> dict:
    legacy_top_level_to_nested = {
        'job_score_delay_base_ms': ('backend', 'job_score_delay_base_ms'),
        'job_score_delay_jitter_ms': ('backend', 'job_score_delay_jitter_ms'),
        'thread': ('frontend', 'thread'),
    }
    for old_key, (group, new_key) in legacy_top_level_to_nested.items():
        if old_key in user_config and user_config[old_key] is not None:
            config[group][new_key] = user_config[old_key]
    return config


def _load_raw_user_config():
    # 必须基于模块文件定位，避免进程工作目录不在项目目录时读不到配置
    config_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'user_config.json')
    if os.path.exists(config_path):
        with open(config_path, 'r', encoding='utf-8') as f:
            user_config = json.load(f)
        if isinstance(user_config, dict):
            return user_config
    return {}


def load_user_config():
    config = copy.deepcopy(DEFAULT_USER_CONFIG)
    user_config = RAW_USER_CONFIG
    if isinstance(user_config, dict) and user_config:
        config = _deep_merge(config, user_config)
        # 评分词表按用户配置整组替换，避免默认词表残留项叠加生效
        user_scoring = user_config.get('scoring')
        if isinstance(user_scoring, dict):
            for table_key, table_value in user_scoring.items():
                if isinstance(table_value, dict):
                    config['scoring'][table_key] = copy.deepcopy(table_value)
        config = _apply_legacy_compat(config, user_config)
    return config


RAW_USER_CONFIG = _load_raw_user_config()
USER_CONFIG = load_user_config()


class Config:
    resume_name = USER_CONFIG['resume_name']
    profile_name = USER_CONFIG.get('profile_name', 'profile_projects.md')
    think_model = USER_CONFIG['think_model']
    chat_model = USER_CONFIG['chat_model']
    introduce = USER_CONFIG['introduce']
    character = USER_CONFIG['character']
    tags = USER_CONFIG['tags']

    job_score_delay_base_ms = USER_CONFIG['backend']['job_score_delay_base_ms']
    job_score_delay_jitter_ms = USER_CONFIG['backend']['job_score_delay_jitter_ms']

    title_block_keywords = USER_CONFIG['scoring']['title_block_keywords']
    title_penalty_keywords = USER_CONFIG['scoring']['title_penalty_keywords']
    title_strong_keywords = USER_CONFIG['scoring']['title_strong_keywords']
    title_medium_keywords = USER_CONFIG['scoring']['title_medium_keywords']
    detail_infra_keywords = USER_CONFIG['scoring']['detail_infra_keywords']
    detail_support_keywords = USER_CONFIG['scoring']['detail_support_keywords']
    detail_negative_keywords = USER_CONFIG['scoring']['detail_negative_keywords']

    score_mode = USER_CONFIG['scoring'].get('score_mode', 'count')
    match_count_threshold = USER_CONFIG['scoring'].get('match_count_threshold', 4)
    title_required_keywords = USER_CONFIG['scoring'].get(
        'title_required_keywords',
        ['数据开发', '数据分析', '数据应用', 'agent', '智能体', '模型开发', '数仓', '数据仓库', 'etl',
         'ai应用', 'ai开发', 'ai工程师', '大模型', 'aigc', 'llm', 'langchain', '人工智能'])

    frontend = USER_CONFIG['frontend']
    backend = USER_CONFIG['backend']
    resume_routing = USER_CONFIG.get('resume_routing') or {}
    scoring = USER_CONFIG['scoring']
    llm = USER_CONFIG['llm']
    auto_reply = USER_CONFIG['auto_reply']
    notify = USER_CONFIG.get('notify') or {}

    @classmethod
    def get_default_introduce(cls):
        return cls.introduce

    @classmethod
    def __read_md(cls, filename: str) -> str:
        try:
            p = os.path.join(os.path.dirname(os.path.abspath(__file__)), filename)
            if os.path.exists(p):
                with open(p, 'r', encoding='utf-8') as f:
                    return f.read().strip()
        except Exception:
            pass
        return ''

    @classmethod
    def __resume_text(cls, resume_filename: str) -> str:
        """指定简历文件 + 项目事实表（供代聊天 LLM 做上下文），文件不存在则自动跳过。"""
        parts = []
        resume = cls.__read_md(resume_filename)
        if resume:
            parts.append(resume)
        profile = cls.__read_md(cls.profile_name)
        if profile:
            parts.append(
                '# 项目与技术栈事实表（回答 HR 提问时以此为准，表里没有的内容一律不得编造）\n' + profile
            )
        return '\n\n'.join(parts)

    @classmethod
    def get_resume_text(cls) -> str:
        """默认文字简历（全局单份，未启用方向分流时使用）。"""
        return cls.__resume_text(cls.resume_name)

    @classmethod
    def route_for_text(cls, text: str):
        """按岗位文本（标题+描述/标题）判断方向：返回命中关键词最多的 route，未启用或无命中返回 None。"""
        cfg = cls.resume_routing or {}
        if not cfg.get('enabled'):
            return None
        compact = re.sub(r'\s+', '', (text or '').lower())
        if not compact:
            return None
        best = None
        best_hits = 0
        for route in cfg.get('routes', []):
            hits = 0
            for kw in (route.get('keywords') or []):
                k = re.sub(r'\s+', '', str(kw).lower())
                if k and k in compact:
                    hits += 1
            if hits > best_hits:
                best_hits = hits
                best = route
        return best if best_hits > 0 else None

    @classmethod
    def get_resume_index_for_job(cls, job_text: str) -> int:
        """按岗位方向返回要发送的附件简历序号；未命中方向则回退 frontend.resumeIndex。"""
        default = cls.frontend.get('resumeIndex', 0)
        route = cls.route_for_text(job_text)
        if route and route.get('resume_index') is not None:
            try:
                return int(route['resume_index'])
            except (TypeError, ValueError):
                return default
        return default

    @classmethod
    def get_introduce_for_job(cls, job_text: str) -> str:
        """按岗位方向返回打招呼话术；未启用/未命中或该方向未配 introduce 则回退全局 introduce。"""
        route = cls.route_for_text(job_text)
        if route and str(route.get('introduce') or '').strip():
            return route['introduce'].strip()
        return cls.introduce

    @classmethod
    def get_resume_text_for_job(cls, job_text: str) -> str:
        """按岗位方向返回聊天用文字简历；未启用/未命中或该方向文件缺失则回退默认 resume.md。"""
        route = cls.route_for_text(job_text)
        if route and route.get('resume_file'):
            text = cls.__resume_text(route['resume_file'])
            if text:
                return text
        return cls.get_resume_text()

    @classmethod
    def get_client_config(cls):
        return {
            'introduce': cls.get_default_introduce(),
            'character': cls.character,
            'tags': cls.tags,
            'frontend': cls.frontend,
            'autoReply': cls.auto_reply,
        }
