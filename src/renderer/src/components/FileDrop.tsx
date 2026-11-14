import { FileInput } from 'lucide-react'
import { useEffect, type ReactNode } from 'react'
import { useStore } from '../store'

/** Files from outside Loom (File Explorer, the desktop), not a tab being moved inside it. */
function carriesFiles(e: DragEvent): boolean {
  const types = e.dataTransfer?.types
  return !!types && [...types].includes('Files') && ![...types].includes('loom/tab')
}

/**
 * Files dragged into the window open as tabs and folders become projects, wherever they are
 * dropped, as in an editor. A chat takes drops on itself first (pictures and anything dropped on
 * its message box go into the message) and passes on the rest.
 */
export function useFileDrop(): void {
  useEffect(() => {
    let quiet: ReturnType<typeof setTimeout> | undefined
    const over = (e: DragEvent): void => {
      if (!carriesFiles(e)) return
      // Without this the window would navigate to the dropped file.
      e.preventDefault()
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'
      if (!useStore.getState().fileDrag) useStore.setState({ fileDrag: true })
      // dragleave fires for every element crossed; a pause in dragover is the drag leaving the window.
      clearTimeout(quiet)
      quiet = setTimeout(() => useStore.setState({ fileDrag: false }), 200)
    }
    const drop = (e: DragEvent): void => {
      if (!carriesFiles(e)) return
      e.preventDefault()
      clearTimeout(quiet)
      useStore.setState({ fileDrag: false })
      const paths = [...(e.dataTransfer?.files ?? [])].map((f) => window.loom.pathForFile(f)).filter(Boolean)
      if (paths.length) void useStore.getState().openPaths(paths, { x: e.clientX, y: e.clientY })
    }
    window.addEventListener('dragover', over)
    window.addEventListener('drop', drop)
    return () => {
      clearTimeout(quiet)
      window.removeEventListener('dragover', over)
      window.removeEventListener('drop', drop)
    }
  }, [])
}

/** While files are dragged over the window: what dropping them does. */
export function FileDropHint(): ReactNode {
  const dragging = useStore((s) => s.fileDrag)
  if (!dragging) return null
  return (
    <div className="file-drop-hint" role="status">
      <FileInput /> Drop a file to open it, or a folder to add it as a project
    </div>
  )
}
