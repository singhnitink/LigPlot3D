
type Point3D = { x: number; y: number; z: number };
type Vector3 = { x: number; y: number; z: number };

export const distance = (a: Point3D, b: Point3D): number => {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
};

export const distanceSq = (a: Point3D, b: Point3D): number => {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return dx * dx + dy * dy + dz * dz;
};

export const getCenter = (atoms: Point3D[]): Point3D => {
  if (atoms.length === 0) return { x: 0, y: 0, z: 0 };
  let x = 0, y = 0, z = 0;
  atoms.forEach(a => {
    x += a.x;
    y += a.y;
    z += a.z;
  });
  return { x: x / atoms.length, y: y / atoms.length, z: z / atoms.length };
};

export const sub = (a: Vector3, b: Vector3): Vector3 => ({
  x: a.x - b.x,
  y: a.y - b.y,
  z: a.z - b.z
});

export const add = (a: Vector3, b: Vector3): Vector3 => ({
  x: a.x + b.x,
  y: a.y + b.y,
  z: a.z + b.z
});

export const dot = (a: Vector3, b: Vector3): number => a.x * b.x + a.y * b.y + a.z * b.z;

export const cross = (a: Vector3, b: Vector3): Vector3 => ({
  x: a.y * b.z - a.z * b.y,
  y: a.z * b.x - a.x * b.z,
  z: a.x * b.y - a.y * b.x
});

export const mag = (v: Vector3): number => Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);

export const scale = (v: Vector3, s: number): Vector3 => ({ x: v.x * s, y: v.y * s, z: v.z * s });

// Lateral (in-plane) offset between two ring centroids, measured by projecting
// the centre-to-centre vector onto the ring plane whose normal is `normal`.
// Evaluated against both rings' normals by the caller, taking the minimum.
export const lateralOffset = (centerA: Point3D, centerB: Point3D, normal: Vector3): number => {
  const d = sub(centerB, centerA);
  const n = normalize(normal);
  return mag(sub(d, scale(n, dot(d, n))));
};

export const normalize = (v: Vector3): Vector3 => {
  const m = mag(v);
  if (m === 0) return { x: 0, y: 0, z: 0 };
  return { x: v.x / m, y: v.y / m, z: v.z / m };
};

export const angleDeg = (a: Vector3, b: Vector3, c: Vector3): number => {
  // Angle at b: a-b-c
  const v1 = sub(a, b);
  const v2 = sub(c, b);
  const dotProd = dot(v1, v2);
  const mag1 = mag(v1);
  const mag2 = mag(v2);
  if (mag1 === 0 || mag2 === 0) return 0;
  const cosTheta = Math.max(-1, Math.min(1, dotProd / (mag1 * mag2)));
  return (Math.acos(cosTheta) * 180) / Math.PI;
};

// Angle between two vectors (no central point)
export const angleBetween = (v1: Vector3, v2: Vector3): number => {
    const dotProd = dot(v1, v2);
    const mag1 = mag(v1);
    const mag2 = mag(v2);
    if (mag1 === 0 || mag2 === 0) return 0;
    const cosTheta = Math.max(-1, Math.min(1, Math.abs(dotProd) / (mag1 * mag2))); // Abs for acute angle between planes
    return (Math.acos(cosTheta) * 180) / Math.PI;
};

// Best fit plane normal for a set of points (simple cross product of first 3 distinct points approximation)
// For 5/6 membered rings, this is usually sufficient if planar.
export const getPlaneNormal = (atoms: Point3D[]): Vector3 => {
  if (atoms.length < 3) return { x: 0, y: 0, z: 1 };
  const p1 = atoms[0];
  const p2 = atoms[Math.floor(atoms.length / 2)];
  const p3 = atoms[atoms.length - 1];
  const v1 = sub(p2, p1);
  const v2 = sub(p3, p1);
  return normalize(cross(v1, v2));
};
