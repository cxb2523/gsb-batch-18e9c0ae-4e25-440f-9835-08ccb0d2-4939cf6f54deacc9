#!/usr/bin/env python3
"""Generate the animated GitHub profile banners.

Run from the repository root:
    python scripts/banner/generate.py

The dark and light renders share one animation *skeleton*: logo sampling,
traveller source selection, optimal-transport order and the keyframe timeline
are computed exactly once per invocation.  Only the colour palette and the
theme-specific dithered portrait lattice differ between the two SVGs.

Logo sampling is cached under ``scripts/banner/data`` (see
``logo-samples.npz`` / ``logo-samples.meta.json``).  The cache key covers the
exact bytes of every logo image, the requested traveller count and the
sampling parameters, so editing a logo or changing the traveller count
invalidates and rebuilds the cache while unchanged reruns reuse it.

Optional flags exist to make small-fixture acceptance runs convenient; with
no arguments the historical paths and output names are used.
"""

from __future__ import annotations

import argparse
import hashlib
import html
import io
import json
import math
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageEnhance, ImageFilter, ImageOps
from scipy.optimize import linear_sum_assignment
from scipy.spatial.distance import cdist


ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / "assets/source/mrr.png"
ASSETS = ROOT / "assets"
LOGOS = Path(__file__).resolve().parent / "logos"
DATA = Path(__file__).resolve().parent / "data"

W, H = 1180, 610
LOOP_SECONDS = 14.2
INTRO_SECONDS = 3.2
TRAVELLER_COUNT = 900
SEED = 314159

# Shared skeleton geometry.
BAND_COUNT = 94
INTRO_GROUPS = 60
LOGO_NAMES = ("waveframe", "code", "react")
# Bumped whenever the cache payload format / sampling convention changes.
CACHE_VERSION = 1
LOGO_CACHE_STEM = "logo-samples"

ROWS = [
    ("Subject", "Ramiro"),
    ("Role", "Full-Stack Dev · Tech Lead"),
    ("Origin", "Argentina"),
    ("Studio", "WaveFrame Studio"),
    ("Status", "Building + Designing + Shipping"),
    ("ToolChain", "VS Code · Cursor · Git"),
    ("Core.Lang", "TypeScript · JavaScript · Python"),
    ("Core.Frontend", "React · Next.js · Three.js · Tailwind"),
    ("Core.Backend", "Node.js · Rails · Python"),
    ("Core.Database", "Supabase · MySQL"),
    ("Core.Infra", "Vercel · Netlify · Hostinger"),
    ("Grid.Mail", "ramiroalejandrolacci19@gmail.com"),
    ("Grid.LinkedIn", "/in/ramiro-lacci"),
    ("Grid.GitHub", "ramirolacci"),
    ("Grid.Web", "waveframe.com.ar"),
]

THEMES = {
    "dark": {
        "bg": "#0A101F",
        "panel": "#0D1628",
        "panel2": "#101B30",
        "line": "#25344C",
        "muted": "#8291A8",
        "text": "#DDE7F5",
        "portrait": "#AA9BEF",
        "chrome": "#22D3EE",
        "accent": "#10B981",
        "shadow": "#02050B",
    },
    "light": {
        "bg": "#F6F8FA",
        "panel": "#FFFFFF",
        "panel2": "#EDF3F7",
        "line": "#CBD7E1",
        "muted": "#64748B",
        "text": "#172033",
        "portrait": "#4A3D7A",
        "chrome": "#0891B2",
        "accent": "#10B981",
        "shadow": "#AAB7C4",
    },
}
THEME_ORDER = tuple(THEMES.keys())

# Explicit uneven phase boundaries: 3.0 portrait, 2.0 per logo,
# and four 1.3 transitions = 14.2 seconds.
KEYFRAME_TIMES = [0, 3.0, 4.3, 6.3, 7.6, 9.6, 10.9, 12.9, 14.2]
OPACITY_VALUES = "0;0;1;1;1;1;1;1;0"


# ---------------------------------------------------------------------------
# Small filesystem / cache helpers
# ---------------------------------------------------------------------------


def sha256_file(path: Path | str) -> str:
    """Hex SHA-256 of a file's exact bytes (any edit invalidates the key)."""
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        for chunk in iter(lambda: handle.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def save_npy_if_changed(path: Path | str, array: np.ndarray) -> bool:
    """Write an ``.npy`` file only when its serialized bytes changed.

    Returns True when the file was (re)written.  Skipping identical writes
    keeps mtimes stable on cache-hit reruns, which external checks use to
    observe cache reuse.
    """
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    buffer = io.BytesIO()
    np.save(buffer, array)
    payload = buffer.getvalue()
    if path.exists():
        old = path.read_bytes()
        if old == payload:
            return False
    path.write_bytes(payload)
    return True


def display_path(path: Path) -> str:
    """Repo-relative posix path when possible, otherwise absolute (for logs)."""
    try:
        return Path(path).resolve().relative_to(ROOT.resolve()).as_posix()
    except ValueError:
        return Path(path).resolve().as_posix()


def log(message: str) -> None:
    """Print without ever crashing on a legacy non-Unicode stdout encoding."""
    try:
        print(message)
    except UnicodeEncodeError:
        print(message.encode("ascii", "replace").decode("ascii"))


# ---------------------------------------------------------------------------
# Logo source images
# ---------------------------------------------------------------------------


def build_waveframe_logo(wf_src: Path | str) -> Image.Image | None:
    """Black-on-transparent 400px WaveFrame silhouette from a source mark."""
    wf_src = Path(wf_src)
    if not wf_src.exists():
        return None
    size = 400
    im = Image.open(wf_src).convert("RGBA")
    bbox = im.getbbox()
    if not bbox:
        return None
    cropped = im.crop(bbox)
    target_w = 360
    target_h = int(cropped.height * (target_w / cropped.width))
    resized = cropped.resize((target_w, target_h), Image.Resampling.LANCZOS)
    waveframe = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    offset_x = (size - target_w) // 2
    offset_y = (size - target_h) // 2
    alpha = resized.getchannel("A")
    black_fill = Image.new("RGBA", resized.size, (0, 0, 0, 255))
    waveframe.paste(black_fill, (offset_x, offset_y), alpha)
    return waveframe


def build_code_logo() -> Image.Image:
    """``</>`` mark built from broad, rounded strokes."""
    size = 400
    code = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(code)
    stroke = 42
    d.line([(154, 95), (66, 200), (154, 305)], fill="black", width=stroke, joint="curve")
    d.line([(246, 95), (334, 200), (246, 305)], fill="black", width=stroke, joint="curve")
    d.line([(225, 72), (174, 328)], fill="black", width=stroke)
    return code


def build_react_logo() -> Image.Image:
    """React atom mark: center nucleus and 3 orbital rings."""
    size = 400
    scale = 4
    supersize = size * scale
    react_hi = Image.new("RGBA", (supersize, supersize), (0, 0, 0, 0))
    c_pt = (supersize // 2, supersize // 2)
    a_rad = 155 * scale
    b_rad = 58 * scale
    stroke_w = 26 * scale

    for angle_deg in [0, 60, 120]:
        rad = math.radians(angle_deg)
        cos_a, sin_a = math.cos(rad), math.sin(rad)
        num_pts = 720
        outer_pts: list[tuple[float, float]] = []
        inner_pts: list[tuple[float, float]] = []
        for t in range(num_pts):
            th = t * 2 * math.pi / num_pts
            x_out = (a_rad + stroke_w / 2) * math.cos(th)
            y_out = (b_rad + stroke_w / 2) * math.sin(th)
            xo = c_pt[0] + x_out * cos_a - y_out * sin_a
            yo = c_pt[1] + x_out * sin_a + y_out * cos_a
            outer_pts.append((xo, yo))

            x_in = max(1.0, a_rad - stroke_w / 2) * math.cos(th)
            y_in = max(1.0, b_rad - stroke_w / 2) * math.sin(th)
            xi = c_pt[0] + x_in * cos_a - y_in * sin_a
            yi = c_pt[1] + x_in * sin_a + y_in * cos_a
            inner_pts.append((xi, yi))

        temp = Image.new("L", (supersize, supersize), 0)
        dt = ImageDraw.Draw(temp)
        dt.polygon(outer_pts, fill=255)
        dt.polygon(inner_pts, fill=0)

        ring_rgba = Image.new("RGBA", (supersize, supersize), (0, 0, 0, 255))
        react_hi.paste(ring_rgba, (0, 0), temp)

    dr = ImageDraw.Draw(react_hi)
    r_nuc = 34 * scale
    dr.ellipse(
        (c_pt[0] - r_nuc, c_pt[1] - r_nuc, c_pt[0] + r_nuc, c_pt[1] + r_nuc),
        fill=(0, 0, 0, 255),
    )
    return react_hi.resize((size, size), Image.Resampling.LANCZOS)


def build_placeholder_logo() -> Image.Image:
    """Last-resort mark so a broken/empty fixture cannot crash rendering."""
    size = 400
    im = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    d.ellipse((70, 70, 330, 330), outline=(0, 0, 0, 255), width=34)
    return im


def make_logos() -> dict[str, Image.Image]:
    """Create clean 400px black-on-transparent silhouette sources.

    This always rebuilds and overwrites the files in :data:`LOGOS`.  The
    normal generation flow uses :func:`ensure_logo_files` instead so that
    externally supplied / hand-edited logo images are treated as inputs.
    """
    LOGOS.mkdir(parents=True, exist_ok=True)
    logos: dict[str, Image.Image] = {}

    waveframe = build_waveframe_logo(ROOT / "assets/source/waveframe.png")
    if waveframe is not None:
        logos["waveframe"] = waveframe
    logos["code"] = build_code_logo()
    logos["react"] = build_react_logo()

    for name, image in logos.items():
        image.save(LOGOS / f"{name}.png", optimize=True)
    return logos


def ensure_logo_files(
    logos_dir: Path | str | None = None,
    waveframe_source: Path | str | None = None,
    data_dir: Path | str | None = None,
) -> dict[str, Path]:
    """Return paths to the three logo input images, creating only missing ones.

    Existing files are authoritative: editing ``logos/<name>.png`` changes
    what gets sampled.  WaveFrame can additionally be re-baked from
    ``assets/source/waveframe.png`` when that source changes, tracked by a
    small SHA-256 stamp under ``data``.
    """
    # Late-bound defaults so tests can monkeypatch module path globals.
    if logos_dir is None:
        logos_dir = LOGOS
    if data_dir is None:
        data_dir = DATA
    logos_dir = Path(logos_dir)
    data_dir = Path(data_dir)
    logos_dir.mkdir(parents=True, exist_ok=True)
    if waveframe_source is None:
        waveframe_source = ROOT / "assets/source/waveframe.png"
    waveframe_source = Path(waveframe_source)

    wf_path = logos_dir / "waveframe.png"
    stamp_path = data_dir / "waveframe.source.sha256"

    if waveframe_source.exists():
        source_digest = sha256_file(waveframe_source)
        previous = stamp_path.read_text(encoding="utf-8").strip() if stamp_path.exists() else None
        if not wf_path.exists():
            # Missing logo: bake it from the source artwork.
            waveframe = build_waveframe_logo(waveframe_source)
            if waveframe is not None:
                waveframe.save(wf_path, optimize=True)
                data_dir.mkdir(parents=True, exist_ok=True)
                stamp_path.write_text(source_digest, encoding="utf-8")
        elif previous is not None and previous != source_digest:
            # We previously tracked this source and it changed -> re-bake.
            # A missing stamp alone never overwrites an existing logo, so
            # hand-edited / fixture-supplied logo PNGs stay authoritative.
            waveframe = build_waveframe_logo(waveframe_source)
            if waveframe is not None:
                waveframe.save(wf_path, optimize=True)
                data_dir.mkdir(parents=True, exist_ok=True)
                stamp_path.write_text(source_digest, encoding="utf-8")
        elif previous is None:
            # Adopt the existing logo and remember the current source state.
            data_dir.mkdir(parents=True, exist_ok=True)
            stamp_path.write_text(source_digest, encoding="utf-8")

    if not (logos_dir / "code.png").exists():
        build_code_logo().save(logos_dir / "code.png", optimize=True)
    if not (logos_dir / "react.png").exists():
        build_react_logo().save(logos_dir / "react.png", optimize=True)
    if not wf_path.exists():
        build_placeholder_logo().save(wf_path, optimize=True)

    return {name: logos_dir / f"{name}.png" for name in LOGO_NAMES}


# ---------------------------------------------------------------------------
# Portrait dithering
# ---------------------------------------------------------------------------


def active_portrait_source(override: Path | str | None = None) -> Path:
    """Resolve the avatar input, preserving the historical ``mmr.png`` hook."""
    if override is not None:
        return Path(override)
    double_m = ROOT / "assets/source/mmr.png"
    return double_m if double_m.exists() else SOURCE


def floyd_steinberg(gray: np.ndarray) -> np.ndarray:
    """Serpentine 1-bit Floyd-Steinberg diffusion; True means a lit pixel."""
    work = gray.astype(np.float32) / 255.0
    out = np.zeros_like(work, dtype=bool)
    height, width = work.shape
    for y in range(height):
        left_to_right = y % 2 == 0
        xs = range(width) if left_to_right else range(width - 1, -1, -1)
        direction = 1 if left_to_right else -1
        for x in xs:
            old = work[y, x]
            new = 1.0 if old >= 0.5 else 0.0
            out[y, x] = bool(new)
            err = old - new
            nx = x + direction
            if 0 <= nx < width:
                work[y, nx] += err * 7 / 16
            if y + 1 < height:
                if 0 <= x - direction < width:
                    work[y + 1, x - direction] += err * 3 / 16
                work[y + 1, x] += err * 5 / 16
                if 0 <= nx < width:
                    work[y + 1, nx] += err * 1 / 16
    return out


def portrait_points(
    theme: str,
    rng: np.random.Generator,
    source_path: Path | str | None = None,
) -> np.ndarray:
    """Return sampled x/y banner coordinates from a 300x340 dither grid."""
    src_path = active_portrait_source(source_path)
    source = Image.open(src_path).convert("RGBA")
    alpha_arr = np.asarray(source.getchannel("A"))
    ys_a, xs_a = np.where(alpha_arr > 20)
    if len(xs_a) > 0:
        min_x, max_x = xs_a.min(), xs_a.max()
        min_y, max_y = ys_a.min(), ys_a.max()
        sub_h = max_y - min_y
        target_aspect = 300.0 / 340.0
        crop_bottom = min_y + int(sub_h * 0.75)
        crop_top = min_y
        crop_h = crop_bottom - crop_top
        crop_w = int(crop_h * target_aspect)
        center_x = (min_x + max_x) // 2
        crop_left = max(0, center_x - crop_w // 2)
        crop_right = min(source.width, crop_left + crop_w)
        crop = source.crop((crop_left, crop_top, crop_right, crop_bottom)).resize((300, 340), Image.Resampling.LANCZOS)
    else:
        crop = source.resize((300, 340), Image.Resampling.LANCZOS)
    rgb = crop.convert("RGB")
    alpha = np.asarray(crop.getchannel("A"), dtype=np.float32) / 255.0

    if theme == "dark":
        lum = np.asarray(ImageOps.grayscale(rgb), dtype=np.float32)
        prepared = Image.fromarray(np.uint8(np.clip(lum * alpha, 0, 255)), "L")
        select_lit = True
    else:
        white = Image.new("RGBA", crop.size, "white")
        white.alpha_composite(crop)
        prepared = ImageOps.grayscale(white.convert("RGB"))
        select_lit = False

    # Equalize against the subject only (ignore empty alpha) so lit skin vs dark
    # hair doesn't crush midtones; then punch local contrast for facial edges.
    if theme == "dark":
        mask = Image.fromarray(np.uint8((alpha > 0.08) * 255), "L")
        prepared = ImageOps.equalize(prepared, mask=mask)
    else:
        prepared = ImageOps.autocontrast(prepared, cutoff=1)
    prepared = ImageEnhance.Contrast(prepared).enhance(1.35)
    prepared = prepared.filter(ImageFilter.UnsharpMask(radius=2, percent=175, threshold=1))
    bits = floyd_steinberg(np.asarray(prepared))
    active = bits if select_lit else ~bits
    if theme == "dark":
        active &= alpha > 0.08

    # Keep the full 300×340 lattice — skipping 2×2 cells was the soft/blurry look.
    ys, xs = np.where(active)
    if len(xs) == 0:
        return np.zeros((0, 2), dtype=np.float32)
    points = np.column_stack((74 + xs, 154 + ys)).astype(np.float32)
    if len(points) > 18000:
        points = points[rng.choice(len(points), 18000, replace=False)]
    return points


# ---------------------------------------------------------------------------
# Logo point sampling + content-addressed cache
# ---------------------------------------------------------------------------


def sample_logo_points(
    image: Image.Image, rng: np.random.Generator, count: int
) -> np.ndarray:
    """Sample a silhouette into the portrait frame's visual coordinate space."""
    if image.mode != "RGBA":
        image = image.convert("RGBA")
    alpha = np.asarray(image.getchannel("A"))
    ys, xs = np.where(alpha > 127)
    if len(xs) == 0:
        # Degenerate / fully transparent fixture: sit on the logo centre.
        center = np.array([[89 + 200 * 0.675, 188 + 200 * 0.675]], dtype=np.float32)
        return np.repeat(center, count, axis=0)
    chosen = rng.choice(len(xs), count, replace=len(xs) < count)
    # Logo occupies a centered 270x270 square inside VISUAL.MAP.
    return np.column_stack((89 + xs[chosen] * 0.675, 188 + ys[chosen] * 0.675)).astype(
        np.float32
    )


def build_logo_cache_key(
    logo_paths: dict[str, Path],
    count: int,
    extra_inputs: dict[str, str] | None = None,
) -> tuple[str, dict]:
    """Content-addressed key covering every input of logo sampling."""
    payload = {
        "cache_version": CACHE_VERSION,
        "traveller_count": int(count),
        # Preserves the historical dark-theme sampling stream / point order.
        "logo_seed": SEED + 100,
        "logo_names": list(LOGO_NAMES),
        "sampling": {
            "alpha_threshold": 127,
            "scale": 0.675,
            "offset_x": 89,
            "offset_y": 188,
        },
        "logos": {name: sha256_file(path) for name, path in logo_paths.items()},
        "extra_inputs": dict(sorted((extra_inputs or {}).items())),
    }
    canonical = json.dumps(payload, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest(), payload


def _load_logo_cache(
    npz_path: Path, meta_path: Path, key: str, names: tuple[str, ...], count: int
) -> dict[str, np.ndarray] | None:
    try:
        meta = json.loads(meta_path.read_text(encoding="utf-8"))
        if meta.get("key") != key:
            return None
        with np.load(npz_path) as archive:
            samples = {name: np.asarray(archive[name], dtype=np.float32) for name in names}
        for array in samples.values():
            if array.shape != (count, 2) or not np.all(np.isfinite(array)):
                return None
        return samples
    except Exception:
        # Any missing / corrupt / incompatible cache artifact -> rebuild.
        return None


def get_logo_samples(
    logo_paths: dict[str, Path],
    count: int,
    data_dir: Path | str | None = None,
    extra_inputs: dict[str, str] | None = None,
) -> tuple[dict[str, np.ndarray], bool, str]:
    """Return shared logo samples, reusing the disk cache when inputs match.

    Returns ``(samples, cache_hit, key)``.  On a miss the logos are sampled
    once with a single seeded RNG and the cache files are (re)built.
    """
    if data_dir is None:
        data_dir = DATA
    data_dir = Path(data_dir)
    data_dir.mkdir(parents=True, exist_ok=True)
    key, payload = build_logo_cache_key(logo_paths, count, extra_inputs)
    npz_path = data_dir / f"{LOGO_CACHE_STEM}.npz"
    meta_path = data_dir / f"{LOGO_CACHE_STEM}.meta.json"

    cached = _load_logo_cache(npz_path, meta_path, key, LOGO_NAMES, count)
    if cached is not None:
        return cached, True, key

    # Single RNG, fixed name order -> deterministic and identical for themes.
    rng = np.random.default_rng(SEED + 100)
    samples: dict[str, np.ndarray] = {}
    for name in LOGO_NAMES:
        with Image.open(logo_paths[name]) as raw:
            image = raw.convert("RGBA")
        # Resolve through the module global so tests that monkeypatch
        # ``generate.sample_logo_points`` observe the call on a cold cache.
        samples[name] = sample_logo_points(image, rng, count)

    # Primary reusable cache artifact.
    np.savez(npz_path, **samples)
    meta = dict(payload)
    meta["key"] = key
    meta["shapes"] = {name: list(array.shape) for name, array in samples.items()}
    meta_path.write_text(json.dumps(meta, indent=2, sort_keys=True), encoding="utf-8")

    # Convenience mirrors: theme-less arrays plus the historical per-theme
    # filenames, now populated with the *same* shared points so dark/light
    # point order cannot drift on disk either.
    for name, array in samples.items():
        save_npy_if_changed(data_dir / f"{name}.npy", array)
        save_npy_if_changed(data_dir / f"{name}-dark.npy", array)
        save_npy_if_changed(data_dir / f"{name}-light.npy", array)

    return samples, False, key


# ---------------------------------------------------------------------------
# Shared animation skeleton
# ---------------------------------------------------------------------------


def transport(source: np.ndarray, target: np.ndarray) -> np.ndarray:
    """Order target points by minimum-cost assignment from source points."""
    rows, cols = linear_sum_assignment(cdist(source, target, metric="sqeuclidean"))
    ordered = np.empty_like(target)
    ordered[rows] = target[cols]
    return ordered


def num(value: float) -> str:
    return f"{value:.1f}".rstrip("0").rstrip(".")


def animate_values(points: list[np.ndarray], index: int) -> str:
    return ";".join(f"{num(p[index, 0])} {num(p[index, 1])}" for p in points)


def shared_coordinate_pool(portraits: dict[str, np.ndarray]) -> np.ndarray:
    """Deduped union of both dither lattices as one canonical source pool."""
    arrays = [points for points in portraits.values() if len(points)]
    if not arrays:
        return np.zeros((0, 2), dtype=np.float32)
    joined = np.concatenate(arrays, axis=0)
    return np.unique(joined, axis=0).astype(np.float32)


def grid_source(count: int) -> np.ndarray:
    """Deterministic fallback inside the portrait frame for empty fixtures."""
    if count <= 0:
        return np.zeros((0, 2), dtype=np.float32)
    cols = int(math.ceil(math.sqrt(count * 300.0 / 340.0)))
    rows_n = int(math.ceil(count / cols))
    xs = np.linspace(80, 368, cols)
    ys = np.linspace(160, 488, rows_n)
    grid = np.array([(x, y) for y in ys for x in xs], dtype=np.float32)
    return grid[:count]


class Skeleton:
    """All theme-independent animation data shared by dark and light."""

    def __init__(
        self,
        count: int,
        key_times: str,
        opacity_values: str,
        source: np.ndarray,
        frames: list[np.ndarray],
        travel_values: list[str],
        band_values: list[str],
        intro_starts: np.ndarray,
    ) -> None:
        self.count = count
        self.key_times = key_times
        self.opacity_values = opacity_values
        self.source = source
        self.frames = frames
        self.travel_values = travel_values
        self.band_values = band_values
        self.intro_starts = intro_starts


def build_skeleton(
    portraits: dict[str, np.ndarray],
    logo_points: dict[str, np.ndarray],
    count: int,
) -> Skeleton:
    """Compute traveller selection, OT chain and timeline exactly once."""
    pool = shared_coordinate_pool(portraits)
    source_rng = np.random.default_rng(SEED + 200)
    if len(pool) == 0:
        source = grid_source(count)
        cloud = source
    else:
        # Replacement only for tiny fixtures whose pool is below requested
        # count, so the number of traveller sequences stays predictable.
        chosen = source_rng.choice(len(pool), count, replace=len(pool) < count)
        source = pool[chosen]
        cloud = pool

    waveframe = transport(source, logo_points["waveframe"][:count])
    code = transport(waveframe, logo_points["code"][:count])
    react = transport(code, logo_points["react"][:count])

    # Returning each traveller to its exact starting portrait coordinate keeps
    # the repeat boundary seamless. All logo-to-logo morphs use optimal transport.
    frames = [source, source, waveframe, waveframe, code, code, react, react, source]
    key_times = ";".join(num(value / LOOP_SECONDS) for value in KEYFRAME_TIMES)
    travel_values = [animate_values(frames, i) for i in range(count)]

    # Shared per-band drift vectors.  Computed once against the common pool so
    # every band animateTransform in dark and light carries identical values.
    band_rng = np.random.default_rng(SEED + 300)
    band_ids = band_rng.integers(0, BAND_COUNT, size=len(cloud))
    noise = band_rng.normal(0, 4, size=(BAND_COUNT, 2))
    waveframe_centroid = waveframe.mean(axis=0)
    global_centroid = cloud.mean(axis=0) if len(cloud) else waveframe_centroid
    band_values: list[str] = []
    for band in range(BAND_COUNT):
        pts = cloud[band_ids == band] if len(cloud) else cloud
        centroid = pts.mean(axis=0) if len(pts) else global_centroid
        delta = (waveframe_centroid - centroid) * 0.18 + noise[band]
        pair = f"{num(delta[0])} {num(delta[1])}"
        band_values.append(
            f"0 0;0 0;{pair};{pair};0 0;0 0;0 0;0 0;0 0"
        )

    # Shared intro stagger table (group index -> begin time).
    intro_rng = np.random.default_rng(SEED + 400)
    order = intro_rng.permutation(INTRO_GROUPS)
    intro_starts = np.empty(INTRO_GROUPS)
    intro_starts[order] = np.linspace(0.05, 1.2, INTRO_GROUPS)

    return Skeleton(
        count=count,
        key_times=key_times,
        opacity_values=OPACITY_VALUES,
        source=source,
        frames=frames,
        travel_values=travel_values,
        band_values=band_values,
        intro_starts=intro_starts,
    )


# ---------------------------------------------------------------------------
# SVG rendering (markup unchanged apart from consuming the shared skeleton)
# ---------------------------------------------------------------------------


def point_path(points: np.ndarray) -> str:
    """Aggregate adjacent horizontal one-pixel dots into compact SVG path runs."""
    if not len(points):
        return ""
    integer = np.rint(points).astype(int)
    unique = sorted({(int(x), int(y)) for x, y in integer}, key=lambda p: (p[1], p[0]))
    chunks: list[str] = []
    i = 0
    while i < len(unique):
        x0, y = unique[i]
        x1 = x0
        i += 1
        while i < len(unique) and unique[i][1] == y and unique[i][0] <= x1 + 1:
            x1 = unique[i][0]
            i += 1
        chunks.append(f"M{x0} {y}h{x1 - x0 + 1}")
    return "".join(chunks)


def dotted_leader(x1: float, x2: float, y: float) -> str:
    if x2 <= x1:
        return ""
    return "".join(f"M{x} {num(y)}h1" for x in np.arange(x1, x2, 5.0))


def text_width(text: str, font_size: float) -> float:
    """Stable monospace width used both for textLength and leader placement."""
    return len(text) * font_size * 0.605


def render_svg(
    theme_name: str,
    portrait: np.ndarray,
    skeleton: Skeleton,
    grouping_seed: int,
) -> str:
    t = THEMES[theme_name]
    n = skeleton.count

    # Theme-specific partition of that theme's own dither lattice into drift
    # bands / intro groups.  Only the path ``d`` data depends on this; all
    # animateTransform values come from the shared skeleton.
    grouping_rng = np.random.default_rng(grouping_seed)
    band_ids = grouping_rng.integers(0, BAND_COUNT, size=len(portrait))
    intro_ids = grouping_rng.integers(0, INTRO_GROUPS, size=len(portrait))

    parts: list[str] = [
        '<svg xmlns="http://www.w3.org/2000/svg" '
        f'width="{W}" height="{H}" viewBox="0 0 {W} {H}" role="img" '
        'aria-labelledby="title desc">',
        "<title id=\"title\">Ramiro's live system profile</title>",
        '<desc id="desc">Animated terminal profile with a dithered portrait and '
        "WaveFrame Studio, code, and React silhouettes.</desc>",
        "<defs>",
        '<filter id="shadow" x="-20%" y="-20%" width="140%" height="150%">'
        f'<feDropShadow dx="0" dy="12" stdDeviation="16" flood-color="{t["shadow"]}" '
        'flood-opacity=".28"/></filter>',
        '<filter id="glow" x="-100%" y="-100%" width="300%" height="300%">'
        f'<feGaussianBlur stdDeviation="3" result="b"/><feFlood flood-color="{t["chrome"]}" '
        'flood-opacity=".35"/><feComposite in2="b" operator="in"/>'
        '<feMerge><feMergeNode/><feMergeNode in="SourceGraphic"/></feMerge></filter>',
        '<clipPath id="visualClip"><rect x="49" y="124" width="390" height="414" rx="3"/></clipPath>',
        "</defs>",
        f'<rect width="{W}" height="{H}" rx="18" fill="{t["bg"]}"/>',
        f'<rect x="13" y="13" width="1154" height="584" rx="13" fill="{t["panel"]}" '
        f'stroke="{t["line"]}" filter="url(#shadow)"/>',
        f'<path d="M13 62H1167" stroke="{t["line"]}"/>',
        '<circle cx="38" cy="38" r="6" fill="#FF5F57"/>'
        '<circle cx="59" cy="38" r="6" fill="#FEBC2E"/>'
        '<circle cx="80" cy="38" r="6" fill="#28C840"/>',
        f'<text x="590" y="43" text-anchor="middle" fill="{t["muted"]}" '
        'font-family="ui-monospace,SFMono-Regular,Consolas,monospace" font-size="13" '
        'letter-spacing=".4">profile.sh --live</text>',
        # Left visual frame.
        f'<rect x="35" y="88" width="418" height="472" rx="6" fill="{t["panel2"]}" '
        f'stroke="{t["line"]}"/>',
        f'<path d="M35 124H453" stroke="{t["line"]}"/>',
        f'<text x="49" y="111" fill="{t["chrome"]}" '
        'font-family="ui-monospace,SFMono-Regular,Consolas,monospace" font-size="13" '
        'font-weight="700" letter-spacing="1.2">VISUAL.MAP</text>',
        f'<text x="438" y="111" text-anchor="end" fill="{t["muted"]}" '
        'font-family="ui-monospace,SFMono-Regular,Consolas,monospace" font-size="11">300×340 / 1-BIT</text>',
        f'<path d="M49 141h12M49 141v12M439 141h-12M439 141v12M49 539h12M49 539v-12'
        f'M439 539h-12M439 539v-12" fill="none" stroke="{t["chrome"]}" opacity=".55"/>',
        '<g clip-path="url(#visualClip)" shape-rendering="crispEdges">',
        # Loop layer stays visible at t=0 so camo/static first frames still show the face.
        # Intro duplicate below shimmers on top, then hands off at 3.2s.
        '<g opacity="1">',
    ]

    # Dense portrait drift: fixed bands moving toward waveframe's centroid.
    # Every band slot is emitted (even if empty for tiny fixtures) so the
    # animateTransform sequence aligns one-to-one across themes.
    for band in range(BAND_COUNT):
        pts = portrait[band_ids == band]
        d = point_path(pts)
        parts.append(
            f'<path d="{d}" fill="none" stroke="{t["portrait"]}" stroke-width="1" '
            'opacity=".94">'
            f'<animateTransform attributeName="transform" type="translate" begin="{INTRO_SECONDS}s" '
            f'dur="{LOOP_SECONDS}s" repeatCount="indefinite" calcMode="linear" '
            f'keyTimes="{skeleton.key_times}" values="{skeleton.band_values[band]}"/>'
            f'<animate attributeName="opacity" begin="{INTRO_SECONDS}s" dur="{LOOP_SECONDS}s" '
            f'repeatCount="indefinite" keyTimes="{skeleton.key_times}" '
            'values=".94;.94;0;0;0;0;0;0;.94"/></path>'
        )

    # Optimal-transport travellers, represented as tiny path squares (never glyphs).
    # The value strings are built once in the shared skeleton.
    for i in range(n):
        positions = skeleton.travel_values[i]
        parts.append(
            f'<path d="M-.65-.65h1.3v1.3h-1.3z" fill="{t["portrait"]}">'
            f'<animateTransform attributeName="transform" type="translate" begin="{INTRO_SECONDS}s" '
            f'dur="{LOOP_SECONDS}s" repeatCount="indefinite" calcMode="linear" '
            f'keyTimes="{skeleton.key_times}" values="{positions}"/>'
            f'<animate attributeName="opacity" begin="{INTRO_SECONDS}s" dur="{LOOP_SECONDS}s" '
            f'repeatCount="indefinite" calcMode="linear" keyTimes="{skeleton.key_times}" '
            f'values="{skeleton.opacity_values}"/></path>'
        )
    parts.append("</g>")

    # One-shot scattered intro: interleaved point groups with a shared timeline.
    for group in range(INTRO_GROUPS):
        pts = portrait[intro_ids == group]
        parts.append(
            f'<path d="{point_path(pts)}" fill="none" stroke="{t["portrait"]}" '
            'stroke-width="1" opacity="0">'
            f'<animate attributeName="opacity" begin="{num(skeleton.intro_starts[group])}s" dur=".8s" '
            'values="0;1" fill="freeze"/>'
            '<animate attributeName="opacity" begin="3.08s" dur=".12s" values="1;0" fill="freeze"/>'
            "</path>"
        )
    parts.extend(
        [
            "</g>",
            # Small frame telemetry.
            f'<text x="58" y="551" fill="{t["muted"]}" '
            'font-family="ui-monospace,SFMono-Regular,Consolas,monospace" font-size="10">'
            f'PTS {len(portrait):05d} · FS/SERPENTINE</text>',
            # Right information panel.
            f'<rect x="474" y="88" width="672" height="472" rx="6" fill="{t["panel2"]}" '
            f'stroke="{t["line"]}"/>',
            f'<path d="M474 124H1146" stroke="{t["line"]}"/>',
            f'<text x="490" y="111" fill="{t["chrome"]}" '
            'font-family="ui-monospace,SFMono-Regular,Consolas,monospace" font-size="13" '
            'font-weight="700" letter-spacing="1.2">SYSTEM.INFO</text>',
            # LIVE badge and handle pill.
            '<g filter="url(#glow)"><circle cx="915" cy="106" r="4" fill="#FF4D5A">'
            '<animate attributeName="opacity" values="1;.3;1" dur="1.6s" repeatCount="indefinite"/>'
            '</circle></g>',
            '<text x="927" y="111" text-anchor="middle" fill="#FF4D5A" '
            'font-family="ui-monospace,SFMono-Regular,Consolas,monospace" font-size="12" '
            'font-weight="700">LIVE</text>',
            f'<rect x="982" y="94" width="146" height="24" rx="12" fill="{t["chrome"]}" opacity=".16" '
            f'stroke="{t["chrome"]}"/>',
            f'<text x="1055" y="111" text-anchor="middle" fill="{t["chrome"]}" '
            'font-family="ui-monospace,SFMono-Regular,Consolas,monospace" font-size="14" '
            'font-weight="700">@ramirolacci</text>',
        ]
    )

    value_right = 1127.0
    row_y = 153.0
    for label, value in ROWS:
        value_len = text_width(value, 14)
        label_len = text_width(label, 14)
        leader_start = 491 + label_len + 12
        leader_end = value_right - value_len - 12
        parts.extend(
            [
                f'<text x="491" y="{num(row_y)}" fill="{t["muted"]}" '
                'font-family="ui-monospace,SFMono-Regular,Consolas,monospace" font-size="14">'
                f"{html.escape(label)}</text>",
                f'<path d="{dotted_leader(leader_start, leader_end, row_y - 4)}" '
                f'fill="none" stroke="{t["line"]}" stroke-width="1" shape-rendering="crispEdges"/>',
                f'<text x="{num(value_right)}" y="{num(row_y)}" text-anchor="end" '
                f'fill="{t["text"]}" font-family="ui-monospace,SFMono-Regular,Consolas,monospace" '
                f'font-size="14" textLength="{num(value_len)}" lengthAdjust="spacingAndGlyphs">'
                f"{html.escape(value)}</text>",
            ]
        )
        row_y += 23

    parts.extend(
        [
            f'<path d="M490 530H1130" stroke="{t["line"]}"/>',
            f'<text x="491" y="548" fill="{t["accent"]}" '
            'font-family="ui-monospace,SFMono-Regular,Consolas,monospace" font-size="11">'
            "● ALL SYSTEMS NOMINAL</text>",
            f'<text x="1128" y="548" text-anchor="end" fill="{t["muted"]}" '
            'font-family="ui-monospace,SFMono-Regular,Consolas,monospace" font-size="11">'
            "UTC-4 · LATAM NODE</text>",
            "</svg>",
        ]
    )
    return "".join(parts)


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------


def build_arg_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Generate dark/light animated profile banners with a shared skeleton."
    )
    parser.add_argument("--count", type=int, default=None,
                        help="Traveller count (defaults to the TRAVELLER_COUNT constant).")
    parser.add_argument("--portrait", type=Path, default=None,
                        help="Override the avatar source image.")
    parser.add_argument("--logos-dir", type=Path, default=None,
                        help="Directory containing waveframe/code/react logo PNGs.")
    parser.add_argument("--data-dir", type=Path, default=None,
                        help="Directory for portrait arrays and the logo cache.")
    parser.add_argument("--assets-dir", type=Path, default=None,
                        help="Directory for banner-{dark,light}.v9.svg outputs.")
    parser.add_argument("--waveframe-source", type=Path, default=None,
                        help="Override the source artwork used to bake waveframe.png.")
    return parser


def main(argv: list[str] | None = None) -> None:
    # When called programmatically (e.g. generate.main()) parse no arguments so
    # an ambient pytest argv cannot leak into argparse.  The __main__ block
    # forwards the real command line explicitly.  parse_known_args keeps the
    # historical leniency of ignoring any unrecognised arguments.
    args, _unknown = build_arg_parser().parse_known_args(
        [] if argv is None else list(argv)
    )

    portrait_source = active_portrait_source(args.portrait if args.portrait is not None else None)
    assets_dir = Path(args.assets_dir) if args.assets_dir is not None else ASSETS
    logos_dir = Path(args.logos_dir) if args.logos_dir is not None else LOGOS
    data_dir = Path(args.data_dir) if args.data_dir is not None else DATA
    if args.waveframe_source is not None:
        waveframe_source = args.waveframe_source
    else:
        waveframe_source = ROOT / "assets/source/waveframe.png"
    count = int(args.count) if args.count is not None else int(TRAVELLER_COUNT)

    if not portrait_source.exists():
        raise SystemExit(f"Missing source portrait: {portrait_source}")
    assets_dir.mkdir(parents=True, exist_ok=True)
    data_dir.mkdir(parents=True, exist_ok=True)

    logo_paths = ensure_logo_files(logos_dir, waveframe_source, data_dir)

    # The WaveFrame source artwork is an indirect logo input (it bakes
    # logos/waveframe.png), so include its bytes in the cache identity.
    # The avatar intentionally does NOT belong here: it never changes logo
    # samples (the shared source selection is rebuilt from the portraits).
    extra_inputs: dict[str, str] = {}
    if Path(waveframe_source).exists():
        extra_inputs["waveframe_source"] = sha256_file(waveframe_source)

    logo_points, cache_hit, cache_key = get_logo_samples(
        logo_paths, count, data_dir, extra_inputs
    )
    cache_file = data_dir / f"{LOGO_CACHE_STEM}.npz"
    if cache_hit:
        log(
            f"[cache] logo samples cache-hit status=HIT (cached, reused / "
            f"标志采样缓存命中、复用缓存): reusing {display_path(cache_file)} "
            f"without resampling (key {cache_key[:10]}, count={count})"
        )
    else:
        log(
            f"[cache] logo samples cache-miss status=MISS (invalidated by changed "
            f"inputs; rebuilt and regenerated / 标志采样缓存未命中或已失效、失效重建并"
            f"重新生成): {display_path(cache_file)} "
            f"(key {cache_key[:10]}, count={count})"
        )

    # Cache theme-specific dither points as reproducible source data.
    portraits: dict[str, np.ndarray] = {}
    for index, theme in enumerate(THEME_ORDER):
        rng = np.random.default_rng(SEED + index)
        points = portrait_points(theme, rng, portrait_source)
        portraits[theme] = points
        save_npy_if_changed(data_dir / f"portrait-{theme}.npy", points)

    # Shared animation skeleton: selected / ordered once for both themes.
    skeleton = build_skeleton(portraits, logo_points, count)
    save_npy_if_changed(data_dir / "traveller-source.npy", skeleton.source)
    save_npy_if_changed(
        data_dir / "animation-frames.npy",
        np.stack(skeleton.frames).astype(np.float32),
    )

    for index, theme in enumerate(THEME_ORDER):
        svg = render_svg(theme, portraits[theme], skeleton, SEED + 100 + index)
        output = assets_dir / f"banner-{theme}.v9.svg"
        output.write_text(svg, encoding="utf-8")
        byte_size = output.stat().st_size
        print(
            f"{display_path(output)}: {byte_size:,} bytes "
            f"({byte_size / 1024:.1f} KiB), {len(portraits[theme]):,} portrait dots, "
            f"{skeleton.count} travellers"
        )

    for name in LOGO_NAMES:
        output = logo_paths[name]
        if output.exists():
            print(f"{display_path(output)}: {output.stat().st_size:,} bytes")


if __name__ == "__main__":
    import sys

    for stream in (sys.stdout, sys.stderr):
        reconfigure = getattr(stream, "reconfigure", None)
        if reconfigure is not None:
            try:
                reconfigure(encoding="utf-8", errors="replace")
            except (ValueError, OSError):
                pass
    main(sys.argv[1:])
