'use client';

import { useEffect, useState } from 'react';
import Card from '@/shared/components/Card';
import Badge from '@/shared/components/Badge';

export default function CustomTokensPageClient() {
  const [providers, setProviders] = useState([]);
  const [selectedProvider, setSelectedProvider] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [probing, setProbing] = useState({});
  const [lastUsed, setLastUsed] = useState({}); // Track last accessed time per provider

  // Load providers with SQLite cache on mount
  useEffect(() => {
    loadProviders();
  }, []);

  // Smart auto-refresh: only refresh recently accessed providers (< 10 min)
  useEffect(() => {
    const interval = setInterval(() => {
      const tenMinutesAgo = Date.now() - 600000;
      providers.forEach(provider => {
        const lastAccess = lastUsed[provider.nodeId];
        if (lastAccess && lastAccess > tenMinutesAgo) {
          console.log(`Auto-refreshing ${provider.name} (last used ${Math.round((Date.now() - lastAccess) / 60000)}m ago)`);
          probeAllKeys(provider);
        }
      });
    }, 60000); // Check every 60s
    
    return () => clearInterval(interval);
  }, [providers, lastUsed]);

  // Track when user views a provider
  useEffect(() => {
    if (selectedProvider) {
      setLastUsed(prev => ({
        ...prev,
        [selectedProvider.nodeId]: Date.now()
      }));
    }
  }, [selectedProvider]);

  async function loadProviders() {
    try {
      setLoading(true);
      const res = await fetch('/api/custom-usage/totals');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      
      // Load quota cache from SQLite
      const cacheRes = await fetch('/api/quota-cache');
      if (cacheRes.ok) {
        const cacheData = await cacheRes.json();
        const quotaMap = new Map();
        cacheData.snapshots.forEach(snap => {
          quotaMap.set(`${snap.nodeId}-${snap.connectionId}`, {
            used: snap.used,
            limit: snap.limit,
            remaining: snap.remaining,
            percentage: snap.percentage
          });
        });
        
        // Merge cache with provider data
        const providersWithCache = (data.result || data).map(provider => ({
          ...provider,
          keys: provider.keys.map(key => {
            const cached = quotaMap.get(`${provider.nodeId}-${key.connectionId}`);
            return cached ? { ...key, quota: cached, quotaProbed: true } : key;
          })
        }));
        
        setProviders(providersWithCache);
      } else {
        setProviders(data.result || data);
      }
      
      setError(null);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  // Auto-fetch quota on first load when providers are ready
  useEffect(() => {
    if (providers.length > 0 && !loading) {
      // Only probe providers with empty/stale cache
      providers.forEach(provider => {
        const hasStaleCache = provider.keys.some(key => {
          if (!key.quotaProbed || !key.quota) return true; // No cache
          // Check if any key has cache (from SQLite) - if all keys have cache, skip
          return false;
        });
        
        // Probe only if at least one key has no cached data
        if (hasStaleCache) {
          console.log(`[AutoFetch] Probing ${provider.name} (has stale/empty cache)`);
          probeAllKeys(provider);
        } else {
          console.log(`[AutoFetch] Skipping ${provider.name} (cache valid)`);
        }
      });
    }
  }, [providers.length, loading]); // Trigger when providers are loaded

  async function probeAllKeys(provider) {
    const activeKeys = provider.keys.filter(k => k.testStatus === 'active');
    
    const BATCH_SIZE = 50;
    const results = [];
    
    // Process in batches to reduce UI jitter
    for (let i = 0; i < activeKeys.length; i++) {
      const key = activeKeys[i];
      const result = await probeSingleQuota(provider.nodeId, key.connectionId, key.keyName, provider.baseUrl);
      
      if (result) {
        results.push({ connectionId: key.connectionId, quota: result });
      }
      
      // Batch update every 50 keys or at the end
      if (results.length >= BATCH_SIZE || i === activeKeys.length - 1) {
        if (results.length > 0) {
          // Batch state update
          setProviders(prev => prev.map(p => {
            if (p.nodeId !== provider.nodeId) return p;
            return {
              ...p,
              keys: p.keys.map(k => {
                const resultData = results.find(r => r.connectionId === k.connectionId);
                return resultData ? { ...k, quota: resultData.quota, quotaProbed: true } : k;
              })
            };
          }));
          
          if (selectedProvider?.nodeId === provider.nodeId) {
            setSelectedProvider(prev => ({
              ...prev,
              keys: prev.keys.map(k => {
                const resultData = results.find(r => r.connectionId === k.connectionId);
                return resultData ? { ...k, quota: resultData.quota, quotaProbed: true } : k;
              })
            }));
          }
          
          results.length = 0; // Clear batch
        }
      }
      
      await new Promise(resolve => setTimeout(resolve, 50)); // 50ms delay
    }
  }

  // Probe single quota without state update (used by probeAllKeys batch)
  async function probeSingleQuota(nodeId, connectionId, keyName, baseUrl) {
    try {
      const res = await fetch(`/api/custom-usage/probe-quota?nodeId=${nodeId}&keyId=${connectionId}&baseUrl=${encodeURIComponent(baseUrl)}`);
      const data = await res.json();
      
      if (data && (data.limit !== null || data.used !== null || data.remaining !== null)) {
        // Save to SQLite cache
        await fetch('/api/quota-cache', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            nodeId,
            connectionId,
            used: data.used,
            limit: data.limit,
            remaining: data.remaining,
            percentage: data.percentage
          })
        });
        
        return data;
      }
    } catch (e) {
      console.error(`Probe failed for ${keyName}:`, e.message);
    }
    return null;
  }

  async function probeQuota(nodeId, connectionId, keyName, baseUrl) {
    const probeKey = `${nodeId}-${connectionId}`;
    setProbing(prev => ({ ...prev, [probeKey]: true }));
    
    try {
      const res = await fetch(`/api/custom-usage/probe-quota?nodeId=${nodeId}&keyId=${connectionId}&baseUrl=${encodeURIComponent(baseUrl)}`);
      const data = await res.json();
      
      if (data && (data.limit !== null || data.used !== null)) {
        // Save to SQLite cache
        await fetch('/api/quota-cache', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            nodeId,
            connectionId,
            used: data.used,
            limit: data.limit,
            remaining: data.remaining,
            percentage: data.percentage
          })
        });
        
        setProviders(prev => prev.map(p => {
          if (p.nodeId !== nodeId) return p;
          return {
            ...p,
            keys: p.keys.map(k => {
              if (k.connectionId !== connectionId) return k;
              return { ...k, quota: data, quotaProbed: true };
            })
          };
        }));
        if (selectedProvider?.nodeId === nodeId) {
          setSelectedProvider(prev => ({
            ...prev,
            keys: prev.keys.map(k => {
              if (k.connectionId !== connectionId) return k;
              return { ...k, quota: data, quotaProbed: true };
            })
          }));
        }
      } else {
        // Provider doesn't expose quota - mark as unsupported instead of error
        setProviders(prev => prev.map(p => {
          if (p.nodeId !== nodeId) return p;
          return {
            ...p,
            keys: p.keys.map(k => {
              if (k.connectionId !== connectionId) return k;
              return { ...k, quotaUnsupported: true, quotaProbed: true };
            })
          };
        }));
        if (selectedProvider?.nodeId === nodeId) {
          setSelectedProvider(prev => ({
            ...prev,
            keys: prev.keys.map(k => {
              if (k.connectionId !== connectionId) return k;
              return { ...k, quotaUnsupported: true, quotaProbed: true };
            })
          }));
        }
      }
    } catch (e) {
      alert(`Probe error: ${e.message}`);
    } finally {
      setProbing(prev => ({ ...prev, [probeKey]: false }));
    }
  }

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="h-8 bg-black/5 dark:bg-white/5 rounded animate-pulse" />
        <div className="h-32 bg-black/5 dark:bg-white/5 rounded animate-pulse" />
        <div className="h-32 bg-black/5 dark:bg-white/5 rounded animate-pulse" />
      </div>
    );
  }

  if (error) {
    return (
      <Card padding="md">
        <div className="text-red-600 dark:text-red-400">
          Failed to load providers: {error}
        </div>
      </Card>
    );
  }

  // Provider detail view
  if (selectedProvider) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <button
              onClick={() => setSelectedProvider(null)}
              className="p-2 rounded-lg hover:bg-black/5 dark:hover:bg-white/5 transition-colors"
            >
              <span className="material-symbols-outlined text-[20px]">arrow_back</span>
            </button>
            <div>
              <h1 className="text-2xl font-bold text-text-primary">
                {selectedProvider.name}
              </h1>
              <p className="text-text-muted text-sm">
                {selectedProvider.baseUrl}
              </p>
            </div>
          </div>
          <button
            onClick={() => probeAllKeys(selectedProvider)}
            disabled={Object.values(probing).some(v => v)}
            className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
          >
            {Object.values(probing).some(v => v) ? (
              <>
                <span className="material-symbols-outlined text-[16px] animate-spin">refresh</span>
                Refreshing...
              </>
            ) : (
              <>
                <span className="material-symbols-outlined text-[16px]">refresh</span>
                Refresh
              </>
            )}
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <Card padding="md">
            <div className="text-text-muted text-sm mb-1">Total Keys</div>
            <div className="text-2xl font-bold text-text-primary">{selectedProvider?.keys?.length || 0}</div>
          </Card>
          <Card padding="md">
            <div className="text-text-muted text-sm mb-1">Active Keys</div>
            <div className="text-2xl font-bold text-green-600 dark:text-green-400">
              {selectedProvider?.keys?.filter(k => k.testStatus === 'active').length || 0}
            </div>
          </Card>
          <Card padding="md">
            <div className="text-text-muted text-sm mb-1">Total Tokens Used</div>
            <div className="text-2xl font-bold text-text-primary">
              {(selectedProvider?.keys
                ?.filter(k => k.quota?.used !== null && k.quota?.used !== undefined)
                .reduce((sum, k) => sum + k.quota.used, 0) || 0)
                .toLocaleString()}
            </div>
          </Card>
          <Card padding="md">
            <div className="text-text-muted text-sm mb-1">Total Tokens Limit</div>
            <div className="text-2xl font-bold text-blue-600 dark:text-blue-400">
              {(selectedProvider?.keys
                ?.filter(k => k.quota?.limit !== null && k.quota?.limit !== undefined)
                .reduce((sum, k) => sum + k.quota.limit, 0) || 0)
                .toLocaleString()}
            </div>
          </Card>
        </div>

        <Card padding="md">
          {selectedProvider?.keys && selectedProvider.keys.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border">
                    <th className="text-left py-2 px-3 text-text-muted font-medium">Key Name</th>
                    <th className="text-left py-2 px-3 text-text-muted font-medium">Status</th>
                    <th className="text-left py-2 px-3 text-text-muted font-medium">Quota</th>
                    <th className="text-right py-2 px-3 text-text-muted font-medium">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {selectedProvider.keys.map(key => {
                    const probeKey = `${selectedProvider.nodeId}-${key.connectionId}`;
                    const isProbing = probing[probeKey];
                    
                    return (
                      <tr key={key.connectionId} className="border-b border-border last:border-0">
                        <td className="py-3 px-3 text-text-primary font-medium">
                          {key.keyName || 'Unnamed'}
                        </td>
                        <td className="py-3 px-3">
                          <Badge 
                            variant={key.status === 'active' ? 'success' : 'default'}
                            size="xs"
                          >
                            {key.status}
                          </Badge>
                        </td>
                        <td className="py-3 px-3 text-text-primary">
                          {key.quotaProbed && key.quota && (key.quota.used !== null || key.quota.limit !== null || key.quota.remaining !== null) ? (
                            <div className="space-y-1">
                              <div className="flex items-center gap-2">
                                <div className="flex-1">
                                  <div className="flex items-center justify-between text-xs mb-1">
                                    <span className="font-medium">
                                      {key.quota.used !== null && key.quota.limit !== null
                                        ? key.quota.used > key.quota.limit
                                          ? 'Over Quota'
                                          : `${((key.quota.used / key.quota.limit) * 100).toFixed(1)}% used`
                                        : key.quota.remaining !== null
                                        ? `${key.quota.remaining.toLocaleString()} remaining`
                                        : 'Available'}
                                    </span>
                                    {key.quota.limit !== null && (
                                      <span className="text-text-muted">
                                        {key.quota.limit.toLocaleString()} limit
                                      </span>
                                    )}
                                  </div>
                                  {key.quota.used !== null && key.quota.limit !== null && (
                                    <div className="w-full bg-black/5 dark:bg-white/5 rounded-full h-2">
                                      <div
                                        className={`h-2 rounded-full transition-all ${
                                          (key.quota.used / key.quota.limit) > 0.9
                                            ? 'bg-red-500'
                                            : (key.quota.used / key.quota.limit) > 0.7
                                            ? 'bg-yellow-500'
                                            : 'bg-green-500'
                                        }`}
                                        style={{ width: `${Math.min((key.quota.used / key.quota.limit) * 100, 100)}%` }}
                                      />
                                    </div>
                                  )}
                                </div>
                              </div>
                              {key.quota.used !== null && (
                                <div className="text-xs text-text-muted">
                                  {key.quota.used.toLocaleString()} used
                                  {key.quota.remaining !== null && ` / ${key.quota.remaining.toLocaleString()} remaining`}
                                </div>
                              )}
                            </div>
                          ) : key.quotaProbed && key.quotaUnsupported ? (
                            <span className="text-xs text-text-muted">Quota not supported</span>
                          ) : (
                            <span className="text-text-muted">—</span>
                          )}
                        </td>
                        <td className="py-3 px-3 text-right">
                          <button
                            onClick={() => probeQuota(selectedProvider.nodeId, key.connectionId, key.keyName, selectedProvider.baseUrl)}
                            disabled={isProbing}
                            className="px-3 py-1.5 rounded-lg bg-black/5 dark:bg-white/5 hover:bg-black/10 dark:hover:bg-white/10 text-text-primary text-xs font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                          >
                            {isProbing ? (
                              <span className="flex items-center gap-1">
                                <span className="material-symbols-outlined text-[14px] animate-spin">refresh</span>
                                Probing...
                              </span>
                            ) : (
                              'Probe Quota'
                            )}
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="text-center py-8 text-text-muted">
              No keys configured for this provider
            </div>
          )}
        </Card>
      </div>
    );
  }

  // Provider list view
  const totalKeys = providers.reduce((sum, p) => sum + p.keys.length, 0);
  const activeKeys = providers.reduce((sum, p) => sum + p.keys.filter(k => k.testStatus === 'active').length, 0);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-text-primary mb-2">
          Custom Provider Tokens
        </h1>
        <p className="text-text-muted">
          Available quota tracker for custom OpenAI-compatible providers
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card padding="md">
          <div className="text-text-muted text-sm mb-1">Providers</div>
          <div className="text-2xl font-bold text-text-primary">{providers.length}</div>
        </Card>
        <Card padding="md">
          <div className="text-text-muted text-sm mb-1">Total Keys</div>
          <div className="text-2xl font-bold text-text-primary">{totalKeys}</div>
        </Card>
        <Card padding="md">
          <div className="text-text-muted text-sm mb-1">Active Keys</div>
          <div className="text-2xl font-bold text-green-600 dark:text-green-400">{activeKeys}</div>
        </Card>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {providers.map(provider => {
          const activeCount = provider.keys.filter(k => k.testStatus === 'active').length;
          const totalUsed = provider.keys
            .filter(k => k.quota?.used !== null && k.quota?.used !== undefined)
            .reduce((sum, k) => sum + k.quota.used, 0);
          const totalLimit = provider.keys
            .filter(k => k.quota?.limit !== null && k.quota?.limit !== undefined)
            .reduce((sum, k) => sum + k.quota.limit, 0);
          const percentage = totalLimit > 0 ? (totalUsed / totalLimit) * 100 : 0;
          const hasQuotaData = totalLimit > 0;
          
          return (
            <Card 
              key={provider.nodeId} 
              padding="md"
              className="cursor-pointer hover:shadow-lg transition-shadow"
              onClick={() => setSelectedProvider(provider)}
            >
              <div className="flex flex-col gap-3">
                <div className="flex items-start justify-between">
                  <h3 className="font-semibold text-text-primary text-lg">
                    {provider.name}
                  </h3>
                  <Badge variant={activeCount > 0 ? 'success' : 'default'} size="sm">
                    {provider.keys.length} keys
                  </Badge>
                </div>
                
                <div className="text-text-muted text-xs line-clamp-1">
                  {provider.baseUrl}
                </div>

                {hasQuotaData && (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-medium text-text-primary">
                        {percentage >= 100 ? 'Over Quota' : `${percentage.toFixed(1)}% used`}
                      </span>
                      <span className="text-text-muted">
                        {totalLimit.toLocaleString()} limit
                      </span>
                    </div>
                    <div className="w-full bg-black/5 dark:bg-white/5 rounded-full h-2">
                      <div
                        className={`h-2 rounded-full transition-all ${
                          percentage > 90
                            ? 'bg-red-500'
                            : percentage > 70
                            ? 'bg-yellow-500'
                            : 'bg-green-500'
                        }`}
                        style={{ width: `${Math.min(percentage, 100)}%` }}
                      />
                    </div>
                    <div className="text-xs text-text-muted">
                      {totalUsed.toLocaleString()} used / {(totalLimit - totalUsed).toLocaleString()} remaining
                    </div>
                  </div>
                )}

                <div className="grid grid-cols-2 gap-2 pt-2 border-t border-border text-xs">
                  <div>
                    <span className="text-text-muted block">Total Keys</span>
                    <span className="font-medium text-text-primary">{provider.keys.length}</span>
                  </div>
                  <div>
                    <span className="text-text-muted block">Active</span>
                    <span className="font-medium text-green-600 dark:text-green-400">{activeCount}</span>
                  </div>
                </div>
              </div>
            </Card>
          );
        })}
      </div>

      {providers.length === 0 && (
        <Card padding="md">
          <div className="text-center py-8 text-text-muted">
            No custom OpenAI-compatible providers found
          </div>
        </Card>
      )}
    </div>
  );
}
