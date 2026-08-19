// Capacitor configuration for MemeFight Android APK
const config = {
  appId: 'com.solanamemefighter.app',
  appName: 'MemeFight',
  webDir: 'www',
  server: {
    androidScheme: 'https'
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 2000,
      launchAutoHide: true,
      backgroundColor: '#0000FF',
      showSpinner: false,
      spinnerStyle: 'large',
      spinnerColor: '#ffffff'
    }
  }
};

export default config;
