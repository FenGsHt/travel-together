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

async function fetchJSON(url, options = {}) {
  const resp = await fetch(url, { credentials: 'include', ...options });
  if (resp.status === 401) {
    window.location.href = 'login.html';
    return null;
  }
  if (!resp.ok) {
    const err = new Error(`HTTP ${resp.status}`);
    err.status = resp.status;
    throw err;
  }
  return await resp.json();
}

export async function getProjects() {
  return await fetchJSON(`${API_BASE}/api/projects`) || [];
}

export async function getProject(projectId) {
  const resp = await fetch(`${API_BASE}/api/projects/${projectId}`, { credentials: 'include' });
  if (resp.status === 401) { window.location.href = 'login.html'; return null; }
  if (resp.status === 404) return null;
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  return await resp.json();
}

export async function createProject(data) {
  return await fetchJSON(`${API_BASE}/api/projects`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  });
}

export async function updateProject(projectId, data) {
  const resp = await fetch(`${API_BASE}/api/projects/${projectId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(data)
  });
  if (resp.status === 401) { window.location.href = 'login.html'; return null; }
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  const payload = await resp.json();
  if (resp.status === 409) return { conflict: true, project: payload.project };
  return payload;
}

export async function deleteProject(projectId) {
  const resp = await fetch(`${API_BASE}/api/projects/${projectId}`, {
    method: 'DELETE',
    credentials: 'include'
  });
  if (resp.status === 401) { window.location.href = 'login.html'; return false; }
  return resp.ok;
}
