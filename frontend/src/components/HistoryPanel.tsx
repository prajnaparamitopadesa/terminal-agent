import { useState, useEffect, useRef, useCallback } from 'react'
import { Search, Plus, MessageSquare, Loader2 } from 'lucide-react'
import { Conversation } from '../types'

interface Props {
  serverId: number
  onSelectConversation: (conversation: Conversation) => void
  onUsePrompt: (prompt: string) => void
}

function formatTime(dateStr: string) {
  const date = new Date(dateStr + 'Z')
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
  const scrollRef = useRef<HTMLDivElement>(null)
  const offsetRef = useRef(0)
  const PAGE_SIZE = 20

  const fetchConversations = useCallback(async (reset = false) => {
    if (loading) return
    const offset = reset ? 0 : offsetRef.current
    setLoading(true)
    try {
      const params = new URLSearchParams({
        limit: String(PAGE_SIZE),
        offset: String(offset),
      })
      if (search.trim()) params.set('search', search.trim())

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
      setLoading(false)
      setInitialLoading(false)
    }
  }, [search, loading])

  // Reset and fetch when search changes
  useEffect(() => {
    offsetRef.current = 0
    setHasMore(true)
    setInitialLoading(true)
    fetchConversations(true)
  }, [search])

  // Initial load
  useEffect(() => {
    fetchConversations(true)
  }, [])

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

  return (
    <div className="flex flex-col h-full">
      {/* Search */}
      <div className="p-3 border-b border-gray-700">
        <div className="relative">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="搜索历史记录..."
            className="w-full bg-gray-800 border border-gray-600 rounded-lg pl-9 pr-3 py-2 text-white text-sm placeholder-gray-500 focus:outline-none focus:border-blue-500"
          />
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
