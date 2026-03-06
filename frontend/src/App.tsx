import { BrowserRouter, Routes, Route } from 'react-router-dom'
import ServerList from './pages/ServerList'
import Connection from './pages/Connection'
import Help from './pages/Help'

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<ServerList />} />
        <Route path="/connect/:serverId" element={<Connection />} />
        <Route path="/help" element={<Help />} />
      </Routes>
    </BrowserRouter>
  )
}
