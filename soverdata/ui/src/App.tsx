import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { Sidebar } from './components/Sidebar'
import { WorkspaceProvider } from './context/WorkspaceContext'
import WorkspacePage from './pages/WorkspacePage'
import ConnectionsPage from './pages/ConnectionsPage'
import PipelinesPage from './pages/PipelinesPage'
import RunsPage from './pages/RunsPage'
import CatalogPage from './pages/CatalogPage'
import QueryPage from './pages/QueryPage'
import BranchesPage from './pages/BranchesPage'

export default function App() {
  return (
    <WorkspaceProvider>
      <BrowserRouter>
        <div className="layout">
          <Sidebar />
          <main className="main-area">
            <Routes>
              <Route path="/" element={<WorkspacePage />} />
              <Route path="/connections" element={<ConnectionsPage />} />
              <Route path="/pipelines" element={<PipelinesPage />} />
              <Route path="/runs" element={<RunsPage />} />
              <Route path="/catalog" element={<CatalogPage />} />
              <Route path="/query" element={<QueryPage />} />
              <Route path="/branches" element={<BranchesPage />} />
            </Routes>
          </main>
        </div>
      </BrowserRouter>
    </WorkspaceProvider>
  )
}
