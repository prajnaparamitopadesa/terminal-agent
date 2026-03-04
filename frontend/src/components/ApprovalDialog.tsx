import { useState } from 'react'
import { X, Sparkles } from 'lucide-react'

interface Props {
  command: string
  serverId: number
  onClose: () => void
}

export default function ApprovalDialog({ command, serverId, onClose }: Props) {
  const [pattern, setPattern] = useState(command)
  const [isRegex, setIsRegex] = useState(false)
  const [requirement, setRequirement] = useState('')
  const [scope, setScope] = useState<'global' | 'server'>('global')
  const [converting, setConverting] = useState(false)

  const convertToRegex = async () => {
    if (!requirement.trim()) return
    setConverting(true)
    try {
      const res = await fetch('/api/convert-to-regex', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ command, requirement }),
      })
      const data = await res.json()
      setPattern(data.regex)
      setIsRegex(true)
    } catch {}
    setConverting(false)
  }

  const handleSave = async () => {
    await fetch('/api/auto-approvals', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        pattern,
        is_regex: isRegex,
        description: requirement || `Pattern for: ${command}`,
        scope,
        server_id: scope === 'server' ? serverId : undefined,
      }),
    })
    onClose()
  }

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50">
      <div className="bg-gray-900 border border-gray-700 rounded-xl w-[500px] p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-semibold text-white">Allow Command</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-white">
            <X className="w-5 h-5" />
          </button>
        </div>
        
        <div className="mb-4">
          <label className="block text-sm text-gray-400 mb-1">Original Command</label>
          <div className="bg-gray-950 border border-gray-700 rounded-lg px-3 py-2 font-mono text-sm text-green-300">
            {command}
          </div>
        </div>
        
        <div className="mb-4">
          <label className="block text-sm text-gray-400 mb-1">Command Pattern</label>
          <input
            value={pattern}
            onChange={e => setPattern(e.target.value)}
            className="w-full bg-gray-800 border border-gray-600 rounded-lg px-3 py-2 font-mono text-sm text-white focus:outline-none focus:border-blue-500"
          />
          <label className="flex items-center gap-2 mt-2 cursor-pointer">
            <input
              type="checkbox"
              checked={isRegex}
              onChange={e => setIsRegex(e.target.checked)}
              className="rounded"
            />
            <span className="text-sm text-gray-400">Regular Expression</span>
          </label>
        </div>
        
        <div className="mb-4">
          <label className="block text-sm text-gray-400 mb-1">Requirement (for regex conversion)</label>
          <div className="flex gap-2">
            <input
              value={requirement}
              onChange={e => setRequirement(e.target.value)}
              placeholder="e.g. Match any ls command with flags"
              className="flex-1 bg-gray-800 border border-gray-600 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500"
            />
            <button
              onClick={convertToRegex}
              disabled={converting || !requirement.trim()}
              className="flex items-center gap-1 bg-purple-700 hover:bg-purple-600 disabled:opacity-50 text-white px-3 py-2 rounded-lg text-sm transition-colors"
            >
              <Sparkles className="w-3.5 h-3.5" />
              {converting ? 'Converting...' : 'To Regex'}
            </button>
          </div>
        </div>
        
        <div className="mb-6">
          <label className="block text-sm text-gray-400 mb-2">Scope</label>
          <div className="flex gap-3">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="radio"
                value="global"
                checked={scope === 'global'}
                onChange={() => setScope('global')}
              />
              <span className="text-sm text-gray-300">All servers</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="radio"
                value="server"
                checked={scope === 'server'}
                onChange={() => setScope('server')}
              />
              <span className="text-sm text-gray-300">This server only</span>
            </label>
          </div>
        </div>
        
        <div className="flex gap-3 justify-end">
          <button onClick={onClose} className="px-4 py-2 text-gray-400 hover:text-white transition-colors">
            Cancel
          </button>
          <button
            onClick={handleSave}
            className="bg-green-600 hover:bg-green-500 text-white px-6 py-2 rounded-lg transition-colors"
          >
            Save
          </button>
        </div>
      </div>
    </div>
  )
}
