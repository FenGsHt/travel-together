// API 客户端
const API_BASE = window.location.origin;

export async function checkAuth() {
  try {
    const resp = await fetch(`${API_BASE}/api/auth/status`, {
      credentials: 'include'
    });
    return await resp.json();
  } catch (error) {
    console.error('Auth check failed:', error);
    return { authenticated: false };
  }
}

export async function getProjects() {
  const resp = await fetch(`${API_BASE}/api/projects`, {
    credentials: 'include'
  });
  if (resp.status === 401) {
    window.location.href = 'login.html';
    return [];
  }
  return await resp.json();
}

export async function getProject(projectId) {
  const resp = await fetch(`${API_BASE}/api/projects/${projectId}`, {
    credentials: 'include'
  });
  if (resp.status === 401) {
    window.location.href = 'login.html';
    return null;
  }
  if (resp.status === 404) {
    return null;
  }
  return await resp.json();
}

export async function createProject(data) {
  const resp = await fetch(`${API_BASE}/api/projects`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(data)
  });
  if (resp.status === 401) {
    window.location.href = 'login.html';
    return null;
  }
  return await resp.json();
}

export async function updateProject(projectId, data) {
  const resp = await fetch(`${API_BASE}/api/projects/${projectId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(data)
  });
  if (resp.status === 401) {
    window.location.href = 'login.html';
    return null;
  }
  return await resp.json();
}

export async function deleteProject(projectId) {
  const resp = await fetch(`${API_BASE}/api/projects/${projectId}`, {
    method: 'DELETE',
    credentials: 'include'
  });
  if (resp.status === 401) {
    window.location.href = 'login.html';
    return false;
  }
  return resp.ok;
}
