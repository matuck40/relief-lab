import { Color } from "three";

export type WeightedColor = { color: string; weight: number };
export type ColorSuggestion = { assignments: Record<string, string>; palette: string[] };

type LabColor = { l: number; a: number; b: number };
type Cluster = { members: Array<{ sources: string[]; hex: string; weight: number; lab: LabColor }> };

export function toHexColor(value: string) {
  const color = new Color("#808080");
  try { color.setStyle(value); } catch { /* Keep a neutral fallback. */ }
  return `#${color.getHexString()}`;
}

function toLab(hex: string): LabColor {
  const numeric = Number.parseInt(hex.slice(1), 16);
  const srgb = [(numeric >> 16) & 255, (numeric >> 8) & 255, numeric & 255].map((channel) => channel / 255);
  const linear = srgb.map((channel) => (
    channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
  ));
  const x = (linear[0] * 0.4124 + linear[1] * 0.3576 + linear[2] * 0.1805) / 0.95047;
  const y = linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722;
  const z = (linear[0] * 0.0193 + linear[1] * 0.1192 + linear[2] * 0.9505) / 1.08883;
  const pivot = (value: number) => value > 0.008856 ? Math.cbrt(value) : 7.787 * value + 16 / 116;
  const fx = pivot(x); const fy = pivot(y); const fz = pivot(z);
  return { l: 116 * fy - 16, a: 500 * (fx - fy), b: 200 * (fy - fz) };
}

function distance(left: LabColor, right: LabColor) {
  return (left.l - right.l) ** 2 + (left.a - right.a) ** 2 + (left.b - right.b) ** 2;
}

function representative(cluster: Cluster) {
  return cluster.members.reduce((best, candidate) => {
    const cost = cluster.members.reduce(
      (total, member) => total + distance(candidate.lab, member.lab) * member.weight,
      0,
    );
    return cost < best.cost || (cost === best.cost && candidate.weight > best.member.weight)
      ? { member: candidate, cost }
      : best;
  }, { member: cluster.members[0], cost: Infinity }).member;
}

export function suggestColorAssignments(colors: WeightedColor[], maximum: number): ColorSuggestion {
  const merged = new Map<string, { sources: string[]; hex: string; weight: number; lab: LabColor }>();
  colors.forEach(({ color, weight }) => {
    const hex = toHexColor(color);
    const current = merged.get(hex);
    if (current) {
      current.weight += Math.max(1, weight);
      if (!current.sources.includes(color)) current.sources.push(color);
    } else merged.set(hex, { sources: [color], hex, weight: Math.max(1, weight), lab: toLab(hex) });
  });

  const limit = Math.max(1, Math.min(Math.round(maximum) || 1, merged.size || 1));
  const clusters: Cluster[] = [...merged.values()].map((member) => ({ members: [member] }));
  while (clusters.length > limit) {
    let pair: [number, number] = [0, 1];
    let lowestCost = Infinity;
    for (let left = 0; left < clusters.length; left += 1) {
      for (let right = left + 1; right < clusters.length; right += 1) {
        const leftRepresentative = representative(clusters[left]);
        const rightRepresentative = representative(clusters[right]);
        const leftWeight = clusters[left].members.reduce((sum, member) => sum + member.weight, 0);
        const rightWeight = clusters[right].members.reduce((sum, member) => sum + member.weight, 0);
        const wardWeight = (leftWeight * rightWeight) / (leftWeight + rightWeight);
        const cost = distance(leftRepresentative.lab, rightRepresentative.lab) * wardWeight;
        if (cost < lowestCost) { lowestCost = cost; pair = [left, right]; }
      }
    }
    clusters[pair[0]].members.push(...clusters[pair[1]].members);
    clusters.splice(pair[1], 1);
  }

  const assignments: Record<string, string> = {};
  const palette = clusters.map((cluster) => {
    const target = representative(cluster).hex;
    cluster.members.forEach((member) => member.sources.forEach((source) => { assignments[source] = target; }));
    return target;
  });
  return { assignments, palette };
}
