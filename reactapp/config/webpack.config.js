const path = require('path');
const webpack = require('webpack');
// const WebpackBundleAnalyzer = require("webpack-bundle-analyzer").BundleAnalyzerPlugin; // Uncomment to analyze bundle size
const Dotenv = require('dotenv-webpack');
const TerserPlugin = require("terser-webpack-plugin");

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

		externals: ({context, request}, callback) => {
			if (/xlsx|canvg|pdfmake/.test(request)) {
				return callback(null, "commonjs " + request);
			}
			callback();
		},
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
			minimizer: [new TerserPlugin()],
			splitChunks: {
				
				 minSize: 17000,
				 minRemainingSize: 0,
				 minChunks: 1,
				 maxAsyncRequests: 30,
				 maxInitialRequests: 30,
				 automaticNameDelimiter: "_",
				 enforceSizeThreshold: 30000,
				 cacheGroups: {
				  common: {
				   test: /[\\/]node_modules[\\/]/,
				   priority: -5,
				   reuseExistingChunk: true,
				   chunks: "all",
				   name: "common_app",
				   minSize: 0,
				  },
				  default: {
				   minChunks: 2,
				   priority: -20,
				   reuseExistingChunk: true,
				  },
				  // we are opting out of defaultVendors, so rest of the node modules will be part of default cacheGroup
				//   defaultVendors: false,
				  reactPackage: {
				   test: /[\\/]node_modules[\\/](react|react-dom|react-router|react-router-dom)[\\/]/,
				   name: 'vendor_react',
				   chunks: "all",
				   priority: 10,
				  }
				 },
				
			   }
		},
		devServer: {
			proxy: {
				'!/static/ngiab/frontend/**': {
					target: 'http://localhost:8000', // points to django dev server
					changeOrigin: true,
				},
			},
			open: true,
		},
	}
};