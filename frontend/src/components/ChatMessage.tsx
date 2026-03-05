import { useState, useMemo } from 'react'
import { Copy, ChevronDown, ChevronUp, Settings, Terminal, Check } from 'lucide-react'
import { UIMessage, isTextUIPart, isToolOrDynamicToolUIPart } from 'ai'
import { AnsiUp } from 'ansi_up'
import ApprovalDialog from './ApprovalDialog'

interface Props {
  message: UIMessage
  sessionId: string
  serverId: number
  onAddSessionApproval: (command: string) => void
  onApproveToolCall?: (approvalId: string, approved: boolean) => void
  onUserInputSubmit?: (requestId: string, input: string) => void
}

/** Convert ANSI text to safe HTML (new instance per call to avoid state leaks) */
function ansiToHtml(text: string): string {
  const converter = new AnsiUp()
  converter.use_classes = false
  return converter.ansi_to_html(text)
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

function AnsiOutput({ text }: { text: string }) {
  const html = useMemo(() => ansiToHtml(text), [text])
  return (
    <pre
      className="p-3 text-xs font-mono overflow-x-auto max-h-48 overflow-y-auto whitespace-pre-wrap break-all"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
}

function ExecResult({ command, output, state, exitCode, closed, streamId, sessionId, serverId, onAddSessionApproval }: {
  command: string
  output?: string
  state: string
  exitCode?: number | null
  closed?: boolean
  streamId?: string
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

  const hasOutput = state === 'output-available' && output

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
      {hasOutput && (
        <AnsiOutput text={output} />
      )}
      {state === 'output-available' && closed !== undefined && (
        <div className="px-3 py-1 text-xs text-gray-500 border-t border-gray-800 flex items-center gap-2">
          {closed ? (
            <span>退出码: {exitCode ?? 'N/A'}</span>
          ) : streamId ? (
            <span className="text-yellow-400">⏳ 流仍然打开 (streamId: {streamId.slice(0, 12)}...)</span>
          ) : null}
        </div>
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

export default function ChatMessage({ message, sessionId, serverId, onAddSessionApproval, onApproveToolCall, onUserInputSubmit }: Props) {
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
        const approval = 'approval' in part ? part.approval : undefined

        // Handle approval-requested state (AI SDK built-in approval)
        if (state === 'approval-requested' && approval) {
          const command = (args as any)?.command || JSON.stringify(args)
          return (
            <ToolApprovalUI
              key={i}
              toolName={String(name)}
              command={command}
              approvalId={approval.id}
              onApprove={onApproveToolCall}
              serverId={serverId}
              onAddSessionApproval={onAddSessionApproval}
            />
          )
        }

        // Handle output-denied state
        if (state === 'output-denied') {
          const command = (args as any)?.command || JSON.stringify(args)
          return (
            <div key={i} className="bg-red-950 border border-red-700 rounded-lg p-3 my-2 text-xs">
              <div className="flex items-center gap-1.5 mb-1 text-red-400">
                <Terminal className="w-3 h-3" />
                <span className="font-mono">{String(name)}</span>
                <span className="text-red-300">— 已拒绝</span>
              </div>
              <code className="text-xs text-red-200 block bg-black/30 rounded px-2 py-1">{command}</code>
            </div>
          )
        }

        // Special rendering for exec tool
        if (name === 'exec') {
          const command = (args as any)?.command || ''
          const output = (result as any)?.output || ''
          const exitCode = (result as any)?.exitCode
          const closed = (result as any)?.closed
          const streamId = (result as any)?.streamId
          return (
            <ExecResult
              key={i}
              command={command}
              output={output}
              state={state}
              exitCode={exitCode}
              closed={closed}
              streamId={streamId}
              sessionId={sessionId}
              serverId={serverId}
              onAddSessionApproval={onAddSessionApproval}
            />
          )
        }

        // Render send-input, wait-output, send-password with output
        if (name === 'send-input' || name === 'wait-output' || name === 'send-password') {
          const output = (result as any)?.output || ''
          const toolLabel = name === 'send-password' ? '发送密码' : name === 'send-input' ? '发送输入' : '等待输出'
          return (
            <div key={i} className="bg-gray-800 border border-gray-600 rounded-lg overflow-hidden text-xs my-2">
              <div className="flex items-center gap-1.5 px-3 py-1.5 text-blue-400 border-b border-gray-700">
                <Settings className="w-3 h-3" style={{ animationPlayState: state === 'output-available' ? 'paused' : 'running' }} />
                <span className="font-mono">{toolLabel}</span>
                {state !== 'output-available' && <span className="text-gray-400">处理中...</span>}
              </div>
              {state === 'output-available' && output && (
                <AnsiOutput text={output} />
              )}
            </div>
          )
        }

        // Render request-user-input
        if (name === 'request-user-input') {
          const prompt = (args as any)?.prompt || '请输入'
          const isPassword = (args as any)?.isPassword || false
          const status = (result as any)?.status
          return (
            <UserInputTool
              key={i}
              prompt={prompt}
              isPassword={isPassword}
              state={state}
              status={status}
              streamId={(args as any)?.streamId}
              output={(result as any)?.output}
              onSubmit={onUserInputSubmit}
            />
          )
        }

        // Default rendering for other tools
        return (
          <div key={i} className="bg-gray-800 border border-gray-600 rounded-lg p-3 text-xs">
            <div className="flex items-center gap-1.5 mb-1 text-blue-400">
              <Settings className="w-3 h-3 animate-spin" style={{ animationPlayState: state === 'output-available' ? 'paused' : 'running' }} />
              <span className="font-mono">{String(name)}</span>
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

function ToolApprovalUI({ toolName, command, approvalId, onApprove, serverId, onAddSessionApproval }: {
  toolName: string
  command: string
  approvalId: string
  onApprove?: (approvalId: string, approved: boolean) => void
  serverId: number
  onAddSessionApproval: (command: string) => void
}) {
  const [showMenu, setShowMenu] = useState(false)

  return (
    <div className="bg-yellow-900/40 border border-yellow-700 rounded-lg p-3 my-2">
      <p className="text-yellow-300 text-xs font-medium mb-1">⚠️ {toolName} 需要审批</p>
      <code className="text-xs text-yellow-200 block bg-black/30 rounded px-2 py-1 mb-2 break-all">
        {command}
      </code>
      <div className="flex gap-2">
        <div className="flex-1 flex relative">
          <button
            onClick={() => onApprove?.(approvalId, true)}
            className="flex-1 flex items-center justify-center gap-1 bg-green-700 hover:bg-green-600 text-white text-xs py-1 rounded-l"
          >
            ✓ 允许
          </button>
          <button
            onClick={() => setShowMenu(!showMenu)}
            className="bg-green-700 hover:bg-green-600 text-white text-xs py-1 px-1.5 rounded-r border-l border-green-600"
          >
            <ChevronDown className="w-3 h-3" />
          </button>
          {showMenu && (
            <div className="absolute left-0 bottom-full mb-1 bg-gray-800 border border-gray-600 rounded-lg shadow-xl z-50 w-64 py-1">
              <button
                onClick={async () => {
                  await fetch('/api/auto-approvals', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ pattern: command, is_regex: false, scope: 'global', description: '完全匹配' }),
                  })
                  setShowMenu(false)
                  onApprove?.(approvalId, true)
                }}
                className="w-full text-left px-3 py-2 text-sm text-gray-300 hover:bg-gray-700 hover:text-white"
              >
                允许完全匹配的命令
              </button>
              <button
                onClick={async () => {
                  await fetch('/api/auto-approvals', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ pattern: command, is_regex: false, scope: 'server', server_id: serverId, description: '完全匹配（仅此服务器）' }),
                  })
                  setShowMenu(false)
                  onApprove?.(approvalId, true)
                }}
                className="w-full text-left px-3 py-2 text-sm text-gray-300 hover:bg-gray-700 hover:text-white"
              >
                允许完全匹配的命令（仅此服务器）
              </button>
              <button
                onClick={() => {
                  onAddSessionApproval(command)
                  setShowMenu(false)
                  onApprove?.(approvalId, true)
                }}
                className="w-full text-left px-3 py-2 text-sm text-gray-300 hover:bg-gray-700 hover:text-white"
              >
                允许完全匹配的命令（仅本次会话）
              </button>
            </div>
          )}
        </div>
        <button
          onClick={() => onApprove?.(approvalId, false)}
          className="flex-1 flex items-center justify-center gap-1 bg-red-700 hover:bg-red-600 text-white text-xs py-1 rounded"
        >
          ✗ 拒绝
        </button>
      </div>
    </div>
  )
}

function UserInputTool({ prompt, isPassword, state, status, streamId, output, onSubmit }: {
  prompt: string
  isPassword: boolean
  state: string
  status?: string
  streamId?: string
  output?: string
  onSubmit?: (requestId: string, input: string) => void
}) {
  const [inputValue, setInputValue] = useState('')

  if (state === 'output-available' && status === 'done') {
    return (
      <div className="bg-gray-800 border border-gray-600 rounded-lg overflow-hidden text-xs my-2">
        <div className="flex items-center gap-1.5 px-3 py-1.5 text-blue-400 border-b border-gray-700">
          <Settings className="w-3 h-3" />
          <span className="font-mono">用户输入</span>
          <span className="text-green-400">✓ 已提交</span>
        </div>
        {output && <AnsiOutput text={output} />}
      </div>
    )
  }

  if (state === 'output-available' && status === 'waiting-for-user-input') {
    return (
      <div className="bg-blue-900/40 border border-blue-700 rounded-lg p-3 my-2">
        <p className="text-blue-300 text-xs font-medium mb-2">🔑 {prompt}</p>
        <div className="flex gap-2">
          <input
            type={isPassword ? 'password' : 'text'}
            value={inputValue}
            onChange={e => setInputValue(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && inputValue && streamId) {
                onSubmit?.(streamId, inputValue)
                setInputValue('')
              }
            }}
            placeholder={isPassword ? '输入密码...' : '输入内容...'}
            className="flex-1 bg-gray-800 border border-gray-600 rounded px-2 py-1 text-white text-xs focus:outline-none focus:border-blue-500"
          />
          <button
            onClick={() => {
              if (inputValue && streamId) {
                onSubmit?.(streamId, inputValue)
                setInputValue('')
              }
            }}
            className="bg-blue-600 hover:bg-blue-500 text-white px-3 py-1 rounded text-xs"
          >
            发送
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="bg-gray-800 border border-gray-600 rounded-lg p-3 text-xs my-2">
      <div className="flex items-center gap-1.5 text-blue-400">
        <Settings className="w-3 h-3 animate-spin" />
        <span className="font-mono">等待用户输入...</span>
      </div>
    </div>
  )
}
