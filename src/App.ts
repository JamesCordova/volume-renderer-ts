import * as THREE from 'three';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import * as BufferGeometryUtils from 'three/addons/utils/BufferGeometryUtils.js';
import * as nifti from 'nifti-reader-js';
import GUI from 'lil-gui';
import VolumeRenderer from './renderer/VolumeRenderer.ts';
import VolumeSamplers from './renderer/VolumeSamplers.ts';
import type { VolumeRendererOptions } from './renderer/VolumeRenderer.ts';
import { AxialApiClient, DEFAULT_API_BASE_URL } from './api/client.ts';
import type { Study } from './api/client.ts';
import { unzipSync } from 'fflate';

// Mismo allowlist que RAW_DTYPES en worker-repo (interfaces/tasks/celery_app.py)
// -- duplicado deliberado (seccion 1.3 del documento de arquitectura, sin
// codigo compartido por import entre repos de distinto lenguaje).
const RAW_DTYPES = ['uint8', 'int16', 'uint16', 'int32', 'float32', 'float64'];

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

        // --- Integracion con el backend de Axial (api-repo) -----------------
        // Reusa loadNiftiFromArrayBuffer tal cual -- el backend ya sirve NIfTI
        // real (worker-repo), asi que no hace falta ningun parser nuevo, solo
        // conseguir los bytes de otro lado (la API en vez de un archivo local).
        const axialClient = new AxialApiClient(
            (import.meta.env.VITE_AXIAL_API_URL as string | undefined) ?? DEFAULT_API_BASE_URL,
        );
        const TOKEN_STORAGE_KEY = 'axial_token';

        let authToken: string | null = null;
        try {
            authToken = localStorage.getItem(TOKEN_STORAGE_KEY);
        } catch {
            // localStorage puede no estar disponible (ej. modo privado
            // estricto de algunos navegadores) -- se sigue funcionando, solo
            // no persiste el token entre recargas.
        }

        let currentSessionId: string | null = null;
        let studiesById: Record<string, Study> = {};

        const endCurrentSessionIfAny = async (): Promise<void> => {
            if (!authToken || !currentSessionId) return;
            const sessionToEnd = currentSessionId;
            currentSessionId = null;
            try {
                await axialClient.endSession(authToken, sessionToEnd);
            } catch (err) {
                console.error('No se pudo cerrar la sesion anterior:', err);
            }
        };

        const accountState = {
            email: '',
            password: '',
            status: 'No conectado',
            login: async (): Promise<void> => {
                try {
                    const { access_token } = await axialClient.login(accountState.email, accountState.password);
                    authToken = access_token;
                    try { localStorage.setItem(TOKEN_STORAGE_KEY, access_token); } catch { /* ignorar */ }
                    const me = await axialClient.me(access_token);
                    accountState.status = `Conectado como ${me.email} (${me.role})`;
                    statusController.updateDisplay();
                    await refreshStudies();
                    await refreshConsentStatus();
                } catch (err) {
                    accountState.status = `Error: ${(err as Error).message}`;
                    statusController.updateDisplay();
                }
            },
            register: async (): Promise<void> => {
                try {
                    const name = accountState.email.split('@')[0] || 'Usuario';
                    await axialClient.register(name, accountState.email, accountState.password);
                    accountState.status = 'Registrado -- ahora inicia sesion';
                    statusController.updateDisplay();
                } catch (err) {
                    accountState.status = `Error de registro: ${(err as Error).message}`;
                    statusController.updateDisplay();
                }
            },
            logout: async (): Promise<void> => {
                await endCurrentSessionIfAny();
                authToken = null;
                try { localStorage.removeItem(TOKEN_STORAGE_KEY); } catch { /* ignorar */ }
                accountState.status = 'No conectado';
                statusController.updateDisplay();
            },
        };

        const accountFolder = gui.addFolder('Cuenta Axial');
        accountFolder.add(accountState, 'email').name('Email');
        // lil-gui no tiene un input type="password" nativo -- aceptable para
        // esta demo de tesis, no reemplaza un login de produccion real.
        accountFolder.add(accountState, 'password').name('Password');
        accountFolder.add(accountState, 'login').name('Iniciar sesion');
        accountFolder.add(accountState, 'register').name('Registrarse');
        accountFolder.add(accountState, 'logout').name('Cerrar sesion');
        const statusController = accountFolder.add(accountState, 'status').name('Estado').disable();

        const studiesState = {
            selectedStudyId: '',
            detailLevel: 'full' as 'preview' | 'full',
            status: 'Inicia sesion primero',
            load: async (): Promise<void> => {
                if (!authToken || !studiesState.selectedStudyId) return;
                const study = studiesById[studiesState.selectedStudyId];
                if (!study) return;
                if (study.status === 'failed') {
                    // failed es definitivo (no "todavia") -- y ahora la API
                    // expone el motivo real (antes solo llegaba a Postgres,
                    // ver StudyResponse.error_message en api-repo).
                    studiesState.status = `Fallo: ${study.error_message ?? 'motivo desconocido'}`;
                    studiesStatusController.updateDisplay();
                    console.error('Estudio fallido:', study.id, study.error_message);
                    return;
                }
                if (study.status !== 'ready') {
                    studiesState.status = `Todavia procesando (status=${study.status}, ` +
                        `stage=${study.stage ?? '?'} ${study.progress_percent ?? 0}%) -- reintenta en un momento`;
                    studiesStatusController.updateDisplay();
                    return;
                }
                try {
                    studiesState.status = 'Descargando volumen...';
                    studiesStatusController.updateDisplay();

                    await endCurrentSessionIfAny();

                    const buffer = await axialClient.getStudyVolume(
                        authToken, study.id, studiesState.detailLevel,
                    );
                    await loadNiftiFromArrayBuffer(buffer, true);

                    const session = await axialClient.startSession(authToken, study.id);
                    currentSessionId = session.id;
                    await axialClient.recordInteraction(authToken, session.id, 'cargar_volumen', {
                        detail_level: studiesState.detailLevel,
                    });

                    studiesState.status = `Cargado: ${study.name} (${studiesState.detailLevel})`;
                    studiesStatusController.updateDisplay();
                } catch (err) {
                    studiesState.status = `Error: ${(err as Error).message}`;
                    studiesStatusController.updateDisplay();
                }
            },
        };

        const refreshStudies = async (): Promise<void> => {
            if (!authToken) return;
            try {
                const studies = await axialClient.listStudies(authToken);
                studiesById = Object.fromEntries(studies.map(s => [s.id, s]));
                // El id corto (8 caracteres) al final desambigua estudios con
                // el mismo nombre+estado -- sin esto, dos estudios llamados
                // igual colisionaban como la misma clave del objeto que
                // recibe .options(), y uno de los dos desaparecia del
                // dropdown (bug real, encontrado probando en el navegador).
                const labels: Record<string, string> = Object.fromEntries(
                    studies.map(s => [`${s.name} (${s.status}) [${s.id.slice(0, 8)}]`, s.id]),
                );
                studySelectController.options(labels);
                if (studies.length > 0) {
                    studiesState.selectedStudyId = studies[0].id;
                    studySelectController.updateDisplay();
                }
                studiesState.status = studies.length > 0
                    ? `${studies.length} estudio(s) encontrado(s)`
                    : 'No tenes estudios todavia';
                studiesStatusController.updateDisplay();
            } catch (err) {
                studiesState.status = `Error al listar: ${(err as Error).message}`;
                studiesStatusController.updateDisplay();
            }
        };

        const studiesFolder = gui.addFolder('Mis Estudios (Axial)');
        const studySelectController = studiesFolder
            .add(studiesState, 'selectedStudyId', { '(inicia sesion y refresca)': '' })
            .name('Estudio');
        studiesFolder.add(studiesState, 'detailLevel', ['preview', 'full']).name('Nivel de detalle');
        studiesFolder.add({ refresh: refreshStudies }, 'refresh').name('Refrescar mis estudios');
        studiesFolder.add(studiesState, 'load').name('Cargar estudio seleccionado');
        const studiesStatusController = studiesFolder.add(studiesState, 'status').name('Estado').disable();

        // Subida real de un estudio DICOM nuevo (seccion 6.2 del documento de
        // clean architecture: un archivo = una llamada PUT, el formato ya
        // viene fragmentado en slices) -- crea el estudio, sube cada slice,
        // confirma (encola el procesamiento en worker-repo) y hace polling
        // hasta que quede listo (o falle), refrescando "Mis Estudios" al final.
        // Nombres que un export real de DICOM suele traer adentro del zip
        // pero que NO son slices de imagen -- subirlos como si lo fueran
        // rompe la lectura de la serie en el worker (SimpleITK espera que
        // CADA archivo sea una imagen DICOM valida).
        const isNonImageZipEntry = (path: string): boolean => {
            const lower = path.toLowerCase();
            return lower.endsWith('/') || lower.endsWith('dicomdir') ||
                lower.endsWith('.txt') || lower.endsWith('.htm') || lower.endsWith('.html') ||
                lower.endsWith('.xml') || lower.endsWith('.json');
        };

        // Descomprime en el navegador (fflate) antes de subir -- mantiene el
        // diseno "un archivo = una llamada" del backend (seccion 6.2 del
        // documento de clean architecture: nunca aceptar un blob grande de
        // una sola subida), la API/worker nunca se enteran de que hubo un zip.
        const expandZipFiles = async (
            files: File[],
        ): Promise<{ filename: string; blob: Blob }[]> => {
            const expanded: { filename: string; blob: Blob }[] = [];
            for (const file of files) {
                if (!file.name.toLowerCase().endsWith('.zip')) {
                    expanded.push({ filename: file.name, blob: file });
                    continue;
                }
                const buffer = new Uint8Array(await file.arrayBuffer());
                const entries = unzipSync(buffer);
                for (const [path, data] of Object.entries(entries)) {
                    if (isNonImageZipEntry(path)) continue;
                    // Aplana subcarpetas (ej. "series-000002/image-000001.dcm")
                    // en un nombre unico -- MinIO/la API no necesitan la
                    // estructura de carpetas, y nombres repetidos entre
                    // subcarpetas colisionarian si no se aplanan.
                    const flatName = path.replace(/[/\\]/g, '_');
                    expanded.push({ filename: flatName, blob: new Blob([data]) });
                }
            }
            return expanded;
        };

        const uploadState = {
            name: 'Estudio nuevo',
            status: 'Elegi archivos DICOM (sueltos o un .zip) y presiona Subir',
            selectedFiles: [] as File[],
            chooseFiles: (): void => dicomInput.click(),
            upload: async (): Promise<void> => {
                if (!authToken) {
                    uploadState.status = 'Inicia sesion primero';
                    uploadStatusController.updateDisplay();
                    return;
                }
                if (uploadState.selectedFiles.length === 0) {
                    uploadState.status = 'No elegiste ningun archivo';
                    uploadStatusController.updateDisplay();
                    return;
                }
                try {
                    uploadState.status = 'Descomprimiendo (si hay algun .zip)...';
                    uploadStatusController.updateDisplay();
                    const toUpload = await expandZipFiles(uploadState.selectedFiles);
                    if (toUpload.length === 0) {
                        uploadState.status = 'El .zip no tenia archivos de imagen validos adentro';
                        uploadStatusController.updateDisplay();
                        return;
                    }

                    uploadState.status = 'Creando estudio...';
                    uploadStatusController.updateDisplay();
                    const study = await axialClient.createStudy(authToken, uploadState.name);

                    const filenames: string[] = [];
                    for (let i = 0; i < toUpload.length; i++) {
                        const { filename, blob } = toUpload[i];
                        uploadState.status = `Subiendo ${i + 1}/${toUpload.length}: ${filename}`;
                        uploadStatusController.updateDisplay();
                        await axialClient.uploadStudyFile(authToken, study.id, filename, blob);
                        filenames.push(filename);
                    }

                    uploadState.status = 'Confirmando subida y encolando procesamiento...';
                    uploadStatusController.updateDisplay();
                    await axialClient.confirmStudyUpload(authToken, study.id, filenames);

                    uploadState.status = 'Procesando (polling)...';
                    uploadStatusController.updateDisplay();
                    for (let attempt = 0; attempt < 30; attempt++) {
                        const current = await axialClient.getStudy(authToken, study.id);
                        uploadState.status = `Estado: ${current.status}` +
                            (current.stage ? ` (${current.stage} ${current.progress_percent}%)` : '');
                        uploadStatusController.updateDisplay();
                        if (current.status === 'ready' || current.status === 'failed') break;
                        await new Promise(resolve => setTimeout(resolve, 2000));
                    }

                    await refreshStudies();
                    uploadState.status = 'Listo -- elegilo en "Mis Estudios" y presiona Cargar';
                    uploadStatusController.updateDisplay();
                } catch (err) {
                    uploadState.status = `Error: ${(err as Error).message}`;
                    uploadStatusController.updateDisplay();
                }
            },
        };

        const dicomInput = document.createElement('input');
        dicomInput.type = 'file';
        dicomInput.multiple = true;
        dicomInput.accept = '.dcm,.zip';
        dicomInput.style.display = 'none';
        dicomInput.addEventListener('change', event => {
            const files = (event.target as HTMLInputElement).files;
            uploadState.selectedFiles = files ? Array.from(files) : [];
            uploadState.status = `${uploadState.selectedFiles.length} archivo(s) elegido(s)`;
            uploadStatusController.updateDisplay();
        });
        document.body.appendChild(dicomInput);

        const uploadFolder = gui.addFolder('Subir Estudio (DICOM)');
        uploadFolder.add(uploadState, 'name').name('Nombre del estudio');
        uploadFolder.add(uploadState, 'chooseFiles').name('Elegir archivos DICOM');
        uploadFolder.add(uploadState, 'upload').name('Subir y procesar');
        const uploadStatusController = uploadFolder.add(uploadState, 'status').name('Estado').disable();

        // Subida de un volumen .raw (sin cabecera, sin metadata propia --
        // a diferencia de un DICOM real, el archivo no trae dims/dtype/spacing,
        // asi que el usuario los declara aca. Ver ConfirmRawVolumeUpload en
        // api-repo y _process_raw_volume en worker-repo para el resto del
        // camino: sin normalizacion de Hounsfield (no son HU calibrados),
        // min-max en su lugar).
        const rawUploadState = {
            name: 'Volumen raw',
            dimZ: 1, dimY: 1, dimX: 1,
            dtype: 'uint8',
            spacingZ: 1.0, spacingY: 1.0, spacingX: 1.0,
            // Opcional: si se sabe que los valores son HU real (u otra
            // escala fisica conocida), declarar la ventana a mostrar en vez
            // de dejar que el worker use min-max automatico -- ver la
            // explicacion completa en la conversacion (aplasta el
            // contraste si NO se declara y los datos SI eran HU real de
            // rango ancho, ej. un .raw de 16 bits).
            useValueRange: false,
            valueRangeMin: -1000.0,
            valueRangeMax: 1000.0,
            selectedFile: null as File | null,
            status: 'Elegi un archivo .raw y completa dims/dtype/spacing',
            chooseFile: (): void => rawInput.click(),
            upload: async (): Promise<void> => {
                if (!authToken) {
                    rawUploadState.status = 'Inicia sesion primero';
                    rawUploadStatusController.updateDisplay();
                    return;
                }
                if (!rawUploadState.selectedFile) {
                    rawUploadState.status = 'No elegiste ningun archivo';
                    rawUploadStatusController.updateDisplay();
                    return;
                }
                try {
                    const file = rawUploadState.selectedFile;
                    const filename = file.name || 'volumen.raw';
                    const dims: [number, number, number] = [
                        rawUploadState.dimZ, rawUploadState.dimY, rawUploadState.dimX,
                    ];
                    const spacing: [number, number, number] = [
                        rawUploadState.spacingZ, rawUploadState.spacingY, rawUploadState.spacingX,
                    ];

                    rawUploadState.status = 'Creando estudio...';
                    rawUploadStatusController.updateDisplay();
                    const study = await axialClient.createStudy(authToken, rawUploadState.name);

                    rawUploadState.status = `Subiendo ${filename}...`;
                    rawUploadStatusController.updateDisplay();
                    await axialClient.uploadStudyFile(authToken, study.id, filename, file);

                    rawUploadState.status = 'Confirmando subida y encolando procesamiento...';
                    rawUploadStatusController.updateDisplay();
                    const valueRange: [number, number] | undefined = rawUploadState.useValueRange
                        ? [rawUploadState.valueRangeMin, rawUploadState.valueRangeMax]
                        : undefined;
                    await axialClient.confirmRawVolumeUpload(
                        authToken, study.id, filename, dims, rawUploadState.dtype, spacing, valueRange,
                    );

                    rawUploadState.status = 'Procesando (polling)...';
                    rawUploadStatusController.updateDisplay();
                    for (let attempt = 0; attempt < 30; attempt++) {
                        const current = await axialClient.getStudy(authToken, study.id);
                        rawUploadState.status = `Estado: ${current.status}` +
                            (current.stage ? ` (${current.stage} ${current.progress_percent}%)` : '');
                        rawUploadStatusController.updateDisplay();
                        if (current.status === 'ready' || current.status === 'failed') {
                            if (current.status === 'failed') {
                                console.error('Estudio raw fallido:', study.id, current.error_message);
                            }
                            break;
                        }
                        await new Promise(resolve => setTimeout(resolve, 2000));
                    }

                    await refreshStudies();
                    rawUploadState.status = 'Listo -- elegilo en "Mis Estudios" y presiona Cargar';
                    rawUploadStatusController.updateDisplay();
                } catch (err) {
                    rawUploadState.status = `Error: ${(err as Error).message}`;
                    rawUploadStatusController.updateDisplay();
                }
            },
        };

        const rawInput = document.createElement('input');
        rawInput.type = 'file';
        rawInput.accept = '.raw';
        rawInput.style.display = 'none';
        rawInput.addEventListener('change', event => {
            const files = (event.target as HTMLInputElement).files;
            rawUploadState.selectedFile = files && files.length > 0 ? files[0] : null;
            rawUploadState.status = rawUploadState.selectedFile
                ? `Elegido: ${rawUploadState.selectedFile.name} (${rawUploadState.selectedFile.size} bytes)`
                : 'Ningun archivo elegido';
            rawUploadStatusController.updateDisplay();
        });
        document.body.appendChild(rawInput);

        const rawUploadFolder = gui.addFolder('Subir Volumen RAW (sin cabecera)');
        rawUploadFolder.add(rawUploadState, 'name').name('Nombre del estudio');
        rawUploadFolder.add(rawUploadState, 'chooseFile').name('Elegir archivo .raw');
        rawUploadFolder.add(rawUploadState, 'dimZ', 1, 2048, 1).name('Dim Z (slices)');
        rawUploadFolder.add(rawUploadState, 'dimY', 1, 2048, 1).name('Dim Y (alto)');
        rawUploadFolder.add(rawUploadState, 'dimX', 1, 2048, 1).name('Dim X (ancho)');
        rawUploadFolder.add(rawUploadState, 'dtype', RAW_DTYPES).name('Tipo de dato');
        rawUploadFolder.add(rawUploadState, 'spacingZ', 0.001, 100, 0.001).name('Spacing Z (mm)');
        rawUploadFolder.add(rawUploadState, 'spacingY', 0.001, 100, 0.001).name('Spacing Y (mm)');
        rawUploadFolder.add(rawUploadState, 'spacingX', 0.001, 100, 0.001).name('Spacing X (mm)');
        rawUploadFolder.add(rawUploadState, 'useValueRange')
            .name('Declarar ventana HU (opcional)');
        rawUploadFolder.add(rawUploadState, 'valueRangeMin', -5000, 5000, 1).name('Ventana: minimo');
        rawUploadFolder.add(rawUploadState, 'valueRangeMax', -5000, 5000, 1).name('Ventana: maximo');
        rawUploadFolder.add(rawUploadState, 'upload').name('Subir y procesar');
        const rawUploadStatusController = rawUploadFolder.add(rawUploadState, 'status').name('Estado').disable();

        // Atribucion de actividad (seccion 9/21 del doc de arquitectura): cada
        // vez que el usuario termina de rotar la camara con una sesion activa,
        // se registra como interaccion -- no bloquea nada si falla, solo se
        // loguea (no es una operacion critica para poder seguir usando el visor).
        this.#orbitControls.addEventListener('end', () => {
            if (!authToken || !currentSessionId) return;
            axialClient.recordInteraction(authToken, currentSessionId, 'rotar_volumen', {
                azimuthAngle: this.#orbitControls.getAzimuthalAngle(),
                polarAngle: this.#orbitControls.getPolarAngle(),
                distance: this.#orbitControls.getDistance(),
            }).catch(err => console.error('No se pudo registrar la interaccion:', err));
        });

        window.addEventListener('beforeunload', () => {
            // best-effort: no se puede awaitear en beforeunload, pero
            // keepalive permite que el request salga aunque la pestana cierre.
            if (authToken && currentSessionId) {
                fetch(`${(import.meta.env.VITE_AXIAL_API_URL as string | undefined) ?? DEFAULT_API_BASE_URL}/sesiones/${currentSessionId}/fin`, {
                    method: 'POST',
                    headers: { Authorization: `Bearer ${authToken}` },
                    keepalive: true,
                });
            }
        });

        const consentState = {
            status: 'Inicia sesion primero',
            accept: async (): Promise<void> => {
                if (!authToken) return;
                try {
                    const result = await axialClient.acceptConsent(authToken);
                    consentState.status = `Aceptado el ${result.accepted_at}`;
                    consentStatusController.updateDisplay();
                } catch (err) {
                    consentState.status = `Error: ${(err as Error).message}`;
                    consentStatusController.updateDisplay();
                }
            },
        };

        const refreshConsentStatus = async (): Promise<void> => {
            if (!authToken) return;
            try {
                const result = await axialClient.getConsentStatus(authToken);
                consentState.status = result.accepted
                    ? `Aceptado el ${result.accepted_at}`
                    : 'Todavia no aceptaste el consentimiento informado';
                consentStatusController.updateDisplay();
            } catch (err) {
                consentState.status = `Error: ${(err as Error).message}`;
                consentStatusController.updateDisplay();
            }
        };

        const consentFolder = gui.addFolder('Consentimiento informado');
        const consentStatusController = consentFolder.add(consentState, 'status').name('Estado').disable();
        consentFolder.add(consentState, 'accept').name('Aceptar consentimiento');

        // Las 10 respuestas viven separadas del estado de envio (status/submit)
        // para no mezclar un indice dinamico (Record<string, number>) con
        // campos de tipo distinto -- TypeScript no puede tipar bien esa mezcla.
        const susQuestions: Record<string, number> = {
            q1: 3, q2: 3, q3: 3, q4: 3, q5: 3, q6: 3, q7: 3, q8: 3, q9: 3, q10: 3,
        };
        const susState = {
            status: 'Sin enviar',
            submit: async (): Promise<void> => {
                if (!authToken) return;
                try {
                    const responses = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(n => ({
                        question_number: n,
                        score: susQuestions[`q${n}`],
                    }));
                    const result = await axialClient.submitSus(authToken, responses, currentSessionId ?? undefined);
                    susState.status = `Enviado -- puntaje SUS: ${result.score}`;
                    susStatusController.updateDisplay();
                } catch (err) {
                    susState.status = `Error: ${(err as Error).message}`;
                    susStatusController.updateDisplay();
                }
            },
        };

        const susFolder = gui.addFolder('Cuestionario SUS');
        for (let n = 1; n <= 10; n++) {
            susFolder.add(susQuestions, `q${n}`, 1, 5, 1).name(`Pregunta ${n}`);
        }
        susFolder.add(susState, 'submit').name('Enviar cuestionario');
        const susStatusController = susFolder.add(susState, 'status').name('Estado').disable();
        // ---------------------------------------------------------------------

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
