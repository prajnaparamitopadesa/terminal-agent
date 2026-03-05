import { useState } from 'react'
import { Copy, Send, ChevronDown, ChevronUp, Settings, Terminal, Check } from 'lucide-react'
import { UIMessage, isTextUIPart, isToolOrDynamicToolUIPart } from 'ai'
import ApprovalDialog from './ApprovalDialog'

interface Props {
  message: UIMessage
  sessionId: string
  serverId: number
  onAddSessionApproval: (command: string) => void
}

/** Strip ANSI escape sequences from text */
function stripAnsi(text: string): string {
  return text
    .replace(/\x1b\[[\x3c-\x3f]*[\x20-\x2f]*[\x40-\x7e]/g, '') // CSI sequences
    .replace(/\x1b\][^\x07]*\x07/g, '')   // OSC sequences
    .replace(/\x1b[()][AB012]/g, '')       // Character set selection
    .replace(/\x1b[>=]/g, '')              // Keypad modes
    .replace(/\x1b[^[\]()>=]/g, '')        // Other 2-char ESC sequences
    .replace(/\r/g, '')
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

  const copyCommand = () => {
    navigator.clipboard.writeText(command)
  }

  const sendToTerminal = async () => {
    try {
      await fetch(`/api/agent/${sessionId}/send-to-terminal`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ command }),
      })
    } catch (err) {
      console.error('Failed to send command to terminal', err)
    }
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
    <div className="relative my-2">
      <div className="bg-gray-950 border border-gray-700 rounded-lg overflow-hidden">
        <div className="flex items-center justify-between px-3 py-1.5 bg-gray-800 border-b border-gray-700">
          <span className="text-xs text-gray-400 font-mono">bash</span>
          <div className="flex items-center gap-1">
            <button
              onClick={copyCommand}
              title="复制"
              className="text-gray-400 hover:text-white p-1 rounded transition-colors"
            >
              <Copy className="w-3 h-3" />
            </button>
            <button
              onClick={sendToTerminal}
              title="发送到终端"
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
                    允许此命令（所有服务器）
                  </button>
                  <button
                    onClick={() => { addGlobalApproval('server'); setShowMenu(false) }}
                    className="w-full text-left px-3 py-2 text-sm text-gray-300 hover:bg-gray-700 hover:text-white"
                  >
                    允许此命令（仅此服务器）
                  </button>
                  <button
                    onClick={() => { onAddSessionApproval(command); setShowMenu(false) }}
                    className="w-full text-left px-3 py-2 text-sm text-gray-300 hover:bg-gray-700 hover:text-white"
                  >
                    允许此命令（仅此会话）
                  </button>
                  <hr className="border-gray-600 my-1" />
                  <button
                    onClick={() => { setShowApprovalDialog(true); setShowMenu(false) }}
                    className="w-full text-left px-3 py-2 text-sm text-gray-300 hover:bg-gray-700 hover:text-white"
                  >
                    允许命令...
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

function RunCommandResult({ command, output, state, error, sessionId, serverId, onAddSessionApproval }: {
  command: string
  output?: string
  state: string
  error?: string
  sessionId: string
  serverId: number
  onAddSessionApproval: (command: string) => void
}) {
  const [expanded, setExpanded] = useState(false)
  const [showMenu, setShowMenu] = useState(false)
  const [showApprovalDialog, setShowApprovalDialog] = useState(false)
  const [copied, setCopied] = useState(false)
  const isLongCommand = command.length > 80
  const displayCommand = isLongCommand && !expanded ? command.slice(0, 80) + '...' : command

  const copyOutput = () => {
    navigator.clipboard.writeText(output || command)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  const sendToTerminal = async () => {
    try {
      await fetch(`/api/agent/${sessionId}/send-to-terminal`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ command }),
      })
    } catch (err) {
      console.error('Failed to send command to terminal', err)
    }
  }

  const addAutoApproval = async (scope: string) => {
    await fetch('/api/auto-approvals', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        pattern: command,
        is_regex: false,
        description: '完全匹配',
        scope,
        server_id: scope === 'server' ? serverId : undefined,
      }),
    })
    setShowMenu(false)
  }

  return (
    <div className="bg-gray-950 border border-gray-700 rounded-lg overflow-hidden my-2">
      {/* Command header */}
      <div className="flex items-center justify-between px-3 py-1.5 bg-gray-800 border-b border-gray-700">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <Terminal className="w-3 h-3 text-green-400 flex-shrink-0" />
          <code className="text-xs text-green-300 font-mono truncate">{displayCommand}</code>
          {isLongCommand && (
            <button onClick={() => setExpanded(!expanded)} className="text-gray-400 hover:text-white flex-shrink-0">
              {expanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
            </button>
          )}
        </div>
        <div className="flex items-center gap-1 flex-shrink-0 ml-2">
          <button onClick={copyOutput} title="复制" className="text-gray-400 hover:text-white p-1 rounded transition-colors">
            {copied ? <Check className="w-3 h-3 text-green-400" /> : <Copy className="w-3 h-3" />}
          </button>
          <button onClick={sendToTerminal} title="发送到终端" className="text-gray-400 hover:text-white p-1 rounded transition-colors">
            <Send className="w-3 h-3" />
          </button>
          <div className="relative">
            <button onClick={() => setShowMenu(!showMenu)} className="text-gray-400 hover:text-white p-1 rounded transition-colors">
              <ChevronDown className="w-3 h-3" />
            </button>
            {showMenu && (
              <div className="absolute right-0 top-6 bg-gray-800 border border-gray-600 rounded-lg shadow-xl z-50 w-64 py-1">
                <button onClick={() => { addAutoApproval('global'); setShowMenu(false) }} className="w-full text-left px-3 py-2 text-sm text-gray-300 hover:bg-gray-700 hover:text-white">
                  允许此命令（所有服务器）
                </button>
                <button onClick={() => { addAutoApproval('server'); setShowMenu(false) }} className="w-full text-left px-3 py-2 text-sm text-gray-300 hover:bg-gray-700 hover:text-white">
                  允许此命令（仅此服务器）
                </button>
                <button onClick={() => { onAddSessionApproval(command); setShowMenu(false) }} className="w-full text-left px-3 py-2 text-sm text-gray-300 hover:bg-gray-700 hover:text-white">
                  允许此命令（仅此会话）
                </button>
                <hr className="border-gray-600 my-1" />
                <button onClick={() => { setShowApprovalDialog(true); setShowMenu(false) }} className="w-full text-left px-3 py-2 text-sm text-gray-300 hover:bg-gray-700 hover:text-white">
                  允许命令...
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
      {/* Result */}
      {state === 'output-available' && output && (
        <pre className="p-3 text-xs text-gray-300 font-mono overflow-x-auto max-h-48 overflow-y-auto whitespace-pre-wrap break-all">
          {stripAnsi(output)}
        </pre>
      )}
      {state === 'output-available' && error && (
        <div className="p-3 text-xs text-red-400 font-mono">{stripAnsi(error)}</div>
      )}
      {state !== 'output-available' && (
        <div className="p-3 flex items-center gap-2 text-xs text-gray-400">
          <div className="w-3 h-3 border border-blue-400 border-t-transparent rounded-full animate-spin" />
          执行中...
        </div>
      )}
      {showApprovalDialog && (
        <ApprovalDialog command={command} serverId={serverId} onClose={() => setShowApprovalDialog(false)} />
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

        // Special rendering for run-command
        if (name === 'run-command') {
          const command = (args as any)?.command || ''
          const output = (result as any)?.result?.output || (result as any)?.output || ''
          const error = (result as any)?.result?.error || (result as any)?.error || ''
          return (
            <RunCommandResult
              key={i}
              command={command}
              output={output}
              state={state}
              error={error}
              sessionId={sessionId}
              serverId={serverId}
              onAddSessionApproval={onAddSessionApproval}
            />
          )
        }

        // Default rendering for other tools
        return (
          <div key={i} className="bg-gray-800 border border-gray-600 rounded-lg p-3 text-xs">
            <div className="flex items-center gap-1.5 mb-1 text-blue-400">
              <Settings className="w-3 h-3 animate-spin" style={{ animationPlayState: state === 'output-available' ? 'paused' : 'running' }} />
              <span className="font-mono">{name}</span>
            </div>
            {state === 'output-available' && result !== undefined && (
              <pre className="text-gray-300 text-xs overflow-x-auto max-h-32 overflow-y-auto bg-black/30 rounded p-2 mt-1">
                {stripAnsi(typeof result === 'string' ? result : JSON.stringify(result, null, 2))}
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
