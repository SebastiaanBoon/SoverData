import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { Sidebar } from './components/Sidebar'
import { WorkspaceProvider } from './context/WorkspaceContext'
import WorkspacePage from './pages/WorkspacePage'
import FilesPage from './pages/FilesPage'
import ConnectionsPage from './pages/ConnectionsPage'
import PipelinesPage from './pages/PipelinesPage'
import PackagesPage from './pages/PackagesPage'
import OrchestrationsPage from './pages/OrchestrationsPage'
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
              <Route path="/files" element={<FilesPage />} />
              <Route path="/connections" element={<ConnectionsPage />} />
              <Route path="/pipelines" element={<PipelinesPage />} />
              <Route path="/packages" element={<PackagesPage />} />
              <Route path="/orchestrations" element={<OrchestrationsPage />} />
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
