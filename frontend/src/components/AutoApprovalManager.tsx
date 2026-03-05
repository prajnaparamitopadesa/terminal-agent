import { useState, useEffect } from 'react'
import { Trash2, Edit2, Save, XCircle, Regex } from 'lucide-react'
import { AutoApproval } from '../types'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from './ui/dialog'
import { Button } from './ui/button'
import { Input } from './ui/input'
import { Select } from './ui/select'
import { Code } from './ui/code'

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
    <Dialog open onOpenChange={(open) => { if (!open) onClose() }}>
      <DialogContent className="w-[600px] max-w-[calc(100vw-2rem)] max-h-[80vh] flex flex-col p-0 gap-0">
        <DialogHeader className="px-6 py-4 border-b border-gray-700 mb-0">
          <DialogTitle>管理自动审批规则</DialogTitle>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {approvals.length === 0 ? (
            <p className="text-center text-gray-500 py-8">暂无自动审批规则。</p>
          ) : (
            approvals.map(approval => (
              <div key={approval.id} className="bg-gray-800 border border-gray-600 rounded-lg p-4">
                {editingId === approval.id ? (
                  <div className="space-y-3">
                    <div>
                      <label className="block text-xs text-gray-400 mb-1">匹配规则</label>
                      <Input
                        value={editForm.pattern}
                        onChange={e => setEditForm(f => ({ ...f, pattern: e.target.value }))}
                        className="font-mono text-sm"
                      />
                    </div>
                    <div className="flex items-center gap-4">
                      <label className="flex items-center gap-2 text-sm text-gray-300 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={editForm.is_regex}
                          onChange={e => setEditForm(f => ({ ...f, is_regex: e.target.checked }))}
                        />
                        Regex（正则表达式）
                      </label>
                      <Select
                        value={editForm.scope}
                        onChange={e => setEditForm(f => ({ ...f, scope: e.target.value }))}
                        className="w-auto text-sm"
                      >
                        <option value="global">所有服务器</option>
                        <option value="server">仅此服务器</option>
                      </Select>
                    </div>
                    <div className="flex gap-2 justify-end">
                      <Button variant="ghost" size="iconSm" onClick={() => setEditingId(null)}>
                        <XCircle className="w-4 h-4" />
                      </Button>
                      <Button variant="ghost" size="iconSm" onClick={saveEdit} className="text-green-400 hover:text-green-300">
                        <Save className="w-4 h-4" />
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-start justify-between">
                    <div>
                      <div className="flex items-center gap-2">
                        {approval.is_regex ? <Regex className="w-3 h-3 text-purple-400" /> : null}
                        <Code className="text-sm">{approval.pattern}</Code>
                      </div>
                      <div className="flex items-center gap-3 mt-1">
                        <span className="text-xs text-gray-500">{approval.scope === 'server' ? `服务器 #${approval.server_id}` : '所有服务器'}</span>
                        {approval.description && <span className="text-xs text-gray-500">{approval.description}</span>}
                      </div>
                    </div>
                    <div className="flex gap-1">
                      <Button variant="ghost" size="iconSm" onClick={() => startEdit(approval)} className="text-gray-400 hover:text-blue-400">
                        <Edit2 className="w-4 h-4" />
                      </Button>
                      <Button variant="ghost" size="iconSm" onClick={() => handleDelete(approval.id)} className="text-gray-400 hover:text-red-400">
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            ))
          )}
        </div>

        <div className="px-6 py-4 border-t border-gray-700">
          <Button onClick={onClose} variant="secondary" className="w-full">
            关闭
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
