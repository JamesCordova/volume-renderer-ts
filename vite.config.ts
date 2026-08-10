import { defineConfig } from 'vite'
import { resolve } from 'path'

export default defineConfig({
    resolve: {
        alias: {
            'lil-gui/dist/lil-gui.min.css': resolve('./node_modules/lil-gui/dist/lil-gui.min.css'),
        },
    },
})
