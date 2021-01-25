/*
 * @Author: DXY
 * @Date: 2021-01-19 16:39:43
 * @LastEditTime: 2021-01-25 13:36:19
 * @LastEditors: DXY
 * @Description: 
 * @FilePath: \obs-studio-node-example\index.js
 * @
 */
const { app, BrowserWindow, ipcMain } = require('electron')
const path = require('path');

const obsRecorder = require('./obsRecorder');
// app.disableHardwareAcceleration();

ipcMain.handle('recording-start', (event) => {
  obsRecorder.start();
  return { recording: true };
});

ipcMain.handle('recording-stop', (event) => {
  obsRecorder.stop();
  return { recording: false };
});

app.on('will-quit', obsRecorder.shutdown);

function createWindow() {
  // Create the browser window.
  const win = new BrowserWindow({
    width: 800,
    height: 600,
    autoHideMenuBar: true,
    webPreferences: {
      nodeIntegration: true,
      enableRemoteModule: true,
    }
  });

  ipcMain.handle('recording-init', (event) => {
    obsRecorder.initialize(win);
    return true;
  });

  ipcMain.handle('preview-init', (event, bounds) => {
    const result = obsRecorder.setupPreview(win, bounds)
    return result;
  });

  ipcMain.handle('preview-bounds', (event, bounds) => {
    return obsRecorder.resizePreview(win, bounds);
  });

  ipcMain.handle('update-rtmp', (event, bounds) => {
    return obsRecorder.udpateRtmp(win, bounds);
  });
  

  // 开始直播/结束直播
  ipcMain.on('toggleStreaming', (event, bounds) => {
    event.returnValue = obsRecorder.toggleStreaming(bounds);
  });

  // 源设置
  ipcMain.on('showSourceInfo', (event, bounds) => {
    event.returnValue = obsRecorder.showSourceInfo(bounds);
  });

  // 显示器设置
  ipcMain.on('selectDisPlay', (event, bounds) => {
    event.returnValue = obsRecorder.selectDisPlay(bounds);
  });

  ipcMain.on('getAllScene', (event) => {
    event.returnValue = obsRecorder.getAllScene();
  });

  ipcMain.on('getALlCameras', (event) => {
    event.returnValue = obsRecorder.getALlCameras();
  });

  ipcMain.on('getSetting', (event, bounds) => {
    event.returnValue = obsRecorder.getSetting(bounds);
  });

  
  // and load the index.html of the app.
  win.loadFile('index.html');

  // Open the DevTools.
  win.webContents.openDevTools();
}

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.whenReady().then(createWindow);

// Quit when all windows are closed.
app.on('window-all-closed', () => {
  // On macOS it is common for applications and their menu bar
  // to stay active until the user quits explicitly with Cmd + Q
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  // On macOS it's common to re-create a window in the app when the
  // dock icon is clicked and there are no other windows open.
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and require them here.
