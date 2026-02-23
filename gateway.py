from collections import deque
from enum import Enum
from fastapi import FastAPI, HTTPException, Query
import json
import logging
import networkx as nx
import argparse
import uvicorn
import networkx as nx

app = FastAPI(title="TrainTicket Query Engine")


class RouteOption(str, Enum):
    public = "public"
    sink = "sink"
    vuln = "vuln"

def build_train_ticket_graph(json_data):
    G = nx.DiGraph()

    for node in json_data["nodes"]:
        node_id = node["name"]
        G.add_node(node_id, **node)

    for edge in json_data["edges"]:
        source = edge["from"]
        targets = edge["to"]

        if not G.has_node(source):
            logging.warning(f"Edge references unknown source node: {source}")
            continue

        if isinstance(targets, str):
            targets = [targets]
        elif not isinstance(targets, list):
            raise ValueError(f"Targets must be list or str: {targets!r}")

        for target in targets:
            if G.has_node(target):
                G.add_edge(source, target)
            else:
                logging.warning("Edge references unknown target node: %s -> %s", source, target)
                continue
                
    return G


def bfs_scan(G, sources:list):
    for s in sources:
        if not G.has_node(s):
            logging.warning("Unknown source node: %s", s)
            return ([], [])
    nodes = []
    edges = []
    seen = set()
    level = deque(sources)
    for s in sources:
        seen.add(s)
    while level:
        u = level.popleft()
        nodes.append(u)
        for v in G.successors(u):
            edges.append((u,v))
            if v not in seen:
                seen.add(v)
                level.append(v)
    return nodes, edges


train_graph = None  # set in main from path arg

def routes_start_public_service(G=None):
    """Return routes (BFS order) starting from every node with publicExposed=true. G defaults to train_graph."""
    G = G or train_graph
    public = [n for n in G.nodes() if G.nodes[n].get("publicExposed") is True]
    if not public:
        return {"public_services": [], "nodes": [], "edges": []}
    nodes, edges = bfs_scan(G, public)
    return {"public_services": public, "nodes": nodes, "edges": edges}


def reverse_bfs(G, sinks):
    for s in sinks:
        if not G.has_node(s):
            logging.warning("Unknown sink node: %s", s)
            return ([], [])
    nodes = []
    edges = []
    seen = set()
    level = deque(sinks)
    for s in sinks:
        seen.add(s)
    while level:
        u = level.popleft()
        nodes.append(u)
        for v in G.predecessors(u):
            edges.append((v,u))
            if v not in seen:
                seen.add(v)
                level.append(v)
    return nodes, edges


def routes_end_sink(G=None):
    """Reverse BFS from rds/sql sink nodes (all nodes that can reach a sink). G defaults to train_graph."""
    G = G or train_graph
    def is_sink(n):
        kind = (G.nodes[n].get("kind") or "").lower()
        return kind == "rds" or kind == "sql"

    sinks = [n for n in G.nodes() if is_sink(n)]
    if not sinks:
        return {"sinks": [], "nodes": [], "edges": []}
    nodes, edges = reverse_bfs(G, sinks)
    return {"sinks": sinks, "nodes": nodes, "edges": edges}

def routes_with_vulnerability(G=None):
    """BFS and reverse BFS from nodes that have at least one vulnerability. G defaults to train_graph."""
    G = G or train_graph
    vuln_sources = [
        n for n in G.nodes()
        if G.nodes[n].get("vulnerabilities") and len(G.nodes[n]["vulnerabilities"]) > 0
    ]
    if not vuln_sources:
        return {"sources": [], "nodes": [], "edges": []}
    bfs_nodes, bfs_edges = bfs_scan(G, vuln_sources)
    rev_nodes, rev_edges = reverse_bfs(G, vuln_sources)
    nodes = list(set(bfs_nodes) | set(rev_nodes))
    edges = list(set(bfs_edges) | set(rev_edges))
    return {"sources": vuln_sources, "nodes": nodes, "edges": edges}


def _subgraph_from(nodes_set: set, edges_set: set):
    """Build a DiGraph with the given nodes (attrs from train_graph) and edges. nodes_set contains node ids (name strings from JSON)."""
    G = nx.DiGraph()
    for node in nodes_set:
        if train_graph.has_node(node):
            G.add_node(node, **train_graph.nodes[node])
    for e in edges_set:
        u, v = e[0], e[1]
        if G.has_node(u) and G.has_node(v):
            G.add_edge(u, v)
    return G


def _run_option_on_graph(option: RouteOption, G: nx.DiGraph) -> tuple[list[str], list[tuple[str, str]]]:
    """Run one filter option on graph G; return (nodes, edges). Calls the specific route functions with G."""
    route = {
        RouteOption.public: routes_start_public_service,
        RouteOption.sink: routes_end_sink,
        RouteOption.vuln: routes_with_vulnerability,
    }.get(option)
    if route is None:
        logging.warning("Unknown option: %s", option)
        return ([], [])
    r = route(G)
    return (r.get("nodes", []), [tuple(e) for e in (r.get("edges") or [])])


def _get_option_nodes_edges(option: RouteOption) -> tuple[list[str], list[tuple[str, str]]]:
    """Return (nodes, edges) for one option on the full train_graph (used by other endpoints)."""
    return _run_option_on_graph(option, train_graph)


@app.get("/intersection")
def intersection(options: list[RouteOption] = Query(default=[], description="Options: public, sink, vuln. Omit or empty = full graph.")):
    """Apply each option in order on the current graph; each step builds a subgraph that the next option runs on. No options = return graph as-is."""
    if not options:
        nodes = list(train_graph.nodes())
        edges = [list(e) for e in train_graph.edges()]
        return {"options": [], "nodes": nodes, "edges": edges}
    current_nodes = set(train_graph.nodes())
    current_edges = set(tuple(e) for e in train_graph.edges())
    for opt in options:
        G = _subgraph_from(current_nodes, current_edges)
        nodes, edges = _run_option_on_graph(opt, G)
        current_nodes = set(nodes)
        current_edges = set(tuple(e) for e in edges)
    return {"options": [o.value for o in options], "nodes": list(current_nodes), "edges": [list(e) for e in current_edges]}


def main():
    global train_graph
    parser = argparse.ArgumentParser()
    parser.add_argument("path", help="Path to graph JSON file")
    args = parser.parse_args()
    try:
        with open(args.path, encoding="utf-8") as f:
            print("Loading graph...")
            train_graph = build_train_ticket_graph(json.load(f))
    except Exception as e:
        print(f"Error loading graph: {e}")
        return
    print("Starting server...")
    uvicorn.run(app, host="0.0.0.0", port=8000)


if __name__ == "__main__":
    main()