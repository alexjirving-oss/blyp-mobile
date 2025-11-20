// MUST be the first import — before anything else, including expo-router/entry
import './src/runtime/prelude';

import { registerRootComponent } from 'expo';
// Choose SafeApp when env EXPO_PUBLIC_SAFE_MODE=1, else normal App
const SafeMode = process.env.EXPO_PUBLIC_SAFE_MODE === '1';
// Use require to avoid importing both trees eagerly
// eslint-disable-next-line @typescript-eslint/no-var-requires
const App = SafeMode ? require('./src/SafeApp').default : require('./App').default;
registerRootComponent(App);
