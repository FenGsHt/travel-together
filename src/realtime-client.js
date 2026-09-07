import { io } from 'socket.io-client';

class RealtimeClient {
  constructor() {
    this.socket = null;
    this.projectId = null;
    this.userId = null;
    this.userName = null;
    this.connected = false;
    this.listeners = new Map();
  }

  connect(projectId, userId, userName) {
    if (this.connected) {
      console.warn('Already connected');
      return;
    }

    this.projectId = projectId;
    this.userId = userId;
    this.userName = userName;

    // 连接到 WebSocket 服务器
    const wsUrl = window.location.origin.replace(/^http/, 'ws');
    this.socket = io(wsUrl, {
      transports: ['websocket', 'polling']
    });

    // 连接成功
    this.socket.on('connect', () => {
      console.log('WebSocket connected');
      this.connected = true;
      
      // 加入项目房间
      this.socket.emit('join_project', {
        project_id: projectId,
        user_id: userId,
        user_name: userName
      });
    });

    // 连接断开
    this.socket.on('disconnect', () => {
      console.log('WebSocket disconnected');
      this.connected = false;
    });

    // 接收远程编辑操作
    this.socket.on('remote_edit', (data) => {
      console.log('Remote edit received:', data);
      this.emit('remote_edit', data);
    });

    // 用户加入
    this.socket.on('user_joined', (data) => {
      console.log('User joined:', data);
      this.emit('user_joined', data);
    });

    // 用户离开
    this.socket.on('user_left', (data) => {
      console.log('User left:', data);
      this.emit('user_left', data);
    });

    // 连接错误
    this.socket.on('connect_error', (error) => {
      console.error('WebSocket connection error:', error);
    });
  }

  disconnect() {
    if (!this.connected || !this.socket) {
      return;
    }

    // 离开项目房间
    this.socket.emit('leave_project', {
      project_id: this.projectId,
      user_id: this.userId,
      user_name: this.userName
    });

    this.socket.disconnect();
    this.connected = false;
    this.projectId = null;
    this.userId = null;
    this.userName = null;
  }

  // 广播编辑操作
  broadcastEdit(action, data) {
    if (!this.connected || !this.socket) {
      console.warn('Not connected, cannot broadcast');
      return;
    }

    this.socket.emit('edit_action', {
      project_id: this.projectId,
      action: action,
      data: data,
      user_id: this.userId,
      user_name: this.userName,
      timestamp: new Date().toISOString()
    });
  }

  // 事件监听
  on(event, callback) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, []);
    }
    this.listeners.get(event).push(callback);
  }

  off(event, callback) {
    if (!this.listeners.has(event)) {
      return;
    }
    
    if (callback) {
      const callbacks = this.listeners.get(event);
      const index = callbacks.indexOf(callback);
      if (index > -1) {
        callbacks.splice(index, 1);
      }
    } else {
      this.listeners.delete(event);
    }
  }

  emit(event, data) {
    if (!this.listeners.has(event)) {
      return;
    }
    
    const callbacks = this.listeners.get(event);
    callbacks.forEach(callback => callback(data));
  }
}

// 创建全局实例
export const realtimeClient = new RealtimeClient();
