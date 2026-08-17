import { useState } from 'react'
import { useAxialStore } from '../store/axial.ts'

/** Login/registro/logout. Reemplaza la carpeta "Cuenta Axial" de lil-gui. */
export default function Account() {
    const token = useAxialStore((s) => s.token)
    const user = useAxialStore((s) => s.user)
    const accountStatus = useAxialStore((s) => s.accountStatus)
    const login = useAxialStore((s) => s.login)
    const register = useAxialStore((s) => s.register)
    const logout = useAxialStore((s) => s.logout)

    const [email, setEmail] = useState('')
    const [password, setPassword] = useState('')

    if (token) {
        return (
            <div className="pointer-events-auto flex items-center gap-2 rounded-md border border-[var(--color-border)] bg-[var(--color-bg-elevated)] px-3 py-2 text-xs text-[var(--color-fg)] shadow-sm">
                <span>{user ? `${user.email} (${user.role})` : accountStatus}</span>
                <button
                    type="button"
                    onClick={() => { void logout() }}
                    className="rounded px-2 py-1 text-[var(--color-danger)] hover:bg-[var(--color-border)]"
                >
                    Cerrar sesion
                </button>
            </div>
        )
    }

    return (
        <form
            className="pointer-events-auto flex flex-col gap-2 rounded-md border border-[var(--color-border)] bg-[var(--color-bg-elevated)] p-3 text-xs text-[var(--color-fg)] shadow-sm"
            onSubmit={(e) => { e.preventDefault(); void login(email, password) }}
        >
            <input
                type="email"
                placeholder="Email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="rounded border border-[var(--color-border)] bg-[var(--color-bg)] px-2 py-1"
            />
            <input
                type="password"
                placeholder="Password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="rounded border border-[var(--color-border)] bg-[var(--color-bg)] px-2 py-1"
            />
            <div className="flex gap-2">
                <button
                    type="submit"
                    className="flex-1 rounded bg-[var(--color-accent)] px-2 py-1 text-[var(--color-accent-fg)]"
                >
                    Iniciar sesion
                </button>
                <button
                    type="button"
                    onClick={() => {
                        const name = email.split('@')[0] || 'Usuario'
                        void register(name, email, password)
                    }}
                    className="flex-1 rounded border border-[var(--color-border)] px-2 py-1 hover:bg-[var(--color-border)]"
                >
                    Registrarse
                </button>
            </div>
            <span className="text-[var(--color-fg-muted)]">{accountStatus}</span>
        </form>
    )
}
