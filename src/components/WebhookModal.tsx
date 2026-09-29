import React, { useState } from 'react';
import { X, GitPullRequest, Copy, Check, Play, ShieldAlert, Sparkles, Terminal } from 'lucide-react';
import { Project } from '../types.ts';

interface WebhookModalProps {
  isOpen: boolean;
  projects: Project[];
  onClose: () => void;
  onSimulationTriggered: () => void;
}

export const WebhookModal: React.FC<WebhookModalProps> = ({
  isOpen,
  projects,
  onClose,
  onSimulationTriggered,
}) => {
  const [copiedUrl, setCopiedUrl] = useState(false);
  const [selectedProjectId, setSelectedProjectId] = useState<string>(projects[0]?.id || '');
  const [branch, setBranch] = useState('main');
  const [commitMessage, setCommitMessage] = useState('feat: update landing page and api handler');
  const [simulateFailure, setSimulateFailure] = useState<'none' | 'build' | 'start' | 'health'>('none');
  const [isTriggering, setIsTriggering] = useState(false);
  const [simulationResponse, setSimulationResponse] = useState<string | null>(null);

  if (!isOpen) return null;

  const webhookUrl = `${window.location.origin}/api/webhooks/github`;

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedUrl(true);
    setTimeout(() => setCopiedUrl(false), 2000);
  };

  const handleRunSimulation = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedProjectId) return;

    setIsTriggering(true);
    setSimulationResponse(null);

    try {
      const res = await fetch('/api/webhooks/simulate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId: selectedProjectId,
          branch,
          commitMessage,
          simulateFailure: simulateFailure === 'none' ? undefined : simulateFailure,
        }),
      });

      const data = await res.json();
      setSimulationResponse(`Success: ${data.message} (Commit: ${data.commitSha})`);
      onSimulationTriggered();
    } catch (err: any) {
      setSimulationResponse(`Error: ${err.message}`);
    } finally {
      setIsTriggering(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm overflow-y-auto">
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl w-full max-w-2xl overflow-hidden shadow-2xl flex flex-col max-h-[92vh]">
        {/* Header */}
        <div className="px-6 py-4 border-b border-zinc-800 flex items-center justify-between bg-zinc-950">
          <div>
            <h3 className="text-base font-semibold text-zinc-100 flex items-center gap-2">
              <GitPullRequest className="w-5 h-5 text-sky-400" />
              <span>GitHub Webhook Configuration & Simulator</span>
            </h3>
            <p className="text-xs text-zinc-400 mt-0.5">
              Automate deployments on every git push or test the deployment pipeline directly
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 rounded-lg transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="p-6 overflow-y-auto space-y-6">
          {/* Section 1: GitHub Setup Instructions */}
          <div className="space-y-3">
            <h4 className="text-xs font-semibold text-zinc-300 uppercase tracking-wider">
              1. Add Webhook to your GitHub Repository
            </h4>
            <div className="text-xs text-zinc-400 space-y-1">
              <p>In GitHub: Go to <strong>Repository Settings → Webhooks → Add webhook</strong>.</p>
              <p>Set Payload URL and Content type as shown below:</p>
            </div>

            <div className="bg-zinc-950 p-3 rounded-lg border border-zinc-800/80 space-y-2 font-mono text-xs">
              <div className="flex items-center justify-between">
                <span className="text-zinc-500">Payload URL:</span>
                <button
                  onClick={() => copyToClipboard(webhookUrl)}
                  className="flex items-center gap-1 text-[11px] text-emerald-400 hover:text-emerald-300 cursor-pointer"
                >
                  {copiedUrl ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                  <span>{copiedUrl ? 'Copied' : 'Copy'}</span>
                </button>
              </div>
              <div className="text-zinc-200 break-all bg-zinc-900 p-2 rounded border border-zinc-800 select-all">
                {webhookUrl}
              </div>

              <div className="flex items-center justify-between pt-1">
                <span className="text-zinc-500">Content type:</span>
                <span className="text-zinc-300">application/json</span>
              </div>

              <div className="flex items-center justify-between pt-1">
                <span className="text-zinc-500">Events:</span>
                <span className="text-zinc-300">Just the push event</span>
              </div>
            </div>
          </div>

          {/* Section 2: Interactive Push Simulator */}
          <div className="pt-4 border-t border-zinc-800 space-y-4">
            <div className="flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-emerald-400" />
              <h4 className="text-xs font-semibold text-zinc-200 uppercase tracking-wider">
                2. Interactive GitHub Push Simulator
              </h4>
            </div>
            <p className="text-xs text-zinc-400">
              Test webhook triggering, pipeline execution, and zero-downtime protection directly from the browser without needing a real GitHub push!
            </p>

            <form onSubmit={handleRunSimulation} className="bg-zinc-950 p-4 rounded-xl border border-zinc-800 space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-zinc-400 mb-1">Target Project</label>
                  <select
                    value={selectedProjectId}
                    onChange={e => setSelectedProjectId(e.target.value)}
                    className="w-full px-2.5 py-1.5 bg-zinc-900 border border-zinc-800 rounded text-xs text-zinc-200 focus:outline-none cursor-pointer"
                  >
                    {projects.map(p => (
                      <option key={p.id} value={p.id}>
                        {p.name} ({p.branch})
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs text-zinc-400 mb-1">Push to Branch</label>
                  <input
                    type="text"
                    value={branch}
                    onChange={e => setBranch(e.target.value)}
                    className="w-full px-2.5 py-1.5 bg-zinc-900 border border-zinc-800 rounded text-xs font-mono text-zinc-200 focus:outline-none"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs text-zinc-400 mb-1">Commit Message</label>
                <input
                  type="text"
                  value={commitMessage}
                  onChange={e => setCommitMessage(e.target.value)}
                  className="w-full px-2.5 py-1.5 bg-zinc-900 border border-zinc-800 rounded text-xs text-zinc-200 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs text-zinc-400 mb-1">
                  Simulation Scenario (Test Zero-Downtime Resilience)
                </label>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {[
                    { key: 'none', label: '✓ Success' },
                    { key: 'build', label: '✕ Build Fail' },
                    { key: 'start', label: '✕ Start Fail' },
                    { key: 'health', label: '✕ Health Fail' },
                  ].map(sc => (
                    <button
                      key={sc.key}
                      type="button"
                      onClick={() => setSimulateFailure(sc.key as any)}
                      className={`px-2 py-1.5 rounded text-xs border text-center transition-colors cursor-pointer ${
                        simulateFailure === sc.key
                          ? 'bg-emerald-500/10 border-emerald-500/40 text-emerald-300 font-medium'
                          : 'bg-zinc-900 border-zinc-800 text-zinc-400 hover:text-zinc-200'
                      }`}
                    >
                      {sc.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="pt-2 flex items-center justify-between">
                <span className="text-[11px] text-zinc-500">
                  {simulateFailure === 'health'
                    ? 'Simulates readiness timeout. Verifies old container stays LIVE!'
                    : 'Dispatches simulated payload to /api/webhooks/github'}
                </span>

                <button
                  type="submit"
                  disabled={isTriggering || !selectedProjectId}
                  className="flex items-center gap-1.5 px-4 py-2 text-xs font-medium text-zinc-950 bg-emerald-400 hover:bg-emerald-300 rounded-lg transition-colors cursor-pointer disabled:opacity-50"
                >
                  <Play className="w-3.5 h-3.5 fill-current" />
                  <span>{isTriggering ? 'Dispatching...' : 'Dispatch Simulated Push'}</span>
                </button>
              </div>

              {simulationResponse && (
                <div className="p-3 bg-zinc-900 rounded border border-zinc-800 text-xs font-mono text-zinc-300">
                  {simulationResponse}
                </div>
              )}
            </form>
          </div>
        </div>
      </div>
    </div>
  );
};
