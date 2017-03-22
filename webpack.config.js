/* eslint-disable import/no-extraneous-dependencies */
const path = require('path');
const webpack = require('webpack');
const ExtractTextPlugin = require('extract-text-webpack-plugin');
const HtmlWebpackPlugin = require('html-webpack-plugin');

const babelOpts = {
  test: /\.jsx?$/,
  exclude: /node_modules/,
  use: [
    'babel-loader',
    // 'eslint-loader',
  ],
};

const cssOpts = {
  test: /\.css$/,
  use: ExtractTextPlugin.extract({
    use: 'css-loader'
  }),
};

const pluginList = [
  new webpack.optimize.CommonsChunkPlugin({
    name: 'vendor',
    minChunks: module =>
      module.context && module.context.indexOf('node_modules') !== -1,
  }),
  new ExtractTextPlugin('styles.bundle.css'),
  new HtmlWebpackPlugin({
    template: 'src/index.ejs',
    inject: false,
    title: 'setlist',
    appMountId: 'main',
  }),
];

if (process.env.NODE_ENV === 'production') {
  pluginList.push(
    new webpack.optimize.UglifyJsPlugin({
      comments: false,
    }),
    new webpack.SourceMapDevToolPlugin({
      filename: '[name].bundle.map',
    })
  );
}

module.exports = {
  entry: './src/app',
  resolve: {
    extensions: [ '.js', '.jsx' ],
  },
  output: {
    filename: '[name].bundle.js',
    path: path.resolve(__dirname, 'dist'),
  },
  module: {
    rules: [
      babelOpts,
      cssOpts,
    ],
  },
  plugins: pluginList,
  devtool: 'inline-source-map',
  devServer: {
    contentBase: path.resolve(__dirname, 'dist'),
    publicPath: '/',
  },
};
