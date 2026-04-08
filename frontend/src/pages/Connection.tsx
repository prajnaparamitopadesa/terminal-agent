import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { useParams, useLocation, useNavigate } from 'react-router-dom'
import { useChat } from '@ai-sdk/react'
import { DefaultChatTransport, isToolOrDynamicToolUIPart, lastAssistantMessageIsCompleteWithApprovalResponses, type UIMessage } from 'ai'
import { ArrowLeft, Terminal as TerminalIcon, MessageSquare, Shield, Plus, GitFork, History, ChevronDown, Send, Square } from 'lucide-react'
import TerminalPanel from '../components/TerminalPanel'
import ChatMessage from '../components/ChatMessage'
import AutoApprovalManager from '../components/AutoApprovalManager'
import HistoryPanel from '../components/HistoryPanel'
import { Server, Conversation, AiModel } from '../types'
import { Button } from '../components/ui/button'
import { PromptInput } from '../components/ai-elements/prompt-input'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../components/ui/dropdown-menu'

const MODEL_STORAGE_KEY = 'selected_ai_model_id'
const MAX_AGENT_EVENTS = 50
const INTERRUPTED_REASON = '未知原因的中断'

interface AgentEvent {
  id: string
  level: 'info' | 'error'
  message: string
  time: string
}

function getToolName(part: any) {
  return 'toolName' in part ? String(part.toolName) : String(part.type).replace('tool-', '')
}

function buildInterruptedToolOutput(toolName: string) {
  if (toolName === 'exec-stream') {
    return { output: INTERRUPTED_REASON, closed: true, exitCode: null }
  }
  return { output: INTERRUPTED_REASON, exitCode: null }
}

function normalizeInterruptedApprovalMessages(messages: UIMessage[]) {
  let interruptedCount = 0
  const normalizedMessages = messages.map(message => {
    let changed = false
    const parts = message.parts.map(part => {
      if (!isToolOrDynamicToolUIPart(part)) return part
      const toolName = getToolName(part)
      if (part.state !== 'approval-requested' || (toolName !== 'exec' && toolName !== 'exec-stream')) {
        return part
      }
      interruptedCount += 1
      changed = true
      return {
        ...part,
        state: 'output-available',
        output: buildInterruptedToolOutput(toolName),
        approval: undefined,
      } as unknown as typeof part
    })
    return changed ? { ...message, parts } : message
  })
  return { messages: normalizedMessages, interruptedCount }
}

function findPendingCommandApproval(messages: UIMessage[]) {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i]
    for (let j = message.parts.length - 1; j >= 0; j -= 1) {
      const part = message.parts[j]
      if (!isToolOrDynamicToolUIPart(part)) continue
      const toolName = getToolName(part)
      if (part.state !== 'approval-requested' || (toolName !== 'exec' && toolName !== 'exec-stream')) {
        continue
      }
      const input = part.input as Record<string, unknown> | undefined
      return {
        approvalId: part.approval.id,
        command: typeof input?.command === 'string' ? input.command : toolName,
      }
    }
  }
  return null
}

function markPendingCommandApprovalAsDenied(messages: UIMessage[], approvalId: string, reason: string) {
  return messages.map(message => {
    let changed = false
    const parts = message.parts.map(part => {
      if (!isToolOrDynamicToolUIPart(part) || part.state !== 'approval-requested' || part.approval.id !== approvalId) {
        return part
      }
      changed = true
      return {
        ...part,
        state: 'output-denied',
        approval: {
          id: approvalId,
          approved: false,
          reason,
        },
      } as unknown as typeof part
    })
    return changed ? { ...message, parts } : message
  })
}

export default function Connection() {
  const { serverId } = useParams()
  const parsedServerId = Number(serverId)
  const serverIdNumber = Number.isFinite(parsedServerId) ? parsedServerId : 0
  const location = useLocation()
  const navigate = useNavigate()
  const [server, setServer] = useState<Server | undefined>(location.state?.server as Server | undefined)
  const [sessionId, setSessionId] = useState(`session_${serverId}_${Date.now()}`)

  const [showApprovalManager, setShowApprovalManager] = useState(false)
  const [sessionApprovals, setSessionApprovals] = useState<string[]>([])
  const [input, setInput] = useState('')
  const [showHistory, setShowHistory] = useState(false)
  const [conversationId, setConversationId] = useState<number | null>(null)
  const [promptHistory, setPromptHistory] = useState<string[]>([])
  const [promptHistoryIndex, setPromptHistoryIndex] = useState(-1)
  const [savedInput, setSavedInput] = useState('')
  const [aiModels, setAiModels] = useState<AiModel[]>([])
  const [selectedModelId, setSelectedModelId] = useState<number | null>(() => {
    const saved = localStorage.getItem(MODEL_STORAGE_KEY)
    const value = saved ? Number(saved) : NaN
    return Number.isFinite(value) ? value : null
  })
  const [chatError, setChatError] = useState<string | null>(null)
  const [agentEvents, setAgentEvents] = useState<AgentEvent[]>([])
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const chatEndRef = useRef<HTMLDivElement>(null)
  const agentWsRef = useRef<WebSocket | null>(null)
  const selectedModelIdRef = useRef<number | null>(null)
  selectedModelIdRef.current = selectedModelId

  const logAgentEvent = useCallback((message: string, level: AgentEvent['level'] = 'info') => {
    const entry: AgentEvent = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      level,
      message,
      time: new Date().toLocaleTimeString('zh-CN', { hour12: false }),
    }
    if (level === 'error') {
      console.error('[agent-event]', message)
    } else {
      console.log('[agent-event]', message)
    }
    setAgentEvents(prev => [...prev.slice(-(MAX_AGENT_EVENTS - 1)), entry])
  }, [])

  const chatTransport = useMemo(() => new DefaultChatTransport({
    api: `/api/agent/${sessionId}/chat`,
    body: () => ({
      serverId: serverIdNumber,
      modelId: selectedModelIdRef.current ?? undefined,
    }),
  }), [sessionId, serverIdNumber])

  useEffect(() => {
    if (!server && serverId) {
      fetch(`/api/servers/${serverId}`)
        .then(r => {
          if (!r.ok) throw new Error(`HTTP ${r.status}`)
          return r.json()
        })
        .then(setServer)
        .catch(err => {
          logAgentEvent(`加载服务器信息失败：${err instanceof Error ? err.message : String(err)}`, 'error')
        })
    }
  }, [logAgentEvent, server, serverId])

  useEffect(() => {
    if (server) {
      document.title = server.name || server.host || '终端'
    }
    return () => { document.title = 'Terminal Agent' }
  }, [server])

  useEffect(() => {
    fetch('/api/ai-models?enabled=true')
      .then(r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return r.json()
      })
      .then((models: AiModel[]) => {
        setAiModels(models)
        setSelectedModelId(prev => {
          if (prev !== null && models.some(model => model.id === prev)) return prev
          const saved = localStorage.getItem(MODEL_STORAGE_KEY)
          const savedId = saved ? Number(saved) : NaN
          if (Number.isFinite(savedId) && models.some(model => model.id === savedId)) {
            return savedId
          }
          return models.length > 0 ? models[0].id : null
        })
        logAgentEvent(`已加载 ${models.length} 个可用模型`)
      })
      .catch(err => {
        const message = err instanceof Error ? err.message : String(err)
        setChatError(`加载模型列表失败：${message}`)
        logAgentEvent(`加载模型列表失败：${message}`, 'error')
      })
  }, [logAgentEvent])

  useEffect(() => {
    if (selectedModelId === null) {
      localStorage.removeItem(MODEL_STORAGE_KEY)
      return
    }
    localStorage.setItem(MODEL_STORAGE_KEY, String(selectedModelId))
  }, [selectedModelId])

  useEffect(() => {
    const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws'
    const ws = new WebSocket(`${protocol}://${window.location.host}/ws/agent/${sessionId}`)
    agentWsRef.current = ws

    ws.onopen = () => {
      logAgentEvent('Agent 事件通道已连接')
    }

    ws.onmessage = evt => {
      const msg = JSON.parse(evt.data)
      if (msg.type === 'user-input-needed') {
        logAgentEvent('Agent 请求用户输入')
      }
    }

    ws.onerror = () => {
      logAgentEvent('Agent 事件通道发生错误', 'error')
    }

    ws.onclose = () => {
      logAgentEvent('Agent 事件通道已关闭')
    }

    return () => ws.close()
  }, [logAgentEvent, sessionId])

  const { messages, sendMessage, status, stop, setMessages, addToolApprovalResponse, error, clearError } = useChat({
    transport: chatTransport,
    sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithApprovalResponses,
    onFinish: () => {
      chatEndRef.current?.scrollIntoView({ behavior: 'smooth' })
      logAgentEvent('Agent 响应完成')
    },
    onError: err => {
      setChatError(err.message)
      logAgentEvent(`大模型调用失败：${err.message}`, 'error')
    },
  })

  useEffect(() => {
    if (error?.message) {
      setChatError(error.message)
    }
  }, [error])

  const prevStatusRef = useRef(status)
  useEffect(() => {
    const wasActive = prevStatusRef.current === 'submitted' || prevStatusRef.current === 'streaming'
    const isNowReady = status === 'ready'
    prevStatusRef.current = status

    if (wasActive && isNowReady && messages.length > 0) {
      const firstUserMsg = messages.find(m => m.role === 'user')
      const title = firstUserMsg?.parts
        ?.filter((p: any) => p.type === 'text')
        .map((p: any) => p.text)
        .join('') || '未命名对话'
      const titleLine = title.split('\n')[0].slice(0, 100)
      const messagesJson = JSON.stringify(messages)

      if (conversationId) {
        fetch(`/api/conversations/${conversationId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title: titleLine, messages: messagesJson }),
        }).catch(err => {
          logAgentEvent(`保存对话失败：${err instanceof Error ? err.message : String(err)}`, 'error')
        })
      } else {
        fetch('/api/conversations', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ server_id: serverIdNumber, title: titleLine, messages: messagesJson }),
        })
          .then(r => {
            if (!r.ok) throw new Error(`HTTP ${r.status}`)
            return r.json()
          })
          .then(data => setConversationId(data.id))
          .catch(err => {
            logAgentEvent(`创建对话失败：${err instanceof Error ? err.message : String(err)}`, 'error')
          })
      }
    }
  }, [conversationId, logAgentEvent, messages, serverIdNumber, status])

  useEffect(() => {
    fetch(`/api/prompts/recent?server_id=${serverId}&limit=50`)
      .then(r => r.json())
      .then((prompts: string[]) => setPromptHistory(prompts))
      .catch(err => {
        logAgentEvent(`加载提示词历史失败：${err instanceof Error ? err.message : String(err)}`, 'error')
      })
  }, [logAgentEvent, serverId])

  const prevChatStatusRef = useRef(status)
  useEffect(() => {
    if (prevChatStatusRef.current !== status) {
      logAgentEvent(`Agent 状态：${prevChatStatusRef.current} → ${status}`)
      prevChatStatusRef.current = status
    }
  }, [logAgentEvent, status])

  const isLoading = status === 'submitted' || status === 'streaming'
  const pendingCommandApproval = useMemo(() => findPendingCommandApproval(messages), [messages])
  const canReplaceApprovalWithMessage = !isLoading || !!pendingCommandApproval

  const handleChatSubmit = async () => {
    if (!input.trim()) return
    const text = input.trim()
    clearError()
    setChatError(null)

    setPromptHistory(prev => {
      const filtered = prev.filter(p => p !== text)
      return [text, ...filtered]
    })
    setPromptHistoryIndex(-1)
    setSavedInput('')
    setInput('')

    if (pendingCommandApproval) {
      const reason = '用户直接发送了新消息，当前审批已终止'
      setMessages(prev => markPendingCommandApprovalAsDenied(prev, pendingCommandApproval.approvalId, reason))
      await stop()
      logAgentEvent(`已跳过命令审批并发送新消息：${pendingCommandApproval.command}`)
    }

    try {
      logAgentEvent(`发送用户消息：${text.slice(0, 60)}`)
      await sendMessage({ text })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setChatError(message)
      logAgentEvent(`发送消息失败：${message}`, 'error')
    }
  }

  const handleToolApproval = useCallback((approvalId: string, approved: boolean) => {
    logAgentEvent(`命令审批已${approved ? '允许' : '拒绝'}`)
    addToolApprovalResponse({ id: approvalId, approved })
  }, [addToolApprovalResponse, logAgentEvent])

  const handleUserInputSubmit = useCallback((requestId: string, inputValue: string) => {
    if (agentWsRef.current?.readyState === WebSocket.OPEN) {
      agentWsRef.current.send(JSON.stringify({
        type: 'user-input',
        id: requestId,
        input: inputValue,
      }))
      logAgentEvent('已通过 WebSocket 提交用户输入')
    } else {
      fetch(`/api/user-inputs/${requestId}/resolve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ input: inputValue }),
      }).catch(err => {
        logAgentEvent(`提交用户输入失败：${err instanceof Error ? err.message : String(err)}`, 'error')
      })
    }
  }, [logAgentEvent])

  const handleAddSessionApproval = (command: string) => {
    setSessionApprovals(prev => [...prev, command])
  }

  const handleNewConversation = () => {
    clearError()
    setChatError(null)
    setMessages([])
    setSessionId(`session_${serverId}_${Date.now()}`)
    setConversationId(null)
    setShowHistory(false)
    logAgentEvent('已创建新对话')
  }

  const handleSelectConversation = async (conv: Conversation) => {
    try {
      const res = await fetch(`/api/conversations/${conv.id}`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      const msgs = JSON.parse(data.messages || '[]') as UIMessage[]
      const normalized = normalizeInterruptedApprovalMessages(msgs)
      clearError()
      setChatError(null)
      setMessages(normalized.messages)
      setConversationId(conv.id)
      setSessionId(`session_${serverId}_${Date.now()}`)
      setShowHistory(false)
      logAgentEvent(`已加载历史对话：${conv.title}`)
      if (normalized.interruptedCount > 0) {
        logAgentEvent(`已将 ${normalized.interruptedCount} 个失效审批转换为中断结果`)
        await fetch(`/api/conversations/${conv.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ messages: JSON.stringify(normalized.messages) }),
        })
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setChatError(`加载对话失败：${message}`)
      logAgentEvent(`加载对话失败：${message}`, 'error')
    }
  }

  const handleUsePrompt = (prompt: string) => {
    setInput(prompt)
    setShowHistory(false)
    requestAnimationFrame(() => textareaRef.current?.focus())
  }

  const handleInputKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (promptHistory.length === 0) return

    const textarea = e.currentTarget
    const { selectionStart, value } = textarea

    if (e.key === 'ArrowUp') {
      const textBeforeCursor = value.slice(0, selectionStart)
      const isFirstLine = !textBeforeCursor.includes('\n')

      if (isFirstLine) {
        e.preventDefault()
        if (promptHistoryIndex === -1) {
          setSavedInput(value)
        }
        const nextIndex = Math.min(promptHistoryIndex + 1, promptHistory.length - 1)
        setPromptHistoryIndex(nextIndex)
        setInput(promptHistory[nextIndex])
        requestAnimationFrame(() => {
          if (textareaRef.current) {
            textareaRef.current.selectionStart = 0
            textareaRef.current.selectionEnd = 0
          }
        })
      }
    } else if (e.key === 'ArrowDown') {
      const textAfterCursor = value.slice(selectionStart)
      const isLastLine = !textAfterCursor.includes('\n')

      if (isLastLine && promptHistoryIndex >= 0) {
        e.preventDefault()
        const nextIndex = promptHistoryIndex - 1
        setPromptHistoryIndex(nextIndex)
        if (nextIndex < 0) {
          setInput(savedInput)
        } else {
          setInput(promptHistory[nextIndex])
        }
        requestAnimationFrame(() => {
          if (textareaRef.current) {
            const len = textareaRef.current.value.length
            textareaRef.current.selectionStart = len
            textareaRef.current.selectionEnd = len
          }
        })
      }
    }
  }

  const handleFork = () => {
    window.open(`/connect/${serverId}`, '_blank')
  }

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const [agentPanelWidth, setAgentPanelWidth] = useState(() => {
    const saved = localStorage.getItem('agent_panel_width')
    return saved ? Number(saved) : 384
  })
  const isDragging = useRef(false)
  const dragStartX = useRef(0)
  const dragStartWidth = useRef(0)

  const onDragStart = useCallback((e: React.MouseEvent) => {
    isDragging.current = true
    dragStartX.current = e.clientX
    dragStartWidth.current = agentPanelWidth
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
  }, [agentPanelWidth])

  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      if (!isDragging.current) return
      const delta = dragStartX.current - e.clientX
      const newWidth = Math.max(280, Math.min(700, dragStartWidth.current + delta))
      setAgentPanelWidth(newWidth)
    }
    const onMouseUp = () => {
      if (!isDragging.current) return
      isDragging.current = false
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', onMouseUp)
    return () => {
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup', onMouseUp)
    }
  }, [])

  useEffect(() => {
    localStorage.setItem('agent_panel_width', String(agentPanelWidth))
  }, [agentPanelWidth])

  return (
    <div className="h-screen flex flex-col bg-gray-950">
      <div className="flex items-center justify-between px-4 py-3 bg-gray-900 border-b border-gray-700 flex-shrink-0">
        <div className="flex items-center gap-3">
          <Button onClick={() => navigate('/')} variant="ghost" size="iconSm">
            <ArrowLeft className="w-5 h-5" />
          </Button>
          <TerminalIcon className="w-5 h-5 text-green-400" />
          <span className="font-semibold">{server?.name || server?.host || '终端'}</span>
          {server && <span className="text-gray-400 text-sm">{server.username}@{server.host}:{server.port}</span>}
          <Button
            onClick={handleFork}
            title="在新窗口中打开"
            variant="ghost"
            size="iconSm"
          >
            <GitFork className="w-4 h-4" />
          </Button>
        </div>
        <Button
          onClick={() => setShowApprovalManager(true)}
          variant="ghost"
          size="sm"
        >
          <Shield className="w-4 h-4" />
          自动审批
        </Button>
      </div>

      <div className="flex-1 flex overflow-hidden">
        <div className="flex-1 min-w-0 relative">
          {server && (
            <TerminalPanel
              server={server}
              sessionId={sessionId}
            />
          )}
        </div>

        <div
          onMouseDown={onDragStart}
          className="w-1 cursor-col-resize bg-gray-700 hover:bg-blue-500 transition-colors flex-shrink-0"
          title="拖动调整宽度"
        />

        <div className="flex flex-col border-l border-gray-700 bg-gray-900 flex-shrink-0" style={{ width: agentPanelWidth }}>
          <div className="flex items-center justify-between px-4 py-3 border-b border-gray-700">
            <div className="flex items-center gap-2">
              <MessageSquare className="w-4 h-4 text-blue-400" />
              <span className="font-medium text-sm">AI 助手</span>
              {aiModels.length > 0 && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="sm" className="h-6 px-2 text-xs text-gray-400 hover:text-gray-200 gap-1">
                      {aiModels.find(m => m.id === selectedModelId)?.display_name || aiModels.find(m => m.id === selectedModelId)?.model_name || '选择模型'}
                      <ChevronDown className="w-3 h-3" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start" className="w-48">
                    {aiModels.map(model => (
                      <DropdownMenuItem
                        key={model.id}
                        onSelect={() => {
                          setSelectedModelId(model.id)
                          logAgentEvent(`已切换模型：${model.display_name || model.model_name}`)
                        }}
                        className={selectedModelId === model.id ? 'text-blue-400' : ''}
                      >
                        <div>
                          <div className="text-xs font-medium">{model.display_name || model.model_name}</div>
                          <div className="text-xs text-gray-500">{model.provider}</div>
                        </div>
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </div>
            <div className="flex items-center gap-1">
              <Button
                onClick={() => setShowHistory(!showHistory)}
                title="历史记录"
                variant="ghost"
                size="iconSm"
                className={showHistory ? 'text-blue-400 bg-gray-800' : ''}
              >
                <History className="w-4 h-4" />
              </Button>
              <Button
                onClick={handleNewConversation}
                title="新对话"
                variant="ghost"
                size="iconSm"
              >
                <Plus className="w-4 h-4" />
              </Button>
            </div>
          </div>

          {showHistory ? (
            <HistoryPanel
              serverId={serverIdNumber}
              onSelectConversation={handleSelectConversation}
              onUsePrompt={handleUsePrompt}
            />
          ) : (
            <>
              <div className="flex-1 overflow-y-auto p-4 space-y-4">
                {messages.length === 0 && (
                  <div className="text-center text-gray-500 text-sm mt-8">
                    <MessageSquare className="w-8 h-8 mx-auto mb-2 opacity-50" />
                    <p>向 AI 助手提问，协助诊断服务器问题。</p>
                  </div>
                )}
                {(chatError || agentEvents.length > 0) && (
                  <div className="space-y-3">
                    {chatError && (
                      <div className="rounded-lg border border-red-700 bg-red-950/60 px-3 py-2 text-sm text-red-200">
                        {chatError}
                      </div>
                    )}
                    <div className="rounded-lg border border-gray-700 bg-gray-950/80">
                      <div className="border-b border-gray-800 px-3 py-2 text-xs font-medium text-gray-300">Agent 事件日志</div>
                      <div className="max-h-32 space-y-1 overflow-y-auto px-3 py-2 text-xs">
                        {agentEvents.length === 0 ? (
                          <div className="text-gray-500">暂无事件</div>
                        ) : (
                          [...agentEvents].reverse().slice(0, 8).map(event => (
                            <div key={event.id} className={event.level === 'error' ? 'text-red-300' : 'text-gray-300'}>
                              <span className="mr-2 text-gray-500">{event.time}</span>
                              <span>{event.message}</span>
                            </div>
                          ))
                        )}
                      </div>
                    </div>
                  </div>
                )}
                {messages.map(msg => (
                  <ChatMessage
                    key={msg.id}
                    message={msg}
                    sessionId={sessionId}
                    serverId={serverIdNumber}
                    onAddSessionApproval={handleAddSessionApproval}
                    onApproveToolCall={handleToolApproval}
                    onUserInputSubmit={handleUserInputSubmit}
                  />
                ))}
                {isLoading && (
                  <div className="flex items-center gap-2 text-gray-400 text-sm">
                    <div className="flex gap-1">
                      <span className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                      <span className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                      <span className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                    </div>
                    <span>思考中...</span>
                  </div>
                )}
                <div ref={chatEndRef} />
              </div>

              <div className="p-3 border-t border-gray-700">
                <PromptInput
                  ref={textareaRef}
                  value={input}
                  onChange={setInput}
                  onSubmit={() => { void handleChatSubmit() }}
                  disabled={!canReplaceApprovalWithMessage}
                  placeholder="向 AI 助手发送消息..."
                  onKeyDown={handleInputKeyDown}
                >
                  {isLoading ? (
                    <Button
                      type="button"
                      size="iconSm"
                      variant="destructive"
                      className="flex-shrink-0 mb-0.5"
                      onClick={stop}
                      title="停止"
                    >
                      <Square className="w-3.5 h-3.5" />
                    </Button>
                  ) : (
                    <Button
                      type="submit"
                      disabled={!input.trim()}
                      size="iconSm"
                      className="flex-shrink-0 mb-0.5"
                      onClick={() => { void handleChatSubmit() }}
                    >
                      <Send className="w-3.5 h-3.5" />
                    </Button>
                  )}
                </PromptInput>
              </div>
            </>
          )}
        </div>
      </div>

      {showApprovalManager && (
        <AutoApprovalManager
          onClose={() => setShowApprovalManager(false)}
          serverId={serverIdNumber}
        />
      )}
    </div>
  )
}
