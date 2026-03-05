import { useState, useEffect, useRef, useCallback } from 'react'
import { useParams, useLocation, useNavigate } from 'react-router-dom'
import { useChat } from '@ai-sdk/react'
import { DefaultChatTransport } from 'ai'
import { ArrowLeft, Send, Terminal as TerminalIcon, MessageSquare, Shield, Plus, GitFork, History } from 'lucide-react'
import TerminalPanel from '../components/TerminalPanel'
import ChatMessage from '../components/ChatMessage'
import AutoApprovalManager from '../components/AutoApprovalManager'
import HistoryPanel from '../components/HistoryPanel'
import { Server, Conversation } from '../types'
import { Button } from '../components/ui/button'
import { Textarea } from '../components/ui/textarea'

export default function Connection() {
  const { serverId } = useParams()
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
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const chatEndRef = useRef<HTMLDivElement>(null)
  const agentWsRef = useRef<WebSocket | null>(null)

  // Fetch server if not provided via navigation state (e.g. opened in new window)
  useEffect(() => {
    if (!server && serverId) {
      fetch(`/api/servers/${serverId}`)
        .then(r => r.json())
        .then(setServer)
        .catch(console.error)
    }
  }, [server, serverId])

  // Set document title to server name (requirement 8)
  useEffect(() => {
    if (server) {
      document.title = server.name || server.host || '终端'
    }
    return () => { document.title = 'Terminal Agent' }
  }, [server])
  
  // Agent WebSocket for user input requests
  useEffect(() => {
    const ws = new WebSocket(`ws://${window.location.host}/ws/agent/${sessionId}`)
    agentWsRef.current = ws
    
    ws.onmessage = (evt) => {
      const msg = JSON.parse(evt.data)
      if (msg.type === 'user-input-needed') {
        // User input requests are handled inline in the chat via tool parts
      }
    }
    
    return () => ws.close()
  }, [sessionId])
  
  const { messages, sendMessage, status, setMessages, addToolApprovalResponse } = useChat({
    transport: new DefaultChatTransport({
      api: `/api/agent/${sessionId}/chat`,
      body: { serverId: Number(serverId) },
    }),
    onFinish: () => {
      chatEndRef.current?.scrollIntoView({ behavior: 'smooth' })
    },
  })

  // Save conversation whenever messages change (after AI finishes)
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
        }).catch(console.error)
      } else {
        fetch('/api/conversations', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ server_id: Number(serverId), title: titleLine, messages: messagesJson }),
        })
          .then(r => r.json())
          .then(data => setConversationId(data.id))
          .catch(console.error)
      }
    }
  }, [status, messages, conversationId, serverId])

  // Fetch recent prompts for arrow key navigation
  useEffect(() => {
    fetch(`/api/prompts/recent?server_id=${serverId}&limit=50`)
      .then(r => r.json())
      .then((prompts: string[]) => setPromptHistory(prompts))
      .catch(console.error)
  }, [serverId])

  const isLoading = status === 'submitted' || status === 'streaming'
  
  const handleChatSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!input.trim()) return
    
    // Add to prompt history
    setPromptHistory(prev => {
      const filtered = prev.filter(p => p !== input.trim())
      return [input.trim(), ...filtered]
    })
    setPromptHistoryIndex(-1)
    setSavedInput('')

    sendMessage({ text: input })
    setInput('')
  }
  
  const handleToolApproval = useCallback((approvalId: string, approved: boolean) => {
    addToolApprovalResponse({ id: approvalId, approved })
  }, [addToolApprovalResponse])

  const handleUserInputSubmit = useCallback((requestId: string, inputValue: string) => {
    // Send user input via WebSocket or API
    if (agentWsRef.current?.readyState === WebSocket.OPEN) {
      agentWsRef.current.send(JSON.stringify({
        type: 'user-input',
        id: requestId,
        input: inputValue,
      }))
    } else {
      fetch(`/api/user-inputs/${requestId}/resolve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ input: inputValue }),
      }).catch(console.error)
    }
  }, [])
  
  const handleAddSessionApproval = (command: string) => {
    setSessionApprovals(prev => [...prev, command])
  }

  const handleNewConversation = () => {
    setMessages([])
    setSessionId(`session_${serverId}_${Date.now()}`)
    setConversationId(null)
    setShowHistory(false)
  }

  const handleSelectConversation = async (conv: Conversation) => {
    try {
      const res = await fetch(`/api/conversations/${conv.id}`)
      const data = await res.json()
      const msgs = JSON.parse(data.messages || '[]')
      setMessages(msgs)
      setConversationId(conv.id)
      setSessionId(`session_${serverId}_${Date.now()}`)
      setShowHistory(false)
    } catch (err) {
      console.error('Failed to load conversation', err)
    }
  }

  const handleUsePrompt = (prompt: string) => {
    setInput(prompt)
    setShowHistory(false)
    requestAnimationFrame(() => textareaRef.current?.focus())
  }

  const handleInputKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Submit on Enter (without Shift)
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleChatSubmit(e)
      return
    }

    if (promptHistory.length === 0) return

    const textarea = e.currentTarget
    const { selectionStart, value } = textarea

    if (e.key === 'ArrowUp') {
      // Only trigger at the first line
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
      // Only trigger at the last line
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

  // Resizable agent panel - persist width in localStorage (requirement 10)
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

  // Persist panel width to localStorage whenever it changes
  useEffect(() => {
    localStorage.setItem('agent_panel_width', String(agentPanelWidth))
  }, [agentPanelWidth])

  return (
    <div className="h-screen flex flex-col bg-gray-950">
      {/* Header */}
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
      
      {/* Main content */}
      <div className="flex-1 flex overflow-hidden">
        {/* Terminal panel */}
        <div className="flex-1 min-w-0 relative">
          {server && (
            <TerminalPanel
              server={server}
              sessionId={sessionId}
            />
          )}
        </div>

        {/* Drag handle */}
        <div
          onMouseDown={onDragStart}
          className="w-1 cursor-col-resize bg-gray-700 hover:bg-blue-500 transition-colors flex-shrink-0"
          title="拖动调整宽度"
        />
        
        {/* Chat panel */}
        <div className="flex flex-col border-l border-gray-700 bg-gray-900 flex-shrink-0" style={{ width: agentPanelWidth }}>
          <div className="flex items-center justify-between px-4 py-3 border-b border-gray-700">
            <div className="flex items-center gap-2">
              <MessageSquare className="w-4 h-4 text-blue-400" />
              <span className="font-medium text-sm">AI 助手</span>
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
              serverId={Number(serverId)}
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
              {messages.map(msg => (
                <ChatMessage
                  key={msg.id}
                  message={msg}
                  sessionId={sessionId}
                  serverId={Number(serverId)}
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
          
            {/* Chat input */}
            <form onSubmit={handleChatSubmit} className="p-4 border-t border-gray-700">
              <div className="flex gap-2 items-end">
                <Textarea
                  ref={textareaRef}
                  value={input}
                  onChange={e => setInput(e.target.value)}
                  onKeyDown={handleInputKeyDown}
                  placeholder="向 AI 助手发送消息..."
                  disabled={isLoading}
                  rows={1}
                  className="flex-1 max-h-32 overflow-y-auto"
                  style={{ minHeight: '38px' }}
                  onInput={(e) => {
                    const target = e.target as HTMLTextAreaElement
                    target.style.height = 'auto'
                    target.style.height = Math.min(target.scrollHeight, 128) + 'px'
                  }}
                />
                <Button
                  type="submit"
                  disabled={isLoading || !input.trim()}
                  size="sm"
                  className="flex-shrink-0 h-[38px]"
                >
                  <Send className="w-4 h-4" />
                </Button>
              </div>
            </form>
            </>
            )}
          </div>
        </div>
      
      {showApprovalManager && (
        <AutoApprovalManager
          onClose={() => setShowApprovalManager(false)}
          serverId={Number(serverId)}
        />
      )}
    </div>
  )
}
