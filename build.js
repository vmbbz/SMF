import fs from 'fs';
import path from 'path';

function copyFileSync(source, target) {
  let targetFile = target;
  if (fs.existsSync(target)) {
    if (fs.lstatSync(target).isDirectory()) {
      targetFile = path.join(target, path.basename(source));
    }
  }
  fs.writeFileSync(targetFile, fs.readFileSync(source));
}

function copyFolderRecursiveSync(source, target) {
  let files = [];
  const targetFolder = path.join(target, path.basename(source));
  if (!fs.existsSync(targetFolder)) {
    fs.mkdirSync(targetFolder, { recursive: true });
  }

  if (fs.lstatSync(source).isDirectory()) {
    files = fs.readdirSync(source);
    files.forEach(function (file) {
      const curSource = path.join(source, file);
      if (fs.lstatSync(curSource).isDirectory()) {
        copyFolderRecursiveSync(curSource, targetFolder);
      } else {
        copyFileSync(curSource, targetFolder);
      }
    });
  }
}

// Ensure www exists
if (!fs.existsSync('www')) {
  fs.mkdirSync('www');
}

// Copy files
copyFileSync('index.html', 'www/index.html');
copyFileSync('wallet-connect.js', 'www/wallet-connect.js');

// Copy folders contents
function copyDirContents(src, dest) {
  if (!fs.existsSync(dest)) {
    fs.mkdirSync(dest, { recursive: true });
  }
  fs.readdirSync(src).forEach(file => {
    const srcPath = path.join(src, file);
    const destPath = path.join(dest, file);
    if (fs.lstatSync(srcPath).isDirectory()) {
      copyFolderRecursiveSync(srcPath, dest);
    } else {
      copyFileSync(srcPath, destPath);
    }
  });
}

copyDirContents('src', 'www/src');
copyDirContents('assets', 'www/assets');

console.log('🎉 Web assets successfully synchronized to www/ folder!');
