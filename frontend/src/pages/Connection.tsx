import { useState, useEffect, useRef, useCallback } from 'react'
import { useParams, useLocation, useNavigate } from 'react-router-dom'
import { useChat } from '@ai-sdk/react'
import { DefaultChatTransport } from 'ai'
import { ArrowLeft, Send, Terminal as TerminalIcon, MessageSquare, CheckCircle, XCircle, Shield } from 'lucide-react'
import TerminalPanel from '../components/TerminalPanel'
import ChatMessage from '../components/ChatMessage'
import AutoApprovalManager from '../components/AutoApprovalManager'
import { Server, ApprovalRequest } from '../types'

export default function Connection() {
  const { serverId } = useParams()
  const location = useLocation()
  const navigate = useNavigate()
  const [server, setServer] = useState<Server | undefined>(location.state?.server as Server | undefined)
  const sessionId = useRef(`session_${serverId}_${Date.now()}`).current
  
  const [pendingApproval, setPendingApproval] = useState<ApprovalRequest | null>(null)
  const [showApprovalManager, setShowApprovalManager] = useState(false)
  const [sessionApprovals, setSessionApprovals] = useState<string[]>([])
  const [sudoPassword, setSudoPassword] = useState('')
  const [input, setInput] = useState('')
  const chatEndRef = useRef<HTMLDivElement>(null)
  const agentWsRef = useRef<WebSocket | null>(null)
  const firstMessageRef = useRef(false)
  const getScreenRef = useRef<() => string>(() => '')

  // Fetch server if not provided via navigation state (e.g. opened in new window)
  useEffect(() => {
    if (!server && serverId) {
      fetch(`/api/servers/${serverId}`)
        .then(r => r.json())
        .then(setServer)
        .catch(console.error)
    }
  }, [server, serverId])

  // Load saved password from localStorage
  useEffect(() => {
    if (server?.id) {
      const saved = localStorage.getItem(`saved_pwd_${server.id}`)
      if (saved) setSudoPassword(saved)
    }
  }, [server?.id])
  
  // Agent WebSocket for approvals
  useEffect(() => {
    const ws = new WebSocket(`ws://localhost:3001/ws/agent/${sessionId}`)
    agentWsRef.current = ws
    
    ws.onmessage = (evt) => {
      const msg = JSON.parse(evt.data)
      if (msg.type === 'approval_needed') {
        setPendingApproval({ id: msg.id, command: msg.command })
      }
    }
    
    return () => ws.close()
  }, [sessionId])
  
  const { messages, sendMessage, status } = useChat({
    transport: new DefaultChatTransport({
      api: `/api/agent/${sessionId}/chat`,
      body: { serverId: Number(serverId), sessionApprovals, sudoPassword },
    }),
    onFinish: () => {
      chatEndRef.current?.scrollIntoView({ behavior: 'smooth' })
    },
  })

  const isLoading = status === 'submitted' || status === 'streaming'
  
  const handleChatSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!input.trim()) return
    
    let text = input
    if (!firstMessageRef.current) {
      firstMessageRef.current = true
      const screenContent = getScreenRef.current()
      if (screenContent) {
        text = `当前终端屏幕内容:\n\`\`\`\n${screenContent}\n\`\`\`\n\n用户请求: ${input}`
      }
    }
    
    sendMessage({ text })
    setInput('')
  }
  
  const handleApprove = (approved: boolean) => {
    if (!pendingApproval) return
    if (agentWsRef.current?.readyState === WebSocket.OPEN) {
      agentWsRef.current.send(JSON.stringify({
        type: approved ? 'approve' : 'reject',
        id: pendingApproval.id,
      }))
    }
    setPendingApproval(null)
  }
  
  const handleAddSessionApproval = (command: string) => {
    setSessionApprovals(prev => [...prev, command])
  }
  
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  // Resizable agent panel
  const [agentPanelWidth, setAgentPanelWidth] = useState(384) // default 384px
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

  return (
    <div className="h-screen flex flex-col bg-gray-950">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 bg-gray-900 border-b border-gray-700 flex-shrink-0">
        <div className="flex items-center gap-3">
          <button onClick={() => navigate('/')} className="text-gray-400 hover:text-white transition-colors">
            <ArrowLeft className="w-5 h-5" />
          </button>
          <TerminalIcon className="w-5 h-5 text-green-400" />
          <span className="font-semibold">{server?.name || server?.host || '终端'}</span>
          {server && <span className="text-gray-400 text-sm">{server.username}@{server.host}:{server.port}</span>}
        </div>
        <button
          onClick={() => setShowApprovalManager(true)}
          className="flex items-center gap-2 text-gray-400 hover:text-white px-3 py-1 rounded-lg hover:bg-gray-800 transition-colors text-sm"
        >
          <Shield className="w-4 h-4" />
          自动审批
        </button>
      </div>
      
      {/* Main content */}
      <div className="flex-1 flex overflow-hidden">
        {/* Terminal panel */}
        <div className="flex-1 min-w-0 relative">
          {server && (
            <TerminalPanel
              server={server}
              sessionId={sessionId}
              onScreenContent={(getter) => { getScreenRef.current = getter }}
              onPasswordSaved={(pwd) => setSudoPassword(pwd)}
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
          <div className="flex items-center gap-2 px-4 py-3 border-b border-gray-700">
            <MessageSquare className="w-4 h-4 text-blue-400" />
            <span className="font-medium text-sm">AI 助手</span>
          </div>
          
          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            {messages.length === 0 && (
              <div className="text-center text-gray-500 text-sm mt-8">
                <MessageSquare className="w-8 h-8 mx-auto mb-2 opacity-50" />
                <p>向 AI 助手提问，协助诊断服务器问题。</p>
                <p className="mt-1 text-xs">首次发送消息时，当前终端屏幕内容将自动附上。</p>
              </div>
            )}
            {messages.map(msg => (
              <ChatMessage
                key={msg.id}
                message={msg}
                sessionId={sessionId}
                serverId={Number(serverId)}
                onAddSessionApproval={handleAddSessionApproval}
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
          
          {/* Approval notification */}
          {pendingApproval && (
            <div className="mx-4 mb-3 bg-yellow-900/40 border border-yellow-700 rounded-lg p-3">
              <p className="text-yellow-300 text-xs font-medium mb-1">⚠️ 命令需要审批</p>
              <code className="text-xs text-yellow-200 block bg-black/30 rounded px-2 py-1 mb-2 break-all">
                {pendingApproval.command}
              </code>
              <div className="flex gap-2">
                <button
                  onClick={() => handleApprove(true)}
                  className="flex-1 flex items-center justify-center gap-1 bg-green-700 hover:bg-green-600 text-white text-xs py-1 rounded"
                >
                  <CheckCircle className="w-3 h-3" /> 允许
                </button>
                <button
                  onClick={() => handleApprove(false)}
                  className="flex-1 flex items-center justify-center gap-1 bg-red-700 hover:bg-red-600 text-white text-xs py-1 rounded"
                >
                  <XCircle className="w-3 h-3" /> 拒绝
                </button>
              </div>
            </div>
          )}
          
          {/* Chat input */}
          <form onSubmit={handleChatSubmit} className="p-4 border-t border-gray-700">
            <div className="flex gap-2">
              <input
                value={input}
                onChange={e => setInput(e.target.value)}
                placeholder="向 AI 助手发送消息..."
                disabled={isLoading}
                className="flex-1 bg-gray-800 border border-gray-600 rounded-lg px-3 py-2 text-white text-sm placeholder-gray-500 focus:outline-none focus:border-blue-500 disabled:opacity-50"
              />
              <button
                type="submit"
                disabled={isLoading || !input.trim()}
                className="bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white px-3 py-2 rounded-lg transition-colors"
              >
                <Send className="w-4 h-4" />
              </button>
            </div>
          </form>
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
