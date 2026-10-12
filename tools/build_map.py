# Converts OpenStreetMap data (data/osm_raw.json) into game data:
#   public/data/campus.json  roads, buildings, water, fields, campus outline, trees
#   public/data/track.json   race line (start/finish at 聽松台)
# Local coordinates are metres: x = east, y = north, origin at LAT0/LON0.
# The game maps (x, y) -> three.js (x, -z).
import json, math, random, os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LAT0, LON0 = 24.9685, 121.1935
EXTENT = 900  # keep features within this many metres of the origin

# Lap waypoints traced from the hand-drawn route on the campus map.
# Start at 聽松台 on the west side of the front oval, heading south.
WAYPOINTS = [
    (235, 14),               # 聽松台 start / finish (grid lines up on the straight behind it)
    (234, -22),              # exit the oval
    (197, -21), (198, -100), (199, -187),
    (205, -240),             # past 大講堂 / 據德樓 to 遊藝館
    (52, -240), (7, -240), (7, -187),
    (-241, -187),            # 女生宿舍 / 松果館 corner
    (-241, -118),
    (-560, -118),            # 工程五館 / 太空遙測中心
    (-560, 68), (-438, 148), # 大型力學實驗室 → 運動中心
    (115, 143),              # north ring past 依仁堂, 科學二館, 志希館
    (115, 244), (200, 244),  # 中大會館
    (216, 226), (200, 207),  # around 男九舍
    (179, 207), (179, 143), (203, 143),
    (197, 16), (197, -30),
    (234, -30),              # enter the oval
    (236, -78), (260, -107), (292, -68), (292, 8), (268, 58), (242, 48),
]
TRACK_WIDTH = 10.0

d = json.load(open(os.path.join(ROOT, 'data', 'osm_raw.json')))
nodes = {e['id']: (e['lat'], e['lon']) for e in d['elements'] if e['type'] == 'node'}
ways = {e['id']: e for e in d['elements'] if e['type'] == 'way'}


def xy(n):
    lat, lon = nodes[n]
    return ((lon - LON0) * 111320 * math.cos(math.radians(LAT0)), (lat - LAT0) * 110574)


def pts_of(w):
    return [xy(n) for n in w['nodes'] if n in nodes]


def r1(p):
    return [round(p[0], 1), round(p[1], 1)]


def near(pts):
    return any(abs(p[0]) < EXTENT and abs(p[1]) < EXTENT for p in pts)


def area(poly):
    return sum(poly[i][0] * poly[i - 1][1] - poly[i - 1][0] * poly[i][1] for i in range(len(poly))) / 2


def inside(p, poly):
    x, y = p; c = False; j = len(poly) - 1
    for i in range(len(poly)):
        xi, yi = poly[i]; xj, yj = poly[j]
        if (yi > y) != (yj > y) and x < (xj - xi) * (y - yi) / (yj - yi) + xi:
            c = not c
        j = i
    return c


def seg_dist(p, a, b):
    ax, ay = a; bx, by = b; px, py = p
    dx, dy = bx - ax, by - ay; L = dx * dx + dy * dy
    t = 0 if L == 0 else max(0, min(1, ((px - ax) * dx + (py - ay) * dy) / L))
    qx, qy = ax + t * dx, ay + t * dy
    return math.hypot(px - qx, py - qy), (qx, qy)


# ---------- campus outline (multipolygon relation) ----------
campus = []
for e in d['elements']:
    if e['type'] == 'relation' and e.get('tags', {}).get('amenity') == 'university':
        segs = [list(ways[m['ref']]['nodes']) for m in e['members'] if m['type'] == 'way' and m['ref'] in ways and m['role'] == 'outer']
        ring = segs.pop(0)
        while segs:
            for i, s in enumerate(segs):
                if s[0] == ring[-1]: ring += s[1:]; segs.pop(i); break
                if s[-1] == ring[-1]: ring += s[::-1][1:]; segs.pop(i); break
            else:
                break
        campus = [xy(n) for n in ring if n in nodes]
if area(campus) < 0: campus.reverse()

# ---------- roads ----------
ROAD_W = {'secondary': 12, 'tertiary': 10, 'unclassified': 7, 'residential': 6, 'service': 5,
          'pedestrian': 5, 'track': 3.5, 'cycleway': 2.5, 'footway': 2, 'path': 1.6, 'steps': 2}
roads = []
for w in ways.values():
    t = w.get('tags', {}); hw = t.get('highway')
    if hw not in ROAD_W: continue
    p = pts_of(w)
    if len(p) < 2 or not near(p): continue
    roads.append({'k': hw, 'w': ROAD_W[hw], 'p': [r1(q) for q in p]})

# ---------- buildings ----------
BRICK = ('志希館', '管理學院', '中大會館', '研究生宿舍', '國鼎圖書')
GLASS = ('電機', '通訊', '工程二館', '國鼎光電', '前瞻')


def levels_for(t, name, in_campus, rnd):
    if 'building:levels' in t:
        try: return float(t['building:levels'])
        except ValueError: pass
    if '舍' in name or '宿舍' in name: return 7
    if '圖書' in name: return 6
    if '工程五館' in name or '太空' in name: return 6
    if any(k in name for k in ('館', '大樓', '中心', '學院')): return 5
    if in_campus: return rnd.choice([2, 3, 4, 4, 5])
    return rnd.choice([2, 3, 3, 4, 4, 5, 6])


buildings = []
rnd = random.Random(7)
for w in ways.values():
    t = w.get('tags', {})
    if 'building' not in t: continue
    p = pts_of(w)
    if len(p) < 4 or not near(p): continue
    if p[0] == p[-1]: p = p[:-1]
    if area(p) < 0: p.reverse()
    if abs(area(p)) < 12: continue
    name = t.get('name', '')
    cx = sum(q[0] for q in p) / len(p); cy = sum(q[1] for q in p) / len(p)
    in_campus = inside((cx, cy), campus)
    if 'height' in t:
        try: h = float(t['height'].replace('m', ''))
        except ValueError: h = 3.6 * levels_for(t, name, in_campus, rnd)
    else:
        h = 3.6 * levels_for(t, name, in_campus, rnd)
    if t.get('building') in ('roof', 'carport'): h = 4
    style = 'brick' if any(k in name for k in BRICK) else 'glass' if any(k in name for k in GLASS) else ('campus' if in_campus else 'town')
    buildings.append({'n': name, 'h': round(h, 1), 's': style, 'p': [r1(q) for q in p]})

# ---------- water, fields, landuse ----------
water, fields = [], []
for w in ways.values():
    t = w.get('tags', {}); p = pts_of(w)
    if len(p) < 4 or not near(p) or w['nodes'][0] != w['nodes'][-1]: continue
    p = p[:-1]
    if t.get('natural') == 'water':  # (室內游泳池 is tagged swimming_pool but is indoors)
        water.append([r1(q) for q in p])
    elif t.get('leisure') in ('pitch', 'track', 'garden', 'park', 'sports_centre') and t.get('leisure') != 'sports_centre':
        fields.append({'k': t.get('sport') or t.get('leisure'), 'p': [r1(q) for q in p]})
    elif t.get('landuse') in ('grass', 'forest', 'meadow', 'recreation_ground', 'village_green'):
        fields.append({'k': 'grass', 'p': [r1(q) for q in p]})

# ---------- track: snap waypoints to OSM roads, fillet corners, resample ----------
drivable = [r['p'] for r in roads]


def snap(p):
    best = (6.0, p)
    for line in drivable:
        for i in range(len(line) - 1):
            dd, q = seg_dist(p, line[i], line[i + 1])
            if dd < best[0]: best = (dd, q)
    return best[1]


wps = [snap(p) for p in WAYPOINTS]


def fillet(points, radius=11.0, steps=10):
    out = []
    n = len(points)
    for i in range(n):
        a, b, c = points[i - 1], points[i], points[(i + 1) % n]
        v1 = (a[0] - b[0], a[1] - b[1]); v2 = (c[0] - b[0], c[1] - b[1])
        l1, l2 = math.hypot(*v1), math.hypot(*v2)
        if l1 < 1e-6 or l2 < 1e-6: continue
        u1 = (v1[0] / l1, v1[1] / l1); u2 = (v2[0] / l2, v2[1] / l2)
        cosang = max(-1, min(1, u1[0] * u2[0] + u1[1] * u2[1]))
        ang = math.acos(cosang)
        if ang > math.radians(172): out.append(b); continue
        tan_len = min(radius / math.tan(ang / 2), l1 * 0.48, l2 * 0.48)
        p1 = (b[0] + u1[0] * tan_len, b[1] + u1[1] * tan_len)
        p2 = (b[0] + u2[0] * tan_len, b[1] + u2[1] * tan_len)
        for k in range(steps + 1):  # quadratic Bezier approximates the arc
            s = k / steps
            out.append(((1 - s) ** 2 * p1[0] + 2 * (1 - s) * s * b[0] + s * s * p2[0],
                        (1 - s) ** 2 * p1[1] + 2 * (1 - s) * s * b[1] + s * s * p2[1]))
    return out


def resample(points, step=2.0):
    pts = points + [points[0]]
    out = [pts[0]]; carry = 0.0
    for i in range(len(pts) - 1):
        a, b = pts[i], pts[i + 1]
        L = math.hypot(b[0] - a[0], b[1] - a[1]); s = step - carry
        while s <= L:
            out.append((a[0] + (b[0] - a[0]) * s / L, a[1] + (b[1] - a[1]) * s / L)); s += step
        carry = L - (s - step)
    if math.hypot(out[-1][0] - out[0][0], out[-1][1] - out[0][1]) < step * 0.5: out.pop()
    return out


line = resample(fillet(wps))


def smooth(line, passes):
    for _ in range(passes):
        line = [((line[i - 1][0] + 2 * line[i][0] + line[(i + 1) % len(line)][0]) / 4,
                 (line[i - 1][1] + 2 * line[i][1] + line[(i + 1) % len(line)][1]) / 4) for i in range(len(line))]
    return line


# Keep the racing corridor clear of building walls: push points away, re-smooth, repeat.
CLEAR = TRACK_WIDTH / 2 + 1.6
edges = []
for b in buildings:
    poly = b['p']
    for k in range(len(poly)):
        a, b2 = poly[k - 1], poly[k]
        box = (min(a[0], b2[0]) - 15, min(a[1], b2[1]) - 15, max(a[0], b2[0]) + 15, max(a[1], b2[1]) + 15)
        if any(box[0] < p[0] < box[2] and box[1] < p[1] < box[3] for p in line[::3]):
            edges.append((a, b2, poly, box))
line = smooth(line, 3)
for it in range(60):
    moved = 0
    out = []
    for p in line:
        best = None
        for a, b2, poly, box in edges:
            if not (box[0] < p[0] < box[2] and box[1] < p[1] < box[3]): continue
            dd, q = seg_dist(p, a, b2)
            if best is None or dd < best[0]: best = (dd, q, poly)
        if best and (best[0] < CLEAR or inside(p, best[2])):
            dd, q, poly = best
            sign = -1 if inside(p, poly) else 1
            if dd < 1e-6: out.append(p); continue
            ux, uy = (p[0] - q[0]) / dd * sign, (p[1] - q[1]) / dd * sign
            push = (CLEAR - sign * dd) * 0.5
            out.append((p[0] + ux * push, p[1] + uy * push)); moved += 1
        else:
            out.append(p)
    line = smooth(out, 1)
    if not moved: break
line = resample(line)
length = sum(math.hypot(line[i][0] - line[i - 1][0], line[i][1] - line[i - 1][1]) for i in range(len(line)))

# ---------- trees ----------
trees = []
rnd = random.Random(42)
grid = {}
CELL = 20


def add_obstacle(p, r):
    gx, gy = int(p[0] // CELL), int(p[1] // CELL)
    grid.setdefault((gx, gy), []).append((p, r))


for r in roads:
    for i in range(len(r['p']) - 1):
        a, b = r['p'][i], r['p'][i + 1]
        L = math.hypot(b[0] - a[0], b[1] - a[1]); n = max(1, int(L / 4))
        for k in range(n + 1):
            add_obstacle((a[0] + (b[0] - a[0]) * k / n, a[1] + (b[1] - a[1]) * k / n), r['w'] / 2 + 2.5)
for p in line:
    add_obstacle(p, TRACK_WIDTH / 2 + 4)


def clear(p):
    gx, gy = int(p[0] // CELL), int(p[1] // CELL)
    for dx in (-1, 0, 1):
        for dy in (-1, 0, 1):
            for q, r in grid.get((gx + dx, gy + dy), []):
                if (q[0] - p[0]) ** 2 + (q[1] - p[1]) ** 2 < r * r: return False
    return True


bboxes = [(min(q[0] for q in b['p']) - 3, min(q[1] for q in b['p']) - 3, max(q[0] for q in b['p']) + 3, max(q[1] for q in b['p']) + 3, b['p']) for b in buildings]
blocked_polys = water + [f['p'] for f in fields if f['k'] != 'garden']


def in_blocked(p):
    for x0, y0, x1, y1, poly in bboxes:
        if x0 <= p[0] <= x1 and y0 <= p[1] <= y1:
            if inside(p, poly): return True
            for i in range(len(poly)):
                if seg_dist(p, poly[i - 1], poly[i])[0] < 3: return True
    for poly in blocked_polys:
        if inside(p, poly): return True
    return False


xs = [q[0] for q in campus]; ys = [q[1] for q in campus]
SP = 8.0
y = min(ys) - 40
while y < max(ys) + 40:
    x = min(xs) - 40
    while x < max(xs) + 40:
        p = (x + rnd.uniform(-3, 3), y + rnd.uniform(-3, 3))
        if (inside(p, campus) and rnd.random() < 0.55) or rnd.random() < 0.08:
            if clear(p) and not in_blocked(p):
                trees.append([round(p[0], 1), round(p[1], 1), round(rnd.uniform(0.75, 1.35), 2), rnd.randrange(3)])
        x += SP
    y += SP

out = os.path.join(ROOT, 'public', 'data'); os.makedirs(out, exist_ok=True)
json.dump({'origin': [LAT0, LON0], 'campus': [r1(q) for q in campus], 'roads': roads, 'buildings': buildings,
           'water': water, 'fields': fields, 'trees': trees},
          open(os.path.join(out, 'campus.json'), 'w'), ensure_ascii=False, separators=(',', ':'))
json.dump({'name': '中央大學 聽松台環線', 'width': TRACK_WIDTH, 'length': round(length, 1),
           'points': [r1(q) for q in line], 'waypoints': [r1(q) for q in wps]},
          open(os.path.join(out, 'track.json'), 'w'), ensure_ascii=False, separators=(',', ':'))
print(f'roads {len(roads)} buildings {len(buildings)} water {len(water)} fields {len(fields)} trees {len(trees)}')
print(f'track length {length:.0f} m, {len(line)} points')
