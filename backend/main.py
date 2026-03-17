from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
import math
import numpy as np
import trimesh
import collections

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"], 
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# --- MASTER BLUEPRINT DATA ---
master_blueprint = {
    "project_id": "house_gen_001",
    "metadata": {"dimensions": {"width": 1000, "height": 800}, "units": "cm", "grid_snap_size": 5},
    "layers": {
        "architecture": {
            "walls": [
                {"id": "wall_1", "type": "straight", "start": [100, 100], "end": [500, 100], "thickness": 20},
                {"id": "wall_2", "type": "straight", "start": [500, 100], "end": [500, 400], "thickness": 20},
                {"id": "wall_3", "type": "straight", "start": [500, 400], "end": [100, 400], "thickness": 20},
                {"id": "wall_4", "type": "straight", "start": [100, 400], "end": [100, 100], "thickness": 20}
            ],
            "rooms": [{"id": "room_1", "label": "Main Living Area", "boundary_walls": ["wall_1", "wall_2", "wall_3", "wall_4"]}]
        },
        "openings": [
            {"id": "door_1", "type": "standard_door", "parent_wall": "wall_1", "position_on_wall": 150, "width": 90, "height": 210, "z_offset": 0},
            {"id": "window_1", "type": "sliding_window", "parent_wall": "wall_3", "position_on_wall": 100, "width": 120, "height": 100, "z_offset": 90}
        ],
        "structural": {
            "pillars": [{"id": "pillar_1", "position": [100, 100], "dimensions": [30, 30]}]
        },
        "mep": {
            "plumbing": {
                "nodes": [
                    {"id": "main_water_1", "type": "main_inlet", "parent_wall": "wall_4", "position_on_wall": 50, "width": 30},
                    {"id": "sink_1", "type": "kitchen_sink", "parent_wall": "wall_3", "position_on_wall": 50, "width": 40}
                ], 
                "pipes": []
            },
            "electrical": {
                "nodes": [
                    {"id": "main_panel_1", "type": "main_breaker", "parent_wall": "wall_1", "position_on_wall": 50, "width": 40},
                    {"id": "outlet_1", "type": "wall_outlet", "parent_wall": "wall_3", "position_on_wall": 200, "width": 15}
                ], 
                "wires": []
            }
        }
    }
}

# --- HELPER FUNCTION ---
def get_global_coords(node, walls):
    wall = next((w for w in walls if w["id"] == node["parent_wall"]), None)
    if not wall: return [0, 0]
    x1, y1 = wall["start"]
    x2, y2 = wall["end"]
    wall_len = math.sqrt((x2-x1)**2 + (y2-y1)**2)
    ratio = node["position_on_wall"] / wall_len
    return [x1 + (x2 - x1) * ratio, y1 + (y2 - y1) * ratio]

# --- ROUTING LOGIC ---
import collections

# --- NEW GRAPH ROUTING LOGIC ---
def bfs_path(graph, start, goal):
    """Finds the shortest path along wall intersections"""
    queue = collections.deque([[start]])
    seen = set([start])
    while queue:
        path = queue.popleft()
        node = path[-1]
        if node == goal:
            return path
        for neighbor in graph[node]:
            if neighbor not in seen:
                seen.add(neighbor)
                queue.append(path + [neighbor])
    return [start, goal] # Fallback

def route_along_walls(start_pos, start_wall_id, end_pos, end_wall_id, walls):
    """Traces the physical walls instead of cutting across the room"""
    if start_wall_id == end_wall_id:
        return [start_pos[0], start_pos[1], end_pos[0], end_pos[1]]

    start_wall = next(w for w in walls if w["id"] == start_wall_id)
    end_wall = next(w for w in walls if w["id"] == end_wall_id)

    # Build an adjacency graph of the room's corners
    graph = collections.defaultdict(list)
    for w in walls:
        p1 = tuple(w["start"])
        p2 = tuple(w["end"])
        graph[p1].append(p2)
        graph[p2].append(p1)

    best_path = []
    min_dist = float('inf')

    # Test which direction around the room is shorter
    for s_node in [tuple(start_wall["start"]), tuple(start_wall["end"])]:
        for e_node in [tuple(end_wall["start"]), tuple(end_wall["end"])]:
            path_nodes = bfs_path(graph, s_node, e_node)
            
            # Calculate total distance
            dist = math.dist(start_pos, s_node) + math.dist(e_node, end_pos)
            for i in range(len(path_nodes)-1):
                dist += math.dist(path_nodes[i], path_nodes[i+1])

            if dist < min_dist:
                min_dist = dist
                best_path = [start_pos] + list(path_nodes) + [end_pos]

    # Flatten coordinates for Konva ( [x1, y1, x2, y2...] )
    flat_path = []
    for p in best_path:
        flat_path.extend([p[0], p[1]])
    return flat_path

# --- UPDATE THESE TWO FUNCTIONS ---
def auto_route_plumbing(blueprint):
    nodes = blueprint["layers"]["mep"]["plumbing"]["nodes"]
    walls = blueprint["layers"]["architecture"]["walls"]
    main_inlet = next((n for n in nodes if n["type"] == "main_inlet"), None)
    if not main_inlet: return blueprint
    
    inlet_pos = get_global_coords(main_inlet, walls)
    generated_pipes = []

    for idx, node in enumerate(nodes):
        if node["type"] == "main_inlet": continue 
        pos = get_global_coords(node, walls)
        
        # USE GRAPH ROUTING
        pipe_path = route_along_walls(pos, node["parent_wall"], inlet_pos, main_inlet["parent_wall"], walls)
        generated_pipes.append({"id": f"pipe_{idx}", "path_coords": pipe_path})

    blueprint["layers"]["mep"]["plumbing"]["pipes"] = generated_pipes
    return blueprint

def auto_route_electrical(blueprint):
    nodes = blueprint["layers"]["mep"]["electrical"]["nodes"]
    walls = blueprint["layers"]["architecture"]["walls"]
    main_breaker = next((n for n in nodes if n["type"] == "main_breaker"), None)
    if not main_breaker: return blueprint 
    
    breaker_pos = get_global_coords(main_breaker, walls)
    generated_wires = []

    for idx, node in enumerate(nodes):
        if node["type"] == "main_breaker": continue
        pos = get_global_coords(node, walls)
        
        # USE GRAPH ROUTING
        wire_path = route_along_walls(pos, node["parent_wall"], breaker_pos, main_breaker["parent_wall"], walls)
        generated_wires.append({"id": f"wire_{idx}", "path_coords": wire_path})

    blueprint["layers"]["mep"]["electrical"]["wires"] = generated_wires
    return blueprint

# --- THE 3D EXTRUSION & BOOLEAN ENGINE ---
def generate_3d_mesh(blueprint):
    walls = blueprint["layers"]["architecture"]["walls"]
    openings = blueprint["layers"]["openings"]
    wall_height = 300
    meshes = []

    for wall in walls:
        start_x, start_y = wall["start"]
        end_x, end_y = wall["end"]
        thickness = wall["thickness"]

        dx = end_x - start_x
        dy = end_y - start_y
        length = math.sqrt(dx**2 + dy**2)

        # Extend length for corner overlaps
        extended_length = length + thickness 

        # Create the solid wall Box
        wall_mesh = trimesh.creation.box(extents=[extended_length, thickness, wall_height])

        # Find all openings (doors/windows) attached to this wall
        wall_openings = [op for op in openings if op["parent_wall"] == wall["id"]]
        
        for op in wall_openings:
            op_width = op["width"]
            op_height = op["height"]
            op_z_offset = op.get("z_offset", 0) 
            
            # Create a "Cutter" box thicker than the wall
            cutter = trimesh.creation.box(extents=[op_width, thickness + 10, op_height])
            
            # Position along the wall's local X axis
            local_x_pos = op["position_on_wall"] - (length / 2) + (op_width / 2)
            
            # Position on the Z axis (Elevation)
            local_z_pos = -(wall_height / 2) + op_z_offset + (op_height / 2)
            
            cutter_matrix = trimesh.transformations.translation_matrix([local_x_pos, 0, local_z_pos])
            cutter.apply_transform(cutter_matrix)
            
            # Subtract the opening from the wall
            wall_mesh = wall_mesh.difference(cutter)

        # Position and Rotation (Global)
        center_x = (start_x + end_x) / 2.0
        center_y = (start_y + end_y) / 2.0
        center_z = wall_height / 2.0
        angle = math.atan2(dy, dx)

        matrix = trimesh.transformations.euler_matrix(0, 0, angle)
        matrix[:3, 3] = [center_x, center_y, center_z]
        
        wall_mesh.apply_transform(matrix)
        meshes.append(wall_mesh)

    house_3d = trimesh.util.concatenate(meshes)
    export_path = "house_model.stl"
    house_3d.export(export_path)
    return export_path


@app.get("/")
def read_root():
    return {"message": "AI House Printer Backend is Live"}

# --- RESTORED GET ENDPOINT ---
@app.get("/api/blueprint")
def get_blueprint():
    processed = auto_route_plumbing(master_blueprint)
    processed = auto_route_electrical(processed)
    return {"status": "success", "data": processed}

@app.post("/api/blueprint")
async def save_blueprint(request: Request):
    global master_blueprint
    new_data = await request.json()
    master_blueprint = new_data 
    
    processed = auto_route_plumbing(master_blueprint)
    processed = auto_route_electrical(processed)
    
    return {"status": "success", "data": processed}

@app.get("/api/export-3d")
def export_3d():
    try:
        file_path = generate_3d_mesh(master_blueprint)
        return FileResponse(
            path=file_path, 
            filename="AI_House_Print.stl", 
            media_type="application/octet-stream"
        )
    except Exception as e:
        return {"status": "error", "message": str(e)}