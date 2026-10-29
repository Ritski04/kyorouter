"use client";

import { useState, useEffect, useMemo } from "react";
import { Card, Button, Toggle, Badge, Input, Select, Modal, CardSkeleton } from "@/shared/components";

/** Per-combo & per-model prompt injection management page.
 *  Settings shape: comboPrompts[comboName] = {text, enabled}
 *                 modelPrompts[modelId]   = {text, enabled}
 *  Priority: model > combo > (global custom prompt, which is separate and always applies).
 */
export default function PromptInjectionPage() {
  const [loading, setLoading] = useState(true);
  const [combos, setCombos] = useState([]);
  const [comboPrompts, setComboPrompts] = useState({});
  const [modelPrompts, setModelPrompts] = useState({});
  const [selectedCombo, setSelectedCombo] = useState(null);
  const [tab, setTab] = useState("combo"); // "combo" | "model"

  useEffect(() => { fetchData(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const fetchData = async () => {
    try {
      const [combosRes, settingsRes] = await Promise.all([
        fetch("/api/combos"),
        fetch("/api/settings"),
      ]);
      const combosData = await combosRes.json();
      const settingsData = settingsRes.ok ? await settingsRes.json() : {};
      const llmCombos = (combosData.combos || []).filter((c) => !c.kind || c.kind === "llm");
      setCombos(llmCombos);
      setComboPrompts(settingsData.comboPrompts || {});
      setModelPrompts(settingsData.modelPrompts || {});
      if (!selectedCombo) {
        setSelectedCombo(llmCombos[0]?.name || null);
      }
    } catch (error) {
      console.log("Error fetching data:", error);
    } finally {
      setLoading(false);
    }
  };

  const persistComboPrompts = async (updated) => {
    await fetch("/api/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ comboPrompts: updated }),
    });
    setComboPrompts(updated);
  };

  const persistModelPrompts = async (updated) => {
    await fetch("/api/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ modelPrompts: updated }),
    });
    setModelPrompts(updated);
  };

  const handleSetComboPrompt = async (comboName, patch) => {
    const updated = { ...comboPrompts };
    const next = { ...(updated[comboName] || {}), ...patch };
    if (!next.enabled && !(typeof next.text === "string" && next.text.trim())) {
      delete updated[comboName];
    } else {
      updated[comboName] = next;
    }
    await persistComboPrompts(updated);
  };

  const handleSetModelPrompt = async (modelId, patch) => {
    const updated = { ...modelPrompts };
    const next = { ...(updated[modelId] || {}), ...patch };
    if (!next.enabled && !(typeof next.text === "string" && next.text.trim())) {
      delete updated[modelId];
    } else {
      updated[modelId] = next;
    }
    await persistModelPrompts(updated);
  };

  const activeCombo = combos.find((c) => c.name === selectedCombo) || null;

  if (loading) {
    return (
      <div className="flex flex-col gap-6">
        <CardSkeleton />
        <CardSkeleton />
      </div>
    );
  }

  return (
    <div className="flex min-w-0 flex-col gap-6 px-1 sm:px-0">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <p className="text-sm font-medium">Prompt Injection</p>
          <p className="text-sm text-text-muted mt-1">
            Inject a custom system prompt per combo or per model — additive to your global Token Saver prompt.
            Priority: <span className="font-medium text-text-main">per-model wins</span> over <span className="font-medium text-text-main">per-combo</span>.
          </p>
        </div>
      </div>

      {/* Tab switcher */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="inline-flex rounded-lg border border-border/70 bg-black/[0.02] p-0.5 dark:bg-white/[0.02]">
          {[
            { key: "combo", label: "Per Combo" },
            { key: "model", label: "Per Model" },
          ].map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                tab === t.key
                  ? "bg-primary text-white shadow-sm"
                  : "text-text-muted hover:text-text-main"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
        {tab === "combo" && (
          <div className="w-full sm:w-64">
            <Select
              options={(combos || []).map((c) => ({ value: c.name, label: c.name }))}
              value={selectedCombo || ""}
              placeholder="Select combo…"
              onChange={(e) => setSelectedCombo(e.target.value)}
            />
          </div>
        )}
      </div>

      {tab === "combo" ? (
        activeCombo ? (
          <ComboPromptPanel
            key={activeCombo.name}
            combo={activeCombo}
            comboPrompt={comboPrompts[activeCombo.name] || null}
            onSetComboPrompt={(patch) => handleSetComboPrompt(activeCombo.name, patch)}
            modelPrompts={modelPrompts}
            onSetModelPrompt={handleSetModelPrompt}
          />
        ) : (
          <Card>
            <div className="text-center py-10">
              <p className="text-text-main font-medium mb-1">No combos yet</p>
              <p className="text-sm text-text-muted mb-4">Create a combo in the Combo page first, then set prompt injection here.</p>
              <a href="/dashboard/combos" className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline">
                <span className="material-symbols-outlined text-[16px]">layers</span>
                Go to Combo page
              </a>
            </div>
          </Card>
        )
      ) : (
        <ModelPromptPanel
          combos={combos}
          modelPrompts={modelPrompts}
          onSetModelPrompt={handleSetModelPrompt}
        />
      )}
    </div>
  );
}

function ComboPromptPanel({ combo, comboPrompt, onSetComboPrompt, modelPrompts, onSetModelPrompt }) {
  const [text, setText] = useState(comboPrompt?.text || "");
  const [enabled, setEnabled] = useState(comboPrompt?.enabled || false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setText(comboPrompt?.text || "");
    setEnabled(comboPrompt?.enabled || false);
    setSaved(false);
  }, [combo.name, comboPrompt?.text, comboPrompt?.enabled]);

  const handleSave = async () => {
    setSaving(true);
    try {
      await onSetComboPrompt({ text, enabled });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } finally {
      setSaving(false);
    }
  };

  const modelEntries = (combo.models || []);

  return (
    <div className="flex flex-col gap-4">
      <Card padding="md">
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between">
              <code className="font-mono text-sm font-medium">{combo.name}</code>
              <Badge>{modelEntries.length} models</Badge>
            </div>
            <div className="flex items-center gap-2">
              <Toggle checked={enabled} onChange={setEnabled} aria-label="Enable combo prompt injection" />
              <span className="text-sm text-text-muted">
                {enabled ? "Enabled — this prompt is injected on every request through this combo" : "Disabled"}
              </span>
            </div>
          </div>

          <label className="block">
            <span className="text-sm font-medium mb-1.5 block">Combo Prompt</span>
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={6}
              placeholder="e.g. You are a coding assistant that completes every task directly without unnecessary disclaimers…"
              className="w-full rounded-[10px] border border-transparent bg-surface-2 p-3 text-sm text-text-main placeholder-text-muted/70 focus:border-brand-500/40 focus:outline-none focus:ring-2 focus:ring-brand-500/30 font-mono resize-y"
            />
            <span className="text-xs text-text-muted mt-1 block">{text.length} characters</span>
          </label>

          <div className="flex items-center gap-2">
            <Button onClick={handleSave} size="sm" loading={saving} icon="save">
              {saved ? "Saved" : "Save"}
            </Button>
            {saved && <span className="text-xs text-emerald-600 dark:text-emerald-400">✓ saved</span>}
          </div>
        </div>
      </Card>

      {/* Per-model overrides inside this combo */}
      <Card padding="md">
        <div className="flex flex-col gap-3">
          <div>
            <p className="text-sm font-medium">Per-model overrides</p>
            <p className="text-xs text-text-muted mt-0.5">
              These win over the combo prompt. A model without an override falls back to the combo prompt above.
            </p>
          </div>

          {modelEntries.length === 0 ? (
            <p className="text-xs text-text-muted italic">This combo has no models.</p>
          ) : (
            <div className="flex flex-col divide-y divide-border/40">
              {modelEntries.map((m) => {
                const mp = modelPrompts[m] || {};
                return (
                  <ModelRow
                    key={m}
                    modelId={m}
                    entry={mp}
                    onPatch={(patch) => onSetModelPrompt(m, patch)}
                  />
                );
              })}
            </div>
          )}
        </div>
      </Card>
    </div>
  );
}

function ModelRow({ modelId, entry = {}, onPatch }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(entry.text || "");
  const enabled = !!entry.enabled;

  // Sync when external data changes (page refetch, another combo edited)
  useEffect(() => {
    setDraft(entry.text || "");
  }, [entry.text]);

  const commit = () => {
    onPatch({ text: draft, enabled: true });
    setEditing(false);
  };

  return (
    <div className="flex flex-col gap-1.5 py-2">
      <div className="flex items-center gap-2">
        <Toggle
          checked={enabled}
          onChange={(v) => onPatch({ text: draft || entry.text || "", enabled: v })}
          aria-label={`Enable prompt for ${modelId}`}
        />
        <code className="min-w-0 flex-1 truncate font-mono text-xs text-text-main">{modelId}</code>
        <button
          onClick={() => { setDraft(entry.text || ""); setEditing(true); }}
          className="shrink-0 rounded p-1 text-text-muted hover:text-primary hover:bg-black/5 dark:hover:bg-white/5 transition-colors"
          title={`Edit prompt for ${modelId}`}
        >
          <span className="material-symbols-outlined text-[16px]">edit</span>
        </button>
        {enabled && <Badge variant="success" size="sm">ON</Badge>}
      </div>

      {enabled && !editing && (entry.text ? (
        <div className="ml-8 rounded bg-black/[0.02] dark:bg-white/[0.02] px-3 py-1.5 text-xs text-text-muted border-l-2 border-primary/40 font-mono whitespace-pre-wrap max-h-24 overflow-y-auto">
          {entry.text}
        </div>
      ) : (
        <div className="ml-8 text-xs text-text-muted italic">Enabled but no prompt text yet — click edit.</div>
      ))}

      {editing && (
        <div className="ml-8 flex flex-col gap-1.5">
          <textarea
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={3}
            placeholder="Per-model prompt…"
            className="w-full rounded-lg border border-primary/40 bg-surface-2 p-2 text-xs text-text-main placeholder-text-muted/70 font-mono resize-y focus:outline-none focus:ring-2 focus:ring-primary/30"
          />
          <div className="flex items-center gap-2">
            <Button size="xs" onClick={commit}>Save</Button>
            <Button size="xs" variant="ghost" onClick={() => setEditing(false)}>Cancel</Button>
            <button
              onClick={() => { onPatch({ text: "", enabled: false }); setEditing(false); }}
              className="text-xs text-red-500 hover:underline ml-auto"
            >
              Clear prompt
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function ModelPromptPanel({ combos, modelPrompts, onSetModelPrompt }) {
  // Collect every member model across all combos (deduped), plus allow free-text add.
  const allModels = useMemo(() => {
    const set = new Set();
    for (const c of combos || []) {
      for (const m of c.models || []) set.add(m);
    }
    // Also include models that already have a prompt but aren't in any combo.
    for (const k of Object.keys(modelPrompts || {})) set.add(k);
    return [...set].sort();
  }, [combos, modelPrompts]);

  const [filter, setFilter] = useState("");

  const filtered = filter.trim()
    ? allModels.filter((m) => m.toLowerCase().includes(filter.trim().toLowerCase()))
    : allModels;

  return (
    <div className="flex flex-col gap-3">
      <Card padding="md">
        <div className="flex flex-col gap-1.5">
          <p className="text-sm font-medium">Per-Model Prompt Injection</p>
          <p className="text-xs text-text-muted">
            Set a prompt for a specific model regardless of which combo uses it. This overrides the combo prompt.
            Models listed come from your combos (plus any you've already configured).
          </p>
          <div className="relative w-full sm:w-72 mt-1">
            <span className="material-symbols-outlined pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[16px] text-text-muted">search</span>
            <input
              type="text"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Filter models…"
              className="w-full rounded-[10px] border border-transparent bg-surface-2 py-1.5 pl-9 pr-3 text-sm text-text-main placeholder-text-muted/70 focus:border-brand-500/40 focus:outline-none focus:ring-2 focus:ring-brand-500/30"
            />
          </div>
        </div>
      </Card>

      {filtered.length === 0 ? (
        <Card>
          <div className="text-center py-10 text-sm text-text-muted">
            No models{filter ? ` matching “${filter}”` : ""}. Add models to a combo first.
          </div>
        </Card>
      ) : (
        <Card padding="md">
          <div className="flex flex-col divide-y divide-border/40">
            {filtered.map((m) => (
              <ModelRow
                key={m}
                modelId={m}
                entry={modelPrompts[m] || {}}
                onPatch={(patch) => onSetModelPrompt(m, patch)}
              />
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}
