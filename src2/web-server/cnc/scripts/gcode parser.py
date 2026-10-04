"""
Parses G-code, cleans consecutive duplicate points, and generates geometry/stats.
Inputs:
    gcode_text: Raw G-code string
    script_name: Name for the header
Outputs:
    Polyline: The resulting curve(s)
    ModifiedGcode: Text with stats header
    PointList: The CLEANED list of points
"""

import math
import Rhino
import Rhino.Geometry as rg
import datetime

def process_gcode(raw_text, s_name):
    debug_log = []
    
    if not raw_text:
        return None, "Error: Input text is empty.", [], debug_log
    
    if not s_name:
        s_name = "Grasshopper Script"

    lines = raw_text.splitlines()
    original_line_count = len(lines)
    
    # --- 1. Parsing Logic ---
    curves = []
    clean_points = []
    
    current_x = 0.0
    current_y = 0.0
    current_z = 0.0
    
    # Stats
    x_vals = []
    y_vals = []
    z_vals = []
    f_vals = []
    s_vals = []
    path_length = 0.0
    
    for line in lines:
        clean_line = line.strip().upper()
        if ";" in clean_line:
            clean_line = clean_line.split(";")[0].strip()
        
        if not clean_line:
            continue

        parts = clean_line.split()
        
        # F/S Parsing
        for part in parts:
            try:
                if part.startswith("S"):
                    s_vals.append(float(part[1:]))
                elif part.startswith("F"):
                    f_vals.append(float(part[1:]))
            except:
                pass

        is_G1 = clean_line.startswith("G1")
        is_G2 = clean_line.startswith("G2")
        is_G3 = clean_line.startswith("G3")
        
        # G0 typically indicates a rapid move, but we only draw cut paths.
        # If you want to include G0 moves as well, add is_G0 here.
        # Original logic only watched G1 to build geometry. 
        if is_G1 or is_G2 or is_G3:
            target_x = current_x
            target_y = current_y
            target_z = current_z
            i_val = 0.0
            j_val = 0.0
            
            geometry_updated = False
            for part in parts:
                try:
                    if len(part) > 1:
                        if part.startswith("X"):
                            target_x = float(part[1:])
                            geometry_updated = True
                        elif part.startswith("Y"):
                            target_y = float(part[1:])
                            geometry_updated = True
                        elif part.startswith("Z"):
                            target_z = float(part[1:])
                            geometry_updated = True
                        elif part.startswith("I"):
                            i_val = float(part[1:])
                        elif part.startswith("J"):
                            j_val = float(part[1:])
                except ValueError:
                    continue
            
            if geometry_updated:
                start_pt = rg.Point3d(current_x, current_y, current_z)
                end_pt = rg.Point3d(target_x, target_y, target_z)
                
                if not clean_points:
                    clean_points.append(start_pt)
                    x_vals.append(current_x)
                    y_vals.append(current_y)
                    z_vals.append(current_z)

                dist = start_pt.DistanceTo(end_pt)
                is_full_circle = dist < Rhino.RhinoMath.ZeroTolerance
                
                # Construct Geometry
                if is_G1 and not is_full_circle:
                    crv = rg.LineCurve(start_pt, end_pt)
                    curves.append(crv)
                    path_length += crv.GetLength()
                    
                elif (is_G2 or is_G3) and (i_val != 0 or j_val != 0):
                    center_pt = rg.Point3d(current_x + i_val, current_y + j_val, current_z)
                    radius = center_pt.DistanceTo(start_pt)
                    
                    if radius > Rhino.RhinoMath.ZeroTolerance:
                        angle1 = math.atan2(current_y - center_pt.Y, current_x - center_pt.X)
                        angle2 = math.atan2(target_y - center_pt.Y, target_x - center_pt.X)
                        
                        if angle1 < 0: angle1 += 2 * math.pi
                        if angle2 < 0: angle2 += 2 * math.pi
                        
                        if is_G2:  # Clockwise
                            sweep = angle2 - angle1
                            if sweep > 0: sweep -= 2 * math.pi
                            if is_full_circle: sweep = -2 * math.pi
                        else:      # Counter-Clockwise
                            sweep = angle2 - angle1
                            if sweep < 0: sweep += 2 * math.pi
                            if is_full_circle: sweep = 2 * math.pi
                            
                        # Arc construction: define plane at center
                        # X-axis of plane points to Start Point
                        x_dir = start_pt - center_pt
                        x_dir.Unitize()
                        y_dir = rg.Vector3d(-x_dir.Y, x_dir.X, 0)
                        plane = rg.Plane(center_pt, x_dir, y_dir)
                        
                        # Create arc domain from 0 to positive or negative sweep
                        arc = rg.Arc(plane, radius, sweep)
                        crv = rg.ArcCurve(arc)
                        curves.append(crv)
                        path_length += crv.GetLength()

                # Update current state
                current_x = target_x
                current_y = target_y
                current_z = target_z
                
                if end_pt.DistanceTo(clean_points[-1]) > Rhino.RhinoMath.ZeroTolerance:
                    clean_points.append(end_pt)
                
                x_vals.append(current_x)
                y_vals.append(current_y)
                z_vals.append(current_z)

    # Output discrete curves instead of a single merged polyline,
    # as Grasshopper can natively output lists of curves robustly.
    final_poly = curves

    # --- 4. Header Construction ---
    def fmt_min(vals, label): return f";{label}: {min(vals):.2f}" if vals else f";{label}: N/A"
    def fmt_max(vals, label): return f";{label}: {max(vals):.2f}" if vals else f";{label}: N/A"

    date_str = datetime.datetime.now().strftime("%d-%b-%Y %H:%M")
    
    header = []
    header.append(f";Date Generated {date_str}")
    header.append(f";Generated using {s_name}")
    header.append(f";Total Travel Length: {path_length:.2f}")
    header.append(fmt_min(x_vals, "Min X"))
    header.append(fmt_max(x_vals, "Max X"))
    header.append(fmt_min(y_vals, "Min Y"))
    header.append(fmt_max(y_vals, "Max Y"))
    header.append(fmt_min(z_vals, "Min Z"))
    header.append(fmt_max(z_vals, "Max Z"))
    header.append(fmt_min(f_vals, "Min Feed"))
    header.append(fmt_max(f_vals, "Max Feed"))
    header.append(fmt_min(s_vals, "Min Speed"))
    header.append(fmt_max(s_vals, "Max Speed"))
    
    total_lines = original_line_count + len(header) + 1
    header.append(f";Total Gcode Lines {total_lines}")
    
    full_header_str = "\n".join(header)
    final_text_output = full_header_str + "\n\n" + raw_text
    
    return final_poly, final_text_output, clean_points, debug_log

# --- Execution ---
Polyline = None
ModifiedGcode = ""
PointList = []

try:
    poly_list, text, pts, logs = process_gcode(gcode_text, script_name)
    
    Polyline = poly_list
    ModifiedGcode = text
    PointList = pts
    
    for l in logs:
        print(l)
        
except Exception as e:
    print(f"Critical Script Error: {str(e)}")