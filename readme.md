<div align="center">

# 🎯 goodjob

**Boss 直聘轻量自动投递工具** · Tampermonkey 脚本 + 本地 Python 后端 · 全配置化

代码保持通用，所有个人差异化内容（目标岗位、判定词表、招呼语、自动回复话术、大模型接口）都集中在 `user_config.json`，改配置即可适配任何求职方向，开箱即用。

[![Python](https://img.shields.io/badge/Python-3.10%2B-3776AB?logo=python&logoColor=white)](https://www.python.org/)
[![FastAPI](https://img.shields.io/badge/FastAPI-009688?logo=fastapi&logoColor=white)](https://fastapi.tiangolo.com/)
[![Tampermonkey](https://img.shields.io/badge/Userscript-Tampermonkey-F28500?logo=tampermonkey&logoColor=white)](https://www.tampermonkey.net/)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

**[能做什么](#能做什么)** · **[快速开始](#快速开始)** · **[配置说明](#配置说明)** · **[隐私与仓库说明](#隐私与仓库说明)**

</div>

> ⚠️ **合规提示**：本项目仅供学习交流。自动操作招聘平台可能违反平台服务条款，请自行评估风险、控制频率并承担相应后果。

## 能做什么

- 在 Boss 直聘岗位列表里轮换搜索关键词（`tags`）
- 对每个岗位做匹配判定（默认计数模式：标题 + JD 命中匹配词 ≥ N 个即投递，不算权重）
- 标题硬门槛（`title_required_keywords`）与硬拦截（`title_block_keywords`）双重过滤
- 仅对活跃状态在白名单内的 HR 打招呼（`requireHrActive` / `allowedHrActive`）
- 判定通过后自动打招呼
- 收到 Boss 新消息后按规则处理：问工作地点→接受、问学历/学信网→发学历证明图、问薪资→配置话术、要简历→发简历
- 当日沟通达上限（如「今天已与 150 位 BOSS 沟通」）后自动停止投递、切去聊天页处理消息
- 连续多轮没有新岗位时自动切换关键词继续挂机
- 遇到超时、详情异常、打招呼异常时自动恢复

## 项目结构

- `main.py`：FastAPI 后端入口
- `core.py`：规则打分主逻辑 + 遗留的 LLM 代聊天能力
- `config.py`：配置加载与默认值
- `llm.py`：OpenAI 兼容大模型适配器
- `prompts.py` / `schema.py` / `tools.py` / `cache.py`：提示词、数据模型与工具函数
- `web_script.js`：Boss 页面 Tampermonkey 脚本
- `user_config.example.json`：用户配置模板（复制为 `user_config.json` 使用）
- `resume-example.md`：简历模板（复制为 `resume.md` 使用）
- `assets/`：聊天自动回复要发送的本地图片（如学历证明 `xuexin.jpg`，自备且不入库）
- `backend_guard.py` / `start_backend.bat` / `start_backend.vbs`：后端启动与简易守护
- `requirements.txt`：Python 依赖

## 快速开始

### 1. 安装依赖

```bash
pip install -r requirements.txt
```

### 2. 准备用户配置

```bash
cp user_config.example.json user_config.json
```

最少需要改这些字段：

- `tags`：搜索关键词列表（你的目标岗位名）
- `introduce`：打招呼语
- `frontend.thread`：投递阈值（分数达到才打招呼）
- `frontend.resumeIndex`：发第几份简历，从 0 开始
- `scoring`：岗位打分词表（详见下方「打分配置」）
- `auto_reply`：聊天自动回复话术（详见下方「自动回复配置」）

### 3.（可选）准备简历文件

```bash
cp resume-example.md resume.md
```

- 自动投递主链不依赖 `resume.md` 打分
- 它主要用于 LLM 代聊天时作为上下文，或供你自己管理简历内容

### 4. 启动后端

```bash
python main.py
```

Windows 下也可直接双击 `start_backend.bat`（前台）或 `start_backend.vbs`（后台带简易守护）。

### 5. 部署浏览器脚本

把 `web_script.js` 的内容粘贴到 Tampermonkey 新建脚本中保存，然后打开 Boss 直聘职位搜索页即可自动运行。

## 配置说明

所有配置都在 `user_config.json`。下面按段说明。

### 顶层字段

- `resume_name`：简历文件名（默认 `resume.md`）
- `introduce`：固定打招呼语
- `character`：性格标签（供 LLM 代聊天使用）
- `tags`：搜索关键词列表，脚本会轮换搜索
- `think_model` / `chat_model`：仅 `provider=ollama` 时使用

### `frontend`（浏览器端运行参数）

- `serverHost`：本地后端地址，默认 `http://127.0.0.1:8000`
- `thread`：**投递阈值**，岗位分数 `>= thread` 才会打招呼投递
- `resumeIndex`：默认发送第几份简历（从 0 开始）
- `onlyGreet`：`true` 时只打招呼、不处理聊天消息
- `manualFilterWaitMs`：每轮搜索后留给你手动筛选的时间
- `roundRestartDelayMs` / `maxEmptyRounds`：轮次缓冲与连续空轮上限
- `detailTimeout` / `greetTimeout` / `timestampTimeout`：各环节超时
- `preload*`：岗位列表预加载（滚动加载 DOM）的相关参数
- `requireHrActive` / `allowedHrActive`：只对白名单内活跃状态（默认 刚刚活跃/今日活跃/3日内活跃/本周活跃）的 HR 打招呼；未识别到活跃状态一律跳过

### `backend`（后端运行参数）

- `job_score_delay_base_ms` / `job_score_delay_jitter_ms`：每次打分接口的基础延迟与随机抖动（毫秒），用于降低请求频率、模拟人工

### `llm`（大模型，仅代聊天等遗留能力使用）

```json
"llm": {
  "provider": "openai",
  "base_url": "https://api.openai.com/v1",
  "model": "gpt-4o-mini",
  "api_key_env": "OPENAI_API_KEY",
  "api_key": "",
  "timeout": 120
}
```

- `provider`：`openai`（任意 OpenAI 兼容接口）或 `ollama`（本地）
- `provider=openai` 时：填 `base_url`、`model`，以及 `api_key`（或留空并用 `api_key_env` 指定的环境变量）。可对接 OpenAI、DeepSeek、月之暗面，或本地 vLLM / Ollama 的 OpenAI 兼容端点等
- `provider=ollama` 时：需 `pip install ollama` 并本地拉起模型，配合 `think_model` / `chat_model`
- 说明：**主链（打分 + 固定招呼 + 直接发简历 + 规则回复）不依赖 LLM**。LLM 仅用于 `/reply`、`/is-need-resume`、`/is-need-works` 这些遗留接口

### `auto_reply`（聊天自动回复话术）

脚本在聊天页会读取对方最新消息，按规则回复，话术全部可自定义：

```json
"auto_reply": {
  "addr_accept_text": "可以的，这个工作地点我能接受。",
  "salary_text": "您好，薪资方面可以再沟通，期待进一步了解岗位职责。",
  "reject_text": "不好意思，不太合适哈，祝早日找到合适的人选。",
  "education_keywords": ["本科", "学信网", "学历", "学位", "毕业证"],
  "education_image": "/assets/xuexin.jpg"
}
```

- `addr_accept_text`：对方询问工作地点是否接受时的回复（若页面有「接受」弹窗会优先点弹窗按钮）
- `salary_text`：对方询问薪资时的回复
- `reject_text`：岗位判定不达标时的婉拒语
- `education_keywords` / `education_image`：对方消息含任一关键词时，自动把本地学历证明图发给对方（后端 `/assets/xuexin.jpg` 提供文件，把你自己截图放到 `assets/xuexin.jpg`，或改路由指向别的图）；每个会话最多发一次
- 规则优先级：工作地点 > 学历图 > 薪资 > 简历；都未命中且尚未发过简历时，兜底主动发简历

### `scoring`（岗位判定词表）

判定逻辑见 `core.py` 的 `evaluateJobMatch`，按顺序过三道关：

1. **硬拦截** `title_block_keywords`：标题命中即 0 分不投（两种模式都生效）
2. **标题硬门槛** `title_required_keywords`：标题必须包含其中任一词（不区分大小写）才可能投递，否则 0 分
3. **计分模式** `score_mode`：
   - `count`（默认）：不算权重。跨「标题 + JD 正文」统计命中的正向匹配词数量（`title_strong` + `title_medium` + `detail_infra` + `detail_support` 四张表按关键词去重），命中数 ≥ `match_count_threshold`（默认 4）→ 100 分投递，否则 0 分
   - `weight`：旧版加权评分（下表分值生效），保留给需要精细控制的人

| 词表 | count 模式作用 | weight 模式作用 |
|---|---|---|
| `title_block_keywords` | 硬拦截 | 硬拦截 |
| `title_penalty_keywords` | 不参与 | 标题命中扣分（累计上限 45） |
| `title_strong_keywords` | 匹配词词表 | 标题强匹配基础分 |
| `title_medium_keywords` | 匹配词词表 | 标题中匹配基础分 |
| `detail_infra_keywords` | 匹配词词表 | JD 强正向累加（上限 24） |
| `detail_support_keywords` | 匹配词词表 | JD 辅助正向累加（上限 12） |
| `detail_negative_keywords` | 不参与 | JD 负向累加扣分（上限 36） |

- 关键词匹配为小写包含匹配，英文词大小写不敏感
- count 模式下各表的分值无意义（可保留任意数字），只有关键词本身参与计数
- 打分接口返回 `matchedCount` / `matchedKeywords`，日志里可直接看到命中了哪些词
- weight 模式补充：最终分 = 标题基础分 + 正文加分 + 组合加分 - 标题扣分 - 正文扣分，裁剪到 0-100；标题未命中任何强/中匹配词时总分封顶 55

## 隐私与仓库说明

以下内容默认被 `.gitignore` 忽略，**不会进入仓库**：

- `user_config.json`（你的真实配置，含 api_key、话术等）
- `resume.md`（你的真实简历）
- 所有 `*.log`、`*.jsonl` 运行日志与投递记录
- `assets/` 下的个人证件图片（学历证明截图等）
- `backend_watchdog.ps1` 等含本机绝对路径的个人脚本

对外只提交 `user_config.example.json`、`resume-example.md` 这类模板。请不要把真实配置直接提交。

## 致谢

本项目在开源项目 goodjob 的基础上做了可配置化改造与增强。

- 演示视频（原作者）：https://www.bilibili.com/video/BV1MyX6BFEp3

## License

MIT，详见 `LICENSE`。
