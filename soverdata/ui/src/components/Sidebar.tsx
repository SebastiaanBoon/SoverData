import { NavLink } from 'react-router-dom'
import { useWorkspace } from '../context/WorkspaceContext'

const navItems = [
  { to: '/', label: 'Workspace', icon: '⬡' },
  { to: '/files', label: 'Files', icon: '[]' },
  { to: '/connections', label: 'Connections', icon: '⚡' },
  { to: '/pipelines', label: 'Activities', icon: '▶' },
  { to: '/packages', label: 'Packages', icon: '+' },
  { to: '/orchestrations', label: 'Orchestrations', icon: '>>' },
  { to: '/runs', label: 'Runs', icon: '◎' },
  { to: '/catalog', label: 'Catalog', icon: '◫' },
]

export function Sidebar() {
  const { workspace } = useWorkspace()

  return (
    <aside className="sidebar">
      <div className="sidebar-logo">
        <span>Sover</span>Data
      </div>
      {workspace && (
        <div className="sidebar-ws" title={workspace.path}>
          {workspace.name}
        </div>
      )}
      <nav className="sidebar-nav">
        {navItems.map(item => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.to === '/'}
            className={({ isActive }) => isActive ? 'active' : ''}
          >
            <span className="nav-icon">{item.icon}</span>
            {item.label}
          </NavLink>
        ))}
      </nav>
    </aside>
  )
}
