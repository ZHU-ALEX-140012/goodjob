# -*- coding: utf-8 -*-
import subprocess, time, sys, os, datetime, socket

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
LOG = os.path.join(BASE_DIR, 'backend_guard.log')

def log(msg):
    with open(LOG, 'a', encoding='utf-8') as f:
        f.write('[%s] %s\n' % (datetime.datetime.now().strftime('%Y-%m-%d %H:%M:%S'), msg))

def port_up():
    s = socket.socket()
    s.settimeout(1)
    try:
        s.connect(('127.0.0.1', 8000))
        return True
    except Exception:
        return False
    finally:
        s.close()

# 端口已有服务则直接退出（避免重复启动）
if port_up():
    log('port 8000 already up, exit')
    sys.exit(0)

while True:
    log('backend starting')
    p = subprocess.Popen([sys.executable, 'main.py'], cwd=BASE_DIR)
    rc = p.wait()
    log('backend exited rc=%s, restarting in 5s' % rc)
    time.sleep(5)
