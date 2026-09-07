class RealtimeClient {
  constructor() {
    this.socket = null;
    this.projectId = null;
    this.userId = null;
    this.userName = null;
    this.connected = false;
    this.listeners = new Map();
    this.onlineUsers = new Map(); // 在线用户列表
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 5;
  }

  connect(projectId, userId, userName) {
    if (this.connected) {
      console.warn('Already connected');
      return;
    }

    this.projectId = projectId;
    this.userId = userId;
    this.userName = userName;

    // 静态站点由 index.html 通过 CDN 提供 Socket.IO 浏览器客户端。
    if (typeof window.io !== 'function') {
      console.error('Socket.IO 客户端未加载，实时协作不可用');
      this.emit('connection_unavailable');
      return;
    }

    this.socket = window.io(window.location.origin, {
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionAttempts: this.maxReconnectAttempts,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 8000,
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
      this.onlineUsers.set(data.user_id, {
        id: data.user_id,
        name: data.user_name,
        joinedAt: Date.now()
      });
      this.emit('user_joined', data);
      this.emit('online_users_changed', this.getOnlineUsers());
    });

    // 用户离开
    this.socket.on('user_left', (data) => {
      console.log('User left:', data);
      this.onlineUsers.delete(data.user_id);
      this.emit('user_left', data);
      this.emit('online_users_changed', this.getOnlineUsers());
    });

    // 接收当前在线用户列表
    this.socket.on('online_users', (users) => {
      console.log('Online users:', users);
      this.onlineUsers.clear();
      users.forEach(user => {
        this.onlineUsers.set(user.id, user);
      });
      this.emit('online_users_changed', this.getOnlineUsers());
    });

    // 连接错误
    this.socket.on('connect_error', (error) => {
      console.error('WebSocket connection error:', error);
    });
  }

  getOnlineUsers() {
    return Array.from(this.onlineUsers.values());
  }

  // 广播光标位置
  broadcastCursor(elementId, position) {
    if (!this.connected || !this.socket) return;
    
    this.socket.emit('cursor_update', {
      project_id: this.projectId,
      user_id: this.userId,
      user_name: this.userName,
      element_id: elementId,
      position: position,
      timestamp: Date.now()
    });
  }

  // 监听其他人的光标位置
  onCursorUpdate(callback) {
    if (!this.socket) return;
    
    this.socket.on('cursor_update', (data) => {
      callback(data);
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
    this.onlineUsers.clear();
  }

  // 断线重连
  reconnect() {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error('Max reconnect attempts reached');
      this.emit('reconnect_failed');
      return;
    }

    this.reconnectAttempts++;
    console.log(`Reconnecting... attempt ${this.reconnectAttempts}`);
    
    setTimeout(() => {
      if (this.projectId && this.userId && this.userName) {
        this.connect(this.projectId, this.userId, this.userName);
      }
    }, 2000 * this.reconnectAttempts); // 指数退避
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
