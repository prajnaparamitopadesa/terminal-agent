import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { Server } from '../types'
import { Monitor, Plus, Trash2, Terminal, Server as ServerIcon } from 'lucide-react'

export default function ServerList() {
  const [servers, setServers] = useState<Server[]>([])
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({ name: '', username: '', host: '', port: '22', terminal_type: 'bash' })
  const navigate = useNavigate()

  useEffect(() => {
    fetch('/api/servers').then(r => r.json()).then(setServers).catch(console.error)
  }, [])

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault()
    const res = await fetch('/api/servers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...form, port: Number(form.port) || 22 }),
    })
    const server = await res.json()
    setServers(prev => [server, ...prev])
    setShowForm(false)
    setForm({ name: '', username: '', host: '', port: '22', terminal_type: 'bash' })
  }

  const handleDelete = async (id: number) => {
    await fetch(`/api/servers/${id}`, { method: 'DELETE' })
    setServers(prev => prev.filter(s => s.id !== id))
  }

  return (
    <div className="min-h-screen bg-gray-950 p-8">
      <div className="max-w-4xl mx-auto">
        <div className="flex items-center justify-between mb-8">
          <div className="flex items-center gap-3">
            <Terminal className="w-8 h-8 text-green-400" />
            <h1 className="text-2xl font-bold text-white">Terminal Agent</h1>
          </div>
          <button
            onClick={() => setShowForm(!showForm)}
            className="flex items-center gap-2 bg-green-600 hover:bg-green-500 text-white px-4 py-2 rounded-lg transition-colors"
          >
            <Plus className="w-4 h-4" />
            Add Server
          </button>
        </div>

        {showForm && (
          <div className="bg-gray-900 border border-gray-700 rounded-xl p-6 mb-6">
            <h2 className="text-lg font-semibold mb-4 text-gray-200">Add New Server</h2>
            <form onSubmit={handleAdd} className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm text-gray-400 mb-1">Name (optional)</label>
                <input
                  type="text"
                  value={form.name}
                  onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                  placeholder="My Server"
                  className="w-full bg-gray-800 border border-gray-600 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-green-500"
                />
              </div>
              <div>
                <label className="block text-sm text-gray-400 mb-1">Username *</label>
                <input
                  type="text"
                  required
                  value={form.username}
                  onChange={e => setForm(f => ({ ...f, username: e.target.value }))}
                  placeholder="root"
                  className="w-full bg-gray-800 border border-gray-600 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-green-500"
                />
              </div>
              <div>
                <label className="block text-sm text-gray-400 mb-1">Host *</label>
                <input
                  type="text"
                  required
                  value={form.host}
                  onChange={e => setForm(f => ({ ...f, host: e.target.value }))}
                  placeholder="192.168.1.1"
                  className="w-full bg-gray-800 border border-gray-600 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-green-500"
                />
              </div>
              <div>
                <label className="block text-sm text-gray-400 mb-1">Port</label>
                <input
                  type="number"
                  value={form.port}
                  onChange={e => setForm(f => ({ ...f, port: e.target.value }))}
                  placeholder="22"
                  className="w-full bg-gray-800 border border-gray-600 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-green-500"
                />
              </div>
              <div>
                <label className="block text-sm text-gray-400 mb-1">Default Terminal</label>
                <select
                  value={form.terminal_type}
                  onChange={e => setForm(f => ({ ...f, terminal_type: e.target.value }))}
                  className="w-full bg-gray-800 border border-gray-600 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-green-500"
                >
                  <option value="bash">bash</option>
                  <option value="zsh">zsh</option>
                  <option value="sh">sh</option>
                </select>
              </div>
              <div className="col-span-2 flex gap-3 justify-end">
                <button
                  type="button"
                  onClick={() => setShowForm(false)}
                  className="px-4 py-2 text-gray-400 hover:text-white transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="bg-green-600 hover:bg-green-500 text-white px-6 py-2 rounded-lg transition-colors"
                >
                  Add Server
                </button>
              </div>
            </form>
          </div>
        )}

        <div className="grid gap-4">
          {servers.length === 0 ? (
            <div className="text-center py-16 text-gray-500">
              <ServerIcon className="w-12 h-12 mx-auto mb-4 opacity-50" />
              <p>No servers added yet. Click "Add Server" to get started.</p>
            </div>
          ) : (
            servers.map(server => (
              <div key={server.id} className="bg-gray-900 border border-gray-700 rounded-xl p-5 flex items-center justify-between hover:border-gray-500 transition-colors">
                <div className="flex items-center gap-4">
                  <div className="bg-gray-800 rounded-lg p-2">
                    <Monitor className="w-6 h-6 text-green-400" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-white">{server.name || server.host}</h3>
                    <p className="text-sm text-gray-400">
                      {server.username}@{server.host}:{server.port} · {server.terminal_type}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <button
                    onClick={() => navigate(`/connect/${server.id}`, { state: { server } })}
                    className="flex items-center gap-2 bg-blue-600 hover:bg-blue-500 text-white px-4 py-2 rounded-lg transition-colors"
                  >
                    <Terminal className="w-4 h-4" />
                    Connect
                  </button>
                  <button
                    onClick={() => handleDelete(server.id)}
                    className="text-gray-500 hover:text-red-400 p-2 rounded-lg hover:bg-gray-800 transition-colors"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  )
}
