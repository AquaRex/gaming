import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { AdminProvider } from './lib/AdminContext.jsx'
import Landing from './pages/Landing.jsx'
import GameDetail from './pages/GameDetail.jsx'
import './styles.css'

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <AdminProvider>
      <BrowserRouter basename="/gaming">
        <Routes>
          <Route path="/" element={<Landing />} />
          <Route path="/:slug" element={<GameDetail />} />
        </Routes>
      </BrowserRouter>
    </AdminProvider>
  </React.StrictMode>
)
