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
  const [quotaSupport, setQuotaSupport] = useState(() => {
    // Load from localStorage
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('kyorouter_quota_support');
      return saved ? JSON.parse(saved) : {};
    }
    return {};
  });

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
        const probedKeys = typeof window !== 'undefined' ? (JSON.parse(localStorage.getItem('kyorouter_probed_keys') || '{}')) : {};
        const providersWithCache = (data.result || data).map(provider => ({
          ...provider,
          keys: provider.keys.map(key => {
            const cached = quotaMap.get(`${provider.nodeId}-${key.connectionId}`);
            // cached → quota + probed
            if (cached) return { ...key, quota: cached, quotaProbed: true };
            // previously tried & failed (transient/unsupported) → don't auto re-probe. persisted in localStorage
            if (probedKeys[`${provider.nodeId}-${key.connectionId}`]) return { ...key, quotaProbed: true, quotaUnsupported: true };
            return key;
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
      console.log('[AutoFetch] Starting auto-fetch check, quotaSupport state:', quotaSupport);
      
      // Only probe providers with empty/stale cache
      providers.forEach(provider => {
        console.log(`[AutoFetch] Checking ${provider.name} (nodeId: ${provider.nodeId})`);
        
        // Check if provider supports quota API
        if (!shouldProbeProvider(provider)) {
          console.log(`[AutoFetch] ${provider.name}: SKIPPED by shouldProbeProvider`);
          return;
        }
        
        const hasStaleCache = provider.keys.some(key => {
          // No cache AND not yet probed = needs probe
          if (!key.quotaProbed) return true;
          // probed but quota present → skip (cache already loaded)
          // probed without quota → already tried, don't re-probe automatically
          return false;
        });
        
        console.log(`[AutoFetch] ${provider.name}: hasStaleCache=${hasStaleCache}, keys=${provider.keys.length}`);
        
        // Probe only if at least one key has no cached data
        if (hasStaleCache) {
          console.log(`[AutoFetch] Probing ${provider.name} (has stale/empty cache)`);
          probeAllKeys(provider);
        } else {
          console.log(`[AutoFetch] Skipping ${provider.name} (all keys cached)`);
        }
      });
    }
  }, [providers.length, loading]); // Remove quotaSupport dependency to prevent infinite loop

  // Helper: Update quota support status and save to localStorage
  function updateQuotaSupport(nodeId, supported) {
    const updated = {
      ...quotaSupport,
      [nodeId]: {
        supported,
        lastChecked: Date.now()
      }
    };
    setQuotaSupport(updated);
    if (typeof window !== 'undefined') {
      localStorage.setItem('kyorouter_quota_support', JSON.stringify(updated));
    }
    console.log(`[QuotaSupport] ${nodeId}: ${supported ? 'SUPPORTED' : 'UNSUPPORTED'}`);
  }

  // Helper: Check if provider should be probed
  function shouldProbeProvider(provider) {
    const support = quotaSupport[provider.nodeId];
    const RECHECK_INTERVAL = 7 * 24 * 60 * 60 * 1000; // 7 days
    
    // Unknown support → probe to detect
    if (!support) return true;
    
    // Marked unsupported → skip (unless recheck time passed)
    if (!support.supported) {
      const needsRecheck = Date.now() - support.lastChecked > RECHECK_INTERVAL;
      if (needsRecheck) {
        console.log(`[QuotaSupport] ${provider.name}: Re-checking after 7 days`);
        return true;
      }
      console.log(`[QuotaSupport] ${provider.name}: SKIP (marked unsupported)`);
      return false;
    }
    
    // Supported → continue normal logic
    return true;
  }

  // Helper: persist a key as "already probed" so it's not auto-re-probed every load
  function persistProbedKeys(nodeId, connectionIds) {
    if (typeof window === 'undefined') return;
    const key = `${nodeId}-`;
    let probed = {};
    try { probed = JSON.parse(localStorage.getItem('kyorouter_probed_keys') || '{}'); } catch {}
    connectionIds.forEach(cid => { probed[key + cid] = true; });
    localStorage.setItem('kyorouter_probed_keys', JSON.stringify(probed));
  }

  async function probeAllKeys(provider) {
    const activeKeys = provider.keys.filter(k => k.testStatus === 'active');
    // Only probe keys that have no cached quota yet (not probed). Once a key is
    // probed (success OR fail), quotaProbed=true → skipped on subsequent loads.
    // This prevents re-probing 1000+ keys just because 2 keys lack cache.
    const keysToProbe = activeKeys.filter(k => !k.quotaProbed);
    if (keysToProbe.length === 0) {
      console.log(`[AutoFetch] ${provider.name}: all ${activeKeys.length} keys already probed, skipping probe`);
      return;
    }
    
    const BATCH_SIZE = 50;
    const results = [];
    const probedFallback = new Set(); // keys that failed/null — mark probed so no re-loop
    
    // Process in batches to reduce UI jitter
    for (let i = 0; i < keysToProbe.length; i++) {
      const key = keysToProbe[i];
      const result = await probeSingleQuota(provider.nodeId, key.connectionId, key.keyName, provider.baseUrl);
      
      // Backend reported no quota endpoint for this key.
      // If this provider already has cached quota data, its endpoint DOES work —
      // this is a per-key failure (bad key / rate-limit), don't punish the provider.
      if (result && result.unsupported) {
        const hasCachedData = provider.keys.some(k => k.quotaProbed && k.quota);
        if (hasCachedData) {
          console.log(`[QuotaSupport] ${provider.name}: per-key failure (provider has cached data), not marking unsupported`);
          probedFallback.add(key.connectionId);
          persistProbedKeys(provider.nodeId, [key.connectionId]);
        } else {
          // No cached data at all → genuinely no quota endpoint → mark provider unsupported
          updateQuotaSupport(provider.nodeId, false);
          // Mark ALL keys as probed + unsupported so they're never auto-probed again
          setProviders(prev => prev.map(p => {
            if (p.nodeId !== provider.nodeId) return p;
            return {
              ...p,
              keys: p.keys.map(k => ({ ...k, quotaProbed: true, quotaUnsupported: true }))
            };
          }));
          if (selectedProvider?.nodeId === provider.nodeId) {
            setSelectedProvider(prev => prev ? { ...prev, keys: prev.keys.map(k => ({ ...k, quotaProbed: true, quotaUnsupported: true })) } : prev);
          }
          persistProbedKeys(provider.nodeId, keysToProbe.map(k => k.connectionId));
          console.log(`[QuotaSupport] ${provider.name}: UNSUPPORTED confirmed, stopping probe of remaining ${keysToProbe.length - i} keys`);
          return;
        }
      }
      
      if (result) {
        results.push({ connectionId: key.connectionId, quota: result });
      } else if (result === null) {
        // probe failed (network/transient/no data) → mark this key probed so it's not re-probed every load.
        // quotaProbed w/o quota shows "—" in UI; scoped so it won't loop. Persist so next load skips it too.
        probedFallback.add(key.connectionId);
        persistProbedKeys(provider.nodeId, [key.connectionId]);
      }

      // Batch update every 50 keys or at the end
      if (results.length >= BATCH_SIZE || i === activeKeys.length - 1) {
        if (results.length > 0 || probedFallback.size > 0) {
          // Batch state update
          setProviders(prev => prev.map(p => {
            if (p.nodeId !== provider.nodeId) return p;
            return {
              ...p,
              keys: p.keys.map(k => {
                const resultData = results.find(r => r.connectionId === k.connectionId);
                if (resultData) return { ...k, quota: resultData.quota, quotaProbed: true };
                if (probedFallback.has(k.connectionId)) return { ...k, quotaProbed: true };
                return k;
              })
            };
          }));
          
          if (selectedProvider?.nodeId === provider.nodeId) {
            setSelectedProvider(prev => ({
              ...prev,
              keys: prev.keys.map(k => {
                const resultData = results.find(r => r.connectionId === k.connectionId);
                if (resultData) return { ...k, quota: resultData.quota, quotaProbed: true };
                if (probedFallback.has(k.connectionId)) return { ...k, quotaProbed: true };
                return k;
              })
            }));
          }
          
          results.length = 0; // Clear batch
          probedFallback.clear();
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
      
      // Backend definitively found no quota endpoint for this provider
      if (data && data.unsupported) {
        return { unsupported: true };
      }
      
      if (data && (data.limit != null || data.used != null || data.remaining != null)) {
        // Mark provider as supporting quota
        updateQuotaSupport(nodeId, true);
        
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
      } else {
        console.log(`[QuotaSupport] ${nodeId}: No quota data, but not marking unsupported yet`);
      }
    } catch (e) {
      // Network error / fetch failed → DON'T mark unsupported (could be temp issue)
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
      
      // Backend definitively found no quota endpoint
      if (data && data.unsupported) {
        // Guard: if provider already has cached quota, a single bad key shouldn't do this
        const p = providers.find(x => x.nodeId === nodeId);
        const hasCachedData = p && p.keys.some(k => k.quotaProbed && k.quota);
        if (!hasCachedData) {
          updateQuotaSupport(nodeId, false);
          setProviders(prev => prev.map(x => {
            if (x.nodeId !== nodeId) return x;
            return { ...x, keys: x.keys.map(k =>
              k.connectionId === connectionId ? { ...k, quotaUnsupported: true, quotaProbed: true } : k
            ) };
          }));
          if (selectedProvider?.nodeId === nodeId) {
            setSelectedProvider(prev => ({ ...prev, keys: prev.keys.map(k =>
              k.connectionId === connectionId ? { ...k, quotaUnsupported: true, quotaProbed: true } : k
            ) }));
          }
        }
        persistProbedKeys(nodeId, [connectionId]);
        return;
      }
      
      const hasQuota = data && (data.limit != null || data.used != null || data.remaining != null);
      if (hasQuota) {
        // Mark provider as supporting quota
        updateQuotaSupport(nodeId, true);
        
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
        // No quota data for this key. Only mark provider unsupported if it has NO cached data.
        const pr = providers.find(x => x.nodeId === nodeId);
        const hasCachedData = pr && pr.keys.some(k => k.quotaProbed && k.quota);
        if (!hasCachedData) {
          updateQuotaSupport(nodeId, false);
        }
        // Mark THIS key probed (so auto-fetch won't retry it)
        setProviders(prev => prev.map(p => {
          if (p.nodeId !== nodeId) return p;
          return {
            ...p,
            keys: p.keys.map(k => {
              if (k.connectionId !== connectionId) return k;
              return { ...k, quotaUnsupported: !hasCachedData, quotaProbed: true };
            })
          };
        }));
        if (selectedProvider?.nodeId === nodeId) {
          setSelectedProvider(prev => ({
            ...prev,
            keys: prev.keys.map(k => {
              if (k.connectionId !== connectionId) return k;
              return { ...k, quotaUnsupported: !hasCachedData, quotaProbed: true };
            })
          }));
        }
        persistProbedKeys(nodeId, [connectionId]);
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
                ?.filter(k => k.quota?.used != null)
                .reduce((sum, k) => sum + k.quota.used, 0) || 0)
                .toLocaleString()}
            </div>
          </Card>
          <Card padding="md">
            <div className="text-text-muted text-sm mb-1">Total Tokens Limit</div>
            <div className="text-2xl font-bold text-blue-600 dark:text-blue-400">
              {(selectedProvider?.keys
                ?.filter(k => k.quota?.limit != null)
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
                          {key.quotaProbed && key.quota && (key.quota.used != null || key.quota.limit != null || key.quota.remaining != null) ? (
                            <div className="space-y-1">
                              <div className="flex items-center gap-2">
                                <div className="flex-1">
                                  <div className="flex items-center justify-between text-xs mb-1">
                                    <span className="font-medium">
                                      {key.quota.used != null && key.quota.limit != null
                                        ? key.quota.used > key.quota.limit
                                          ? 'Over Quota'
                                          : `${(((key.quota.limit - key.quota.used) / key.quota.limit) * 100).toFixed(1)}% remaining`
                                        : key.quota.remaining != null
                                        ? `${key.quota.remaining.toLocaleString()} remaining`
                                        : 'Available'}
                                    </span>
                                    {key.quota.limit != null && (
                                      <span className="text-text-muted">
                                        {key.quota.limit.toLocaleString()} limit
                                      </span>
                                    )}
                                  </div>
                                  {key.quota.used != null && key.quota.limit != null && (() => {
                                    const remaining = Math.max(key.quota.limit - key.quota.used, 0);
                                    const remainingPct = (remaining / key.quota.limit) * 100;
                                    return (
                                      <div className="w-full bg-black/5 dark:bg-white/5 rounded-full h-2">
                                        <div
                                          className={`h-2 rounded-full transition-all ${
                                            remainingPct < 0.1
                                              ? 'bg-red-500'
                                              : remainingPct < 0.3
                                              ? 'bg-yellow-500'
                                              : 'bg-green-500'
                                          }`}
                                          style={{ width: `${Math.min(remainingPct, 100)}%` }}
                                        />
                                      </div>
                                    );
                                  })()}
                                </div>
                              </div>
                              {key.quota.used != null && (
                                <div className="text-xs text-text-muted">
                                  {key.quota.used.toLocaleString()} used
                                  {key.quota.remaining != null && ` / ${key.quota.remaining.toLocaleString()} remaining`}
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
            .filter(k => k.quota?.used != null)
            .reduce((sum, k) => sum + k.quota.used, 0);
          const totalLimit = provider.keys
            .filter(k => k.quota?.limit != null)
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
                        {percentage >= 100 ? 'Over Quota' : `${(100 - percentage).toFixed(1)}% remaining`}
                      </span>
                      <span className="text-text-muted">
                        {totalLimit.toLocaleString()} limit
                      </span>
                    </div>
                    <div className="w-full bg-black/5 dark:bg-white/5 rounded-full h-2">
                      <div
                        className={`h-2 rounded-full transition-all ${
                          (100 - percentage) < 0.1
                            ? 'bg-red-500'
                            : (100 - percentage) < 0.3
                            ? 'bg-yellow-500'
                            : 'bg-green-500'
                        }`}
                        style={{ width: `${Math.min(100 - percentage, 100)}%` }}
                      />
                    </div>
                    <div className="text-xs text-text-muted">
                      {(totalLimit - totalUsed).toLocaleString()} remaining / {totalUsed.toLocaleString()} used
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
