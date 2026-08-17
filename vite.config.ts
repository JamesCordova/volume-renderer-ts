import { defineConfig } from 'vite'
import { resolve } from 'path'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
    plugins: [tailwindcss()],
    resolve: {
        alias: {
            'lil-gui/dist/lil-gui.min.css': resolve('./node_modules/lil-gui/dist/lil-gui.min.css'),
        },
    },
})
