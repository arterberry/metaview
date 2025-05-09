import resolve from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';
import { terser } from 'rollup-plugin-terser';

export default {
    input: 'src/index.js',   // <-- we'll create this next
    output: {
        file: 'dist/scte35.bundle.min.js',  // <-- your minified bundle output
        format: 'umd',
        name: 'SCTE35Parser',               // global variable name (for Chrome extension use)
        sourcemap: false
    },
    plugins: [
        resolve(),
        commonjs(),
        terser()  // optional: remove this if you want unminified output
    ]
};
