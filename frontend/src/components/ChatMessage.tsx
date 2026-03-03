import { useState, useRef } from 'react'
import { Copy, Send, ChevronDown, Settings } from 'lucide-react'
import { UIMessage, isTextUIPart, isToolOrDynamicToolUIPart } from 'ai'
import ApprovalDialog from './ApprovalDialog'

interface Props {
  message: UIMessage
  sessionId: string
  serverId: number
  onAddSessionApproval: (command: string) => void
}

function extractCodeBlocks(content: string): Array<{ type: 'text' | 'code'; content: string; lang?: string }> {
  const parts: Array<{ type: 'text' | 'code'; content: string; lang?: string }> = []
  const regex = /```(\w*)\n?([\s\S]*?)```/g
  let lastIndex = 0
  let match

  while ((match = regex.exec(content)) !== null) {
    if (match.index > lastIndex) {
      parts.push({ type: 'text', content: content.slice(lastIndex, match.index) })
    }
    parts.push({ type: 'code', content: match[2].trim(), lang: match[1] || 'bash' })
    lastIndex = match.index + match[0].length
  }

  if (lastIndex < content.length) {
    parts.push({ type: 'text', content: content.slice(lastIndex) })
  }

  return parts
}

function CommandBlock({ command, sessionId, serverId, onAddSessionApproval }: {
  command: string
  sessionId: string
  serverId: number
  onAddSessionApproval: (command: string) => void
}) {
  const [showMenu, setShowMenu] = useState(false)
  const [showApprovalDialog, setShowApprovalDialog] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  const copyCommand = () => {
    navigator.clipboard.writeText(command)
  }

  const sendToTerminal = async () => {
    await fetch(`/api/agent/${sessionId}/send-to-terminal`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ command }),
    }).catch(() => {})
  }

  const addGlobalApproval = async (scope: string) => {
    await fetch('/api/auto-approvals', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        pattern: command,
        is_regex: false,
        description: `Auto-approved from chat`,
        scope,
        server_id: scope === 'server' ? serverId : undefined,
      }),
    })
    setShowMenu(false)
  }

  return (
    <div className="relative my-2" ref={menuRef}>
      <div className="bg-gray-950 border border-gray-700 rounded-lg overflow-hidden">
        <div className="flex items-center justify-between px-3 py-1.5 bg-gray-800 border-b border-gray-700">
          <span className="text-xs text-gray-400 font-mono">bash</span>
          <div className="flex items-center gap-1">
            <button
              onClick={copyCommand}
              title="Copy"
              className="text-gray-400 hover:text-white p-1 rounded transition-colors"
            >
              <Copy className="w-3 h-3" />
            </button>
            <button
              onClick={sendToTerminal}
              title="Send to Terminal"
              className="text-gray-400 hover:text-white p-1 rounded transition-colors text-xs flex items-center gap-1"
            >
              <Send className="w-3 h-3" />
            </button>
            <div className="relative">
              <button
                onClick={() => setShowMenu(!showMenu)}
                className="text-gray-400 hover:text-white p-1 rounded transition-colors"
              >
                <ChevronDown className="w-3 h-3" />
              </button>
              {showMenu && (
                <div className="absolute right-0 top-6 bg-gray-800 border border-gray-600 rounded-lg shadow-xl z-50 w-64 py-1">
                  <button
                    onClick={() => { addGlobalApproval('global'); setShowMenu(false) }}
                    className="w-full text-left px-3 py-2 text-sm text-gray-300 hover:bg-gray-700 hover:text-white"
                  >
                    Allow exact command (all servers)
                  </button>
                  <button
                    onClick={() => { addGlobalApproval('server'); setShowMenu(false) }}
                    className="w-full text-left px-3 py-2 text-sm text-gray-300 hover:bg-gray-700 hover:text-white"
                  >
                    Allow exact command (this server only)
                  </button>
                  <button
                    onClick={() => { onAddSessionApproval(command); setShowMenu(false) }}
                    className="w-full text-left px-3 py-2 text-sm text-gray-300 hover:bg-gray-700 hover:text-white"
                  >
                    Allow exact command (this session only)
                  </button>
                  <hr className="border-gray-600 my-1" />
                  <button
                    onClick={() => { setShowApprovalDialog(true); setShowMenu(false) }}
                    className="w-full text-left px-3 py-2 text-sm text-gray-300 hover:bg-gray-700 hover:text-white"
                  >
                    Allow command...
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
        <pre className="p-3 text-sm text-green-300 font-mono overflow-x-auto whitespace-pre-wrap break-all">
          {command}
        </pre>
      </div>
      
      {showApprovalDialog && (
        <ApprovalDialog
          command={command}
          serverId={serverId}
          onClose={() => setShowApprovalDialog(false)}
        />
      )}
    </div>
  )
}

export default function ChatMessage({ message, sessionId, serverId, onAddSessionApproval }: Props) {
  const isUser = message.role === 'user'
  
  const renderContent = (content: string) => {
    const parts = extractCodeBlocks(content)
    return parts.map((part, i) => {
      if (part.type === 'code') {
        return (
          <CommandBlock
            key={i}
            command={part.content}
            sessionId={sessionId}
            serverId={serverId}
            onAddSessionApproval={onAddSessionApproval}
          />
        )
      }
      return (
        <p key={i} className="text-sm text-gray-200 whitespace-pre-wrap leading-relaxed">
          {part.content}
        </p>
      )
    })
  }

  if (isUser) {
    const textContent = message.parts
      .filter(isTextUIPart)
      .map(p => p.text)
      .join('')
    return (
      <div className="flex justify-end">
        <div className="bg-blue-600 text-white rounded-2xl rounded-tr-sm px-4 py-2 max-w-[85%]">
          <p className="text-sm whitespace-pre-wrap">{textContent}</p>
        </div>
      </div>
    )
  }

  const toolParts = message.parts.filter(isToolOrDynamicToolUIPart)
  const textParts = message.parts.filter(isTextUIPart)

  return (
    <div className="space-y-2">
      {toolParts.map((part, i) => {
        const name = 'toolName' in part ? part.toolName : part.type.replace('tool-', '')
        const state = part.state
        const args = 'input' in part ? part.input : undefined
        const result = 'output' in part ? part.output : undefined
        return (
          <div key={i} className="bg-gray-800 border border-gray-600 rounded-lg p-3 text-xs">
            <div className="flex items-center gap-1.5 mb-1 text-blue-400">
              <Settings className="w-3 h-3 animate-spin" style={{ animationPlayState: state === 'output-available' ? 'paused' : 'running' }} />
              <span className="font-mono">{name}</span>
              {args !== undefined && (
                <span className="text-gray-500">({JSON.stringify(args).slice(0, 60)}...)</span>
              )}
            </div>
            {state === 'output-available' && result !== undefined && (
              <pre className="text-gray-300 text-xs overflow-x-auto max-h-32 overflow-y-auto bg-black/30 rounded p-2 mt-1">
                {typeof result === 'string' ? result : JSON.stringify(result, null, 2)}
              </pre>
            )}
          </div>
        )
      })}
      {textParts.length > 0 && (
        <div className="bg-gray-800 rounded-2xl rounded-tl-sm px-4 py-3 max-w-[95%]">
          {textParts.map((part, i) => (
            <div key={i}>{renderContent(part.text)}</div>
          ))}
        </div>
      )}
    </div>
  )
}
