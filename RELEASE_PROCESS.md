# StickLash Release Process

This is the lightweight release checklist for APK and web releases.

## 1. Pre-Release Checks

- Confirm `main` is clean before release work begins.
- Sync web assets into Capacitor:

```powershell
npx cap sync android
```

- Run fast checks:

```powershell
node --check .\src\game.js
node --check .\wallet-connect.js
python -m py_compile .\server.py
```

## 2. Build Signed APK

```powershell
$env:JAVA_HOME='C:\Program Files\Android\Android Studio\jbr'
$env:Path="$env:JAVA_HOME\bin;$env:Path"
$env:SMF_RELEASE_STORE_FILE='C:/Users/cosyc/sticklash-key.jks'
$env:SMF_RELEASE_STORE_PASSWORD='***'
$env:SMF_RELEASE_KEY_ALIAS='Sensei Lasher'
$env:SMF_RELEASE_KEY_PASSWORD='***'
.\gradlew.bat assembleRelease
```

Working directory:

```text
android
```

## 3. Refresh Public APK Filenames

From the repo root:

```powershell
New-Item -ItemType Directory -Force .\android\app\release | Out-Null
Copy-Item .\android\app\build\outputs\apk\release\app-release.apk .\android\app\release\app-release.apk -Force
Copy-Item .\android\app\build\outputs\apk\release\app-release.apk .\android\app\release\stickler-app-release.apk -Force
Copy-Item .\android\app\build\outputs\apk\release\output-metadata.json .\android\app\release\output-metadata.json -Force
```

## 4. Verify APK

```powershell
$apksigner = Join-Path $env:LOCALAPPDATA 'Android\Sdk\build-tools\35.0.0\apksigner.bat'
& $apksigner verify --verbose --print-certs .\android\app\release\stickler-app-release.apk
Get-FileHash .\android\app\release\stickler-app-release.apk -Algorithm SHA256
```

Also confirm key release markers exist inside the APK when a web asset changed:

```powershell
@'
import zipfile
apk = r'android/app/release/stickler-app-release.apk'
with zipfile.ZipFile(apk) as z:
    data = z.read('assets/public/src/game.js').decode('utf-8')
    print('Outer hand-drawn flame silhouette' in data)
'@ | python -
```

## 5. Write Release Notes

Create a dated file under `releases/` with:

- Release title and date.
- APK filename and SHA-256.
- Signer SHA-256 fingerprint.
- Commit or tag.
- What changed.
- Verification performed.
- Known risks.
- GitHub Release copy block.

Update `CHANGELOG.md` with the new release summary.

## 6. GitHub Release

After pushing the release commit:

- Create a GitHub tag.
- Create a GitHub Release from that tag.
- Paste the release-note summary.
- Attach `stickler-app-release.apk`.
- Verify the README download link and release asset both work.

