// ==UserScript==
// @name         goodJobs
// @namespace    http://tampermonkey.net/
// @version      2026-09-17.2
// @description  goodJobs篡改猴插件
// @match        https://www.zhipin.com/*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=zhipin.com
// @grant        GM_xmlhttpRequest
// @grant        GM.xml
// @connect      127.0.0.1
// @connect      localhost
// @require      https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js
// ==/UserScript==

(function () {
    'use strict';

    // 配置项
    const OPTIONS = {
        resumeIndex: 0, // 第几份简历，从 0 开始递增
                autoStart: true, // 进入搜索页后自动开始运行（免手动点击"开始"）
                autoStartDelay: 3000, // 自动开始前的等待时间，单位毫秒
        serverHost: 'http://127.0.0.1:8000', // 本地服务的主机地址
        thread: 50, // 分数阈值，低于这个就不发消息了
        timestampTimeout: 60000, // 时间戳过期时间，单位毫秒（必须大于 detailTimeout，避免详情页因加载慢/被节流而误判"非自动化来源"→静默不回传→搜索页干等满超时）
        onlyGreet: false, // 是否只打招呼，默认为false，即打招呼和代聊天
        manualFilterWaitMs: 10000, // 每轮搜索后留给用户手动筛选的时间
        roundRestartDelayMs: 2000, // 本轮结束后，启动下一轮前的缓冲时间
        maxEmptyRounds: 3, // 连续多少轮没有拿到新岗位后停止，避免空转
        detailTimeout: 45000, // 获取职位详情超时时间（给后台标签节流/SPA 慢渲染预留更充裕窗口）
        greetTimeout: 45000, // 打招呼页回执超时时间
        preloadScrollPixels: 180, // 岗位预加载：每轮下滑像素
        preloadScrollWaitMs: 450, // 岗位预加载：每轮等待毫秒数
        preloadStableRoundsLimit: 24, // 岗位预加载：连续多少轮无增长后结束
        preloadMaxRounds: 300, // 岗位预加载：最多滑动多少轮
        preloadActivateCardEvery: 0, // 预加载时每隔多少轮尝试轻点一次左侧岗位卡片，0 表示关闭
        preloadActivateCardWaitMs: 250, // 轻点岗位卡片后的额外等待时间
        dailyLimitChatIntervalMs: 60000, // 触发"今日沟通已达上限"后，纯消息模式下每隔多久重新检查一次新消息
        chatRecheckWindowMs: 1800000, // 未读红点消失后，列表时间在此窗口内的会话仍会复查一遍，防止人工看过就永远不回
        chatRunIdleTimeoutMs: 180000, // 聊天页看门狗：连续多少秒没有任何状态心跳才判卡死（每处理一条消息会自动续期）
        requireHrActive: true, // 是否只对"活跃"HR打招呼（true 时仅允许 allowedHrActive 中的活跃状态才打招呼）
        allowedHrActive: ['刚刚活跃', '今日活跃', '3日内活跃', '本周活跃'], // 允许打招呼的 HR 活跃状态白名单（其余状态一律跳过）
    };

    // 自动回复话术（运行时会被后端 /client-config 返回的 autoReply 覆盖，可在 user_config.json 自定义）
    const AUTO_REPLY = {
        addr_accept_text: '可以的，这个工作地点我能接受。',
        salary_text: '您好，薪资方面可以再沟通，期待进一步了解岗位职责。',
        reject_text: '不好意思，不太合适哈，祝早日找到合适的人选。',
        education_keywords: ['本科', '学信网', '学历', '学位', '毕业证'], // 对方消息含任一关键词时发送学历证明图
        education_image: '/assets/xuexin.jpg', // 学历证明图的后端路由
        llm_chat: { enabled: true, use_screenshot: true, jpeg_quality: 0.8, max_width: 720 }, // 聊天页 LLM 视觉决策（运行时被 /client-config 的 autoReply.llm_chat 覆盖）
    };

    // 元素选择器
    const SELECTORS = {
        ZHIPIN: {
            SEARCH: {
                SEARCHINPUT: 'input', // 搜索框
                SEARCHBTN: '.search-btn', // 搜索按钮
                JOBLISTCTN: '.job-list-container', // 职位列表容器
                JOBLIST: '.rec-job-list', // 职位列表
                JOBCARD: '.job-card-box', // 左侧岗位卡片
                JOBHREFS: '.job-card-box .job-name', // 职位链接
            },
            DETAIL: {
                STARTCHAT: '.btn-startchat', // 开始聊天按钮
                NAMEBOX: '.name', // 职位名称盒子
                JOBNAME: 'h1', // 职位名称
                SALARY: '.salary', // 职位薪资
                DETAIL: '.job-sec-text', // 职位详情
                CHATURL: 'redirect-url', // 聊天链接
            },
            CHAT: {
                // 聊天
                CHATINPUT: '#chat-input', // 聊天输入框
                MSGSEND: '.btn-send', // 消息发送按钮
                // 聊天记录
                HISTORYCTN: '.chat-message', // 聊天记录容器
                USEFULMSG: '.item-friend,.item-myself', // 有效的文字聊天记录项
                MSGCONTENT: '.message-content .text', // 聊天记录内容
                // 职位
                JOBEL: '*[ka=geek_chat_job_detail]', // 职位元素
                JOBCITY: '.city', // 职位城市
                // 简历
                RESUMESEND: '.toolbar-btn.tooltip.tooltip-top', // 简历发送按钮
                RESUMEMODAL: '.panel-resume', // 简历发送弹窗，有的时候简历按钮点击会出来一个小弹窗
                RESUMEMODALCONFIRM: '.btn-sure-v2', // 简历发送弹窗确认按钮
                RESUMELIST: '.resume-list', // 简历列表
                RESUMELISTITEM: 'li', // 简历列表项
                RESUMESENDCONFIRM: '.btn-confirm', // 简历发送确认按钮
                // 联系人
                CONTACTLISTEMPTY: '.no-data', // 联系人列表为空
                CONTACTLIST: '.user-list-content', // 联系人列表
                CONTACTLISTITEM: 'li', // 联系人列表项
                NEWMSGNOTICE: '.notice-badge', // 新消息通知图标
                USERNAME: '.name-text', // 联系人名称
            }
        },
    };

    // 搜索路径
    const SEARCHPATH = {
        zhipin: '/web/geek/job',
    };

    // 白名单
    const WHITELIST = {
        zhipin: {
            deatil: '/job_detail',
            chat: '/web/geek/chat'
        },
    };

    // 工具
    const tools = {
        inWhiteList: function (pathObj) {
            return Object.values(pathObj).some((path) => location.pathname.startsWith(path));
        },
        endlessFind: function (selector) {
            return new Promise((resolve, reject) => {
                // 初始立即检查元素是否存在
                let element;
                try {
                    element = document.querySelector(selector);
                } catch (e) {
                    reject(e); // 处理无效选择器
                    return;
                }
                if (element) {
                    resolve(element);
                    return;
                }

                // 设置超时
                const timeoutId = setTimeout(() => {
                    observer.disconnect();
                    reject(new Error('未找到目标元素'));
                }, 10000);

                // 定义MutationObserver回调
                const observer = new MutationObserver((_, obs) => {
                    try {
                        const el = document.querySelector(selector);
                        if (el) {
                            obs.disconnect();
                            clearTimeout(timeoutId);
                            resolve(el);
                        }
                    } catch (e) {
                        obs.disconnect();
                        clearTimeout(timeoutId);
                        reject(e);
                    }
                });

                // 开始观察整个文档的DOM变化
                observer.observe(document.documentElement, {
                    childList: true,
                    subtree: true
                });
            });
        },
        inputText: function (el, text) {
            el.value = text;
            el.dispatchEvent(new Event('input', { bubbles: true }));
        },
        asyncSleep(ms) {
            return new Promise((resolve) => {
                // 创建一个 Blob 对象，包含 Web Worker 的代码
                const workerCode = `self.addEventListener('message', function(e) {
                    const delay = e.data;
                    setTimeout(function() {
                        self.postMessage('done');
                    }, delay);
                });`;

                const blob = new Blob([workerCode], { type: 'application/javascript' });
                const workerUrl = URL.createObjectURL(blob);

                const worker = new Worker(workerUrl);
                worker.onmessage = function () {
                    resolve();
                    worker.terminate(); // 使用后终止worker
                    URL.revokeObjectURL(workerUrl); // 释放对象URL
                };
                worker.postMessage(ms);
            });
        },
        getTimestamp(key) {
            return Number(localStorage.getItem(key));
        },
        openTabNSetTimestamp(href, key, self = false) {
            localStorage.setItem(key, new Date().getTime());
            const win = window.open(href, self ? '_self' : key);
            if (!self && !win) {
                // 弹窗被拦截：回传后端日志并在页面醒目提示
                try {
                    fetch(OPTIONS.serverHost + '/log-action', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ action: 'popup_blocked', scene: 'search', href: href, key: key }),
                    }).catch(() => {});
                } catch (e) { }
                try { banner('弹窗被拦截，请允许 zhipin.com 弹窗'); } catch (e) { }
            }
            return win;
        },
    };

    /**
     * 横幅
     * @param {string} text 显示的文本
     */
    function banner(text) {
        const el = document.createElement('div');
        el.style.cssText = `
                position: fixed;
                top: 60px;
                left: 50%;
                transform: translateX(-50%);
                z-index: 9999;
                background-color: rgba(0,0,0,.5);
                padding: 4px 20px;
                text-align: center;
                border-radius: 8px;
                color: #fff;
        `;
        el.innerText = text;
        document.body.appendChild(el);
        setTimeout(function () {
            el.remove();
        }, 3000);
    }

    /**
     * 机器人验证哨兵：扫描 Boss 直聘的“安全验证/滑块/人机验证”弹窗。
     * 检测到后：页面顶部常驻红色横幅 + 循环提示音 + 请求后端 /notify 推送到微信；
     * 并通过 localStorage 心跳在标签页间同步“验证进行中”状态（搜索/详情/聊天任一标签弹验证，
     * 搜索页投递循环自动暂停），验证完成（弹窗消失、心跳过期）后自动恢复。
     */
    class CaptchaSentinel {
        constructor() {
            this.STORAGE_KEY = 'goodjobs_captcha_state';
            this.TICK_MS = 2000;      // 检测轮询间隔（也是跨标签心跳刷新频率）
            this.STALE_MS = 8000;     // 跨标签心跳过期：验证所在标签 8s 不再刷新即视为已通过/已关闭
            this.RESHOW_MS = 60000;   // 验证持续期间每隔多久再次请求微信推送（后端另有冷却防刷屏）
            this.SELECTORS = [
                '.geetest_panel', '.geetest_holder', '.geetest_slider',
                '.v3-captcha', '.verify-panel', '.verify-box',
                '[class*="captcha"]', '[class*="verify"]', '[id*="captcha"]', '[id*="verify"]',
                'iframe[src*="captcha"]', 'iframe[src*="verify"]',
            ];
            this.TEXT_RE = /(安全验证|人机验证|点击.{0,10}进行验证|拖动.{0,12}滑块|滑块.{0,10}验证|请完成验证|验证.{0,6}后.{0,6}继续|异常(访问|流量)|访问验证)/;
            this.localActive = false;
            this.active = false;
            this.listeners = [];
            this.lastNotifyAt = 0;
            this.currentReason = '';
            this.bannerEl = null;
            this.beepTimer = null;
            this.audioCtx = null;
            this.api = null;
            this.timer = null;
        }

        onChange(cb) {
            this.listeners.push(cb);
        }

        emit(active) {
            this.listeners.forEach(cb => { try { cb(active, this.currentReason); } catch (e) { } });
        }

        start() {
            if (this.timer) return;
            this.tick();
            this.timer = setInterval(() => {
                try { this.tick(); } catch (e) { }
            }, this.TICK_MS);
        }

        // 当前页面上是否存在可见的验证弹窗；命中返回特征摘要，未命中返回 ''
        detectLocal() {
            const vw = window.innerWidth || 1920;
            const vh = window.innerHeight || 1080;
            for (const sel of this.SELECTORS) {
                let els = [];
                try { els = Array.from(document.querySelectorAll(sel)); } catch (e) { continue; }
                for (const el of els) {
                    if (!el || el === document.body || el === document.documentElement) continue;
                    // 聊天消息内容里带“验证”字样的不算弹窗
                    if (el.closest && el.closest('.chat-message')) continue;
                    const r = el.getBoundingClientRect();
                    if (r.width < 120 || r.height < 60 || r.bottom < 0 || r.top > vh) continue;
                    // 通配选择器可能是页内大容器，面积超半屏的跳过，避免误报
                    if (sel.indexOf('*') !== -1 && r.width * r.height > vw * vh * 0.55) continue;
                    if (el.tagName === 'IFRAME') return sel + '@' + ((el.getAttribute('src') || '').slice(0, 60));
                    const t = (el.innerText || el.textContent || '').replace(/\s+/g, '');
                    if (t && this.TEXT_RE.test(t)) return t.slice(0, 50);
                }
            }
            return '';
        }

        tick() {
            const reason = this.detectLocal();
            const now = Date.now();
            if (reason) {
                this.currentReason = reason;
                try { localStorage.setItem(this.STORAGE_KEY, JSON.stringify({ at: now, path: location.pathname, reason })); } catch (e) { }
            }
            let remote = false;
            try {
                const raw = localStorage.getItem(this.STORAGE_KEY);
                const info = raw ? JSON.parse(raw) : null;
                remote = !!(info && (now - info.at) < this.STALE_MS);
            } catch (e) { }
            const localNow = !!reason;
            if (localNow && !this.localActive) this.onLocalStart(reason);
            if (!localNow && this.localActive) this.onLocalEnd();
            this.localActive = localNow;
            // 验证持续期间周期性重复推微信，防止用户没看到第一条
            if (localNow && now - this.lastNotifyAt > this.RESHOW_MS) {
                this.lastNotifyAt = now;
                this.pushWechat(reason);
            }
            const eff = localNow || remote;
            if (eff !== this.active) {
                this.active = eff;
                this.emit(eff);
            }
        }

        onLocalStart(reason) {
            this.lastNotifyAt = Date.now();
            this.showBanner();
            this.startBeep();
            this.log('captcha_detected', { reason, href: location.href });
            this.pushWechat(reason);
        }

        onLocalEnd() {
            this.hideBanner();
            this.stopBeep();
            this.log('captcha_cleared', { href: location.href });
        }

        log(action, extra) {
            try {
                this.api = this.api || new Api();
                this.api.logAction({ action, scene: 'captcha', ...extra }).catch(() => { });
            } catch (e) { }
        }

        // 请求后端把提醒推到微信（需 user_config.json 配好 notify 段的 pushplus/server酱凭证）
        pushWechat(reason) {
            try {
                this.api = this.api || new Api();
                const t = new Date().toLocaleString('zh-CN', { hour12: false });
                this.api.notify({
                    key: 'captcha',
                    title: '⚠️ Boss直聘触发了机器人验证，请手动验证',
                    content: `<b>页面：</b>${location.href}<br><b>时间：</b>${t}<br><b>特征：</b>${reason || ''}<br>请尽快到浏览器里手动完成验证；自动投递已暂停，验证通过后会自动恢复。`,
                }).then(res => {
                    this.log('captcha_notify_result', { ok: !!(res && res.success), reason: (res && res.reason) || '' });
                    if (res && !res.success) banner(`微信推送未送达：${res.reason}`);
                }).catch(err => {
                    this.log('captcha_notify_result', { ok: false, reason: String(err) });
                });
            } catch (e) { }
        }

        showBanner() {
            if (this.bannerEl && this.bannerEl.isConnected) return;
            const el = document.createElement('div');
            el.style.cssText = `
                position: fixed;
                top: 0;
                left: 0;
                width: 100%;
                z-index: 99999;
                background-color: #e64545;
                color: #fff;
                text-align: center;
                padding: 10px 16px;
                font-size: 15px;
                font-weight: bold;
                box-shadow: 0 2px 8px rgba(0,0,0,.35);
            `;
            el.innerText = '⚠️ 检测到机器人验证，请在本页面手动完成验证！自动投递已暂停，验证通过后自动恢复（提醒已推送到微信）';
            document.body.appendChild(el);
            this.bannerEl = el;
        }

        hideBanner() {
            if (this.bannerEl) { try { this.bannerEl.remove(); } catch (e) { } this.bannerEl = null; }
        }

        beepOnce(freq = 880) {
            try {
                const AC = window.AudioContext || window.webkitAudioContext;
                if (!AC) return;
                this.audioCtx = this.audioCtx || new AC();
                const ctx = this.audioCtx;
                if (ctx.state === 'suspended') ctx.resume().catch(() => { });
                const osc = ctx.createOscillator();
                const gain = ctx.createGain();
                osc.type = 'square';
                osc.frequency.value = freq;
                gain.gain.setValueAtTime(0.001, ctx.currentTime);
                gain.gain.exponentialRampToValueAtTime(0.2, ctx.currentTime + 0.02);
                gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3);
                osc.connect(gain);
                gain.connect(ctx.destination);
                osc.start();
                osc.stop(ctx.currentTime + 0.32);
            } catch (e) { }
        }

        startBeep() {
            this.stopBeep();
            const burst = () => {
                this.beepOnce(880);
                setTimeout(() => this.beepOnce(660), 350);
            };
            burst();
            this.beepTimer = setInterval(burst, 8000);
        }

        stopBeep() {
            if (this.beepTimer) { clearInterval(this.beepTimer); this.beepTimer = null; }
        }
    }

    const captchaSentinel = new CaptchaSentinel();

    /**
     * 转换时间
     * @param {number} seconds 秒数
     * @returns {string} 转换后的时间字符串
     */
    function convertTime(seconds) {
        const hours = Math.floor(seconds / 3600);
        const minutes = Math.floor((seconds % 3600) / 60);
        const secs = seconds % 60;

        return `${hours.toString().padStart(2, 0)
            } : ${minutes.toString().padStart(2, 0)
            } : ${secs.toFixed(0).padStart(2, 0)
            }`;
    }


    class WebBroadcastError extends Error {
        constructor(code, message) {
            super(message);
            this.code = code;
            this.name = 'WebBroadcastError';
        }
    }

    class WebBroadcast {
        static ID_COUNTER = 0; // 自增序列，避免时间戳冲突

        /**
         * @param {string} name 频道名称
         * @param {string} target 当前页面标识
         * @param {object} [options] 配置项
         * @param {number} [options.retry=3] 发送失败重试次数
         * @param {number} [options.retryInterval=1000] 重试间隔(毫秒)
         */
        constructor(name, target, options = {}) {
            this.name = name;
            this.target = target;
            this.retry = options.retry ?? 3;
            this.retryInterval = options.retryInterval ?? 1000;
            this.evts = {};
            this.pendingResponses = {};
            this.pendingReceives = {};

            // 初始化通信通道
            this.initChannel();
        }

        /* -------------------- 核心通信逻辑 -------------------- */
        initChannel() {
            // 优先使用 BroadcastChannel
            if (typeof BroadcastChannel !== 'undefined') {
                this.setupBroadcastChannel();
            } else {
                this.setupStorageFallback();
            }
            window.addEventListener('beforeunload', () => this.destroy());
        }

        setupBroadcastChannel() {
            this.channelType = 'broadcast';
            this.channel = new BroadcastChannel(this.name);
            this.channel.addEventListener('message', this.handleMessage.bind(this));
            this.channel.addEventListener('messageerror', (e) => {
                this.emitError('MESSAGE_ERROR', '消息解析失败', e);
            });
        }

        setupStorageFallback() {
            this.channelType = 'storage';
            this.storageKey = `web_broadcast_${this.name}`;

            // 监听 storage 事件
            window.addEventListener('storage', (e) => {
                if (e.key === this.storageKey && e.newValue) {
                    const message = JSON.parse(e.newValue);
                    this.handleMessage({ data: message });
                }
            });
        }

        handleMessage(e) {
            const resp = e.data;
            if (![this.target, 'all'].includes(resp.to)) return;

            // 处理事件监听
            if (this.evts[resp.type]) {
                Promise.resolve().then(() => this.evts[resp.type](resp.from, resp.data));
            }

            // 处理 receive 等待
            const receiveKey = `${resp.from}-${resp.type}`;
            if (this.pendingReceives[receiveKey]) {
                const pending = this.pendingReceives[receiveKey];
                pending.resolve(resp.data);
                clearTimeout(pending.timer);
                delete this.pendingReceives[receiveKey];
            }

            // 处理 sendAndReceive 响应
            if (this.pendingResponses[resp.data?.requestId]) {
                const pending = this.pendingResponses[resp.data.requestId];
                pending.resolve(resp.data);
                clearTimeout(pending.timer);
                delete this.pendingResponses[resp.data.requestId];
            }
        }

        /* -------------------- 消息收发方法 -------------------- */
        send(to, type, data = null, attempt = 0) {
            const message = { from: this.target, to, type, data };

            return new Promise((resolve, reject) => {
                try {
                    if (this.channelType === 'broadcast') {
                        this.channel.postMessage(message);
                    } else {
                        // storage 方案需要先写入再删除，触发事件
                        localStorage.setItem(this.storageKey, JSON.stringify(message));
                        localStorage.removeItem(this.storageKey);
                    }
                    resolve();
                } catch (err) {
                    if (attempt < this.retry) {
                        setTimeout(() => this.send(to, type, data, attempt + 1), this.retryInterval);
                    } else {
                        this.emitError('SEND_FAILED', `消息发送失败: ${type}`, err);
                        reject(`消息发送失败: ${type}, ${err.message}`);
                    }
                }
            });
        }

        receive(from, type, timeout = 30000) {
            const key = `${from}-${type}`;
            return new Promise((resolve, reject) => {
                const timer = setTimeout(() => {
                    reject(new WebBroadcastError('TIMEOUT', `接收超时: ${type}`));
                    delete this.pendingReceives[key];
                }, timeout);

                this.pendingReceives[key] = { resolve, reject, timer };
            });
        }

        sendAndReceive(to, type, data = null, timeout = 30000) {
            const requestId = this.generateRequestId();
            const responseType = `${type}_response`;

            return new Promise((resolve, reject) => {
                const timer = setTimeout(() => {
                    reject(new WebBroadcastError('TIMEOUT', `请求超时: ${type}`));
                    delete this.pendingResponses[requestId];
                }, timeout);


                this.pendingResponses[requestId] = { resolve, reject, timer };
                // 发送时携带 responseType
                this.send(to, type, { ...data, requestId, responseType });
            });
        }

        reply(originalFrom, originalType, data, requestId, responseType) {
            const finalResponseType = responseType || `${originalType}_response`;
            return this.send(originalFrom, finalResponseType, { ...data, requestId });
        }

        /* -------------------- 工具方法 -------------------- */
        generateRequestId() {
            const time = Date.now().toString(36);
            const random = Math.random().toString(36).slice(2, 6);
            WebBroadcast.ID_COUNTER = (WebBroadcast.ID_COUNTER + 1) % 0xfff;
            return `${time}-${random}-${WebBroadcast.ID_COUNTER.toString(36).padStart(2, '0')}`;
        }

        emitError(code, message, error) {
            const err = new WebBroadcastError(code, `${message}: ${error?.message || error}`);
            console.error(err);
            if (this.evts['error']) {
                this.evts['error'](code, err.message);
            }
        }

        on(evt, fn) {
            if (typeof fn !== 'function') throw new Error('回调必须是函数');
            this.evts[evt] = fn;
        }

        off(evt) {
            delete this.evts[evt];
        }

        destroy() {
            if (this.channel) {
                this.channel.close();
            }
            window.removeEventListener('storage', this.handleMessage);
            this.pendingResponses = {};
            this.pendingReceives = {};
        }
    }

    // api请求
    class Api {
        constructor() { }

        /**
         * 封装请求
         * @param {string} path 请求路径
         * @param {string} method 请求方法
         * @param {any} data 请求数据
         * @returns {Promise<any>} 请求结果
         */
        __http(path, method = 'GET', data = null) {
            const start = performance.now();
            return new Promise(async (resolve, reject) => {
                GM.xmlHttpRequest({
                    method: method,
                    url: OPTIONS.serverHost + path,
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    data: data,
                    timeout: 1000 * 60 * 10,
                })
                    .then(resp => {
                        if (resp.status != 200) {
                            banner(`请求失败: ${resp.status}`);
                            reject(resp.status);
                            return;
                        }
                        resolve(JSON.parse(resp.response));
                    })
                    .catch((err) => {
                        banner('请求出错');
                        reject(`请求出错: ${JSON.stringify(err)}`);
                    });
            });
        }

        /**
         * 从本地服务拉取二进制资源（图片），返回 Blob
         * @param {string} path 路由
         */
        fetchBlob(path) {
            return new Promise((resolve, reject) => {
                GM.xmlHttpRequest({
                    method: 'GET',
                    url: OPTIONS.serverHost + path,
                    responseType: 'blob',
                    timeout: 1000 * 60,
                })
                    .then(resp => {
                        if (resp.status != 200 || !resp.response) {
                            reject(`fetch blob failed: ${resp.status}`);
                            return;
                        }
                        resolve(resp.response);
                    })
                    .catch((err) => {
                        reject(`fetch blob error: ${JSON.stringify(err)}`);
                    });
            });
        }

        /**
         * 获取自我介绍
         */
        getIntroduce() {
            return new Promise((resolve, reject) => this.__http('/get-introduce').then(res => {
                resolve(res.introduce);
            }).catch(reject));
        }

        /**
         * 获取标签
         */
        getTags() {
            return new Promise((resolve, reject) => this.__http('/tags').then(res => {
                resolve(res.tags);
            }).catch(reject));
        }

        /**
         * 获取前端运行配置
         */
        getClientConfig() {
            return new Promise((resolve, reject) => this.__http('/client-config').then(resolve).catch(reject));
        }

        /**
         * 获取职位匹配度
         * @param {string} title 职位标题
         * @param {string} salary 薪资范围
         * @param {string} detail 职位描述
         */
        getJobScore(title, salary, detail) {
            const data = `# 职位名称\n${title}\n\n# 薪资范围\n${salary}\n\n# 职位描述\n${detail}`;
            return new Promise((resolve, reject) => {
                this.__http('/get-job-score', 'POST', JSON.stringify(data)).then(resolve).catch(reject);
            });
        }

        /**
         * 回复消息
         * @param {string} msgs 消息记录
         */
        reply(msgs) {
            return new Promise((resolve, reject) => {
                this.__http('/reply', 'POST', JSON.stringify(msgs)).then(res => {
                    resolve(res);
                }).catch(reject);
            });
        }

        /**
         * 聊天截图+文本 → 视觉 LLM 决策回复
         * @param {object} payload {screenshot, msgs, recent, resumeSended, eduSent, jobTitle}
         */
        chatDecide(payload) {
            return new Promise((resolve, reject) => {
                this.__http('/chat-decide', 'POST', JSON.stringify(payload)).then(res => {
                    resolve(res);
                }).catch(reject);
            });
        }

        /**
         * 判断是否需要简历
         * @param {string} msgs 消息记录
         */
        isNeedResume(msgs) {
            return new Promise((resolve, reject) => {
                this.__http('/is-need-resume', 'POST', JSON.stringify(msgs)).then(res => {
                    resolve(res.need);
                }).catch(reject);
            });
        }

        /**
         * 判断是否需要作品集
         * @param {string} msgs 消息记录
         */
        isNeedWorks(msgs) {
            return new Promise((resolve, reject) => {
                this.__http('/is-need-works', 'POST', JSON.stringify(msgs)).then(res => {
                    resolve(res.need);
                }).catch(reject);
            });
        }

        /**
         * 记录动作日志
         * @param {object} payload 动作信息
         */
        logAction(payload) {
            return new Promise((resolve, reject) => {
                this.__http('/log-action', 'POST', JSON.stringify(payload)).then(resolve).catch(reject);
            });
        }

        /**
         * 请求后端发外部通知（如机器人验证→微信推送）
         * @param {object} payload {key, title, content}
         */
        notify(payload) {
            return new Promise((resolve, reject) => {
                this.__http('/notify', 'POST', JSON.stringify(payload)).then(resolve).catch(reject);
            });
        }
    }

    // 日志记录
    class Logger {
        constructor(startFn, pauseFn) {
            // 校验函数
            if (startFn && !Function.prototype.isPrototypeOf(startFn)) {
                throw new Error('参数错误，startFn应为函数');
            }
            if (pauseFn && !Function.prototype.isPrototypeOf(pauseFn)) {
                throw new Error('参数错误，pauseFn应为函数');
            }
            // 创建元素
            const ctn = document.createElement('div');
            const btnBox = document.createElement('div');
            const clearBtn = document.createElement('div');
            const runBtn = document.createElement('div');
            const foldBtn = document.createElement('div');
            const msgList = document.createElement('div');
            ctn.style.cssText = `
                position: fixed;
                bottom: 16px;
                left: 16px;
                width: 380px;
                background-color: rgba(0, 0, 0, 0.5);
                color: #fff;
                z-index: 9999;
                font-size: 14px;
                border-radius: 10px;
            `;
            btnBox.style.cssText = `
                width: 380px;
                height: 32px;
                display: flex;
                align-items: center;
                justify-content: flex-end;
            `;
            clearBtn.style.cssText = runBtn.style.cssText = foldBtn.style.cssText = `
                width: 60px;
                height: 32px;
                line-height: 32px;
                text-align: center;
                cursor: pointer;
            `;
            msgList.style.cssText = `
                width: 380px;
                height: 240px;
                padding: 2px 12px 8px;
                overflow-y: auto;
                display: flex;
                flex-direction: column;
                gap: 4px;
            `;
            clearBtn.innerText = "清空";
            runBtn.innerText = "开始";
            foldBtn.innerText = "收起";
            document.body.appendChild(ctn);
            ctn.appendChild(btnBox);
            btnBox.appendChild(clearBtn);
            btnBox.appendChild(runBtn);
            btnBox.appendChild(foldBtn);
            ctn.appendChild(msgList);
            this.ctn = ctn;
            this.list = msgList;
            this.runBtn = runBtn;
            this.clearBtn = clearBtn;
            this.__startFn = startFn || (() => void 0);
            this.__pauseFn = pauseFn || (() => void 0);
            this.__pause = true;
            clearBtn.addEventListener('click', () => this.clear());
            runBtn.addEventListener('click', () => {
                this.__pause = !this.__pause;
                if (this.__pause) {
                    runBtn.innerText = "继续";
                    this.__pauseFn();
                } else {
                    runBtn.innerText = "暂停";
                    this.__startFn();
                }
            });
            foldBtn.addEventListener('click', () => {
                if (foldBtn.innerText === "展开") {
                    msgList.style.height = "240px";
                    foldBtn.innerText = "收起";
                } else {
                    msgList.style.height = "32px";
                    this.list.scrollTop = this.list.scrollHeight;
                    foldBtn.innerText = "展开";
                }
            });
        }

        add(message) {
            const item = document.createElement('div');
            item.textContent = message;
            this.list.appendChild(item);
            this.list.scrollTop = this.list.scrollHeight;
        }

        divider() {
            const item = document.createElement('div');
            item.style.cssText = `
                width: 100%;
                border-top: 1px dashed rgba(255, 255, 255, 0.6);
            `;
            this.list.appendChild(item);
            this.list.scrollTop = this.list.scrollHeight;
        }

        clear() {
            while (this.list.firstChild) {
                this.list.removeChild(this.list.firstChild);
            }
        }

        remove() {
            this.ctn.remove();
        }
    }

    // boss 直聘
    class Zhipin {
        constructor() {
            // 窗口标签
            this.targets = {
                search: "__zhipin_search",
                detail: "__zhipin_detail",
                chat: "__zhipin_chat",
                chatGreet: "__zhipin_chat_greet",
            };
            // 广播类型
            this.bcTypes = {
                // 全局
                STATUS: "status",
                RUN: 'run',
                DIVIDER: 'divider',
                INTRODUCE: 'introduce',
                HEART_BEAT: 'heart-beat',
                // 聊天页和职位详情页
                GET_JOB_INFO: 'get-job-info',
                SAY_HI: 'say-hi',
            };
            // 白名单
            this.whiteList = WHITELIST.zhipin;
            // 记录状态
            this.pause = false;
            this.tags = [];
            this.introduce = ''
        }

        // 注册广播
        __broadcast(target) {
            this.broadcast = new WebBroadcast('__zhipin_broadcast', target);
        }

        // 搜索页
        async __search(tagIdx) {
            // api
            const api = new Api();
            // 记录开始时间
            const start = new Date().getTime();
            let count = 0;
            let page = 0;
            // 记录职位链接
            let jobHrefs = [];
            let elsLen = 0;
            // 缓存
            let started = false;
            let pendingRoundRestart = false;
            let roundTransitioning = false;
            let currentRound = 0;
            let emptyRounds = 0;
            let roundQueuedCount = 0;
            let currentKeyword = '';
            let currentTagIdx = -1;
            let dailyLimitReached = false; // 今日沟通是否已达上限（达上限后停止投递，只处理消息）
            // 上限状态必须落盘：搜索页一旦被刷新/重开，内存里的 dailyLimitReached、聊天窗口句柄和看门狗定时器会全部消失，
            // 新实例会以为还能投，既继续白发打招呼，又把纯消息复查链条一起带走（已读消息因此永远没人回）。按日期分键，次日自动失效。
            const dailyLimitStorageKey = () => {
                const d = new Date();
                const p = (n) => String(n).padStart(2, '0');
                return 'goodjobs_daily_limit:' + d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
            };
            const processedJobHrefs = new Set();

            // 日志启动暂停事件
            const logger = new Logger(() => {
                this.pause = false;
                if (!started) return main();
                if (pendingRoundRestart) {
                    pendingRoundRestart = false;
                    return startRound();
                }
                loop();
            }, () => {
                this.pause = true;
            });

            // 机器人验证联动：任一标签页（搜索/详情/聊天）弹出验证 → 自动暂停投递循环并推微信提醒，验证通过后自动恢复
            let captchaAutoPaused = false;
            captchaSentinel.onChange((active, reason) => {
                if (active) {
                    logger.add(`⚠️ 检测到机器人验证${reason ? `（${reason}）` : ''}，已暂停投递并推送微信提醒，请手动完成验证`);
                    if (started && !this.pause && logger.runBtn && logger.runBtn.isConnected) {
                        captchaAutoPaused = true;
                        logger.runBtn.click();
                    }
                } else {
                    if (!captchaAutoPaused) return;
                    captchaAutoPaused = false;
                    logger.add('机器人验证已通过，自动恢复投递');
                    if (this.pause && logger.runBtn && logger.runBtn.isConnected) {
                        logger.runBtn.click();
                    }
                }
            });

            // 自动开始：进入搜索页后无需手动点击"开始"
            if (OPTIONS.autoStart) {
                setTimeout(() => {
                    if (logger.runBtn && logger.runBtn.isConnected && logger.__pause) {
                        logger.add('自动开始已启用，自动点击开始');
                        logger.runBtn.click();
                    }
                }, OPTIONS.autoStartDelay || 3000);
            }

            // 开始广播
            const startBroadcast = () => {
                this.__broadcast(this.targets.search);
                // 接收聊天页的消息提醒
                this.broadcast.on(this.bcTypes.STATUS, (from, data) => {
                    if (from === this.targets.chat) {
                        logger.add(data);
                        // 聊天页每报一次状态就说明它还在干活，给看门狗续命，避免把“逐条慢处理”误判成卡死而关掉页面
                        try { beatChatRunWatchdog(); } catch (e) { }
                    }
                });
                // 发送自我介绍
                this.broadcast.on(this.bcTypes.INTRODUCE, (from, data) => {
                    this.broadcast.reply(
                        from,
                        this.bcTypes.INTRODUCE,
                        { introduce: this.introduce },
                        data.requestId,
                        data.responseType
                    );
                });
                // 分割线
                this.broadcast.on(this.bcTypes.DIVIDER, () => {
                    logger.divider();
                });
                // 监听打招呼
                greetListener();
                // 监听聊天页
                chatListener();
                // 心跳监听
                heartBeatListener();
            };

            // 执行搜索
            const search = async (kw) => {
                try {
                    const input = await tools.endlessFind(SELECTORS.ZHIPIN.SEARCH.SEARCHINPUT);
                    const btn = await tools.endlessFind(SELECTORS.ZHIPIN.SEARCH.SEARCHBTN);
                    tools.inputText(input, kw);
                    btn.click();
                } catch (e) {
                    logger.add('搜索出错');
                    throw new Error('搜索出错');
                }
            };

            // 获取职位链接
            const getJobHrefs = async () => {
                try {
                    const jobUl = await tools.endlessFind(SELECTORS.ZHIPIN.SEARCH.JOBLIST);
                    const aList = jobUl.querySelectorAll(SELECTORS.ZHIPIN.SEARCH.JOBHREFS);
                    const hrefs = Array.from(aList)
                        .map(a => a.href)
                        .slice(elsLen)
                        .filter(href => !processedJobHrefs.has(href));
                    return [hrefs, aList];
                } catch (e) {
                    logger.add('获取职位链接出错');
                    throw new Error('获取职位链接出错');
                }
            };

            const resetRoundState = () => {
                jobHrefs = [];
                elsLen = 0;
                page = 0;
                roundQueuedCount = 0;
                clearPendingGreet();
            };

            const activatePreloadCard = async (round) => {
                if (!OPTIONS.preloadActivateCardEvery || round % OPTIONS.preloadActivateCardEvery !== 0) return;
                try {
                    const jobUl = document.querySelector(SELECTORS.ZHIPIN.SEARCH.JOBLIST);
                    if (!jobUl) return;
                    const cards = Array.from(jobUl.querySelectorAll(SELECTORS.ZHIPIN.SEARCH.JOBCARD));
                    if (!cards.length) return;
                    const visibleCards = cards.filter(card => {
                        const rect = card.getBoundingClientRect();
                        return rect.top < window.innerHeight - 120 && rect.bottom > 120;
                    });
                    const targetCard = visibleCards[visibleCards.length - 1] || cards[cards.length - 1];
                    if (!targetCard) return;
                    targetCard.scrollIntoView({ block: 'center', behavior: 'smooth' });
                    await tools.asyncSleep(120);
                    targetCard.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window }));
                    targetCard.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, view: window }));
                    targetCard.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
                    logger.add(`预加载第 ${round} 轮：已轻点左侧岗位卡片`);
                    await tools.asyncSleep(OPTIONS.preloadActivateCardWaitMs);
                } catch (e) {
                    logger.add('预加载时轻点岗位卡片失败，已继续纯滚动');
                }
            };

            // 下一页
            const nextPage = async () => {
                while (true) {
                    let hrefs, els;
                    [hrefs, els] = await getJobHrefs();
                    if (els.length === elsLen) {
                        logger.add('没有更多职位了');
                        return false;
                    }
                    elsLen = els.length;
                    els[elsLen - 1].scrollIntoView();
                    page++;
                    logger.add(`开始浏览第 ${page} 页`);
                    if (hrefs.length) {
                        jobHrefs.push(...hrefs);
                        roundQueuedCount += hrefs.length;
                        logger.add(`本页新增 ${hrefs.length} 个未处理岗位`);
                        return true;
                    }
                    logger.add('本页新增岗位都已处理过，继续向下查找');
                    await tools.asyncSleep(OPTIONS.preloadScrollWaitMs);
                }
            };

            document.nextPage = nextPage

            let pendingGreetTimer = null;
            let pendingGreetTitle = '';
            let pendingGreetDecision = null;
            let pendingGreetWin = null;
            let chatProcWin = null;

            // 聊天阶段看门狗：聊天页迟迟不回就自救，避免永久卡死
            let chatRunTimer = null;
            let chatRunRetries = 0;

            const clearChatRunWatchdog = () => {
                if (chatRunTimer) {
                    clearTimeout(chatRunTimer);
                    chatRunTimer = null;
                }
                chatRunRetries = 0;
            };

            const armChatRunWatchdog = () => {
                // 每次重新计时时才读配置，保证 /client-config 下发的 chatRunIdleTimeoutMs 能生效
                const idleMs = OPTIONS.chatRunIdleTimeoutMs || 180000;
                if (chatRunTimer) clearTimeout(chatRunTimer);
                chatRunTimer = setTimeout(async () => {
                    chatRunTimer = null;
                    chatRunRetries += 1;
                    logger.add(`聊天页 ${Math.round(idleMs / 1000)} 秒无心跳（第 ${chatRunRetries} 次）`);
                    await logAction({
                        action: 'chat_run_timeout',
                        scene: 'search',
                        retry: chatRunRetries,
                    });
                    if (chatRunRetries < 2) {
                        logger.add('重新打开聊天页重试');
                        if (chatProcWin) { try { chatProcWin.close(); } catch (e) { } chatProcWin = null; }
                        chatProcWin = tools.openTabNSetTimestamp(this.whiteList.chat, this.targets.chat);
                        armChatRunWatchdog();
                    } else {
                        logger.add('聊天阶段多次超时，跳过本轮聊天继续扫描');
                        if (chatProcWin) { try { chatProcWin.close(); } catch (e) { } chatProcWin = null; }
                        clearChatRunWatchdog();
                        // 今日已达上限：不再投递，稍后重开聊天页继续处理消息
                        if (dailyLimitReached) {
                            await tools.asyncSleep(OPTIONS.dailyLimitChatIntervalMs);
                            return startChatProcessing();
                        }
                        const hasNext = await nextPage();
                        if (!hasNext) return handleRoundExhausted();
                        loop();
                    }
                }, idleMs);
            };

            // 心跳：仅在聊天页确实开着时续期看门狗
            const beatChatRunWatchdog = () => {
                if (chatProcWin) armChatRunWatchdog();
            };

            const clearPendingGreet = () => {
                if (pendingGreetTimer) {
                    clearTimeout(pendingGreetTimer);
                    pendingGreetTimer = null;
                }
                pendingGreetTitle = '';
                pendingGreetDecision = null;
                // 关闭打招呼标签页，避免堆积被休眠
                if (pendingGreetWin) {
                    const w = pendingGreetWin;
                    pendingGreetWin = null;
                    try { setTimeout(() => { try { w.close(); } catch (e) { } }, 1000); } catch (e) { }
                }
            };

            const armPendingGreet = (title, decision = null) => {
                clearPendingGreet();
                pendingGreetTitle = title;
                pendingGreetDecision = decision;
                pendingGreetTimer = setTimeout(() => {
                    logger.add(`职位 [${pendingGreetTitle}] 打招呼超时，已跳过`);
                    logAction({
                        action: 'greet_timeout',
                        scene: 'search',
                        title: pendingGreetTitle,
                        greetTimeout: OPTIONS.greetTimeout,
                    });
                    clearPendingGreet();
                    loop();
                }, OPTIONS.greetTimeout);
            };

            const handleRoundExhausted = async () => {
                if (roundTransitioning) return;
                roundTransitioning = true;
                try {
                    if (roundQueuedCount === 0) {
                        emptyRounds += 1;
                        logger.add(`第 ${currentRound} 轮没有拿到新岗位（连续空轮 ${emptyRounds}/${OPTIONS.maxEmptyRounds}）`);
                    } else {
                        emptyRounds = 0;
                        logger.add(`第 ${currentRound} 轮已处理完当前加载岗位，准备进入下一轮`);
                    }
                    if (emptyRounds >= OPTIONS.maxEmptyRounds) {
                        logger.add(`连续 ${OPTIONS.maxEmptyRounds} 轮没有新岗位，自动切换到下一个关键词继续挂机`);
                        emptyRounds = 0;
                        return startRound();
                    }
                    await tools.asyncSleep(OPTIONS.roundRestartDelayMs);
                    if (this.pause) {
                        pendingRoundRestart = true;
                        logger.add('当前已暂停，下一轮等待继续');
                        return;
                    }
                    await startRound();
                } finally {
                    roundTransitioning = false;
                }
            };

            // 打开聊天页处理消息（投递阶段结束后 / 今日达上限后共用）
            const startChatProcessing = () => {
                // 离开投递场景时才统一关闭详情窗口（此后不会紧接着同名 open，无竞态）
                closeDetailTab();
                if (chatProcWin) { try { chatProcWin.close(); } catch (e) { } chatProcWin = null; }
                chatProcWin = tools.openTabNSetTimestamp(this.whiteList.chat, this.targets.chat);
                armChatRunWatchdog();
            };

            // 今日沟通已达上限：停止投递，切换到消息界面处理聊天
            const handleDailyLimitReached = async () => {
                if (dailyLimitReached) return;
                dailyLimitReached = true;
                try { localStorage.setItem(dailyLimitStorageKey(), String(Date.now())); } catch (e) { }
                jobHrefs = [];
                clearPendingGreet();
                logger.divider();
                logger.add('检测到今日沟通已达上限（BOSS 提示"休息一下，明天再来"），今日投递结束，切换到消息界面处理聊天消息');
                await logAction({ action: 'daily_limit_reached', scene: 'search' });
                startChatProcessing();
            };

            const logAction = async (payload) => {
                try {
                    await api.logAction(payload);
                } catch (e) {
                    console.log('logAction failed', e);
                }
            };

            // 详情页标签管理：整个投递轮次复用同一个命名窗口，轮次内绝不关闭它。
            // 根因复盘：绝不能在 window.close() 之后立刻再 window.open(同名) —— 窗口是异步销毁的，
            // 在其名下资源尚未释放的间隙里发起的同名 open 会命中"正在关闭的窗口"、导航被丢弃，
            // 导致该岗位详情页脚本从不执行（后端日志里对应岗位连 script_injected 都没有），搜索页只能干等满 detailTimeout；
            // 而它超时后的下一轮 close 变成空操作、open 才真正建出新窗口，于是呈现"每超时一次紧接着一次成功"的固定节奏。
            // 复用同一命名窗口时 window.open 会让浏览器对该窗口做真实整页导航，脚本必然重新注入，无任何关闭竞态。
            let detailWin = null;
            const closeDetailTab = () => {
                if (detailWin) { const w = detailWin; detailWin = null; try { w.close(); } catch (e) { } }
            };

            // 获取职位信息
            const getJobInfo = async (href) => {
                // 复用命名窗口打开详情：不在此处关闭/重建窗口，规避"关闭后立刻重开同名窗口"的导航丢失竞态
                const win = tools.openTabNSetTimestamp(href, this.targets.detail);
                if (win) detailWin = win;
                // 接收职位信息
                const info = await this.broadcast.receive(
                    this.targets.detail,
                    this.bcTypes.GET_JOB_INFO,
                    OPTIONS.detailTimeout
                ).catch(() => ({
                    skip: true,
                    skipReason: `获取职位详情超时（>${(OPTIONS.detailTimeout / 1000).toFixed(0)}s）`,
                }));
                return info;
            };

            // 添加到聊天列表
            const addToChatList = async (url) => {
                return new Promise((resolve, reject) => {
                    fetch(url)
                        .then(async resp => {
                            if (!(resp.ok && resp.status === 200)) {
                                const bodyText = await resp.text().catch(() => '');
                                logger.add(`boss直聘网络连接出错: status=${resp.status}`);
                                return reject(new Error(`http_${resp.status}:${bodyText.slice(0, 300)}`));
                            }
                            return resp.json();
                        }).then(resp => {
                            if (resp.code === 0) return resolve(resp);
                                                        const dlg = resp?.zpData?.bizData?.chatRemindDialog;
                                                        const dlgContent = (dlg?.content || '').replace(/\s+/g, ' ').slice(0, 80);
                                                        const msg = dlg?.title
                                                            ? `${dlg.title}${dlgContent ? '：' + dlgContent : ''}`
                                                            : (resp?.message || '未知错误');
                            // 检测"今日沟通已达上限"提醒（如：您今天已与150位BOSS沟通，休息一下，明天再来吧~）
                            const limitText = `${dlg?.title || ''} ${dlg?.content || ''} ${resp?.message || ''}`.replace(/\s+/g, ' ');
                            if (/(明天再来|休息一下|已与\s*\d+\s*位|今日.{0,8}沟通|沟通.{0,4}上限|达.{0,4}上限)/.test(limitText)) {
                                logger.add(`今日沟通已达上限：${msg}`);
                                const limitErr = new Error(`daily_limit:${msg}`);
                                limitErr.dailyLimit = true;
                                return reject(limitErr);
                            }
                            logger.add(`打招呼失败: ${msg}`);
                            reject(new Error(`biz_fail:${msg}`));
                        }).catch(err => {
                            reject(err instanceof Error ? err : new Error(String(err)));
                        });
                });
            };

            // 打招呼监听
            const greetListener = () => {
                this.broadcast.on(this.bcTypes.SAY_HI, async (from, data) => {
                    if (from !== this.targets.chatGreet) return;
                    // 要自我介绍
                    if (data.requestId) {
                        this.broadcast.reply(
                            from,
                            this.bcTypes.SAY_HI,
                            {
                                introduce: pendingGreetDecision?.introduce || this.introduce,
                                resumeIndex: pendingGreetDecision?.resumeIndex ?? OPTIONS.resumeIndex,
                            },
                            data.requestId,
                            data.responseType
                        );
                        return;
                    }
                    // 告知结果
                    const finalDecision = pendingGreetDecision;
                    const finalTitle = pendingGreetTitle;
                    clearPendingGreet();
                    if (data.success) {
                        logger.add(`打招呼成功`);
                        await logAction({
                            action: 'greet_sent',
                            scene: 'search',
                            title: finalTitle,
                            resumeIndex: finalDecision?.resumeIndex ?? OPTIONS.resumeIndex,
                        });
                    }
                    // 出错了
                    else {
                        logger.add(`打招呼失败`);
                        await logAction({
                            action: 'greet_failed',
                            scene: 'search',
                            title: finalTitle,
                            resumeIndex: finalDecision?.resumeIndex ?? OPTIONS.resumeIndex,
                        });
                    }
                    loop();
                });
            };

            // 聊天页监听
            const chatListener = () => {
                this.broadcast.on(this.bcTypes.RUN, async (from, data) => {
                    if (from !== this.targets.chat) return;
                    clearChatRunWatchdog();
                    // 聊天处理完毕，关闭聊天标签页，下一轮需要时会重新打开新标签
                    if (chatProcWin) { const w = chatProcWin; chatProcWin = null; try { setTimeout(() => { try { w.close(); } catch (e) { } }, 1000); } catch (e) { } }
                    if (data) {
                        logger.divider();
                        // 今日已达上限：保持纯消息模式，稍后再次检查新消息，不再进入投递轮次
                        if (dailyLimitReached) {
                            logger.add('聊天消息处理完毕（今日投递已达上限），保持消息模式，稍后继续检查新消息');
                            await logAction({ action: 'daily_limit_chat_cycle', scene: 'search' });
                            await tools.asyncSleep(OPTIONS.dailyLimitChatIntervalMs);
                            return startChatProcessing();
                        }
                        // 聊天是在本轮岗位全部投递完之后才处理的，处理完直接进入下一轮
                        logger.add('聊天消息处理完毕，进入下一轮');
                        return handleRoundExhausted();
                    } else {
                        logger.add(`消息处理出错，重试中...`);
                        tools.openTabNSetTimestamp(this.whiteList.chat, this.targets.chat);
                    }
                });
            };

            // 心跳监听
            const heartBeatListener = () => {
                this.broadcast.on(this.bcTypes.HEART_BEAT, async (from, data) => {
                    this.broadcast.reply(
                        from,
                        this.bcTypes.HEART_BEAT,
                        { success: true },
                        data.requestId,
                        data.responseType
                    );
                });
            }

            // 循环
            const loop = async () => {
                try {
                    // 今日沟通已达上限：不再投递（保持只处理消息）
                    if (dailyLimitReached) return;
                    // 如果暂停，则跳过
                    if (this.pause) {
                        logger.add('暂停中...');
                        return;
                    }
                    logger.divider();
                    // 判断职位链接是否为空
                    if (jobHrefs.length === 0) {
                        // 先投递：尝试翻页加载更多岗位，只要还有就继续投递
                        const hasNext = await nextPage();
                        if (hasNext) return loop();
                        // 岗位已全部投递完毕
                        if (OPTIONS.onlyGreet) {
                            // 只打招呼、不代聊天，直接进入下一轮
                            return handleRoundExhausted();
                        }
                        // 投递完成后再统一处理聊天消息
                        logger.add('本轮岗位已全部投递，开始处理聊天消息');
                        startChatProcessing();
                        return;
                    }
                    // 抽取第一个
                    const href = jobHrefs.shift();
                    const diff = (new Date().getTime() - start) / 1000;
                    // 获取详情
                    logger.add(`| 浏览: ${++count} | 剩余: ${jobHrefs.length} | 平均: ${(diff / count).toFixed(0)}s | 耗时: ${convertTime(diff)} |`);
                    logger.add(`正在获取职位详情`);
                    const jobInfo = await getJobInfo(href);
                    if (jobInfo.skip) {
                        logger.add(`职位跳过: ${jobInfo.skipReason}`);
                        await logAction({
                            action: 'job_skip',
                            scene: 'search',
                            title: jobInfo.title || null,
                            salary: jobInfo.salary || null,
                            detail: jobInfo.detail || null,
                            reason: jobInfo.skipReason,
                        });
                        return loop();
                    }
                    processedJobHrefs.add(href);
                    // 如果聊过，下一个
                    if (jobInfo.talked) {
                        logger.add(`职位 [${jobInfo.title}] 已经聊过，下一个`);
                        await logAction({
                            action: 'job_already_talked',
                            scene: 'search',
                            title: jobInfo.title,
                            salary: jobInfo.salary,
                        });
                        return loop();
                    }
                    // HR 活跃状态过滤：仅当活跃状态在白名单内才打招呼，否则跳过
                    if (OPTIONS.requireHrActive) {
                        const active = (jobInfo.hrActive || '').trim();
                        const allowed = Array.isArray(OPTIONS.allowedHrActive) ? OPTIONS.allowedHrActive : [];
                        if (!active || allowed.indexOf(active) === -1) {
                            logger.add(`职位 [${jobInfo.title}] HR活跃状态[${active || '未识别'}]不在允许范围（${allowed.join('、')}），跳过`);
                            await logAction({
                                action: 'job_skip_inactive_hr',
                                scene: 'search',
                                title: jobInfo.title,
                                salary: jobInfo.salary,
                                hrActive: active || null,
                                reason: active ? `HR活跃状态[${active}]不在允许范围` : '未识别到HR活跃状态',
                            });
                            return loop();
                        }
                        logger.add(`职位 [${jobInfo.title}] HR活跃状态[${active}]，符合打招呼条件`);
                    }
                    // 否则发送消息计算匹配度
                    logger.add(`开始计算职位 [${jobInfo.title}] 的匹配度`);
                    const decision = await api.getJobScore(jobInfo.title, jobInfo.salary, jobInfo.detail);
                    logger.add(`匹配度: ${decision.score} | 命中匹配词: ${decision.matchedCount ?? '-'} | 简历索引: ${decision.resumeIndex}`);
                    await logAction({
                        action: 'job_decision_consumed',
                        scene: 'search',
                        title: jobInfo.title,
                        salary: jobInfo.salary,
                        score: decision.score,
                        resumeIndex: decision.resumeIndex,
                        hrActive: jobInfo.hrActive || null,
                        matchedCount: decision.matchedCount ?? null,
                    });
                    // 如果分数达到阈值，打个招呼
                    if (decision.score >= OPTIONS.thread) {
                        logger.add(`正在给职位 [${jobInfo.title}] 发送打招呼消息`);
                        await logAction({
                            action: 'greet_queued',
                            scene: 'search',
                            title: jobInfo.title,
                            salary: jobInfo.salary,
                            resumeIndex: decision.resumeIndex,
                            score: decision.score,
                            hrActive: jobInfo.hrActive || null,
                            matchedCount: decision.matchedCount ?? null,
                        });
                        // 判断是否有提醒返回
                        addToChatList(jobInfo.addUrl).then(async () => {
                            await logAction({
                                action: 'chat_open_requested',
                                scene: 'search',
                                title: jobInfo.title,
                                chatUrl: jobInfo.chatUrl,
                                resumeIndex: decision.resumeIndex,
                            });
                            armPendingGreet(jobInfo.title, decision);
                            pendingGreetWin = tools.openTabNSetTimestamp(jobInfo.chatUrl, this.targets.chatGreet);
                        }).catch(async (err) => {
                            await logAction({
                                action: 'greet_queue_failed',
                                scene: 'search',
                                title: jobInfo.title,
                                resumeIndex: decision.resumeIndex,
                                addUrl: jobInfo.addUrl,
                                chatUrl: jobInfo.chatUrl,
                                reason: String(err),
                            });
                            clearPendingGreet();
                            // 今日沟通已达上限 -> 停止投递，切换到消息界面处理聊天
                            if (err && err.dailyLimit) {
                                return handleDailyLimitReached();
                            }
                            loop();
                        });
                    }
                    // 否则下一轮
                    else {
                        await logAction({
                            action: 'job_below_threshold',
                            scene: 'search',
                            title: jobInfo.title,
                            salary: jobInfo.salary,
                            score: decision.score,
                            threshold: OPTIONS.thread,
                            resumeIndex: decision.resumeIndex,
                        });
                        loop();
                    }
                } catch (e) {
                    console.log(e);
                    logger.add(`循环时出错: ${e}`);
                    loop();
                }
            };

            const preloadJobs = async () => {
                logger.add('开始慢速预加载岗位列表');
                let stableRounds = 0;
                let lastCount = 0;
                let lastScrollY = -1;
                for (let round = 1; round <= OPTIONS.preloadMaxRounds; round++) {
                    const jobUl = await tools.endlessFind(SELECTORS.ZHIPIN.SEARCH.JOBLIST).catch(() => null);
                    const currentCount = jobUl ? jobUl.querySelectorAll(SELECTORS.ZHIPIN.SEARCH.JOBHREFS).length : 0;
                    window.scrollBy({ top: OPTIONS.preloadScrollPixels, left: 0, behavior: 'smooth' });
                    await tools.asyncSleep(OPTIONS.preloadScrollWaitMs);
                    await activatePreloadCard(round);
                    const afterJobUl = document.querySelector(SELECTORS.ZHIPIN.SEARCH.JOBLIST);
                    const afterCount = afterJobUl ? afterJobUl.querySelectorAll(SELECTORS.ZHIPIN.SEARCH.JOBHREFS).length : currentCount;
                    const afterY = window.scrollY;
                    logger.add(`预加载第 ${round} 轮：岗位 ${currentCount} -> ${afterCount}`);
                    if (afterCount > lastCount || afterY > lastScrollY) {
                        stableRounds = 0;
                    } else {
                        stableRounds += 1;
                    }
                    lastCount = Math.max(lastCount, afterCount);
                    lastScrollY = Math.max(lastScrollY, afterY);
                    if (stableRounds >= OPTIONS.preloadStableRoundsLimit) {
                        logger.add(`预加载结束：连续 ${stableRounds} 轮无新增岗位`);
                        break;
                    }
                }
                const finalJobUl = document.querySelector(SELECTORS.ZHIPIN.SEARCH.JOBLIST);
                const finalCount = finalJobUl ? finalJobUl.querySelectorAll(SELECTORS.ZHIPIN.SEARCH.JOBHREFS).length : 0;
                logger.add(`预加载完成，当前已加载岗位数：${finalCount}`);
            };

            const pickNextKeyword = () => {
                if (!this.tags || !this.tags.length) {
                    throw new Error('未获取到岗位关键词列表');
                }
                currentTagIdx = (currentTagIdx + 1) % this.tags.length;
                currentKeyword = this.tags[currentTagIdx];
                return currentKeyword;
            };

            const startRound = async () => {
                resetRoundState();
                // 进入新一轮前清掉上一轮遗留的详情窗口（此后要经过搜索+等待才会开新详情，非紧邻同名 open，安全）
                closeDetailTab();
                currentRound += 1;
                const keyword = pickNextKeyword();
                logger.divider();
                logger.add(`开始第 ${currentRound} 轮`);
                logger.add(`本轮搜索关键词：${keyword}`);
                window.scrollTo({ top: 0, left: 0, behavior: 'smooth' });
                await tools.asyncSleep(600);
                await search(keyword);
                logger.add(`第 ${currentRound} 轮已完成搜索（关键词：${keyword}），请在 ${(OPTIONS.manualFilterWaitMs / 1000).toFixed(0)} 秒内手动选择地区、薪资等筛选条件`);
                await tools.asyncSleep(OPTIONS.manualFilterWaitMs);
                await preloadJobs();
                logger.add(`第 ${currentRound} 轮开始按当前筛选条件扫描岗位（关键词：${keyword}）`);
                loop();
            };

            // 主函数
            const main = async () => {
                started = true;
                logger.add('--程序启动--');
                // 开始广播
                startBroadcast();
                // 获取统一配置
                const clientConfig = await api.getClientConfig().catch((e) => {
                    logger.add('获取统一配置失败，将回退旧接口');
                    return null;
                });
                if (clientConfig && clientConfig.frontend) {
                    Object.assign(OPTIONS, clientConfig.frontend);
                    if (clientConfig.autoReply) Object.assign(AUTO_REPLY, clientConfig.autoReply);
                    logger.add('获取前端配置成功');
                }
                if (clientConfig && Array.isArray(clientConfig.tags) && clientConfig.tags.length) {
                    this.tags = clientConfig.tags;
                    logger.add('获取标签成功: ' + this.tags.join('、'));
                } else {
                    this.tags = await api.getTags();
                    logger.add('获取标签成功(旧接口): ' + this.tags.join('、'));
                }
                if (typeof tagIdx === 'number' && this.tags.length) {
                    currentTagIdx = ((tagIdx % this.tags.length) + this.tags.length) % this.tags.length - 1;
                }
                if (clientConfig && typeof clientConfig.introduce === 'string' && clientConfig.introduce) {
                    this.introduce = clientConfig.introduce;
                    logger.add('获取自我介绍成功');
                } else {
                    this.introduce = await api.getIntroduce();
                    logger.add('获取自我介绍成功(旧接口)');
                }
                // 页面重开后从本地记录恢复“今日已达上限”状态，直接回到纯消息模式继续复查
                if (localStorage.getItem(dailyLimitStorageKey())) {
                    dailyLimitReached = true;
                    logger.add('本地记录显示今日沟通已达上限，跳过投递，直接进入消息模式复查新消息');
                    await logAction({ action: 'daily_limit_restored', scene: 'search' });
                    return startChatProcessing();
                }
                await startRound();
            };

            // 初始化
            const init = () => {
                // 如果时间戳小于阈值，直接运行
                if (start - tools.getTimestamp(this.targets.search) < OPTIONS.timestampTimeout) {
                    logger.runBtn.click();
                }
            };

            init();
        }

        // 详情页
        __detail() {
            // 注册广播
            const startBroadcast = () => {
                this.__broadcast(this.targets.detail);
            };
            startBroadcast();

            // 抓取招聘者(HR/Boss)活跃状态文案，归一化去除空白；找不到返回 ''
            const getHrActiveText = () => {
                const ACTIVE_RE = /(刚刚活跃|今[日天]活跃|\d+日内活跃|本周活跃|\d+周内活跃|半月前活跃|本月活跃|\d+个?月前活跃|近半年活跃|半年前活跃|长期未活跃|未活跃)/;
                const pick = (el) => {
                    if (!el) return '';
                    const t = (el.innerText || el.textContent || '').replace(/\s+/g, '');
                    const m = t.match(ACTIVE_RE);
                    return m ? m[0] : '';
                };
                // 优先在招聘者信息相关容器内查找
                const containers = document.querySelectorAll('.job-boss-info, .boss-info, .boss-info-attr, .info-public, .job-detail-boss, .boss-name-box');
                for (const c of containers) {
                    const s = pick(c);
                    if (s) return s;
                }
                // 兜底：全页文本扫描（活跃状态文案具有唯一性，误匹配概率低）
                return pick(document.body);
            };

            // 获取职位信息；核心 DOM 未就绪（SPA 未渲染/异常页面）时返回 null 供上层重试
            const collectJobInfo = () => {
                const chatBtn = document.querySelector(SELECTORS.ZHIPIN.DETAIL.STARTCHAT);
                const nameBox = document.querySelector(SELECTORS.ZHIPIN.DETAIL.NAMEBOX);
                const jobNameEl = nameBox && nameBox.querySelector(SELECTORS.ZHIPIN.DETAIL.JOBNAME);
                const salaryEl = nameBox && nameBox.querySelector(SELECTORS.ZHIPIN.DETAIL.SALARY);
                const detailEl = document.querySelector(SELECTORS.ZHIPIN.DETAIL.DETAIL);
                if (!nameBox || !jobNameEl || !detailEl) return null;
                const title = jobNameEl.innerText;
                const salary = salaryEl ? (salaryEl.innerText || salaryEl.textContent || '') : '';
                const detail = detailEl.innerText;
                const actionText = chatBtn ? chatBtn.innerText.trim() : '';
                const chatUrl = chatBtn && chatBtn.getAttribute(SELECTORS.ZHIPIN.DETAIL.CHATURL);
                const addUrl = chatBtn && chatBtn.dataset.url;
                const hrActive = getHrActiveText(); // HR 活跃状态（用于活跃过滤）
                let skip = false;
                let skipReason = '';

                if (!chatBtn) {
                    skip = true;
                    skipReason = '未找到立即沟通按钮';
                } else if (actionText.indexOf('立即沟通') === -1) {
                    skip = true;
                    skipReason = `按钮为 [${actionText || '未知'}]，疑似网申岗位`;
                } else if (!chatUrl || !addUrl) {
                    skip = true;
                    skipReason = '缺少聊天链接，疑似异常岗位';
                }

                return {
                    title,
                    salary,
                    detail,
                    actionText,
                    chatUrl,
                    addUrl,
                    skip,
                    skipReason,
                    hrActive,
                    talked: chatBtn && chatBtn.dataset.isfriend === 'true',
                };
            };

            // 异常兜底信息：保证搜索/聊天页一定收到回传，避免干等满超时
            const makeFailInfo = (reason) => ({
                title: '',
                salary: '',
                detail: '',
                actionText: '',
                chatUrl: '',
                addUrl: '',
                skip: true,
                skipReason: reason,
                hrActive: '',
                talked: false,
            });

            // 来自搜索页
            const fromSearchPage = (info) => {
                // 把职位信息发送给搜索页
                this.broadcast.send(this.targets.search, this.bcTypes.GET_JOB_INFO, info);
            };

            // 来自聊天页
            const fromChatPage = (info) => {
                // 把职位信息发送给聊天页
                this.broadcast.send(
                    this.targets.chat,
                    this.bcTypes.GET_JOB_INFO,
                    info
                ).then(() => {
                    window.close();
                });
            };

            // 主函数
            const main = () => {
                // 判断来源
                const now = new Date().getTime();
                const isFromSearch = now - tools.getTimestamp(this.targets.detail) < OPTIONS.timestampTimeout && window.name === this.targets.detail;
                const isFromChat = now - tools.getTimestamp(this.targets.chat) < OPTIONS.timestampTimeout;
                // 手动浏览的详情页：不回传
                if (!isFromSearch && !isFromChat) return;

                const dispatch = (info) => {
                    if (isFromSearch) fromSearchPage(info);
                    else fromChatPage(info);
                };

                // 轮询等待核心 DOM 就绪（详情页为 SPA 渲染，后台标签节流下可能迟迟未绘制）
                // 关键修复：搜索页最多等 detailTimeout，本端必须在它放弃前至少 5 秒回传，
                // 否则慢加载/被节流的标签页会拖过搜索页超时点，误报"获取职位详情超时"并跳过岗位。
                let deadline;
                if (isFromSearch) {
                    const openedAt = tools.getTimestamp(this.targets.detail);
                    const dispatchBy = openedAt + OPTIONS.detailTimeout - 5000;
                    deadline = Math.min(now + 20000, Math.max(now, dispatchBy));
                } else {
                    deadline = now + 20000;
                }
                const tick = () => {
                    let info = null;
                    let errReason = '';
                    try {
                        info = collectJobInfo();
                    } catch (e) {
                        errReason = '详情采集异常: ' + (e && e.message ? e.message : String(e));
                    }
                    if (!info && !errReason && new Date().getTime() < deadline) {
                        setTimeout(tick, 300);
                        return;
                    }
                    if (!info) info = makeFailInfo(errReason || '详情页DOM未就绪（疑似安全验证/职位下架/渲染过慢）');
                    dispatch(info);
                };
                tick();
            };
            main();
        }

        // 聊天页
        async __chat() {
            // 注册广播
            const startBroadcast = (target = this.targets.chat) => {
                this.__broadcast(target);
            };

            // 全局日志回传（main / sayHi / chat 都要用，必须在最外层定义）
            const api = new Api();
            const logAction = async (payload) => {
                try {
                    await api.logAction(payload);
                } catch (e) {
                    console.log('logAction failed', e);
                }
            };

            // 发送消息
            const sendMsg = (text) => {
                return new Promise(async (resolve, reject) => {
                    try {
                        const ipt = await tools.endlessFind(SELECTORS.ZHIPIN.CHAT.CHATINPUT);
                        ipt.innerText = text;
                        await tools.asyncSleep(600);
                        const btn = await tools.endlessFind(SELECTORS.ZHIPIN.CHAT.MSGSEND);
                        btn.click();
                        resolve();
                    } catch (e) {
                        reject();
                    }
                })
            };

            // 打招呼
            const sayHi = async () => {
                await logAction({ action: 'sayhi_started', scene: 'chat_greet' });
                startBroadcast(this.targets.chatGreet);

                // 心跳 
                let count = 0;
                const loop = () => {
                    this.broadcast.sendAndReceive(
                        this.targets.search,
                        this.bcTypes.HEART_BEAT,
                        { count: ++count }
                    ).then((res) => {
                        if (res.success) {
                            setTimeout(loop, 1000);
                        } else {
                            throw new Error('心跳失联');
                        }
                    });
                };
                loop();

                try {
                    const greetDecision = await this.broadcast.sendAndReceive(this.targets.search, this.bcTypes.SAY_HI);
                    const introduce = greetDecision.introduce;
                    await sendMsg(introduce);
                    await logAction({
                        action: 'greet_message_sent',
                        scene: 'chat_greet',
                        resumeIndex: greetDecision.resumeIndex ?? OPTIONS.resumeIndex,
                    });
                    this.broadcast.send(this.targets.search, this.bcTypes.SAY_HI, { success: true }).then(() => {
                        this.broadcast.destroy();
                    });
                } catch (e) {
                    await logAction({
                        action: 'greet_message_failed',
                        scene: 'chat_greet',
                        reason: String(e),
                    });
                    this.broadcast.send(this.targets.search, this.bcTypes.SAY_HI, { success: false }).then(() => {
                        this.broadcast.destroy();
                    });
                }
            };

            // 获取聊天记录信息
            const getChatInfo = async () => {
                const ctn = await tools.endlessFind(SELECTORS.ZHIPIN.CHAT.HISTORYCTN);

                const getMsgs = async () => {
                    const lis = Array.from(ctn.querySelectorAll(SELECTORS.ZHIPIN.CHAT.USEFULMSG));
                    // 提取历史记录
                    const msgs = [];
                    lis.forEach(li => {
                        const role = li.classList.contains('item-friend') ? 'user' : 'assistant';
                        const msgBox = li.querySelector(SELECTORS.ZHIPIN.CHAT.MSGCONTENT);
                        if (!msgBox) return;
                        msgs.push({
                            role,
                            content: msgBox.innerText,
                        });
                    });
                    // 提取简历，作品集状态
                    let needResume = 0;
                    let needWorks = 0;
                    let resumeSended = false;
                    let worksSended = false;
                    let confirmAddr = false;
                    // 判断聊天字眼中是否有相关信息
                    msgs.reverse();
                    let recent = '';
                    for (const msg of msgs) {
                        if (msg.role !== 'user') {
                            break;
                        }
                        recent += msg.content;
                    }
                    msgs.reverse();
                    if (recent.indexOf('简历') !== -1) {
                        needResume = 1;
                    }
                    if (recent.indexOf('作品') !== -1) {
                        needWorks = 1;
                    }
                    // 判断是否有过明确弹窗
                    const rlis = lis.reverse();
                    for (const li of rlis) {
                        if (li.classList.contains('item-myself')) {
                            break;
                        }
                        const bossGreen = li.querySelector('.boss-green');
                        const dialog = li.querySelector('.item-dialog');
                        if (bossGreen) {
                            const t = bossGreen.innerText;
                            if (t.indexOf('我想要一份您的附件简历，您是否同意\n拒绝\n同意') !== -1) {
                                needResume = 2;
                            }
                        } else if (dialog) {
                            const t = dialog.querySelector('.msg-dialog-title').innerText;
                            if (t.indexOf('您是否接受此工作地点?') !== -1) {
                                confirmAddr = true;
                            }
                        }
                    }
                    // 判断是否发过简历
                    const bossGreen = ctn.querySelectorAll('.boss-green');
                    if (bossGreen.length) {
                        bossGreen.forEach(el => {
                            const t = el.innerText;
                            if (t.indexOf('点击预览附件简历') !== -1) {
                                resumeSended = true;
                            }
                        });
                    }
                    return {
                        msgs,
                        recent,
                        needResume,
                        needWorks,
                        resumeSended,
                        worksSended,
                        confirmAddr,
                        talked: !msgs.every(d => d.role === 'user'),
                        jobEl: (await tools.endlessFind(SELECTORS.ZHIPIN.CHAT.JOBEL)).querySelector(SELECTORS.ZHIPIN.CHAT.JOBCITY)
                    };
                };

                const scroll2Top = async () => {
                    if (ctn.scrollTop === 0) return;
                    ctn.scrollTop = 0;
                    await tools.asyncSleep(300);
                    await scroll2Top();
                };

                // 滚动到顶部
                await tools.asyncSleep(300);
                await scroll2Top();
                // 获取聊天记录
                return await getMsgs();
            };

            // 用 html2canvas 截取聊天记录容器 → JPEG data URL；失败返回 ''（跨域污染/未引入库等）
            const captureChatScreenshot = async () => {
                try {
                    const cfg = AUTO_REPLY.llm_chat || {};
                    if (cfg.use_screenshot === false) return '';
                    const h2c = (typeof html2canvas === 'function') ? html2canvas
                        : (typeof window !== 'undefined' && typeof window.html2canvas === 'function' ? window.html2canvas : null);
                    if (!h2c) { console.log('html2canvas 未加载，跳过截图'); return ''; }
                    const target = document.querySelector(SELECTORS.ZHIPIN.CHAT.HISTORYCTN);
                    if (!target) return '';
                    // getChatInfo 会把聊天记录滚到顶部，这里滚回底部以截取最近对话
                    try { target.scrollTop = target.scrollHeight; } catch (e) { }
                    await tools.asyncSleep(350);
                    const quality = typeof cfg.jpeg_quality === 'number' ? cfg.jpeg_quality : 0.8;
                    const maxWidth = typeof cfg.max_width === 'number' ? cfg.max_width : 720;
                    const canvas = await h2c(target, {
                        useCORS: true,
                        allowTaint: false,
                        backgroundColor: '#ffffff',
                        logging: false,
                        // 跳过跨域头像/图片，避免画布被污染导致 toDataURL 抛错
                        ignoreElements: (el) => {
                            if (!el || !el.tagName) return false;
                            const cls = typeof el.className === 'string' ? el.className : ((el.getAttribute && el.getAttribute('class')) || '');
                            if (/avatar|figure/i.test(cls)) return true;
                            if (el.tagName.toLowerCase() === 'img') {
                                const src = el.src || '';
                                try { if (src && new URL(src, location.href).origin !== location.origin) return true; } catch (e) { return true; }
                            }
                            return false;
                        },
                    });
                    let out = canvas;
                    if (canvas.width > maxWidth) {
                        const scale = maxWidth / canvas.width;
                        const scaled = document.createElement('canvas');
                        scaled.width = Math.max(1, Math.round(canvas.width * scale));
                        scaled.height = Math.max(1, Math.round(canvas.height * scale));
                        scaled.getContext('2d').drawImage(canvas, 0, 0, scaled.width, scaled.height);
                        out = scaled;
                    }
                    return out.toDataURL('image/jpeg', quality);
                } catch (e) {
                    console.log('captureChatScreenshot failed', e);
                    return '';
                }
            };
            window.__captureChatScreenshot = captureChatScreenshot; // 手动测试钩子：await __captureChatScreenshot()

            // 手动测试钩子：聊天页控制台 await __chatDecideTest()，返回 LLM 决策 JSON（不执行发送）
            window.__chatDecideTest = async () => {
                const info = await getChatInfo();
                const shot = await captureChatScreenshot();
                const key = 'goodjobs_edu_img:' + ((new URLSearchParams(location.search).get('id')) || 'default');
                const eduSent = !!localStorage.getItem(key) || !!document.querySelector('.item-myself .message-content img, .item-myself img:not([class*=avatar])');
                return await api.chatDecide({
                    screenshot: shot,
                    msgs: (info.msgs || []).slice(-20).map(m => ({ role: m.role, content: String(m.content || '').slice(0, 500) })),
                    recent: info.recent || '',
                    resumeSended: !!info.resumeSended,
                    eduSent,
                    jobTitle: '',
                });
            };

            // HR 发来“我想要一份您的附件简历，您是否同意”这类系统卡片时，直接点「同意」比找“发简历”按钮更可靠
            const clickResumeConsentDialog = () => {
                try {
                    const leaves = Array.from(document.querySelectorAll('button, a, span, div'))
                        .filter(el => /^(同意|接受|确认同意|同意发送)$/.test((el.innerText || '').trim()));
                    for (const el of leaves) {
                        let node = el;
                        for (let depth = 0; node && depth < 6; depth++, node = node.parentElement) {
                            const t = node.innerText || node.textContent || '';
                            if (t.indexOf('附件简历') !== -1 || t.indexOf('是否同意') !== -1) {
                                el.click();
                                return true;
                            }
                        }
                    }
                } catch (e) { }
                return false;
            };

            // 发送简历
            const sendResume = async (resumeIndex = OPTIONS.resumeIndex) => {
                // 优先响应“求简历”确认卡片：此时聊天区往往没有“发简历”按钮，硬找会空等数十秒后报“未找到目标元素”
                if (clickResumeConsentDialog()) {
                    await tools.asyncSleep(500);
                    return {
                        mode: 'consent_dialog',
                        selectedResumeIndex: resumeIndex,
                    };
                }
                const sendBtn = await tools.endlessFind(SELECTORS.ZHIPIN.CHAT.RESUMESEND);
                sendBtn.click();

                // 可能是弹一个小窗
                const smallDialog = await tools.endlessFind(SELECTORS.ZHIPIN.CHAT.RESUMEMODAL).catch(() => null);
                if (smallDialog) {
                    smallDialog.querySelector(SELECTORS.ZHIPIN.CHAT.RESUMEMODALCONFIRM).click();
                    await sendMsg('已发送，请查收');
                    return {
                        mode: 'small_dialog',
                        selectedResumeIndex: resumeIndex,
                    };
                }

                // 弹出大窗让选择
                const resumeCtn = await tools.endlessFind(SELECTORS.ZHIPIN.CHAT.RESUMELIST);
                const confirm = await tools.endlessFind(SELECTORS.ZHIPIN.CHAT.RESUMESENDCONFIRM);
                const resumes = resumeCtn.querySelectorAll(SELECTORS.ZHIPIN.CHAT.RESUMELISTITEM);
                const fallbackIndex = resumes[resumeIndex] ? resumeIndex : (resumes[OPTIONS.resumeIndex] ? OPTIONS.resumeIndex : 0);
                const resume = resumes[fallbackIndex];
                await tools.asyncSleep(300);
                resume.click();
                await tools.asyncSleep(300);
                confirm.click();
                await sendMsg('已发送，请查收');
                return {
                    mode: 'resume_list',
                    selectedResumeIndex: fallbackIndex,
                };
            };

            // 发送作品集
            const sendWorks = async () => {
                logger.add('sendWks');
            };

            // 尝试点击“工作地点确认”系统弹窗里的接受按钮（找不到则返回 false，降级为发文字）
            const clickDialogAccept = () => {
                try {
                    const dialogs = Array.from(document.querySelectorAll('.item-dialog')).reverse();
                    for (const dlg of dialogs) {
                        const title = dlg.querySelector('.msg-dialog-title');
                        if (!title || title.innerText.indexOf('您是否接受此工作地点') === -1) continue;
                        const candidates = Array.from(dlg.querySelectorAll('button, a, span, div, [class*="btn"]'));
                        const accept = candidates.find(b => /^(接受|同意|确认|接受并继续|确认接受)$/.test((b.innerText || '').trim()));
                        if (accept) { accept.click(); return true; }
                    }
                } catch (e) { }
                return false;
            };

            let logger = null;
            // 给搜索页同步状态
            const status = (text) => {
                logger && logger.add(text);
                this.broadcast && this.broadcast.send(
                    this.targets.search,
                    this.bcTypes.STATUS,
                    text
                );
            };
            // 分割线
            const divider = () => {
                logger && logger.divider();
                this.broadcast && this.broadcast.send(this.targets.search, this.bcTypes.DIVIDER);
            };

            // 聊天
            const chat = async () => {
                // api
                const api = new Api();
                const logAction = async (payload) => {
                    try {
                        await api.logAction(payload);
                    } catch (e) {
                        console.log('logAction failed', e);
                    }
                };
                // 开始广播
                startBroadcast(this.targets.chat);
                // 获取默认自我介绍（兜底）
                const defaultIntroduce = (await this.broadcast.sendAndReceive(
                    this.targets.search,
                    this.bcTypes.INTRODUCE,
                )).introduce;
                // 心跳
                let count = 0;
                const loop = async () => {
                    await this.broadcast.sendAndReceive(
                        this.targets.search,
                        this.bcTypes.HEART_BEAT,
                        { count: ++count }
                    ).then((res) => {
                        if (res.success) {
                            setTimeout(loop, 1000);
                        } else {
                            throw new Error('心跳失联');
                        }
                    });
                };
                loop();

                // 一轮
                let round = 0;
                let lastTop = 0;
                // 解析联系人列表项里的时间（如 16:46 / 昨天），用于兜底识别“已读但没回”的会话
                const parseContactItemTime = (item) => {
                    try {
                        const nodes = Array.from(item.querySelectorAll('span, div, time, p'));
                        for (const el of nodes) {
                            const t = (el.innerText || '').trim();
                            if (!t || t.length > 12) continue;
                            const m = t.match(/(\d{1,2}):(\d{2})\s*$/);
                            if (m) {
                                const d = new Date();
                                d.setHours(Number(m[1]), Number(m[2]), 0, 0);
                                // 显示时间比当前还晚，说明是昨天及更早的会话
                                if (d.getTime() > Date.now() + 5 * 60 * 1000) d.setDate(d.getDate() - 1);
                                return d.getTime();
                            }
                            if (/^昨天/.test(t)) {
                                const d = new Date();
                                d.setDate(d.getDate() - 1);
                                d.setHours(12, 0, 0, 0);
                                return d.getTime();
                            }
                        }
                    } catch (e) { }
                    return 0;
                };
                const once = async () => {
                    // 获取联系人列表
                    let empty = false;
                    const ctn = await tools.endlessFind(SELECTORS.ZHIPIN.CHAT.CONTACTLIST).catch(e => {
                        if (document.querySelector(SELECTORS.ZHIPIN.CHAT.CONTACTLISTEMPTY)) {
                            status('当前暂无消息');
                            empty = true;
                        }
                    });
                    if (empty) return;
                    const lis = ctn.querySelectorAll(SELECTORS.ZHIPIN.CHAT.CONTACTLISTITEM);
                    // 遍历新消息
                    for (const ls of lis) {
                        try {
                            // 获取联系人信息
                            const name = ls.querySelector(SELECTORS.ZHIPIN.CHAT.USERNAME);
                            if (!name) continue;
                            const company = (name.nextElementSibling && name.nextElementSibling.innerText) || '';
                            const seenKey = 'goodjobs_contact_seen:' + company + '|' + (name.innerText || '').trim();
                            const lastSeenAt = Number(localStorage.getItem(seenKey) || 0);
                            const hasUnread = !!ls.querySelector(SELECTORS.ZHIPIN.CHAT.NEWMSGNOTICE);
                            const itemAt = parseContactItemTime(ls);
                            // 兜底：人工点开会话会把未读红点消掉，只认红点会导致 HR 的消息永远没人回；
                            // 列表时间比上次复查记录更新、且在复查窗口内的会话也要进来复查（后面有“最后一条是自己发的就跳过”的保护）
                            const pendingCheck = !!itemAt && itemAt > Math.max(lastSeenAt, Date.now() - (OPTIONS.chatRecheckWindowMs || 1800000));
                            if (!hasUnread && !pendingCheck) continue;
                            divider();
                            status(hasUnread ? `[${company} - ${name.innerText}] 发来一条新消息` : `[${company} - ${name.innerText}] 无未读标记，复查是否有待回复消息`);
                            // 进入聊天界面
                            name.click();
                            // 记下本次复查时间，避免同一已读会话每轮被重复点开
                            try { localStorage.setItem(seenKey, String(Date.now())); } catch (e) { }
                            // 获取聊天记录信息
                            const chatInfo = await getChatInfo();
                            // 如果最新的是我的回复
                            const lastMsg = chatInfo.msgs.slice(-1)[0];
                            if (lastMsg && lastMsg.role === 'assistant') continue;
                            // 如果以前没聊过
                            if (!chatInfo.talked) {
                                localStorage.setItem(this.targets.chat, new Date().getTime());
                                chatInfo.jobEl.click();
                                status(`正在获取职位详情`);
                                const jobInfo = await this.broadcast.receive(this.targets.detail, this.bcTypes.GET_JOB_INFO);
                                // 获取职位匹配度
                                status(`开始计算职位 [${jobInfo.title}] 的匹配度`);
                                const decision = await api.getJobScore(jobInfo.title, jobInfo.salary, jobInfo.detail);
                                status(`匹配度: ${decision.score} | 简历索引: ${decision.resumeIndex}`);
                                await logAction({
                                    action: 'job_decision_consumed',
                                    scene: 'chat',
                                    title: jobInfo.title,
                                    salary: jobInfo.salary,
                                    score: decision.score,
                                    resumeIndex: decision.resumeIndex,
                                });
                                // 如果分数达到阈值并且未聊过天，打个招呼
                                if (decision.score >= OPTIONS.thread && !chatInfo.msgs.length) {
                                    status(`正在给职位 [${jobInfo.title}] 发送打招呼消息`);
                                    try {
                                        await sendMsg(decision.introduce || defaultIntroduce);
                                        await logAction({
                                            action: 'chat_greet_sent',
                                            scene: 'chat',
                                            title: jobInfo.title,
                                            resumeIndex: decision.resumeIndex,
                                        });
                                        status(`打招呼成功`);
                                    } catch (e) {
                                        await logAction({
                                            action: 'chat_greet_failed',
                                            scene: 'chat',
                                            title: jobInfo.title,
                                            resumeIndex: decision.resumeIndex,
                                            reason: String(e),
                                        });
                                        status(`打招呼失败: ${e}`);
                                    }
                                    continue;
                                }
                                // 未达到阈值，直接下一个
                                else if (decision.score < OPTIONS.thread) {
                                    await logAction({
                                        action: 'chat_rejected_below_threshold',
                                        scene: 'chat',
                                        title: jobInfo.title,
                                        score: decision.score,
                                        threshold: OPTIONS.thread,
                                        resumeIndex: decision.resumeIndex,
                                    });
                                    await sendMsg(AUTO_REPLY.reject_text)
                                    continue;
                                }
                            }
                            // ===== 截图 + 文本 → 视觉 LLM → 结构化决策回复 =====
                            const eduSentKey = 'goodjobs_edu_img:' + ((new URLSearchParams(location.search).get('id')) || 'default');
                            const eduImgInHistory = !!document.querySelector('.item-myself .message-content img, .item-myself img:not([class*=avatar])');
                            // confirmAddr 系统弹窗仍机械点击接受（避免遮挡输入框），并把该状态并入决策上下文
                            let recentText = chatInfo.recent || '';
                            if (chatInfo.confirmAddr) {
                                const clicked = clickDialogAccept();
                                await logAction({ action: 'chat_addr_dialog_accepted', scene: 'chat', clickedDialog: clicked, recent: recentText.slice(0, 120) });
                                recentText = '[系统提示：对方发来"是否接受此工作地点"确认弹窗，脚本已自动点击' + (clicked ? '接受' : '，但未找到接受按钮，可能需在回复中确认工作地点') + ']\n' + recentText;
                            }

                            // 发送简历（先获取职位详情以确定简历索引）
                            const doSendResume = async () => {
                                localStorage.setItem(this.targets.chat, new Date().getTime());
                                chatInfo.jobEl.click();
                                status(`正在获取职位详情（用于确定简历）`);
                                const jobInfo = await this.broadcast.receive(this.targets.detail, this.bcTypes.GET_JOB_INFO);
                                const decision = await api.getJobScore(jobInfo.title, jobInfo.salary, jobInfo.detail);
                                status(`发送简历（简历索引 ${decision.resumeIndex}）`);
                                const resumeResult = await sendResume(decision.resumeIndex);
                                await logAction({
                                    action: 'resume_sent',
                                    scene: 'chat',
                                    title: jobInfo.title,
                                    salary: jobInfo.salary,
                                    requestedResumeIndex: decision.resumeIndex,
                                    selectedResumeIndex: resumeResult?.selectedResumeIndex ?? decision.resumeIndex,
                                    sendMode: resumeResult?.mode || 'unknown',
                                });
                                status('简历发送成功');
                            };

                            // 发送学历证明图（学信网截图）：从本地服务取图，多策略注入 Boss 聊天上传入口，全程日志便于排查
                            const sendEducationImage = async () => {
                                const blob = await api.fetchBlob(AUTO_REPLY.education_image || '/assets/xuexin.jpg');
                                const file = new File([blob], 'xuexin.jpg', { type: 'image/jpeg' });
                                const countMyImages = () => document.querySelectorAll('.item-myself .message-content img, .item-myself img:not([class*=avatar])').length;
                                const findFileInput = () => {
                                    const inputs = Array.from(document.querySelectorAll('input[type=file]'));
                                    return inputs.find(i => /image|png|jpe?g/i.test(i.accept || ''))
                                        || inputs.find(i => i.closest('[class*=chat]'))
                                        || inputs[0] || null;
                                };
                                const fireInput = (input) => {
                                    const dt = new DataTransfer();
                                    dt.items.add(file);
                                    input.files = dt.files;
                                    input.dispatchEvent(new Event('change', { bubbles: true }));
                                    input.dispatchEvent(new Event('input', { bubbles: true }));
                                };
                                const before = countMyImages();
                                let input = findFileInput();
                                let strategy = 'existing-input';
                                if (!input) {
                                    // 无现成文件选择框：点工具栏图片按钮，并拦截 file input 的 click（防弹 OS 文件框）
                                    const btnSelectors = [
                                        '.chat-input [class*=image]', '.chat-input [class*=img]',
                                        '[class*=chat-op] [class*=image]', '[class*=chat-op] [class*=img]',
                                        '[class*=toolbar] [class*=image]', '[class*=toolbar] [class*=img]',
                                        '.btn-image', '.op-image', '[title*=图片]', '[title*=上传]',
                                    ];
                                    const btn = btnSelectors.map(s => { try { return document.querySelector(s); } catch (e) { return null; } }).find(el => el) || null;
                                    if (btn) {
                                        strategy = 'click-button';
                                        const origClick = HTMLInputElement.prototype.click;
                                        let captured = null;
                                        HTMLInputElement.prototype.click = function () {
                                            if (this.type === 'file') captured = this;
                                            else origClick.call(this);
                                        };
                                        try { btn.click(); } catch (e) { /* 忽略 */ }
                                        HTMLInputElement.prototype.click = origClick;
                                        input = captured || findFileInput();
                                    }
                                }
                                if (input) {
                                    fireInput(input);
                                } else {
                                    // 兜底：模拟粘贴图片到输入框
                                    strategy = 'paste';
                                    const ipt = await tools.endlessFind(SELECTORS.ZHIPIN.CHAT.CHATINPUT);
                                    const dt = new DataTransfer();
                                    dt.items.add(file);
                                    const ev = new ClipboardEvent('paste', { bubbles: true, cancelable: true });
                                    Object.defineProperty(ev, 'clipboardData', { value: dt });
                                    ipt.dispatchEvent(ev);
                                }
                                await logAction({ action: 'edu_image_injected', scene: 'chat', strategy });
                                // 等待上传完成：弹窗出现发送按钮则顺带点击；己方出现新图片消息即视为成功
                                for (let i = 0; i < 12; i++) {
                                    await tools.asyncSleep(1000);
                                    const dlgBtn = document.querySelector('.dialog-content .btn-send, .dialog .btn-send, .confirm-dialog .btn-send');
                                    if (dlgBtn) {
                                        dlgBtn.click();
                                        await logAction({ action: 'edu_image_dialog_send_clicked', scene: 'chat' });
                                    }
                                    if (countMyImages() > before) return true;
                                }
                                return false;
                            };
                            window.__sendEduImage = sendEducationImage; // 手动测试钩子：聊天页控制台 await __sendEduImage()

                            // 组装决策上下文
                            const resumeSended = !!chatInfo.resumeSended;
                            const eduSent = !!localStorage.getItem(eduSentKey) || eduImgInHistory;
                            const jobTitle = (() => {
                                try {
                                    const jel = document.querySelector(SELECTORS.ZHIPIN.CHAT.JOBEL);
                                    if (jel) {
                                        const nameEl = jel.querySelector('.job-name, .name, [class*=job-name], [class*=title]');
                                        return (((nameEl ? nameEl.innerText : jel.innerText) || '').split('\n')[0] || '').trim().slice(0, 60);
                                    }
                                } catch (e) { }
                                return '';
                            })();
                            const msgsForApi = (chatInfo.msgs || []).slice(-20).map(m => ({ role: m.role, content: String(m.content || '').slice(0, 500) }));

                            // 截图（失败降级为纯文本决策，仍走 LLM）
                            let screenshot = '';
                            if ((AUTO_REPLY.llm_chat || {}).enabled !== false) {
                                screenshot = await captureChatScreenshot();
                            }

                            // 请求 LLM 决策；失败仅记录日志，不做关键词兜底
                            let decision = null;
                            try {
                                status('正在请求 LLM 决策回复');
                                decision = await api.chatDecide({
                                    screenshot,
                                    msgs: msgsForApi,
                                    recent: recentText,
                                    resumeSended,
                                    eduSent,
                                    jobTitle,
                                });
                            } catch (e) {
                                await logAction({ action: 'chat_llm_decide_failed', scene: 'chat', reason: String(e), hasScreenshot: !!screenshot, recent: recentText.slice(0, 120) });
                                status('LLM 决策失败，跳过本条');
                            }

                            if (decision) {
                                const replyText = String(decision.reply || '').trim();
                                const wantEdu = !!decision.send_education_image;
                                const wantResume = !!decision.send_resume;
                                await logAction({ action: 'chat_llm_decided', scene: 'chat', reply: replyText.slice(0, 200), sendEducationImage: wantEdu, sendResume: wantResume, hasScreenshot: !!screenshot, jobTitle });
                                // 执行顺序：发学历图 → 发简历 → 回复文本（每步去重安全阀）
                                if (wantEdu && !eduSent) {
                                    status('LLM 决策：发送学信网截图');
                                    let ok = false;
                                    try {
                                        ok = await sendEducationImage();
                                    } catch (e) {
                                        await logAction({ action: 'edu_image_failed', scene: 'chat', reason: String(e) });
                                    }
                                    if (ok) localStorage.setItem(eduSentKey, String(new Date().getTime()));
                                    await logAction({ action: 'edu_image_sent', scene: 'chat', ok });
                                }
                                if (wantResume && !resumeSended) {
                                    status('LLM 决策：发送简历');
                                    try {
                                        await doSendResume();
                                    } catch (e) {
                                        await logAction({ action: 'resume_send_failed', scene: 'chat', reason: String(e) });
                                    }
                                }
                                if (replyText) {
                                    status('LLM 决策：回复 → ' + replyText.slice(0, 60));
                                    await sendMsg(replyText);
                                    await logAction({ action: 'chat_llm_reply_sent', scene: 'chat', reply: replyText.slice(0, 200) });
                                }
                                if (!replyText && !wantEdu && !wantResume) {
                                    status('LLM 决策：无需回复');
                                }
                            }
                        } catch (e) {
                            status('回复某条消息出错');
                        }
                    }
                    // 向下滚动
                    ctn.scrollTop = 1014 * ++round;
                    await tools.asyncSleep(300);
                    if (ctn.scrollTop !== lastTop) {
                        lastTop = ctn.scrollTop;
                        await once();
                    }
                };
                // 完成一轮
                await once();
            };

            // 主函数（整体包一层保护，任何异常都回传后端，绝不再静默崩溃）
            const main = async () => {
                try {
                // 判断来源
                const now = new Date().getTime();
                const greetAge = now - tools.getTimestamp(this.targets.chatGreet);
                const chatAge = now - tools.getTimestamp(this.targets.chat);
                const isGreet = greetAge < OPTIONS.timestampTimeout && window.name === this.targets.chatGreet;
                const isChat = chatAge < OPTIONS.timestampTimeout && window.name === this.targets.chat;
                console.log('[goodJobs] chat source check', JSON.stringify({ isGreet, isChat, windowName: window.name }));
                logAction({
                    action: 'chat_page_loaded',
                    scene: 'chat',
                    isGreet,
                    isChat,
                    windowName: window.name,
                    greetAge,
                    chatAge,
                    timestampTimeout: OPTIONS.timestampTimeout,
                    href: location.href,
                });

                if (isGreet) {
                    sayHi();
                }
                else if (isChat) {
                    // 日志
                    logger = new Logger();
                    logger.runBtn.remove();
                    logger.clearBtn.remove();
                    // 等待加载
                    await tools.asyncSleep(3000);
                    chat()
                        .then(async () => {
                            status('消息处理完毕');
                            await this.broadcast.send(this.targets.search, this.bcTypes.RUN, true);
                        })
                        .catch(async () => {
                            status('聊天程序运行出错');
                            await this.broadcast.send(this.targets.search, this.bcTypes.RUN, false);
                        }).finally(() => {
                            this.broadcast.destroy();
                        });
                }
                } catch (e) {
                    try {
                        await logAction({ action: 'chat_main_error', scene: 'chat', reason: String(e && e.stack || e) });
                    } catch (e2) { }
                    console.log('[goodJobs] chat main error', e);
                }
            };
            main();
        }

        // 运行
        run(tagIdx = 0) {
            // 机器人验证哨兵：所有 zhipin 页面（搜索/详情/聊天）都挂上监测
            try { captchaSentinel.start(); } catch (e) { }
            // 最早期探针：只要脚本在某个 zhipin 页面被注入就回传一次，用于定位“脚本未运行”问题
            try {
                fetch(OPTIONS.serverHost + '/log-action', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ action: 'script_injected', path: location.pathname, windowName: window.name, version: (typeof GM_info !== 'undefined' && GM_info.script && GM_info.script.version) || 'unknown' }),
                }).catch(() => {});
            } catch (e) { }
            const path = location.pathname;
            // 在搜索页
            if (path.startsWith(SEARCHPATH.zhipin)) {
                this.__search(tagIdx);
            }
            // 在详情页
            else if (path.startsWith(this.whiteList.deatil)) {
                this.__detail();
            }
            // 在聊天页
            else if (path.startsWith(this.whiteList.chat)) {
                this.__chat();
            }
            // 否则跳转搜索页
            else {
                new Logger(() => {
                    tools.openTabNSetTimestamp(SEARCHPATH.zhipin, this.targets.search, true);
                });
            }
        }
    }

    const goodjobs = new Zhipin().run();
})();
