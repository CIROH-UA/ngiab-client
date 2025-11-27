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
			path: path.resolve(__dirname, '../../tethysapp/ngiab/public/frontend'),
			filename: '[name].js',
			publicPath: '/static/ngiab/frontend/',
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
			proxy: [
				{
				// Proxy every request *except* your frontend bundle path
				context: (pathname) => !pathname.startsWith('/static/ngiab/frontend/'),
				target: 'http://127.0.0.1:8000',
				changeOrigin: true,
				},
			],
			open: true,
		}
 
		// devServer: {
		// 	proxy: {
		// 		'!/static/ngiab/frontend/**': {
		// 			target: 'http://127.0.0.1:8000', // points to django dev server
		// 			changeOrigin: true,
		// 		},
		// 	},
		// 	open: true,
		// },
	}
};
