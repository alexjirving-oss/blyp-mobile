#!/usr/bin/env node

/**
 * Screen Layout Fixer
 * 
 * This utility script can be run to automatically update screens to use the 
 * new ScreenContainer component for consistent layout across the app.
 * 
 * Usage:
 * node fix-screen-layouts.js [--all] [--screen=ScreenName]
 */

const fs = require('fs');
const path = require('path');
const readline = require('readline');

const SCREENS_DIR = path.join(__dirname, 'src', 'screens');
const SCREEN_CONTAINER_IMPORT = `import ScreenContainer from '../components/ScreenContainer';`;

// Config
const DRY_RUN = process.argv.includes('--dry-run');
const FIX_ALL = process.argv.includes('--all');
let TARGET_SCREEN = null;

// Parse args for specific screen
process.argv.forEach(arg => {
  if (arg.startsWith('--screen=')) {
    TARGET_SCREEN = arg.split('=')[1];
  }
});

// Interactive CLI
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

/**
 * Check if a file already uses the ScreenContainer
 */
function usesScreenContainer(content) {
  return content.includes('ScreenContainer');
}

/**
 * Check if file uses SafeAreaView
 */
function usesSafeAreaView(content) {
  return content.includes('SafeAreaView');
}

/**
 * Add ScreenContainer import if needed
 */
function addScreenContainerImport(content) {
  // Don't duplicate imports
  if (content.includes(SCREEN_CONTAINER_IMPORT)) {
    return content;
  }
  
  // Find the right spot after React Native imports
  const lines = content.split('\n');
  let insertIndex = 0;
  
  // Look for the last import line
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim().startsWith('import ')) {
      insertIndex = i + 1;
    } else if (lines[i].trim() === '' && insertIndex > 0) {
      // Found the end of the import block
      break;
    }
  }
  
  // Insert our import
  lines.splice(insertIndex, 0, SCREEN_CONTAINER_IMPORT);
  return lines.join('\n');
}

/**
 * Wrap the main component in ScreenContainer
 */
function wrapInScreenContainer(content) {
  // This is a simplified approach - more complex screens might need manual fixing
  // Look for common pattern: return ( <View/> or <SafeAreaView> or <LinearGradient>
  let updated = content.replace(
    /return\s*\(\s*<(SafeAreaView|View|LinearGradient)/g,
    'return (\n    <ScreenContainer>\n      <$1'
  );
  
  // Close the wrapper before the closing component tag
  updated = updated.replace(
    /\s*<\/(SafeAreaView|View|LinearGradient)>\s*\);/g,
    '\n      </$1>\n    </ScreenContainer>\n  );'
  );
  
  return updated;
}

/**
 * Remove manual padding for status bar
 */
function removeManualPadding(content) {
  // Look for padding patterns that try to account for status bar
  return content.replace(/paddingTop:\s*\d+,\s*\/\/\s*Account for status bar/, 'paddingTop: 0,');
}

/**
 * Process a single screen file
 */
async function processScreenFile(filePath, fileName) {
  console.log(`\nProcessing ${fileName}...`);
  
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    
    // Analyze the file
    const hasScreenContainer = usesScreenContainer(content);
    const hasSafeAreaView = usesSafeAreaView(content);
    
    if (hasScreenContainer) {
      console.log(`✅ Already using ScreenContainer`);
      return;
    }
    
    if (!hasSafeAreaView) {
      console.log(`⚠️ Doesn't use SafeAreaView, may need manual inspection`);
    }
    
    // Make updates
    let updatedContent = content;
    updatedContent = addScreenContainerImport(updatedContent);
    updatedContent = wrapInScreenContainer(updatedContent);
    updatedContent = removeManualPadding(updatedContent);
    
    if (DRY_RUN) {
      console.log(`🔍 Would update ${fileName}`);
    } else {
      fs.writeFileSync(filePath, updatedContent, 'utf8');
      console.log(`✅ Updated ${fileName}`);
    }
    
  } catch (error) {
    console.error(`❌ Error processing ${fileName}:`, error.message);
  }
}

/**
 * Main function
 */
async function main() {
  console.log('🔧 Screen Layout Fixer');
  console.log('-----------------------');
  
  if (DRY_RUN) {
    console.log('⚠️ DRY RUN - No files will be changed');
  }
  
  const files = fs.readdirSync(SCREENS_DIR);
  const screenFiles = files.filter(file => file.endsWith('Screen.js'));
  
  console.log(`Found ${screenFiles.length} screen files`);
  
  // Handle specific screen
  if (TARGET_SCREEN) {
    const targetFile = screenFiles.find(file => file === `${TARGET_SCREEN}.js` || file === `${TARGET_SCREEN}`);
    if (targetFile) {
      await processScreenFile(path.join(SCREENS_DIR, targetFile), targetFile);
      console.log(`\nFinished processing ${targetFile}`);
      rl.close();
      return;
    } else {
      console.error(`❌ Could not find screen: ${TARGET_SCREEN}`);
      rl.close();
      return;
    }
  }
  
  // Handle all screens
  if (FIX_ALL) {
    for (const file of screenFiles) {
      await processScreenFile(path.join(SCREENS_DIR, file), file);
    }
    console.log('\n✅ Finished processing all screens');
    rl.close();
    return;
  }
  
  // Interactive mode
  console.log('\nAvailable screens:');
  screenFiles.forEach((file, index) => {
    console.log(`${index + 1}. ${file}`);
  });
  
  rl.question('\nEnter the number of the screen to fix (or "all" for all screens): ', async (answer) => {
    if (answer.toLowerCase() === 'all') {
      for (const file of screenFiles) {
        await processScreenFile(path.join(SCREENS_DIR, file), file);
      }
    } else {
      const index = parseInt(answer) - 1;
      if (index >= 0 && index < screenFiles.length) {
        await processScreenFile(path.join(SCREENS_DIR, screenFiles[index]), screenFiles[index]);
      } else {
        console.error('❌ Invalid selection');
      }
    }
    
    console.log('\n✅ Finished processing');
    rl.close();
  });
}

main();