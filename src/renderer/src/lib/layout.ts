// The split layout of the work area, as plain functions over the layout tree.

import type { LayoutNode, Tab } from '@shared/types'

/** Files and diffs sit in the lower tab row; chats, terminals and the rest in the top one. */
export function inFileRow(t: Tab): boolean {
  return t.kind === 'file' || t.kind === 'diff'
}
import { uid } from './paths'

export type Pane = Extract<LayoutNode, { kind: 'pane' }>
export type Split = Extract<LayoutNode, { kind: 'split' }>
export type Edge = 'left' | 'right' | 'top' | 'bottom'

export function newPane(tabId: string | null = null): Pane {
  return { kind: 'pane', id: uid(), tabId }
}

/** Every pane, left to right and top to bottom. */
export function panesOf(node: LayoutNode): Pane[] {
  return node.kind === 'pane' ? [node] : node.children.flatMap(panesOf)
}

export function paneById(node: LayoutNode, id: string): Pane | undefined {
  return panesOf(node).find((p) => p.id === id)
}

export function paneOfTab(node: LayoutNode, tabId: string): Pane | undefined {
  return panesOf(node).find((p) => p.tabId === tabId)
}

export function mapPanes(node: LayoutNode, fn: (p: Pane) => Pane): LayoutNode {
  if (node.kind === 'pane') return fn(node)
  return { ...node, children: node.children.map((c) => mapPanes(c, fn)) }
}

export function setPaneTab(node: LayoutNode, paneId: string, tabId: string | null): LayoutNode {
  return mapPanes(node, (p) => (p.id === paneId ? { ...p, tabId } : p))
}

/** Splits with one child become that child; nested splits in the same direction merge. */
function tidy(node: LayoutNode): LayoutNode {
  if (node.kind === 'pane') return node
  const children: LayoutNode[] = []
  const sizes: number[] = []
  node.children.forEach((c, i) => {
    const t = tidy(c)
    if (t.kind === 'split' && t.dir === node.dir) {
      t.children.forEach((cc, j) => {
        children.push(cc)
        sizes.push(node.sizes[i] * t.sizes[j])
      })
    } else {
      children.push(t)
      sizes.push(node.sizes[i])
    }
  })
  if (children.length === 1) return children[0]
  const total = sizes.reduce((a, b) => a + b, 0) || 1
  return { ...node, children, sizes: sizes.map((s) => s / total) }
}

/** Puts `added` beside the pane, on the given edge. Same-direction neighbours share the space. */
export function splitPane(node: LayoutNode, paneId: string, edge: Edge, added: Pane): LayoutNode {
  const dir = edge === 'left' || edge === 'right' ? 'row' : 'column'
  const before = edge === 'left' || edge === 'top'
  const walk = (n: LayoutNode): LayoutNode => {
    if (n.kind === 'pane') {
      if (n.id !== paneId) return n
      return { kind: 'split', id: uid(), dir, sizes: [0.5, 0.5], children: before ? [added, n] : [n, added] }
    }
    const i = n.children.findIndex((c) => c.kind === 'pane' && c.id === paneId)
    if (i >= 0 && n.dir === dir) {
      const half = n.sizes[i] / 2
      const children = [...n.children]
      const sizes = [...n.sizes]
      children.splice(before ? i : i + 1, 0, added)
      sizes.splice(i, 1, half, half)
      return { ...n, children, sizes }
    }
    return { ...n, children: n.children.map(walk) }
  }
  return tidy(walk(node))
}

export function removePane(node: LayoutNode, paneId: string): LayoutNode {
  if (node.kind === 'pane') return node
  const walk = (n: LayoutNode): LayoutNode | null => {
    if (n.kind === 'pane') return n.id === paneId ? null : n
    const kept: LayoutNode[] = []
    const sizes: number[] = []
    n.children.forEach((c, i) => {
      const w = walk(c)
      if (w) {
        kept.push(w)
        sizes.push(n.sizes[i])
      }
    })
    if (!kept.length) return null
    return { ...n, children: kept, sizes }
  }
  return tidy(walk(node) ?? newPane())
}

export function setSizes(node: LayoutNode, splitId: string, sizes: number[]): LayoutNode {
  if (node.kind === 'pane') return node
  if (node.id === splitId) return { ...node, sizes }
  return { ...node, children: node.children.map((c) => setSizes(c, splitId, sizes)) }
}

/** Drops tabs that no longer exist and fixes up anything malformed (e.g. from an older save). */
export function cleanLayout(node: LayoutNode | undefined, tabIds: Set<string>): LayoutNode {
  if (!node) return newPane()
  const seen = new Set<string>()
  const walk = (n: LayoutNode): LayoutNode => {
    if (n.kind === 'pane') {
      const ok = !!n.tabId && tabIds.has(n.tabId) && !seen.has(n.tabId)
      if (ok) seen.add(n.tabId!)
      return { kind: 'pane', id: n.id || uid(), tabId: ok ? n.tabId : null }
    }
    if (!Array.isArray(n.children) || !n.children.length) return newPane()
    const sizes = n.children.map((_, i) => (Number(n.sizes?.[i]) > 0 ? Number(n.sizes[i]) : 1))
    return { kind: 'split', id: n.id || uid(), dir: n.dir === 'column' ? 'column' : 'row', sizes, children: n.children.map(walk) }
  }
  return tidy(walk(node))
}

export type PresetName = 'single' | 'columns' | 'rows' | 'three' | 'grid' | 'main-side'

export const PRESETS: { name: PresetName; label: string; panes: number }[] = [
  { name: 'single', label: 'One pane', panes: 1 },
  { name: 'columns', label: 'Side by side', panes: 2 },
  { name: 'rows', label: 'Top and bottom', panes: 2 },
  { name: 'three', label: 'Three columns', panes: 3 },
  { name: 'main-side', label: 'One large, two stacked', panes: 3 },
  { name: 'grid', label: 'Four squares', panes: 4 }
]

/** A fresh layout of the named shape, filled with the given tabs in reading order. */
export function presetLayout(name: PresetName, tabs: (string | null)[]): LayoutNode {
  const p = (i: number): Pane => newPane(tabs[i] ?? null)
  const split = (dir: 'row' | 'column', children: LayoutNode[], sizes?: number[]): Split => ({
    kind: 'split',
    id: uid(),
    dir,
    sizes: sizes ?? children.map(() => 1 / children.length),
    children
  })
  switch (name) {
    case 'single':
      return p(0)
    case 'columns':
      return split('row', [p(0), p(1)])
    case 'rows':
      return split('column', [p(0), p(1)])
    case 'three':
      return split('row', [p(0), p(1), p(2)])
    case 'main-side':
      return split('row', [p(0), split('column', [p(1), p(2)])], [0.6, 0.4])
    case 'grid':
      return split('column', [split('row', [p(0), p(1)]), split('row', [p(2), p(3)])])
  }
}

/** Which preset a layout matches, if any, so the menu can mark it. */
export function presetOf(node: LayoutNode): PresetName | null {
  if (node.kind === 'pane') return 'single'
  const kids = node.children
  const allPanes = kids.every((c) => c.kind === 'pane')
  if (node.dir === 'row' && allPanes && kids.length === 2) return 'columns'
  if (node.dir === 'column' && allPanes && kids.length === 2) return 'rows'
  if (node.dir === 'row' && allPanes && kids.length === 3) return 'three'
  if (node.dir === 'row' && kids.length === 2 && kids[0].kind === 'pane' && kids[1].kind === 'split' && kids[1].children.length === 2) return 'main-side'
  if (node.dir === 'column' && kids.length === 2 && kids.every((c) => c.kind === 'split' && c.dir === 'row' && c.children.length === 2)) return 'grid'
  return null
}
