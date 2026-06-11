const { app, BrowserWindow } = require('electron');
const path = require('path');

app.whenReady().then(async () => {
  const win = new BrowserWindow({ 
    width: 1000, 
    height: 800, 
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'dist', 'electron', 'preload', 'index.js'),
      contextIsolation: true,
    }
  });
  
  win.webContents.on('console-message', (event, level, message, line, sourceId) => {
    console.log(`[RENDERER CONSOLE]: ${message} (line ${line})`);
  });

  await win.loadURL('http://127.0.0.1:5173');
  
  // click the publish tab
  await win.webContents.executeJavaScript(`
    const tabs = document.querySelectorAll('.tab-btn');
    if (tabs.length > 1) tabs[1].click();
  `);
  
  await new Promise(r => setTimeout(r, 1000));
  
  const image = await win.webContents.capturePage();
  const fs = require('fs');
  fs.writeFileSync('/tmp/renderer_shot.png', image.toPNG());
  app.quit();
});
