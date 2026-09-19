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

## 📺 安装 & 使用教程视频

不想盯代码？从环境安装、配置 `user_config.json`、启动后端到部署油猴脚本，视频与图文手册都全程演示。

- 教程视频（B站）：https://www.bilibili.com/video/BV1AGet6BEFE
- 图文版部署手册（照做即可，含常见问题速查表）：[干净电脑部署操作手册.md](干净电脑部署操作手册.md)

## 能做什么

- 在 Boss 直聘岗位列表里轮换搜索关键词（`tags`）
- 对每个岗位做匹配判定（默认计数模式：标题 + JD 命中匹配词 ≥ N 个即投递，不算权重）
- 标题硬门槛（`title_required_keywords`）与硬拦截（`title_block_keywords`）双重过滤
- 仅对活跃状态在白名单内的 HR 打招呼（`requireHrActive` / `allowedHrActive`）
- 判定通过后自动打招呼
- 收到 Boss 新消息后由视觉大模型看「页面截图 + 最近消息」做决策：精简回复 / 发学历证明图 / 发简历（需在 `llm` 配置大模型；未配置时仅消息回复不执行，投递主链不受影响）
- 检测到机器人/人机验证（滑块弹窗）时自动暂停投递，页面常驻横幅+提示音提醒，并通过后端推送微信通知，手动完成验证后自动恢复（见 `notify` 配置）
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
- `scoring`：岗位判定词表（详见下方「打分配置」）
- `auto_reply`：聊天处理与 LLM 决策开关（详见下方「聊天处理配置」）
- `notify.pushplus_token`（可选）：填了才能在触发机器人验证时收到微信提醒

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

> 不会操作？看上面的 [📺 安装 & 使用教程视频](#-安装--使用教程视频)。

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
- `chatRunIdleTimeoutMs` / `chatRecheckWindowMs`：聊天页卡死看门狗与「已读未回」兜底复查窗口

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
- 说明：**投递主链（打分 + 固定招呼）不依赖 LLM**。聊天消息处理走 `/chat-decide`（视觉决策，需 `model` 支持图像输入，如 gpt-4o-mini；把 `auto_reply.llm_chat.use_screenshot` 设为 false 可降级为纯文本决策）；`/reply`、`/is-need-resume`、`/is-need-works` 为遗留接口

### `notify`（机器人验证 → 微信提醒）

```json
"notify": {
  "enabled": true,
  "provider": "pushplus",
  "pushplus_token": "",
  "serverchan_send_key": "",
  "cooldown_seconds": 120
}
```

- 前端内置验证哨兵：搜索/详情/聊天页每 2 秒轮询检测验证弹窗，跨标签同步状态；命中后当前页常驻红色横幅+提示音，并调后端 `/notify` 推送到你的手机
- `provider`：`pushplus`（去 http://www.pushplus.plus 微信扫码关注公众号后获取 token，推荐）或 `serverchan`（去 https://sct.ftqq.com 登录获取 SendKey）
- 两个凭证按 `provider` 填其一；都没填时推送失败会在页面横幅提示原因，不影响自动暂停/恢复逻辑
- `cooldown_seconds`：同类事件推送冷却，防止多标签/持续弹窗刷屏（验证未消失期间前端每分钟重试一次）
- 弹窗消失（验证完成）后投递循环自动恢复；改本段配置后需重启后端生效

### `auto_reply`（聊天处理与 LLM 决策）

聊天回复由视觉大模型根据「聊天区截图 + 最近消息」决策，输出：回复文本 / 是否发学历图 / 是否发简历。相关字段：

```json
"auto_reply": {
  "reject_text": "不好意思，不太合适哈，祝早日找到合适的人选。",
  "education_image": "/assets/xuexin.jpg",
  "llm_chat": { "enabled": true, "use_screenshot": true, "jpeg_quality": 0.8, "max_width": 720 }
}
```

- `reject_text`：岗位判定不达标时的婉拒语
- `education_image`：学历证明图的后端路由（把你自己截图放到 `assets/xuexin.jpg`）；每个会话最多发一次
- `llm_chat.enabled`：LLM 决策总开关；`use_screenshot`：关闭后仅靠文本决策（`llm.model` 不支持视觉时建议关闭）；`jpeg_quality` / `max_width` 控制截图体积
- LLM 决策失败时仅记录日志并跳过本条消息，不乱回话
- `addr_accept_text`、`salary_text`、`education_keywords` 为旧版规则回复字段，保留仅为兼容

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
