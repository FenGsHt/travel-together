#!/usr/bin/env python3
"""
用户管理模块
处理用户注册、登录、认证
"""

import os
import json
import hmac
import hashlib
import secrets
from datetime import datetime
from pathlib import Path

# 用户数据存储路径
USERS_FILE = Path(__file__).parent / "data" / "users.json"
USERS_FILE.parent.mkdir(exist_ok=True)


def load_users():
    """加载用户数据"""
    if USERS_FILE.exists():
        with open(USERS_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    return []


def save_users(users):
    """保存用户数据"""
    with open(USERS_FILE, "w", encoding="utf-8") as f:
        json.dump(users, f, ensure_ascii=False, indent=2)


def hash_password(password, salt=None):
    """密码哈希（使用 salt 防止彩虹表攻击）"""
    if salt is None:
        salt = secrets.token_hex(16)
    hashed = hashlib.sha256(f"{salt}{password}".encode()).hexdigest()
    return f"{salt}:{hashed}"


def verify_password(password, stored_hash):
    """验证密码"""
    salt, hashed = stored_hash.split(":")
    return hmac.compare_digest(hash_password(password, salt), stored_hash)


def create_user(username, password, display_name=None):
    """创建新用户"""
    users = load_users()
    
    # 检查用户名是否已存在
    if any(u['username'] == username for u in users):
        return None, "用户名已存在"
    
    user = {
        'id': f"user_{int(datetime.now().timestamp() * 1000)}",
        'username': username,
        'password_hash': hash_password(password),
        'display_name': display_name or username,
        'created_at': datetime.now().isoformat(),
        'last_login': None
    }
    
    users.append(user)
    save_users(users)
    
    # 返回用户信息（不包含密码哈希）
    user_info = {k: v for k, v in user.items() if k != 'password_hash'}
    return user_info, None


def authenticate_user(username, password):
    """用户认证"""
    users = load_users()
    user = next((u for u in users if u['username'] == username), None)
    
    if not user:
        return None, "用户不存在"
    
    if not verify_password(password, user['password_hash']):
        return None, "密码错误"
    
    # 更新最后登录时间
    user['last_login'] = datetime.now().isoformat()
    save_users(users)
    
    # 返回用户信息（不包含密码哈希）
    user_info = {k: v for k, v in user.items() if k != 'password_hash'}
    return user_info, None


def get_user_by_id(user_id):
    """根据 ID 获取用户"""
    users = load_users()
    user = next((u for u in users if u['id'] == user_id), None)
    
    if not user:
        return None
    
    # 返回用户信息（不包含密码哈希）
    return {k: v for k, v in user.items() if k != 'password_hash'}


def get_all_users():
    """获取所有用户（不包含密码哈希）"""
    users = load_users()
    return [{k: v for k, v in u.items() if k != 'password_hash'} for u in users]
