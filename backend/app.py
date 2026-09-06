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

# AI API Key（从环境变量读取）
AI_API_KEY = os.getenv('AI_API_KEY', '')


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


def require_ai_auth(f):
    """AI API 认证装饰器"""
    from functools import wraps
    
    @wraps(f)
    def decorated(*args, **kwargs):
        if not AI_API_KEY:
            return jsonify({'error': 'AI API 未配置'}), 503
        
        # 从请求头获取 API Key
        api_key = request.headers.get('X-API-Key', '')
        
        if not api_key or not hmac.compare_digest(api_key, AI_API_KEY):
            return jsonify({'error': 'API Key 无效'}), 401
        
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


# ============== AI API 接口 ==============

@app.route('/api/ai/projects/<project_id>/blocks', methods=['POST'])
@require_ai_auth
def ai_import_blocks(project_id):
    """AI 批量导入旅行块"""
    projects = load_projects()
    project = next((p for p in projects if p['id'] == project_id), None)
    
    if not project:
        return jsonify({'error': '项目不存在'}), 404
    
    data = request.get_json(silent=True) or {}
    blocks = data.get('blocks', [])
    
    if not isinstance(blocks, list):
        return jsonify({'error': 'blocks 必须是数组'}), 400
    
    # 为每个 block 生成 ID
    for block in blocks:
        if 'id' not in block:
            block['id'] = f"block_{int(datetime.now().timestamp() * 1000)}_{len(project['data']['blocks'])}"
        project['data']['blocks'].append(block)
    
    project['updatedAt'] = datetime.now().isoformat()
    save_projects(projects)
    
    return jsonify({
        'success': True,
        'imported': len(blocks),
        'blocks': project['data']['blocks']
    })


@app.route('/api/ai/projects/<project_id>/timeline', methods=['POST'])
@require_ai_auth
def ai_update_timeline(project_id):
    """AI 添加/修改行程项"""
    projects = load_projects()
    project = next((p for p in projects if p['id'] == project_id), None)
    
    if not project:
        return jsonify({'error': '项目不存在'}), 404
    
    data = request.get_json(silent=True) or {}
    action = data.get('action', 'add')  # add, update, remove
    item = data.get('item', {})
    
    if action == 'add':
        if 'id' not in item:
            item['id'] = f"timeline_{int(datetime.now().timestamp() * 1000)}_{len(project['data']['timeline'])}"
        project['data']['timeline'].append(item)
        
    elif action == 'update':
        item_id = item.get('id')
        if not item_id:
            return jsonify({'error': '缺少 item.id'}), 400
        
        for i, t in enumerate(project['data']['timeline']):
            if t['id'] == item_id:
                project['data']['timeline'][i] = {**t, **item}
                break
        else:
            return jsonify({'error': '行程项不存在'}), 404
            
    elif action == 'remove':
        item_id = item.get('id')
        if not item_id:
            return jsonify({'error': '缺少 item.id'}), 400
        
        project['data']['timeline'] = [
            t for t in project['data']['timeline'] if t['id'] != item_id
        ]
    else:
        return jsonify({'error': '无效的 action'}), 400
    
    project['updatedAt'] = datetime.now().isoformat()
    save_projects(projects)
    
    return jsonify({
        'success': True,
        'action': action,
        'timeline': project['data']['timeline']
    })


@app.route('/api/ai/projects/<project_id>/polls', methods=['POST'])
@require_ai_auth
def ai_create_poll(project_id):
    """AI 创建投票"""
    projects = load_projects()
    project = next((p for p in projects if p['id'] == project_id), None)
    
    if not project:
        return jsonify({'error': '项目不存在'}), 404
    
    data = request.get_json(silent=True) or {}
    poll = {
        'id': f"poll_{int(datetime.now().timestamp() * 1000)}_{len(project['data']['polls'])}",
        'question': data.get('question', ''),
        'options': data.get('options', []),
        'votes': {},
        'createdBy': 'ai',
        'createdAt': datetime.now().isoformat()
    }
    
    if not poll['question']:
        return jsonify({'error': '缺少 question'}), 400
    
    project['data']['polls'].append(poll)
    project['updatedAt'] = datetime.now().isoformat()
    save_projects(projects)
    
    return jsonify({
        'success': True,
        'poll': poll
    })


@app.route('/api/ai/projects/<project_id>/summary', methods=['GET'])
@require_ai_auth
def ai_get_summary(project_id):
    """获取项目摘要（供 AI 读取）"""
    projects = load_projects()
    project = next((p for p in projects if p['id'] == project_id), None)
    
    if not project:
        return jsonify({'error': '项目不存在'}), 404
    
    summary = {
        'id': project['id'],
        'name': project['name'],
        'description': project.get('description', ''),
        'destination': project.get('destination', ''),
        'startDate': project.get('startDate', ''),
        'endDate': project.get('endDate', ''),
        'blocks_count': len(project['data']['blocks']),
        'timeline_count': len(project['data']['timeline']),
        'polls_count': len(project['data']['polls']),
        'blocks': project['data']['blocks'],
        'timeline': project['data']['timeline'],
        'polls': project['data']['polls']
    }
    
    return jsonify(summary)


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
