import { useEffect, useRef, useState, useCallback } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import '@xterm/xterm/css/xterm.css'
import { Server } from '../types'
import { Wifi, WifiOff, Lock } from 'lucide-react'

interface Props {
  server: Server
  sessionId: string
  onScreenContent: (getter: () => string) => void
  onPasswordSaved?: (password: string) => void
}

export default function TerminalPanel({ server, sessionId, onScreenContent, onPasswordSaved }: Props) {
  const termRef = useRef<HTMLDivElement>(null)
  const xtermRef = useRef<Terminal | null>(null)
  const wsRef = useRef<WebSocket | null>(null)
  const fitAddonRef = useRef<FitAddon | null>(null)
  const [connected, setConnected] = useState(false)
  const [connecting, setConnecting] = useState(false)
  const storageKey = `saved_pwd_${server?.id}`
  const savedPwd = server?.id ? (localStorage.getItem(storageKey) || '') : ''
  const [password, setPassword] = useState(savedPwd)
  const [rememberPassword, setRememberPassword] = useState(!!savedPwd)
  const [showPasswordInput, setShowPasswordInput] = useState(true)
  const screenBufferRef = useRef<string>('')

  const getScreen = useCallback(() => screenBufferRef.current.slice(-3000), [])

  useEffect(() => {
    onScreenContent(getScreen)
  }, [onScreenContent, getScreen])

  useEffect(() => {
    if (!termRef.current) return

    const term = new Terminal({
      theme: {
        background: '#030712',
        foreground: '#e5e7eb',
        cursor: '#4ade80',
        selectionBackground: '#374151',
      },
      fontFamily: 'Menlo, Monaco, "Courier New", monospace',
      fontSize: 14,
      cursorBlink: true,
    })

    const fitAddon = new FitAddon()
    const webLinksAddon = new WebLinksAddon()
    term.loadAddon(fitAddon)
    term.loadAddon(webLinksAddon)
    term.open(termRef.current)
    fitAddon.fit()

    xtermRef.current = term
    fitAddonRef.current = fitAddon

    term.onData((data) => {
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ type: 'input', data }))
      }
    })

    const resizeObserver = new ResizeObserver(() => {
      fitAddon.fit()
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ 
          type: 'resize', 
          cols: term.cols, 
          rows: term.rows 
        }))
      }
    })
    resizeObserver.observe(termRef.current)

    return () => {
      resizeObserver.disconnect()
      term.dispose()
      wsRef.current?.close()
    }
  }, [])

  const connect = (pwd: string) => {
    if (!server) return
    setConnecting(true)
    setShowPasswordInput(false)

    if (rememberPassword) {
      localStorage.setItem(storageKey, pwd)
      onPasswordSaved?.(pwd)
    } else {
      localStorage.removeItem(storageKey)
    }

    const ws = new WebSocket(`ws://localhost:3001/ws/terminal/${sessionId}`)
    wsRef.current = ws

    ws.onopen = () => {
      ws.send(JSON.stringify({
        type: 'connect',
        host: server.host,
        port: server.port || 22,
        username: server.username,
        password: pwd,
        serverId: server.id,
      }))
    }

    ws.onmessage = (evt) => {
      const msg = JSON.parse(evt.data)
      if (msg.type === 'data') {
        xtermRef.current?.write(msg.data)
        screenBufferRef.current += msg.data
        if (screenBufferRef.current.length > 50000) {
          screenBufferRef.current = screenBufferRef.current.slice(-30000)
        }
        if (!connected) {
          setConnected(true)
          setConnecting(false)
        }
      } else if (msg.type === 'error') {
        xtermRef.current?.write(`\r\n\x1b[31m错误: ${msg.error}\x1b[0m\r\n`)
        setConnecting(false)
        setShowPasswordInput(true)
      } else if (msg.type === 'close') {
        xtermRef.current?.write('\r\n\x1b[33m连接已关闭。\x1b[0m\r\n')
        setConnected(false)
      }
    }

    ws.onerror = () => {
      setConnecting(false)
      setShowPasswordInput(true)
    }
  }

  return (
    <div className="h-full flex flex-col bg-gray-950">
      <div className="flex items-center justify-between px-3 py-2 bg-gray-900 border-b border-gray-700 flex-shrink-0">
        <span className="text-xs text-gray-400 font-mono">{server?.username}@{server?.host}</span>
        <div className="flex items-center gap-1.5">
          {connected ? (
            <><Wifi className="w-3 h-3 text-green-400" /><span className="text-xs text-green-400">已连接</span></>
          ) : connecting ? (
            <><div className="w-3 h-3 border border-yellow-400 border-t-transparent rounded-full animate-spin" /><span className="text-xs text-yellow-400">连接中...</span></>
          ) : (
            <><WifiOff className="w-3 h-3 text-red-400" /><span className="text-xs text-red-400">未连接</span></>
          )}
        </div>
      </div>

      {showPasswordInput && !connected && (
        <div className="absolute inset-0 flex items-center justify-center bg-gray-950/90 z-10">
          <div className="bg-gray-900 border border-gray-700 rounded-xl p-6 w-80">
            <div className="flex items-center gap-2 mb-4">
              <Lock className="w-5 h-5 text-blue-400" />
              <h3 className="font-semibold">SSH 连接</h3>
            </div>
            <p className="text-sm text-gray-400 mb-4">{server?.username}@{server?.host}:{server?.port}</p>
            <div className="mb-3">
              <label className="block text-sm text-gray-400 mb-1">密码</label>
              <input
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && connect(password)}
                placeholder="SSH 密码"
                autoFocus
                className="w-full bg-gray-800 border border-gray-600 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-blue-500"
              />
            </div>
            <div className="mb-4">
              <label className="flex items-center gap-2 cursor-pointer text-sm text-gray-400">
                <input
                  type="checkbox"
                  checked={rememberPassword}
                  onChange={e => setRememberPassword(e.target.checked)}
                  className="rounded"
                />
                记住密码（用于 sudo 自动输入）
              </label>
            </div>
            <button
              onClick={() => connect(password)}
              disabled={connecting}
              className="w-full bg-blue-600 hover:bg-blue-500 text-white py-2 rounded-lg transition-colors disabled:opacity-50"
            >
              {connecting ? '连接中...' : '连接'}
            </button>
          </div>
        </div>
      )}

      <div ref={termRef} className="flex-1 p-1" />
    </div>
  )
}
