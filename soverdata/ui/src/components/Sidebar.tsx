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
      <div style={{ marginTop: 'auto' }}>
        <p style={{ padding: '12px 16px 8px', fontSize: 12, color: 'var(--text-muted)' }}>
          <a href="https://cafeboon.com" style={{ color: 'inherit' }}>a Cafe Boon company</a>
        </p>
        <div className="trust-mini">
          <a href="https://cloudsecurityalliance.org/star/registry/cafe-boon" target="_blank" rel="noopener noreferrer">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M12 3 4 6v6c0 4.5 3.2 8 8 9 4.8-1 8-4.5 8-9V6l-8-3Z" />
              <path d="m9 12 2 2 4-4" />
            </svg>
            <span><strong>CSA STAR Level 1</strong><small>Cafe Boon, Cloud Security Alliance registry</small></span>
          </a>
          <a href="https://learn.microsoft.com/en-us/entra/identity-platform/publisher-verification-overview" target="_blank" rel="noopener noreferrer">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M12 3 4 6v6c0 4.5 3.2 8 8 9 4.8-1 8-4.5 8-9V6l-8-3Z" />
              <path d="m9 12 2 2 4-4" />
            </svg>
            <span><strong>Microsoft Verified Publisher</strong><small>Cafe Boon, verified by Microsoft</small></span>
          </a>
          {/* Een volgende kaart komt hier zodra die echt is behaald. */}
        </div>
      </div>
    </aside>
  )
}
