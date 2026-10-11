# syntax=docker/dockerfile:1
FROM python:3.12-slim

ENV PYTHONUTF8=1 \
    PYTHONUNBUFFERED=1

WORKDIR /app

# 依赖层单独成层：requirements.txt 不变时复用缓存，改代码不重装依赖
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

# 只带代码与模板。user_config.json / 简历 / 证件图 / 投递日志
# 由 .dockerignore 显式排除 —— 镜像被外传也不丢任何个人信息。
COPY main.py core.py config.py schema.py llm.py prompts.py cache.py tools.py backend_guard.py ./
COPY user_config.example.json resume-example.md LICENSE ./

# 真实配置与证件图在运行时挂卷（见文末用法），容器只读它们
EXPOSE 8000

# 健康检查用标准库自己探 /health —— 不往镜像里塞 curl
HEALTHCHECK --interval=30s --timeout=3s --start-period=8s --retries=3 \
  CMD ["python", "-c", "import urllib.request,sys;sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8000/health',timeout=2).getcode()==200 else 1)"]

CMD ["python", "main.py"]

# ------------------------------------------------------------
# 用法：
#   docker build -t goodjob .
#   docker run -d --name goodjob -p 8000:8000 ^
#     -v %cd%/user_config.json:/app/user_config.json:ro ^
#     -v %cd%/resume.md:/app/resume.md:ro ^
#     -v %cd%/assets:/app/assets:ro ^
#     goodjob
#
#   油猴脚本（web_script.js）装进浏览器，serverHost 指向 http://127.0.0.1:8000。
#   投递日志 job_decisions.jsonl / job_actions.jsonl 写在容器内 /app，
#   需要留档就再加一条 -v 挂到宿主机。
# ------------------------------------------------------------
