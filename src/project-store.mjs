export class ProjectStore {
  constructor() {
    this.storageKey = 'travel_projects';
    this.projects = this.loadProjects();
  }

  loadProjects() {
    try {
      const data = localStorage.getItem(this.storageKey);
      return data ? JSON.parse(data) : [];
    } catch (error) {
      console.error('Failed to load projects:', error);
      return [];
    }
  }

  saveProjects() {
    try {
      localStorage.setItem(this.storageKey, JSON.stringify(this.projects));
    } catch (error) {
      console.error('Failed to save projects:', error);
    }
  }

  createProject({ name, description, startDate, endDate, destination }) {
    const project = {
      id: `project_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`,
      name,
      description: description || '',
      startDate,
      endDate,
      destination: destination || '',
      members: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      data: {
        blocks: [],
        timeline: [],
        polls: [],
        activity: []
      }
    };
    
    this.projects.push(project);
    this.saveProjects();
    return project;
  }

  getProject(projectId) {
    return this.projects.find(p => p.id === projectId);
  }

  getAllProjects() {
    return [...this.projects].sort((a, b) => 
      new Date(b.updatedAt) - new Date(a.updatedAt)
    );
  }

  updateProject(projectId, updates) {
    const project = this.getProject(projectId);
    if (!project) return null;

    Object.assign(project, updates, {
      updatedAt: new Date().toISOString()
    });
    
    this.saveProjects();
    return project;
  }

  updateProjectData(projectId, data) {
    const project = this.getProject(projectId);
    if (!project) return null;

    project.data = data;
    project.updatedAt = new Date().toISOString();
    
    this.saveProjects();
    return project;
  }

  deleteProject(projectId) {
    const index = this.projects.findIndex(p => p.id === projectId);
    if (index === -1) return false;

    this.projects.splice(index, 1);
    this.saveProjects();
    return true;
  }

  addMember(projectId, member) {
    const project = this.getProject(projectId);
    if (!project) return null;

    if (!project.members.find(m => m.id === member.id)) {
      project.members.push(member);
      project.updatedAt = new Date().toISOString();
      this.saveProjects();
    }
    
    return project;
  }

  removeMember(projectId, memberId) {
    const project = this.getProject(projectId);
    if (!project) return null;

    project.members = project.members.filter(m => m.id !== memberId);
    project.updatedAt = new Date().toISOString();
    this.saveProjects();
    
    return project;
  }
}

export const projectStore = new ProjectStore();
