export interface RepoCheckResult {
  exists: boolean;
  defaultBranch?: string;
  branches?: string[];
  hasDockerfile?: boolean;
  detectedType?: 'DOCKERFILE' | 'NODEJS' | 'PYTHON' | 'STATIC';
  error?: string;
}

export async function checkGitHubRepo(repoUrl: string): Promise<RepoCheckResult> {
  const token = process.env.GITHUB_TOKEN;
  
  // Extract owner/repo
  let owner = '';
  let repo = '';
  try {
    const cleanUrl = repoUrl.replace(/\.git$/, '');
    const parts = cleanUrl.split(/[:/]/);
    if (parts.length >= 2) {
      repo = parts[parts.length - 1];
      owner = parts[parts.length - 2];
    }
  } catch {
    return { exists: false, error: 'Invalid repository URL' };
  }

  if (!owner || !repo) {
    return { exists: false, error: 'Could not extract owner and repository name' };
  }

  const headers: Record<string, string> = {
    'User-Agent': 'LocalPaaS-Deployer',
    'Accept': 'application/vnd.github.v3+json',
  };

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  try {
    const res = await fetch(`https://api.github.com/repos/${owner}/${repo}`, { headers });
    if (!res.ok) {
      if (res.status === 404) {
        return { exists: false, error: 'Repository not found or private (check GITHUB_TOKEN)' };
      }
      return { exists: false, error: `GitHub API error: ${res.statusText}` };
    }

    const data = await res.json() as any;
    
    // Check files for auto-detection
    let detectedType: 'DOCKERFILE' | 'NODEJS' | 'PYTHON' | 'STATIC' = 'DOCKERFILE';
    try {
      const contentsRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/contents`, { headers });
      if (contentsRes.ok) {
        const files = await contentsRes.json() as Array<{ name: string }>;
        const fileNames = files.map(f => f.name.toLowerCase());
        
        if (fileNames.includes('dockerfile')) {
          detectedType = 'DOCKERFILE';
        } else if (fileNames.includes('package.json')) {
          detectedType = 'NODEJS';
        } else if (fileNames.includes('requirements.txt') || fileNames.includes('pyproject.toml')) {
          detectedType = 'PYTHON';
        } else if (fileNames.includes('index.html')) {
          detectedType = 'STATIC';
        }
      }
    } catch {
      // Fallback
    }

    return {
      exists: true,
      defaultBranch: data.default_branch || 'main',
      detectedType,
    };
  } catch (err: any) {
    // If offline or network issue, return graceful fallback
    return {
      exists: true,
      defaultBranch: 'main',
      detectedType: 'DOCKERFILE',
    };
  }
}

export async function createGitHubWebhook(
  owner: string,
  repo: string,
  webhookUrl: string,
  secret: string
): Promise<{ success: boolean; webhookId?: string; message: string }> {
  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    return {
      success: false,
      message: 'GITHUB_TOKEN is not configured. Webhook must be added manually in GitHub repository settings.',
    };
  }

  try {
    const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/hooks`, {
      method: 'POST',
      headers: {
        'User-Agent': 'LocalPaaS-Deployer',
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/vnd.github.v3+json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name: 'web',
        active: true,
        events: ['push', 'ping'],
        config: {
          url: webhookUrl,
          content_type: 'json',
          secret: secret,
          insecure_ssl: '0',
        },
      }),
    });

    if (res.ok) {
      const data = await res.json() as any;
      return {
        success: true,
        webhookId: String(data.id),
        message: 'GitHub webhook created automatically!',
      };
    } else {
      const err = await res.json() as any;
      return {
        success: false,
        message: err.message || `GitHub error status ${res.status}`,
      };
    }
  } catch (err: any) {
    return {
      success: false,
      message: err.message || 'Network error contacting GitHub API',
    };
  }
}
