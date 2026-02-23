import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import ForceGraph2D from 'react-force-graph-2d'
import { fetchIntersection } from './api'

type FilterId = 'public' | 'sink' | 'vuln'

const FILTERS: { id: FilterId; label: string }[] = [
  { id: 'public', label: 'From public services' },
  { id: 'sink', label: 'To RDS/SQL sinks' },
  { id: 'vuln', label: 'With vulnerability' },
]

const FILTER_COLORS: Record<FilterId, string> = {
  public: '#22c55e',
  sink: '#3b82f6',
  vuln: '#ef4444',
}

const DEFAULT_LINK_COLOR = '#64748b'

type GraphNode = { id: string; group: FilterId[] }
type GraphLink = { source: string; target: string }

export default function App() {
  const [selected, setSelected] = useState<Set<FilterId>>(new Set())
  const [graph, setGraph] = useState<{ nodes: GraphNode[]; links: GraphLink[] }>({ nodes: [], links: [] })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const apply = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const options = Array.from(selected) as string[]
      const r = await fetchIntersection(options)
      const nodes: GraphNode[] = (r.nodes ?? []).map((id) => ({ id, group: options as FilterId[] }))
      const links: GraphLink[] = (r.edges ?? []).map(([source, target]) => ({ source, target }))
      setGraph({ nodes, links })
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setGraph({ nodes: [], links: [] })
    } finally {
      setLoading(false)
    }
  }, [selected])

  const toggle = (id: FilterId) => {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const nodeColor = (node: GraphNode) => {
    const groups = node.group as FilterId[]
    if (groups.length === 0) return '#94a3b8' // full graph
    if (groups.length === 1) return FILTER_COLORS[groups[0]]
    return '#a855f7' // purple for multiple filters (intersection)
  }

  const graphData = useMemo(
    () => ({ nodes: graph.nodes, links: graph.links }),
    [graph.nodes, graph.links]
  )

  const fgRef = useRef<{ d3Force: (n: string) => { distance?: (v: number) => void; strength?: (v: number) => void }; d3ReheatSimulation?: () => void } | null>(null)
  const [dagBlocked, setDagBlocked] = useState(false)

  useEffect(() => {
    setDagBlocked(false)
  }, [graph.nodes.length])

  useEffect(() => {
    const fg = fgRef.current as {
      d3Force: (n: string) => { distance?: (v: number) => void; strength?: (v: number) => void }
      d3ReheatSimulation?: () => void
    } | null
    if (!fg || !graph.nodes.length) return
    const linkForce = fg.d3Force('link')
    const chargeForce = fg.d3Force('charge')
    if (linkForce?.distance) linkForce.distance(70)
    if (chargeForce?.strength) chargeForce.strength(-180)
    if (typeof fg.d3ReheatSimulation === 'function') fg.d3ReheatSimulation()
  }, [graph.nodes.length, graph.links.length])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh' }}>
      <header style={{
        padding: '12px 20px',
        borderBottom: '1px solid #27272a',
        display: 'flex',
        alignItems: 'center',
        gap: 24,
        flexWrap: 'wrap',
      }}>
        <h1 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 600 }}>TrainTicket Graph</h1>
        <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
          {FILTERS.map(({ id, label }) => (
            <label key={id} style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={selected.has(id)}
                onChange={() => toggle(id)}
              />
              <span style={{ color: FILTER_COLORS[id] }}>●</span>
              <span>{label}</span>
            </label>
          ))}
        </div>
        <button
          onClick={apply}
          disabled={loading}
          style={{
            padding: '8px 16px',
            background: '#3b82f6',
            color: '#fff',
            border: 'none',
            borderRadius: 6,
            cursor: loading ? 'wait' : 'pointer',
          }}
        >
          {loading ? 'Loading…' : selected.size ? 'Filter' : 'Full graph'}
        </button>
        <div style={{ fontSize: '0.85rem', color: '#71717a' }}>
          {graph.nodes.length} nodes, {graph.links.length} edges
        </div>
      </header>

      {error && (
        <div style={{ padding: 12, background: '#7f1d1d', color: '#fecaca' }}>{error}</div>
      )}

      <div style={{ flex: 1, minHeight: 0 }}>
        <ForceGraph2D
          ref={fgRef as any}
          graphData={graphData}
          dagMode={dagBlocked ? undefined : 'lr'}
          dagLevelDistance={90}
          onDagError={() => setDagBlocked(true)}
          nodeLabel={(n: GraphNode) => n.id}
          nodeColor={nodeColor}
          nodeCanvasObject={(node, ctx, globalScale) => {
            const n = node as GraphNode
            const label = n.id
            const fontSize = 11 / globalScale
            const size = 4
            ctx.font = `${fontSize}px sans-serif`
            ctx.textAlign = 'center'
            ctx.textBaseline = 'middle'
            ctx.fillStyle = nodeColor(n)
            ctx.beginPath()
            ctx.arc(node.x!, node.y!, size, 0, 2 * Math.PI)
            ctx.fill()
            ctx.fillStyle = '#e4e4e7'
            ctx.fillText(label, node.x!, node.y! + size + fontSize / 2 + 2)
          }}
          nodeCanvasObjectMode={() => 'replace'}
          linkColor={() => DEFAULT_LINK_COLOR}
          linkDirectionalArrowLength={4}
          linkDirectionalArrowRelPos={1}
          backgroundColor="#0f0f12"
          nodeRelSize={6}
        />
      </div>

      <footer style={{
        padding: '8px 20px',
        borderTop: '1px solid #27272a',
        fontSize: '0.8rem',
        color: '#71717a',
      }}>
        Use proxy: ensure API runs at <code style={{ background: '#27272a', padding: '2px 6px' }}>http://localhost:8000</code> and dev server proxies <code>/api</code> to it.
      </footer>
    </div>
  )
}
