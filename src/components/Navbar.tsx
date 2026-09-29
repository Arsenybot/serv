import React from 'react';
import { Server, Plus, Radio, Activity, GitPullRequest, ShieldCheck } from 'lucide-react';
import { SystemStatus } from '../types.ts';

interface NavbarProps {
  systemStatus: SystemStatus | null;
  isConnected: boolean;
  onOpenAddProject: () => void;
  onOpenWebhookModal: () => void;
  onOpenSystemStatus: () => void;
}

export const Navbar: React.FC<NavbarProps> = ({
  systemStatus,
  isConnected,
  onOpenAddProject,
  onOpenWebhookModal,
  onOpenSystemStatus,
}) => {
  return (
    <header className="border-b border-zinc-800 bg-zinc-950/80 backdrop-blur-md sticky top-0 z-40">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
        {/* Brand */}
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center text-emerald-400">
            <Server className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-semibold text-zinc-100 tracking-tight text-base">LocalPaaS</span>
              <span className="text-[11px] font-mono text-zinc-400 uppercase tracking-widest bg-zinc-900 border border-zinc-800 px-1.5 py-0.5 rounded">
                Self-Hosted
              </span>
            </div>
            <p className="text-xs text-zinc-400 hidden sm:block">Automated Local GitHub Deployment Server</p>
          </div>
        </div>

        {/* System Indicators & Quick Actions */}
        <div className="flex items-center gap-2 sm:gap-4">
          {/* Realtime Connection Indicator */}
          <div className="flex items-center gap-2 px-2.5 py-1 text-xs text-zinc-400">
            <span
              className={`w-2 h-2 rounded-full ${
                isConnected ? 'bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.6)]' : 'bg-amber-400 animate-pulse'
              }`}
            />
            <span className="font-mono text-[11px] hidden md:inline">
              {isConnected ? 'LIVE SYNC' : 'RECONNECTING'}
            </span>
          </div>

          {/* System Status Trigger */}
          <button
            onClick={onOpenSystemStatus}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-zinc-300 hover:text-white bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 rounded-lg transition-colors cursor-pointer"
            title="Inspect host infrastructure"
          >
            <Activity className="w-3.5 h-3.5 text-emerald-400" />
            <span className="hidden sm:inline">Engine</span>
            <span className="text-zinc-400">·</span>
            <span className="text-emerald-400 font-mono text-[11px]">
              {systemStatus?.dockerAvailable ? 'DOCKER OK' : 'LOCAL HOST'}
            </span>
          </button>

          {/* Webhook Assistant & Simulator */}
          <button
            onClick={onOpenWebhookModal}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-zinc-300 hover:text-white bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 rounded-lg transition-colors cursor-pointer"
            title="Configure GitHub Webhook or run test simulations"
          >
            <GitPullRequest className="w-3.5 h-3.5 text-sky-400" />
            <span className="hidden sm:inline">Webhook</span>
          </button>

          {/* Add Project Primary Action */}
          <button
            onClick={onOpenAddProject}
            className="flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-medium text-zinc-950 bg-emerald-400 hover:bg-emerald-300 active:bg-emerald-500 rounded-lg shadow-sm transition-colors cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            <span>Add Project</span>
          </button>
        </div>
      </div>
    </header>
  );
};
