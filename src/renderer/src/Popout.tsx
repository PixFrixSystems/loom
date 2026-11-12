import { SquareArrowDownLeft } from 'lucide-react'
import { useEffect, type ReactNode } from 'react'
import { ConfirmHost, ToastHost } from './components/Confirm'
import { ImageViewer } from './components/ImageViewer'
import { ContextMenuHost } from './components/Menu'
import { ProjectMark } from './components/ProjectMark'
import { TabContent } from './components/Workspace'
import { startRemoteAgent } from './remoteAgent'
import { useStore } from './store'

/**
 * A window holding one tab moved out of the main window. Closing it, or the button in its bar,
 * moves the tab back with everything it holds.
 */
export function Popout(): ReactNode {
  const ready = useStore((s) => s.ready)
  const tab = useStore((s) => s.tabs[0])
  const project = useStore((s) => s.projects.find((p) => p.id === tab?.projectId))

  useEffect(() => {
    void useStore.getState().init().then(startRemoteAgent)
    const onKey = (e: KeyboardEvent): void => {
      if ((e.ctrlKey || e.metaKey) && e.code === 'KeyW' && !useStore.getState().confirm) {
        e.preventDefault()
        window.close()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [])

  useEffect(() => {
    if (tab) document.title = project ? `${tab.title}: ${project.name}` : tab.title
  }, [tab?.title, project?.name])

  if (!ready || !tab) return <div className="boot" />

  return (
    <div className="popout">
      <header className="popout-bar thread" data-color={project?.color}>
        <ProjectMark project={project} size={14} />
        {project ? <span className="popout-project">{project.name}</span> : null}
        <span className="popout-title">{tab.title}</span>
        <span className="popout-spacer" />
        <button className="icon-btn topbar-btn" title="Move back to the main window (Ctrl+W)" onClick={() => window.close()}>
          <SquareArrowDownLeft />
        </button>
        <div className="window-controls-space" />
      </header>
      <main className="popout-body">
        <div className="tab-panel">
          <TabContent tab={tab} active visible />
        </div>
      </main>
      <ContextMenuHost />
      <ImageViewer />
      <ConfirmHost />
      <ToastHost />
    </div>
  )
}
