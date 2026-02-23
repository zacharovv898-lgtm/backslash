# TrainTicket Graph Viewer

React app that consumes the gateway API and visualizes route filters (public services, RDS/SQL sinks, vulnerabilities) as a force-directed graph.

## Setup

1. **Start the API** (from repo root):
   ```bash
   python gateway.py train-ticket-be.json
   ```
   API runs at `http://localhost:8000`.

2. **Install and run the frontend**:
   ```bash
   cd graph-viewer
   npm install
   npm run dev
   ```
   App runs at `http://localhost:5173`. Vite proxies `/api` to `http://localhost:8000`.

## Usage

- Select one or more filters: **From public services**, **To RDS/SQL sinks**, **With vulnerability**.
- Click **Apply** to fetch and merge the selected routes and show them in the graph.
- **Green** = public, **Blue** = sink, **Red** = vulnerability; **Purple** = node appears in more than one filter.
- Drag nodes to rearrange; scroll to zoom.
