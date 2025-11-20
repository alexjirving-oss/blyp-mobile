# Assets Directory - Blyp Mobile App

## 🎨 Required Assets for Production

Create these files in the `/assets` directory before building:

### 📱 App Icons
- **`icon.png`** (1024x1024) - Main app icon
- **`adaptive-icon.png`** (1024x1024) - Android adaptive icon foreground
- **`favicon.png`** (32x32) - Web favicon

### 🌟 Splash Screen  
- **`splash.png`** (1284x2778) - Loading screen image

## 🛠️ Quick Asset Creation

### Option 1: Use Figma Template (Recommended)
1. Create a 1024x1024 canvas in Figma
2. Design your "B" logo with purple gradient (#a855f7 to #ec4899)
3. Export as PNG at 1024x1024 for `icon.png` and `adaptive-icon.png`
4. Create 1284x2778 canvas for splash screen
5. Export as PNG for `splash.png`

### Option 2: Download Placeholder Assets
Run these PowerShell commands to download temporary assets:

```powershell
# Download app icon (1024x1024)
Invoke-WebRequest -Uri "https://via.placeholder.com/1024x1024/a855f7/ffffff.png?text=B" -OutFile "assets\icon.png"

# Download adaptive icon (1024x1024) 
Invoke-WebRequest -Uri "https://via.placeholder.com/1024x1024/a855f7/ffffff.png?text=B" -OutFile "assets\adaptive-icon.png"

# Download splash screen (1284x2778)
Invoke-WebRequest -Uri "https://via.placeholder.com/1284x2778/0f172a/a855f7.png?text=Blyp" -OutFile "assets\splash.png"

# Download favicon (32x32)
Invoke-WebRequest -Uri "https://via.placeholder.com/32x32/a855f7/ffffff.png?text=B" -OutFile "assets\favicon.png"
```

### Option 3: Professional Tools
- **[Expo Icon Generator](https://buildicon.netlify.app/)** - Generate all sizes from one image
- **[App Icon Generator](https://www.appicon.co/)** - Professional icon generator
- **Adobe Illustrator/Photoshop** - For custom professional designs

## 🎯 Design Guidelines

### Colors (Blyp Brand)
- Primary Purple: `#a855f7`
- Secondary Pink: `#ec4899` 
- Accent Fuchsia: `#d946ef`
- Background Dark: `#0f172a`

### Icon Design Tips
- Use the letter "B" as the main element
- Apply purple-to-pink gradient
- Ensure readability at small sizes
- Follow platform guidelines (iOS Human Interface, Material Design)

## ✅ Verification

After adding assets, verify they work:
1. Run `npm start` - Should load without asset errors
2. Check Expo Go app - Icons should display properly
3. Test on both light/dark device themes

## 🚀 Ready for Production

Once assets are added, you can build for production:
```bash
eas build --platform android
```

Your app will be ready for Google Play Store submission!