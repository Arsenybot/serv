import React from 'react';
import { ExternalLink, Play, Terminal, Settings, ArrowUpRight, Cpu, HardDrive } from 'lucide-react';
import { Project, Deployment, ProjectStats } from '../types.ts';

interface ProjectCardProps {
  project: Project;
  currentDeployment?: Deployment;
  stats?: ProjectStats;
  onSelectProject: (projectId: string, initialTab?: string) => void;
  onTriggerDeploy: (projectId: string) => void;
}

export const ProjectCard: React.FC<ProjectCardProps> = ({
  project,
  currentDeployment,
  stats,
  onSelectProject,
  onTriggerDeploy,
}) => {
  const getStatusColor = (status: string) => {
    switch (status) {
      case 'LIVE':
        return 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20';
      case 'BUILDING':
        return 'text-amber-400 bg-amber-500/10 border-amber-500/20 animate-pulse';
      case 'FAILED':
        return 'text-rose-400 bg-rose-500/10 border-rose-500/20';
      case 'CRASHED':
        return 'text-red-400 bg-red-500/10 border-red-500/20';
      case 'STOPPED':
      default:
        return 'text-zinc-400 bg-zinc-800/40 border-zinc-700/40';
    }
  };

  const shortSha = currentDeployment?.commitSha ? currentDeployment.commitSha.slice(0, 7) : '—';
  const cpuDisplay = stats && project.status === 'LIVE' ? `${stats.cpuPercent}%` : '0%';
  const ramDisplay = stats && project.status === 'LIVE' ? `${Math.round(stats.memoryMb)}MB` : '0MB';

  const projectUrl = `http://${project.domain}`;

  return (
    <div className="bg-zinc-900/60 border border-zinc-800 hover:border-zinc-700 rounded-xl p-5 transition-all flex flex-col justify-between shadow-sm hover:shadow-md">
      {/* Top Header: Title & Status */}
      <div>
        <div className="flex items-start justify-between gap-3 mb-1.5">
          <button
            onClick={() => onSelectProject(project.id, 'overview')}
            className="text-left font-semibold text-zinc-100 hover:text-emerald-400 text-base tracking-tight truncate cursor-pointer transition-colors"
          >
            {project.name}
          </button>
          
          <div className="flex items-center gap-2 shrink-0">
            <span
              className={`px-2 py-0.5 text-[11px] font-mono font-medium rounded border ${getStatusColor(
                project.status
              )}`}
            >
              {project.status}
            </span>
          </div>
        </div>

        {/* Branch & Commit info */}
        <div className="flex items-center gap-2 text-xs text-zinc-400 font-mono mb-4">
          <span className="text-zinc-300 font-medium">{project.branch}</span>
          <span aria-hidden="true" className="text-zinc-600">·</span>
          <span className="text-zinc-400">{shortSha}</span>
          {currentDeployment?.commitMessage && (
            <>
              <span aria-hidden="true" className="text-zinc-600">·</span>
              <span className="truncate max-w-[160px] text-zinc-500" title={currentDeployment.commitMessage}>
                {currentDeployment.commitMessage}
              </span>
            </>
          )}
        </div>

        {/* Resource Stats Bar: CPU & RAM */}
        <div className="bg-zinc-950/60 border border-zinc-800/80 rounded-lg px-3 py-2 flex items-center justify-between text-xs font-mono mb-4">
          <div className="flex items-center gap-2 text-zinc-300">
            <Cpu className="w-3.5 h-3.5 text-zinc-500" />
            <span className="text-zinc-500">CPU</span>
            <span className="font-semibold text-zinc-200">{cpuDisplay}</span>
          </div>
          <span className="text-zinc-700">|</span>
          <div className="flex items-center gap-2 text-zinc-300">
            <HardDrive className="w-3.5 h-3.5 text-zinc-500" />
            <span className="text-zinc-500">RAM</span>
            <span className="font-semibold text-zinc-200">{ramDisplay}</span>
          </div>
        </div>

        {/* Application URL */}
        <div className="mb-4">
          <a
            href={projectUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="group flex items-center gap-1.5 text-xs font-mono text-emerald-400/90 hover:text-emerald-300 truncate"
          >
            <span className="truncate">{projectUrl}</span>
            <ArrowUpRight className="w-3 h-3 shrink-0 opacity-70 group-hover:opacity-100 transition-opacity" />
          </a>
        </div>
      </div>

      {/* Action Buttons matching specification: [Deploy] [Logs] [Settings] */}
      <div className="pt-3 border-t border-zinc-800/80 grid grid-cols-3 gap-2">
        <button
          onClick={() => onTriggerDeploy(project.id)}
          disabled={project.status === 'BUILDING'}
          className="flex items-center justify-center gap-1.5 px-2.5 py-1.5 text-xs font-medium bg-zinc-800 hover:bg-zinc-700 active:bg-zinc-600 text-zinc-200 rounded-lg transition-colors cursor-pointer disabled:opacity-50"
        >
          <Play className="w-3 h-3 text-emerald-400 fill-current" />
          <span>Deploy</span>
        </button>

        <button
          onClick={() => onSelectProject(project.id, 'logs')}
          className="flex items-center justify-center gap-1.5 px-2.5 py-1.5 text-xs font-medium bg-zinc-800 hover:bg-zinc-700 text-zinc-200 rounded-lg transition-colors cursor-pointer"
        >
          <Terminal className="w-3 h-3 text-sky-400" />
          <span>Logs</span>
        </button>

        <button
          onClick={() => onSelectProject(project.id, 'settings')}
          className="flex items-center justify-center gap-1.5 px-2.5 py-1.5 text-xs font-medium bg-zinc-800 hover:bg-zinc-700 text-zinc-200 rounded-lg transition-colors cursor-pointer"
        >
          <Settings className="w-3 h-3 text-zinc-400" />
          <span>Settings</span>
        </button>
      </div>
    </div>
  );
};
