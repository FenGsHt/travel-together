from flask_socketio import SocketIO, emit, join_room, leave_room, rooms
from flask import request
from functools import wraps

# 初始化 SocketIO
socketio = SocketIO(cors_allowed_origins="*", async_mode='threading')

# 存储在线用户信息 {project_id: {sid: {user_id, user_name}}}
online_users_by_project = {}

def init_socketio(app):
    """初始化 SocketIO 并注册事件"""
    socketio.init_app(app)
    
    @socketio.on('connect')
    def handle_connect():
        print(f'Client connected: {request.sid}')
    
    @socketio.on('disconnect')
    def handle_disconnect():
        print(f'Client disconnected: {request.sid}')
        # 从所有房间中移除该用户
        for project_id, users in online_users_by_project.items():
            if request.sid in users:
                user_info = users[request.sid]
                del users[request.sid]
                # 通知房间内其他用户
                emit('user_left', {
                    'user_id': user_info['user_id'],
                    'user_name': user_info['user_name']
                }, room=project_id, include_self=False)
                print(f'User {user_info["user_name"]} disconnected from project {project_id}')
    
    @socketio.on('join_project')
    def handle_join_project(data):
        """用户加入项目房间"""
        project_id = data.get('project_id')
        user_id = data.get('user_id')
        user_name = data.get('user_name')
    
        if project_id:
            join_room(project_id)
            
            # 记录在线用户
            if project_id not in online_users_by_project:
                online_users_by_project[project_id] = {}
            
            online_users_by_project[project_id][request.sid] = {
                'user_id': user_id,
                'user_name': user_name
            }
            
            # 获取房间内所有在线用户
            online_users = [
                {'id': info['user_id'], 'name': info['user_name']}
                for sid, info in online_users_by_project[project_id].items()
                if sid != request.sid
            ]
        
            # 发送当前在线用户列表给新加入的用户
            emit('online_users', online_users, room=request.sid)
        
            # 通知房间内其他用户
            emit('user_joined', {
                'user_id': user_id,
                'user_name': user_name,
                'timestamp': request.sid
            }, room=project_id, include_self=False)
            print(f'User {user_name} joined project {project_id}')

    @socketio.on('leave_project')
    def handle_leave_project(data):
        """用户离开项目房间"""
        project_id = data.get('project_id')
        user_id = data.get('user_id')
        user_name = data.get('user_name')
    
        if project_id:
            leave_room(project_id)
            
            # 从在线用户列表中移除
            if project_id in online_users_by_project and request.sid in online_users_by_project[project_id]:
                del online_users_by_project[project_id][request.sid]
            
            # 通知房间内其他用户
            emit('user_left', {
                'user_id': user_id,
                'user_name': user_name
            }, room=project_id, include_self=False)
            print(f'User {user_name} left project {project_id}')
    
    @socketio.on('edit_action')
    def handle_edit_action(data):
        """广播编辑操作"""
        project_id = data.get('project_id')
        
        if project_id:
            # 广播给房间内所有其他用户
            emit('remote_edit', {
                'action': data.get('action'),
                'data': data.get('data'),
                'user_id': data.get('user_id'),
                'user_name': data.get('user_name'),
                'timestamp': data.get('timestamp')
            }, room=project_id, include_self=False)

def broadcast_edit(project_id, action, data, user_id, user_name):
    """广播编辑操作到项目房间"""
    from datetime import datetime
    socketio.emit('remote_edit', {
        'action': action,
        'data': data,
        'user_id': user_id,
        'user_name': user_name,
        'timestamp': datetime.now().isoformat()
    }, room=project_id)

def broadcast_user_action(project_id, action, user_id, user_name, data=None):
    """广播用户操作（加入/离开等）"""
    socketio.emit(action, {
        'user_id': user_id,
        'user_name': user_name,
        'data': data
    }, room=project_id)
