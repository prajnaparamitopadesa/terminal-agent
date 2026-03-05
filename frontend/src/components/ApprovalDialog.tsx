import { useState } from 'react'
import { Sparkles } from 'lucide-react'
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
    setConverting(true)
    try {
      const res = await fetch('/api/convert-to-regex', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ command, requirement: requirement || undefined }),
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
    <Dialog open onOpenChange={(open) => { if (!open) onClose() }}>
      <DialogContent className="w-[500px] max-w-[calc(100vw-2rem)]">
        <DialogHeader>
          <DialogTitle>允许命令</DialogTitle>
        </DialogHeader>

        <div className="mb-4">
          <label className="block text-sm text-gray-400 mb-1">原始命令</label>
          <div className="bg-gray-950 border border-gray-700 rounded-lg px-3 py-2">
            <Code className="text-sm">{command}</Code>
          </div>
        </div>

        <div className="mb-4">
          <label className="block text-sm text-gray-400 mb-1">命令匹配规则</label>
          <Input
            value={pattern}
            onChange={e => setPattern(e.target.value)}
            className="font-mono"
          />
          <label className="flex items-center gap-2 mt-2 cursor-pointer">
            <input
              type="checkbox"
              checked={isRegex}
              onChange={e => setIsRegex(e.target.checked)}
              className="rounded"
            />
            <span className="text-sm text-gray-400">正则表达式</span>
          </label>
        </div>

        <div className="mb-4">
          <label className="block text-sm text-gray-400 mb-1">描述（用于生成正则）</label>
          <div className="flex gap-2">
            <Input
              value={requirement}
              onChange={e => setRequirement(e.target.value)}
              placeholder="例如：匹配任意带参数的 ls 命令"
              className="flex-1"
            />
            <Button
              onClick={convertToRegex}
              disabled={converting}
              variant="secondary"
              className="bg-purple-700 hover:bg-purple-600 text-white flex-shrink-0"
            >
              <Sparkles className="w-3.5 h-3.5" />
              {converting ? '转换中...' : '转为正则'}
            </Button>
          </div>
        </div>

        <div className="mb-6">
          <label className="block text-sm text-gray-400 mb-2">生效范围</label>
          <Select
            value={scope}
            onChange={e => setScope(e.target.value as 'global' | 'server')}
            className="w-auto"
          >
            <option value="global">所有服务器</option>
            <option value="server">仅此服务器</option>
          </Select>
        </div>

        <div className="flex gap-3 justify-end">
          <Button onClick={onClose} variant="ghost">
            取消
          </Button>
          <Button onClick={handleSave} variant="success">
            保存
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
