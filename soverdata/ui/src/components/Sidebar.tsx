import { NavLink } from 'react-router-dom'
import { useWorkspace } from '../context/WorkspaceContext'

const analystItems = [
  { to: '/', label: 'Home', icon: 'H' },
  { to: '/catalog', label: 'Data', icon: 'D' },
  { to: '/pipelines', label: 'Activities', icon: 'A' },
  { to: '/orchestrations', label: 'Flow', icon: 'F' },
  { to: '/runs', label: 'Runs', icon: 'R' },
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
        {analystItems.map(item => (
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
