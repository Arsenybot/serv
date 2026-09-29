import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Search, Download, Trash2, ArrowDown, Terminal, Filter } from 'lucide-react';
import { DeploymentLog } from '../types.ts';

interface LogViewerProps {
  logs: DeploymentLog[];
  title?: string;
  onClear?: () => void;
  isLive?: boolean;
}

export const LogViewer: React.FC<LogViewerProps> = ({
  logs,
  title = 'Execution Logs',
  onClear,
  isLive = true,
}) => {
  const [filterType, setFilterType] = useState<'all' | 'build' | 'runtime' | 'system'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [autoScroll, setAutoScroll] = useState(true);
  const terminalEndRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Filter logs based on stream and search query
  const filteredLogs = useMemo(() => {
    return logs.filter(log => {
      // Stream filter
      if (filterType === 'build' && log.stream !== 'build') return false;
      if (filterType === 'runtime' && log.stream !== 'stdout' && log.stream !== 'stderr') return false;
      if (filterType === 'system' && log.stream !== 'system') return false;

      // Text search
      if (searchQuery.trim() && !log.message.toLowerCase().includes(searchQuery.toLowerCase())) {
        return false;
      }

      return true;
    });
  }, [logs, filterType, searchQuery]);

  // Autoscroll
  useEffect(() => {
    if (autoScroll && terminalEndRef.current) {
      terminalEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [filteredLogs, autoScroll]);

  // Handle user manual scroll
  const handleScroll = () => {
    if (!containerRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = containerRef.current;
    const isAtBottom = scrollHeight - scrollTop - clientHeight < 40;
    setAutoScroll(isAtBottom);
  };

  const handleDownload = () => {
    const textContent = logs
      .map(l => `[${l.timestamp}] [${l.stream.toUpperCase()}] ${l.message}`)
      .join('\n');
    const blob = new Blob([textContent], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `localpaas-logs-${Date.now()}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const formatTimestamp = (isoString: string) => {
    try {
      const d = new Date(isoString);
      return d.toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
    } catch {
      return '';
    }
  };

  const getStreamColor = (stream: string) => {
    switch (stream) {
      case 'stderr':
        return 'text-rose-400 bg-rose-500/10';
      case 'build':
        return 'text-amber-400 bg-amber-500/10';
      case 'system':
        return 'text-sky-400 bg-sky-500/10';
      case 'stdout':
      default:
        return 'text-emerald-400 bg-emerald-500/10';
    }
  };

  return (
    <div className="bg-zinc-950 border border-zinc-800 rounded-xl overflow-hidden flex flex-col font-mono text-xs shadow-2xl">
      {/* Terminal Title Bar & Toolbar */}
      <div className="bg-zinc-900/90 border-b border-zinc-800 px-4 py-2.5 flex flex-wrap items-center justify-between gap-3 select-none">
        {/* Left: Indicator & Tabs */}
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-rose-500/80" />
            <span className="w-2.5 h-2.5 rounded-full bg-amber-500/80" />
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-500/80" />
          </div>

          <div className="h-4 w-[1px] bg-zinc-800" />

          <div className="flex items-center gap-1 bg-zinc-950 p-0.5 rounded-lg border border-zinc-800">
            {(['all', 'build', 'runtime', 'system'] as const).map(tab => (
              <button
                key={tab}
                onClick={() => setFilterType(tab)}
                className={`px-2.5 py-1 rounded text-[11px] font-sans transition-colors cursor-pointer ${
                  filterType === tab
                    ? 'bg-zinc-800 text-zinc-100 font-medium'
                    : 'text-zinc-400 hover:text-zinc-200'
                }`}
              >
                {tab.toUpperCase()}
              </button>
            ))}
          </div>

          {isLive && (
            <span className="flex items-center gap-1.5 text-[10px] text-emerald-400 font-sans tracking-wide">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              LIVE STREAM
            </span>
          )}
        </div>

        {/* Right: Search, Autoscroll & Actions */}
        <div className="flex items-center gap-2">
          {/* Search Input */}
          <div className="relative">
            <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-500" />
            <input
              type="text"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="Search logs..."
              className="pl-8 pr-2.5 py-1 bg-zinc-950 border border-zinc-800 focus:border-zinc-600 rounded text-[11px] text-zinc-200 placeholder-zinc-600 focus:outline-none w-32 sm:w-44"
            />
          </div>

          {/* Autoscroll Toggle */}
          <button
            onClick={() => setAutoScroll(!autoScroll)}
            className={`flex items-center gap-1 px-2 py-1 rounded text-[11px] font-sans border transition-colors cursor-pointer ${
              autoScroll
                ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
                : 'bg-zinc-950 text-zinc-400 border-zinc-800 hover:text-zinc-300'
            }`}
            title="Toggle autoscroll"
          >
            <ArrowDown className="w-3 h-3" />
            <span className="hidden sm:inline">Autoscroll</span>
          </button>

          {/* Download Logs */}
          <button
            onClick={handleDownload}
            className="p-1.5 bg-zinc-950 hover:bg-zinc-800 text-zinc-400 hover:text-zinc-200 border border-zinc-800 rounded transition-colors cursor-pointer"
            title="Download log output"
          >
            <Download className="w-3.5 h-3.5" />
          </button>

          {/* Clear Logs */}
          {onClear && (
            <button
              onClick={onClear}
              className="p-1.5 bg-zinc-950 hover:bg-zinc-800 text-zinc-400 hover:text-rose-400 border border-zinc-800 rounded transition-colors cursor-pointer"
              title="Clear log view"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Terminal Output Area */}
      <div
        ref={containerRef}
        onScroll={handleScroll}
        className="p-4 h-96 overflow-y-auto space-y-1 select-text bg-[#090d16]"
      >
        {filteredLogs.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-zinc-600 text-xs font-sans">
            <Terminal className="w-6 h-6 mb-2 opacity-40" />
            <p>No log entries found{searchQuery ? ` matching "${searchQuery}"` : ''}</p>
          </div>
        ) : (
          filteredLogs.map(log => (
            <div key={log.id} className="leading-relaxed flex items-start gap-2 hover:bg-white/[0.02] px-1 rounded">
              <span className="text-zinc-600 select-none text-[11px] shrink-0">
                {formatTimestamp(log.timestamp)}
              </span>
              <span
                className={`text-[10px] uppercase font-mono px-1 py-0.2 rounded select-none shrink-0 ${getStreamColor(
                  log.stream
                )}`}
              >
                {log.stream}
              </span>
              <span
                className={`break-all ${
                  log.stream === 'stderr'
                    ? 'text-rose-300'
                    : log.stream === 'system'
                    ? 'text-sky-300'
                    : log.stream === 'build'
                    ? 'text-amber-200'
                    : 'text-zinc-300'
                }`}
              >
                {log.message}
              </span>
            </div>
          ))
        )}
        <div ref={terminalEndRef} />
      </div>

      {/* Terminal Footer with Line Count */}
      <div className="bg-zinc-900/60 border-t border-zinc-800/80 px-4 py-1.5 flex items-center justify-between text-[11px] text-zinc-500 font-sans">
        <span>{filteredLogs.length} line(s)</span>
        <span>Output formatted in UTF-8</span>
      </div>
    </div>
  );
};
