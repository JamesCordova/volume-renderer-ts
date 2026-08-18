import { useThemeStore } from './store/theme.ts'
import Account from './components/Account.tsx'
import Library from './components/Library.tsx'
import Upload from './components/Upload.tsx'
import Appearance from './components/Appearance.tsx'

/**
 * Raiz de la capa de UI en React. Vive junto al canvas de Three.js (ver
 * App.ts) pero nunca lo toca -- se comunican por un store compartido (ver
 * ./store), no por props ni por DOM.
 * Ver intern-talk/arquitectura-frontend-react.md.
 *
 * Etapas 2 y 3: reemplaza las carpetas "Cuenta Axial", "Mis Estudios
 * (Axial)", "Subir Estudio (DICOM)" y "Subir Volumen RAW" de lil-gui.
 * Ventaneo/paleta/recorte, SUS y consentimiento siguen en lil-gui hasta las
 * etapas siguientes.
 *
 * Distribucion: cuenta + biblioteca + subida (el flujo principal) a la
 * izquierda; tema/apariencia (preferencias perifericas, no parte del flujo)
 * en su propia esquina a la derecha, para no mezclarse con lo que si se usa
 * a cada rato.
 */
export default function App() {
    const theme = useThemeStore((state) => state.theme)
    const setTheme = useThemeStore((state) => state.setTheme)

    return (
        <>
            {/* max-h + overflow-y-auto: en un viewport bajo (laptop chica,
                ventana angosta) la pila puede ser mas alta que la pantalla --
                sin esto, la parte de abajo quedaba inalcanzable. pointer-
                events-auto en el contenedor (no solo en cada control) para
                que el scroll se capture aunque el mouse este en el espacio
                entre Account y Library, no solo exactamente sobre uno. */}
            <div className="axial-scroll pointer-events-auto fixed top-2 left-2 flex max-h-[calc(100vh-1rem)] flex-col gap-2 overflow-y-auto">
                <Account />
                <Library />
                <Upload />
            </div>

            <div className="axial-scroll pointer-events-auto fixed top-2 right-2 flex max-h-[calc(100vh-1rem)] flex-col items-end gap-2 overflow-y-auto">
                <div className="pointer-events-auto flex gap-1 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-elevated)] p-1 text-xs text-[var(--color-fg)] shadow-[0_1px_3px_var(--color-shadow)]">
                    {(['system', 'light', 'dark'] as const).map((option) => (
                        <button
                            key={option}
                            type="button"
                            onClick={() => setTheme(option)}
                            className={
                                'rounded px-2 py-1 transition-colors ' +
                                (theme === option
                                    ? 'bg-[var(--color-invert)] text-[var(--color-invert-fg)]'
                                    : 'text-[var(--color-fg-muted)] hover:bg-[var(--color-hover)]')
                            }
                        >
                            {option}
                        </button>
                    ))}
                </div>

                <Appearance />
            </div>
        </>
    )
}
