const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');

const config = getDefaultConfig(projectRoot);

// Watch the parent package directory for changes
config.watchFolders = [workspaceRoot];

// Resolve modules from both the project and workspace node_modules
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
];

// Ensure react-native-webrtc source files are resolved correctly
config.resolver.extraNodeModules = {
  'react-native-webrtc': workspaceRoot,
};

module.exports = config;

