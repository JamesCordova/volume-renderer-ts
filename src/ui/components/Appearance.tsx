import { useRef } from 'react'
import { useSceneStore } from '../store/scene.ts'

/** Fondo de la escena (skybox): una imagen equirectangular real, o un color
 * solido -- equivale visualmente al clearColor de siempre, pero se aplica
 * como scene.background (ver comentario en App.ts). */
export default function Appearance() {
    const skyboxMode = useSceneStore((s) => s.skyboxMode)
    const skyboxColor = useSceneStore((s) => s.skyboxColor)
    const skyboxStatus = useSceneStore((s) => s.skyboxStatus)
    const setSkyboxColor = useSceneStore((s) => s.setSkyboxColor)
    const setSkyboxImageFile = useSceneStore((s) => s.setSkyboxImageFile)

    const fileInputRef = useRef<HTMLInputElement>(null)

    return (
        <div className="pointer-events-auto flex flex-col gap-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-elevated)] p-3 text-xs text-[var(--color-fg)] shadow-[0_1px_3px_var(--color-shadow)]">
            <span className="font-medium">Fondo de la escena</span>

            <div className="flex items-center gap-2">
                <label className="flex items-center gap-1.5 rounded border border-[var(--color-border-strong)] px-2 py-1 hover:bg-[var(--color-hover)]">
                    <input
                        type="color"
                        value={skyboxColor}
                        onChange={(e) => setSkyboxColor(e.target.value)}
                        className="h-4 w-4 cursor-pointer border-none bg-transparent p-0"
                    />
                    Color solido
                </label>

                <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className={
                        'rounded border px-2 py-1 hover:bg-[var(--color-hover)] ' +
                        (skyboxMode === 'imagen'
                            ? 'border-[var(--color-invert)]'
                            : 'border-[var(--color-border-strong)]')
                    }
                >
                    Elegir imagen...
                </button>
                <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(e) => {
                        const file = e.target.files?.[0]
                        if (file) void setSkyboxImageFile(file)
                        e.target.value = ''
                    }}
                />
            </div>

            {skyboxMode === 'imagen' && (
                <span className="text-[var(--color-fg-muted)]">
                    {skyboxStatus || 'Imagen equirectangular por defecto'}
                </span>
            )}
        </div>
    )
}
