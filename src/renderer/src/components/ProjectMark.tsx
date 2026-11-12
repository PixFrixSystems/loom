import type { ReactNode } from 'react'
import type { Project } from '@shared/types'
import { useStore } from '../store'

/**
 * The project's icon when it has one, otherwise its initial on a small tile tinted with the
 * project's colour.
 */
export function ProjectMark({ project, size = 16 }: { project: Project | null | undefined; size?: number }): ReactNode {
  const icon = useStore((s) => (project ? s.icons[project.id] : null))
  // Tabs and chats outside any project (Settings, Get started) show no tile at all.
  if (!project) return null
  if (icon) {
    return <img className="project-icon" src={icon} width={size} height={size} alt="" draggable={false} />
  }
  const initial = Array.from(project.name.trim())[0]?.toUpperCase() ?? ''
  return (
    <span
      className="project-tile thread"
      data-color={project.color}
      style={{ width: size, height: size, fontSize: Math.max(8, Math.round(size * 0.6)) }}
      aria-hidden="true"
    >
      {initial}
    </span>
  )
}
