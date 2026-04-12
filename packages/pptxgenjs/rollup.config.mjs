import pkg from "./package.json" with { type: "json" };
import resolve from "@rollup/plugin-node-resolve";
import commonjs from "@rollup/plugin-commonjs";
import esbuild from "rollup-plugin-esbuild";

const nodeBuiltinsRE = /^node:.*/;

const esbuildPlugin = esbuild.default || esbuild;

export default {
	input: "src/pptxgen.ts",
	output: [
		{
			file: "./dist/pptxgen.js",
			format: "iife",
			name: "PptxGenJS",
			globals: { jszip: "JSZip" },
		},
		{ file: "./dist/pptxgen.cjs.js", format: "cjs", exports: "default" },
		{ file: "./dist/pptxgen.es.js", format: "es" },
	],
	external: [
		nodeBuiltinsRE,
		...Object.keys(pkg.dependencies || {}),
		...Object.keys(pkg.peerDependencies || {}),
	],
	plugins: [
		resolve({ preferBuiltins: true }),
		commonjs(),
		esbuildPlugin({ target: 'es2016' }),
	]
};
