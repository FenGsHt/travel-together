#!/usr/bin/env python3
"""
Travel Together 后端服务
Flask 应用 - 项目管理 + 认证
"""

import os
import json
import hmac
import hashlib
from datetime import datetime
from flask import Flask, jsonify, request, session
from flask_cors import CORS
from pathlib import Path

app = Flask(__name__)

# 安全配置
app.config.update(
    SECRET_KEY=os.getenv('FLASK_SECRET_KEY', ''),
    SESSION_COOKIE_HTTPONLY=True,
    SESSION_COOKIE_SAMESITE='Lax',
    SESSION_COOKIE_SECURE=False,  # 生产环境改为 True（需要 HTTPS）
)

CORS(app, supports_credentials=True)

# 数据存储路径
DATA_DIR = Path(__file__).parent / "data"
DATA_DIR.mkdir(exist_ok=True)
PROJECTS_FILE = DATA_DIR / "projects.json"

# 访问令牌（从环境变量读取）
SITE_ACCESS_TOKEN = os.getenv('SITE_ACCESS_TOKEN', '')


# ============== 认证 API ==============

def _access_configured():
    """检查认证是否已配置"""
    return bool(SITE_ACCESS_TOKEN and app.config['SECRET_KEY'])


def _access_token_fingerprint():
    """生成令牌指纹（哈希值）"""
    return hashlib.sha256(SITE_ACCESS_TOKEN.encode('utf-8')).hexdigest()


@app.route('/api/auth/status', methods=['GET'])
def auth_status():
    """检查认证状态"""
    if not _access_configured():
        return jsonify({'authenticated': False, 'configured': False}), 503

    authenticated = (
        session.get('site_access') is True
        and hmac.compare_digest(
            session.get('site_access_token_hash', ''),
            _access_token_fingerprint()
        )
    )
    return jsonify({'authenticated': authenticated, 'configured': True})


@app.route('/api/auth/verify', methods=['POST'])
def verify_access():
    """验证访问令牌"""
    if not _access_configured():
        return jsonify({'success': False, 'error': '认证未配置'}), 503

    data = request.get_json(silent=True) or {}
    token = str(data.get('token', ''))
    
    # 使用 hmac.compare_digest 防止时序攻击
    if not hmac.compare_digest(token, SITE_ACCESS_TOKEN):
        return jsonify({'success': False, 'error': '令牌无效'}), 401

    # 清除旧会话，设置新认证
    session.clear()
    session['site_access'] = True
    session['site_access_token_hash'] = _access_token_fingerprint()
    
    return jsonify({'success': True})


@app.route('/api/auth/logout', methods=['POST'])
def logout():
    """登出"""
    session.clear()
    return jsonify({'success': True})


# ============== 项目管理 API ==============

def load_projects():
    """加载项目数据"""
    if PROJECTS_FILE.exists():
        with open(PROJECTS_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    return []


def save_projects(projects):
    """保存项目数据"""
    with open(PROJECTS_FILE, "w", encoding="utf-8") as f:
        json.dump(projects, f, ensure_ascii=False, indent=2)


def require_auth(f):
    """认证装饰器"""
    from functools import wraps
    
    @wraps(f)
    def decorated(*args, **kwargs):
        if not _access_configured():
            return jsonify({'error': '认证未配置'}), 503
        
        authenticated = (
            session.get('site_access') is True
            and hmac.compare_digest(
                session.get('site_access_token_hash', ''),
                _access_token_fingerprint()
            )
        )
        
        if not authenticated:
            return jsonify({'error': '未授权'}), 401
        
        return f(*args, **kwargs)
    
    return decorated


@app.route('/api/projects', methods=['GET'])
@require_auth
def get_projects():
    """获取所有项目"""
    projects = load_projects()
    return jsonify(projects)


@app.route('/api/projects', methods=['POST'])
@require_auth
def create_project():
    """创建新项目"""
    data = request.get_json(silent=True) or {}
    
    project = {
        'id': f"project_{int(datetime.now().timestamp() * 1000)}",
        'name': data.get('name', '未命名项目'),
        'description': data.get('description', ''),
        'destination': data.get('destination', ''),
        'startDate': data.get('startDate', ''),
        'endDate': data.get('endDate', ''),
        'createdAt': datetime.now().isoformat(),
        'updatedAt': datetime.now().isoformat(),
        'data': {
            'blocks': [],
            'timeline': [],
            'polls': [],
            'aiDrafts': [],
            'activity': []
        }
    }
    
    projects = load_projects()
    projects.append(project)
    save_projects(projects)
    
    return jsonify(project)


@app.route('/api/projects/<project_id>', methods=['GET'])
@require_auth
def get_project(project_id):
    """获取单个项目"""
    projects = load_projects()
    project = next((p for p in projects if p['id'] == project_id), None)
    
    if not project:
        return jsonify({'error': '项目不存在'}), 404
    
    return jsonify(project)


@app.route('/api/projects/<project_id>', methods=['PUT'])
@require_auth
def update_project(project_id):
    """更新项目"""
    projects = load_projects()
    project = next((p for p in projects if p['id'] == project_id), None)
    
    if not project:
        return jsonify({'error': '项目不存在'}), 404
    
    data = request.get_json(silent=True) or {}
    
    # 更新基本信息
    if 'name' in data:
        project['name'] = data['name']
    if 'description' in data:
        project['description'] = data['description']
    if 'destination' in data:
        project['destination'] = data['destination']
    if 'startDate' in data:
        project['startDate'] = data['startDate']
    if 'endDate' in data:
        project['endDate'] = data['endDate']
    
    # 更新项目数据
    if 'data' in data:
        project['data'] = data['data']
    
    project['updatedAt'] = datetime.now().isoformat()
    save_projects(projects)
    
    return jsonify(project)


@app.route('/api/projects/<project_id>', methods=['DELETE'])
@require_auth
def delete_project(project_id):
    """删除项目"""
    projects = load_projects()
    projects = [p for p in projects if p['id'] != project_id]
    save_projects(projects)
    
    return jsonify({'success': True})


# ============== 健康检查 ==============

@app.route('/api/health', methods=['GET'])
def health_check():
    """健康检查"""
    return jsonify({
        'status': 'ok',
        'timestamp': datetime.now().isoformat(),
        'configured': _access_configured()
    })


if __name__ == '__main__':
    port = int(os.getenv('FLASK_PORT', 5000))
    debug = os.getenv('FLASK_DEBUG', 'false').lower() == 'true'
    app.run(host='0.0.0.0', port=port, debug=debug)
