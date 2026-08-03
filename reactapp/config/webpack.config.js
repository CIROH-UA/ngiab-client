const path = require('path');
const webpack = require('webpack');
// const WebpackBundleAnalyzer = require("webpack-bundle-analyzer").BundleAnalyzerPlugin; // Uncomment to analyze bundle size
const Dotenv = require('dotenv-webpack');
// const TerserPlugin = require("terser-webpack-plugin");

module.exports = (env, argv) => {
	const dotEnvPath = `./reactapp/config/${argv.mode}.env`;
	console.log(`Building in ${argv.mode} mode...`);
	console.log(`=> Using .env config at "${dotEnvPath}"`);
	
	return {
		entry: ['./reactapp'],
		output: {
			// public/frontend/ is now hand-authored vanilla-JS source, so this build writes to
			// public/react-build/ instead. Both this dir and the legacy React app are deleted at
			// the Phase 2 cutover of the vanilla-JS migration.
			path: path.resolve(__dirname, '../../tethysapp/ngiab/public/react-build'),
			filename: '[name].js',
			publicPath: '/static/ngiab/react-build/',
		},
		resolve: {
			modules: [
				path.resolve(__dirname, '../'), 
				path.resolve(__dirname, '../../node_modules')
			]
		},
		plugins: [
			new Dotenv({
				path: dotEnvPath
			}),
			// new WebpackBundleAnalyzer(), // Uncomment to analyze bundle size
		],


		module: {
			rules: [
				{
					test: /\.(js|jsx)$/,
					exclude: /node_modules/,
					use: [
						{
							loader: 'babel-loader',
						},
					],
				},
				{
					test: /\.css$/,
					use: [
						{
							loader: 'style-loader',
						},
						{
							loader: 'css-loader',
						},
					],
				},
				{
					test: /\.(scss|sass)$/,
					exclude: /node_modules/,
					use: [
						{
							loader: 'style-loader',
						},
						{
							loader: 'css-loader',
						},
						{
							loader: 'sass-loader',
						},
					],
				},
				{
					test: /\.(jpe?g|png|gif|svg|mp4|mp3)$/,
					use: [
						{
							loader: 'file-loader',
							options: {
								outputPath: '',
							},
						},
					],
				},
			],
		},
		optimization: {
			minimize: true,
		},
		devServer: {
			proxy: {
				// Must match output.publicPath — everything except the bundle is proxied to Django.
				'!/static/ngiab/react-build/**': {
					target: 'http://127.0.0.1:8000', // points to django dev server
					changeOrigin: true,
				},
			},
			open: true,
		},
	}
};
