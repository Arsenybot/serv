import React, { useState } from 'react';
import { X, Sparkles, FolderGit2, Check, AlertCircle, Plus, Trash2, Globe, Cpu } from 'lucide-react';
import { BuildType } from '../types.ts';

interface AddProjectModalProps {
  isOpen: boolean;
  onClose: () => void;
  onProjectCreated: (newProject: any) => void;
}

export const AddProjectModal: React.FC<AddProjectModalProps> = ({
  isOpen,
  onClose,
  onProjectCreated,
}) => {
  const [name, setName] = useState('');
  const [repositoryUrl, setRepositoryUrl] = useState('');
  const [branch, setBranch] = useState('main');
  const [buildType, setBuildType] = useState<BuildType>('DOCKERFILE');
  const [internalPort, setInternalPort] = useState(3000);
  const [healthPath, setHealthPath] = useState('/health');
  const [domain, setDomain] = useState('');
  const [triggerInitialDeploy, setTriggerInitialDeploy] = useState(true);
  const [autoDeploy, setAutoDeploy] = useState(true);

  // Environment variables
  const [envVars, setEnvVars] = useState<Array<{ key: string; value: string }>>([
    { key: 'NODE_ENV', value: 'production' },
  ]);

  // Auto-detection state
  const [isDetecting, setIsDetecting] = useState(false);
  const [detectionNotice, setDetectionNotice] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  if (!isOpen) return null;

  // Auto slugify name into domain preview
  const handleNameChange = (val: string) => {
    setName(val);
    const slug = val.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
    if (!domain || domain.includes('.localhost')) {
      setDomain(slug ? `${slug}.localhost` : '');
    }
  };

  const handleAutoDetect = async () => {
    if (!repositoryUrl) {
      setDetectionNotice('Please enter a GitHub repository URL first.');
      return;
    }

    setIsDetecting(true);
    setDetectionNotice(null);

    try {
      const res = await fetch('/api/github/check-repo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ repoUrl: repositoryUrl }),
      });

      const data = await res.json();
      if (data.exists) {
        if (data.defaultBranch) setBranch(data.defaultBranch);
        if (data.detectedType) {
          setBuildType(data.detectedType);
          setDetectionNotice(`Auto-detected: ${data.detectedType} (Default branch: ${data.defaultBranch})`);
        } else {
          setDetectionNotice('Automatic detection failed. Configure build manually.');
        }
      } else {
        setDetectionNotice(data.error || 'Repository check failed. Manual configuration recommended.');
      }
    } catch {
      setDetectionNotice('Automatic detection failed. Configure build manually.');
    } finally {
      setIsDetecting(false);
    }
  };

  const addEnvRow = () => {
    setEnvVars([...envVars, { key: '', value: '' }]);
  };

  const updateEnvRow = (index: number, field: 'key' | 'value', value: string) => {
    const updated = [...envVars];
    updated[index][field] = value;
    setEnvVars(updated);
  };

  const removeEnvRow = (index: number) => {
    setEnvVars(envVars.filter((_, idx) => idx !== index));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !repositoryUrl.trim()) {
      setErrorMessage('Project name and GitHub repository URL are required.');
      return;
    }

    setIsSubmitting(true);
    setErrorMessage(null);

    try {
      const res = await fetch('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          repositoryUrl: repositoryUrl.trim(),
          branch: branch.trim() || 'main',
          buildType,
          internalPort: Number(internalPort) || 3000,
          healthPath: healthPath.trim() || '/health',
          domain: domain.trim(),
          autoDeploy,
          triggerInitialDeploy,
          envVars: envVars.filter(ev => ev.key.trim() !== ''),
        }),
      });

      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.error || 'Failed to create project');
      }

      const data = await res.json();
      onProjectCreated(data.project);
      onClose();
    } catch (err: any) {
      setErrorMessage(err.message || 'An error occurred while creating project.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm overflow-y-auto">
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl w-full max-w-2xl overflow-hidden shadow-2xl flex flex-col max-h-[92vh]">
        {/* Header */}
        <div className="px-6 py-4 border-b border-zinc-800 flex items-center justify-between bg-zinc-950">
          <div>
            <h3 className="text-base font-semibold text-zinc-100 flex items-center gap-2">
              <FolderGit2 className="w-5 h-5 text-emerald-400" />
              <span>Add New Project</span>
            </h3>
            <p className="text-xs text-zinc-400 mt-0.5">
              Connect a GitHub repository for automated zero-downtime container deployments
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 rounded-lg transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="p-6 overflow-y-auto space-y-5">
          {errorMessage && (
            <div className="p-3 bg-rose-500/10 border border-rose-500/30 rounded-lg text-xs text-rose-300 flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0 text-rose-400" />
              <span>{errorMessage}</span>
            </div>
          )}

          {/* Row 1: Name & Domain Preview */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-zinc-300 mb-1.5">
                Project Name <span className="text-rose-400">*</span>
              </label>
              <input
                type="text"
                required
                placeholder="e.g. backend-api"
                value={name}
                onChange={e => handleNameChange(e.target.value)}
                className="w-full px-3 py-2 bg-zinc-950 border border-zinc-800 focus:border-emerald-500 rounded-lg text-sm text-zinc-100 placeholder-zinc-600 focus:outline-none"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-zinc-300 mb-1.5">
                Domain Routing (Traefik)
              </label>
              <div className="relative">
                <Globe className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" />
                <input
                  type="text"
                  placeholder="e.g. backend-api.localhost"
                  value={domain}
                  onChange={e => setDomain(e.target.value)}
                  className="w-full pl-9 pr-3 py-2 bg-zinc-950 border border-zinc-800 focus:border-emerald-500 rounded-lg text-sm font-mono text-zinc-100 placeholder-zinc-600 focus:outline-none"
                />
              </div>
            </div>
          </div>

          {/* Row 2: Repository URL with Auto-Detect */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-xs font-medium text-zinc-300">
                GitHub Repository URL <span className="text-rose-400">*</span>
              </label>
              <button
                type="button"
                onClick={handleAutoDetect}
                disabled={isDetecting || !repositoryUrl}
                className="text-[11px] text-emerald-400 hover:text-emerald-300 flex items-center gap-1 cursor-pointer disabled:opacity-40"
              >
                <Sparkles className="w-3 h-3" />
                <span>{isDetecting ? 'Detecting...' : 'Auto-detect stack'}</span>
              </button>
            </div>
            <input
              type="text"
              required
              placeholder="https://github.com/username/repository"
              value={repositoryUrl}
              onChange={e => setRepositoryUrl(e.target.value)}
              className="w-full px-3 py-2 bg-zinc-950 border border-zinc-800 focus:border-emerald-500 rounded-lg text-sm font-mono text-zinc-100 placeholder-zinc-600 focus:outline-none"
            />
            {detectionNotice && (
              <p className="mt-1.5 text-xs text-sky-400 flex items-center gap-1.5">
                <span>ℹ</span>
                <span>{detectionNotice}</span>
              </p>
            )}
          </div>

          {/* Row 3: Branch & Deployment Type */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-zinc-300 mb-1.5">Branch</label>
              <input
                type="text"
                required
                placeholder="main"
                value={branch}
                onChange={e => setBranch(e.target.value)}
                className="w-full px-3 py-2 bg-zinc-950 border border-zinc-800 focus:border-emerald-500 rounded-lg text-sm font-mono text-zinc-100 focus:outline-none"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-zinc-300 mb-1.5">Deployment Type</label>
              <select
                value={buildType}
                onChange={e => setBuildType(e.target.value as BuildType)}
                className="w-full px-3 py-2 bg-zinc-950 border border-zinc-800 focus:border-emerald-500 rounded-lg text-sm text-zinc-100 focus:outline-none cursor-pointer"
              >
                <option value="DOCKERFILE">Dockerfile (Recommended & Most Reliable)</option>
                <option value="NODEJS">Node.js (Auto package.json)</option>
                <option value="PYTHON">Python (Auto requirements.txt)</option>
                <option value="STATIC">Static Frontend</option>
              </select>
            </div>
          </div>

          {/* Row 4: Port & Health Check Path */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-zinc-300 mb-1.5">Internal App Port</label>
              <input
                type="number"
                required
                value={internalPort}
                onChange={e => setInternalPort(parseInt(e.target.value, 10))}
                className="w-full px-3 py-2 bg-zinc-950 border border-zinc-800 focus:border-emerald-500 rounded-lg text-sm font-mono text-zinc-100 focus:outline-none"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-zinc-300 mb-1.5">Health Check Path</label>
              <input
                type="text"
                required
                value={healthPath}
                onChange={e => setHealthPath(e.target.value)}
                placeholder="/health"
                className="w-full px-3 py-2 bg-zinc-950 border border-zinc-800 focus:border-emerald-500 rounded-lg text-sm font-mono text-zinc-100 focus:outline-none"
              />
            </div>
          </div>

          {/* Environment Variables Section */}
          <div className="pt-2 border-t border-zinc-800">
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs font-medium text-zinc-300">
                Initial Environment Variables
              </label>
              <button
                type="button"
                onClick={addEnvRow}
                className="text-[11px] text-emerald-400 hover:text-emerald-300 flex items-center gap-1 cursor-pointer"
              >
                <Plus className="w-3 h-3" />
                <span>Add Variable</span>
              </button>
            </div>

            <div className="space-y-2">
              {envVars.map((row, idx) => (
                <div key={idx} className="flex items-center gap-2">
                  <input
                    type="text"
                    placeholder="KEY"
                    value={row.key}
                    onChange={e => updateEnvRow(idx, 'key', e.target.value)}
                    className="w-1/2 px-2.5 py-1.5 bg-zinc-950 border border-zinc-800 rounded text-xs font-mono text-zinc-200 placeholder-zinc-600 focus:outline-none"
                  />
                  <input
                    type="password"
                    placeholder="VALUE"
                    value={row.value}
                    onChange={e => updateEnvRow(idx, 'value', e.target.value)}
                    className="w-1/2 px-2.5 py-1.5 bg-zinc-950 border border-zinc-800 rounded text-xs font-mono text-zinc-200 placeholder-zinc-600 focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => removeEnvRow(idx)}
                    className="p-1.5 text-zinc-500 hover:text-rose-400 cursor-pointer"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>
          </div>

          {/* Checkboxes */}
          <div className="pt-2 border-t border-zinc-800 space-y-2">
            <label className="flex items-center gap-2 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={triggerInitialDeploy}
                onChange={e => setTriggerInitialDeploy(e.target.checked)}
                className="rounded border-zinc-700 text-emerald-500 focus:ring-emerald-400"
              />
              <span className="text-xs text-zinc-300">Perform first deployment immediately after creation</span>
            </label>

            <label className="flex items-center gap-2 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={autoDeploy}
                onChange={e => setAutoDeploy(e.target.checked)}
                className="rounded border-zinc-700 text-emerald-500 focus:ring-emerald-400"
              />
              <span className="text-xs text-zinc-300">Auto-deploy on GitHub pushes to {branch}</span>
            </label>
          </div>

          {/* Form Actions */}
          <div className="pt-4 border-t border-zinc-800 flex items-center justify-end gap-3">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-xs font-medium text-zinc-400 hover:text-zinc-200 cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="px-4 py-2 text-xs font-medium text-zinc-950 bg-emerald-400 hover:bg-emerald-300 active:bg-emerald-500 rounded-lg transition-colors cursor-pointer disabled:opacity-50"
            >
              {isSubmitting ? 'Creating Project...' : 'Create Project'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
