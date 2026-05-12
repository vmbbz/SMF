// Capacitor configuration for Phase 3 Android APK
import { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.solanamemefighter.app',
  appName: 'SMF Karate',
  webDir: 'public',
  server: {
    androidScheme: 'https'
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 2000,
      launchAutoHide: true,
      backgroundColor: '#13ef95',
      showSpinner: false,
      spinnerStyle: 'large',
      spinnerColor: '#ffffff'
    }
  }
};

export default config;
