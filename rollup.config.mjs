import resolve from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';
import { terser } from 'rollup-plugin-terser';

export default {
    input: 'src/index.js',   // <-- we'll create this next
    output: {
        file: 'src/lib/jwt_decode.bundle.min.js',  // <-- your minified bundle output
        format: 'iife',
        name: 'JWTDecodeBundle',               // global variable name (for Chrome extension use)
        sourcemap: false
    },
    plugins: [
        resolve({
            browser: true,  // Use the browser field in package.json
        }),
        commonjs(),
        // terser()  // optional: remove this if you want unminified output
    ]
};
