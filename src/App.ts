import * as THREE from 'three';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import * as BufferGeometryUtils from 'three/addons/utils/BufferGeometryUtils.js';
import * as nifti from 'nifti-reader-js';
import GUI from 'lil-gui';
import VolumeRenderer from './renderer/VolumeRenderer.ts';
import VolumeSamplers from './renderer/VolumeSamplers.ts';
import type { VolumeRendererOptions } from './renderer/VolumeRenderer.ts';

const samples: Record<string, string> = {
    'Animated Smoke': 'nifti_samples/fds_smoke.nii.gz',
    'Chris TI MRI':   'nifti_samples/chris_t1.nii.gz',
    'Iguana':         'nifti_samples/Iguana.nii.gz',
};

export default class App {
    static init(): void {
        window.addEventListener('load', () => { new App(); });
    }

    #renderer: THREE.WebGLRenderer;
    #scene: THREE.Scene;
    #camera: THREE.PerspectiveCamera;
    #orbitControls: OrbitControls;
    #volumeRenderer: VolumeRenderer;
    #spinningCube: THREE.Mesh;
    #directionalLight: THREE.DirectionalLight;
    #pointLight: THREE.PointLight;
    #renderTarget: THREE.WebGLRenderTarget;
    #lastTime: number | null = null;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    #timeElement: any = null;
    #time      = { value: 0 };
    #timescale = { value: 1 };
    #timeRange = { value: 200 };

    constructor() {
        this.#renderer = new THREE.WebGLRenderer({
            canvas: document.querySelector('canvas')!,
        });

        this.#scene = new THREE.Scene();

        this.#directionalLight = new THREE.DirectionalLight();
        this.#directionalLight.add(new THREE.Mesh(new THREE.SphereGeometry(0.03)));
        this.#directionalLight.visible = false;
        this.#scene.add(this.#directionalLight);

        this.#pointLight = new THREE.PointLight(0xffffff, 1, 3);
        this.#pointLight.add(new THREE.Mesh(new THREE.SphereGeometry(0.03)));
        this.#pointLight.visible = false;
        this.#scene.add(this.#pointLight);

        const axes = new THREE.AxesHelper(0.1);
        axes.position.set(-1, -1, -1);
        this.#scene.add(axes);

        this.#spinningCube = new THREE.Mesh(
            new THREE.BoxGeometry(),
            new THREE.MeshLambertMaterial(),
        );
        this.#spinningCube.visible = false;
        this.#scene.add(this.#spinningCube);

        const depthTexture    = new THREE.DepthTexture();
        depthTexture.format   = THREE.DepthFormat;
        depthTexture.type     = THREE.UnsignedShortType;
        this.#renderTarget    = new THREE.WebGLRenderTarget(64, 64, {
            depthTexture,
            depthBuffer: true,
        });

        this.#camera          = new THREE.PerspectiveCamera(75, 1, 0.01, 10);
        this.#camera.position.z = 2;

        this.#orbitControls = new OrbitControls(this.#camera, this.#renderer.domElement);
        this.#orbitControls.enableDamping  = true;
        this.#orbitControls.dampingFactor  = 0.1;

        this.#scene.background = new THREE.CubeTextureLoader().load([
            'images/pisa/px.png', 'images/pisa/nx.png',
            'images/pisa/py.png', 'images/pisa/ny.png',
            'images/pisa/pz.png', 'images/pisa/nz.png',
        ]);

        this.#volumeRenderer = new VolumeRenderer();
        this.#scene.add(this.#volumeRenderer);

        const uniforms = this.#volumeRenderer.uniforms;
        uniforms.depthTexture.value = this.#renderTarget.depthTexture;
        uniforms.volumeSize.value.set(2, 2, 2);
        uniforms.clipMin.value.set(-1, -1, -1);
        uniforms.clipMax.value.set(1, 1, 1);
        uniforms.valueAdded.value = 0.3;

        const gui = new GUI();

        const functionPresets: Record<string, string> = {
            'Sphere': `
vec3 p = vec3(x, y, z) - vec3(1.0);
return length(p);
`,
            'Pulsing Sphere': `
vec3 p = vec3(x, y, z) - vec3(1.0);
return length(p) + 0.1 * sin(t);
`,
            'Expanding Rings': `
vec3 p = vec3(x, y, z) - vec3(1.0);
return sin(length(p) * 10.0 - t * 4.0);
`,
            'Cube': `
vec3 p = vec3(x, y, z) - vec3(1.0);
return max(max(abs(p.x), abs(p.y)), abs(p.z)) * 2.0;
`,
            'Spinning Cube': `
vec3 p = vec3(x, y, z) - vec3(1.0);
float cx = cos(t); float sx = sin(t);
float rx = cx * p.x - sx * p.z;
float rz = sx * p.x + cx * p.z;
return max(max(abs(rx), abs(p.y)), abs(rz)) * 2.0;
`,
            'SphereCube Morph': `
vec3 p = vec3(x, y, z) - vec3(1.0);
float sphere = length(p);
float cube = max(max(abs(p.x), abs(p.y)), abs(p.z));
float blend = (sin(t) + 1.0) * 0.5;
return mix(sphere, cube, blend) * 2.0;
`,
            'Torus': `
vec3 p = vec3(x, y, z) - vec3(1.0);
float qx = length(vec2(p.x, p.z)) - 0.5;
return length(vec2(qx, p.y)) * 2.0;
`,
            'Surface': `
float wave1 = sin(x * 3.0 + t) * 0.1;
float wave2 = sin(z * 2.5 + t * 1.5) * 0.1;
float wave3 = sin((x + z) * 4.0 + t * 0.8) * 0.05;
return y - 1.0 - (wave1 + wave2 + wave3);
`,
            'Wobbly Sphere': `
vec3 p = vec3(x, y, z) - vec3(1.0);
float radius = 0.5 + 0.05 * sin(10.0 * atan(p.y, p.x) + t);
return length(p) - radius;
`,
            'Twister': `
vec3 p = vec3(x, y, z) - vec3(1.0);
float r = length(p.xy);
float theta = atan(p.y, p.x) + t + p.z * 3.0;
float nx = r * cos(theta); float ny = r * sin(theta);
float funnel = p.z + 0.3 * r;
return sin(nx * 4.0) * cos(ny * 4.0) - funnel;
`,
            'Warp Tunnel': `
vec3 p = vec3(x, y, z) - vec3(1.0);
float r = length(vec2(p.x, p.y)) - 0.5;
return r + sin(p.z * 5.0 - t * 3.0) * 0.1;
`,
            'Sine Flow': `
return sin(x * 2.0 + t) * sin(y * 2.0 - t) * sin(z * 2.0 + t);
`,
            'Gyroid': `
return (
    sin(x * 10.0) * cos(y * 10.0) +
    sin(y * 10.0) * cos(z * 10.0) +
    sin(z * 10.0) * cos(x * 10.0)
);
`,
            'Gyroid Animated': `
return (
    sin(x * 10.0 + t) * cos(y * 10.0) +
    sin(y * 10.0 + t) * cos(z * 10.0) +
    sin(z * 10.0 + t) * cos(x * 10.0)
);
`,
            'Smoke': `
return 0.2 * (
    sin(x * 7.5 + t) +
    sin(-y * 5.7 - 1.3 * t) * sin(z * 3.3 + 2.3 * t) +
    sin((x + y) * 6.2 + 2.5 * t) * sin((y + z) * 4.4 - 0.7 * t)
);
`,
            'Mandelbulb': `
vec3 p = vec3(x, y, z) - vec3(1.0);
vec3 Z = p; float dr = 1.0; float r = 0.0;
for (int i = 0; i < 8; i++) {
    r = length(Z);
    float theta = acos(Z.z / r);
    float phi = atan(Z.y, Z.x);
    float s = step(r, 2.0);
    dr = mix(dr, pow(r, 7.0) * 8.0 * dr + 1.0, s);
    float zr = pow(r, 8.0);
    theta *= 8.0; phi *= 8.0;
    Z = mix(Z, zr * vec3(sin(theta + t) * cos(phi), sin(theta) * sin(phi), cos(theta)) + p, s);
}
return 0.5 * log(r) * r / dr * 10.0 + 1.0;
`,
        };

        const options: VolumeRendererOptions & {
            distance: number;
            paletteMin: number;
            paletteMax: number;
            functionPreset: string;
            useCustomFunction: boolean;
            customFunction: string | null;
            extinctionCoefficient: number;
            compile: () => void;
            niftiSample: string;
            sampleResolution: number;
            createTorus: () => void;
        } = {
            distance: 1.0,
            extinctionCoefficient: 1.0,
            paletteMin: 0,
            paletteMax: 1,
            useVolumetricDepthTest: false,
            useExtinctionCoefficient: true,
            useValueAsExtinctionCoefficient: false,
            usePointLights: false,
            useDirectionalLights: false,
            useRandomStart: true,
            renderMeanValue: false,
            invertNormals: false,
            renderNormals: false,
            raySteps: 64,
            functionPreset: 'Pulsing Sphere',
            useCustomFunction: false,
            customFunction: null,
            compile: () => { setUseCustomFunction(true); },
            niftiSample: 'Animated Smoke',
            sampleResolution: 32,
            createTorus: () => {
                const geometry = new THREE.TorusKnotGeometry(0.5, 0.125);
                const sampler  = VolumeSamplers.createGeometrySdfSampler(geometry);
                setUseCustomFunction(false, true);
                const resolution = options.sampleResolution;
                this.#volumeRenderer.createAtlasTexture(
                    new THREE.Vector3(resolution, resolution, resolution),
                    new THREE.Vector3(-1, -1, -1),
                    new THREE.Vector3(2 / resolution, 2 / resolution, 2 / resolution),
                    1,
                );
                this.#volumeRenderer.updateAtlasTexture((_xi, _yi, _zi, x, y, z) =>
                    sampler(x, y, z) + 1,
                );
            },
        };

        const loadNiftiFromArrayBuffer = async (data: ArrayBuffer, zeroValueAdded = true): Promise<void> => {
            let buf = data;
            if (nifti.isCompressed(buf)) buf = nifti.decompress(buf);
            if (!nifti.isNIFTI(buf)) { console.error('Invalid NIfTI data'); return; }

            const header = nifti.readHeader(buf);
            const image  = nifti.readImage(header, buf);

            let volume: ArrayLike<number>;
            switch (header.datatypeCode) {
                case 2:  volume = new Uint8Array(image);   break;
                case 4:  volume = new Int16Array(image);   break;
                case 8:  volume = new Int32Array(image);   break;
                case 16: volume = new Float32Array(image); break;
                case 64: volume = new Float64Array(image); break;
                default: throw new Error(`Unsupported datatype ${header.datatypeCode}`);
            }

            const slope     = header.scl_slope ?? 1;
            const inter     = header.scl_inter ?? 0;
            const size      = header.dims;
            const timeCount = size[4] ?? 1;

            const physicalSize = new THREE.Vector3(
                size[1] * header.pixDims[1],
                size[2] * header.pixDims[2],
                size[3] * header.pixDims[3],
            );
            const scale    = 2 / Math.max(physicalSize.x, physicalSize.y, physicalSize.z);
            const voxelSize = new THREE.Vector3(
                header.pixDims[1] * scale,
                header.pixDims[2] * scale,
                header.pixDims[3] * scale,
            );

            this.#volumeRenderer.createAtlasTexture(
                new THREE.Vector3(size[1], size[3], size[2]),
                new THREE.Vector3(-1, -1, -1),
                new THREE.Vector3(voxelSize.x, voxelSize.z, voxelSize.y),
                timeCount,
            );

            const max = Array.from(volume).reduce((a, x) => Math.max(a, slope * x + inter), 1e-6);

            this.#volumeRenderer.updateAtlasTexture((xi, yi, zi, _x, _y, _z, t) => {
                const idx =
                    xi +
                    zi * size[1] +
                    yi * size[1] * size[2] +
                    Math.floor(t) * size[1] * size[2] * size[3];
                return (slope * volume[idx] + inter) / max;
            });

            if (zeroValueAdded) {
                uniforms.valueAdded.value = 0;
                valueAddedController.updateDisplay();
            }

            this.#timeRange.value  = timeCount;
            this.#timescale.value  = timeCount === 1 ? 0 : 1 / (header.pixDims[4] === 0 ? 1 : (header.pixDims[4] ?? 1));
            this.#timeElement.max(this.#timeRange.value);
            timescaleController.updateDisplay();
            timeRangeController.updateDisplay();
        };

        const loadObjFromFile = async (file: File): Promise<void> => {
            const text   = await file.text();
            const loader = new OBJLoader();
            const obj    = loader.parse(text);
            obj.updateMatrixWorld(true);

            const position = new THREE.Vector3();
            const box      = new THREE.Box3();

            obj.traverse(child => {
                if ((child as THREE.Mesh).isMesh) {
                    const positions = (child as THREE.Mesh).geometry.attributes.position;
                    for (let i = 0; i < positions.count; i++) {
                        position.fromBufferAttribute(positions as THREE.BufferAttribute, i);
                        box.expandByPoint(position);
                    }
                }
            });

            const size   = new THREE.Vector3();
            const center = new THREE.Vector3();
            box.getSize(size);
            box.getCenter(center);
            const scale = 2 / Math.max(size.x, size.y, size.z);

            const samplers: Array<(x: number, y: number, z: number) => number> = [];
            obj.traverse(child => {
                if ((child as THREE.Mesh).isMesh) {
                    const geometry  = (child as THREE.Mesh).geometry.clone();
                    const positions = geometry.attributes.position;
                    for (let i = 0; i < positions.count; i++) {
                        position.fromBufferAttribute(positions as THREE.BufferAttribute, i);
                        position.sub(center).multiplyScalar(scale);
                        positions.setXYZ(i, position.x, position.y, position.z);
                    }
                    const merged = BufferGeometryUtils.mergeVertices(geometry);
                    samplers.push(VolumeSamplers.createGeometrySdfSampler(merged, new THREE.Matrix4()));
                }
            });

            const resolution = options.sampleResolution;
            this.#volumeRenderer.createAtlasTexture(
                new THREE.Vector3(resolution, resolution, resolution),
                new THREE.Vector3(-1, -1, -1),
                new THREE.Vector3(2 / resolution, 2 / resolution, 2 / resolution),
                1,
            );
            this.#volumeRenderer.updateAtlasTexture((_xi, _yi, _zi, x, y, z) =>
                samplers.reduce((v, s) => Math.min(v, s(x, y, z) + 1), Infinity),
            );
        };

        const fileFolder = gui.addFolder('File');

        const loadSample = async (name: string, zeroValueAdded = true): Promise<void> => {
            const data = await fetch(samples[name]).then(r => r.arrayBuffer());
            await loadNiftiFromArrayBuffer(data, zeroValueAdded);
        };
        loadSample(options.niftiSample, false);

        fileFolder.add(options, 'niftiSample', Object.keys(samples))
            .name('Load Sample NIfTI file')
            .onChange(loadSample);

        const niftiInput = document.createElement('input');
        niftiInput.type   = 'file';
        niftiInput.accept = '.nii,.nii.gz';
        niftiInput.style.display = 'none';
        niftiInput.addEventListener('change', async event => {
            const file = (event.target as HTMLInputElement).files?.[0];
            if (!file) return;
            await loadNiftiFromArrayBuffer(await file.arrayBuffer(), true);
        });

        const objInput = document.createElement('input');
        objInput.type   = 'file';
        objInput.accept = '.obj';
        objInput.style.display = 'none';
        objInput.addEventListener('change', async event => {
            const file = (event.target as HTMLInputElement).files?.[0];
            if (!file) return;
            await loadObjFromFile(file);
        });

        fileFolder.add({ load: () => niftiInput.click() }, 'load').name('Load NIfTI file');
        fileFolder.add(options, 'sampleResolution', 2, 128, 1).name('Sampling resolution');
        fileFolder.add({ load: () => objInput.click() }, 'load').name('Load OBJ file');
        fileFolder.add(options, 'createTorus').name('Sample torus knot geometry');

        const glslTextarea = document.querySelector<HTMLTextAreaElement>('.glsl')!;
        glslTextarea.value = functionPresets[options.functionPreset].trim();

        const setUseCustomFunction = (use: boolean, skipLoadSample = false): void => {
            glslTextarea.style.visibility = use ? 'visible' : 'hidden';
            options.useCustomFunction = use;
            controlUseFunction.updateDisplay();
            uniforms.valueAdded.value = 0;
            valueAddedController.updateDisplay();

            if (use) {
                this.#volumeRenderer.createAtlasTexture(
                    new THREE.Vector3(2, 2, 2),
                    new THREE.Vector3(-1, -1, -1),
                    new THREE.Vector3(2, 2, 2),
                    1,
                );
                options.customFunction = glslTextarea.value;
            } else {
                options.customFunction = null;
                if (!skipLoadSample) loadSample(options.niftiSample);
            }
            this.#volumeRenderer.updateMaterial(options);
        };

        const functionFolder = gui.addFolder('Custom Function');
        functionFolder.add(options, 'functionPreset', Object.keys(functionPresets))
            .name('Presets')
            .onChange((name: string) => {
                glslTextarea.value = functionPresets[name].trim();
                setUseCustomFunction(true);
            });

        const controlUseFunction = functionFolder.add(options, 'useCustomFunction')
            .name('Use Function')
            .onChange((value: boolean) => setUseCustomFunction(value));

        functionFolder.add(options, 'compile').name('Compile function');

        const timeFolder = gui.addFolder('Time');

        const timeRangeController = timeFolder.add(this.#timeRange, 'value')
            .name('Time Range')
            .onChange((value: number) => this.#timeElement.max(value));

        this.#timeElement = timeFolder.add(this.#time, 'value', 0, this.#timeRange.value, 0.001)
            .name('Time Index');

        const timescaleController = timeFolder.add(this.#timescale, 'value', 0, 8, 0.001)
            .name('Time Scale');

        const palettes = ['Viridis', 'Rainbow', 'Plasma', 'Hot', 'Gray', 'Smoke', 'White'];

        const setPalette = (name: string): void => {
            new THREE.TextureLoader().load(`images/palettes/${name.toLowerCase()}.png`, texture => {
                uniforms.palette.value = texture;
                this.#volumeRenderer.material.needsUpdate = true;
            });
        };
        setPalette(palettes[0]);

        const updatePaletteUniforms = (): void => {
            const cutMin = uniforms.minCutoffValue.value;
            const cutMax = uniforms.maxCutoffValue.value;
            uniforms.minPaletteValue.value = cutMin + (cutMax - cutMin) * options.paletteMin;
            uniforms.maxPaletteValue.value = cutMin + (cutMax - cutMin) * options.paletteMax;
        };

        const folderPalette = gui.addFolder('Palette');
        folderPalette.add({ palette: palettes[0] }, 'palette', palettes).name('Palette').onChange(setPalette);
        folderPalette.add(options, 'paletteMin', 0, 1, 0.01).name('Palette Min').onChange(updatePaletteUniforms);
        folderPalette.add(options, 'paletteMax', 0, 1, 0.01).name('Palette Max').onChange(updatePaletteUniforms);
        folderPalette.add(uniforms.minCutoffValue, 'value', 0, 3, 0.01).name('Min Cutoff Value').onChange(updatePaletteUniforms);
        folderPalette.add(uniforms.maxCutoffValue, 'value', 0, 3, 0.01).name('Max Cutoff Value').onChange(updatePaletteUniforms);
        folderPalette.add(uniforms.cutoffFadeRange, 'value', 0, 1, 0.01).name('Cutoff Fade Range');
        folderPalette.add(uniforms.valueMultiplier, 'value', 0, 4, 0.01).name('Value Multiplier');
        const valueAddedController = folderPalette.add(uniforms.valueAdded, 'value', 0, 0.5, 0.01).name('Value Added');

        const folderOpacity = gui.addFolder('Opacity');
        const controlCoefficient = folderOpacity.add(options, 'extinctionCoefficient', 0.1, 10, 0.01)
            .name('Extinction Coefficient')
            .onChange((value: number) => {
                options.distance = 3.912 / value;
                uniforms.extinctionCoefficient.value = value;
                controlDistance.updateDisplay();
            });
        const controlDistance = folderOpacity.add(options, 'distance', 0.1, 10, 0.01)
            .name('Visible Range (~98%)')
            .onChange((value: number) => {
                options.extinctionCoefficient = 3.912 / value;
                uniforms.extinctionCoefficient.value = 3.912 / value;
                controlCoefficient.updateDisplay();
            });
        folderOpacity.add(uniforms.extinctionMultiplier, 'value', 0, 10, 0.01).name('Extinction Multiplier');
        folderOpacity.add(uniforms.alphaMultiplier, 'value', 0, 4, 0.01).name('Alpha Multiplier');

        const folderClip = gui.addFolder('Clipping planes');
        folderClip.add(uniforms.clipMin.value, 'x', -1, 1, 0.01).name('Min X');
        folderClip.add(uniforms.clipMax.value, 'x', -1, 1, 0.01).name('Max X');
        folderClip.add(uniforms.clipMin.value, 'y', -1, 1, 0.01).name('Min Y');
        folderClip.add(uniforms.clipMax.value, 'y', -1, 1, 0.01).name('Max Y');
        folderClip.add(uniforms.clipMin.value, 'z', -1, 1, 0.01).name('Min Z');
        folderClip.add(uniforms.clipMax.value, 'z', -1, 1, 0.01).name('Max Z');

        const folderDefine = gui.addFolder('Shader Options');
        folderDefine.add(options, 'useVolumetricDepthTest').name('Depth Test').onChange((value: boolean) => {
            this.#spinningCube.visible = value;
            this.#volumeRenderer.updateMaterial(options);
        });
        folderDefine.add(options, 'renderMeanValue').name('Mean Value').onChange(() => this.#volumeRenderer.updateMaterial(options));
        folderDefine.add(options, 'useExtinctionCoefficient').name('Extinction Coefficient').onChange(() => this.#volumeRenderer.updateMaterial(options));
        folderDefine.add(options, 'useValueAsExtinctionCoefficient').name('Value as Extinction').onChange(() => this.#volumeRenderer.updateMaterial(options));
        folderDefine.add(options, 'usePointLights').name('Point Lights').onChange((value: boolean) => {
            this.#pointLight.visible = value;
            this.#volumeRenderer.updateMaterial(options);
        });
        folderDefine.add(options, 'useDirectionalLights').name('Directional Lights').onChange((value: boolean) => {
            this.#directionalLight.visible = value;
            this.#volumeRenderer.updateMaterial(options);
        });
        folderDefine.add(options, 'useRandomStart').name('Random Start').onChange(() => this.#volumeRenderer.updateMaterial(options));
        folderDefine.add(options, 'invertNormals').name('Invert normals').onChange(() => this.#volumeRenderer.updateMaterial(options));
        folderDefine.add(options, 'renderNormals').name('Render normals').onChange(() => this.#volumeRenderer.updateMaterial(options));

        const folderLight = gui.addFolder('Directional Light');
        folderLight.add(this.#directionalLight.position, 'x', -2, 2, 0.1).name('Position X');
        folderLight.add(this.#directionalLight.position, 'y', -2, 2, 0.1).name('Position Y');
        folderLight.add(this.#directionalLight.position, 'z', -2, 2, 0.1).name('Position Z');

        const folderRay = gui.addFolder('Ray Stepping');
        folderRay.add(options, 'raySteps', 2, 256, 1).name('Ray Steps').onChange(() => this.#volumeRenderer.updateMaterial(options));

        const folderOther = gui.addFolder('Other Settings');
        folderOther.add(uniforms.normalEpsilon, 'value', 0.001, 0.1, 0.01).name('Normal Epsilon');

        // suppress unused-variable warnings for controllers only used via updateDisplay
        void controlCoefficient;
        void controlDistance;
        void timeRangeController;
        void timescaleController;

        this.#renderer.setAnimationLoop(this.#update.bind(this));
        window.addEventListener('resize', this.#handleResize.bind(this));
        this.#handleResize();
    }

    #handleResize(): void {
        this.#renderer.setSize(window.innerWidth, window.innerHeight);
        this.#renderTarget.setSize(window.innerWidth, window.innerHeight);
        this.#camera.aspect = window.innerWidth / window.innerHeight;
        this.#camera.updateProjectionMatrix();
    }

    #update(time: number): void {
        const dt = Math.min(1, Math.max(1e-6, this.#lastTime === null ? 0 : (time - this.#lastTime) / 1000));
        this.#lastTime = time;

        this.#time.value = Math.floor(((this.#time.value + dt * this.#timescale.value) %
            this.#timeRange.value) * 10000) / 10000;
        this.#timeElement.updateDisplay();
        this.#volumeRenderer.uniforms.time.value   = this.#time.value;
        this.#volumeRenderer.uniforms.random.value = Math.random();

        this.#pointLight.position.set(
            Math.sin(time * 0.001) * 1.5,
            0.5,
            Math.cos(time * 0.001) * 1.5,
        );

        this.#orbitControls.update(dt);

        if (this.#spinningCube.visible) {
            this.#spinningCube.rotation.x += dt * 0.2;
            this.#spinningCube.rotation.y += dt * 0.1;
            this.#renderer.setRenderTarget(this.#renderTarget);
            this.#renderer.render(this.#scene, this.#camera);
        }

        this.#renderer.setRenderTarget(null);
        this.#renderer.render(this.#scene, this.#camera);
    }
}
