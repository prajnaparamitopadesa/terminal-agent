import { useState, useEffect } from 'react'
import { X, Trash2, Edit2, Save, XCircle, Regex } from 'lucide-react'
import { AutoApproval } from '../types'

interface Props {
  onClose: () => void
  serverId: number
}

export default function AutoApprovalManager({ onClose, serverId }: Props) {
  const [approvals, setApprovals] = useState<AutoApproval[]>([])
  const [editingId, setEditingId] = useState<number | null>(null)
  const [editForm, setEditForm] = useState({ pattern: '', is_regex: false, description: '', scope: 'global' })

  useEffect(() => {
    fetch(`/api/auto-approvals?serverId=${serverId}`).then(r => r.json()).then(setApprovals).catch(console.error)
  }, [serverId])

  const handleDelete = async (id: number) => {
    await fetch(`/api/auto-approvals/${id}`, { method: 'DELETE' })
    setApprovals(prev => prev.filter(a => a.id !== id))
  }

  const startEdit = (approval: AutoApproval) => {
    setEditingId(approval.id)
    setEditForm({
      pattern: approval.pattern,
      is_regex: !!approval.is_regex,
      description: approval.description || '',
      scope: approval.scope,
    })
  }

  const saveEdit = async () => {
    if (!editingId) return
    await fetch(`/api/auto-approvals/${editingId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(editForm),
    })
    setApprovals(prev => prev.map(a => a.id === editingId ? { ...a, ...editForm, is_regex: editForm.is_regex ? 1 : 0 } : a))
    setEditingId(null)
  }

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50">
      <div className="bg-gray-900 border border-gray-700 rounded-xl w-[600px] max-h-[80vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-700">
          <h3 className="font-semibold text-white">Manage Auto-Approvals</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-white">
            <X className="w-5 h-5" />
          </button>
        </div>
        
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {approvals.length === 0 ? (
            <p className="text-center text-gray-500 py-8">No auto-approval rules configured.</p>
          ) : (
            approvals.map(approval => (
              <div key={approval.id} className="bg-gray-800 border border-gray-600 rounded-lg p-4">
                {editingId === approval.id ? (
                  <div className="space-y-3">
                    <div>
                      <label className="block text-xs text-gray-400 mb-1">Pattern</label>
                      <input
                        value={editForm.pattern}
                        onChange={e => setEditForm(f => ({ ...f, pattern: e.target.value }))}
                        className="w-full bg-gray-700 border border-gray-500 rounded px-3 py-1.5 text-sm font-mono text-white focus:outline-none focus:border-blue-500"
                      />
                    </div>
                    <div className="flex items-center gap-4">
                      <label className="flex items-center gap-2 text-sm text-gray-300 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={editForm.is_regex}
                          onChange={e => setEditForm(f => ({ ...f, is_regex: e.target.checked }))}
                        />
                        Regex
                      </label>
                      <select
                        value={editForm.scope}
                        onChange={e => setEditForm(f => ({ ...f, scope: e.target.value }))}
                        className="bg-gray-700 border border-gray-500 rounded px-2 py-1 text-sm text-white"
                      >
                        <option value="global">All servers</option>
                        <option value="server">This server</option>
                      </select>
                    </div>
                    <div className="flex gap-2 justify-end">
                      <button onClick={() => setEditingId(null)} className="text-gray-400 hover:text-white p-1">
                        <XCircle className="w-4 h-4" />
                      </button>
                      <button onClick={saveEdit} className="text-green-400 hover:text-green-300 p-1">
                        <Save className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-start justify-between">
                    <div>
                      <div className="flex items-center gap-2">
                        {approval.is_regex ? <Regex className="w-3 h-3 text-purple-400" /> : null}
                        <code className="text-sm font-mono text-green-300">{approval.pattern}</code>
                      </div>
                      <div className="flex items-center gap-3 mt-1">
                        <span className="text-xs text-gray-500">{approval.scope === 'server' ? `Server #${approval.server_id}` : 'All servers'}</span>
                        {approval.description && <span className="text-xs text-gray-500">{approval.description}</span>}
                      </div>
                    </div>
                    <div className="flex gap-1">
                      <button onClick={() => startEdit(approval)} className="text-gray-400 hover:text-blue-400 p-1">
                        <Edit2 className="w-4 h-4" />
                      </button>
                      <button onClick={() => handleDelete(approval.id)} className="text-gray-400 hover:text-red-400 p-1">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ))
          )}
        </div>
        
        <div className="px-6 py-4 border-t border-gray-700">
          <button
            onClick={onClose}
            className="w-full bg-gray-700 hover:bg-gray-600 text-white py-2 rounded-lg transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  )
}
