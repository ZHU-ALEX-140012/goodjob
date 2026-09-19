from pydantic import BaseModel, Field
from typing import Annotated
from enum import Enum


class JobScore(BaseModel):
    score: Annotated[int, Field(description='匹配度分数')]


class InterestValue(BaseModel):
    value: Annotated[bool, Field(description='是否感兴趣')]


class NeedResume(BaseModel):
    need: Annotated[bool, Field(description='是否需要简历')]


class NeedWorks(BaseModel):
    need: Annotated[bool, Field(description='是否需要作品集')]


class MessageRole(str, Enum):
    system = 'system'
    user = 'user'
    assistant = 'assistant'


class Msg(BaseModel):
    role: Annotated[MessageRole, Field(description='消息角色')]
    content: Annotated[str, Field(description='消息内容')]


class ChatDecideRequest(BaseModel):
    screenshot: Annotated[str, Field(description='聊天界面截图（base64 data URL），可为空')] = ''
    msgs: Annotated[list[Msg], Field(description='抽取的聊天消息列表')] = []
    recent: Annotated[str, Field(description='最近聊天文本摘要')] = ''
    resumeSended: Annotated[bool, Field(description='此前是否已发送过简历')] = False
    eduSent: Annotated[bool, Field(description='此前是否已发送过学历证明图')] = False
    jobTitle: Annotated[str, Field(description='当前岗位名称')] = ''
