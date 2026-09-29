import React from 'react';
import { X, CheckCircle, AlertTriangle, Clock, GitCommit, Box, RotateCcw, Play, ShieldAlert } from 'lucide-react';
import { Deployment, DeploymentLog, Project } from '../types.ts';
import { LogViewer } from './LogViewer.tsx';

interface DeploymentModalProps {
  deployment: Deployment | null;
  project: Project | null;
  logs: DeploymentLog[];
  isOpen: boolean;
  onClose: () => void;
  onRollback: (deploymentId: string) => void;
  onRedeploy: (projectId: string) => void;
}

export const DeploymentModal: React.FC<DeploymentModalProps> = ({
  deployment,
  project,
  logs,
  isOpen,
  onClose,
  onRollback,
  onRedeploy,
}) => {
  if (!isOpen || !deployment || !project) return null;

  const steps = [
    { key: 'QUEUED', label: 'Queued' },
    { key: 'BUILDING', label: 'Docker Build' },
    { key: 'STARTING', label: 'Container Start' },
    { key: 'HEALTH_CHECK', label: 'Health Check' },
    { key: 'LIVE', label: 'Traffic Switch' },
  ];

  const getStepStatus = (stepKey: string) => {
    const status = deployment.status;
    const order = ['QUEUED', 'BUILDING', 'STARTING', 'HEALTH_CHECK', 'LIVE'];
    const currentIndex = order.indexOf(status);
    const stepIndex = order.indexOf(stepKey);

    // If failed in a specific step
    if (status === 'BUILD_FAILED' && stepKey === 'BUILDING') return 'failed';
    if (status === 'START_FAILED' && stepKey === 'STARTING') return 'failed';
    if (status === 'HEALTH_CHECK_FAILED' && stepKey === 'HEALTH_CHECK') return 'failed';
    if (status === 'CANCELLED' && stepIndex >= currentIndex) return 'cancelled';

    if (currentIndex >= stepIndex) return 'completed';
    return 'pending';
  };

  const calculateDuration = () => {
    if (!deployment.startedAt) return '—';
    const start = new Date(deployment.startedAt).getTime();
    const end = deployment.finishedAt ? new Date(deployment.finishedAt).getTime() : Date.now();
    const sec = Math.max(0, Math.floor((end - start) / 1000));
    return `${sec}s`;
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm overflow-y-auto">
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl w-full max-w-4xl overflow-hidden shadow-2xl flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="px-6 py-4 border-b border-zinc-800 flex items-center justify-between bg-zinc-950">
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-base font-semibold text-zinc-100">
                Deployment <span className="font-mono text-emerald-400">{deployment.id}</span>
              </h3>
              <span className="text-xs text-zinc-500">·</span>
              <span className="text-xs text-zinc-400 font-medium">{project.name}</span>
            </div>
            <p className="text-xs text-zinc-400 font-mono mt-0.5">
              {deployment.commitSha.slice(0, 7)} — {deployment.commitMessage}
            </p>
          </div>

          <div className="flex items-center gap-2">
            {deployment.status === 'LIVE' && project.currentDeploymentId !== deployment.id && (
              <button
                onClick={() => onRollback(deployment.id)}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-amber-300 bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/30 rounded-lg transition-colors cursor-pointer"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>Rollback to this</span>
              </button>
            )}

            <button
              onClick={onClose}
              className="p-1.5 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 rounded-lg transition-colors cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Modal Body */}
        <div className="p-6 overflow-y-auto space-y-6">
          {/* Pipeline State Machine Indicator */}
          <div className="bg-zinc-950 border border-zinc-800/80 rounded-xl p-4">
            <h4 className="text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-3">
              Deployment Pipeline State Machine
            </h4>
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
              {steps.map((step, idx) => {
                const state = getStepStatus(step.key);
                let badgeStyle = 'bg-zinc-900 border-zinc-800 text-zinc-500';
                if (state === 'completed') badgeStyle = 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400 font-medium';
                if (state === 'failed') badgeStyle = 'bg-rose-500/10 border-rose-500/30 text-rose-400 font-medium';
                if (state === 'cancelled') badgeStyle = 'bg-zinc-800/40 border-zinc-700 text-zinc-400';

                return (
                  <div
                    key={step.key}
                    className={`border rounded-lg p-2.5 flex flex-col items-center justify-center text-center ${badgeStyle}`}
                  >
                    <span className="text-[10px] font-mono opacity-60">Step {idx + 1}</span>
                    <span className="text-xs mt-0.5">{step.label}</span>
                    <span className="text-[10px] font-mono mt-1 uppercase">
                      {state === 'completed' ? '✓ OK' : state === 'failed' ? '✕ FAILED' : '• PENDING'}
                    </span>
                  </div>
                );
              })}
            </div>

            {/* Error Message banner if failed */}
            {deployment.errorMessage && (
              <div className="mt-4 p-3 bg-rose-500/10 border border-rose-500/20 rounded-lg flex items-start gap-2.5 text-xs text-rose-300">
                <ShieldAlert className="w-4 h-4 shrink-0 text-rose-400 mt-0.5" />
                <div>
                  <span className="font-semibold">Pipeline Failure Reason: </span>
                  {deployment.errorMessage}
                  <p className="mt-1 text-zinc-400">
                    Zero-downtime safety: Any previous working deployment remains operational.
                  </p>
                </div>
              </div>
            )}
          </div>

          {/* Metadata Grid */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
            <div className="bg-zinc-950 p-3 rounded-lg border border-zinc-800/80">
              <span className="text-zinc-500 block mb-1">Status</span>
              <span className="font-mono font-medium text-zinc-200">{deployment.status}</span>
            </div>

            <div className="bg-zinc-950 p-3 rounded-lg border border-zinc-800/80">
              <span className="text-zinc-500 block mb-1">Duration</span>
              <span className="font-mono font-medium text-zinc-200">{calculateDuration()}</span>
            </div>

            <div className="bg-zinc-950 p-3 rounded-lg border border-zinc-800/80">
              <span className="text-zinc-500 block mb-1">Docker Image</span>
              <span className="font-mono text-zinc-300 truncate block" title={deployment.imageName || '—'}>
                {deployment.imageName || '—'}
              </span>
            </div>

            <div className="bg-zinc-950 p-3 rounded-lg border border-zinc-800/80">
              <span className="text-zinc-500 block mb-1">Container ID</span>
              <span className="font-mono text-zinc-300 truncate block" title={deployment.containerId || '—'}>
                {deployment.containerId || '—'}
              </span>
            </div>
          </div>

          {/* Integrated Logs Viewer */}
          <div>
            <h4 className="text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-2">
              Execution & Health Check Logs
            </h4>
            <LogViewer logs={logs} title={`Logs: ${deployment.id}`} />
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-3 border-t border-zinc-800 bg-zinc-950 flex items-center justify-between">
          <div className="text-xs text-zinc-500 font-mono">
            Started: {new Date(deployment.startedAt).toLocaleString()}
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => onRedeploy(project.id)}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-zinc-950 bg-emerald-400 hover:bg-emerald-300 rounded-lg transition-colors cursor-pointer"
            >
              <Play className="w-3.5 h-3.5 fill-current" />
              <span>Redeploy Project</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
