#!/bin/bash
# 启动 Flask 后端

cd "$(dirname "$0")"

# 加载环境变量
if [ -f .env ]; then
    export $(cat .env | grep -v '^#' | xargs)
fi

# 使用 gunicorn 启动（生产环境）
if [ "$FLASK_DEBUG" != "true" ]; then
    exec gunicorn -w 4 -b 0.0.0.0:${FLASK_PORT:-5000} app:app
else
    # 开发环境使用 Flask 内置服务器
    exec python3 app.py
fi
