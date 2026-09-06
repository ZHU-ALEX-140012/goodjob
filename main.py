from datetime import datetime
import asyncio
import random
import json
import sys
from pathlib import Path

# 防止 Windows 控制台/重定向默认 GBK 编码遇到生僻字符（如康熙部首）时 print 崩溃
for _stream in (sys.stdout, sys.stderr):
    try:
        _stream.reconfigure(encoding='utf-8', errors='replace')
    except Exception:
        pass

from fastapi import FastAPI, Body, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from core import replyMsg, isNeedResume, isNeedWorks, evaluateSingleRouteDelivery
from schema import Msg
from config import Config


app = FastAPI()
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)
LOG_PATH = Path(__file__).resolve().parent / 'job_decisions.jsonl'
ACTION_LOG_PATH = Path(__file__).resolve().parent / 'job_actions.jsonl'


def append_job_decision_log(result: dict, raw_job: str, delay_ms: int):
    log_record = {
        'loggedAt': datetime.now().isoformat(timespec='seconds'),
        'title': result.get('title'),
        'detail': result.get('detail'),
        'matchedField': result.get('matched_field'),
        'keyword': result.get('keyword'),
        'score': result.get('score'),
        'introduce': result.get('introduce'),
        'resumeIndex': result.get('resumeIndex'),
        'titleScore': result.get('title_score'),
        'detailScore': result.get('detail_score'),
        'comboScore': result.get('combo_score'),
        'titlePenaltyScore': result.get('title_penalty_score'),
        'penaltyScore': result.get('penalty_score'),
        'matchedCount': result.get('matched_count'),
        'matchedKeywords': result.get('matched_keywords'),
        'reason': result.get('reason'),
        'delayMs': delay_ms,
        'rawJob': raw_job,
    }
    with LOG_PATH.open('a', encoding='utf-8') as f:
        f.write(json.dumps(log_record, ensure_ascii=False) + '\n')


def append_job_action_log(action: dict):
    action_record = {
        'loggedAt': datetime.now().isoformat(timespec='seconds'),
        **action,
    }
    with ACTION_LOG_PATH.open('a', encoding='utf-8') as f:
        f.write(json.dumps(action_record, ensure_ascii=False) + '\n')


@app.get("/tags", summary="获取职位标签")
async def get_tags():
    return {
        'tags': Config.tags
    }


@app.get("/get-introduce", summary="获取自我介绍")
async def get_introduce():
    return {
        'introduce': Config.get_default_introduce()
    }


@app.get("/client-config", summary="获取前端运行配置")
async def get_client_config():
    return Config.get_client_config()


@app.get("/assets/xuexin.jpg", summary="学信网学位截图（对方问学历时聊天页自动发送）")
async def asset_xuexin():
    p = Path(__file__).resolve().parent / 'assets' / 'xuexin.jpg'
    if not p.exists():
        raise HTTPException(status_code=404, detail='missing asset: assets/xuexin.jpg')
    return FileResponse(str(p), media_type='image/jpeg')


@app.post("/get-job-score", summary="获取职位匹配度")
async def get_job_score(job: str = Body(..., description="职位信息")):
    result = evaluateSingleRouteDelivery(job)
    delay_ms = max(0, Config.job_score_delay_base_ms + random.randint(
        -Config.job_score_delay_jitter_ms,
        Config.job_score_delay_jitter_ms,
    ))
    time_str = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
    title = result['title'] or '未识别标题'
    keyword = result['keyword'] or '无'
    matched_field_map = {
        'title': '岗位名称',
        'detail': '职位描述',
        'none': '未命中',
        'count': '匹配词计数达标',
        'title_required_miss': '标题缺必需关键词',
        'title_negative': '标题负向拦截',
    }
    print(
        f"[{time_str}] /get-job-score | "
        f"title={title} | "
        f"matched={matched_field_map.get(result['matched_field'], result['matched_field'])} | "
        f"keyword={keyword} | "
        f"title_score={result['title_score']} | "
        f"detail_score={result['detail_score']} | "
        f"combo_score={result['combo_score']} | "
        f"title_penalty_score={result.get('title_penalty_score', 0)} | "
        f"penalty_score={result['penalty_score']} | "
        f"matched_count={result.get('matched_count')} | "
        f"delay_ms={delay_ms} | "
        f"score={result['score']} | "
        f"reason={result['reason']}",
        flush=True
    )
    append_job_decision_log(result, job, delay_ms)
    await asyncio.sleep(delay_ms / 1000)
    return {
        'score': result['score'],
        'introduce': result['introduce'],
        'resumeIndex': result['resumeIndex'],
        'matchedCount': result.get('matched_count'),
        'matchedKeywords': result.get('matched_keywords'),
    }


@app.post("/log-action", summary="记录前端动作日志")
async def log_action(action: dict = Body(..., description="动作日志")):
    append_job_action_log(action)
    return {'success': True}


@app.post("/reply", summary="回复消息")
async def reply(msgs: list[Msg] = Body(..., description="消息列表")):
    try:
        return replyMsg(msgs, Config.get_resume_text(), Config.character)
    except RuntimeError as e:
        raise HTTPException(status_code=503, detail=str(e)) from e
    except Exception as e:
        # LLM 调用失败（额度用尽/代理未启动/网络不通等），返清晰错误便于前端与日志定位
        raise HTTPException(status_code=502, detail=f'LLM 调用失败: {e}') from e


@app.post("/is-need-resume", summary="是否需要简历")
async def is_need_resume(msgs: list[Msg] = Body(..., description="消息列表")):
    try:
        return {
            'need': isNeedResume(msgs)
        }
    except RuntimeError as e:
        raise HTTPException(status_code=503, detail=str(e)) from e


@app.post("/is-need-works", summary="是否需要作品集")
async def is_need_works(msgs: list[Msg] = Body(..., description="消息列表")):
    try:
        return {
            'need': isNeedWorks(msgs)
        }
    except RuntimeError as e:
        raise HTTPException(status_code=503, detail=str(e)) from e


if __name__ == '__main__':
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=False)
