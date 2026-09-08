#!/usr/bin/env python3
"""
Travel Together 后端服务
Flask 应用 - 项目管理 + 认证
"""

import os
import json
import hmac
import hashlib
import fcntl
from contextlib import contextmanager
from datetime import datetime
from flask import Flask, jsonify, request, session
from flask_cors import CORS
from pathlib import Path
from user_manager import create_user, authenticate_user, get_user_by_id, get_all_users
from websocket_handler import init_socketio, broadcast_edit

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
PROJECTS_LOCK_FILE = DATA_DIR / "projects.lock"
NOTIFICATIONS_FILE = DATA_DIR / "notifications.json"
NOTIFICATION_PREFERENCES_FILE = DATA_DIR / "notification_preferences.json"

# 访问令牌（从环境变量读取）
SITE_ACCESS_TOKEN = os.getenv('SITE_ACCESS_TOKEN', '')
# 访问密钥登录时使用的共享协作身份。后续接入独立账号后由真实用户覆盖。
SITE_ACCESS_USER_ID = os.getenv('SITE_ACCESS_USER_ID', 'site-access-user')
SITE_ACCESS_USER_NAME = os.getenv('SITE_ACCESS_USER_NAME', '协作访客')

# AI API Key（从环境变量读取）
AI_API_KEY = os.getenv('AI_API_KEY', '')


# ============== 认证 API ==============

def _access_configured():
    """检查认证是否已配置"""
    return bool(SITE_ACCESS_TOKEN and app.config['SECRET_KEY'])


def _access_token_fingerprint():
    """生成令牌指纹（哈希值）"""
    return hashlib.sha256(SITE_ACCESS_TOKEN.encode('utf-8')).hexdigest()


def resolve_user_profile(user_id):
    """返回会话用户的安全公开资料，兼容访问密钥模式与注册用户。"""
    if user_id == SITE_ACCESS_USER_ID:
        return {
            'id': SITE_ACCESS_USER_ID,
            'username': 'site-access',
            'display_name': SITE_ACCESS_USER_NAME,
        }
    return get_user_by_id(user_id)


def display_name_for(user):
    """兼容旧数据的用户展示名字段。"""
    return user.get('display_name') or user.get('displayName') or user.get('username', '未知用户')


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

    # 清除旧会话，设置新认证和访问密钥模式的共享协作身份。
    session.clear()
    session['site_access'] = True
    session['site_access_token_hash'] = _access_token_fingerprint()
    session['user_id'] = SITE_ACCESS_USER_ID
    session['username'] = 'site-access'
    
    return jsonify({'success': True})


@app.route('/api/auth/logout', methods=['POST'])
def logout():
    """登出"""
    session.clear()
    return jsonify({'success': True})


# ============== 用户管理 API ==============

@app.route('/api/users/register', methods=['POST'])
def register_user():
    """用户注册"""
    data = request.get_json(silent=True) or {}
    username = data.get('username', '').strip()
    password = data.get('password', '')
    display_name = data.get('display_name', '').strip() or username
    
    if not username or not password:
        return jsonify({'error': '用户名和密码不能为空'}), 400
    
    if len(username) < 3:
        return jsonify({'error': '用户名至少 3 个字符'}), 400
    
    if len(password) < 6:
        return jsonify({'error': '密码至少 6 个字符'}), 400
    
    user, error = create_user(username, password, display_name)
    
    if error or not user:
        return jsonify({'error': error or '创建失败'}), 400
    
    # 自动登录
    session['user_id'] = user['id']
    session['username'] = user['username']
    
    return jsonify({'success': True, 'user': user})


@app.route('/api/users/login', methods=['POST'])
def login_user():
    """用户登录"""
    data = request.get_json(silent=True) or {}
    username = data.get('username', '').strip()
    password = data.get('password', '')
    
    if not username or not password:
        return jsonify({'error': '用户名和密码不能为空'}), 400
    
    user, error = authenticate_user(username, password)
    
    if error:
        return jsonify({'error': error}), 401
    
    session['user_id'] = user['id']
    session['username'] = user['username']
    
    return jsonify({'success': True, 'user': user})


@app.route('/api/users/me', methods=['GET'])
def get_current_user():
    """获取当前登录用户信息"""
    user_id = session.get('user_id')
    
    if not user_id:
        return jsonify({'authenticated': False}), 401
    
    user = resolve_user_profile(user_id)
    
    if not user:
        session.clear()
        return jsonify({'authenticated': False}), 401
    
    return jsonify({'authenticated': True, 'user': user})


@app.route('/api/users', methods=['GET'])
def list_users():
    """获取所有用户列表"""
    users = get_all_users()
    return jsonify({'users': users})


def require_user_auth(f):
    """用户认证装饰器"""
    from functools import wraps
    
    @wraps(f)
    def decorated(*args, **kwargs):
        user_id = session.get('user_id')
        
        if not user_id:
            return jsonify({'error': '未登录'}), 401
        
        user = resolve_user_profile(user_id)
        if not user:
            session.clear()
            return jsonify({'error': '用户不存在'}), 401
        
        request.current_user = user
        return f(*args, **kwargs)
    
    return decorated


# ============== 项目管理 API ==============

def load_projects():
    """加载项目数据（带共享文件锁）。"""
    if not PROJECTS_FILE.exists():
        return []

    with open(PROJECTS_FILE, "r", encoding="utf-8") as f:
        fcntl.flock(f.fileno(), fcntl.LOCK_SH)
        try:
            return json.load(f)
        finally:
            fcntl.flock(f.fileno(), fcntl.LOCK_UN)


def save_projects(projects):
    """保存项目数据（带独占文件锁）。"""
    with open(PROJECTS_FILE, "w", encoding="utf-8") as f:
        fcntl.flock(f.fileno(), fcntl.LOCK_EX)
        try:
            json.dump(projects, f, ensure_ascii=False, indent=2)
        finally:
            fcntl.flock(f.fileno(), fcntl.LOCK_UN)


@contextmanager
def locked_projects_for_update():
    """在读取、比较版本与写入的整个更新周期内保持独占锁。"""
    with open(PROJECTS_LOCK_FILE, "a+", encoding="utf-8") as lock_file:
        fcntl.flock(lock_file.fileno(), fcntl.LOCK_EX)
        projects = None
        try:
            projects = []
            if PROJECTS_FILE.exists():
                with open(PROJECTS_FILE, "r", encoding="utf-8") as projects_file:
                    projects = json.load(projects_file)
            yield projects
        finally:
            if projects is not None:
                with open(PROJECTS_FILE, "w", encoding="utf-8") as projects_file:
                    json.dump(projects, projects_file, ensure_ascii=False, indent=2)
            fcntl.flock(lock_file.fileno(), fcntl.LOCK_UN)


def project_revision(project):
    """为旧项目提供稳定的初始版本号。"""
    try:
        return max(1, int(project.get('revision', 1)))
    except (TypeError, ValueError):
        return 1


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
    for project in projects:
        project['revision'] = project_revision(project)
    return jsonify(projects)


@app.route('/api/projects', methods=['POST'])
@require_auth
def create_project():
    """创建新项目"""
    data = request.get_json(silent=True) or {}
    
    # 生成项目 ID
    project_id = f"project_{int(datetime.now().timestamp() * 1000)}"
    
    # 创建者自动成为 owner
    owner_id = session['user_id']
    
    project = {
        'id': project_id,
        'name': data.get('name', '未命名项目'),
        'description': data.get('description', ''),
        'destination': data.get('destination', ''),
        'startDate': data.get('startDate', ''),
        'endDate': data.get('endDate', ''),
        'createdAt': datetime.now().isoformat(),
        'updatedAt': datetime.now().isoformat(),
        'revision': 1,
        'members': [
            {
                'userId': owner_id,
                'role': 'owner',
                'joinedAt': datetime.now().isoformat()
            }
        ],
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

    project['revision'] = project_revision(project)
    return jsonify(project)


@app.route('/api/projects/<project_id>', methods=['PUT'])
@require_auth
def update_project(project_id):
    """更新项目，并以乐观锁避免静默覆盖同行人的修改。"""
    data = request.get_json(silent=True) or {}
    expected_revision = data.get('expectedRevision')

    if expected_revision is not None:
        try:
            expected_revision = int(expected_revision)
        except (TypeError, ValueError):
            return jsonify({'error': 'expectedRevision 必须是整数'}), 400

    with locked_projects_for_update() as projects:
        project = next((p for p in projects if p['id'] == project_id), None)

        if not project:
            return jsonify({'error': '项目不存在'}), 404

        current_revision = project_revision(project)
        project['revision'] = current_revision
        if expected_revision is not None and expected_revision != current_revision:
            return jsonify({
                'error': '编辑冲突',
                'project': project,
            }), 409

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

        project['revision'] = current_revision + 1
        project['updatedAt'] = datetime.now().isoformat()
        return jsonify(project)


@app.route('/api/projects/<project_id>', methods=['DELETE'])
@require_auth
def delete_project(project_id):
    """删除项目（仅 owner 可操作）"""
    user_id = session['user_id']
    projects = load_projects()
    
    # 查找项目
    project = next((p for p in projects if p['id'] == project_id), None)
    if not project:
        return jsonify({'error': '项目不存在'}), 404
    
    # 检查权限
    member = next((m for m in project['members'] if m['userId'] == user_id), None)
    if not member or member['role'] != 'owner':
        return jsonify({'error': '仅项目所有者可删除项目'}), 403
    
    # 删除项目
    projects = [p for p in projects if p['id'] != project_id]
    save_projects(projects)
    
    return jsonify({'success': True})


@app.route('/api/projects/<project_id>/invite', methods=['POST'])
@require_auth
def invite_member(project_id):
    """邀请成员加入项目"""
    data = request.get_json(silent=True) or {}
    invitee_id = data.get('userId')
    role = data.get('role', 'editor')  # 默认角色为 editor
    
    if not invitee_id:
        return jsonify({'error': '缺少 userId'}), 400
    
    if role not in ['owner', 'editor', 'viewer']:
        return jsonify({'error': '无效的角色'}), 400
    
    projects = load_projects()
    project = next((p for p in projects if p['id'] == project_id), None)
    
    if not project:
        return jsonify({'error': '项目不存在'}), 404
    
    # 检查是否已存在
    existing = next((m for m in project['members'] if m['userId'] == invitee_id), None)
    if existing:
        return jsonify({'error': '用户已是项目成员'}), 400
    
    # 添加成员
    project['members'].append({
        'userId': invitee_id,
        'role': role,
        'joinedAt': datetime.now().isoformat()
    })
    project['updatedAt'] = datetime.now().isoformat()
    
    save_projects(projects)
    
    return jsonify({'success': True, 'member': project['members'][-1]})


@app.route('/api/projects/<project_id>/members', methods=['GET'])
@require_auth
def get_members(project_id):
    """获取项目成员列表"""
    projects = load_projects()
    project = next((p for p in projects if p['id'] == project_id), None)
    
    if not project:
        return jsonify({'error': '项目不存在'}), 404
    
    # 获取成员详细信息
    members_info = []
    for member in project['members']:
        user = resolve_user_profile(member['userId'])
        if user:
            members_info.append({
                'userId': member['userId'],
                'username': user['username'],
                'displayName': display_name_for(user),
                'role': member['role'],
                'joinedAt': member['joinedAt']
            })
    
    return jsonify({'members': members_info})


@app.route('/api/projects/<project_id>/members/<user_id>', methods=['PUT'])
@require_auth
def update_member_role(project_id, user_id):
    """更新成员角色（仅 owner 可操作）"""
    data = request.get_json(silent=True) or {}
    new_role = data.get('role')
    
    if new_role not in ['owner', 'editor', 'viewer']:
        return jsonify({'error': '无效的角色'}), 400
    
    current_user_id = session['user_id']
    projects = load_projects()
    project = next((p for p in projects if p['id'] == project_id), None)
    
    if not project:
        return jsonify({'error': '项目不存在'}), 404
    
    # 检查当前用户权限
    current_member = next((m for m in project['members'] if m['userId'] == current_user_id), None)
    if not current_member or current_member['role'] != 'owner':
        return jsonify({'error': '仅项目所有者可修改成员角色'}), 403
    
    # 更新角色
    target_member = next((m for m in project['members'] if m['userId'] == user_id), None)
    if not target_member:
        return jsonify({'error': '成员不存在'}), 404
    
    target_member['role'] = new_role
    project['updatedAt'] = datetime.now().isoformat()
    
    save_projects(projects)
    
    return jsonify({'success': True})


@app.route('/api/projects/<project_id>/members/<user_id>', methods=['DELETE'])
@require_auth
def remove_member(project_id, user_id):
    """移除成员（owner 可移除任何人，其他成员只能自己退出）"""
    current_user_id = session['user_id']
    projects = load_projects()
    project = next((p for p in projects if p['id'] == project_id), None)
    
    if not project:
        return jsonify({'error': '项目不存在'}), 404
    
    # 检查权限
    current_member = next((m for m in project['members'] if m['userId'] == current_user_id), None)
    if not current_member:
        return jsonify({'error': '你不是项目成员'}), 403
    
    # 非 owner 只能移除自己
    if current_member['role'] != 'owner' and current_user_id != user_id:
        return jsonify({'error': '仅项目所有者可移除其他成员'}), 403
    
    # 不能移除最后一个 owner
    target_member = next((m for m in project['members'] if m['userId'] == user_id), None)
    if not target_member:
        return jsonify({'error': '成员不存在'}), 404
    
    if target_member['role'] == 'owner':
        owner_count = sum(1 for m in project['members'] if m['role'] == 'owner')
        if owner_count == 1:
            return jsonify({'error': '不能移除唯一的项目所有者'}), 400
    
    # 移除成员
    project['members'] = [m for m in project['members'] if m['userId'] != user_id]
    project['updatedAt'] = datetime.now().isoformat()
    
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


# ============== 通知偏好 API ==============

DEFAULT_NOTIFICATION_PREFERENCES = {
    'mentions': True,
    'polls': True,
    'system': True,
}


def load_notification_preferences():
    """加载各用户的通知偏好。"""
    if not NOTIFICATION_PREFERENCES_FILE.exists():
        return {}
    with open(NOTIFICATION_PREFERENCES_FILE, 'r', encoding='utf-8') as f:
        return json.load(f)


def save_notification_preferences(preferences_by_user):
    """原子地保存各用户的通知偏好。"""
    temporary_file = NOTIFICATION_PREFERENCES_FILE.with_suffix('.tmp')
    with open(temporary_file, 'w', encoding='utf-8') as f:
        json.dump(preferences_by_user, f, ensure_ascii=False, indent=2)
    temporary_file.replace(NOTIFICATION_PREFERENCES_FILE)


def notification_preferences_for(user_id):
    preferences_by_user = load_notification_preferences()
    saved = preferences_by_user.get(user_id, {})
    return {**DEFAULT_NOTIFICATION_PREFERENCES, **saved}


@app.route('/api/notification-preferences', methods=['GET'])
@require_auth
def get_notification_preferences():
    """获取当前用户的通知偏好。"""
    return jsonify({'preferences': notification_preferences_for(session['user_id'])})


@app.route('/api/notification-preferences', methods=['PUT'])
@require_auth
def update_notification_preferences():
    """更新当前用户的通知偏好，仅接受已知的布尔开关。"""
    payload = request.get_json(silent=True) or {}
    requested = payload.get('preferences')
    if not isinstance(requested, dict):
        return jsonify({'error': 'preferences 必须是对象'}), 400

    unknown_keys = set(requested) - set(DEFAULT_NOTIFICATION_PREFERENCES)
    invalid_values = [key for key, value in requested.items() if not isinstance(value, bool)]
    if unknown_keys or invalid_values:
        return jsonify({'error': '通知偏好只能包含 mentions、polls、system 三个布尔值'}), 400

    user_id = session['user_id']
    preferences_by_user = load_notification_preferences()
    preferences_by_user[user_id] = {
        **notification_preferences_for(user_id),
        **requested,
    }
    save_notification_preferences(preferences_by_user)
    return jsonify({'preferences': preferences_by_user[user_id]})


# ============== 通知系统 API ==============

def load_notifications():
    """加载通知数据"""
    if NOTIFICATIONS_FILE.exists():
        with open(NOTIFICATIONS_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    return []


def save_notifications(notifications):
    """保存通知数据"""
    with open(NOTIFICATIONS_FILE, "w", encoding="utf-8") as f:
        json.dump(notifications, f, ensure_ascii=False, indent=2)


def create_notification(user_id, type, title, message, project_id=None, data=None):
    """创建通知"""
    notifications = load_notifications()
    notification = {
        'id': f"notif_{int(datetime.now().timestamp() * 1000)}",
        'userId': user_id,
        'type': type,
        'title': title,
        'message': message,
        'projectId': project_id,
        'data': data or {},
        'read': False,
        'createdAt': datetime.now().isoformat()
    }
    notifications.append(notification)
    save_notifications(notifications)
    return notification


def notify_project_members(project_id, type, title, message, exclude_user_id=None, data=None):
    """通知项目所有成员"""
    projects = load_projects()
    project = next((p for p in projects if p['id'] == project_id), None)
    if not project:
        return []
    
    notifications = []
    for member in project.get('members', []):
        if member['userId'] != exclude_user_id:
            notif = create_notification(
                member['userId'], type, title, message, project_id, data
            )
            notifications.append(notif)
    return notifications


@app.route('/api/notifications', methods=['GET'])
@require_auth
def get_notifications():
    """获取当前用户的通知"""
    user_id = session['user_id']
    notifications = load_notifications()
    user_notifs = [n for n in notifications if n['userId'] == user_id]
    # 按时间倒序，最多返回 50 条
    user_notifs.sort(key=lambda x: x['createdAt'], reverse=True)
    return jsonify(user_notifs[:50])


@app.route('/api/notifications/<notif_id>/read', methods=['POST'])
@require_auth
def mark_notification_read(notif_id):
    """标记通知为已读"""
    user_id = session['user_id']
    notifications = load_notifications()
    
    for notif in notifications:
        if notif['id'] == notif_id and notif['userId'] == user_id:
            notif['read'] = True
            save_notifications(notifications)
            return jsonify({'success': True})
    
    return jsonify({'error': '通知不存在'}), 404


@app.route('/api/notifications/read-all', methods=['POST'])
@require_auth
def mark_all_notifications_read():
    """标记所有通知为已读"""
    user_id = session['user_id']
    notifications = load_notifications()
    
    for notif in notifications:
        if notif['userId'] == user_id:
            notif['read'] = True
    
    save_notifications(notifications)
    return jsonify({'success': True})


@app.route('/api/notifications/unread-count', methods=['GET'])
@require_auth
def get_unread_count():
    """获取未读通知数量"""
    user_id = session['user_id']
    notifications = load_notifications()
    unread = sum(1 for n in notifications if n['userId'] == user_id and not n['read'])
    return jsonify({'count': unread})


# ============== 评论通知 API ==============

def notify_mentioned_users(project_id, comment_data, author_id):
    """当评论中有 @提及时，通知被提及的用户"""
    mentions = comment_data.get('mentions', [])
    if not mentions:
        return []
    
    projects = load_projects()
    project = next((p for p in projects if p['id'] == project_id), None)
    if not project:
        return []
    
    # 获取项目成员列表
    member_ids = [m['userId'] for m in project.get('members', [])]
    
    notifications = []
    for mentioned_name in mentions:
        # 查找被提及的用户
        all_users = get_all_users()
        mentioned_user = next(
            (
                user for user in all_users
                if user['username'] == mentioned_name or display_name_for(user) == mentioned_name
            ),
            None,
        )
        
        if mentioned_user and mentioned_user['id'] != author_id and mentioned_user['id'] in member_ids:
            notif = create_notification(
                mentioned_user['id'],
                'mention',
                f'{comment_data["author"]["name"]} 在评论中提到了你',
                comment_data['content'][:100],  # 截取前100字符
                project_id,
                {
                    'commentId': comment_data['id'],
                    'timelineItemId': comment_data['timelineItemId'],
                    'authorName': comment_data['author']['name']
                }
            )
            notifications.append(notif)
    
    return notifications


@app.route('/api/projects/<project_id>/comments', methods=['POST'])
@require_auth
def add_comment_with_notification(project_id):
    """添加评论并触发通知"""
    data = request.get_json(silent=True) or {}
    user_id = session['user_id']
    
    # 获取用户信息
    user = resolve_user_profile(user_id)
    if not user:
        return jsonify({'error': '用户不存在'}), 404
    
    comment_data = {
        'id': data.get('id'),
        'timelineItemId': data.get('timelineItemId'),
        'content': data.get('content', ''),
        'author': {
            'id': user_id,
            'name': display_name_for(user)
        },
        'mentions': data.get('mentions', []),
        'createdAt': datetime.now().isoformat()
    }
    
    # 创建通知（通知被 @提及的用户）
    notifications = notify_mentioned_users(project_id, comment_data, user_id)
    
    return jsonify({
        'success': True,
        'comment': comment_data,
        'notifications_sent': len(notifications)
    })


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
    
    # 初始化 WebSocket
    init_socketio(app)
    
    # 使用 socketio 启动，支持 WebSocket。
    # allow_unsafe_werkzeug=True 允许在 systemd / 容器等无 debug 的生产场景下
    # 继续用 Werkzeug 开发服务器承载 SocketIO 长连接，避免 502。
    from websocket_handler import socketio
    socketio.run(
        app,
        host='0.0.0.0',
        port=port,
        debug=debug,
        allow_unsafe_werkzeug=True,
    )
