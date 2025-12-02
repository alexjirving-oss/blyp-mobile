// Backup of mediaDescriptionService.js before photo description hardening changes
import * as FileSystem from 'expo-file-system/legacy';
import { getGeminiApiKey, buildGeminiUrl, hasGeminiKey } from '../config/geminiConfig';
import { logStructured } from '../utils/logStructured';

