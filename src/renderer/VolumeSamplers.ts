import * as THREE from 'three';

export type SdfSamplerFn = (x: number, y: number, z: number) => number;

export default class VolumeSamplers {
    static createMeshInstanceSdfSampler(instance: THREE.Mesh): SdfSamplerFn {
        if (!(instance instanceof THREE.Mesh)) {
            throw new Error('Expected a THREE.Mesh instance');
        }
        instance.updateMatrixWorld(true);
        return VolumeSamplers.createGeometrySdfSampler(instance.geometry, instance.matrixWorld);
    }

    static createGeometrySdfSampler(
        geometry: THREE.BufferGeometry,
        transform = new THREE.Matrix4(),
    ): SdfSamplerFn {
        if (!geometry.index) {
            throw new Error('Geometry must be indexed');
        }

        const va = new THREE.Vector3();
        const vb = new THREE.Vector3();
        const vc = new THREE.Vector3();
        const ab = new THREE.Vector3();
        const ac = new THREE.Vector3();
        const bc = new THREE.Vector3();
        const ap = new THREE.Vector3();
        const bp = new THREE.Vector3();
        const cp = new THREE.Vector3();
        const n  = new THREE.Vector3();
        const p  = new THREE.Vector3();
        const q  = new THREE.Vector3();
        const bestPoint  = new THREE.Vector3();
        const bestNormal = new THREE.Vector3();
        const toPoint    = new THREE.Vector3();

        const position = geometry.attributes.position as THREE.BufferAttribute;
        const index    = geometry.index.array;

        const worldPositions = Array.from({ length: position.count }, (_, i) =>
            new THREE.Vector3().fromBufferAttribute(position, i).applyMatrix4(transform),
        );

        const closestPointOnTriangle = (
            pt: THREE.Vector3,
            a: THREE.Vector3,
            b: THREE.Vector3,
            c: THREE.Vector3,
            target: THREE.Vector3,
        ): THREE.Vector3 => {
            ab.subVectors(b, a);
            ac.subVectors(c, a);
            ap.subVectors(pt, a);

            const d1 = ab.dot(ap);
            const d2 = ac.dot(ap);
            if (d1 <= 0 && d2 <= 0) return target.copy(a);

            bp.subVectors(pt, b);
            const d3 = ab.dot(bp);
            const d4 = ac.dot(bp);
            if (d3 >= 0 && d4 <= d3) return target.copy(b);

            cp.subVectors(pt, c);
            const d5 = ab.dot(cp);
            const d6 = ac.dot(cp);
            if (d6 >= 0 && d5 <= d6) return target.copy(c);

            if (d1 * d4 - d3 * d2 <= 0 && d1 >= 0 && d3 <= 0) {
                const v = d1 / (d1 - d3);
                return target.copy(a).add(ab.multiplyScalar(v));
            }

            if (d5 * d2 - d1 * d6 <= 0 && d2 >= 0 && d6 <= 0) {
                const w = d2 / (d2 - d6);
                return target.copy(a).add(ac.multiplyScalar(w));
            }

            if (d3 * d6 - d5 * d4 <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) {
                const w = (d4 - d3) / (d4 - d3 + d5 - d6);
                bc.subVectors(c, b);
                return target.copy(b).add(bc.multiplyScalar(w));
            }

            n.crossVectors(ab, ac).normalize();
            const distance = n.dot(ap);
            return target.copy(pt).sub(n.multiplyScalar(distance));
        };

        return (x: number, y: number, z: number): number => {
            p.set(x, y, z);

            let closestDistance2 = Infinity;

            for (let i = 0; i < index.length; i += 3) {
                va.copy(worldPositions[index[i]]);
                vb.copy(worldPositions[index[i + 1]]);
                vc.copy(worldPositions[index[i + 2]]);

                closestPointOnTriangle(p, va, vb, vc, q);
                const distance2 = p.distanceToSquared(q);

                if (distance2 < closestDistance2) {
                    closestDistance2 = distance2;
                    bestPoint.copy(q);
                    ab.subVectors(vb, va);
                    ac.subVectors(vc, va);
                    bestNormal.crossVectors(ab, ac).normalize();
                }
            }

            toPoint.subVectors(p, bestPoint);
            const sign = toPoint.dot(bestNormal) >= 0 ? 1 : -1;
            return Math.sqrt(closestDistance2) * sign;
        };
    }
}
