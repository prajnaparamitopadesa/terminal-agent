import { useState, useEffect } from 'react'
import { Server, AiModel, ModelProvider } from '../types'
import { Monitor, Plus, Trash2, Terminal, Server as ServerIcon, BrainCircuit, Pencil, Check, X, Building2, HelpCircle, AlertTriangle } from 'lucide-react'
import { Button } from '../components/ui/button'
import { Input } from '../components/ui/input'
import { Select } from '../components/ui/select'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '../components/ui/dialog'
import { useNavigate } from 'react-router-dom'

type Tab = 'servers' | 'models' | 'providers'

const emptyModelForm = { model_name: '', display_name: '', provider: '', enabled: 'Y' as 'Y' | 'N' }
const emptyProviderForm = { name: '', label: '', base_url: '', api_key: '' }

interface ConfirmState {
  type: 'server' | 'model' | 'provider'
  id?: number
  name?: string
  /** For provider deletion: list of model IDs that belong to this provider */
  affectedModels?: AiModel[]
}

const TAB_STORAGE_KEY = 'serverList_activeTab'

function getStoredTab(): Tab {
  try {
    const stored = localStorage.getItem(TAB_STORAGE_KEY)
    if (stored === 'servers' || stored === 'models' || stored === 'providers') return stored
  } catch (e) {
    console.warn('Failed to retrieve stored tab:', e)
  }
  return 'servers'
}

export default function ServerList() {
  const [tab, setTab] = useState<Tab>(getStoredTab)
  const navigate = useNavigate()

  useEffect(() => {
    try { localStorage.setItem(TAB_STORAGE_KEY, tab) } catch (e) { console.warn('Failed to save tab state:', e) }
  }, [tab])

  // ── Confirmation dialog ───────────────────────────────────────────────────
  const [confirmState, setConfirmState] = useState<ConfirmState | null>(null)

  // ── Servers ──────────────────────────────────────────────────────────────
  const [servers, setServers] = useState<Server[]>([])
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({ name: '', username: '', host: '', port: '22' })

  useEffect(() => {
    fetch('/api/servers').then(r => r.json()).then(setServers).catch(console.error)
  }, [])

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault()
    const res = await fetch('/api/servers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...form, port: Number(form.port) || 22 }),
    })
    const server = await res.json()
    setServers(prev => [server, ...prev])
    setShowForm(false)
    setForm({ name: '', username: '', host: '', port: '22' })
  }

  const handleDelete = async (id: number) => {
    await fetch(`/api/servers/${id}`, { method: 'DELETE' })
    setServers(prev => prev.filter(s => s.id !== id))
  }

  const handleConnect = (server: Server) => {
    window.open(`/connect/${server.id}`, '_blank')
  }

  // ── Providers ─────────────────────────────────────────────────────────────
  const [providers, setProviders] = useState<ModelProvider[]>([])
  const [showProviderForm, setShowProviderForm] = useState(false)
  const [providerForm, setProviderForm] = useState(emptyProviderForm)
  const [editingProviderName, setEditingProviderName] = useState<string | null>(null)

  const fetchProviders = () => {
    fetch('/api/providers').then(r => r.json()).then(setProviders).catch(console.error)
  }

  useEffect(() => {
    fetchProviders()
  }, [])

  const handleAddProvider = async (e: React.FormEvent) => {
    e.preventDefault()
    await fetch('/api/providers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(providerForm),
    }).catch(console.error)
    setProviderForm(emptyProviderForm)
    setShowProviderForm(false)
    fetchProviders()
  }

  const handleDeleteProvider = async (name: string) => {
    await fetch(`/api/providers/${encodeURIComponent(name)}`, { method: 'DELETE' }).catch(console.error)
    setProviders(prev => prev.filter(p => p.name !== name))
    // Also remove associated models from the local list
    setModels(prev => prev.filter(m => m.provider !== name))
  }

  const startEditProvider = (provider: ModelProvider) => {
    setEditingProviderName(provider.name)
    setProviderForm({
      name: provider.name,
      label: provider.label || '',
      base_url: provider.base_url,
      api_key: provider.api_key,
    })
  }

  const handleSaveProviderEdit = async (originalName: string) => {
    await fetch(`/api/providers/${encodeURIComponent(originalName)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(providerForm),
    }).catch(console.error)
    setEditingProviderName(null)
    setProviderForm(emptyProviderForm)
    fetchProviders()
  }

  const cancelProviderEdit = () => {
    setEditingProviderName(null)
    setProviderForm(emptyProviderForm)
  }

  // ── AI Models ─────────────────────────────────────────────────────────────
  const [models, setModels] = useState<AiModel[]>([])
  const [showModelForm, setShowModelForm] = useState(false)
  const [modelForm, setModelForm] = useState(emptyModelForm)
  const [editingModelId, setEditingModelId] = useState<number | null>(null)

  const fetchModels = () => {
    fetch('/api/ai-models').then(r => r.json()).then(setModels).catch(console.error)
  }

  useEffect(() => {
    if (tab === 'models' || tab === 'providers') fetchModels()
  }, [tab])

  // Sync default provider when providers load (only sets once when provider is empty)
  useEffect(() => {
    if (providers.length > 0) {
      setModelForm(f => f.provider ? f : { ...f, provider: providers[0].name })
    }
  }, [providers])

  const handleAddModel = async (e: React.FormEvent) => {
    e.preventDefault()
    await fetch('/api/ai-models', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(modelForm),
    }).catch(console.error)
    setModelForm({ ...emptyModelForm, provider: providers[0]?.name || '' })
    setShowModelForm(false)
    fetchModels()
  }

  const handleToggleModel = async (model: AiModel) => {
    await fetch(`/api/ai-models/${model.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: model.enabled === 'Y' ? 'N' : 'Y' }),
    }).catch(console.error)
    fetchModels()
  }

  const handleDeleteModel = async (id: number) => {
    await fetch(`/api/ai-models/${id}`, { method: 'DELETE' }).catch(console.error)
    setModels(prev => prev.filter(m => m.id !== id))
  }

  const startEditModel = (model: AiModel) => {
    setEditingModelId(model.id)
    setModelForm({
      model_name: model.model_name,
      display_name: model.display_name || model.model_name,
      provider: model.provider,
      enabled: model.enabled,
    })
  }

  const handleSaveEdit = async (id: number) => {
    await fetch(`/api/ai-models/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(modelForm),
    }).catch(console.error)
    setEditingModelId(null)
    setModelForm({ ...emptyModelForm, provider: providers[0]?.name || '' })
    fetchModels()
  }

  const cancelEdit = () => {
    setEditingModelId(null)
    setModelForm({ ...emptyModelForm, provider: providers[0]?.name || '' })
  }

  const handleShowModelForm = () => {
    setShowModelForm(prev => !prev)
    cancelEdit()
  }

  // ── Confirm dialog actions ────────────────────────────────────────────────
  const handleConfirmDelete = async () => {
    if (!confirmState) return
    if (confirmState.type === 'server' && confirmState.id !== undefined) {
      await handleDelete(confirmState.id)
    } else if (confirmState.type === 'model' && confirmState.id !== undefined) {
      await fetch(`/api/ai-models/${confirmState.id}`, { method: 'DELETE' }).catch(console.error)
      setModels(prev => prev.filter(m => m.id !== confirmState.id))
    } else if (confirmState.type === 'provider' && confirmState.name) {
      // Delete all associated models first
      for (const m of confirmState.affectedModels || []) {
        await fetch(`/api/ai-models/${m.id}`, { method: 'DELETE' }).catch(console.error)
      }
      await handleDeleteProvider(confirmState.name)
    }
    setConfirmState(null)
  }

  return (
    <>
    {/* ── Confirm Dialog ── */}
    <Dialog open={!!confirmState} onOpenChange={open => { if (!open) setConfirmState(null) }}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="w-5 h-5 text-red-400" />
            确认删除
          </DialogTitle>
          <DialogDescription>
            {confirmState?.type === 'server' && '此操作将永久删除该服务器配置，无法恢复。'}
            {confirmState?.type === 'model' && '此操作将永久删除该模型，无法恢复。'}
            {confirmState?.type === 'provider' && (
              confirmState.affectedModels && confirmState.affectedModels.length > 0
                ? `删除服务商「${confirmState.name}」将同时删除其下 ${confirmState.affectedModels.length} 个模型，操作无法恢复。`
                : `此操作将永久删除服务商「${confirmState.name}」，无法恢复。`
            )}
          </DialogDescription>
        </DialogHeader>
        {confirmState?.type === 'provider' && confirmState.affectedModels && confirmState.affectedModels.length > 0 && (
          <div className="bg-red-950/30 border border-red-800/50 rounded-lg p-3 text-xs text-red-300 space-y-1 max-h-32 overflow-y-auto">
            {confirmState.affectedModels.map(m => (
              <div key={m.id}>{m.display_name || m.model_name}</div>
            ))}
          </div>
        )}
        <DialogFooter>
          <Button variant="ghost" onClick={() => setConfirmState(null)}>取消</Button>
          <Button variant="destructive" onClick={handleConfirmDelete}>确认删除</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    <div className="min-h-screen bg-gray-950 p-8">
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <Terminal className="w-8 h-8 text-green-400" />
            <h1 className="text-2xl font-bold text-white">终端助手</h1>
          </div>
          <Button variant="ghost" size="sm" onClick={() => navigate('/help')} className="text-gray-400 hover:text-white">
            <HelpCircle className="w-4 h-4" />
            使用帮助
          </Button>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 mb-6 border-b border-gray-700">
          <button
            onClick={() => setTab('servers')}
            className={`px-4 py-2 text-sm font-medium rounded-t-lg transition-colors ${
              tab === 'servers'
                ? 'text-white bg-gray-800 border-b-2 border-green-400'
                : 'text-gray-400 hover:text-gray-200'
            }`}
          >
            <span className="flex items-center gap-2">
              <ServerIcon className="w-4 h-4" />
              服务器
            </span>
          </button>
          <button
            onClick={() => setTab('providers')}
            className={`px-4 py-2 text-sm font-medium rounded-t-lg transition-colors ${
              tab === 'providers'
                ? 'text-white bg-gray-800 border-b-2 border-purple-400'
                : 'text-gray-400 hover:text-gray-200'
            }`}
          >
            <span className="flex items-center gap-2">
              <Building2 className="w-4 h-4" />
              服务商
            </span>
          </button>
          <button
            onClick={() => setTab('models')}
            className={`px-4 py-2 text-sm font-medium rounded-t-lg transition-colors ${
              tab === 'models'
                ? 'text-white bg-gray-800 border-b-2 border-blue-400'
                : 'text-gray-400 hover:text-gray-200'
            }`}
          >
            <span className="flex items-center gap-2">
              <BrainCircuit className="w-4 h-4" />
              模型管理
            </span>
          </button>
        </div>

        {/* ── Servers Tab ── */}
        {tab === 'servers' && (
          <>
            <div className="flex justify-end mb-4">
              <Button onClick={() => setShowForm(!showForm)} variant="success">
                <Plus className="w-4 h-4" />
                添加服务器
              </Button>
            </div>

            {showForm && (
              <div className="bg-gray-900 border border-gray-700 rounded-xl p-6 mb-6">
                <h2 className="text-lg font-semibold mb-4 text-gray-200">添加新服务器</h2>
                <form onSubmit={handleAdd} className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm text-gray-400 mb-1">名称（可选）</label>
                    <Input
                      type="text"
                      value={form.name}
                      onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                      placeholder="我的服务器"
                    />
                  </div>
                  <div>
                    <label className="block text-sm text-gray-400 mb-1">用户名 *</label>
                    <Input
                      type="text"
                      required
                      value={form.username}
                      onChange={e => setForm(f => ({ ...f, username: e.target.value }))}
                      placeholder="root"
                    />
                  </div>
                  <div>
                    <label className="block text-sm text-gray-400 mb-1">主机地址 *</label>
                    <Input
                      type="text"
                      required
                      value={form.host}
                      onChange={e => setForm(f => ({ ...f, host: e.target.value }))}
                      placeholder="192.168.1.1"
                    />
                  </div>
                  <div>
                    <label className="block text-sm text-gray-400 mb-1">端口</label>
                    <Input
                      type="number"
                      value={form.port}
                      onChange={e => setForm(f => ({ ...f, port: e.target.value }))}
                      placeholder="22"
                    />
                  </div>
                  <div className="col-span-2 flex gap-3 justify-end">
                    <Button type="button" variant="ghost" onClick={() => setShowForm(false)}>
                      取消
                    </Button>
                    <Button type="submit" variant="success" size="lg">
                      添加
                    </Button>
                  </div>
                </form>
              </div>
            )}

            <div className="grid gap-4">
              {servers.length === 0 ? (
                <div className="text-center py-16 text-gray-500">
                  <ServerIcon className="w-12 h-12 mx-auto mb-4 opacity-50" />
                  <p>尚未添加任何服务器，点击「添加服务器」开始使用。</p>
                </div>
              ) : (
                servers.map(server => (
                  <div key={server.id} className="bg-gray-900 border border-gray-700 rounded-xl p-5 flex items-center justify-between hover:border-gray-500 transition-colors">
                    <div className="flex items-center gap-4">
                      <div className="bg-gray-800 rounded-lg p-2">
                        <Monitor className="w-6 h-6 text-green-400" />
                      </div>
                      <div>
                        <h3 className="font-semibold text-white">{server.name || server.host}</h3>
                        <p className="text-sm text-gray-400">
                          {server.username}@{server.host}:{server.port}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <Button onClick={() => handleConnect(server)} variant="default">
                        <Terminal className="w-4 h-4" />
                        连接
                      </Button>
                      <Button
                        onClick={() => setConfirmState({ type: 'server', id: server.id, name: server.name || server.host })}
                        variant="ghost"
                        size="icon"
                        className="text-gray-500 hover:text-red-400 hover:bg-gray-800"
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </>
        )}

        {/* ── Providers Tab ── */}
        {tab === 'providers' && (
          <>
            <div className="flex justify-end mb-4">
              <Button onClick={() => { setShowProviderForm(p => !p); cancelProviderEdit() }} variant="secondary">
                <Plus className="w-4 h-4" />
                添加服务商
              </Button>
            </div>

            {showProviderForm && (
              <div className="bg-gray-900 border border-gray-700 rounded-xl p-6 mb-6">
                <h2 className="text-lg font-semibold mb-4 text-gray-200">添加服务商</h2>
                <form onSubmit={handleAddProvider} className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm text-gray-400 mb-1">服务商标识 *</label>
                    <Input
                      type="text"
                      required
                      value={providerForm.name}
                      onChange={e => setProviderForm(f => ({ ...f, name: e.target.value }))}
                      placeholder="例如：阿里云"
                    />
                  </div>
                  <div>
                    <label className="block text-sm text-gray-400 mb-1">显示名称</label>
                    <Input
                      type="text"
                      value={providerForm.label}
                      onChange={e => setProviderForm(f => ({ ...f, label: e.target.value }))}
                      placeholder="例如：阿里云 DashScope"
                    />
                  </div>
                  <div className="col-span-2">
                    <label className="block text-sm text-gray-400 mb-1">API Base URL *</label>
                    <Input
                      type="url"
                      required
                      value={providerForm.base_url}
                      onChange={e => setProviderForm(f => ({ ...f, base_url: e.target.value }))}
                      placeholder="https://dashscope.aliyuncs.com/compatible-mode/v1"
                    />
                  </div>
                  <div className="col-span-2">
                    <label className="block text-sm text-gray-400 mb-1">API Key *</label>
                    <Input
                      type="password"
                      required
                      value={providerForm.api_key}
                      onChange={e => setProviderForm(f => ({ ...f, api_key: e.target.value }))}
                      placeholder="sk-..."
                    />
                  </div>
                  <div className="col-span-2 flex gap-3 justify-end">
                    <Button type="button" variant="ghost" onClick={() => setShowProviderForm(false)}>取消</Button>
                    <Button type="submit" variant="secondary" size="lg">添加</Button>
                  </div>
                </form>
              </div>
            )}

            <div className="grid gap-3">
              {providers.length === 0 ? (
                <div className="text-center py-16 text-gray-500">
                  <Building2 className="w-12 h-12 mx-auto mb-4 opacity-50" />
                  <p>尚未配置任何服务商，点击「添加服务商」开始使用。</p>
                </div>
              ) : (
                providers.map(provider => (
                  <div key={provider.name} className="bg-gray-900 border border-gray-700 rounded-xl p-4 hover:border-gray-500 transition-colors">
                    {editingProviderName === provider.name ? (
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="block text-xs text-gray-400 mb-1">服务商标识</label>
                          <Input
                            type="text"
                            value={providerForm.name}
                            onChange={e => setProviderForm(f => ({ ...f, name: e.target.value }))}
                          />
                        </div>
                        <div>
                          <label className="block text-xs text-gray-400 mb-1">显示名称</label>
                          <Input
                            type="text"
                            value={providerForm.label}
                            onChange={e => setProviderForm(f => ({ ...f, label: e.target.value }))}
                          />
                        </div>
                        <div className="col-span-2">
                          <label className="block text-xs text-gray-400 mb-1">API Base URL</label>
                          <Input
                            type="url"
                            value={providerForm.base_url}
                            onChange={e => setProviderForm(f => ({ ...f, base_url: e.target.value }))}
                          />
                        </div>
                        <div className="col-span-2">
                          <label className="block text-xs text-gray-400 mb-1">API Key</label>
                          <Input
                            type="password"
                            value={providerForm.api_key}
                            onChange={e => setProviderForm(f => ({ ...f, api_key: e.target.value }))}
                            placeholder="留空则保持不变"
                          />
                        </div>
                        <div className="col-span-2 flex gap-2 justify-end">
                          <Button variant="ghost" size="sm" onClick={cancelProviderEdit}>
                            <X className="w-3.5 h-3.5" />取消
                          </Button>
                          <Button variant="success" size="sm" onClick={() => handleSaveProviderEdit(provider.name)}>
                            <Check className="w-3.5 h-3.5" />保存
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-4">
                          <div className="bg-gray-800 rounded-lg p-2">
                            <Building2 className="w-5 h-5 text-purple-400" />
                          </div>
                          <div>
                            <span className="font-medium text-white">{provider.label || provider.name}</span>
                            <p className="text-xs text-gray-500 mt-0.5">
                              {provider.name} · {provider.base_url}
                            </p>
                            <p className="text-xs text-gray-600 mt-0.5">
                              API Key: {provider.api_key ? `sk-${'*'.repeat(6)}${provider.api_key.slice(-4)}` : '未设置'}
                            </p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => startEditProvider(provider)}
                            className="text-gray-500 hover:text-purple-400 hover:bg-gray-800"
                          >
                            <Pencil className="w-4 h-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => {
                              const affectedModels = models.filter(m => m.provider === provider.name)
                              setConfirmState({ type: 'provider', name: provider.name, affectedModels })
                            }}
                            className="text-gray-500 hover:text-red-400 hover:bg-gray-800"
                          >
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        </div>
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          </>
        )}

        {/* ── Models Tab ── */}
        {tab === 'models' && (
          <>
            <div className="flex justify-end mb-4">
              <Button onClick={handleShowModelForm} variant="default">
                <Plus className="w-4 h-4" />
                添加模型
              </Button>
            </div>

            {/* Add model form */}
            {showModelForm && (
              <div className="bg-gray-900 border border-gray-700 rounded-xl p-6 mb-6">
                <h2 className="text-lg font-semibold mb-4 text-gray-200">添加新模型</h2>
                <form onSubmit={handleAddModel} className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm text-gray-400 mb-1">显示名称</label>
                    <Input
                      type="text"
                      value={modelForm.display_name}
                      onChange={e => setModelForm(f => ({ ...f, display_name: e.target.value }))}
                      placeholder="例如：通义千问 Plus"
                    />
                  </div>
                  <div>
                    <label className="block text-sm text-gray-400 mb-1">模型 ID *</label>
                    <Input
                      type="text"
                      required
                      value={modelForm.model_name}
                      onChange={e => setModelForm(f => ({ ...f, model_name: e.target.value }))}
                      placeholder="例如：qwen-plus"
                    />
                  </div>
                  <div>
                    <label className="block text-sm text-gray-400 mb-1">服务商 *</label>
                    <Select
                      value={modelForm.provider}
                      onChange={e => setModelForm(f => ({ ...f, provider: e.target.value }))}
                      required
                    >
                      {providers.map(p => (
                        <option key={p.name} value={p.name}>{p.label || p.name}</option>
                      ))}
                    </Select>
                  </div>
                  <div>
                    <label className="block text-sm text-gray-400 mb-1">状态</label>
                    <Select
                      value={modelForm.enabled}
                      onChange={e => setModelForm(f => ({ ...f, enabled: e.target.value as 'Y' | 'N' }))}
                    >
                      <option value="Y">启用</option>
                      <option value="N">禁用</option>
                    </Select>
                  </div>
                  <div className="col-span-2 flex gap-3 justify-end">
                    <Button type="button" variant="ghost" onClick={() => setShowModelForm(false)}>
                      取消
                    </Button>
                    <Button type="submit" variant="default" size="lg">
                      添加
                    </Button>
                  </div>
                </form>
              </div>
            )}

            {/* Model list */}
            <div className="grid gap-3">
              {models.length === 0 ? (
                <div className="text-center py-16 text-gray-500">
                  <BrainCircuit className="w-12 h-12 mx-auto mb-4 opacity-50" />
                  <p>尚未配置任何模型，点击「添加模型」开始使用。</p>
                </div>
              ) : (
                models.map(model => (
                  <div key={model.id} className="bg-gray-900 border border-gray-700 rounded-xl p-4 hover:border-gray-500 transition-colors">
                    {editingModelId === model.id ? (
                      /* Inline edit form */
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="block text-xs text-gray-400 mb-1">显示名称</label>
                          <Input
                            type="text"
                            value={modelForm.display_name}
                            onChange={e => setModelForm(f => ({ ...f, display_name: e.target.value }))}
                            placeholder="显示名称"
                          />
                        </div>
                        <div>
                          <label className="block text-xs text-gray-400 mb-1">模型 ID</label>
                          <Input
                            type="text"
                            value={modelForm.model_name}
                            onChange={e => setModelForm(f => ({ ...f, model_name: e.target.value }))}
                            placeholder="模型 ID"
                          />
                        </div>
                        <div>
                          <label className="block text-xs text-gray-400 mb-1">服务商</label>
                          <Select
                            value={modelForm.provider}
                            onChange={e => setModelForm(f => ({ ...f, provider: e.target.value }))}
                          >
                            {providers.map(p => (
                              <option key={p.name} value={p.name}>{p.label || p.name}</option>
                            ))}
                          </Select>
                        </div>
                        <div>
                          <label className="block text-xs text-gray-400 mb-1">状态</label>
                          <Select
                            value={modelForm.enabled}
                            onChange={e => setModelForm(f => ({ ...f, enabled: e.target.value as 'Y' | 'N' }))}
                          >
                            <option value="Y">启用</option>
                            <option value="N">禁用</option>
                          </Select>
                        </div>
                        <div className="col-span-2 flex gap-2 justify-end">
                          <Button variant="ghost" size="sm" onClick={cancelEdit}>
                            <X className="w-3.5 h-3.5" />
                            取消
                          </Button>
                          <Button variant="success" size="sm" onClick={() => handleSaveEdit(model.id)}>
                            <Check className="w-3.5 h-3.5" />
                            保存
                          </Button>
                        </div>
                      </div>
                    ) : (
                      /* Display row */
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-4">
                          <div className="bg-gray-800 rounded-lg p-2">
                            <BrainCircuit className={`w-5 h-5 ${model.enabled === 'Y' ? 'text-blue-400' : 'text-gray-600'}`} />
                          </div>
                          <div>
                            <div className="flex items-center gap-2">
                              <span className="font-medium text-white">{model.display_name || model.model_name}</span>
                              <span className={`text-xs px-1.5 py-0.5 rounded ${model.enabled === 'Y' ? 'bg-green-900 text-green-300' : 'bg-gray-800 text-gray-500'}`}>
                                {model.enabled === 'Y' ? '启用' : '禁用'}
                              </span>
                            </div>
                            <p className="text-xs text-gray-500 mt-0.5">
                              {model.provider} · {model.model_name}
                            </p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleToggleModel(model)}
                            className={model.enabled === 'Y' ? 'text-green-400 hover:text-gray-300' : 'text-gray-500 hover:text-green-400'}
                          >
                            {model.enabled === 'Y' ? '禁用' : '启用'}
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => startEditModel(model)}
                            className="text-gray-500 hover:text-blue-400 hover:bg-gray-800"
                          >
                            <Pencil className="w-4 h-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => setConfirmState({ type: 'model', id: model.id, name: model.display_name || model.model_name })}
                            className="text-gray-500 hover:text-red-400 hover:bg-gray-800"
                          >
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        </div>
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          </>
        )}
      </div>
    </div>
    </>
  )
}
