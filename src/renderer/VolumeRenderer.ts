import * as THREE from 'three';

const vertexShader = `
varying vec2 vUv;
varying float near;
varying float far;
varying mat4 invProjView;

void main() {
    gl_Position = vec4(position.xy, 0.0, 1.0);
    vUv = uv;
    near = projectionMatrix[3][2] / (projectionMatrix[2][2] - 1.0);
    far = projectionMatrix[3][2] / (projectionMatrix[2][2] + 1.0);
    invProjView = inverse(projectionMatrix * viewMatrix);
}`;

const fragmentShader = `
#if RENDER_MEAN_VALUE == 0 && (USE_POINT_LIGHTS || USE_DIR_LIGHTS) || RENDER_NORMALS
uniform float normalEpsilon;
#endif

#if RENDER_NORMALS == 0
uniform sampler2D palette;
uniform float minPaletteValue;
uniform float maxPaletteValue;
#endif
uniform float valueMultiplier;
uniform float valueAdded;
uniform float minCutoffValue;
uniform float maxCutoffValue;
uniform vec3 clipMin;
uniform vec3 clipMax;

#if RENDER_MEAN_VALUE == 0 && USE_EXTINCTION_COEFFICIENT && RENDER_NORMALS == 0
 #if USE_VALUE_AS_EXTINCTION_COEFFICIENT == 0
uniform float extinctionCoefficient;
 #endif
uniform float extinctionMultiplier;
#endif

#if RENDER_NORMALS == 0
uniform float alphaMultiplier;

 #if RENDER_MEAN_VALUE == 0
uniform float cutoffFadeRange;
 #endif
#endif

uniform float time;
uniform float random;

#if USE_VOLUMETRIC_DEPTH_TEST
uniform sampler2D depthTexture;
#endif

uniform vec3 volumeOrigin;
#if USE_CUSTOM_VALUE_FUNCTION
uniform vec3 volumeSize;

float sampleValue(float x, float y, float z, float t) {
{function}
}
#else
uniform sampler3D volumeAtlas;
uniform vec3 atlasResolution;
uniform vec3 volumeResolution;
uniform vec3 voxelSize;
uniform float timeCount;

float sampleValue(vec3 position, vec3 volumeUvOffset0, vec3 volumeUvOffset1, float volumeT) {
    vec3 volumeVoxel = (position - volumeOrigin) / voxelSize;
    vec3 volumeUv = (volumeVoxel + 0.5) / volumeResolution;

    vec3 uv0 = volumeUvOffset0 + volumeUv / atlasResolution;
    vec3 uv1 = volumeUvOffset1 + volumeUv / atlasResolution;

    float value0 = texture(volumeAtlas, uv0).r;
    float value1 = texture(volumeAtlas, uv1).r;

    return mix(value0, value1, volumeT);
}
#endif

#if (USE_POINT_LIGHTS || USE_DIR_LIGHTS) && RENDER_NORMALS == 0
 #if USE_POINT_LIGHTS && NUM_POINT_LIGHTS > 0
struct PointLight {
    vec3 color;
    vec3 position;
    float distance;
};
uniform PointLight pointLights[NUM_POINT_LIGHTS];
 #endif
 #if USE_DIR_LIGHTS && NUM_DIR_LIGHTS > 0
struct DirectionalLight {
    vec3 direction;
    vec3 color;
};
uniform DirectionalLight directionalLights[NUM_DIR_LIGHTS];
 #endif
#endif

varying vec2 vUv;
varying float near;
varying float far;
varying mat4 invProjView;

void main() {
    vec4 farWorld = invProjView * vec4(vUv * 2.0 - 1.0, 1.0, 1.0);
    farWorld /= farWorld.w;

    vec3 rayOrigin = cameraPosition;
    vec3 rayDirection = normalize(farWorld.xyz - rayOrigin);

#if USE_VOLUMETRIC_DEPTH_TEST
    float z = texture(depthTexture, vUv).r;
    float depth = -((near * far) / ((far - near) * z - far));
#endif

#if USE_CUSTOM_VALUE_FUNCTION == 0
    vec3 volumeSize = volumeResolution * voxelSize;
    vec3 volumeMax = volumeOrigin + (volumeResolution - 1.0) * voxelSize;

    int volumeIndex0 = int(time) % int(timeCount);
    int volumeIndex1 = (volumeIndex0 + 1) % int(timeCount);
    float volumeT = fract(time);

    int atlasResolutionX = int(atlasResolution.x);
    int atlasResolutionY = int(atlasResolution.y);
    int atlasResolutionZ = int(atlasResolution.z);

    int volume0X = volumeIndex0 % atlasResolutionX;
    int volume0Y = (volumeIndex0 / atlasResolutionX) % atlasResolutionY;
    int volume0Z = volumeIndex0 / (atlasResolutionX * atlasResolutionY);

    int volume1X = volumeIndex1 % atlasResolutionX;
    int volume1Y = (volumeIndex1 / atlasResolutionX) % atlasResolutionY;
    int volume1Z = volumeIndex1 / (atlasResolutionX * atlasResolutionY);

    vec3 volumeUvOffset0 = vec3(float(volume0X), float(volume0Y), float(volume0Z)) / atlasResolution;
    vec3 volumeUvOffset1 = vec3(float(volume1X), float(volume1Y), float(volume1Z)) / atlasResolution;
#else
    vec3 volumeMax = volumeOrigin + volumeSize;
#endif

    vec3 boxMin = max(volumeOrigin, clipMin);
    vec3 boxMax = min(volumeMax, clipMax);

    vec3 t1 = (boxMin - rayOrigin) / rayDirection;
    vec3 t2 = (boxMax - rayOrigin) / rayDirection;

    vec3 tMin = min(t1, t2);
    vec3 tMax = max(t1, t2);

    float tNear = max(max(tMin.x, tMin.y), tMin.z);
    float tFar  = min(min(tMax.x, tMax.y), tMax.z);

    bool insideBox = all(greaterThanEqual(rayOrigin, boxMin)) &&
        all(lessThanEqual(rayOrigin, boxMax));

    if (!insideBox && (tNear > tFar || tFar < 0.0)) {
        discard;
    }

    vec3 entryPoint = insideBox ? rayOrigin : rayOrigin + rayDirection * tNear;
    vec3 exitPoint  = rayOrigin + rayDirection * tFar;

    float intersectionLength = length(exitPoint - entryPoint);
    float stepLength = intersectionLength / float(RAY_STEPS);

#if RENDER_NORMALS == 0
 #if RENDER_MEAN_VALUE
    float valueSum  = 0.0;
    float weightSum = 0.0;
 #else
    vec4 alphaBlendedColor = vec4(0.0);
 #endif
#else
    gl_FragColor = vec4(0.0);
#endif

#if USE_RANDOM_START
    float rand = mod(random + fract(sin(dot(rayDirection, vec3(12.9898, 78.233, 45.164))) * 43758.5453), 1.0);
    float currentRayLength = stepLength * (rand - 1.0) + 1e-6;
#else
    float currentRayLength = -stepLength + 1e-6;
#endif

    for (int i = 0; i < RAY_STEPS; i++) {
        currentRayLength += stepLength;

        float stepWeight = 1.0 - step(intersectionLength - 1e-6, currentRayLength);

        vec3 position = mix(entryPoint, exitPoint, currentRayLength / intersectionLength);

#if USE_CUSTOM_VALUE_FUNCTION
        vec3 local = position - volumeOrigin;
        float sampledValue = sampleValue(local.x, local.y, local.z, time);
#else
        float sampledValue = sampleValue(position, volumeUvOffset0, volumeUvOffset1, volumeT);
#endif
        float scaledValue = sampledValue * valueMultiplier + valueAdded;

        stepWeight *= step(minCutoffValue, scaledValue) * step(scaledValue, maxCutoffValue);

#if USE_VOLUMETRIC_DEPTH_TEST
        stepWeight *= step(currentRayLength + tNear, depth);
#endif

#if RENDER_MEAN_VALUE && RENDER_NORMALS == 0
        valueSum  += scaledValue * stepLength * stepWeight;
        weightSum += stepLength * stepWeight;
#else
 #if USE_POINT_LIGHTS || USE_DIR_LIGHTS || RENDER_NORMALS
  #if USE_CUSTOM_VALUE_FUNCTION
        vec3 delta = vec3(
            sampleValue(local.x + normalEpsilon, local.y, local.z, time) - sampledValue,
            sampleValue(local.x, local.y + normalEpsilon, local.z, time) - sampledValue,
            sampleValue(local.x, local.y, local.z + normalEpsilon, time) - sampledValue);
  #else
        vec3 delta = vec3(
            sampleValue(position + vec3(normalEpsilon, 0.0, 0.0), volumeUvOffset0, volumeUvOffset1, volumeT) - sampledValue,
            sampleValue(position + vec3(0.0, normalEpsilon, 0.0), volumeUvOffset0, volumeUvOffset1, volumeT) - sampledValue,
            sampleValue(position + vec3(0.0, 0.0, normalEpsilon), volumeUvOffset0, volumeUvOffset1, volumeT) - sampledValue);
  #endif
        delta = mix(vec3(0, 1, 0), delta, step(1e-7, dot(delta, delta)));
  #if INVERT_NORMALS
        vec3 normal = normalize(-delta);
  #else
        vec3 normal = normalize(delta);
  #endif

  #if RENDER_NORMALS
        if (stepWeight > 0.0) {
            gl_FragColor = vec4(normal * 0.5 + vec3(0.5), 1.0);
            break;
        }
  #else
        vec3 addedLights = vec3(0.0);

        vec3 viewPosition = (viewMatrix * vec4(position, 1.0)).xyz;
        vec3 viewNormal   = normalize((viewMatrix * vec4(normal, 0.0)).xyz);

   #if USE_POINT_LIGHTS && NUM_POINT_LIGHTS > 0
        for(int l = 0; l < NUM_POINT_LIGHTS; l++) {
            vec3 lightDirection = normalize(pointLights[l].position - viewPosition);
            float strength = max(1.0 - (distance(viewPosition, pointLights[l].position) / pointLights[l].distance), 0.0);
            addedLights += clamp(dot(lightDirection, viewNormal), 0.0, 1.0) * pointLights[l].color * strength;
        }
   #endif
   #if USE_DIR_LIGHTS && NUM_DIR_LIGHTS > 0
        for(int l = 0; l < NUM_DIR_LIGHTS; l++) {
            vec3 lightDirection = directionalLights[l].direction;
            addedLights += clamp(dot(lightDirection, viewNormal), 0.0, 1.0) * directionalLights[l].color;
        }
   #endif
  #endif
 #endif

 #if RENDER_NORMALS == 0
        float normalizedValue = clamp((scaledValue - minPaletteValue) / (maxPaletteValue - minPaletteValue), 0.0, 1.0);

  #if USE_EXTINCTION_COEFFICIENT == 0
        float alpha = 1.0;
  #elif USE_VALUE_AS_EXTINCTION_COEFFICIENT
        float alpha = 1.0 - exp(-scaledValue * extinctionMultiplier * stepLength);
  #else
        float alpha = 1.0 - exp(-extinctionCoefficient * extinctionMultiplier * stepLength);
  #endif
        alpha *= stepWeight * alphaMultiplier;

        alpha *= smoothstep(0.0, cutoffFadeRange + 1e-6, min(scaledValue - minCutoffValue, maxCutoffValue - scaledValue));
        alpha = clamp(alpha, 0.0, 1.0);

        vec4 color = vec4(texture(palette, vec2(normalizedValue, 0.5)).rgb, alpha);

  #if USE_POINT_LIGHTS || USE_DIR_LIGHTS
        color.rgb *= addedLights;
  #endif

        alphaBlendedColor.rgb += color.rgb * color.a * (1.0 - alphaBlendedColor.a);
        alphaBlendedColor.a   += (1.0 - alphaBlendedColor.a) * color.a;
 #endif
#endif
    }

#if RENDER_NORMALS == 0
 #if RENDER_MEAN_VALUE
    float meanValue       = valueSum / max(weightSum, 1e-6);
    float normalizedMean  = clamp((meanValue - minPaletteValue) / (maxPaletteValue - minPaletteValue), 1e-7, 1.0 - 1e-7);
    float alpha = step(minCutoffValue, meanValue) * step(meanValue, maxCutoffValue) * alphaMultiplier;
    alpha = clamp(alpha, 0.0, 1.0);
    gl_FragColor = vec4(texture(palette, vec2(normalizedMean, 0.5)).rgb * alpha, alpha);
 #else
    gl_FragColor = alphaBlendedColor;
 #endif
#endif
}`;

export interface VolumeRendererOptions {
    customFunction?: string | null;
    useVolumetricDepthTest?: boolean;
    useExtinctionCoefficient?: boolean;
    useValueAsExtinctionCoefficient?: boolean;
    usePointLights?: boolean;
    useDirectionalLights?: boolean;
    useRandomStart?: boolean;
    renderMeanValue?: boolean;
    invertNormals?: boolean;
    renderNormals?: boolean;
    raySteps?: number;
}

interface AtlasUniform {
    value: THREE.Data3DTexture | null;
    data?: Uint16Array;
}

export interface VolumeUniforms {
    depthTexture:          { value: THREE.Texture | null };
    volumeOrigin:          { value: THREE.Vector3 };
    volumeSize:            { value: THREE.Vector3 };
    volumeAtlas:           AtlasUniform;
    atlasResolution:       { value: THREE.Vector3 };
    volumeResolution:      { value: THREE.Vector3 };
    voxelSize:             { value: THREE.Vector3 };
    clipMin:               { value: THREE.Vector3 };
    clipMax:               { value: THREE.Vector3 };
    timeCount:             { value: number };
    time:                  { value: number };
    random:                { value: number };
    normalEpsilon:         { value: number };
    palette:               { value: THREE.Texture | null };
    minPaletteValue:       { value: number };
    maxPaletteValue:       { value: number };
    minCutoffValue:        { value: number };
    maxCutoffValue:        { value: number };
    cutoffFadeRange:       { value: number };
    valueMultiplier:       { value: number };
    valueAdded:            { value: number };
    extinctionCoefficient: { value: number };
    extinctionMultiplier:  { value: number };
    alphaMultiplier:       { value: number };
}

export type VolumeSamplerFn = (
    xi: number, yi: number, zi: number,
    x: number,  y: number,  z: number,
    t: number,
) => number;

export default class VolumeRenderer extends THREE.Mesh {
    declare material: THREE.ShaderMaterial;

    uniforms: VolumeUniforms = {
        depthTexture:          { value: null },
        volumeOrigin:          { value: new THREE.Vector3() },
        volumeSize:            { value: new THREE.Vector3() },
        volumeAtlas:           { value: null },
        atlasResolution:       { value: new THREE.Vector3() },
        volumeResolution:      { value: new THREE.Vector3() },
        voxelSize:             { value: new THREE.Vector3() },
        clipMin:               { value: new THREE.Vector3(-1e10, -1e10, -1e10) },
        clipMax:               { value: new THREE.Vector3(1e10, 1e10, 1e10) },
        timeCount:             { value: 0.0 },
        time:                  { value: 0.0 },
        random:                { value: 0.0 },
        normalEpsilon:         { value: 0.01 },
        palette:               { value: null },
        minPaletteValue:       { value: 0.0 },
        maxPaletteValue:       { value: 1.0 },
        minCutoffValue:        { value: 1e-3 },
        maxCutoffValue:        { value: 1.0 - 1e-3 },
        cutoffFadeRange:       { value: 0.0 },
        valueMultiplier:       { value: 1.0 },
        valueAdded:            { value: 0.0 },
        extinctionCoefficient: { value: 1.0 },
        extinctionMultiplier:  { value: 1.0 },
        alphaMultiplier:       { value: 1.0 },
    };

    constructor() {
        super(new THREE.PlaneGeometry(2, 2));
        this.name = 'VolumeRenderer';
        this.renderOrder = 1000;
        this.updateMaterial();
    }

    updateMaterial(options: VolumeRendererOptions = {}): void {
        const customFunction = options.customFunction ?? null;

        const defines: Record<string, number> = {
            USE_CUSTOM_VALUE_FUNCTION:           +(customFunction !== null),
            USE_VOLUMETRIC_DEPTH_TEST:           +(options.useVolumetricDepthTest ?? false),
            RENDER_MEAN_VALUE:                   +(options.renderMeanValue ?? false),
            USE_EXTINCTION_COEFFICIENT:          +(options.useExtinctionCoefficient ?? true),
            USE_VALUE_AS_EXTINCTION_COEFFICIENT: +(options.useValueAsExtinctionCoefficient ?? false),
            USE_POINT_LIGHTS:                    +(options.usePointLights ?? false),
            USE_DIR_LIGHTS:                      +(options.useDirectionalLights ?? false),
            USE_RANDOM_START:                    +(options.useRandomStart ?? true),
            INVERT_NORMALS:                      +(options.invertNormals ?? false),
            RENDER_NORMALS:                      +(options.renderNormals ?? false),
            RAY_STEPS:                            options.raySteps ?? 64,
        };

        const lights = !!defines.USE_POINT_LIGHTS || !!defines.USE_DIR_LIGHTS;

        const uniforms: Record<string, { value: unknown }> = lights
            ? THREE.UniformsUtils.merge([THREE.UniformsLib.lights, {}])
            : {};

        uniforms.volumeOrigin    = this.uniforms.volumeOrigin;
        uniforms.time            = this.uniforms.time;
        uniforms.random          = this.uniforms.random;
        uniforms.minCutoffValue  = this.uniforms.minCutoffValue;
        uniforms.maxCutoffValue  = this.uniforms.maxCutoffValue;
        uniforms.cutoffFadeRange = this.uniforms.cutoffFadeRange;
        uniforms.valueMultiplier = this.uniforms.valueMultiplier;
        uniforms.valueAdded      = this.uniforms.valueAdded;
        uniforms.clipMin         = this.uniforms.clipMin;
        uniforms.clipMax         = this.uniforms.clipMax;

        if (defines.RENDER_NORMALS || (!defines.RENDER_MEAN_VALUE &&
            (defines.USE_POINT_LIGHTS || defines.USE_DIR_LIGHTS))) {
            uniforms.normalEpsilon = this.uniforms.normalEpsilon;
        }

        if (!defines.RENDER_NORMALS) {
            uniforms.palette         = this.uniforms.palette;
            uniforms.minPaletteValue = this.uniforms.minPaletteValue;
            uniforms.maxPaletteValue = this.uniforms.maxPaletteValue;
            uniforms.alphaMultiplier = this.uniforms.alphaMultiplier;
        }

        if (defines.USE_VOLUMETRIC_DEPTH_TEST) {
            uniforms.depthTexture = this.uniforms.depthTexture;
        }

        if (defines.USE_CUSTOM_VALUE_FUNCTION) {
            uniforms.volumeSize = this.uniforms.volumeSize;
        } else {
            uniforms.volumeAtlas      = this.uniforms.volumeAtlas;
            uniforms.atlasResolution  = this.uniforms.atlasResolution;
            uniforms.volumeResolution = this.uniforms.volumeResolution;
            uniforms.voxelSize        = this.uniforms.voxelSize;
            uniforms.timeCount        = this.uniforms.timeCount;
        }

        if (!defines.RENDER_MEAN_VALUE) {
            if (!defines.USE_VALUE_AS_EXTINCTION_COEFFICIENT) {
                uniforms.extinctionCoefficient = this.uniforms.extinctionCoefficient;
            }
            uniforms.extinctionMultiplier = this.uniforms.extinctionMultiplier;
        }

        this.material?.dispose();

        this.material = new THREE.ShaderMaterial({
            vertexShader,
            fragmentShader: defines.USE_CUSTOM_VALUE_FUNCTION
                ? fragmentShader.replace('{function}', customFunction!)
                : fragmentShader,
            uniforms,
            defines,
            depthTest: false,
            depthWrite: false,
            transparent: true,
            premultipliedAlpha: true,
            lights,
        });
    }

    createAtlasTexture(
        volumeResolution: THREE.Vector3,
        volumeOrigin: THREE.Vector3,
        voxelSize: THREE.Vector3,
        timeCount: number,
        textureFilter = THREE.LinearFilter,
    ): void {
        const atlasResolutionX = Math.ceil(Math.pow(timeCount, 1 / 3));
        const atlasResolutionY = atlasResolutionX;
        const atlasResolutionZ = Math.ceil(timeCount / (atlasResolutionX * atlasResolutionY));
        const atlasResolution  = new THREE.Vector3(atlasResolutionX, atlasResolutionY, atlasResolutionZ);

        const textureSizeX = volumeResolution.x * atlasResolutionX;
        const textureSizeY = volumeResolution.y * atlasResolutionY;
        const textureSizeZ = volumeResolution.z * atlasResolutionZ;

        const voxels  = new Uint16Array(textureSizeX * textureSizeY * textureSizeZ);
        const texture = new THREE.Data3DTexture(voxels, textureSizeX, textureSizeY, textureSizeZ);

        texture.format    = THREE.RedFormat;
        texture.type      = THREE.HalfFloatType;
        texture.minFilter = textureFilter;
        texture.magFilter = textureFilter;
        texture.wrapS     = THREE.ClampToEdgeWrapping;
        texture.wrapT     = THREE.ClampToEdgeWrapping;
        texture.wrapR     = THREE.ClampToEdgeWrapping;

        this.uniforms.volumeAtlas.value?.dispose();

        this.uniforms.volumeAtlas.value = texture;
        this.uniforms.volumeAtlas.data  = voxels;
        this.uniforms.atlasResolution.value.copy(atlasResolution);
        this.uniforms.volumeResolution.value.copy(volumeResolution);
        this.uniforms.volumeOrigin.value.copy(volumeOrigin);
        this.uniforms.voxelSize.value.copy(voxelSize);
        this.uniforms.timeCount.value = timeCount;
    }

    updateAtlasTexture(
        sampler: VolumeSamplerFn,
        timeOffset: number | null = null,
        timeCount: number | null = null,
    ): { minValue: number; maxValue: number } {
        const { x: atlasResolutionX, y: atlasResolutionY } = this.uniforms.atlasResolution.value;
        const { x: volumeResolutionX, y: volumeResolutionY, z: volumeResolutionZ } = this.uniforms.volumeResolution.value;
        const { x: volumeOriginX, y: volumeOriginY, z: volumeOriginZ } = this.uniforms.volumeOrigin.value;
        const { x: voxelSizeX, y: voxelSizeY, z: voxelSizeZ } = this.uniforms.voxelSize.value;

        const textureSizeX = volumeResolutionX * atlasResolutionX;
        const textureSizeY = volumeResolutionY * atlasResolutionY;

        let minValue = Number.POSITIVE_INFINITY;
        let maxValue = Number.NEGATIVE_INFINITY;

        this.uniforms.volumeAtlas.value!.needsUpdate = true;
        const voxels = this.uniforms.volumeAtlas.data!;

        const start = timeOffset ?? 0;
        const count = timeCount ?? this.uniforms.timeCount.value;
        const end   = start + Math.min(count, this.uniforms.timeCount.value);

        for (let t = start; t < end; t++) {
            const volumeIndexX = t % atlasResolutionX;
            const volumeIndexY = Math.floor(t / atlasResolutionX) % atlasResolutionY;
            const volumeIndexZ = Math.floor(t / (atlasResolutionX * atlasResolutionY));

            for (let xi = 0; xi < volumeResolutionX; xi++) {
                for (let yi = 0; yi < volumeResolutionY; yi++) {
                    for (let zi = 0; zi < volumeResolutionZ; zi++) {
                        const value = sampler(
                            xi, yi, zi,
                            xi * voxelSizeX + volumeOriginX,
                            yi * voxelSizeY + volumeOriginY,
                            zi * voxelSizeZ + volumeOriginZ,
                            t,
                        );

                        minValue = Math.min(minValue, value);
                        maxValue = Math.max(maxValue, value);

                        const xai = volumeIndexX * volumeResolutionX + xi;
                        const yai = volumeIndexY * volumeResolutionY + yi;
                        const zai = volumeIndexZ * volumeResolutionZ + zi;
                        const i   = xai + yai * textureSizeX + zai * textureSizeX * textureSizeY;

                        voxels[i] = THREE.DataUtils.toHalfFloat(value);
                    }
                }
            }
        }

        return { minValue, maxValue };
    }
}
