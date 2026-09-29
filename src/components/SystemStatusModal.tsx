import React from 'react';
import { X, Server, Database, Layers, Radio, Shield, HardDrive, CheckCircle2, AlertCircle } from 'lucide-react';
import { SystemStatus } from '../types.ts';

interface SystemStatusModalProps {
  isOpen: boolean;
  onClose: () => void;
  status: SystemStatus | null;
}

export const SystemStatusModal: React.FC<SystemStatusModalProps> = ({
  isOpen,
  onClose,
  status,
}) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm overflow-y-auto">
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl w-full max-w-xl overflow-hidden shadow-2xl flex flex-col">
        {/* Header */}
        <div className="px-6 py-4 border-b border-zinc-800 flex items-center justify-between bg-zinc-950">
          <div>
            <h3 className="text-base font-semibold text-zinc-100 flex items-center gap-2">
              <Server className="w-5 h-5 text-emerald-400" />
              <span>Deployment Infrastructure Status</span>
            </h3>
            <p className="text-xs text-zinc-400 mt-0.5">
              Host environment, Docker socket, Traefik proxy, and service health
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 rounded-lg transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-4 text-xs font-mono">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {/* Docker Engine */}
            <div className="p-3 bg-zinc-950 rounded-lg border border-zinc-800 flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <HardDrive className="w-4 h-4 text-emerald-400" />
                <div>
                  <span className="font-semibold text-zinc-200 block">Docker Engine</span>
                  <span className="text-[11px] text-zinc-500 font-sans">
                    {status?.dockerAvailable ? '/var/run/docker.sock connected' : 'Local process executor'}
                  </span>
                </div>
              </div>
              <span
                className={`px-2 py-0.5 rounded text-[10px] font-semibold ${
                  status?.dockerAvailable ? 'bg-emerald-500/10 text-emerald-400' : 'bg-sky-500/10 text-sky-400'
                }`}
              >
                {status?.dockerAvailable ? 'ONLINE' : 'HOST READY'}
              </span>
            </div>

            {/* Traefik Proxy */}
            <div className="p-3 bg-zinc-950 rounded-lg border border-zinc-800 flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <Layers className="w-4 h-4 text-sky-400" />
                <div>
                  <span className="font-semibold text-zinc-200 block">Traefik Proxy</span>
                  <span className="text-[11px] text-zinc-500 font-sans">Domain: {status?.traefikDomain || 'localhost'}</span>
                </div>
              </div>
              <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-emerald-500/10 text-emerald-400">
                PORT 80
              </span>
            </div>

            {/* Redis & BullMQ */}
            <div className="p-3 bg-zinc-950 rounded-lg border border-zinc-800 flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <Radio className="w-4 h-4 text-amber-400" />
                <div>
                  <span className="font-semibold text-zinc-200 block">BullMQ Queue</span>
                  <span className="text-[11px] text-zinc-500 font-sans">Concurrency safe & coalesced</span>
                </div>
              </div>
              <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-emerald-500/10 text-emerald-400">
                ACTIVE
              </span>
            </div>

            {/* PostgreSQL Database */}
            <div className="p-3 bg-zinc-950 rounded-lg border border-zinc-800 flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <Database className="w-4 h-4 text-indigo-400" />
                <div>
                  <span className="font-semibold text-zinc-200 block">PostgreSQL / Prisma</span>
                  <span className="text-[11px] text-zinc-500 font-sans">Persistent metadata store</span>
                </div>
              </div>
              <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-emerald-500/10 text-emerald-400">
                CONNECTED
              </span>
            </div>
          </div>

          {/* Project Summary */}
          <div className="p-4 bg-zinc-950 rounded-lg border border-zinc-800 space-y-2">
            <span className="text-zinc-400 font-semibold uppercase tracking-wider text-[11px] block">
              Fleet Overview
            </span>
            <div className="flex items-center justify-between text-zinc-300">
              <span>Total Managed Projects:</span>
              <span className="font-bold text-zinc-100">{status?.totalProjects ?? 0}</span>
            </div>
            <div className="flex items-center justify-between text-zinc-300">
              <span>Active LIVE Deployments:</span>
              <span className="font-bold text-emerald-400">{status?.liveProjects ?? 0}</span>
            </div>
            <div className="flex items-center justify-between text-zinc-300">
              <span>Building Pipelines:</span>
              <span className="font-bold text-amber-400">{status?.buildingProjects ?? 0}</span>
            </div>
            <div className="flex items-center justify-between text-zinc-300">
              <span>Retention Limit per Project:</span>
              <span className="font-bold text-zinc-400">
                {status?.maxDeploymentsLimit ?? 10} deployments
              </span>
            </div>
          </div>

          <div className="p-3 bg-zinc-900 rounded-lg border border-zinc-800 text-[11px] text-zinc-400 font-sans leading-relaxed">
            <p>
              <strong>Security note:</strong> Containers run with isolated non-root privileges, memory limits, and CPU quotas on the host Docker bridge network. Designed for trusted single-user home lab / server deployments.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};
