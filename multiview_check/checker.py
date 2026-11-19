import hashlib
import json
import math
import warnings
from pathlib import Path, PureWindowsPath

from PIL import Image, UnidentifiedImageError


def finite_number(value):
    try:
        return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)
    except OverflowError:
        return False


def matrix(value, size):
    return (isinstance(value, list) and len(value) == size
            and all(isinstance(row, list) and len(row) == size
                    and all(finite_number(v) for v in row) for row in value))


def determinant(r):
    return (r[0][0] * (r[1][1]*r[2][2]-r[1][2]*r[2][1])
            - r[0][1] * (r[1][0]*r[2][2]-r[1][2]*r[2][0])
            + r[0][2] * (r[1][0]*r[2][1]-r[1][1]*r[2][0]))


def safe_path(root, value):
    if not isinstance(value, str) or not value or '\0' in value or Path(value).is_absolute() or PureWindowsPath(value).is_absolute():
        return None
    try:
        result = (root / value).resolve()
    except (OSError, ValueError):
        return None
    return result if result.is_relative_to(root) else None


def check_dataset(manifest_path):
    manifest_path = Path(manifest_path).resolve()
    root = manifest_path.parent
    issues, cameras = [], []

    def issue(code, severity, frame, message):
        issues.append(dict(code=code, severity=severity, frame=frame, message=message))

    def finish(frame_count=0, convention=None, units=None):
        return dict(schema_version=1, manifest=manifest_path.name,
                    convention=convention if isinstance(convention, str) else None,
                    units=units if isinstance(units, str) else None,
                    summary=dict(frames=frame_count, errors=sum(x['severity']=='error' for x in issues),
                                 warnings=sum(x['severity']=='warning' for x in issues), cameras=len(cameras)),
                    issues=issues, cameras=cameras)

    try:
        data = json.loads(manifest_path.read_text(encoding='utf-8-sig'))
    except (OSError, ValueError, UnicodeError):
        issue('manifest_read', 'error', None, 'Cannot read a valid UTF-8 JSON manifest.')
        return finish()
    if not isinstance(data, dict) or data.get('schema_version') != 1 or isinstance(data.get('schema_version'), bool):
        issue('schema', 'error', None, 'Expected an object with schema_version: 1.')
        return finish()
    convention = data.get('convention')
    if convention not in ('camera_to_world', 'world_to_camera'):
        issue('convention', 'error', None, 'Specify camera_to_world or world_to_camera; convention is never inferred.')
    units = data.get('units')
    if units != 'm':
        issue('units', 'error', None, 'v0.1 expects world translations in meters (units: m).')
    frames = data.get('frames')
    if not isinstance(frames, list) or not frames:
        issue('frames', 'error', None, 'frames must be a non-empty list.')
        return finish(convention=convention, units=units)
    ids, image_paths, digests, timestamps = set(), set(), {}, set()
    last_time = None
    for index, frame in enumerate(frames):
        label = str(index)
        if not isinstance(frame, dict):
            issue('frame_schema', 'error', label, 'Frame must be an object.')
            continue
        frame_id = frame.get('id')
        if not isinstance(frame_id, str) or not frame_id:
            issue('frame_id', 'error', label, 'id must be a non-empty string.')
        else:
            label = frame_id
            if frame_id in ids:
                issue('duplicate_id', 'error', label, 'Frame id is repeated.')
            ids.add(frame_id)
        dimensions = [frame.get('width'), frame.get('height')]
        size_ok = all(isinstance(n, int) and not isinstance(n, bool) and n > 0 for n in dimensions)
        if not size_ok:
            issue('dimensions', 'error', label, 'width and height must be positive integers.')
        path = safe_path(root, frame.get('image'))
        actual_size = None
        if path is None:
            issue('image_path', 'error', label, 'Image must be a relative path inside the dataset directory, including symlink resolution.')
        else:
            if path in image_paths:
                issue('duplicate_path', 'warning', label, 'Multiple frames reference the same image path.')
            image_paths.add(path)
            if not path.is_file():
                issue('image_missing', 'error', label, 'Referenced image file is missing.')
            elif path.stat().st_size > 64 * 1024 * 1024:
                issue('image_size_limit', 'error', label, 'Image exceeds the v0.1 64 MiB inspection limit; not decoded.')
            else:
                try:
                    with warnings.catch_warnings():
                        warnings.simplefilter('error', Image.DecompressionBombWarning)
                        with Image.open(path) as image:
                            image.verify()
                        with Image.open(path) as image:
                            image.load()
                            actual_size = image.size
                    digest = hashlib.sha256(path.read_bytes()).hexdigest()
                    if digest in digests:
                        issue('duplicate_content', 'warning', label, 'Exact encoded image duplicate of frame '+digests[digest]+'.')
                    else:
                        digests[digest] = label
                except (OSError, ValueError, UnidentifiedImageError, Image.DecompressionBombError, Image.DecompressionBombWarning):
                    issue('image_decode', 'error', label, 'Image cannot be fully decoded within Pillow safety limits.')
                if actual_size and size_ok and list(actual_size) != dimensions:
                    issue('image_dimensions', 'error', label, 'Declared dimensions differ from the decoded image.')
        k = frame.get('K')
        if not matrix(k, 3):
            issue('intrinsics', 'error', label, 'K must be a finite 3x3 matrix.')
        else:
            if k[0][0] <= 0 or k[1][1] <= 0 or abs(k[1][0]) > 1e-6 or any(abs(a-b)>1e-6 for a,b in zip(k[2],[0,0,1])):
                issue('intrinsics', 'error', label, 'K needs positive focal lengths, upper triangular form and final row [0,0,1].')
            image_size = actual_size or (dimensions if size_ok else None)
            if image_size and not (0 <= k[0][2] < image_size[0] and 0 <= k[1][2] < image_size[1]):
                issue('principal_point', 'warning', label, 'Principal point is outside image bounds; verify crop/resize calibration.')
        pose = frame.get('pose')
        if not matrix(pose, 4):
            issue('pose_shape', 'error', label, 'pose must be a finite 4x4 matrix.')
        elif any(abs(a-b)>1e-6 for a,b in zip(pose[3],[0,0,0,1])):
            issue('pose_homogeneous', 'error', label, 'Final homogeneous row must be [0,0,0,1].')
        else:
            r = [row[:3] for row in pose[:3]]
            orthogonal_error = max(abs(sum(r[k][i]*r[k][j] for k in range(3)) - (i==j)) for i in range(3) for j in range(3))
            if orthogonal_error > 1e-3 or abs(determinant(r)-1) > 1e-3:
                issue('rotation', 'error', label, 'Rotation must be orthonormal with determinant +1 (tolerance 1e-3).')
            elif convention in ('camera_to_world','world_to_camera') and units == 'm':
                t = [row[3] for row in pose[:3]]
                if convention == 'camera_to_world':
                    center, forward = t, [row[2] for row in r]
                else:
                    center = [-sum(r[k][i]*t[k] for k in range(3)) for i in range(3)]
                    forward = r[2]
                if all(finite_number(v) for v in center):
                    cameras.append(dict(id=label, center=center, forward=forward))
                else:
                    issue('camera_center', 'error', label, 'Camera center cannot be represented as finite coordinates.')
        if 'timestamp' in frame:
            timestamp = frame['timestamp']
            if not finite_number(timestamp):
                issue('timestamp', 'error', label, 'Optional timestamp must be finite seconds.')
            else:
                if timestamp in timestamps:
                    issue('duplicate_timestamp','warning',label,'Timestamp is repeated.')
                if last_time is not None and timestamp < last_time:
                    issue('timestamp_order','warning',label,'Timestamp decreases in manifest order.')
                timestamps.add(timestamp)
                last_time = timestamp
    extras = [p for p in root.rglob('*') if p.suffix.lower() in ('.png','.jpg','.jpeg','.webp')
              and p.is_file() and p.resolve().is_relative_to(root) and p.resolve() not in image_paths]
    if extras:
        issue('unreferenced_images','warning',None,f'{len(extras)} image file(s) in the dataset directory are not referenced.')
    return finish(len(frames),convention,units)
