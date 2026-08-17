import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.tsx'
import './ui.css'

export function mountUi(): void {
    const container = document.getElementById('react-root')
    if (container === null) {
        throw new Error('#react-root no existe en index.html')
    }

    createRoot(container).render(
        <StrictMode>
            <App />
        </StrictMode>,
    )
}
