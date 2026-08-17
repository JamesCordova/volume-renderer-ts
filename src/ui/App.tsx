import { useThemeStore } from './store/theme.ts'

/**
 * Raiz de la capa de UI en React. Vive junto al canvas de Three.js (ver
 * App.ts) pero nunca lo toca -- se comunican por un store compartido (ver
 * ./store), no por props ni por DOM.
 * Ver intern-talk/arquitectura-frontend-react.md.
 *
 * Etapa 1 (andamiaje): solo el toggle de tema, para confirmar que React,
 * Tailwind y el store conviven con el canvas sin romper nada. La biblioteca
 * de estudios, subida, ventaneo, etc. llegan en las etapas siguientes.
 */
export default function App() {
    const theme = useThemeStore((state) => state.theme)
    const setTheme = useThemeStore((state) => state.setTheme)

    return (
        <div className="pointer-events-auto fixed top-2 right-2 flex gap-1 rounded-md border border-[var(--color-border)] bg-[var(--color-bg-elevated)] p-1 text-xs text-[var(--color-fg)] shadow-sm">
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
    )
}
