import React, { useState, useEffect } from 'react';
import {
  ArrowLeft,
  Play,
  RotateCcw,
  Square,
  RefreshCw,
  ExternalLink,
  Cpu,
  HardDrive,
  Activity,
  GitBranch,
  ShieldCheck,
  Eye,
  EyeOff,
  Plus,
  Trash2,
  Settings as SettingsIcon,
  Terminal,
  History,
  Info,
  Clock,
  ArrowUpRight,
  AlertTriangle,
} from 'lucide-react';
import { Project, Deployment, DeploymentLog, ProjectStats, EnvironmentVariable } from '../types.ts';
import { LogViewer } from './LogViewer.tsx';

interface ProjectDetailsProps {
  project: Project;
  deployments: Deployment[];
  stats?: ProjectStats;
  initialTab?: string;
  onBack: () => void;
  onTriggerDeploy: (projectId: string) => void;
  onRestart: (projectId: string) => void;
  onStop: (projectId: string) => void;
  onStart: (projectId: string) => void;
  onRollback: (deploymentId: string) => void;
  onSelectDeployment: (deployment: Deployment) => void;
  onUpdateProject: (projectId: string, updates: Partial<Project>) => Promise<void>;
  onDeleteProject: (projectId: string) => Promise<void>;
}

export const ProjectDetails: React.FC<ProjectDetailsProps> = ({
  project,
  deployments,
  stats,
  initialTab = 'overview',
  onBack,
  onTriggerDeploy,
  onRestart,
  onStop,
  onStart,
  onRollback,
  onSelectDeployment,
  onUpdateProject,
  onDeleteProject,
}) => {
  const [activeTab, setActiveTab] = useState<'overview' | 'deployments' | 'logs' | 'env' | 'settings'>(
    (initialTab as any) || 'overview'
  );

  // Logs for current deployment
  const [currentLogs, setCurrentLogs] = useState<DeploymentLog[]>([]);
  
  // Environment variables state
  const [envVars, setEnvVars] = useState<EnvironmentVariable[]>([]);
  const [revealedKeys, setRevealedKeys] = useState<Set<string>>(new Set());
  const [newEnvKey, setNewEnvKey] = useState('');
  const [newEnvValue, setNewEnvValue] = useState('');
  const [isSavingEnv, setIsSavingEnv] = useState(false);

  // Settings form state
  const [branch, setBranch] = useState(project.branch);
  const [internalPort, setInternalPort] = useState(project.internalPort);
  const [healthPath, setHealthPath] = useState(project.healthPath);
  const [domain, setDomain] = useState(project.domain);
  const [cpuLimit, setCpuLimit] = useState(project.cpuLimit);
  const [memoryLimit, setMemoryLimit] = useState(project.memoryLimit);
  const [autoDeploy, setAutoDeploy] = useState(project.autoDeploy);
  const [isSavingSettings, setIsSavingSettings] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  const currentDeployment = deployments.find(d => d.id === project.currentDeploymentId) || deployments[0];

  // Fetch env vars
  const fetchEnvVars = async (reveal = false) => {
    try {
      const res = await fetch(`/api/projects/${project.id}/env?reveal=${reveal}`);
      if (res.ok) {
        const data = await res.json();
        setEnvVars(data);
      }
    } catch (err) {
      console.error('Failed to load env vars:', err);
    }
  };

  // Fetch current logs
  const fetchCurrentLogs = async () => {
    if (!currentDeployment) return;
    try {
      const res = await fetch(`/api/deployments/${currentDeployment.id}/logs`);
      if (res.ok) {
        const data = await res.json();
        setCurrentLogs(data);
      }
    } catch (err) {
      console.error('Failed to load logs:', err);
    }
  };

  useEffect(() => {
    fetchEnvVars();
    fetchCurrentLogs();

    // Auto-poll logs if active tab is logs or overview and status is building/starting
    const isLiveOrDone = ['LIVE', 'FAILED', 'BUILD_FAILED', 'START_FAILED', 'HEALTH_CHECK_FAILED'].includes(currentDeployment?.status || '');
    if (!isLiveOrDone) {
      const interval = setInterval(fetchCurrentLogs, 1500);
      return () => clearInterval(interval);
    }
  }, [project.id, currentDeployment?.id, currentDeployment?.status]);


  const handleAddEnv = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newEnvKey.trim()) return;
    setIsSavingEnv(true);
    try {
      const res = await fetch(`/api/projects/${project.id}/env`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: newEnvKey.trim(), value: newEnvValue }),
      });
      if (res.ok) {
        setNewEnvKey('');
        setNewEnvValue('');
        fetchEnvVars();
      }
    } finally {
      setIsSavingEnv(false);
    }
  };

  const handleDeleteEnv = async (key: string) => {
    try {
      await fetch(`/api/projects/${project.id}/env/${key}`, { method: 'DELETE' });
      fetchEnvVars();
    } catch (err) {
      console.error(err);
    }
  };

  const toggleRevealKey = async (key: string) => {
    const next = new Set(revealedKeys);
    if (next.has(key)) {
      next.delete(key);
      setRevealedKeys(next);
      fetchEnvVars(false);
    } else {
      next.add(key);
      setRevealedKeys(next);
      fetchEnvVars(true);
    }
  };

  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSavingSettings(true);
    try {
      await onUpdateProject(project.id, {
        branch,
        internalPort: Number(internalPort),
        healthPath,
        domain,
        cpuLimit,
        memoryLimit,
        autoDeploy,
      });
    } finally {
      setIsSavingSettings(false);
    }
  };

  const formatUptime = (seconds?: number) => {
    if (!seconds) return '—';
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    if (h > 0) return `${h}h ${m}m`;
    if (m > 0) return `${m}m ${s}s`;
    return `${s}s`;
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
      {/* Top Navigation & Status Bar */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-zinc-800 pb-5">
        <div className="flex items-center gap-3">
          <button
            onClick={onBack}
            className="p-2 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900 rounded-lg transition-colors cursor-pointer"
            title="Back to all projects"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-xl font-bold text-zinc-100 tracking-tight">{project.name}</h1>
              <span
                className={`px-2.5 py-0.5 text-xs font-mono font-medium rounded border ${
                  project.status === 'LIVE'
                    ? 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20'
                    : project.status === 'BUILDING'
                    ? 'text-amber-400 bg-amber-500/10 border-amber-500/20 animate-pulse'
                    : project.status === 'FAILED'
                    ? 'text-rose-400 bg-rose-500/10 border-rose-500/20'
                    : 'text-zinc-400 bg-zinc-800/40 border-zinc-700/40'
                }`}
              >
                {project.status}
              </span>
            </div>
            <div className="flex items-center gap-2 text-xs text-zinc-400 font-mono mt-1">
              <span>{project.repositoryUrl}</span>
              <span aria-hidden="true" className="text-zinc-600">·</span>
              <span className="text-zinc-300">branch: {project.branch}</span>
            </div>
          </div>
        </div>

        {/* Global Project Controls: Deploy, Restart, Stop/Start */}
        <div className="flex items-center gap-2">
          {project.status === 'LIVE' ? (
            <button
              onClick={() => onStop(project.id)}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-zinc-900 hover:bg-zinc-800 text-zinc-300 border border-zinc-800 rounded-lg transition-colors cursor-pointer"
            >
              <Square className="w-3.5 h-3.5 text-amber-400" />
              <span>Stop</span>
            </button>
          ) : (
            <button
              onClick={() => onStart(project.id)}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-zinc-900 hover:bg-zinc-800 text-zinc-300 border border-zinc-800 rounded-lg transition-colors cursor-pointer"
            >
              <Play className="w-3.5 h-3.5 text-emerald-400 fill-current" />
              <span>Start</span>
            </button>
          )}

          <button
            onClick={() => onRestart(project.id)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-zinc-900 hover:bg-zinc-800 text-zinc-300 border border-zinc-800 rounded-lg transition-colors cursor-pointer"
          >
            <RefreshCw className="w-3.5 h-3.5 text-sky-400" />
            <span>Restart</span>
          </button>

          <button
            onClick={() => onTriggerDeploy(project.id)}
            disabled={project.status === 'BUILDING'}
            className="flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-medium bg-emerald-400 hover:bg-emerald-300 active:bg-emerald-500 text-zinc-950 rounded-lg shadow-sm transition-colors cursor-pointer disabled:opacity-50"
          >
            <Play className="w-3.5 h-3.5 fill-current" />
            <span>Deploy Now</span>
          </button>
        </div>
      </div>

      {/* Tabs Bar */}
      <div className="flex items-center gap-1 bg-zinc-950 p-1 rounded-xl border border-zinc-800 max-w-fit">
        <button
          onClick={() => setActiveTab('overview')}
          className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-medium transition-colors cursor-pointer ${
            activeTab === 'overview'
              ? 'bg-zinc-800 text-zinc-100 shadow-sm'
              : 'text-zinc-400 hover:text-zinc-200'
          }`}
        >
          <Info className="w-3.5 h-3.5" />
          <span>Overview</span>
        </button>

        <button
          onClick={() => setActiveTab('deployments')}
          className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-medium transition-colors cursor-pointer ${
            activeTab === 'deployments'
              ? 'bg-zinc-800 text-zinc-100 shadow-sm'
              : 'text-zinc-400 hover:text-zinc-200'
          }`}
        >
          <History className="w-3.5 h-3.5" />
          <span>Deployments</span>
          <span className="text-[10px] font-mono px-1.5 py-0.2 bg-zinc-900 rounded text-zinc-400">
            {deployments.length}
          </span>
        </button>

        <button
          onClick={() => setActiveTab('logs')}
          className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-medium transition-colors cursor-pointer ${
            activeTab === 'logs'
              ? 'bg-zinc-800 text-zinc-100 shadow-sm'
              : 'text-zinc-400 hover:text-zinc-200'
          }`}
        >
          <Terminal className="w-3.5 h-3.5" />
          <span>Logs</span>
        </button>

        <button
          onClick={() => setActiveTab('env')}
          className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-medium transition-colors cursor-pointer ${
            activeTab === 'env'
              ? 'bg-zinc-800 text-zinc-100 shadow-sm'
              : 'text-zinc-400 hover:text-zinc-200'
          }`}
        >
          <ShieldCheck className="w-3.5 h-3.5" />
          <span>Environment</span>
          <span className="text-[10px] font-mono px-1.5 py-0.2 bg-zinc-900 rounded text-zinc-400">
            {envVars.length}
          </span>
        </button>

        <button
          onClick={() => setActiveTab('settings')}
          className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-medium transition-colors cursor-pointer ${
            activeTab === 'settings'
              ? 'bg-zinc-800 text-zinc-100 shadow-sm'
              : 'text-zinc-400 hover:text-zinc-200'
          }`}
        >
          <SettingsIcon className="w-3.5 h-3.5" />
          <span>Settings</span>
        </button>
      </div>

      {/* TAB 1: OVERVIEW */}
      {activeTab === 'overview' && (
        <div className="space-y-6">
          {/* Quick Metrics Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="bg-zinc-900/60 border border-zinc-800 rounded-xl p-4">
              <div className="flex items-center justify-between text-zinc-400 mb-2">
                <span className="text-xs font-medium">CPU Usage</span>
                <Cpu className="w-4 h-4 text-emerald-400" />
              </div>
              <div className="text-2xl font-bold font-mono text-zinc-100">
                {stats && project.status === 'LIVE' ? `${stats.cpuPercent}%` : '0%'}
              </div>
              <p className="text-[11px] text-zinc-500 mt-1 font-mono">Limit: {project.cpuLimit} CPU</p>
            </div>

            <div className="bg-zinc-900/60 border border-zinc-800 rounded-xl p-4">
              <div className="flex items-center justify-between text-zinc-400 mb-2">
                <span className="text-xs font-medium">Memory Usage</span>
                <HardDrive className="w-4 h-4 text-sky-400" />
              </div>
              <div className="text-2xl font-bold font-mono text-zinc-100">
                {stats && project.status === 'LIVE' ? `${Math.round(stats.memoryMb)} MB` : '0 MB'}
              </div>
              <p className="text-[11px] text-zinc-500 mt-1 font-mono">Limit: {project.memoryLimit}</p>
            </div>

            <div className="bg-zinc-900/60 border border-zinc-800 rounded-xl p-4">
              <div className="flex items-center justify-between text-zinc-400 mb-2">
                <span className="text-xs font-medium">Uptime</span>
                <Clock className="w-4 h-4 text-amber-400" />
              </div>
              <div className="text-2xl font-bold font-mono text-zinc-100">
                {formatUptime(stats?.uptimeSeconds)}
              </div>
              <p className="text-[11px] text-zinc-500 mt-1 font-mono">Restarts: {stats?.restartCount || 0}</p>
            </div>

            <div className="bg-zinc-900/60 border border-zinc-800 rounded-xl p-4">
              <div className="flex items-center justify-between text-zinc-400 mb-2">
                <span className="text-xs font-medium">Network I/O</span>
                <Activity className="w-4 h-4 text-indigo-400" />
              </div>
              <div className="text-sm font-bold font-mono text-zinc-100">
                RX: {Math.round(stats?.networkRxKb || 0)} KB
              </div>
              <div className="text-sm font-bold font-mono text-zinc-100 mt-0.5">
                TX: {Math.round(stats?.networkTxKb || 0)} KB
              </div>
            </div>
          </div>

          {/* Active Container & Current Deployment Details */}
          <div className="bg-zinc-900/60 border border-zinc-800 rounded-xl p-5 space-y-4">
            <h3 className="text-sm font-semibold text-zinc-200">Active Deployment & Routing</h3>
            
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 text-xs font-mono">
              <div className="bg-zinc-950 p-3 rounded-lg border border-zinc-800/80">
                <span className="text-zinc-500 block mb-1">Public URL</span>
                <a
                  href={`http://${project.domain}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-emerald-400 hover:text-emerald-300 flex items-center gap-1 truncate"
                >
                  <span className="truncate">http://{project.domain}</span>
                  <ArrowUpRight className="w-3.5 h-3.5 shrink-0" />
                </a>
              </div>

              <div className="bg-zinc-950 p-3 rounded-lg border border-zinc-800/80">
                <span className="text-zinc-500 block mb-1">Active Commit</span>
                <span className="text-zinc-200">
                  {currentDeployment ? currentDeployment.commitSha.slice(0, 7) : '—'}
                </span>
                <span className="text-zinc-500 block truncate mt-0.5">
                  {currentDeployment?.commitMessage || 'No deployments yet'}
                </span>
              </div>

              <div className="bg-zinc-950 p-3 rounded-lg border border-zinc-800/80">
                <span className="text-zinc-500 block mb-1">Docker Container</span>
                <span className="text-zinc-300 truncate block">
                  {currentDeployment?.containerId || 'None'}
                </span>
                <span className="text-zinc-500 block mt-0.5">Port: {project.internalPort}</span>
              </div>
            </div>
          </div>

          {/* Quick Logs Terminal Preview */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-sm font-semibold text-zinc-200">Recent Logs</h3>
              <button
                onClick={() => setActiveTab('logs')}
                className="text-xs text-emerald-400 hover:text-emerald-300 font-medium cursor-pointer"
              >
                View Full Terminal →
              </button>
            </div>
            <LogViewer logs={currentLogs.slice(-50)} />
          </div>
        </div>
      )}

      {/* TAB 2: DEPLOYMENTS HISTORY & ROLLBACK */}
      {activeTab === 'deployments' && (
        <div className="bg-zinc-900/60 border border-zinc-800 rounded-xl overflow-hidden shadow-sm">
          <div className="px-5 py-4 border-b border-zinc-800 flex items-center justify-between bg-zinc-950/60">
            <div>
              <h3 className="text-sm font-semibold text-zinc-100">Deployment History</h3>
              <p className="text-xs text-zinc-400">
                Previous releases with instant zero-downtime rollback capability
              </p>
            </div>
            <button
              onClick={() => onTriggerDeploy(project.id)}
              disabled={project.status === 'BUILDING'}
              className="px-3 py-1.5 text-xs font-medium text-zinc-950 bg-emerald-400 hover:bg-emerald-300 rounded-lg transition-colors cursor-pointer"
            >
              Trigger New Deploy
            </button>
          </div>

          <div className="divide-y divide-zinc-800/80">
            {deployments.length === 0 ? (
              <div className="p-8 text-center text-zinc-500 text-xs">No deployments recorded yet.</div>
            ) : (
              deployments.map(dep => {
                const isCurrent = dep.id === project.currentDeploymentId;
                return (
                  <div
                    key={dep.id}
                    className="p-4 hover:bg-zinc-900/80 flex flex-wrap items-center justify-between gap-4 transition-colors"
                  >
                    <div className="flex items-start gap-3">
                      <div className="mt-1">
                        <span
                          className={`w-2.5 h-2.5 rounded-full block ${
                            dep.status === 'LIVE'
                              ? 'bg-emerald-400'
                              : dep.status === 'BUILDING'
                              ? 'bg-amber-400 animate-pulse'
                              : 'bg-rose-400'
                          }`}
                        />
                      </div>

                      <div>
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => onSelectDeployment(dep)}
                            className="font-mono text-xs font-semibold text-zinc-100 hover:text-emerald-400 transition-colors cursor-pointer"
                          >
                            {dep.commitSha.slice(0, 7)}
                          </button>
                          <span className="text-xs text-zinc-400">·</span>
                          <span className="text-xs text-zinc-300 truncate max-w-md">
                            {dep.commitMessage}
                          </span>
                          {isCurrent && (
                            <span className="px-1.5 py-0.2 bg-emerald-500/20 text-emerald-400 text-[10px] font-mono rounded font-medium border border-emerald-500/30">
                              ACTIVE NOW
                            </span>
                          )}
                        </div>

                        <div className="flex items-center gap-3 text-[11px] text-zinc-500 font-mono mt-1">
                          <span>{dep.id}</span>
                          <span>·</span>
                          <span>{new Date(dep.startedAt).toLocaleString()}</span>
                          {dep.author && (
                            <>
                              <span>·</span>
                              <span>By {dep.author}</span>
                            </>
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      <span
                        className={`text-xs font-mono px-2 py-0.5 rounded border ${
                          dep.status === 'LIVE'
                            ? 'text-emerald-400 border-emerald-500/30 bg-emerald-500/10'
                            : dep.status === 'BUILDING'
                            ? 'text-amber-400 border-amber-500/30 bg-amber-500/10'
                            : 'text-rose-400 border-rose-500/30 bg-rose-500/10'
                        }`}
                      >
                        {dep.status}
                      </span>

                      {/* Rollback button: available on any previous successful deployment */}
                      {!isCurrent && dep.status === 'LIVE' && (
                        <button
                          onClick={() => onRollback(dep.id)}
                          className="flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-amber-300 hover:text-amber-200 bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/30 rounded-lg transition-colors cursor-pointer"
                          title="Instant Zero-Downtime Rollback (reuses image without rebuild)"
                        >
                          <RotateCcw className="w-3 h-3" />
                          <span>Rollback</span>
                        </button>
                      )}

                      <button
                        onClick={() => onSelectDeployment(dep)}
                        className="px-2.5 py-1 text-xs text-zinc-400 hover:text-zinc-200 bg-zinc-800 hover:bg-zinc-700 rounded-lg transition-colors cursor-pointer"
                      >
                        Details
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}

      {/* TAB 3: LOGS */}
      {activeTab === 'logs' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-zinc-200">
              Live Container Logs ({project.name})
            </h3>
            <span className="text-xs text-zinc-400 font-mono">
              Deployment: {currentDeployment?.id || '—'}
            </span>
          </div>
          <LogViewer logs={currentLogs} onClear={() => setCurrentLogs([])} />
        </div>
      )}

      {/* TAB 4: ENVIRONMENT VARIABLES */}
      {activeTab === 'env' && (
        <div className="bg-zinc-900/60 border border-zinc-800 rounded-xl p-5 space-y-5">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-sm font-semibold text-zinc-100">Environment Variables</h3>
              <p className="text-xs text-zinc-400">
                Encrypted with AES-256-GCM. Injected securely into Docker container at start.
              </p>
            </div>
          </div>

          {/* Add New Variable Form */}
          <form onSubmit={handleAddEnv} className="flex flex-wrap items-center gap-2 bg-zinc-950 p-3 rounded-lg border border-zinc-800">
            <input
              type="text"
              placeholder="KEY (e.g. DATABASE_URL)"
              value={newEnvKey}
              onChange={e => setNewEnvKey(e.target.value.toUpperCase())}
              className="px-3 py-1.5 bg-zinc-900 border border-zinc-800 focus:border-emerald-500 rounded text-xs font-mono text-zinc-200 placeholder-zinc-600 focus:outline-none flex-1 min-w-[140px]"
            />
            <input
              type="password"
              placeholder="VALUE"
              value={newEnvValue}
              onChange={e => setNewEnvValue(e.target.value)}
              className="px-3 py-1.5 bg-zinc-900 border border-zinc-800 focus:border-emerald-500 rounded text-xs font-mono text-zinc-200 placeholder-zinc-600 focus:outline-none flex-1 min-w-[140px]"
            />
            <button
              type="submit"
              disabled={isSavingEnv || !newEnvKey.trim()}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-zinc-950 bg-emerald-400 hover:bg-emerald-300 rounded transition-colors cursor-pointer disabled:opacity-50"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Add Variable</span>
            </button>
          </form>

          {/* List of Variables */}
          <div className="border border-zinc-800 rounded-lg overflow-hidden divide-y divide-zinc-800/80">
            {envVars.length === 0 ? (
              <div className="p-4 text-center text-xs text-zinc-500">No environment variables set.</div>
            ) : (
              envVars.map(ev => {
                const isRevealed = revealedKeys.has(ev.key);
                return (
                  <div key={ev.id} className="p-3 bg-zinc-950/40 flex items-center justify-between gap-4 font-mono text-xs">
                    <div className="font-semibold text-zinc-200">{ev.key}</div>
                    
                    <div className="flex items-center gap-2">
                      <span className="text-zinc-400 bg-zinc-900 px-2 py-1 rounded text-[11px] select-all">
                        {isRevealed ? ev.value : '••••••••••••'}
                      </span>

                      <button
                        onClick={() => toggleRevealKey(ev.key)}
                        className="p-1 text-zinc-400 hover:text-zinc-200 cursor-pointer"
                        title={isRevealed ? 'Hide secret' : 'Reveal secret'}
                      >
                        {isRevealed ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                      </button>

                      <button
                        onClick={() => handleDeleteEnv(ev.key)}
                        className="p-1 text-zinc-500 hover:text-rose-400 cursor-pointer"
                        title="Delete variable"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}

      {/* TAB 5: SETTINGS & DANGER ZONE */}
      {activeTab === 'settings' && (
        <div className="space-y-6">
          <form onSubmit={handleSaveSettings} className="bg-zinc-900/60 border border-zinc-800 rounded-xl p-5 space-y-4">
            <h3 className="text-sm font-semibold text-zinc-100">Project Configuration</h3>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs text-zinc-400 mb-1">Git Branch</label>
                <input
                  type="text"
                  value={branch}
                  onChange={e => setBranch(e.target.value)}
                  className="w-full px-3 py-2 bg-zinc-950 border border-zinc-800 rounded text-xs font-mono text-zinc-200 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs text-zinc-400 mb-1">Internal Container Port</label>
                <input
                  type="number"
                  value={internalPort}
                  onChange={e => setInternalPort(parseInt(e.target.value, 10))}
                  className="w-full px-3 py-2 bg-zinc-950 border border-zinc-800 rounded text-xs font-mono text-zinc-200 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs text-zinc-400 mb-1">Health Check Path</label>
                <input
                  type="text"
                  value={healthPath}
                  onChange={e => setHealthPath(e.target.value)}
                  className="w-full px-3 py-2 bg-zinc-950 border border-zinc-800 rounded text-xs font-mono text-zinc-200 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs text-zinc-400 mb-1">Routing Domain</label>
                <input
                  type="text"
                  value={domain}
                  onChange={e => setDomain(e.target.value)}
                  className="w-full px-3 py-2 bg-zinc-950 border border-zinc-800 rounded text-xs font-mono text-zinc-200 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs text-zinc-400 mb-1">CPU Limit</label>
                <input
                  type="text"
                  value={cpuLimit}
                  onChange={e => setCpuLimit(e.target.value)}
                  className="w-full px-3 py-2 bg-zinc-950 border border-zinc-800 rounded text-xs font-mono text-zinc-200 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs text-zinc-400 mb-1">Memory Limit</label>
                <input
                  type="text"
                  value={memoryLimit}
                  onChange={e => setMemoryLimit(e.target.value)}
                  className="w-full px-3 py-2 bg-zinc-950 border border-zinc-800 rounded text-xs font-mono text-zinc-200 focus:outline-none"
                />
              </div>
            </div>

            <div className="pt-2">
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={autoDeploy}
                  onChange={e => setAutoDeploy(e.target.checked)}
                  className="rounded border-zinc-700 text-emerald-500 focus:ring-emerald-400"
                />
                <span className="text-xs text-zinc-300">
                  Enable automatic deployment on GitHub push webhook events
                </span>
              </label>
            </div>

            <div className="pt-2 flex justify-end">
              <button
                type="submit"
                disabled={isSavingSettings}
                className="px-4 py-2 text-xs font-medium text-zinc-950 bg-emerald-400 hover:bg-emerald-300 rounded-lg transition-colors cursor-pointer"
              >
                {isSavingSettings ? 'Saving...' : 'Save Settings'}
              </button>
            </div>
          </form>

          {/* Danger Zone: Delete Project */}
          <div className="bg-rose-500/5 border border-rose-500/20 rounded-xl p-5 space-y-3">
            <h3 className="text-sm font-semibold text-rose-400 flex items-center gap-2">
              <AlertTriangle className="w-4 h-4" />
              <span>Danger Zone</span>
            </h3>
            <p className="text-xs text-zinc-400">
              Permanently stop containers, prune Traefik routes, and delete this project's deployment records.
            </p>

            {showDeleteConfirm ? (
              <div className="p-3 bg-zinc-950 rounded-lg border border-rose-500/30 flex items-center justify-between gap-3">
                <span className="text-xs text-rose-300">
                  Are you absolutely sure you want to delete <strong>{project.name}</strong>?
                </span>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setShowDeleteConfirm(false)}
                    className="px-3 py-1 text-xs text-zinc-400 hover:text-zinc-200 cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={() => onDeleteProject(project.id)}
                    className="px-3 py-1 text-xs font-medium text-white bg-rose-600 hover:bg-rose-500 rounded cursor-pointer"
                  >
                    Yes, Delete Project
                  </button>
                </div>
              </div>
            ) : (
              <button
                onClick={() => setShowDeleteConfirm(true)}
                className="px-3 py-1.5 text-xs font-medium text-rose-400 hover:text-rose-300 bg-rose-500/10 hover:bg-rose-500/20 border border-rose-500/30 rounded-lg transition-colors cursor-pointer"
              >
                Delete Project...
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
