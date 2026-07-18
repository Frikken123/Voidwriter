const { app, BrowserWindow, ipcMain } = require('electron');
const fs = require('fs');
const path = require('path');
const { createCanvas, registerFont } = require('canvas');

let mainWindow;
let pendingFilePath = null;

let latestContent = ''; 
let latestTransform = 'translate(0px, 0px)';
let latestCursorIndex = 0;
let isQuitting = false; //

const recoveryTextPath = path.join(app.getPath('userData'), 'voidwriter_recovery.txt');
const recoveryProjPath = path.join(app.getPath('userData'), 'voidwriter_recovery.vwproject');

const explicitWritingsDir = path.join(app.getPath('home'), 'VoidWriter', 'writings');

let lockedBaseName = null;
let activeSessionTextPath = '';
let activeSessionProjPath = '';

// Register font for offline automated canvas export
try {
  registerFont(path.join(__dirname, 'Rough Serif.ttf'), { family: 'Rough Serif' });
} catch (e) {
  console.log("Font registration note:", e.message);
}

function getNextNewDraftPaths(writingsDir) {
  let index = 1;
  let textPath = path.join(writingsDir, `new-draft-${index}.txt`);
  let projPath = path.join(writingsDir, `new-draft-${index}.vwproject`);

  while (fs.existsSync(textPath) || fs.existsSync(projPath)) {
    index++;
    textPath = path.join(writingsDir, `new-draft-${index}.txt`);
    projPath = path.join(writingsDir, `new-draft-${index}.vwproject`);
  }
  return { textPath, projPath };
}

function resolveSessionPaths(targetPath = null) {
  if (!fs.existsSync(explicitWritingsDir)) {
    fs.mkdirSync(explicitWritingsDir, { recursive: true });
  }

  if (targetPath && fs.existsSync(targetPath)) {
    const ext = path.extname(targetPath);
    lockedBaseName = path.basename(targetPath, ext);
  } else if (!lockedBaseName) {
    const nextDraft = getNextNewDraftPaths(explicitWritingsDir);
    lockedBaseName = path.basename(nextDraft.textPath, '.txt');
  }

  activeSessionTextPath = path.join(explicitWritingsDir, `${lockedBaseName}.txt`);
  activeSessionProjPath = path.join(explicitWritingsDir, `${lockedBaseName}.vwproject`);
}

const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', (event, commandLine) => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
      const filePath = commandLine.find(arg => arg.endsWith('.vwproject') || arg.endsWith('.txt'));
      if (filePath && fs.existsSync(filePath)) {
        lockedBaseName = null; 
        resolveSessionPaths(filePath);
        loadProjectFileIntoWindow(filePath);
      }
    }
  });
}

const startupFileArg = process.argv.find(arg => arg.endsWith('.vwproject') || arg.endsWith('.txt'));
if (startupFileArg && fs.existsSync(startupFileArg)) {
  pendingFilePath = startupFileArg;
  resolveSessionPaths(pendingFilePath);
}

// Synchronous export function to guarantee files write completely before exit
function exportPagesOnClose(rawText) {
  try {
    if (!rawText || !rawText.trim()) return;
    if (!lockedBaseName) resolveSessionPaths(pendingFilePath);

    const outputDir = path.join(explicitWritingsDir, `${lockedBaseName}_pages`);
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    const canvasWidth = 2835;
    const canvasHeight = 3508;
    const canvas = createCanvas(canvasWidth, canvasHeight);
    const ctx = canvas.getContext('2d');

    // Fill background solid or load image synchronously if needed
    const bgImagePath = path.join(__dirname, 'nordwood-themes-R53t-Tg6J4c-unsplash.jpg');
    if (fs.existsSync(bgImagePath)) {
      try {
        const bgImgData = fs.readFileSync(bgImagePath);
        const img = new (require('canvas').Image)();
        img.src = bgImgData;
        ctx.drawImage(img, 0, 0, canvasWidth, canvasHeight);
      } catch (e) {
        ctx.fillStyle = '#f4f1ea';
        ctx.fillRect(0, 0, canvasWidth, canvasHeight);
      }
    } else {
      ctx.fillStyle = '#f4f1ea';
      ctx.fillRect(0, 0, canvasWidth, canvasHeight);
    }

    const marginLeft = 295;
    const marginTop = 295;
    const maxLineWidth = canvasWidth - (marginLeft * 2);

    ctx.font = '72px "Rough Serif", Courier, monospace';
    ctx.fillStyle = '#171717';
    ctx.textBaseline = 'top';

    const paragraphs = rawText.split(/\r?\n/);
    let pages = [];
    let currentPageLines = [];
    const maxLinesPerPage = Math.floor((canvasHeight - (marginTop * 2)) / 108);

    for (let para of paragraphs) {
      const words = para.split(' ');
      let currentLine = '';

      for (let word of words) {
        let testLine = currentLine.length === 0 ? word : currentLine + ' ' + word;
        let metrics = ctx.measureText(testLine);

        if (metrics.width > maxLineWidth) {
          currentPageLines.push(currentLine);
          currentLine = word;

          if (currentPageLines.length >= maxLinesPerPage) {
            pages.push([...currentPageLines]);
            currentPageLines = [];
          }
        } else {
          currentLine = testLine;
        }
      }
      if (currentLine.length > 0) {
        currentPageLines.push(currentLine);
      }
      if (currentPageLines.length >= maxLinesPerPage) {
        pages.push([...currentPageLines]);
        currentPageLines = [];
      }
    }

    if (currentPageLines.length > 0) {
      pages.push(currentPageLines);
    }

    for (let i = 0; i < pages.length; i++) {
      // Re-draw background for each page
      if (fs.existsSync(bgImagePath)) {
        try {
          const bgImgData = fs.readFileSync(bgImagePath);
          const img = new (require('canvas').Image)();
          img.src = bgImgData;
          ctx.drawImage(img, 0, 0, canvasWidth, canvasHeight);
        } catch (e) {}
      }

      ctx.font = '72px "Rough Serif", Courier, monospace';
      ctx.fillStyle = '#171717';
      
      let currentY = marginTop;
      for (let line of pages[i]) {
        ctx.fillText(line, marginLeft, currentY);
        currentY += 108;
      }

      const buffer = canvas.toBuffer('image/png');
      fs.writeFileSync(path.join(outputDir, `page-${i + 1}.png`), buffer);
    }
    console.log(`[SYNC EXPORT SUCCESS] Synchronously wrote ${pages.length} page snapshots to disk.`);
  } catch (err) {
    console.error("[SYNC EXPORT FAILED]:", err);
  }
}

function handleAutosave(text, transform, cursorIndex) {
  // SAFETY GUARD: If we are closing, or if the text is empty, don't overwrite good files
  if (isQuitting) return; 
  
  if (!text || text.trim() === "") {
    if (activeSessionTextPath && fs.existsSync(activeSessionTextPath)) {
       // Optional: Log this so you know why it didn't save
       console.log("[AUTOSAVE BLOCKED] Refusing to overwrite existing file with empty data.");
       return; 
    }
  }

  try {
    const safeText = text || '';
    
    if (!activeSessionTextPath) {
      resolveSessionPaths(pendingFilePath);
    }
    
    if (!fs.existsSync(explicitWritingsDir)) {
      fs.mkdirSync(explicitWritingsDir, { recursive: true });
    }
    
    fs.writeFileSync(recoveryTextPath, safeText, 'utf8');
    fs.writeFileSync(recoveryProjPath, JSON.stringify({ 
      textContent: safeText, 
      transform: transform || "translate(0px, 0px)", 
      cursorIndex: cursorIndex !== undefined ? cursorIndex : safeText.length 
    }, null, 2), 'utf8');

    fs.writeFileSync(activeSessionTextPath, safeText, 'utf8');
    fs.writeFileSync(activeSessionProjPath, JSON.stringify({ 
      textContent: safeText, 
      transform: transform || "translate(0px, 0px)", 
      cursorIndex: cursorIndex !== undefined ? cursorIndex : safeText.length 
    }, null, 2), 'utf8');

    console.log(`[AUTOSAVE SUCCESS] Overwritten in place: ${activeSessionTextPath}`);
  } catch (err) {
    console.error("[AUTOSAVE FAILED] Could not write to disk:", err);
  }
}

function loadProjectFileIntoWindow(filePath) {
  try {
    const rawData = fs.readFileSync(filePath, 'utf8');
    const projectData = JSON.parse(rawData);
    
    // SYNC THE MEMORY HERE
    latestContent = projectData.textContent || '';
    latestTransform = projectData.transform || 'translate(0px, 0px)';
    latestCursorIndex = projectData.cursorIndex !== undefined ? projectData.cursorIndex : latestContent.length;
    
    if (mainWindow && mainWindow.webContents) {
      mainWindow.webContents.send('load-project-data', projectData);
    }
    console.log(`[FILE LOAD] Loaded project path: ${filePath}`);
  } catch (err) {
    console.error("[FILE LOAD FAILED] Could not read project file:", err);
  }
}

function createWindow() {
  if (!activeSessionTextPath) {
    resolveSessionPaths(pendingFilePath);
  }

  mainWindow = new BrowserWindow({
    width: 1200,
    height: 900,
    fullscreen: true, 
    frame: false,     
    skipTaskbar: false,
    alwaysOnTop: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
      backgroundThrottling: false 
    }
  });

  mainWindow.loadFile('VoidWriter.html');

  mainWindow.webContents.once('did-finish-load', () => {
    if (pendingFilePath) {
      loadProjectFileIntoWindow(pendingFilePath);
    }
  });

  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (input.key === 'Escape' && input.type === 'keyDown') {
      event.preventDefault();
      mainWindow.minimize();
    }
  });

  mainWindow.webContents.on('will-navigate', (event) => {
    event.preventDefault();
  });

mainWindow.on('close', (event) => {
    isQuitting = true; // Prevents autosave from running during shutdown
    console.log("[APP CLOSE] Performing final save and synchronous page export.");
    
    handleAutosave(latestContent, latestTransform, latestCursorIndex);
    
    // Guaranteed blocking synchronous execution before process closes
    if (activeSessionTextPath && fs.existsSync(activeSessionTextPath)) {
      const finalRawText = fs.readFileSync(activeSessionTextPath, 'utf8');
      exportPagesOnClose(finalRawText);
    }
  });
}

ipcMain.on('dropped-file-path', (event, filePath) => {
  if (filePath && fs.existsSync(filePath)) {
    lockedBaseName = null;
    resolveSessionPaths(filePath);
    loadProjectFileIntoWindow(filePath);
  }
});

app.whenReady().then(createWindow);

ipcMain.on('update-memory', (event, payload) => {
  if (typeof payload === 'object' && payload !== null) {
    latestContent = payload.textContent || '';
    latestTransform = payload.transform || 'translate(0px, 0px)';
    latestCursorIndex = payload.cursorIndex !== undefined ? payload.cursorIndex : latestContent.length;
  }
  handleAutosave(latestContent, latestTransform, latestCursorIndex);
});

ipcMain.on('force-save-to-disk', (event, projectData) => {
  if (projectData) {
    latestContent = projectData.textContent || '';
    latestTransform = projectData.transform || 'translate(0px, 0px)';
    latestCursorIndex = projectData.cursorIndex !== undefined ? projectData.cursorIndex : latestContent.length;
    handleAutosave(latestContent, latestTransform, latestCursorIndex);
  }
});

ipcMain.on('request-app-minimize', () => {
  if (mainWindow) mainWindow.minimize();
});

ipcMain.on('request-app-quit', () => {
  if (mainWindow) mainWindow.close(); 
});