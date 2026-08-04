// MUST be the first import — before anything else, including expo-router/entry
import './src/runtime/prelude';

import { registerRootComponent } from 'expo';
// Release root is locked to the main application tree.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const App = require('./App').default;
registerRootComponent(App);
