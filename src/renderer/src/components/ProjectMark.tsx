import type { ReactNode } from 'react'
import type { Project } from '@shared/types'
import { useStore } from '../store'

/** The project's icon when it has one, otherwise its colour thread. Place inside a `.thread` element. */
export function ProjectMark({
  project,
  fallback = 'chat-head-thread',
  size = 16
}: {
  project: Project | null | undefined
  fallback?: string
  size?: number
}): ReactNode {
  const icon = useStore((s) => (project ? s.icons[project.id] : null))
  if (project && icon) {
    return <img className="project-icon" src={icon} width={size} height={size} alt="" draggable={false} />
  }
  return <span className={fallback} aria-hidden="true" />
}
