import { useState, useEffect, useRef, useCallback } from 'react'
import { Search, Plus, MessageSquare, Loader2, Globe, Server, Trash2 } from 'lucide-react'
import { Conversation } from '../types'

interface Props {
  serverId: number
  onSelectConversation: (conversation: Conversation) => void
  onUsePrompt: (prompt: string) => void
}

function formatTime(dateStr: string) {
  const date = new Date(dateStr.includes('T') || dateStr.includes('Z') ? dateStr : dateStr + 'Z')
  const now = new Date()
  const diff = now.getTime() - date.getTime()
  const minutes = Math.floor(diff / 60000)
  const hours = Math.floor(diff / 3600000)
  const days = Math.floor(diff / 86400000)

  if (minutes < 1) return '刚刚'
  if (minutes < 60) return `${minutes} 分钟前`
  if (hours < 24) return `${hours} 小时前`
  if (days < 7) return `${days} 天前`
  return date.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' })
}

export default function HistoryPanel({ serverId, onSelectConversation, onUsePrompt }: Props) {
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(false)
  const [hasMore, setHasMore] = useState(true)
  const [initialLoading, setInitialLoading] = useState(true)
  const [showAll, setShowAll] = useState(() => localStorage.getItem('history_show_all') === 'true')
  const [clearConfirm, setClearConfirm] = useState<'server' | 'all' | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const offsetRef = useRef(0)
  const loadingRef = useRef(false)
  const PAGE_SIZE = 20

  // Persist showAll toggle
  useEffect(() => {
    localStorage.setItem('history_show_all', String(showAll))
  }, [showAll])

  const fetchConversations = useCallback(async (reset = false, searchOverride?: string, showAllOverride?: boolean) => {
    if (loadingRef.current) return
    const offset = reset ? 0 : offsetRef.current
    loadingRef.current = true
    setLoading(true)
    try {
      const params = new URLSearchParams({
        limit: String(PAGE_SIZE),
        offset: String(offset),
      })
      const searchVal = searchOverride !== undefined ? searchOverride : search
      if (searchVal.trim()) params.set('search', searchVal.trim())
      const filterAll = showAllOverride !== undefined ? showAllOverride : showAll
      if (!filterAll) params.set('server_id', String(serverId))

      const res = await fetch(`/api/conversations?${params}`)
      const data: Conversation[] = await res.json()

      if (reset) {
        setConversations(data)
        offsetRef.current = data.length
      } else {
        setConversations(prev => [...prev, ...data])
        offsetRef.current = offset + data.length
      }
      setHasMore(data.length === PAGE_SIZE)
    } catch (err) {
      console.error('Failed to fetch conversations', err)
    } finally {
      loadingRef.current = false
      setLoading(false)
      setInitialLoading(false)
    }
  }, [search])

  // Reset and fetch when search or showAll changes
  useEffect(() => {
    offsetRef.current = 0
    setHasMore(true)
    setInitialLoading(true)
    fetchConversations(true, search, showAll)
  }, [search, showAll])

  // Infinite scroll
  const handleScroll = useCallback(() => {
    const el = scrollRef.current
    if (!el || loading || !hasMore) return
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 50) {
      fetchConversations(false)
    }
  }, [loading, hasMore, fetchConversations])

  // Extract first user prompt from conversation title
  const getPrompt = (conv: Conversation) => {
    return conv.title || ''
  }

  const handleClearHistory = async (scope: 'server' | 'all') => {
    const params = new URLSearchParams()
    if (scope === 'server') params.set('server_id', String(serverId))
    try {
      const res = await fetch(`/api/conversations?${params}`, { method: 'DELETE' })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
    } catch (err) {
      console.error('Failed to clear history:', err)
    }
    setClearConfirm(null)
    // Refresh list
    offsetRef.current = 0
    setHasMore(true)
    setInitialLoading(true)
    fetchConversations(true, search, showAll)
  }

  return (
    <div className="flex flex-col h-full">
      {/* Search + toggle */}
      <div className="p-3 border-b border-gray-700 space-y-2">
        <div className="relative">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="搜索历史记录..."
            className="w-full bg-gray-800 border border-gray-600 rounded-lg pl-9 pr-3 py-2 text-white text-sm placeholder-gray-500 focus:outline-none focus:border-blue-500"
          />
        </div>
        <div className="flex items-center justify-between">
          <button
            onClick={() => setShowAll(v => !v)}
            className={`flex items-center gap-1.5 text-xs px-2 py-1 rounded-md transition-colors ${showAll ? 'bg-blue-600/20 text-blue-400' : 'text-gray-400 hover:text-gray-200 hover:bg-gray-800'}`}
            title={showAll ? '当前显示所有服务器的历史记录' : '当前只显示本服务器的历史记录'}
          >
            {showAll ? <Globe className="w-3.5 h-3.5" /> : <Server className="w-3.5 h-3.5" />}
            {showAll ? '所有服务器' : '当前服务器'}
          </button>
          <div className="relative">
            <button
              onClick={() => setClearConfirm(c => c ? null : 'server')}
              className="flex items-center gap-1 text-xs px-2 py-1 rounded-md text-gray-500 hover:text-red-400 hover:bg-gray-800 transition-colors"
              title="清空历史记录"
            >
              <Trash2 className="w-3.5 h-3.5" />
              清空
            </button>
            {clearConfirm && (
              <div className="absolute right-0 top-7 z-10 bg-gray-800 border border-gray-600 rounded-lg shadow-xl p-3 w-52">
                <p className="text-xs text-gray-300 mb-2 font-medium">确认清空历史记录？</p>
                <div className="flex flex-col gap-1.5">
                  <button
                    onClick={() => handleClearHistory('server')}
                    className="text-xs px-2 py-1.5 rounded-md bg-red-900/40 text-red-300 hover:bg-red-900/70 transition-colors text-left"
                  >
                    清空当前服务器记录
                  </button>
                  <button
                    onClick={() => handleClearHistory('all')}
                    className="text-xs px-2 py-1.5 rounded-md bg-red-900/40 text-red-300 hover:bg-red-900/70 transition-colors text-left"
                  >
                    清空所有服务器记录
                  </button>
                  <button
                    onClick={() => setClearConfirm(null)}
                    className="text-xs px-2 py-1.5 rounded-md text-gray-400 hover:bg-gray-700 transition-colors text-left"
                  >
                    取消
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* List */}
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto"
      >
        {initialLoading ? (
          <div className="flex items-center justify-center py-12 text-gray-400">
            <Loader2 className="w-5 h-5 animate-spin mr-2" />
            <span className="text-sm">加载中...</span>
          </div>
        ) : conversations.length === 0 ? (
          <div className="text-center text-gray-500 text-sm mt-8">
            <MessageSquare className="w-8 h-8 mx-auto mb-2 opacity-50" />
            <p>暂无记录</p>
          </div>
        ) : (
          <div className="divide-y divide-gray-800">
            {conversations.map(conv => (
              <div
                key={conv.id}
                className="flex items-start gap-2 px-3 py-3 hover:bg-gray-800/50 cursor-pointer transition-colors group"
              >
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    onUsePrompt(getPrompt(conv))
                  }}
                  title="使用提示词"
                  className="flex-shrink-0 mt-0.5 w-6 h-6 flex items-center justify-center rounded-md text-gray-500 hover:text-blue-400 hover:bg-gray-700 transition-colors opacity-0 group-hover:opacity-100"
                >
                  <Plus className="w-4 h-4" />
                </button>
                <div
                  className="flex-1 min-w-0"
                  onClick={() => onSelectConversation(conv)}
                >
                  <p className="text-sm text-gray-200 truncate">{conv.title}</p>
                  <p className="text-xs text-gray-500 mt-1">{formatTime(conv.updated_at || conv.created_at)}</p>
                </div>
              </div>
            ))}
            {loading && !initialLoading && (
              <div className="flex items-center justify-center py-4 text-gray-400">
                <Loader2 className="w-4 h-4 animate-spin mr-2" />
                <span className="text-xs">加载更多...</span>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
