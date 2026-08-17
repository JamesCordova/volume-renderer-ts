import { useThemeStore } from './store/theme.ts'
import Account from './components/Account.tsx'
import Library from './components/Library.tsx'

/**
 * Raiz de la capa de UI en React. Vive junto al canvas de Three.js (ver
 * App.ts) pero nunca lo toca -- se comunican por un store compartido (ver
 * ./store), no por props ni por DOM.
 * Ver intern-talk/arquitectura-frontend-react.md.
 *
 * Etapa 2 (cuenta + biblioteca): reemplaza las carpetas "Cuenta Axial" y
 * "Mis Estudios (Axial)" de lil-gui. Subida, ventaneo/paleta/recorte, SUS y
 * consentimiento siguen en lil-gui hasta las etapas siguientes.
 */
export default function App() {
    const theme = useThemeStore((state) => state.theme)
    const setTheme = useThemeStore((state) => state.setTheme)

    return (
        <div className="fixed top-2 left-2 flex flex-col gap-2">
            <Account />
            <Library />

            <div className="pointer-events-auto flex gap-1 self-start rounded-md border border-[var(--color-border)] bg-[var(--color-bg-elevated)] p-1 text-xs text-[var(--color-fg)] shadow-sm">
                {(['system', 'light', 'dark'] as const).map((option) => (
                    <button
                        key={option}
                        type="button"
                        onClick={() => setTheme(option)}
                        className={
                            'rounded px-2 py-1 transition-colors ' +
                            (theme === option
                                ? 'bg-[var(--color-accent)] text-[var(--color-accent-fg)]'
                                : 'hover:bg-[var(--color-border)]')
                        }
                    >
                        {option}
                    </button>
                ))}
            </div>
        </div>
    )
}
