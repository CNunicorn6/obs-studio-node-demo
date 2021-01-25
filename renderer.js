/*
 * @Author: DXY
 * @Date: 2021-01-19 16:39:43
 * @LastEditTime: 2021-01-25 14:16:30
 * @LastEditors: DXY
 * @Description: 
 * @FilePath: \obs-studio-node-example\renderer.js
 * @
 */
const { ipcRenderer, shell, remote } = require('electron');
const path = require('path');

async function initOBS() {
  const result = await ipcRenderer.invoke('recording-init');
  if (result) {
    ipcRenderer.on("performanceStatistics", (_event, data) => {
      onPerformanceStatistics(data)
    });
  }
}

async function startRecording() {
  const result = await ipcRenderer.invoke('recording-start');
  return result;
}

async function stopRecording() {
  const result = await ipcRenderer.invoke('recording-stop');
  console.debug("stopRecording result:", result);
  return result;
}

let recording = false;
let recordingStartedAt = null;
let timer = null;

async function switchRecording() {
  if (recording) {
    recording = (await stopRecording()).recording;
  } else {
    recording = (await startRecording()).recording;
  }
  updateUI();
}

function updateUI() {
  console.log('on updateUI---------------------')
  const button = document.getElementById('rec-button');
  button.disabled = false;
  if (recording) {
    console.log('status: start')
    button.innerText = '⏹️ Stop recording'
    startTimer();
  } else {
    console.log('status: Stop')
    button.innerText = '⏺️ Start recording'
    stopTimer();
  }


  getStream()

  const displaySelect = document.getElementById('displaySelect')
  remote.screen.getAllDisplays().forEach(function (dispaly, index) {
    displaySelect.options.add(new Option(dispaly.size.height + "*" + dispaly.size.width, index));
  })

  //设置主显示器
  displaySelect.selectedIndex = 0;
  displaySelectChange()

  const cameras = ipcRenderer.sendSync('getALlCameras');
  const cameraSelect = document.getElementById('cameraSelect')
  cameras.forEach(function (camera) {
    cameraSelect.options.add(new Option(camera.name, camera.value));
  })

  const allScene = ipcRenderer.sendSync('getAllScene');
  console.log(allScene)

  const sceneSelect = document.getElementById('sceneSelect')
  allScene.forEach(function (scene) {
    sceneSelect.options.add(new Option(scene.name, scene.name));
  })
  sceneSelect.selectedIndex = 0;

  const sourceSelect = document.getElementById('sourceSelect')
  if (allScene.length == 1) {
    allScene[0].items.forEach(function (item) {
      sourceSelect.options.add(new Option(item, item));
    })
  }
}

// 获取流数据
function getStream() {
  const rtmp_server = document.getElementById('rtmp_server');
  const rtmp_key = document.getElementById('rtmp_key');

  const streamSettings = ipcRenderer.sendSync('getSetting', { name: 'Stream' });

  streamSettings.forEach(subCate => {
    subCate.parameters.forEach(parameter => {
      switch (parameter.name) {
        case 'service': {
          break;
        }
        case 'server': {
          rtmp_server.value = parameter.currentValue;
          break;
        }
        case 'key': {
          rtmp_key.value = parameter.currentValue;
          break;
        }
      }
    })
  })
}

function startTimer() {
  recordingStartedAt = Date.now();
  timer = setInterval(updateTimer, 100);
}

function stopTimer() {
  clearInterval(timer);
}

function updateTimer() {
  const diff = Date.now() - recordingStartedAt;
  const timerElem = document.getElementById('rec-timer');
  const decimals = `${Math.floor(diff % 1000 / 100)}`;
  const seconds = `${Math.floor(diff % 60000 / 1000)}`.padStart(2, '0');
  const minutes = `${Math.floor(diff % 3600000 / 60000)}`.padStart(2, '0');
  const hours = `${Math.floor(diff / 3600000)}`.padStart(2, '0');
  timerElem.innerText = `${hours}:${minutes}:${seconds}.${decimals}`;
}

function openFolder() {
  shell.openPath(path.join(__dirname, 'videos'));
}

function onPerformanceStatistics(data) {
  document.querySelector(".performanceStatistics #cpu").innerText = `${data.CPU} %`;
  document.querySelector(".performanceStatistics #cpuMeter").value = data.CPU;
  document.querySelector(".performanceStatistics #numberDroppedFrames").innerText = data.numberDroppedFrames;
  document.querySelector(".performanceStatistics #percentageDroppedFrames").innerText = `${data.percentageDroppedFrames} %`;
  document.querySelector(".performanceStatistics #bandwidth").innerText = data.bandwidth;
  document.querySelector(".performanceStatistics #frameRate").innerText = `${Math.round(data.frameRate)} fps`;
}

const previewContainer = document.getElementById('preview');

async function setupPreview() {
  const { width, height, x, y } = previewContainer.getBoundingClientRect();
  const result = await ipcRenderer.invoke('preview-init', { width, height, x, y });
  previewContainer.style = `height: ${result.height}px`;
}

async function resizePreview() {
  const { width, height, x, y } = previewContainer.getBoundingClientRect();
  const result = await ipcRenderer.invoke('preview-bounds', { width, height, x, y });
  previewContainer.style = `height: ${result.height}px`;
}

// 保存设置
async function saveSetting() {
  const server = document.getElementById('rtmp_server').value;
  const key = document.getElementById('rtmp_key').value;
  console.log(server, key)
  await ipcRenderer.invoke('update-rtmp', { server, key });
  getStream()
}

// 获取setting
function getSetting() {
  const cate = document.getElementById('OBSSettingsCategories')
  const result = ipcRenderer.sendSync('getSetting', { name: cate.options[cate.selectedIndex].text });
  console.log(result)
}

// 选择摄像头
function cameraSelectChange() {
  const select = document.getElementById('cameraSelect')
  const result = ipcRenderer.sendSync('cameraSelect', { id: select.options[select.selectedIndex].value });
  console.log(result)
}

// 选择显示器
function displaySelectChange() {
  const select = document.getElementById('displaySelect')
  const result = ipcRenderer.sendSync('selectDisPlay', { id: select.options[select.selectedIndex].value });
  console.log(result)
}

// 设置并展示源数据
function showSourceInfo() {
  const sourceSelect = document.getElementById('sourceSelect')
  const result = ipcRenderer.sendSync('showSourceInfo', { id: sourceSelect.options[sourceSelect.selectedIndex].value });
  console.log(result)
  document.getElementById('response').innerHTML = JSON.stringify(result)
}

// 是否直播
function streaming() {
  const streamingButton = document.getElementById('streaming')
  let status = Boolean(JSON.parse(localStorage.getItem('streaming_status')).status)
  if (!status) {
    console.log('开始直播')
    streamingButton.innerText = '结束直播'
  } else {
    console.log('结束直播')
    streamingButton.innerText = '开始直播'
  }
  ipcRenderer.sendSync('toggleStreaming', status)
  localStorage.setItem('streaming_status', JSON.stringify({ status: !status }))
  console.log('修改后', localStorage.getItem('streaming_status'))
}

const currentWindow = remote.getCurrentWindow();
currentWindow.on('resize', resizePreview);
document.addEventListener("scroll", resizePreview);
var ro = new ResizeObserver(resizePreview);
ro.observe(document.querySelector("#preview"));

try {
  initOBS();
  setupPreview();
  updateUI();
} catch (err) {
  console.log(err)
}
