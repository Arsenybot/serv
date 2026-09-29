import React, { useState, useEffect } from 'react';
import { Navbar } from './components/Navbar.tsx';
import { ProjectCard } from './components/ProjectCard.tsx';
import { ProjectDetails } from './components/ProjectDetails.tsx';
import { AddProjectModal } from './components/AddProjectModal.tsx';
import { DeploymentModal } from './components/DeploymentModal.tsx';
import { WebhookModal } from './components/WebhookModal.tsx';
import { SystemStatusModal } from './components/SystemStatusModal.tsx';
import { Project, Deployment, DeploymentLog, ProjectStats, SystemStatus } from './types.ts';
import { Search, Plus, Filter, Server, CheckCircle2, AlertCircle, RefreshCw } from 'lucide-react';

export default function App() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [deploymentsByProject, setDeploymentsByProject] = useState<Record<string, Deployment[]>>({});
  const [statsByProject, setStatsByProject] = useState<Record<string, ProjectStats>>({});
  const [systemStatus, setSystemStatus] = useState<SystemStatus | null>(null);
  const [isConnected, setIsConnected] = useState(false);

  // Selected project view
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [selectedProjectTab, setSelectedProjectTab] = useState<string>('overview');

  // Active deployment modal
  const [inspectDeployment, setInspectDeployment] = useState<Deployment | null>(null);
  const [inspectLogs, setInspectLogs] = useState<DeploymentLog[]>([]);

  // Modals
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [isWebhookModalOpen, setIsWebhookModalOpen] = useState(false);
  const [isSystemStatusOpen, setIsSystemStatusOpen] = useState(false);

  // Filter & Search
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'LIVE' | 'BUILDING' | 'FAILED' | 'STOPPED'>('ALL');

  // Load initial data
  const loadProjects = async () => {
    try {
      const res = await fetch('/api/projects');
      if (res.ok) {
        const data = await res.json();
        setProjects(data);

        // Fetch deployments and stats for all projects
        for (const proj of data) {
          loadDeploymentsForProject(proj.id);
          loadStatsForProject(proj.id);
        }
      }
    } catch (err) {
      console.error('Failed to load projects:', err);
    }
  };

  const loadSystemStatus = async () => {
    try {
      const res = await fetch('/api/system/status');
      if (res.ok) {
        const data = await res.json();
        setSystemStatus(data);
      }
    } catch (err) {
      console.error('Failed to load system status:', err);
    }
  };

  const loadDeploymentsForProject = async (projectId: string) => {
    try {
      const res = await fetch(`/api/projects/${projectId}/deployments`);
      if (res.ok) {
        const data = await res.json();
        setDeploymentsByProject(prev => ({ ...prev, [projectId]: data }));
      }
    } catch (err) {
      console.error('Failed to load deployments for project:', err);
    }
  };

  const loadStatsForProject = async (projectId: string) => {
    try {
      const res = await fetch(`/api/projects/${projectId}/stats`);
      if (res.ok) {
        const data = await res.json();
        setStatsByProject(prev => ({ ...prev, [projectId]: data }));
      }
    } catch (err) {
      console.error('Failed to load stats for project:', err);
    }
  };

  // Keep a ref to inspectDeployment to avoid stale closure in SSE listener
  const inspectDeploymentRef = React.useRef<Deployment | null>(null);
  useEffect(() => {
    inspectDeploymentRef.current = inspectDeployment;
  }, [inspectDeployment]);

  // Real-time EventSource connection (SSE)
  useEffect(() => {
    loadProjects();
    loadSystemStatus();

    const eventSource = new EventSource('/api/events');

    eventSource.onopen = () => {
      setIsConnected(true);
    };

    eventSource.onerror = () => {
      setIsConnected(false);
    };

    eventSource.addEventListener('project_updated', (event: any) => {
      const updatedProject: Project = JSON.parse(event.data);
      setProjects(prev => {
        const idx = prev.findIndex(p => p.id === updatedProject.id);
        if (idx >= 0) {
          const next = [...prev];
          next[idx] = updatedProject;
          return next;
        }
        return [updatedProject, ...prev];
      });
      loadSystemStatus();
    });

    eventSource.addEventListener('project_deleted', (event: any) => {
      const { id } = JSON.parse(event.data);
      setProjects(prev => prev.filter(p => p.id !== id));
      if (selectedProjectId === id) {
        setSelectedProjectId(null);
      }
      loadSystemStatus();
    });

    eventSource.addEventListener('deployment_created', (event: any) => {
      const dep: Deployment = JSON.parse(event.data);
      setDeploymentsByProject(prev => {
        const list = prev[dep.projectId] || [];
        return { ...prev, [dep.projectId]: [dep, ...list.filter(d => d.id !== dep.id)] };
      });
    });

    eventSource.addEventListener('deployment_updated', (event: any) => {
      const dep: Deployment = JSON.parse(event.data);
      setDeploymentsByProject(prev => {
        const list = prev[dep.projectId] || [];
        const idx = list.findIndex(d => d.id === dep.id);
        if (idx >= 0) {
          const next = [...list];
          next[idx] = dep;
          return { ...prev, [dep.projectId]: next };
        }
        return { ...prev, [dep.projectId]: [dep, ...list] };
      });

      // If this deployment is currently inspected in modal, update modal state
      setInspectDeployment(curr => (curr && curr.id === dep.id ? dep : curr));
    });

    eventSource.addEventListener('log_added', (event: any) => {
      const log: DeploymentLog = JSON.parse(event.data);
      const currentInspected = inspectDeploymentRef.current;
      if (currentInspected && currentInspected.id === log.deploymentId) {
        setInspectLogs(prev => [...prev, log]);
      }
    });

    eventSource.addEventListener('stats_updated', (event: any) => {
      const stats: ProjectStats = JSON.parse(event.data);
      setStatsByProject(prev => ({ ...prev, [stats.projectId]: stats }));
    });

    return () => {
      eventSource.close();
    };
  }, []);


  // Filter projects
  const filteredProjects = projects.filter(p => {
    if (statusFilter !== 'ALL' && p.status !== statusFilter) return false;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      return (
        p.name.toLowerCase().includes(q) ||
        p.repositoryUrl.toLowerCase().includes(q) ||
        p.domain.toLowerCase().includes(q)
      );
    }
    return true;
  });

  // Active polling fallback when inspectDeployment is active and in progress
  useEffect(() => {
    if (!inspectDeployment) return;
    const isFinished = ['LIVE', 'FAILED', 'BUILD_FAILED', 'START_FAILED', 'HEALTH_CHECK_FAILED', 'CANCELLED'].includes(inspectDeployment.status);
    if (isFinished) return;

    const interval = setInterval(async () => {
      try {
        const [depRes, logsRes] = await Promise.all([
          fetch(`/api/deployments/${inspectDeployment.id}`),
          fetch(`/api/deployments/${inspectDeployment.id}/logs`),
        ]);

        if (depRes.ok) {
          const updatedDep = await depRes.json();
          setInspectDeployment(updatedDep);
        }
        if (logsRes.ok) {
          const updatedLogs = await logsRes.json();
          setInspectLogs(updatedLogs);
        }
      } catch (err) {
        console.error('Polling error:', err);
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [inspectDeployment?.id, inspectDeployment?.status]);

  // Action handlers
  const handleTriggerDeploy = async (projectId: string) => {
    try {
      const res = await fetch(`/api/projects/${projectId}/deploy`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ commitMessage: 'Manual deploy triggered from dashboard' }),
      });
      if (res.ok) {
        const data = await res.json();
        setInspectDeployment(data.deployment);
        setInspectLogs([]);
      }
    } catch (err) {
      console.error('Failed to trigger deploy:', err);
    }
  };


  const handleRestart = async (projectId: string) => {
    try {
      await fetch(`/api/projects/${projectId}/restart`, { method: 'POST' });
    } catch (err) {
      console.error(err);
    }
  };

  const handleStop = async (projectId: string) => {
    try {
      await fetch(`/api/projects/${projectId}/stop`, { method: 'POST' });
    } catch (err) {
      console.error(err);
    }
  };

  const handleStart = async (projectId: string) => {
    try {
      await fetch(`/api/projects/${projectId}/start`, { method: 'POST' });
    } catch (err) {
      console.error(err);
    }
  };

  const handleRollback = async (deploymentId: string) => {
    if (!selectedProjectId) return;
    try {
      const res = await fetch(`/api/projects/${selectedProjectId}/rollback/${deploymentId}`, {
        method: 'POST',
      });
      if (res.ok) {
        // Modal can be closed or updated
        setInspectDeployment(null);
      }
    } catch (err) {
      console.error('Rollback error:', err);
    }
  };

  const handleInspectDeployment = async (dep: Deployment) => {
    setInspectDeployment(dep);
    try {
      const res = await fetch(`/api/deployments/${dep.id}/logs`);
      if (res.ok) {
        const logs = await res.json();
        setInspectLogs(logs);
      }
    } catch {
      setInspectLogs([]);
    }
  };

  const handleUpdateProject = async (projectId: string, updates: Partial<Project>) => {
    try {
      const res = await fetch(`/api/projects/${projectId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      });
      if (res.ok) {
        const updated = await res.json();
        setProjects(prev => prev.map(p => (p.id === projectId ? updated : p)));
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleDeleteProject = async (projectId: string) => {
    try {
      const res = await fetch(`/api/projects/${projectId}`, { method: 'DELETE' });
      if (res.ok) {
        setProjects(prev => prev.filter(p => p.id !== projectId));
        setSelectedProjectId(null);
      }
    } catch (err) {
      console.error(err);
    }
  };

  const selectedProject = projects.find(p => p.id === selectedProjectId);

  return (
    <div className="min-h-screen bg-[#0c1017] text-zinc-100 flex flex-col font-sans selection:bg-emerald-500/30 selection:text-emerald-200">
      {/* Top Navigation */}
      <Navbar
        systemStatus={systemStatus}
        isConnected={isConnected}
        onOpenAddProject={() => setIsAddModalOpen(true)}
        onOpenWebhookModal={() => setIsWebhookModalOpen(true)}
        onOpenSystemStatus={() => setIsSystemStatusOpen(true)}
      />

      {/* Main Content Area */}
      <main className="flex-1">
        {selectedProject ? (
          /* Project Details View */
          <ProjectDetails
            project={selectedProject}
            deployments={deploymentsByProject[selectedProject.id] || []}
            stats={statsByProject[selectedProject.id]}
            initialTab={selectedProjectTab}
            onBack={() => setSelectedProjectId(null)}
            onTriggerDeploy={handleTriggerDeploy}
            onRestart={handleRestart}
            onStop={handleStop}
            onStart={handleStart}
            onRollback={handleRollback}
            onSelectDeployment={handleInspectDeployment}
            onUpdateProject={handleUpdateProject}
            onDeleteProject={handleDeleteProject}
          />
        ) : (
          /* Main Dashboard: Projects List */
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
            {/* Header & Stats Banner */}
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <h1 className="text-xl font-bold tracking-tight text-zinc-100">
                  Applications
                </h1>
                <p className="text-xs text-zinc-400 mt-0.5">
                  Automated local Docker deployments via Traefik reverse proxy
                </p>
              </div>

              {/* Status Summary Counts */}
              <div className="flex items-center gap-3 text-xs font-mono">
                <div className="flex items-center gap-1.5 text-zinc-400">
                  <span className="w-2 h-2 rounded-full bg-emerald-400" />
                  <span>{projects.filter(p => p.status === 'LIVE').length} Live</span>
                </div>
                <span className="text-zinc-700">·</span>
                <div className="flex items-center gap-1.5 text-zinc-400">
                  <span className="w-2 h-2 rounded-full bg-amber-400" />
                  <span>{projects.filter(p => p.status === 'BUILDING').length} Building</span>
                </div>
                <span className="text-zinc-700">·</span>
                <div className="flex items-center gap-1.5 text-zinc-400">
                  <span className="w-2 h-2 rounded-full bg-zinc-500" />
                  <span>{projects.length} Total</span>
                </div>
              </div>
            </div>

            {/* Filter Bar & Search */}
            <div className="flex flex-wrap items-center justify-between gap-3 bg-zinc-900/60 p-2.5 rounded-xl border border-zinc-800">
              {/* Segmented Filter Control */}
              <div className="flex items-center gap-1 bg-zinc-950 p-1 rounded-lg border border-zinc-800 text-xs">
                {(['ALL', 'LIVE', 'BUILDING', 'FAILED', 'STOPPED'] as const).map(tab => (
                  <button
                    key={tab}
                    onClick={() => setStatusFilter(tab)}
                    className={`px-3 py-1 rounded-md font-medium transition-colors cursor-pointer ${
                      statusFilter === tab
                        ? 'bg-zinc-800 text-zinc-100 shadow-sm'
                        : 'text-zinc-400 hover:text-zinc-200'
                    }`}
                  >
                    {tab}
                  </button>
                ))}
              </div>

              {/* Search Box */}
              <div className="relative w-full sm:w-64">
                <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" />
                <input
                  type="text"
                  placeholder="Filter by name, repo, or domain..."
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  className="w-full pl-9 pr-3 py-1.5 bg-zinc-950 border border-zinc-800 focus:border-zinc-700 rounded-lg text-xs text-zinc-200 placeholder-zinc-500 focus:outline-none"
                />
              </div>
            </div>

            {/* Project Cards Grid */}
            {filteredProjects.length === 0 ? (
              <div className="bg-zinc-900/40 border border-dashed border-zinc-800 rounded-2xl p-12 text-center max-w-lg mx-auto my-12 space-y-4">
                <div className="w-12 h-12 rounded-xl bg-zinc-800/80 flex items-center justify-center text-zinc-400 mx-auto">
                  <Server className="w-6 h-6" />
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-zinc-200">No applications found</h3>
                  <p className="text-xs text-zinc-500 mt-1">
                    {searchQuery
                      ? 'No projects match your search query.'
                      : 'Connect your first GitHub repository to launch automated local deployments.'}
                  </p>
                </div>
                <button
                  onClick={() => setIsAddModalOpen(true)}
                  className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium text-zinc-950 bg-emerald-400 hover:bg-emerald-300 rounded-lg shadow-sm transition-colors cursor-pointer"
                >
                  <Plus className="w-4 h-4" />
                  <span>Add First Project</span>
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
                {filteredProjects.map(project => {
                  const projectDeployments = deploymentsByProject[project.id] || [];
                  const currentDep =
                    projectDeployments.find(d => d.id === project.currentDeploymentId) ||
                    projectDeployments[0];
                  const stats = statsByProject[project.id];

                  return (
                    <ProjectCard
                      key={project.id}
                      project={project}
                      currentDeployment={currentDep}
                      stats={stats}
                      onSelectProject={(id, tab) => {
                        setSelectedProjectId(id);
                        if (tab) setSelectedProjectTab(tab);
                      }}
                      onTriggerDeploy={handleTriggerDeploy}
                    />
                  );
                })}
              </div>
            )}
          </div>
        )}
      </main>

      {/* Modals */}
      <AddProjectModal
        isOpen={isAddModalOpen}
        onClose={() => setIsAddModalOpen(false)}
        onProjectCreated={newProj => {
          setProjects(prev => [newProj, ...prev]);
          loadDeploymentsForProject(newProj.id);
        }}
      />

      <DeploymentModal
        deployment={inspectDeployment}
        project={inspectDeployment ? projects.find(p => p.id === inspectDeployment.projectId) || null : null}
        logs={inspectLogs}
        isOpen={Boolean(inspectDeployment)}
        onClose={() => setInspectDeployment(null)}
        onRollback={handleRollback}
        onRedeploy={handleTriggerDeploy}
      />

      <WebhookModal
        isOpen={isWebhookModalOpen}
        projects={projects}
        onClose={() => setIsWebhookModalOpen(false)}
        onSimulationTriggered={() => {
          loadProjects();
        }}
      />

      <SystemStatusModal
        isOpen={isSystemStatusOpen}
        onClose={() => setIsSystemStatusOpen(false)}
        status={systemStatus}
      />
    </div>
  );
}
