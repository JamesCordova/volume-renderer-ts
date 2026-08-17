import { useState } from 'react'
import { useAxialStore } from '../store/axial.ts'

/** Login/registro/logout. Reemplaza la carpeta "Cuenta Axial" de lil-gui. */
export default function Account() {
    const token = useAxialStore((s) => s.token)
    const user = useAxialStore((s) => s.user)
    const accountStatus = useAxialStore((s) => s.accountStatus)
    const accountLoading = useAxialStore((s) => s.accountLoading)
    const login = useAxialStore((s) => s.login)
    const register = useAxialStore((s) => s.register)
    const logout = useAxialStore((s) => s.logout)

    const [email, setEmail] = useState('')
    const [password, setPassword] = useState('')

    if (token) {
        return (
            <div className="pointer-events-auto flex items-center gap-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-elevated)] px-3 py-2 text-xs text-[var(--color-fg)] shadow-[0_1px_3px_var(--color-shadow)]">
                {user
                    ? <span>{user.email} <span className="text-[var(--color-fg-subtle)]">({user.role})</span></span>
                    : <div className="axial-skeleton h-3 w-32 rounded" />}
                <button
                    type="button"
                    onClick={() => { void logout() }}
                    className="rounded px-2 py-1 text-[var(--color-danger)] hover:bg-[var(--color-hover)]"
                >
                    Cerrar sesion
                </button>
            </div>
        )
    }

    return (
        <form
            className="pointer-events-auto flex w-64 flex-col gap-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-elevated)] p-3 text-xs text-[var(--color-fg)] shadow-[0_1px_3px_var(--color-shadow)]"
            onSubmit={(e) => { e.preventDefault(); void login(email, password) }}
        >
            {accountLoading ? (
                <>
                    <div className="axial-skeleton h-7 rounded" />
                    <div className="axial-skeleton h-7 rounded" />
                    <div className="axial-skeleton h-7 rounded" />
                </>
            ) : (
                <>
                    <input
                        type="email"
                        placeholder="Email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        className="rounded border border-[var(--color-border)] bg-[var(--color-bg-subtle)] px-2 py-1 outline-none focus:border-[var(--color-accent)]"
                    />
                    <input
                        type="password"
                        placeholder="Password"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        className="rounded border border-[var(--color-border)] bg-[var(--color-bg-subtle)] px-2 py-1 outline-none focus:border-[var(--color-accent)]"
                    />
                    <div className="flex gap-2">
                        <button
                            type="submit"
                            className="flex-1 rounded bg-[var(--color-accent)] px-2 py-1 text-[var(--color-accent-fg)] hover:bg-[var(--color-accent-hover)]"
                        >
                            Iniciar sesion
                        </button>
                        <button
                            type="button"
                            onClick={() => {
                                const name = email.split('@')[0] || 'Usuario'
                                void register(name, email, password)
                            }}
                            className="flex-1 rounded border border-[var(--color-border-strong)] px-2 py-1 hover:bg-[var(--color-hover)]"
                        >
                            Registrarse
                        </button>
                    </div>
                </>
            )}
            <span className="text-[var(--color-fg-muted)]">{accountStatus}</span>
        </form>
    )
}
